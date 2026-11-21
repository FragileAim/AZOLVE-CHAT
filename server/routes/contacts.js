import { Router } from 'express';
import { get, run, all } from '../db.js';
import { publicUser, err, now, id, parseJSON } from '../util.js';
import { requireAuth, isBlocked } from '../auth.js';
import { emitToUser } from '../realtime.js';

const r = Router();

/* ---------------------------------------------------------------------------
   Contact requests.

   Everybody can find everybody — the directory lists every active account — but
   a conversation only opens after the other person accepts. Until then a
   stranger can send exactly one request and nothing else: no DM, no message, no
   call. This is enforced on the server, not just hidden in the UI.
--------------------------------------------------------------------------- */

/** True when the two people have accepted each other. */
export function areContacts(a, b) {
  if (!a || !b || a === b) return false;
  return !!get('SELECT 1 FROM contacts WHERE owner_id = ? AND peer_id = ?', a, b);
}

/** pending_out | pending_in | contact | blocked | none */
export function contactState(viewerId, otherId) {
  if (!viewerId || !otherId || viewerId === otherId) return 'self';
  if (isBlocked(viewerId, otherId) || isBlocked(otherId, viewerId)) return 'blocked';
  if (areContacts(viewerId, otherId)) return 'contact';
  const out = get(`SELECT 1 FROM contact_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`, viewerId, otherId);
  if (out) return 'pending_out';
  const inc = get(`SELECT 1 FROM contact_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`, otherId, viewerId);
  if (inc) return 'pending_in';
  return 'none';
}

const shape = (row, viewerId, state) => ({
  ...publicUser(row, viewerId),
  contactState: state,
});

/** The people you can actually talk to. */
r.get('/', requireAuth, (req, res) => {
  const rows = all(`SELECT u.*, c.created_at AS since FROM contacts c JOIN users u ON u.id = c.peer_id
                    WHERE c.owner_id = ? AND u.status = 'active'
                    ORDER BY lower(u.display_name)`, req.user.id);
  res.json({
    contacts: rows.map(u => ({ ...shape(u, req.user.id, 'contact'), since: u.since })),
  });
});

/** Incoming requests waiting on you, and requests you are waiting on. */
r.get('/requests', requireAuth, (req, res) => {
  const incoming = all(`SELECT q.*, u.* , q.id AS request_id, q.created_at AS requested_at
                        FROM contact_requests q JOIN users u ON u.id = q.from_id
                        WHERE q.to_id = ? AND q.status = 'pending' ORDER BY q.created_at DESC`, req.user.id);
  const outgoing = all(`SELECT q.*, u.*, q.id AS request_id, q.created_at AS requested_at
                        FROM contact_requests q JOIN users u ON u.id = q.to_id
                        WHERE q.from_id = ? AND q.status = 'pending' ORDER BY q.created_at DESC`, req.user.id);
  const map = (rows) => rows.map(u => ({
    requestId: u.request_id,
    note: u.note,
    requestedAt: u.requested_at,
    user: publicUser(u, req.user.id),
  }));
  res.json({ incoming: map(incoming), outgoing: map(outgoing) });
});

/**
 * Everyone on AZOLVE CHAT, with your relationship to each of them.
 * This is the "see everyone" directory — the gate is on talking, not on being
 * discoverable.
 */
/* Category chips on the People screen. There is no separate "interests" column,
   so a category matches the words people actually put in their bio, name or
   username. That keeps the filter honest: it never invents a match. */
const CATEGORY_WORDS = {
  music: ['music', 'musician', 'singer', 'song', 'guitar', 'piano', 'dj', 'band', 'producer', 'संगीत', 'música', 'musique'],
  travel: ['travel', 'traveller', 'traveler', 'backpack', 'wanderlust', 'flight', 'nomad', 'trip', 'यात्रा', 'viaje', 'voyage'],
  food: ['food', 'foodie', 'chef', 'cook', 'recipe', 'baking', 'coffee', 'restaurant', 'खाना', 'comida', 'cuisine'],
  gaming: ['game', 'gamer', 'gaming', 'esports', 'streamer', 'playstation', 'xbox', 'nintendo', 'गेम', 'juegos', 'jeu'],
};

r.get('/directory', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 40));
  const like = `%${q}%`;
  const tag = String(req.query.tag || '').trim().toLowerCase();
  const words = CATEGORY_WORDS[tag] || null;
  const tagSql = words
    ? ` AND (${words.map(() => `lower(display_name) LIKE ? OR lower(username) LIKE ? OR lower(bio) LIKE ?`).join(' OR ')})`
    : '';
  const tagArgs = words ? words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`]) : [];

  const rows = q
    ? all(`SELECT * FROM users WHERE status = 'active' AND id != ?
           AND (lower(display_name) LIKE ? OR lower(username) LIKE ? OR lower(bio) LIKE ? OR lower(country) LIKE ?)${tagSql}
           ORDER BY lower(display_name) LIMIT ?`, req.user.id, like, like, like, like, ...tagArgs, limit)
    : all(`SELECT * FROM users WHERE status = 'active' AND id != ?${tagSql}
           ORDER BY (last_seen IS NULL), last_seen DESC LIMIT ?`, req.user.id, ...tagArgs, limit);

  const contacts = new Set(all('SELECT peer_id FROM contacts WHERE owner_id = ?', req.user.id).map(x => x.peer_id));
  const outReq = new Set(all(`SELECT to_id FROM contact_requests WHERE from_id = ? AND status = 'pending'`, req.user.id).map(x => x.to_id));
  const inReq = new Set(all(`SELECT from_id FROM contact_requests WHERE to_id = ? AND status = 'pending'`, req.user.id).map(x => x.from_id));

  res.json({
    users: rows.filter(u => !isBlocked(req.user.id, u.id) && !isBlocked(u.id, req.user.id)).map(u => {
      const state = contacts.has(u.id) ? 'contact'
        : outReq.has(u.id) ? 'pending_out'
          : inReq.has(u.id) ? 'pending_in' : 'none';
      return shape(u, req.user.id, state);
    }),
  });
});

/** Relationship to one person, for profile buttons. */
r.get('/state/:userId', requireAuth, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.userId);
  if (!u) return err(res, 404, 'User not found');
  res.json({ state: contactState(req.user.id, u.id), user: publicUser(u, req.user.id) });
});

/** Send a request. One per direction; a repeat is treated as "already sent". */
r.post('/request', requireAuth, (req, res) => {
  const userId = String(req.body?.userId || '');
  const note = String(req.body?.note || '').slice(0, 200);
  const target = get('SELECT * FROM users WHERE id = ?', userId);
  if (!target) return err(res, 404, 'User not found');
  if (target.id === req.user.id) return err(res, 400, 'That is you.');
  if (target.status !== 'active') return err(res, 400, 'That account is not active.');
  if (isBlocked(req.user.id, target.id)) return err(res, 403, 'You cannot add this person.');
  if (isBlocked(target.id, req.user.id)) return err(res, 403, 'This person is not accepting requests.');

  if (areContacts(req.user.id, target.id)) {
    return res.json({ state: 'contact', already: true, message: 'You are already contacts.' });
  }

  /* If they already asked you, treat this as accepting instead of creating a
     second pending row that both sides would have to click through. */
  const theirs = get(`SELECT * FROM contact_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
    target.id, req.user.id);
  if (theirs) {
    run(`UPDATE contact_requests SET status = 'accepted', responded_at = ? WHERE id = ?`, now(), theirs.id);
    run('INSERT OR IGNORE INTO contacts (owner_id, peer_id, created_at) VALUES (?,?,?)', req.user.id, target.id, now());
    run('INSERT OR IGNORE INTO contacts (owner_id, peer_id, created_at) VALUES (?,?,?)', target.id, req.user.id, now());
    emitToUser(target.id, 'contact:accepted', { user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id), target.id) });
    return res.json({ state: 'contact', mutual: true, message: `You and ${target.display_name} are now contacts.` });
  }

  const dup = get(`SELECT * FROM contact_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
    req.user.id, target.id);
  if (dup) return res.json({ state: 'pending_out', already: true, requestId: dup.id, message: 'Request already sent.' });

  const rid = id('cr_');
  run(`INSERT INTO contact_requests (id, from_id, to_id, note, status, created_at) VALUES (?,?,?,?, 'pending', ?)`,
    rid, req.user.id, target.id, note || null, now());

  const me = get('SELECT * FROM users WHERE id = ?', req.user.id);
  run(`INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, read, created_at)
       VALUES (?,?,?,?,?,?,?,0,?)`,
    id('n_'), target.id, 'contact_request', req.user.id, 'user', req.user.id,
    `${me.display_name} wants to connect with you`, now());

  emitToUser(target.id, 'contact:request', {
    requestId: rid,
    note: note || null,
    from: publicUser(me, target.id),
  });

  res.status(201).json({ state: 'pending_out', requestId: rid, message: `Request sent to ${target.display_name}.` });
});

/** Accept or decline a request addressed to you. */
r.post('/respond', requireAuth, (req, res) => {
  const { requestId, action } = req.body || {};
  if (!['accept', 'decline', 'block'].includes(action)) return err(res, 400, 'action must be accept, decline or block');
  const q = get('SELECT * FROM contact_requests WHERE id = ?', String(requestId || ''));
  if (!q) return err(res, 404, 'That request no longer exists.');
  if (q.to_id !== req.user.id) return err(res, 403, 'That request is not addressed to you.');
  if (q.status !== 'pending') return err(res, 409, `That request was already ${q.status}.`);

  const from = get('SELECT * FROM users WHERE id = ?', q.from_id);

  if (action === 'accept') {
    run(`UPDATE contact_requests SET status = 'accepted', responded_at = ? WHERE id = ?`, now(), q.id);
    run('INSERT OR IGNORE INTO contacts (owner_id, peer_id, created_at) VALUES (?,?,?)', req.user.id, q.from_id, now());
    run('INSERT OR IGNORE INTO contacts (owner_id, peer_id, created_at) VALUES (?,?,?)', q.from_id, req.user.id, now());
    run(`INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, read, created_at)
         VALUES (?,?,?,?,?,?,?,0,?)`, id('n_'), q.from_id, 'contact_accepted', req.user.id, 'user', req.user.id,
      `${req.user.display_name} accepted your request`, now());
    emitToUser(q.from_id, 'contact:accepted', { user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id), q.from_id) });
    return res.json({ ok: true, state: 'contact', user: publicUser(from, req.user.id) });
  }

  if (action === 'block') {
    run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, at) VALUES (?,?,?)', req.user.id, q.from_id, now());
  }
  run(`UPDATE contact_requests SET status = ?, responded_at = ? WHERE id = ?`,
    action === 'block' ? 'declined' : 'declined', now(), q.id);
  res.json({ ok: true, state: action === 'block' ? 'blocked' : 'none' });
});

/** Cancel a request you sent. */
r.delete('/request/:id', requireAuth, (req, res) => {
  const q = get('SELECT * FROM contact_requests WHERE id = ?', req.params.id);
  if (!q) return err(res, 404, 'Request not found');
  if (q.from_id !== req.user.id) return err(res, 403, 'Not your request');
  run(`UPDATE contact_requests SET status = 'cancelled', responded_at = ? WHERE id = ?`, now(), q.id);
  res.json({ ok: true });
});

/** Remove someone from your contacts. Their side keeps theirs, like a phone. */
r.delete('/:userId', requireAuth, (req, res) => {
  run('DELETE FROM contacts WHERE owner_id = ? AND peer_id = ?', req.user.id, req.params.userId);
  res.json({ ok: true });
});

export default r;
