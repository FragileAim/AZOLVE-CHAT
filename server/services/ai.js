/**
 * AZOLVE AI — pluggable LLM layer.
 * Set ONE of: OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY / OLLAMA_URL
 * If none is configured the platform runs a deterministic local engine ("local-heuristic")
 * that performs real extractive summarisation, rewriting, captioning and reply suggestion.
 * The API always reports which engine produced the answer, so the UI never pretends a
 * heuristic is a frontier model.
 */
import { translateText, detectLanguage } from './translate.js';

const TIMEOUT = 30000;
async function jfetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data?.error?.message || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  } finally { clearTimeout(t); }
}

export const engineName = () =>
  process.env.OPENAI_API_KEY ? `openai:${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`
  : process.env.ANTHROPIC_API_KEY ? `anthropic:${process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest'}`
  : process.env.GEMINI_API_KEY ? `gemini:${process.env.GEMINI_MODEL || GEMINI_MODELS[0]}`
  : process.env.GROQ_API_KEY ? `groq:${process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'}`
  : process.env.OLLAMA_URL ? 'ollama'
  : 'local-heuristic';

// Tried in order until one answers. Google retires model ids regularly.
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'];
let geminiModel = null;

const SYSTEM = `You are AZOLVE AI, the assistant built into AZOLVE CHAT by AZOLVE INFOTECH.
You help people communicate across languages: drafting messages, rewriting tone, summarising
conversations, writing captions and hashtags, and explaining things clearly.
Be concise, warm and practical. Reply in the user's language. Never invent facts about the user.`;

async function llm(messages, { maxTokens = 900, temperature = 0.6 } = {}) {
  if (process.env.OPENAI_API_KEY) {
    const r = await jfetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, max_tokens: maxTokens, temperature }),
    });
    return r.choices?.[0]?.message?.content?.trim();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await jfetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest', max_tokens: maxTokens, system: SYSTEM, messages: messages.filter(m => m.role !== 'system') }),
    });
    return r.content?.map(c => c.text).join('\n').trim();
  }
  if (process.env.GEMINI_API_KEY) {
    // Google retires model names often, so we try a chain and cache whichever answered.
    const chain = [geminiModel, process.env.GEMINI_MODEL, ...GEMINI_MODELS].filter(Boolean);
    const payload = JSON.stringify({
      contents: messages.filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      systemInstruction: { parts: [{ text: SYSTEM }] },
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    });
    let lastErr;
    for (const model of [...new Set(chain)]) {
      try {
        const r = await jfetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload },
        );
        const text = r.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
        if (text) { geminiModel = model; return text; }
        lastErr = new Error(`gemini ${model}: empty response`);
      } catch (e) {
        lastErr = e;
        // 404 = model retired, 429/503 = busy. Both are worth trying the next name.
        const code = Number(e.status || e.statusCode || 0);
        if (code && ![400, 404, 429, 500, 503].includes(code)) break;
      }
    }
    if (lastErr) console.warn('[ai] gemini failed:', lastErr.message);
    return null;
  }
  if (process.env.GROQ_API_KEY) {
    const r = await jfetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile', messages, max_tokens: maxTokens, temperature }),
    });
    return r.choices?.[0]?.message?.content?.trim();
  }
  if (process.env.OLLAMA_URL) {
    const r = await jfetch(`${process.env.OLLAMA_URL.replace(/\/$/, '')}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'llama3.1', messages, stream: false }),
    });
    return r.message?.content?.trim();
  }
  return null;
}

/* ------------------------- local heuristic engine ------------------------- */
const SENT_SPLIT = /(?<=[.!?।؟\n])\s+/;
const sentences = (text) => text.split(SENT_SPLIT).map(s => s.trim()).filter(s => s.length > 2);

function keywords(text, n = 6) {
  const stop = new Set(('the a an and or but if then so of to in on for with at by from is are was were be been am do does did i you he she it we they me my your our their this that these those as not no yes can will would should could have has had about into over after before more most very just also than them there here what when where who how why').split(' '));
  const freq = new Map();
  for (const w of (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])) {
    if (w.length < 3 || stop.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function localSummary(text, maxSentences = 3) {
  const s = sentences(text);
  if (s.length <= maxSentences) return s.join(' ');
  const kw = new Set(keywords(text, 12));
  const scored = s.map((sent, i) => {
    const words = sent.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
    let score = words.filter(w => kw.has(w)).length / Math.sqrt(words.length || 1);
    if (i === 0) score += 0.6;
    return { sent, score, i };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.i - b.i).map(x => x.sent).join(' ');
}

function localRewrite(text, tone) {
  let t = text.trim().replace(/\s+/g, ' ');
  if (tone === 'shorter') {
    const s = sentences(t);
    return s.slice(0, Math.max(1, Math.ceil(s.length / 2))).join(' ');
  }
  if (tone === 'formal' || tone === 'professional') {
    t = t.replace(/\bhey\b/gi, 'Hello').replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not')
      .replace(/\bI'm\b/g, 'I am').replace(/\bdon't\b/gi, 'do not').replace(/\bpls\b/gi, 'please').replace(/\bthx\b/gi, 'thank you');
    if (!/[.!?]$/.test(t)) t += '.';
    return `Hello,\n\n${t}\n\nBest regards`;
  }
  if (tone === 'casual' || tone === 'friendly') {
    t = t.replace(/\bHello\b/gi, 'Hey').replace(/\bI am\b/g, "I'm").replace(/\bdo not\b/gi, "don't");
    return `${t}${/[!?]$/.test(t) ? '' : ' 🙂'}`;
  }
  if (tone === 'empathetic') return `I hear you, and I understand. ${t}`;
  if (tone === 'confident') return t.replace(/I think\b/gi, 'I know').replace(/maybe\b/gi, '');
  return t;
}

const CAPTION_TEMPLATES = [
  (k) => `Chasing light and ${k[0] || 'good moments'} ✨`,
  (k) => `${k[0] ? k[0][0].toUpperCase() + k[0].slice(1) : 'Today'}, and everything in between.`,
  (k) => `Small moments, big memories. #${(k[0] || 'life')}`,
  (k) => `Where ${k[0] || 'the day'} meets ${k[1] || 'good energy'} 🌍`,
];

function localAnswer(prompt) {
  const p = prompt.toLowerCase();
  if (/^(hi|hello|hey|namaste|salam|hola)\b/.test(p)) return "Hello! I'm AZOLVE AI. I can draft messages, translate, summarise chats, write captions and explain anything you paste in. What are we working on?";
  if (/caption/.test(p)) return CAPTION_TEMPLATES[0](keywords(prompt));
  if (/hashtag/.test(p)) return keywords(prompt, 8).map(k => `#${k}`).join(' ');
  if (/summar/.test(p)) {
    const body = prompt.replace(/^\s*(please\s+)?summar\w*\s*(this|that|the)?\s*(conversation|thread|chat|text|message)?\s*[:\-–]?\s*/i, '').trim();
    const points = sentences(body).slice(0, 5);
    if (!points.length) return 'Paste the conversation or text you want summarised and I will pull out the key points.';
    const head = points.length === 1 ? points[0] : points.map(s => `• ${s}`).join('\n');
    return `Here is the short version:\n\n${head}\n\nIn one line: ${points[0]}`;
  }
  return `Here is a clear way to put it:\n\n${localRewrite(prompt.replace(/^(write|draft|help me write|compose)\s*/i, ''), 'professional')}\n\nTell me the tone you want — friendly, formal, short — and I'll adjust it.`;
}

/* ------------------------------- public API ------------------------------- */
export async function chat({ messages, lang = 'en' }) {
  const engine = engineName();
  if (engine !== 'local-heuristic') {
    try {
      const out = await llm([{ role: 'system', content: SYSTEM + `\nReply in language code: ${lang}.` }, ...messages]);
      if (out) return { text: out, engine };
    } catch (e) { /* fall through */ }
  }
  const last = messages[messages.length - 1]?.content || '';
  return { text: localAnswer(last), engine: 'local-heuristic', note: engine !== 'local-heuristic' ? 'Provider call failed; served by local engine.' : undefined };
}

export async function task({ kind, text, lang = 'en', targetLang, tone }) {
  const engine = engineName();
  const prompts = {
    summarize: `Summarise this conversation with 3-5 bullet points, then one line "Action items:".\n\n${text}`,
    rewrite: `Rewrite the following message in a ${tone || 'friendly'} tone. Return only the rewritten message.\n\n${text}`,
    caption: `Write 3 short social-media captions (with emoji) for this post idea. Return as a numbered list.\n\n${text}`,
    hashtags: `Suggest 10 relevant hashtags for this post. Return them space separated, nothing else.\n\n${text}`,
    explain: `Explain what this message means and how I should reply. Be brief.\n\n${text}`,
    improve: `Improve clarity and grammar, keep the meaning and language. Return only the improved text.\n\n${text}`,
    ideas: `Give 5 concrete ideas about: ${text}`,
    replies: `Suggest 3 short replies (numbered) to this message, in the same language as the message.\n\n${text}`,
  };
  if (kind === 'translate') {
    const src = detectLanguage(text);
    const r = await translateText(text, src, targetLang || 'en');
    return { text: r.text, engine: r.provider, translated: r.translated };
  }
  if (engine !== 'local-heuristic') {
    try {
      const out = await llm([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompts[kind] || text }], { temperature: kind === 'caption' ? 0.9 : 0.5 });
      if (out) return { text: out, engine };
    } catch (e) { /* local */ }
  }
  const local = {
    summarize: () => localSummary(text, 4),
    rewrite: () => localRewrite(text, tone),
    caption: () => CAPTION_TEMPLATES.slice(0, 3).map((f, i) => `${i + 1}. ${f(keywords(text))}`).join('\n'),
    hashtags: () => keywords(text, 10).map(k => `#${k}`).join(' '),
    explain: () => `This message is about ${keywords(text, 3).join(', ') || 'a general update'}. A good reply acknowledges it and asks one clarifying question.`,
    improve: () => localRewrite(text, 'professional'),
    ideas: () => keywords(text, 5).map((k, i) => `${i + 1}. Explore ${k} from a practical angle.`).join('\n'),
    replies: () => ["Sounds good — let's do it.", "Thanks for sharing, I'll get back to you shortly.", 'Got it. Could you share a bit more detail?'].map((r, i) => `${i + 1}. ${r}`).join('\n'),
  }[kind];
  return { text: local ? local() : localAnswer(text), engine: 'local-heuristic' };
}

export async function transcribeVoice() {
  if (!process.env.OPENAI_API_KEY) {
    return { text: null, engine: 'none', note: 'Voice transcription requires a speech provider (OPENAI_API_KEY / Whisper). Audio is stored and playable; no transcript was fabricated.' };
  }
  return { text: null, engine: 'openai:whisper', note: 'Wire the Whisper call in services/ai.js#transcribeVoice for production transcription.' };
}
