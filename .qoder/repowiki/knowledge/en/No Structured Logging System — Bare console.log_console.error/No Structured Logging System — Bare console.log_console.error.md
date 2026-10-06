---
kind: logging_system
name: No Structured Logging System — Bare console.log/console.error
category: logging_system
scope:
    - '**'
source_files:
    - server/index.js
    - server/ingest.js
---

## What system/approach is used

The repository has **no logging framework, no logger abstraction, and no structured logging**. The Node.js server uses only the built-in `console` object:
- `console.log(...)` for startup messages (e.g. `index.js:242`: `console.log(\`RAT server listening on http://localhost:${PORT}\`)`).
- `console.error(err)` in the single Express error handler (`index.js:237`).

There are no imports of any logging library (`winston`, `pino`, `bunyan`, `morgan`, `debug`, `loglevel`, etc.), no `logger` module, no log-level configuration, and no custom formatter or sink.

## Key files

- `server/index.js` — the only file that emits to `console`; it contains both the sole `console.log` (server startup) and the sole `console.error` (Express error middleware).
- `server/ingest.js`, `server/store.js`, `server/metrics.js` — zero logging calls; errors surface as thrown exceptions or job-status fields rather than being logged.

## Architecture and conventions

- **Ad-hoc, unstructured output**: every log line is a plain string with no timestamp, level, request ID, or contextual fields.
- **No log levels beyond what `console` provides**: there is no concept of debug/info/warn/error levels; `console.log` and `console.error` are the only two channels.
- **Errors are not logged at call sites**: ingestion failures in `ingest.js` set `job.status = 'error'` and `job.error = String(e.message || e)` (line 291–294) instead of writing to stdout/stderr. HTTP-layer errors go through the Express error handler which logs via `console.error` and returns `{ error }` to the client.
- **No log rotation, sinks, or persistence**: nothing writes logs to files, pipes them to a collector, or supports different outputs per environment.
- **Client-side code** (`client/src/*.jsx`, `client/src/api.js`) does not perform any logging either.

## Conventions and constraints

Observed patterns (descriptive):
- All server-side diagnostics go through `console.log` / `console.error` directly from `server/index.js`.
- Operational state changes during ingestion are communicated to clients via the `jobs` Map (`status`, `detail`, `progress`, `error` fields in `ingest.js`) rather than via logs.
- There is no documented logging policy, no `.env` variable controlling verbosity, and no test assertions about log output.

Enforced rules: none. The codebase imposes no lint rule, build check, or runtime guard around logging; adding a new `console.*` call anywhere is unconstrained.