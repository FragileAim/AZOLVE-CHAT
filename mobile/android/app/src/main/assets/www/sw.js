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

/* Take over immediately: a worker that waits for every old tab to close is a
   worker that misses calls. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const ICON = '/logo.svg';

function callTitle(p) {
  const name = p?.from?.displayName || 'Someone';
  return p?.type === 'video' ? `${name} is video calling` : `${name} is calling`;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

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
