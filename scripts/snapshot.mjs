/**
 * Captures a real API snapshot from the running AZOLVE server.
 * The snapshot powers the static preview build (VITE_DEMO=1) so the deployed
 * preview shows exactly the same data shapes the real server returns.
 *
 *   node scripts/snapshot.mjs > web/src/lib/demo-data.json
 */
const BASE = process.env.BASE || 'http://localhost:3000/api';

const ACCOUNTS = [
  { key: 'alex', identifier: 'alex@azolve.io', password: 'Azolve@2025' },
  { key: 'priya', identifier: 'priya@azolve.io', password: 'Azolve@2025' },
  { key: 'omar', identifier: 'omar@azolve.io', password: 'Azolve@2025' },
  { key: 'lena', identifier: 'lena@azolve.io', password: 'Azolve@2025' },
  { key: 'miguel', identifier: 'miguel@azolve.io', password: 'Azolve@2025' },
  { key: 'yuki', identifier: 'yuki@azolve.io', password: 'Azolve@2025' },
  { key: 'admin', identifier: 'azolve', password: 'Azolve@2025' },
];

async function call(path, token, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) return { __error: r.status, ...json };
  return json;
}

const out = { generatedAt: Date.now(), accounts: [], byUser: {}, profiles: {}, social: null, communities: null, admin: null, aiStatus: null };

for (const acc of ACCOUNTS) {
  const login = await call('/auth/login', null, { method: 'POST', body: { identifier: acc.identifier, password: acc.password } });
  if (!login.token) { console.error('login failed', acc.key, login); continue; }
  const t = login.token;
  const me = login.user;
  out.accounts.push({ key: acc.key, id: me.id, username: me.username, email: me.email, displayName: me.displayName, language: me.language, role: me.role, avatar: me.avatar });
  const u = { me, chats: await call('/chats', t), convs: {}, notifications: await call('/ai/notifications', t), calls: await call('/ai/calls', t), sessions: await call('/auth/sessions', t), aiThreads: await call('/ai/threads', t) };
  const list = u.chats?.conversations || [];
  for (const c of list) {
    const detail = await call(`/chats/${c.id}`, t);
    const msgs = await call(`/chats/${c.id}/messages`, t);
    u.convs[c.id] = { conversation: detail.conversation || c, participants: detail.participants || [], messages: msgs.messages || [], viewerLanguage: msgs.viewerLanguage };
  }
  out.byUser[me.id] = u;

  if (acc.key === 'alex') {
    out.social = {
      feed: await call('/social/feed', t),
      explore: await call('/social/explore', t),
      trending: await call('/social/trending', t),
      moments: await call('/social/moments', t),
      suggestions: await call('/users/suggestions', t),
    };
    const cl = await call('/communities', t);
    const details = {};
    for (const c of cl.communities || []) details[c.id] = await call(`/communities/${c.id}`, t);
    out.communities = { list: cl, details };
    out.aiStatus = await call('/ai/status', t);
  }

  if (acc.key === 'admin') {
    out.admin = {
      stats: await call('/admin/stats', t),
      users: await call('/admin/users', t),
      reports: await call('/admin/reports', t),
      audit: await call('/admin/audit', t),
    };
  }
}

for (const a of out.accounts) {
  const p = await call(`/users/${a.username}`, null);
  if (!p.__error) out.profiles[a.username] = p;
}

process.stdout.write(JSON.stringify(out));
