# Debugging with the CLI

*When something fails: narrow **where** (HTTP `proj_auth`, server WebSocket, browser WebSocket) and **whether** data is actually landing (fetch with **`get-logs`**). This page is the ordered playbook.*

---

## 0) Run from the right place (fix half the “mystery” errors)

1. **`cd` into the project** that owns your Auralogger credentials — the one with **`.env`** or **`.env.local`**.
2. The CLI loads env files from **`process.cwd()`** (the current working directory), not from “somewhere on your machine.”
3. If a command says your token is wrong, credentials are empty, or `proj_auth` failed: **put `AURALOGGER_PROJECT_TOKEN` and `AURALOGGER_USER_SECRET` in that folder’s env**, or **export them in the shell** before running the command.
4. If you are starting fresh: **`auralogger init`** (see [`environment.md`](environment.md)) prints the right variable names and can prompt for missing values.

---

## 1) How to invoke the CLI (`auralogger` vs `auralogger-cli`, with or without `npx`)

The published package is **`auralogger-cli`**. The executable name on your PATH is typically **`auralogger`**.

| Situation | What to run |
|-----------|-------------|
| You ran **`npm install auralogger-cli`** in this repo and want the **lockfile** version | **`npx auralogger <command>`** |
| `auralogger` is not found, or the shell picks a different global | **`npx auralogger-cli <command>`** — `npx` runs the **package** by name and uses that package’s binary |
| You want to be explicit and avoid PATH weirdness | **`npx auralogger-cli <command>`** every time |
| You installed the package globally and your PATH is clean | **`auralogger <command>`** (no `npx`) |

**Examples (all equivalent for a given install):**

```bash
npx auralogger server-check
npx auralogger-cli server-check
```

**If `auralogger` does not work, try `auralogger-cli` with `npx` first** — that bypasses a broken or missing global install and uses the project dependency.

**Spelling note:** the command is **`test-serverlog`** (hyphen, singular), not `testserverlogs`. Same pattern: **`test-clientlog`**, **`test-log`**.

---

## 2) What each “debug” command is for

| Command | What it proves | Needs in env (typical) |
|---------|----------------|-------------------------|
| **`server-check`** | Server ingest WebSocket **`/{token}/create_log`** opens and accepts **one** test log with **`Authorization: Bearer`** (user secret). | **`AURALOGGER_PROJECT_TOKEN`**, **`AURALOGGER_USER_SECRET`** (or paste at prompt). Calls **`proj_auth`** first — needs **project id + session** from the API. |
| **`client-check`** | Browser ingest **`/{token}/create_browser_logs`** (path token only, **no** secret on the socket) works. | **`AURALOGGER_PROJECT_TOKEN`** (or paste at prompt). **`proj_auth`** must return **project id** and **session**. **No** user secret is read or sent on this command. |
| **`test-serverlog`** | Your **Node server SDK path** can emit several logs in a row (uses **`AuraServer`** internally — production-style server logging). | **`AURALOGGER_PROJECT_TOKEN`** + **`AURALOGGER_USER_SECRET`** configured like server code. |
| **`test-clientlog`** | The **client SDK** path can emit logs over **`create_browser_logs`** (same family as the browser). | Project token ( **`AuraClient.configure`**); hydrates via **`proj_auth`**. |
| **`test-log`** | Same idea as **`test-clientlog`**, but through the **package root `AuraClient`** export (smoke test for the index entry). | Project token. |
| **`get-logs`** | Logs **actually arrived** in the backend and can be queried — use after any send test. | Token + user secret; optional filters (see [`commands.md`](commands.md)). |

---

## 3) Step-by-step: narrow a failure

### A) “Nothing works” / auth or network errors

1. Confirm **cwd** (section 0).
2. Run **`init`** if tokens might be wrong or missing:  
   `npx auralogger-cli init` (or `npx auralogger init`).
3. Run **`server-check`**:  
   `npx auralogger-cli server-check`
4. **If this fails:**
   - Read the **red error line** (timeout vs WebSocket error vs `proj_auth`).
   - **Timeout / socket didn’t open:** VPN, firewall, corporate proxy, or wrong **`AURALOGGER_WS_URL`** if you override WebSocket base URL (advanced; see maintainer docs).
   - **Credentials / `proj_auth`:** wrong **`AURALOGGER_PROJECT_TOKEN`**, wrong **`AURALOGGER_USER_SECRET`**, or API not returning **project id + session** — fix env and retry.

### B) “Server-side logging in my app is broken”

1. **`server-check`** must succeed first (section 3A).
2. Send a **richer** burst: **`test-serverlog`**  
   `npx auralogger-cli test-serverlog`
3. **Verify storage/query:**  
   `npx auralogger-cli get-logs -maxcount 20`  
   You should see rows whose **`location`** looks like **`cli/test-serverlog`** (see [`commands.md`](commands.md) for filters).
4. **If `test-serverlog` fails but `server-check` passed:** compare how your app calls **`AuraServer.configure`** / env resolution with the working directory’s **`.env`**.

### C) “Browser / client logs are broken”

1. Run **`client-check`**:  
   `npx auralogger-cli client-check`
2. If that passes, run **`test-clientlog`** (or **`test-log`** to exercise the index export):  
   `npx auralogger-cli test-clientlog`  
   `npx auralogger-cli test-log`
3. Confirm with **`get-logs`** (narrow by **`-message`**, **`-location`**, or time if needed).

### D) “I think logs send but I can’t see them”

1. After **`test-serverlog`** or **`test-clientlog`**, always run **`get-logs`** with a generous **`-maxcount`**.
2. Remember: **`get-logs`** returns **one page** per invocation — use **`-skip`** / cursor-style args if your backend supports them (see [`commands.md`](commands.md) and main **`readme.md`**).
3. Filter by **session**, **type**, or **message** to cut noise.

---

## 4) Quick reference (copy-paste)

```bash
# Connectivity (after .env in cwd)
npx auralogger-cli server-check
npx auralogger-cli client-check

# Synthetic traffic + proof in the API
npx auralogger-cli test-serverlog
npx auralogger-cli test-clientlog
npx auralogger-cli test-log
npx auralogger-cli get-logs -maxcount 20
```

If `auralogger` works on your machine, you can shorten:

```bash
npx auralogger server-check
```

---

## 5) Where to read next

- **Variable names and troubleshooting:** [`environment.md`](environment.md)
- **All commands and `get-logs` filters:** [`commands.md`](commands.md)
