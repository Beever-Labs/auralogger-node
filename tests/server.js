const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env.example") });
const { AuraServer } = require(path.resolve(__dirname, "../dist/server.js"));

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
  const userSecret = process.env.AURALOGGER_USER_SECRET || "";
  if (projectToken && userSecret) {
    AuraServer.configure(projectToken, userSecret);
  } else {
    console.warn("[Auralogger] Missing server credentials env; local-only logging enabled.");
    AuraServer.configure(projectToken || "", userSecret);
  }
  configured = true;
}

function AuraLog(params) {
  ensureConfigured();
  AuraServer.log(params.type, params.message, params.location, params.data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runServerTest() {
  AuraLog({ type: "info", message: "server test suite started", location: "node/tests/local-server.js:/test", data: { source: "test-api-route", env: "test" } });
  AuraLog({ type: "warn", message: "rate limit threshold approaching", location: "node/tests/local-server.js:/test", data: { currentRate: 480, limit: 500, unit: "req/min" } });
  AuraLog({ type: "error", message: "failed to connect to upstream service", location: "node/tests/local-server.js:/test", data: { service: "auth-api", statusCode: 503, retries: 3 } });
  AuraLog({ type: "debug", message: "request payload parsed successfully", location: "node/tests/local-server.js:/test", data: { userId: "usr_42", action: "login", durationMs: 12 } });
  AuraLog({ type: "info", message: "server test suite finished", location: "node/tests/local-server.js:/test", data: { logsEmitted: 5 } });

  await sleep(800);
  await AuraServer.closeSocket(3000);
}

const TYPES = ["info", "warn", "error", "debug"];

// Burst: large synchronous flood — checks the server SDK doesn't drop under load.
async function runServerLoadTest(count = 500) {
  const startedAt = Date.now();
  AuraLog({ type: "info", message: "server load test started", location: "node/tests/server.js:load", data: { count } });

  for (let i = 0; i < count; i++) {
    AuraLog({
      type: TYPES[i % TYPES.length],
      message: `bulk log ${i + 1}/${count}`,
      location: "node/tests/server.js:load",
      data: { i, batch: Math.floor(i / 50), payload: { a: i, b: i * 2, tag: `t${i % 7}` } },
    });
  }

  AuraLog({ type: "info", message: "server load test finished", location: "node/tests/server.js:load", data: { count, elapsedMs: Date.now() - startedAt } });
  await sleep(1500);
  await AuraServer.closeSocket(5000);
}

// Logs called from inside async handlers with awaits (mimics request handler shape).
async function runServerAsyncTest() {
  AuraLog({ type: "info", message: "server async test started", location: "node/tests/server.js:async", data: { phase: "start" } });

  async function fakeDbQuery(id) {
    await sleep(20);
    return { id, rows: [{ id, name: `user_${id}` }] };
  }

  for (let i = 0; i < 10; i++) {
    const result = await fakeDbQuery(i);
    AuraLog({
      type: "debug",
      message: "async db query resolved",
      location: "node/tests/server.js:async",
      data: { result, i },
    });
  }

  await Promise.resolve()
    .then(() => {
      AuraLog({ type: "info", message: "from .then chain", location: "node/tests/server.js:async", data: { chained: true } });
    })
    .catch(() => {
      AuraLog({ type: "error", message: "from .catch chain", location: "node/tests/server.js:async", data: { chained: true } });
    });

  AuraLog({ type: "info", message: "server async test finished", location: "node/tests/server.js:async", data: { phase: "end" } });
  await sleep(800);
  await AuraServer.closeSocket(3000);
}

// Concurrent async handlers — simulates many in-flight requests logging in parallel.
async function runServerConcurrentAsyncTest(parallel = 25, perTask = 20) {
  AuraLog({ type: "info", message: "server concurrent async test started", location: "node/tests/server.js:concurrent", data: { parallel, perTask } });

  const tasks = Array.from({ length: parallel }, (_, taskId) => (async () => {
    for (let i = 0; i < perTask; i++) {
      await sleep(5 + (taskId % 5));
      AuraLog({
        type: TYPES[(taskId + i) % TYPES.length],
        message: `req ${taskId} step ${i}`,
        location: "node/tests/server.js:concurrent",
        data: { taskId, i },
      });
    }
  })());

  await Promise.all(tasks);

  AuraLog({ type: "info", message: "server concurrent async test finished", location: "node/tests/server.js:concurrent", data: { totalLogs: parallel * perTask } });
  await sleep(1200);
  await AuraServer.closeSocket(5000);
}

module.exports = {
  AuraLog,
  AuraServer,
  runServerTest,
  runServerLoadTest,
  runServerAsyncTest,
  runServerConcurrentAsyncTest,
};
