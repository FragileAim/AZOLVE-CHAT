/* ============================================================================
   AZOLVE SPEECH — "tap to hear"
   ----------------------------------------------------------------------------
   Two real engines, picked at runtime:

   1. The native bridge (`window.AzolveTts`). Inside the Android app the WebView
      exposes speechSynthesis but almost never has a voice list bound to it, so
      every tap failed with "this browser has no speech engine" even though the
      phone can obviously talk. The bridge hands the text to Android's own
      TextToSpeech engine, which is the engine that actually exists there.

   2. The Web Speech API (speechSynthesis) in a real browser. No API keys, no
      network round-trip: the voice comes from the device.

   Design rules:
   - One utterance at a time, app-wide. Starting a new one stops the old one.
   - Long text is chunked on sentence boundaries; some engines silently cut
     utterances off after ~15 seconds.
   - We never pretend a language is available. `resolveVoice` reports whether
     the match is native, approximate, or missing, and the UI says so.
   ========================================================================== */
import { isNativeShell } from './shell.js';

/* The native bridge is injected before the page loads, but the TTS engine
   initialises asynchronously, so `ready` can flip a moment after boot. */
const nativeTts = () => {
  if (typeof window === 'undefined') return null;
  const b = window.AzolveTts;
  if (!b) return null;
  try { return typeof b.speak === 'function' ? b : null; } catch { return null; }
};

export const nativeTtsAvailable = () => {
  const b = nativeTts();
  if (!b) return false;
  try { return b.isReady() === true; } catch { return false; }
};

/* The Android engine initialises asynchronously and can take a moment on a cold
   start. Poll briefly so the button flips to "ready" instead of staying dead. */
export const whenNativeReady = (timeout = 3000) => new Promise(resolve => {
  const b = nativeTts();
  if (!b) return resolve(false);
  const started = Date.now();
  const tick = () => {
    let ok = false;
    try { ok = b.isReady() === true; } catch { ok = false; }
    if (ok) return resolve(true);
    if (Date.now() - started >= timeout) return resolve(false);
    setTimeout(tick, 150);
  };
  tick();
});

const LANG_TAG = {
  en: 'en-US', hi: 'hi-IN', ar: 'ar-SA', gu: 'gu-IN', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', pt: 'pt-BR', ru: 'ru-RU',
  it: 'it-IT', tr: 'tr-TR', id: 'id-ID', bn: 'bn-IN', mr: 'mr-IN', ta: 'ta-IN',
  te: 'te-IN', ur: 'ur-PK', nl: 'nl-NL', pl: 'pl-PL', vi: 'vi-VN', th: 'th-TH',
  he: 'he-IL', fa: 'fa-IR', sw: 'sw-KE',
};

/* "Can this device speak at all?" — true for either engine, so the UI never
   hides the button on a phone that has a perfectly good TTS engine. */
export const speechSupported = () => {
  if (typeof window === 'undefined') return false;
  if (nativeTts()) return true;
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
};

/* True when the *web* engine is what will be used. The UI uses this to explain
   why a language may be missing. */
export const webSpeechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/* ------------------------------- voices ---------------------------------- */
let voices = [];
let voicesLoaded = false;
const voiceWaiters = new Set();

function readVoices() {
  if (!speechSupported()) return [];
  try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
  if (voices.length && !voicesLoaded) {
    voicesLoaded = true;
    voiceWaiters.forEach(fn => { try { fn(voices); } catch {} });
    voiceWaiters.clear();
  }
  return voices;
}

if (speechSupported()) {
  readVoices();
  // Chrome populates the list asynchronously.
  try { window.speechSynthesis.addEventListener('voiceschanged', readVoices); } catch {}
}

export function whenVoicesReady(timeout = 1500) {
  return new Promise(resolve => {
    if (!speechSupported()) return resolve([]);
    const v = readVoices();
    if (v.length) return resolve(v);
    let done = false;
    const finish = (list) => { if (!done) { done = true; resolve(list); } };
    voiceWaiters.add(finish);
    setTimeout(() => finish(readVoices()), timeout);
  });
}

export function allVoices() { return readVoices(); }

/**
 * Pick the best voice for a language code.
 * Returns { voice, tag, quality: 'native' | 'approximate' | 'none' }
 */
export function resolveVoice(lang) {
  const tag = LANG_TAG[lang] || lang || 'en-US';
  const base = tag.split('-')[0].toLowerCase();
  const list = readVoices();
  if (!list.length) return { voice: null, tag, quality: 'none' };

  const norm = s => (s || '').toLowerCase().replace('_', '-');
  const exact = list.find(v => norm(v.lang) === tag.toLowerCase());
  if (exact) return { voice: exact, tag, quality: 'native' };

  const sameBase = list.filter(v => norm(v.lang).split('-')[0] === base);
  if (sameBase.length) return { voice: sameBase[0], tag, quality: 'native' };

  // English is the most common fallback voice; label it as approximate.
  const en = list.find(v => norm(v.lang).startsWith('en'));
  if (en) return { voice: en, tag, quality: 'approximate' };
  return { voice: list[0], tag, quality: 'approximate' };
}

/* ------------------------------ playback --------------------------------- */
const listeners = new Set();
let state = { id: null, lang: null, status: 'idle', quality: null, error: null };

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach(fn => { try { fn(state); } catch {} });
}

export function subscribeSpeech(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function speechState() { return state; }

let queue = [];
let playing = false;

function splitChunks(text, max = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const parts = clean.split(/(?<=[.!?。！？؛;:])\s+/);
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + ' ' + p).trim().length > max && buf) { out.push(buf.trim()); buf = p; }
    else buf = (buf + ' ' + p).trim();
  }
  if (buf) out.push(buf.trim());
  // hard-split anything still too long
  return out.flatMap(c => {
    if (c.length <= max) return [c];
    const slices = [];
    for (let i = 0; i < c.length; i += max) slices.push(c.slice(i, i + max));
    return slices;
  });
}

export function stopSpeech() {
  queue = [];
  playing = false;
  nativeToken += 1;          // invalidates any in-flight native utterance
  nativeFinish = null;
  const bridge = nativeTts();
  if (bridge) { try { bridge.stop(); } catch { /* already stopped */ } }
  if (webSpeechSupported()) {
    try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
  }
  emit({ id: null, lang: null, status: 'idle', error: null });
}

/* --------------------------- native engine ------------------------------- */
/* Android's TextToSpeech speaks one utterance at a time and reports completion
   back through `window.__azolveTtsDone(id, ok)`. We feed the chunks one after
   another so long messages are not truncated, and we keep a single global
   resolver so a new tap can cancel the previous one cleanly. */
let nativeFinish = null;
let nativeToken = 0;

if (typeof window !== 'undefined') {
  window.__azolveTtsDone = (id, ok) => {
    if (nativeFinish) nativeFinish(id, ok);
  };
}

function speakNative({ bridge, chunks, lang, id, rate, pitch, onDone }) {
  stopSpeech();
  playing = true;
  emit({ id, lang, status: 'speaking', quality: 'native', error: null });

  const myToken = ++nativeToken;

  return new Promise(resolve => {
    let idx = 0;
    let alive = true;

    const finish = (result) => {
      if (!alive) return;
      alive = false;
      nativeFinish = null;
      playing = false;
      if (result.ok) {
        emit({ id: null, lang: null, status: 'idle', error: null });
        onDone?.();
      } else {
        emit({ id: null, lang: null, status: 'error', error: result.error || null });
      }
      resolve(result);
    };

    /* The bridge reports back with the utterance id it was given, so we tag
       each chunk and only advance on a match. */
    nativeFinish = (doneId, ok) => {
      if (!alive || myToken !== nativeToken) return;
      if (doneId !== `${id}#${idx - 1}`) return;
      if (!ok) return finish({ ok: false, error: 'The speech engine stopped.' });
      next();
    };

    const next = () => {
      if (!alive || myToken !== nativeToken) return;
      if (idx >= chunks.length) return finish({ ok: true });
      const part = chunks[idx];
      const uid = `${id}#${idx}`;
      idx += 1;
      let started = '';
      try {
        started = bridge.speak(part, lang, rate, pitch, uid) || '';
      } catch (e) {
        return finish({ ok: false, error: String(e?.message || e) });
      }
      if (!started) {
        let err = '';
        try { err = bridge.error?.() || ''; } catch { /* optional */ }
        return finish({ ok: false, error: err || 'The speech engine could not speak this.' });
      }
    };

    next();
  });
}

/**
 * Speak text. Calling again with the same id toggles it off.
 * Resolves when playback finishes or is cancelled.
 */
export function speak({ text, lang = 'en', id = 'default', rate = 1, pitch = 1, onDone }) {
  if (!speechSupported()) {
    emit({ id, lang, status: 'unsupported', quality: 'none', error: 'This device has no speech engine.' });
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  // toggle: tapping the thing that is already playing stops it
  if (state.id === id && (state.status === 'speaking' || state.status === 'loading')) {
    stopSpeech();
    return Promise.resolve({ ok: true, reason: 'stopped' });
  }

  const chunks = splitChunks(text);
  if (!chunks.length) return Promise.resolve({ ok: false, reason: 'empty' });

  /* Native engine first: inside the app it is the only one that works. */
  const bridge = nativeTts();
  if (bridge) {
    let ready = false;
    try { ready = bridge.isReady() === true; } catch { ready = false; }
    if (ready) return speakNative({ bridge, chunks, lang, id, rate, pitch, onDone });
    /* Engine still warming up. Wait for it rather than silently falling back to
       a web engine that has no voices on this platform. */
    emit({ id, lang, status: 'loading', quality: 'native', error: null });
    return whenNativeReady(2500).then(ok => {
      if (ok) return speakNative({ bridge, chunks, lang, id, rate, pitch, onDone });
      return speakWeb({ chunks, lang, id, rate, pitch, onDone });
    });
  }

  return speakWeb({ chunks, lang, id, rate, pitch, onDone });
}

/* --------------------------- web engine ---------------------------------- */
function speakWeb({ chunks, lang, id, rate, pitch, onDone }) {
  if (!webSpeechSupported()) {
    emit({ id, lang, status: 'unsupported', quality: 'none', error: 'This device has no speech engine.' });
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  const { voice, quality } = resolveVoice(lang);
  if (quality === 'none') {
    emit({ id, lang, status: 'novoice', quality, error: 'No speech voices are installed on this device.' });
    return Promise.resolve({ ok: false, reason: 'novoice' });
  }

  stopSpeech();
  queue = chunks.slice();
  playing = true;
  emit({ id, lang, status: 'speaking', quality, error: null });

  return new Promise(resolve => {
    const next = () => {
      if (!playing || !queue.length) {
        playing = false;
        emit({ id: null, lang: null, status: 'idle', error: null });
        onDone?.();
        resolve({ ok: true });
        return;
      }
      const part = queue.shift();
      let u;
      try {
        u = new SpeechSynthesisUtterance(part);
        // Always ask for the target language so the engine can pick a matching
        // voice. Only pin an explicit voice when it is a true native match —
        // forcing an English voice onto Hindi text just mispronounces it.
        u.lang = LANG_TAG[lang] || voice?.lang || 'en-US';
        // A voice object can go stale when the device's voice list changes.
        if (voice && quality === 'native') { try { u.voice = voice; } catch { /* fall back to u.lang */ } }
        u.rate = rate;
        u.pitch = pitch;
        u.volume = 1;
      } catch (err) {
        playing = false;
        emit({ id: null, lang: null, status: 'error', error: String(err?.message || err) });
        resolve({ ok: false, reason: 'utterance' });
        return;
      }
      u.onend = next;
      u.onerror = (e) => {
        // 'interrupted' / 'canceled' happen when we stop deliberately
        if (e?.error && !['interrupted', 'canceled'].includes(e.error)) {
          playing = false;
          emit({ id: null, lang: null, status: 'error', error: e.error });
          resolve({ ok: false, reason: e.error });
        } else {
          next();
        }
      };
      try { window.speechSynthesis.speak(u); }
      catch (err) {
        playing = false;
        emit({ id: null, lang: null, status: 'error', error: String(err?.message || err) });
        resolve({ ok: false, reason: 'exception' });
      }
    };
    next();
  });
}

/* ------------------------------ React hook -------------------------------- */
import { useEffect, useState, useCallback } from 'react';

export function useSpeech() {
  const [st, setSt] = useState(state);
  useEffect(() => subscribeSpeech(setSt), []);

  const toggle = useCallback((args) => {
    if (state.id === args.id && (state.status === 'speaking' || state.status === 'loading')) {
      stopSpeech();
      return;
    }
    speak(args);
  }, []);

  return {
    ...st,
    supported: speechSupported(),
    toggle,
    stop: stopSpeech,
    isPlaying: (id) => st.id === id && (st.status === 'speaking' || st.status === 'loading'),
  };
}
