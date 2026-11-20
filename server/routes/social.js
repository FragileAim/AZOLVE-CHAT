import { Router } from 'express';
import { get, run, all } from '../db.js';
import { publicUser, err, now, id, parseJSON } from '../util.js';
import { requireAuth, optionalAuth, isBlocked } from '../auth.js';
import { translateText, detectLanguage } from '../services/translate.js';
import { emitToUser } from '../realtime.js';

const r = Router();

function postFor(p, viewerId, lang) {
  const author = get('SELECT * FROM users WHERE id = ?', p.user_id);
  return {
    id: p.id, caption: p.caption, originalLang: p.original_lang, media: parseJSON(p.media, []),
    location: p.location, privacy: p.privacy, type: p.type, createdAt: p.created_at,
    likes: p.likes_count, comments: p.comments_count,
    liked: viewerId ? !!get('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?', p.id, viewerId) : false,
    saved: viewerId ? !!get('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?', p.id, viewerId) : false,
    author: publicUser(author, viewerId),
  };
}

async function localize(posts, lang) {
  return Promise.all(posts.map(async (p) => {
    if (!p.caption || !lang || p.originalLang === lang) return p;
    const t = await translateText(p.caption, p.originalLang || detectLanguage(p.caption), lang);
    return { ...p, displayCaption: t.text, translated: t.translated };
  }));
}

r.get('/feed', requireAuth, async (req, res) => {
  const lang = req.user.language || 'en';
  const rows = all(`SELECT * FROM posts WHERE privacy != 'private' AND user_id IN
      (SELECT following_id FROM follows WHERE follower_id = ?) OR user_id = ?
      ORDER BY created_at DESC LIMIT 40`, req.user.id, req.user.id);
  const posts = rows.filter(p => !isBlocked(req.user.id, p.user_id)).map(p => postFor(p, req.user.id, lang));
  res.json({ posts: await localize(posts, lang) });
});

r.get('/explore', requireAuth, async (req, res) => {
  const lang = req.user.language || 'en';
  const { hashtag, language, type } = req.query;
  let rows;
  if (hashtag) rows = all("SELECT * FROM posts WHERE privacy = 'public' AND lower(caption) LIKE ? ORDER BY created_at DESC LIMIT 40", `%#${String(hashtag).toLowerCase()}%`);
  else if (language) rows = all("SELECT * FROM posts WHERE privacy = 'public' AND original_lang = ? ORDER BY created_at DESC LIMIT 40", language);
  else if (type) rows = all("SELECT * FROM posts WHERE privacy = 'public' AND type = ? ORDER BY likes_count DESC LIMIT 40", type);
  else rows = all("SELECT * FROM posts WHERE privacy = 'public' ORDER BY (likes_count * 3 + comments_count * 2) DESC, created_at DESC LIMIT 40");
  const posts = rows.filter(p => !isBlocked(req.user.id, p.user_id)).map(p => postFor(p, req.user.id, lang));
  res.json({ posts: await localize(posts, lang) });
});

r.get('/trending', requireAuth, (req, res) => {
  const rows = all("SELECT caption, original_lang FROM posts WHERE created_at > ?", now() - 30 * 864e5);
  const counts = new Map();
  for (const row of rows) {
    for (const tag of (row.caption || '').match(/#[\p{L}\p{N}_]+/gu) || []) {
      const key = tag.toLowerCase();
      const cur = counts.get(key) || { tag: key, posts: 0, languages: new Set() };
      cur.posts++; cur.languages.add(row.original_lang); counts.set(key, cur);
    }
  }
  res.json({ trending: [...counts.values()].sort((a, b) => b.posts - a.posts).slice(0, 12).map(t => ({ tag: t.tag, posts: t.posts, languages: [...t.languages] })) });
});

r.post('/posts', requireAuth, (req, res) => {
  const { caption = '', media = [], location, privacy = 'public', type = 'post' } = req.body || {};
  if (!caption.trim() && !media.length) return err(res, 400, 'Add a caption or media');
  const pid = id('p_');
  run('INSERT INTO posts (id, user_id, caption, original_lang, media, location, privacy, type, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    pid, req.user.id, caption, detectLanguage(caption), JSON.stringify(media), location || null, privacy, type, now());
  const p = get('SELECT * FROM posts WHERE id = ?', pid);
  const followers = all('SELECT follower_id FROM follows WHERE following_id = ?', req.user.id);
  for (const f of followers) {
    run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id('n_'), f.follower_id, 'post', req.user.id, 'post', pid, `${req.user.display_name} shared a new post`, now());
    emitToUser(f.follower_id, 'post:new', { postId: pid });
  }
  res.status(201).json({ post: postFor(p, req.user.id, req.user.language) });
});

r.delete('/posts/:id', requireAuth, (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', req.params.id);
  if (!p) return err(res, 404, 'Post not found');
  if (p.user_id !== req.user.id && !['admin', 'moderator'].includes(req.user.role)) return err(res, 403, 'Not allowed');
  run('DELETE FROM posts WHERE id = ?', p.id);
  run('DELETE FROM post_comments WHERE post_id = ?', p.id);
  run('DELETE FROM post_likes WHERE post_id = ?', p.id);
  res.json({ ok: true });
});

r.post('/posts/:id/like', requireAuth, (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', req.params.id);
  if (!p) return err(res, 404, 'Post not found');
  const liked = get('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
  if (liked) {
    run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
    run('UPDATE posts SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?', p.id);
  } else {
    run('INSERT INTO post_likes (post_id, user_id, at) VALUES (?,?,?)', p.id, req.user.id, now());
    run('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', p.id);
    if (p.user_id !== req.user.id) {
      run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
        id('n_'), p.user_id, 'like', req.user.id, 'post', p.id, `${req.user.display_name} liked your post`, now());
      emitToUser(p.user_id, 'notification', { type: 'like', postId: p.id });
    }
  }
  res.json({ liked: !liked, likes: get('SELECT likes_count c FROM posts WHERE id = ?', p.id).c });
});

r.post('/posts/:id/save', requireAuth, (req, res) => {
  const saved = get('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?', req.params.id, req.user.id);
  if (saved) run('DELETE FROM post_saves WHERE post_id = ? AND user_id = ?', req.params.id, req.user.id);
  else run('INSERT INTO post_saves (post_id, user_id, at) VALUES (?,?,?)', req.params.id, req.user.id, now());
  res.json({ saved: !saved });
});

r.get('/saved', requireAuth, async (req, res) => {
  const rows = all('SELECT p.* FROM post_saves s JOIN posts p ON p.id = s.post_id WHERE s.user_id = ? ORDER BY s.at DESC', req.user.id);
  res.json({ posts: await localize(rows.map(p => postFor(p, req.user.id, req.user.language)), req.user.language) });
});

r.get('/posts/:id/comments', requireAuth, async (req, res) => {
  const rows = all('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 200', req.params.id);
  const lang = req.user.language || 'en';
  const comments = await Promise.all(rows.map(async (c) => {
    const author = get('SELECT * FROM users WHERE id = ?', c.user_id);
    let display = c.body, translated = false;
    if (c.original_lang && c.original_lang !== lang) {
      const t = await translateText(c.body, c.original_lang, lang);
      display = t.text; translated = t.translated;
    }
    return { id: c.id, body: c.body, displayBody: display, translated, originalLang: c.original_lang, createdAt: c.created_at, author: publicUser(author, req.user.id) };
  }));
  res.json({ comments });
});

r.post('/posts/:id/comments', requireAuth, (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', req.params.id);
  if (!p) return err(res, 404, 'Post not found');
  const body = String(req.body?.body || '').trim();
  if (!body) return err(res, 400, 'Comment cannot be empty');
  const cid = id('cm_');
  run('INSERT INTO post_comments (id, post_id, user_id, body, original_lang, created_at, parent_id) VALUES (?,?,?,?,?,?,?)',
    cid, p.id, req.user.id, body, detectLanguage(body), now(), req.body?.parentId || null);
  run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', p.id);
  if (p.user_id !== req.user.id) {
    run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id('n_'), p.user_id, 'comment', req.user.id, 'post', p.id, `${req.user.display_name} commented on your post`, now());
  }
  res.status(201).json({ comment: { id: cid, body, createdAt: now(), author: publicUser(req.user, req.user.id) } });
});

/* ------------------------------- MOMENTS ---------------------------------- */
r.get('/moments', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM moments WHERE expires_at > ? ORDER BY created_at ASC', now());
  const byUser = new Map();
  for (const m of rows) {
    if (isBlocked(req.user.id, m.user_id)) continue;
    const hideFrom = parseJSON(m.hide_from, []);
    if (hideFrom.includes(req.user.id)) continue;
    if (m.audience === 'private' && m.user_id !== req.user.id) continue;
    if (m.audience === 'followers' && m.user_id !== req.user.id && !get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', req.user.id, m.user_id)) continue;
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    const viewed = !!get('SELECT 1 FROM moment_views WHERE moment_id = ? AND user_id = ?', m.id, req.user.id);
    byUser.get(m.user_id).push({ ...m, viewed, hideFrom: undefined });
  }
  const groups = [...byUser.entries()].map(([userId, moments]) => ({
    user: publicUser(get('SELECT * FROM users WHERE id = ?', userId), req.user.id), moments,
    allViewed: moments.every(m => m.viewed),
  })).sort((a, b) => (a.allViewed - b.allViewed) || (b.moments.at(-1).created_at - a.moments.at(-1).created_at));
  res.json({ groups });
});

r.post('/moments', requireAuth, (req, res) => {
  const { type = 'image', mediaUrl, text, bg, caption, location, audience = 'followers', music, hideFrom = [], aiGenerated } = req.body || {};
  if (!mediaUrl && !text) return err(res, 400, 'Add media or text to your Moment');
  const mid = id('mo_');
  run(`INSERT INTO moments (id, user_id, type, media_url, text, bg, caption, location, audience, expires_at, created_at, music, ai_generated, hide_from)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    mid, req.user.id, type, mediaUrl || null, text || null, bg || null, caption || null, location || null,
    audience, now() + 24 * 3600 * 1000, now(), music || null, aiGenerated ? 1 : 0, JSON.stringify(hideFrom));
  const followers = all('SELECT follower_id FROM follows WHERE following_id = ?', req.user.id);
  for (const f of followers) emitToUser(f.follower_id, 'moment:new', { momentId: mid, userId: req.user.id });
  res.status(201).json({ moment: get('SELECT * FROM moments WHERE id = ?', mid) });
});

r.post('/moments/:id/view', requireAuth, (req, res) => {
  run('INSERT OR REPLACE INTO moment_views (moment_id, user_id, at) VALUES (?,?,?)', req.params.id, req.user.id, now());
  res.json({ ok: true });
});

r.post('/moments/:id/react', requireAuth, (req, res) => {
  const { emoji = '❤️' } = req.body || {};
  run('INSERT OR REPLACE INTO moment_reactions (moment_id, user_id, emoji, at) VALUES (?,?,?,?)', req.params.id, req.user.id, emoji, now());
  const m = get('SELECT * FROM moments WHERE id = ?', req.params.id);
  if (m && m.user_id !== req.user.id) {
    run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id('n_'), m.user_id, 'moment_reaction', req.user.id, 'moment', m.id, `${req.user.display_name} reacted ${emoji} to your Moment`, now());
  }
  res.json({ ok: true });
});

r.post('/moments/:id/reply', requireAuth, (req, res) => {
  const m = get('SELECT * FROM moments WHERE id = ?', req.params.id);
  if (!m) return err(res, 404, 'Moment not found');
  const body = String(req.body?.body || '').trim();
  if (!body) return err(res, 400, 'Reply cannot be empty');
  let conv = get(`SELECT c.* FROM conversations c JOIN participants a ON a.conversation_id = c.id AND a.user_id = ?
    JOIN participants b ON b.conversation_id = c.id AND b.user_id = ? WHERE c.type = 'dm' LIMIT 1`, req.user.id, m.user_id);
  if (!conv) {
    const cid = id('c_');
    run('INSERT INTO conversations (id, type, created_by, created_at) VALUES (?,?,?,?)', cid, 'dm', req.user.id, now());
    run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, req.user.id, 'member', now());
    run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, m.user_id, 'member', now());
    conv = get('SELECT * FROM conversations WHERE id = ?', cid);
  }
  const mid = id('m_');
  run(`INSERT INTO messages (id, conversation_id, sender_id, body, original_body, original_lang, type, created_at)
       VALUES (?,?,?,?,?,?,?,?)`, mid, conv.id, req.user.id, body, body, detectLanguage(body), 'text', now());
  res.status(201).json({ conversationId: conv.id, messageId: mid });
});

r.get('/moments/:id/viewers', requireAuth, (req, res) => {
  const m = get('SELECT * FROM moments WHERE id = ?', req.params.id);
  if (!m) return err(res, 404, 'Moment not found');
  if (m.user_id !== req.user.id) return err(res, 403, 'Only the creator can see viewers');
  const rows = all('SELECT u.*, v.at FROM moment_views v JOIN users u ON u.id = v.user_id WHERE v.moment_id = ? ORDER BY v.at DESC', m.id);
  const reactions = all('SELECT emoji, COUNT(*) c FROM moment_reactions WHERE moment_id = ? GROUP BY emoji', m.id);
  res.json({ viewers: rows.map(u => ({ ...publicUser(u, req.user.id), viewedAt: u.at })), reactions });
});

r.post('/moments/:id/highlight', requireAuth, (req, res) => {
  const m = get('SELECT * FROM moments WHERE id = ?', req.params.id);
  if (!m || m.user_id !== req.user.id) return err(res, 403, 'Not allowed');
  const hid = id('h_');
  run('INSERT INTO highlights (id, user_id, title, cover, moment_ids, created_at) VALUES (?,?,?,?,?,?)',
    hid, req.user.id, req.body?.title || 'Highlight', m.media_url, JSON.stringify([m.id]), now());
  res.status(201).json({ ok: true, highlightId: hid });
});

r.get('/highlights/:userId', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM highlights WHERE user_id = ? ORDER BY created_at DESC', req.params.userId);
  res.json({ highlights: rows.map(h => ({ ...h, momentIds: parseJSON(h.moment_ids, []) })) });
});

r.delete('/moments/:id', requireAuth, (req, res) => {
  const m = get('SELECT * FROM moments WHERE id = ?', req.params.id);
  if (!m) return err(res, 404, 'Moment not found');
  if (m.user_id !== req.user.id) return err(res, 403, 'Not allowed');
  run('DELETE FROM moments WHERE id = ?', m.id);
  res.json({ ok: true });
});

export default r;
