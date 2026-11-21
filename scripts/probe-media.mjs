/* Quick capability probe: can this headless build open a microphone and see
   audio energy? Used to decide whether a full two-browser call test is possible
   in this sandbox. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = process.env.CHROME || '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9351;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=/tmp/cdp-probe', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const p = (await r.json()).find(t => t.type === 'page');
      if (p) return p;
    } catch { }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4500/' });
await sleep(1500);

const r = await send('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(s);
      const an = ac.createAnalyser(); an.fftSize = 512;
      src.connect(an);
      await new Promise(r => setTimeout(r, 800));
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
      return { ok: true, tracks: s.getAudioTracks().length, peak, state: ac.state };
    } catch (e) { return { ok: false, error: String(e) }; }
  })()`,
});
console.log(JSON.stringify(r.result?.result?.value || r, null, 2));
chrome.kill();
process.exit(0);
