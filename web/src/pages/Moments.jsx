import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { API, api, uploadFile } from '../lib/api.js';
import { Icon, Avatar, Modal, Empty, Skeleton, Verified } from '../components/UI.jsx';
import { timeAgo } from '../lib/utils.js';

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
    <div className="page moments-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">AZOLVE MOMENTS · 24 HOURS</div>
          <h1>Share a moment<span className="soft">, in any language.</span></h1>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setCreateOpen(true)}><Icon name="magic" size={16} /> AI Moment Creator</button>
          <button className="btn primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} /> New moment</button>
        </div>
      </div>

      <section className="moment-hero">
        <div className="mh-left">
          <h2>Moments that speak<br /><em>every language.</em></h2>
          <p>Post a photo, a video or a thought. Captions and replies are translated per viewer — your words stay yours.</p>
          <div className="mh-stats">
            <div><b>{groups?.length || 0}</b><span>people sharing</span></div>
            <div><b>{groups?.reduce((s, g) => s + g.moments.length, 0) || 0}</b><span>live moments</span></div>
            <div><b>24h</b><span>then it's gone</span></div>
          </div>
        </div>
        <div className="mh-art" aria-hidden="true">
          <div className="mh-card c1"><span>नमस्ते</span></div>
          <div className="mh-card c2"><span>Hola</span></div>
          <div className="mh-card c3"><span>こんにちは</span></div>
        </div>
      </section>

      <div className="section-head">
        <h3>Your circle</h3>
        <button className="link-btn" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Add yours</button>
      </div>

      {!groups ? (
        <div className="moment-rail">{[1, 2, 3, 4].map(i => <Skeleton key={i} w={150} h={210} r={20} />)}</div>
      ) : groups.length === 0 ? (
        <Empty icon="eye" title="No moments right now" text="Be the first to share something with your circle."
          action={<button className="btn primary sm" onClick={() => setCreateOpen(true)}>Create a moment</button>} />
      ) : (
        <div className="moment-rail">
          <button className="moment-card add" onClick={() => setCreateOpen(true)}>
            <div className="mc-add"><Icon name="plus" size={22} /></div>
            <span className="label">Your moment</span>
          </button>
          {groups.map((g, gi) => {
            const last = g.moments[g.moments.length - 1];
            return (
              <button key={g.user.id} className={`moment-card ${g.allViewed ? 'seen' : 'unseen'}`} onClick={() => setViewer({ gi, mi: 0 })}>
                <div className="ring" />
                {last.type === 'image' || last.type === 'video' ? (
                  <img src={last.media_url} alt="" loading="lazy" />
                ) : (
                  <div className="mc-text" style={{ background: last.bg || BGS[0] }}>{last.text}</div>
                )}
                <div className="scrim" />
                <div className="mc-user"><Avatar user={g.user} size={30} /><span>{g.user.displayName.split(' ')[0]}</span></div>
                <span className="label">{timeAgo(last.created_at)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="section-head"><h3>Highlights</h3><span className="hint">Saved moments stay forever</span></div>
      <div className="highlights-row">
        {(mine?.moments || []).map(m => (
          <div key={m.id} className="highlight-card">
            {m.type === 'image' ? <img src={m.media_url} alt="" /> : <div style={{ background: m.bg || BGS[0] }}>{m.text}</div>}
            <span>{new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </div>
        ))}
        {!mine && <div className="hint">Create a moment to start your highlight collection.</div>}
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
    <div className="moment-viewer" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="moment-stage" onMouseDown={() => setPaused(p => !p)}>
        <div className="moment-bars">
          {group.moments.map((m, i) => (
            <i key={m.id} className={i < mi ? 'done' : ''}><b style={{ width: i < mi ? '100%' : i === mi ? `${progress}%` : 0 }} /></i>
          ))}
        </div>
        <div className="moment-top">
          <Avatar user={group.user} size={34} />
          <div className="mt-who"><b>{group.user.displayName} {group.user.verified && <Verified size={12} />}</b><span>{timeAgo(moment.created_at)} · {moment.audience}</span></div>
          {own && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); openViewers(); }} title="Viewers"><Icon name="eye" size={17} /></button>}
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon name="close" size={18} /></button>
        </div>

        {moment.type === 'image' && <img src={moment.media_url} alt={moment.caption || 'Moment'} />}
        {moment.type === 'video' && <video src={moment.media_url} autoPlay muted playsInline loop />}
        {moment.type === 'text' && <div className="text-stage" style={{ background: moment.bg || BGS[0] }}>{moment.text}</div>}

        {moment.caption && <div className="moment-caption">{moment.caption}</div>}
        {moment.location && <div className="moment-loc"><Icon name="map" size={12} /> {moment.location}</div>}

        <div className="moment-bottom" onMouseDown={e => e.stopPropagation()}>
          <div className="moment-reactions">
            {['❤️', '😂', '🔥', '👏', '😮'].map(e => <button key={e} onClick={() => react(e)}>{e}</button>)}
          </div>
          {!own ? (
            <div className="moment-reply">
              <input value={reply} onChange={e => setReply(e.target.value)} placeholder={`Reply to ${group.user.displayName.split(' ')[0]}…`} onKeyDown={e => e.key === 'Enter' && sendReply()} />
              <button className="send-btn sm" onClick={sendReply}><Icon name="send" size={16} /></button>
            </div>
          ) : (
            <div className="moment-own-actions">
              <button className="btn ghost sm" onClick={openViewers}><Icon name="eye" size={14} /> Viewers</button>
              <button className="btn ghost sm" onClick={del}><Icon name="trash" size={14} /> Delete</button>
            </div>
          )}
        </div>

        <button className="mv-nav left" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous"><Icon name="back" size={20} /></button>
        <button className="mv-nav right" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next"><Icon name="arrow" size={20} /></button>
      </div>

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
