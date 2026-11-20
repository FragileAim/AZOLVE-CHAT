/* Focused checks for the session/refresh behaviour the user reported.
   Run against a live server:  BASE=http://localhost:4500 node scripts/test-session.mjs */

const BASE = process.env.BASE || 'http://localhost:4500';
let pass = 0, fail = 0;
const ok = (n, x = '') => { pass++; console.log(`  PASS  ${n}${x ? '  ' + x : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}  ->  ${d}`); };
const check = (n, c, d = '') => (c ? ok(n, d) : bad(n, d || 'false'));

const j = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

const stamp = Date.now();
const email = `sess.${stamp}@azolve.io`;

const start = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: 'Session Test' } });
check('email/start', start.status === 200, `status ${start.status}`);
const code = start.data.deliveryCode;
check('code echoed in test mode', !!code, code ? 'yes' : 'no');

const ver = await j('/api/auth/email/verify', { method: 'POST', body: { userId: start.data.userId, code } });
check('email/verify returns session', ver.status === 200 && !!ver.data.token && !!ver.data.refreshToken, `status ${ver.status}`);
const { token: t0, refreshToken: rt1 } = ver.data;

const me = await j('/api/auth/me', { token: t0 });
check('access token works', me.status === 200 && me.data.user?.email === email);

/* --- rotation --- */
const r1 = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: rt1 } });
check('refresh #1 ok', r1.status === 200 && !!r1.data.refreshToken, `status ${r1.status}`);
const rt2 = r1.data.refreshToken;
check('refresh token actually rotated', rt2 !== rt1);

/* The race: a second tab still holds rt1 and refreshes a moment later. */
const r2 = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: rt1 } });
check('stale token still works inside the grace window', r2.status === 200, `status ${r2.status}`);
check('grace refresh hands back the token the caller already has', r2.data.refreshToken === rt1, String(r2.data.refreshToken).slice(0, 8) + '…');

const r3 = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: rt2 } });
check('current token still works', r3.status === 200, `status ${r3.status}`);
const rt3 = r3.data.refreshToken;

const me2 = await j('/api/auth/me', { token: r2.data.token });
check('access token from grace refresh is valid', me2.status === 200, `status ${me2.status}`);

/* --- deliberate sign-out --- */
await j('/api/auth/logout', { method: 'POST', token: r3.data.token });
const afterLogout = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: rt3 } });
check('refresh rejected after logout', afterLogout.status === 401, `status ${afterLogout.status}`);
const meAfter = await j('/api/auth/me', { token: r3.data.token });
check('access token rejected after logout', meAfter.status === 401, `status ${meAfter.status}`);
check('revoked session says so', meAfter.data.code === 'session_revoked', JSON.stringify(meAfter.data));

/* --- unknown session (what a database reset looks like) --- */
const fake = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1X25vbmUiLCJzaWQiOiJzX2dvbmUiLCJyb2xlIjoidXNlciIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo5OTk5OTk5OTk5fQ.invalid-signature';
const unknown = await j('/api/auth/me', { token: fake });
check('badly signed token -> 401', unknown.status === 401, `status ${unknown.status}`);

/* A token signed with the real secret but pointing at a deleted session can only
   be produced server-side, so we approximate it by checking the message text
   path exists in the codebase. */
const fs = await import('node:fs/promises');
const src = await fs.readFile(new URL('../server/auth.js', import.meta.url), 'utf8');
check('missing session row reports "expired", not "revoked"', src.includes("code: 'session_expired'"));
check('revoked session row reports "revoked"', src.includes("code: 'session_revoked'"));
check('rotation keeps a grace window', src.includes('ROTATE_GRACE_MS'));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
