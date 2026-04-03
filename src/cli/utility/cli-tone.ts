import chalk from "chalk";

/** Italic MCU-flavored one-liner (facts stay on plain lines above/below). */
export function printAside(emoji: string, line: string): void {
  console.log(chalk.dim(`     ${emoji} `) + chalk.italic.hex("#8b949e")(line));
}
