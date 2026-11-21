import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Switch, Empty, Skeleton } from '../components/UI.jsx';
import { API, uploadFile, getToken } from '../lib/api.js';
import { LANGS, langOf } from '../lib/i18n.js';
import { timeAgo } from '../lib/utils.js';
import { resolveVoice, whenVoicesReady, speak, stopSpeech, speechSupported } from '../lib/speech.js';
import { SpeakingBars } from '../components/Hear.jsx';
import * as Push from '../lib/push.js';

const SECTIONS = [
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'language', label: 'Language & translation', icon: 'translate' },
  { id: 'voice', label: 'Voice & speech', icon: 'volume' },
  { id: 'privacy', label: 'Privacy', icon: 'shield' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'data', label: 'Data & account', icon: 'download' },
];

/* ---------------------------------------------------------------------------
   Voice & speech — honest device capability report.
   The voices come from the operating system / browser, so we show exactly
   which of the 27 languages have a real native voice here, which fall back to
   an approximate one, and which have none at all.
   ------------------------------------------------------------------------- */
const SAMPLE = {
  en: 'Hello — this is how your messages will sound.',
  hi: 'नमस्ते — आपके संदेश ऐसे सुनाई देंगे।',
  ar: 'مرحباً — هكذا ستبدو رسائلك.',
  es: 'Hola — así sonarán tus mensajes.',
  fr: 'Bonjour — voici comment vos messages sonneront.',
  de: 'Hallo — so werden deine Nachrichten klingen.',
  ja: 'こんにちは — メッセージはこのように聞こえます。',
  zh: '你好 — 你的消息听起来会是这样。',
  pt: 'Olá — é assim que as suas mensagens vão soar.',
  ru: 'Привет — так будут звучать ваши сообщения.',
  gu: 'નમસ્તે — તમારા સંદેશા આ રીતે સંભળાશે.',
  ur: 'ہیلو — آپ کے پیغامات ایسے سنائی دیں گے۔',
};

function VoicePanel({ notify }) {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(null);
  const supported = speechSupported();

  useEffect(() => {
    let alive = true;
    whenVoicesReady(2500).then(() => { if (alive) setReady(true); });
    return () => { alive = false; stopSpeech(); };
  }, []);

  const rows = LANGS.map(l => ({ ...l, ...resolveVoice(l.code) }));
  const native = rows.filter(r => r.quality === 'native');
  const approximate = rows.filter(r => r.quality === 'approximate');
  const missing = rows.filter(r => r.quality === 'none');

  const play = (row) => {
    if (playing === row.code) { stopSpeech(); setPlaying(null); return; }
    const text = SAMPLE[row.code] || `${row.native}.`;
    setPlaying(row.code);
    speak({ text, lang: row.code, id: `voice-test-${row.code}`, onDone: () => setPlaying(null) })
      .then(r => { if (!r.ok) { setPlaying(null); notify('This device has no voice for that language.', 'err'); } });
  };

  return (
    <div className="card stack">
      <h2>Voice &amp; speech</h2>
      <p className="muted small">
        Tap any translated message, or any call caption, to hear it read aloud. Speech is
        generated on your device by your operating system — no audio is uploaded, and no
        API key is involved. That also means the available voices depend on your device.
      </p>

      {!supported && (
        <div className="voice-warn">
          <Icon name="warning" size={15} /> This browser has no speech engine, so tap-to-hear is unavailable here.
        </div>
      )}

      {supported && (
        <>
          <div className="voice-summary">
            <div><b>{native.length}</b><span>native {native.length === 1 ? 'voice' : 'voices'}</span></div>
            <div><b>{approximate.length}</b><span>approximate</span></div>
            <div><b>{missing.length}</b><span>not installed</span></div>
          </div>

          {!ready && <Skeleton h={64} />}

          {ready && (
            <div className="voice-list">
              {rows.map(r => (
                <div key={r.code} className={`voice-row q-${r.quality}`}>
                  <span className="voice-flag">{r.code.toUpperCase()}</span>
                  <span className="voice-name">{r.native}<em>{r.label}</em></span>
                  <span className={`voice-badge ${r.quality}`}>
                    {r.quality === 'native' ? 'Native' : r.quality === 'approximate' ? 'Approximate' : 'None'}
                  </span>
                  <button
                    className={`voice-play ${playing === r.code ? 'on' : ''}`}
                    onClick={() => play(r)}
                    disabled={r.quality === 'none'}
                    title={r.quality === 'none' ? 'No voice installed for this language' : `Hear a sample in ${r.native}`}
                  >
                    {playing === r.code ? <SpeakingBars small /> : <Icon name="volume" size={14} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="muted small">
            “Approximate” means the language has no installed voice, so the closest available
            voice reads it. AZOLVE tells you this instead of pretending the language is supported.
          </p>
        </>
      )}
    </div>
  );
}


/* ---------------------------------------------------------------------------
   PushPanel
   The switch here is not cosmetic: turning it on really asks the browser for
   permission, creates a push subscription, and stores it on the server so a
   call can ring this device while the app is closed. Every failure is reported
   in plain words instead of silently flipping back.
--------------------------------------------------------------------------- */
function PushPanel({ notify }) {
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = Push.isSupported();
      if (!alive) return;
      setSupported(ok);
      if (!ok) return;
      const st = await Push.status();
      const sub = await Push.isSubscribed();
      if (!alive) return;
      setReady(st.ready !== false);
      setOn(!!sub && st.subscribed !== false);
    })();
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
    setBusy(true);
    setNote('');
    if (on) {
      const r = await Push.unsubscribe();
      if (r.ok) { setOn(false); notify?.('Call notifications turned off for this device', 'ok'); }
      else notify?.(r.reason || 'Could not turn notifications off', 'err');
    } else {
      const r = await Push.subscribe();
      if (r.ok) { setOn(true); notify?.('This device will now ring even when AZOLVE is closed', 'ok'); }
      else { setNote(r.reason || 'Could not turn on notifications'); notify?.(r.reason || 'Could not turn on notifications', 'err'); }
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const r = await Push.sendTest();
    setBusy(false);
    if (r.ok) notify?.('Test notification sent \u2014 check your notification shade', 'ok');
    else notify?.('Nothing was delivered. Make sure notifications are allowed for this site.', 'err');
  };

  return (
    <div className="card stack">
      <h2>Call notifications</h2>
      <p className="muted small">
        When this is on, an incoming call rings this device even if AZOLVE CHAT is closed,
        with Accept and Decline buttons on the notification.
      </p>

      {!supported && (
        <div className="info-box warn">
          <Icon name="warning" size={16} />
          <div>
            <b>This browser cannot do it</b>
            <p className="muted small">
              Background notifications need a browser with the Push API. On iPhone, open AZOLVE
              in Safari, tap Share, then Add to Home Screen and enable this from there.
              The Android APK rings while it is open or in the background; ringing a fully
              closed native app needs Firebase Cloud Messaging, which is not connected yet.
            </p>
          </div>
        </div>
      )}

      {supported && !ready && (
        <div className="info-box warn">
          <Icon name="warning" size={16} />
          <div>
            <b>The server has not finished setting up notifications</b>
            <p className="muted small">Try again in a minute.</p>
          </div>
        </div>
      )}

      {supported && (
        <>
          <Switch on={on} label={busy ? 'Working\u2026' : 'Ring this device when the app is closed'} onChange={toggle} />
          {note && <p className="muted small">{note}</p>}
          {on && (
            <div className="data-row">
              <div>
                <b>Test it now</b>
                <p className="muted small">Sends one notification to this device so you can see exactly how a call will look.</p>
              </div>
              <button className="btn ghost" disabled={busy} onClick={test}>
                <Icon name="bell" size={16} /> Send test
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const { user, theme, themePref, setTheme, notify, refreshMe, logout, device, setDevice } = useApp();
  const [sec, setSec] = useState('account');
  const [profile, setProfile] = useState({ displayName: user.displayName || '', bio: user.bio || '', country: user.country || '', language: user.language || 'en', mood: user.mood || '' });
  const [privacy, setPrivacy] = useState(user.privacy || { profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' });
  const [prefs, setPrefs] = useState(user.prefs || { autoTranslate: true, notifications: { messages: true, social: true, calls: true } });
  const [sessions, setSessions] = useState(null);
  const [twofa, setTwofa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const avRef = useRef(null);

  useEffect(() => {
    API.aiStatus().then(setAiStatus).catch(() => {});
    API.sessions().then(r => setSessions(r.sessions || [])).catch(() => setSessions([]));
    setTwofa(!!user.twoFactor);
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    try { await API.updateMe(profile); await refreshMe(); notify('Saved', 'ok'); }
    catch (e) { notify(e.message, 'err'); }
    finally { setSaving(false); }
  };
  const savePrivacy = async (next) => {
    setPrivacy(next);
    try { await API.updateMe({ privacy: next }); notify('Privacy updated', 'ok'); } catch (e) { notify(e.message, 'err'); }
  };
  const savePrefs = async (next) => {
    setPrefs(next);
    try { await API.updateMe({ prefs: next }); notify('Preferences updated', 'ok'); } catch (e) { notify(e.message, 'err'); }
  };
  const changeAvatar = async (file) => {
    try { const r = await uploadFile(file); await API.updateMe({ avatar: r.url }); await refreshMe(); notify('Photo updated', 'ok'); }
    catch (e) { notify(e.message, 'err'); }
  };
  const toggle2fa = async () => {
    try { await API.twofa(!twofa); setTwofa(t => !t); notify(!twofa ? '2FA enabled' : '2FA disabled', 'ok'); }
    catch (e) { notify(e.message, 'err'); }
  };
  const revoke = async (id) => {
    try { await API.revokeSession(id); setSessions(s => s.filter(x => x.id !== id)); notify('Session revoked', 'ok'); }
    catch (e) { notify(e.message, 'err'); }
  };
  const exportData = async () => {
    try {
      const res = await fetch('/api/users/me/export', { headers: { Authorization: `Bearer ${getToken()}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'azolve-export.json'; a.click();
      URL.revokeObjectURL(url);
      notify('Export downloaded', 'ok');
    } catch (e) { notify(e.message, 'err'); }
  };
  const deleteAccount = async () => {
    if (!confirm('Delete your account? This deactivates your profile and clears personal identifiers.')) return;
    try { await API.deleteMe(); notify('Account deleted', 'ok'); logout(); }
    catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div className="page page-wide settings-page">
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Control how AZOLVE looks, speaks and protects you.</p></div></div>
      <div className="settings-layout">
        <aside className="settings-nav card">
          {SECTIONS.map(s => (
            <button key={s.id} className={`settings-item ${sec === s.id ? 'active' : ''}`} onClick={() => setSec(s.id)}>
              <Icon name={s.icon} size={17} /> {s.label}
            </button>
          ))}
        </aside>

        <section className="settings-body">
          {sec === 'account' && (
            <div className="card stack">
              <h2>Account</h2>
              <div className="avatar-edit">
                <Avatar user={user} size={72} />
                <div>
                  <button className="btn ghost btn-sm" onClick={() => avRef.current?.click()}>Change photo</button>
                  <input ref={avRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && changeAvatar(e.target.files[0])} />
                  <p className="muted small">@{user.username} · {user.email || user.phone}</p>
                </div>
              </div>
              <div className="field-row">
                <label className="field"><span>Display name</span><input value={profile.displayName} onChange={e => setProfile(p => ({ ...p, displayName: e.target.value }))} /></label>
                <label className="field"><span>Country</span><input value={profile.country} onChange={e => setProfile(p => ({ ...p, country: e.target.value.toUpperCase().slice(0, 2) }))} /></label>
              </div>
              <label className="field"><span>Bio</span><textarea rows={3} value={profile.bio} onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} maxLength={160} /></label>
              <label className="field"><span>Mood status</span><input value={profile.mood} onChange={e => setProfile(p => ({ ...p, mood: e.target.value }))} placeholder="🎧 Focused" /></label>
              <button className="btn primary" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}

          {sec === 'appearance' && (
            <div className="stack">
              <div className="card stack">
                <div className="sec-head">
                  <div>
                    <h2>Theme</h2>
                    <p className="muted small">Pick a look. It applies instantly and is remembered on this device.</p>
                  </div>
                  <span className="pill">{theme === 'dark' ? 'Dark active' : 'Light active'}</span>
                </div>

                <div className="theme-picker three">
                  <button className={`theme-card ${themePref === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
                    <div className="tc-preview light"><span /><span /><span /></div>
                    <div className="tc-meta"><b>Light</b><small>Bright, paper-soft</small></div>
                    {themePref === 'light' && <i className="tc-check">✓</i>}
                  </button>
                  <button className={`theme-card ${themePref === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
                    <div className="tc-preview dark"><span /><span /><span /></div>
                    <div className="tc-meta"><b>Dark</b><small>Midnight, low glare</small></div>
                    {themePref === 'dark' && <i className="tc-check">✓</i>}
                  </button>
                  <button className={`theme-card ${themePref === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')}>
                    <div className="tc-preview auto"><span /><span /><span /></div>
                    <div className="tc-meta"><b>System</b><small>Follows your OS</small></div>
                    {themePref === 'system' && <i className="tc-check">✓</i>}
                  </button>
                </div>

                <div className="theme-swatch">
                  <span className="sw-label">Live preview</span>
                  <div className="sw-card">
                    <div className="sw-bubble in">Perfecto. ¿Podemos revisar la versión en español?</div>
                    <div className="sw-bubble out">Sounds good — I'll review tonight.</div>
                    <div className="sw-tag">Translated from Spanish · See original</div>
                  </div>
                </div>
              </div>

              <div className="card stack">
                <div className="sec-head">
                  <div>
                    <h2>Device preview</h2>
                    <p className="muted small">AZOLVE is built as a mobile application first. Open the phone frame to check the layout at real device sizes.</p>
                  </div>
                </div>
                <div className="device-picker">
                  <button className={`dp-card ${device === 'desktop' ? 'active' : ''}`} onClick={() => setDevice('desktop')}>
                    <span className="dp-ic">🖥</span><b>Desktop</b><small>Wide layout</small>
                  </button>
                  <button className={`dp-card ${device === 'mobile' ? 'active' : ''}`} onClick={() => setDevice('mobile')}>
                    <span className="dp-ic">📱</span><b>Mobile</b><small>Phone frame · 393×852</small>
                  </button>
                </div>
              </div>

              <div className="card stack">
                <h2>Motion</h2>
                <p className="muted small">AZOLVE uses gentle motion — a rotating mark on launch, a progress bar while data loads, and soft transitions between screens. Motion respects your system's reduced-motion setting.</p>
                <div className="motion-demo">
                  <span className="md-orbit"><i /></span>
                  <div className="md-track"><i /></div>
                  <span className="md-text">Rotating mark + progress</span>
                </div>
              </div>
            </div>
          )}

          {sec === 'language' && (
            <div className="stack">
              <div className="card stack">
                <div className="sec-head"><h3>Translation</h3></div>
                <div className="tr-preview">
                  <div className="src">Shall we meet this evening?</div>
                  <div className="dst">¿Nos vemos esta noche? · translated to {langOf(profile.language).label}</div>
                </div>
                <Switch on={prefs.autoTranslate !== false} label="Auto-translate messages"
                  onChange={v => savePrefs({ ...prefs, autoTranslate: v })} />
                <p className="muted small" style={{ marginTop: -6 }}>Incoming chats appear in your language.</p>
                <Switch on={prefs.showOriginalDefault === true} label="Show original by default"
                  onChange={v => savePrefs({ ...prefs, showOriginalDefault: v })} />
                <p className="muted small" style={{ marginTop: -6 }}>Display both languages together.</p>
                <Switch on={prefs.voiceCaptions !== false} label="Voice message captions"
                  onChange={v => savePrefs({ ...prefs, voiceCaptions: v })} />
                <p className="muted small" style={{ marginTop: -6 }}>Transcribe and translate audio.</p>
                <Switch on={prefs.translateFeeds !== false} label="Stories, posts & reels"
                  onChange={v => savePrefs({ ...prefs, translateFeeds: v })} />
                <p className="muted small" style={{ marginTop: -6 }}>Translate captions in feeds.</p>
              </div>

              <div className="card stack">
                <div className="sec-head"><h3>Languages</h3></div>
                <label className="field"><span>Your language</span>
                  <select value={profile.language} onChange={e => { setProfile(p => ({ ...p, language: e.target.value })); }}>
                    {LANGS.map(l => <option key={l.code} value={l.code}>{l.label} — {l.native}</option>)}
                  </select>
                </label>
                <label className="field"><span>Translate everything into</span>
                  <select value={prefs.translateTo || profile.language}
                    onChange={e => savePrefs({ ...prefs, translateTo: e.target.value })}>
                    {LANGS.map(l => <option key={l.code} value={l.code}>{l.label} — {l.native}</option>)}
                  </select>
                </label>
                <button className="btn primary btn-sm" onClick={saveProfile} disabled={saving}>Save language</button>
                <div className="info-box">
                  <Icon name="info" size={16} />
                  <div>
                    <b>How translation works</b>
                    <p className="muted small">Every message is stored once in its original language. Translation happens per-recipient at read time and is cached separately — the original is never overwritten. If a provider is unavailable, AZOLVE falls back gracefully.</p>
                    <div className="prov-chips">
                      {(aiStatus?.translationProviders || []).map(p => <span key={p.name} className={`prov ${p.available ? 'on' : ''}`}>{p.name}{p.available ? ' ✓' : ''}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {sec === 'privacy' && (
            <div className="card stack">
              <h2>Privacy</h2>
              <label className="field"><span>Who can see my profile</span>
                <select value={privacy.profile} onChange={e => savePrivacy({ ...privacy, profile: e.target.value })}>
                  <option value="public">Everyone</option><option value="followers">Followers</option><option value="private">Only me</option>
                </select>
              </label>
              <label className="field"><span>Last seen</span>
                <select value={privacy.lastSeen} onChange={e => savePrivacy({ ...privacy, lastSeen: e.target.value })}>
                  <option value="everyone">Everyone</option><option value="contacts">My contacts</option><option value="nobody">Nobody</option>
                </select>
              </label>
              <label className="field"><span>Moment audience default</span>
                <select value={privacy.storyAudience} onChange={e => savePrivacy({ ...privacy, storyAudience: e.target.value })}>
                  <option value="followers">Followers</option><option value="close">Close friends</option><option value="private">Only me</option>
                </select>
              </label>
              <Switch on={!!privacy.readReceipts} label="Send read receipts" onChange={v => savePrivacy({ ...privacy, readReceipts: v })} />
              <Switch on={!!user.isPrivate} label="Private account (approve followers)" onChange={async v => { await API.updateMe({ isPrivate: v }); refreshMe(); }} />
              <Switch on={!!user.temporaryIdentity} label="Temporary identity mode (hide real name in public spaces)" onChange={async v => { await API.updateMe({ temporaryIdentity: v }); refreshMe(); }} />
            </div>
          )}

          {sec === 'security' && (
            <div className="card stack">
              <h2>Security</h2>
              <Switch on={twofa} label="Two-factor authentication on login" onChange={toggle2fa} />
              <div className="info-box warn">
                <Icon name="warning" size={16} />
                <div>
                  <b>Encryption status — honest disclosure</b>
                  <p className="muted small">AZOLVE currently uses TLS in transit and server-side storage at rest. End-to-end encryption is <b>not</b> enabled in this build, because per-recipient AI translation requires the server to read message text. We never claim E2EE when it is not active. A future E2EE mode will translate on-device and be clearly labelled.</p>
                </div>
              </div>
              <h3>Active sessions</h3>
              {sessions === null && <Skeleton h={50} />}
              {sessions && sessions.length === 0 && <p className="muted">No other sessions.</p>}
              {sessions && sessions.map(s => (
                <div key={s.id} className="session-row">
                  <Icon name="smartphone" size={18} />
                  <div><b>{s.device || 'Unknown device'} {s.current && <span className="pill">This device</span>}</b><small>{s.ip} · active {timeAgo(s.last_active)}</small></div>
                  {!s.current && <button className="btn ghost btn-sm" onClick={() => revoke(s.id)}>Revoke</button>}
                </div>
              ))}
              <button className="btn ghost" onClick={async () => { await API.logout(); logout(); }}><Icon name="logout" size={16} /> Log out</button>
            </div>
          )}

          {sec === 'voice' && <VoicePanel notify={notify} />}

          {sec === 'notifications' && (
            <>
              <PushPanel notify={notify} />
              <div className="card stack">
                <h2>In-app notifications</h2>
                <Switch on={prefs.notifications?.messages !== false} label="New messages" onChange={v => savePrefs({ ...prefs, notifications: { ...prefs.notifications, messages: v } })} />
                <Switch on={prefs.notifications?.social !== false} label="Likes, comments and follows" onChange={v => savePrefs({ ...prefs, notifications: { ...prefs.notifications, social: v } })} />
                <Switch on={prefs.notifications?.calls !== false} label="Incoming calls" onChange={v => savePrefs({ ...prefs, notifications: { ...prefs.notifications, calls: v } })} />
              </div>
            </>
          )}

          {sec === 'data' && (
            <div className="card stack">
              <h2>Data &amp; account</h2>
              <div className="data-row">
                <div><b>Download your data</b><p className="muted small">Export your profile, posts, messages and settings as JSON.</p></div>
                <button className="btn ghost" onClick={exportData}><Icon name="download" size={16} /> Export</button>
              </div>
              <div className="data-row danger">
                <div><b>Delete account</b><p className="muted small">Deactivates your profile and clears personal identifiers. This cannot be undone.</p></div>
                <button className="btn danger" onClick={deleteAccount}><Icon name="trash" size={16} /> Delete</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
