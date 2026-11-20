export const timeAgo = (ts) => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const clock = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
export const fullDate = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const dayLabel = (ts) => {
  const d = new Date(ts); const today = new Date(); const y = new Date(Date.now() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

export const initials = (name = '?') => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

const GRADS = [
  'linear-gradient(135deg,#6d5ef8,#4f8cff)', 'linear-gradient(135deg,#ff7a59,#ff4d6d)',
  'linear-gradient(135deg,#18e0c8,#0ea5e9)', 'linear-gradient(135deg,#b14cff,#6d5ef8)',
  'linear-gradient(135deg,#ffb020,#ff7a59)', 'linear-gradient(135deg,#22d37a,#18e0c8)',
  'linear-gradient(135deg,#4f8cff,#b14cff)', 'linear-gradient(135deg,#ff4d6d,#b14cff)',
];
export const gradientFor = (seed = '') => {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return GRADS[h % GRADS.length];
};

export const RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);
export const isRTL = (code) => RTL_LANGS.has(code);

export function groupByDay(messages) {
  const out = [];
  let cur = null;
  for (const m of messages) {
    const label = dayLabel(m.createdAt);
    if (!cur || cur.label !== label) { cur = { label, items: [] }; out.push(cur); }
    cur.items.push(m);
  }
  return out;
}

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function bytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function countdown(ts) {
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
