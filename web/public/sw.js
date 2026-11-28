/* ============================================================================
   AZOLVE CHAT service worker
   ----------------------------------------------------------------------------
   Its whole job is to make a phone ring when the app is not open.

   A socket only reaches a running tab. This worker is woken by the browser's
   push service even when every tab is closed, so it can show a notification
   with real Accept and Decline buttons:

     Accept  -> opens the app straight into the call (?answer=<callId>)
     Decline -> POSTs /api/push/decline with a short-lived token, so the call
                is actually declined on the server without opening the app

   It also handles ordinary message notifications, so the same subscription can
   be reused later without a second worker.
============================================================================ */

const ICON = '/logo.svg';

/* ---------------------------------------------------------------------------
   Offline shell
   ---------------------------------------------------------------------------
   This worker used to handle push only. That meant a phone with no signal got
   the browser's own "no internet" page — the app could not even open, let alone
   show what it already knew. It now keeps the app shell on disk:

     - navigations  : network first, cached index.html when the network fails
     - /assets/*    : cache first, refreshed in the background

   API responses are deliberately NOT cached here. They are handled in
   lib/api.js, which knows which reads are safe to replay and which writes must
   fail honestly.
--------------------------------------------------------------------------- */
const SHELL_CACHE = 'azolve-shell-v1';
const ASSET_CACHE = 'azolve-assets-v1';

/* Take over immediately: a worker that waits for every old tab to close is a
   worker that misses calls. */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try {
      const c = await caches.open(SHELL_CACHE);
      await c.add(new Request('/index.html', { cache: 'reload' }));
    } catch { /* first run offline: nothing to precache yet */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* Drop caches from older versions so a stale shell cannot outlive a deploy. */
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('azolve-') && !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  /* Never intercept the API, the socket, or user uploads: those must fail
     honestly rather than be answered from disk. */
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/socket.io/') || p.startsWith('/uploads/')) return;

  /* --- navigations: the app shell --- */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(SHELL_CACHE);
          c.put('/index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const c = await caches.open(SHELL_CACHE);
        const hit = (await c.match('/index.html')) || (await c.match('/'));
        if (hit) return hit;
        return new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<body style="margin:0;background:#07070C;color:#fff;font-family:system-ui;'
          + 'display:grid;place-items:center;height:100vh;text-align:center">'
          + '<div><div style="font-size:22px;font-weight:800;letter-spacing:.22em">AZOLVE</div>'
          + '<div style="color:#18E0C8;font-size:11px;letter-spacing:.5em;margin-top:6px">CHAT</div>'
          + '<p style="color:#8A8AA0;font-size:13px;margin-top:22px">You are offline. Reconnect to continue.</p></div></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
    })());
    return;
  }

  /* --- hashed build assets: cache first, refresh behind the scenes --- */
  if (p.startsWith('/assets/') || /\.(js|mjs|css|woff2?|ttf|png|jpe?g|svg|webp|gif|ico)$/i.test(p)) {
    event.respondWith((async () => {
      const c = await caches.open(ASSET_CACHE);
      const hit = await c.match(req);
      const net = fetch(req)
        .then((r) => { if (r && r.ok) c.put(req, r.clone()).catch(() => {}); return r; })
        .catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});


/* ---------------------------------------------------------------------------
   Firebase Cloud Messaging, merged into this worker on purpose.
   ---------------------------------------------------------------------------
   FCM's web SDK wants its own worker at /firebase-messaging-sw.js, but that
   would sit at the same scope as this one and replace it — taking the Accept
   and Decline buttons with it. One worker handles both transports instead.
   The config below is public by design; the secret lives only on the server.
--------------------------------------------------------------------------- */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyCjl_QNr2ChcorRs4Up8vE4SgZwqN6h7Ic',
    authDomain: 'azolve-infotech.firebaseapp.com',
    projectId: 'azolve-infotech',
    storageBucket: 'azolve-infotech.firebasestorage.app',
    messagingSenderId: '816829921245',
    appId: '1:816829921245:web:d1c7e3babdfbe002e62834',
  });
  const messaging = firebase.messaging();

  /* Calls arrive data-only (so they can ring), and land here. */
  messaging.onBackgroundMessage((payload) => {
    const d = payload.data || {};
    if (d.kind !== 'call' && d.kind !== 'incoming_call') return;
    const name = d.fromName || d.title || 'Someone';
    return self.registration.showNotification(
      d.type === 'video' ? `${name} is video calling` : `${name} is calling`,
      {
        body: d.type === 'video' ? 'Tap Accept to join the video call' : 'Tap Accept to answer',
        tag: `call-${d.callId || Date.now()}`,
        renotify: true,
        requireInteraction: true,
        icon: d.fromAvatar || ICON,
        badge: ICON,
        vibrate: [400, 200, 400, 200, 400, 200, 400],
        actions: [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Decline' }],
        data: { ...d, kind: 'call' },
      },
    );
  });
} catch (e) {
  /* Offline, or the CDN is blocked. Web push below still works. */
}

function callTitle(p) {
  const name = p?.from?.displayName || 'Someone';
  return p?.type === 'video' ? `${name} is video calling` : `${name} is calling`;
}

self.addEventListener('push', (event) => {
  let data = null;
  try { data = event.data ? event.data.json() : null; } catch { data = null; }

  /* An FCM push is encrypted, so json() throws. Firebase's own handler above
     already turned it into a notification; drawing another one here would put
     an empty "AZOLVE CHAT" card on screen next to the real one. */
  if (!data) return;

  if (data.kind === 'call') {
    const body = data.type === 'video' ? 'Tap Accept to join the video call' : 'Tap Accept to answer';
    event.waitUntil((async () => {
      await self.registration.showNotification(callTitle(data), {
        body,
        tag: `call-${data.callId}`,
        /* The tag plus renotify means a second push for the same call updates the
           existing notification instead of stacking duplicates. */
        renotify: true,
        requireInteraction: true,
        icon: data.from?.avatar || ICON,
        badge: ICON,
        vibrate: [400, 200, 400, 200, 400, 200, 400],
        /* Android shows these as buttons; desktop Chrome shows them too. */
        actions: [
          { action: 'accept', title: 'Accept' },
          { action: 'decline', title: 'Decline' },
        ],
        data,
      });
      /* If a tab is already open but hidden, let it start ringing in-app as
         well, so the person can answer from either place. */
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'azolve:push-call', payload: data }));
    })());
    return;
  }

  /* Anything else is a normal notification. */
  const title = data.title || 'AZOLVE CHAT';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: data.icon || ICON,
    badge: ICON,
    data,
  }));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  const action = event.action;

  /* Declining must work with the app closed, so it is a plain fetch to a public
     endpoint guarded by a two-minute token. No session required. */
  if (action === 'decline' && data.declineToken) {
    event.waitUntil((async () => {
      try {
        await fetch('/api/push/decline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: data.declineToken }),
        });
      } catch { /* offline: the call will time out on the server instead */ }
      n.close();
    })());
    return;
  }

  n.close();

  /* Accept (or a tap on the body) opens the app. `answer` tells CallHost to
     join this specific call instead of just landing on the home screen. */
  const isCall = data.kind === 'call';
  const target = isCall
    ? `/?answer=${encodeURIComponent(data.callId)}&peer=${encodeURIComponent(data.from?.id || '')}&type=${encodeURIComponent(data.type || 'audio')}&name=${encodeURIComponent(data.from?.displayName || '')}`
    : '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Reuse an open tab when there is one, so the person does not end up with
       five copies of the app. */
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) {
        try {
          await c.focus();
          c.postMessage({ type: 'azolve:answer', payload: data });
          return;
        } catch { /* fall through to opening a new window */ }
      }
    }
    await self.clients.openWindow(target);
  })());
});
