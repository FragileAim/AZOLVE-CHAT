import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';
import { initRealtime } from './realtime.js';
import { iceServers } from './services/turn.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import chatRoutes, { processScheduled } from './routes/chats.js';
import socialRoutes from './routes/social.js';
import communityRoutes from './routes/communities.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import contactRoutes from './routes/contacts.js';
import pushRoutes from './routes/push.js';
import callRoutes from './routes/calls.js';
import { seedIfEmpty } from './seed.js';
import * as translateService from './services/translate.js';
import { db } from './db.js';
import { startSnapshotLoop, saveSnapshot, snapshotEnabled, bindDb, status as persistStatus } from './services/persist.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '30d' }));

/* basic rate limiting (per IP, in-memory) */
const hits = new Map();
app.use('/api', (req, res, next) => {
  const key = req.ip;
  const bucket = hits.get(key) || { count: 0, reset: Date.now() + 60000 };
  if (Date.now() > bucket.reset) { bucket.count = 0; bucket.reset = Date.now() + 60000; }
  bucket.count++;
  hits.set(key, bucket);
  if (bucket.count > 600) return res.status(429).json({ error: 'Too many requests — slow down.' });
  next();
});

/* Report the version that is actually running. It used to be hardcoded to
   1.0.0, so every deploy still claimed to be the first release. */
const PKG_VERSION = (() => {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    for (const rel of ['../package.json', 'package.json']) {
      const p = path.resolve(here, rel);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).version || 'unknown';
    }
  } catch { /* fall through */ }
  return 'unknown';
})();
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'azolve-chat', version: PKG_VERSION, time: Date.now() }));

/* Lets us confirm from outside that backups are actually landing, instead of
   hoping a log line was seen. Must be declared before the /api catch-all. */
app.get('/api/health/persist', (req, res) => res.json({
  ok: !!persistStatus.backend,
  ...persistStatus,
  users: (() => { try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; } catch { return null; } })(),
}));

/* ---------------------------------------------------------------------------
   WebRTC ICE configuration
   STUN alone only works when both peers can be reached directly. Behind
   cellular CGNAT or a symmetric NAT — which is most mobile networks — media
   needs a TURN relay. TURN credentials stay on the server and are handed to
   the client per session; nothing is baked into the bundle.
--------------------------------------------------------------------------- */
app.get('/api/rtc/config', async (req, res) => {
  try {
    const { servers, turn, source } = await iceServers();
    res.json({
      iceServers: servers,
      hasTurn: turn,
      turnSource: source,
      ringTimeout: Number(process.env.CALL_RING_TIMEOUT_MS || 45000),
      iceTransportPolicy: process.env.ICE_TRANSPORT_POLICY || 'all',
    });
  } catch (e) {
    console.warn('[rtc] config failed:', e.message);
    res.json({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      hasTurn: false,
      turnSource: 'error',
      ringTimeout: Number(process.env.CALL_RING_TIMEOUT_MS || 45000),
      iceTransportPolicy: 'all',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/calls', callRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: `Unknown endpoint ${req.method} ${req.originalUrl}` }));
/* Every error used to become a 500, including a malformed JSON body — which is
   the client's mistake, not the server's. Map the ones we can recognise to the
   right status so a broken request gets a 4xx and a useful message, and keep
   stack traces out of the response. */
app.use((e, req, res, next) => {
  const status = e.status || e.statusCode || 500;
  if (e.type === 'entity.parse.failed' || e instanceof SyntaxError) {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (e.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (status >= 500) console.error('[error]', e.message);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500 ? 'Internal server error' : (e.message || 'Bad request'),
  });
});

/* ---------------------------------------------------------------------------
   Android App Links.

   Google sign-in has to run in a real browser (Google refuses embedded
   WebViews). Getting the session back into the app therefore needs a URL the
   operating system itself knows how to route. A `azolve://` redirect is not
   reliable — Chrome declines to follow a 302 to an unregistered scheme — so the
   callback returns over https to /oauth/app, and this file tells Android that
   this host owns that path for our package.

   The fingerprint below is the debug signing certificate. A Play-signed release
   build has a different one; add it to the array before shipping to the store.
   ------------------------------------------------------------------------- */
const ANDROID_CERT_SHA256 = [
  'D3:23:37:7C:F2:D1:A9:39:30:85:EB:55:D2:94:C9:4A:41:95:5A:4E:06:0A:55:99:1F:76:34:2E:62:95:7E:31',
];

app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json').set('Cache-Control', 'public, max-age=300').send(JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'io.azolve.chat',
      sha256_cert_fingerprints: ANDROID_CERT_SHA256,
    },
  }]));
});

/* Fallback for browsers that did not hand the link to the app. It keeps the
   credentials in the fragment, so they are never sent to this server, and it
   offers a tap target because Chrome only follows a custom scheme from a real
   user gesture. */
app.get('/oauth/app', (req, res) => {
  res.type('html').set('Cache-Control', 'no-store').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AZOLVE CHAT</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:#0b1020;color:#eef1ff;padding:24px}
  .card{max-width:420px;width:100%;background:#151b33;border:1px solid #2a3358;
        border-radius:20px;padding:28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .mark{width:56px;height:56px;border-radius:16px;margin:0 auto 18px;
        background:linear-gradient(135deg,#5b6cff,#8b5cf6);display:flex;align-items:center;
        justify-content:center;font-weight:700;font-size:22px;letter-spacing:.5px}
  h1{font-size:19px;margin:0 0 8px}
  p{margin:0 0 20px;color:#a9b2d6;font-size:14px}
  a.btn{display:block;padding:14px 18px;border-radius:14px;text-decoration:none;
        font-weight:600;color:#fff;background:linear-gradient(135deg,#5b6cff,#8b5cf6)}
  .hint{margin-top:16px;font-size:12px;color:#6f7aa3}
</style></head>
<body><div class="card">
  <div class="mark">AZ</div>
  <h1>Finishing sign-in…</h1>
  <p>Taking you back to AZOLVE CHAT.</p>
  <a class="btn" id="go" href="#">Open AZOLVE CHAT</a>
  <div class="hint">If nothing happens, the app may not be installed on this device.</div>
</div>
<script>
  var q = location.hash.replace(/^#/, '');
  var link = 'azolve://oauth' + (q ? '?' + q : '');
  document.getElementById('go').setAttribute('href', link);
  /* The App Link should have opened the app before this page rendered. If we
     are here, try the custom scheme once; the button above is the fallback. */
  if (q) { try { location.replace(link); } catch (e) {} }
</script></body></html>`);
});

const webDist = path.join(process.cwd(), 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

/* One bad request must never take the whole service down. Log it and keep
   serving; the client still gets a normal 500 from the error middleware. */
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', (e && e.message) || e));

initRealtime(server);
seedIfEmpty();

/* Keep an encrypted copy of the database off-box so a restart on a diskless
   host does not wipe every account. */
bindDb(db);
startSnapshotLoop(db);
if (snapshotEnabled()) {
  /* Establish a baseline only when the restore actually succeeded, or when
     there was nothing to restore yet. If a restore errored, saving now would
     overwrite a good snapshot with this empty database. */
  const r = persistStatus.lastRestore;
  if (!r || r.restored || r.reason === 'no-snapshot-yet' || r.reason === 'reset-by-operator') {
    saveSnapshot(db, { force: true }).catch(() => {});
  } else {
    console.warn('[persist] restore did not succeed — leaving the stored snapshot untouched');
  }
}

/* Lets us confirm from outside that backups are actually landing, instead of
   hoping a log line was seen. */
app.get('/api/health/persist', (req, res) => res.json({
  ok: !!persistStatus.backend,
  ...persistStatus,
  users: (() => { try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; } catch { return null; } })(),
}));

setInterval(() => { processScheduled().catch(() => {}); }, 20000);

/* ---------------------------------------------------------------------------
   Language repair (v1.1.6).
   The old detector labelled every Romanised Indic message as English, so those
   rows carry a wrong `original_lang` and were never translated for anyone. This
   re-runs the corrected detector over recent messages and fixes the column. It
   is idempotent, only touches rows that actually disagree, and is deferred so
   it never delays the first request after a cold start.
   ------------------------------------------------------------------------- */
setTimeout(() => {
  try {
    const { backfillLanguages } = translateService;
    const r = backfillLanguages(5000);
    if (r.fixed) console.log(`[i18n] repaired original_lang on ${r.fixed}/${r.scanned} messages`);
  } catch (e) {
    console.warn('[i18n] language repair skipped:', e?.message || e);
  }
}, 8000);

server.listen(PORT, '0.0.0.0', () => console.log(`AZOLVE CHAT server on http://localhost:${PORT}`));
