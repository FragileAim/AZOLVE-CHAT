/* Two things the user asked for that are easy to get wrong:
     1. a stranger pressing Call must not ring the other person
     2. the Log out button on the profile must really end the session
   Run: BASE=http://localhost:4500 node scripts/test-call-logout.mjs */
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:4500';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}${d ? '  ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${n}  ->  ${d}`); } };

const j = async (p, o = {}) => {
  const r = await fetch(BASE + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const s = Date.now();
const make = async (name) => {
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${s}@azolve.io`;
  const a = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: name, mode: 'create' } });
  const v = await j('/api/auth/email/verify', { method: 'POST', body: { userId: a.data.userId, code: a.data.deliveryCode } });
  await j('/api/users/me', { method: 'PATCH', token: v.data.token, body: { country: 'India', bio: 'x' } });
  return { id: v.data.user.id, token: v.data.token, refreshToken: v.data.refreshToken, name };
};

const caller = await make('Caller Stranger');
const target = await make('Call Target');

const sock = io(BASE, { auth: { token: caller.token }, transports: ['websocket'], reconnection: false });
const targetSock = io(BASE, { auth: { token: target.token }, transports: ['websocket'], reconnection: false });

const waitFor = (s, ev, ms = 6000) => new Promise((res) => {
  const t = setTimeout(() => { s.off(ev, h); res(null); }, ms);
  const h = (p) => { clearTimeout(t); s.off(ev, h); res(p); };
  s.on(ev, h);
});

await Promise.all([waitFor(sock, 'connect'), waitFor(targetSock, 'connect')]);
await new Promise(r => setTimeout(r, 600));

console.log('\n== a stranger cannot ring you ==');
const refused = waitFor(sock, 'call:not-contact', 6000);
const rang = waitFor(targetSock, 'call:incoming', 3500);
sock.emit('call:invite', { to: target.id, kind: 'audio', callId: 'c_test_stranger' });
const [r1, r2] = await Promise.all([refused, rang]);
check('the caller is told they are not contacts', !!r1, r1 ? 'call:not-contact received' : 'nothing');
check('the target phone never rings', r2 === null, r2 ? 'IT RANG' : 'silent');

console.log('\n== once accepted, the call goes through ==');
const req = await j('/api/contacts/request', { method: 'POST', token: caller.token, body: { userId: target.id } });
const inbox = await j('/api/contacts/requests', { token: target.token });
const rid = (inbox.data.incoming || [])[0]?.requestId;
await j('/api/contacts/respond', { method: 'POST', token: target.token, body: { requestId: rid, action: 'accept' } });

const ring = waitFor(targetSock, 'call:incoming', 6000);
sock.emit('call:invite', { to: target.id, kind: 'audio', callId: 'c_test_ok' });
const incoming = await ring;
check('the target phone rings after acceptance', !!incoming, incoming ? `from ${incoming.from?.displayName || 'peer'}` : 'no ring');

console.log('\n== log out ends the session ==');
const out = await j('/api/auth/logout', { method: 'POST', token: caller.token, body: { refreshToken: caller.refreshToken } });
check('logout returns ok', out.status === 200, `status ${out.status}`);
const reuse = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: caller.refreshToken } });
check('the refresh token no longer works', reuse.status === 401 || reuse.status === 403, `status ${reuse.status}`);
const meAfter = await j('/api/auth/me', { token: caller.token });
check('the access token is rejected too', meAfter.status === 401 || meAfter.status === 403, `status ${meAfter.status}`);

const signin = await j('/api/auth/email/start', { method: 'POST', body: { email: `callerstranger.${s}@azolve.io`, mode: 'signin' } });
check('they can sign straight back in', signin.status === 200 && signin.data.userId === caller.id, `status ${signin.status}`);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
sock.close(); targetSock.close();
process.exit(fail === 0 ? 0 : 1);
