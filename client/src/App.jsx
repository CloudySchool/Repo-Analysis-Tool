import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Dashboard } from './Dashboard.jsx';
import { fmt, timeAgo } from './format.js';

let toastSeq = 0;

export default function App() {
  const [repos, setRepos] = useState([]);
  const [jobs, setJobs] = useState({});
  const [toasts, setToasts] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [view, setView] = useState('repos'); // 'repos' | 'dash'
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setView('repos')}>
          <span className="brand-mark">RAT</span>
          <span className="brand-sub">Repo Analysis Tool</span>
        </div>
        <nav className="repo-tabs">
          {repos.map((r) => (
            <button
              key={r.id}
              className={'tab' + (currentId === r.id && view === 'dash' ? ' active' : '')}
              onClick={() => {
                setCurrentId(r.id);
                setView('dash');
              }}
              title={r.source?.url || r.source?.file || ''}
            >
              {r.name}
            </button>
          ))}
          <button className="tab add" onClick={() => setView('repos')}>
            + Repositories
          </button>
        </nav>
      </header>

      {view === 'repos' && (
        <main className="repos-view">
          <section className="panel add-panel">
            <h2>Add a repository</h2>
            <div className="add-row">
              <input
                className="input"
                placeholder="https://github.com/user/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addByUrl()}
                disabled={busy}
              />
              <button className="btn primary" onClick={addByUrl} disabled={busy || !url.trim()}>
                Clone URL
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
              />
              <span className="hint">zip containing a .git directory or bare repository</span>
            </div>
          </section>

          {activeJobs.length > 0 && (
            <section className="panel">
              <h2>In progress</h2>
              {activeJobs.map(([id, j]) => (
                <div key={id} className="job-row">
                  <div className="job-info">
                    <strong>{j.name}</strong>
                    <span className="muted">{j.detail}</span>
                  </div>
                  <div className="progress">
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
                  <div><b>{fmt(r.counts?.commits)}</b><span>commits</span></div>
                  <div><b>{fmt(r.counts?.authors)}</b><span>authors</span></div>
                  <div><b>{fmt(r.counts?.files)}</b><span>files</span></div>
                  <div><b>{fmt(r.counts?.dirs)}</b><span>dirs</span></div>
                </div>
                <div className="muted small">
                  ingested {timeAgo(Math.floor((r.ingestedAt || 0) / 1000))}
                </div>
                <div className="repo-card-actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      setCurrentId(r.id);
                      setView('dash');
                    }}
                  >
                    Open dashboard
                  </button>
                  <button className="btn danger" onClick={() => removeRepo(r.id)}>
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
        <Dashboard repoId={currentId} repos={repos} toast={toast} />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
