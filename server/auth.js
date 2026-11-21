import jwt from 'jsonwebtoken';
import { get, run } from './db.js';
import { id, now, sha, err } from './util.js';
import { requestSave } from './services/persist.js';

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
  /* A new session is exactly the moment where losing the database would force
     someone to register again. Back it up now rather than up to 60s later. */
  requestSave();
  return { token: issueToken(user, sid), refreshToken: raw, sessionId: sid };
}

/* How long the previous refresh token keeps working after a rotation. Two
   tabs (or a retried request) can race on /auth/refresh; without this grace
   window the loser would be handed "refresh token invalid" and the person
   would be signed out for no reason. */
const ROTATE_GRACE_MS = 2 * 60 * 1000;

export function rotateSession(raw, req) {
  const hash = sha(raw);
  const s = get('SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0', hash);
  if (!s) {
    /* The token may be the one we just replaced. Re-issue an access token and
       hand back the same refresh token the caller already holds. */
    const prev = get('SELECT * FROM sessions WHERE prev_hash = ? AND revoked = 0', hash);
    if (!prev) return null;
    if (Date.now() - (prev.prev_at || 0) > ROTATE_GRACE_MS) return null;
    const user = get('SELECT * FROM users WHERE id = ?', prev.user_id);
    if (!user) return null;
    run('UPDATE sessions SET last_active = ? WHERE id = ?', now(), prev.id);
    requestSave();
    return { token: issueToken(user, prev.id), refreshToken: raw };
  }
  const user = get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!user) return null;
  const next = id('rt_');
  run('UPDATE sessions SET prev_hash = ?, prev_at = ?, token_hash = ?, last_active = ? WHERE id = ?',
    s.token_hash, now(), sha(next), now(), s.id);
  requestSave();
  return { token: issueToken(user, s.id), refreshToken: next };
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return err(res, 401, 'Authentication required');
  try {
    const p = jwt.verify(token, SECRET);
    const s = get('SELECT * FROM sessions WHERE id = ?', p.sid);
    if (!s) {
      /* The row is gone entirely: the database was reset, or the session was
         cleaned up. That is not the same thing as being signed out on purpose,
         so say so plainly instead of accusing the person of a revoked session. */
      return err(res, 401, 'Your session has expired. Please sign in again.', { code: 'session_expired' });
    }
    if (s.revoked) {
      return err(res, 401, 'This session was signed out. Please sign in again.', { code: 'session_revoked' });
    }
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
