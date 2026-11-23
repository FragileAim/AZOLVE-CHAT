/* ============================================================================
   Firebase Cloud Messaging — client registration.
   ----------------------------------------------------------------------------
   The server can only ring a device it has a token for. This module obtains
   that token and registers it, and it is deliberately defensive:

   - If the server has no Firebase config, it does nothing. No error, no noise.
   - On web it loads the Firebase SDK from Google's CDN on demand, so the app
     bundle does not grow and nothing is fetched until a signed-in user exists.
   - In the Android shell it uses the Capacitor PushNotifications plugin, which
     is the only path that works inside a WebView (the web SDK's Push API does
     not exist there).
   - Every failure is reported as a reason string, never swallowed silently
     into "notifications are on" when they are not.
   ========================================================================== */
import { api } from './api.js';

const FCM_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let cachedConfig = null;
let registering = null;
let lastReason = null;

export const fcmLastReason = () => lastReason;

const nativePush = () => {
  try {
    return window.Capacitor?.Plugins?.PushNotifications || null;
  } catch {
    return null;
  }
};

async function serverConfig() {
  if (cachedConfig !== null) return cachedConfig;
  try {
    const d = await api('/push/firebase-config');
    cachedConfig = d?.ready ? d : false;
  } catch {
    cachedConfig = false;
  }
  return cachedConfig;
}

/* ------------------------------ native path ------------------------------ */

async function registerNative(plugin) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };

    plugin.addListener('registration', async ({ value }) => {
      try {
        await api('/push/fcm/register', { method: 'POST', body: { token: value, platform: 'android' } });
        done(resolve, { ok: true, transport: 'fcm-native' });
      } catch (e) {
        done(reject, e);
      }
    });
    plugin.addListener('registrationError', err => {
      lastReason = err?.error || 'registration failed';
      done(reject, new Error(lastReason));
    });

    /* Android 13+ asks for notification permission at runtime. */
    Promise.resolve(plugin.requestPermissions?.())
      .then(p => {
        if (p && p.receive === 'denied') {
          lastReason = 'permission denied';
          done(reject, new Error(lastReason));
          return;
        }
        return plugin.register();
      })
      .catch(e => { lastReason = String(e?.message || e); done(reject, e); });
  });
}

/* -------------------------------- web path -------------------------------- */

async function registerWeb(cfg) {
  const [{ initializeApp }, { getMessaging, getToken, onMessage }] = await Promise.all([
    import(/* @vite-ignore */ `${FCM_SDK}/firebase-app.js`),
    import(/* @vite-ignore */ `${FCM_SDK}/firebase-messaging.js`),
  ]);

  if (!('Notification' in window)) throw new Error('this browser has no notifications');
  if (Notification.permission === 'denied') throw new Error('permission denied');

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('permission denied');

  const app = initializeApp(cfg);
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: cfg.vapidKey });
  if (!token) throw new Error('no token issued');

  await api('/push/fcm/register', { method: 'POST', body: { token, platform: 'web' } });

  /* Foreground messages do not raise a system notification, so surface them
     in-app instead of letting them vanish. */
  onMessage(messaging, payload => {
    try {
      window.dispatchEvent(new CustomEvent('azolve:push', { detail: payload }));
    } catch { /* no listeners */ }
  });

  return { ok: true, transport: 'fcm-web' };
}

/* -------------------------------- public --------------------------------- */

/**
 * Register this device for push. Safe to call on every sign-in: the server
 * upserts by token, so repeat calls are cheap.
 * @returns {Promise<{ok:boolean, transport?:string, reason?:string}>}
 */
export function registerPush() {
  if (registering) return registering;
  registering = (async () => {
    const cfg = await serverConfig();
    const plugin = nativePush();

    /* Native first: the WebView cannot use the web SDK, but it may still have
       the plugin available. */
    if (plugin) {
      try {
        return await registerNative(plugin);
      } catch (e) {
        lastReason = lastReason || String(e?.message || e);
        /* fall through to web push, which still works for the PWA build */
      }
    }

    if (!cfg) {
      lastReason = 'Firebase is not configured on the server';
      return { ok: false, reason: lastReason };
    }

    try {
      return await registerWeb(cfg.config);
    } catch (e) {
      lastReason = String(e?.message || e);
      return { ok: false, reason: lastReason };
    }
  })().finally(() => { registering = null; });
  return registering;
}

/** Honest one-line summary for the Settings screen. */
export async function pushStatus() {
  try {
    const s = await api('/push/fcm/status');
    return {
      configured: !!s.configured,
      devices: s.devices || 0,
      projectId: s.projectId || null,
      reason: s.error || lastReason || null,
    };
  } catch {
    return { configured: false, devices: 0, projectId: null, reason: lastReason };
  }
}
