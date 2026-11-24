import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export function useTips(attemptId) {
  const [d, setD] = useState(null);
  const load = useCallback(() => api.get(`/attempts/${attemptId}/tips`).then(setD).catch(() => setD({ enabled: false })), [attemptId]);
  useEffect(() => { load(); }, [load]);
  return [d, load];
}

export default function TrickCorner({ attemptId, q, tips, reload }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  useEffect(() => { setText(''); setErr(''); setNote(''); }, [q.id]);
  if (!tips || tips.enabled === false || !tips.available || q.qualifying) return null;
  const list = tips.tips[q.id] || []; const mine = list.some((t) => t.mine);
  const correct = tips.right.includes(q.id); const canShare = tips.canPost && !mine && (correct || !tips.needCorrect);
  const act = async (fn, msg) => { setErr(''); setNote(''); try { await fn(); if (msg) setNote(msg); await reload(); } catch (e) { setErr(e.message); } };
  const share = async (e) => { e.preventDefault(); setBusy(true); await act(() => api.post(`/attempts/${attemptId}/tips`, { questionId: q.id, text }), 'Shared. Thank you!'); setText(''); setBusy(false); };
  return (
    <section className="tc-corner" aria-label="Topper trick corner">
      <header><h3>Topper trick corner</h3><span className="muted small">How top scorers solved this one fast</span></header>
      {!list.length && <p className="muted small">No tricks yet for this question.</p>}
      <ul>{list.map((t) => (
        <li key={t.id} className={t.verified ? 'ver' : ''}>
          <button type="button" className={`tc-vote ${t.voted ? 'on' : ''}`} aria-pressed={t.voted} disabled={t.mine} title={t.mine ? 'Your trick' : t.voted ? 'Remove upvote' : 'Upvote'} onClick={() => act(() => api.post(`/tips/${t.id}/vote`))}><span aria-hidden="true">▲</span><b>{t.votes}</b><span className="sr-only"> upvotes</span></button>
          <div className="tc-body">
            <p>{t.text}</p>
            <span className="small muted">{t.author} <span className={`tc-badge ${t.badge}`}>{t.badge === 'teacher' ? 'Teacher' : 'Top scorer'}</span>{t.verified && <span className="tc-badge ok" title={t.verifiedBy ? `Checked by ${t.verifiedBy}` : 'Checked by a teacher'}>✔ Teacher verified</span>}</span>
          </div>
          {t.mine ? <button type="button" className="tc-x" onClick={() => act(() => api.del(`/tips/${t.id}`))} aria-label="Delete your trick">Delete</button> : <button type="button" className="tc-x" onClick={() => window.confirm('Report this trick as wrong or inappropriate?') && act(() => api.post(`/tips/${t.id}/report`), 'Reported. Thank you.')} aria-label="Report this trick">Report</button>}
        </li>))}
      </ul>
      {canShare && (
        <form onSubmit={share} className="tc-form">
          <label htmlFor="tc-in">Share how you solved this in 20 seconds</label>
          <div><input id="tc-in" value={text} maxLength={140} placeholder="One line, for example: last digit of 7×7×7 is 3, so only (b) fits" onChange={(e) => setText(e.target.value)} /><button className="btn btn-primary btn-sm" disabled={busy || text.trim().length < 12}>Share trick</button></div>
          <small className="muted">{text.length}/140 · one line, no links</small>
        </form>
      )}
      {!canShare && !mine && <p className="small muted">{tips.canPost ? 'You can share a trick on questions you answered correctly.' : tips.reason}</p>}
      {note && <p className="small tc-note" role="status">{note}</p>}
      {err && <div className="alert" role="alert">{err}</div>}
    </section>
  );
}
