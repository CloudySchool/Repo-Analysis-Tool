import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Chart, timelineOption, treemapOption, topFilesOption, authorsOption } from './charts.jsx';
import { numberParts, dstr, dtstr, fromLocalInput, shortHash } from './format.js';

const SORTABLE = {
  path: (r) => r.path,
  plus: (r) => r.plus,
  minus: (r) => r.minus,
  growth: (r) => r.growth,
  churn: (r) => r.churn,
  mods: (r) => r.mods,
  freq: (r) => r.freq,
  rate: (r) => r.rate,
  ownership: (r) => r.ownership,
};

function Num({ value, percent = false, className = '' }) {
  const { display, exact } = numberParts(value, { percent });
  return (
    <span className={`number-value ${className}`.trim()} title={`Exact value: ${exact}`} aria-label={exact}>
      {display}
    </span>
  );
}

function Spinner({ small = false }) {
  return <span className={`spinner${small ? ' small-spinner' : ''}`} aria-hidden="true" />;
}

function MetricSkeleton() {
  return (
    <div className="metric-skeleton" role="status" aria-label="Computing repository metrics">
      <div className="loading-heading"><Spinner /> Computing metrics…</div>
      <div className="kpi-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <div className="skeleton-card" key={i} />)}
      </div>
      <div className="skeleton-chart" aria-hidden="true" />
    </div>
  );
}

function SortTable({ rows, columns, onRowClick, empty, ariaLabel = 'Metrics table' }) {
  const [sort, setSort] = useState({ key: columns[0].key, dir: -1 });
  const sorted = useMemo(() => {
    const fn = SORTABLE[sort.key] || SORTABLE.path;
    return [...rows].sort((a, b) => {
      const x = fn(a), y = fn(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);
  const activateRow = (event, row) => {
    if (onRowClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onRowClick(row);
    }
  };
  return (
    <div className="table-wrap">
      <table aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.num ? 'num' : ''}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}
              >
                <button
                  className="sort-button"
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}
                  aria-label={`Sort by ${c.label}${sort.key === c.key ? `, currently ${sort.dir === -1 ? 'descending' : 'ascending'}` : ''}`}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 300).map((r) => (
            <tr
              key={r.path}
              onClick={() => onRowClick && onRowClick(r)}
              onKeyDown={(event) => activateRow(event, r)}
              className={onRowClick ? 'clickable' : ''}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? `Open ${r.path} details` : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : 'mono'}>
                  {c.render ? c.render(r) : c.num ? <Num value={r[c.key]} /> : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty small">{empty || 'Nothing in this commit set.'}</div>}
      {rows.length > 300 && <div className="muted small pad">showing top 300 of <Num value={rows.length} /> — use filters or sorting to narrow</div>}
    </div>
  );
}

const FILE_COLS = [
  { key: 'path', label: 'path' },
  { key: 'plus', label: '+ lines', num: true, render: (r) => <Num value={r.plus} /> },
  { key: 'minus', label: '− lines', num: true, render: (r) => <Num value={r.minus} /> },
  { key: 'growth', label: 'growth', num: true, render: (r) => <Num value={r.growth} className={r.growth >= 0 ? 'pos' : 'neg'} /> },
  { key: 'churn', label: 'churn', num: true, render: (r) => <Num value={r.churn} /> },
  { key: 'mods', label: 'mods', num: true, render: (r) => <Num value={r.mods} /> },
  { key: 'freq', label: 'mod. freq', num: true, render: (r) => <Num value={r.freq} percent /> },
  { key: 'rate', label: 'churn rate', num: true, render: (r) => <Num value={r.rate} /> },
];

function Kpi({ label, value, sub, percent = false, valueClass = '' }) {
  return (
    <div className="kpi">
      <div className="kpi-value"><Num value={value} percent={percent} className={valueClass} /></div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Dashboard({ repoId, repos, toast, tourStep = null }) {
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
  const tourWasActive = useRef(false);
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
    setDrawerData(null);
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

  useEffect(() => {
    if (!tourStep) {
      if (tourWasActive.current) {
        setDrawer(null);
        setShowMerge(false);
      }
      tourWasActive.current = false;
      return;
    }
    tourWasActive.current = true;
    if (tourStep === 'file-drawer') {
      setShowMerge(false);
      if (data?.files?.length) setDrawer(data.files[0].path);
    } else if (tourStep === 'author-merge') {
      setDrawer(null);
      setShowMerge(true);
    } else {
      setDrawer(null);
      setShowMerge(false);
    }
  }, [tourStep, data]);

  useEffect(() => {
    if (!drawer && !showMerge) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (showMerge) setShowMerge(false);
      else setDrawer(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drawer, showMerge]);

  return (
    <div className="dash">
      <aside className="sidebar panel" data-tour="filters" aria-labelledby="commit-set-title">
        <h3 id="commit-set-title">Commit set H</h3>
        <label className="field">
          <span>Authors</span>
          <input className="input" placeholder="filter authors…" value={authorSearch} onChange={(e) => setAuthorSearch(e.target.value)} aria-label="Search repository authors" />
        </label>
        <div className="author-list">
          {filteredAuthors.slice(0, 60).map((a) => (
            <label key={a.email} className="check">
              <input
                type="checkbox"
                checked={draft.authors.includes(a.email)}
                onChange={() => toggleAuthor(a.email)}
                aria-label={`Filter by ${a.name}, ${a.email}`}
              />
              <span className="check-name" title={a.email}>{a.name}</span>
              <span className="muted"><Num value={a.commits} /></span>
            </label>
          ))}
          {filteredAuthors.length > 60 && <div className="muted small">+<Num value={filteredAuthors.length - 60} /> more (use the filter box)</div>}
        </div>
        <button className="btn block" onClick={() => setShowMerge(true)} aria-label="Open author merge panel">
          Merge authors…
        </button>

        <label className="field">
          <span>From (inclusive)</span>
          <input className="input" type="datetime-local" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="Start date and time, inclusive" />
        </label>
        <label className="field">
          <span>To (exclusive)</span>
          <input className="input" type="datetime-local" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="End date and time, exclusive" />
        </label>
        <label className="field">
          <span>File / directory</span>
          <select className="input" value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} aria-label="Filter by file or directory">
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
            aria-label="Manual commit hash list"
          />
        </label>
        <div className="row gap">
          <button className="btn primary" onClick={apply} disabled={loading} aria-label="Apply metric filters">
            {loading && <Spinner small />} Apply filters
          </button>
          <button className="btn" onClick={reset} aria-label="Reset all metric filters">Reset</button>
        </div>
        <button className="btn block" onClick={() => setShowVerify((v) => !v)} aria-label={`${showVerify ? 'Hide' : 'Show'} commit verifier`}>
          {showVerify ? 'Hide' : 'Show'} commit verifier
        </button>
      </aside>

      <main className="content" aria-busy={loading}>
        <div className="crumbs" aria-label="Current repository path">
          {crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 0 && <span className="muted"> / </span>}
              <button className="crumb" onClick={() => openPath(c.path)} aria-label={`Open ${c.label} scope`}>{c.label}</button>
            </span>
          ))}
          {applied.authors.length > 0 && <span className="chip">authors: <Num value={applied.authors.length} /></span>}
          {applied.from && <span className="chip">from {dstr(applied.from)}</span>}
          {applied.to && <span className="chip">to {dstr(applied.to)} (excl.)</span>}
          {applied.commits.length > 0 && <span className="chip">manual set: <Num value={applied.commits.length} /> commits</span>}
        </div>

        {error && <div className="banner error" role="alert">{error}</div>}
        {loading && data && <div className="banner loading-banner" role="status"><Spinner small /> Computing metrics…</div>}
        {loading && !data && <MetricSkeleton />}

        {data && s && (
          <>
            <div className="kpi-grid" data-tour="kpis" aria-label="Key repository metrics">
              <Kpi label="commits |H|" value={data.H} />
              <Kpi label="lines added l⁺" value={s.plus} sub="l⁺_H,o" />
              <Kpi label="lines removed l⁻" value={s.minus} sub="l⁻_H,o" />
              <Kpi label="growth δ" value={s.growth} valueClass={s.growth >= 0 ? 'pos' : 'neg'} sub="δ_H,o" />
              <Kpi label="churn λ" value={s.churn} sub="λ_H,o" />
              <Kpi label="modifications n" value={s.mods} sub="n_H,o" />
              <Kpi label="mod. frequency η" value={s.freq} percent sub="n_H,o / |H|" />
              <Kpi label="churn rate ρ" value={s.rate} sub="λ_H,o / |H|" />
            </div>

            {showVerify && <VerifyPanel repoId={repoId} applied={applied} toast={toast} />}

            <div className="visualization-tour-group">
              <div className="grid-2">
                <section className="panel" data-tour="timeline-chart">
                  <h3>Activity over time</h3>
                  <Chart option={timelineOption(data.timeline)} height={280} ariaLabel="Activity timeline: lines added, lines removed, and commits over time" />
                </section>
                <section className="panel" data-tour="authors-chart">
                  <h3>Author churn</h3>
                  <Chart option={authorsOption(data.authors)} height={280} ariaLabel="Top authors ranked by churn" />
                </section>
              </div>

              <section className="panel" data-tour="treemap-chart">
                <h3>Directory churn treemap <span className="muted">(size = λ_H,d, click to zoom / set filter)</span></h3>
                <Chart
                  option={treemapOption(data.dirs)}
                  height={420}
                  ariaLabel="Interactive directory churn treemap"
                  onClick={(p) => {
                    if (p.data?.path !== undefined) openPath(p.data.path);
                  }}
                />
              </section>

              <div className="grid-2">
                <section className="panel" data-tour="top-files-chart">
                  <h3>Top files by churn</h3>
                  <Chart
                    option={topFilesOption(data.files)}
                    height={360}
                    ariaLabel="Top files ranked by churn; click a bar for file history"
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
                        { key: 'churn', label: 'churn', num: true, render: (r) => <Num value={r.churn} /> },
                        { key: 'ownership', label: 'ownership', num: true, render: (r) => <Num value={r.ownership} percent /> },
                        { key: 'mods', label: 'mods', num: true, render: (r) => <Num value={r.mods} /> },
                      ]}
                      empty="No authors"
                      ariaLabel="Authors and ownership for the selected scope"
                    />
                  ) : (
                    <div className="muted small">
                      Select a file or directory scope to see per-author ownership ω_H,o,a for that object.
                    </div>
                  )}
                </section>
              </div>
            </div>

            <section className="panel">
              <h3>Files {applied.path ? `under ${applied.path}` : ''}</h3>
              <SortTable rows={data.files} columns={FILE_COLS} onRowClick={(r) => openFile(r.path)} empty="No file changes in this commit set." ariaLabel="File metrics" />
            </section>

            <section className="panel">
              <h3>Directories</h3>
              <SortTable rows={data.dirs} columns={FILE_COLS} onRowClick={(r) => openPath(r.path)} empty="No directory changes in this commit set." ariaLabel="Directory metrics" />
            </section>
          </>
        )}
      </main>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="file-drawer-title" data-tour="file-drawer">
            <div className="drawer-head">
              <h3 id="file-drawer-title">{drawer}</h3>
              <button className="btn" onClick={() => setDrawer(null)} aria-label="Close file history drawer">Close</button>
            </div>
            {drawerData ? (
              <>
                <div className="kpi-grid small">
                  <Kpi label="added" value={drawerData.metrics.summary.plus} />
                  <Kpi label="removed" value={drawerData.metrics.summary.minus} />
                  <Kpi label="churn" value={drawerData.metrics.summary.churn} />
                  <Kpi label="mods" value={drawerData.metrics.summary.mods} />
                </div>
                <h4>Authors</h4>
                <SortTable
                  rows={(drawerData.metrics.objectAuthors || []).map((a) => ({ ...a, path: a.name }))}
                  columns={[
                    { key: 'path', label: 'author' },
                    { key: 'churn', label: 'churn', num: true, render: (r) => <Num value={r.churn} /> },
                    { key: 'ownership', label: 'ownership', num: true, render: (r) => <Num value={r.ownership} percent /> },
                  ]}
                  empty="—"
                  ariaLabel="Authors contributing to this file"
                />
                <h4>Commits touching this object</h4>
                <div className="table-wrap">
                  <table aria-label="Commits touching this file">
                    <thead>
                      <tr><th scope="col">commit</th><th scope="col">date</th><th scope="col" className="num">+</th><th scope="col" className="num">−</th><th scope="col">author</th><th scope="col">subject</th></tr>
                    </thead>
                    <tbody>
                      {drawerData.commits.map((c) => (
                        <tr key={c.h}>
                          <td className="mono" title={c.h}>{shortHash(c.h)}</td>
                          <td className="mono">{dtstr(c.t)}</td>
                          <td className="num pos"><Num value={c.plus} /></td>
                          <td className="num neg"><Num value={c.minus} /></td>
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
              <div className="drawer-loading" role="status"><Spinner /> Loading file history…</div>
            )}
          </div>
        </div>
      )}

      {showMerge && (
        <MergeModal
          repoId={repoId}
          authors={authors}
          onClose={() => setShowMerge(false)}
          onDone={(message) => {
            setShowMerge(false);
            loadAuthors();
            load(applied);
            toast(message, 'ok');
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
    <section className="panel verify" aria-labelledby="verify-title">
      <h3 id="verify-title">Commit verifier <span className="muted">(H = {"{h}"} — sample metrics per the test spec)</span></h3>
      <div className="add-row">
        <input
          className="input mono"
          placeholder="full commit hash"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          aria-label="Commit hash to verify"
        />
        <button className="btn primary" onClick={run} disabled={busy || !hash.trim()} aria-label="Verify commit metrics">
          {busy && <Spinner small />} Verify
        </button>
      </div>
      {result && (
        <>
          <div className="kpi-grid small">
            <Kpi label="l⁺ (added)" value={result.summary.plus} />
            <Kpi label="l⁻ (removed)" value={result.summary.minus} />
            <Kpi label="δ (growth)" value={result.summary.growth} />
            <Kpi label="λ (churn)" value={result.summary.churn} />
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
  const [busy, setBusy] = useState(null);

  const toggle = (email) =>
    setSelected((s) => (s.includes(email) ? s.filter((x) => x !== email) : [...s, email]));

  const submit = async () => {
    if (selected.length < 2) return;
    setBusy('merge');
    try {
      await api.merge(repoId, selected, name.trim() || undefined);
      onDone('Authors merged');
    } catch (e) {
      toast('Merge failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const unmerge = async () => {
    if (selected.length !== 1) return;
    setBusy('unmerge');
    try {
      await api.unmerge(repoId, selected[0]);
      onDone('Author identity unmerged');
    } catch (e) {
      toast('Unmerge failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="merge-authors-title" data-tour="author-merge">
        <h3 id="merge-authors-title">Merge or unmerge authors</h3>
        <p className="muted small">
          Combine multiple author identities (e.g. different emails of the same person) into one.
          Identities already covered by a repo's <code>.mailmap</code> are merged automatically at
          ingest; this adds manual merges on top. The first checked identity becomes canonical.
        </p>
        <div className="author-list tall">
          {authors.map((a) => (
            <label key={a.email} className="check">
              <input type="checkbox" checked={selected.includes(a.email)} onChange={() => toggle(a.email)} aria-label={`Select ${a.name}, ${a.email}`} />
              <span className="check-name" title={a.email}>{a.name}</span>
              <span className="muted mono small">{a.email}</span>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Display name for the merged author (optional)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={selected.length ? authors.find((a) => a.email === selected[0])?.name : ''} aria-label="Merged author display name" />
        </label>
        <div className="row gap end merge-actions">
          <button className="btn" onClick={onClose} aria-label="Cancel author changes">Cancel</button>
          <button className="btn" onClick={unmerge} disabled={busy || selected.length !== 1} aria-label="Unmerge selected author identity">
            {busy === 'unmerge' && <Spinner small />} Unmerge selected
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || selected.length < 2} aria-label="Merge selected author identities">
            {busy === 'merge' && <Spinner small />} Merge {selected.length > 1 && <>(<Num value={selected.length} />)</>}
          </button>
        </div>
      </div>
    </div>
  );
}
