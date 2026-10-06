// Ingestion pipeline: clone (URL) or extract (zip) -> single-pass `git log` parse.
//
// One `git log` invocation produces every raw number the metric spec needs:
//   git log HEAD --no-merges -M50% --numstat --format=<custom>
//     --no-merges : H-bar = non-merge commits reachable from HEAD
//     -M50%       : rename detection at the spec's 50% similarity threshold,
//                   changes attributed to the NEW path
//     --numstat   : per-file l+ / l- (binary files appear as "-", skipped;
//                   deletions report the full line count as removed; the
//                   initial commit diff is against the empty commit h_empty)
//   format fields : %H hash, %an/%ae raw author, %aE .mailmap-merged author
//                   email, %ct COMMITTER date, %s subject

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MARKER = '@@RAT@@\x00';
const FORMAT = '@@RAT@@%x00%H%x00%an%x00%ae%x00%aE%x00%ct%x00%s';

export const jobs = new Map(); // jobId -> { id, kind, status, progress, detail, repoId, error, name }

function git(gitDir, args) {
  return new Promise((resolve, reject) => {
    const c = spawn('git', [`--git-dir=${gitDir}`, ...args]);
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `git exited with code ${code}`))));
  });
}

// numstat rename forms:  "old => new", "dir/{old => new}.c", "{a => b}/f", "d/{ => n}/f"
export function parseRename(p) {
  if (!p.includes(' => ')) return p;
  const b = p.indexOf('{');
  if (b >= 0) {
    const e = p.indexOf('}', b);
    const inner = p.slice(b + 1, e);
    const idx = inner.indexOf(' => ');
    const right = idx >= 0 ? inner.slice(idx + 4) : '';
    return p.slice(0, b) + right + p.slice(e + 1);
  }
  return p.slice(p.indexOf(' => ') + 4);
}

// Parse the full history in one streaming pass over `git log` stdout.
async function parseGitRepo(gitDir, onProgress) {
  const head = (await git(gitDir, ['rev-parse', 'HEAD'])).trim();
  const paths = [''];
  const pathIndex = { '': 0 };
  const intern = (p) => {
    let i = pathIndex[p];
    if (i !== undefined) return i;
    const s = p.lastIndexOf('/');
    if (s > 0) intern(p.slice(0, s)); // ensure ancestor dirs exist in the table
    i = paths.length;
    paths.push(p);
    pathIndex[p] = i;
    return i;
  };

  const commits = [];
  let cur = null;
  let buf = '';
  let sinceReport = 0;

  await new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        `--git-dir=${gitDir}`,
        '-c', 'core.quotepath=false',
        'log', 'HEAD',
        '--no-merges',
        '-M50%',
        '--numstat',
        `--format=${FORMAT}`,
      ],
      { env: { ...process.env, LC_ALL: 'C.UTF-8' } }
    );
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue; // blank separator line between commits
        if (line.startsWith(MARKER)) {
          if (cur) commits.push(cur);
          const f = line.split('\x00');
          cur = { h: f[1], n: f[2], e: f[3], m: f[4], t: +f[5], s: f[6] || '', f: [] };
          if (commits.length - sinceReport >= 5000) {
            sinceReport = commits.length;
            onProgress?.(commits.length);
          }
        } else if (cur) {
          const t1 = line.indexOf('\t');
          const t2 = line.indexOf('\t', t1 + 1);
          if (t1 < 0 || t2 < 0) continue;
          const a = line.slice(0, t1);
          if (a === '-') continue; // binary file -> not measured
          const r = line.slice(t1 + 1, t2);
          const p = parseRename(line.slice(t2 + 1));
          cur.f.push(intern(p), +a, +r);
        }
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (cur) commits.push(cur);
      if (code !== 0) reject(new Error(`git log failed (code ${code}) - not a valid git repository?`));
      else resolve();
    });
  });

  return { head, paths, pathIndex, commits };
}

// Derive directory structure (ancestors/isDir) and per-email author identities.
function finalize(parsed) {
  const { paths, pathIndex, commits } = parsed;
  const n = paths.length;
  const isDir = new Array(n).fill(0);
  isDir[0] = 1;
  const ancestors = new Array(n);
  for (let i = 0; i < n; i++) {
    const chain = [0]; // every object rolls up to the root
    let p = paths[i];
    while (true) {
      const s = p.lastIndexOf('/');
      if (s < 0) break;
      p = p.slice(0, s);
      const idx = pathIndex[p];
      if (idx === undefined) break;
      chain.push(idx);
      isDir[idx] = 1;
    }
    ancestors[i] = chain;
  }
  parsed.isDir = isDir;
  parsed.ancestors = ancestors;

  const acc = {};
  for (const c of commits) {
    const key = (c.m || c.e).toLowerCase();
    const a = acc[key] || (acc[key] = { votes: {}, commits: 0 });
    a.commits++;
    a.votes[c.n] = (a.votes[c.n] || 0) + 1;
  }
  const baseAuthors = {};
  for (const [k, a] of Object.entries(acc)) {
    let best = k, bv = -1;
    for (const [name, v] of Object.entries(a.votes)) {
      if (v > bv) {
        bv = v;
        best = name;
      }
    }
    baseAuthors[k] = { name: best, commits: a.commits };
  }
  parsed.baseAuthors = baseAuthors;
  return parsed;
}

function cloneBare(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const c = spawn('git', ['clone', '--bare', '--progress', url, dest]);
    let err = '';
    c.stderr.on('data', (d) => {
      err += d;
      const pct = err.match(/(\d+)%/g);
      if (pct) onProgress(parseInt(pct[pct.length - 1], 10));
    });
    c.on('error', reject);
    c.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(err.split('\n').filter(Boolean).pop() || `git clone failed (code ${code})`))
    );
  });
}

function unzip(file, out) {
  return new Promise((resolve, reject) => {
    const c = spawn('unzip', ['-q', '-o', file, '-d', out]);
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip failed: ${err.trim() || `code ${code}`}`))));
  });
}

// Locate a git directory inside an extracted tree: a dir holding HEAD+objects+refs
// (bare repo or a .git folder), or a .git file pointer ("gitdir: <path>").
function findGitDir(root) {
  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const dotgit = entries.find((e) => e.name === '.git');
    if (dotgit) {
      if (dotgit.isDirectory()) return path.join(dir, '.git');
      if (dotgit.isFile()) {
        const ptr = fs.readFileSync(path.join(dir, '.git'), 'utf8').trim();
        const m = ptr.match(/gitdir:\s*(.+)/);
        if (m) return path.resolve(dir, m[1].trim());
      }
    }
    const has = (name, isFile) => entries.some((e) => e.name === name && (isFile ? e.isFile() : e.isDirectory()));
    if (has('HEAD', true) && has('objects', false) && has('refs', false)) return dir;
    if (depth < 3) {
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) queue.push([path.join(dir, e.name), depth + 1]);
      }
    }
  }
  return null;
}

export function startJob(store, kind, payload) {
  const id = store.newId();
  const job = {
    id,
    kind,
    name: payload.name,
    status: 'running',
    progress: 0,
    detail: 'queued',
    repoId: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  (async () => {
    try {
      let gitDir;
      let source;
      if (kind === 'url') {
        job.detail = 'cloning';
        const dest = path.join(store.repoDir, id);
        await cloneBare(payload.url, dest, (p) => {
          job.progress = Math.min(90, Math.round(p * 0.9));
          job.detail = `cloning ${p}%`;
        });
        gitDir = dest;
        source = { type: 'url', url: payload.url };
      } else {
        job.detail = 'extracting zip';
        job.progress = 5;
        const out = path.join(store.tmpDir, id);
        fs.mkdirSync(out, { recursive: true });
        await unzip(payload.file, out);
        gitDir = findGitDir(out);
        if (!gitDir) throw new Error('No git repository found in the uploaded zip (expected a .git directory/file or a bare repo)');
        source = { type: 'zip', file: payload.original };
        job.progress = 85;
      }

      job.status = 'parsing';
      job.detail = 'parsing history';
      const parsed = await parseGitRepo(gitDir, (n) => {
        job.detail = `parsing history (${n.toLocaleString()} commits)`;
        job.progress = 92;
      });
      if (!parsed.commits.length) throw new Error('Repository has no commits');
      parsed.id = id;
      parsed.name = payload.name;
      parsed.source = source;
      finalize(parsed);

      if (kind === 'zip') {
        const dest = path.join(store.repoDir, id);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(gitDir, dest);
      }

      store.addRepo(parsed);
      job.status = 'ready';
      job.progress = 100;
      job.detail = 'done';
      job.repoId = id;
    } catch (e) {
      job.status = 'error';
      job.error = String((e && e.message) || e);
      fs.rmSync(path.join(store.repoDir, id), { recursive: true, force: true });
      fs.rmSync(path.join(store.tmpDir, id), { recursive: true, force: true });
    }
  })();

  return job;
}
