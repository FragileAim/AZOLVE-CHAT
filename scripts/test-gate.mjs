/* End-to-end proof of Request Y:
     1. sign-in vs create-account behave differently on the same address
     2. a stranger can see everyone but cannot DM, message or call
     3. after the request is accepted, chat opens
     4. logout revokes the refresh token, and signing back in restores history

   Run against a live server:  BASE=http://localhost:4500 node scripts/test-gate.mjs
*/

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
const mk = async (tag) => {
  const email = `${tag}.${stamp}@azolve.io`;
  const s = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: `${tag} ${stamp}`, mode: 'create' } });
  if (s.status !== 200) throw new Error(`start ${tag}: ${s.status} ${JSON.stringify(s.data)}`);
  const v = await j('/api/auth/email/verify', { method: 'POST', body: { userId: s.data.userId, code: s.data.deliveryCode } });
  if (v.status !== 200) throw new Error(`verify ${tag}: ${v.status}`);
  return { email, id: v.data.user.id, username: v.data.user.username, token: v.data.token, refreshToken: v.data.refreshToken, name: `${tag} ${stamp}` };
};

console.log('\n== 1. sign in vs create account ==');
const alice = await mk('alice');
const bob = await mk('bob');

const signupDup = await j('/api/auth/email/start', { method: 'POST', body: { email: alice.email, mode: 'signup' } });
check('creating with an existing email is refused', signupDup.status === 409 && signupDup.data.code === 'ACCOUNT_EXISTS',
  `status ${signupDup.status} code ${signupDup.data.code}`);

const signinUnknown = await j('/api/auth/email/start', { method: 'POST', body: { email: `nobody.${stamp}@azolve.io`, mode: 'signin' } });
check('signing in with an unknown email says "no account"', signinUnknown.status === 404 && signinUnknown.data.code === 'NO_ACCOUNT',
  `status ${signinUnknown.status} code ${signinUnknown.data.code}`);

const signin = await j('/api/auth/email/start', { method: 'POST', body: { email: alice.email, mode: 'signin' } });
check('signing in with a real email issues a code', signin.status === 200 && !!signin.data.deliveryCode, `status ${signin.status}`);
check('sign-in does not create a second account', signin.data.userId === alice.id, `${signin.data.userId} vs ${alice.id}`);
check('sign-in is flagged as a returning user', signin.data.isNew === false, `isNew=${signin.data.isNew}`);

console.log('\n== 2. everyone is discoverable ==');
const dir = await j('/api/contacts/directory?limit=60', { token: alice.token });
const bobInDir = (dir.data.users || []).find(u => u.id === bob.id);
check('directory lists other accounts', dir.status === 200 && !!bobInDir, `${(dir.data.users || []).length} people`);
check('stranger shows contactState "none"', bobInDir?.contactState === 'none', bobInDir?.contactState);

const prof = await j(`/api/users/${bob.username}`, { token: alice.token });
check('profile reports the relationship', prof.status === 200 && prof.data.contactState === 'none', prof.data.contactState);

console.log('\n== 3. the gate blocks a stranger ==');
const dmBlocked = await j('/api/chats/dm', { method: 'POST', body: { userId: bob.id }, token: alice.token });
check('stranger cannot open a DM', dmBlocked.status === 403 && dmBlocked.data.code === 'NOT_CONTACTS',
  `status ${dmBlocked.status} code ${dmBlocked.data.code}`);

const req = await j('/api/contacts/request', { method: 'POST', body: { userId: bob.id, note: 'Hi from the gate test' }, token: alice.token });
check('a request can be sent', req.status === 201 && req.data.state === 'pending_out', `status ${req.status} state ${req.data.state}`);

const dmStill = await j('/api/chats/dm', { method: 'POST', body: { userId: bob.id }, token: alice.token });
check('a pending request still cannot open a DM', dmStill.status === 403 && dmStill.data.code === 'NOT_CONTACTS',
  `status ${dmStill.status} code ${dmStill.data.code}`);

const inbox = await j('/api/contacts/requests', { token: bob.token });
const fromAlice = (inbox.data.incoming || []).find(r => r.user.id === alice.id);
check('the request lands in the target inbox', inbox.status === 200 && !!fromAlice, `${(inbox.data.incoming || []).length} incoming`);
check('the note is carried through', fromAlice?.note === 'Hi from the gate test', fromAlice?.note);

const aliceState = await j(`/api/contacts/state/${bob.id}`, { token: alice.token });
check('sender sees pending_out', aliceState.data.state === 'pending_out', aliceState.data.state);
const bobState = await j(`/api/contacts/state/${alice.id}`, { token: bob.token });
check('receiver sees pending_in', bobState.data.state === 'pending_in', bobState.data.state);

console.log('\n== 4. accepting opens the conversation ==');
const acc = await j('/api/contacts/respond', { method: 'POST', body: { requestId: fromAlice.requestId, action: 'accept' }, token: bob.token });
check('accept succeeds', acc.status === 200 && acc.data.state === 'contact', `status ${acc.status} state ${acc.data.state}`);

const dm = await j('/api/chats/dm', { method: 'POST', body: { userId: bob.id }, token: alice.token });
check('contacts can open a DM', dm.status === 200 || dm.status === 201, `status ${dm.status}`);
const convId = dm.data.conversation?.id;
check('conversation id returned', !!convId, convId || 'none');

const msg = await j(`/api/chats/${convId}/messages`, { method: 'POST', body: { body: 'Gate test message' }, token: alice.token });
check('contacts can send a message', msg.status === 200 || msg.status === 201, `status ${msg.status}`);

console.log('\n== 5. removing a contact re-closes the door ==');
await j(`/api/contacts/${bob.id}`, { method: 'DELETE', token: alice.token });
const afterRemove = await j(`/api/chats/${convId}/messages`, { method: 'POST', body: { body: 'should fail' }, token: alice.token });
check('messages are refused after removal', afterRemove.status === 403 && afterRemove.data.code === 'NOT_CONTACTS',
  `status ${afterRemove.status} code ${afterRemove.data.code}`);

console.log('\n== 6. logout and sign back in ==');
const out = await j('/api/auth/logout', { method: 'POST', body: { refreshToken: alice.refreshToken }, token: alice.token });
check('logout succeeds', out.status === 200 || out.status === 204, `status ${out.status}`);

const reuse = await j('/api/auth/refresh', { method: 'POST', body: { refreshToken: alice.refreshToken } });
check('the old refresh token is dead after logout', reuse.status === 401 || reuse.status === 403, `status ${reuse.status}`);

const again = await j('/api/auth/email/start', { method: 'POST', body: { email: alice.email, mode: 'signin' } });
const back = await j('/api/auth/email/verify', { method: 'POST', body: { userId: again.data.userId, code: again.data.deliveryCode } });
check('signing back in works', back.status === 200 && !!back.data.token, `status ${back.status}`);
check('it is the same account', back.data.user?.id === alice.id, `${back.data.user?.id} vs ${alice.id}`);

const chats = await j('/api/chats', { token: back.data.token });
const kept = (chats.data.conversations || []).find(c => c.id === convId);
check('chat history is still there after signing back in', !!kept, `${(chats.data.conversations || []).length} conversations`);
check('the earlier message survived', (kept?.lastMessage?.body || '').includes('Gate test'), kept?.lastMessage?.body || 'none');

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
