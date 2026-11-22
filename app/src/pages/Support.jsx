import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useCrumb } from '../components/PageNav.jsx';

const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const STATUS = { open: ['Waiting for us', 'warn'], answered: ['We replied', 'good'], closed: ['Closed', 'mute'] };

export default function Support() {
  const { id } = useParams(); return id ? <Thread id={id} /> : <List />;
}

function List() {
  const nav = useNavigate(); const [d, setD] = useState(null); const [err, setErr] = useState(''); const [f, setF] = useState({ subject: '', category: 'account', body: '' }); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false);
  const load = () => api.get('/support').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const send = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api.post('/support', f); nav(`/support/${r.ticket.id}`); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  if (!d && !err) return <p className="muted" role="status">Loading…</p>;
  const waiting = d?.tickets.filter((t) => t.waiting).length || 0;
  return (
    <div className="sp-page">
      <header className="sp-head"><div><h1>Help and support</h1><p className="muted">Ask us anything about your account, a test or your results. We reply here and in your inbox.</p></div>{!open && <button className="btn btn-primary" onClick={() => setOpen(true)}>Ask a question</button>}</header>
      {err && <p className="alert" role="alert">{err}</p>}
      {open && <form className="card sp-new" onSubmit={send}>
        <h2>New question</h2>
        <label>What is it about?<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(d?.categories || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Short title<input value={f.subject} maxLength={120} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. My result page is blank" autoFocus required /></label>
        <label>Tell us what happened<textarea rows={5} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Which test, what you expected and what you saw. The more detail, the faster we can help." required /></label>
        <div className="sp-act"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send question'}</button></div>
      </form>}
      {waiting > 0 && <p className="sp-note" role="status"><b>{waiting === 1 ? 'We have replied to one of your questions.' : `We have replied to ${waiting} of your questions.`}</b></p>}
      {d?.tickets.length ? <ul className="sp-list">{d.tickets.map((t) => <li key={t.id}><Link to={`/support/${t.id}`}><div><b>{t.subject}</b><small className="muted">{t.categoryLabel} · updated {when(t.updatedAt)}</small></div><span className={`sp-st ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span></Link></li>)}</ul>
        : !open && <div className="card sp-empty"><h2>No questions yet</h2><p className="muted">When you ask us something, the whole conversation stays here.</p><button className="btn btn-primary" onClick={() => setOpen(true)}>Ask a question</button></div>}
    </div>
  );
}

function Thread({ id }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api.get(`/support/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  useCrumb(`/support/${id}`, d?.ticket.subject);
  if (err && !d) return <p className="alert" role="alert">{err}</p>; if (!d) return <p className="muted" role="status">Loading…</p>;
  const t = d.ticket; const st = STATUS[t.status];
  const act = async (fn) => { setBusy(true); setErr(''); try { await fn(); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="sp-page">
      <header className="sp-head"><div><h1>{t.subject}</h1><p className="muted">{t.categoryLabel} · opened {when(t.createdAt)}</p></div><span className={`sp-st ${st[1]}`}>{st[0]}</span></header>
      <ol className="sp-msgs" aria-label="Conversation">{d.messages.map((m) => <li key={m.id} className={m.from === 'student' ? 'me' : 'them'}><div><b>{m.author}</b><small className="muted"> {when(m.at)}</small></div><p>{m.body}</p></li>)}</ol>
      {err && <p className="alert" role="alert">{err}</p>}
      {t.status === 'closed' ? <div className="card sp-closed"><p style={{ margin: 0 }}>This question is closed. {t.rating ? `You rated our help ${t.rating} out of 5. Thank you.` : 'Was our help useful?'}</p>
        {!t.rating && <div className="sp-stars" role="group" aria-label="Rate our help">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} disabled={busy} onClick={() => act(() => api.post(`/support/${id}/rate`, { rating: n }))}>★</button>)}</div>}
        <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.post(`/support/${id}/reply`, { body: 'I have a follow-up question.' }))}>Reopen</button></div>
        : <form className="sp-reply" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.post(`/support/${id}/reply`, { body }); setBody(''); }); }}>
          <label className="sr-only" htmlFor="sp-r">Your reply</label><textarea id="sp-r" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t.status === 'answered' ? 'Reply to our team' : 'Add more details if you remember something else'} />
          <div className="sp-act"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.post(`/support/${id}/close`))}>This is sorted. Close it</button><button className="btn btn-primary" disabled={busy || !body.trim()}>Send</button></div></form>}
      
    </div>
  );
}
