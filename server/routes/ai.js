import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { get, run, all } from '../db.js';
import { err, now, id, publicUser, parseJSON } from '../util.js';
import { requireAuth } from '../auth.js';
import { chat, task, engineName } from '../services/ai.js';
import { providerStatus } from '../services/translate.js';

const r = Router();

r.get('/status', requireAuth, (req, res) => {
  res.json({ engine: engineName(), translationProviders: providerStatus() });
});

r.get('/threads', requireAuth, (req, res) => {
  const rows = all('SELECT thread_id, MIN(created_at) started, MAX(created_at) last FROM ai_messages WHERE user_id = ? GROUP BY thread_id ORDER BY last DESC LIMIT 30', req.user.id);
  res.json({ threads: rows });
});

r.get('/threads/:threadId', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM ai_messages WHERE user_id = ? AND thread_id = ? ORDER BY created_at', req.user.id, req.params.threadId);
  res.json({ messages: rows });
});

r.post('/chat', requireAuth, async (req, res) => {
  const { message, threadId = id('t_'), history = [] } = req.body || {};
  if (!message || !String(message).trim()) return err(res, 400, 'Message required');
  run('INSERT INTO ai_messages (id, user_id, thread_id, role, content, created_at) VALUES (?,?,?,?,?,?)', id('am_'), req.user.id, threadId, 'user', message, now());
  const messages = [...history.slice(-10), { role: 'user', content: message }];
  const out = await chat({ messages, lang: req.user.language || 'en' });
  run('INSERT INTO ai_messages (id, user_id, thread_id, role, content, created_at) VALUES (?,?,?,?,?,?)', id('am_'), req.user.id, threadId, 'assistant', out.text, now());
  res.json({ threadId, reply: out.text, engine: out.engine, note: out.note });
});

r.post('/task', requireAuth, async (req, res) => {
  const { kind, text, tone, targetLang } = req.body || {};
  if (!text) return err(res, 400, 'text required');
  const out = await task({ kind, text, tone, targetLang, lang: req.user.language || 'en' });
  res.json(out);
});

/* ------------------------------- uploads ---------------------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8) || '';
    cb(null, `${Date.now()}-${id()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

r.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return err(res, 400, 'No file uploaded');
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    kind: req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('video/') ? 'video' : req.file.mimetype.startsWith('audio/') ? 'audio' : 'file',
  });
});

/* ----------------------------- notifications ------------------------------ */
r.get('/notifications', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 80', req.user.id);
  const out = rows.map(n => ({
    ...n, read: !!n.read, actor: n.actor_id ? publicUser(get('SELECT * FROM users WHERE id = ?', n.actor_id), req.user.id) : null,
  }));
  res.json({ notifications: out, unread: out.filter(n => !n.read).length });
});

r.post('/notifications/read', requireAuth, (req, res) => {
  if (req.body?.id) run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', req.body.id, req.user.id);
  else run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

r.delete('/notifications', requireAuth, (req, res) => {
  run('DELETE FROM notifications WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

/* -------------------------------- calls ----------------------------------- */
r.get('/calls', requireAuth, (req, res) => {
  const rows = all(`SELECT c.*, u.display_name, u.avatar, u.username FROM calls c
    LEFT JOIN users u ON u.id = CASE WHEN c.caller_id = ? THEN c.callee_id ELSE c.caller_id END
    WHERE c.caller_id = ? OR c.callee_id = ? ORDER BY c.started_at DESC LIMIT 50`, req.user.id, req.user.id, req.user.id);
  res.json({ calls: rows.map(c => ({ ...c, direction: c.caller_id === req.user.id ? 'outgoing' : 'incoming' })) });
});

r.post('/calls', requireAuth, (req, res) => {
  const { calleeId, type = 'audio', conversationId, status = 'ringing' } = req.body || {};
  const cid = id('call_');
  run('INSERT INTO calls (id, conversation_id, caller_id, callee_id, type, status, started_at) VALUES (?,?,?,?,?,?,?)',
    cid, conversationId || null, req.user.id, calleeId || null, type, status, now());
  res.status(201).json({ callId: cid });
});

r.patch('/calls/:id', requireAuth, (req, res) => {
  const c = get('SELECT * FROM calls WHERE id = ?', req.params.id);
  if (!c) return err(res, 404, 'Call not found');
  if (c.caller_id !== req.user.id && c.callee_id !== req.user.id) return err(res, 403, 'Not your call');
  const { status, duration, reason } = req.body || {};
  /* The person sending this request is the one who ended it, unless the call
     was already closed by the other side or timed out. */
  const endedBy = c.ended_by || (status && status !== 'ringing' ? req.user.id : null);
  const endedReason = c.ended_reason || reason || (status === 'missed' ? 'no-answer' : status === 'declined' ? 'declined' : status === 'completed' ? 'hangup' : null);
  run('UPDATE calls SET status = ?, ended_at = ?, duration = ?, ended_by = ?, ended_reason = ? WHERE id = ?',
    status || c.status, now(), duration ?? c.duration, endedBy, endedReason, c.id);
  res.json({ ok: true, endedBy, endedReason });
});

export default r;
