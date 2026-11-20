/**
 * AZOLVE translation layer.
 * Provider chain is configurable through env vars, no code changes required:
 *   DEEPL_API_KEY -> GOOGLE_TRANSLATE_API_KEY -> LIBRE_TRANSLATE_URL -> OPENAI_API_KEY -> MyMemory (keyless) -> phrasebook
 * Every result is cached in the `translations` table keyed by (message_id, lang),
 * so a single message can be rendered in N languages for N recipients while the
 * original is never overwritten.
 */
import { get, run, all } from '../db.js';
import { now } from '../util.js';

const TIMEOUT = 8000;

async function jfetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------------------------- language detection --------------------------- */
const SCRIPTS = [
  [/[\u0900-\u097F]/, 'hi'], [/[\u0980-\u09FF]/, 'bn'], [/[\u0A80-\u0AFF]/, 'gu'],
  [/[\u0B80-\u0BFF]/, 'ta'], [/[\u0C00-\u0C7F]/, 'te'], [/[\u0600-\u06FF]/, 'ar'],
  [/[\u0590-\u05FF]/, 'he'], [/[\u3040-\u30FF]/, 'ja'], [/[\u4E00-\u9FFF]/, 'zh'],
  [/[\uAC00-\uD7AF]/, 'ko'], [/[\u0400-\u04FF]/, 'ru'], [/[\u0E00-\u0E7F]/, 'th'],
];
const STOPWORDS = {
  en: ['the', 'and', 'you', 'how', 'are', 'is', 'to', 'i', 'we', 'this', 'that', 'hello', 'thanks', 'please', 'good', 'morning', 'what', 'with', 'for', 'me', 'my'],
  es: ['el', 'la', 'que', 'de', 'y', 'cómo', 'estás', 'hola', 'gracias', 'por', 'favor', 'buenos', 'días', 'quiero', 'hablar', 'contigo', 'muy', 'bien'],
  fr: ['le', 'la', 'les', 'et', 'vous', 'comment', 'allez', 'bonjour', 'merci', 'je', 'tu', 'nous', 'avec', 'pour', 'très', 'bien', 'salut'],
  de: ['der', 'die', 'das', 'und', 'wie', 'geht', 'hallo', 'danke', 'ich', 'du', 'wir', 'mit', 'für', 'sehr', 'gut', 'guten', 'tag', 'bitte', 'nicht', 'kein', 'keine', 'mehr', 'nötig', 'auch', 'ist', 'sind', 'es', 'mir', 'dir', 'heute', 'abend', 'genau', 'schaue', 'wird', 'haben', 'aber', 'noch'],
  pt: ['o', 'a', 'que', 'de', 'e', 'como', 'está', 'olá', 'obrigado', 'por', 'favor', 'bom', 'dia', 'eu', 'você', 'muito', 'bem'],
  it: ['il', 'la', 'che', 'di', 'e', 'come', 'stai', 'ciao', 'grazie', 'per', 'favore', 'buongiorno', 'io', 'tu', 'molto', 'bene'],
  nl: ['de', 'het', 'en', 'hoe', 'gaat', 'hallo', 'dank', 'ik', 'jij', 'met', 'voor', 'goed', 'alsjeblieft'],
  tr: ['ve', 'bir', 'nasılsın', 'merhaba', 'teşekkür', 'için', 'ben', 'sen', 'çok', 'iyi', 'günaydın'],
  id: ['dan', 'yang', 'apa', 'kabar', 'halo', 'terima', 'kasih', 'saya', 'kamu', 'untuk', 'sangat', 'baik'],
  sw: ['na', 'ya', 'habari', 'asante', 'tafadhali', 'mimi', 'wewe', 'kwa', 'sana', 'nzuri'],
  pl: ['i', 'w', 'jak', 'się', 'masz', 'cześć', 'dziękuję', 'proszę', 'bardzo', 'dobrze', 'jest'],
  vi: ['và', 'là', 'bạn', 'khỏe', 'xin', 'chào', 'cảm', 'ơn', 'tôi', 'rất', 'tốt'],
};

export function detectLanguage(text) {
  if (!text || !text.trim()) return 'en';
  for (const [re, code] of SCRIPTS) if (re.test(text)) return code;
  if (/[äöüß]/i.test(text)) return 'de';
  if (/[ñ¿¡]/i.test(text)) return 'es';
  if (/[ãõ]/i.test(text)) return 'pt';
  if (/[çœ]/i.test(text)) return 'fr';
  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return 'en';
  let best = 'en', bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    let s = 0;
    for (const w of words) if (list.includes(w)) s++;
    if (s > bestScore) { bestScore = s; best = lang; }
  }
  return bestScore > 0 ? best : 'en';
}

/* ------------------------------- providers -------------------------------- */
const phrasebook = {
  'hi|en': { 'आप कैसे हैं?': 'How are you?', 'मुझे आपसे बात करनी है।': 'I need to talk to you.', 'नमस्ते': 'Hello', 'धन्यवाद': 'Thank you', 'आप कैसे हैं': 'How are you?' },
  'en|hi': { 'how are you?': 'आप कैसे हैं?', 'hello': 'नमस्ते', 'thank you': 'धन्यवाद', 'good morning': 'सुप्रभात' },
  'en|ar': { 'hello': 'مرحبا', 'how are you?': 'كيف حالك؟', 'thank you': 'شكرا' },
  'ar|en': { 'مرحبا': 'Hello', 'كيف حالك؟': 'How are you?', 'شكرا': 'Thank you' },
};

const providers = {
  deepl: {
    name: 'deepl',
    available: () => !!process.env.DEEPL_API_KEY,
    async translate(text, from, to) {
      const body = new URLSearchParams({ text, target_lang: to.toUpperCase() });
      if (from !== 'auto') body.set('source_lang', from.toUpperCase());
      const r = await jfetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      return r.translations?.[0]?.text;
    },
  },
  google: {
    name: 'google',
    available: () => !!process.env.GOOGLE_TRANSLATE_API_KEY,
    async translate(text, from, to) {
      const u = `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_TRANSLATE_API_KEY}`;
      const r = await jfetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: text, target: to, source: from === 'auto' ? undefined : from, format: 'text' }) });
      return r.data?.translations?.[0]?.translatedText;
    },
  },
  libre: {
    name: 'libre',
    available: () => !!process.env.LIBRE_TRANSLATE_URL,
    async translate(text, from, to) {
      const r = await jfetch(`${process.env.LIBRE_TRANSLATE_URL.replace(/\/$/, '')}/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: from === 'auto' ? 'auto' : from, target: to, format: 'text', api_key: process.env.LIBRE_TRANSLATE_KEY || undefined }),
      });
      return r.translatedText;
    },
  },
  openai: {
    name: 'openai',
    available: () => !!process.env.OPENAI_API_KEY,
    async translate(text, from, to) {
      const r = await jfetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini', temperature: 0,
          messages: [{ role: 'system', content: 'You are a translation engine. Reply with the translation only, preserving tone, emoji and formatting. No commentary.' },
            { role: 'user', content: `Translate from ${from} to ${to}:\n${text}` }],
        }),
      });
      return r.choices?.[0]?.message?.content?.trim();
    },
  },
  mymemory: {
    name: 'mymemory',
    available: () => process.env.TRANSLATION_PROVIDER !== 'offline',
    async translate(text, from, to) {
      const src = from === 'auto' ? detectLanguage(text) : from;
      const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${src}|${to}${process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : ''}`;
      const r = await jfetch(u);
      const t = r.responseData?.translatedText;
      if (!t || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error('mymemory empty');
      return t;
    },
  },
  offline: {
    name: 'offline-phrasebook',
    available: () => true,
    async translate(text, from, to) {
      const key = `${from}|${to}`;
      const book = phrasebook[key] || {};
      const hit = book[text.trim().toLowerCase()] || book[text.trim()];
      if (hit) return hit;
      throw new Error('no offline match');
    },
  },
};

export const providerStatus = () => Object.values(providers).map(p => ({ name: p.name, available: p.available() }));

export async function translateText(text, from, to) {
  if (!text || !text.trim() || from === to) return { text, provider: 'none', translated: false };
  const chain = (process.env.TRANSLATION_PROVIDER || 'deepl,google,libre,openai,mymemory,offline')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const key of chain) {
    const p = providers[key];
    if (!p || !p.available()) continue;
    try {
      const out = await p.translate(text, from, to);
      if (out && out.trim()) return { text: out, provider: p.name, translated: true };
    } catch (e) { /* try next provider */ }
  }
  return { text, provider: 'none', translated: false };
}

/** Translate one message for one recipient language, with DB cache. */
export async function translateMessage(msg, targetLang) {
  const src = msg.original_lang || detectLanguage(msg.original_body || msg.body || '');
  if (!targetLang || src === targetLang) return { text: msg.original_body || msg.body, translated: false, lang: src };
  const cached = get('SELECT text, provider FROM translations WHERE message_id = ? AND lang = ?', msg.id, targetLang);
  if (cached) return { text: cached.text, translated: true, lang: targetLang, provider: cached.provider, cached: true };
  const body = msg.original_body || msg.body || '';
  const r = await translateText(body, src, targetLang);
  if (r.translated) run('INSERT OR REPLACE INTO translations (message_id, lang, text, provider, created_at) VALUES (?,?,?,?,?)', msg.id, targetLang, r.text, r.provider, now());
  return { text: r.text, translated: r.translated, lang: targetLang, provider: r.provider, sourceLang: src };
}

/** Batch translate a list of messages for a viewer, in parallel with a small cap. */
export async function translateManyForViewer(messages, viewerLang, overrideLang) {
  const lang = overrideLang || viewerLang || 'en';
  const out = [];
  const queue = [...messages];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const m = queue.shift();
      if (m.deleted) { out.push(m); continue; }
      if (m.type !== 'text' && !m.original_body) { out.push(m); continue; }
      const t = await translateMessage(m, lang);
      out.push({ ...m, displayBody: t.text, translated: t.translated, displayLang: t.lang, translationProvider: t.provider });
    }
  });
  await Promise.all(workers);
  const order = new Map(messages.map((m, i) => [m.id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

export function translationUsage() {
  return all('SELECT provider, COUNT(*) as count FROM translations GROUP BY provider');
}
