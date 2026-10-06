// Metric engine: pure aggregation over the per-commit file records produced at
// ingest time. Everything the spec defines reduces to one pass over the commits
// of the selected commit set H:
//
//   file metrics      : per-file records, exact
//   directory metrics : roll each file up into its ancestor dirs
//                       (spec's recursion collapses to "sum all descendants")
//   repository metrics: same rollup at the root directory
//   commit set metrics: sums / indicators over H  (eta = n/|H|, rho = churn/|H|)
//   author metrics    : same accumulation keyed by canonical author
//                       (ownership = author churn / total churn)
//
// Filter semantics (spec):
//   H_t   = { h in H | t <= h[committer-date] }            (from, inclusive)
//   H_i,j = { h in H | i <= h[committer-date] < j }        (to, EXCLUSIVE)
//   H may also be given as an explicit list of commit hashes.

const CAP_FILES = 1500;
const CAP_DIRS = 1500;
const CAP_AUTHORS = 400;

export function makeCanon(repo) {
  const merge = repo.merge || {};
  return (c) => {
    const base = (c.m || c.e).toLowerCase();
    return merge[base] || base;
  };
}

export function nameOf(repo, email) {
  return (repo.names && repo.names[email]) || (repo.baseAuthors && repo.baseAuthors[email] && repo.baseAuthors[email].name) || email;
}

export function selectCommits(repo, q) {
  const canon = makeCanon(repo);
  const authors = q.authors && q.authors.size ? q.authors : null;
  const commitSet = q.commits && q.commits.size ? q.commits : null;
  const out = [];
  for (const c of repo.commits) {
    if (commitSet && !commitSet.has(c.h)) continue;
    if (q.from != null && c.t < q.from) continue;
    if (q.to != null && c.t >= q.to) continue;
    if (authors && !authors.has(canon(c))) continue;
    out.push(c);
  }
  return out;
}

export function computeMetrics(repo, q) {
  const paths = repo.paths;
  const ancestors = repo.ancestors;
  const isDir = repo.isDir;
  const canon = makeCanon(repo);

  const H = selectCommits(repo, q);
  const N = H.length;

  const P = q.path || '';
  const pIdx = P ? repo.pathIndex[P] : 0;
  const pIsDir = P ? (pIdx === undefined ? false : !!isDir[pIdx]) : true;
  const under = (p) => !P || p === P || p.startsWith(P + '/');
  const dirOk = (pi) => {
    if (!P) return true;
    const p = paths[pi];
    return p === P || p.startsWith(P + '/');
  };

  const DAY = 86400;
  let tlSize = DAY;
  if (N) {
    const span = H[0].t - H[N - 1].t; // commits are newest-first
    tlSize = span <= 120 * DAY ? DAY : span <= 1600 * DAY ? 7 * DAY : 30 * DAY;
  }

  const mkRec = () => ({ plus: 0, minus: 0, mods: 0, a: new Map() });
  const fileMap = new Map(); // pathIdx -> rec
  const dirMap = new Map();  // dir pathIdx -> rec
  const authorMap = new Map(); // canonical email -> {plus, minus, commits}
  const tl = new Map();      // bucket start -> {t, plus, minus, churn, commits}

  for (const c of H) {
    const ce = canon(c);
    let aTotal = authorMap.get(ce);
    if (!aTotal) {
      aTotal = { plus: 0, minus: 0, commits: 0 };
      authorMap.set(ce, aTotal);
    }
    aTotal.commits++;

    const cF = new Map(); // per-commit churn per file (for modification counts)
    const cD = new Map(); // per-commit churn per dir
    let cPlus = 0, cMinus = 0;
    const f = c.f;
    for (let i = 0; i < f.length; i += 3) {
      const pi = f[i], a = f[i + 1], r = f[i + 2];
      if (!under(paths[pi])) continue;
      cPlus += a;
      cMinus += r;
      const churn = a + r;

      let fr = fileMap.get(pi);
      if (!fr) {
        fr = mkRec();
        fileMap.set(pi, fr);
      }
      fr.plus += a;
      fr.minus += r;
      let fa = fr.a.get(ce);
      if (!fa) {
        fa = { plus: 0, minus: 0, mods: 0 };
        fr.a.set(ce, fa);
      }
      fa.plus += a;
      fa.minus += r;
      cF.set(pi, (cF.get(pi) || 0) + churn);

      const anc = ancestors[pi];
      for (let k = 0; k < anc.length; k++) {
        const di = anc[k];
        if (!dirOk(di)) continue;
        let dr = dirMap.get(di);
        if (!dr) {
          dr = mkRec();
          dirMap.set(di, dr);
        }
        dr.plus += a;
        dr.minus += r;
        let da = dr.a.get(ce);
        if (!da) {
          da = { plus: 0, minus: 0, mods: 0 };
          dr.a.set(ce, da);
        }
        da.plus += a;
        da.minus += r;
        cD.set(di, (cD.get(di) || 0) + churn);
      }
    }
    aTotal.plus += cPlus;
    aTotal.minus += cMinus;

    // modifications: commit counts once per object if the object changed at all
    for (const [pi, ch] of cF) {
      if (ch > 0) {
        const fr = fileMap.get(pi);
        fr.mods++;
        const fa = fr.a.get(ce);
        if (fa) fa.mods++;
      }
    }
    for (const [di, ch] of cD) {
      if (ch > 0) {
        const dr = dirMap.get(di);
        dr.mods++;
        const da = dr.a.get(ce);
        if (da) da.mods++;
      }
    }

    const b = Math.floor(c.t / tlSize) * tlSize;
    let tb = tl.get(b);
    if (!tb) {
      tb = { t: b, plus: 0, minus: 0, churn: 0, commits: 0 };
      tl.set(b, tb);
    }
    tb.plus += cPlus;
    tb.minus += cMinus;
    tb.churn += cPlus + cMinus;
    tb.commits++;
  }

  const outRec = (path, r) => {
    const plus = r ? r.plus : 0;
    const minus = r ? r.minus : 0;
    const churn = plus + minus;
    const mods = r ? r.mods : 0;
    return {
      path,
      plus,
      minus,
      growth: plus - minus,
      churn,
      mods,
      freq: N ? mods / N : 0,
      rate: N ? churn / N : 0,
    };
  };

  const scopeRec = P
    ? pIsDir
      ? dirMap.get(pIdx)
      : fileMap.get(pIdx)
    : dirMap.get(0);
  const summary = outRec(P || '', scopeRec);
  const totalChurn = summary.churn;

  const files = [...fileMap.entries()]
    .map(([pi, r]) => outRec(paths[pi], r))
    .sort((a, b) => b.churn - a.churn)
    .slice(0, CAP_FILES);

  const dirs = [...dirMap.entries()]
    .map(([pi, r]) => outRec(paths[pi], r))
    .sort((a, b) => b.churn - a.churn)
    .slice(0, CAP_DIRS);

  const authors = [...authorMap.entries()]
    .map(([email, a]) => {
      const churn = a.plus + a.minus;
      return {
        email,
        name: nameOf(repo, email),
        plus: a.plus,
        minus: a.minus,
        growth: a.plus - a.minus,
        churn,
        commits: a.commits,
        ownership: totalChurn > 0 ? churn / totalChurn : 0,
      };
    })
    .sort((a, b) => b.churn - a.churn)
    .slice(0, CAP_AUTHORS);

  // author breakdown of the filtered object itself (file or directory)
  let objectAuthors = null;
  if (P && scopeRec) {
    const rec = scopeRec;
    const denom = rec.plus + rec.minus;
    objectAuthors = [...rec.a.entries()]
      .map(([email, a]) => {
        const churn = a.plus + a.minus;
        return {
          email,
          name: nameOf(repo, email),
          plus: a.plus,
          minus: a.minus,
          churn,
          mods: a.mods,
          ownership: denom > 0 ? churn / denom : 0,
        };
      })
      .sort((a, b) => b.churn - a.churn);
  }

  return {
    H: N,
    scope: { path: P || null, from: q.from ?? null, to: q.to ?? null },
    summary,
    files,
    dirs,
    authors,
    objectAuthors,
    timeline: [...tl.values()].sort((a, b) => a.t - b.t),
  };
}
