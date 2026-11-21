// End-to-end check of the live call translation API.
const BASE = process.env.BASE || 'http://127.0.0.1:4500';
const email = `live${Date.now()}@azolve.test`;

const post = (p, body, token) => fetch(`${BASE}${p}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

const start = await post('/api/auth/email/start', { email });
const code = start.data.deliveryCode;
const verify = await post('/api/auth/email/verify', { userId: start.data.userId, code });
const token = verify.data.token;
console.log('auth', start.status, verify.status, !!token);

const status = await fetch(`${BASE}/api/calls/live/status`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
console.log('status', JSON.stringify(status));

const pairs = [
  ['en', 'hi', 'Shall we meet this evening at seven?'],
  ['hi', 'en', 'मैं आज शाम सात बजे मिल सकता हूँ।'],
  ['en', 'es', 'The train is late by twenty minutes.'],
  ['gu', 'en', 'તમે કેમ છો?'],
];
for (const [from, to, text] of pairs) {
  const t0 = Date.now();
  const r = await post('/api/calls/live/translate', { text, from, to }, token);
  console.log(`${from}->${to} ${r.status} ${Date.now() - t0}ms`, JSON.stringify(r.data).slice(0, 220));
}
