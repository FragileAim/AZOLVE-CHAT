/* Boot the LIVE site at phone size and report, second by second, what is on
   screen: splash, auth, onboarding or app. Also captures console errors and
   failed network requests, which is where "it just keeps loading" lives. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://azolve-chat.onrender.com';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/live-prof', PORT = 9351;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, sessionId; const pend = new Map();
const send = (m, p = {}, sid = sessionId) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.value; };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const logs = [], netFail = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (m.method === 'Runtime.exceptionThrown')
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Network.loadingFailed') netFail.push(m.params.errorText);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400)
      netFail.push(m.params.response.status + ' ' + m.params.response.url.slice(0, 120));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' });

  await send('Page.navigate', { url: BASE + '/' });
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const s = await ev(`JSON.stringify({
      t: Math.round(performance.now()),
      splash: !!document.querySelector('.splash, [class*=splash]'),
      auth: !!document.querySelector('.auth, [class*=auth-]'),
      app: !!document.querySelector('.mobile-nav, .ux-screen'),
      navBtns: document.querySelectorAll('.mobile-nav button').length,
      iframe: document.querySelectorAll('iframe').length,
      txt: document.body.innerText.replace(/\\s+/g,' ').slice(0,90)
    })`);
    console.log(i + 1 + 's', s);
    if (JSON.parse(s).navBtns > 0) break;
  }
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync('/workspace/.screenshots/live-boot.png', Buffer.from(r.data, 'base64')));
  console.log('\nconsole:', logs.length ? logs.slice(0, 12) : 'none');
  console.log('network failures:', netFail.length ? netFail.slice(0, 12) : 'none');
})().catch(e => console.error('ERR', e.message)).finally(async () => { await sleep(200); try { ws?.close(); } catch { } chrome.kill('SIGKILL'); });
