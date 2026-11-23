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

/* The Android shell is a plain Activity + WebView, not a Capacitor bridge, so
   the Capacitor plugin is absent there. It exposes window.AzolvePush instead. */
const androidBridge = () => {
  try {
    const b = window.AzolvePush;
    return b && typeof b.getToken === 'function' ? b : null;
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

/* ---------------------------- android bridge ---------------------------- */

/* Polls the bridge until a token appears. Firebase fetches it over the network
   on first run, so it is not there instantly; 12 tries at 500 ms is generous
   without leaving a spinner running forever. */
async function registerAndroidBridge(bridge) {
  bridge.requestToken?.();
  for (let i = 0; i < 12; i++) {
    const token = String(bridge.getToken?.() || '');
    if (token) {
      await api('/push/fcm/register', { method: 'POST', body: { token, platform: 'android' } });
      return { ok: true, transport: 'fcm-android' };
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Firebase did not issue a device token');
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
    const bridge = androidBridge();

    /* The Android shell first: it is the only path that can ring a closed app. */
    if (bridge) {
      try {
        return await registerAndroidBridge(bridge);
      } catch (e) {
        lastReason = String(e?.message || e);
        /* fall through — the page may still register for web push */
      }
    }

    /* A Capacitor build with the plugin installed. */
    if (plugin) {
      try {
        return await registerNative(plugin);
      } catch (e) {
        lastReason = lastReason || String(e?.message || e);
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
