import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { restoreSnapshot, backend } from './services/persist.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'azolve.db');

/* On a host without a persistent disk the container starts empty after every
   deploy. Pull the last snapshot before opening the file so people keep their
   accounts, chats and contacts. A local database that already holds users is
   always considered newer and is never overwritten. */
function holdsUsers(file) {
  try {
    if (!fs.existsSync(file)) return false;
    const probe = new DatabaseSync(file, { readOnly: true });
    try {
      const row = probe.prepare('SELECT COUNT(*) AS n FROM users').get();
      return (row?.n || 0) > 0;
    } finally { probe.close(); }
  } catch { return false; }
}

if (!holdsUsers(DB_PATH)) {
  const r = await restoreSnapshot(DB_PATH);
  if (r.restored) {
    console.log(`[db] restored ${Math.round(r.bytes / 1024)} KB snapshot from ${backend()}`);
  } else if (r.reason && r.reason !== 'not-configured' && r.reason !== 'no-snapshot-yet') {
    console.warn('[db] snapshot restore skipped:', r.reason);
  }
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, password_hash TEXT,
  username TEXT UNIQUE, display_name TEXT, avatar TEXT, cover TEXT, bio TEXT,
  dob TEXT, country TEXT, language TEXT DEFAULT 'en', mood TEXT, mood_text TEXT,
  role TEXT DEFAULT 'user', verified INTEGER DEFAULT 0, is_private INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', last_seen INTEGER, created_at INTEGER,
  prefs TEXT DEFAULT '{}', privacy TEXT DEFAULT '{}', twofa_enabled INTEGER DEFAULT 0,
  twofa_secret TEXT, temporary_identity INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS otps (
  id TEXT PRIMARY KEY, user_id TEXT, target TEXT, code TEXT, purpose TEXT,
  expires_at INTEGER, used INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT, device TEXT, ip TEXT,
  created_at INTEGER, last_active INTEGER, revoked INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, type TEXT DEFAULT 'dm', title TEXT, avatar TEXT,
  created_by TEXT, created_at INTEGER, disappear_seconds INTEGER DEFAULT 0,
  wallpaper TEXT, community_id TEXT
);
CREATE TABLE IF NOT EXISTS participants (
  conversation_id TEXT, user_id TEXT, role TEXT DEFAULT 'member', joined_at INTEGER,
  last_read_at INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, language_override TEXT,
  nickname TEXT, PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT, sender_id TEXT, body TEXT,
  original_body TEXT, original_lang TEXT, type TEXT DEFAULT 'text', media_url TEXT,
  media_meta TEXT, reply_to TEXT, created_at INTEGER, edited_at INTEGER,
  deleted INTEGER DEFAULT 0, scheduled_for INTEGER, silent INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0, starred TEXT DEFAULT '[]', location TEXT, contact TEXT,
  client_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS translations (
  message_id TEXT, lang TEXT, text TEXT, provider TEXT, created_at INTEGER,
  PRIMARY KEY (message_id, lang)
);
CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT, user_id TEXT, emoji TEXT, created_at INTEGER,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS receipts (
  message_id TEXT, user_id TEXT, state TEXT, at INTEGER,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY, user_id TEXT, type TEXT DEFAULT 'image', media_url TEXT,
  text TEXT, bg TEXT, caption TEXT, location TEXT, audience TEXT DEFAULT 'followers',
  expires_at INTEGER, created_at INTEGER, music TEXT, ai_generated INTEGER DEFAULT 0,
  hide_from TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS moment_views (moment_id TEXT, user_id TEXT, at INTEGER, PRIMARY KEY (moment_id, user_id));
CREATE TABLE IF NOT EXISTS moment_reactions (moment_id TEXT, user_id TEXT, emoji TEXT, at INTEGER, PRIMARY KEY (moment_id, user_id));
CREATE TABLE IF NOT EXISTS highlights (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, cover TEXT, moment_ids TEXT DEFAULT '[]', created_at INTEGER);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, user_id TEXT, caption TEXT, original_lang TEXT, media TEXT DEFAULT '[]',
  location TEXT, privacy TEXT DEFAULT 'public', type TEXT DEFAULT 'post', created_at INTEGER,
  likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS post_likes (post_id TEXT, user_id TEXT, at INTEGER, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, body TEXT, original_lang TEXT, created_at INTEGER, parent_id TEXT
);
CREATE TABLE IF NOT EXISTS post_saves (post_id TEXT, user_id TEXT, at INTEGER, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS follows (follower_id TEXT, following_id TEXT, at INTEGER, PRIMARY KEY (follower_id, following_id));
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY, name TEXT, slug TEXT UNIQUE, description TEXT, avatar TEXT, cover TEXT,
  category TEXT, privacy TEXT DEFAULT 'public', owner_id TEXT, created_at INTEGER, rules TEXT
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT, user_id TEXT, role TEXT DEFAULT 'member', joined_at INTEGER, anonymous INTEGER DEFAULT 0,
  PRIMARY KEY (community_id, user_id)
);
CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY, community_id TEXT, user_id TEXT, body TEXT, original_lang TEXT,
  media TEXT DEFAULT '[]', created_at INTEGER, type TEXT DEFAULT 'discussion', poll TEXT, event TEXT
);
CREATE TABLE IF NOT EXISTS poll_votes (post_id TEXT, user_id TEXT, option_index INTEGER, at INTEGER, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT, type TEXT, actor_id TEXT, entity TEXT, entity_id TEXT,
  text TEXT, read INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY, conversation_id TEXT, caller_id TEXT, callee_id TEXT, type TEXT,
  status TEXT, started_at INTEGER, ended_at INTEGER, duration INTEGER DEFAULT 0, participants TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS blocks (blocker_id TEXT, blocked_id TEXT, at INTEGER, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE IF NOT EXISTS contact_requests (
  id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, note TEXT, status TEXT DEFAULT 'pending',
  created_at INTEGER, responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_creq_to ON contact_requests(to_id, status);
CREATE INDEX IF NOT EXISTS idx_creq_from ON contact_requests(from_id, status);
CREATE TABLE IF NOT EXISTS contacts (
  owner_id TEXT, peer_id TEXT, created_at INTEGER, source TEXT DEFAULT 'request',
  PRIMARY KEY (owner_id, peer_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter_id TEXT, target_type TEXT, target_id TEXT, reason TEXT,
  details TEXT, status TEXT DEFAULT 'open', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY, user_id TEXT, thread_id TEXT, role TEXT, content TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT,
  ua TEXT, created_at INTEGER, last_ok INTEGER, fails INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
/* Firebase Cloud Messaging device tokens. A Capacitor WebView has no Push API,
   so the native shell can only be woken through FCM. One row per device. */
CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY, user_id TEXT, platform TEXT, ua TEXT,
  created_at INTEGER, last_ok INTEGER, fails INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_device_user ON device_tokens(user_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, target TEXT, meta TEXT, created_at INTEGER
);
`;
db.exec(SCHEMA);

/* --- forward-only migrations for databases created by older builds ------- */
const migrations = [
  ['users', 'phone_verified', 'INTEGER DEFAULT 0'],
  ['users', 'email_verified', 'INTEGER DEFAULT 0'],
  ['otps', 'attempts', 'INTEGER DEFAULT 0'],
  ['otps', 'sent_at', 'INTEGER'],
  ['otps', 'channel', "TEXT DEFAULT 'sms'"],
  ['sessions', 'prev_hash', 'TEXT'],
  ['sessions', 'prev_at', 'INTEGER'],
  /* Who ended a call, and why. Without these a call log can only say
     "completed" — it cannot answer the question people actually ask, which is
     "did they hang up on me or did my signal drop?". */
  ['calls', 'ended_by', 'TEXT'],
  ['calls', 'ended_reason', 'TEXT'],
  ['calls', 'answered_at', 'INTEGER'],
  /* Google sign-in: the stable Google subject id, so a person who changes their
     Google email address still lands on the same AZOLVE account. */
  ['users', 'oauth_sub', 'TEXT'],
  /* Onboarding used to be inferred from "has a country and a bio". That is a
     guess, not a fact: someone who deliberately left the bio blank was asked
     to fill the whole form again on every single login. An explicit timestamp
     records that they actually finished it, once. */
  ['users', 'onboarded_at', 'INTEGER'],
];
for (const [table, column, type] of migrations) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    console.warn(`[db] migration ${table}.${column} skipped:`, e.message);
  }
}

/* Everyone who already filled in a country and a bio has plainly finished
   onboarding, so mark them done rather than marching them through the form
   again after this upgrade. Idempotent: only rows still NULL are touched. */
try {
  db.exec(`
    UPDATE users SET onboarded_at = COALESCE(created_at, 0)
    WHERE onboarded_at IS NULL
      AND country IS NOT NULL AND country != ''
      AND bio IS NOT NULL AND bio != ''
  `);
} catch (e) {
  console.warn('[db] onboarding backfill skipped:', e.message);
}


/* Anyone who already had a direct conversation is, in effect, already connected.
   Backfill the contacts table from existing DMs so the new request gate does not
   lock people out of chats they were already having. Runs once — the INSERT OR
   IGNORE makes it a no-op afterwards. */
try {
  db.exec(`
    INSERT OR IGNORE INTO contacts (owner_id, peer_id, created_at, source)
    SELECT p1.user_id, p2.user_id, COALESCE(c.created_at, 0), 'backfill'
    FROM conversations c
    JOIN participants p1 ON p1.conversation_id = c.id
    JOIN participants p2 ON p2.conversation_id = c.id AND p2.user_id != p1.user_id
    WHERE c.type = 'dm';
  `);
} catch (e) {
  console.warn('[db] contact backfill skipped:', e.message);
}

export const all = (sql, ...params) => db.prepare(sql).all(...params.map(p => p === undefined ? null : p));
export const get = (sql, ...params) => db.prepare(sql).get(...params.map(p => p === undefined ? null : p));
export const run = (sql, ...params) => db.prepare(sql).run(...params.map(p => p === undefined ? null : p));
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
export default db;
