/* Why does MediaRecorder refuse to start? Try every plausible configuration
   against a real getUserMedia audio stream and report what actually works. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9361;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--use-file-for-fake-audio-capture=/tmp/en.wav',
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=/tmp/cdp-probe-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });

let ver;
for (let i = 0; i < 100 && !ver; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { }
  if (!ver) await sleep(200);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl, { maxPayload: 1 << 26 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const tgt = await send('Target.createTarget', { url: 'about:blank' });
const att = await send('Target.attachToTarget', { targetId: tgt.targetId, flatten: true });
const sid = att.sessionId;
const bsend = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: mid, sessionId: sid, method, params }));
});
await bsend('Page.enable'); await bsend('Runtime.enable');
await bsend('Page.navigate', { url: 'http://localhost:4500/?splash=0' });
await sleep(2500);

const out = await bsend('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    const results = [];
    const tryOne = async (label, constraints, opts) => {
      try {
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        const tracks = s.getAudioTracks().map(t => ({ kind: t.kind, state: t.readyState, enabled: t.enabled, muted: t.muted }));
        try {
          const r = opts ? new MediaRecorder(s, opts) : new MediaRecorder(s);
          const started = await new Promise((res) => {
            r.onstart = () => res('started');
            r.onerror = (e) => res('error:' + (e.error?.name || e.error?.message || 'unknown'));
            try { r.start(); } catch (e) { res('throw:' + e.message); return; }
            setTimeout(() => res('timeout state=' + r.state), 1500);
          });
          try { r.stop(); } catch {}
          results.push({ label, tracks, started, mime: r.mimeType });
        } catch (e) {
          results.push({ label, tracks, started: 'ctor-throw:' + e.message });
        }
        s.getTracks().forEach(t => t.stop());
      } catch (e) {
        results.push({ label, started: 'gum-fail:' + e.name + ':' + e.message });
      }
    };
    // The real-call case: the mic track is already attached to a peer connection.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const pc = new RTCPeerConnection({ iceServers: [] });
      s.getAudioTracks().forEach(t => pc.addTrack(t, s));
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
      let started;
      try {
        const r = new MediaRecorder(s);
        started = await new Promise((res) => {
          r.onstart = () => res('started'); r.onerror = (e) => res('error:' + (e.error?.name || 'unknown'));
          try { r.start(); } catch (e) { res('throw:' + e.message); return; }
          setTimeout(() => res('timeout state=' + r.state), 1500);
        });
        try { r.stop(); } catch {}
      } catch (e) { started = 'ctor-throw:' + e.message; }
      results.push({ label: 'mic attached to RTCPeerConnection + default', started });
      s.getTracks().forEach(t => t.stop()); pc.close();
    } catch (e) { results.push({ label: 'pc-case', started: 'fail:' + e.message }); }

    await tryOne('audio:true + webm/opus + 32000bps', { audio: true }, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
    await tryOne('audio:true + webm/opus', { audio: true }, { mimeType: 'audio/webm;codecs=opus' });
    await tryOne('audio:true + default', { audio: true }, null);
    await tryOne('audio:{ec,ns,agc} + webm/opus + 32000bps', { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
    await tryOne('audio:{ec,ns,agc} + default', { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }, null);
    return results;
  })()`,
});
console.log(JSON.stringify(out.result?.value, null, 1));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
