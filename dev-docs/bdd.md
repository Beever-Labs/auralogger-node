
## Feature: server logs (`AuraServer`)

### Scenario: logs print locally

- **Given** the user calls **`AuraServer.log(type, message, location?, data?)`**
- **When** the deferred handler runs
- **Then** a log line is printed (styled in terminal when styles resolve; otherwise plain)
- **And** failures to reach the backend do not crash the process (errors surface as console messages / non-fatal paths)

### Scenario: streaming needs a usable secret path

- **Given** **`AURALOGGER_PROJECT_SECRET`** is missing and **`AuraServer`** was not configured with a non-empty secret
- **When** the user calls **`AuraServer.log(...)`**
- **Then** logs still print locally where applicable
- **And** streaming / **`proj_auth`** does not succeed without a secret (console-only or error messaging per implementation)

### Scenario: after configure, backend metadata can come from API

- **Given** a valid project secret (**`configure(secret)`** or env) so **`proj_auth`** can run
- **When** the user calls **`AuraServer.log(...)`**
- **Then** the SDK may obtain id, session, and styles from **`POST /api/proj_auth`** without all four **`AURALOGGER_PROJECT_*`** variables present in `.env`
- **And** when the socket is ready, payloads go to **`/{project_id}/create_log`** with auth as implemented in **`server-log.ts`**

## Feature: browser logs (`AuraClient`)

### Scenario: native WebSocket only

- **Given** code runs in a browser (or any runtime with global **`WebSocket`**)
- **When** the user calls **`AuraClient.log(...)`**
- **Then** the implementation uses the standard **`WebSocket`** API (no Node **`ws`** package in the client graph)

### Scenario: browser ingest is unauthenticated

- **Given** a resolvable **project id** (configure or **`NEXT_PUBLIC_*`** / **`VITE_*`** / unprefixed env per **`env-config.ts`**)
- **When** **`AuraClient.log`** opens a socket
- **Then** it targets **`/{project_id}/create_browser_logs`**
- **And** it does not send the project secret
- **And** payload shape matches server ingest expectations (type, message, session, **`created_at`**, optional location / data)

### Scenario: local preview tolerates bad style config

- **Given** **`styles`** / env styles are missing or invalid
- **When** **`AuraClient.log`** runs
- **Then** a plain fallback console line can still appear
- **And** socket behavior degrades gracefully (e.g. missing project id → error message, not opaque **`bind`** failures on wrong socket APIs)

## Feature: CLI

### Scenario: `init` produces secret + snippets

- **Given** the user runs **`auralogger init`**
- **When** the CLI authenticates via **`POST /api/proj_auth`**
- **Then** it prints a **`AURALOGGER_PROJECT_SECRET`** line when the secret was not already in env
- **And** it shows publishable id / session / styles for copying into **`NEXT_PUBLIC_*`** / **`VITE_*`**
- **And** it prints **`Auralog`** (env-driven **`AuraClient.configure`**) and **`AuraLog`** (**`AuraServer.configure(secret)`**) snippets for separate files

### Scenario: `server-check` hits authenticated ingest WS

- **Given** project id + secret in env
- **When** the user runs **`auralogger server-check`**
- **Then** it validates connectivity toward **`/{project_id}/create_log`** (authenticated)

### Scenario: `client-check` hits browser ingest WS

- **Given** the same shell expectations as **`server-check`** (including secret in env for parity checks; not sent on the browser socket)
- **When** the user runs **`auralogger client-check`**
- **Then** it opens **`/{project_id}/create_browser_logs`** without secret on the wire

### Scenario: `test-serverlog` / `test-clientlog` smoke paths

- **Given** env appropriate to each command
- **When** the CLI runs the smoke command
- **Then** it sends multiple **`AuraServer.log`** or **`AuraClient.log`** payloads on the production code path and closes the socket
