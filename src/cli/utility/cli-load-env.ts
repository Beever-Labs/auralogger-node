/**
 * Loads `.env` / `.env.local` from cwd into `process.env`.
 * Used by the `auralogger` CLI binary and by `AuraServer` (Node, once on first use).
 * `AuraClient` and browser builds never call this.
 */
import * as path from "node:path";

import { config as loadDotenv } from "dotenv";

export function loadCliEnvFiles(cwd: string = process.cwd()): void {
  // Belt-and-suspenders: dotenv v17 logs tips unless quiet; env wins over options otherwise.
  if (process.env.DOTENV_CONFIG_QUIET !== "false") {
    process.env.DOTENV_CONFIG_QUIET = "true";
  }
  loadDotenv({ path: path.join(cwd, ".env"), quiet: true });
  loadDotenv({ path: path.join(cwd, ".env.local"), override: true, quiet: true });
}
