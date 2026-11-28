import { Router } from 'express';
import { get, run, all } from '../db.js';
import { publicUser, err, now, id, parseJSON, slugify } from '../util.js';
import { requireAuth } from '../auth.js';
import { translateText, detectLanguage } from '../services/translate.js';

const r = Router();

const memberRole = (cid, uid) => get('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?', cid, uid)?.role;

function communityFor(c, viewerId) {
  const members = get('SELECT COUNT(*) c FROM community_members WHERE community_id = ?', c.id).c;
  return {
    id: c.id, name: c.name, slug: c.slug, description: c.description, avatar: c.avatar, cover: c.cover,
    category: c.category, privacy: c.privacy, ownerId: c.owner_id, createdAt: c.created_at, rules: c.rules,
    members, joined: viewerId ? !!get('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?', c.id, viewerId) : false,
    myRole: viewerId ? memberRole(c.id, viewerId) || null : null,
    conversationId: get('SELECT id FROM conversations WHERE community_id = ?', c.id)?.id || null,
  };
}

r.get('/', requireAuth, (req, res) => {
  const { q, category, privacy, feed } = req.query;

  /* -------------------------------------------------------------------------
     "For you"
     A ranked discovery feed, not a relabelled list. Before this there was no
     such endpoint at all — the client showed a "For you" tab that pointed at
     nothing, so the request fell through to a network error the user read as
     "server not found".

     Ranking is deliberately simple and explainable, because a black-box score
     is worse than a boring one:
       +40  same category as a community the viewer already belongs to
       +2/member (max 30)     — other people found it worth joining
       +5/post in last 30d (max 30) — it is actually alive
       -25  already joined    — discovery should surface something new
       -10  private           — cannot be browsed anyway
  ------------------------------------------------------------------------- */
  if (feed === 'for-you') {
    const uid = req.user.id;
    const mine = all(
      `SELECT c.category FROM community_members m JOIN communities c ON c.id = m.community_id WHERE m.user_id = ?`,
      uid,
    );
    const cats = new Set(mine.map((x) => x.category).filter(Boolean));
    const since = now() - 30 * 24 * 60 * 60 * 1000;

    const rows = all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM community_members mm WHERE mm.community_id = c.id) AS member_count,
              (SELECT COUNT(*) FROM community_posts p WHERE p.community_id = c.id AND p.created_at > ?) AS recent_posts
         FROM communities c`,
      since,
    );

    const ranked = rows
      .map((c) => {
        const joined = !!get('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?', c.id, uid);
        let score = 0;
        if (cats.has(c.category)) score += 40;
        score += Math.min(30, Number(c.member_count || 0) * 2);
        score += Math.min(30, Number(c.recent_posts || 0) * 5);
        if (joined) score -= 25;
        if (c.privacy === 'private') score -= 10;
        return { c, score };
      })
      .sort((a, b) => b.score - a.score || (b.c.created_at || 0) - (a.c.created_at || 0))
      .slice(0, 60)
      .map(({ c }) => communityFor(c, uid));

    return res.json({ communities: ranked, feed: 'for-you' });
  }

  let rows;
  if (q) rows = all('SELECT * FROM communities WHERE lower(name) LIKE ? OR lower(description) LIKE ? ORDER BY created_at DESC', `%${String(q).toLowerCase()}%`, `%${String(q).toLowerCase()}%`);
  else if (category) rows = all('SELECT * FROM communities WHERE category = ? ORDER BY created_at DESC', category);
  else if (privacy) rows = all('SELECT * FROM communities WHERE privacy = ? ORDER BY created_at DESC', privacy);
  else rows = all('SELECT * FROM communities ORDER BY created_at DESC LIMIT 60');
  res.json({ communities: rows.map(c => communityFor(c, req.user.id)) });
});

r.post('/', requireAuth, (req, res) => {
  const { name, description, category = 'Technology', privacy = 'public', avatar, cover, rules } = req.body || {};
  if (!name || String(name).trim().length < 3) return err(res, 400, 'Community name must be at least 3 characters');
  let slug = slugify(name);
  if (get('SELECT 1 FROM communities WHERE slug = ?', slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
  const cid = id('cm_');
  run('INSERT INTO communities (id, name, slug, description, avatar, cover, category, privacy, owner_id, created_at, rules) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    cid, name.trim(), slug, description || '', avatar || null, cover || null, category, privacy, req.user.id, now(), rules || null);
  run('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, req.user.id, 'owner', now());
  const convId = id('c_');
  run('INSERT INTO conversations (id, type, title, avatar, created_by, created_at, community_id) VALUES (?,?,?,?,?,?,?)', convId, 'group', name.trim(), avatar || null, req.user.id, now(), cid);
  run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', convId, req.user.id, 'owner', now());
  res.status(201).json({ community: communityFor(get('SELECT * FROM communities WHERE id = ?', cid), req.user.id) });
});

r.get('/:id', requireAuth, async (req, res) => {
  const c = get('SELECT * FROM communities WHERE id = ?', req.params.id);
  if (!c) return err(res, 404, 'Community not found');
  const joined = !!get('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?', c.id, req.user.id);
  if (c.privacy === 'private' && !joined) return res.json({ community: communityFor(c, req.user.id), posts: [], locked: true });
  const lang = req.user.language || 'en';
  const rows = all('SELECT * FROM community_posts WHERE community_id = ? ORDER BY created_at DESC LIMIT 50', c.id);
  const posts = await Promise.all(rows.map(async (p) => {
    const author = get('SELECT * FROM users WHERE id = ?', p.user_id);
    const anonymous = !!get('SELECT anonymous FROM community_members WHERE community_id = ? AND user_id = ?', c.id, p.user_id)?.anonymous;
    let display = p.body, translated = false;
    if (p.body && p.original_lang && p.original_lang !== lang) {
      const t = await translateText(p.body, p.original_lang, lang);
      display = t.text; translated = t.translated;
    }
    const poll = parseJSON(p.poll, null);
    if (poll) {
      const votes = all('SELECT option_index, COUNT(*) c FROM poll_votes WHERE post_id = ? GROUP BY option_index', p.id);
      poll.results = poll.options.map((_, i) => votes.find(v => v.option_index === i)?.c || 0);
      poll.myVote = get('SELECT option_index FROM poll_votes WHERE post_id = ? AND user_id = ?', p.id, req.user.id)?.option_index ?? null;
      poll.total = poll.results.reduce((a, b) => a + b, 0);
    }
    return {
      id: p.id, body: p.body, displayBody: display, translated, originalLang: p.original_lang,
      media: parseJSON(p.media, []), createdAt: p.created_at, type: p.type, poll, event: parseJSON(p.event, null),
      author: anonymous ? { id: 'anon', displayName: 'Anonymous member', avatar: null, temporaryIdentity: true } : publicUser(author, req.user.id),
    };
  }));
  const members = all('SELECT u.*, m.role, m.joined_at FROM community_members m JOIN users u ON u.id = m.user_id WHERE m.community_id = ? ORDER BY m.joined_at', c.id);
  res.json({
    community: communityFor(c, req.user.id), posts, locked: false,
    members: members.map(m => ({ ...publicUser(m, req.user.id), memberRole: m.role })),
  });
});

r.post('/:id/join', requireAuth, (req, res) => {
  const c = get('SELECT * FROM communities WHERE id = ?', req.params.id);
  if (!c) return err(res, 404, 'Community not found');
  const existing = get('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?', c.id, req.user.id);
  if (existing) {
    run('DELETE FROM community_members WHERE community_id = ? AND user_id = ?', c.id, req.user.id);
    return res.json({ joined: false });
  }
  run('INSERT INTO community_members (community_id, user_id, role, joined_at, anonymous) VALUES (?,?,?,?,?)', c.id, req.user.id, 'member', now(), req.body?.anonymous ? 1 : 0);
  const conv = get('SELECT * FROM conversations WHERE community_id = ?', c.id);
  if (conv && !get('SELECT 1 FROM participants WHERE conversation_id = ? AND user_id = ?', conv.id, req.user.id)) {
    run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', conv.id, req.user.id, 'member', now());
  }
  res.json({ joined: true });
});

r.post('/:id/posts', requireAuth, (req, res) => {
  const c = get('SELECT * FROM communities WHERE id = ?', req.params.id);
  if (!c) return err(res, 404, 'Community not found');
  const role = memberRole(c.id, req.user.id);
  if (!role) return err(res, 403, 'Join the community to post');
  const { body = '', type = 'discussion', poll, event, media = [] } = req.body || {};
  if (type === 'announcement' && !['owner', 'admin', 'moderator'].includes(role)) return err(res, 403, 'Only admins can post announcements');
  if (!body.trim() && !poll && !event) return err(res, 400, 'Write something first');
  const pid = id('cp_');
  run('INSERT INTO community_posts (id, community_id, user_id, body, original_lang, media, created_at, type, poll, event) VALUES (?,?,?,?,?,?,?,?,?,?)',
    pid, c.id, req.user.id, body, detectLanguage(body), JSON.stringify(media), now(), type,
    poll ? JSON.stringify({ question: poll.question, options: poll.options }) : null,
    event ? JSON.stringify(event) : null);
  res.status(201).json({ postId: pid });
});

r.post('/:id/posts/:pid/vote', requireAuth, (req, res) => {
  const p = get('SELECT * FROM community_posts WHERE id = ? AND community_id = ?', req.params.pid, req.params.id);
  if (!p) return err(res, 404, 'Post not found');
  const idx = Number(req.body?.optionIndex);
  const poll = parseJSON(p.poll, null);
  if (!poll || idx < 0 || idx >= poll.options.length) return err(res, 400, 'Invalid option');
  run('INSERT OR REPLACE INTO poll_votes (post_id, user_id, option_index, at) VALUES (?,?,?,?)', p.id, req.user.id, idx, now());
  const votes = all('SELECT option_index, COUNT(*) c FROM poll_votes WHERE post_id = ? GROUP BY option_index', p.id);
  res.json({ results: poll.options.map((_, i) => votes.find(v => v.option_index === i)?.c || 0), myVote: idx });
});

r.patch('/:id/members/:uid', requireAuth, (req, res) => {
  const c = get('SELECT * FROM communities WHERE id = ?', req.params.id);
  if (!c) return err(res, 404, 'Community not found');
  const role = memberRole(c.id, req.user.id);
  if (!['owner', 'admin'].includes(role)) return err(res, 403, 'Admins only');
  run('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?', req.body?.role || 'member', c.id, req.params.uid);
  res.json({ ok: true });
});

r.delete('/:id', requireAuth, (req, res) => {
  const c = get('SELECT * FROM communities WHERE id = ?', req.params.id);
  if (!c) return err(res, 404, 'Community not found');
  if (c.owner_id !== req.user.id && req.user.role !== 'admin') return err(res, 403, 'Not allowed');
  run('DELETE FROM communities WHERE id = ?', c.id);
  res.json({ ok: true });
});

export default r;
