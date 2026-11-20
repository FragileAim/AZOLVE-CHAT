import bcrypt from 'bcryptjs';
import { get, run, all } from './db.js';
import { id, now, parseJSON } from './util.js';
import { detectLanguage } from './services/translate.js';

const PASSWORD = process.env.DEMO_PASSWORD || 'Azolve@2025';
const IMG = {
  priya: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80',
  omar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80',
  lena: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80',
  miguel: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80',
  yuki: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&q=80',
  alex: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80',
  admin: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400&q=80',
};
const POST_IMG = [
  'https://images.unsplash.com/photo-1526772662000-3f88f10405ff?w=900&q=80',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=900&q=80',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=900&q=80',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=900&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=900&q=80',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=900&q=80',
];

const PEOPLE = [
  { key: 'alex', email: 'alex@azolve.io', name: 'Alex Rivera', username: 'alexr', lang: 'en', country: 'US', bio: 'Product designer. Building calm interfaces for a noisy world.', mood: '🎧 Focused', verified: 1 },
  { key: 'priya', email: 'priya@azolve.io', name: 'Priya Sharma', username: 'priyasharma', lang: 'hi', country: 'IN', bio: 'Product manager in Bengaluru. Coffee, cricket, and cross-cultural teams.', mood: '☕ Energised', verified: 1 },
  { key: 'omar', email: 'omar@azolve.io', name: 'Omar Al-Farsi', username: 'omarfarsi', lang: 'ar', country: 'AE', bio: 'Dubai. Logistics founder. Always shipping.', mood: '🌙 Night owl' },
  { key: 'lena', email: 'lena@azolve.io', name: 'Lena Fischer', username: 'lenafischer', lang: 'de', country: 'DE', bio: 'Engineering lead in Berlin. Distributed systems and good bread.', mood: '🚀 Shipping' },
  { key: 'miguel', email: 'miguel@azolve.io', name: 'Miguel Santos', username: 'miguels', lang: 'es', country: 'BR', bio: 'Growth & partnerships. São Paulo → everywhere.', mood: '🎸 Creative' },
  { key: 'yuki', email: 'yuki@azolve.io', name: 'Yuki Tanaka', username: 'yukitanaka', lang: 'ja', country: 'JP', bio: 'Motion designer in Tokyo. Making pixels move.', mood: '🍜 Happy' },
];

/**
 * Demo workspace seeding is OFF by default.
 *
 * Production and team-test deployments start empty: the first person to sign
 * up with a phone number becomes the admin (see roleForNewUser in
 * routes/auth.js). If you explicitly want the sample workspace back for a
 * throwaway demo box, start the server with SEED_DEMO=1.
 */
export async function seedIfEmpty() {
  if (process.env.SEED_DEMO !== '1') {
    const n = get('SELECT COUNT(*) c FROM users').c;
    if (n === 0) {
      console.log('[seed] demo seeding disabled — the first phone sign-up becomes the admin');
    }
    return;
  }
  if (get('SELECT COUNT(*) c FROM users').c > 0) return;
  console.log('[seed] SEED_DEMO=1 — creating sample workspace (demo data, not real users)');
  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = {};
  const addUser = (u, role = 'user') => {
    const uid = id('u_');
    run(`INSERT INTO users (id, email, password_hash, username, display_name, avatar, bio, country, language, mood, role, verified, created_at, last_seen, status, prefs, privacy)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid, u.email, hash, u.username, u.name, IMG[u.key] || null, u.bio || '', u.country || 'US', u.lang || 'en',
      u.mood || null, role, u.verified || 0, now() - 90 * 864e5, now() - Math.floor(Math.random() * 3600e3), 'active',
      JSON.stringify({ autoTranslate: true, notifications: { messages: true, social: true, calls: true } }),
      JSON.stringify({ profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' }));
    return get('SELECT * FROM users WHERE id = ?', uid);
  };
  for (const p of PEOPLE) users[p.key] = addUser(p);
  users.admin = addUser({ key: 'admin', email: 'admin@azolve.io', name: 'AZOLVE Admin', username: 'azolve', lang: 'en', country: 'IN', bio: 'Platform operations — AZOLVE INFOTECH.', verified: 1 }, 'admin');

  // follow graph
  const keys = Object.keys(users);
  for (const a of keys) for (const b of keys) if (a !== b) run('INSERT OR IGNORE INTO follows (follower_id, following_id, at) VALUES (?,?,?)', users[a].id, users[b].id, now() - 30 * 864e5);

  // global group
  const gid = id('c_');
  run('INSERT INTO conversations (id, type, title, created_by, created_at) VALUES (?,?,?,?,?)', gid, 'group', 'Global Founders 🌍', users.alex.id, now() - 20 * 864e5);
  for (const k of ['alex', 'priya', 'omar', 'lena', 'miguel', 'yuki']) {
    run('INSERT INTO participants (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?,?,?,?,?)', gid, users[k].id, k === 'alex' ? 'owner' : 'member', now() - 20 * 864e5, now() - 3600e3);
  }
  const script = [
    ['alex', 'Morning everyone — the new onboarding flow is live on staging. Would love your eyes on it before Friday.', -7200],
    ['priya', 'आप कैसे हैं? मुझे आपसे बात करनी है।', -7100],
    ['lena', 'Mir geht es gut, danke! Ich schaue es mir heute Abend an.', -7000],
    ['omar', 'مرحبا بالجميع، سأراجع التصميم الجديد وأشارك ملاحظاتي غدا.', -6900],
    ['miguel', 'Perfecto. ¿Podemos revisar también la versión en español?', -6800],
    ['yuki', 'はい、日本語のコピーも確認します。', -6700],
    ['alex', 'Amazing — this is exactly why we built Universal Language Mode. Everyone is reading this in their own language right now.', -6600],
    ['priya', 'यह कितना आसान है! मुझे अनुवाद के बारे में सोचना भी नहीं पड़ता।', -3600],
    ['lena', 'Genau. Kein Sprachwechsel mehr nötig.', -3500],
  ];
  for (const [who, body, offset] of script) {
    const mid = id('m_');
    run(`INSERT INTO messages (id, conversation_id, sender_id, body, original_body, original_lang, type, created_at)
         VALUES (?,?,?,?,?,?,?,?)`, mid, gid, users[who].id, body, body, detectLanguage(body), 'text', now() + offset * 1000);
  }

  // DM between alex and priya
  const dm = id('c_');
  run('INSERT INTO conversations (id, type, created_by, created_at) VALUES (?,?,?,?)', dm, 'dm', users.alex.id, now() - 5 * 864e5);
  run('INSERT INTO participants (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?,?,?,?,?)', dm, users.alex.id, 'member', now() - 5 * 864e5, now());
  run('INSERT INTO participants (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?,?,?,?,?)', dm, users.priya.id, 'member', now() - 5 * 864e5, now() - 600e3);
  const dmScript = [
    ['priya', 'नमस्ते Alex! क्या आप कल की बैठक के लिए तैयार हैं?', -5400],
    ['alex', 'Almost — I am finishing the deck tonight. Could you review the pricing slide?', -5300],
    ['priya', 'ज़रूर, मैं अभी देखती हूँ।', -5200],
    ['alex', 'Thank you! 🙏', -5100],
  ];
  for (const [who, body, offset] of dmScript) {
    run(`INSERT INTO messages (id, conversation_id, sender_id, body, original_body, original_lang, type, created_at)
         VALUES (?,?,?,?,?,?,?,?)`, id('m_'), dm, users[who].id, body, body, detectLanguage(body), 'text', now() + offset * 1000);
  }

  // posts
  const posts = [
    ['priya', 'Golden hour in Bengaluru. Some evenings just reset everything. 🌇 #bengaluru #goldenhour', 0],
    ['lena', 'Shipped a distributed cache rewrite today. 40% faster p99. Team is unstoppable. #engineering #berlin', 1],
    ['omar', 'Desert road, empty calendar, full tank. Best kind of Sunday. #dubai #roadtrip', 2],
    ['yuki', 'New motion study — 240 frames of pure calm. #motiondesign #tokyo', 3],
    ['miguel', 'São Paulo at night hits different. 🌃 #saopaulo #citylights', 4],
    ['alex', 'Design principle #12: if it needs a tooltip to be understood, it is not finished. #design #product', 5],
  ];
  for (const [who, caption, i] of posts) {
    run(`INSERT INTO posts (id, user_id, caption, original_lang, media, location, privacy, type, created_at, likes_count, comments_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id('p_'), users[who].id, caption, detectLanguage(caption),
      JSON.stringify([{ url: POST_IMG[i % POST_IMG.length], kind: 'image' }]), null, 'public', 'post', now() - (i + 1) * 7200e3,
      12 + i * 7, 2);
  }
  const firstPost = get('SELECT * FROM posts ORDER BY created_at DESC LIMIT 1');
  run('INSERT INTO post_comments (id, post_id, user_id, body, original_lang, created_at) VALUES (?,?,?,?,?,?)', id('cm_'), firstPost.id, users.omar.id, 'هذه الصورة رائعة جدا!', 'ar', now() - 3000e3);
  run('INSERT INTO post_comments (id, post_id, user_id, body, original_lang, created_at) VALUES (?,?,?,?,?,?)', id('cm_'), firstPost.id, users.lena.id, 'Wunderschönes Licht!', 'de', now() - 2500e3);

  // moments
  const moments = [
    ['priya', 'text', null, 'Deadline week. Breathing. Still shipping. 🧘‍♀️', 'linear-gradient(135deg,#FF6B6B,#FFD93D)'],
    ['lena', 'image', POST_IMG[1], 'Berlin, 06:40. The city before the city wakes up.', null],
    ['omar', 'text', null, 'Family lunch. 14 people. 3 languages. Zero misunderstandings. ❤️', 'linear-gradient(135deg,#0F2027,#2C5364)'],
    ['yuki', 'image', POST_IMG[3], 'Frame 217. Almost there.', null],
  ];
  for (const [who, type, media, text, bg] of moments) {
    run(`INSERT INTO moments (id, user_id, type, media_url, text, bg, audience, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      id('mo_'), users[who].id, type, media, text, bg, 'followers', now() + 20 * 3600e3, now() - Math.floor(Math.random() * 8) * 3600e3);
  }

  // communities
  const communities = [
    ['Global Builders', 'Technology', 'A home for founders and engineers building across borders. Weekly demo Fridays.', 'public'],
    ['Cross-Language Design', 'Education', 'Designing interfaces that survive translation. Case studies, critique, and critique of the critique.', 'public'],
    ['Dubai Founders Circle', 'Business', 'Private network for founders based in the Gulf. Intros, hiring, and honest numbers.', 'private'],
    ['Cinema & Motion', 'Entertainment', 'Motion designers, editors and film nerds. Share work, get feedback.', 'public'],
  ];
  for (const [name, category, desc, privacy] of communities) {
    const cid = id('cm_');
    run('INSERT INTO communities (id, name, slug, description, category, privacy, owner_id, created_at, rules) VALUES (?,?,?,?,?,?,?,?,?)',
      cid, name, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), desc, category, privacy, users.alex.id, now() - 15 * 864e5, 'Be kind. Stay on topic. No spam.');
    for (const k of ['alex', 'priya', 'lena', 'omar', 'miguel', 'yuki']) {
      run('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)', cid, users[k].id, k === 'alex' ? 'owner' : 'member', now() - 14 * 864e5);
    }
    const convId = id('c_');
    run('INSERT INTO conversations (id, type, title, created_by, created_at, community_id) VALUES (?,?,?,?,?,?)', convId, 'group', name, users.alex.id, now() - 15 * 864e5, cid);
    for (const k of ['alex', 'priya', 'lena', 'omar', 'miguel', 'yuki']) {
      run('INSERT INTO participants (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)', convId, users[k].id, k === 'alex' ? 'owner' : 'member', now() - 14 * 864e5);
    }
    run('INSERT INTO community_posts (id, community_id, user_id, body, original_lang, created_at, type) VALUES (?,?,?,?,?,?,?)',
      id('cp_'), cid, users.lena.id, 'Welcome to everyone joining this week. Introduce yourself in whichever language feels natural — everyone here reads in their own.', detectLanguage('Welcome to everyone joining this week.'), now() - 3 * 864e5, 'announcement');
    run('INSERT INTO community_posts (id, community_id, user_id, body, original_lang, created_at, type, poll) VALUES (?,?,?,?,?,?,?,?)',
      id('cp_'), cid, users.alex.id, 'What should we cover in the next live session?', 'en', now() - 2 * 864e5, 'poll',
      JSON.stringify({ question: 'Next live session topic', options: ['Cross-language UX', 'Scaling realtime chat', 'AI in messaging', 'Community moderation'] }));
  }

  // notifications
  run('INSERT INTO notifications (id, user_id, type, actor_id, entity, entity_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id('n_'), users.alex.id, 'like', users.priya.id, 'post', firstPost.id, 'Priya Sharma liked your post', now() - 900e3);

  // calls
  run('INSERT INTO calls (id, conversation_id, caller_id, callee_id, type, status, started_at, ended_at, duration) VALUES (?,?,?,?,?,?,?,?,?)',
    id('call_'), dm, users.priya.id, users.alex.id, 'video', 'completed', now() - 86400e3, now() - 86400e3 + 754000, 754);
  run('INSERT INTO calls (id, conversation_id, caller_id, callee_id, type, status, started_at, ended_at, duration) VALUES (?,?,?,?,?,?,?,?,?)',
    id('call_'), dm, users.alex.id, users.priya.id, 'audio', 'missed', now() - 7200e3, now() - 7200e3, 0);

  // a report for the admin console
  run('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id('rp_'), users.yuki.id, 'post', firstPost.id, 'spam', 'Automated filter flagged repeated promotional links.', 'open', now() - 4000e3);

  console.log(`[seed] done — ${Object.keys(users).length} demo accounts, password: ${PASSWORD}`);
}
