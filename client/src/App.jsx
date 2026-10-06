import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Dashboard } from './Dashboard.jsx';
import { numberParts, timeAgo } from './format.js';

let toastSeq = 0;
const TOUR_STORAGE_KEY = 'rat-dashboard-tour-seen';
const TOUR_STEPS = [
  {
    id: 'add-repository',
    view: 'repos',
    selector: '[data-tour="add-repository"]',
    title: 'Add a repository',
    description: 'Clone a remote Git URL or upload a zip containing a .git directory. Ingestion runs in the background and reports its progress here.',
  },
  {
    id: 'filters',
    view: 'dash',
    selector: '[data-tour="filters"]',
    title: 'Choose the commit set',
    description: 'Combine authors, an inclusive/exclusive date range, a file or directory, and an optional manual commit list. Apply filters to recompute every metric.',
  },
  {
    id: 'kpis',
    view: 'dash',
    selector: '[data-tour="kpis"]',
    title: 'Read the key metrics',
    description: 'l⁺ and l⁻ are changed lines; δ is growth; λ is churn; n is modifications; η is modification frequency; and ρ is churn per commit. Hover abbreviated values for exact numbers.',
  },
  {
    id: 'timeline-chart',
    view: 'dash',
    selector: '[data-tour="timeline-chart"]',
    title: 'Navigate the timeline',
    description: 'Hover points for exact additions, removals, and commit counts. Drag the slider or scroll inside the chart to zoom into a time range.',
  },
  {
    id: 'treemap-chart',
    view: 'dash',
    selector: '[data-tour="treemap-chart"]',
    title: 'Explore directory churn',
    description: 'Treemap area represents churn. Click a directory to zoom and apply it as the current path filter.',
  },
  {
    id: 'top-files-chart',
    view: 'dash',
    selector: '[data-tour="top-files-chart"]',
    title: 'Find high-churn files',
    description: 'The top-files bars rank files by churn. Hover for exact values and click a bar to inspect that file’s commit history.',
  },
  {
    id: 'authors-chart',
    view: 'dash',
    selector: '[data-tour="authors-chart"]',
    title: 'Compare author activity',
    description: 'The author chart ranks contributors by churn and its tooltip includes exact churn, ownership, and commit values.',
  },
  {
    id: 'file-drawer',
    view: 'dash',
    selector: '[data-tour="file-drawer"]',
    title: 'Inspect file history',
    description: 'Click a file row or bar to open this drawer. It shows file-level KPIs, ownership, and every matching commit with additions and removals.',
  },
  {
    id: 'author-merge',
    view: 'dash',
    selector: '[data-tour="author-merge"]',
    title: 'Merge or unmerge authors',
    description: 'Merge identities that belong to one person, or select one canonical identity to undo its manual merge. .mailmap identities are already combined during ingestion.',
  },
];

function NumberText({ value }) {
  const { display, exact } = numberParts(value);
  return <span className="number-value" title={`Exact value: ${exact}`} aria-label={exact}>{display}</span>;
}

function GuidedTour({ step, index, total, onBack, onNext, onClose }) {
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!step) return undefined;
    let target = null;
    const update = () => {
      target = document.querySelector(step.selector);
      if (!target) {
        setRect(null);
        return;
      }
      const r = target.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    };
    const reveal = window.setTimeout(() => {
      target = document.querySelector(step.selector);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      window.setTimeout(update, 250);
    }, 80);
    const poll = window.setInterval(update, 400);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    return () => {
      window.clearTimeout(reveal);
      window.clearInterval(poll);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const closeOnEscape = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  if (!step) return null;
  const cardWidth = Math.min(380, window.innerWidth - 24);
  let cardStyle;
  if (rect) {
    const estimatedHeight = 250;
    cardStyle = {
      width: cardWidth,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - cardWidth - 12)),
      top: rect.bottom + estimatedHeight + 20 < window.innerHeight
        ? rect.bottom + 14
        : Math.max(12, rect.top - estimatedHeight - 14),
    };
  }

  return (
    <div className="tour-layer" aria-live="polite">
      {rect && <div className="tour-spotlight" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <section
        ref={cardRef}
        className={'tour-card' + (rect ? '' : ' centered')}
        style={cardStyle}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        tabIndex={-1}
      >
        <button className="tour-close" onClick={onClose} aria-label="Close tutorial">×</button>
        <div className="tour-count">Step {index + 1} of {total}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.description}</p>
        {!rect && step.view === 'dash' && <p className="tour-note">Open or add a repository to see this section highlighted.</p>}
        <div className="tour-actions">
          <button className="btn" onClick={onClose} aria-label="Skip tutorial">Skip</button>
          <span className="tour-spacer" />
          <button className="btn" onClick={onBack} disabled={index === 0} aria-label="Previous tutorial step">Back</button>
          <button className="btn primary" onClick={onNext} aria-label={index === total - 1 ? 'Finish tutorial' : 'Next tutorial step'}>
            {index === total - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [repos, setRepos] = useState([]);
  const [jobs, setJobs] = useState({});
  const [toasts, setToasts] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [view, setView] = useState('repos'); // 'repos' | 'dash'
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [tourIndex, setTourIndex] = useState(() => {
    try {
      return window.localStorage.getItem(TOUR_STORAGE_KEY) ? null : 0;
    } catch {
      return 0;
    }
  });
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const toast = useCallback((msg, kind = 'info') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listRepos();
      setRepos(list);
    } catch (e) {
      toast('Failed to list repositories: ' + e.message, 'error');
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const jobsRef = useRef({});
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // Poll every running job (not just the newest) until none are left.
  const watchJob = useCallback(
    (jobId) => {
      setJobs((js) => ({ ...js, [jobId]: { status: 'running', progress: 0, detail: 'queued' } }));
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        const running = Object.keys(jobsRef.current).filter((id) => jobsRef.current[id]?.status === 'running');
        if (!running.length) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        for (const id of running) {
          try {
            const j = await api.job(id);
            const prev = jobsRef.current[id]?.status;
            setJobs((cur) => ({ ...cur, [id]: j }));
            if (j.status === 'ready' && prev === 'running') {
              toast(`Repository "${j.name}" ready`, 'ok');
              await refresh();
              setCurrentId(j.repoId);
              setView('dash');
            } else if (j.status === 'error' && prev === 'running') {
              toast(`Ingest failed: ${j.error}`, 'error');
            }
          } catch {
            /* transient poll error */
          }
        }
      }, 1000);
    },
    [refresh, toast]
  );

  const addByUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const { jobId } = await api.addByUrl(url.trim());
      toast('Clone started');
      watchJob(jobId);
      setAdding(false);
      setUrl('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const uploadZip = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { jobId } = await api.uploadZip(file);
      toast('Upload started');
      watchJob(jobId);
      setAdding(false);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeRepo = async (id) => {
    if (!window.confirm('Remove this repository and its cached data?')) return;
    try {
      await api.removeRepo(id);
      toast('Repository removed', 'ok');
      if (currentId === id) {
        setCurrentId(null);
        setView('repos');
      }
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const activeJobs = Object.entries(jobs).filter(([, j]) => j.status === 'running');
  const tourStep = tourIndex === null ? null : TOUR_STEPS[tourIndex];

  useEffect(() => {
    if (!tourStep) return;
    if (tourStep.view === 'repos') {
      setView('repos');
    } else if (repos.length) {
      setCurrentId((id) => (repos.some((repo) => repo.id === id) ? id : repos[0].id));
      setView('dash');
    }
  }, [tourStep, repos]);

  const closeTour = useCallback(() => {
    setTourIndex(null);
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      /* localStorage can be unavailable in privacy-restricted contexts */
    }
  }, []);

  const nextTourStep = () => {
    if (tourIndex === TOUR_STEPS.length - 1) closeTour();
    else setTourIndex((i) => i + 1);
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView('repos')} aria-label="Go to repositories">
          <span className="brand-mark">RAT</span>
          <span className="brand-sub">Repo Analysis Tool</span>
        </button>
        <nav className="repo-tabs" aria-label="Repository dashboards">
          {repos.map((r) => (
            <button
              key={r.id}
              className={'tab' + (currentId === r.id && view === 'dash' ? ' active' : '')}
              onClick={() => {
                setCurrentId(r.id);
                setView('dash');
              }}
              title={r.source?.url || r.source?.file || ''}
              aria-label={`Open ${r.name} dashboard`}
            >
              {r.name}
            </button>
          ))}
          <button className="tab add" onClick={() => setView('repos')} aria-label="Manage repositories">
            + Repositories
          </button>
        </nav>
        <button className="btn tour-launch" onClick={() => setTourIndex(0)} aria-label="Start dashboard tutorial">
          Tour
        </button>
      </header>

      {view === 'repos' && (
        <main className="repos-view">
          <section className="panel add-panel" data-tour="add-repository" aria-labelledby="add-repository-title">
            <h2 id="add-repository-title">Add a repository</h2>
            <div className="add-row">
              <input
                className="input"
                placeholder="https://github.com/user/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addByUrl()}
                disabled={busy}
                aria-label="Remote Git repository URL"
              />
              <button className="btn primary" onClick={addByUrl} disabled={busy || !url.trim()} aria-label="Clone repository URL">
                {busy && <span className="spinner small-spinner" aria-hidden="true" />} Clone URL
              </button>
            </div>
            <div className="divider">or</div>
            <div className="add-row">
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => uploadZip(e.target.files?.[0])}
                disabled={busy}
                aria-label="Upload repository zip file"
              />
              <span className="hint">zip containing a .git directory or bare repository</span>
            </div>
          </section>

          {activeJobs.length > 0 && (
            <section className="panel">
              <h2>In progress</h2>
              {activeJobs.map(([id, j]) => (
                <div key={id} className="job-row" role="status" aria-label={`${j.name || 'Repository'} ingestion progress`}>
                  <div className="job-info">
                    <strong>{j.name}</strong>
                    <span className="muted">{j.detail}</span>
                  </div>
                  <div className="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={j.progress || 0}>
                    <div className="progress-bar" style={{ width: `${j.progress}%` }} />
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="repo-grid">
            {repos.map((r) => (
              <div key={r.id} className="panel repo-card">
                <div className="repo-card-head">
                  <h3>{r.name}</h3>
                  <span className={'badge ' + (r.source?.type === 'zip' ? 'b-zip' : 'b-url')}>{r.source?.type}</span>
                </div>
                <div className="repo-stats">
                  <div><b><NumberText value={r.counts?.commits} /></b><span>commits</span></div>
                  <div><b><NumberText value={r.counts?.authors} /></b><span>authors</span></div>
                  <div><b><NumberText value={r.counts?.files} /></b><span>files</span></div>
                  <div><b><NumberText value={r.counts?.dirs} /></b><span>dirs</span></div>
                </div>
                <div className="muted small">
                  ingested {timeAgo(Math.floor((r.ingestedAt || 0) / 1000))}
                </div>
                <div className="repo-card-actions">
                  <button
                    className="btn primary"
                    aria-label={`Open ${r.name} dashboard`}
                    onClick={() => {
                      setCurrentId(r.id);
                      setView('dash');
                    }}
                  >
                    Open dashboard
                  </button>
                  <button className="btn danger" onClick={() => removeRepo(r.id)} aria-label={`Delete ${r.name} repository`}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {repos.length === 0 && <div className="empty">No repositories yet — add one above.</div>}
          </section>
        </main>
      )}

      {view === 'dash' && currentId && (
        <Dashboard repoId={currentId} repos={repos} toast={toast} tourStep={tourStep?.id || null} />
      )}

      <div className="toasts" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.msg}
          </div>
        ))}
      </div>

      <GuidedTour
        step={tourStep}
        index={tourIndex ?? 0}
        total={TOUR_STEPS.length}
        onBack={() => setTourIndex((i) => Math.max(0, i - 1))}
        onNext={nextTourStep}
        onClose={closeTour}
      />
    </div>
  );
}
