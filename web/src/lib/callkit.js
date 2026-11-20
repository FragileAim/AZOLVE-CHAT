/* ---------------------------------------------------------------------------
   AZOLVE call kit
   Small, dependency-free helpers shared by the call UI: a WebAudio ringtone,
   a microphone level meter and a voice-activity analyser for the audio stage.
--------------------------------------------------------------------------- */

export function fmtDur(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/* ------------------------------- ringtone -------------------------------- */
let ctx = null;
function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, gain = 0.05, type = 'sine') {
  const c = audioCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.05);
}

/** Looping ring tone. `mode` = 'in' (incoming, brighter) | 'out' (dial tone). */
export function startRing(mode = 'in') {
  stopRing();
  const pattern = mode === 'in'
    ? [[0, 0.34, 0.055], [0.42, 0.34, 0.055], [0.84, 0.5, 0.05]]
    : [[0, 0.5, 0.03]];
  const loop = () => {
    pattern.forEach(([t, d, g]) => tone(mode === 'in' ? 784 : 440, t, d, g, mode === 'in' ? 'sine' : 'triangle'));
    if (mode === 'in') pattern.forEach(([t, d, g]) => tone(523, t, d, g * 0.7, 'sine'));
  };
  loop();
  const id = setInterval(loop, mode === 'in' ? 2600 : 3200);
  ringId = id;
}

let ringId = null;
export function stopRing() {
  if (ringId) { clearInterval(ringId); ringId = null; }
}

/** Short confirmation blip (call connected / ended). */
export function blip(kind = 'connect') {
  if (kind === 'connect') { tone(660, 0, 0.12, 0.045); tone(880, 0.1, 0.16, 0.045); }
  else { tone(440, 0, 0.14, 0.04); tone(300, 0.12, 0.22, 0.04); }
}

/* ------------------------------ mic meter -------------------------------- */
/**
 * Attaches an analyser to a MediaStream and reports a 0..1 level through
 * `onLevel`. Returns a disposer.
 */
export function meterStream(stream, onLevel, { bins = 1 } = {}) {
  const c = audioCtx();
  if (!c || !stream || !stream.getAudioTracks().length) {
    onLevel(0);
    return () => {};
  }
  const src = c.createMediaStreamSource(stream);
  const an = c.createAnalyser();
  an.fftSize = 512;
  an.smoothingTimeConstant = 0.75;
  src.connect(an);
  const data = new Uint8Array(an.frequencyBinCount);
  let raf;
  const loop = () => {
    an.getByteFrequencyData(data);
    if (bins > 1) {
      const out = [];
      const step = Math.floor(data.length / bins);
      for (let i = 0; i < bins; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j];
        out.push(Math.min(1, (sum / step) / 150));
      }
      onLevel(out);
    } else {
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      onLevel(Math.min(1, (sum / data.length) / 120));
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    try { src.disconnect(); an.disconnect(); } catch {}
  };
}

/* --------------------------- device enumeration -------------------------- */
export async function listDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return {
      cams: devs.filter(d => d.kind === 'videoinput'),
      mics: devs.filter(d => d.kind === 'audioinput'),
      speakers: devs.filter(d => d.kind === 'audiooutput'),
    };
  } catch {
    return { cams: [], mics: [], speakers: [] };
  }
}

export function stopStream(stream) {
  stream?.getTracks?.().forEach(t => { try { t.stop(); } catch {} });
}
