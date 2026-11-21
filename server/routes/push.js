import express from 'express';
import { requireAuth } from '../auth.js';
import { err } from '../util.js';
import { vapidKeys, saveSubscription, removeSubscription, sendToUser, readDeclineToken, pushReady } from '../services/push.js';
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
