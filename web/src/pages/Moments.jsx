import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { API, api, uploadFile } from '../lib/api.js';
import { Icon, Avatar, Modal, Empty, Skeleton, Verified } from '../components/UI.jsx';
import { timeAgo } from '../lib/utils.js';
import { langOf } from '../lib/i18n.js';

const BGS = [
  'linear-gradient(135deg,#0F2027,#2C5364)', 'linear-gradient(135deg,#FF6B6B,#FFD93D)',
  'linear-gradient(135deg,#6D5EF8,#18E0C8)', 'linear-gradient(135deg,#3A1C71,#D76D77)',
  'linear-gradient(135deg,#134E5E,#71B280)', 'linear-gradient(135deg,#232526,#414345)',
];

export default function Moments() {
  const { user, notify } = useApp();
  const [groups, setGroups] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    try { const d = await API.moments(); setGroups(d.groups); }
    catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, []);

  const mine = groups?.find(g => g.user.id === user.id);

  return (
    <div className="ux-screen">
      <div className="ux-scroll">
        <header className="ux-feed-head">
          <div>
            <h1 className="ux-feed-h1">Moments</h1>
            <p className="ux-set-sub">24 hours · translated for every viewer</p>
          </div>
          <div className="acts">
            <button className="ux-round" onClick={() => setCreateOpen(true)} aria-label="AI moment creator"><Icon name="magic" size={18} /></button>
            <button className="ux-round blue" onClick={() => setCreateOpen(true)} aria-label="New moment"><Icon name="plus" size={18} /></button>
          </div>
        </header>

        <div className="ux-calls-hero">
          <div className="glow" />
          <div className="eyebrow">AZOLVE MOMENTS</div>
          <h2>Say it once.<br />Everyone reads it in their language.</h2>
          <p>Photo, video or a thought. Captions and replies are translated per viewer — your original is never replaced.</p>
          <div className="acts">
            <button className="p" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} /> New moment</button>
            <button className="g" onClick={() => setCreateOpen(true)}><Icon name="magic" size={16} /> AI caption</button>
          </div>
        </div>

        <div className="ux-calls-stats">
          <div><b>{groups?.length || 0}</b><span>people sharing</span></div>
          <div><b>{groups?.reduce((s, g) => s + g.moments.length, 0) || 0}</b><span>live moments</span></div>
          <div><b>24h</b><span>then it's gone</span></div>
        </div>

        <p className="ux-sub">Your circle <span>{groups?.length || 0}</span></p>

        {!groups ? (
          <div className="ux-stories">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} w={66} h={66} r={999} />)}</div>
        ) : groups.length === 0 ? (
          <div className="ux-pf-empty">
            <b>No moments right now</b>
            <p>Be the first to share something with your circle.</p>
            <button className="ux-set-btn" style={{ marginTop: 14 }} onClick={() => setCreateOpen(true)}>Create a moment</button>
          </div>
        ) : (
          <div className="ux-stories">
            <button className="ux-story" onClick={() => setCreateOpen(true)}>
              <span className="ux-story-ring" style={{ background: 'transparent' }}>
                <span className="inner"><Icon name="plus" size={22} /></span>
                <span className="ux-story-add"><Icon name="plus" size={12} /></span>
              </span>
              <p>Your moment</p>
            </button>
            {groups.map((g, gi) => {
              const last = g.moments[g.moments.length - 1];
              return (
                <button key={g.user.id} className={`ux-story ${g.allViewed ? 'seen' : ''}`} onClick={() => setViewer({ gi, mi: 0 })}>
                  <span className={`ux-story-ring ${g.allViewed ? 'seen' : ''}`}>
                    {last.type === 'image' ? (
                      <img src={last.media_url} alt="" loading="lazy" />
                    ) : (
                      <span className="inner" style={{ background: last.bg || BGS[0], color: '#fff', fontSize: 10, fontWeight: 800, padding: 4, textAlign: 'center' }}>
                        {(last.text || '').slice(0, 18)}
                      </span>
                    )}
                  </span>
                  <p>{g.user.displayName.split(' ')[0]}</p>
                </button>
              );
            })}
          </div>
        )}

        <div className="ux-section-head" style={{ marginTop: 26 }}>
          <h3>Highlights</h3>
          <span>Saved moments stay forever</span>
        </div>
        <div className="ux-pf-highlights">
          {(mine?.moments || []).map(m => (
            <div key={m.id} className="ux-pf-hl">
              <span className="ux-pf-hl-circle">
                {m.type === 'image' ? <img src={m.media_url} alt="" /> : <i style={{ background: m.bg || BGS[0], color: '#fff', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, padding: 4, textAlign: 'center' }}>{(m.text || '').slice(0, 12)}</i>}
              </span>
              <small>{new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
            </div>
          ))}
          {!mine && <p className="ux-pf-note">Create a moment to start your highlight collection.</p>}
        </div>
      </div>

      {viewer && groups && (
        <MomentViewer groups={groups} start={viewer} onClose={() => setViewer(null)} onChanged={load} />
      )}
      <CreateMoment open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />
    </div>
  );
}

function MomentViewer({ groups, start, onClose, onChanged }) {
  const { user, notify } = useApp();
  const [gi, setGi] = useState(start.gi);
  const [mi, setMi] = useState(start.mi);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState('');
  const [paused, setPaused] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewerList, setViewerList] = useState(null);
  const timer = useRef(null);

  const group = groups[gi];
  const moment = group?.moments[mi];

  const next = () => {
    if (!group) return onClose();
    if (mi < group.moments.length - 1) { setMi(mi + 1); setProgress(0); }
    else if (gi < groups.length - 1) { setGi(gi + 1); setMi(0); setProgress(0); }
    else onClose();
  };
  const prev = () => {
    if (mi > 0) { setMi(mi - 1); setProgress(0); }
    else if (gi > 0) { setGi(gi - 1); setMi(0); setProgress(0); }
  };

  useEffect(() => {
    if (!moment) return;
    API.viewMoment(moment.id).catch(() => {});
  }, [moment?.id]);

  useEffect(() => {
    if (!moment || paused || viewersOpen) return;
    setProgress(0);
    const startAt = Date.now();
    const dur = moment.type === 'video' ? 15000 : 6000;
    timer.current = setInterval(() => {
      const p = Math.min(100, ((Date.now() - startAt) / dur) * 100);
      setProgress(p);
      if (p >= 100) { clearInterval(timer.current); next(); }
    }, 60);
    return () => clearInterval(timer.current);
  }, [moment?.id, paused, viewersOpen]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [gi, mi, groups]);

  if (!moment) return null;
  const own = group.user.id === user.id;

  const react = async (emoji) => {
    try { await API.reactMoment(moment.id, emoji); notify(`${emoji} sent`); } catch (e) { notify(e.message, 'err'); }
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    try {
      const d = await API.replyMoment(moment.id, reply);
      setReply(''); notify('Reply sent in chat');
      onClose();
      navigate('chats', d.conversationId);
    } catch (e) { notify(e.message, 'err'); }
  };
  const openViewers = async () => {
    try { const d = await API.momentViewers(moment.id); setViewerList(d.viewers); setViewersOpen(true); }
    catch (e) { notify(e.message, 'err'); }
  };
  const del = async () => {
    if (!confirm('Delete this moment?')) return;
    try { await api(`/social/moments/${moment.id}`, { method: 'DELETE' }); onChanged(); onClose(); }
    catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div className="ux-storyv">
      {moment.type === 'image' && <img src={moment.media_url} alt={moment.caption || 'Moment'} />}
      {moment.type === 'video' && <video src={moment.media_url} autoPlay muted playsInline loop />}
      {moment.type === 'text' && (
        <div className="ux-story-bg" style={{ background: moment.bg || BGS[0] }}>
          <span>{moment.text}</span>
        </div>
      )}
      <div className="ux-story-shade" />
      <button className="ux-story-pause" onClick={() => setPaused(p => !p)} aria-label={paused ? 'Play' : 'Pause'} />

      <div className="ux-story-bars">
        {group.moments.map((m, i) => (
          <i key={m.id}><b style={{ width: i < mi ? '100%' : i === mi ? `${progress}%` : 0 }} /></i>
        ))}
      </div>

      <div className="ux-story-head">
        <div className="ux-story-av"><Avatar user={group.user} size={40} /></div>
        <div className="ux-story-who">
          <b>{group.user.displayName} {group.user.verified && <Verified size={12} />} <span>{timeAgo(moment.created_at)}</span></b>
          <small><Icon name="star" size={9} style={{ fill: 'currentColor' }} /> {moment.audience === 'close' ? 'Close friends' : moment.audience || 'Everyone'}</small>
        </div>
        {own && <button className="ux-story-btn" onClick={openViewers} aria-label="Viewers"><Icon name="eye" size={19} /></button>}
        <button className="ux-story-btn" onClick={onClose} aria-label="Close story"><Icon name="close" size={22} /></button>
      </div>

      {moment.music && (
        <div className="ux-story-music"><Icon name="music" size={14} /><span>{moment.music}</span></div>
      )}

      {(moment.caption || moment.text) && (
        <div className="ux-story-cap">
          <p>{moment.caption || moment.text}</p>
          <div className="ux-story-tr"><Icon name="translate" size={13} /><span>Translated from {langOf(group.user.language || 'en').native}</span></div>
          {moment.location && <div className="ux-story-loc"><Icon name="map" size={12} /> {moment.location}</div>}
        </div>
      )}

      <div className="ux-story-react">
        {['😂', '😮', '😍', '😢', '👏', '🔥'].map(e => <button key={e} onClick={() => react(e)}>{e}</button>)}
      </div>

      {!own ? (
        <div className="ux-story-reply">
          <div className="fld">
            <input value={reply} onChange={e => setReply(e.target.value)} placeholder={`Reply to ${group.user.displayName.split(' ')[0]}…`} onKeyDown={e => e.key === 'Enter' && sendReply()} />
          </div>
          <button className="snd" onClick={sendReply} aria-label="Send reply"><Icon name="send" size={20} /></button>
        </div>
      ) : (
        <div className="ux-story-own">
          <button onClick={openViewers}><Icon name="eye" size={15} /> Viewers</button>
          <button onClick={del}><Icon name="trash" size={15} /> Delete</button>
        </div>
      )}

      <button className="ux-story-nav l" onClick={prev} aria-label="Previous"><Icon name="back" size={20} /></button>
      <button className="ux-story-nav r" onClick={next} aria-label="Next"><Icon name="arrow" size={20} /></button>

      <Modal open={viewersOpen} onClose={() => setViewersOpen(false)} title="Moment viewers">
        {!viewerList ? <Skeleton h={80} /> : viewerList.length === 0 ? <div className="hint">No views yet.</div> : (
          <div className="viewer-list">
            {viewerList.map(v => (
              <div key={v.id} className="viewer-row"><Avatar user={v} size={34} /><div><b>{v.displayName}</b><span>{timeAgo(v.viewedAt)} ago</span></div></div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateMoment({ open, onClose, onCreated }) {
  const { notify } = useApp();
  const [tab, setTab] = useState('text');
  const [form, setForm] = useState({ text: '', caption: '', bg: BGS[0], mediaUrl: '', mediaType: '', location: '', audience: 'followers' });
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const upload = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    try {
      const d = await uploadFile(f);
      set('mediaUrl', d.url); set('mediaType', d.kind);
      setTab(d.kind === 'video' ? 'video' : 'image');
    } catch (err) { notify(err.message, 'err'); }
    finally { setBusy(false); }
  };

  const aiCaption = async () => {
    const seed = form.text || form.caption;
    if (!seed.trim()) return notify('Write a few words first, or add a photo', 'err');
    setAiBusy(true);
    try {
      const d = await API.aiTask({ kind: 'caption', text: seed });
      set('caption', d.text);
      notify(`Caption generated · ${d.engine}`);
    } catch (e) { notify(e.message, 'err'); }
    finally { setAiBusy(false); }
  };

  const post = async () => {
    if (tab === 'text' && !form.text.trim()) return notify('Write something for your moment', 'err');
    if ((tab === 'image' || tab === 'video') && !form.mediaUrl) return notify('Upload media first', 'err');
    setBusy(true);
    try {
      await API.createMoment({
        type: tab, text: tab === 'text' ? form.text : null, mediaUrl: form.mediaUrl || null,
        bg: tab === 'text' ? form.bg : null, caption: form.caption || null,
        location: form.location || null, audience: form.audience,
      });
      notify('Moment shared — live for 24 hours');
      setForm({ text: '', caption: '', bg: BGS[0], mediaUrl: '', mediaType: '', location: '', audience: 'followers' });
      onCreated();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a moment" wide>
      <div className="create-moment">
        <div className="cm-preview">
          {tab === 'text' ? (
            <div className="text-stage" style={{ background: form.bg }}>{form.text || 'Your words here'}</div>
          ) : form.mediaUrl ? (
            form.mediaType === 'video' ? <video src={form.mediaUrl} controls /> : <img src={form.mediaUrl} alt="" />
          ) : (
            <button className="cm-upload" onClick={() => fileRef.current?.click()}>
              <Icon name="image" size={28} /><b>Upload photo or video</b><span>JPG, PNG, MP4 · up to 25 MB</span>
            </button>
          )}
          {form.caption && <div className="cm-cap">{form.caption}</div>}
        </div>
        <div className="cm-form">
          <div className="seg">
            <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>Text</button>
            <button className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}>Photo</button>
            <button className={tab === 'video' ? 'active' : ''} onClick={() => setTab('video')}>Video</button>
          </div>
          <input ref={fileRef} type="file" hidden accept="image/*,video/*" onChange={upload} />

          {tab === 'text' ? (
            <label className="field"><span>Your moment</span>
              <textarea className="textarea" rows={4} maxLength={220} value={form.text} onChange={e => set('text', e.target.value)} placeholder="What's on your mind?" />
            </label>
          ) : (
            <button className="btn block" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icon name="image" size={15} /> {form.mediaUrl ? 'Replace media' : 'Choose media'}
            </button>
          )}

          {tab === 'text' && (
            <div className="bg-picker">
              {BGS.map(b => <button key={b} className={form.bg === b ? 'on' : ''} style={{ background: b }} onClick={() => set('bg', b)} />)}
            </div>
          )}

          <label className="field"><span>Caption <button className="link-btn" onClick={aiCaption} disabled={aiBusy}>{aiBusy ? '…' : 'AI suggest'}</button></span>
            <input className="input" value={form.caption} onChange={e => set('caption', e.target.value)} placeholder="Add a caption (translated per viewer)" />
          </label>
          <label className="field"><span>Location</span>
            <input className="input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Tokyo, Japan" />
          </label>
          <label className="field"><span>Audience</span>
            <select className="input" value={form.audience} onChange={e => set('audience', e.target.value)}>
              <option value="followers">Followers</option>
              <option value="contacts">Close contacts</option>
              <option value="private">Only me</option>
            </select>
          </label>
          <button className="btn primary block" onClick={post} disabled={busy}>{busy ? 'Sharing…' : 'Share moment'}</button>
          <div className="hint">Moments expire after 24 hours. Save to Highlights to keep them.</div>
        </div>
      </div>
    </Modal>
  );
}
