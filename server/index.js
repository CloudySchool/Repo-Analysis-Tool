// RAT (Repo Analysis Tool) - HTTP API
//
//   POST /api/repos/url        { url }                       -> { jobId }   clone + ingest
//   POST /api/repos/zip        multipart field "file"        -> { jobId }   extract + ingest
//   GET  /api/jobs/:id                                       -> job status/progress
//   GET  /api/repos                                          -> registry
//   GET  /api/repos/:id                                      -> repo meta
//   DELETE /api/repos/:id                                    -> remove repo + data
//   GET  /api/repos/:id/authors                              -> author list (merged view)
//   GET  /api/repos/:id/metrics?authors=&from=&to=&path=&commits=
//                                        -> all metric categories for the selected commit set H
//   GET  /api/repos/:id/commits?...same filters...&limit=    -> commit drill-down rows
//   POST /api/repos/:id/merge    { emails: [...], name }     -> manual author merge
//   POST /api/repos/:id/unmerge  { email }                   -> undo merges of an author

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { startJob, jobs } from './ingest.js';
import { computeMetrics, selectCommits, makeCanon, nameOf } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(__dirname);
const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const upDir = path.join(store.tmpDir, 'up');
fs.mkdirSync(upDir, { recursive: true });
const upload = multer({
  dest: upDir,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // repo zips can be large
});

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function repoOr404(req, res) {
  const meta = store.metas.get(req.params.id);
  if (!meta) {
    bad(res, 'repository not found', 404);
    return null;
  }
  return store.load(req.params.id);
}

function parseFilters(req) {
  const q = {};
  if (req.query.authors) {
    q.authors = new Set(
      String(req.query.authors)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }
  if (req.query.from != null && req.query.from !== '') {
    const v = Math.floor(Number(req.query.from));
    if (Number.isFinite(v)) q.from = v;
  }
  if (req.query.to != null && req.query.to !== '') {
    const v = Math.floor(Number(req.query.to));
    if (Number.isFinite(v)) q.to = v;
  }
  if (req.query.commits) {
    q.commits = new Set(
      String(req.query.commits)
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  if (req.query.path) {
    q.path = String(req.query.path).replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');
  }
  return q;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/repos/url', (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return bad(res, 'url is required');
  if (!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(url) && !url.startsWith('/')) {
    return bad(res, 'unsupported url scheme (need http(s), ssh, git@ or file)');
  }
  const name = decodeURIComponent(url.split('/').filter(Boolean).pop() || 'repo').replace(/\.git$/i, '');
  const job = startJob(store, 'url', { url, name });
  res.json({ jobId: job.id });
});

app.post('/api/repos/zip', upload.single('file'), (req, res) => {
  if (!req.file) return bad(res, 'file is required (multipart field "file")');
  const original = req.file.originalname || 'upload.zip';
  if (!/\.zip$/i.test(original)) {
    fs.rmSync(req.file.path, { force: true });
    return bad(res, 'only .zip archives are accepted');
  }
  const name = original.replace(/\.zip$/i, '');
  const job = startJob(store, 'zip', { file: req.file.path, original, name });
  res.json({ jobId: job.id });
});

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return bad(res, 'job not found', 404);
  res.json(j);
});

app.get('/api/repos', (req, res) => {
  res.json([...store.metas.values()]);
});

app.get('/api/repos/:id', (req, res) => {
  const meta = store.metas.get(req.params.id);
  if (!meta) return bad(res, 'repository not found', 404);
  res.json(meta);
});

app.delete('/api/repos/:id', (req, res) => {
  if (!store.metas.has(req.params.id)) return bad(res, 'repository not found', 404);
  store.remove(req.params.id);
  res.json({ ok: true });
});

app.get('/api/repos/:id/authors', (req, res) => {
  const repo = repoOr404(req, res);
  if (!repo) return;
  const canon = makeCanon(repo);
  const acc = new Map();
  for (const c of repo.commits) {
    const k = canon(c);
    let a = acc.get(k);
    if (!a) {
      a = { email: k, name: nameOf(repo, k), commits: 0, plus: 0, minus: 0 };
      acc.set(k, a);
    }
    a.commits++;
    for (let i = 0; i < c.f.length; i += 3) {
      a.plus += c.f[i + 1];
      a.minus += c.f[i + 2];
    }
  }
  const out = [...acc.values()]
    .map((a) => ({ ...a, churn: a.plus + a.minus }))
    .sort((a, b) => b.churn - a.churn)
    .slice(0, 500);
  res.json(out);
});

app.get('/api/repos/:id/metrics', (req, res) => {
  const repo = repoOr404(req, res);
  if (!repo) return;
  const q = parseFilters(req);
  const key = `${req.params.id}|${JSON.stringify(q)}`;
  let out = store.mcache.get(key);
  if (!out) {
    out = computeMetrics(repo, q);
    if (store.mcache.size > 40) store.mcache.delete(store.mcache.keys().next().value);
    store.mcache.set(key, out);
  }
  res.json(out);
});

app.get('/api/repos/:id/commits', (req, res) => {
  const repo = repoOr404(req, res);
  if (!repo) return;
  const q = parseFilters(req);
  const sel = selectCommits(repo, q);
  const canon = makeCanon(repo);
  const P = q.path || '';
  const under = (p) => !P || p === P || p.startsWith(P + '/');
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const out = [];
  for (const c of sel) {
    let plus = 0, minus = 0;
    for (let i = 0; i < c.f.length; i += 3) {
      if (under(repo.paths[c.f[i]])) {
        plus += c.f[i + 1];
        minus += c.f[i + 2];
      }
    }
    out.push({ h: c.h, s: c.s, t: c.t, a: nameOf(repo, canon(c)), e: canon(c), plus, minus });
    if (out.length >= limit) break;
  }
  res.json({ total: sel.length, commits: out });
});

app.post('/api/repos/:id/merge', (req, res) => {
  const meta = store.metas.get(req.params.id);
  if (!meta) return bad(res, 'repository not found', 404);
  const emails = (req.body?.emails || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (emails.length < 2) return bad(res, 'select at least two authors to merge');
  const target = emails[0];
  meta.merge = meta.merge || {};
  for (const e of emails.slice(1)) meta.merge[e] = target;
  if (req.body?.name) {
    meta.names = meta.names || {};
    meta.names[target] = String(req.body.name);
  }
  store.applyMerge(req.params.id);
  res.json({ ok: true, canonical: target });
});

app.post('/api/repos/:id/unmerge', (req, res) => {
  const meta = store.metas.get(req.params.id);
  if (!meta) return bad(res, 'repository not found', 404);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return bad(res, 'email is required');
  meta.merge = meta.merge || {};
  // drop merges that point at this author, plus any merge this author had
  for (const k of Object.keys(meta.merge)) {
    if (meta.merge[k] === email || k === email) delete meta.merge[k];
  }
  store.applyMerge(req.params.id);
  res.json({ ok: true });
});

// ---- static client (production build) ----
const dist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// API error handler
app.use('/api', (req, res) => bad(res, 'not found', 404));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  bad(res, err.message || 'internal error', 500);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`RAT server listening on http://localhost:${PORT}`));
