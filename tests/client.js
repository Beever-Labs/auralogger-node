const path = require("node:path");

const { DEFAULT_TEST_PROJECT_TOKEN } = require("./harness-defaults.json");
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
    DEFAULT_TEST_PROJECT_TOKEN;
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

module.exports = {
  AuraClient,
  Auralog,
  runClientTest,
};
