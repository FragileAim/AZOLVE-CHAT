const TOKEN_KEY = 'azolve.token';
const REFRESH_KEY = 'azolve.refresh';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getRefresh = () => localStorage.getItem(REFRESH_KEY);
export const setSession = ({ token, refreshToken }) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
};
export const clearSession = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); };

let refreshing = null;

/* Endpoints where a 401 is the answer to the request itself (wrong password,
   bad code, dead refresh token). Retrying them through the refresh flow would
   only produce a second, more confusing failure. */
const NO_RETRY = /^\/auth\/(refresh|login|signup|otp|forgot|reset|logout|email|phone)/;

/* Called when the refresh token itself is no longer good. The stored session is
   useless at that point, so drop it and let the app show the sign-in screen
   instead of leaving a half-signed-in shell that keeps failing. */
export function endSession(reason = 'expired') {
  clearSession();
  try {
    window.dispatchEvent(new CustomEvent('azolve:session-expired', { detail: { reason } }));
  } catch { /* older browsers */ }
}

async function refreshSession() {
  if (refreshing) return refreshing;
  const rt = getRefresh();
  if (!rt) throw new Error('no refresh token');
  refreshing = fetchWithWakeUp('/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }),
  }).then(async (r) => {
    if (!r.ok) throw new Error('refresh failed');
    const d = await r.json();
    if (!d || !d.token) throw new Error('refresh failed');
    setSession(d);
    return d.token;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

/* A free-tier host sleeps when nobody is using it, and the first request after
   that can fail outright while the container boots. Reporting that as "check
   your connection" is wrong and makes people think the app is broken, so we
   wait and try again, and tell the UI what is actually happening. */
const BOOT_STATUSES = new Set([502, 503, 504]);
const BOOT_DELAYS = [1200, 2500, 4000, 6000, 8000, 10000, 10000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function announce(detail) {
  try { window.dispatchEvent(new CustomEvent('azolve:server-waking', { detail })); } catch { /* noop */ }
}

/* A 502/503/504 means the platform accepted the connection but the app was not
   running yet — worth waiting out. A thrown TypeError means the request never
   reached anything at all: no radio, no DNS, no route. Waiting 42 seconds for
   that is what made the app sit on the splash screen forever with no signal,
   so network-level failures get a much shorter budget and then fall through to
   the offline cache. */
const NET_DELAYS = [700, 1400];
const NET_MAX_FAILS = NET_DELAYS.length;

async function fetchWithWakeUp(url, opts) {
  let lastErr = null;
  let netFails = 0;
  for (let attempt = 0; attempt <= BOOT_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, opts);
      /* A 502/503/504 from the platform means the app never ran, so the request
         is safe to repeat — except for a body we cannot replay (FormData). */
      if (BOOT_STATUSES.has(res.status) && !(opts.body instanceof FormData) && attempt < BOOT_DELAYS.length) {
        announce({ attempt: attempt + 1, total: BOOT_DELAYS.length });
        await sleep(BOOT_DELAYS[attempt]);
        continue;
      }
      if (attempt > 0) announce({ done: true });
      return res;
    } catch (e) {
      lastErr = e;
      netFails += 1;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline || netFails > NET_MAX_FAILS) break;
      if (attempt < BOOT_DELAYS.length) {
        announce({ attempt: attempt + 1, total: BOOT_DELAYS.length });
        await sleep(NET_DELAYS[Math.min(netFails - 1, NET_DELAYS.length - 1)]);
        continue;
      }
    }
  }
  announce({ done: true });
  const err = new Error('Could not reach the server. It may be starting up — please try again in a moment.');
  err.cause = lastErr;
  err.network = true;
  throw err;
}

/* ---------------------------------------------------------------------------
   Offline read cache
   ---------------------------------------------------------------------------
   A phone on a lift, a train tunnel, a plane, or simply a host that has gone to
   sleep used to mean a blank app: every screen waited on a request that could
   not complete. Nothing was ever kept locally, so "offline" was the same as
   "broken".

   Every successful GET is now mirrored into localStorage (small responses
   only), and when the network cannot be reached at all the cached copy is
   returned instead. The app boots, the last conversation list renders, the
   profile loads — read-only, clearly marked as offline, and honest about it.
   Writes are never faked: they fail loudly, as they should.
--------------------------------------------------------------------------- */
const CACHE_PREFIX = 'azolve.cache:';
const CACHE_MAX_BYTES = 200 * 1024;
const CACHE_MAX_KEYS = 60;

function cacheGet(path) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && rec.data !== undefined ? rec : null;
  } catch { return null; }
}

function pruneCache() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    if (keys.length <= CACHE_MAX_KEYS) return;
    const stamped = keys.map((k) => {
      let at = 0;
      try { at = JSON.parse(localStorage.getItem(k)).at || 0; } catch { /* skip */ }
      return { k, at };
    }).sort((a, b) => a.at - b.at);
    stamped.slice(0, keys.length - CACHE_MAX_KEYS).forEach(({ k }) => localStorage.removeItem(k));
  } catch { /* storage unavailable: caching is optional */ }
}

function cachePut(path, data) {
  try {
    const json = JSON.stringify({ at: Date.now(), data });
    if (json.length > CACHE_MAX_BYTES) return;
    localStorage.setItem(CACHE_PREFIX + path, json);
    pruneCache();
  } catch { /* quota exceeded: drop the cache write, never the request */ }
}

/** Tell the shell that what is on screen came from disk, not the server. */
export function announceOffline() {
  try { window.dispatchEvent(new CustomEvent('azolve:offline')); } catch { /* noop */ }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false, retry = true } = {}) {
  const token = getToken();
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }

  let res;
  try {
    res = await fetchWithWakeUp(`/api${path}`, opts);
  } catch (e) {
    /* Only reads can be served from disk. A write that did not reach the server
       must fail, otherwise the user believes a message was sent when it was not. */
    if (method === 'GET') {
      const hit = cacheGet(path);
      if (hit) { announceOffline(); return hit.data; }
    }
    throw e;
  }

  if (res.status === 401 && retry && getRefresh() && !NO_RETRY.test(path)) {
    const peek = await res.clone().json().catch(() => ({}));
    try {
      await refreshSession();
      return api(path, { method, body, headers, raw, retry: false });
    } catch {
      /* Refresh failed: the session is genuinely gone. Clear it so the app can
         return to the sign-in screen rather than looping on 401s. */
      endSession(peek && peek.code === 'session_revoked' ? 'revoked' : 'expired');
    }
  }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    Object.assign(e, data, { status: res.status });
    throw e;
  }
  if (method === 'GET') cachePut(path, data);
  return data;
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/ai/upload', { method: 'POST', body: fd });
}

export const API = {
  me: () => api('/auth/me'),
  login: (identifier, password) => api('/auth/login', { method: 'POST', body: { identifier, password } }),
  signup: (b) => api('/auth/signup', { method: 'POST', body: b }),
  verifyOtp: (userId, code) => api('/auth/otp/verify', { method: 'POST', body: { userId, code } }),
  requestOtp: (identifier, purpose) => api('/auth/otp/request', { method: 'POST', body: { identifier, purpose } }),
  phoneStart: (b) => api('/auth/phone/start', { method: 'POST', body: b }),
  phoneVerify: (userId, code) => api('/auth/phone/verify', { method: 'POST', body: { userId, code } }),
  phoneResend: (userId) => api('/auth/phone/resend', { method: 'POST', body: { userId } }),
  emailStart: (b) => api('/auth/email/start', { method: 'POST', body: b }),
  emailVerify: (userId, code) => api('/auth/email/verify', { method: 'POST', body: { userId, code } }),
  emailResend: (userId) => api('/auth/email/resend', { method: 'POST', body: { userId } }),
  otpStatus: () => api('/auth/otp/status'),
  forgot: (identifier) => api('/auth/forgot', { method: 'POST', body: { identifier } }),
  reset: (b) => api('/auth/reset', { method: 'POST', body: b }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  updateMe: (b) => api('/users/me', { method: 'PATCH', body: b }),
  contacts: () => api('/contacts'),
  contactRequests: () => api('/contacts/requests'),
  directory: (q = '', limit = 40, tag = '') => api(`/contacts/directory?q=${encodeURIComponent(q)}&limit=${limit}${tag && tag !== 'for-you' ? `&tag=${encodeURIComponent(tag)}` : ''}`),
  contactState: (userId) => api(`/contacts/state/${userId}`),
  requestContact: (userId, note) => api('/contacts/request', { method: 'POST', body: { userId, note } }),
  respondContact: (requestId, action) => api('/contacts/respond', { method: 'POST', body: { requestId, action } }),
  cancelContactRequest: (requestId) => api(`/contacts/request/${requestId}`, { method: 'DELETE' }),
  removeContact: (userId) => api(`/contacts/${userId}`, { method: 'DELETE' }),
  chats: (archived) => api(`/chats${archived ? '?archived=true' : ''}`),
  conversation: (id) => api(`/chats/${id}`),
  messages: (id, before) => api(`/chats/${id}/messages${before ? `?before=${before}` : ''}`),
  send: (id, body) => api(`/chats/${id}/messages`, { method: 'POST', body }),
  patchChat: (id, body) => api(`/chats/${id}`, { method: 'PATCH', body }),
  react: (cid, mid, emoji) => api(`/chats/${cid}/messages/${mid}/react`, { method: 'POST', body: { emoji } }),
  editMessage: (cid, mid, body) => api(`/chats/${cid}/messages/${mid}`, { method: 'PATCH', body: { body } }),
  deleteMessage: (cid, mid) => api(`/chats/${cid}/messages/${mid}`, { method: 'DELETE' }),
  markRead: (id) => api(`/chats/${id}/read`, { method: 'POST' }),
  summary: (id) => api(`/chats/${id}/summary`),
  startDm: (userId) => api('/chats/dm', { method: 'POST', body: { userId } }),
  createGroup: (b) => api('/chats/group', { method: 'POST', body: b }),
  feed: () => api('/social/feed'),
  explore: (q = '') => api(`/social/explore${q}`),
  trending: () => api('/social/trending'),
  createPost: (b) => api('/social/posts', { method: 'POST', body: b }),
  likePost: (id) => api(`/social/posts/${id}/like`, { method: 'POST' }),
  savePost: (id) => api(`/social/posts/${id}/save`, { method: 'POST' }),
  comments: (id) => api(`/social/posts/${id}/comments`),
  comment: (id, body) => api(`/social/posts/${id}/comments`, { method: 'POST', body: { body } }),
  moments: () => api('/social/moments'),
  createMoment: (b) => api('/social/moments', { method: 'POST', body: b }),
  viewMoment: (id) => api(`/social/moments/${id}/view`, { method: 'POST' }),
  reactMoment: (id, emoji) => api(`/social/moments/${id}/react`, { method: 'POST', body: { emoji } }),
  replyMoment: (id, body) => api(`/social/moments/${id}/reply`, { method: 'POST', body: { body } }),
  momentViewers: (id) => api(`/social/moments/${id}/viewers`),
  profile: (username) => api(`/users/${username}`),
  follow: (id) => api(`/users/${id}/follow`, { method: 'POST' }),
  block: (id) => api(`/users/${id}/block`, { method: 'POST' }),
  report: (id, b) => api(`/users/${id}/report`, { method: 'POST', body: b }),
  searchUsers: (q) => api(`/users/search?q=${encodeURIComponent(q)}`),
  suggestions: () => api('/users/suggestions'),
  notifications: () => api('/ai/notifications'),
  readNotifications: () => api('/ai/notifications/read', { method: 'POST' }),
  communities: (q = '') => api(`/communities${q}`),
  community: (id) => api(`/communities/${id}`),
  joinCommunity: (id, anonymous) => api(`/communities/${id}/join`, { method: 'POST', body: { anonymous } }),
  createCommunity: (b) => api('/communities', { method: 'POST', body: b }),
  communityPost: (id, b) => api(`/communities/${id}/posts`, { method: 'POST', body: b }),
  vote: (id, pid, optionIndex) => api(`/communities/${id}/posts/${pid}/vote`, { method: 'POST', body: { optionIndex } }),
  aiStatus: () => api('/ai/status'),
  aiChat: (b) => api('/ai/chat', { method: 'POST', body: b }),
  aiThreads: () => api('/ai/threads'),
  aiThread: (id) => api(`/ai/threads/${id}`),
  aiTask: (b) => api('/ai/task', { method: 'POST', body: b }),
  calls: () => api('/ai/calls'),
  logCall: (b) => api('/ai/calls', { method: 'POST', body: b }),
  updateCall: (id, b) => api(`/ai/calls/${id}`, { method: 'PATCH', body: b }),
  sessions: () => api('/auth/sessions'),
  revokeSession: (id) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
  twofa: (enable) => api('/auth/2fa/enable', { method: 'POST', body: { enable } }),
  adminStats: () => api('/admin/stats'),
  adminIntegrations: () => api('/admin/integrations'),
  adminUsers: (q = '') => api(`/admin/users?q=${encodeURIComponent(q)}`),
  adminVerify: (id) => api(`/admin/users/${id}/verify`, { method: 'POST' }),
  adminStatus: (id, status) => api(`/admin/users/${id}/status`, { method: 'POST', body: { status } }),
  adminReports: () => api('/admin/reports'),
  adminResolve: (id) => api(`/admin/reports/${id}`, { method: 'POST', body: { status: 'resolved' } }),
  deleteMe: () => api('/users/me', { method: 'DELETE' }),
};

/* Nudge a sleeping host awake as soon as the app opens, so the first real
   request (sign-in, code, feed) does not have to wait for a cold start.
   Fire-and-forget: failures are silent, the retry wrapper handles the rest. */
export function warmUp() {
  try { fetch('/api/health', { method: 'GET', cache: 'no-store' }).catch(() => {}); } catch { /* noop */ }
}
