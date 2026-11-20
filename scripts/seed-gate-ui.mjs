/* Seeds a fresh pair for the UI gate test and prints the token of the
   receiver (the one with a pending request waiting). */
const B = process.env.BASE || 'http://localhost:4500';
const j = async (p, o = {}) => {
  const r = await fetch(B + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const s = Date.now();
const make = async (name, country, bio) => {
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${s}@azolve.io`;
  const a = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: name, mode: 'create' } });
  const v = await j('/api/auth/email/verify', { method: 'POST', body: { userId: a.data.userId, code: a.data.deliveryCode } });
  await j('/api/users/me', { method: 'PATCH', token: v.data.token, body: { country, bio } });
  return { id: v.data.user.id, token: v.data.token, name };
};

const me = await make('Flow Tester', 'India', 'Testing the gate');
const priya = await make('Priya Sharma', 'India', 'Product designer');
await j('/api/contacts/request', {
  method: 'POST', token: priya.token,
  body: { userId: me.id, note: 'Hi! We met at the Ahmedabad founders meetup — would love to stay in touch.' },
});
console.log(me.token);
