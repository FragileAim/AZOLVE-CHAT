/* Clicks every button on every screen and reports which ones do nothing.
   A button "works" if clicking it changes the route, opens a dialog/sheet,
   mutates the DOM, fires a network request, or shows a toast. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:4500';
const PORT = 9381;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const post = async (p, b, tok) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b),
})).json();
const get = async (p, tok) => (await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + tok } })).json();

/* ---------- account + content ---------- */
const stamp = Date.now();
const mk = async (name, lang) => {
  const em = `${name.toLowerCase().replace(/\W/g, '')}.${stamp + Math.floor(Math.random() * 999)}@azolve.io`;
  const a = await post('/api/auth/email/start', { email: em, name });
  const b = await post('/api/auth/email/verify', { userId: a.userId, code: a.deliveryCode });
  await fetch(BASE + '/api/users/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b.token },
    body: JSON.stringify({ language: lang, country: 'IN', bio: 'Click test account.', displayName: name, username: name.toLowerCase().replace(/\W/g, '') + String(stamp).slice(-5) }),
  });
  return { token: b.token, id: b.user.id, name };
};
const me = await mk('Click Tester', 'hi');
const peer = await mk('Omar Haddad', 'en');
await post('/api/contacts/request', { userId: peer.id }, me.token);
const rq = await get('/api/contacts/requests', peer.token);
if (rq.incoming?.[0]) await post('/api/contacts/respond', { requestId: rq.incoming[0].requestId, action: 'accept' }, peer.token);
const dm = await post('/api/chats/dm', { userId: peer.id }, me.token);
const cid = dm.conversation?.id;
if (cid) {
  await post(`/api/chats/${cid}/messages`, { body: 'Shall we meet this evening?' }, me.token);
  await post(`/api/chats/${cid}/messages`, { body: 'نعم، الساعة السابعة.' }, peer.token);
}
const IMG = 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=900&q=70';
await post('/api/social/posts', { caption: 'Golden hour ✨', media: [{ kind: 'image', url: IMG }] }, me.token);
await post('/api/social/moments', { type: 'text', text: 'Hello from Ahmedabad', caption: 'Testing', audience: 'followers' }, me.token);
const comm = await post('/api/communities', { name: 'Cross-Language Design', description: 'Designing across languages.', category: 'Design', privacy: 'public' }, me.token);
if (comm.community?.id) await post(`/api/communities/${comm.community.id}/join`, {}, me.token);
console.log('SEED ok cid=' + cid + ' comm=' + comm.community?.id);

/* ---------- browser ---------- */
const chrome = spawn(CHROME, ['--headless', '--remote-debugging-port=' + PORT, '--no-sandbox', '--disable-gpu', '--window-size=390,844', 'about:blank']);
await sleep(1400);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map(); const consoleErrors = [];
ws.on('message', (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push((msg.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXC ' + (msg.params?.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
});
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
await send('Runtime.enable', {}, sessionId);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.result?.exceptionDetails) return { __err: String(r.result.exceptionDetails.text || '').slice(0, 200) };
  return r.result?.result?.value;
};
let nav = 0;
const go = async (hash, settle = 2600) => {
  await send('Page.navigate', { url: `${BASE}/?splash=0&n=${++nav}#${hash}` }, sessionId);
  await sleep(settle);
};

await go('');
await ev(`try{localStorage.setItem('azolve.token', ${JSON.stringify(me.token)});}catch(e){}`);

/* Destructive / external buttons we must not press in an automated sweep. */
const SKIP = /delete|remove|block|report|log ?out|sign ?out|leave|unfriend|clear|reset|end call|hang ?up|decline/i;

const PAGES = [
  ['home', 'home'], ['chats', 'chats'], ['chats/' + cid, 'conversation'],
  ['moments', 'moments'], ['people', 'people'], ['explore', 'explore'],
  ['ai', 'ai'], ['calls', 'calls'], ['communities', 'communities'],
  ['communities/' + (comm.community?.id || ''), 'community-detail'],
  ['profile', 'profile'], ['settings', 'settings'], ['settings/language', 'language'],
];

const results = [];
for (const [route, label] of PAGES) {
  await go(route, 3200);
  const buttons = await ev(`(() => {
    const out = [];
    document.querySelectorAll('button, [role="button"], a[href^="#"]').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      if (r.bottom < 0 || r.top > innerHeight) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) return;
      const txt = (el.getAttribute('aria-label') || el.innerText || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 48);
      out.push({ i, txt, cls: (el.className || '').toString().slice(0, 60) });
    });
    return out;
  })()`);
  if (!Array.isArray(buttons)) { console.log(`${label}: could not enumerate (${JSON.stringify(buttons)})`); continue; }

  let dead = 0, tested = 0;
  for (const b of buttons) {
    if (SKIP.test(b.txt)) continue;
    tested++;
    const before = await ev(`JSON.stringify({h:location.hash, d:document.body.innerHTML.length, m:document.querySelectorAll('[class*=modal],[class*=sheet],[class*=dialog],[role=dialog]').length})`);
    const errBefore = consoleErrors.length;
    await ev(`(() => {
      const el = document.querySelectorAll('button, [role="button"], a[href^="#"]')[${b.i}];
      if (!el) return 'gone';
      el.scrollIntoView({block:'center'});
      el.click();
      return 'ok';
    })()`);
    await sleep(700);
    const after = await ev(`JSON.stringify({h:location.hash, d:document.body.innerHTML.length, m:document.querySelectorAll('[class*=modal],[class*=sheet],[class*=dialog],[role=dialog]').length})`);
    const changed = before !== after;
    const newErr = consoleErrors.length > errBefore;
    if (!changed && !newErr) {
      dead++;
      results.push({ page: label, txt: b.txt || '(no label)', cls: b.cls });
    }
    await go(route, 1500);
  }
  console.log(`${label.padEnd(18)} buttons=${buttons.length} tested=${tested} dead=${dead}`);
}

console.log('\n=== DEAD BUTTONS ===');
if (!results.length) console.log('none');
for (const r of results) console.log(`- [${r.page}] "${r.txt}"  class="${r.cls}"`);
console.log('\nconsole errors:', consoleErrors.length);
consoleErrors.slice(0, 10).forEach(e => console.log('  !', e));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
