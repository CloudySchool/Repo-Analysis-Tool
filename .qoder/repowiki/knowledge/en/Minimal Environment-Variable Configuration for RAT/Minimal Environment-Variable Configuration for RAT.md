---
kind: configuration_system
name: Minimal Environment-Variable Configuration for RAT
category: configuration_system
scope:
    - '**'
source_files:
    - server/index.js
    - server/store.js
    - server/ingest.js
    - client/vite.config.js
---

## Approach

RAT has no dedicated configuration framework, config files, or secret manager. Runtime configuration is extremely minimal and comes from two sources:

1. **Node.js environment variables** — read via `process.env` at startup.
2. **Hard-coded defaults** in source code when an env var is absent.

There are no `.env` files, no YAML/TOML/JSON config files, no feature flags, and no secrets-loading layer.

## Server-side configuration

The only runtime knob on the server (`server/index.js`) is the HTTP port:

```js
const PORT = process.env.PORT || 4000;
```

If `PORT` is unset, the Express server binds to `4000`. No other `process.env` reads exist in the server codebase (verified by grep).

A related environment variable is set during Git invocation in `server/ingest.js`:

```js
{ env: { ...process.env, LC_ALL: 'C.UTF-8' } }
```

This forces the child `git` process to use a deterministic locale; it does not expose a user-configurable option.

## Client-side configuration

The Vite dev server (`client/vite.config.js`) hard-codes the development proxy:

```js
server: {
  port: 5173,
  proxy: { '/api': 'http://localhost:4000' },
},
```

The production build output directory is also hard-coded as `dist`, and the server serves that same directory (`../client/dist`). There is no client-side env-var injection (no `import.meta.env.*` usage observed).

## Data paths as implicit configuration

`server/store.js` derives all persistent paths relative to the module's `__dirname`:

| Concept | Default path |
|---|---|
| Root data dir | `<module-dir>/data` |
| Parsed repo cache | `<module-dir>/data/cache/<id>.json` |
| Cloned repos | `<module-dir>/data/repos/<id>/` |
| Upload temp | `<module-dir>/data/tmp/up` |
| Registry metadata | `<module-dir>/data/registry.json` |

These are not configurable via env vars — they are fixed by construction in the `Store` constructor. The registry file is loaded on startup and persisted on every mutation.

## Constraints and conventions observed

- The server exposes exactly one externally configurable value: `PORT` (default `4000`).
- The dev client proxies `/api` requests to `http://localhost:4000`; this couples the default dev server port to the default server port.
- All filesystem layout under `server/data/` is hard-coded inside `Store` and cannot be overridden at runtime.
- No `.env` files are committed (only `.gitignore` exists at the repo root) and none are referenced in code.
- No configuration validation, schema, or error handling around missing env vars exists beyond the simple fallbacks shown above.