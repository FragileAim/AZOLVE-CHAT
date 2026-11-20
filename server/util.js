import crypto from 'node:crypto';

export const id = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');
export const now = () => Date.now();
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
export const parseJSON = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function publicUser(u, viewerId = null) {
  if (!u) return null;
  const privacy = parseJSON(u.privacy, {});
  const hideLastSeen = privacy.lastSeen === 'nobody';
  const out = {
    id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar, cover: u.cover,
    bio: u.bio, country: u.country, language: u.language, mood: u.mood, moodText: u.mood_text,
    verified: !!u.verified, isPrivate: !!u.is_private, role: u.role, createdAt: u.created_at,
    lastSeen: hideLastSeen && viewerId !== u.id ? null : u.last_seen,
    online: hideLastSeen && viewerId !== u.id ? false : Date.now() - (u.last_seen || 0) < 70000,
    temporaryIdentity: !!u.temporary_identity,
  };
  if (viewerId === u.id) {
    out.email = u.email; out.phone = u.phone; out.dob = u.dob; out.privacy = privacy;
    out.prefs = parseJSON(u.prefs, {}); out.twofaEnabled = !!u.twofa_enabled;
    out.emailVerified = !!u.email_verified; out.phoneVerified = !!u.phone_verified;
  }
  return out;
}

export function err(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

export const LANG_NAMES = {
  en: 'English', hi: 'हिन्दी', ar: 'العربية', gu: 'ગુજરાતી', es: 'Español', fr: 'Français',
  de: 'Deutsch', zh: '中文', ja: '日本語', ko: '한국어', pt: 'Português', ru: 'Русский',
  it: 'Italiano', tr: 'Türkçe', id: 'Bahasa Indonesia', bn: 'বাংলা', mr: 'मराठी',
  ta: 'தமிழ்', te: 'తెలుగు', ur: 'اردو', nl: 'Nederlands', pl: 'Polski', vi: 'Tiếng Việt',
  th: 'ไทย', he: 'עברית', fa: 'فارسی', sw: 'Kiswahili',
};
export const langName = (code) => LANG_NAMES[code] || code;
export const RTL = new Set(['ar', 'ur', 'he', 'fa']);
