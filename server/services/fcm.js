/* ============================================================================
   Firebase Cloud Messaging — waking the native app.
   ----------------------------------------------------------------------------
   Why this exists: a Capacitor WebView has no Push API. Web Push can ring a
   browser tab, an installed PWA, and Android Chrome, but it cannot reach the
   Android app shell when the app is closed. FCM is the only mechanism that can.

   Configuration is entirely environment-driven, because a credential must never
   be committed:
     FIREBASE_SERVICE_ACCOUNT_JSON  the whole service-account JSON, as one line
     FIREBASE_PROJECT_ID            optional; read from the JSON when absent
     GOOGLE_SERVICE_ACCOUNT_JSON    accepted as a fallback name (the same
                                    account also serves Speech-to-Text)

   No SDK is required. FCM HTTP v1 needs an OAuth2 bearer token, and a service
   account can mint one by signing a JWT with its own private key. That is about
   forty lines of `node:crypto`, which is cheaper than pulling in the Admin SDK.
   ========================================================================== */
import crypto from 'node:crypto';
import { all, get, run } from '../db.js';
import { now } from '../util.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let cachedAccount = null;
let cachedToken = null;      // { value, expiresAt }
let lastError = null;

/** Parse the service account out of the environment, tolerating base64. */
function serviceAccount() {
  if (cachedAccount !== null) return cachedAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    || '';
  if (!raw.trim()) { cachedAccount = false; return false; }
  try {
    let text = raw.trim();
    /* Render's UI sometimes mangles newlines in a multi-line secret, and some
       people paste the file base64-encoded. Handle both. */
    if (!text.startsWith('{')) {
      try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { /* not base64 */ }
    }
    const json = JSON.parse(text);
    if (!json.client_email || !json.private_key) throw new Error('missing client_email/private_key');
    /* The private key is the fragile part: a JSON string carries "\n" escapes,
       but a hand-pasted value may carry real newlines. */
    json.private_key = String(json.private_key).replace(/\\n/g, '\n');
    cachedAccount = json;
    return json;
  } catch (e) {
    lastError = `service account unreadable: ${e.message}`;
    cachedAccount = false;
    return false;
  }
}

export const fcmConfigured = () => !!serviceAccount();

export const fcmProjectId = () => {
  const a = serviceAccount();
  return (a && (a.project_id || process.env.FIREBASE_PROJECT_ID)) || process.env.FIREBASE_PROJECT_ID || null;
};

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const acct = serviceAccount();
  if (!acct) throw new Error('no service account');

  const iat = Math.floor(Date.now() / 1000);
  const claim = {
    iss: acct.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(acct.private_key);
  const assertion = `${unsigned}.${b64url(signature)}`;

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error_description || data?.error || `token HTTP ${r.status}`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

/* ------------------------------- tokens ---------------------------------- */

export function saveDeviceToken(userId, token, platform = 'android', ua = '') {
  if (!token || !userId) return;
  run(
    `INSERT INTO device_tokens (token, user_id, platform, ua, created_at, last_ok, fails)
     VALUES (?,?,?,?,?,NULL,0)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, ua = excluded.ua`,
    String(token).slice(0, 4096), userId, String(platform).slice(0, 16), String(ua).slice(0, 300), now(),
  );
}

export function removeDeviceToken(token) {
  if (token) run('DELETE FROM device_tokens WHERE token = ?', token);
}

export function deviceTokenCount(userId) {
  return get('SELECT COUNT(*) c FROM device_tokens WHERE user_id = ?', userId)?.c || 0;
}

/* -------------------------------- sending -------------------------------- */

/**
 * Send one notification to every registered device for a user.
 * @returns {Promise<number>} how many devices accepted it
 */
export async function sendToUserFcm(userId, { title, body, data = {} } = {}) {
  if (!fcmConfigured()) return 0;
  const project = fcmProjectId();
  if (!project) { lastError = 'no project id'; return 0; }

  const rows = all('SELECT token FROM device_tokens WHERE user_id = ?', userId);
  if (!rows.length) return 0;

  let bearer;
  try {
    bearer = await accessToken();
  } catch (e) {
    lastError = `auth: ${e.message}`;
    return 0;
  }

  /* FCM v1 takes one message per request. Devices per user are few, so a small
     parallel fan-out is fine; allSettled keeps one dead token from hiding the
     successes. */
  const results = await Promise.allSettled(rows.map(async ({ token }) => {
    /* A call is sent data-only on purpose. A `notification` payload is drawn by
       the system, and a system-drawn notification cannot carry a full-screen
       intent, so the phone would buzz in the tray instead of ringing over the
       lock screen. Data-only reaches AzolveMessagingService, which builds the
       call notification itself. */
    const isCall = data.kind === 'call' || data.kind === 'incoming_call';
    const message = {
      token,
      ...(isCall ? {} : { notification: { title, body } }),
      /* `data` values must be strings in FCM v1. */
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])),
      android: {
        priority: 'HIGH',
        ...(isCall
          ? { ttl: 45000 }
          : {
              notification: {
                channel_id: 'azolve_messages',
                sound: 'default',
                visibility: 'PUBLIC',
              },
            }),
      },
    };
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (r.ok) {
      run('UPDATE device_tokens SET last_ok = ?, fails = 0 WHERE token = ?', now(), token);
      return true;
    }
    const e = await r.json().catch(() => ({}));
    const status = e?.error?.status || `HTTP ${r.status}`;
    /* UNREGISTERED / INVALID_ARGUMENT means the token is dead — drop it rather
       than retrying forever. Anything else is transient. */
    if (status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' || r.status === 404) {
      removeDeviceToken(token);
    } else {
      run('UPDATE device_tokens SET fails = fails + 1 WHERE token = ?', token);
    }
    throw new Error(status);
  }));

  return results.filter(r => r.status === 'fulfilled').length;
}

/** Honest status for the admin panel and the client. */
export function fcmStatus() {
  const acct = serviceAccount();
  return {
    configured: !!acct,
    projectId: fcmProjectId(),
    account: acct ? acct.client_email : null,
    error: lastError,
    needs: 'FIREBASE_SERVICE_ACCOUNT_JSON (service account JSON from Firebase Console → Project Settings → Service accounts)',
  };
}
