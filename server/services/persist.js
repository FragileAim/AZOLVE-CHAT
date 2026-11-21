import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/* ---------------------------------------------------------------------------
   Durable storage for deployments that have no disk.

   Render's free plan cannot attach a persistent disk, so every deploy, restart
   and wake-from-sleep starts with an empty DATA_DIR. That is why accounts kept
   disappearing and testers had to register again each time.

   This module keeps one encrypted copy of the SQLite file outside the container
   and restores it on boot. Two interchangeable backends:

     postgres  SNAPSHOT_PG_URL (or DATABASE_URL) pointing at any Postgres
     github    SNAPSHOT_REPO + SNAPSHOT_TOKEN for a PRIVATE repository

   Either way the payload is AES-256-GCM encrypted and gzipped before it leaves
   the process, so the store only ever sees ciphertext. Without a configured
   backend the app still runs, it just lives only on this instance.

   Env:
     SNAPSHOT_KEY    passphrase for the encryption (falls back to JWT_SECRET)
     SNAPSHOT_PATH   file name used by the github backend
     SNAPSHOT_EVERY  seconds between saves (default 60, minimum 20)
--------------------------------------------------------------------------- */

const REPO = process.env.SNAPSHOT_REPO || '';
const TOKEN = process.env.SNAPSHOT_TOKEN || '';
const PASS = process.env.SNAPSHOT_KEY || process.env.JWT_SECRET || '';
const FILE = process.env.SNAPSHOT_PATH || 'azolve.db.enc';
const EVERY = Math.max(20, Number(process.env.SNAPSHOT_EVERY || 60)) * 1000;

const PG_URL = process.env.SNAPSHOT_PG_URL
  || (/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || '') ? process.env.DATABASE_URL : '');

export const backend = () => {
  if (!PASS) return null;
  if (PG_URL) return 'postgres';
  if (REPO && TOKEN) return 'github';
  return null;
};
export const snapshotEnabled = () => !!backend();

/* A fixed salt is fine: the key is derived once per process and the salt only
   has to defeat rainbow tables, not rotate. */
const SALT = Buffer.from('azolve-chat-snapshot-v1');
const key = () => crypto.scryptSync(PASS, SALT, 32);

function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('AZV1'), iv, c.getAuthTag(), body]);
}

function decrypt(buf) {
  if (buf.subarray(0, 4).toString() !== 'AZV1') throw new Error('snapshot has an unknown format');
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

/* ------------------------------------------------------------------ postgres */

let pool = null;
async function pg() {
  if (pool) return pool;
  const { default: pgp } = await import('pg');
  const needsSsl = !/localhost|127\.0\.0\.1/.test(PG_URL) && !/sslmode=disable/.test(PG_URL);
  pool = new pgp.Pool({
    connectionString: PG_URL,
    max: 2,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS azolve_snapshot (
    id          text PRIMARY KEY,
    data        bytea NOT NULL,
    bytes       integer NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`);
  return pool;
}

const pgGet = async () => {
  const r = await (await pg()).query('SELECT data, bytes, updated_at FROM azolve_snapshot WHERE id = $1', ['db']);
  return r.rows[0] || null;
};
const pgPut = async (buf) => {
  await (await pg()).query(
    `INSERT INTO azolve_snapshot (id, data, bytes, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, bytes = EXCLUDED.bytes, updated_at = now()`,
    ['db', buf, buf.length],
  );
};

/* -------------------------------------------------------------------- github */

const ghApi = (p) => `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(p)}`;
const ghHeaders = () => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'azolve-chat',
});

const ghGet = async () => {
  const r = await fetch(ghApi(FILE), { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} reading snapshot`);
  const j = await r.json();
  const bin = await fetch(j.download_url, { headers: ghHeaders() });
  if (!bin.ok) throw new Error(`GitHub ${bin.status} downloading snapshot`);
  return { data: Buffer.from(await bin.arrayBuffer()), bytes: j.size, sha: j.sha };
};
const ghPut = async (buf, existing) => {
  const r = await fetch(ghApi(FILE), {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `snapshot ${new Date().toISOString()} (${(buf.length / 1024).toFixed(0)} KB)`,
      content: buf.toString('base64'),
      ...(existing?.sha ? { sha: existing.sha } : {}),
    }),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`);
};

/* -------------------------------------------------------------------- public */

export const status = {
  backend: null,
  lastRestore: null,
  lastSaveAt: null,
  lastSaveBytes: null,
  lastError: null,
};

/** Download the newest snapshot and write it to dbPath. */
export async function restoreSnapshot(dbPath) {
  const b = backend();
  status.backend = b;
  if (!b) return { restored: false, reason: 'not-configured' };
  try {
    const row = b === 'postgres' ? await pgGet() : await ghGet();
    if (!row) {
      status.lastRestore = { at: Date.now(), restored: false, reason: 'no-snapshot-yet' };
      return { restored: false, reason: 'no-snapshot-yet' };
    }
    const raw = zlib.gunzipSync(decrypt(Buffer.from(row.data)));
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, raw);
    status.lastRestore = { at: Date.now(), restored: true, bytes: raw.length };
    return { restored: true, bytes: raw.length };
  } catch (e) {
    status.lastRestore = { at: Date.now(), restored: false, reason: e.message };
    status.lastError = e.message;
    console.warn('[persist] restore failed:', e.message);
    return { restored: false, reason: e.message };
  }
}

let lastSig = '';
let saving = false;

/* The database runs in WAL mode, so almost every write lands in the -wal file
   and the main .db file is not touched until a checkpoint. Signing only the
   main file therefore reported "unchanged" for a database that had just gained
   a user, the save was skipped, and the account vanished at the next restart.
   Both files are part of the signature. */
function signature(file) {
  try {
    const s = fs.statSync(file);
    let wal = '0:0';
    try {
      const w = fs.statSync(`${file}-wal`);
      wal = `${w.size}:${Math.round(w.mtimeMs)}`;
    } catch { /* no WAL file means everything is already in the main file */ }
    return `${s.size}:${Math.round(s.mtimeMs)}:${wal}`;
  } catch { return ''; }
}

/** Push the current database to the configured store. Safe to call often. */
export async function saveSnapshot(db, { force = false, file: explicitPath = null, allowEmpty = false } = {}) {
  const b = backend();
  status.backend = b;
  if (!b || saving) return { saved: false };
  const dbPath = explicitPath || db?.location?.() || path.join(process.env.DATA_DIR || 'data', 'azolve.db');
  if (!fs.existsSync(dbPath)) return { saved: false, reason: 'no-db' };

  const sig = signature(dbPath);
  if (!force && sig === lastSig) return { saved: false, reason: 'unchanged' };

  /* Never replace a snapshot that may hold real accounts with a database that
     has none. This is what would happen if a restore failed transiently on a
     diskless host: the container starts empty and the first save would wipe the
     only copy of everyone's data. */
  if (!allowEmpty) {
    const users = (() => { try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; } catch { return 0; } })();
    if (!users) {
      try {
        const existing = b === 'postgres' ? await pgGet() : await ghGet();
        if (existing) {
          status.lastError = null;
          console.warn('[persist] refusing to overwrite a stored snapshot with an empty database');
          return { saved: false, reason: 'empty-db-guard' };
        }
      } catch { /* if we cannot read it, fall through and save */ }
    }
  }

  saving = true;
  try {
    /* Fold the write-ahead log back into the main file, otherwise the copy we
       upload can be missing the most recent messages. */
    try { db?.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* not fatal */ }

    const raw = fs.readFileSync(dbPath);
    const packed = encrypt(zlib.gzipSync(raw));
    if (b === 'postgres') await pgPut(packed);
    else await ghPut(packed, await ghGet());

    lastSig = sig;
    status.lastSaveAt = Date.now();
    status.lastSaveBytes = raw.length;
    status.lastError = null;
    return { saved: true, bytes: raw.length };
  } catch (e) {
    status.lastError = e.message;
    console.warn('[persist] save failed:', e.message);
    return { saved: false, reason: e.message };
  } finally {
    saving = false;
  }
}

/* ---------------------------------------------------------------------------
   Event-driven saves
   Waiting for the 60 second tick means a brand new account is not backed up
   for up to a minute. Signup, login and refresh call requestSave() so the
   snapshot is current within a fraction of a second.
--------------------------------------------------------------------------- */
let boundDb = null;
let pendingSave = null;

export function bindDb(db) { boundDb = db; }

export function requestSave(delay = 300) {
  if (!snapshotEnabled() || !boundDb) return;
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    pendingSave = null;
    saveSnapshot(boundDb, { force: true }).catch(() => {});
  }, delay);
  pendingSave.unref?.();
}

/** Start the background saver. Returns a stop function. */
export function startSnapshotLoop(db) {
  const b = backend();
  status.backend = b;
  if (!b) {
    console.log('[persist] no snapshot store configured — data lives only on this instance');
    return () => {};
  }
  console.log(`[persist] snapshotting to ${b} every ${EVERY / 1000}s`);
  const timer = setInterval(() => { saveSnapshot(db).catch(() => {}); }, EVERY);
  timer.unref?.();

  /* Render sends SIGTERM before it stops a container. Try to get one last copy
     out; the process may not wait, so the periodic save is the real guarantee. */
  const bye = async () => { await saveSnapshot(db, { force: true }).catch(() => {}); process.exit(0); };
  process.once('SIGTERM', bye);
  process.once('SIGINT', bye);

  return () => { clearInterval(timer); };
}
