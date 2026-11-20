import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { Icon, Avatar, Empty, Skeleton } from '../components/UI.jsx';
import { API } from '../lib/api.js';
import { LANGS, langOf } from '../lib/i18n.js';

const QUICK = [
  { kind: 'summarize', label: 'Summarise a thread', icon: 'brain', hint: 'Paste a conversation and get the key points.' },
  { kind: 'rewrite', label: 'Rewrite a message', icon: 'edit', hint: 'Make it clearer, warmer or more concise.' },
  { kind: 'translate', label: 'Translate text', icon: 'translate', hint: 'Any language to any language.' },
  { kind: 'caption', label: 'Write a caption', icon: 'magic', hint: 'For a post or a moment.' },
  { kind: 'hashtags', label: 'Suggest hashtags', icon: 'hashtag', hint: 'Reach the right audience.' },
  { kind: 'explain', label: 'Explain something', icon: 'info', hint: 'Plain-language answers.' },
  { kind: 'ideas', label: 'Brainstorm ideas', icon: 'zap', hint: 'Content, product, campaigns.' },
  { kind: 'replies', label: 'Draft replies', icon: 'reply', hint: 'Three ways to respond.' },
];

export default function AI() {
  const { user, notify } = useApp();
  const [status, setStatus] = useState(null);
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [taskKind, setTaskKind] = useState(null);
  const [taskText, setTaskText] = useState('');
  const [taskLang, setTaskLang] = useState(user.language || 'en');
  const [taskResult, setTaskResult] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef(null);
  const recRef = useRef(null);

  useEffect(() => {
    API.aiStatus().then(setStatus).catch(() => {});
    loadThreads();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const loadThreads = async () => {
    try { const r = await API.aiThreads(); setThreads(r.threads || []); } catch {}
  };

  const openThread = async (id) => {
    setThreadId(id);
    try { const r = await API.aiThread(id); setMessages(r.messages || []); } catch { setMessages([]); }
  };

  const newThread = () => { setThreadId(null); setMessages([]); };

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setMessages(m => [...m, { id: `local_${Date.now()}`, role: 'user', content: text, created_at: Date.now() }]);
    setSending(true);
    try {
      const r = await API.aiChat({ message: text, threadId: threadId || undefined, lang: user.language });
      setThreadId(r.threadId);
      setMessages(m => [...m, { id: `a_${Date.now()}`, role: 'assistant', content: r.reply, created_at: Date.now(), engine: r.engine }]);
      loadThreads();
    } catch (err) {
      notify(err.message, 'err');
      setMessages(m => [...m, { id: `e_${Date.now()}`, role: 'assistant', content: `I couldn't respond: ${err.message}`, created_at: Date.now(), error: true }]);
    } finally { setSending(false); }
  };

  const runTask = async () => {
    if (!taskText.trim()) { notify('Add some text first', 'err'); return; }
    setTaskBusy(true); setTaskResult(null);
    try {
      const r = await API.aiTask({ kind: taskKind, text: taskText, lang: user.language, targetLang: taskLang });
      setTaskResult(r);
    } catch (e) { notify(e.message, 'err'); }
    finally { setTaskBusy(false); }
  };

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { notify('Voice input is not supported in this browser', 'err'); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = langOf(user.language)?.native ? user.language : 'en';
    rec.interimResults = true;
    rec.onresult = (ev) => {
      const t = Array.from(ev.results).map(r => r[0].transcript).join(' ');
      setInput(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const speak = (text) => {
    if (!window.speechSynthesis) { notify('Speech output not supported', 'err'); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = user.language || 'en';
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="page page-wide ai-page">
      <div className="page-head">
        <div>
          <h1><span className="grad-text">AZOLVE AI</span></h1>
          <p className="muted">Your multilingual copilot for messages, posts and ideas.</p>
        </div>
        <div className="engine-chip" title="The model actually answering right now">
          <Icon name="zap" size={14} /> engine: <b>{status?.engine || '…'}</b>
        </div>
      </div>

      <div className="ai-layout">
        <aside className="ai-threads card">
          <button className="btn primary btn-block" onClick={newThread}><Icon name="plus" size={16} /> New chat</button>
          <div className="thread-list">
            {threads.length === 0 && <p className="muted small">No conversations yet.</p>}
            {threads.map(t => (
              <button key={t.thread_id} className={`thread-row ${threadId === t.thread_id ? 'active' : ''}`} onClick={() => openThread(t.thread_id)}>
                <Icon name="chat" size={15} />
                <span>{new Date(t.last).toLocaleDateString()} · {new Date(t.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="ai-main">
          <div className="ai-chat card">
            <div className="ai-chat-scroll">
              {messages.length === 0 && (
                <div className="ai-hello">
                  <div className="ai-orb"><Icon name="sparkles" size={30} /></div>
                  <h2>How can I help, {user.displayName?.split(' ')[0]}?</h2>
                  <p className="muted">Ask anything, or pick a tool below. I answer in {user.language?.toUpperCase() || 'EN'} by default.</p>
                  <div className="quick-grid">
                    {QUICK.map(q => (
                      <button key={q.kind} className="quick-card" onClick={() => { setTaskKind(q.kind); setTaskText(''); setTaskResult(null); }}>
                        <Icon name={q.icon} size={18} />
                        <b>{q.label}</b>
                        <small>{q.hint}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map(m => (
                <div key={m.id} className={`ai-msg ${m.role} ${m.error ? 'error' : ''}`}>
                  {m.role === 'assistant' && <span className="ai-avatar"><Icon name="sparkles" size={15} /></span>}
                  <div className="bubble">
                    <p>{m.content}</p>
                    {m.role === 'assistant' && (
                      <div className="ai-msg-tools">
                        <button onClick={() => { navigator.clipboard.writeText(m.content); notify('Copied', 'ok'); }}><Icon name="copy" size={13} /> Copy</button>
                        <button onClick={() => speak(m.content)}><Icon name="volume" size={13} /> Speak</button>
                      </div>
                    )}
                  </div>
                  {m.role === 'user' && <Avatar user={user} size={30} />}
                </div>
              ))}
              {sending && <div className="ai-msg assistant"><span className="ai-avatar"><Icon name="sparkles" size={15} /></span><div className="bubble typing"><i /><i /><i /></div></div>}
              <div ref={endRef} />
            </div>

            <form className="ai-input" onSubmit={send}>
              <button type="button" className={`icon-btn ${listening ? 'rec' : ''}`} onClick={toggleVoice} title="Voice input"><Icon name="mic" size={19} /></button>
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Message AZOLVE AI…" />
              <button className="btn primary" disabled={sending || !input.trim()}><Icon name="send" size={17} /></button>
            </form>
          </div>
        </section>

        <aside className="ai-side card">
          <h3><Icon name="brain" size={16} /> Toolbox</h3>
          <div className="tool-list">
            {QUICK.map(q => (
              <button key={q.kind} className={`tool-row ${taskKind === q.kind ? 'active' : ''}`} onClick={() => { setTaskKind(q.kind); setTaskResult(null); }}>
                <Icon name={q.icon} size={15} /> {q.label}
              </button>
            ))}
          </div>
          <div className="ai-provider-note">
            <p className="muted small">Translation providers — highlighted means configured &amp; active:</p>
            <div className="prov-chips">
              {(status?.translationProviders || []).map(p => (
                <span key={p.name} className={`prov ${p.available ? 'on' : ''}`}>{p.name}</span>
              ))}
            </div>
            <p className="muted small">Add API keys in <code>.env</code> to unlock DeepL, Google, OpenAI, Anthropic, Gemini or Groq. Without keys the assistant uses a deterministic local engine and MyMemory translation.</p>
          </div>
        </aside>
      </div>

      {taskKind && (
        <div className="modal-backdrop" onClick={() => setTaskKind(null)}>
          <div className="modal wide" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{QUICK.find(q => q.kind === taskKind)?.label}</h3>
              <button className="icon-btn" onClick={() => setTaskKind(null)}><Icon name="close" size={18} /></button>
            </div>
            <div className="modal-body">
              <textarea rows={6} value={taskText} onChange={e => setTaskText(e.target.value)}
                placeholder="Paste text or describe what you need…" />
              {taskKind === 'translate' && (
                <label className="field">
                  <span>Translate into</span>
                  <select value={taskLang} onChange={e => setTaskLang(e.target.value)}>
                    {LANGS.map(l => <option key={l.code} value={l.code}>{l.label} — {l.native}</option>)}
                  </select>
                </label>
              )}
              {taskResult && (
                <div className="task-result">
                  <div className="row-between"><b>Result</b><span className="engine-chip small">{taskResult.engine}</span></div>
                  <p>{taskResult.text}</p>
                  <button className="btn ghost btn-sm" onClick={() => { navigator.clipboard.writeText(taskResult.text); notify('Copied', 'ok'); }}><Icon name="copy" size={14} /> Copy</button>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setTaskKind(null)}>Close</button>
              <button className="btn primary" onClick={runTask} disabled={taskBusy}>{taskBusy ? 'Working…' : 'Run'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
