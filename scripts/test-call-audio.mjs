/* Request AA, the important one: does a normal (audio-only) call actually carry
   sound in both directions?

   Two real pages, two real accounts, two real Socket.IO connections, a real
   RTCPeerConnection between them, and Chromium's fake microphone (a tone) as the
   source. After the call connects we read the audio energy arriving at each
   page's remote sink. If the old bug is back, peak is 0 and this fails.

   The two pages use different hostnames (localhost vs 127.0.0.1) so they get
   separate localStorage and can be signed in as different people at once. */

import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = process.env.CHROME || '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9361;
const HOST_A = 'http://localhost:4500';
const HOST_B = 'http://127.0.0.1:4500';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
const ok = (n, extra = '') => { pass++; console.log(`  PASS  ${n}${extra ? '  ' + extra : ''}`); };
const bad = (n, d) => { fail++; failures.push(`${n}: ${d}`); console.log(`  FAIL  ${n}  ->  ${d}`); };
const check = (n, c, d = '') => (c ? ok(n, d) : bad(n, d || 'false'));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--user-data-dir=/tmp/cdp-call', 'about:blank',
], { stdio: 'ignore' });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

/* One CDP connection per page, each with its own id space. */
async function openPage(url) {
  const bws = new WebSocket(await browserWs(), { maxPayload: 128 * 1024 * 1024 });
  await new Promise(r => bws.on('open', r));
  let bid = 0; const bwait = new Map();
  bws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && bwait.has(m.id)) { bwait.get(m.id)(m); bwait.delete(m.id); }
  });
  const bsend = (method, params = {}, sessionId) => new Promise((res) => {
    const i = ++bid; bwait.set(i, res); bws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const t = await bsend('Target.createTarget', { url: 'about:blank' });
  const targetId = t.result.targetId;
  const at = await bsend('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = at.result.sessionId;

  const send = (method, params = {}) => bsend(method, params, sessionId);
  const logs = [];
  bws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(1200);

  const evalJs = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  return { send, evalJs, targetId, logs };
}

const stamp = Date.now().toString().slice(-7);

async function signup(page, tag) {
  const email = `audio.${tag}.${stamp}@azolve.io`;
  return page.evalJs(`(async () => {
    const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
    const s = await post('/api/auth/email/start', { email: ${JSON.stringify(email)}, displayName: ${JSON.stringify('Audio ' + tag)} });
    if (!s.deliveryCode) return { error: 'no code', s };
    const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
    if (!v.token) return { error: 'no token', v };
    localStorage.setItem('azolve.token', v.token);
    localStorage.setItem('azolve.refresh', v.refreshToken);
    /* Clear the onboarding gate (it keys off country + bio) so the app boots
       straight into the product instead of the profile wizard. */
    await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token },
      body: JSON.stringify({ username: ${JSON.stringify('aud_' + tag + '_')} + ${JSON.stringify(stamp)}, country: 'IN', bio: 'audio test' }),
    });
    return { id: v.user.id, name: v.user.displayName, token: v.token };
  })()`);
}

const A = await openPage(HOST_A);
const B = await openPage(HOST_B);

const ua = await signup(A, 'A');
const ub = await signup(B, 'B');
if (ua.error || ub.error) { console.log('signup failed', ua, ub); process.exit(2); }
ok('two accounts created', `${ua.name} / ${ub.name}`);

/* Contacts + a conversation, because calling is contact-only and the call
   picker lists people you already have a chat with. */
const setup = await A.evalJs(`(async () => {
  const h = { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('azolve.token') };
  const post = (p, b) => fetch(p, { method: 'POST', headers: h, body: JSON.stringify(b) }).then(r => r.json());
  const rq = await post('/api/contacts/request', { userId: ${JSON.stringify(ub.id)} });
  return { requestId: rq.requestId };
})()`);
await B.evalJs(`(async () => {
  const h = { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('azolve.token') };
  await fetch('/api/contacts/respond', { method: 'POST', headers: h, body: JSON.stringify({ requestId: ${JSON.stringify(setup.requestId)}, action: 'accept' }) });
})()`);
const dm = await A.evalJs(`(async () => {
  const h = { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('azolve.token') };
  const r = await fetch('/api/chats/dm', { method: 'POST', headers: h, body: JSON.stringify({ userId: ${JSON.stringify(ub.id)} }) }).then(x => x.json());
  return r.conversation?.id || r.id;
})()`);
check('contacts and conversation ready', !!dm, String(dm));

/* Reload so both apps boot with a real session and open their sockets. */
await A.evalJs('location.reload()', false);
await B.evalJs('location.reload()', false);
await sleep(2500);

const socketState = await A.evalJs(`!!localStorage.getItem('azolve.token')`);
check('page A booted with a stored session', socketState === true);

/* A opens the Calls page and starts an AUDIO call through the real UI. */
await A.evalJs(`location.hash = '#/calls'`, false);
await sleep(1200);
console.log('DEBUG hash:', await A.evalJs('location.hash'));
console.log('DEBUG text:', (await A.evalJs('document.body.innerText')).slice(0, 400));
const started = await A.evalJs(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /Audio call/i.test(b.textContent));
  if (!btn) return { error: 'no audio button' };
  btn.click();
  await new Promise(r => setTimeout(r, 900));
  const contact = document.querySelector('.cv-contact');
  if (!contact) return { error: 'no contact in picker' };
  contact.click();
  return { ok: true };
})()`);
check('audio call started from the Calls page', started.ok === true, JSON.stringify(started));

/* B should be ringing. Accept from the real incoming screen. */
let accepted = { ok: false };
for (let i = 0; i < 20; i++) {
  accepted = await B.evalJs(`(async () => {
    const b = document.querySelector('.cv-big.accept');
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  })()`);
  if (accepted.ok) break;
  await sleep(400);
}
check('callee saw the incoming call and accepted', accepted.ok === true);

/* Give ICE + media a moment, then measure what is actually arriving. */
await sleep(4000);

const measure = `(async () => {
  const el = document.querySelector('audio.cv-remote-audio');
  if (!el) return { found: false };
  const s = el.srcObject;
  if (!s) return { found: true, stream: false };
  const tracks = s.getAudioTracks();
  if (!tracks.length) return { found: true, stream: true, tracks: 0 };
  const ac = new AudioContext();
  await ac.resume().catch(() => {});
  const src = ac.createMediaStreamSource(s);
  const an = ac.createAnalyser(); an.fftSize = 1024;
  src.connect(an);
  await new Promise(r => setTimeout(r, 1000));
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
  return { found: true, stream: true, tracks: tracks.length, peak,
           muted: tracks[0].muted, state: tracks[0].readyState, paused: el.paused };
})()`;

console.log('--- page A console ---'); A.logs.slice(-25).forEach(l => console.log('   ', l.slice(0, 200)));
console.log('--- page B console ---'); B.logs.slice(-25).forEach(l => console.log('   ', l.slice(0, 200)));
const ra = await A.evalJs(measure);
const rb = await B.evalJs(measure);

check('caller has an always-mounted remote audio sink', ra.found === true, JSON.stringify(ra).slice(0, 120));
check('caller remote stream has an audio track', ra.tracks > 0, `tracks=${ra.tracks}`);
/* Chromium's fake microphone is a very quiet tone (peak ~3e-4 on the source
   side), so the bar is "clearly non-zero audio arrived", not "loud". A silent
   or unattached stream reads exactly 0. */
check('caller actually hears the other person', ra.peak > 0.00002, `peak=${ra.peak}`);
check('caller audio element is playing, not paused', ra.paused === false, `paused=${ra.paused}`);

check('callee has an always-mounted remote audio sink', rb.found === true, JSON.stringify(rb).slice(0, 120));
check('callee remote stream has an audio track', rb.tracks > 0, `tracks=${rb.tracks}`);
check('callee actually hears the other person', rb.peak > 0.00002, `peak=${rb.peak}`);
check('callee audio element is playing, not paused', rb.paused === false, `paused=${rb.paused}`);

/* Who ended it: A hangs up, B must be told it was A and how long it ran. */
const ended = await A.evalJs(`(async () => {
  const b = [...document.querySelectorAll('button')].find(x => x.classList.contains('cv-end') || /end call|hang up/i.test(x.getAttribute('aria-label') || ''));
  if (!b) return { error: 'no hangup button', cls: [...document.querySelectorAll('button')].map(x=>x.className).slice(0,40) };
  b.click();
  return { ok: true };
})()`);
check('caller can hang up', ended.ok === true, JSON.stringify(ended).slice(0, 160));
await sleep(1500);
const endedText = await B.evalJs(`document.querySelector('.cv-ended-status')?.textContent || ''`);
check('callee is told who ended the call', /ended the call/i.test(endedText), endedText);

chrome.kill();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) failures.forEach(f => console.log('  - ' + f));
process.exit(fail ? 1 : 0);
