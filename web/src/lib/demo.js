/**
 * AZOLVE CHAT — preview runtime.
 *
 * This module is only loaded when the app is built with VITE_DEMO=1.
 * It replaces window.fetch for /api/* with an in-memory implementation backed by
 * a snapshot of the real API (demo-data.json). Reads return exactly the shapes the
 * live server returns; writes mutate the snapshot in this browser tab only.
 *
 * Nothing here runs in the production build.
 */
import raw from './demo-data.json';

const PASSWORD = 'Azolve@2025';
const UID_KEY = 'azolve.demo.uid';
const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => Date.now();
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

const state = clone(raw);

/* ------------------------------------------------------------------ helpers */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const fail = (status, error) => json({ error }, status);

function currentUid() {
  const t = localStorage.getItem('azolve.token') || '';
  if (t.startsWith('demo.')) return t.slice(5);
  return localStorage.getItem(UID_KEY) || null;
}
function entry(uid) {
  return state.byUser[uid] || null;
}
function meOf(uid) {
  return state.byUser[uid]?.me || null;
}
function accountBy(ident) {
  const q = String(ident || '').trim().toLowerCase();
  return state.accounts.find(
    (a) => a.username.toLowerCase() === q || a.email.toLowerCase() === q || a.key === q || a.displayName.toLowerCase() === q,
  );
}
function sessionFor(uid) {
  const me = meOf(uid);
  return {
    token: `demo.${uid}`,
    refreshToken: `demo-refresh.${uid}`,
    user: me,
    needsOnboarding: !me?.country || !me?.bio,
  };
}

/* --------------------------------------------------------- conversation data */

function convEntry(uid, cid) {
  return state.byUser[uid]?.convs?.[cid] || null;
}

function lastMessageOf(msgs) {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m.scheduledFor && m.scheduledFor > now()) continue;
    return m;
  }
  return null;
}

function listItem(uid, c) {
  const conv = c.conversation;
  const last = lastMessageOf(c.messages);
  const parts = (c.participants && c.participants.length ? c.participants : conv.participants) || [];
  const other = conv.type === 'dm' ? parts.find((p) => p.id !== uid) : null;
  return {
    ...conv,
    title: conv.type === 'dm' ? other?.displayName || conv.title || 'Direct message' : conv.title,
    avatar: conv.type === 'dm' ? other?.avatar || conv.avatar : conv.avatar,
    other: other || null,
    participants: parts,
    unread: conv.unread || 0,
    lastMessageAt: last?.createdAt || conv.lastMessageAt || conv.createdAt,
    lastMessage: last
      ? {
          id: last.id,
          body: last.originalBody || last.body,
          type: last.type,
          senderId: last.senderId,
          createdAt: last.createdAt,
          originalLang: last.originalLang,
          displayBody: last.displayBody,
          translated: last.translated,
        }
      : null,
  };
}

function chatList(uid, archived) {
  const u = entry(uid);
  if (!u) return { conversations: [] };
  const rows = Object.values(u.convs)
    .filter((c) => !!c.conversation.archived === !!archived)
    .map((c) => listItem(uid, c));
  rows.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  return { conversations: rows };
}

/** Apply a mutation to every account that can see this conversation. */
function eachConv(cid, fn) {
  for (const u of Object.values(state.byUser)) {
    const c = u.convs?.[cid];
    if (c) fn(c, u);
  }
}

/* ---------------------------------------------------------------- social data */

function allPostBuckets() {
  const buckets = [state.social?.feed?.posts, state.social?.explore?.posts];
  for (const p of Object.values(state.profiles)) buckets.push(p.posts);
  return buckets.filter(Boolean);
}
function findPost(id) {
  for (const b of allPostBuckets()) {
    const p = b.find((x) => x.id === id);
    if (p) return p;
  }
  return null;
}
function touchPost(id, fn) {
  for (const b of allPostBuckets()) b.forEach((p) => p.id === id && fn(p));
}

function allMoments() {
  return (state.social?.moments?.groups || []).flatMap((g) => g.moments || []);
}
function findMoment(id) {
  return allMoments().find((m) => m.id === id) || null;
}

/* ------------------------------------------------------------------ AI local */

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function localTask(kind, text) {
  const body = String(text || '').trim();
  const first = sentences(body)[0] || body;
  switch (kind) {
    case 'summarize':
    case 'summarise': {
      const pts = sentences(body).slice(0, 5);
      if (!pts.length) return 'Paste the conversation or text you want summarised and I will pull out the key points.';
      const head = pts.length === 1 ? pts[0] : pts.map((s) => `• ${s}`).join('\n');
      return `Here is the short version:\n\n${head}\n\nIn one line: ${pts[0]}`;
    }
    case 'caption': {
      const seed = first.replace(/[.!?]+$/, '');
      return `${seed ? `${seed[0].toUpperCase()}${seed.slice(1)}.` : 'A small moment worth keeping.'} ✨`;
    }
    case 'hashtags': {
      const words = body.toLowerCase().match(/[a-z\u00C0-\u024F]{4,}/g) || [];
      const tags = [...new Set(words)].slice(0, 5).map((w) => `#${w}`);
      return tags.length ? tags.join(' ') : '#azolve #moments #global';
    }
    case 'translate':
      return `${body}\n\n— Preview engine: seeded conversations show full per-recipient translation. New text is translated by the live provider chain when the backend is running.`;
    case 'replies':
      return `1. Sounds good — let's do it.\n2. Thanks for sharing, I'll take a look today.\n3. Could you send a little more detail?`;
    case 'improve':
      return `${body.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim()}${/[.!?]$/.test(body) ? '' : '.'}`;
    default:
      return body;
  }
}

function localChat(message) {
  const p = String(message || '').toLowerCase();
  if (/summar/.test(p)) return localTask('summarize', message.replace(/^.*?summar\w*\s*/i, ''));
  if (/translat/.test(p)) return 'I translate every message per recipient, keeping the original untouched. Open any seeded chat and tap “See original” to compare.';
  if (/hello|hi\b|hey|namaste|hola/.test(p)) return 'Hello! I am AZOLVE AI. I can summarise a thread, rewrite a message, draft a caption, or explain a feature. What would you like to do?';
  if (/feature|what can you|help/.test(p)) return 'I can summarise conversations, rewrite in a different tone, translate, draft captions and hashtags, suggest replies, and explain how AZOLVE CHAT works.';
  return `Here is what I can tell you about “${String(message).slice(0, 120)}”: this preview runs the same deterministic local engine as the live server when no model key is configured. Add an OpenAI, Anthropic, Gemini or Groq key to route these answers through a hosted model.`;
}

/* ------------------------------------------------------------------- routing */

function parse(path) {
  const [p, qs] = path.split('?');
  return { parts: p.split('/').filter(Boolean), query: new URLSearchParams(qs || '') };
}

async function handle(method, url, body) {
  const { parts, query } = parse(url.replace(/^\/api/, ''));
  const uid = currentUid();
  const me = meOf(uid);
  const [a, b, c, d, e] = parts;
  const route = `${method} /${parts.join('/')}`;

  /* ---------------------------------------------------------------- auth */
  /* Preview-only phone sign-up. The real server sends an SMS; here the code
     is always 123456 and is echoed so the flow stays clickable offline. */
  if (route === 'POST /auth/phone/start') {
    const phone = String(body?.phone || '').replace(/[^\d+]/g, '');
    if (phone.replace(/\D/g, '').length < 7) return fail(400, 'Enter a valid phone number');
    const existing = accountBy(phone);
    if (existing) {
      return json({
        userId: existing.id, phone, isNew: false, channel: 'sms',
        provider: 'preview', delivered: false,
        deliveryError: 'Preview mode — no SMS is sent',
        deliveryCode: '123456',
      });
    }
    const id = rid('u');
    const username = `user${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = {
      id, username, displayName: body?.displayName || `Guest ${username.slice(-4)}`,
      avatar: null, cover: null, bio: null, country: null, language: 'en',
      mood: null, moodText: null, verified: false, isPrivate: false, role: 'user',
      createdAt: now(), lastSeen: now(), online: true, temporaryIdentity: false,
      email: null, phone, dob: null,
      privacy: { profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' },
      prefs: { reduceMotion: false, translationPreview: true, readReceipts: true },
    };
    state.accounts.push({ key: username, id, username, email: '', displayName: user.displayName, language: 'en', role: 'user', avatar: null });
    state.byUser[id] = {
      me: user,
      chats: { conversations: [] }, convs: {}, notifications: { notifications: [], unread: 0 },
      calls: { calls: [] }, sessions: { sessions: [] }, aiThreads: { threads: [] },
    };
    return json({
      userId: id, phone, isNew: true, channel: 'sms', provider: 'preview',
      delivered: false, deliveryError: 'Preview mode — no SMS is sent',
      deliveryCode: '123456',
    });
  }

  if (route === 'POST /auth/phone/verify') {
    const target = body?.userId;
    if (!state.byUser[target]) return fail(400, 'No pending sign-up for this number');
    if (String(body?.code || '') !== '123456') return fail(400, 'Incorrect code');
    localStorage.setItem(UID_KEY, target);
    const s = sessionFor(target);
    const u = meOf(target);
    return json({ ...s, user: u, needsOnboarding: !u.country || !u.bio, isNew: !u.country && !u.bio });
  }

  if (route === 'POST /auth/phone/resend') {
    return json({ ok: true, provider: 'preview', delivered: false, deliveryCode: '123456' });
  }

  if (route === 'GET /auth/otp/status') {
    return json({ provider: 'preview', configured: false, echo: true, smsDelivery: false, primary: 'phone' });
  }

  if (route === 'POST /auth/login') {
    const acc = accountBy(body?.identifier);
    if (!acc) return fail(401, 'Incorrect email/phone or password');
    if (String(body?.password || '') !== PASSWORD) return fail(401, 'Incorrect email/phone or password');
    localStorage.setItem(UID_KEY, acc.id);
    return json(sessionFor(acc.id));
  }

  if (route === 'POST /auth/signup') {
    const ident = String(body?.identifier || '').trim().toLowerCase();
    if (!ident) return fail(400, 'Enter an email address or phone number');
    if (accountBy(ident)) return fail(409, 'An account already exists for these details');
    const id = rid('u');
    const username = ident.includes('@') ? ident.split('@')[0].replace(/[^a-z0-9_]/g, '') : `user${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = {
      id,
      username,
      displayName: body?.displayName || username,
      avatar: null,
      cover: null,
      bio: null,
      country: null,
      language: 'en',
      mood: null,
      moodText: null,
      verified: false,
      isPrivate: false,
      role: 'user',
      createdAt: now(),
      lastSeen: now(),
      online: true,
      temporaryIdentity: false,
      email: ident.includes('@') ? ident : null,
      phone: ident.includes('@') ? null : ident,
      dob: null,
      privacy: { profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' },
      prefs: { reduceMotion: false, translationPreview: true, readReceipts: true },
    };
    state.accounts.push({ key: username, id, username, email: user.email || '', displayName: user.displayName, language: 'en', role: 'user', avatar: null });
    state.byUser[id] = {
      me: user,
      chats: { conversations: [] },
      convs: {},
      notifications: { notifications: [], unread: 0 },
      calls: { calls: [] },
      sessions: { sessions: [] },
      aiThreads: { threads: [] },
    };
    return json({ userId: id, deliveryCode: '123456', target: ident, channel: ident.includes('@') ? 'email' : 'sms' });
  }

  if (route === 'POST /auth/otp/request') {
    const acc = accountBy(body?.identifier);
    if (!acc) return fail(404, 'No account found for these details');
    return json({ userId: acc.id, deliveryCode: '123456', channel: 'email' });
  }

  if (route === 'POST /auth/otp/verify') {
    const target = body?.userId;
    if (!state.byUser[target]) return fail(400, 'Invalid verification code');
    if (String(body?.code || '') !== '123456') return fail(400, 'Invalid verification code');
    localStorage.setItem(UID_KEY, target);
    return json(sessionFor(target));
  }

  if (route === 'POST /auth/forgot') {
    const acc = accountBy(body?.identifier);
    if (!acc) return fail(404, 'No account found for these details');
    return json({ userId: acc.id, deliveryCode: '123456', channel: 'email' });
  }

  if (route === 'POST /auth/reset') return json({ ok: true });

  if (route === 'POST /auth/refresh') {
    const t = String(body?.refreshToken || '');
    const id = t.startsWith('demo-refresh.') ? t.slice(13) : uid;
    if (!id || !meOf(id)) return fail(401, 'Session expired');
    return json(sessionFor(id));
  }

  if (route === 'POST /auth/logout') return json({ ok: true });
  if (route === 'POST /auth/logout-all') return json({ ok: true });

  if (route === 'GET /auth/me') {
    if (!uid || !me) return fail(401, 'Not signed in');
    return json({ user: me, needsOnboarding: !me.country || !me.bio });
  }

  if (route === 'GET /auth/sessions') return json(entry(uid)?.sessions || { sessions: [] });
  if (method === 'DELETE' && a === 'auth' && b === 'sessions') {
    const u = entry(uid);
    if (u?.sessions?.sessions) u.sessions.sessions = u.sessions.sessions.filter((s) => s.id !== c);
    return json({ ok: true });
  }
  if (route === 'POST /auth/2fa/enable') {
    if (me) me.twofa = !!body?.enable;
    return json({ enabled: !!body?.enable });
  }
  if (a === 'auth' && b === 'oauth') {
    return fail(501, `${c ? c[0].toUpperCase() + c.slice(1) : 'This'} sign-in is not configured in the preview. Use a demo account below.`);
  }

  /* --------------------------------------------------------------- users */
  if (route === 'PATCH /users/me') {
    if (!me) return fail(401, 'Not signed in');
    Object.assign(me, body || {});
    const prof = state.profiles[me.username];
    if (prof) prof.user = { ...prof.user, ...body };
    for (const u of Object.values(state.byUser)) {
      if (u.me.id === me.id) u.me = me;
    }
    return json({ user: me });
  }

  if (route === 'DELETE /users/me') return json({ ok: true });
  if (route === 'GET /users/me/export') return json({ user: me, exportedAt: now() });

  if (route === 'GET /users/search') {
    const q = (query.get('q') || '').toLowerCase();
    const users = Object.values(state.profiles)
      .map((p) => p.user)
      .filter((u) => u.id !== uid)
      .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
      .slice(0, 20);
    return json({ users });
  }

  if (route === 'GET /users/suggestions') {
    const known = new Set((state.social?.suggestions?.users || []).map((u) => u.id));
    const users = Object.values(state.profiles)
      .map((p) => p.user)
      .filter((u) => u.id !== uid && !known.has(u.id))
      .slice(0, 8);
    return json({ users: [...(state.social?.suggestions?.users || []), ...users].slice(0, 8) });
  }

  if (method === 'GET' && a === 'users' && b && parts.length === 2) {
    const prof = state.profiles[b];
    if (!prof) return fail(404, 'User not found');
    return json(prof);
  }

  if (method === 'POST' && a === 'users' && c === 'follow') {
    const prof = Object.values(state.profiles).find((p) => p.user.id === b);
    const following = !(prof?.isFollowing);
    if (prof) {
      prof.isFollowing = following;
      prof.counts.followers += following ? 1 : -1;
    }
    return json({ following, followers: prof?.counts.followers || 0 });
  }

  if (method === 'POST' && a === 'users' && c === 'block') {
    const prof = Object.values(state.profiles).find((p) => p.user.id === b);
    if (prof) prof.blocked = true;
    return json({ blocked: true });
  }

  if (method === 'POST' && a === 'users' && c === 'report') {
    state.admin.reports.reports.unshift({
      id: rid('rp'),
      reporter_id: uid,
      target_type: 'user',
      target_id: b,
      reason: body?.reason || 'other',
      details: body?.details || '',
      status: 'open',
      created_at: now(),
      reporter: me,
    });
    state.admin.stats.openReports = state.admin.reports.reports.filter((r) => r.status === 'open').length;
    return json({ ok: true, id: rid('rp') });
  }

  /* --------------------------------------------------------------- chats */
  if (route === 'GET /chats') return json(chatList(uid, query.get('archived') === 'true'));

  if (route === 'POST /chats/dm') {
    const otherId = body?.userId;
    const existing = Object.values(entry(uid)?.convs || {}).find(
      (c) => c.conversation.type === 'dm' && c.participants.some((p) => p.id === otherId),
    );
    if (existing) return json({ conversation: existing.conversation });
    const other = Object.values(state.profiles).find((p) => p.user.id === otherId)?.user;
    if (!other) return fail(404, 'User not found');
    const id = rid('c');
    const conv = {
      id, type: 'dm', title: null, avatar: null, communityId: null, wallpaper: null,
      disappearSeconds: 0, muted: false, archived: false, pinned: false, locked: false,
      languageOverride: null, unread: 0, lastMessageAt: now(), lastMessage: null,
      participants: [me, other],
    };
    for (const u of [uid, otherId]) {
      const en = entry(u);
      if (!en) continue;
      en.convs[id] = { conversation: { ...conv, unread: u === uid ? 0 : 1 }, participants: [me, other], messages: [], viewerLanguage: en.me.language };
    }
    return json({ conversation: conv });
  }

  if (route === 'POST /chats/group') {
    const id = rid('c');
    const members = [me, ...(body?.userIds || []).map((x) => Object.values(state.profiles).find((p) => p.user.id === x)?.user).filter(Boolean)];
    const conv = {
      id, type: 'group', title: body?.title || 'New group', avatar: null, communityId: null,
      wallpaper: null, disappearSeconds: 0, muted: false, archived: false, pinned: false,
      locked: false, languageOverride: null, unread: 0, lastMessageAt: now(), lastMessage: null,
      participants: members,
    };
    for (const m of members) {
      const en = entry(m.id);
      if (!en) continue;
      en.convs[id] = { conversation: { ...conv }, participants: members, messages: [], viewerLanguage: en.me.language };
    }
    return json({ conversation: conv });
  }

  if (method === 'GET' && a === 'chats' && b && parts.length === 2) {
    const ce = convEntry(uid, b);
    if (!ce) return fail(404, 'Conversation not found');
    const parts = ce.conversation.participants?.length ? ce.conversation.participants : ce.participants;
    return json({ conversation: { ...ce.conversation, participants: parts }, viewerLanguage: ce.viewerLanguage });
  }

  if (method === 'GET' && a === 'chats' && c === 'messages' && parts.length === 3) {
    const ce = convEntry(uid, b);
    if (!ce) return fail(404, 'Conversation not found');
    const before = Number(query.get('before') || 0);
    const visible = ce.messages.filter((m) => !m.scheduledFor || m.scheduledFor <= now());
    const slice = before ? visible.filter((m) => m.createdAt < before) : visible;
    const page = slice.slice(-40);
    return json({ messages: page, hasMore: slice.length > page.length });
  }

  if (method === 'POST' && a === 'chats' && c === 'messages' && parts.length === 3) {
    const ce = convEntry(uid, b);
    if (!ce) return fail(404, 'Conversation not found');
    const msg = {
      id: rid('m'),
      conversationId: b,
      senderId: uid,
      body: body?.body || '',
      displayBody: body?.body || '',
      translated: false,
      displayLang: me.language,
      originalBody: body?.body || '',
      originalLang: me.language,
      type: body?.type || 'text',
      mediaUrl: body?.mediaUrl || null,
      mediaMeta: body?.mediaMeta || null,
      replyTo: body?.replyTo ? ce.messages.find((m) => m.id === body.replyTo) || null : null,
      createdAt: now(),
      editedAt: null,
      deleted: false,
      pinned: false,
      starred: false,
      scheduledFor: body?.scheduledFor || null,
      silent: !!body?.silent,
      location: body?.location || null,
      contact: body?.contact || null,
      reactions: {},
      reads: [],
      clientId: body?.clientId || null,
    };
    eachConv(b, (cv) => {
      cv.messages.push({ ...msg });
      cv.conversation.lastMessageAt = msg.createdAt;
      cv.conversation.lastMessage = {
        id: msg.id, body: msg.body, type: msg.type, senderId: msg.senderId,
        createdAt: msg.createdAt, originalLang: msg.originalLang, displayBody: msg.displayBody, translated: false,
      };
      if (cv.conversation.type === 'dm' && (cv.conversation.participants || []).some((p) => p.id !== uid)) {
        // leave unread counters untouched for the sender
      }
    });
    return json({ message: msg });
  }

  if (method === 'PATCH' && a === 'chats' && c === 'messages' && parts.length === 4) {
    let updated = null;
    eachConv(b, (cv) => {
      const m = cv.messages.find((x) => x.id === d);
      if (m) {
        m.body = body?.body ?? m.body;
        m.originalBody = m.body;
        m.displayBody = m.body;
        m.editedAt = now();
        updated = m;
      }
    });
    if (!updated) return fail(404, 'Message not found');
    return json({ message: updated });
  }

  if (method === 'DELETE' && a === 'chats' && c === 'messages' && parts.length === 4) {
    eachConv(b, (cv) => {
      const m = cv.messages.find((x) => x.id === d);
      if (m) {
        m.deleted = true;
        m.body = '';
        m.displayBody = '';
        m.originalBody = '';
        m.mediaUrl = null;
      }
    });
    return json({ ok: true });
  }

  if (method === 'POST' && a === 'chats' && c === 'messages' && e === 'react') {
    let reactions = {};
    eachConv(b, (cv) => {
      const m = cv.messages.find((x) => x.id === d);
      if (!m) return;
      m.reactions = m.reactions || {};
      const list = new Set(m.reactions[body?.emoji] || []);
      if (list.has(uid)) list.delete(uid);
      else list.add(uid);
      if (list.size) m.reactions[body?.emoji] = [...list];
      else delete m.reactions[body?.emoji];
      reactions = m.reactions;
    });
    return json({ reactions });
  }

  if (method === 'POST' && a === 'chats' && c === 'read') {
    const ce = convEntry(uid, b);
    if (ce) {
      ce.conversation.unread = 0;
      ce.messages.forEach((m) => {
        if (m.senderId !== uid && !(m.reads || []).some((r) => r.user_id === uid)) {
          m.reads = [...(m.reads || []), { user_id: uid, state: 'read', at: now() }];
        }
      });
    }
    return json({ ok: true });
  }

  if (method === 'PATCH' && a === 'chats' && parts.length === 2) {
    const ce = convEntry(uid, b);
    if (!ce) return fail(404, 'Conversation not found');
    Object.assign(ce.conversation, body || {});
    eachConv(b, (cv) => Object.assign(cv.conversation, body || {}));
    return json({ conversation: ce.conversation });
  }

  if (method === 'GET' && a === 'chats' && c === 'summary') {
    const ce = convEntry(uid, b);
    if (!ce) return fail(404, 'Conversation not found');
    const msgs = ce.messages.filter((m) => !m.deleted).slice(-12);
    const points = msgs.slice(-5).map((m) => {
      const who = (ce.conversation.participants || ce.participants || []).find((p) => p.id === m.senderId)?.displayName || 'Member';
      return `• ${who}: ${(m.displayBody || m.body || '').slice(0, 110)}`;
    });
    return json({
      summary: `This conversation has ${ce.messages.length} messages across ${ce.participants.length} people.\n\n${points.join('\n')}`,
      engine: state.aiStatus?.engine || 'local-heuristic',
    });
  }

  if (method === 'GET' && a === 'chats' && c === 'starred') {
    const ce = convEntry(uid, b);
    return json({ messages: (ce?.messages || []).filter((m) => m.starred) });
  }

  if (method === 'POST' && a === 'chats' && c === 'star') {
    let starred = false;
    eachConv(b, (cv) => {
      const m = cv.messages.find((x) => x.id === d);
      if (m) { m.starred = !m.starred; starred = m.starred; }
    });
    return json({ starred });
  }

  /* -------------------------------------------------------------- social */
  if (route === 'GET /social/feed') return json(state.social.feed);
  if (route === 'GET /social/trending') return json(state.social.trending);
  if (route === 'GET /social/explore') {
    const q = (query.get('q') || '').toLowerCase().trim();
    const posts = state.social.explore.posts.filter(
      (p) => !q || p.caption?.toLowerCase().includes(q) || p.author?.displayName.toLowerCase().includes(q) || p.author?.username.toLowerCase().includes(q),
    );
    return json({ posts });
  }

  if (route === 'POST /social/posts') {
    const post = {
      id: rid('p'),
      caption: body?.caption || '',
      originalLang: me.language,
      media: body?.media || [],
      location: body?.location || null,
      privacy: body?.privacy || 'public',
      type: body?.type || 'post',
      createdAt: now(),
      likes: 0,
      comments: 0,
      liked: false,
      saved: false,
      author: me,
    };
    state.social.feed.posts.unshift(post);
    state.social.explore.posts.unshift(post);
    if (state.profiles[me.username]) state.profiles[me.username].posts.unshift(post);
    return json({ post });
  }

  if (method === 'POST' && a === 'social' && b === 'posts' && d === 'like') {
    let liked = false;
    let likes = 0;
    touchPost(c, (p) => {
      p.liked = !p.liked;
      p.likes += p.liked ? 1 : -1;
      liked = p.liked;
      likes = p.likes;
    });
    return json({ liked, likes });
  }

  if (method === 'POST' && a === 'social' && b === 'posts' && d === 'save') {
    let saved = false;
    touchPost(c, (p) => { p.saved = !p.saved; saved = p.saved; });
    return json({ saved });
  }

  if (method === 'GET' && a === 'social' && b === 'posts' && d === 'comments') {
    return json({ comments: state.comments?.[c] || [] });
  }

  if (method === 'POST' && a === 'social' && b === 'posts' && d === 'comments') {
    state.comments = state.comments || {};
    state.comments[c] = state.comments[c] || [];
    const comment = { id: rid('pc'), post_id: c, user_id: uid, body: body?.body || '', created_at: now(), author: me };
    state.comments[c].push(comment);
    touchPost(c, (p) => { p.comments = (p.comments || 0) + 1; });
    return json({ comment });
  }

  if (route === 'GET /social/moments') return json(state.social.moments);

  if (route === 'POST /social/moments') {
    const groups = state.social.moments.groups;
    let g = groups.find((x) => x.user.id === uid);
    if (!g) {
      g = { user: me, moments: [], allViewed: false };
      groups.unshift(g);
    }
    const moment = {
      id: rid('mo'),
      user_id: uid,
      type: body?.type || 'text',
      media_url: body?.mediaUrl || null,
      text: body?.text || null,
      caption: body?.caption || null,
      bg: body?.bg || null,
      location: body?.location || null,
      audience: body?.audience || 'followers',
      created_at: now(),
      expires_at: now() + 86400000,
      views: 0,
      reactions: {},
      mine: true,
    };
    g.moments.unshift(moment);
    return json({ moment });
  }

  if (method === 'POST' && a === 'social' && b === 'moments' && d === 'view') {
    const m = findMoment(c);
    if (m) m.views = (m.views || 0) + 1;
    return json({ ok: true });
  }
  if (method === 'POST' && a === 'social' && b === 'moments' && d === 'react') {
    const m = findMoment(c);
    if (m) {
      m.reactions = m.reactions || {};
      m.reactions[body?.emoji] = (m.reactions[body?.emoji] || 0) + 1;
    }
    return json({ ok: true });
  }
  if (method === 'POST' && a === 'social' && b === 'moments' && d === 'reply') {
    const m = findMoment(c);
    const target = m ? Object.values(state.profiles).find((p) => p.user.id === m.user_id)?.user : null;
    if (!target) return fail(404, 'Moment not found');
    const dm = await handle('POST', '/api/chats/dm', { userId: target.id });
    const conv = (await dm.json()).conversation;
    await handle('POST', `/api/chats/${conv.id}/messages`, { body: body?.body || '' });
    return json({ conversationId: conv.id });
  }
  if (method === 'GET' && a === 'social' && b === 'moments' && d === 'viewers') {
    return json({ viewers: state.profiles.alexr ? [state.profiles.alexr.user, state.profiles.priyasharma?.user].filter(Boolean) : [] });
  }
  if (method === 'DELETE' && a === 'social' && b === 'moments') {
    for (const g of state.social.moments.groups) g.moments = g.moments.filter((m) => m.id !== c);
    state.social.moments.groups = state.social.moments.groups.filter((g) => g.moments.length);
    return json({ ok: true });
  }

  /* --------------------------------------------------------- communities */
  if (route === 'GET /communities') {
    const q = (query.get('q') || '').toLowerCase();
    const list = state.communities.list.communities.filter(
      (x) => !q || x.name.toLowerCase().includes(q) || x.description?.toLowerCase().includes(q),
    );
    return json({ communities: list });
  }

  if (route === 'POST /communities') {
    const id = rid('cm');
    const community = {
      id,
      name: body?.name || 'New community',
      slug: String(body?.name || 'community').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: body?.description || '',
      avatar: null, cover: null,
      category: body?.category || 'General',
      privacy: body?.privacy || 'public',
      ownerId: uid,
      createdAt: now(),
      rules: body?.rules || '',
      members: 1,
      joined: true,
      myRole: 'owner',
      conversationId: null,
    };
    state.communities.list.communities.unshift(community);
    state.communities.details[id] = { community, posts: [], locked: false, members: [me] };
    return json({ community });
  }

  if (method === 'GET' && a === 'communities' && parts.length === 2) {
    const det = state.communities.details[b];
    if (!det) return fail(404, 'Community not found');
    return json(det);
  }

  if (method === 'POST' && a === 'communities' && c === 'join') {
    const det = state.communities.details[b];
    const item = state.communities.list.communities.find((x) => x.id === b);
    const joined = !(det?.community.joined ?? item?.joined);
    if (det) {
      det.community.joined = joined;
      det.community.members += joined ? 1 : -1;
    }
    if (item) {
      item.joined = joined;
      item.members += joined ? 1 : -1;
    }
    return json({ joined });
  }

  if (method === 'POST' && a === 'communities' && c === 'posts') {
    const det = state.communities.details[b];
    if (!det) return fail(404, 'Community not found');
    const post = {
      id: rid('cp'),
      community_id: b,
      user_id: uid,
      body: body?.body || '',
      type: body?.type || 'post',
      poll: body?.poll || null,
      created_at: now(),
      author: me,
      likes: 0,
      comments: 0,
      votes: body?.poll ? body.poll.options.map(() => 0) : null,
      myVote: null,
    };
    det.posts.unshift(post);
    return json({ post });
  }

  if (method === 'POST' && a === 'communities' && c === 'posts' && e === 'vote') {
    const det = state.communities.details[b];
    const post = det?.posts.find((p) => p.id === d);
    if (!post || !post.votes) return fail(400, 'Poll not found');
    const idx = Number(body?.optionIndex);
    if (post.myVote != null && post.votes[post.myVote] > 0) post.votes[post.myVote] -= 1;
    post.votes[idx] = (post.votes[idx] || 0) + 1;
    post.myVote = idx;
    return json({ post });
  }

  /* ------------------------------------------------------------------ AI */
  if (route === 'GET /ai/status') return json(state.aiStatus);
  if (route === 'GET /ai/threads') return json(entry(uid)?.aiThreads || { threads: [] });
  if (method === 'GET' && a === 'ai' && b === 'threads' && parts.length === 3) {
    const t = (entry(uid)?.aiThreads?.threads || []).find((x) => x.thread_id === c);
    return json({ messages: t?.messages || [] });
  }
  if (route === 'POST /ai/chat') {
    const en = entry(uid);
    if (!en) return fail(401, 'Not signed in');
    en.aiThreads = en.aiThreads || { threads: [] };
    let threadId = body?.threadId;
    let thread = en.aiThreads.threads.find((t) => t.thread_id === threadId);
    if (!thread) {
      threadId = rid('t');
      thread = { thread_id: threadId, started: now(), last: now(), title: String(body?.message || '').slice(0, 48), messages: [] };
      en.aiThreads.threads.unshift(thread);
    }
    thread.messages.push({ role: 'user', content: body?.message || '', created_at: now() });
    const reply = localChat(body?.message);
    thread.messages.push({ role: 'assistant', content: reply, created_at: now() });
    thread.last = now();
    return json({ threadId, reply, engine: state.aiStatus?.engine || 'local-heuristic' });
  }
  if (route === 'POST /ai/task') {
    const kind = body?.kind || 'improve';
    const text = localTask(kind, body?.text);
    return json({ kind, text, result: text, engine: state.aiStatus?.engine || 'local-heuristic' });
  }
  if (route === 'POST /ai/upload') {
    const file = body?.get?.('file');
    if (!file) return fail(400, 'No file uploaded');
    const mime = file.type || 'application/octet-stream';
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';
    return json({ url: URL.createObjectURL(file), kind, name: file.name, size: file.size, mime });
  }
  if (route === 'GET /ai/notifications') return json(entry(uid)?.notifications || { notifications: [], unread: 0 });
  if (route === 'POST /ai/notifications/read') {
    const n = entry(uid)?.notifications;
    if (n) {
      n.notifications.forEach((x) => { x.read = 1; });
      n.unread = 0;
    }
    return json({ ok: true });
  }
  if (method === 'DELETE' && a === 'ai' && b === 'notifications') {
    const n = entry(uid)?.notifications;
    if (n) n.notifications = n.notifications.filter((x) => x.id !== c);
    return json({ ok: true });
  }
  if (route === 'GET /ai/calls') return json(entry(uid)?.calls || { calls: [] });
  if (route === 'POST /ai/calls') {
    const en = entry(uid);
    if (!en) return fail(401, 'Not signed in');
    const callee = Object.values(state.profiles).find((p) => p.user.id === body?.calleeId)?.user;
    const callId = rid('call');
    en.calls.calls.unshift({
      id: callId,
      conversation_id: null,
      caller_id: uid,
      callee_id: body?.calleeId,
      type: body?.type || 'audio',
      status: body?.status || 'ringing',
      started_at: now(),
      ended_at: null,
      duration: 0,
      participants: '[]',
      display_name: callee?.displayName || 'Unknown',
      avatar: callee?.avatar || null,
      username: callee?.username || '',
      direction: 'outgoing',
    });
    return json({ callId });
  }
  if (method === 'PATCH' && a === 'ai' && b === 'calls') {
    const call = (entry(uid)?.calls?.calls || []).find((x) => x.id === c);
    if (call) Object.assign(call, body || {}, { ended_at: now() });
    return json({ call });
  }

  /* ---------------------------------------------------------------- admin */
  if (route === 'GET /admin/stats') {
    if (me?.role !== 'admin' && me?.role !== 'moderator') return fail(403, 'Admin access required');
    return json(state.admin.stats);
  }
  if (route === 'GET /admin/users') {
    if (me?.role !== 'admin' && me?.role !== 'moderator') return fail(403, 'Admin access required');
    const q = (query.get('q') || '').toLowerCase();
    const users = state.admin.users.users.filter(
      (u) => !q || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    );
    return json({ users });
  }
  if (method === 'POST' && a === 'admin' && b === 'users' && d === 'verify') {
    const u = state.admin.users.users.find((x) => x.id === c);
    if (u) u.verified = !u.verified;
    return json({ user: u });
  }
  if (method === 'POST' && a === 'admin' && b === 'users' && d === 'status') {
    const u = state.admin.users.users.find((x) => x.id === c);
    if (u) u.status = body?.status;
    return json({ user: u });
  }
  if (route === 'GET /admin/reports') {
    if (me?.role !== 'admin' && me?.role !== 'moderator') return fail(403, 'Admin access required');
    return json(state.admin.reports);
  }
  if (method === 'POST' && a === 'admin' && b === 'reports') {
    const r = state.admin.reports.reports.find((x) => x.id === c);
    if (r) r.status = body?.status || 'resolved';
    state.admin.stats.openReports = state.admin.reports.reports.filter((x) => x.status === 'open').length;
    return json({ report: r });
  }
  if (route === 'GET /admin/audit') {
    if (me?.role !== 'admin' && me?.role !== 'moderator') return fail(403, 'Admin access required');
    return json(state.admin.audit);
  }

  /* --------------------------------------------------------------- misc */
  if (route === 'GET /health') return json({ ok: true, service: 'azolve-chat-preview', mode: 'demo' });

  return fail(404, `Preview mode: ${route} is not available without the backend.`);
}

/* ------------------------------------------------------------------ install */

export function installDemo() {
  if (window.__azolveDemo) return;
  window.__azolveDemo = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api')) return realFetch(input, init);

    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    let body;
    if (init.body instanceof FormData) body = init.body;
    else if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    try {
      return await handle(method, url, body);
    } catch (e) {
      console.error('[demo]', method, url, e);
      return fail(500, e.message || 'Preview runtime error');
    }
  };
}

export const DEMO_ACCOUNTS = state.accounts.map((a) => ({
  key: a.key,
  id: a.id,
  username: a.username,
  email: a.email,
  displayName: a.displayName,
  language: a.language,
  role: a.role,
  avatar: a.avatar,
}));

export const DEMO_PASSWORD = PASSWORD;
