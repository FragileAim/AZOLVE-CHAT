/* ============================================================================
   Push subscriptions, client side
   ----------------------------------------------------------------------------
   Wraps the parts of the Push API that are easy to get wrong:

     - registering the service worker
     - turning the VAPID public key into the Uint8Array subscribe() wants
     - asking the server whether it has push configured at all
     - telling the truth when the platform cannot do it

   Nothing here pretends to work. If the browser has no Push API, or the user
   blocked notifications, isSupported()/subscribe() say so and the Settings
   screen shows the real reason.
============================================================================ */

import { getToken } from './api.js';

const SW_URL = '/sw.js';

export function isSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/* The subscribe() call wants the base64url VAPID key as bytes. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function api(path, opts = {}) {
  const token = getToken();
  const r = await fetch(`/api/push${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || `Request failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Registers the worker. Safe to call repeatedly. */
export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  } catch {
    return null;
  }
}

/** What the server thinks: { ready, subscribed }. */
export async function status() {
  try { return await api('/status'); } catch { return { ready: false, subscribed: false }; }
}

/**
 * Ask for permission, subscribe, and register the subscription with the server.
 * Returns { ok, reason } so the UI can explain a refusal instead of silently
 * flipping a switch back.
 */
export async function subscribe() {
  if (!isSupported()) {
    return {
      ok: false,
      reason: 'This browser cannot receive notifications while the app is closed. On iPhone, add AZOLVE to your Home Screen first.',
    };
  }

  const reg = await registerWorker();
  if (!reg) return { ok: false, reason: 'The notification service could not start.' };

  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, reason: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.' };
  }

  let key;
  try {
    const k = await api('/key');
    key = k.key;
  } catch {
    return { ok: false, reason: 'The server has not finished setting up notifications. Try again in a minute.' };
  }
  if (!key) return { ok: false, reason: 'The server has no notification key yet.' };

  let sub;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
  } catch (e) {
    return { ok: false, reason: e?.message || 'Could not create a notification subscription.' };
  }

  try {
    await api('/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  } catch (e) {
    return { ok: false, reason: e.message || 'Could not save the subscription.' };
  }
  return { ok: true };
}

export async function unsubscribe() {
  if (!isSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await api('/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || 'Could not turn notifications off.' };
  }
}

/** Sends a notification to this device right now, to prove delivery works. */
export async function sendTest() {
  try {
    const r = await api('/test', { method: 'POST' });
    return { ok: r.sent > 0, sent: r.sent || 0 };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** True when this device already holds a live subscription. */
export async function isSubscribed() {
  if (!isSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager?.getSubscription();
    return !!sub;
  } catch { return false; }
}
