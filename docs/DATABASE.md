# AZOLVE CHAT — Database Schema

Engine: **SQLite** via Node 22's built-in `node:sqlite` (`DatabaseSync`), WAL journal, foreign keys on.
File: `data/azolve.db` (configurable with `DATA_DIR`). Uploads: `data/uploads/`.

The schema is created idempotently on boot from `server/db.js` (`CREATE TABLE IF NOT EXISTS`), so a fresh clone starts with an empty, ready database. All queries are parameterised through four helpers:

```js
all(sql, ...params)   // rows
get(sql, ...params)   // first row
run(sql, ...params)   // write
tx(fn)                // BEGIN / COMMIT / ROLLBACK
```

Because the data layer is isolated in `db.js`, migrating to PostgreSQL means porting these four helpers plus the DDL below — no route code changes.

---

## 1. Entity map

```
users ──┬── sessions
        ├── otps
        ├── participants ── conversations ── messages ──┬── translations
        │                                              ├── reactions
        │                                              ├── receipts
        │                                              └── (reply_to → messages.id)
        ├── moments ──┬── moment_views
        │             ├── moment_reactions
        │             └── highlights
        ├── posts ──┬── post_likes
        │           ├── post_comments
        │           └── post_saves
        ├── follows (follower → following)
        ├── communities ── community_members
        │                └── community_posts ── poll_votes
        ├── notifications
        ├── calls
        ├── blocks
        ├── reports
        └── ai_messages
audit_log (actor → users)
```

---

## 2. Tables

### users
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `u_<random>` |
| email / phone | TEXT UNIQUE | either can be null |
| password_hash | TEXT | bcrypt |
| username | TEXT UNIQUE | handle, used in `#/profile/:username` |
| display_name, avatar, cover, bio, dob, country | TEXT | profile |
| language | TEXT | default `en` — **the translation target for this user** |
| mood, mood_text | TEXT | Mood-Based Status |
| role | TEXT | `user` \| `moderator` \| `admin` |
| verified | INTEGER | badge |
| is_private | INTEGER | private profile |
| status | TEXT | `active` \| `suspended` \| `deleted` |
| last_seen | INTEGER | epoch ms |
| prefs | TEXT (JSON) | notification + UI preferences |
| privacy | TEXT (JSON) | lastSeen, readReceipts, storyAudience, etc. |
| twofa_enabled, twofa_secret | | TOTP |
| temporary_identity | INTEGER | Temporary Identity Mode |

### sessions
`id`, `user_id`, `token_hash`, `device` (UA), `ip`, `created_at`, `last_active`, `revoked`.
Refresh tokens rotate on every `/auth/refresh`; the old row is revoked.

### otps
`id`, `user_id`, `target`, `code`, `purpose` (`signup`/`reset`), `expires_at`, `used`.
In `OTP_DEMO_MODE` the code is returned in the API response and shown in the UI labelled as demo delivery.

### conversations
`id`, `type` (`dm`/`group`), `title`, `avatar`, `created_by`, `created_at`, `disappear_seconds`, `wallpaper`, `community_id`.

### participants
Composite PK `(conversation_id, user_id)`. Per-user chat state: `role`, `joined_at`, `last_read_at`, `muted`, `archived`, `pinned`, `locked`, `language_override`, `nickname`.

`language_override` is how a user can read one specific chat in a different language without changing their global setting.

### messages
| Column | Notes |
|---|---|
| id | `m_<random>` |
| conversation_id, sender_id | |
| body | **the immutable original text** |
| original_body | copy of the original at creation (kept even if `body` is edited) |
| original_lang | detected language (`hi`, `ar`, `ja`, …) |
| type | `text`/`image`/`video`/`file`/`voice`/`location`/`contact`/`system` |
| media_url, media_meta (JSON) | uploaded asset + dimensions/duration/name/size |
| reply_to | parent message id |
| created_at, edited_at | epoch ms |
| deleted | soft delete |
| scheduled_for | Smart Message Delivery / scheduled send |
| silent | silent message |
| pinned | pinned in chat |
| starred | JSON array of user ids who starred |
| location, contact | JSON payloads |
| client_id | optimistic UI idempotency key |

Index: `idx_msg_conv (conversation_id, created_at)`.

### translations
**The heart of per-recipient translation.**
Composite PK `(message_id, lang)`, columns `text`, `provider`, `created_at`.
One row per (message, reader language). Never mutates `messages.body`. Cache is reused across readers of the same language, and invalidated when a message is edited.

### reactions
PK `(message_id, user_id, emoji)` — multiple emoji per user allowed, matching modern chat UX.

### receipts
PK `(message_id, user_id)`, `state`, `at` — read receipts.

### moments
`id`, `user_id`, `type` (`image`/`video`/`text`), `media_url`, `text`, `bg`, `caption`, `location`, `audience` (`followers`/`close`/`private`), `expires_at` (created_at + 24h), `music`, `ai_generated`, `hide_from` (JSON array).

### moment_views / moment_reactions / highlights
- `moment_views (moment_id, user_id, at)` — viewer list + analytics.
- `moment_reactions (moment_id, user_id, emoji, at)`.
- `highlights (id, user_id, title, cover, moment_ids JSON, created_at)` — saved moments that outlive 24h.

### posts
`id`, `user_id`, `caption`, `original_lang`, `media` (JSON array of `{kind,url,w,h}` for carousels/video), `location`, `privacy` (`public`/`followers`/`private`), `type` (`post`/`reel`), `created_at`, `likes_count`, `comments_count`.

### post_likes / post_comments / post_saves
- `post_likes (post_id, user_id, at)`
- `post_comments (id, post_id, user_id, body, original_lang, created_at, parent_id)` — `original_lang` enables per-viewer comment translation.
- `post_saves (post_id, user_id, at)`

### follows
PK `(follower_id, following_id)`, `at`.

### communities
`id`, `name`, `slug` UNIQUE, `description`, `avatar`, `cover`, `category`, `privacy` (`public`/`private`), `owner_id`, `created_at`, `rules`.

### community_members
PK `(community_id, user_id)`, `role` (`owner`/`admin`/`moderator`/`member`), `joined_at`, `anonymous` (Temporary Identity Mode inside communities).

### community_posts
`id`, `community_id`, `user_id`, `body`, `original_lang`, `media` JSON, `created_at`, `type` (`discussion`/`poll`/`event`), `poll` JSON `{question, options[]}`, `event` JSON `{title, startsAt, location}`.

### poll_votes
PK `(post_id, user_id)`, `option_index`, `at` — one vote per member, changeable.

### notifications
`id`, `user_id`, `type`, `actor_id`, `entity`, `entity_id`, `text`, `read`, `created_at`.

### calls
`id`, `conversation_id`, `caller_id`, `callee_id`, `type` (`audio`/`video`), `status` (`ringing`/`completed`/`missed`/`declined`), `started_at`, `ended_at`, `duration` (seconds), `participants` JSON.

### blocks
PK `(blocker_id, blocked_id)`. Enforced in chats, feed, moments, profiles and search.

### reports
`id`, `reporter_id`, `target_type` (`user`/`post`/`moment`/`message`/`community`), `target_id`, `reason`, `details`, `status` (`open`/`resolved`/`dismissed`), `created_at`.

### ai_messages
`id`, `user_id`, `thread_id`, `role` (`user`/`assistant`), `content`, `created_at` — persistent AZOLVE AI threads.

### audit_log
`id`, `actor_id`, `action`, `target`, `meta` JSON, `created_at` — every admin mutation.

---

## 3. Data-integrity rules

1. **Originals are immutable.** `messages.body` is written once. Translation writes only to `translations`.
2. **Edit is explicit.** `PATCH /chats/:id/messages/:mid` rewrites `body` and `original_body`, re-detects `original_lang`, and deletes cached translations for that message.
3. **Delete is soft.** `deleted = 1`; the row remains for receipts and replies, the body is hidden by the API.
4. **Account deletion is soft.** `status='deleted'`, email/phone/avatar cleared, username replaced with `deleted_<id>` so the handle can be reused.
5. **Cascading cleanup** is handled in route code (e.g. deleting a post removes its likes, comments and saves).
6. **Blocking** is checked before returning conversations, messages, feed items, moments and profiles.

---

## 4. Seeding

`npm run seed` (`server/seed.js`) creates 7 users, a follow graph, a multilingual group ("Global Founders 🌍"), a DM, 6 posts, 4 moments, 4 communities, notifications, 2 call records and 1 open report.

All seeded media uses Unsplash URLs; no binary assets are committed. Seeded content is demo data and is labelled as such in the UI and docs.
