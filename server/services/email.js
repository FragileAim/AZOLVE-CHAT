/* ============================================================================
   OTP DELIVERY — pluggable EMAIL providers
   ----------------------------------------------------------------------------
   India requires DLT registration before an SMS gateway will deliver
   transactional traffic to real handsets. Until that approval lands, email is
   the primary verification channel. This module is the email twin of sms.js:
   the app asks it to deliver a code, and it picks whichever provider the
   operator configured.

   Providers, cheapest first:

     console   FREE, no account. Prints the code to the server log. Correct for
               a team test on Render — everyone reads the code from the logs, or
               from OTP_DEV_ECHO when the operator explicitly turns it on.
     resend    FREE 3,000 emails/month, 100/day. No credit card. Best default.
     brevo     FREE 300 emails/day. No credit card.
     smtp      Any mailbox you already own: Gmail app password, Zoho, Fastmail,
               Amazon SES SMTP, Mailgun SMTP, your own Postfix. Works with an
               app password, no domain needed.
     sendgrid  Free 100/day. Requires sender verification.
     mailgun   Paid after trial. Requires a verified domain.

   Set EMAIL_PROVIDER to pick one. If it is unset we auto-detect: the first
   provider whose credentials are present, else `console`.

   Every provider call is wrapped: a delivery failure never throws into the
   request handler, it returns { ok:false, error } so the caller can tell the
   user "we could not send the code" instead of pretending it was sent.
   ========================================================================== */

import nodemailer from 'nodemailer';

const EXPLICIT = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

/* Which provider will actually be used. Resolved once at boot. */
function resolveProvider() {
  if (EXPLICIT) return EXPLICIT;
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SMTP_HOST) return 'smtp';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) return 'mailgun';
  return 'console';
}

const PROVIDER = resolveProvider();

const FROM_NAME = process.env.EMAIL_FROM_NAME || 'AZOLVE CHAT';
const FROM_ADDR = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'no-reply@azolve.io';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@azolve.io';

function timeout(ms = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function postJson(url, body, headers = {}) {
  const t = timeout();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { status: res.status, ok: res.ok, data };
  } finally { t.done(); }
}

/* ------------------------------- the message ------------------------------- */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SUBJECTS = {
  signup: 'Your AZOLVE CHAT verification code',
  login: 'Your AZOLVE CHAT sign-in code',
  reset: 'Reset your AZOLVE CHAT password',
  '2fa': 'Your AZOLVE CHAT security code',
  verify: 'Confirm your email for AZOLVE CHAT',
};

function subjectFor(purpose) {
  return SUBJECTS[purpose] || 'Your AZOLVE CHAT verification code';
}

/**
 * Branded HTML. Deliberately table-based with inline styles: Gmail, Outlook and
 * Apple Mail all strip <style> blocks and flexbox, so this is the only layout
 * that renders identically everywhere.
 */
function htmlFor({ code, purpose, name }) {
  const hi = name ? `Hi ${esc(String(name).split(' ')[0])},` : 'Hi there,';
  const line = purpose === 'reset'
    ? 'Use this code to set a new password.'
    : purpose === 'login'
      ? 'Use this code to finish signing in.'
      : 'Use this code to verify your account.';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subjectFor(purpose))}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;box-shadow:0 8px 32px rgba(16,16,32,.08);">
    <tr><td style="background:linear-gradient(135deg,#6555F0 0%,#4F7FF2 55%,#18E0C8 100%);padding:28px 32px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:.14em;color:#ffffff;">AZOLVE CHAT</div>
      <div style="font-size:12px;color:rgba(255,255,255,.82);margin-top:4px;letter-spacing:.06em;">PRIVATE · TRANSLATED · GLOBAL</div>
    </td></tr>
    <tr><td style="padding:36px 32px 8px;">
      <p style="margin:0 0 10px;font-size:17px;color:#12121a;">${hi}</p>
      <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#4a4a5a;">${esc(line)} It expires in 10 minutes and can only be used once.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="background:#f6f5ff;border:1px solid #e6e3ff;border-radius:14px;padding:22px 12px;">
          <div style="font-size:38px;font-weight:700;letter-spacing:.34em;color:#2b2b3d;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding-left:.34em;">${esc(code)}</div>
        </td></tr>
      </table>
      <p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#7a7a8c;">If you did not request this, you can ignore this email — nobody can sign in without the code above.</p>
    </td></tr>
    <tr><td style="padding:26px 32px 32px;">
      <hr style="border:none;border-top:1px solid #ececf2;margin:0 0 18px;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9a9aac;">AZOLVE INFOTECH · AZOLVE CHAT<br>Questions? Reply to this mail or write to ${esc(REPLY_TO)}.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function textFor({ code, purpose, name }) {
  const hi = name ? `Hi ${String(name).split(' ')[0]},` : 'Hi there,';
  return [
    `${hi}`,
    '',
    `Your AZOLVE CHAT verification code is ${code}`,
    '',
    'It expires in 10 minutes and can only be used once.',
    'If you did not request this, ignore this email.',
    '',
    'AZOLVE INFOTECH · AZOLVE CHAT',
    REPLY_TO,
  ].join('\n');
}

/* ------------------------------- providers -------------------------------- */

const providers = {
  /* Free. No account, no network. The code goes to the server log. */
  async console({ to, code, purpose, name }) {
    const line = `  to: ${to}`;
    console.log(`\n  ┌${'─'.repeat(52)}┐`);
    console.log(`  │  AZOLVE EMAIL OTP${' '.repeat(33)}│`);
    console.log(`  │${line.padEnd(52)}│`);
    console.log(`  │  code: ${code}${' '.repeat(44)}│`);
    console.log(`  │  purpose: ${String(purpose).padEnd(41)}│`);
    console.log(`  └${'─'.repeat(52)}┘\n`);
    // Still render the body once so template bugs surface in dev.
    void htmlFor({ code, purpose, name });
    return { ok: true, provider: 'console', id: `log_${Date.now()}`, toLog: true };
  },

  /* Resend — free 3,000/month, 100/day, no card. https://resend.com */
  async resend({ to, code, purpose, name }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, provider: 'resend', error: 'RESEND_API_KEY is not set' };
    const r = await postJson('https://api.resend.com/emails', {
      from: `${FROM_NAME} <${process.env.RESEND_FROM || FROM_ADDR}>`,
      to: [to],
      reply_to: REPLY_TO,
      subject: subjectFor(purpose),
      html: htmlFor({ code, purpose, name }),
      text: textFor({ code, purpose, name }),
    }, { authorization: `Bearer ${key}` });
    if (!r.ok) return { ok: false, provider: 'resend', error: r.data?.message || r.data?.error || `HTTP ${r.status}` };
    return { ok: true, provider: 'resend', id: r.data?.id };
  },

  /* Brevo (ex-Sendinblue) — free 300/day. https://brevo.com */
  async brevo({ to, code, purpose, name }) {
    const key = process.env.BREVO_API_KEY;
    if (!key) return { ok: false, provider: 'brevo', error: 'BREVO_API_KEY is not set' };
    const r = await postJson('https://api.brevo.com/v3/smtp/email', {
      sender: { name: FROM_NAME, email: process.env.BREVO_FROM || FROM_ADDR },
      to: [{ email: to }],
      replyTo: { email: REPLY_TO },
      subject: subjectFor(purpose),
      htmlContent: htmlFor({ code, purpose, name }),
      textContent: textFor({ code, purpose, name }),
    }, { 'api-key': key });
    if (!r.ok) return { ok: false, provider: 'brevo', error: r.data?.message || `HTTP ${r.status}` };
    return { ok: true, provider: 'brevo', id: r.data?.messageId };
  },

  /* Any SMTP mailbox. Gmail needs an App Password, not your login password. */
  async smtp({ to, code, purpose, name }) {
    const host = process.env.SMTP_HOST;
    if (!host) return { ok: false, provider: 'smtp', error: 'SMTP_HOST is not set' };
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === '1' || port === 465;
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        : undefined,
      tls: { rejectUnauthorized: process.env.SMTP_STRICT_TLS !== '0' },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
    try {
      const info = await transport.sendMail({
        from: `"${FROM_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER || FROM_ADDR}>`,
        to,
        replyTo: REPLY_TO,
        subject: subjectFor(purpose),
        html: htmlFor({ code, purpose, name }),
        text: textFor({ code, purpose, name }),
        headers: { 'X-Entity-Ref-ID': `azolve-${Date.now()}` },
      });
      return { ok: true, provider: 'smtp', id: info.messageId };
    } finally {
      transport.close();
    }
  },

  /* SendGrid — free 100/day. https://sendgrid.com */
  async sendgrid({ to, code, purpose, name }) {
    const key = process.env.SENDGRID_API_KEY;
    if (!key) return { ok: false, provider: 'sendgrid', error: 'SENDGRID_API_KEY is not set' };
    const r = await postJson('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.SENDGRID_FROM || FROM_ADDR, name: FROM_NAME },
      reply_to: { email: REPLY_TO },
      subject: subjectFor(purpose),
      content: [
        { type: 'text/plain', value: textFor({ code, purpose, name }) },
        { type: 'text/html', value: htmlFor({ code, purpose, name }) },
      ],
    }, { authorization: `Bearer ${key}` });
    if (!r.ok) {
      const msg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
      return { ok: false, provider: 'sendgrid', error: msg };
    }
    return { ok: true, provider: 'sendgrid', id: r.data?.id };
  },

  /* Mailgun — needs a verified domain. */
  async mailgun({ to, code, purpose, name }) {
    const key = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    if (!key || !domain) return { ok: false, provider: 'mailgun', error: 'MAILGUN_API_KEY / MAILGUN_DOMAIN are not set' };
    const base = process.env.MAILGUN_BASE || 'https://api.mailgun.net';
    const body = new URLSearchParams({
      from: `${FROM_NAME} <${process.env.MAILGUN_FROM || `no-reply@${domain}`}>`,
      to,
      'h:Reply-To': REPLY_TO,
      subject: subjectFor(purpose),
      html: htmlFor({ code, purpose, name }),
      text: textFor({ code, purpose, name }),
    });
    const t = timeout();
    try {
      const res = await fetch(`${base}/v3/${domain}/messages`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}` },
        body,
        signal: t.signal,
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
      if (!res.ok) return { ok: false, provider: 'mailgun', error: data?.message || `HTTP ${res.status}` };
      return { ok: true, provider: 'mailgun', id: data?.id };
    } finally { t.done(); }
  },
};

/* --------------------------------- public --------------------------------- */

export function emailProviderName() { return PROVIDER; }

export function emailConfigured() {
  if (PROVIDER === 'console') return true;
  const need = {
    resend: () => !!process.env.RESEND_API_KEY,
    brevo: () => !!process.env.BREVO_API_KEY,
    smtp: () => !!(process.env.SMTP_HOST && (process.env.SMTP_USER ? process.env.SMTP_PASS : true)),
    sendgrid: () => !!process.env.SENDGRID_API_KEY,
    mailgun: () => !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
  };
  return !!(need[PROVIDER] && need[PROVIDER]());
}

/** True when a real mail server will actually receive the message. */
export function emailWillDeliver() {
  return PROVIDER !== 'console' && emailConfigured();
}

/* The last real send attempt, whatever the outcome.
   `emailWillDeliver()` answers "is a provider configured", which is not the same
   question as "did the last email actually go out". A misconfigured provider
   (wrong port, blocked IP, unverified sender) is still *configured*, so a status
   endpoint built only on that flag will happily report success while every send
   fails. This records the truth so the client can show it. */
let lastSend = null;

export function lastEmailDelivery() {
  return lastSend;
}

/**
 * Deliver an OTP by email. Never throws.
 * @returns {Promise<{ok:boolean, provider:string, id?:string, toLog?:boolean, error?:string}>}
 */
export async function deliverEmailOtp({ email, code, purpose = 'signup', name }) {
  if (!isEmail(email)) return { ok: false, provider: PROVIDER, error: 'Not a valid email address' };
  const fn = providers[PROVIDER];
  if (!fn) {
    return {
      ok: false,
      provider: PROVIDER,
      error: `Unknown EMAIL_PROVIDER "${PROVIDER}". Use console, resend, brevo, smtp, sendgrid or mailgun.`,
    };
  }
  if (!emailConfigured()) {
    return { ok: false, provider: PROVIDER, error: `EMAIL_PROVIDER=${PROVIDER} is selected but its credentials are missing.` };
  }
  let out;
  try {
    out = await fn({ to: email, code, purpose, name });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Provider timed out'
      : (e?.response || e?.message || String(e));
    out = { ok: false, provider: PROVIDER, error: String(msg).slice(0, 300) };
  }
  lastSend = {
    ok: !!out.ok,
    at: Date.now(),
    provider: out.provider || PROVIDER,
    error: out.ok ? undefined : out.error,
  };
  return out;
}

/**
 * Send a non-OTP transactional email (welcome, security notice, …).
 * Same provider plumbing, different subject/body. Never throws.
 */
export async function sendMail({ to, subject, html, text }) {
  if (!isEmail(to)) return { ok: false, provider: PROVIDER, error: 'Not a valid email address' };
  if (!emailWillDeliver()) return { ok: false, provider: PROVIDER, error: 'No email provider configured' };
  try {
    if (PROVIDER === 'resend') {
      const r = await postJson('https://api.resend.com/emails', {
        from: `${FROM_NAME} <${process.env.RESEND_FROM || FROM_ADDR}>`, to: [to], subject, html, text,
      }, { authorization: `Bearer ${process.env.RESEND_API_KEY}` });
      return r.ok ? { ok: true, provider: 'resend', id: r.data?.id } : { ok: false, provider: 'resend', error: `HTTP ${r.status}` };
    }
    if (PROVIDER === 'smtp') {
      const port = Number(process.env.SMTP_PORT || 587);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port,
        secure: process.env.SMTP_SECURE === '1' || port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      });
      try {
        const info = await transport.sendMail({
          from: `"${FROM_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER || FROM_ADDR}>`,
          to, replyTo: REPLY_TO, subject, html, text,
        });
        return { ok: true, provider: 'smtp', id: info.messageId };
      } finally { transport.close(); }
    }
    return { ok: false, provider: PROVIDER, error: `sendMail() has no generic path for ${PROVIDER}` };
  } catch (e) {
    return { ok: false, provider: PROVIDER, error: String(e?.message || e).slice(0, 300) };
  }
}
