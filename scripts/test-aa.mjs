/* Request AA verification: call signalling, who ended the call, and the
   offline / push path. Runs against a live server with two real Socket.IO
   connections, the same way the app talks to it. */

import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:4500';
let pass = 0, fail = 0;
const failures = [];
const ok = (n, extra = '') => { pass++; console.log(`  PASS  ${n}${extra ? '  ' + extra : ''}`); };
const bad = (n, d) => { fail++; failures.push(`${n}: ${d}`); console.log(`  FAIL  ${n}  ->  ${d}`); };
const check = (n, c, d = '') => (c ? ok(n, d) : bad(n, d || 'false'));

async function req(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const stamp = Date.now().toString().slice(-7);
async function makeUser(tag) {
  const email = `aa.${tag}.${stamp}@azolve.io`;
  const s = await req('POST', '/api/auth/email/start', { body: { email, displayName: `AA ${tag}` } });
  if (!s.data.deliveryCode) throw new Error('no code: ' + JSON.stringify(s.data));
  const v = await req('POST', '/api/auth/email/verify', { body: { userId: s.data.userId, code: s.data.deliveryCode } });
  if (!v.data.token) throw new Error('no token: ' + JSON.stringify(v.data));
  return { id: v.data.user.id, name: `AA ${tag}`, token: v.data.token, refresh: v.data.refreshToken, email };
}

const connect = (u) => new Promise((res, rej) => {
  const s = io(BASE, { auth: { token: u.token }, transports: ['websocket'] });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});
const once = (sock, ev, ms = 6000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout: ${ev}`)), ms);
  sock.once(ev, (p) => { clearTimeout(t); res(p); });
});

const A = await makeUser('A');
const B = await makeUser('B');
const C = await makeUser('C');

/* Contacts: calling is gated, so set the gate up properly. */
const rq = await req('POST', '/api/contacts/request', { token: A.token, body: { userId: B.id } });
const rid = rq.data.requestId;
const acc = await req('POST', '/api/contacts/respond', { token: B.token, body: { requestId: rid, action: 'accept' } });
if (acc.data.state !== 'contact') throw new Error('contact setup failed: ' + JSON.stringify(acc.data));
const rq2 = await req('POST', '/api/contacts/request', { token: A.token, body: { userId: C.id } });
await req('POST', '/api/contacts/respond', { token: C.token, body: { requestId: rq2.data.requestId, action: 'accept' } });

const sa = await connect(A);
const sb = await connect(B);

console.log('\n=== 1. Decline records who declined ===');
{
  const call = await req('POST', '/api/ai/calls', { token: A.token, body: { calleeId: B.id, type: 'audio', status: 'ringing' } });
  const callId = call.data.callId;
  check('call row created', call.status === 201 && !!callId, String(call.status));

  const incoming = once(sb, 'call:incoming');
  sa.emit('call:invite', { to: B.id, callId, type: 'audio' });
  const inc = await incoming;
  check('callee receives call:incoming', inc.callId === callId, inc.callId);

  const declined = once(sa, 'call:declined');
  sb.emit('call:decline', { to: A.id, callId });
  const dec = await declined;
  check('caller is told it was declined', dec.callId === callId, dec.reason);
  check('decline names the person who declined', dec.by === B.id && dec.byName === B.name, `${dec.byName}`);

  await new Promise(r => setTimeout(r, 250));
  const hist = await req('GET', '/api/ai/calls', { token: A.token });
  const row = hist.data.calls.find(c => c.id === callId);
  check('call log says declined', row?.status === 'declined', row?.status);
  check('call log records ended_by = the decliner', row?.ended_by === B.id, row?.ended_by);
  check('call log records the reason', row?.ended_reason === 'declined', row?.ended_reason);
}

console.log('\n=== 2. Hang up records who hung up and the duration ===');
{
  const call = await req('POST', '/api/ai/calls', { token: A.token, body: { calleeId: B.id, type: 'audio', status: 'ringing' } });
  const callId = call.data.callId;

  const incoming = once(sb, 'call:incoming');
  sa.emit('call:invite', { to: B.id, callId, type: 'audio' });
  await incoming;

  const accepted = once(sa, 'call:accepted');
  sb.emit('call:accept', { to: A.id, callId });
  const acc = await accepted;
  check('caller is told it was accepted', acc.callId === callId);

  sa.emit('call:connected', { to: B.id, callId });
  await new Promise(r => setTimeout(r, 1600)); // a real second of conversation

  const ended = once(sb, 'call:ended');
  sa.emit('call:end', { to: B.id, callId });
  const end = await ended;
  check('callee is told the call ended', end.callId === callId);
  check('end names the person who hung up', end.by === A.id && end.byName === A.name, `${end.byName}`);
  check('end reports a real duration', typeof end.duration === 'number' && end.duration >= 1, `${end.duration}s`);

  await new Promise(r => setTimeout(r, 250));
  const hist = await req('GET', '/api/ai/calls', { token: B.token });
  const row = hist.data.calls.find(c => c.id === callId);
  check('call log says completed', row?.status === 'completed', row?.status);
  check('call log records ended_by = the hanger-upper', row?.ended_by === A.id, row?.ended_by);
  check('call log duration measured from answer, not from ring', row?.duration >= 1 && row.duration < 20, `${row?.duration}s`);
  check('call log records answered_at', !!row?.answered_at, String(row?.answered_at));
}

console.log('\n=== 3. Offline callee: honest unavailable, not a silent ring ===');
{
  const call = await req('POST', '/api/ai/calls', { token: A.token, body: { calleeId: C.id, type: 'audio', status: 'ringing' } });
  const callId = call.data.callId;
  const un = once(sa, 'call:unavailable');
  sa.emit('call:invite', { to: C.id, callId, type: 'audio' });
  const p = await un;
  check('caller is told the callee cannot be reached', p.callId === callId, p.reason || 'unavailable');

  await new Promise(r => setTimeout(r, 250));
  const hist = await req('GET', '/api/ai/calls', { token: A.token });
  const row = hist.data.calls.find(c => c.id === callId);
  check('unreachable call is logged as missed, not ringing forever', row?.status === 'missed', row?.status);
  check('unreachable call reason is peer-offline', row?.ended_reason === 'peer-offline', row?.ended_reason);
}

console.log('\n=== 4. Call log ownership ===');
{
  const call = await req('POST', '/api/ai/calls', { token: A.token, body: { calleeId: B.id, type: 'audio', status: 'ringing' } });
  const outsider = await req('PATCH', `/api/ai/calls/${call.data.callId}`, { token: C.token, body: { status: 'completed' } });
  check('a stranger cannot rewrite your call log', outsider.status === 403, String(outsider.status));
  const owner = await req('PATCH', `/api/ai/calls/${call.data.callId}`, { token: A.token, body: { status: 'completed', duration: 5, reason: 'hangup' } });
  check('a participant can close their own call', owner.status === 200 && owner.data.endedBy === A.id, JSON.stringify(owner.data));
}

sa.close(); sb.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) failures.forEach(f => console.log('  - ' + f));
process.exit(fail ? 1 : 0);
