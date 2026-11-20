import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { API, uploadFile } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { Icon, Avatar, Modal, Switch, Empty, Skeleton, Verified, LangTag } from '../components/UI.jsx';
import { timeAgo, clock, dayLabel, groupByDay, isRTL, bytes } from '../lib/utils.js';
import { LANGS, langOf } from '../lib/i18n.js';
import Hear, { SpeakingBars } from '../components/Hear.jsx';
import { useSpeech, speechSupported, resolveVoice } from '../lib/speech.js';

/* ============================== list ===================================== */
export default function Chats() {
  const { route, user } = useApp();
  const activeId = route.param;
  return (
    <div className={`chats-layout ${activeId ? 'has-active' : ''}`}>
      <ChatList activeId={activeId} />
      {activeId ? <ChatView key={activeId} id={activeId} /> : (
        <div className="chat-empty">
          <div className="ce-inner">
            <div className="ce-orb"><Icon name="chat" size={30} /></div>
            <h2>Your conversations live here</h2>
            <p>Pick a chat, or start a new one. Every message arrives in the reader's own language.</p>
            <div className="ce-points">
              <span><Icon name="translate" size={14} /> Per-person translation</span>
              <span><Icon name="lock" size={14} /> Private by default</span>
              <span><Icon name="sparkles" size={14} /> AI summaries</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatList({ activeId }) {
  const { user, notify } = useApp();
  const [convs, setConvs] = useState(null);
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    try { const d = await API.chats(archived); setConvs(d.conversations); }
    catch (e) { notify(e.message, 'err'); }
  }, [archived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    const h = () => load();
    s.on('conversation:updated', h);
    s.on('message:new', h);
    return () => { s.off('conversation:updated', h); s.off('message:new', h); };
  }, [load]);

  const filtered = useMemo(() => (convs || []).filter(c =>
    !q || c.title?.toLowerCase().includes(q.toLowerCase()) ||
    c.participants.some(p => p.displayName.toLowerCase().includes(q.toLowerCase()))
  ), [convs, q]);

  return (
    <aside className="chat-list-pane">
      <div className="clp-head">
        <div className="clp-title">
          <h1>Chats</h1>
          <button className="icon-btn" onClick={() => setNewOpen(true)} aria-label="New chat"><Icon name="plus" size={19} /></button>
        </div>
        <div className="search-box">
          <Icon name="search" size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search conversations" />
        </div>
        <div className="clp-tabs">
          <button className={!archived ? 'on' : ''} onClick={() => setArchived(false)}>All</button>
          <button className={archived ? 'on' : ''} onClick={() => setArchived(true)}><Icon name="archive" size={13} /> Archived</button>
        </div>
      </div>

      <div className="clp-body">
        {!convs ? [1, 2, 3, 4, 5].map(i => (
          <div key={i} className="conv-skel"><Skeleton w={46} h={46} r={99} /><div style={{ flex: 1 }}><Skeleton w="55%" h={13} /><Skeleton w="80%" h={11} style={{ marginTop: 7 }} /></div></div>
        )) : filtered.length === 0 ? (
          <Empty icon="chat" title={archived ? 'Nothing archived' : 'No conversations'} text={q ? 'No chats match that search.' : 'Start a direct message or create a group.'} />
        ) : filtered.map(c => (
          <button key={c.id} className={`conv-item ${activeId === c.id ? 'active' : ''}`} onClick={() => navigate('chats', c.id)}>
            <div className="ci-avatar">
              <Avatar user={{ displayName: c.title, avatar: c.avatar }} size={46} showStatus online={c.other?.online} />
              {c.type === 'group' && <span className="ci-group"><Icon name="users" size={10} /></span>}
            </div>
            <div className="ci-main">
              <div className="ci-top">
                <span className="ci-name">{c.title}{c.locked && <Icon name="lock" size={11} />}</span>
                <span className="ci-time">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <div className="ci-sub">
                {c.lastMessage?.translated && <Icon name="translate" size={11} />}
                {c.lastMessage?.type && c.lastMessage.type !== 'text' && <Icon name={c.lastMessage.type === 'image' ? 'image' : c.lastMessage.type === 'voice' ? 'mic' : 'file'} size={11} />}
                <span className="ellipsis">{c.lastMessage?.displayBody || c.lastMessage?.body || 'No messages yet'}</span>
              </div>
            </div>
            <div className="ci-meta">
              {c.unread > 0 && <i className="unread-pill">{c.unread}</i>}
              <div className="ci-flags">
                {c.pinned && <Icon name="pin" size={11} />}
                {c.muted && <Icon name="mute" size={11} />}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button className="clp-new" onClick={() => setNewOpen(true)}><Icon name="plus" size={17} /> New conversation</button>
      <NewChatModal open={newOpen} onClose={() => setNewOpen(false)} />
    </aside>
  );
}

function NewChatModal({ open, onClose }) {
  const { notify } = useApp();
  const [tab, setTab] = useState('dm');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const d = q.trim() ? await API.searchUsers(q) : await API.suggestions();
        setUsers(d.users || []);
      } catch {}
    })();
  }, [q, open]);

  const startDm = async (u) => {
    setBusy(true);
    try { const d = await API.startDm(u.id); onClose(); navigate('chats', d.conversation.id); }
    catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const createGroup = async () => {
    if (!title.trim()) return notify('Give the group a name', 'err');
    if (picked.length < 1) return notify('Pick at least one person', 'err');
    setBusy(true);
    try {
      const d = await API.createGroup({ title, userIds: picked.map(p => p.id) });
      onClose(); navigate('chats', d.conversation.id);
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New conversation">
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === 'dm' ? 'active' : ''} onClick={() => setTab('dm')}>Direct message</button>
        <button className={tab === 'group' ? 'active' : ''} onClick={() => setTab('group')}>Group</button>
      </div>
      {tab === 'group' && (
        <label className="field" style={{ marginBottom: 12 }}><span>Group name</span>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Global Founders 🌍" />
        </label>
      )}
      {tab === 'group' && picked.length > 0 && (
        <div className="picked-row">
          {picked.map(p => <span key={p.id} className="chip on">{p.displayName}<button onClick={() => setPicked(x => x.filter(y => y.id !== p.id))}><Icon name="close" size={11} /></button></span>)}
        </div>
      )}
      <div className="search-box" style={{ marginBottom: 10 }}>
        <Icon name="search" size={15} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people by name or @username" />
      </div>
      <div className="user-pick-list">
        {users.length === 0 && <div className="hint" style={{ padding: 16 }}>No people found.</div>}
        {users.map(u => {
          const on = picked.some(p => p.id === u.id);
          return (
            <button key={u.id} className={`user-pick ${on ? 'on' : ''}`} onClick={() => {
              if (tab === 'dm') startDm(u);
              else setPicked(x => on ? x.filter(y => y.id !== u.id) : [...x, u]);
            }} disabled={busy}>
              <Avatar user={u} size={38} showStatus online={u.online} />
              <div className="up-main"><b>{u.displayName} {u.verified && <Verified size={12} />}</b><span>@{u.username} · {langOf(u.language).label}</span></div>
              {tab === 'group' && <span className={`pick-check ${on ? 'on' : ''}`}>{on && <Icon name="check" size={12} stroke={3} />}</span>}
              {tab === 'dm' && <Icon name="arrow" size={15} />}
            </button>
          );
        })}
      </div>
      {tab === 'group' && (
        <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy} onClick={createGroup}>
          {busy ? 'Creating…' : `Create group${picked.length ? ` · ${picked.length + 1} members` : ''}`}
        </button>
      )}
    </Modal>
  );
}

/* ============================== conversation ============================= */
const QUICK_EMOJI = ['❤️', '😂', '👍', '🔥', '🙏', '😮'];

function ChatView({ id }) {
  const { user, notify } = useApp();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [origOpen, setOrigOpen] = useState({});
  const [typing, setTyping] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const typingTimer = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const me = user;

  const scrollBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, m] = await Promise.all([API.conversation(id), API.messages(id)]);
      setConv(c.conversation);
      setMessages(m.messages);
      setHasMore(m.hasMore);
      requestAnimationFrame(() => scrollBottom());
      API.markRead(id).catch(() => {});
    } catch (e) { notify(e.message, 'err'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const s = getSocket(); if (!s) return;
    s.emit('join', { conversationId: id });
    const onNew = (m) => {
      if (m.conversationId !== id) return;
      setMessages(prev => {
        if (prev.some(x => x.id === m.id)) return prev;
        const withoutClient = prev.filter(x => !(x.clientId && x.clientId === m.clientId));
        return [...withoutClient, {
          ...m, displayBody: m.displayBody ?? m.body, originalBody: m.original_body ?? m.body,
          originalLang: m.original_lang, reactions: {}, reads: [], replyTo: null,
        }];
      });
      if (m.senderId !== me.id) { API.markRead(id).catch(() => {}); s.emit('read', { conversationId: id }); }
      requestAnimationFrame(() => scrollBottom(true));
    };
    const onUpd = ({ message, conversationId }) => {
      if (conversationId !== id) return;
      setMessages(prev => prev.map(x => x.id === message.id ? { ...x, body: message.body, originalBody: message.original_body, editedAt: message.edited_at } : x));
    };
    const onDel = ({ messageId, conversationId }) => {
      if (conversationId !== id) return;
      setMessages(prev => prev.map(x => x.id === messageId ? { ...x, deleted: true, body: '', displayBody: '', mediaUrl: null } : x));
    };
    const onReact = ({ messageId, reactions }) => {
      setMessages(prev => prev.map(x => x.id === messageId ? { ...x, reactions } : x));
    };
    const onTyping = ({ conversationId, userId, typing: t }) => {
      if (conversationId !== id || userId === me.id) return;
      setTyping(prev => t ? [...new Set([...prev, userId])] : prev.filter(x => x !== userId));
    };
    const onRead = ({ conversationId, userId, at }) => {
      if (conversationId !== id) return;
      setMessages(prev => prev.map(x => x.senderId === me.id ? { ...x, reads: [...(x.reads || []).filter(r => r.user_id !== userId), { user_id: userId, state: 'read', at }] } : x));
    };
    s.on('message:new', onNew); s.on('message:updated', onUpd); s.on('message:deleted', onDel);
    s.on('message:reaction', onReact); s.on('typing', onTyping); s.on('read', onRead);
    return () => {
      s.off('message:new', onNew); s.off('message:updated', onUpd); s.off('message:deleted', onDel);
      s.off('message:reaction', onReact); s.off('typing', onTyping); s.off('read', onRead);
    };
  }, [id, me.id]);

  const emitTyping = () => {
    const s = getSocket(); if (!s) return;
    s.emit('typing', { conversationId: id, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => s.emit('typing', { conversationId: id, typing: false }), 1600);
  };

  const send = async (payload = {}) => {
    const body = (payload.body ?? text).trim();
    if (!body && !payload.mediaUrl) return;
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
      id: clientId, clientId, conversationId: id, senderId: me.id, body, displayBody: body,
      originalBody: body, originalLang: 'auto', type: payload.type || 'text', mediaUrl: payload.mediaUrl,
      mediaMeta: payload.mediaMeta, replyTo, createdAt: Date.now(), reactions: {}, reads: [], pending: true,
      location: payload.location, contact: payload.contact, silent: payload.silent,
    };
    setMessages(prev => [...prev, optimistic]);
    setText(''); setReplyTo(null); setEmojiOpen(false);
    requestAnimationFrame(() => scrollBottom(true));
    try {
      const d = await API.send(id, { ...payload, body, clientId, replyTo: replyTo?.id });
      setMessages(prev => prev.map(x => x.clientId === clientId ? { ...x, id: d.message.id, pending: false } : x));
    } catch (e) {
      setMessages(prev => prev.map(x => x.clientId === clientId ? { ...x, failed: true, pending: false } : x));
      notify(e.message, 'err');
    }
  };

  const pickFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setSending(true);
    try {
      const up = await uploadFile(file);
      const type = up.kind === 'image' ? 'image' : up.kind === 'video' ? 'video' : up.kind === 'audio' ? 'voice' : 'file';
      await send({ mediaUrl: up.url, type, mediaMeta: { name: up.name, size: up.size, mime: up.mime } });
    } catch (err) { notify(err.message, 'err'); }
    finally { setSending(false); e.target.value = ''; }
  };

  const toggleRecord = async () => {
    if (recording) { recorderRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 800) return;
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        setSending(true);
        try {
          const up = await uploadFile(file);
          await send({ mediaUrl: up.url, type: 'voice', mediaMeta: { duration: 0, size: up.size } });
        } catch (err) { notify(err.message, 'err'); }
        finally { setSending(false); }
      };
      rec.start(); recorderRef.current = rec; setRecording(true);
    } catch { notify('Microphone permission is required for voice notes', 'err'); }
  };

  const applyAi = async (kind, tone) => {
    if (!text.trim()) return notify('Type a draft first', 'err');
    try {
      const d = await API.aiTask({ kind, text, tone, targetLang: me.language });
      setText(d.text);
      notify(`AI ${kind} applied · ${d.engine}`);
    } catch (e) { notify(e.message, 'err'); }
  };

  const react = async (mid, emoji) => {
    try { await API.react(id, mid, emoji); }
    catch (e) { notify(e.message, 'err'); }
  };

  const saveEdit = async () => {
    try {
      await API.editMessage(id, editing.id, text);
      setMessages(prev => prev.map(x => x.id === editing.id ? { ...x, body: text, displayBody: text, editedAt: Date.now() } : x));
      setEditing(null); setText('');
    } catch (e) { notify(e.message, 'err'); }
  };

  const del = async (mid) => {
    if (!confirm('Delete this message for everyone?')) return;
    try { await API.deleteMessage(id, mid); setMessages(prev => prev.map(x => x.id === mid ? { ...x, deleted: true, body: '', displayBody: '' } : x)); }
    catch (e) { notify(e.message, 'err'); }
  };

  const loadOlder = async () => {
    if (!messages.length) return;
    try {
      const d = await API.messages(id, messages[0].createdAt);
      setMessages(prev => [...d.messages, ...prev]);
      setHasMore(d.hasMore);
    } catch (e) { notify(e.message, 'err'); }
  };

  const groups = useMemo(() => groupByDay(messages), [messages]);
  const others = conv?.participants.filter(p => p.id !== me.id) || [];
  const title = conv?.title || 'Conversation';
  const subtitle = conv?.type === 'dm'
    ? (conv.other?.online ? 'Online now' : conv.other?.lastSeen ? `Last seen ${timeAgo(conv.other.lastSeen)}` : 'Offline')
    : `${conv?.participants.length || 0} members`;

  return (
    <section className="chat-pane">
      <header className="chat-head">
        <button className="icon-btn chat-back" onClick={() => navigate('chats')} aria-label="Back"><Icon name="back" size={19} /></button>
        <Avatar user={{ displayName: title, avatar: conv?.avatar }} size={40} showStatus online={conv?.other?.online} />
        <div className="who">
          <div className="n">{title} {conv?.type === 'dm' && conv.other && <Verified size={13} />}</div>
          <div className="s">
            {typing.length > 0 ? <span className="typing-inline">typing…</span> : subtitle}
            {conv?.languageOverride && <> · <span className="lo-badge">reads in {langOf(conv.languageOverride).label}</span></>}
          </div>
        </div>
        <div className="chat-head-actions">
          <button className="icon-btn" title="Search in chat" onClick={() => setSearchOpen(true)}><Icon name="search" size={18} /></button>
          <button className="icon-btn" title="Voice call" onClick={() => navigate('calls')}><Icon name="phone" size={18} /></button>
          <button className="icon-btn" title="Video call" onClick={() => navigate('calls')}><Icon name="video" size={18} /></button>
          <button className="icon-btn" title="Chat settings" onClick={() => setSettingsOpen(true)}><Icon name="more" size={19} /></button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {loading ? <div className="chat-loading"><Skeleton h={40} w="60%" /><Skeleton h={40} w="45%" style={{ marginLeft: 'auto' }} /><Skeleton h={40} w="55%" /></div> : (
          <>
            {hasMore && <button className="btn ghost sm load-older" onClick={loadOlder}>Load earlier messages</button>}
            {messages.length === 0 && (
              <div className="chat-start">
                <Avatar user={{ displayName: title, avatar: conv?.avatar }} size={64} />
                <h3>{title}</h3>
                <p>This is the beginning of your conversation. Say hello — it will arrive in their language.</p>
              </div>
            )}
            {groups.map(g => (
              <React.Fragment key={g.day}>
                <div className="chat-day">{g.label}</div>
                {g.items.map((m, i) => {
                  const prev = g.items[i - 1];
                  const mine = m.senderId === me.id;
                  const sender = conv?.participants.find(p => p.id === m.senderId);
                  const showName = conv?.type === 'group' && !mine && (!prev || prev.senderId !== m.senderId);
                  return (
                    <MessageBubble key={m.id} m={m} mine={mine} sender={sender} showName={showName}
                      isGroup={conv?.type === 'group'} me={me} participants={conv?.participants || []}
                      origOpen={!!origOpen[m.id]} onToggleOrig={() => setOrigOpen(o => ({ ...o, [m.id]: !o[m.id] }))}
                      onReact={react} onReply={() => { setReplyTo(m); setEditing(null); }}
                      onEdit={() => { setEditing(m); setText(m.body); }} onDelete={() => del(m.id)}
                      onCopy={() => { navigator.clipboard?.writeText(m.originalBody || m.body); notify('Copied'); }}
                      onPin={async () => { try { await API.patchChat(id, {}); } catch {} }}
                      onUnavailable={(msg) => notify(msg, 'err')}
                    />
                  );
                })}
              </React.Fragment>
            ))}
            {typing.length > 0 && (
              <div className="typing"><span className="dots"><span /><span /><span /></span> {typing.map(t => conv?.participants.find(p => p.id === t)?.displayName?.split(' ')[0]).filter(Boolean).join(', ')} typing…</div>
            )}
          </>
        )}
      </div>

      <div className="chat-composer">
        {replyTo && (
          <div className="reply-banner">
            <Icon name="reply" size={14} />
            <div><b>Replying to {replyTo.senderId === me.id ? 'yourself' : conv?.participants.find(p => p.id === replyTo.senderId)?.displayName}</b><span className="ellipsis">{replyTo.body}</span></div>
            <button className="icon-btn sm" onClick={() => setReplyTo(null)}><Icon name="close" size={14} /></button>
          </div>
        )}
        {editing && (
          <div className="reply-banner edit">
            <Icon name="edit" size={14} />
            <div><b>Editing message</b><span className="ellipsis">{editing.body}</span></div>
            <button className="icon-btn sm" onClick={() => { setEditing(null); setText(''); }}><Icon name="close" size={14} /></button>
          </div>
        )}
        {aiOpen && (
          <div className="ai-compose-panel">
            <div className="acp-head"><Icon name="sparkles" size={15} /> AI writing tools <span className="hint">works on your draft</span></div>
            <div className="acp-row">
              <button onClick={() => applyAi('improve')}>Improve</button>
              <button onClick={() => applyAi('rewrite', 'professional')}>Professional</button>
              <button onClick={() => applyAi('rewrite', 'friendly')}>Friendly</button>
              <button onClick={() => applyAi('rewrite', 'concise')}>Shorter</button>
              <button onClick={() => applyAi('translate', null)}>To {langOf(me.language).label}</button>
            </div>
          </div>
        )}
        {emojiOpen && (
          <div className="emoji-pop">
            {['😀', '😂', '🥹', '😍', '😎', '🤔', '😴', '👍', '🙏', '👏', '🔥', '❤️', '💜', '✨', '🎉', '☕', '🌍', '🚀', '✅', '🙌', '😅', '😮', '😢', '🤝'].map(e => (
              <button key={e} onClick={() => setText(t => t + e)}>{e}</button>
            ))}
          </div>
        )}
        <div className="composer-box">
          <div className="composer-tools">
            <button className="icon-btn sm" title="Attach" onClick={() => fileRef.current?.click()} disabled={sending}><Icon name="plus" size={19} /></button>
            <input ref={fileRef} type="file" hidden onChange={pickFile} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt" />
            <button className="icon-btn sm" title="Emoji" onClick={() => setEmojiOpen(o => !o)}><Icon name="smile" size={18} /></button>
            <button className="icon-btn sm" title="AI tools" onClick={() => setAiOpen(o => !o)}><Icon name="sparkles" size={18} /></button>
          </div>
          <textarea
            value={text}
            rows={1}
            placeholder={editing ? 'Edit your message…' : `Message in ${langOf(me.language).label} — translated for each person`}
            dir={isRTL(me.language) ? 'rtl' : 'ltr'}
            onChange={e => { setText(e.target.value); emitTyping(); }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editing) saveEdit(); else send();
              }
            }}
          />
          <div className="composer-tools right">
            <button className={`icon-btn sm ${recording ? 'rec' : ''}`} title={recording ? 'Stop recording' : 'Voice note'} onClick={toggleRecord}>
              <Icon name={recording ? 'pause' : 'mic'} size={18} />
            </button>
            <button className="send-btn" disabled={!text.trim() && !editing} onClick={() => editing ? saveEdit() : send()} aria-label="Send">
              <Icon name={editing ? 'check' : 'send'} size={18} />
            </button>
          </div>
        </div>
        <div className="composer-foot">
          <span><Icon name="translate" size={11} /> Original text is never changed</span>
          <span>Enter to send · Shift+Enter for a new line</span>
        </div>
      </div>

      <ChatSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} conv={conv} onSaved={load} />
      <ChatSearch open={searchOpen} onClose={() => setSearchOpen(false)} convId={id} onJump={(mid) => {
        const el = document.getElementById(`m-${mid}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }} />
    </section>
  );
}

function MessageBubble({ m, mine, sender, showName, isGroup, me, participants, origOpen, onToggleOrig, onReact, onReply, onEdit, onDelete, onCopy, onPin, onUnavailable }) {
  const [actions, setActions] = useState(false);
  const sp = useSpeech();
  const hearId = `msg-${m.id}`;
  const speaking = sp.isPlaying(hearId);
  const hearLang = m.displayLang || me.language || 'en';
  /* Speak the translation. If the device has no engine or no voices, say so in
     the UI instead of leaving a tap that silently does nothing. */
  const hear = () => {
    if (!speechSupported()) {
      onUnavailable?.('This browser has no speech engine. Try Chrome, Edge, Safari or Firefox.');
      return;
    }
    if (resolveVoice(hearLang).quality === 'none') {
      onUnavailable?.(`No speech voices are installed on this device, so ${langOf(hearLang).native} cannot be spoken here.`);
      return;
    }
    sp.toggle({ text: m.displayBody, lang: hearLang, id: hearId });
  };
  const translated = m.translated && m.displayBody && m.displayBody !== (m.originalBody || m.body);
  const readCount = (m.reads || []).filter(r => r.user_id !== me.id).length;
  const totalOthers = Math.max(1, participants.length - 1);
  const allRead = readCount >= totalOthers;

  if (m.deleted) {
    return <div className={`msg-row ${mine ? 'mine' : ''}`}><div className="bubble deleted"><Icon name="trash" size={13} /> This message was deleted</div></div>;
  }

  return (
    <div id={`m-${m.id}`} className={`msg-row ${mine ? 'mine' : ''} ${showName ? 'first' : ''}`}>
      {!mine && <Avatar user={sender || { displayName: '?' }} size={28} />}
      <div className="bubble-wrap">
        <div className="msg-hover">
          <div className="msg-actions">
            {QUICK_EMOJI.slice(0, 4).map(e => <button key={e} onClick={() => onReact(m.id, e)}>{e}</button>)}
            <button onClick={onReply} title="Reply"><Icon name="reply" size={14} /></button>
            <button onClick={() => setActions(true)} title="More"><Icon name="more" size={14} /></button>
          </div>
        </div>
        <div className={`bubble ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}`} dir={isRTL(m.displayLang || m.originalLang) ? 'rtl' : 'ltr'}>
          {showName && <div className="sender">{sender?.displayName || 'Member'}</div>}
          {m.replyTo && (
            <div className="reply-quote">
              <b>{m.replyTo.sender_id === me.id ? 'You' : participants.find(p => p.id === m.replyTo.sender_id)?.displayName || 'Member'}</b>
              <span className="ellipsis">{m.replyTo.body || 'Attachment'}</span>
            </div>
          )}

          {m.type === 'image' && m.mediaUrl && <div className="bubble-media"><img src={m.mediaUrl} alt={m.mediaMeta?.name || 'Shared image'} loading="lazy" /></div>}
          {m.type === 'video' && m.mediaUrl && <div className="bubble-media"><video src={m.mediaUrl} controls /></div>}
          {m.type === 'voice' && m.mediaUrl && <div className="voice-note"><Icon name="mic" size={15} /><audio src={m.mediaUrl} controls /></div>}
          {m.type === 'file' && m.mediaUrl && (
            <a className="file-card" href={m.mediaUrl} target="_blank" rel="noreferrer" download>
              <Icon name="file" size={20} />
              <div><b>{m.mediaMeta?.name || 'Attachment'}</b><span>{bytes(m.mediaMeta?.size || 0)}</span></div>
              <Icon name="download" size={16} />
            </a>
          )}
          {m.location && (
            <a className="loc-card" href={`https://maps.google.com/?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noreferrer">
              <Icon name="map" size={18} /><div><b>{m.location.name || 'Shared location'}</b><span>{m.location.lat?.toFixed(4)}, {m.location.lng?.toFixed(4)}</span></div>
            </a>
          )}
          {m.contact && (
            <div className="contact-card"><Icon name="user" size={18} /><div><b>{m.contact.name}</b><span>{m.contact.phone || m.contact.username}</span></div></div>
          )}

          {m.displayBody && (
            <div
              className={`bubble-text ${translated ? 'tappable' : ''} ${speaking ? 'speaking' : ''}`}
              onClick={translated ? (e) => {
                // never hijack a text selection — people still copy messages
                if (window.getSelection?.()?.toString()) return;
                e.stopPropagation();
                hear();
              } : undefined}
              role={translated ? 'button' : undefined}
              tabIndex={translated ? 0 : undefined}
              onKeyDown={translated ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  hear();
                }
              } : undefined}
              title={translated ? 'Tap to hear this in your language' : undefined}
            >
              {m.displayBody}
              {translated && (
                <span className="hear-affordance" aria-hidden>
                  {speaking ? <SpeakingBars small /> : <Icon name="volume" size={13} />}
                </span>
              )}
            </div>
          )}

          {translated && (
            <div className="translated-row">
              <button className="translated-note" onClick={onToggleOrig}>
                <Icon name="translate" size={11} />
                Translated from {langOf(m.originalLang).label}
                <span>{origOpen ? 'Hide original' : 'See original'}</span>
              </button>
              <Hear
                variant="inline"
                text={m.displayBody}
                lang={m.displayLang || me.language || 'en'}
                id={`${hearId}-btn`}
                label={`Hear in ${langOf(m.displayLang || me.language || 'en').native}`}
                onUnavailable={onUnavailable}
              />
            </div>
          )}
          {origOpen && translated && (
            <div className="orig" dir={isRTL(m.originalLang) ? 'rtl' : 'ltr'}>
              {m.originalBody}
              <Hear
                variant="inline"
                text={m.originalBody}
                lang={m.originalLang}
                id={`${hearId}-orig`}
                label={`Hear original · ${langOf(m.originalLang).native}`}
                onUnavailable={onUnavailable}
                className="orig-hear"
              />
            </div>
          )}

          {Object.keys(m.reactions || {}).length > 0 && (
            <div className="reactions">
              {Object.entries(m.reactions).map(([emoji, users]) => (
                <button key={emoji} className={`reaction-pill ${users.includes(me.id) ? 'mine' : ''}`} onClick={() => onReact(m.id, emoji)}>
                  {emoji} {users.length}
                </button>
              ))}
            </div>
          )}

          <div className="foot">
            {m.silent && <Icon name="mute" size={10} />}
            {m.editedAt && <span>edited</span>}
            <span>{clock(m.createdAt)}</span>
            {mine && <span className={allRead ? 'read-all' : ''}><Icon name={allRead ? 'checkcheck' : m.pending ? 'clock' : 'check'} size={12} /></span>}
            {m.failed && <span className="failed-tag">Not sent</span>}
          </div>
        </div>
      </div>

      <Modal open={actions} onClose={() => setActions(false)} title="Message actions">
        <div className="action-list">
          <button onClick={() => { onReply(); setActions(false); }}><Icon name="reply" size={17} /> Reply</button>
          <button onClick={() => { onCopy(); setActions(false); }}><Icon name="copy" size={17} /> Copy original</button>
          <button onClick={() => { onReact(m.id, '⭐'); setActions(false); }}><Icon name="star" size={17} /> Star message</button>
          <button onClick={() => { onPin(); setActions(false); }}><Icon name="pin" size={17} /> Pin in chat</button>
          {mine && <button onClick={() => { onEdit(); setActions(false); }}><Icon name="edit" size={17} /> Edit</button>}
          {mine && <button className="danger" onClick={() => { onDelete(); setActions(false); }}><Icon name="trash" size={17} /> Delete for everyone</button>}
        </div>
      </Modal>
    </div>
  );
}

/* ============================== settings ================================= */
function ChatSettings({ open, onClose, conv, onSaved }) {
  const { notify } = useApp();
  const [form, setForm] = useState({});
  useEffect(() => { if (conv) setForm({ muted: conv.muted, archived: conv.archived, pinned: conv.pinned, locked: conv.locked, disappearSeconds: conv.disappearSeconds, wallpaper: conv.wallpaper || '', languageOverride: conv.languageOverride || '' }); }, [conv, open]);

  const patch = async (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    try { await API.patchChat(conv.id, { [k]: v }); onSaved?.(); }
    catch (e) { notify(e.message, 'err'); }
  };

  if (!conv) return null;
  return (
    <Modal open={open} onClose={onClose} title="Chat settings">
      <div className="chat-settings">
        <div className="cs-identity">
          <Avatar user={{ displayName: conv.title, avatar: conv.avatar }} size={54} />
          <div><b>{conv.title}</b><span>{conv.type === 'group' ? `${conv.participants.length} members` : `@${conv.other?.username}`}</span></div>
        </div>
        <div className="setting-row"><div><div className="t">Mute notifications</div><div className="d">Stay in the chat without alerts.</div></div><Switch on={!!form.muted} onChange={v => patch('muted', v)} /></div>
        <div className="setting-row"><div><div className="t">Pin to top</div><div className="d">Keep this conversation above the rest.</div></div><Switch on={!!form.pinned} onChange={v => patch('pinned', v)} /></div>
        <div className="setting-row"><div><div className="t">Archive</div><div className="d">Hide from the main list.</div></div><Switch on={!!form.archived} onChange={v => patch('archived', v)} /></div>
        <div className="setting-row"><div><div className="t">Lock chat</div><div className="d">Prevents sending until unlocked.</div></div><Switch on={!!form.locked} onChange={v => patch('locked', v)} /></div>
        <label className="field" style={{ marginTop: 14 }}><span>Disappearing messages</span>
          <select className="input" value={form.disappearSeconds || 0} onChange={e => patch('disappearSeconds', Number(e.target.value))}>
            <option value={0}>Off</option>
            <option value={3600}>1 hour</option>
            <option value={86400}>24 hours</option>
            <option value={604800}>7 days</option>
          </select>
        </label>
        <label className="field" style={{ marginTop: 12 }}><span>Read this chat in</span>
          <select className="input" value={form.languageOverride || ''} onChange={e => patch('languageOverride', e.target.value || null)}>
            <option value="">Use my account language ({langOf(conv.participants.find(p => p.id === conv.participants[0]?.id)?.language || 'en').label})</option>
            {LANGS.map(l => <option key={l.code} value={l.code}>{l.label} — {l.native}</option>)}
          </select>
          <span className="hint">Overrides your display language for this conversation only.</span>
        </label>
        <label className="field" style={{ marginTop: 12 }}><span>Wallpaper</span>
          <div className="wallpaper-row">
            {['', 'linear-gradient(135deg,#1a1a2e,#16213e)', 'linear-gradient(135deg,#0f2027,#2c5364)', 'linear-gradient(135deg,#3a1c71,#d76d77)', 'linear-gradient(135deg,#134e5e,#71b280)'].map(w => (
              <button key={w || 'none'} className={`wp-swatch ${form.wallpaper === w ? 'on' : ''}`} style={{ background: w || 'var(--surface-2)' }} onClick={() => patch('wallpaper', w)} title={w ? 'Gradient' : 'None'} />
            ))}
          </div>
        </label>
        {conv.type === 'group' && (
          <div className="members-block">
            <div className="mb-head">Members <span>{conv.participants.length}</span></div>
            {conv.participants.map(p => (
              <div key={p.id} className="member-row">
                <Avatar user={p} size={34} showStatus online={p.online} />
                <div><b>{p.displayName}</b><span>@{p.username} · {langOf(p.language).native}</span></div>
                <span className="role-chip">{p.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ChatSearch({ open, onClose, convId, onJump }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (!open || !q.trim()) return;
    (async () => {
      try {
        const res = await fetch(`/api/chats/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('azolve.token')}` } });
        const d = await res.json();
        setResults((d.messages || []).filter(m => m.conversation_id === convId));
      } catch {}
    })();
  }, [q, open, convId]);

  return (
    <Modal open={open} onClose={onClose} title="Search this conversation">
      <div className="search-box"><Icon name="search" size={15} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages…" /></div>
      <div className="search-results">
        {results.map(m => (
          <button key={m.id} className="search-result" onClick={() => { onJump(m.id); onClose(); }}>
            <div className="sr-top"><b>{new Date(m.created_at).toLocaleDateString()}</b><span>{clock(m.created_at)}</span></div>
            <p>{m.body}</p>
          </button>
        ))}
        {q && results.length === 0 && <div className="hint" style={{ padding: 16 }}>No messages match “{q}”.</div>}
      </div>
    </Modal>
  );
}
