/* ---------------------------------------------------------------------------
   Integration status
   One place that answers: which providers are actually wired up right now?
   Used by the admin dashboard so an operator can see at a glance whether a
   pasted API key took effect, without reading the server log.
--------------------------------------------------------------------------- */

import { turnReady } from './turn.js';

const has = (...keys) => keys.every(k => !!process.env[k]);

const row = (id, label, group, ready, detail, envKeys) => ({
  id, label, group, ready: !!ready, detail, envKeys,
});

export function integrationStatus() {
  const rows = [];

  /* ------------------------------- AI ---------------------------------- */
  rows.push(row('openai', 'OpenAI', 'ai', has('OPENAI_API_KEY'),
    has('OPENAI_API_KEY') ? `model ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}` : 'add OPENAI_API_KEY',
    ['OPENAI_API_KEY', 'OPENAI_MODEL']));
  rows.push(row('anthropic', 'Anthropic Claude', 'ai', has('ANTHROPIC_API_KEY'),
    has('ANTHROPIC_API_KEY') ? `model ${process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest'}` : 'add ANTHROPIC_API_KEY',
    ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']));
  rows.push(row('gemini', 'Google Gemini', 'ai', has('GEMINI_API_KEY'),
    has('GEMINI_API_KEY') ? `model ${process.env.GEMINI_MODEL || 'gemini-3.6-flash'} (auto-fallback)` : 'add GEMINI_API_KEY',
    ['GEMINI_API_KEY', 'GEMINI_MODEL']));
  rows.push(row('groq', 'Groq', 'ai', has('GROQ_API_KEY'),
    has('GROQ_API_KEY') ? `model ${process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'}` : 'add GROQ_API_KEY',
    ['GROQ_API_KEY', 'GROQ_MODEL']));
  rows.push(row('ollama', 'Ollama (self-hosted)', 'ai', has('OLLAMA_URL'),
    has('OLLAMA_URL') ? process.env.OLLAMA_URL : 'add OLLAMA_URL',
    ['OLLAMA_URL', 'OLLAMA_MODEL']));

  /* --------------------------- Translation ------------------------------ */
  rows.push(row('deepl', 'DeepL', 'translation', has('DEEPL_API_KEY'),
    has('DEEPL_API_KEY') ? 'key present' : 'add DEEPL_API_KEY', ['DEEPL_API_KEY']));
  rows.push(row('google', 'Google Translate', 'translation', has('GOOGLE_TRANSLATE_API_KEY'),
    has('GOOGLE_TRANSLATE_API_KEY') ? 'key present' : 'add GOOGLE_TRANSLATE_API_KEY', ['GOOGLE_TRANSLATE_API_KEY']));
  rows.push(row('libre', 'LibreTranslate', 'translation', has('LIBRE_TRANSLATE_URL'),
    has('LIBRE_TRANSLATE_URL') ? process.env.LIBRE_TRANSLATE_URL : 'add LIBRE_TRANSLATE_URL', ['LIBRE_TRANSLATE_URL', 'LIBRE_TRANSLATE_KEY']));
  rows.push(row('mymemory', 'MyMemory', 'translation', true,
    process.env.MYMEMORY_EMAIL ? `keyless · ${process.env.MYMEMORY_EMAIL}` : 'keyless fallback (no key needed)',
    ['MYMEMORY_EMAIL']));

  /* ------------------------------- Email -------------------------------- */
  const emailProvider = (process.env.EMAIL_PROVIDER || '').toLowerCase()
    || (process.env.RESEND_API_KEY && 'resend')
    || (process.env.BREVO_API_KEY && 'brevo')
    || (process.env.SMTP_HOST && 'smtp')
    || (process.env.SENDGRID_API_KEY && 'sendgrid')
    || (process.env.MAILGUN_API_KEY && 'mailgun')
    || 'console';
  const emailReady = {
    console: true,
    resend: !!process.env.RESEND_API_KEY,
    brevo: !!process.env.BREVO_API_KEY,
    smtp: has('SMTP_HOST'),
    sendgrid: !!process.env.SENDGRID_API_KEY,
    mailgun: has('MAILGUN_API_KEY', 'MAILGUN_DOMAIN'),
  }[emailProvider];
  rows.push(row('email', `Email OTP · ${emailProvider}`, 'sms', !!emailReady,
    emailProvider === 'console'
      ? 'codes go to the server log — add RESEND_API_KEY (free) for real mail'
      : (emailReady ? 'credentials present — verification mail will send' : 'selected but credentials are missing'),
    ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']));

  /* ------------------------------- SMS ---------------------------------- */
  const smsProvider = (process.env.SMS_PROVIDER || 'console').toLowerCase();
  const smsReady = {
    console: true,
    textbelt: !!process.env.TEXTBELT_KEY,
    fast2sms: !!process.env.FAST2SMS_API_KEY,
    msg91: has('MSG91_AUTH_KEY', 'MSG91_SENDER_ID'),
    '2factor': !!process.env.TWOFACTOR_API_KEY,
    vonage: has('VONAGE_API_KEY', 'VONAGE_API_SECRET'),
    twilio: has('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'),
  }[smsProvider];
  rows.push(row('sms', `SMS · ${smsProvider}`, 'sms', !!smsReady,
    smsProvider === 'console'
      ? 'codes go to the server log — pick a gateway for real texts'
      : (smsReady ? 'credentials present' : 'selected but credentials are missing'),
    ['SMS_PROVIDER']));

  /* ------------------------------ Calling ------------------------------- */
  const turn = turnReady();
  const turnDetail = !process.env.TURN_URL
    ? 'STUN only — calls may fail on cellular'
    : turn
      ? (process.env.TURN_STATIC_AUTH_SECRET ? 'coturn REST credentials — mobile calls will connect'
        : process.env.TURN_APP ? `Metered app "${process.env.TURN_APP}" — mobile calls will connect`
          : 'static username/password — mobile calls will connect')
      : 'relay URL set but no credentials — add TURN_APP or TURN_USERNAME/TURN_CREDENTIAL';
  rows.push(row('turn', 'TURN relay', 'calling', turn, turnDetail,
    ['TURN_URL', 'TURN_APP', 'TURN_API_KEY', 'TURN_API_SECRET', 'TURN_STATIC_AUTH_SECRET', 'TURN_USERNAME', 'TURN_CREDENTIAL']));

  /* ------------------------------ Social -------------------------------- */
  rows.push(row('google-oauth', 'Google sign-in', 'auth', has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    has('GOOGLE_CLIENT_ID') ? 'client configured' : 'add GOOGLE_CLIENT_ID / SECRET',
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']));
  rows.push(row('apple-oauth', 'Apple sign-in', 'auth', has('APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'),
    has('APPLE_CLIENT_ID') ? 'client configured' : 'add APPLE_CLIENT_ID / TEAM_ID / KEY_ID / PRIVATE_KEY',
    ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']));

  const groups = ['ai', 'translation', 'sms', 'calling', 'auth'];
  return {
    rows,
    groups: groups.map(g => ({
      id: g,
      label: { ai: 'AI', translation: 'Translation', sms: 'SMS / OTP', calling: 'Calling', auth: 'Social sign-in' }[g],
      ready: rows.filter(r => r.group === g && r.ready).length,
      total: rows.filter(r => r.group === g).length,
    })),
    activeAi: (process.env.OPENAI_API_KEY && 'openai')
      || (process.env.ANTHROPIC_API_KEY && 'anthropic')
      || (process.env.GEMINI_API_KEY && 'gemini')
      || (process.env.GROQ_API_KEY && 'groq')
      || (process.env.OLLAMA_URL && 'ollama')
      || 'offline',
    activeTranslation: (process.env.TRANSLATION_PROVIDER || 'deepl,google,libre,openai,mymemory,offline')
      .split(',').map(s => s.trim()).filter(Boolean),
    smsProvider,
    emailProvider,
    hasTurn: turn,
  };
}
