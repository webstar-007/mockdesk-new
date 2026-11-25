import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const L = 'ABCD';
const ago = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} days ago`; };
const TABS = [['open', 'Waiting'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']];

function Item({ d, base, onDone }) {
  const [text, setText] = useState(d.answer || ''); const [share, setShare] = useState(d.shared); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [edit, setEdit] = useState(d.status === 'open');
  async function go(path, body) { setBusy(true); setErr(''); try { await api.post(`${base}/desk/${d.id}/${path}`, body); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <li className={`dk-item s-${d.status}`}>
      <header><b>{d.student}</b><span className="muted small">{d.mock} · {ago(d.createdAt)}</span><span className={`dk-st s-${d.status}`}>{d.status === 'open' ? 'Waiting' : d.status === 'answered' ? 'Answered' : 'Closed'}</span></header>
      {d.q && (
        <div className="dk-q">
          <p><span className="muted small">{d.q.section} · Q{d.q.index}</span> {d.q.text}</p>
          <ol className="dk-opts">{d.q.options.map((o, i) => <li key={i} className={`${i === d.q.correct ? 'right' : ''} ${i === d.q.selected && i !== d.q.correct ? 'wrong' : ''}`}><b>{L[i]}</b> {o}{i === d.q.correct && <small> correct</small>}{i === d.q.selected && i !== d.q.correct && <small> student chose this</small>}</li>)}</ol>
        </div>)}
      <blockquote className="dk-ask">{d.text}</blockquote>
      {!edit && d.answer && <div className="dk-ans"><p>{d.answer}</p><small className="muted">By {d.answeredName} · {ago(d.answeredAt)}{d.shared ? ' · shared with others reviewing this question' : ''}</small> <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>Edit answer</button></div>}
      {edit && d.status !== 'closed' && (
        <div className="dk-reply">
          <label className="sr-only" htmlFor={`dk${d.id}`}>Your answer</label>
          <textarea id={`dk${d.id}`} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Explain it the way you would in class. Short and clear works best." />
          <label className="dk-share"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Also show this answer to other students who review this question</label>
          {err && <p className="alert" role="alert">{err}</p>}
          <div className="dk-acts"><button className="btn btn-primary btn-sm" disabled={busy || text.trim().length < 2} onClick={() => go('answer', { answer: text, share })}>{d.status === 'answered' ? 'Save answer' : 'Send answer'}</button>{d.status === 'open' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => go('close', {})}>Close without answering</button>}</div>
        </div>)}
    </li>
  );
}

/** Teacher and admin queue for "Ask a teacher" doubts. */
export default function DeskQueue({ base }) {
  const [tab, setTab] = useState('open'); const [d, setD] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => api.get(`${base}/desk?status=${tab}`).then(setD).catch((e) => setErr(e.message)), [base, tab]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => { const h = setInterval(load, 30000); return () => clearInterval(h); }, [load]);
  if (err) return <p className="alert" role="alert">{err}</p>;
  const s = d?.stats;
  return (
    <div className="dk">
      {s && <div className="hb-tiles"><div className={`hb-tile ${s.open ? 'warn' : 'good'}`}><b>{s.open}</b><span>waiting for an answer</span></div><div className="hb-tile"><b>{s.oldest ? ago(s.oldest) : '–'}</b><span>oldest waiting</span></div><div className="hb-tile"><b>{s.avgHours != null ? `${s.avgHours} h` : '–'}</b><span>average reply time, 30 days</span></div><div className="hb-tile"><b>{s.answered30}</b><span>answered in 30 days</span></div></div>}
      <div className="chips" role="tablist" aria-label="Filter doubts">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {!d ? <p className="muted" role="status">Loading…</p> : !d.doubts.length ? <div className="card v24-empty"><h3>{tab === 'open' ? 'No doubts waiting' : 'Nothing here'}</h3><p className="muted">Students ask from the review page of any finished test: “Ask a teacher”.</p></div> : <ul className="dk-list">{d.doubts.map((x) => <Item key={`${x.id}:${x.status}`} d={x} base={base} onDone={load} />)}</ul>}
    </div>
  );
}
