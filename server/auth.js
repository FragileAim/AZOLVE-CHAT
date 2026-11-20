import jwt from 'jsonwebtoken';
import { get, run } from './db.js';
import { id, now, sha, err } from './util.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
export const ACCESS_TTL = '30d';

export function issueToken(user, sid) {
  return jwt.sign({ sub: user.id, sid, role: user.role }, SECRET, { expiresIn: ACCESS_TTL });
}

export function createSession(userId, req) {
  const sid = id('s_');
  const raw = id('rt_');
  const device = (req.headers['user-agent'] || 'Unknown device').slice(0, 180);
  run('INSERT INTO sessions (id, user_id, token_hash, device, ip, created_at, last_active) VALUES (?,?,?,?,?,?,?)',
    sid, userId, sha(raw), device, req.ip || '', now(), now());
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  return { token: issueToken(user, sid), refreshToken: raw, sessionId: sid };
}

export function rotateSession(raw, req) {
  const s = get('SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0', sha(raw));
  if (!s) return null;
  const user = get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!user) return null;
  const next = id('rt_');
  run('UPDATE sessions SET token_hash = ?, last_active = ? WHERE id = ?', sha(next), now(), s.id);
  return { token: issueToken(user, s.id), refreshToken: next };
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return err(res, 401, 'Authentication required');
  try {
    const p = jwt.verify(token, SECRET);
    const s = get('SELECT * FROM sessions WHERE id = ? AND revoked = 0', p.sid);
    if (!s) return err(res, 401, 'Session revoked');
    const user = get('SELECT * FROM users WHERE id = ?', p.sub);
    if (!user) return err(res, 401, 'User not found');
    if (user.status === 'suspended') return err(res, 403, 'Account suspended');
    req.user = user; req.sessionId = s.id;
    if (Date.now() - (s.last_active || 0) > 60000) run('UPDATE sessions SET last_active = ? WHERE id = ?', now(), s.id);
    run('UPDATE users SET last_seen = ? WHERE id = ?', now(), user.id);
    next();
  } catch {
    return err(res, 401, 'Invalid or expired token');
  }
}

export function optionalAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return next();
  try {
    const p = jwt.verify(h.slice(7), SECRET);
    const user = get('SELECT * FROM users WHERE id = ?', p.sub);
    if (user) { req.user = user; req.sessionId = p.sid; }
  } catch {}
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'moderator'].includes(req.user.role)) return err(res, 403, 'Admin access required');
    next();
  });
}

export function isBlocked(a, b) {
  return !!get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a);
}
