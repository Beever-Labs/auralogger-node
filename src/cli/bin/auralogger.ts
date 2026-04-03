#!/usr/bin/env node

import "./quiet-dotenv-first";

import chalk from "chalk";

import { loadCliEnvFiles } from "../utility/cli-load-env";
import { printAside } from "../utility/cli-tone";
import { runTestClientlog } from "../services/test-logger";
import { runGetLogs } from "../services/get-logs";
import { runInit } from "../services/init";
import { runClientCheck } from "../services/client-check";
import { runServerCheck } from "../services/server-check";
import { runTestServerlog } from "../services/test-logger";

function printUsage(): void {
  console.log("");
  console.log(chalk.bold.hex("#ffa657")("✨ Auralogger CLI") + chalk.dim(" — pick a command:"));
  console.log(chalk.hex("#7ee787")("  init") + chalk.dim("           wire up secrets + copy-paste client config"));
  console.log(chalk.hex("#7ee787")("  server-check") + chalk.dim("    make sure the server logger can talk"));
  console.log(chalk.hex("#7ee787")("  client-check") + chalk.dim("   same vibes, browser-style pipe"));
  console.log(chalk.hex("#7ee787")("  test-serverlog") + chalk.dim("  five fake server logs, just for kicks"));
  console.log(chalk.hex("#7ee787")("  test-clientlog") + chalk.dim("  five fake client logs, same deal"));
  console.log(chalk.hex("#7ee787")("  get-logs") + chalk.dim("       hunt past logs (filters optional)"));
  console.log("");
  console.log(chalk.dim("Docs live on npm: auralogger-cli — filter cheat sheet is there."));
  printAside("🕶️", "Fury: There was an idea — pick an Avenger from the list. Or a subcommand, whatever.");
  console.log("");
}

async function main(): Promise<void> {
  loadCliEnvFiles();

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    return;
  }

  if (command === "init") {
    await runInit();
    return;
  }

  if (command === "get-logs") {
    await runGetLogs(args);
    return;
  }

  if (command === "server-check") {
    await runServerCheck();
    return;
  }

  if (command === "client-check") {
    await runClientCheck();
    return;
  }

  if (command === "test-serverlog") {
    await runTestServerlog();
    return;
  }

  if (command === "test-clientlog") {
    await runTestClientlog();
    return;
  }

  console.error(chalk.red("🤔 Hmm, never heard of ") + chalk.bold(command) + chalk.red("."));
  printAside("❓", "That's not on the briefing — choose a codename we actually use.");
  printUsage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red("💥 That didn’t work — ") + message);
  printAside("🎬", "Stark: Not a great showing — read the red text, then try again with swagger.");
  process.exit(1);
});
