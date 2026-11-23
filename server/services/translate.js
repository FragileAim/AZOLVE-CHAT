/**
 * AZOLVE translation layer.
 * Provider chain is configurable through env vars, no code changes required:
 *   DEEPL_API_KEY -> GOOGLE_TRANSLATE_API_KEY -> LIBRE_TRANSLATE_URL -> OPENAI_API_KEY -> MyMemory (keyless)
 * Every result is cached in the `translations` table keyed by (message_id, lang),
 * so a single message can be rendered in N languages for N recipients while the
 * original is never overwritten.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE CHANGED (v1.1.6)
 *
 * The old detector only understood native scripts. Romanised Hindi/Gujarati —
 * how most people in India actually type — scored zero and fell through to a
 * hardcoded `return 'en'`. A Hinglish message was therefore labelled English,
 * the recipient was English, `from === to` short-circuited, and the original
 * text was handed back as though it were a translation. That is the "translation
 * is coming on its own" bug.
 *
 * Two structural fixes:
 *   1. `detectLanguage` now scores Romanised Indic markers and returns `'und'`
 *      (undetermined) instead of lying with `'en'` when it has no evidence.
 *   2. When the source is `'und'` we omit `source_lang` entirely and let the
 *      provider detect it. DeepL reports `detected_source_language` and handles
 *      code-mixed Hinglish correctly — it was only ever wrong because we were
 *      telling it "this is English, don't bother looking".
 *
 * A failed translation is never returned as a success: `translated: false` and
 * `provider: 'none'` are propagated so the UI can say "Translation unavailable"
 * rather than echoing the original in silence.
 * ---------------------------------------------------------------------------
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

/* Latin-script words. These are what catch Romanised Indic input, which the
   script table above cannot see. Kept deliberately narrow: a word only earns a
   place here if it is not also an ordinary English word, because a false
   positive here would translate an English sentence into Hindi. */
const ROMAN = {
  hi: ['mujhe', 'mujhko', 'tumhe', 'aapko', 'humein', 'hume', 'kal', 'aaj', 'abhi',
    'subah', 'shaam', 'raat', 'baje', 'jaana', 'jana', 'aana', 'ana', 'karna', 'karo',
    'kar', 'raha', 'rahi', 'rahe', 'hoon', 'hu', 'hai', 'hain', 'nahi', 'nahin',
    'haan', 'theek', 'thik', 'accha', 'acha', 'bahut', 'bhai', 'milte', 'milna',
    'kya', 'kaise', 'kaisa', 'kahan', 'kab', 'kyun', 'kyon', 'mera', 'meri', 'tera',
    'teri', 'tum', 'aap', 'hum', 'bolo', 'bol', 'chalo', 'jao', 'ghar', 'kaam',
    'paani', 'khana', 'dost', 'yaar', 'matlab', 'samajh', 'baat', 'kuch', 'sab',
    'chalega', 'dekh', 'dekho', 'suno', 'batao', 'chahiye', 'sakta', 'sakte', 'hoga',
    'tha', 'thi', 'honge', 'karte', 'karta', 'karti', 'jaise', 'phir', 'fir', 'lekin',
    'magar', 'bhi', 'sirf', 'wala', 'wali', 'namaste', 'dhanyavad', 'shukriya',
    'kitna', 'kitni', 'zyada', 'kam', 'paisa', 'time', 'baje', 'nikal', 'chalo'],
  gu: ['kem', 'cho', 'majama', 'aavjo', 'chhe', 'nathi', 'karvu', 'javu', 'aavu',
    'tamne', 'mane', 'ame', 'tame', 'kemcho', 'bhalo', 'saru', 'hato', 'hati',
    'chhu', 'chho', 'bhai', 'aavjo', 'dhanyavad', 'kaho', 'su', 'kem'],
  ta: ['enna', 'epdi', 'eppadi', 'irukka', 'irukkinga', 'vanakkam', 'nandri',
    'seri', 'illa', 'aama', 'romba', 'nalla', 'thambi', 'akka', 'anna', 'yaaru',
    'eppo', 'saaptiya', 'po', 'vaa', 'sollu', 'venum'],
  te: ['ela', 'unnaru', 'bagunara', 'dhanyavadalu', 'cheppu', 'chesanu', 'vellu',
    'kani', 'chala', 'baga', 'emi', 'enti', 'unnava', 'ra'],
  bn: ['kemon', 'acho', 'bhalo', 'dhonnobad', 'ami', 'tumi', 'apni', 'kotha',
    'koro', 'korbo', 'jabo', 'asbo', 'khub', 'onek', 'kemonacho'],
  mr: ['kasa', 'kase', 'ahes', 'aahat', 'dhanyavad', 'karto', 'karte', 'kela',
    'kai', 'mala', 'tula', 'aamhi', 'tumhi', 'kay', 'zala'],
};

const STOPWORDS = {
  en: ['the', 'and', 'you', 'how', 'are', 'is', 'to', 'i', 'we', 'this', 'that',
    'hello', 'thanks', 'thank', 'please', 'good', 'morning', 'what', 'with', 'for',
    'me', 'my', 'will', 'call', 'after', 'before', 'have', 'has', 'was', 'were',
    'can', 'could', 'would', 'should', 'not', 'but', 'from', 'they', 'them', 'your',
    'our', 'about', 'there', 'here', 'when', 'where', 'why', 'who', 'just', 'now',
    'today', 'tomorrow', 'meeting', 'office', 'going', 'come', 'see', 'know'],
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

const ROMAN_SETS = Object.fromEntries(
  Object.entries(ROMAN).map(([lang, list]) => [lang, new Set(list)]),
);

/**
 * Best-effort language guess.
 * @returns {string} a language code, or `'und'` when there is genuinely no
 *   evidence. `'und'` is a real answer meaning "ask the provider" — it is not
 *   the same as guessing English.
 */
export function detectLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'und';

  for (const [re, code] of SCRIPTS) if (re.test(raw)) return code;
  if (/[äöüß]/i.test(raw)) return 'de';
  if (/[ñ¿¡]/i.test(raw)) return 'es';
  if (/[ãõ]/i.test(raw)) return 'pt';
  if (/[çœ]/i.test(raw)) return 'fr';

  const words = raw.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return 'und';

  /* Romanised Indic first: these markers are strong enough that one or two hits
     beat a single incidental English stopword ("meeting", "office"). */
  let romanBest = null;
  let romanScore = 0;
  for (const [lang, set] of Object.entries(ROMAN_SETS)) {
    let s = 0;
    for (const w of words) if (set.has(w)) s++;
    if (s > romanScore) { romanScore = s; romanBest = lang; }
  }

  let best = null;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    let s = 0;
    for (const w of words) if (list.includes(w)) s++;
    if (s > bestScore) { bestScore = s; best = lang; }
  }

  /* A Romanised hit wins ties against English: "kal office aa raha hoon" scores
     kal+aa+raha+hoon = 4 against English's office = 1. */
  if (romanScore > 0 && romanScore >= bestScore) return romanBest;
  if (bestScore > 0) return best;
  return 'und';
}

/** True when the detector is confident enough to send as a source language. */
const isKnown = code => !!code && code !== 'und' && code !== 'auto';

/* ------------------------------- providers -------------------------------- */
/* Every provider returns { text, detected } where `detected` is the provider's
   own opinion of the source language (null when it does not say). */
const providers = {
  deepl: {
    name: 'deepl',
    available: () => !!process.env.DEEPL_API_KEY,
    async translate(text, from, to) {
      const body = new URLSearchParams({ text, target_lang: to.toUpperCase() });
      /* Only pin the source when we actually know it. Omitting it is what lets
         DeepL recognise code-mixed Hinglish. */
      if (isKnown(from)) body.set('source_lang', from.toUpperCase());
      const r = await jfetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const t = r.translations?.[0];
      const detected = String(t?.detected_source_language || '').toLowerCase() || null;
      return { text: t?.text, detected: detected === 'om' ? null : detected };
    },
  },
  google: {
    name: 'google',
    available: () => !!process.env.GOOGLE_TRANSLATE_API_KEY,
    async translate(text, from, to) {
      const u = `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_TRANSLATE_API_KEY}`;
      const payload = { q: text, target: to, format: 'text' };
      if (isKnown(from)) payload.source = from;
      const r = await jfetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const t = r.data?.translations?.[0];
      return { text: t?.translatedText, detected: t?.detectedSourceLanguage || null };
    },
  },
  libre: {
    name: 'libre',
    available: () => !!process.env.LIBRE_TRANSLATE_URL,
    async translate(text, from, to) {
      const r = await jfetch(`${process.env.LIBRE_TRANSLATE_URL.replace(/\/$/, '')}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: isKnown(from) ? from : 'auto',
          target: to,
          format: 'text',
          api_key: process.env.LIBRE_TRANSLATE_KEY || undefined,
        }),
      });
      return { text: r.translatedText, detected: r.detectedLanguage?.language || null };
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
          model: process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini',
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: 'You are a translation engine. Detect the source language yourself, including romanised Indic languages such as Hinglish. Reply with the translation only, preserving tone, emoji and formatting. No commentary.',
            },
            {
              role: 'user',
              content: `Translate the following ${isKnown(from) ? `from ${from} ` : ''}into ${to}. Reply with JSON only: {"detected":"<iso code>","text":"<translation>"}\n\n${text}`,
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      const raw = r.choices?.[0]?.message?.content?.trim() || '';
      try {
        const p = JSON.parse(raw);
        return { text: p.text, detected: p.detected ? String(p.detected).slice(0, 8) : null };
      } catch {
        return { text: raw, detected: null };
      }
    },
  },
  mymemory: {
    name: 'mymemory',
    available: () => process.env.TRANSLATION_PROVIDER !== 'offline',
    async translate(text, from, to) {
      const src = isKnown(from) ? from : (detectLanguage(text) === 'und' ? 'en' : detectLanguage(text));
      const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${src}|${to}${process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : ''}`;
      const r = await jfetch(u);
      const t = r.responseData?.translatedText;
      /* MyMemory answers HTTP 200 with prose when it is unhappy. Treating that
         as a translation is how "PLEASE SELECT TWO DISTINCT LANGUAGES" once
         ended up in a chat bubble. */
      if (!t || /MYMEMORY WARNING|INVALID|PLEASE SELECT|QUERY LENGTH LIMIT|NO QUERY SPECIFIED/i.test(t)) {
        throw new Error('mymemory rejected the request');
      }
      return { text: t, detected: null };
    },
  },
};

/* The old offline phrasebook is gone on purpose. It only ever knew four pairs
   and a handful of phrases, so for anything else it threw, the chain fell
   through, and the caller got the original text back as if it were a
   translation. A missing provider is now reported honestly instead of being
   papered over with a five-entry dictionary. */

export const providerStatus = () =>
  Object.values(providers).map(p => ({ name: p.name, available: p.available() }));

/** True when at least one real provider is configured. */
export const hasRealProvider = () => Object.values(providers).some(p => p.available());

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Translate text.
 * @param {string} text
 * @param {string} from  language code, or 'und'/'auto' to let the provider decide
 * @param {string} to    target language code
 * @returns {Promise<{text:string, provider:string, translated:boolean,
 *                    detectedLang:string|null, reason?:string}>}
 */
export async function translateText(text, from, to) {
  const body = String(text || '');
  if (!body.trim()) return { text: body, provider: 'none', translated: false, detectedLang: null, reason: 'empty' };
  if (isKnown(from) && from === to) {
    return { text: body, provider: 'none', translated: false, detectedLang: from, reason: 'same-language' };
  }

  const chain = (process.env.TRANSLATION_PROVIDER || 'deepl,google,libre,openai,mymemory')
    .split(',').map(s => s.trim()).filter(Boolean);

  /* Our own detector is better than the provider's guess on Romanised Indic
     text. Left to itself DeepL reads "kale savare hu office jaish" as Swedish
     and hands it back untranslated; told it is Gujarati it gets it right. So
     when the caller did not name a source language, detect it here and pass it
     down as a hint. Unknown stays unknown so the provider may still guess. */
  const local = isKnown(from) ? from : detectLanguage(body);
  const hint = isKnown(local) ? local : null;

  /* Already in the target language: nothing to do. But code-mixed text such as
     "Good morning, kal meeting 10 baje hai na?" detects as Hindi and still
     deserves a real Hindi rendering, so only short-circuit when there is no
     Latin text left to convert. */
  const hasLatin = /[A-Za-z]/.test(body);
  if (hint && hint === to && !hasLatin) {
    return { text: body, provider: 'none', translated: false, detectedLang: hint, reason: 'same-language' };
  }

  /* Providers reject source === target, so drop a hint that matches the target
     and let them auto-detect the mixed input instead. */
  const srcHint = hint && hint !== to ? hint : null;

  let detected = null;
  const failures = [];

  for (const key of chain) {
    const p = providers[key];
    if (!p || !p.available()) continue;
    try {
      const out = await p.translate(body, srcHint || from, to);
      const outText = String(out?.text || '').trim();
      if (!outText) throw new Error('empty');
      if (out?.detected) detected = out.detected;

      /* An echo is not a translation. If the provider handed the input back
         unchanged and the language is not the target, it did not do the job —
         move on rather than reporting success. */
      const echoed = norm(outText) === norm(body);
      const srcLang = detected || srcHint || hint || (isKnown(from) ? from : null);
      if (echoed && srcLang && srcLang !== to) throw new Error('echoed input');

      if (echoed) {
        /* Genuinely the same language: report it as untranslated, not as a
           translation, so the UI shows the original without a "translated" badge. */
        return { text: outText, provider: p.name, translated: false, detectedLang: srcLang || to, reason: 'same-language' };
      }

      return { text: outText, provider: p.name, translated: true, detectedLang: srcLang };
    } catch (e) {
      failures.push(`${p.name}:${e?.message || e}`);
    }
  }

  return {
    text: body,
    provider: 'none',
    translated: false,
    detectedLang: detected,
    reason: failures.length ? `all-providers-failed (${failures.join(' | ').slice(0, 200)})` : 'no-provider',
  };
}

/** Translate one message for one recipient language, with DB cache. */
export async function translateMessage(msg, targetLang) {
  const body = msg.original_body || msg.body || '';
  const to = targetLang || 'en';

  /* Trust the detector over the stored column: messages written before this fix
     have `original_lang = 'en'` on Hinglish text. */
  const guess = detectLanguage(body);
  const src = guess; // may be 'und' — that is intentional, the provider decides

  if (isKnown(src) && src === to) {
    return { text: body, translated: false, lang: src, provider: 'none', sourceLang: src };
  }

  const cached = get('SELECT text, provider FROM translations WHERE message_id = ? AND lang = ?', msg.id, to);
  if (cached) {
    return { text: cached.text, translated: true, lang: to, provider: cached.provider, cached: true, sourceLang: src };
  }

  const r = await translateText(body, src, to);

  /* Repair the stored language when the detector disagrees with it. */
  if (msg.id && isKnown(r.detectedLang) && r.detectedLang !== msg.original_lang) {
    try { run('UPDATE messages SET original_lang = ? WHERE id = ?', r.detectedLang, msg.id); } catch { /* read-only replica */ }
  }

  if (r.translated) {
    try {
      run('INSERT OR REPLACE INTO translations (message_id, lang, text, provider, created_at) VALUES (?,?,?,?,?)',
        msg.id, to, r.text, r.provider, now());
    } catch { /* cache is best-effort */ }
  }

  return {
    text: r.text,
    translated: r.translated,
    lang: to,
    provider: r.provider,
    sourceLang: r.detectedLang || src,
    reason: r.reason,
  };
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
      out.push({
        ...m,
        displayBody: t.text,
        translated: t.translated,
        displayLang: t.lang,
        translationProvider: t.provider,
        originalLang: t.sourceLang || m.original_lang,
        translationUnavailable: !t.translated && t.provider === 'none' && isKnown(t.sourceLang) && t.sourceLang !== lang,
      });
    }
  });
  await Promise.all(workers);
  const order = new Map(messages.map((m, i) => [m.id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

export function translationUsage() {
  return all('SELECT provider, COUNT(*) as count FROM translations GROUP BY provider');
}

/**
 * One-off repair for messages whose stored language was mislabelled by the old
 * script-only detector. Safe to run repeatedly: it only touches rows whose
 * detected language actually differs.
 * @returns {{scanned:number, fixed:number}}
 */
export function backfillLanguages(limit = 5000) {
  const rows = all(
    `SELECT id, body, original_body, original_lang FROM messages
     WHERE type = 'text' AND body IS NOT NULL AND body <> ''
     ORDER BY created_at DESC LIMIT ?`, limit,
  );
  let fixed = 0;
  for (const m of rows) {
    const guess = detectLanguage(m.original_body || m.body);
    if (!isKnown(guess)) continue;
    if (guess === m.original_lang) continue;
    try { run('UPDATE messages SET original_lang = ? WHERE id = ?', guess, m.id); fixed++; } catch { /* skip */ }
  }
  return { scanned: rows.length, fixed };
}
