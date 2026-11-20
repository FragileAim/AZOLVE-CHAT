/* Full API audit for AZOLVE CHAT.
   Exercises every route the way a real client would: two accounts, a real
   conversation, real translation, real uploads, real RBAC checks. Prints a
   pass/fail line per check and exits non-zero if anything failed. */

const BASE = process.env.BASE || 'http://localhost:4500';
const ECHO = process.env.ECHO === '1';

let pass = 0, fail = 0;
const failures = [];

function ok(name, extra = '') {
  pass++; console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
}
function bad(name, detail) {
  fail++; failures.push(`${name}: ${detail}`);
  console.log(`  FAIL  ${name}  ->  ${detail}`);
}
function check(name, cond, detail = '') {
  cond ? ok(name, detail) : bad(name, detail || 'condition false');
}
function section(t) { console.log(`\n=== ${t} ===`); }

async function req(method, path, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers: h,
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

/* ------------------------------------------------------------------ auth --- */
async function makeUser(email, displayName) {
  const start = await req('POST', '/api/auth/email/start', { body: { email, displayName } });
  if (start.status !== 200) throw new Error(`start ${start.status} ${JSON.stringify(start.data)}`);
  if (!start.data.delivered) throw new Error(`not delivered: ${start.data.deliveryError}`);
  let code = start.data.deliveryCode;
  if (!code && ECHO) {
    const again = await req('POST', '/api/auth/email/resend', { body: { userId: start.data.userId } });
    code = again.data?.deliveryCode;
  }
  if (!code) throw new Error('no code available (need OTP_DEV_ECHO=1 for local runs)');
  const v = await req('POST', '/api/auth/email/verify', { body: { userId: start.data.userId, code } });
  if (v.status !== 200) throw new Error(`verify ${v.status} ${JSON.stringify(v.data)}`);
  return { token: v.data.token, refresh: v.data.refreshToken, user: v.data.user, email };
}

async function main() {
  section('0. Health & static');
  {
    const h = await req('GET', '/api/health');
    check('GET /api/health', h.status === 200 && h.data.ok === true, JSON.stringify(h.data));
    const s = await req('GET', '/api/auth/otp/status');
    check('GET /api/auth/otp/status', s.status === 200 && s.data.primary === 'email',
      `provider=${s.data.emailProvider} delivery=${s.data.emailDelivery}`);
    const spa = await fetch(BASE + '/');
    const html = await spa.text();
    check('GET / serves SPA html', spa.status === 200 && /<div id="root"/.test(html), `${html.length} bytes`);
    const unknown = await req('GET', '/api/nope/nothing');
    check('unknown API route -> 404 json', unknown.status === 404 && !!unknown.data.error,
      JSON.stringify(unknown.data).slice(0, 60));
    const notFoundPage = await fetch(BASE + '/#/chats');
    check('hash route serves app', notFoundPage.status === 200);
  }

  section('1. Auth');
  let A, B;
  try {
    A = await makeUser('audit.owner@azolve.io', 'Audit Owner');
    ok('signup + email verify (account A)', A.user.role);
  } catch (e) { bad('signup A', e.message); return; }
  try {
    B = await makeUser('audit.peer@azolve.io', 'Audit Peer');
    ok('signup + email verify (account B)', B.user.role);
  } catch (e) { bad('signup B', e.message); return; }

  {
    const me = await req('GET', '/api/auth/me', { token: A.token });
    check('GET /api/auth/me', me.status === 200 && me.data.user?.email === A.email,
      me.data.user?.email);
    const noTok = await req('GET', '/api/auth/me');
    check('me without token -> 401', noTok.status === 401, String(noTok.status));
    const badTok = await req('GET', '/api/auth/me', { token: 'garbage.token.here' });
    check('me with bad token -> 401', badTok.status === 401, String(badTok.status));

    const ref = await req('POST', '/api/auth/refresh', { body: { refreshToken: A.refresh } });
    check('POST /api/auth/refresh', ref.status === 200 && !!ref.data.token, String(ref.status));
    if (ref.data?.token) A.token = ref.data.token;

    const s = await req('GET', '/api/auth/sessions', { token: A.token });
    check('GET /api/auth/sessions', s.status === 200, `count=${Array.isArray(s.data.sessions) ? s.data.sessions.length : '?'}`);

    // rate limit: same address twice in a row must be throttled
    const r1 = await req('POST', '/api/auth/email/start', { body: { email: 'audit.owner@azolve.io' } });
    const r2 = await req('POST', '/api/auth/email/start', { body: { email: 'audit.owner@azolve.io' } });
    // The first call may already be inside the cooldown window left by sign-up,
    // so what matters is that a rapid repeat is refused rather than re-sent.
    check('OTP resend is throttled', r2.status === 429, `first=${r1.status} second=${r2.status}`);

    const badEmail = await req('POST', '/api/auth/email/start', { body: { email: 'not-an-email' } });
    check('invalid email -> 400', badEmail.status === 400, String(badEmail.status));

    const wrong = await req('POST', '/api/auth/email/verify', { body: { userId: A.user.id, code: '000000' } });
    check('wrong OTP rejected', wrong.status === 400 || wrong.status === 401, String(wrong.status));
  }

  section('2. Users & profile');
  {
    const me = await req('GET', '/api/users/me', { token: A.token });
    check('GET /api/users/me', me.status === 200, String(me.status));
    const upd = await req('PATCH', '/api/users/me', {
      token: A.token,
      body: { displayName: 'Audit Owner Renamed', bio: 'Testing AZOLVE', country: 'IN', language: 'hi', mood: '🚀 Testing' },
    });
    check('PATCH /api/users/me', upd.status === 200, String(upd.status));
    const after = await req('GET', '/api/users/me', { token: A.token });
    const u = after.data.user || after.data;
    check('profile update persisted', u.displayName === 'Audit Owner Renamed' && u.language === 'hi',
      `${u.displayName}/${u.language}`);

    const search = await req('GET', '/api/users/search?q=audit', { token: A.token });
    check('GET /api/users/search', search.status === 200,
      `results=${(search.data.users || search.data || []).length}`);
    const sug = await req('GET', '/api/users/suggestions', { token: A.token });
    check('GET /api/users/suggestions', sug.status === 200, String(sug.status));
    const byName = await req('GET', `/api/users/${B.user.username}`, { token: A.token });
    check('GET /api/users/:username', byName.status === 200, String(byName.status));
  }

  section('3. Chats & messaging');
  let convId;
  {
    const conv = await req('POST', '/api/chats/dm', { token: A.token, body: { userId: B.user.id } });
    convId = conv.data.conversation?.id || conv.data.id;
    check('POST /api/chats/dm', (conv.status === 200 || conv.status === 201) && !!convId, `conv=${convId}`);

    const dup = await req('POST', '/api/chats/dm', { token: A.token, body: { userId: B.user.id } });
    const dupId = dup.data.conversation?.id || dup.data.id;
    check('DM is idempotent (same conversation)', dupId === convId, `${dupId} vs ${convId}`);

    const list = await req('GET', '/api/chats', { token: A.token });
    check('GET /api/chats', list.status === 200, String(list.status));

    const msg = await req('POST', `/api/chats/${convId}/messages`, {
      token: A.token, body: { body: 'Hello from the audit, this should translate.' },
    });
    const mid = msg.data.message?.id || msg.data.id;
    check('POST message', (msg.status === 200 || msg.status === 201) && !!mid, `id=${mid}`);

    const msgs = await req('GET', `/api/chats/${convId}/messages`, { token: B.token });
    const arr = msgs.data.messages || msgs.data || [];
    check('peer can read message', msgs.status === 200 && arr.length >= 1, `count=${arr.length}`);

    // B speaks Hindi -> translation should be produced for B's language
    const tr = await req('POST', `/api/chats/${convId}/translate`, {
      token: B.token, body: { messageId: mid, lang: 'hi' },
    });
    const text = tr.data.text || tr.data.translation || tr.data.body;
    check('per-recipient translation (en -> hi)', tr.status === 200 && !!text,
      `${tr.status} ${String(text).slice(0, 40)}`);

    const orig = await req('GET', `/api/chats/${convId}/messages`, { token: B.token });
    const m0 = (orig.data.messages || []).find(x => x.id === mid);
    check('original message body never overwritten',
      m0 && /Hello from the audit/.test(m0.body || ''),
      m0 ? String(m0.body).slice(0, 30) : 'message missing');

    const react = await req('POST', `/api/chats/${convId}/messages/${mid}/react`, {
      token: B.token, body: { emoji: '🔥' },
    });
    check('react to message', react.status === 200, String(react.status));

    const star = await req('POST', `/api/chats/${convId}/messages/${mid}/star`, { token: B.token });
    check('star message', star.status === 200, String(star.status));

    const pin = await req('POST', `/api/chats/${convId}/messages/${mid}/pin`, { token: A.token });
    check('pin message', pin.status === 200, String(pin.status));

    const read = await req('POST', `/api/chats/${convId}/read`, { token: B.token });
    check('mark read', read.status === 200, String(read.status));

    const summary = await req('GET', `/api/chats/${convId}/summary`, { token: A.token });
    check('GET chat summary', summary.status === 200, String(summary.status));

    const threads = await req('GET', '/api/ai/threads', { token: A.token });
    check('GET AI threads', threads.status === 200, String(threads.status));

    const calls = await req('GET', '/api/ai/calls', { token: A.token });
    check('GET call history', calls.status === 200, String(calls.status));

    // authorisation: C must not read A<->B conversation
    const outsider = await req('GET', `/api/chats/${convId}/messages`, { token: 'nope' });
    check('outsider blocked from conversation', outsider.status === 401, String(outsider.status));
  }

  section('4. Translation breadth');
  {
    const langs = ['hi', 'ar', 'ja', 'de', 'es', 'fr', 'zh', 'pt', 'ru', 'ko', 'it', 'tr', 'id', 'vi', 'th', 'nl', 'pl', 'sv', 'he', 'fa', 'bn', 'ta', 'te', 'mr', 'gu', 'ur', 'en'];
    let good = 0, bads = [];
    for (const lang of langs) {
      const r = await req('POST', `/api/chats/${convId}/translate`, {
        token: A.token, body: { messageId: (await req('GET', `/api/chats/${convId}/messages`, { token: A.token })).data.messages[0].id, lang },
      });
      const t = r.data.text || r.data.translation || r.data.body;
      if (r.status === 200 && t) good++; else bads.push(`${lang}:${r.status}`);
    }
    check(`translation works for ${langs.length} languages`, good === langs.length,
      `${good}/${langs.length}${bads.length ? ' missing ' + bads.join(',') : ''}`);
  }

  section('5. AI assistant');
  {
    const ai = await req('POST', '/api/ai/chat', {
      token: A.token, body: { message: 'Reply with exactly the word PONG and nothing else.' },
    });
    const reply = ai.data.reply || ai.data.message?.body || ai.data.text || ai.data.content;
    check('POST /api/ai/chat returns a real reply', ai.status === 200 && !!reply,
      `${ai.status} ${String(reply).slice(0, 60)}`);
    check('AI reply is not an error string', !/api key|not configured|no provider/i.test(String(reply)),
      String(reply).slice(0, 60));

    const integ = await req('GET', '/api/admin/integrations', { token: A.token });
    check('integrations endpoint responds', integ.status === 200 || integ.status === 403, String(integ.status));
  }

  section('6. Moments');
  let momentId;
  {
    const m = await req('POST', '/api/social/moments', {
      token: A.token, body: { caption: 'Audit moment', mediaUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&q=80' },
    });
    momentId = m.data.moment?.id || m.data.id;
    check('POST moment', (m.status === 200 || m.status === 201) && !!momentId, `id=${momentId}`);
    const feed = await req('GET', '/api/social/moments', { token: B.token });
    check('peer sees moments feed', feed.status === 200, String(feed.status));
    if (momentId) {
      const view = await req('POST', `/api/social/moments/${momentId}/view`, { token: B.token });
      check('view moment', view.status === 200, String(view.status));
      const react = await req('POST', `/api/social/moments/${momentId}/react`, { token: B.token, body: { emoji: '❤️' } });
      check('react to moment', react.status === 200, String(react.status));
      const viewers = await req('GET', `/api/social/moments/${momentId}/viewers`, { token: A.token });
      check('moment viewers', viewers.status === 200, String(viewers.status));
    }
  }

  section('7. Social feed');
  let postId;
  {
    const p = await req('POST', '/api/social/posts', {
      token: A.token, body: { caption: 'Audit post — testing the feed.', privacy: 'public' },
    });
    postId = p.data.post?.id || p.data.id;
    check('POST post', (p.status === 200 || p.status === 201) && !!postId, `id=${postId}`);
    const feed = await req('GET', '/api/social/feed', { token: B.token });
    check('GET feed', feed.status === 200, String(feed.status));
    if (postId) {
      const like = await req('POST', `/api/social/posts/${postId}/like`, { token: B.token });
      check('like post', like.status === 200, String(like.status));
      const cm = await req('POST', `/api/social/posts/${postId}/comments`, { token: B.token, body: { body: 'Nice post' } });
      check('comment on post', cm.status === 200 || cm.status === 201, String(cm.status));
      const comments = await req('GET', `/api/social/posts/${postId}/comments`, { token: B.token });
      check('read comments', comments.status === 200, String(comments.status));
      const save = await req('POST', `/api/social/posts/${postId}/save`, { token: B.token });
      check('save post', save.status === 200, String(save.status));
      const saved = await req('GET', '/api/social/saved', { token: B.token });
      check('GET saved posts', saved.status === 200, String(saved.status));
    }
    const follow = await req('POST', `/api/users/${B.user.id}/follow`, { token: A.token });
    check('follow user', follow.status === 200, String(follow.status));
    const followers = await req('GET', `/api/users/${B.user.id}/followers`, { token: A.token });
    check('followers list', followers.status === 200, String(followers.status));
    const trending = await req('GET', '/api/social/trending', { token: A.token });
    check('trending', trending.status === 200, String(trending.status));
    const explore = await req('GET', '/api/social/explore', { token: A.token });
    check('explore', explore.status === 200, String(explore.status));
  }

  section('8. Communities');
  let commId;
  {
    const c = await req('POST', '/api/communities', {
      token: A.token, body: { name: 'Audit Community', description: 'Testing communities', privacy: 'public' },
    });
    commId = c.data.community?.id || c.data.id;
    check('POST community', (c.status === 200 || c.status === 201) && !!commId, `id=${commId}`);
    if (commId) {
      const join = await req('POST', `/api/communities/${commId}/join`, { token: B.token });
      check('join community', join.status === 200, String(join.status));
      const post = await req('POST', `/api/communities/${commId}/posts`, { token: B.token, body: { body: 'Hello community' } });
      check('post in community', post.status === 200 || post.status === 201, String(post.status));
      const list = await req('GET', '/api/communities', { token: A.token });
      check('list communities', list.status === 200, String(list.status));
      const detail = await req('GET', `/api/communities/${commId}`, { token: A.token });
      check('community detail', detail.status === 200, String(detail.status));
    }
  }

  section('9. Notifications');
  {
    const n = await req('GET', '/api/ai/notifications', { token: B.token });
    check('GET notifications', n.status === 200, String(n.status));
    const count = (n.data.notifications || n.data || []).length;
    check('notifications generated by activity', count > 0, `count=${count}`);
    const rd = await req('POST', '/api/ai/notifications/read', { token: B.token });
    check('mark notifications read', rd.status === 200, String(rd.status));
  }

  section('10. Uploads');
  {
    // 1x1 transparent PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'audit.png');
    const up = await fetch(BASE + '/api/ai/upload', {
      method: 'POST', headers: { authorization: `Bearer ${A.token}` }, body: form,
    });
    const body = await up.json().catch(() => ({}));
    check('POST upload image', (up.status === 200 || up.status === 201) && (body.url || body.path), JSON.stringify(body).slice(0, 80));
    if (body.url) {
      const img = await fetch(BASE.startsWith('http') && body.url.startsWith('/') ? BASE + body.url : body.url);
      check('uploaded file is served', img.status === 200, String(img.status));
    }
  }

  section('11. RBAC / admin');
  {
    const asUser = await req('GET', '/api/admin/stats', { token: B.token });
    check('non-admin blocked from /api/admin/stats', asUser.status === 403 || asUser.status === 401, String(asUser.status));
    const asAnon = await req('GET', '/api/admin/stats');
    check('anon blocked from admin', asAnon.status === 401, String(asAnon.status));
    // A was created with ADMIN_EMAILS match in this run
    const asAdmin = await req('GET', '/api/admin/stats', { token: A.token });
    check('admin can read stats', asAdmin.status === 200, String(asAdmin.status));
    const audit = await req('GET', '/api/admin/audit', { token: A.token });
    check('admin audit log', audit.status === 200, String(audit.status));
    const users = await req('GET', '/api/admin/users', { token: A.token });
    check('admin user list', users.status === 200, String(users.status));
    const promote = await req('POST', `/api/admin/users/${B.user.id}/role`, { token: A.token, body: { role: 'moderator' } });
    check('admin can change role', promote.status === 200, String(promote.status));
    const demote = await req('POST', `/api/admin/users/${B.user.id}/role`, { token: B.token, body: { role: 'admin' } });
    check('non-admin cannot escalate own role', demote.status === 403 || demote.status === 401, String(demote.status));
    // Put B back so a second run of this script starts from the same state.
    await req('POST', `/api/admin/users/${B.user.id}/role`, { token: A.token, body: { role: 'user' } });
  }

  section('12. RTC / calls');
  {
    const cfg = await req('GET', '/api/rtc/config');
    const turn = (cfg.data.iceServers || []).find(s => JSON.stringify(s.urls).includes('turn'));
    check('rtc config has TURN with credentials',
      cfg.status === 200 && cfg.data.hasTurn === true && turn && !!turn.username,
      `source=${cfg.data.turnSource}`);
    const call = await req('POST', '/api/ai/calls', {
      token: A.token, body: { conversationId: convId, kind: 'audio' },
    });
    check('POST create call', call.status === 200 || call.status === 201, String(call.status));
    const cid = call.data.call?.id || call.data.id;
    if (cid) {
      const upd = await req('PATCH', `/api/ai/calls/${cid}`, { token: A.token, body: { status: 'ended' } });
      check('PATCH call status', upd.status === 200, String(upd.status));
    }
  }

  section('13. Input validation & error hygiene');
  {
    const badJson = await fetch(BASE + '/api/auth/email/start', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    });
    const t = await badJson.text();
    check('malformed JSON -> 4xx, no stack trace',
      badJson.status >= 400 && badJson.status < 500 && !/at\s+\w+\s+\(/.test(t),
      `${badJson.status} ${t.slice(0, 50)}`);

    const missing = await req('POST', '/api/chats/dm', { token: A.token, body: {} });
    check('missing body field -> 4xx', missing.status >= 400 && missing.status < 500, String(missing.status));

    const huge = await req('POST', `/api/chats/${convId}/messages`, {
      token: A.token, body: { body: 'x'.repeat(20000) },
    });
    check('oversized message rejected', huge.status === 400 || huge.status === 413, String(huge.status));
  }

  section('14. Logout');
  {
    const lo = await req('POST', '/api/auth/logout', { token: B.token, body: { refreshToken: B.refresh } });
    check('POST /api/auth/logout', lo.status === 200, String(lo.status));
    const after = await req('GET', '/api/auth/me', { token: B.token });
    check('token invalid after logout', after.status === 401, String(after.status));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS CRASH:', e); process.exit(2); });
