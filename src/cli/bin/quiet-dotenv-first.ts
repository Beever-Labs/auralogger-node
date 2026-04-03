/**
 * Ensures dotenv’s “injecting env…” tips stay off for this process before any
 * `config()` runs. (CLI entry imports this module first.)
 */
if (process.env.DOTENV_CONFIG_QUIET !== "false") {
  process.env.DOTENV_CONFIG_QUIET = "true";
}
