/* ============================================================================
   AZOLVE SPEECH — "tap to hear"
   ----------------------------------------------------------------------------
   Real text-to-speech on top of the Web Speech API (speechSynthesis). No API
   keys, no network round-trip: the voice comes from the device.

   Design rules:
   - One utterance at a time, app-wide. Starting a new one stops the old one.
   - Long text is chunked on sentence boundaries; some engines silently cut
     utterances off after ~15 seconds.
   - We never pretend a language is available. `resolveVoice` reports whether
     the match is native, approximate, or missing, and the UI says so.
   ========================================================================== */

const LANG_TAG = {
  en: 'en-US', hi: 'hi-IN', ar: 'ar-SA', gu: 'gu-IN', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', pt: 'pt-BR', ru: 'ru-RU',
  it: 'it-IT', tr: 'tr-TR', id: 'id-ID', bn: 'bn-IN', mr: 'mr-IN', ta: 'ta-IN',
  te: 'te-IN', ur: 'ur-PK', nl: 'nl-NL', pl: 'pl-PL', vi: 'vi-VN', th: 'th-TH',
  he: 'he-IL', fa: 'fa-IR', sw: 'sw-KE',
};

export const speechSupported = () =>
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
  if (speechSupported()) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
  emit({ id: null, lang: null, status: 'idle', error: null });
}

/**
 * Speak text. Calling again with the same id toggles it off.
 * Resolves when playback finishes or is cancelled.
 */
export function speak({ text, lang = 'en', id = 'default', rate = 1, pitch = 1, onDone }) {
  if (!speechSupported()) {
    emit({ id, lang, status: 'unsupported', quality: 'none', error: 'This browser has no speech engine.' });
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  // toggle: tapping the thing that is already playing stops it
  if (state.id === id && (state.status === 'speaking' || state.status === 'loading')) {
    stopSpeech();
    return Promise.resolve({ ok: true, reason: 'stopped' });
  }

  const chunks = splitChunks(text);
  if (!chunks.length) return Promise.resolve({ ok: false, reason: 'empty' });

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
