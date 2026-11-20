/* Proves the encrypted snapshot actually round-trips through whichever store is
   configured:
     build a database with a user + a message, save it, delete the local file,
     restore it, and confirm the account is still there and readable.

   Works with both backends:
     SNAPSHOT_PG_URL=postgres://...            (postgres)
     SNAPSHOT_REPO / SNAPSHOT_TOKEN            (private github repo)
   Plus SNAPSHOT_KEY in both cases.
   Run: node scripts/test-persist.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { saveSnapshot, restoreSnapshot, snapshotEnabled, backend } from '../server/services/persist.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}${d ? '  ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${n}  ->  ${d}`); } };

check('a snapshot store is configured', snapshotEnabled(),
  snapshotEnabled() ? `backend=${backend()}` : 'set SNAPSHOT_PG_URL or SNAPSHOT_REPO+SNAPSHOT_TOKEN, plus SNAPSHOT_KEY');
if (!snapshotEnabled()) { console.log('\nCannot test without configuration.\n'); process.exit(1); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azolve-persist-'));
const file = path.join(dir, 'azolve.db');

/* A tiny stand-in for the real schema: what matters is the bytes survive. */
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL');
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT)');
db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, body TEXT)');
const stamp = Date.now();
db.prepare('INSERT INTO users VALUES (?,?,?)').run('u_persist', `persist.${stamp}@azolve.io`, 'Persist Tester');
db.prepare('INSERT INTO messages VALUES (?,?)').run('m_persist', 'this message must survive a deploy');

const saved = await saveSnapshot(db, { force: true, file });
check(`snapshot saved to ${backend()}`, !!saved?.saved, JSON.stringify(saved));
db.close();

/* Simulate a fresh container: the local file is gone. */
fs.rmSync(file, { force: true });
fs.rmSync(file + '-wal', { force: true });
fs.rmSync(file + '-shm', { force: true });
check('local database is gone', !fs.existsSync(file));

const restored = await restoreSnapshot(file);
check('restore reports success', !!restored.restored, JSON.stringify(restored));
check('a database file was written', fs.existsSync(file));

const back = new DatabaseSync(file, { readOnly: true });
const u = back.prepare('SELECT * FROM users WHERE id = ?').get('u_persist');
const m = back.prepare('SELECT * FROM messages WHERE id = ?').get('m_persist');
check('the account came back', u?.email === `persist.${stamp}@azolve.io`, u?.email || 'missing');
check('the message came back', m?.body === 'this message must survive a deploy', m?.body || 'missing');
back.close();

/* What sits in the store must be ciphertext, not a readable SQLite file. */
let blob = null;
if (backend() === 'postgres') {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.SNAPSHOT_PG_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const r = await pool.query('SELECT data FROM azolve_snapshot WHERE id = $1', ['db']);
  blob = r.rows[0]?.data || null;
  await pool.end();
} else {
  const remote = await fetch(`https://api.github.com/repos/${process.env.SNAPSHOT_REPO}/contents/${encodeURIComponent(process.env.SNAPSHOT_PATH || 'azolve.db.enc')}`, {
    headers: { Authorization: `Bearer ${process.env.SNAPSHOT_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  blob = Buffer.from((await remote.json()).content || '', 'base64');
}
check('the stored snapshot is encrypted, not a raw database',
  !!blob && blob.subarray(0, 4).toString() === 'AZV1' && blob.subarray(0, 15).toString() !== 'SQLite format 3',
  blob ? `${blob.subarray(0, 4).toString()} · ${blob.length} bytes` : 'no blob');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
