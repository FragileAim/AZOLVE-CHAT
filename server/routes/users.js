import { Router } from 'express';
import { get, run, all } from '../db.js';
import { publicUser, err, now, parseJSON, id } from '../util.js';
import { requireAuth, optionalAuth, isBlocked } from '../auth.js';
import { contactState } from './contacts.js';

const r = Router();

const UPDATABLE = {
  display_name: 'displayName', bio: 'bio', avatar: 'avatar', cover: 'cover', dob: 'dob',
  country: 'country', language: 'language', mood: 'mood', mood_text: 'moodText', username: 'username',
  is_private: 'isPrivate', temporary_identity: 'temporaryIdentity',
};

r.patch('/me', requireAuth, (req, res) => {
  const b = req.body || {};
  if (b.username) {
    const un = String(b.username).toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (un.length < 3) return err(res, 400, 'Username must be at least 3 characters (a-z, 0-9, _)');
    if (get('SELECT 1 FROM users WHERE username = ? AND id != ?', un, req.user.id)) return err(res, 409, 'That username is taken');
    b.username = un;
  }
  for (const [col, key] of Object.entries(UPDATABLE)) {
    if (b[key] !== undefined) {
      const val = typeof b[key] === 'boolean' ? (b[key] ? 1 : 0) : b[key];
      run(`UPDATE users SET ${col} = ? WHERE id = ?`, val, req.user.id);
    }
  }
  if (b.privacy) run('UPDATE users SET privacy = ? WHERE id = ?', JSON.stringify(b.privacy), req.user.id);
  if (b.prefs) {
    const cur = parseJSON(req.user.prefs, {});
    run('UPDATE users SET prefs = ? WHERE id = ?', JSON.stringify({ ...cur, ...b.prefs }), req.user.id);
  }
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(u, u.id) });
});

/* The signed-in user's own profile. `/auth/me` also returns this, but a client
   that only holds a user id should not have to guess a username to re-read
   itself. Declared before `/:username` so "me" is never treated as a handle. */
r.get('/me', requireAuth, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u) return err(res, 404, 'User not found');
  res.json({ user: publicUser(u, u.id) });
});

r.get('/search', requireAuth, (req, res) => {
  const q = `%${String(req.query.q || '').toLowerCase()}%`;
  const rows = all(`SELECT * FROM users WHERE status = 'active' AND (lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(bio) LIKE ?)
                    AND id != ? LIMIT 30`, q, q, q, req.user.id);
  res.json({ users: rows.filter(u => !isBlocked(req.user.id, u.id)).map(u => publicUser(u, req.user.id)) });
});

r.get('/suggestions', requireAuth, (req, res) => {
  const rows = all(`SELECT * FROM users u WHERE u.id != ? AND u.status = 'active'
    AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
    ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) DESC, u.created_at DESC LIMIT 12`, req.user.id, req.user.id);
  res.json({ users: rows.map(u => publicUser(u, req.user.id)) });
});

r.get('/:username', optionalAuth, (req, res) => {
  const u = get('SELECT * FROM users WHERE username = ?', req.params.username);
  if (!u) return err(res, 404, 'User not found');
  const viewer = req.user?.id || null;
  const blocked = viewer ? isBlocked(viewer, u.id) : false;
  const isFollowing = viewer ? !!get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', viewer, u.id) : false;
  const followsYou = viewer ? !!get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', u.id, viewer) : false;
  const counts = {
    followers: get('SELECT COUNT(*) c FROM follows WHERE following_id = ?', u.id).c,
    following: get('SELECT COUNT(*) c FROM follows WHERE follower_id = ?', u.id).c,
    posts: get("SELECT COUNT(*) c FROM posts WHERE user_id = ? AND privacy != 'private'", u.id).c,
  };
  const canView = !u.is_private || isFollowing || viewer === u.id;
  const posts = canView ? all("SELECT * FROM posts WHERE user_id = ? AND privacy != 'private' ORDER BY created_at DESC LIMIT 30", u.id) : [];
  const moments = all('SELECT * FROM moments WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC', u.id, now());
  const mutual = viewer ? all(`SELECT u.* FROM follows a JOIN follows b ON a.following_id = b.following_id
      JOIN users u ON u.id = a.following_id WHERE a.follower_id = ? AND b.follower_id = ? LIMIT 6`, viewer, u.id).map(x => publicUser(x, viewer)) : [];
  res.json({
    user: publicUser(u, viewer), counts, isFollowing, followsYou, blocked, canView,
    contactState: viewer ? contactState(viewer, u.id) : 'none',
    posts: posts.map(p => ({
      ...p,
      media: parseJSON(p.media, []),
      likes: get('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?', p.id).c,
      comments: get('SELECT COUNT(*) c FROM post_comments WHERE post_id = ?', p.id).c,
      liked: viewer ? !!get('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?', p.id, viewer) : false,
    })),
    moments, mutual,
  });
});

r.post('/:id/follow', requireAuth, (req, res) => {
  if (req.params.id === req.user.id) return err(res, 400, 'You cannot follow yourself');
  const target = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return err(res, 404, 'User not found');
  const existing = get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', req.user.id, req.params.id);
  if (existing) {
    run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', req.user.id, req.params.id);
    return res.json({ following: false });
  }
  run('INSERT INTO follows (follower_id, following_id, at) VALUES (?,?,?)', req.user.id, req.params.id, now());
  run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id('n_'), req.params.id, 'follow', req.user.id, 'user', req.user.id, `${req.user.display_name} started following you`, now());
  res.json({ following: true });
});

r.get('/:id/followers', requireAuth, (req, res) => {
  const rows = all('SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ? LIMIT 100', req.params.id);
  res.json({ users: rows.map(u => publicUser(u, req.user.id)) });
});
r.get('/:id/following', requireAuth, (req, res) => {
  const rows = all('SELECT u.* FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ? LIMIT 100', req.params.id);
  res.json({ users: rows.map(u => publicUser(u, req.user.id)) });
});

r.post('/:id/block', requireAuth, (req, res) => {
  if (req.params.id === req.user.id) return err(res, 400, 'You cannot block yourself');
  if (get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, req.params.id)) {
    run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, req.params.id);
    return res.json({ blocked: false });
  }
  run('INSERT INTO blocks (blocker_id, blocked_id, at) VALUES (?,?,?)', req.user.id, req.params.id, now());
  run('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)', req.user.id, req.params.id, req.params.id, req.user.id);
  res.json({ blocked: true });
});

r.post('/:id/report', requireAuth, (req, res) => {
  run('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, created_at) VALUES (?,?,?,?,?,?,?)',
    id('rp_'), req.user.id, req.body?.targetType || 'user', req.params.id, req.body?.reason || 'other', req.body?.details || '', now());
  res.json({ ok: true });
});

r.get('/me/export', requireAuth, (req, res) => {
  const uid = req.user.id;
  const data = {
    exportedAt: new Date().toISOString(),
    account: publicUser(req.user, uid),
    messages: all('SELECT * FROM messages WHERE sender_id = ? ORDER BY created_at', uid),
    posts: all('SELECT * FROM posts WHERE user_id = ?', uid),
    moments: all('SELECT * FROM moments WHERE user_id = ?', uid),
    comments: all('SELECT * FROM post_comments WHERE user_id = ?', uid),
    follows: all('SELECT * FROM follows WHERE follower_id = ?', uid),
    sessions: all('SELECT id, device, ip, created_at, last_active FROM sessions WHERE user_id = ?', uid),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="azolve-export.json"');
  res.json(data);
});

r.delete('/me', requireAuth, (req, res) => {
  if (req.body?.confirm !== 'DELETE') return err(res, 400, 'Type DELETE to confirm account deletion');
  run("UPDATE users SET status = 'deleted', email = NULL, phone = NULL, username = ?, display_name = 'Deleted account', bio = '', avatar = NULL WHERE id = ?", `deleted_${req.user.id.slice(-6)}`, req.user.id);
  run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

export default r;
