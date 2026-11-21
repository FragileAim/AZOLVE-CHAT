/* Compares the live DOM's computed styles against the UXPilot export's exact
   Tailwind measurements. Prints PASS/FAIL per check so fidelity is measured. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:4500';
const PORT = 9379;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const post = async (p, b, tok) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b),
})).json();

const stamp = Date.now();
const email = `audit.${stamp}@azolve.io`;
const s = await post('/api/auth/email/start', { email, name: 'Audit User' });
const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
await fetch(BASE + '/api/users/me', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + v.token },
  body: JSON.stringify({ language: 'hi', country: 'IN', bio: 'Audit account for layout checks.', displayName: 'Audit User', username: 'audit' + String(stamp).slice(-6) }),
});


/* --- seed real content so layout checks run against populated screens --- */
const mk = async (name, lang) => {
  const st = Date.now() + Math.floor(Math.random() * 9999);
  const em = `${name.toLowerCase().replace(/\W/g, '')}.${st}@azolve.io`;
  const a = await post('/api/auth/email/start', { email: em, name });
  const b = await post('/api/auth/email/verify', { userId: a.userId, code: a.deliveryCode });
  await fetch(BASE + '/api/users/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b.token },
    body: JSON.stringify({ language: lang, country: 'IN', bio: 'Seeded for layout audit.', displayName: name, username: name.toLowerCase().replace(/\W/g, '') + String(st).slice(-5) }),
  });
  return { token: b.token, id: b.user.id, name };
};
const peer = await mk('Omar Haddad', 'en');
await post('/api/contacts/request', { userId: peer.id }, v.token);
const reqs = await (await fetch(BASE + '/api/contacts/requests', { headers: { Authorization: 'Bearer ' + peer.token } })).json();
const rid = reqs.incoming?.[0]?.requestId;
if (rid) await post('/api/contacts/respond', { requestId: rid, action: 'accept' }, peer.token);
await post(`/api/users/${peer.id}/follow`, {}, v.token);
await post(`/api/users/${v.user.id}/follow`, {}, peer.token);
const dm = await post('/api/chats/dm', { userId: peer.id }, v.token);
const cid = dm.conversation?.id;
if (cid) {
  await post(`/api/chats/${cid}/messages`, { body: 'Shall we meet this evening?' }, v.token);
  await post(`/api/chats/${cid}/messages`, { body: 'نعم، الساعة السابعة مناسب.' }, peer.token);
}
const IMG = 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=900&q=70';
await post('/api/social/posts', { caption: 'Golden hour never gets old ✨', media: [{ kind: 'image', url: IMG }] }, v.token);
await post('/api/social/posts', { caption: 'Designing across 27 languages', media: [{ kind: 'image', url: IMG }] }, peer.token);
await post('/api/social/moments', { type: 'text', text: 'Hello from Ahmedabad', caption: 'Testing the story viewer', audience: 'followers' }, v.token);
await post('/api/social/moments', { type: 'image', mediaUrl: IMG, caption: 'Evening light', audience: 'public' }, peer.token);
const comm = await post('/api/communities', { name: 'Cross-Language Design', description: 'Designing across 27 languages.', category: 'Design', privacy: 'public' }, v.token);
if (comm.community?.id) await post(`/api/communities/${comm.community.id}/join`, {}, v.token);
console.log('SEED', JSON.stringify({ dm, post: 'ok', moment: 'ok', comm: comm.community?.id, reqs: reqs.incoming?.length }));

const chrome = spawn(CHROME, ['--headless', '--remote-debugging-port=' + PORT, '--no-sandbox', '--disable-gpu', '--window-size=390,844', 'about:blank']);
await sleep(1400);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
let nav = 0;
const go = async (hash, settle = 2200) => {
  await send('Page.navigate', { url: `${BASE}/?splash=0&n=${++nav}#${hash}` }, sessionId);
  await sleep(settle);
};

const CHECKS = {
  chats: [
    ['.ux-cl-head', 'paddingTop', 56, 2],
    ['.ux-h1', 'fontSize', 30, 1],
    ['.ux-h1', 'fontWeight', 800, 1],
    ['.ux-av', 'width', 54, 1],
    ['.ux-name', 'fontSize', 15, 0.6],
    ['.ux-prev', 'fontSize', 13.5, 0.6],
  ],
  conversation: [
    ['.ux-cv-back', 'width', 40, 1],
    ['.ux-bubble', 'borderRadius', 20, 4],
  ],
  profile: [
    ['.ux-pf-cover', 'height', 190, 1],
    ['.ux-pf-avatar', 'width', 92, 1],
    ['.ux-pf-name', 'fontSize', 24, 1],
    ['.ux-pf-stats', 'borderRadius', 24, 1],
  ],
  explore: [
    ['.ux-feed-h1', 'fontSize', 26, 1],
    ['.ux-story-ring', 'width', 66, 1],
    ['.ux-post', 'borderRadius', 28, 1],
    ['.ux-post-media', 'height', 290, 2],
    ['.ux-post-follow', 'height', 30, 1],
  ],
  settings: [
    ['.ux-set-h1.lg', 'fontSize', 30, 1],
    ['.ux-set-ic', 'width', 36, 1],
  ],
  'settings/language': [
    ['.ux-set-h1', 'fontSize', 20, 1],
    ['.ux-my-lang', 'borderRadius', 24, 1],
    ['.ux-tgl', 'width', 46, 1],
    ['.ux-tgl', 'height', 28, 1],
  ],
  moments: [
    ['.ux-story-ring', 'width', 66, 1],
    ['.ux-calls-hero', 'borderRadius', 26, 1],
  ],
  calls: [
    ['.ux-calls-hero', 'borderRadius', 26, 1],
  ],
  communities: [
    ['.ux-comm-ic', 'width', 56, 1],
  ],
  home: [
    ['.ux-reel-tabs', 'fontSize', 16, 1],
    ['.ux-reel-rail .ic', 'width', 48, 1],
    ['.ux-reel-info', 'bottom', 96, 1],
  ],
  ai: [
    ['.ux-ai-orb', 'width', 40, 1],
    ['.ux-ai-input', 'height', 48, 1],
  ],
};

await go('');
await ev(`try{localStorage.setItem('azolve.token', ${JSON.stringify(v.token)});}catch(e){}`);
let fails = 0, total = 0;
const routeFor = (route) => route === 'conversation' && cid ? `chats/${cid}` : route;
for (const [route, checks] of Object.entries(CHECKS)) {
  await go(routeFor(route), ['explore','moments','home','conversation'].includes(route) ? 7000 : 2400);
  const got = await ev(`(() => {
    const out = {};
    const specs = ${JSON.stringify(checks)};
    for (const [sel, prop] of specs) {
      const el = document.querySelector(sel);
      out[sel + '|' + prop] = el ? getComputedStyle(el)[prop] : null;
    }
    out.__body = (document.body.innerText || '').slice(0, 160).replace(/\s+/g, ' ');
    return out;
  })()`);
  for (const [sel, prop, want, tol] of checks) {
    total++;
    const raw = got[sel + '|' + prop];
    const num = parseFloat(raw);
    const ok = raw != null && Math.abs(num - want) <= tol;
    if (!ok) { fails++; console.log(`FAIL  ${route.padEnd(20)} ${sel} ${prop} = ${raw} (want ${want}±${tol})  body~ "${got.__body || ''}"`); }
    else console.log(`PASS  ${route.padEnd(20)} ${sel} ${prop} = ${raw} (want ${want}±${tol})`);
  }
}
console.log(`\n${total - fails}/${total} checks passed`);
ws.close(); chrome.kill('SIGKILL');
process.exit(fails ? 1 : 0);
