import React, { useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { API, uploadFile } from '../lib/api.js';
import { Icon, Logo, Avatar, Switch } from '../components/UI.jsx';
import { LANGS } from '../lib/i18n.js';

const COUNTRIES = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['BR', 'Brazil'], ['JP', 'Japan'],
  ['KR', 'South Korea'], ['CN', 'China'], ['SA', 'Saudi Arabia'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['SG', 'Singapore'], ['ZA', 'South Africa'], ['MX', 'Mexico'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['RU', 'Russia'], ['TR', 'Türkiye'], ['EG', 'Egypt'], ['NG', 'Nigeria'], ['ID', 'Indonesia'],
];

const STEPS = ['Identity', 'Profile', 'Language', 'Privacy'];

export default function Onboarding() {
  const { user, setUser, setNeedsOnboarding, notify, theme, setTheme } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    displayName: user.displayName || '',
    username: user.username || '',
    bio: user.bio || '',
    dob: user.dob || '',
    country: user.country || 'IN',
    avatar: user.avatar || '',
    language: user.language || 'en',
    isPrivate: !!user.isPrivate,
    privacy: { profile: user.privacy?.profile || 'public', lastSeen: user.privacy?.lastSeen || 'contacts', readReceipts: user.privacy?.readReceipts !== false, storyAudience: user.privacy?.storyAudience || 'followers' },
    prefs: { autoTranslate: user.prefs?.autoTranslate !== false },
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setBusy(true);
      const d = await uploadFile(file);
      set('avatar', d.url);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const save = async (final = false) => {
    setBusy(true); setError('');
    try {
      const d = await API.updateMe({
        displayName: form.displayName, username: form.username, bio: form.bio, dob: form.dob,
        country: form.country, avatar: form.avatar, language: form.language, isPrivate: form.isPrivate,
        privacy: form.privacy, prefs: form.prefs,
      });
      setUser(d.user);
      if (final) { setNeedsOnboarding(false); notify('Your profile is ready. Welcome to AZOLVE CHAT.'); }
      else setStep(s => s + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const next = () => {
    if (step === 0) {
      if (!form.displayName.trim()) return setError('Add a display name');
      if (form.username.trim().length < 3) return setError('Username needs at least 3 characters');
    }
    if (step === 2 && !form.language) return setError('Choose your display language');
    save(step === STEPS.length - 1);
  };

  return (
    <div className="onb">
      <header className="onb-head">
        <Logo size={36} withWord />
        <div className="onb-progress">
          {STEPS.map((s, i) => (
            <div key={s} className={`onb-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
              <span className="dot">{i < step ? <Icon name="check" size={11} stroke={3} /> : i + 1}</span>
              <span className="lbl">{s}</span>
            </div>
          ))}
        </div>
        <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
      </header>

      <div className="onb-body">
        {step === 0 && (
          <div className="onb-card">
            <div className="onb-title">Make it yours</div>
            <p className="sub">This is how people will find and recognise you across AZOLVE.</p>
            <div className="onb-avatar-row">
              <Avatar user={{ displayName: form.displayName, avatar: form.avatar }} size={84} />
              <div>
                <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Icon name="camera" size={15} /> {form.avatar ? 'Change photo' : 'Upload photo'}
                </button>
                <div className="hint">JPG or PNG, up to 25 MB</div>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
              </div>
            </div>
            <label className="field"><span>Display name</span>
              <input className="input" value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="Your name" />
            </label>
            <label className="field"><span>Username</span>
              <div className="input-prefix"><span>@</span>
                <input className="input" value={form.username} onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="yourhandle" />
              </div>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="onb-card">
            <div className="onb-title">Tell your story</div>
            <p className="sub">A short bio helps people understand who you are. You can change this anytime.</p>
            <label className="field"><span>Bio</span>
              <textarea className="textarea" rows={3} maxLength={160} value={form.bio} onChange={e => set('bio', e.target.value)} placeholder="Designer, builder, traveller — say what matters to you." />
              <span className="counter">{form.bio.length}/160</span>
            </label>
            <div className="two-col">
              <label className="field"><span>Date of birth</span>
                <input className="input" type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
              </label>
              <label className="field"><span>Country</span>
                <select className="input" value={form.country} onChange={e => set('country', e.target.value)}>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="mood-row">
              <span className="hint">Mood status</span>
              {['🎧 Focused', '☕ Energised', '🌙 Night owl', '🚀 Shipping', '🌿 Calm'].map(m => (
                <button key={m} className={`chip ${form.mood === m ? 'on' : ''}`} onClick={() => set('mood', m)}>{m}</button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onb-card wide">
            <div className="onb-title">Your language, everywhere</div>
            <p className="sub">
              Choose the language you want to read in. Every message, post, comment and moment is
              automatically translated for you — the original is always kept intact.
            </p>
            <div className="lang-grid">
              {LANGS.map(l => (
                <button key={l.code} className={`lang-opt ${form.language === l.code ? 'on' : ''}`} onClick={() => set('language', l.code)}>
                  <span className="lo-native" dir={l.rtl ? 'rtl' : 'ltr'}>{l.native}</span>
                  <span className="lo-label">{l.label}</span>
                  {form.language === l.code && <span className="lo-check"><Icon name="check" size={12} stroke={3} /></span>}
                </button>
              ))}
            </div>
            <div className="onb-note">
              <Icon name="translate" size={17} />
              <div><b>Per-person translation.</b> Your language is stored per account, not per device. Switch it anytime in Settings.</div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onb-card">
            <div className="onb-title">Privacy, your way</div>
            <p className="sub">Sensible defaults. Change anything later in Settings → Privacy.</p>
            <div className="setting-row">
              <div><b>Private account</b><p>Only approved followers can see your posts and moments.</p></div>
              <Switch on={form.isPrivate} onChange={v => set('isPrivate', v)} label="Private account" />
            </div>
            <div className="setting-row">
              <div><b>Automatic translation</b><p>Translate incoming messages into your language.</p></div>
              <Switch on={form.prefs.autoTranslate} onChange={v => setForm(f => ({ ...f, prefs: { ...f.prefs, autoTranslate: v } }))} label="Auto translate" />
            </div>
            <div className="setting-row">
              <div><b>Read receipts</b><p>Let people know when you've read their message.</p></div>
              <Switch on={form.privacy.readReceipts} onChange={v => setForm(f => ({ ...f, privacy: { ...f.privacy, readReceipts: v } }))} label="Read receipts" />
            </div>
            <label className="field"><span>Who can see your last seen</span>
              <select className="input" value={form.privacy.lastSeen} onChange={e => setForm(f => ({ ...f, privacy: { ...f.privacy, lastSeen: e.target.value } }))}>
                <option value="everyone">Everyone</option>
                <option value="contacts">My contacts</option>
                <option value="nobody">Nobody</option>
              </select>
            </label>
            <label className="field"><span>Who can see your moments</span>
              <select className="input" value={form.privacy.storyAudience} onChange={e => setForm(f => ({ ...f, privacy: { ...f.privacy, storyAudience: e.target.value } }))}>
                <option value="followers">Followers</option>
                <option value="contacts">Close contacts</option>
                <option value="private">Only me</option>
              </select>
            </label>
            <div className="onb-note">
              <Icon name="shield" size={17} />
              <div><b>Honest security.</b> Messages are encrypted in transit and at rest. End-to-end encryption is not yet enabled because AI translation requires server-side processing — this is documented in Settings → Security.</div>
            </div>
          </div>
        )}

        {error && <div className="form-error" style={{ maxWidth: 620, margin: '0 auto 14px' }}><Icon name="warning" size={15} />{error}</div>}

        <div className="onb-actions">
          {step > 0 && <button className="btn" onClick={() => setStep(s => s - 1)} disabled={busy}><Icon name="back" size={16} /> Back</button>}
          <button className="btn primary lg" onClick={next} disabled={busy}>
            {busy ? 'Saving…' : step === STEPS.length - 1 ? 'Enter AZOLVE CHAT' : 'Continue'} <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
