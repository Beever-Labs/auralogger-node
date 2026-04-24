import { buildProjAuthUrl, resolveApiBaseUrl, resolveWsBaseUrl } from "../utils/backend-origin";
import { DEFAULT_SOCKET_IDLE_CLOSE_MS } from "../utils/socket-idle-close";
import { resolveStylesForConsolePrint } from "../utils/env-config";
import { parseErrorBody } from "../utils/http-utils";
import { printLog } from "../cli/services/log-print";
import { buildStyleEntriesFromProjAuth } from "../cli/utility/log-styles";

interface WebSocketLike {
  readyState: number;
  send(data: string, cb?: (error?: Error) => void): void;
  close(): void;
  on?(event: string, cb: (...args: unknown[]) => void): void;
  once?(event: string, cb: (...args: unknown[]) => void): void;
  addEventListener?(
    type: string,
    listener: (ev: unknown) => void,
    options?: boolean | { once?: boolean },
  ): void;
}

interface LogPayload {
  type: string;
  message: string;
  session: string;
  location?: string;
  data?: string;
  created_at: string;
}

const UNKNOWN_TYPE = "unknown";
const LOCAL_FALLBACK_SESSION = "auralogger-local-session";
const BATCH_FLUSH_INTERVAL_MS = 30;
const BATCH_MAX_SIZE = 30;
const PROJ_AUTH_RETRY_ATTEMPTS = 3;
const PROJ_AUTH_RETRY_DELAY_MS = 500;

function isDebugEnabled(): boolean {
  const g = globalThis as { AURALOGGER_DEBUG?: unknown };
  if (g.AURALOGGER_DEBUG === true || g.AURALOGGER_DEBUG === "1") return true;
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.AURALOGGER_DEBUG;
    if (typeof v === "string" && v.trim() && v.trim() !== "0" && v.trim().toLowerCase() !== "false") {
      return true;
    }
  }
  return false;
}

function trace(event: string, details?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  if (details) console.log(`auralogger: [AuraClient] ${event}`, details);
  else console.log(`auralogger: [AuraClient] ${event}`);
}

let projectToken: string | null = null;
let session: string | null = null;
let styles: unknown = undefined;
let projAuthPromise: Promise<boolean> | null = null;

let socket: WebSocketLike | null = null;
let socketUrl: string | null = null;
let socketIdleTimer: ReturnType<typeof setTimeout> | null = null;

let batch: LogPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let warnedMissingWebSocket = false;

const deferTask =
  typeof setImmediate === "function"
    ? (task: () => void) => setImmediate(task)
    : (task: () => void) => setTimeout(task, 0);

function wsStates(): { CONNECTING: number; OPEN: number; CLOSED: number } {
  const W = (globalThis as { WebSocket?: { CONNECTING?: number; OPEN?: number; CLOSED?: number } })
    .WebSocket;
  return {
    CONNECTING: W?.CONNECTING ?? 0,
    OPEN: W?.OPEN ?? 1,
    CLOSED: W?.CLOSED ?? 3,
  };
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function padMicros(us: number): string {
  return String(us).padStart(6, "0");
}

function createIsoTimestampWithMicroseconds(epochMs: number): string {
  const d = new Date(epochMs);
  const iso = d.toISOString();
  const micros = padMicros(d.getUTCMilliseconds() * 1_000);
  return `${iso.slice(0, 19)}.${micros}Z`;
}

function normalizeType(type: string): string {
  return type.trim() ? type.trim() : UNKNOWN_TYPE;
}

function normalizeLocation(location?: string): string | undefined {
  if (typeof location !== "string") return undefined;
  const trimmed = location.trim();
  return trimmed || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maybeData(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return data;
  if (!isPlainObject(data)) return undefined;
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function isPlainAuthResponse(v: unknown): v is { project_id?: unknown; session?: unknown; styles?: unknown } {
  return v !== null && typeof v === "object";
}

async function fetchProjAuthOnce(token: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(buildProjAuthUrl(resolveApiBaseUrl(), token), { method: "POST" });
  } catch (err: unknown) {
    trace("proj_auth.network_error", { message: toErrorMessage(err) });
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!response.ok) {
    const body = await parseErrorBody(response).catch(() => "Request failed.");
    trace("proj_auth.http_error", { status: response.status, body });
    throw new Error(`proj_auth HTTP ${response.status}: ${body}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    trace("proj_auth.non_json");
    throw new Error("proj_auth replied with non-JSON");
  }
  if (!isPlainAuthResponse(data)) {
    trace("proj_auth.bad_shape");
    throw new Error("proj_auth response shape unexpected");
  }
  const pid = typeof data.project_id === "string" ? data.project_id.trim() : "";
  const sess = typeof data.session === "string" ? data.session.trim() : "";
  if (!pid || !sess) {
    trace("proj_auth.invalid_response", { hasProjectId: !!pid, hasSession: !!sess });
    throw new Error("proj_auth response missing project id or session");
  }
  session = sess;
  styles = buildStyleEntriesFromProjAuth(data.styles);
  trace("proj_auth.ok", { session: sess });
  return true;
}

async function fetchProjAuth(token: string): Promise<boolean> {
  trace("proj_auth.start", { hasToken: !!token });
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PROJ_AUTH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchProjAuthOnce(token);
    } catch (err: unknown) {
      lastError = err;
      trace("proj_auth.attempt_failed", {
        attempt,
        max: PROJ_AUTH_RETRY_ATTEMPTS,
        message: toErrorMessage(err),
      });
      if (attempt < PROJ_AUTH_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, PROJ_AUTH_RETRY_DELAY_MS));
      }
    }
  }
  console.warn(
    `auralogger: proj_auth failed after ${PROJ_AUTH_RETRY_ATTEMPTS} attempts; local-only logging (${toErrorMessage(lastError)})`,
  );
  return false;
}

function startProjAuthOnce(): void {
  if (projAuthPromise || !projectToken) return;
  const token = projectToken;
  trace("proj_auth.once.start", { tokenPresent: true });
  projAuthPromise = fetchProjAuth(token)
    .catch((err) => {
      console.error(`auralogger: proj_auth failed: ${toErrorMessage(err)}`);
      trace("proj_auth.once.error", { message: toErrorMessage(err) });
      return false;
    })
    .then((ok) => {
      // On failure, clear the cached promise so subsequent log calls can try again
      // instead of being permanently stuck in local-only mode after a transient failure.
      if (!ok) projAuthPromise = null;
      return ok;
    });
}

function clearSocketIdleTimer(): void {
  if (socketIdleTimer !== null) {
    clearTimeout(socketIdleTimer);
    socketIdleTimer = null;
    trace("socket_idle_timer.cleared");
  }
}

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
    trace("flush_timer.cleared");
  }
}

function bumpSocketIdleTimer(ws: WebSocketLike): void {
  const { OPEN } = wsStates();
  clearSocketIdleTimer();
  socketIdleTimer = setTimeout(() => {
    socketIdleTimer = null;
    if (socket !== ws || ws.readyState !== OPEN) return;
    trace("socket_idle_timer.fired_close");
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }, DEFAULT_SOCKET_IDLE_CLOSE_MS);
  trace("socket_idle_timer.set", { ms: DEFAULT_SOCKET_IDLE_CLOSE_MS });
}

function socketOnce(ws: WebSocketLike, event: "open" | "error" | "close", handler: () => void): void {
  if (typeof ws.once === "function") {
    ws.once(event, handler);
    return;
  }
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, () => handler(), { once: true });
  }
}

function attachLifecycle(ws: WebSocketLike, url: string): void {
  const onOpen = () => {
    trace("socket.event.open");
    bumpSocketIdleTimer(ws);
  };
  const onClose = () => {
    trace("socket.event.close");
    clearSocketIdleTimer();
    if (socket === ws) {
      socket = null;
      socketUrl = null;
    }
  };
  const onErr = (...args: unknown[]) => {
    const first = args[0];
    const msg = first instanceof Error ? first.message : String(first ?? "error");
    console.error(`auralogger: [AuraClient] websocket error — ${url} — ${msg}`);
    trace("socket.event.error", { message: msg, url });
  };
  if (typeof ws.on === "function") {
    ws.on("open", onOpen);
    ws.on("close", onClose);
    ws.on("error", onErr);
    return;
  }
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("open", () => onOpen());
    ws.addEventListener("close", () => onClose());
    ws.addEventListener("error", (ev) => onErr(ev));
  }
}

function createWebSocket(url: string): WebSocketLike | null {
  const Ctor = (globalThis as { WebSocket?: new (u: string) => unknown }).WebSocket;
  if (typeof Ctor !== "function") {
    if (!warnedMissingWebSocket) {
      warnedMissingWebSocket = true;
      console.error("auralogger: WebSocket is not available in this browser environment.");
      trace("socket.missing_websocket_ctor");
    }
    return null;
  }
  try {
    trace("socket.ctor", { url });
    return new Ctor(url) as WebSocketLike;
  } catch (err: unknown) {
    console.error(`auralogger: could not open websocket. ${toErrorMessage(err)}`);
    trace("socket.ctor_error", { message: toErrorMessage(err) });
    return null;
  }
}

function openSocketIfNeeded(): WebSocketLike | null {
  if (!projectToken) return null;
  const { CONNECTING, OPEN, CLOSED } = wsStates();
  const url = `${resolveWsBaseUrl()}/${projectToken}/create_browser_logs`;
  if (socket && socketUrl === url && (socket.readyState === OPEN || socket.readyState === CONNECTING)) {
    trace("socket.reuse", { readyState: socket.readyState });
    return socket;
  }
  if (socket && socket.readyState !== CLOSED) {
    clearSocketIdleTimer();
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  const fresh = createWebSocket(url);
  if (!fresh) {
    socket = null;
    socketUrl = null;
    return null;
  }
  trace("socket.open", { url });
  attachLifecycle(fresh, url);
  socket = fresh;
  socketUrl = url;
  return socket;
}

function sendOverSocket(ws: WebSocketLike, payload: string, onErr: (err: unknown) => void): void {
  const nodeStyle = typeof ws.on === "function";
  try {
    if (nodeStyle) {
      ws.send(payload, (err?: Error) => {
        if (err) onErr(err);
      });
    } else {
      ws.send(payload);
    }
  } catch (err: unknown) {
    onErr(err);
  }
}

function dropCurrentSocket(): void {
  const { CLOSED } = wsStates();
  if (socket && socket.readyState !== CLOSED) {
    clearSocketIdleTimer();
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  socket = null;
  socketUrl = null;
}

async function sendSerializedOverSocket(
  ws: WebSocketLike,
  serialized: string,
  onErr: (err: unknown) => void,
): Promise<void> {
  const { OPEN, CONNECTING } = wsStates();
  if (ws.readyState === OPEN) {
    bumpSocketIdleTimer(ws);
    sendOverSocket(ws, serialized, onErr);
    trace("send_batch.sent", { mode: "open" });
    return;
  }
  if (ws.readyState === CONNECTING) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      socketOnce(ws, "open", () => {
        bumpSocketIdleTimer(ws);
        sendOverSocket(ws, serialized, onErr);
        trace("send_batch.sent", { mode: "connecting->open" });
        finish();
      });
      socketOnce(ws, "error", () => {
        onErr(new Error("websocket errored while connecting"));
        finish();
      });
      socketOnce(ws, "close", () => {
        onErr(new Error("websocket closed while connecting"));
        finish();
      });
    });
    return;
  }
  onErr(new Error(`websocket in bad state (readyState=${ws.readyState})`));
}

async function sendBatch(payloads: LogPayload[]): Promise<boolean> {
  trace("send_batch.start", { count: payloads.length });

  let serialized: string;
  try {
    serialized = JSON.stringify(payloads);
  } catch (err: unknown) {
    console.error(`auralogger: failed to serialize log batch: ${toErrorMessage(err)}`);
    trace("send_batch.serialize_error", { message: toErrorMessage(err) });
    return false;
  }

  const ws = openSocketIfNeeded();
  if (!ws) return false;

  let sendError: unknown = null;
  await sendSerializedOverSocket(ws, serialized, (err) => {
    sendError = err;
  });

  if (!sendError) return true;

  // First attempt failed — rebuild the socket and retry once, matching the
  // old 2/2 retry behaviour. Don't permanently disable the logger.
  console.warn(
    `auralogger: websocket send failed (${toErrorMessage(sendError)}); retrying with fresh socket (2/2)...`,
  );
  trace("send_batch.retry.start", { message: toErrorMessage(sendError) });
  dropCurrentSocket();

  const retryWs = openSocketIfNeeded();
  if (!retryWs) {
    console.error("auralogger: websocket unavailable after retry; dropping batch.");
    trace("send_batch.retry.no_socket");
    return false;
  }

  let retryError: unknown = null;
  await sendSerializedOverSocket(retryWs, serialized, (err) => {
    retryError = err;
  });

  if (retryError) {
    console.error(
      `auralogger: websocket send failed after retry: ${toErrorMessage(retryError)}`,
    );
    trace("send_batch.retry.failed", { message: toErrorMessage(retryError) });
    dropCurrentSocket();
    return false;
  }

  trace("send_batch.retry.sent");
  return true;
}

async function flushNow(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  clearFlushTimer();
  trace("flush.start", { queued: batch.length });
  try {
    if (!projAuthPromise) return;
    const ok = await projAuthPromise;
    if (!ok || !session) {
      // proj_auth failed. Drop the current batch (same as before) but DO NOT
      // permanently disable the logger — startProjAuthOnce already cleared the
      // cached promise on failure, so the next log() call will kick off a fresh
      // proj_auth attempt (which itself has 3 internal retries).
      batch = [];
      trace("flush.proj_auth_failed_drop_batch", { ok, hasSession: !!session });
      return;
    }
    const liveSession = session;
    while (batch.length > 0) {
      const slice = batch.slice(0, BATCH_MAX_SIZE);
      for (const p of slice) p.session = liveSession;
      trace("flush.slice", { slice: slice.length, remainingBefore: batch.length });
      const sent = await sendBatch(slice);
      if (!sent) {
        // Drop the slice we tried to send (best-effort semantics), but keep any
        // later logs that may have been queued during the send attempt so the
        // next flush can try them with a fresh socket.
        batch.splice(0, slice.length);
        trace("flush.send_failed_drop_slice", { dropped: slice.length, remaining: batch.length });
        if (batch.length > 0) scheduleFlush();
        return;
      }
      batch.splice(0, slice.length);
      trace("flush.slice_done", { remainingAfter: batch.length });
    }
  } finally {
    flushInFlight = false;
    trace("flush.end", { queued: batch.length });
  }
}

function scheduleFlush(): void {
  clearFlushTimer();
  flushTimer = setTimeout(() => {
    flushTimer = null;
    trace("flush_timer.fire");
    void flushNow();
  }, BATCH_FLUSH_INTERVAL_MS);
  trace("flush_timer.set", { ms: BATCH_FLUSH_INTERVAL_MS });
}

function processLog(type: string, message: string, nowMs: number, location?: string, data?: unknown): void {
  trace("process_log.start", {
    type,
    messageLen: String(message ?? "").length,
    hasLocation: typeof location === "string" && !!location.trim(),
    hasData: data !== null && data !== undefined,
    nowMs,
  });
  const payload: LogPayload = {
    type: normalizeType(type),
    message: String(message ?? ""),
    session: session ?? LOCAL_FALLBACK_SESSION,
    created_at: createIsoTimestampWithMicroseconds(nowMs),
  };
  const loc = normalizeLocation(location);
  if (loc) payload.location = loc;
  const d = maybeData(data);
  if (d) payload.data = d;

  try {
    printLog(payload, resolveStylesForConsolePrint(styles));
    trace("process_log.printed", { session: payload.session });
  } catch (err: unknown) {
    console.error(`auralogger: failed to print log: ${toErrorMessage(err)}`);
    trace("process_log.print_error", { message: toErrorMessage(err) });
  }

  if (!projectToken) return;

  startProjAuthOnce();

  const wasEmpty = batch.length === 0;
  batch.push(payload);
  trace("batch.push", { queued: batch.length, wasEmpty });
  if (batch.length >= BATCH_MAX_SIZE) {
    trace("batch.max_reached_flush_now", { max: BATCH_MAX_SIZE });
    void flushNow();
    return;
  }
  if (wasEmpty) scheduleFlush();
}

export class AuraClient {
  /**
   * @param projectToken Project token string, or `{ projectToken }` (object form accepted for convenience).
   */
  static configure(input: string | { projectToken: unknown }): void {
    trace("configure.enter", {
      inputType: typeof input,
      tokenPresent: !!(typeof input === "string" ? input.trim() : String(input?.projectToken ?? "").trim()),
    });
    const raw = typeof input === "string" ? input : input?.projectToken;
    const token = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();

    session = null;
    styles = undefined;
    projAuthPromise = null;
    batch = [];
    clearFlushTimer();
    flushInFlight = false;
    warnedMissingWebSocket = false;

    if (!token) {
      projectToken = null;
      console.warn(
        "auralogger: AuraClient.configure called with empty token; continuing in local-only mode.",
      );
      trace("configure.local_only");
      return;
    }
    projectToken = token;
    startProjAuthOnce();
    trace("configure.ok");
  }

  static log(type: string, message: string, location?: string, data?: unknown): void {
    trace("log.enter", {
      type,
      messageLen: String(message ?? "").length,
      hasLocation: typeof location === "string" && !!location.trim(),
      hasData: data !== null && data !== undefined,
    });
    const nowMs = Date.now();
    trace("log.timestamp", { nowMs });
    deferTask(() => {
      try {
        trace("log.dispatch.start");
        processLog(type, message, nowMs, location, data);
        trace("log.dispatch.done");
      } catch (err: unknown) {
        console.error(`auralogger: log dispatch failed: ${toErrorMessage(err)}`);
        trace("log.dispatch.error", { message: toErrorMessage(err) });
      } finally {
        trace("log.dispatch.finally");
      }
    });
    trace("log.defer_scheduled");
  }

  static async closeSocket(timeoutMs = 1000): Promise<void> {
    trace("close_socket.enter", { timeoutMs });
    // Drain pending deferTask callbacks so log() calls made just before closeSocket()
    // get a chance to enqueue their payloads.
    await new Promise<void>((resolve) => deferTask(resolve));
    if (projAuthPromise) {
      try {
        await projAuthPromise;
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => deferTask(resolve));
    await flushNow();
    clearSocketIdleTimer();
    if (!socket) return;

    const { CONNECTING, OPEN, CLOSED } = wsStates();
    const ws = socket;
    if (ws.readyState === CLOSED) {
      socket = null;
      socketUrl = null;
      trace("close_socket.socket_already_closed");
      return;
    }
    if (ws.readyState === CONNECTING) {
      trace("close_socket.wait_connecting");
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        socketOnce(ws, "open", () => {
          clearTimeout(t);
          resolve();
        });
        socketOnce(ws, "error", () => {
          clearTimeout(t);
          resolve();
        });
        socketOnce(ws, "close", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (ws.readyState !== OPEN) return;

    trace("close_socket.closing");
    await new Promise<void>((resolve) => {
      let done = false;
      const fin = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const t = setTimeout(fin, timeoutMs);
      socketOnce(ws, "close", () => {
        clearTimeout(t);
        fin();
      });
      socketOnce(ws, "error", () => {
        clearTimeout(t);
        fin();
      });
      try {
        ws.close();
      } catch {
        clearTimeout(t);
        fin();
      }
    });
    trace("close_socket.done");
  }
}
