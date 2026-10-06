import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Chart, timelineOption, treemapOption, topFilesOption, authorsOption } from './charts.jsx';
import { fmt, pct, dstr, dtstr, toLocalInput, fromLocalInput, shortHash } from './format.js';

const SORTABLE = {
  path: (r) => r.path,
  plus: (r) => r.plus,
  minus: (r) => r.minus,
  growth: (r) => r.growth,
  churn: (r) => r.churn,
  mods: (r) => r.mods,
  freq: (r) => r.freq,
  rate: (r) => r.rate,
};

function SortTable({ rows, columns, onRowClick, empty }) {
  const [sort, setSort] = useState({ key: columns[0].key, dir: -1 });
  const sorted = useMemo(() => {
    const fn = SORTABLE[sort.key] || SORTABLE.path;
    return [...rows].sort((a, b) => {
      const x = fn(a), y = fn(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.num ? 'num' : ''}
                onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 300).map((r) => (
            <tr key={r.path} onClick={() => onRowClick && onRowClick(r)} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : 'mono'}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty small">{empty || 'Nothing in this commit set.'}</div>}
      {rows.length > 300 && <div className="muted small pad">showing top 300 of {rows.length.toLocaleString()} — use filters or sorting to narrow</div>}
    </div>
  );
}

const FILE_COLS = [
  { key: 'path', label: 'path' },
  { key: 'plus', label: '+ lines', num: true, render: (r) => fmt(r.plus) },
  { key: 'minus', label: '− lines', num: true, render: (r) => fmt(r.minus) },
  { key: 'growth', label: 'growth', num: true, render: (r) => <span className={r.growth >= 0 ? 'pos' : 'neg'}>{fmt(r.growth)}</span> },
  { key: 'churn', label: 'churn', num: true, render: (r) => fmt(r.churn) },
  { key: 'mods', label: 'mods', num: true, render: (r) => fmt(r.mods) },
  { key: 'freq', label: 'mod. freq', num: true, render: (r) => pct(r.freq) },
  { key: 'rate', label: 'churn rate', num: true, render: (r) => fmt(r.rate) },
];

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Dashboard({ repoId, repos, toast }) {
  const meta = repos.find((r) => r.id === repoId);
  const [authors, setAuthors] = useState([]);
  const [draft, setDraft] = useState({ authors: [], from: '', to: '', path: '', commitsText: '' });
  const [applied, setApplied] = useState({ authors: [], from: null, to: null, path: '', commits: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null); // file path being inspected
  const [drawerData, setDrawerData] = useState(null);
  const [showMerge, setShowMerge] = useState(false);
  const [authorSearch, setAuthorSearch] = useState('');
  const [showVerify, setShowVerify] = useState(false);

  const loadAuthors = useCallback(async () => {
    try {
      setAuthors(await api.authors(repoId));
    } catch (e) {
      toast('Failed to load authors: ' + e.message, 'error');
    }
  }, [repoId, toast]);

  useEffect(() => {
    loadAuthors();
  }, [loadAuthors]);

  const load = useCallback(
    async (params) => {
      setLoading(true);
      setError(null);
      try {
        setData(await api.metrics(repoId, params));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [repoId]
  );

  useEffect(() => {
    setApplied({ authors: [], from: null, to: null, path: '', commits: [] });
    setDraft({ authors: [], from: '', to: '', path: '', commitsText: '' });
    setDrawer(null);
    setData(null);
    load({ path: '' });
  }, [repoId, load]);

  const apply = () => {
    const commits = draft.commitsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const params = {
      authors: draft.authors,
      from: fromLocalInput(draft.from),
      to: fromLocalInput(draft.to),
      path: draft.path,
      commits,
    };
    setApplied(params);
    load(params);
  };

  const reset = () => {
    setDraft({ authors: [], from: '', to: '', path: '', commitsText: '' });
    setApplied({ authors: [], from: null, to: null, path: '', commits: [] });
    load({ path: '' });
  };

  const openPath = (path) => {
    setDrawer(null);
    setDraft((d) => ({ ...d, path }));
    setApplied((a) => ({ ...a, path }));
    load({ ...applied, path });
  };

  const openFile = (path) => {
    setDrawer(path);
  };

  useEffect(() => {
    if (!drawer) {
      setDrawerData(null);
      return;
    }
    (async () => {
      try {
        const [m, c] = await Promise.all([
          api.metrics(repoId, { ...applied, path: drawer }),
          api.commits(repoId, { ...applied, path: drawer }, 200),
        ]);
        setDrawerData({ metrics: m, commits: c.commits });
      } catch (e) {
        toast('Failed to load file details: ' + e.message, 'error');
      }
    })();
  }, [drawer, applied, repoId, toast]);

  const crumbs = useMemo(() => {
    const out = [{ label: meta?.name || 'repo', path: '' }];
    if (applied.path) {
      const segs = applied.path.split('/');
      let cp = '';
      for (const s of segs) {
        cp = cp ? cp + '/' + s : s;
        out.push({ label: s, path: cp });
      }
    }
    return out;
  }, [applied.path, meta]);

  const pathOptions = useMemo(() => {
    const opts = [''];
    const seen = new Set(opts);
    for (const c of crumbs) if (!seen.has(c.path)) { opts.push(c.path); seen.add(c.path); }
    for (const d of data?.dirs || []) if (!seen.has(d.path)) { opts.push(d.path); seen.add(d.path); }
    return opts;
  }, [data, crumbs]);

  const s = data?.summary;
  const filteredAuthors = authors.filter(
    (a) => !authorSearch || a.name.toLowerCase().includes(authorSearch.toLowerCase()) || a.email.includes(authorSearch.toLowerCase())
  );

  const toggleAuthor = (email) => {
    setDraft((d) => ({
      ...d,
      authors: d.authors.includes(email) ? d.authors.filter((x) => x !== email) : [...d.authors, email],
    }));
  };

  return (
    <div className="dash">
      <aside className="sidebar panel">
        <h3>Commit set H</h3>
        <label className="field">
          <span>Authors</span>
          <input className="input" placeholder="filter authors…" value={authorSearch} onChange={(e) => setAuthorSearch(e.target.value)} />
        </label>
        <div className="author-list">
          {filteredAuthors.slice(0, 60).map((a) => (
            <label key={a.email} className="check">
              <input
                type="checkbox"
                checked={draft.authors.includes(a.email)}
                onChange={() => toggleAuthor(a.email)}
              />
              <span className="check-name" title={a.email}>{a.name}</span>
              <span className="muted">{fmt(a.commits)}</span>
            </label>
          ))}
          {filteredAuthors.length > 60 && <div className="muted small">+{filteredAuthors.length - 60} more (use the filter box)</div>}
        </div>
        <button className="btn block" onClick={() => setShowMerge(true)}>
          Merge authors…
        </button>

        <label className="field">
          <span>From (inclusive)</span>
          <input className="input" type="datetime-local" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="field">
          <span>To (exclusive)</span>
          <input className="input" type="datetime-local" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <label className="field">
          <span>File / directory</span>
          <select className="input" value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })}>
            {pathOptions.map((p) => (
              <option key={p} value={p}>
                {p || '(whole repository)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Manual commit list <span className="muted">(hashes, space or comma separated)</span></span>
          <textarea
            className="input mono"
            rows={3}
            placeholder="a1b2c3… d4e5f6…"
            value={draft.commitsText}
            onChange={(e) => setDraft({ ...draft, commitsText: e.target.value })}
          />
        </label>
        <div className="row gap">
          <button className="btn primary" onClick={apply} disabled={loading}>Apply filters</button>
          <button className="btn" onClick={reset}>Reset</button>
        </div>
        <button className="btn block" onClick={() => setShowVerify((v) => !v)}>
          {showVerify ? 'Hide' : 'Show'} commit verifier
        </button>
      </aside>

      <main className="content">
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 0 && <span className="muted"> / </span>}
              <button className="crumb" onClick={() => openPath(c.path)}>{c.label}</button>
            </span>
          ))}
          {applied.authors.length > 0 && <span className="chip">authors: {applied.authors.length}</span>}
          {applied.from && <span className="chip">from {dstr(applied.from)}</span>}
          {applied.to && <span className="chip">to {dstr(applied.to)} (excl.)</span>}
          {applied.commits.length > 0 && <span className="chip">manual set: {applied.commits.length} commits</span>}
        </div>

        {error && <div className="banner error">{error}</div>}
        {loading && <div className="banner">Computing metrics…</div>}

        {data && s && (
          <>
            <div className="kpi-grid">
              <Kpi label="commits |H|" value={fmt(data.H)} />
              <Kpi label="lines added l⁺" value={fmt(s.plus)} sub="l⁺_H,o" />
              <Kpi label="lines removed l⁻" value={fmt(s.minus)} sub="l⁻_H,o" />
              <Kpi label="growth δ" value={<span className={s.growth >= 0 ? 'pos' : 'neg'}>{fmt(s.growth)}</span>} sub="δ_H,o" />
              <Kpi label="churn λ" value={fmt(s.churn)} sub="λ_H,o" />
              <Kpi label="modifications n" value={fmt(s.mods)} sub="n_H,o" />
              <Kpi label="mod. frequency η" value={pct(s.freq)} sub="n_H,o / |H|" />
              <Kpi label="churn rate ρ" value={fmt(s.rate)} sub="λ_H,o / |H|" />
            </div>

            {showVerify && <VerifyPanel repoId={repoId} applied={applied} toast={toast} />}

            <div className="grid-2">
              <section className="panel">
                <h3>Activity over time</h3>
                <Chart option={timelineOption(data.timeline)} height={280} />
              </section>
              <section className="panel">
                <h3>Author churn</h3>
                <Chart option={authorsOption(data.authors)} height={280} />
              </section>
            </div>

            <section className="panel">
              <h3>Directory churn treemap <span className="muted">(size = λ_H,d, click to zoom / set filter)</span></h3>
              <Chart
                option={treemapOption(data.dirs)}
                height={420}
                onClick={(p) => {
                  if (p.data?.path !== undefined) openPath(p.data.path);
                }}
              />
            </section>

            <div className="grid-2">
              <section className="panel">
                <h3>Top files by churn</h3>
                <Chart
                  option={topFilesOption(data.files)}
                  height={360}
                  onClick={(p) => {
                    const f = data.files.slice(0, 15).reverse()[p.dataIndex];
                    if (f) openFile(f.path);
                  }}
                />
              </section>
              <section className="panel">
                <h3>Authors of this {applied.path && !data.dirs.some((d) => d.path === applied.path) ? 'file' : 'scope'}</h3>
                {data.objectAuthors ? (
                  <SortTable
                    rows={data.objectAuthors.map((a) => ({ ...a, path: a.name }))}
                    columns={[
                      { key: 'path', label: 'author' },
                      { key: 'churn', label: 'churn', num: true, render: (r) => fmt(r.churn) },
                      { key: 'ownership', label: 'ownership', num: true, render: (r) => pct(r.ownership) },
                      { key: 'mods', label: 'mods', num: true, render: (r) => fmt(r.mods) },
                    ]}
                    empty="No authors"
                  />
                ) : (
                  <div className="muted small">
                    Select a file or directory scope to see per-author ownership ω_H,o,a for that object.
                  </div>
                )}
              </section>
            </div>

            <section className="panel">
              <h3>Files {applied.path ? `under ${applied.path}` : ''}</h3>
              <SortTable rows={data.files} columns={FILE_COLS} onRowClick={(r) => openFile(r.path)} empty="No file changes in this commit set." />
            </section>

            <section className="panel">
              <h3>Directories</h3>
              <SortTable rows={data.dirs} columns={FILE_COLS} onRowClick={(r) => openPath(r.path)} empty="No directory changes in this commit set." />
            </section>
          </>
        )}
      </main>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>{drawer}</h3>
              <button className="btn" onClick={() => setDrawer(null)}>Close</button>
            </div>
            {drawerData ? (
              <>
                <div className="kpi-grid small">
                  <Kpi label="added" value={fmt(drawerData.metrics.summary.plus)} />
                  <Kpi label="removed" value={fmt(drawerData.metrics.summary.minus)} />
                  <Kpi label="churn" value={fmt(drawerData.metrics.summary.churn)} />
                  <Kpi label="mods" value={fmt(drawerData.metrics.summary.mods)} />
                </div>
                <h4>Authors</h4>
                <SortTable
                  rows={(drawerData.metrics.objectAuthors || []).map((a) => ({ ...a, path: a.name }))}
                  columns={[
                    { key: 'path', label: 'author' },
                    { key: 'churn', label: 'churn', num: true, render: (r) => fmt(r.churn) },
                    { key: 'ownership', label: 'ownership', num: true, render: (r) => pct(r.ownership) },
                  ]}
                  empty="—"
                />
                <h4>Commits touching this object</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>commit</th><th>date</th><th className="num">+</th><th className="num">−</th><th>author</th><th>subject</th></tr>
                    </thead>
                    <tbody>
                      {drawerData.commits.map((c) => (
                        <tr key={c.h}>
                          <td className="mono" title={c.h}>{shortHash(c.h)}</td>
                          <td className="mono">{dtstr(c.t)}</td>
                          <td className="num pos">{fmt(c.plus)}</td>
                          <td className="num neg">{fmt(c.minus)}</td>
                          <td>{c.a}</td>
                          <td className="subject">{c.s}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {drawerData.commits.length === 0 && <div className="empty small">No commits</div>}
                </div>
              </>
            ) : (
              <div className="muted">Loading…</div>
            )}
          </div>
        </div>
      )}

      {showMerge && (
        <MergeModal
          repoId={repoId}
          authors={authors}
          onClose={() => setShowMerge(false)}
          onDone={() => {
            setShowMerge(false);
            loadAuthors();
            load(applied);
            toast('Authors merged', 'ok');
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

function VerifyPanel({ repoId, applied, toast }) {
  const [hash, setHash] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const h = hash.trim();
    if (!h) return;
    setBusy(true);
    try {
      const m = await api.metrics(repoId, { ...applied, commits: [h] });
      setResult(m);
    } catch (e) {
      toast('Verify failed: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel verify">
      <h3>Commit verifier <span className="muted">(H = {"{h}"} — sample metrics per the test spec)</span></h3>
      <div className="add-row">
        <input
          className="input mono"
          placeholder="full commit hash"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button className="btn primary" onClick={run} disabled={busy || !hash.trim()}>Verify</button>
      </div>
      {result && (
        <>
          <div className="kpi-grid small">
            <Kpi label="l⁺ (added)" value={fmt(result.summary.plus)} />
            <Kpi label="l⁻ (removed)" value={fmt(result.summary.minus)} />
            <Kpi label="δ (growth)" value={fmt(result.summary.growth)} />
            <Kpi label="λ (churn)" value={fmt(result.summary.churn)} />
          </div>
          <SortTable rows={result.files} columns={FILE_COLS} empty="Commit not found (merge commits are excluded from H̄)." />
        </>
      )}
    </section>
  );
}

function MergeModal({ repoId, authors, onClose, onDone, toast }) {
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (email) =>
    setSelected((s) => (s.includes(email) ? s.filter((x) => x !== email) : [...s, email]));

  const submit = async () => {
    if (selected.length < 2) return;
    setBusy(true);
    try {
      await api.merge(repoId, selected, name.trim() || undefined);
      onDone();
    } catch (e) {
      toast('Merge failed: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Merge authors</h3>
        <p className="muted small">
          Combine multiple author identities (e.g. different emails of the same person) into one.
          Identities already covered by a repo's <code>.mailmap</code> are merged automatically at
          ingest; this adds manual merges on top. The first checked identity becomes canonical.
        </p>
        <div className="author-list tall">
          {authors.map((a) => (
            <label key={a.email} className="check">
              <input type="checkbox" checked={selected.includes(a.email)} onChange={() => toggle(a.email)} />
              <span className="check-name" title={a.email}>{a.name}</span>
              <span className="muted mono small">{a.email}</span>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Display name for the merged author (optional)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={selected.length ? authors.find((a) => a.email === selected[0])?.name : ''} />
        </label>
        <div className="row gap end">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || selected.length < 2}>
            Merge {selected.length > 1 ? `(${selected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
