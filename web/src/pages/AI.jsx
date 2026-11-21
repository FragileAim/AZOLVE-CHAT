import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Modal } from '../components/UI.jsx';
import { API } from '../lib/api.js';
import { LANGS, langOf } from '../lib/i18n.js';

/* ===========================================================================
   Azolve AI — the dark assistant screen from the UI/UX export.
   Four tools, real threads, real provider status. No canned answers.
   ========================================================================= */

const QUICK = [
  { kind: 'summarize', label: 'Summarize', icon: 'brain', tone: 'a' },
  { kind: 'translate', label: 'Translate', icon: 'translate', tone: 'b' },
  { kind: 'rewrite', label: 'Rewrite', icon: 'edit', tone: 'c' },
  { kind: 'caption', label: 'Caption', icon: 'magic', tone: 'd' },
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
  const [menu, setMenu] = useState(false);
  const endRef = useRef(null);
  const recRef = useRef(null);

  useEffect(() => {
    API.aiStatus().then(setStatus).catch(() => { });
    loadThreads();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const loadThreads = async () => {
    try { const r = await API.aiThreads(); setThreads(r.threads || []); } catch { }
  };

  const openThread = async (id) => {
    setThreadId(id); setMenu(false);
    try { const r = await API.aiThread(id); setMessages(r.messages || []); } catch { setMessages([]); }
  };

  const newThread = () => { setThreadId(null); setMessages([]); setMenu(false); };

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

  const useResult = () => {
    if (!taskResult) return;
    setInput(taskResult.text || taskResult.result || '');
    setTaskKind(null);
    notify('Added to the composer', 'ok');
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

  const engine = status?.engine || '…';

  return (
    <div className="ux-ai">
      <header className="ux-ai-head">
        <button type="button" className="ux-ai-back" onClick={() => navigate('chats')} aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <span className="ux-ai-orb"><Icon name="magic" size={20} /></span>
        <div className="ux-ai-who">
          <b>Azolve AI</b>
          <span>Private · on your chats only</span>
        </div>
        <button type="button" className="ux-ai-back" onClick={() => setMenu(true)} aria-label="Conversations">
          <Icon name="more" size={20} />
        </button>
      </header>

      <div className="ux-ai-body">
        {messages.length === 0 && (
          <div className="ux-ai-card">
            <div className="h"><Icon name="magic" size={12} /> Ready · {engine}</div>
            <p className="ux-ai-p" style={{ marginTop: 10 }}>
              Hi {user.displayName?.split(' ')[0]}. I answer in {user.language?.toUpperCase() || 'EN'} by default.
              Ask me anything, or use a tool below.
            </p>
            <div className="foot">
              <b>What I can do</b>
              <ul>
                <li>Summarise a long conversation into decisions and action items.</li>
                <li>Translate between {LANGS.length} languages, keeping the original intact.</li>
                <li>Rewrite a message so it lands the way you meant it.</li>
              </ul>
            </div>
          </div>
        )}

        {messages.map(m => (
          m.role === 'user' ? (
            <div key={m.id} className="ux-ai-me">{m.content}</div>
          ) : (
            <div key={m.id} className="ux-ai-card">
              <div className="h"><Icon name="magic" size={12} /> {m.error ? 'Error' : (m.engine || 'Azolve AI')}</div>
              <p className="ux-ai-p" style={{ marginTop: 10 }}>{m.content}</p>
              {!m.error && (
                <div className="ux-ai-tools">
                  <button type="button" className="ux-ai-use" onClick={() => { navigator.clipboard.writeText(m.content); notify('Copied', 'ok'); }}>Copy</button>
                  <button type="button" className="ux-ai-use ux-ai-ghost" onClick={() => speak(m.content)}>
                    <Icon name="volume" size={14} /> Speak
                  </button>
                </div>
              )}
            </div>
          )
        ))}

        {sending && (
          <div className="ux-ai-card">
            <div className="h"><Icon name="magic" size={12} /> Thinking</div>
            <div className="ux-ai-typing"><i /><i /><i /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="ux-ai-compose">
        <div className="ux-ai-quick">
          {QUICK.map(q => (
            <button key={q.kind} type="button" className="ux-ai-q"
              onClick={() => { setTaskKind(q.kind); setTaskText(''); setTaskResult(null); }}>
              <Icon name={q.icon} size={16} className={q.tone} />
              {q.label}
            </button>
          ))}
        </div>
        <form className="ux-ai-input" onSubmit={send}>
          <button type="button" className="ux-ai-back" style={{ width: 28, height: 28 }}
            onClick={toggleVoice} aria-label="Voice input">
            <Icon name="mic" size={18} style={{ color: listening ? '#ffb938' : 'rgba(255,255,255,.55)' }} />
          </button>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Azolve AI anything…" />
          <button type="submit" className="ux-ai-send" disabled={sending || !input.trim()} aria-label="Send">
            <Icon name="arrow" size={16} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        </form>
      </div>

      {menu && (
        <div className="more-sheet" onClick={() => setMenu(false)}>
          <div className="more-sheet-inner" onClick={e => e.stopPropagation()}>
            <div className="more-grab" />
            <b className="more-title">Conversations</b>
            <button className="more-new" onClick={newThread}><Icon name="plus" size={18} /> New chat</button>
            <div className="more-grid">
              {threads.length === 0 && <p className="muted" style={{ padding: '0 4px' }}>No conversations yet.</p>}
              {threads.map(t => (
                <button key={t.thread_id} className={`more-item ${threadId === t.thread_id ? 'active' : ''}`}
                  onClick={() => openThread(t.thread_id)}>
                  <span className="more-ic"><Icon name="chat" size={20} /></span>
                  <span>{new Date(t.last).toLocaleDateString()} · {new Date(t.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {taskKind && (
        <div className="modal-backdrop" onClick={() => setTaskKind(null)}>
          <div className="modal wide" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{QUICK.find(q => q.kind === taskKind)?.label || taskKind}</h3>
              <button className="icon-btn" onClick={() => setTaskKind(null)} aria-label="Close"><Icon name="close" size={18} /></button>
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
                  <p>{taskResult.text || taskResult.result}</p>
                  <button className="btn ghost btn-sm" onClick={() => { navigator.clipboard.writeText(taskResult.text || taskResult.result); notify('Copied', 'ok'); }}>
                    <Icon name="copy" size={14} /> Copy
                  </button>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setTaskKind(null)}>Close</button>
              {taskResult && <button className="btn ghost" onClick={useResult}>Use this</button>}
              <button className="btn primary" onClick={runTask} disabled={taskBusy}>{taskBusy ? 'Working…' : 'Run'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
