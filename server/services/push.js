/* ============================================================================
   Web Push for incoming calls
   ----------------------------------------------------------------------------
   A socket only reaches someone who has the app open. To ring a phone whose
   app is closed we need a push service, and the browser's own push endpoint is
   the only one that works without a vendor account (no Firebase, no APNs key).

   The VAPID key pair is generated once and stored in the database, so it is
   stable across restarts and is carried inside the encrypted snapshot. Set
   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the environment to pin it instead.

   What this can and cannot do, stated plainly:
     - Chrome / Edge / Firefox / Android Chrome and an installed PWA: works with
       the app fully closed.
     - iOS Safari 16.4+: works only after the site is added to the Home Screen
       (Apple's rule, not ours).
     - The Capacitor Android shell: a WebView has no Push API. Ringing a closed
       native app needs Firebase Cloud Messaging, which needs a Firebase project
       and google-services.json. Until those exist, the APK rings while it is
       open or in the background, and the web/PWA build rings when closed.
============================================================================ */

/* web-push 4 is a native ES module with named exports only, so a default
   import throws at load time and takes the whole server down with it. */
import { generateVAPIDKeys, setVapidDetails, sendNotification } from 'web-push';
import jwt from 'jsonwebtoken';
import { all, get, run } from '../db.js';
import { id, now } from '../util.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@azolve.io';

let cached = null;

/** Returns { publicKey, privateKey } and configures web-push. */
export function vapidKeys() {
  if (cached) return cached;

  let pub = process.env.VAPID_PUBLIC_KEY || '';
  let priv = process.env.VAPID_PRIVATE_KEY || '';

  if (!pub || !priv) {
    try {
      const row = get('SELECT value FROM app_settings WHERE key = ?', 'vapid');
      if (row?.value) {
        const j = JSON.parse(row.value);
        pub = j.pub;
        priv = j.priv;
      }
    } catch { /* table may not exist on a very old database */ }
  }

  if (!pub || !priv) {
    const k = generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    try {
      run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'vapid', JSON.stringify({ pub, priv }));
    } catch (e) {
      console.warn('[push] could not persist VAPID keys:', e.message);
    }
  }

  try {
    setVapidDetails(SUBJECT, pub, priv);
  } catch (e) {
    console.warn('[push] invalid VAPID keys:', e.message);
    return null;
  }
  cached = { publicKey: pub, privateKey: priv };
  return cached;
}

export const pushReady = () => !!vapidKeys();

export function saveSubscription(userId, sub, ua = '') {
  if (!sub?.endpoint) return null;
  const existing = get('SELECT id FROM push_subscriptions WHERE endpoint = ?', sub.endpoint);
  if (existing) {
    run('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, ua = ?, fails = 0 WHERE id = ?',
      userId, sub.keys?.p256dh || '', sub.keys?.auth || '', String(ua).slice(0, 200), existing.id);
    return existing.id;
  }
  const sid = id('ps_');
  run('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, ua, created_at) VALUES (?,?,?,?,?,?,?)',
    sid, userId, sub.endpoint, sub.keys?.p256dh || '', sub.keys?.auth || '', String(ua).slice(0, 200), now());
  return sid;
}

export function removeSubscription(endpoint) {
  if (!endpoint) return;
  run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
}

/* A push endpoint that answers 404/410 is permanently dead; keeping it would
   mean retrying a gone device on every call. */
function dropDead(endpoint) {
  try { run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint); } catch { /* noop */ }
}

/**
 * Send one payload to every device registered for a user.
 * Returns the number of endpoints that accepted it.
 *
 * Two transports, because they cover different devices:
 *   - Web Push  : browser tabs, installed PWAs, Android Chrome
 *   - FCM       : the Capacitor Android shell, which has no Push API at all
 * A user can legitimately have both, so we fan out to both and add up the
 * successes rather than treating them as alternatives.
 */
export async function sendToUser(userId, payload) {
  let sent = 0;
  const p = payload || {};
  const isCall = p.kind === 'call' || p.kind === 'incoming_call';

  /* Every exit path below reports how many devices a call actually reached.
     Without it there is no way to tell "no token registered" from "Firebase
     refused", and the last three call regressions were all diagnosed blind. */
  try {

  /* --- native shell ---
     FCM v1 can only carry flat string key/value data, so a nested payload like
     {kind:'call', from:{id,name}} has to be flattened here. This used to be
     skipped entirely: sendToUser passed `payload.data`, which a call payload
     does not have, so the phone received a data-only message with an empty data
     map. AzolveMessagingService then saw no `kind`, drew a generic "AZOLVE
     CHAT" tray entry with no body, and tapping it opened the app without ever
     joining the call. Flattening fixes both the ringing and the tap-through. */
  const flat = { ...(p.data || {}) };
  if (isCall) {
    flat.kind = 'call';
    flat.callId = p.callId || '';
    flat.type = p.type || 'audio';
    flat.conversationId = p.conversationId || '';
    flat.fromId = p.from?.id || '';
    flat.fromName = p.from?.displayName || 'Someone';
    flat.fromAvatar = p.from?.avatar || '';
    flat.fromLanguage = p.from?.language || 'en';
    flat.declineToken = p.declineToken || '';
  } else {
    if (p.kind) flat.kind = p.kind;
    if (p.tag) flat.tag = p.tag;
    flat.title = p.title || 'AZOLVE CHAT';
    flat.body = p.body || '';
  }

  const title = isCall
    ? `${p.from?.displayName || 'Someone'} is ${p.type === 'video' ? 'video calling' : 'calling'}`
    : (p.title || 'AZOLVE CHAT');
  const body = isCall
    ? (p.type === 'video' ? 'Tap Accept to join the video call' : 'Tap Accept to answer')
    : (p.body || '');

  try {
    const { sendToUserFcm } = await import('./fcm.js');
    sent += await sendToUserFcm(userId, { title, body, data: flat });
  } catch { /* FCM is optional; web push still runs */ }

  /* --- browsers --- */
  if (!vapidKeys()) return sent;

  /* A browser that registered an FCM web token already got this push through
     FCM. Sending the VAPID copy too would show the same notification twice, so
     the FCM path wins wherever it is available. */
  try {
    const webFcm = all("SELECT 1 FROM device_tokens WHERE user_id = ? AND platform = 'web' LIMIT 1", userId);
    if (webFcm.length && sent > 0) return sent;
  } catch { /* table missing on an old database: fall through to web push */ }

  const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  if (!subs.length) return sent;

  const raw = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        raw,
        { TTL: 45, urgency: 'high' },
      );
      sent++;
      run('UPDATE push_subscriptions SET last_ok = ?, fails = 0 WHERE id = ?', now(), s.id);
    } catch (e) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) dropDead(s.endpoint);
      else run('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?', s.id);
    }
  }));

  return sent;
  } finally {
    if (isCall) console.log(`[push] call ${p.callId || '?'} -> user ${userId}: ${sent} device(s)`);
  }
}

/**
 * A short-lived token that lets the service worker decline a call without a
 * login. It is scoped to one call and one user, and expires in two minutes, so
 * leaking it is worth almost nothing.
 */
export function declineToken(callId, userId) {
  return jwt.sign({ callId, uid: userId, purpose: 'decline' }, SECRET, { expiresIn: '2m' });
}

export function readDeclineToken(token) {
  try {
    const p = jwt.verify(token, SECRET);
    if (p.purpose !== 'decline') return null;
    return p;
  } catch { return null; }
}

/** The payload the service worker turns into a ringing notification. */
export function callPayload({ callId, from, type, conversationId, toUserId }) {
  return {
    kind: 'call',
    callId,
    type: type || 'audio',
    conversationId: conversationId || null,
    from: {
      id: from?.id || null,
      displayName: from?.displayName || 'Someone',
      avatar: from?.avatar || null,
      language: from?.language || 'en',
    },
    declineToken: declineToken(callId, toUserId),
    at: Date.now(),
  };
}
