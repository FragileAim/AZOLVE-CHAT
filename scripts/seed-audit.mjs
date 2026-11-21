/* Creates a ready-to-use test account with some content so the UI audit has
   something real to look at. Prints the access token on the last line. */
const BASE = process.env.BASE || 'http://localhost:4500';

const post = async (path, body, token) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const patch = async (path, body, token) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

async function makeUser(email, name, handle) {
  const s = await post('/auth/email/start', { email, mode: 'signup' });
  if (s.status !== 200) throw new Error(`start ${s.status}: ${JSON.stringify(s.data)}`);
  const code = s.data.deliveryCode;
  if (!code) throw new Error('no dev code returned — is OTP_DEV_ECHO=1?');
  const v = await post('/auth/email/verify', { userId: s.data.userId, code });
  if (v.status !== 200) throw new Error(`verify ${v.status}: ${JSON.stringify(v.data)}`);
  const token = v.data.token;
  await patch('/users/me', {
    displayName: name, username: handle, country: 'India',
    bio: 'Designing calm software for a noisy world.', language: 'en',
  }, token);
  return { token, id: v.data.user?.id || s.data.userId };
}

const me = await makeUser(`audit.me.${Date.now()}@azolve.io`, 'Aarav Mehta', `aarav${Date.now() % 10000}`);
const other = await makeUser(`audit.p.${Date.now()}@azolve.io`, 'Priya Sharma', `priya${Date.now() % 10000}`);

/* A pending request so the People inbox is populated. */
await post('/contacts/request', { userId: me.id, note: 'Hey! Saw we both work in design — would love to connect.' }, other.token);

const inbox = await fetch(`${BASE}/api/contacts/requests`, { headers: { Authorization: `Bearer ${me.token}` } }).then(r => r.json());
const pending = (inbox.incoming || [])[0];
if (pending) await post('/contacts/respond', { requestId: pending.requestId, action: 'accept' }, me.token);

/* A conversation with a few messages so the chat list is not empty. */
const dm = await post('/chats/dm', { userId: other.id }, me.token);
if (dm.status === 201) {
  const cid = dm.data.id || dm.data.conversation?.id;
  for (const body of ['Hey Priya! Just moved to Ahmedabad.', 'Loving the new design system you shared.']) {
    await post(`/chats/${cid}/messages`, { body }, me.token);
  }
  for (const body of ['Welcome! Let me know if you need anything.', 'Thanks, that means a lot.']) {
    await post(`/chats/${cid}/messages`, { body }, other.token);
  }
}

console.log(me.token);
