# Dev docs (repository only)

`**dev-docs/**` is for **contributors** working from a Git clone. End users start at `**[../readme.md](../readme.md)`** and `**[../user-docs/](../user-docs/)**`.

**Docs index:** `**[../docs/README.md](../docs/README.md)`** (where everything lives now).

## Start here


| Doc                                                    | Purpose                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `[file-map.md](file-map.md)`                           | **Source map:** every meaningful `src/` file + `package.json` exports                                |
| `[feature-flows.md](feature-flows.md)`                 | **End-to-end flows:** init, get-logs, checks, `AuraServer` / `AuraClient` (diagrams + credentials)   |
| `[api-urls.md](api-urls.md)`                           | **HTTP vs WebSocket origins:** defaults, `AURALOGGER_API_URL` / `AURALOGGER_WS_URL`, troubleshooting |
| `[routes.md](routes.md)`                               | HTTP + WebSocket **routes** (paths, auth); links to `api-urls.md` for bases                          |
| `[infra.md](infra.md)`                                 | Backend / ingest assumptions (no storage implementation in this repo)                                |
| `[bdd.md](bdd.md)`                                     | Observable behavior for `AuraServer`, `AuraClient`, CLI                                              |
| `[../user-docs/commands.md](../user-docs/commands.md)` | CLI cheat sheet (filters)                                                                            |


## Current package behavior (high level)

- `**AuraServer`** (Node, `auralogger-cli/server`): uses `ws`. `**POST /api/{project_token}/proj_auth**` (token in path). After configure/env, id/session/styles load from `**proj_auth**`. Server ingest WebSocket: `**/{proj_token}/create_log**` with `**Authorization: Bearer <user_secret>**` (see `**server-log.ts**`). `**AuraServer.log` does not print successful logs to the console** — only errors / connection issues. `**auralogger get-logs`** still prints rows with `**chalk**` via `**log-print.ts**` when styles resolve. Browser bundles that import `./server` get `**server.browser.ts**` (stub).
- `**AuraClient**` (browser-safe, `auralogger-cli/client`): **global `WebSocket`**, **no user secret**. `**AuraClient.configure(projectToken )`** only; hydrates via `**POST /api/{project_token}/proj_auth**`. Browser ingest: `**/{proj_token}/create_browser_logs**` (path token in URL; no custom socket headers). `**AuraClient.log` does not mirror successful logs to the browser console** — only problems log with `**console.error`** / `**console.warn**`.

## CLI

- Entry: `**src/cli/bin/auralogger.ts**` → `loadCliEnvFiles()` then subcommands.
- `**init**`: banner → prompts → `POST /api/{project_token}/proj_auth` (token in path), **session summary**, **copy-paste dotenv** (up to five lines: server token, user secret, session, `**NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`**, `**VITE_AURALOGGER_PROJECT_TOKEN**` — no id/styles keys); snippets are `**Auralog**` and `**AuraLog**`.
- Recommended invocation for apps: `**npx auralogger-cli …**` (project-scoped; see readme).

## Build

- `**package.json**`: `"build": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\" && tsc"` — always clean compile output.

## Test

This repo has a small **local harness** under `tests/`:

- Browser harness (open in your browser): `tests/index.html`
- Node routes (used by the browser page):
  - `GET /test` → `AuraServer` (server SDK)
  - `GET /test-client` → `AuraClient` (client SDK, but executed in Node with ws polyfill)
  - Load/async variants: `/test-load`, `/test-async`, `/test-concurrent`, plus `*-client-*` equivalents

### 1) Prep credentials

Tests read env from `**node/.env.example`** (loaded by the harness using `dotenv`).

- If you want the harness to stream logs to the hosted backend, set at least:
  - `AURALOGGER_PROJECT_TOKEN`
  - `AURALOGGER_USER_SECRET` (required for `AuraServer` encrypted ingest)

### 2) Build + bundle the browser client

From the repo root (PowerShell-friendly):

```bash
cd node
npm run build
npm run bundle:test-client
```

### 3) Start the local test server

```bash
cd node
node tests/local-server.js
```
 127.0.0.1:4173 
run the test server on a different port
Your harness supports AURALOGGER_TEST_PORT, so do:

cd E:\codebases\auralogger\auralogger-cli\Auralogger-cli\node
$env:AURALOGGER_TEST_PORT=5173
node tests/local-server.js
Then open http://127.0.0.1:5173/.

If you want, paste the output of:

Get-NetTCPConnection -LocalPort 4173 -State Listen | Format-List *
and I’ll tell you exactly what’s holding the port.





Expected output includes:

- `Auralogger test server running at http://127.0.0.1:4173`

Optional:

- Change port: set `AURALOGGER_TEST_PORT` (see `tests/local-server.js`).

### 4) Run and check tests

#### Browser harness

1. Open `http://127.0.0.1:4173/`
2. Click:
  - **Send Client Logs (browser / DevTools)** → should succeed and you’ll see DevTools activity (the SDK only prints warnings/errors by default).
  - **Send Server Logs** → hits `GET /test` and returns JSON. If creds are missing, the route still responds but logs are local-only.
  - **Send Client Logs (Node + ws)** → hits `GET /test-client`

#### Quick route checks (curl)

```bash
curl http://127.0.0.1:4173/test
curl http://127.0.0.1:4173/test-client
curl http://127.0.0.1:4173/test-load
curl http://127.0.0.1:4173/test-client-load
```

#### “Did it actually ingest?”

- **Local check**: `auralogger get-logs -maxcount 20` (ensure you run it in a shell where the same env vars are set / loaded)
- **Dashboard check**: open your project on Auralogger and confirm new logs arrive

### 5) Stop the server

- Press `Ctrl+C` in the terminal running `tests/local-server.js`.

## Contributing (quick)

1. Change `**src/`**; keep `**dev-docs/**` and `**[user-docs/](../user-docs/)**` in sync when behavior is user-visible.
2. `**npm run build**`
3. Exercise the CLI path you touched (`npx auralogger-cli …`).

