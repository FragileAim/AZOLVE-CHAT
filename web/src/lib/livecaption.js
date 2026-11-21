/* ============================================================================
   AZOLVE LIVE CAPTIONS — speech in, translated text out, during a call.
   ----------------------------------------------------------------------------
   Two real engines, picked at runtime:

   1. On-device recognition (Web Speech API). Zero latency, no upload, but only
      available where the browser ships it (Chrome, Edge, Safari 14.1+).

   2. Server transcription. The mic stream is sliced every few seconds, decoded
      to 16 kHz mono WAV in the page, and posted to /api/calls/live/listen where
      Gemini (or Whisper) transcribes and translates it. This is the path that
      works inside the Android/iOS app shells, where the Web Speech API is
      missing.

   Either way the caller gets `onSegment({ source, translated, srcLang, lang })`
   and can render/speak it. Nothing here invents a transcript: if no engine is
   available the status says so.
   ========================================================================== */
import { api } from './api.js';

const LANG_TAG = {
  en: 'en-US', hi: 'hi-IN', ar: 'ar-SA', gu: 'gu-IN', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', pt: 'pt-BR', ru: 'ru-RU',
  it: 'it-IT', tr: 'tr-TR', id: 'id-ID', bn: 'bn-IN', mr: 'mr-IN', ta: 'ta-IN',
  te: 'te-IN', ur: 'ur-PK', nl: 'nl-NL', pl: 'pl-PL', vi: 'vi-VN', th: 'th-TH',
  he: 'he-IL', fa: 'fa-IR', sw: 'sw-KE',
};

export const tagFor = lang => LANG_TAG[lang] || lang || 'en-US';

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
      // 'no-speech' / 'aborted' are routine in a call; only surface real faults.
      if (!['no-speech', 'aborted', 'interrupted'].includes(e.error)) {
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
  let queue = Promise.resolve();
  let inFlight = 0;

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
      const wav = await toWav16k(blob);
      if (wav.size < 3000) return; // ~0.1s of audio: nothing to transcribe
      const fd = new FormData();
      fd.append('audio', wav, 'slice.wav');
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
      } else if (out && !out.ok && out.reason && out.reason !== 'empty-audio') {
        onStatus?.({ state: 'error', engine: 'server', error: out.reason, detail: out.detail });
      }
    } catch (e) {
      onStatus?.({ state: 'error', engine: 'server', error: String(e?.message || e) });
    } finally {
      inFlight--;
    }
  };

  const startSlice = () => {
    if (stopped || paused) return;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    } catch {
      onStatus?.({ state: 'error', engine: 'server', error: 'recorder-unavailable' });
      return;
    }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      if (chunks.length) {
        const blob = new Blob(chunks, { type: mime || 'audio/webm' });
        queue = queue.then(() => send(blob)).catch(() => {});
      }
      startSlice();
    };
    try {
      recorder.start();
      onStatus?.({ state: 'listening', engine: 'server' });
      // a 3.2s slice keeps captions close to real time without flooding the API
      setTimeout(() => { try { recorder?.state === 'recording' && recorder.stop(); } catch { /* already stopped */ } }, 3200);
    } catch (e) {
      onStatus?.({ state: 'error', engine: 'server', error: String(e?.message || e) });
    }
  };

  startSlice();

  return {
    kind: 'server',
    pause() {
      paused = true;
      try { if (recorder?.state === 'recording') recorder.stop(); } catch { /* already stopped */ }
    },
    resume() { if (!stopped) { paused = false; startSlice(); } },
    stop() {
      stopped = true;
      try { if (recorder?.state === 'recording') recorder.stop(); } catch { /* already stopped */ }
      recorder = null;
    },
  };
}

/**
 * Start live captions.
 * @param {object} o
 * @param {MediaStream} [o.stream]  mic stream (needed for the server engine)
 * @param {string} o.lang           speaker's own language
 * @param {string} o.targetLang     listener's language
 * @param {function} o.onSegment    ({source, translated, final, engine})
 * @param {function} [o.onStatus]   ({state, engine, error})
 * @param {boolean} [o.preferServer] skip device recognition even if present
 */
export function startLiveCaption({ stream, lang = 'en', targetLang = 'en', onSegment, onStatus, preferServer = false }) {
  const canDevice = deviceRecognitionSupported() && !preferServer;
  const canServer = !!stream && recorderSupported();

  if (canDevice) return deviceEngine({ lang, onSegment, onStatus });
  if (canServer) return serverEngine({ stream, lang, targetLang, onSegment, onStatus });
  onStatus?.({ state: 'unsupported', engine: 'none' });
  return { kind: 'none', pause() {}, resume() {}, stop() {} };
}

/** Translate a transcript that the device already recognised. */
export async function translateSegment(text, from, to) {
  return api('/calls/live/translate', { method: 'POST', body: { text, from, to } });
}
