import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { get, run, all } from '../db.js';
import { id, now, code6, publicUser, err, parseJSON } from '../util.js';
import { createSession, rotateSession, requireAuth, issueToken } from '../auth.js';
import { deliverOtp, echoOtp, smsProviderName, smsConfigured } from '../services/sms.js';
import { deliverEmailOtp, emailProviderName, emailConfigured, emailWillDeliver, lastEmailDelivery } from '../services/email.js';

const r = Router();

const OTP_TTL = 10 * 60 * 1000;        // code lives 10 minutes
const RESEND_COOLDOWN = 30 * 1000;     // one send per 30s per number
const MAX_PER_HOUR = 6;                // hard cap per number
const MAX_ATTEMPTS = 5;                // wrong guesses before the code dies

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s) => /^\+?[1-9]\d{7,14}$/.test(String(s).replace(/[\s()-]/g, ''));

/* Normalise to E.164-ish: keep a leading +, strip spaces/dashes/parens. */
function normPhone(s) {
  let v = String(s || '').trim().replace(/[\s()\-.]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (!v.startsWith('+')) v = `+${v}`;
  return v;
}


/* The client says whether the person pressed "Sign in" or "Create account".
   Without it the old behaviour (create on demand) is kept, so older builds and
   the API keep working. With it, we never silently create a second account for
   an address that already has one, and never pretend an unknown address is a
   sign-in. */
function modeCheck(res, { mode, exists, channel, target }) {
  if (mode === 'signin' && !exists) {
    return err(res, 404,
      `No AZOLVE CHAT account uses ${target}. Create one instead — it takes a minute.`,
      { code: 'NO_ACCOUNT', channel });
  }
  if (mode === 'signup' && exists) {
    return err(res, 409,
      `${target} already has an account. Sign in instead — we will email you a code, no password needed.`,
      { code: 'ACCOUNT_EXISTS', channel });
  }
  return null;
}

/* ------------------------------ OTP plumbing ------------------------------ */

/**
 * Create an OTP row and try to deliver it.
 * Returns { code, delivered, provider, error }. `code` is only ever handed to
 * the caller so it can be echoed when OTP_DEV_ECHO=1 — never returned otherwise.
 */
async function issueOtp(user, target, purpose, channel = 'sms') {
  const code = code6();
  run(
    `INSERT INTO otps (id, user_id, target, code, purpose, expires_at, used, attempts, sent_at, channel)
     VALUES (?,?,?,?,?,?,0,0,?,?)`,
    id('o_'), user.id, target, code, purpose, now() + OTP_TTL, now(), channel,
  );

  if (channel === 'sms') {
    const out = await deliverOtp({ phone: target, code });
    if (!out.ok) console.warn(`[OTP] SMS delivery failed via ${out.provider}: ${out.error}`);
    // The console provider writes to the log, it does not send a text. Report
    // that honestly so the UI never claims "sent by SMS" when nothing was.
    const toLog = out.provider === 'console';
    return {
      code,
      delivered: out.ok && !toLog,
      provider: out.provider,
      error: toLog
        ? 'No SMS gateway configured — the code was written to the server log'
        : (out.ok ? undefined : out.error),
    };
  }

  // Email is the primary channel while SMS sits in DLT approval.
  const out = await deliverEmailOtp({
    email: target,
    code,
    purpose,
    name: user?.display_name,
  });
  if (!out.ok) console.warn(`[OTP] email delivery failed via ${out.provider}: ${out.error}`);
  // The console provider writes to the log, it does not send mail. Report that
  // honestly so the UI never claims "check your inbox" when nothing was sent.
  const toLog = out.provider === 'console' || out.toLog;
  return {
    code,
    delivered: out.ok && !toLog,
    provider: out.provider,
    error: toLog
      ? 'No email provider configured — the code was written to the server log'
      : (out.ok ? undefined : out.error),
  };
}

/**
 * Rate limit per target.
 * @returns {number} 0 when allowed, >0 seconds to wait, -1 when the hourly cap is hit.
 */
function tooSoon(target) {
  /* Only an *unused* code holds the cooldown. Once someone has verified, they
     have proven they own the address, so a fresh code can go out immediately —
     that is what makes "sign out, sign back in" feel instant. */
  const last = get('SELECT sent_at FROM otps WHERE target = ? AND used = 0 ORDER BY sent_at DESC LIMIT 1', target);
  if (last?.sent_at) {
    const wait = Math.ceil((last.sent_at + RESEND_COOLDOWN - now()) / 1000);
    if (wait > 0) return wait;
  }
  const hourAgo = now() - 60 * 60 * 1000;
  const n = get('SELECT COUNT(*) AS n FROM otps WHERE target = ? AND sent_at > ?', target, hourAgo);
  if ((n?.n || 0) >= MAX_PER_HOUR) return -1;
  return 0;
}

/* A code sent seconds ago is still valid. Telling someone to wait 30 seconds
   reads as "broken" when they just signed out and came back, so hand back the
   live code instead of a 429. */
function liveOtp(target) {
  return get(`SELECT * FROM otps WHERE target = ? AND used = 0 AND expires_at > ?
              ORDER BY sent_at DESC LIMIT 1`, target, now());
}

function uniqueUsername(base) {
  let u = String(base || 'azolve').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'azolve';
  if (u.length < 3) u = `user${u}`;
  let candidate = u, i = 0;
  while (get('SELECT 1 FROM users WHERE username = ?', candidate)) { i++; candidate = `${u}${i}`; }
  return candidate;
}

/* Who becomes an admin.
   1. ADMIN_EMAILS / ADMIN_PHONES — an explicit allowlist. This is the safe way:
      the role is tied to an identity you control, so nobody can grab admin by
      registering first.
   2. FIRST_USER_IS_ADMIN — legacy behaviour where the very first account on a
      fresh deployment becomes admin. Convenient, but on a public URL anyone who
      finds the site first wins the role, so it is off unless explicitly set. */
function adminAllowlist() {
  const emails = String(process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const phones = String(process.env.ADMIN_PHONES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return { emails, phones };
}

function roleForNewUser({ email = null, phone = null } = {}) {
  const { emails, phones } = adminAllowlist();
  if (email && emails.includes(String(email).toLowerCase())) return 'admin';
  if (phone && phones.includes(String(phone))) return 'admin';
  if (process.env.FIRST_USER_IS_ADMIN !== '1') return 'user';
  const n = get('SELECT COUNT(*) AS n FROM users');
  return (n?.n || 0) === 0 ? 'admin' : 'user';
}

function newUserRow({ email = null, phone = null, passwordHash = null, displayName, language = 'en' }) {
  const uid = id('u_');
  const uname = uniqueUsername(displayName || (email ? email.split('@')[0] : `user${String(now()).slice(-5)}`));
  run(
    `INSERT INTO users (id, email, phone, password_hash, username, display_name, avatar, language,
       created_at, last_seen, status, role, phone_verified, prefs, privacy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid, email, phone, passwordHash, uname, displayName || uname, null, language,
    now(), now(), 'pending', roleForNewUser({ email, phone }), phone ? 1 : 0,
    JSON.stringify({ autoTranslate: true, notifications: { messages: true, social: true, calls: true } }),
    JSON.stringify({ profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' }),
  );
  return get('SELECT * FROM users WHERE id = ?', uid);
}

/* ---------------------------- phone-first signup --------------------------- */

/**
 * Step 1 — the user types their phone number. We create a pending account if
 * this number is new, then text them a code.
 */
r.post('/phone/start', async (req, res) => {
  const raw = req.body?.phone;
  if (!isPhone(raw)) return err(res, 400, 'Enter a valid phone number with your country code, e.g. +919876543210');
  const phone = normPhone(raw);

  const wait = tooSoon(phone);
  if (wait === -1) return err(res, 429, 'Too many codes requested for this number. Try again in an hour.');

  let user = get('SELECT * FROM users WHERE phone = ?', phone);
  const isNew = !user;
  const blocked = modeCheck(res, { mode: req.body?.mode, exists: !!user, channel: 'sms', target: phone });
  if (blocked) return blocked;

  if (wait > 0) {
    const live = liveOtp(phone);
    if (live) {
      return res.json({
        userId: live.user_id,
        phone,
        isNew,
        channel: 'sms',
        provider: 'reused',
        delivered: true,
        reused: true,
        deliveryCode: echoOtp() ? live.code : undefined,
        message: 'Your code is still valid — check your messages.',
      });
    }
    return err(res, 429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });
  }
  if (!user) user = newUserRow({ phone, displayName: req.body?.displayName, language: req.body?.language });
  if (user.status === 'suspended') return err(res, 403, 'This account is suspended. Contact support@azolve.io');

  const out = await issueOtp(user, phone, isNew ? 'signup' : 'login', 'sms');

  res.json({
    userId: user.id,
    phone,
    isNew,
    channel: 'sms',
    provider: out.provider,
    delivered: out.delivered,
    deliveryError: out.delivered ? undefined : out.error,
    // Only present when the operator opted into test mode.
    deliveryCode: echoOtp() ? out.code : undefined,
    message: out.delivered
      ? `A 6-digit code was sent to ${phone}.`
      : 'Code generated. No SMS provider is configured, so read it from the server log.',
  });
});

/** Step 2 — the user types the 6 digits. */
r.post('/phone/verify', async (req, res) => {
  const { userId, code } = req.body || {};
  if (!userId || !code) return err(res, 400, 'userId and code are required');

  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return err(res, 404, 'No pending sign-up for this number. Start again.');

  const o = get(
    `SELECT * FROM otps WHERE user_id = ? AND code = ? AND used = 0 ORDER BY sent_at DESC LIMIT 1`,
    userId, String(code).trim(),
  );

  if (!o) {
    // Count the miss against the most recent live code so brute force is bounded.
    const live = get('SELECT * FROM otps WHERE user_id = ? AND used = 0 ORDER BY sent_at DESC LIMIT 1', userId);
    if (live) {
      const attempts = (live.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        run('UPDATE otps SET used = 1, attempts = ? WHERE id = ?', attempts, live.id);
        return err(res, 429, 'Too many incorrect attempts. Request a new code.');
      }
      run('UPDATE otps SET attempts = ? WHERE id = ?', attempts, live.id);
      return err(res, 400, `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) left.`);
    }
    return err(res, 400, 'Invalid verification code');
  }

  if (o.expires_at < now()) return err(res, 400, 'That code has expired — request a new one.');

  run('UPDATE otps SET used = 1 WHERE id = ?', o.id);
  run(`UPDATE users SET status = 'active', phone_verified = 1, last_seen = ? WHERE id = ?`, now(), userId);

  const fresh = get('SELECT * FROM users WHERE id = ?', userId);
  const s = createSession(fresh.id, req);
  res.json({
    ...s,
    user: publicUser(fresh, fresh.id),
    needsOnboarding: !fresh.onboarded_at,
    isNew: !fresh.country && !fresh.bio,
  });
});

/** Step 3 (optional) — resend. Same throttles as /phone/start. */
r.post('/phone/resend', async (req, res) => {
  const { userId } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user || !user.phone) return err(res, 404, 'No pending sign-up for this number. Start again.');

  const wait = tooSoon(user.phone);
  if (wait === -1) return err(res, 429, 'Too many codes requested for this number. Try again in an hour.');
  if (wait > 0) return err(res, 429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });

  const out = await issueOtp(user, user.phone, user.status === 'pending' ? 'signup' : 'login', 'sms');
  res.json({
    ok: true,
    provider: out.provider,
    delivered: out.delivered,
    deliveryError: out.delivered ? undefined : out.error,
    deliveryCode: echoOtp() ? out.code : undefined,
  });
});


/* Why a code did not arrive. Two very different causes, and telling the user the
   wrong one wastes their time:
     - no provider configured at all -> the code is only in the server log
     - a provider IS configured but rejected the send -> say what it said
   The provider's own message is the most useful thing we can show. Kept at
   module scope because both /otp/status and /email/start need it. */
function mailFailureNote() {
  const provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const configured = !!(provider && provider !== 'console');
  if (!configured) {
    return 'No mail provider is configured yet \u2014 the code was written to the server log instead of being emailed.';
  }
  return 'The email provider rejected this message, so no code was sent. Check the server log for the code, or fix the provider configuration.';
}

/** Lets the client tell the user, honestly, whether a real SMS will arrive. */
r.get('/otp/status', (req, res) => {
  const smsLive = smsConfigured() && smsProviderName() !== 'console';
  const mailConfigured = emailWillDeliver();
  const last = lastEmailDelivery();
  // A configured provider is not proof of delivery: a wrong port, a blocked IP
  // or an unverified sender all fail *after* configuration. If the most recent
  // send failed, say so instead of claiming email works.
  const mailLive = mailConfigured && !(last && last.ok === false);
  res.json({
    provider: smsProviderName(),
    configured: smsConfigured(),
    echo: echoOtp(),
    smsDelivery: smsLive,
    emailProvider: emailProviderName(),
    emailConfigured: emailConfigured(),
    emailDelivery: mailLive,
    // Which channel the client should lead with. Email is the default while
    // SMS is blocked on DLT approval in India.
    primary: mailLive ? 'email' : (smsLive ? 'phone' : 'email'),
    lastEmail: last || undefined,
    note: mailLive
      ? 'Verification codes are sent by email.'
      : (last && last.ok === false ? `The last email failed: ${last.error}` : mailFailureNote()),
  });
});

/* ---------------------------- email-first signup --------------------------- */

/**
 * Step 1 — the user types their email address. We create a pending account if
 * this address is new, then mail them a code. This is the primary flow while
 * SMS is stuck in DLT approval.
 */
r.post('/email/start', async (req, res) => {
  const raw = String(req.body?.email || '').trim().toLowerCase();
  if (!isEmail(raw)) return err(res, 400, 'Enter a valid email address, e.g. you@company.com');
  const email = raw;

  const wait = tooSoon(email);
  if (wait === -1) return err(res, 429, 'Too many codes requested for this address. Try again in an hour.');

  let user = get('SELECT * FROM users WHERE lower(email) = ?', email);
  const isNew = !user;
  const blocked = modeCheck(res, { mode: req.body?.mode, exists: !!user, channel: 'email', target: email });
  if (blocked) return blocked;

  /* Still inside the resend window and the last code has not expired: reuse it
     rather than making a returning user wait. */
  if (wait > 0) {
    const live = liveOtp(email);
    if (live) {
      return res.json({
        userId: live.user_id,
        email,
        isNew,
        channel: 'email',
        provider: 'reused',
        delivered: true,
        reused: true,
        deliveryCode: echoOtp() ? live.code : undefined,
        message: 'Your code is still valid — check your inbox and spam folder.',
      });
    }
    return err(res, 429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });
  }
  if (!user) user = newUserRow({ email, displayName: req.body?.displayName, language: req.body?.language });
  if (user.status === 'suspended') return err(res, 403, 'This account is suspended. Contact support@azolve.io');

  const out = await issueOtp(user, email, isNew ? 'signup' : 'login', 'email');

  res.json({
    userId: user.id,
    email,
    isNew,
    channel: 'email',
    provider: out.provider,
    delivered: out.delivered,
    deliveryError: out.delivered ? undefined : out.error,
    deliveryCode: echoOtp() ? out.code : undefined,
    message: out.delivered
      ? `A 6-digit code was sent to ${email}. Check your inbox and spam folder.`
      : mailFailureNote(),
  });
});

/** Step 2 — the user types the 6 digits. Marks the address verified. */
r.post('/email/verify', async (req, res) => {
  const { userId, code } = req.body || {};
  if (!userId || !code) return err(res, 400, 'userId and code are required');

  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return err(res, 404, 'No pending sign-up for this address. Start again.');

  const o = get(
    `SELECT * FROM otps WHERE user_id = ? AND code = ? AND used = 0 ORDER BY sent_at DESC LIMIT 1`,
    userId, String(code).trim(),
  );

  if (!o) {
    const live = get('SELECT * FROM otps WHERE user_id = ? AND used = 0 ORDER BY sent_at DESC LIMIT 1', userId);
    if (live) {
      const attempts = (live.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        run('UPDATE otps SET used = 1, attempts = ? WHERE id = ?', attempts, live.id);
        return err(res, 429, 'Too many incorrect attempts. Request a new code.');
      }
      run('UPDATE otps SET attempts = ? WHERE id = ?', attempts, live.id);
      return err(res, 400, `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) left.`);
    }
    return err(res, 400, 'Invalid verification code');
  }

  if (o.expires_at < now()) return err(res, 400, 'That code has expired — request a new one.');

  run('UPDATE otps SET used = 1 WHERE id = ?', o.id);
  run(`UPDATE users SET status = 'active', email_verified = 1, last_seen = ? WHERE id = ?`, now(), userId);

  const fresh = get('SELECT * FROM users WHERE id = ?', userId);
  const s = createSession(fresh.id, req);
  res.json({
    ...s,
    user: publicUser(fresh, fresh.id),
    needsOnboarding: !fresh.onboarded_at,
    isNew: !fresh.country && !fresh.bio,
  });
});

/** Step 3 (optional) — resend. Same throttles as /email/start. */
r.post('/email/resend', async (req, res) => {
  const { userId } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user || !user.email) return err(res, 404, 'No pending sign-up for this address. Start again.');

  const wait = tooSoon(user.email);
  if (wait === -1) return err(res, 429, 'Too many codes requested for this address. Try again in an hour.');
  if (wait > 0) return err(res, 429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });

  const out = await issueOtp(user, user.email, user.status === 'pending' ? 'signup' : 'login', 'email');
  res.json({
    ok: true,
    provider: out.provider,
    delivered: out.delivered,
    deliveryError: out.delivered ? undefined : out.error,
    deliveryCode: echoOtp() ? out.code : undefined,
  });
});

/* ------------------------- email + password (legacy) ----------------------- */

r.post('/signup', async (req, res) => {
  const { identifier, password, displayName } = req.body || {};
  if (!identifier || !password) return err(res, 400, 'Email/phone and password are required');
  if (String(password).length < 8) return err(res, 400, 'Password must be at least 8 characters');
  const ident = String(identifier).trim();
  const email = isEmail(ident) ? ident.toLowerCase() : null;
  const phone = isPhone(ident) ? normPhone(ident) : null;
  if (!email && !phone) return err(res, 400, 'Enter a valid email address or phone number (with country code)');
  if (get('SELECT 1 FROM users WHERE email = ? OR phone = ?', email, phone)) {
    return err(res, 409, 'An account with these details already exists. Try logging in.');
  }

  const user = newUserRow({
    email, phone,
    passwordHash: await bcrypt.hash(password, 10),
    displayName: displayName || req.body.username,
    language: req.body.language || 'en',
  });
  const target = email || phone;
  const out = await issueOtp(user, target, 'signup', email ? 'email' : 'sms');

  res.status(201).json({
    userId: user.id,
    target,
    channel: email ? 'email' : 'sms',
    provider: out.provider,
    delivered: out.delivered,
    deliveryError: out.delivered ? undefined : out.error,
    deliveryCode: echoOtp() ? out.code : undefined,
    message: 'Verification code sent',
  });
});

r.post('/otp/request', async (req, res) => {
  const { identifier, purpose = 'login' } = req.body || {};
  const ident = String(identifier || '').trim().toLowerCase();
  const phone = normPhone(ident);
  const user = get('SELECT * FROM users WHERE lower(email) = ? OR phone = ?', ident, phone);
  if (!user) return err(res, 404, 'No account found for these details');

  const channel = isEmail(ident) ? 'email' : 'sms';
  const target = channel === 'email' ? ident : phone;
  const wait = tooSoon(target);
  if (wait === -1) return err(res, 429, 'Too many codes requested. Try again in an hour.');
  if (wait > 0) return err(res, 429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });

  const out = await issueOtp(user, target, purpose, channel);
  res.json({
    userId: user.id,
    channel,
    provider: out.provider,
    delivered: out.delivered,
    deliveryError: out.delivered ? undefined : out.error,
    deliveryCode: echoOtp() ? out.code : undefined,
  });
});

r.post('/otp/verify', (req, res) => {
  const { userId, code } = req.body || {};
  const o = get('SELECT * FROM otps WHERE user_id = ? AND code = ? AND used = 0 ORDER BY sent_at DESC', userId, String(code || ''));
  if (!o) return err(res, 400, 'Invalid verification code');
  if (o.expires_at < now()) return err(res, 400, 'Code expired — request a new one');
  run('UPDATE otps SET used = 1 WHERE id = ?', o.id);
  run("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'", userId);
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  const s = createSession(user.id, req);
  res.json({ ...s, user: publicUser(user, user.id), needsOnboarding: !user.onboarded_at });
});

r.post('/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  const ident = String(identifier || '').trim().toLowerCase();
  const user = get(
    'SELECT * FROM users WHERE lower(email) = ? OR phone = ? OR lower(username) = ?',
    ident, normPhone(ident), ident,
  );
  if (!user || !user.password_hash) return err(res, 401, 'Incorrect email/phone or password');
  if (!(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return err(res, 401, 'Incorrect email/phone or password');
  }
  if (user.status === 'suspended') return err(res, 403, 'This account is suspended. Contact support@azolve.io');
  if (user.status === 'pending') {
    const out = await issueOtp(user, user.email || user.phone, 'signup', user.email ? 'email' : 'sms');
    return res.status(403).json({
      error: 'Account not verified',
      needsVerification: true,
      userId: user.id,
      deliveryCode: echoOtp() ? out.code : undefined,
    });
  }
  if (user.twofa_enabled) {
    const out = await issueOtp(user, user.email || user.phone, '2fa', user.email ? 'email' : 'sms');
    return res.json({ twoFactor: true, userId: user.id, deliveryCode: echoOtp() ? out.code : undefined });
  }
  const s = createSession(user.id, req);
  res.json({ ...s, user: publicUser(user, user.id) });
});

/* ------------------------------ session mgmt ------------------------------- */

r.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return err(res, 400, 'refreshToken required');
  const s = rotateSession(refreshToken, req);
  if (!s) return err(res, 401, 'Refresh token invalid or revoked');
  res.json(s);
});

r.post('/logout', requireAuth, (req, res) => {
  run('UPDATE sessions SET revoked = 1 WHERE id = ?', req.sessionId);
  res.json({ ok: true });
});

r.post('/logout-all', requireAuth, (req, res) => {
  run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(u, u.id), needsOnboarding: !u.onboarded_at });
});

r.post('/forgot', async (req, res) => {
  const ident = String(req.body?.identifier || '').trim().toLowerCase();
  const phone = normPhone(ident);
  const user = get('SELECT * FROM users WHERE lower(email) = ? OR phone = ?', ident, phone);
  if (!user) return res.json({ ok: true, message: 'If an account exists, a reset code has been sent.' });

  const channel = isEmail(ident) ? 'email' : 'sms';
  const target = channel === 'email' ? ident : phone;
  const wait = tooSoon(target);
  if (wait === -1) return err(res, 429, 'Too many codes requested. Try again in an hour.');
  if (wait > 0) return err(res, 429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });

  const out = await issueOtp(user, target, 'reset', channel);
  res.json({
    ok: true,
    userId: user.id,
    channel,
    delivered: out.delivered,
    deliveryCode: echoOtp() ? out.code : undefined,
  });
});

r.post('/reset', async (req, res) => {
  const { userId, code, password } = req.body || {};
  if (String(password || '').length < 8) return err(res, 400, 'Password must be at least 8 characters');
  const o = get("SELECT * FROM otps WHERE user_id = ? AND code = ? AND purpose = 'reset' AND used = 0", userId, String(code || ''));
  if (!o || o.expires_at < now()) return err(res, 400, 'Invalid or expired reset code');
  run('UPDATE otps SET used = 1 WHERE id = ?', o.id);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(password, 10), userId);
  run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', userId);
  res.json({ ok: true });
});

r.get('/sessions', requireAuth, (req, res) => {
  const rows = all('SELECT id, device, ip, created_at, last_active FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_active DESC', req.user.id);
  res.json({ sessions: rows.map(s => ({ ...s, current: s.id === req.sessionId })) });
});

r.delete('/sessions/:id', requireAuth, (req, res) => {
  run('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

r.post('/2fa/enable', requireAuth, (req, res) => {
  const { enable } = req.body || {};
  run('UPDATE users SET twofa_enabled = ? WHERE id = ?', enable ? 1 : 0, req.user.id);
  res.json({ ok: true, twofaEnabled: !!enable });
});

/* Which sign-in providers are actually live. The client uses this to enable or
   honestly disable the Google/Apple buttons instead of offering a button that
   always fails. */
r.get('/providers', (req, res) => {
  /* This answer changes the moment an environment variable is edited, and a
     cached copy would keep telling the browser that Google is unavailable
     long after it was switched on. */
  res.set('Cache-Control', 'no-store');
  res.json({
    google: googleConfigured(),
    apple: !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID),
    email: true,
    phone: smsConfigured(),
    googleMode: googleConfigured() ? (process.env.GOOGLE_CLIENT_SECRET ? 'redirect' : 'idtoken') : null,
  });
});

/* ===========================================================================
   Google sign-in.
   ---------------------------------------------------------------------------
   Two real flows, because the app has two clients:

   1. ID-token flow  — POST /oauth/google { idToken }
      The web and the native shell both obtain a Google ID token (Google
      Identity Services on web, the Google Sign-In plugin in the app) and post
      it here. We verify it against Google's tokeninfo endpoint, which checks
      the signature, expiry and audience for us.

   2. Redirect flow  — GET /oauth/google/start -> Google -> GET /oauth/google/callback
      For browsers where a popup is blocked. The `state` parameter is a signed
      JWT so the callback cannot be forged.

   Both end in the same place: find-or-create the account by verified email and
   issue a normal AZOLVE session. No password is ever stored for these accounts,
   which is why `password_hash` is left null — password login then simply fails
   for them, as it should.
   ========================================================================= */

const googleClientIds = () => String(process.env.GOOGLE_CLIENT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const googleConfigured = () => googleClientIds().length > 0;

const baseUrl = req =>
  process.env.PUBLIC_BASE_URL
  || `${req.headers['x-forwarded-proto'] || req.protocol || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

/** Find or create the account behind a verified Google profile. */
function upsertOAuthUser({ email, name, picture, sub }) {
  const clean = String(email || '').toLowerCase().trim();
  if (!clean) return null;

  let user = get('SELECT * FROM users WHERE email = ?', clean);
  if (user) {
    /* Never let a linked provider silently take over an unverified address. */
    if (!user.email_verified) run('UPDATE users SET email_verified = 1 WHERE id = ?', user.id);
    if (!user.avatar && picture) run('UPDATE users SET avatar = ? WHERE id = ?', picture, user.id);
    return get('SELECT * FROM users WHERE id = ?', user.id);
  }

  const uid = id('u_');
  const local = clean.split('@')[0].replace(/[^a-z0-9._-]/gi, '').slice(0, 20) || 'azolve';
  let uname = local;
  for (let i = 0; i < 40 && get('SELECT 1 FROM users WHERE username = ?', uname); i++) {
    uname = `${local}${Math.floor(Math.random() * 9000) + 1000}`;
  }

  run(
    `INSERT INTO users (id, email, phone, password_hash, username, display_name, avatar, language,
       created_at, last_seen, status, role, phone_verified, email_verified, oauth_sub, prefs, privacy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid, clean, null, null, uname, name || uname, picture || null,
    (req_lang_hint() || 'en'), now(), now(), 'active',
    roleForNewUser({ email: clean, phone: null }), 0, 1, sub || null,
    JSON.stringify({ autoTranslate: true, notifications: { messages: true, social: true, calls: true } }),
    JSON.stringify({ profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' }),
  );
  return get('SELECT * FROM users WHERE id = ?', uid);
}

/* Language for a brand-new OAuth account. The client may pass a hint; the
   server never guesses from an IP address. */
let pendingLangHint = 'en';
const req_lang_hint = () => pendingLangHint;

function finishOAuth(req, res, profile) {
  const user = upsertOAuthUser(profile);
  if (!user) return err(res, 400, 'That Google account did not share an email address');
  if (user.status === 'suspended' || user.status === 'banned') {
    return err(res, 403, 'This account is suspended');
  }
  const session = createSession(user.id, req);
  res.json({ ...session, user: publicUser(user), provider: 'google' });
}

/* ---- 1. ID-token flow ---- */
r.post('/oauth/google', async (req, res) => {
  if (!googleConfigured()) {
    return err(res, 501, 'Google sign-in is not configured on this deployment', {
      setup: 'Set GOOGLE_CLIENT_ID (and GOOGLE_CLIENT_SECRET for the redirect flow) on the server.',
    });
  }
  const idToken = req.body?.idToken || req.body?.credential;
  if (!idToken) return err(res, 400, 'idToken required');
  pendingLangHint = String(req.body?.language || 'en').slice(0, 8) || 'en';

  let info;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    info = await r.json().catch(() => ({}));
    if (!r.ok) return err(res, 401, info?.error_description || 'Google rejected that token');
  } catch {
    return err(res, 502, 'Could not reach Google to verify the sign-in');
  }

  if (!googleClientIds().includes(String(info.aud || ''))) {
    return err(res, 401, 'That token was issued for a different application');
  }
  if (String(info.email_verified) !== 'true') {
    return err(res, 403, 'Google has not verified that email address');
  }
  if (Number(info.exp) * 1000 < Date.now()) return err(res, 401, 'That sign-in has expired');

  return finishOAuth(req, res, {
    email: info.email,
    name: info.name,
    picture: info.picture,
    sub: info.sub,
  });
});

/* ---- 2. Redirect flow ---- */
r.get('/oauth/google/start', (req, res) => {
  if (!googleConfigured()) return err(res, 501, 'Google sign-in is not configured on this deployment');
  /* `mobile=1` means the flow was started from the Android shell. Google
     refuses to render its consent screen inside an embedded WebView
     ("disallowed_useragent"), so the app hands this URL to the real browser.
     The browser cannot reach the app's localStorage, so the callback has to
     come back over a deep link instead of a page redirect. The flag rides in
     the signed state so a caller cannot turn an ordinary web login into a
     deep-link redirect after the fact. */
  const state = jwt.sign(
    {
      purpose: 'oauth-state',
      lang: String(req.query.lang || 'en').slice(0, 8),
      mobile: String(req.query.mobile || '') === '1',
      nonce: id('n_'),
    },
    process.env.JWT_SECRET || 'dev-only-secret-change-me',
    { expiresIn: '10m' },
  );
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', googleClientIds()[0]);
  u.searchParams.set('redirect_uri', `${baseUrl(req)}/api/auth/oauth/google/callback`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'select_account');
  res.redirect(u.toString());
});

r.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query || {};
  /* Decode before verifying only to learn where to send the result. Nothing
     is trusted from this decode: every branch below still verifies the
     signature, and a forged state fails that check and lands on the generic
     web error page. */
  const peek = (() => { try { return jwt.decode(String(state || '')) || {}; } catch { return {}; } })();
  const mobile = peek.mobile === true;
  /* Chrome will not follow a server-side 302 to a custom scheme: it stops on an
     "unknown URL scheme" page instead of launching the app, which is what sent
     people back to the login screen. So the app return trip goes over https to
     a verified Android App Link, which the OS opens directly. The fallback page
     there re-tries azolve:// for browsers that do not support App Links. */
  const appReturn = (req, hash) => `${baseUrl(req)}/oauth/app#${hash}`;
  const fail = msg => res.redirect(
    mobile
      ? appReturn(req, new URLSearchParams({ error: msg }).toString())
      : `/#/auth?error=${encodeURIComponent(msg)}`,
  );
  if (error) return fail(String(error));
  if (!code || !state) return fail('Google did not return a code');

  try {
    jwt.verify(String(state), process.env.JWT_SECRET || 'dev-only-secret-change-me');
  } catch {
    return fail('That sign-in link expired. Please try again.');
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: googleClientIds()[0],
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${baseUrl(req)}/api/auth/oauth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.id_token) return fail(tokens?.error_description || 'Google refused the exchange');

    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
    const info = await infoRes.json().catch(() => ({}));
    if (!infoRes.ok || !info.email) return fail('Google did not share an email address');

    const decoded = jwt.decode(String(state)) || {};
    pendingLangHint = decoded.lang || 'en';
    const user = upsertOAuthUser({ email: info.email, name: info.name, picture: info.picture, sub: info.sub });
    if (!user) return fail('Could not create an account for that Google profile');

    const session = createSession(user.id, req);
    /* Hand the session to the SPA through the URL fragment: fragments are not
       sent to servers, so the token does not land in an access log. */
    const frag = new URLSearchParams({
      token: session.token,
      refreshToken: session.refreshToken,
    });
    /* The Android shell picks this up as an App Link and replays it into the
       WebView as the ordinary `#/auth?token=…` fragment, so the SPA has exactly
       one code path for absorbing a session. */
    if (mobile) return res.redirect(appReturn(req, frag.toString()));
    return res.redirect(`/#/auth?${frag.toString()}`);
  } catch {
    return fail('Could not complete Google sign-in');
  }
});

/* Apple is still a stub on purpose: it needs a paid Apple Developer account, a
   Services ID and a .p8 key. The button reports that honestly rather than
   pretending to work. */
r.post('/oauth/:provider', (req, res) => {
  const p = req.params.provider;
  const configured = p === 'apple' && process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID;
  if (!configured) {
    return err(res, 501, `${p} sign-in is not configured on this deployment`, {
      setup: p === 'apple'
        ? 'Set APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_PRIVATE_KEY to enable Apple sign-in.'
        : 'Use POST /api/auth/oauth/google with an idToken.',
    });
  }
  return err(res, 501, 'Apple sign-in needs an Apple Developer account; not enabled for this deployment');
});

export default r;
