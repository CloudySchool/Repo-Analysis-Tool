const BASE = '/api';

async function j(res) {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const b = await res.json();
      msg = b.error || msg;
    } catch {
      /* keep statusText */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  listRepos: () => fetch(`${BASE}/repos`).then(j),

  addByUrl: (url) =>
    fetch(`${BASE}/repos/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(j),

  uploadZip: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`${BASE}/repos/zip`, { method: 'POST', body: fd }).then(j);
  },

  job: (id) => fetch(`${BASE}/jobs/${id}`).then(j),

  removeRepo: (id) => fetch(`${BASE}/repos/${id}`, { method: 'DELETE' }).then(j),

  metrics: (id, params) => {
    const clean = {};
    for (const [k, v] of Object.entries(params || {})) {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      clean[k] = Array.isArray(v) ? v.join(',') : v;
    }
    const qs = new URLSearchParams(clean).toString();
    return fetch(`${BASE}/repos/${id}/metrics${qs ? '?' + qs : ''}`).then(j);
  },

  commits: (id, params, limit = 200) => {
    const clean = { limit };
    for (const [k, v] of Object.entries(params || {})) {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      clean[k] = Array.isArray(v) ? v.join(',') : v;
    }
    const qs = new URLSearchParams(clean).toString();
    return fetch(`${BASE}/repos/${id}/commits?${qs}`).then(j);
  },

  authors: (id) => fetch(`${BASE}/repos/${id}/authors`).then(j),

  merge: (id, emails, name) =>
    fetch(`${BASE}/repos/${id}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails, name }),
    }).then(j),

  unmerge: (id, email) =>
    fetch(`${BASE}/repos/${id}/unmerge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then(j),
};
