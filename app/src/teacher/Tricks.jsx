import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from '../admin/ui.jsx';

export default function Tricks() {
  const [list, setList] = useState(null); const [err, setErr] = useState(''); const [show, setShow] = useState('todo');
  const [mocks, setMocks] = useState([]); const [mock, setMock] = useState(''); const [qs, setQs] = useState([]); const [qid, setQid] = useState(''); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/teacher/tips').then((r) => setList(r.tips)).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); api.get('/teacher/tips/mocks').then((r) => setMocks(r.mocks)).catch(() => {}); }, [load]);
  useEffect(() => { setQs([]); setQid(''); if (mock) api.get(`/teacher/tips/mocks/${mock}/questions`).then((r) => setQs(r.questions)).catch((e) => setErr(e.message)); }, [mock]);
  const act = async (fn, msg) => { setErr(''); try { await fn(); toast(msg); load(); } catch (e) { setErr(e.message); } };
  const post = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post('/teacher/tips', { mockId: mock, questionId: qid, text }); toast('Trick posted'); setText(''); load(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const rows = (list || []).filter((t) => (show === 'todo' ? !t.verified : show === 'ver' ? t.verified : true));
  return (
    <div className="tc-page">
      <div className="tc-head"><div><h1>Topper tricks</h1><p className="muted">Short shortcuts shared by top-scoring students. Verify the correct ones so everyone sees the Teacher Verified badge, and remove the wrong ones.</p></div></div>
      {err && <div className="alert" role="alert">{err}</div>}
      <section className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Post your own trick</h3>
        <form onSubmit={post} className="tt-form">
          <select aria-label="Mock" value={mock} onChange={(e) => setMock(e.target.value)}><option value="">Choose a mock</option>{mocks.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <select aria-label="Question" value={qid} onChange={(e) => setQid(e.target.value)} disabled={!qs.length}><option value="">{qs.length ? 'Choose a question' : 'Pick a mock first'}</option>{qs.map((q) => <option key={q.id} value={q.id}>{q.section} {q.index}: {q.text.slice(0, 70)}</option>)}</select>
          <input aria-label="Your trick" placeholder="One line, up to 140 characters" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !mock || !qid || text.trim().length < 12}>Post (verified)</button>
        </form>
      </section>
      <div className="chips" role="tablist" aria-label="Show" style={{ marginBottom: 10 }}>
        {[['todo', 'Needs a look'], ['ver', 'Verified'], ['all', 'All']].map(([k, l]) => <button key={k} role="tab" aria-selected={show === k} className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
      </div>
      {!list ? <p className="muted" role="status">Loading…</p> : !rows.length ? <div className="card"><p className="muted" style={{ margin: 0 }}>{show === 'todo' ? 'Nothing waiting. New tricks from students show up here.' : 'No tricks here yet.'}</p></div> : (
        <ul className="tt-list">{rows.map((t) => (
          <li key={t.id} className="card">
            <div><p className="tt-text">{t.text}</p><p className="small muted">{t.author}{t.role === 'teacher' ? ' (teacher)' : ''} · {t.mock} · {t.votes} upvote{t.votes === 1 ? '' : 's'}{t.reports ? ` · ${t.reports} report${t.reports === 1 ? '' : 's'}` : ''}</p>{t.question && <p className="small tt-q">Question: {t.question}</p>}</div>
            <div className="tt-act">
              {t.verified ? <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.post(`/teacher/tips/${t.id}/verify`, { on: false }), 'Verification removed')}>✔ Verified · undo</button> : <button className="btn btn-primary btn-sm" onClick={() => act(() => api.post(`/teacher/tips/${t.id}/verify`, { on: true }), 'Verified')}>Verify</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Remove this trick for everyone?') && act(() => api.del(`/teacher/tips/${t.id}`), 'Removed')}>Remove</button>
            </div>
          </li>))}
        </ul>
      )}
    </div>
  );
}
