const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env.example") });
const { AuraClient } = require(path.resolve(__dirname, "../dist/client.js"));

/**
 * @typedef {Object} AuralogParams
 * @property {string} type
 * @property {string} message
 * @property {string=} location
 * @property {unknown=} data
 */

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const projectToken =
    process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN ||
    process.env.VITE_AURALOGGER_PROJECT_TOKEN ||
    process.env.AURALOGGER_PROJECT_TOKEN ||
    "";
  if (projectToken) {
    AuraClient.configure(projectToken);
  } else {
    console.warn("[Auralogger] Missing project token env; local-only logging enabled.");
    AuraClient.configure("");
  }
  configured = true;
}

function Auralog(params) {
  ensureConfigured();
  AuraClient.log(params.type, params.message, params.location, params.data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runClientTest() {
  Auralog({ type: "info", message: "client test suite started", location: "node/tests/client.js", data: { source: "node-tests", env: "node" } });
  Auralog({ type: "warn", message: "localStorage quota nearing limit", location: "node/tests/client.js", data: { usedKB: 4800, limitKB: 5120 } });
  Auralog({ type: "error", message: "unhandled promise rejection in fetch", location: "node/tests/client.js", data: { url: "/api/data", reason: "NetworkError: Failed to fetch" } });
  Auralog({ type: "debug", message: "component render cycle complete", location: "node/tests/client.js", data: { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } } });
  Auralog({ type: "info", message: "client test suite finished", location: "node/tests/client.js", data: { logsEmitted: 5 } });

  await sleep(800);
  await AuraClient.closeSocket(3000);
}

const TYPES = ["info", "warn", "error", "debug"];

// Burst: N synchronous Auralog calls in a tight loop — verifies the SDK
// survives a flood and the batcher doesn't drop or deadlock.
async function runClientLoadTest(count = 500) {
  const startedAt = Date.now();
  Auralog({ type: "info", message: "client load test started", location: "node/tests/client.js:load", data: { count } });

  for (let i = 0; i < count; i++) {
    const type = TYPES[i % TYPES.length];
    Auralog({
      type,
      message: `bulk log ${i + 1}/${count}`,
      location: "node/tests/client.js:load",
      data: { i, batch: Math.floor(i / 50), payload: { a: i, b: i * 2, tag: `t${i % 7}` } },
    });
  }

  Auralog({ type: "info", message: "client load test finished", location: "node/tests/client.js:load", data: { count, elapsedMs: Date.now() - startedAt } });
  await sleep(1500);
  await AuraClient.closeSocket(5000);
}

// Awaited async caller — Auralog invoked from inside an async function with awaits
// before/after, simulating real app flows (fetch, then log).
async function runClientAsyncTest() {
  Auralog({ type: "info", message: "client async test started", location: "node/tests/client.js:async", data: { phase: "start" } });

  async function fakeFetch(id) {
    await sleep(20);
    return { id, ok: true };
  }

  for (let i = 0; i < 10; i++) {
    const result = await fakeFetch(i);
    Auralog({
      type: "debug",
      message: `async fetch resolved`,
      location: "node/tests/client.js:async",
      data: { result, i },
    });
  }

  // Fire from inside a then/catch chain too.
  await Promise.resolve()
    .then(() => {
      Auralog({ type: "info", message: "from .then chain", location: "node/tests/client.js:async", data: { chained: true } });
    })
    .catch(() => {
      Auralog({ type: "error", message: "from .catch chain", location: "node/tests/client.js:async", data: { chained: true } });
    });

  Auralog({ type: "info", message: "client async test finished", location: "node/tests/client.js:async", data: { phase: "end" } });
  await sleep(800);
  await AuraClient.closeSocket(3000);
}

// Concurrent: many independent async tasks each emitting logs in parallel —
// verifies thread-of-execution interleaving doesn't corrupt batching.
async function runClientConcurrentAsyncTest(parallel = 25, perTask = 20) {
  Auralog({ type: "info", message: "client concurrent async test started", location: "node/tests/client.js:concurrent", data: { parallel, perTask } });

  const tasks = Array.from({ length: parallel }, (_, taskId) => (async () => {
    for (let i = 0; i < perTask; i++) {
      await sleep(5 + (taskId % 5));
      Auralog({
        type: TYPES[(taskId + i) % TYPES.length],
        message: `task ${taskId} log ${i}`,
        location: "node/tests/client.js:concurrent",
        data: { taskId, i },
      });
    }
  })());

  await Promise.all(tasks);

  Auralog({ type: "info", message: "client concurrent async test finished", location: "node/tests/client.js:concurrent", data: { totalLogs: parallel * perTask } });
  await sleep(1200);
  await AuraClient.closeSocket(5000);
}

module.exports = {
  AuraClient,
  Auralog,
  runClientTest,
  runClientLoadTest,
  runClientAsyncTest,
  runClientConcurrentAsyncTest,
};
