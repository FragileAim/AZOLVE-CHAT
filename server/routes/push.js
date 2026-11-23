import express from 'express';
import { requireAuth } from '../auth.js';
import { err } from '../util.js';
import { vapidKeys, saveSubscription, removeSubscription, sendToUser, readDeclineToken, pushReady } from '../services/push.js';
import { saveDeviceToken, removeDeviceToken, deviceTokenCount, fcmStatus, fcmConfigured } from '../services/fcm.js';
import { get } from '../db.js';
import { finishCall, emitToUser } from '../realtime.js';

const r = express.Router();

/* The browser needs the VAPID public key to create a subscription. It is
   public by design — it only identifies the sender. */
r.get('/key', (req, res) => {
  const k = vapidKeys();
  if (!k) return err(res, 503, 'Push is not configured on this server');
  res.json({ key: k.publicKey, ready: true });
});

r.get('/status', requireAuth, (req, res) => {
  res.json({ ready: pushReady(), subscribed: !!get('SELECT 1 FROM push_subscriptions WHERE user_id = ?', req.user.id) });
});

r.post('/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return err(res, 400, 'A push subscription with endpoint and keys is required');
  }
  saveSubscription(req.user.id, sub, req.headers['user-agent'] || '');
  res.json({ ok: true });
});

r.post('/unsubscribe', requireAuth, (req, res) => {
  removeSubscription(req.body?.endpoint);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------------------
   Firebase Cloud Messaging
   ---------------------------------------------------------------------------
   Web push (VAPID) cannot wake a Capacitor WebView: the Push API does not
   exist there. FCM is the only transport that rings a closed Android app, so
   the two live side by side and sendToUser() fans out to both.
   ------------------------------------------------------------------------- */

/* The public Firebase web config. None of these values are secrets \u2014 they ship
   inside every Firebase web app bundle. The service-account key, which *is* a
   secret, never leaves the server. */
r.get('/firebase-config', (req, res) => {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    vapidKey: process.env.FIREBASE_VAPID_KEY || '',
  };
  const ready = !!(config.apiKey && config.projectId && config.messagingSenderId && config.appId && config.vapidKey);
  res.json({ ready, config, fcmServerReady: fcmConfigured() });
});

r.post('/fcm/register', requireAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return err(res, 400, 'A device token is required');
  const platform = String(req.body?.platform || 'web').slice(0, 20);
  saveDeviceToken(req.user.id, token, platform, req.headers['user-agent'] || '');
  res.json({ ok: true, devices: deviceTokenCount(req.user.id) });
});

r.post('/fcm/unregister', requireAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (token) removeDeviceToken(token);
  res.json({ ok: true });
});

r.get('/fcm/status', requireAuth, (req, res) => {
  res.json({ ...fcmStatus(), devices: deviceTokenCount(req.user.id) });
});

/* A self-test so a person can prove the notification actually arrives instead
   of finding out during a real call. */
r.post('/test', requireAuth, async (req, res) => {
  const sent = await sendToUser(req.user.id, {
    kind: 'test',
    title: 'AZOLVE CHAT notifications are on',
    body: 'This is how an incoming call will look when the app is closed.',
  });
  res.json({ ok: sent > 0, sent });
});

/* Called by the service worker when someone taps Decline on the notification
   without opening the app. Authenticated by the short-lived token in the
   payload, not by a session. */
r.post('/decline', (req, res) => {
  const { token } = req.body || {};
  const p = readDeclineToken(token);
  if (!p) return err(res, 401, 'That call is no longer available');
  const call = finishCall(p.callId, 'declined', { endedBy: p.uid, reason: 'declined' });
  if (call) {
    const other = call.callerId === p.uid ? call.calleeId : call.callerId;
    emitToUser(other, 'call:declined', {
      callId: p.callId,
      by: p.uid,
      byName: get('SELECT display_name FROM users WHERE id = ?', p.uid)?.display_name || null,
      reason: 'declined',
    });
  }
  res.json({ ok: true });
});

export default r;
