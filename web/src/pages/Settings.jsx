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
          <Icon name="warning" size={15} /> This device has no speech engine, so tap-to-hear is unavailable here. On Android, install or enable "Speech Services by Google" in system settings.
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
function PushPanel(props) {
  /* Inside the Android app there is no Push API at all, so the browser panel
     would always say "this browser cannot do it" — which is true but useless.
     The native path is a different chain with different failure points, so it
     gets its own panel that reports each link honestly. */
  return isNativeShell() ? <NativePushPanel {...props} /> : <WebPushPanel {...props} />;
}

/* ---------------------------------------------------------------------------
   NativePushPanel
   The Android chain, link by link:

     Firebase token  →  registered on the server  →  notification permission
     →  full-screen intent permission  →  battery exemption

   A call can only ring if every one of those is true, and any single failure
   produces the same symptom: the phone stays silent. So each link is shown with
   its real state, and the ones the user can fix have the exact system dialog
   behind a button. Nothing here is a placeholder.
--------------------------------------------------------------------------- */
function NativePushPanel({ notify }) {
  const [st, setSt] = useState(null);
  const [srv, setSrv] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setSt(nativeStatus());
    fcmStatus().then(s => setSrv(s)).catch(() => setSrv(null));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const testLocal = () => {
    const r = testLocalNotification(true);
    if (r.ok) notify?.('Test notification posted — check your shade and lock screen', 'ok');
    else notify?.(r.reason || 'Could not post a notification', 'err');
  };

  const testServer = async () => {
    setBusy(true);
    const r = await Push.sendTest();
    setBusy(false);
    if (r.ok) notify?.('Sent from the server — check your notification shade', 'ok');
    else notify?.('The server delivered nothing. This device may not be registered yet.', 'err');
  };

  const rows = [
    {
      key: 'token',
      label: 'Registered for push',
      ok: !!st?.token,
      detail: st?.token ? 'This phone has a Firebase token' : 'No token yet — open the app with internet once',
    },
    {
      key: 'server',
      label: 'Registered on the server',
      ok: (srv?.devices || 0) > 0,
      detail: srv?.devices ? `${srv.devices} device${srv.devices === 1 ? '' : 's'} on your account` : 'The server has no device for you yet',
    },
    {
      key: 'notif',
      label: 'Notifications allowed',
      ok: !!st?.notifications,
      detail: st?.notifications ? 'Android will show AZOLVE notifications' : 'Blocked — calls cannot appear until this is on',
      fix: openNotificationSettings,
      fixLabel: 'Allow',
    },
    {
      key: 'fsi',
      label: 'Full-screen calls allowed',
      ok: !!st?.fullScreen,
      detail: st?.fullScreen ? 'Calls can take over the screen and the lock screen' : 'Android will only show a banner, not a full call screen',
      fix: openFullScreenSettings,
      fixLabel: 'Allow',
    },
    {
      key: 'battery',
      label: 'Battery optimisation off',
      ok: st ? !st.batteryOptimised : false,
      detail: st?.batteryOptimised ? 'Android may delay or drop calls while the app is closed' : 'This app is exempt from battery saving',
      fix: requestBatteryExemption,
      fixLabel: 'Fix',
    },
  ];

  const broken = rows.filter(r => !r.ok);

  return (
    <div className="card stack">
      <h2>Call notifications</h2>
      <p className="muted small">
        When every line below is green, an incoming call takes over this phone's screen even
        when AZOLVE CHAT is closed, with Accept and Decline on the notification.
      </p>

      {broken.length === 0 ? (
        <div className="info-box ok">
          <Icon name="check" size={16} />
          <div>
            <b>Everything is set up</b>
            <p className="muted small">If a call still does not ring, the problem is on the caller's side or the server.</p>
          </div>
        </div>
      ) : (
        <div className="info-box warn">
          <Icon name="warning" size={16} />
          <div>
            <b>{broken.length} thing{broken.length === 1 ? '' : 's'} will stop calls from ringing</b>
            <p className="muted small">Fix them below — each button opens the exact Android setting.</p>
          </div>
        </div>
      )}

      {rows.map(r => (
        <div className="data-row" key={r.key}>
          <div>
            <b>
              <span style={{ color: r.ok ? '#1FBF75' : '#FF3B4E', marginRight: 6 }}>{r.ok ? '●' : '●'}</span>
              {r.label}
            </b>
            <p className="muted small">{r.detail}</p>
          </div>
          {!r.ok && r.fix && (
            <button className="btn ghost" onClick={r.fix}>{r.fixLabel}</button>
          )}
        </div>
      ))}

      <div className="data-row">
        <div>
          <b>Test on this phone</b>
          <p className="muted small">Posts a call notification from the app itself, with no server involved.</p>
        </div>
        <button className="btn ghost" onClick={testLocal}>
          <Icon name="bell" size={16} /> Test here
        </button>
      </div>

      <div className="data-row">
        <div>
          <b>Test through the server</b>
          <p className="muted small">Proves the whole chain: server → Firebase → this phone.</p>
        </div>
        <button className="btn ghost" disabled={busy} onClick={testServer}>
          <Icon name="send" size={16} /> Send test
        </button>
      </div>

      {st && (
        <p className="muted small">
          Android {st.sdk} · Firebase {st.firebase ? 'ready' : 'not initialised'}
          {srv?.projectId ? ` · project ${srv.projectId}` : ''}
        </p>
      )}
    </div>
  );
}


function WebPushPanel({ notify }) {
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
              In the Android app, notifications are handled by Firebase and are set up in the
              app itself.
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


const META = {
  account: { sub: 'Name, photo, bio and mood', tone: 'blue' },
  appearance: { sub: 'Light, dark or follow your system', tone: 'amber' },
  language: { sub: 'Your language and what gets translated', tone: 'green' },
  voice: { sub: 'Tap-to-hear and installed voices', tone: 'red' },
  privacy: { sub: 'Who sees your profile and activity', tone: 'blue' },
  security: { sub: 'Two-factor, sessions and encryption status', tone: 'amber' },
  notifications: { sub: 'Calls, messages and social activity', tone: 'green' },
  data: { sub: 'Export or delete your account data', tone: 'red' },
};

/* A short, honest language preview: the same sentence rendered in the
   language you picked. It is a static UI sample, not user data. */
const PREVIEW = {
  en: 'Shall we meet this evening?',
  hi: 'आज शाम को मिलते हैं?',
  ar: 'هل نتقابل هذا المساء؟',
  gu: 'આજે સાંજે મળીએ?',
  es: '¿Nos vemos esta noche?',
  fr: 'On se voit ce soir ?',
  de: 'Treffen wir uns heute Abend?',
  zh: '今晚我们见面吗？',
  ja: '今夜会いましょうか？',
  ko: '오늘 저녁에 만날까요?',
  pt: 'Encontramo-nos esta noite?',
  ru: 'Встретимся сегодня вечером?',
  it: 'Ci vediamo stasera?',
  tr: 'Bu akşam buluşalım mı?',
  id: 'Kita bertemu malam ini?',
  bn: 'আজ সন্ধ্যায় দেখা করব?',
  mr: 'आज संध्याकाळी भेटूया?',
  ta: 'இன்று மாலை சந்திக்கலாமா?',
  te: 'ఈ సాయంత్రం కలుద్దామా?',
  ur: 'آج شام ملتے ہیں؟',
  nl: 'Zien we elkaar vanavond?',
  pl: 'Spotkamy się dziś wieczorem?',
  vi: 'Tối nay gặp nhau nhé?',
  th: 'เย็นนี้เจอกันไหม?',
  he: 'ניפגש הערב?',
  fa: 'امشب همدیگر را ببینیم؟',
  sw: 'Tukutane leo jioni?',
};

const Toggle = ({ on, onClick, label }) => (
  <button
    type="button"
    className={`ux-tgl ${on ? 'on' : ''}`}
    onClick={onClick}
    aria-label={label}
    aria-pressed={!!on}
  ><i /></button>
);

const TRow = ({ icon, tone, title, sub, on, onClick }) => (
  <div className="ux-set-row" style={{ cursor: 'default' }}>
    <span className={`ux-set-ic ${tone}`}><Icon name={icon} size={18} /></span>
    <span className="ux-set-main"><b>{title}</b><small>{sub}</small></span>
    <Toggle on={on} onClick={onClick} label={title} />
  </div>
);

const Chev = () => (
  <Icon name="back" size={16} className="ux-set-chev" style={{ transform: 'rotate(180deg)' }} />
);

export default function Settings() {
  const { user, route, navigate, theme, themePref, setTheme, notify, refreshMe, logout, device, setDevice } = useApp();
  const [sec, setSec] = useState(route?.param || null);
  const [profile, setProfile] = useState({ displayName: user.displayName || '', bio: user.bio || '', country: user.country || '', language: user.language || 'en', mood: user.mood || '' });
  const [privacy, setPrivacy] = useState(user.privacy || { profile: 'public', lastSeen: 'contacts', readReceipts: true, storyAudience: 'followers' });
  const [prefs, setPrefs] = useState(user.prefs || { autoTranslate: true, notifications: { messages: true, social: true, calls: true } });
  const [sessions, setSessions] = useState(null);
  const [twofa, setTwofa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [pick, setPick] = useState(null); // 'primary' | 'read'
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

  const readLangs = Array.isArray(prefs.readLangs) && prefs.readLangs.length ? prefs.readLangs : ['en'];
  const setReadLangs = (next) => savePrefs({ ...prefs, readLangs: next });
  const toggleRead = (code) => {
    if (code === profile.language) return;
    setReadLangs(readLangs.includes(code) ? readLangs.filter(c => c !== code) : [...readLangs, code]);
  };
  const chooseLang = (code) => {
    setProfile(p => ({ ...p, language: code }));
    setPick(null);
    API.updateMe({ language: code }).then(() => refreshMe()).then(() => notify('Language updated', 'ok')).catch(e => notify(e.message, 'err'));
  };

  const title = sec ? (SECTIONS.find(s => s.id === sec)?.label || 'Settings') : 'Settings';

  const backHeader = (t, sub) => (
    <header className="ux-set-head">
      <button className="ux-set-back" onClick={() => { setSec(null); navigate('settings'); }} aria-label="Back">
        <Icon name="back" size={18} />
      </button>
      <div>
        <h1 className="ux-set-h1">{t}</h1>
        {sub && <p className="ux-set-sub">{sub}</p>}
      </div>
    </header>
  );

  /* ------------------------------- menu ---------------------------------- */
  const menu = (
    <>
      <header className="ux-set-head">
        <div>
          <h1 className="ux-set-h1 lg">Settings</h1>
          <p className="ux-set-sub">How AZOLVE looks, speaks and protects you.</p>
        </div>
      </header>

      <div className="ux-set-group">
        {SECTIONS.map(s => (
          <button key={s.id} className="ux-set-row" onClick={() => setSec(s.id)}>
            <span className={`ux-set-ic ${META[s.id]?.tone || 'grey'}`}><Icon name={s.icon} size={18} /></span>
            <span className="ux-set-main"><b>{s.label}</b><small>{META[s.id]?.sub}</small></span>
            <Chev />
          </button>
        ))}
      </div>

      <div className="ux-set-group" style={{ marginTop: 16 }}>
        <button className="ux-set-row" onClick={() => navigate('profile')}>
          <span className="ux-set-ic grey"><Icon name="user" size={18} /></span>
          <span className="ux-set-main"><b>View my profile</b><small>@{user.username}</small></span>
          <Chev />
        </button>
        <button className="ux-set-row" onClick={async () => { await API.logout(); logout(); }}>
          <span className="ux-set-ic red"><Icon name="logout" size={18} /></span>
          <span className="ux-set-main"><b>Log out</b><small>You will need your code to sign back in</small></span>
          <Chev />
        </button>
      </div>

      <p className="ux-set-sub" style={{ textAlign: 'center', marginTop: 20 }}>
        AZOLVE CHAT · v1.1.1 · {theme === 'dark' ? 'Dark' : 'Light'} theme
      </p>
    </>
  );

  /* ----------------------------- language -------------------------------- */
  const languageBody = (
    <>
      <section className="ux-my-lang">
        <div className="glow" />
        <p className="lbl">MY LANGUAGE</p>
        <div className="top">
          <b dir={langOf(profile.language).rtl ? 'rtl' : 'ltr'}>{langOf(profile.language).native}</b>
          <button className="chg" onClick={() => setPick('primary')}>Change</button>
        </div>
        <div className="prev">
          <span>PREVIEW</span>
          <p dir={langOf(profile.language).rtl ? 'rtl' : 'ltr'}>
            “Shall we meet this evening?”
            <Icon name="back" size={12} style={{ transform: 'rotate(180deg)' }} />
            {PREVIEW[profile.language] || langOf(profile.language).native}
          </p>
        </div>
      </section>

      <section className="ux-set-group" style={{ marginTop: 20 }}>
        <TRow icon="translate" tone="blue" title="Auto-translate messages"
          sub="Incoming chats appear in your language"
          on={prefs.autoTranslate !== false}
          onClick={() => savePrefs({ ...prefs, autoTranslate: prefs.autoTranslate === false })} />
        <TRow icon="eye" tone="amber" title="Show original by default"
          sub="Display both languages together"
          on={prefs.showOriginalDefault === true}
          onClick={() => savePrefs({ ...prefs, showOriginalDefault: prefs.showOriginalDefault !== true })} />
        <TRow icon="mic" tone="green" title="Voice message captions"
          sub="Transcribe and translate audio"
          on={prefs.voiceCaptions !== false}
          onClick={() => savePrefs({ ...prefs, voiceCaptions: prefs.voiceCaptions === false })} />
        <TRow icon="play" tone="red" title="Stories, posts & reels"
          sub="Translate captions in feeds"
          on={prefs.translateFeeds !== false}
          onClick={() => savePrefs({ ...prefs, translateFeeds: prefs.translateFeeds === false })} />
      </section>

      <p className="ux-lang-lbl">LANGUAGES I READ</p>
      <section className="ux-set-group" style={{ marginTop: 8 }}>
        <div className="ux-lang-row">
          <span dir={langOf(profile.language).rtl ? 'rtl' : 'ltr'}>{langOf(profile.language).native}</span>
          <span className="tag">Primary</span>
          <Icon name="check" size={18} className="ck" />
        </div>
        {readLangs.filter(c => c !== profile.language).map(code => (
          <button key={code} className="ux-lang-row" onClick={() => toggleRead(code)}>
            <span dir={langOf(code).rtl ? 'rtl' : 'ltr'}>{langOf(code).native}</span>
            <Icon name="check" size={18} className="ck" />
          </button>
        ))}
        <button className="ux-lang-row add" onClick={() => setPick('read')}>
          <Icon name="plus" size={16} /> Add language
        </button>
      </section>

      <section className="ux-set-group" style={{ marginTop: 20 }}>
        <button className="ux-set-row" onClick={() => navigate('chats')}>
          <span className="ux-set-ic grey"><Icon name="chat" size={18} /></span>
          <span className="ux-set-main">
            <b>Per-chat overrides</b>
            <small>{readLangs.length > 1 ? `${readLangs.length} languages in use` : 'Set a language per conversation'}</small>
          </span>
          <Chev />
        </button>
      </section>

      <div className="ux-set-note blue">
        <Icon name="info" size={16} />
        <div>
          <b>How translation works</b>
          Every message is stored once in its original language. Translation happens per-recipient at read time and is cached separately — the original is never overwritten.
          <div className="prov-chips" style={{ marginTop: 8 }}>
            {(aiStatus?.translationProviders || []).map(p => <span key={p.name} className={`prov ${p.available ? 'on' : ''}`}>{p.name}{p.available ? ' ✓' : ''}</span>)}
          </div>
        </div>
      </div>

      <div className="ux-set-pad" style={{ marginTop: 16 }}>
        <button className="ux-set-btn" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save language'}</button>
      </div>
    </>
  );

  /* ------------------------------ account -------------------------------- */
  const accountBody = (
    <div className="ux-set-pad">
      <div className="ux-card" style={{ padding: 16 }}>
        <div className="avatar-edit">
          <Avatar user={user} size={72} />
          <div>
            <button className="btn ghost btn-sm" onClick={() => avRef.current?.click()}>Change photo</button>
            <input ref={avRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && changeAvatar(e.target.files[0])} />
            <p className="muted small">@{user.username} · {user.email || user.phone}</p>
          </div>
        </div>
        <div className="field-row" style={{ marginTop: 14 }}>
          <label className="field"><span>Display name</span><input value={profile.displayName} onChange={e => setProfile(p => ({ ...p, displayName: e.target.value }))} /></label>
          <label className="field"><span>Country</span><input value={profile.country} onChange={e => setProfile(p => ({ ...p, country: e.target.value.toUpperCase().slice(0, 2) }))} /></label>
        </div>
        <label className="field"><span>Bio</span><textarea rows={3} value={profile.bio} onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} maxLength={160} /></label>
        <label className="field"><span>Mood status</span><input value={profile.mood} onChange={e => setProfile(p => ({ ...p, mood: e.target.value }))} placeholder="🎧 Focused" /></label>
        <button className="ux-set-btn" style={{ marginTop: 14 }} onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );

  /* ----------------------------- appearance ------------------------------ */
  const appearanceBody = (
    <div className="ux-set-pad">
      <div className="ux-card" style={{ padding: 16 }}>
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

      <div className="ux-card" style={{ padding: 16, marginTop: 16 }}>
        <div className="sec-head">
          <div>
            <h2>Device preview</h2>
            <p className="muted small">AZOLVE is built as a mobile application first. Check the layout at real device sizes.</p>
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

      <div className="ux-card" style={{ padding: 16, marginTop: 16 }}>
        <h2>Motion</h2>
        <p className="muted small">AZOLVE uses gentle motion — a rotating mark on launch, a progress bar while data loads, and soft transitions between screens. Motion respects your system's reduced-motion setting.</p>
        <div className="motion-demo">
          <span className="md-orbit"><i /></span>
          <div className="md-track"><i /></div>
          <span className="md-text">Rotating mark + progress</span>
        </div>
      </div>
    </div>
  );

  /* ------------------------------- privacy ------------------------------- */
  const privacyBody = (
    <div className="ux-set-pad">
      <div className="ux-card" style={{ padding: 16 }}>
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
    </div>
  );

  /* ------------------------------ security ------------------------------- */
  const securityBody = (
    <div className="ux-set-pad">
      <div className="ux-card" style={{ padding: 16 }}>
        <Switch on={twofa} label="Two-factor authentication on login" onChange={toggle2fa} />
      </div>
      <div className="ux-set-note">
        <Icon name="warning" size={16} />
        <div>
          <b>Encryption status — honest disclosure</b>
          AZOLVE currently uses TLS in transit and server-side storage at rest. End-to-end encryption is <b>not</b> enabled in this build, because per-recipient AI translation requires the server to read message text. We never claim E2EE when it is not active.
        </div>
      </div>
      <p className="ux-lang-lbl">ACTIVE SESSIONS</p>
      <div className="ux-set-group" style={{ marginTop: 8 }}>
        {sessions === null && <div style={{ padding: 16 }}><Skeleton h={44} /></div>}
        {sessions && sessions.length === 0 && <div style={{ padding: 16 }} className="muted small">No other sessions.</div>}
        {sessions && sessions.map(s => (
          <div key={s.id} className="ux-sess">
            <Icon name="smartphone" size={18} />
            <div>
              <b>{s.device || 'Unknown device'} {s.current && <span>This device</span>}</b>
              <small>{s.ip} · active {timeAgo(s.last_active)}</small>
            </div>
            {!s.current && <button className="ux-set-btn ghost sm" onClick={() => revoke(s.id)}>Revoke</button>}
          </div>
        ))}
      </div>
      <button className="ux-set-btn ghost" style={{ marginTop: 16 }} onClick={async () => { await API.logout(); logout(); }}>
        <Icon name="logout" size={16} /> Log out
      </button>
    </div>
  );

  /* --------------------------- notifications ----------------------------- */
  const notificationsBody = (
    <div className="ux-set-pad">
      <PushPanel notify={notify} />
      <div className="ux-card" style={{ padding: 16, marginTop: 16 }}>
        <h2>In-app notifications</h2>
        <Switch on={prefs.notifications?.messages !== false} label="New messages" onChange={v => savePrefs({ ...prefs, notifications: { ...prefs.notifications, messages: v } })} />
        <Switch on={prefs.notifications?.social !== false} label="Likes, comments and follows" onChange={v => savePrefs({ ...prefs, notifications: { ...prefs.notifications, social: v } })} />
        <Switch on={prefs.notifications?.calls !== false} label="Incoming calls" onChange={v => savePrefs({ ...prefs, notifications: { ...prefs.notifications, calls: v } })} />
      </div>
    </div>
  );

  /* -------------------------------- data --------------------------------- */
  const dataBody = (
    <div className="ux-set-pad">
      <div className="ux-card" style={{ padding: 16 }}>
        <div className="data-row">
          <div><b>Download your data</b><p className="muted small">Export your profile, posts, messages and settings as JSON.</p></div>
          <button className="ux-set-btn ghost sm" onClick={exportData}><Icon name="download" size={16} /> Export</button>
        </div>
        <div className="data-row danger">
          <div><b>Delete account</b><p className="muted small">Deactivates your profile and clears personal identifiers. This cannot be undone.</p></div>
          <button className="ux-set-btn red sm" onClick={deleteAccount}><Icon name="trash" size={16} /> Delete</button>
        </div>
      </div>
    </div>
  );

  const bodies = {
    account: accountBody,
    appearance: appearanceBody,
    language: languageBody,
    voice: <div className="ux-set-pad"><VoicePanel notify={notify} /></div>,
    privacy: privacyBody,
    security: securityBody,
    notifications: notificationsBody,
    data: dataBody,
  };

  return (
    <div className="ux-screen">
      <div className="ux-scroll">
        {!sec ? menu : (
          <>
            {backHeader(title, META[sec]?.sub)}
            {bodies[sec]}
          </>
        )}
      </div>

      {pick && (
        <div className="modal-backdrop" onClick={() => setPick(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>{pick === 'primary' ? 'My language' : 'Add a language'}</b>
              <button className="icon-btn" onClick={() => setPick(null)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {LANGS.map(l => (
                <button key={l.code} className="ux-lang-row" onClick={() => {
                  if (pick === 'primary') chooseLang(l.code);
                  else { if (!readLangs.includes(l.code)) setReadLangs([...readLangs, l.code]); setPick(null); }
                }}>
                  <span dir={l.rtl ? 'rtl' : 'ltr'}>{l.native}</span>
                  <span className="tag">{l.label}</span>
                  {(pick === 'primary' ? profile.language === l.code : readLangs.includes(l.code)) && <Icon name="check" size={18} className="ck" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
