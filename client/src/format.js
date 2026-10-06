export function fullNumber(n, maximumFractionDigits = 12) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits });
}

export function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n * 10) / 10);
}

export function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return (x * 100).toFixed(digits) + '%';
}

export function numberParts(n, { percent = false } = {}) {
  const display = percent ? pct(n) : fmt(n);
  if (display === '—') return { display, exact: 'Not available' };
  const exact = percent ? `${fullNumber(Number(n) * 100)}%` : fullNumber(n);
  return { display, exact };
}

export function dstr(unix) {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return d.toISOString().slice(0, 10);
}

export function dtstr(unix) {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// datetime-local input value <-> unix seconds
export function toLocalInput(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  if (!v) return null;
  const t = Math.floor(new Date(v).getTime() / 1000);
  return Number.isFinite(t) ? t : null;
}

export function shortHash(h) {
  return h ? h.slice(0, 10) : '—';
}

export function timeAgo(unix) {
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
