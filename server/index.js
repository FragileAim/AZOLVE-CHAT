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
import { seedIfEmpty } from './seed.js';
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

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'azolve-chat', version: '1.0.0', time: Date.now() }));

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
  if (!r || r.restored || r.reason === 'no-snapshot-yet') {
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

server.listen(PORT, '0.0.0.0', () => console.log(`AZOLVE CHAT server on http://localhost:${PORT}`));
