import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../auth.js';
import { err } from '../util.js';
import { listenAndTranslate, translateTranscript, speechEngine } from '../services/speech.js';
import { providerStatus } from '../services/translate.js';

const r = Router();

/* Audio slices are tiny (a few seconds of 16 kHz mono WAV). Keeping them in
   memory means nothing hits the disk on the call path. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

r.get('/live/status', requireAuth, (req, res) => {
  res.json({
    speechEngine: speechEngine(),
    canTranscribe: !!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY,
    translationProviders: providerStatus(),
  });
});

/* Transcribe a slice of call audio and translate it for the listener. */
r.post('/live/listen', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file?.buffer?.length) return err(res, 400, 'No audio received');
  const targetLang = String(req.body?.targetLang || req.user.language || 'en').slice(0, 8);
  const sourceHint = String(req.body?.sourceLang || '').slice(0, 8) || undefined;
  const out = await listenAndTranslate(req.file.buffer, {
    mime: req.file.mimetype || 'audio/wav',
    targetLang,
    sourceHint,
  });
  if (!out.ok) return res.status(200).json(out);
  res.json(out);
});

/* Translate a transcript the device already recognised (Web Speech API path). */
r.post('/live/translate', requireAuth, async (req, res) => {
  const { text, from, to } = req.body || {};
  if (!text || !String(text).trim()) return err(res, 400, 'text required');
  const out = await translateTranscript(String(text), from, String(to || req.user.language || 'en').slice(0, 8));
  res.json(out);
});

export default r;
