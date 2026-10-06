# RAT — Repo Analysis Tool

A web-app dashboard that measures evolution, authorship and volatility metrics of git
repositories, built for the COMS3011A test (SDP 2026). RAT ingests a repository once and
computes every metric category **live** for any selected commit set H.

![stack](https://img.shields.io/badge/stack-React%20%C2%B7%20Express%20%C2%B7%20git%20CLI-58a6ff)

## Quickstart

```bash
# 1. install dependencies
npm --prefix server install
npm --prefix client install

# 2. build the client (the server serves it statically)
npm --prefix client run build

# 3. run
npm --prefix server start        # → http://localhost:4000
```

For development run the server (`npm --prefix server run dev`, port 4000) and the Vite
dev server (`npm --prefix client run dev`, port 5173, proxies `/api`) in two terminals.

## Features (mapped to the rubric)

| Requirement | Where |
|---|---|
| Zip **and** remote-URL ingestion | Repositories page → *Clone URL* or zip upload (accepts a `.git` directory, a `.git` file pointer, or a bare repo inside the zip) |
| Multiple repository support | every repo gets a tab; switch anytime, data is cached |
| Author merging | `.mailmap` applied at ingest (git `%aE`); *Merge authors…* dialog adds manual merges; unmerge supported |
| Filter by repository / author / file or directory / commits | left sidebar — author multi-select, path scope (via select, breadcrumb, directory table or treemap click), manual commit-hash list |
| Filter by a specified period of time | *From (inclusive)* / *To (exclusive)* datetime pickers, on **committer date** |
| File / directory / repository / commit-set / author metrics | KPI row + files & directories tables + per-scope author ownership |
| Metric verification | *Commit verifier* panel computes every metric for **H = {h}** from a pasted hash — the sampling method the test brief describes |

### Metric categories

All quantities from the spec, for the selected commit set H and any object
o ∈ H[F] ∪ H[D]:

* **Files** — added lines `l⁺_{h,f}`, removed lines `l⁻_{h,f}`, growth `δ`, churn `λ`
* **Directories** — the same, summed across all immediate subdirectories and files
  (implemented as a rollup of each file into its ancestor directories, which is exactly
  the spec's recursion)
* **Repository** — directory metrics at the root of the commit tree
* **Commit set** — sums over H plus modifications `n_{H,o}`, modification frequency
  `η = n/|H|` and churn rate `ρ = λ/|H|` (0 when `|H| = 0`)
* **Authors** — author modifications, author churn and ownership
  `ω = λ_{H,o,a} / λ_{H,o}` per file/directory (the *Authors of this scope* panel)

### Spec compliance notes

* `H̄` = non-merge commits reachable from `HEAD` (`git log --no-merges`).
* Rename detection at the spec's **50%** threshold (`-M50%`); changed lines of a renamed
  object are attributed to its **new path** — a pure rename adds zero churn.
* Binary files are not measured (numstat reports them as `-`; skipped).
* A deleted object's lines count as removed; the initial commit diffs against the empty
  commit `h_∅`, so all its lines count as added.
* Time filters are half-open on **committer date**: `H_t` = `t ≤ date`, `H_{i,j}` =
  `i ≤ date < j`.
* Author identity is the mailmap-resolved email address, lower-cased; manual merges
  remap identities at query time, so merging/unmerging is instant.

## Architecture

```
browser (React + ECharts)
   │  /api/*
   ▼
Express ──► Store (registry + parsed-repo cache on disk)
   │
   ▼                                          one pass, at ingest:
ingest:  clone --bare / unzip ──► git log HEAD --no-merges -M50% --numstat \
   │                               --format=%H%x00%an%x00%ae%x00%aE%x00%ct%x00%s
   ▼                              → compact per-commit records
metrics:  single aggregation pass over H's records
          (path interning, ancestor-dir rollup, per-author accumulation,
           timeline bucketing) — O(lines touched in H), nothing recomputed per metric
```

The expensive part of every other tool — walking diffs per commit, per query — happens
**once** at ingest. Queries aggregate pre-parsed records in memory, which is why a
whole-repository aggregation over git.git (~61k non-merge commits) returns in
**~150 ms**. Results are memoized per filter-set; author merges only invalidate the
memo, they never re-parse history.

## Validation against raw git

Checked on the three provided repositories (numbers from `git log --no-merges -M50%
--numstat` vs. the RAT API):

| Repository | Metric | Raw git | RAT |
|---|---|---|---|
| cJSON | whole-repo l⁺ / l⁻ | 46 377 / 11 211 | 46 377 / 11 211 |
| cJSON | `tests/` l⁺ / l⁻ | 5 747 / 669 | 5 747 / 669 |
| cJSON | H = {HEAD} files | 6/2 `cJSON_Utils.c`, 34/0 `tests/old_utils_tests.c` | identical |
| cJSON | author = max@maxbruckner.de | 634 commits, 39 192 / 9 000 | identical |
| cJSON | 2020 commits (half-open range) | 49 | 49 |
| Redis | whole-repo l⁺ / l⁻ | 1 110 258 / 500 312 | identical |
| git | whole-repo l⁺ / l⁻ | 4 070 371 / 2 375 604 | identical |

Directory metrics intentionally differ from `git log -- <dir>` (git's pathspec matches
*both* sides of a rename; the spec attributes changes to the *new* path only) — RAT was
verified equal to strict new-path attribution over the raw numstat stream.

## API

```
POST   /api/repos/url            { url }                 → { jobId }
POST   /api/repos/zip            multipart "file"        → { jobId }
GET    /api/jobs/:id             ingest status/progress
GET    /api/repos                list repositories
GET    /api/repos/:id            repository meta
DELETE /api/repos/:id
GET    /api/repos/:id/authors    merged author list
GET    /api/repos/:id/metrics?authors=&from=&to=&path=&commits=
GET    /api/repos/:id/commits?…same filters…&limit=       drill-down rows
POST   /api/repos/:id/merge      { emails[], name? }
POST   /api/repos/:id/unmerge    { email }
```

Query filters: `authors` (comma-separated emails), `from`/`to` (unix seconds, half-open),
`path` (file or directory scope), `commits` (comma/space separated hashes).

## Project layout

```
server/   Express API, ingestion pipeline, metric engine (Node, ESM)
client/   React dashboard (Vite, ECharts)
```

Runtime data (cloned repos, parsed cache, registry) lives in `server/data/` and is
git-ignored.

---

## AI declaration

This project was developed with AI assistance (Qoder agentic IDE, code generation and
refactoring), and all generated code was reviewed, validated against raw `git` output by
the author, and remains fully understood by them. Validation results are documented
above.
