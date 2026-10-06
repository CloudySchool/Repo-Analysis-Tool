// Repo registry + on-disk cache for parsed repositories.
// A parsed repo is a compact plain-JSON structure produced by ingest.js:
//   { id, name, source, head,
//     paths:      ["" , "src", "src/main.js", ...]   // path table, index 0 = root
//     pathIndex:  { path -> index }
//     ancestors:  [[dirIdx...]]  // ancestor dir indices (incl. root 0) per path
//     isDir:      [0|1]          // 1 = directory (prefix of another path)
//     commits:    [{ h, n, e, m, t, s, f:[pathIdx, plus, minus, ...] }]
//     baseAuthors:{ emailLower: { name, commits } }  // identity after .mailmap (%aE)
//   }
// Manual author merges live in the registry meta (meta.merge / meta.names) so a
// merge never rewrites the large cache file; they are applied at query time.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Store {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'data');
    this.repoDir = path.join(this.dir, 'repos');
    this.tmpDir = path.join(this.dir, 'tmp');
    this.cacheDir = path.join(this.dir, 'cache');
    this.regFile = path.join(this.dir, 'registry.json');
    for (const d of [this.dir, this.repoDir, this.tmpDir, this.cacheDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    this.metas = new Map();
    this.repos = new Map();
    this.mcache = new Map(); // metrics cache, key: repoId|params, value: response
    try {
      const reg = JSON.parse(fs.readFileSync(this.regFile, 'utf8'));
      for (const m of reg.repos || []) this.metas.set(m.id, m);
    } catch {
      // no registry yet -> fresh start
    }
  }

  persist() {
    fs.writeFileSync(this.regFile, JSON.stringify({ repos: [...this.metas.values()] }, null, 1));
  }

  newId() {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  }

  load(id) {
    let r = this.repos.get(id);
    if (r) return r;
    const f = path.join(this.cacheDir, `${id}.json`);
    if (!fs.existsSync(f)) return null;
    r = JSON.parse(fs.readFileSync(f, 'utf8'));
    const meta = this.metas.get(id) || {};
    r.merge = meta.merge || {}; // manual merges: baseEmailLower -> canonicalEmailLower
    r.names = meta.names || {}; // display name overrides per canonical email
    this.repos.set(id, r);
    return r;
  }

  addRepo(parsed) {
    this.repos.set(parsed.id, parsed);
    let dirs = 0;
    for (const d of parsed.isDir) if (d) dirs++;
    const meta = {
      id: parsed.id,
      name: parsed.name,
      source: parsed.source,
      head: parsed.head,
      counts: {
        commits: parsed.commits.length,
        paths: parsed.paths.length,
        files: parsed.paths.length - dirs,
        dirs,
        authors: Object.keys(parsed.baseAuthors).length,
      },
      firstDate: parsed.commits.length ? parsed.commits[parsed.commits.length - 1].t : null,
      lastDate: parsed.commits.length ? parsed.commits[0].t : null,
      merge: {},
      names: {},
      ingestedAt: Date.now(),
    };
    this.metas.set(parsed.id, meta);
    fs.writeFileSync(path.join(this.cacheDir, `${parsed.id}.json`), JSON.stringify(parsed));
    this.persist();
    return meta;
  }

  remove(id) {
    this.metas.delete(id);
    this.repos.delete(id);
    this.mcache.clear();
    fs.rmSync(path.join(this.repoDir, id), { recursive: true, force: true });
    fs.rmSync(path.join(this.cacheDir, `${id}.json`), { force: true });
    this.persist();
  }

  applyMerge(id) {
    const meta = this.metas.get(id);
    const repo = this.repos.get(id);
    if (meta && repo) {
      repo.merge = meta.merge || {};
      repo.names = meta.names || {};
    }
    this.mcache.clear();
    this.persist();
  }
}
