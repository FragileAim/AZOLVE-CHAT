import { Router } from 'express';
import { get, run, all } from '../db.js';
import { err, now, id, publicUser } from '../util.js';
import { requireAdmin } from '../auth.js';
import { engineName } from '../services/ai.js';
import { translationUsage, backfillLanguages } from '../services/translate.js';
import { integrationStatus } from '../services/integrations.js';

const r = Router();

/* Which API keys are actually live. Read-only — secrets are never returned,
   only whether each provider is ready and which env var it needs. */
r.get('/integrations', requireAdmin, (req, res) => res.json(integrationStatus()));

r.get('/stats', requireAdmin, (req, res) => {
  const day = 864e5;
  const users = get('SELECT COUNT(*) c FROM users').c;
  const active24 = get('SELECT COUNT(*) c FROM users WHERE last_seen > ?', now() - day).c;
  const active30 = get('SELECT COUNT(*) c FROM users WHERE last_seen > ?', now() - 30 * day).c;
  const messages = get('SELECT COUNT(*) c FROM messages').c;
  const msgs24 = get('SELECT COUNT(*) c FROM messages WHERE created_at > ?', now() - day).c;
  const posts = get('SELECT COUNT(*) c FROM posts').c;
  const moments = get('SELECT COUNT(*) c FROM moments WHERE expires_at > ?', now()).c;
  const communities = get('SELECT COUNT(*) c FROM communities').c;
  const calls = get('SELECT COUNT(*) c FROM calls').c;
  const openReports = get("SELECT COUNT(*) c FROM reports WHERE status = 'open'").c;
  const suspended = get("SELECT COUNT(*) c FROM users WHERE status = 'suspended'").c;
  const translations = get('SELECT COUNT(*) c FROM translations').c;
  const aiMsgs = get('SELECT COUNT(*) c FROM ai_messages').c;
  const registrations = all(`SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM users
    GROUP BY d ORDER BY d DESC LIMIT 14`).reverse();
  const messageVolume = all(`SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM messages
    GROUP BY d ORDER BY d DESC LIMIT 14`).reverse();
  const languages = all('SELECT language, COUNT(*) c FROM users GROUP BY language ORDER BY c DESC');
  const storage = all("SELECT SUM(size) s FROM (SELECT 0 size)").length ? 0 : 0;
  res.json({
    users, active24, active30, messages, msgs24, posts, moments, communities, calls, openReports, suspended,
    translations, aiMsgs, registrations, messageVolume, languages,
    engine: engineName(), translationUsage: translationUsage(),
    system: { uptime: process.uptime(), memory: process.memoryUsage().rss, node: process.version, db: 'SQLite (WAL)', realtime: 'Socket.IO' },
  });
});

r.get('/users', requireAdmin, (req, res) => {
  const q = `%${String(req.query.q || '').toLowerCase()}%`;
  const rows = all('SELECT * FROM users WHERE lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ? ORDER BY created_at DESC LIMIT 100', q, q, q);
  res.json({ users: rows.map(u => ({ ...publicUser(u, req.user.id), status: u.status, email: u.email, phone: u.phone })) });
});

r.post('/users/:id/verify', requireAdmin, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return err(res, 404, 'User not found');
  run('UPDATE users SET verified = ? WHERE id = ?', u.verified ? 0 : 1, u.id);
  run('INSERT INTO audit_log (id, actor_id, action, target, meta, created_at) VALUES (?,?,?,?,?,?)', id('a_'), req.user.id, 'verify_user', u.id, JSON.stringify({ verified: !u.verified }), now());
  res.json({ verified: !u.verified });
});

r.post('/users/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended', 'pending'].includes(status)) return err(res, 400, 'Invalid status');
  run('UPDATE users SET status = ? WHERE id = ?', status, req.params.id);
  if (status === 'suspended') run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.params.id);
  run('INSERT INTO audit_log (id, actor_id, action, target, meta, created_at) VALUES (?,?,?,?,?,?)', id('a_'), req.user.id, 'set_status', req.params.id, JSON.stringify({ status }), now());
  res.json({ ok: true });
});

r.post('/users/:id/role', requireAdmin, (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Only admins can change roles');
  const { role } = req.body || {};
  if (!['user', 'moderator', 'admin'].includes(role)) return err(res, 400, 'Invalid role');
  run('UPDATE users SET role = ? WHERE id = ?', role, req.params.id);
  res.json({ ok: true });
});

r.get('/reports', requireAdmin, (req, res) => {
  const rows = all('SELECT * FROM reports ORDER BY created_at DESC LIMIT 100');
  res.json({ reports: rows.map(x => ({ ...x, reporter: publicUser(get('SELECT * FROM users WHERE id = ?', x.reporter_id), req.user.id) })) });
});

r.post('/reports/:id', requireAdmin, (req, res) => {
  const { status = 'resolved' } = req.body || {};
  run('UPDATE reports SET status = ? WHERE id = ?', status, req.params.id);
  res.json({ ok: true });
});

r.get('/posts', requireAdmin, (req, res) => {
  const rows = all('SELECT p.*, u.username FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 60');
  res.json({ posts: rows });
});

r.get('/communities', requireAdmin, (req, res) => {
  const rows = all('SELECT c.*, (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id) members FROM communities c ORDER BY created_at DESC');
  res.json({ communities: rows });
});

r.get('/audit', requireAdmin, (req, res) => {
  res.json({ audit: all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100') });
});

/* Repairs messages whose original_lang was written by the old detector, which
   claimed every unknown string was English. Idempotent: safe to run twice. */
r.post('/repair-languages', requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || 5000, 1), 20000);
  const result = backfillLanguages(limit);
  res.json(result);
});

export default r;
