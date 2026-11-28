/* ============================================================================
   AZOLVE LIVE CAPTIONS — speech in, translated text out, during a call.
   ----------------------------------------------------------------------------
   Two real engines, and the choice is made at runtime *and re-made if it fails*:

   1. On-device recognition (Web Speech API). Zero latency, no upload — but it
      is only genuinely usable where a speech service exists. Chrome on desktop
      has one; Android WebView, in-app browsers and many mobile builds expose
      the constructor and then fail silently with `network` / `not-allowed`, or
      never fire a single result. Choosing it and hoping is what made captions
      look broken.

   2. Server transcription. The mic stream is sliced every couple of seconds,
      decoded to 16 kHz mono WAV in the page, and posted to
      /api/calls/live/listen where Gemini (or Whisper) transcribes it and the
      translation chain renders it in the listener's language. This is the path
      that works inside the Android/iOS app shells.

   So the engine is now a supervisor: it starts on-device, and if that engine
   errors *or stays silent for a few seconds while the mic is open*, it tears it
   down and switches to the server engine mid-call without dropping the call.
   `onStatus` always reports which engine is actually carrying the captions, so
   the UI never claims to be listening when it is not.

   Nothing here invents a transcript: if neither engine works the status says
   `unsupported`, and the caption bar stays empty.
   ========================================================================== */
import { api } from './api.js';
import { isNativeShell } from './shell.js';

const LANG_TAG = {
  en: 'en-US', hi: 'hi-IN', ar: 'ar-SA', gu: 'gu-IN', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', pt: 'pt-BR', ru: 'ru-RU',
  it: 'it-IT', tr: 'tr-TR', id: 'id-ID', bn: 'bn-IN', mr: 'mr-IN', ta: 'ta-IN',
  te: 'te-IN', ur: 'ur-PK', nl: 'nl-NL', pl: 'pl-PL', vi: 'vi-VN', th: 'th-TH',
  he: 'he-IL', fa: 'fa-IR', sw: 'sw-KE',
};

export const tagFor = lang => LANG_TAG[lang] || lang || 'en-US';

const log = (...a) => { try { console.debug('[live-caption]', ...a); } catch { /* no console */ } };

const Recognition = () =>
  (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;

export const deviceRecognitionSupported = () => !!Recognition();
export const recorderSupported = () =>
  typeof window !== 'undefined' && !!(window.MediaRecorder && (window.AudioContext || window.webkitAudioContext));

/* --------------------------- WAV encoding -------------------------------- */
function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);   // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits per sample
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decode whatever MediaRecorder produced and re-encode as 16 kHz mono WAV. */
async function toWav16k(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const src = decoded.getChannelData(0);
    const targetRate = 16000;
    const ratio = decoded.sampleRate / targetRate;
    const len = Math.max(1, Math.floor(src.length / ratio));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = src[Math.floor(i * ratio)] || 0;
    return encodeWav(out, targetRate);
  } finally {
    try { ctx.close(); } catch { /* already closed */ }
  }
}

/** Extension for a recorded blob, so the server and Gemini see the real type. */
function extFor(type = '') {
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  if (type.includes('mpeg')) return 'mp3';
  return 'wav';
}

/* --------------------------- engine 1: device ----------------------------- */
function deviceEngine({ lang, onSegment, onStatus }) {
  const Rec = Recognition();
  let rec = null;
  let stopped = false;
  let restartTimer = null;
  let paused = false;

  const build = () => {
    const r = new Rec();
    r.lang = tagFor(lang);
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => onStatus?.({ state: 'listening', engine: 'device' });

    r.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = (res[0]?.transcript || '').trim();
        if (!text) continue;
        onSegment?.({ source: text, final: res.isFinal, engine: 'device' });
      }
    };

    r.onerror = (e) => {
      /* 'no-speech' / 'aborted' are routine in a call. Everything else — and
         especially 'network' and 'not-allowed', which is what a WebView without
         a speech service returns — means this engine cannot carry the call. */
      if (!['no-speech', 'aborted', 'interrupted'].includes(e.error)) {
        log('device engine failed:', e.error);
        onStatus?.({ state: 'error', engine: 'device', error: e.error });
      }
    };

    r.onend = () => {
      if (stopped || paused) return;
      // Chrome ends the stream on silence; keep listening for the whole call.
      restartTimer = setTimeout(() => {
        if (stopped || paused) return;
        try { r.start(); } catch { /* already starting */ }
      }, 350);
    };
    return r;
  };

  try {
    rec = build();
    rec.start();
  } catch (e) {
    onStatus?.({ state: 'error', engine: 'device', error: String(e?.message || e) });
  }

  return {
    kind: 'device',
    pause() { paused = true; try { rec?.stop(); } catch { /* not running */ } },
    resume() {
      if (stopped) return;
      paused = false;
      clearTimeout(restartTimer);
      try { rec = build(); rec.start(); } catch { /* engine refuses; stays paused */ }
    },
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      try { rec?.stop(); } catch { /* not running */ }
      rec = null;
    },
  };
}

/* --------------------------- engine 2: server ----------------------------- */
function serverEngine({ stream, lang, targetLang, onSegment, onStatus }) {
  let stopped = false;
  let paused = false;
  let recorder = null;
  let recStream = stream;
  let micFallback = null;
  let queue = Promise.resolve();
  let inFlight = 0;
  let sliceTimer = null;

  const mime = (() => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of candidates) {
      try { if (window.MediaRecorder.isTypeSupported?.(m)) return m; } catch { /* keep trying */ }
    }
    return '';
  })();

  const send = async (blob) => {
    if (inFlight > 2) return; // never let a slow provider build a backlog
    inFlight++;
    try {
      /* Decoding is the fragile step on mobile WebViews. If it fails we still
         upload the original recording — the server accepts any audio type and
         Gemini reads webm/opus directly, so a decode failure must not silently
         eat the sentence. */
      let file;
      try {
        file = await toWav16k(blob);
        if (file.size < 3000) return; // ~0.1s of audio: nothing to transcribe
      } catch (e) {
        log('wav decode failed, uploading raw slice', e?.message || e);
        file = blob;
        if (!file.size) return;
      }
      const fd = new FormData();
      fd.append('audio', file, `slice.${extFor(file.type || blob.type)}`);
      fd.append('targetLang', targetLang);
      fd.append('sourceLang', lang);
      const out = await api('/calls/live/listen', { method: 'POST', body: fd });
      if (out?.ok && (out.source || out.translated)) {
        onSegment?.({
          source: out.source || '',
          translated: out.translated || out.source || '',
          srcLang: out.srcLang || lang,
          final: true,
          engine: out.engine,
        });
      } else if (out && !out.ok && out.reason && out.reason !== 'empty-audio' && out.reason !== 'no-speech') {
        onStatus?.({ state: 'error', engine: 'server', error: out.reason, detail: out.detail });
      }
    } catch (e) {
      onStatus?.({ state: 'error', engine: 'server', error: String(e?.message || e) });
    } finally {
      inFlight--;
    }
  };

  /* The call's mic stream is not always recordable as-is: a track can be
     ended (device switch, retry after a failed getUserMedia, a previous
     teardown) and MediaRecorder.start() then throws "There was an error
     starting the MediaRecorder." with no other detail. So: keep only live
     tracks, fall back to a freshly acquired mic, and try progressively
     simpler recorder options before giving up. */
  const liveAudio = (s) => (s?.getAudioTracks?.() || []).filter(t => t.readyState === 'live');

  const tryStart = (s, opts) => {
    let r;
    try { r = opts ? new MediaRecorder(s, opts) : new MediaRecorder(s); }
    catch (e) { return { err: 'ctor:' + (e?.message || e) }; }
    try { r.start(); return { rec: r }; }
    catch (e) { try { r.stop(); } catch { /* never started */ } return { err: 'start:' + (e?.message || e) }; }
  };

  const openRecorder = async () => {
    const attempts = [];
    let s = recStream;
    let tracks = liveAudio(s);
    if (!tracks.length) {
      log('call stream has no live audio track — re-acquiring the microphone');
      try {
        micFallback = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        s = micFallback;
        tracks = liveAudio(s);
      } catch (e) { attempts.push('getUserMedia:' + (e?.name || e?.message || e)); }
    }
    if (tracks.length) {
      if (tracks.length !== (s.getAudioTracks?.() || []).length) s = new MediaStream(tracks);
      const optsList = [
        mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 },
        mime ? { mimeType: mime } : null,
        null,
      ];
      for (const opts of optsList) {
        const r = tryStart(s, opts);
        if (r.rec) { log('recorder started', opts ? JSON.stringify(opts) : 'defaults', 'liveTracks=' + tracks.length); return r.rec; }
        attempts.push(r.err);
      }
    }
    log('could not start MediaRecorder:', attempts.join(' | ') || 'no audio track');
    onStatus?.({ state: 'error', engine: 'server', error: attempts.join(' | ') || 'no-audio-track' });
    return null;
  };

  const startSlice = async () => {
    if (stopped || paused) return;
    const rec = await openRecorder();
    if (!rec || stopped || paused) { try { rec?.stop(); } catch { /* not running */ } return; }
    recorder = rec;
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearTimeout(sliceTimer);
      if (chunks.length) {
        const blob = new Blob(chunks, { type: mime || 'audio/webm' });
        queue = queue.then(() => send(blob)).catch(() => {});
      }
      startSlice();
    };
    onStatus?.({ state: 'listening', engine: 'server' });
    /* 3s slices: short enough that the translation lands while the person is
       still talking, long enough for a whole sentence to be recognised. */
    sliceTimer = setTimeout(() => {
      try { if (recorder?.state === 'recording') recorder.stop(); } catch { /* already stopped */ }
    }, 3000);
  };

  startSlice();

  return {
    kind: 'server',
    pause() {
      paused = true;
      clearTimeout(sliceTimer);
      try { if (recorder?.state === 'recording') recorder.stop(); } catch { /* already stopped */ }
    },
    resume() { if (!stopped) { paused = false; startSlice(); } },
    stop() {
      stopped = true;
      clearTimeout(sliceTimer);
      try { if (recorder?.state === 'recording') recorder.stop(); } catch { /* already stopped */ }
      recorder = null;
      try { micFallback?.getTracks().forEach(t => t.stop()); } catch { /* already gone */ }
      micFallback = null;
    },
  };
}

/**
 * Start live captions, with automatic device → server failover.
 *
 * @param {object} o
 * @param {MediaStream} [o.stream]  mic stream (needed for the server engine)
 * @param {string} o.lang           speaker's own language
 * @param {string} o.targetLang     listener's language
 * @param {function} o.onSegment    ({source, translated, final, engine})
 * @param {function} [o.onStatus]   ({state, engine, error})
 * @param {boolean} [o.preferServer] skip on-device recognition entirely
 * @param {number} [o.silenceMs]    how long on-device may stay silent before failover
 */
export function startLiveCaption({
  stream, lang = 'en', targetLang = 'en', onSegment, onStatus, preferServer = false, silenceMs = 4000,
}) {
  const canServer = !!stream && recorderSupported();
  const canDevice = deviceRecognitionSupported() && !preferServer && !isNativeShell();

  let current = null;
  let stopped = false;
  let paused = false;
  let heard = false;          // did the on-device engine ever produce a word?
  let watchdog = null;

  const clearWatchdog = () => { clearTimeout(watchdog); watchdog = null; };

  const armWatchdog = () => {
    clearWatchdog();
    if (stopped || paused || !canServer || current?.kind === 'server') return;
    watchdog = setTimeout(() => {
      if (stopped || paused || heard) return;
      log('on-device recognition stayed silent — switching to server transcription');
      startServer('device-silent');
    }, silenceMs);
  };

  function startServer(reason) {
    if (stopped || !canServer || current?.kind === 'server') return;
    clearWatchdog();
    try { current?.stop?.(); } catch { /* already gone */ }
    log('server transcription engine starting:', reason);
    current = serverEngine({
      stream, lang, targetLang,
      onSegment: seg => { heard = true; onSegment?.(seg); },
      onStatus: st => onStatus?.({ ...st, reason }),
    });
  }

  if (canDevice) {
    log('on-device recognition available; starting there first');
    current = deviceEngine({
      lang,
      onSegment: seg => { heard = true; clearWatchdog(); onSegment?.(seg); },
      onStatus: st => {
        onStatus?.(st);
        /* A device engine that reports an error is not coming back. Switch. */
        if (st.state === 'error' && canServer) startServer(st.error || 'device-error');
      },
    });
    armWatchdog();
  } else if (canServer) {
    startServer('no-device-engine');
  } else {
    log('no caption engine available');
    onStatus?.({ state: 'unsupported', engine: 'none' });
  }

  return {
    kind: 'auto',
    get engine() { return current?.kind || 'none'; },
    pause() { paused = true; clearWatchdog(); try { current?.pause?.(); } catch { /* noop */ } },
    resume() {
      if (stopped) return;
      paused = false;
      try { current?.resume?.(); } catch { /* noop */ }
      armWatchdog();
    },
    stop() {
      stopped = true;
      clearWatchdog();
      try { current?.stop?.(); } catch { /* noop */ }
      current = null;
    },
  };
}

/** Translate a transcript that the device already recognised. */
export async function translateSegment(text, from, to) {
  return api('/calls/live/translate', { method: 'POST', body: { text, from, to } });
}
