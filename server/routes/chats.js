import { Router } from 'express';
import { get, run, all } from '../db.js';
import { publicUser, err, now, id, parseJSON } from '../util.js';
import { requireAuth, isBlocked } from '../auth.js';
import { translateMessage, translateManyForViewer, detectLanguage } from '../services/translate.js';
import { deliverMessage, emitToConv, emitToUser } from '../realtime.js';
import { task } from '../services/ai.js';
import { areContacts, contactState } from './contacts.js';

const r = Router();

/* 10,000 characters is roughly 1,500 words — far beyond any real chat message,
   but small enough that storing, translating and fanning out a message stays
   cheap. Anything larger is a client bug or an abuse attempt. */
const MAX_MESSAGE_CHARS = 10000;

export function conversationFor(conv, viewerId) {
  const parts = all('SELECT p.*, u.display_name, u.username, u.avatar, u.language, u.last_seen FROM participants p JOIN users u ON u.id = p.user_id WHERE p.conversation_id = ?', conv.id);
  const me = parts.find(p => p.user_id === viewerId);
  const others = parts.filter(p => p.user_id !== viewerId);
  const last = get(`SELECT * FROM messages WHERE conversation_id = ? AND deleted = 0 AND (scheduled_for IS NULL OR scheduled_for <= ?)
                    ORDER BY created_at DESC LIMIT 1`, conv.id, now());
  const unread = me ? get('SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND created_at > ? AND sender_id != ? AND deleted = 0', conv.id, me.last_read_at || 0, viewerId).c : 0;
  return {
    id: conv.id, type: conv.type, title: conv.type === 'dm' ? (others[0]?.display_name || 'Direct message') : conv.title,
    avatar: conv.type === 'dm' ? others[0]?.avatar : conv.avatar,
    communityId: conv.community_id,
    wallpaper: conv.wallpaper, disappearSeconds: conv.disappear_seconds,
    muted: !!me?.muted, archived: !!me?.archived, pinned: !!me?.pinned, locked: !!me?.locked,
    languageOverride: me?.language_override || null,
    unread, lastMessageAt: last?.created_at || conv.created_at,
    lastMessage: last ? { id: last.id, body: last.body, type: last.type, senderId: last.sender_id, createdAt: last.created_at, originalLang: last.original_lang } : null,
    participants: parts.map(p => ({
      id: p.user_id, displayName: p.display_name, username: p.username, avatar: p.avatar, language: p.language,
      role: p.role, online: Date.now() - (p.last_seen || 0) < 70000, lastSeen: p.last_seen, lastReadAt: p.last_read_at,
    })),
    other: conv.type === 'dm' && others[0] ? { id: others[0].user_id, displayName: others[0].display_name, username: others[0].username, avatar: others[0].avatar, language: others[0].language, online: Date.now() - (others[0].last_seen || 0) < 70000, lastSeen: others[0].last_seen } : null,
  };
}

r.get('/', requireAuth, async (req, res) => {
  const rows = all(`SELECT c.* FROM conversations c JOIN participants p ON p.conversation_id = c.id
                    WHERE p.user_id = ? ORDER BY c.created_at DESC`, req.user.id);
  const convs = rows.map(c => conversationFor(c, req.user.id));
  const filtered = req.query.archived === 'true' ? convs.filter(c => c.archived) : convs.filter(c => !c.archived);
  filtered.sort((a, b) => (b.pinned - a.pinned) || (b.lastMessageAt - a.lastMessageAt));
  const lang = req.user.language || 'en';
  await Promise.all(filtered.map(async (c) => {
    if (!c.lastMessage || c.lastMessage.type !== 'text') return;
    const full = get('SELECT * FROM messages WHERE id = ?', c.lastMessage.id);
    if (!full) return;
    const t = await translateMessage({ ...full, original_body: full.original_body ?? full.body }, c.languageOverride || lang);
    c.lastMessage.displayBody = t.text;
    c.lastMessage.translated = t.translated;
  }));
  res.json({ conversations: filtered });
});

r.post('/dm', requireAuth, (req, res) => {
  const { userId } = req.body || {};
  const target = get('SELECT * FROM users WHERE id = ?', userId);
  if (!target) return err(res, 404, 'User not found');
  if (isBlocked(req.user.id, userId)) return err(res, 403, 'You cannot message this user');

  /* Talking requires an accepted contact request. A stranger can find you and
     send one request, but cannot open a conversation until you accept. */
  if (!areContacts(req.user.id, userId)) {
    const state = contactState(req.user.id, userId);
    return err(res, 403,
      state === 'pending_out'
        ? 'Your request is still waiting for them to accept.'
        : state === 'pending_in'
          ? 'They already asked to connect — accept their request to start chatting.'
          : 'Send a contact request first. Once they accept, you can chat and call.',
      { code: 'NOT_CONTACTS', contactState: state });
  }
  const existing = get(`SELECT c.* FROM conversations c
    JOIN participants a ON a.conversation_id = c.id AND a.user_id = ?
    JOIN participants b ON b.conversation_id = c.id AND b.user_id = ?
    WHERE c.type = 'dm' LIMIT 1`, req.user.id, userId);
  if (existing) return res.json({ conversation: conversationFor(existing, req.user.id) });
  const cid = id('c_');
  run('INSERT INTO conversations (id, type, created_by, created_at) VALUES (?,?,?,?)', cid, 'dm', req.user.id, now());
  run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, req.user.id, 'member', now());
  run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, userId, 'member', now());
  const conv = get('SELECT * FROM conversations WHERE id = ?', cid);
  emitToUser(userId, 'conversation:created', { conversationId: cid });
  res.status(201).json({ conversation: conversationFor(conv, req.user.id) });
});

r.post('/group', requireAuth, (req, res) => {
  const { title, userIds = [], languageOverride, avatar } = req.body || {};
  if (!title) return err(res, 400, 'Group title is required');
  const cid = id('c_');
  /* `avatar` is the URL returned by /api/ai/upload. Optional: a group with no
     photo falls back to the generated initials tile in the UI. */
  run('INSERT INTO conversations (id, type, title, avatar, created_by, created_at) VALUES (?,?,?,?,?,?)', cid, 'group', title, avatar || null, req.user.id, now());
  const members = [...new Set([req.user.id, ...userIds])];
  for (const uid of members) run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, uid, uid === req.user.id ? 'owner' : 'member', now());
  const conv = get('SELECT * FROM conversations WHERE id = ?', cid);
  for (const uid of members) if (uid !== req.user.id) emitToUser(uid, 'conversation:created', { conversationId: cid });
  res.status(201).json({ conversation: conversationFor(conv, req.user.id) });
});

r.get('/search', requireAuth, (req, res) => {
  const q = `%${String(req.query.q || '')}%`;
  const rows = all(`SELECT m.*, c.title, c.type FROM messages m JOIN conversations c ON c.id = m.conversation_id
    JOIN participants p ON p.conversation_id = c.id AND p.user_id = ?
    WHERE m.deleted = 0 AND (m.body LIKE ? OR m.original_body LIKE ?) ORDER BY m.created_at DESC LIMIT 60`, req.user.id, q, q);
  res.json({ messages: rows });
});

r.get('/:id', requireAuth, (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) return err(res, 404, 'Conversation not found');
  if (!get('SELECT 1 FROM participants WHERE conversation_id = ? AND user_id = ?', conv.id, req.user.id)) return err(res, 403, 'Not a participant');
  res.json({ conversation: conversationFor(conv, req.user.id) });
});

r.get('/:id/messages', requireAuth, (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) return err(res, 404, 'Conversation not found');
  const me = get('SELECT * FROM participants WHERE conversation_id = ? AND user_id = ?', conv.id, req.user.id);
  if (!me) return err(res, 403, 'Not a participant');
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const before = Number(req.query.before) || now() + 1;
  const rows = all(`SELECT * FROM messages WHERE conversation_id = ? AND created_at < ?
    AND (scheduled_for IS NULL OR scheduled_for <= ? OR sender_id = ?) ORDER BY created_at DESC LIMIT ?`, conv.id, before, now(), req.user.id, limit);
  const ordered = rows.reverse();
  const lang = me.language_override || req.user.language || 'en';
  translateManyForViewer(ordered.map(m => ({ ...m, original_body: m.original_body ?? m.body })), lang).then((translated) => {
    const withMeta = translated.map(m => {
      const reactions = all('SELECT emoji, user_id FROM reactions WHERE message_id = ?', m.id);
      const reply = m.reply_to ? get('SELECT id, body, sender_id, type FROM messages WHERE id = ?', m.reply_to) : null;
      const reads = all('SELECT user_id, state, at FROM receipts WHERE message_id = ?', m.id);
      return {
        id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, body: m.deleted ? '' : (m.body || ''),
        displayBody: m.deleted ? '' : (m.displayBody ?? m.body), translated: !!m.translated, displayLang: m.displayLang,
        originalBody: m.original_body ?? m.body, originalLang: m.original_lang,
        type: m.type, mediaUrl: m.media_url, mediaMeta: parseJSON(m.media_meta, null), replyTo: reply,
        createdAt: m.created_at, editedAt: m.edited_at, deleted: !!m.deleted, pinned: !!m.pinned,
        starred: parseJSON(m.starred, []).includes(req.user.id), scheduledFor: m.scheduled_for, silent: !!m.silent,
        location: parseJSON(m.location, null), contact: parseJSON(m.contact, null),
        reactions: reactions.reduce((acc, x) => { (acc[x.emoji] ||= []).push(x.user_id); return acc; }, {}),
        reads, clientId: m.client_id,
      };
    });
    res.json({ messages: withMeta, hasMore: rows.length === limit, viewerLanguage: lang });
  }).catch(e => err(res, 500, 'Could not load messages', { detail: e.message }));
});

r.post('/:id/messages', requireAuth, (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) return err(res, 404, 'Conversation not found');
  const me = get('SELECT * FROM participants WHERE conversation_id = ? AND user_id = ?', conv.id, req.user.id);
  if (!me) return err(res, 403, 'Not a participant');
  if (me.locked) return err(res, 423, 'This chat is locked. Unlock it to send messages.');

  /* Belt and braces: even if a DM row exists, a removed contact cannot keep
     writing into it. Group chats are open to all their members. */
  if (conv.type === 'dm') {
    const other = get('SELECT user_id FROM participants WHERE conversation_id = ? AND user_id != ? LIMIT 1', conv.id, req.user.id);
    if (other && !areContacts(req.user.id, other.user_id)) {
      return err(res, 403, 'You are no longer contacts with this person.', { code: 'NOT_CONTACTS' });
    }
  }
  const { body = '', type = 'text', mediaUrl, mediaMeta, replyTo, clientId, scheduledFor, silent, location, contact } = req.body || {};
  if (typeof body !== 'string') return err(res, 400, 'Message body must be text');
  if (!body.trim() && !mediaUrl && type === 'text') return err(res, 400, 'Message cannot be empty');
  // Without a ceiling a single request can store megabytes in the row, which
  // then has to be translated into 27 languages and shipped to every client.
  if (body.length > MAX_MESSAGE_CHARS) {
    return err(res, 413, `Message is too long (${body.length} characters, limit ${MAX_MESSAGE_CHARS})`);
  }
  const mid = id('m_');
  const lang = detectLanguage(body);
  run(`INSERT INTO messages (id, conversation_id, sender_id, body, original_body, original_lang, type, media_url, media_meta, reply_to, created_at, scheduled_for, silent, location, contact, client_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    mid, conv.id, req.user.id, body, body, lang, type, mediaUrl || null, mediaMeta ? JSON.stringify(mediaMeta) : null,
    replyTo || null, now(), scheduledFor || null, silent ? 1 : 0, location ? JSON.stringify(location) : null, contact ? JSON.stringify(contact) : null, clientId || null);
  const msg = get('SELECT * FROM messages WHERE id = ?', mid);
  res.status(201).json({ message: { ...msg, displayBody: body, clientId } });
  if (!scheduledFor || scheduledFor <= now()) {
    deliverMessage(msg, conv.id).catch(() => {});
    if (conv.disappear_seconds > 0) {
      setTimeout(() => run('UPDATE messages SET deleted = 1, body = \'\' WHERE id = ?', mid), conv.disappear_seconds * 1000);
    }
  }
});

r.patch('/:id/messages/:mid', requireAuth, (req, res) => {
  const m = get('SELECT * FROM messages WHERE id = ? AND conversation_id = ?', req.params.mid, req.params.id);
  if (!m) return err(res, 404, 'Message not found');
  if (m.sender_id !== req.user.id) return err(res, 403, 'You can only edit your own messages');
  if (Date.now() - m.created_at > 24 * 3600 * 1000) return err(res, 400, 'Messages can only be edited within 24 hours');
  const body = String(req.body?.body || '');
  if (!body.trim()) return err(res, 400, 'Message cannot be empty');
  run('UPDATE messages SET body = ?, original_body = ?, original_lang = ?, edited_at = ? WHERE id = ?', body, body, detectLanguage(body), now(), m.id);
  run('DELETE FROM translations WHERE message_id = ?', m.id);
  const updated = get('SELECT * FROM messages WHERE id = ?', m.id);
  emitToConv(req.params.id, 'message:updated', { message: updated, conversationId: req.params.id });
  deliverMessage(updated, req.params.id).catch(() => {});
  res.json({ message: updated });
});

r.delete('/:id/messages/:mid', requireAuth, (req, res) => {
  const m = get('SELECT * FROM messages WHERE id = ? AND conversation_id = ?', req.params.mid, req.params.id);
  if (!m) return err(res, 404, 'Message not found');
  if (m.sender_id !== req.user.id && req.user.role === 'user') return err(res, 403, 'You can only delete your own messages');
  run("UPDATE messages SET deleted = 1, body = '', original_body = '', media_url = NULL WHERE id = ?", m.id);
  emitToConv(req.params.id, 'message:deleted', { messageId: m.id, conversationId: req.params.id });
  res.json({ ok: true });
});

r.post('/:id/messages/:mid/react', requireAuth, (req, res) => {
  const { emoji } = req.body || {};
  if (!emoji) return err(res, 400, 'emoji required');
  const existing = get('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', req.params.mid, req.user.id, emoji);
  if (existing) run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', req.params.mid, req.user.id, emoji);
  else run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?,?,?,?)', req.params.mid, req.user.id, emoji, now());
  const reactions = all('SELECT emoji, user_id FROM reactions WHERE message_id = ?', req.params.mid)
    .reduce((acc, x) => { (acc[x.emoji] ||= []).push(x.user_id); return acc; }, {});
  emitToConv(req.params.id, 'message:reaction', { messageId: req.params.mid, reactions, conversationId: req.params.id });
  const m = get('SELECT sender_id FROM messages WHERE id = ?', req.params.mid);
  if (m && m.sender_id !== req.user.id) {
    run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id('n_'), m.sender_id, 'reaction', req.user.id, 'message', req.params.mid, `${req.user.display_name} reacted ${emoji} to your message`, now());
  }
  res.json({ reactions });
});

r.post('/:id/read', requireAuth, (req, res) => {
  run('UPDATE participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', now(), req.params.id, req.user.id);
  const ids = all('SELECT id FROM messages WHERE conversation_id = ? AND sender_id != ? AND created_at <= ?', req.params.id, req.user.id, now());
  for (const m of ids) run('INSERT OR REPLACE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)', m.id, req.user.id, 'read', now());
  emitToConv(req.params.id, 'read', { conversationId: req.params.id, userId: req.user.id, at: now() });
  res.json({ ok: true });
});

r.patch('/:id', requireAuth, (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) return err(res, 404, 'Conversation not found');
  const b = req.body || {};
  if (b.muted !== undefined) run('UPDATE participants SET muted = ? WHERE conversation_id = ? AND user_id = ?', b.muted ? 1 : 0, conv.id, req.user.id);
  if (b.archived !== undefined) run('UPDATE participants SET archived = ? WHERE conversation_id = ? AND user_id = ?', b.archived ? 1 : 0, conv.id, req.user.id);
  if (b.pinned !== undefined) run('UPDATE participants SET pinned = ? WHERE conversation_id = ? AND user_id = ?', b.pinned ? 1 : 0, conv.id, req.user.id);
  if (b.locked !== undefined) run('UPDATE participants SET locked = ? WHERE conversation_id = ? AND user_id = ?', b.locked ? 1 : 0, conv.id, req.user.id);
  if (b.languageOverride !== undefined) run('UPDATE participants SET language_override = ? WHERE conversation_id = ? AND user_id = ?', b.languageOverride || null, conv.id, req.user.id);
  if (b.wallpaper !== undefined) run('UPDATE conversations SET wallpaper = ? WHERE id = ?', b.wallpaper, conv.id);
  if (b.disappearSeconds !== undefined) run('UPDATE conversations SET disappear_seconds = ? WHERE id = ?', Number(b.disappearSeconds) || 0, conv.id);
  if (b.title && conv.type === 'group') run('UPDATE conversations SET title = ? WHERE id = ?', b.title, conv.id);
  if (b.avatar && conv.type === 'group') run('UPDATE conversations SET avatar = ? WHERE id = ?', b.avatar, conv.id);
  const updated = get('SELECT * FROM conversations WHERE id = ?', conv.id);
  emitToConv(conv.id, 'conversation:meta', { conversationId: conv.id, ...b });
  res.json({ conversation: conversationFor(updated, req.user.id) });
});

r.post('/:id/members', requireAuth, (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ? AND type = ?', req.params.id, 'group');
  if (!conv) return err(res, 404, 'Group not found');
  const me = get('SELECT * FROM participants WHERE conversation_id = ? AND user_id = ?', conv.id, req.user.id);
  if (!me || !['owner', 'admin'].includes(me.role)) return err(res, 403, 'Only admins can add members');
  for (const uid of req.body?.userIds || []) {
    if (!get('SELECT 1 FROM participants WHERE conversation_id = ? AND user_id = ?', conv.id, uid)) {
      run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', conv.id, uid, 'member', now());
      emitToUser(uid, 'conversation:created', { conversationId: conv.id });
    }
  }
  res.json({ conversation: conversationFor(conv, req.user.id) });
});

r.delete('/:id/members/:uid', requireAuth, (req, res) => {
  run('DELETE FROM participants WHERE conversation_id = ? AND user_id = ?', req.params.id, req.params.uid);
  emitToConv(req.params.id, 'conversation:meta', { conversationId: req.params.id });
  res.json({ ok: true });
});

r.post('/:id/messages/:mid/star', requireAuth, (req, res) => {
  const m = get('SELECT * FROM messages WHERE id = ?', req.params.mid);
  if (!m) return err(res, 404, 'Message not found');
  const starred = parseJSON(m.starred, []);
  const next = starred.includes(req.user.id) ? starred.filter(x => x !== req.user.id) : [...starred, req.user.id];
  run('UPDATE messages SET starred = ? WHERE id = ?', JSON.stringify(next), m.id);
  res.json({ starred: next.includes(req.user.id) });
});

r.post('/:id/messages/:mid/pin', requireAuth, (req, res) => {
  const m = get('SELECT * FROM messages WHERE id = ?', req.params.mid);
  if (!m) return err(res, 404, 'Message not found');
  run('UPDATE messages SET pinned = ? WHERE id = ?', m.pinned ? 0 : 1, m.id);
  emitToConv(req.params.id, 'message:pinned', { messageId: m.id, pinned: !m.pinned, conversationId: req.params.id });
  res.json({ pinned: !m.pinned });
});

r.get('/:id/starred', requireAuth, (req, res) => {
  const rows = all("SELECT * FROM messages WHERE conversation_id = ? AND starred LIKE ? AND deleted = 0 ORDER BY created_at DESC", req.params.id, `%${req.user.id}%`);
  res.json({ messages: rows });
});

r.get('/:id/summary', requireAuth, (req, res) => {
  const rows = all('SELECT sender_id, body FROM messages WHERE conversation_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 60', req.params.id).reverse();
  const text = rows.map(m => `${get('SELECT display_name FROM users WHERE id = ?', m.sender_id)?.display_name || 'User'}: ${m.body}`).join('\n');
  if (!text.trim()) return err(res, 400, 'Not enough messages to summarise');
  task({ kind: 'summarize', text, lang: req.user.language }).then(out => res.json({ summary: out.text, engine: out.engine }));
});

r.post('/:id/translate', requireAuth, (req, res) => {
  const { messageId, lang } = req.body || {};
  const m = get('SELECT * FROM messages WHERE id = ?', messageId);
  if (!m) return err(res, 404, 'Message not found');
  translateMessage({ ...m, original_body: m.original_body ?? m.body }, lang || req.user.language).then(t => res.json(t));
});

/** Delivers scheduled messages whose time has come. Called by the scheduler. */
export async function processScheduled() {
  const due = all('SELECT * FROM messages WHERE scheduled_for IS NOT NULL AND scheduled_for <= ?', now());
  for (const m of due) {
    run('UPDATE messages SET scheduled_for = NULL WHERE id = ?', m.id);
    await deliverMessage({ ...m, scheduled_for: null }, m.conversation_id).catch(() => {});
  }
  return due.length;
}

export default r;
