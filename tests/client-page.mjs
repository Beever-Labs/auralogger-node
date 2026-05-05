/**
 * Browser harness: loads the bundled SDK so AuraClient runs in the page (DevTools console).
 *
 * From the `node/` folder (where package.json lives):
 *   npm run build && npm run bundle:test-client
 *
 * Optional URL flags:
 *   ?projectToken=...           — one-off token (not stored)
 *   ?auraloggerDebug=1        — sets globalThis.__AURALOGGER_DEBUG__ for `auralogger:debug` lines in client-log
 *
 * Project token resolution (browser):
 *   1) ?projectToken=...
 *   2) localStorage["AURALOGGER_PROJECT_TOKEN"]
 *   3) empty string (local-only mode)
 */
import clientModule from "./auralogger-client.browser.mjs";

const { AuraClient } = clientModule;

function maybeEnableDebugFromUrl() {
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  if (params.get("auraloggerDebug") === "1") {
    globalThis.__AURALOGGER_DEBUG__ = true;
  }
}

async function resolveProjectToken() {
  maybeEnableDebugFromUrl();

  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const fromQuery = params.get("projectToken")?.trim();
  if (fromQuery) {
    return fromQuery;
  }

  const fromLocalStorage = globalThis.localStorage?.getItem("AURALOGGER_PROJECT_TOKEN")?.trim();
  if (fromLocalStorage) {
    return fromLocalStorage;
  }

  return "";
}

let configured = false;

async function ensureConfigured() {
  if (configured) {
    return;
  }
  AuraClient.configure(await resolveProjectToken());
  configured = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs AuraClient in the browser; styled log lines appear in DevTools. Waits for batch flush via closeSocket. */
export async function runClientTest() {
  console.log(
    "[browser] AuraClient.log → open DevTools Console. Add ?auraloggerDebug=1 for SDK debug lines.",
  );
  await ensureConfigured();

  const clientLogs = [
    ["info", "client test suite started", "node/tests/index.html", { source: "test-page-client" }],
    ["warn", "localStorage quota nearing limit", "node/tests/index.html", { usedKB: 4800, limitKB: 5120 }],
    ["error", "unhandled promise rejection in fetch", "node/tests/index.html", { url: "/api/data", reason: "NetworkError: Failed to fetch" }],
    ["debug", "component render cycle complete", "node/tests/index.html", { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } }],
    ["info", "client test suite finished", "node/tests/index.html", { logsEmitted: 5 }],
  ];

  for (const args of clientLogs) {
    AuraClient.log(...args);
    await sleep(150);
  }

  await sleep(800);
  await AuraClient.closeSocket(3000);
  return { ok: true, route: "browser", logged: true };
}

const TYPES = ["info", "warn", "error", "debug"];

/** Burst of N synchronous AuraClient.log calls in the browser. */
export async function runClientLoadTest(count = 500) {
  await ensureConfigured();
  const startedAt = Date.now();
  AuraClient.log("info", "browser load test started", "node/tests/index.html:load", { count });

  for (let i = 0; i < count; i++) {
    AuraClient.log(
      TYPES[i % TYPES.length],
      `bulk log ${i + 1}/${count}`,
      "node/tests/index.html:load",
      { i, batch: Math.floor(i / 50), payload: { a: i, b: i * 2 } },
    );
  }

  AuraClient.log("info", "browser load test finished", "node/tests/index.html:load", { count, elapsedMs: Date.now() - startedAt });
  await sleep(1500);
  await AuraClient.closeSocket(5000);
  return { ok: true, route: "browser-load", count };
}

/** Awaited async caller — fetch-style awaits between AuraClient.log calls. */
export async function runClientAsyncTest() {
  await ensureConfigured();
  AuraClient.log("info", "browser async test started", "node/tests/index.html:async", { phase: "start" });

  async function fakeFetch(id) {
    await sleep(20);
    return { id, ok: true };
  }

  for (let i = 0; i < 10; i++) {
    const result = await fakeFetch(i);
    AuraClient.log("debug", "async fetch resolved", "node/tests/index.html:async", { result, i });
  }

  await Promise.resolve()
    .then(() => AuraClient.log("info", "from .then chain", "node/tests/index.html:async", { chained: true }))
    .catch(() => AuraClient.log("error", "from .catch chain", "node/tests/index.html:async", { chained: true }));

  AuraClient.log("info", "browser async test finished", "node/tests/index.html:async", { phase: "end" });
  await sleep(800);
  await AuraClient.closeSocket(3000);
  return { ok: true, route: "browser-async" };
}

/** Many concurrent async tasks each emitting logs in parallel. */
export async function runClientConcurrentAsyncTest(parallel = 25, perTask = 20) {
  await ensureConfigured();
  AuraClient.log("info", "browser concurrent async test started", "node/tests/index.html:concurrent", { parallel, perTask });

  const tasks = Array.from({ length: parallel }, (_, taskId) => (async () => {
    for (let i = 0; i < perTask; i++) {
      await sleep(5 + (taskId % 5));
      AuraClient.log(
        TYPES[(taskId + i) % TYPES.length],
        `task ${taskId} log ${i}`,
        "node/tests/index.html:concurrent",
        { taskId, i },
      );
    }
  })());

  await Promise.all(tasks);

  AuraClient.log("info", "browser concurrent async test finished", "node/tests/index.html:concurrent", { totalLogs: parallel * perTask });
  await sleep(1200);
  await AuraClient.closeSocket(5000);
  return { ok: true, route: "browser-concurrent" };
}

async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Triggers Node AuraServer log via GET /test. */
export async function runServerTest() {
  const res = await fetch("/test");
  const body = await readJsonResponse(res);
  if (!res.ok) {
    const err =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : String(body);
    throw new Error(err);
  }
  return body;
}

/** Triggers Node AuraClient (with ws polyfill) via GET /test-client. */
export async function runNodeClientTest() {
  const res = await fetch("/test-client");
  const body = await readJsonResponse(res);
  if (!res.ok) {
    const err =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : String(body);
    throw new Error(err);
  }
  return body;
}
