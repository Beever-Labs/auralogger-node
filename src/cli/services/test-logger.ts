import WebSocket from "ws";
import chalk from "chalk";

import { AuraClient } from "../../client/client-log";
import { AuraServer } from "../../server/server-log";
import { printAside } from "../utility/cli-tone";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTestServerlog(): Promise<void> {
  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("server") +
      chalk.white(" logger — 5 peppy test logs incoming."),
  );
  console.log(chalk.dim("   (Same path your real code uses — not a fake shortcut.)"));
  printAside(
    "💚",
    "Banner: That's my secret, Cap — I'm always logging. Five Hulk punches, hold the speech.",
  );
  console.log("");

  for (let i = 1; i <= 5; i++) {
    AuraServer.log("info", `test-serverlog log ${i}/5`, "cli/test-serverlog", {
      i,
      kind: "test-serverlog",
    });
    await sleep(150);
  }

  await sleep(800);
  await AuraServer.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Server burst sent. Peek with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" if the dashboard’s shy."),
  );
  printAside(
    "⚡",
    "Thor: ANOTHER! …fine, five was plenty — peek get-logs if Valhalla stayed weirdly quiet.",
  );
}

export async function runTestClientlog(): Promise<void> {
  const root = globalThis as typeof globalThis & { WebSocket?: unknown };
  if (typeof root.WebSocket !== "function") {
    (root as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
  }

  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("client") +
      chalk.white(" logger — 5 test logs, browser flavor."),
  );
  console.log(chalk.dim("   (Patches in `ws` so Node can fake a browser here.)"));
  printAside("🎭", "We glued WebSocket onto Node — method acting for AuraClient.");
  console.log("");

  for (let i = 1; i <= 5; i++) {
    AuraClient.log("info", `test-clientlog log ${i}/5`, "cli/test-clientlog", {
      i,
      kind: "test-clientlog",
    });
    await sleep(150);
  }

  await sleep(800);
  await AuraClient.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Client burst sent. Spy with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" when curious."),
  );
  printAside(
    "🕷️",
    "Parker juggling plates: \"I'm okay, I'm okay!\" — five client logs, not a drop of Stark sauce spilled.",
  );
}
