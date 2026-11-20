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

async function fetchWithWakeUp(url, opts) {
  let lastErr = null;
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
      if (attempt < BOOT_DELAYS.length) {
        announce({ attempt: attempt + 1, total: BOOT_DELAYS.length });
        await sleep(BOOT_DELAYS[attempt]);
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

export async function api(path, { method = 'GET', body, headers = {}, raw = false, retry = true } = {}) {
  const token = getToken();
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetchWithWakeUp(`/api${path}`, opts);
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
  directory: (q = '', limit = 40) => api(`/contacts/directory?q=${encodeURIComponent(q)}&limit=${limit}`),
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
