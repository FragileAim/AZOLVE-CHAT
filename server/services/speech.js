/**
 * AZOLVE LIVE SPEECH — real transcription for live call translation.
 * ----------------------------------------------------------------------------
 * The browser records a short slice of the speaker's microphone, decodes it and
 * hands us 16 kHz mono WAV. We transcribe it and translate it in one hop so the
 * other person sees (and can hear) the sentence a beat after it is spoken.
 *
 * Providers, in order:
 *   1. Gemini  — native audio input, transcription + translation in one request.
 *   2. OpenAI  — Whisper transcription, then the normal translate chain.
 * If neither key is configured we say so plainly instead of inventing a
 * transcript. `engine` in the response always names what actually ran.
 */
import { translateText, detectLanguage } from './translate.js';

const TIMEOUT = 20000;

const LANG_NAME = {
  en: 'English', hi: 'Hindi', ar: 'Arabic', gu: 'Gujarati', es: 'Spanish',
  fr: 'French', de: 'German', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  pt: 'Portuguese', ru: 'Russian', it: 'Italian', tr: 'Turkish', id: 'Indonesian',
  bn: 'Bengali', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', ur: 'Urdu',
  nl: 'Dutch', pl: 'Polish', vi: 'Vietnamese', th: 'Thai', he: 'Hebrew',
  fa: 'Persian', sw: 'Swahili',
};

const langName = code => LANG_NAME[code] || code || 'English';

/* Dedicated transcription model first: it returns plain text, is fast (~1.5s
   for a 5s clip) and does not need JSON mode. The flash models are kept as a
   fallback for projects where the transcribe model is not enabled. */
const TRANSCRIBE_MODELS = ['gemini-3.5-transcribe', 'gemini-3-transcribe', 'gemini-2.5-transcribe'];
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
let geminiModel = null;
let transcribeModel = null;

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export const speechEngine = () =>
  process.env.GEMINI_API_KEY ? `gemini:${transcribeModel || TRANSCRIBE_MODELS[0]}`
  : process.env.OPENAI_API_KEY ? `openai:${process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'}`
  : 'none';

/* ------------------------------- Gemini ---------------------------------- */
/* Ask a model for a plain transcript. Used with the dedicated transcription
   model, which rejects JSON mode and simply returns the words. */
async function geminiTranscribe(wavBuffer, mime, model, key) {
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mime || 'audio/wav', data: wavBuffer.toString('base64') } },
        {
          text: 'Transcribe this audio exactly as spoken, in the language being spoken. '
              + 'Return only the transcript with no commentary, labels or translation. '
              + 'If there is no intelligible speech, return an empty string.',
        },
      ],
    }],
    generationConfig: { temperature: 0 },
  };
  const r = await timedFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `gemini HTTP ${r.status}`);
  const part = data?.candidates?.[0]?.content?.parts?.find(p => p?.audioTranscription?.text || p?.text);
  const text = (part?.audioTranscription?.text || part?.text || '').trim();
  if (!text) throw new Error('gemini: empty transcript');
  return text;
}

/* Fallback: a flash model that both transcribes and translates in one request. */
async function geminiListen(wavBuffer, mime, targetLang, sourceHint) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no gemini key');

  const prompt = [
    'You are a real-time interpreter on a live voice/video call.',
    'Transcribe the speech in this audio clip exactly, in the language actually spoken.',
    `Then translate it naturally into ${langName(targetLang)} (${targetLang}).`,
    sourceHint ? `The speaker's profile language is ${langName(sourceHint)}; use it only as a hint.` : '',
    'Rules: never invent words that are not in the audio. If the clip is silence, noise or',
    'unintelligible, return empty strings. Keep the translation conversational, the way a',
    'person would actually say it out loud — not literal word-for-word.',
    'Return JSON only: {"source": string, "srcLang": string, "translated": string}',
  ].filter(Boolean).join('\n');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mime || 'audio/wav', data: wavBuffer.toString('base64') } },
        { text: prompt },
      ],
    }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };

  const chain = [geminiModel, process.env.GEMINI_MODEL, ...GEMINI_MODELS].filter(Boolean);
  let lastErr = null;
  for (const model of [...new Set(chain)]) {
    try {
      const r = await timedFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message || `gemini HTTP ${r.status}`);
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
      if (!text) throw new Error('gemini: empty response');
      geminiModel = model;
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { /* leave null */ } }
      }
      if (!parsed) throw new Error('gemini: unparsable JSON');
      return {
        source: String(parsed.source || '').trim(),
        srcLang: String(parsed.srcLang || sourceHint || 'en').slice(0, 8),
        translated: String(parsed.translated || '').trim(),
        engine: `gemini:${model}`,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('gemini failed');
}

/* ------------------------------- OpenAI ---------------------------------- */
async function whisperListen(wavBuffer, mime, targetLang, sourceHint) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no openai key');
  const form = new FormData();
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
  form.append('file', new Blob([wavBuffer], { type: mime || 'audio/wav' }), 'clip.wav');
  form.append('model', model);
  if (sourceHint) form.append('language', sourceHint);

  const r = await timedFetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `whisper HTTP ${r.status}`);
  const source = String(data.text || '').trim();
  if (!source) return { source: '', srcLang: sourceHint || 'en', translated: '', engine: `openai:${model}` };

  const srcLang = detectLanguage(source);
  const resolved = srcLang === 'und' ? (sourceHint || 'en') : srcLang;
  const tr = await translateText(source, srcLang, targetLang);
  return {
    source, srcLang: resolved, translated: tr.text || source,
    translatedByProvider: !!tr.translated, engine: `openai:${model}`,
  };
}

/**
 * Transcribe + translate one audio slice.
 * @returns {Promise<{ok:boolean, source?:string, translated?:string, srcLang?:string,
 *                    targetLang?:string, engine?:string, reason?:string}>}
 */
export async function listenAndTranslate(buffer, { mime, targetLang = 'en', sourceHint } = {}) {
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty-audio' };
  const errors = [];
  const key = process.env.GEMINI_API_KEY;

  /* 1. dedicated transcription model, then the normal translation chain */
  if (key) {
    const chain = [transcribeModel, ...TRANSCRIBE_MODELS].filter(Boolean);
    for (const model of [...new Set(chain)]) {
      try {
        const source = await geminiTranscribe(buffer, mime, model, key);
        transcribeModel = model;
        const srcLang = detectLanguage(source) || sourceHint || 'en';
        const tr = await translateText(source, srcLang, targetLang);
        return {
          ok: true, source, srcLang, targetLang,
          translated: tr.text || source,
          engine: `gemini:${model}+${tr.provider || 'none'}`,
        };
      } catch (e) { errors.push(`${model}: ${e.message}`); }
    }
    /* 2. flash model that does both in one hop */
    try {
      const out = await geminiListen(buffer, mime, targetLang, sourceHint);
      return { ok: true, ...out, targetLang };
    } catch (e) { errors.push(`flash: ${e.message}`); }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const out = await whisperListen(buffer, mime, targetLang, sourceHint);
      return { ok: true, ...out, targetLang };
    } catch (e) { errors.push(`openai: ${e.message}`); }
  }
  if (!key && !process.env.OPENAI_API_KEY) {
    return { ok: false, reason: 'no-speech-provider', engine: 'none' };
  }
  return { ok: false, reason: 'provider-failed', detail: errors.join(' | ').slice(0, 300), engine: speechEngine() };
}

/** Translate a live transcript that the device already recognised itself. */
export async function translateTranscript(text, from, to) {
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, reason: 'empty' };
  const guess = detectLanguage(clean);
  const src = guess === 'und' ? (from || 'en') : guess;
  if (src === to) {
    return { ok: true, source: clean, translated: clean, srcLang: src, targetLang: to, engine: 'same-language', translatedByProvider: false };
  }
  const out = await translateText(clean, guess, to);
  return {
    ok: true, source: clean, translated: out.text || clean,
    srcLang: out.detectedLang || src, targetLang: to,
    engine: out.provider || 'none', translatedByProvider: !!out.translated,
  };
}
