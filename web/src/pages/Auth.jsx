import React, { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { API, api } from '../lib/api.js';
import { Icon, Logo } from '../components/UI.jsx';
import OtpInput from '../components/OtpInput.jsx';

const WORDS = [
  ['नमस्ते', 'hi'], ['Hello', 'en'], ['مرحبا', 'ar'], ['Hola', 'es'],
  ['Bonjour', 'fr'], ['Hallo', 'de'], ['こんにちは', 'ja'], ['你好', 'zh'],
  ['Olá', 'pt'], ['Привет', 'ru'], ['નમસ્તે', 'gu'], ['안녕하세요', 'ko'],
];

/* Dial codes for the countries most likely to be used first. The number is
   always sent to the API as `<code><digits>`, so adding more here is safe. */
const CODES = [
  ['+91', 'India'], ['+1', 'US / Canada'], ['+44', 'United Kingdom'], ['+971', 'UAE'],
  ['+65', 'Singapore'], ['+61', 'Australia'], ['+49', 'Germany'], ['+33', 'France'],
  ['+34', 'Spain'], ['+39', 'Italy'], ['+81', 'Japan'], ['+82', 'South Korea'],
  ['+86', 'China'], ['+852', 'Hong Kong'], ['+60', 'Malaysia'], ['+62', 'Indonesia'],
  ['+63', 'Philippines'], ['+66', 'Thailand'], ['+84', 'Vietnam'], ['+880', 'Bangladesh'],
  ['+92', 'Pakistan'], ['+94', 'Sri Lanka'], ['+977', 'Nepal'], ['+966', 'Saudi Arabia'],
  ['+974', 'Qatar'], ['+968', 'Oman'], ['+965', 'Kuwait'], ['+20', 'Egypt'],
  ['+27', 'South Africa'], ['+234', 'Nigeria'], ['+254', 'Kenya'], ['+55', 'Brazil'],
  ['+52', 'Mexico'], ['+54', 'Argentina'], ['+56', 'Chile'], ['+57', 'Colombia'],
  ['+7', 'Russia'], ['+90', 'Türkiye'], ['+380', 'Ukraine'], ['+48', 'Poland'],
  ['+31', 'Netherlands'], ['+32', 'Belgium'], ['+41', 'Switzerland'], ['+46', 'Sweden'],
  ['+47', 'Norway'], ['+45', 'Denmark'], ['+358', 'Finland'], ['+353', 'Ireland'],
  ['+351', 'Portugal'], ['+30', 'Greece'], ['+972', 'Israel'], ['+64', 'New Zealand'],
];

export default function Auth() {
  const { login, notify } = useApp();
  const [step, setStep] = useState('welcome');
  /* 'signin' or 'create'. Drives the copy and is sent to the server so an
     existing address is never silently turned into a second account. */
  const [mode, setMode] = useState('signin');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ identifier: '', password: '', displayName: '', code: '', newPassword: '' });
  const [cc, setCc] = useState('+91');
  const [digits, setDigits] = useState('');
  const [emailAddr, setEmailAddr] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [otpInfo, setOtpInfo] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  /* Ask the server whether a real SMS will actually arrive, so the UI never
     promises a text message that no provider is going to send. */
  useEffect(() => {
    API.otpStatus().then(setOtpInfo).catch(() => {});
  }, []);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); }
    catch (e) { setError(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  const phone = `${cc}${digits.replace(/\D/g, '')}`;

  /* ------------------------------ phone flow ------------------------------ */

  const startPhone = () => run(async () => {
    const d = await API.phoneStart({
      phone,
      mode,
      displayName: form.displayName || undefined,
    });
    setPending({
      userId: d.userId,
      phone: d.phone,
      isNew: d.isNew,
      channel: 'sms',
      provider: d.provider,
      delivered: d.delivered,
      deliveryError: d.deliveryError,
      deliveryCode: d.deliveryCode,
    });
    setStep('phoneotp');
  });

  const verifyPhone = (code) => run(async () => {
    const d = await API.phoneVerify(pending.userId, code || form.code);
    await login(d);
    notify(d.isNew ? 'Welcome to AZOLVE CHAT' : 'Welcome back');
  });

  const resendPhone = () => run(async () => {
    const d = await API.phoneResend(pending.userId);
    setPending(p => ({
      ...p,
      delivered: d.delivered,
      deliveryError: d.deliveryError,
      deliveryCode: d.deliveryCode,
      provider: d.provider,
    }));
    notify(d.delivered ? 'A new code is on its way' : 'New code generated — see the server log');
  });

  /* ------------------------------ email flow ------------------------------ */

  const startEmail = () => run(async () => {
    let d;
    try {
      d = await API.emailStart({
        email: emailAddr.trim(),
        mode,
        displayName: form.displayName || undefined,
      });
    } catch (e) {
      /* Point them at the right door instead of leaving them stuck. */
      if (e.code === 'ACCOUNT_EXISTS') {
        setMode('signin');
        notify('You already have an account — press “Email me a code” to sign in.', 'err');
        return;
      }
      if (e.code === 'NO_ACCOUNT') {
        setMode('create');
        notify('No account with that email yet — switch to Create account.', 'err');
        return;
      }
      throw e;
    }
    setPending({
      userId: d.userId,
      email: d.email,
      isNew: d.isNew,
      channel: 'email',
      provider: d.provider,
      delivered: d.delivered,
      deliveryError: d.deliveryError,
      deliveryCode: d.deliveryCode,
    });
    setStep('phoneotp');
  });

  const verifyEmail = (code) => run(async () => {
    const d = await API.emailVerify(pending.userId, code || form.code);
    await login(d);
    notify(d.isNew ? 'Welcome to AZOLVE CHAT' : 'Welcome back');
  });

  const resendEmail = () => run(async () => {
    const d = await API.emailResend(pending.userId);
    setPending(p => ({
      ...p,
      delivered: d.delivered,
      deliveryError: d.deliveryError,
      deliveryCode: d.deliveryCode,
      provider: d.provider,
    }));
    notify(d.delivered ? 'A new code is in your inbox' : 'New code generated - see the server log');
  });

  /* --------------------------- email / password --------------------------- */

  const doLogin = () => run(async () => {
    const d = await API.login(form.identifier, form.password);
    if (d.twoFactor) {
      setPending({ userId: d.userId, deliveryCode: d.deliveryCode, target: form.identifier, channel: 'email', purpose: '2fa' });
      setStep('otp');
      return;
    }
    await login(d);
    notify(`Welcome back, ${d.user.displayName.split(' ')[0]}`);
  });

  const doSignup = () => run(async () => {
    const d = await API.signup({ identifier: form.identifier, password: form.password, displayName: form.displayName });
    setPending({
      userId: d.userId, target: d.target, channel: d.channel, purpose: 'signup',
      delivered: d.delivered, deliveryCode: d.deliveryCode, provider: d.provider,
    });
    setStep('otp');
  });

  const doVerify = (code) => run(async () => {
    const d = await API.verifyOtp(pending.userId, code || form.code);
    await login(d);
    notify('Verified — welcome to AZOLVE CHAT');
  });

  const doForgot = () => run(async () => {
    const d = await API.forgot(form.identifier);
    setPending({
      userId: d.userId, target: form.identifier, channel: d.channel || 'email',
      purpose: 'reset', delivered: d.delivered, deliveryCode: d.deliveryCode,
    });
    setStep('reset');
  });

  const doReset = () => run(async () => {
    await API.reset({ userId: pending.userId, code: form.code, password: form.newPassword });
    notify('Password updated. Sign in with your new password.');
    setStep('login');
  });

  const oauth = (provider) => run(async () => {
    try {
      await api(`/auth/oauth/${provider}`, { method: 'POST', body: {} });
    } catch (e) {
      notify(e.message || `${provider} sign-in is not configured yet`, 'err');
    }
  });

  /* Small honest banner shown under the phone field. */
  const deliveryBanner = otpInfo && !otpInfo.smsDelivery ? (
    <div className="otp-hint">
      <Icon name="info" size={14} />
      <span>
        SMS delivery is not configured on this server (provider: <b>{otpInfo.provider}</b>).
        Your code will appear in the server log.
      </span>
    </div>
  ) : null;

  return (
    <div className="auth-wrap">
      <section className="auth-art">
        <div className="auth-art-top">
          <Logo size={46} withWord tagline />
        </div>

        <div className="auth-art-copy">
          <div className="auth-preview">
            <div className="ap-row in">Shall we meet this evening?</div>
            <div className="ap-row out">Absolutely, 7 pm works!</div>
            <div className="ap-tr"><Icon name="translate" size={12} /> ¿Nos vemos esta noche?</div>
          </div>
          <div className="auth-chips">
            <span className="on">English</span>
            <span>Español</span>
            <span>+ 25 more</span>
          </div>
          <h1>Say it your way.<br /><em>They read it theirs.</em></h1>
          <p>
            Every message arrives in the language you speak — instantly, beautifully, privately.
          </p>
        </div>

        <div className="auth-art-foot">© {new Date().getFullYear()} AZOLVE INFOTECH · Designed for a borderless world</div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {step === 'welcome' && (
            <>
              <div className="auth-mobile-logo"><Logo size={40} withWord /></div>

              <div className="auth-mode-switch" role="tablist" aria-label="Sign in or create an account">
                <button
                  role="tab" aria-selected={mode === 'signin'}
                  className={mode === 'signin' ? 'on' : ''}
                  onClick={() => { setError(''); setMode('signin'); }}
                >Sign in</button>
                <button
                  role="tab" aria-selected={mode === 'create'}
                  className={mode === 'create' ? 'on' : ''}
                  onClick={() => { setError(''); setMode('create'); }}
                >Create account</button>
              </div>

              <h2>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="sub">
                {mode === 'signin'
                  ? 'Enter the email you registered with. We will send a 6-digit code — no password to remember, and everything comes back exactly as you left it.'
                  : 'One minute to set up. Your chats, contacts and calls stay with your account for good.'}
              </p>

              {mode === 'create' && (
                <label className="field"><span>Your name</span>
                  <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Ada Lovelace" autoComplete="name" />
                </label>
              )}

              <label className="field"><span>Email address</span>
                <input
                  className="input"
                  type="email"
                  value={emailAddr}
                  onChange={e => setEmailAddr(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr.trim()) && startEmail()}
                />
              </label>

              {otpInfo && !otpInfo.emailDelivery && (
                <div className="otp-hint">
                  <Icon name="info" size={14} />
                  <span>
                    Mail delivery is not configured on this server (provider: <b>{otpInfo.emailProvider}</b>).
                    Your code will appear in the server log.
                  </span>
                </div>
              )}
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}

              <button
                className="btn primary block lg"
                disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr.trim())}
                onClick={startEmail}
              >
                {busy
                  ? 'Sending code…'
                  : mode === 'signin' ? 'Email me a code' : 'Create account & email my code'}
              </button>

              <button className="btn block lg" style={{ marginTop: 10 }} onClick={() => { setError(''); setStep('phone'); }}>
                <Icon name="smartphone" size={17} /> {mode === 'signin' ? 'Sign in with a phone number' : 'Use a phone number instead'}
              </button>

              {mode === 'signin' && (
                <p className="auth-switch">
                  Prefer your password?{' '}
                  <button className="link-btn" onClick={() => { setError(''); setStep('login'); }}>Sign in with password</button>
                </p>
              )}

              <div className="divider"><span>or continue with</span></div>
              <div className="oauth-row">
                <button className="btn" onClick={() => oauth('google')}><Icon name="mail" size={16} /> Google</button>
                <button className="btn" onClick={() => oauth('apple')}><Icon name="smartphone" size={16} /> Apple</button>
              </div>

              <p className="auth-fine">
                We verify every account with a one-time code, so there is no password to lose.
                Email is the default channel; phone verification becomes available once our SMS gateway clears DLT approval.
              </p>
            </>
          )}

          {step === 'email' && (
            <>
              <button className="back-link" onClick={() => setStep('welcome')}><Icon name="back" size={15} /> Back</button>
              <h2>Your email address</h2>
              <p className="sub">We'll email you a 6-digit code to confirm it's you.</p>

              <label className="field"><span>Your name <em>(optional)</em></span>
                <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Ada Lovelace" autoComplete="name" />
              </label>

              <label className="field"><span>Email address</span>
                <input
                  className="input"
                  type="email"
                  value={emailAddr}
                  onChange={e => setEmailAddr(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr.trim()) && startEmail()}
                />
              </label>

              {otpInfo && !otpInfo.emailDelivery && (
                <div className="otp-hint">
                  <Icon name="info" size={14} />
                  <span>
                    Mail delivery is not configured on this server (provider: <b>{otpInfo.emailProvider}</b>).
                    Your code will appear in the server log.
                  </span>
                </div>
              )}
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}

              <button
                className="btn primary block lg"
                disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr.trim())}
                onClick={startEmail}
              >
                {busy ? 'Sending code…' : 'Email my code'}
              </button>
              <p className="auth-switch">Prefer your phone? <button className="link-btn" onClick={() => setStep('phone')}>Use phone number</button></p>
            </>
          )}

          {step === 'phone' && (
            <>
              <button className="back-link" onClick={() => setStep('welcome')}><Icon name="back" size={15} /> Back</button>
              <h2>{mode === 'signin' ? 'Sign in with your phone' : 'Your phone number'}</h2>
              <p className="sub">
                {mode === 'signin'
                  ? 'We will text a 6-digit code to the number on your account.'
                  : "We'll text you a 6-digit code to confirm it's you."}
              </p>

              {mode === 'create' && (
                <label className="field"><span>Your name</span>
                  <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Ada Lovelace" autoComplete="name" />
                </label>
              )}

              <label className="field"><span>Phone number</span>
                <div className="phone-row">
                  <select className="input cc-select" value={cc} onChange={e => setCc(e.target.value)} aria-label="Country code">
                    {CODES.map(([code, name]) => (
                      <option key={code} value={code}>{code} · {name}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={digits}
                    onChange={e => setDigits(e.target.value.replace(/[^\d\s-]/g, ''))}
                    placeholder="98765 43210"
                    inputMode="tel"
                    autoComplete="tel"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && digits.replace(/\D/g, '').length >= 6 && startPhone()}
                  />
                </div>
              </label>

              {deliveryBanner}
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}

              <button className="btn primary block lg" disabled={busy || digits.replace(/\D/g, '').length < 6} onClick={startPhone}>
                {busy ? 'Sending code…' : mode === 'signin' ? 'Text me a code' : 'Create account & text my code'}
              </button>
              <p className="auth-switch">Prefer email? <button className="link-btn" onClick={() => { setError(''); setStep('welcome'); }}>Use my email address</button></p>
            </>
          )}

          {step === 'phoneotp' && pending && (
            <>
              <button className="back-link" onClick={() => setStep(pending.channel === 'email' ? 'welcome' : 'phone')}><Icon name="back" size={15} /> Back</button>
              <h2>Enter your code</h2>
              <p className="sub">
                We sent a 6-digit code to <b>{pending.channel === 'email' ? pending.email : pending.phone}</b>.
              </p>

              <OtpInput
                value={form.code}
                onChange={(code) => setForm(f => ({ ...f, code }))}
                onComplete={(code) => (pending.channel === 'email' ? verifyEmail(code) : verifyPhone(code))}
                disabled={busy}
                ariaLabel="Six digit verification code"
              />

              {pending.delivered && (
                <div className="otp-hint ok">
                  <Icon name="check" size={14} />
                  <span>
                    Code sent by {pending.channel === 'email' ? 'email' : 'SMS'} via <b>{pending.provider}</b>.
                    {pending.channel === 'email' ? ' Check your inbox and spam folder.' : ''}
                  </span>
                </div>
              )}

              {!pending.delivered && pending.deliveryCode && (
                <div className="demo-code">
                  <div className="dc-label"><Icon name="info" size={14} /> Test mode — the server is echoing the code</div>
                  <div className="dc-code">{pending.deliveryCode}</div>
                  <button className="link-btn" onClick={() => setForm(f => ({ ...f, code: pending.deliveryCode }))}>Use this code</button>
                </div>
              )}

              {!pending.delivered && !pending.deliveryCode && (
                <div className="otp-hint">
                  <Icon name="info" size={14} />
                  <span>
                    No {pending.channel === 'email' ? 'email' : 'SMS'} provider is configured, so nothing was sent.
                    Your code is in the server log — ask whoever runs this deployment to read it out.
                    {pending.deliveryError ? <><br /><em>{pending.deliveryError}</em></> : null}
                  </span>
                </div>
              )}

              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}

              <button
                className="btn primary block lg"
                disabled={busy || form.code.length < 6}
                onClick={pending.channel === 'email' ? verifyEmail : verifyPhone}
              >
                {busy ? 'Verifying…' : 'Verify & continue'}
              </button>
              <p className="auth-switch">
                Didn't get it?{' '}
                <button
                  className="link-btn"
                  disabled={busy}
                  onClick={pending.channel === 'email' ? resendEmail : resendPhone}
                >
                  Send a new code
                </button>
              </p>
            </>
          )}

          {step === 'login' && (
            <>
              <button className="back-link" onClick={() => setStep('welcome')}><Icon name="back" size={15} /> Back</button>
              <h2>Sign in</h2>
              <p className="sub">Use your email, phone number or username.</p>
              <label className="field"><span>Email, phone or username</span>
                <input className="input" value={form.identifier} onChange={set('identifier')} autoComplete="username" placeholder="you@example.com" />
              </label>
              <label className="field"><span>Password</span>
                <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="current-password" placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && doLogin()} />
              </label>
              <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 14 }}>
                <button className="link-btn" onClick={() => setStep('forgot')}>Forgot password?</button>
              </div>
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}
              <button className="btn primary block lg" disabled={busy} onClick={doLogin}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <p className="auth-switch">No password? <button className="link-btn" onClick={() => { setError(''); setStep('phone'); }}>Sign in with a phone code</button></p>
            </>
          )}

          {step === 'signup' && (
            <>
              <button className="back-link" onClick={() => setStep('welcome')}><Icon name="back" size={15} /> Back</button>
              <h2>Create your account</h2>
              <p className="sub">Email and password is optional — phone sign-up is the default.</p>
              <label className="field"><span>Display name</span>
                <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Ada Lovelace" />
              </label>
              <label className="field"><span>Email or phone</span>
                <input className="input" value={form.identifier} onChange={set('identifier')} placeholder="you@example.com or +91 98765 43210" />
              </label>
              <label className="field"><span>Password</span>
                <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" />
              </label>
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}
              <button className="btn primary block lg" disabled={busy} onClick={doSignup}>
                {busy ? 'Creating account…' : 'Continue'}
              </button>
              <p className="auth-switch">Already have an account? <button className="link-btn" onClick={() => setStep('login')}>Sign in</button></p>
            </>
          )}

          {step === 'otp' && pending && (
            <>
              <button className="back-link" onClick={() => setStep('login')}><Icon name="back" size={15} /> Back</button>
              <h2>Verify your {pending.channel === 'sms' ? 'phone' : 'email'}</h2>
              <p className="sub">Enter the 6-digit code we sent to <b>{pending.target}</b>.</p>
              <OtpInput
                value={form.code}
                onChange={(code) => setForm(f => ({ ...f, code }))}
                onComplete={(code) => doVerify(code)}
                disabled={busy}
                ariaLabel="Six digit verification code"
              />
              {pending.deliveryCode ? (
                <div className="demo-code">
                  <div className="dc-label"><Icon name="info" size={14} /> Test mode — the server is echoing the code</div>
                  <div className="dc-code">{pending.deliveryCode}</div>
                  <button className="link-btn" onClick={() => setForm(f => ({ ...f, code: pending.deliveryCode }))}>Use this code</button>
                </div>
              ) : (
                <div className="otp-hint">
                  <Icon name="info" size={14} />
                  <span>Check your {pending.channel === 'sms' ? 'messages' : 'inbox'}. If nothing arrives, the code is in the server log.</span>
                </div>
              )}
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}
              <button className="btn primary block lg" disabled={busy || form.code.length < 6} onClick={doVerify}>
                {busy ? 'Verifying…' : 'Verify & continue'}
              </button>
              <p className="auth-switch">Didn't get it? <button className="link-btn" onClick={() => run(async () => {
                const d = await API.requestOtp(pending.target, pending.purpose || 'signup');
                setPending(p => ({ ...p, deliveryCode: d.deliveryCode, userId: d.userId }));
                notify('A new code has been generated');
              })}>Resend code</button></p>
            </>
          )}

          {step === 'forgot' && (
            <>
              <button className="back-link" onClick={() => setStep('login')}><Icon name="back" size={15} /> Back</button>
              <h2>Reset your password</h2>
              <p className="sub">We'll send a reset code to your registered email or phone.</p>
              <label className="field"><span>Email or phone</span>
                <input className="input" value={form.identifier} onChange={set('identifier')} placeholder="you@example.com" />
              </label>
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}
              <button className="btn primary block lg" disabled={busy} onClick={doForgot}>{busy ? 'Sending…' : 'Send reset code'}</button>
            </>
          )}

          {step === 'reset' && pending && (
            <>
              <h2>Choose a new password</h2>
              <p className="sub">Enter the code sent to <b>{pending.target}</b> and your new password.</p>
              <OtpInput
                value={form.code}
                onChange={(code) => setForm(f => ({ ...f, code }))}
                disabled={busy}
                ariaLabel="Six digit reset code"
              />
              {pending.deliveryCode && (
                <div className="demo-code">
                  <div className="dc-label"><Icon name="info" size={14} /> Test mode — the server is echoing the code</div>
                  <div className="dc-code">{pending.deliveryCode}</div>
                </div>
              )}
              <label className="field" style={{ marginTop: 14 }}><span>New password</span>
                <input className="input" type="password" value={form.newPassword} onChange={set('newPassword')} placeholder="At least 8 characters" />
              </label>
              {error && <div className="form-error"><Icon name="warning" size={15} />{error}</div>}
              <button className="btn primary block lg" disabled={busy} onClick={doReset}>{busy ? 'Updating…' : 'Update password'}</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
