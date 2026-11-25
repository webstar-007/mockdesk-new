import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const ago = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} days ago`; };
export function useDesk(attemptId) {
  const [d, setD] = useState(null);
  const load = useCallback(() => api.get(`/attempts/${attemptId}/desk`).then(setD).catch(() => setD({ mine: [], shared: {}, open: 0, limit: 5 })), [attemptId]);
  useEffect(() => { load(); }, [load]);
  return [d, load];
}

/** "Ask a teacher" under each reviewed question, plus answers teachers chose to share. */
export default function DeskPanel({ attemptId, q, desk, reload }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { setOpen(false); setText(''); setErr(''); }, [q.id]);
  if (!desk) return null;
  const mine = desk.mine.filter((x) => x.questionId === q.id); const shared = desk.shared[q.id] || [];
  const waiting = mine.some((x) => x.status === 'open');
  async function send() {
    setBusy(true); setErr('');
    try { await api.post(`/attempts/${attemptId}/desk`, { questionId: q.id, text }); setText(''); setOpen(false); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="dsk" aria-label="Ask a teacher">
      {shared.map((s, i) => <div key={i} className="dsk-shared"><b>Teacher’s answer to a student’s doubt</b>{s.asked && <p className="muted small">Someone asked: “{s.asked}”</p>}<p>{s.answer}</p><small className="muted">{s.by}</small></div>)}
      {mine.map((x) => (
        <div key={x.id} className={`dsk-mine s-${x.status}`}>
          <p className="small"><b>You asked</b> <span className="muted">{ago(x.createdAt)}</span></p><p>{x.text}</p>
          {x.status === 'open' && <p className="dsk-wait" role="status">Waiting for your teacher. You will get a notification.</p>}
          {x.status === 'answered' && <div className="dsk-ans"><b>{x.answeredName} replied</b><p>{x.answer}</p></div>}
          {x.status === 'closed' && <p className="muted small">Your teacher closed this one without a reply. Try asking again with more detail, or use the doubt helper above.</p>}
        </div>))}
      {!open && !waiting && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>🙋 Ask a teacher about this question</button>}
      {open && (
        <div className="dsk-form">
          <label htmlFor="dsk-t" className="small"><b>What are you stuck on?</b></label>
          <textarea id="dsk-t" rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: I understand the formula but not why we divide by 2 in step 3." />
          {err && <p className="alert" role="alert">{err}</p>}
          <div className="dk-acts"><button className="btn btn-primary btn-sm" disabled={busy || text.trim().length < 5} onClick={send}>{busy ? 'Sending…' : 'Send to teacher'}</button><button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button><small className="muted">{desk.open}/{desk.limit} waiting</small></div>
        </div>)}
    </section>
  );
}
