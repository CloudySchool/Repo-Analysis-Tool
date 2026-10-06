---
kind: dependency_management
name: Node.js Dependency Management via npm with Lockfiles
category: dependency_management
scope:
    - '**'
source_files:
    - client/package.json
    - client/package-lock.json
    - server/package.json
    - server/package-lock.json
---

## Approach

The repository uses **npm** as the package manager for both the client and server modules. There is no vendoring (no `vendor/` directories), no private registry configuration, and no monorepo tooling — each subdirectory (`client/`, `server/`) is an independent npm project.

## Key Files

- `client/package.json` — declares runtime dependencies (`react`, `react-dom`, `echarts`) and dev dependencies (`vite`, `@vitejs/plugin-react`).
- `client/package-lock.json` — npm lockfile pinning exact transitive versions for reproducible installs.
- `server/package.json` — declares runtime dependencies (`express`, `cors`, `multer`).
- `server/package-lock.json` — npm lockfile for the server module.

## Architecture and Conventions

- **Dual-module layout**: The workspace root contains two sibling Node.js projects rather than a single top-level `package.json`. Each module owns its own dependency graph.
- **ESM-only**: Both `package.json` files set `"type": "module"`, so all source code under each module must use ES module syntax (`import`/`export`).
- **Dependency versioning**: All dependencies in both manifests use caret ranges (`^x.y.z`), allowing semver-compatible updates within the major version. No explicit patch pins are used in the manifests; exact resolved versions are captured by the generated `package-lock.json` files.
- **No vendoring or private registries**: There is no `.npmrc`, no `yarn.lock`, no `pnpm-lock.yaml`, no `go.mod`, and no vendored third-party code beyond what npm resolves into `node_modules/`.
- **Runtime vs build separation**: The client separates runtime UI libraries from build tooling (`vite`, `@vitejs/plugin-react`) by placing them under `dependencies` vs `devDependencies`; the server has only runtime dependencies since it runs directly with `node index.js`.

## Constraints

- Reproducible installs are enforced per module by committing the corresponding `package-lock.json` alongside `package.json` (both `client/` and `server/` include lockfiles).
- The client is marked `"private": true` in its manifest, preventing accidental publication to the public npm registry.
- Scripts in `package.json` define the entry points: `npm run start` for the server and `npm run dev` / `npm run build` / `npm run preview` for the client.