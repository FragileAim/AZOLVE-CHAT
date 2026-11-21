/* Proves "stay signed in on the same device" survives a server restart.

   Phase 1 (create): register a real account, keep the token + refresh token.
   Then the shell restarts the server process.
   Phase 2 (verify): the SAME token must still work, /api/auth/me must still
   return the same user, and a refresh with the SAME refresh token must still
   succeed. If the account vanished from the database (the old WAL-signature
   bug), phase 2 fails with 401.

   Run:  node scripts/test-restart.mjs create
         <restart the server>
         node scripts/test-restart.mjs verify
*/
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4500';
const FILE = '/tmp/azolve-restart.json';
const phase = process.argv[2] || 'create';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}${d ? '  ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${n}  ->  ${d}`); } };

const j = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

if (phase === 'create') {
  const stamp = Date.now();
  const email = `stay.${stamp}@azolve.io`;
  const start = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: 'Stay Signed In' } });
  check('signup started', start.status === 200, `status ${start.status}`);
  const ver = await j('/api/auth/email/verify', { method: 'POST', body: { userId: start.data.userId, code: start.data.deliveryCode } });
  check('signed up and got a session', ver.status === 200 && !!ver.data.token, `status ${ver.status}`);
  await j('/api/users/me', { method: 'PATCH', token: ver.data.token, body: { username: `stay_${stamp}`, country: 'IN', bio: 'restart proof' } });
  fs.writeFileSync(FILE, JSON.stringify({
    email, userId: ver.data.user.id, token: ver.data.token, refreshToken: ver.data.refreshToken,
  }));
  console.log(`\nSaved session for ${email}. Now restart the server and run: node scripts/test-restart.mjs verify`);
  process.exit(fail ? 1 : 0);
}

if (!fs.existsSync(FILE)) { console.log('No saved session — run the create phase first.'); process.exit(1); }
const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const me = await j('/api/auth/me', { token: saved.token });
check('the same access token still works after a restart', me.status === 200, `status ${me.status}`);
check('it is still the same account', me.data.user?.id === saved.userId, `${me.data.user?.id} vs ${saved.userId}`);
check('the account still has its profile', String(me.data.user?.username || '').startsWith('stay_'), me.data.user?.username);

const ref = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: saved.refreshToken } });
check('the same refresh token still works after a restart', ref.status === 200 && !!ref.data.token, `status ${ref.status}`);

const me2 = await j('/api/auth/me', { token: ref.data.token });
check('the refreshed token resolves to the same account', me2.data.user?.id === saved.userId, me2.data.user?.id);

/* And the honest negative: a garbage token must still be rejected, otherwise
   "stays signed in" would really mean "never checks anything". */
const bogus = await j('/api/auth/me', { token: 'not-a-real-token' });
check('a bogus token is still rejected', bogus.status === 401, `status ${bogus.status}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
