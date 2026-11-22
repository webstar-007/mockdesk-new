import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Empty, Err, Loading, PageHead, ago, dt, toast, useLoad } from './ui.jsx';

const ST = { open: ['Needs reply', 'bad'], answered: ['Waiting for student', 'good'], closed: ['Closed', 'mute'] };
const FILTERS = [['open', 'Needs reply'], ['answered', 'Answered'], ['closed', 'Closed'], ['', 'All']];

export default function Support() {
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? 'open'; const sel = Number(sp.get('t')) || 0; const [q, setQ] = useState(''); const [mine, setMine] = useState(false);
  const qs = new URLSearchParams({ status, q, mine: mine ? '1' : '0' }).toString(); const { data: d, err, loading, reload } = useLoad(`/admin/tickets?${qs}`, [qs]);
  const set = (o) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v === '' || v == null) n.delete(k); else n.set(k, v); } if (!('status' in o) && !sp.has('status')) n.set('status', status); setSp(n, { replace: true }); };
  return (
    <>
      <PageHead title="Support inbox" sub="Questions students send from the app. Answer here, and they get the reply in their inbox, by email and as a phone alert if those are on.">
        {d?.rating && <Badge tone="good">★ {d.rating.avg} from {d.rating.n} rating{d.rating.n === 1 ? '' : 's'}</Badge>}
      </PageHead>
      <div className="sup">
        <section className="sup-list card nopad" aria-label="Questions">
          <div className="sup-tools">
            <div className="tc-seg" role="group" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k || 'all'} className={status === k ? 'on' : ''} aria-pressed={status === k} onClick={() => set({ status: k || 'all', t: '' })}>{l}{d && k && d.counts[k] > 0 ? ` ${d.counts[k]}` : ''}</button>)}</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by student or title" aria-label="Search" /><label className="sx-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only</label>
          </div>
          {err && <Err>{err}</Err>}{loading && !d ? <Loading /> : !d?.tickets.length ? <Empty>{status === 'open' ? 'Nothing is waiting for a reply. 🎉' : 'No questions here.'}</Empty>
            : <ul>{d.tickets.map((t) => <li key={t.id}><button className={sel === t.id ? 'on' : ''} onClick={() => set({ t: t.id })}><span className="sup-top"><b>{t.student}</b><small className="muted">{ago(t.updatedAt)}</small></span><span className="sup-sub">{t.priority === 'high' && <Badge tone="bad">High</Badge>} {t.subject}</span><span className="sup-pre muted">{t.lastFrom === 'staff' ? 'You: ' : ''}{t.preview}</span><Badge tone={ST[t.status][1]}>{ST[t.status][0]}</Badge></button></li>)}</ul>}
        </section>
        <section className="sup-view card" aria-label="Conversation">{sel ? <Thread id={sel} key={sel} onChanged={reload} /> : <Empty>Choose a question on the left to read and answer it.</Empty>}</section>
      </div>
    </>
  );
}

function Thread({ id, onChanged }) {
  const { data: d, err, loading, reload } = useLoad(`/admin/tickets/${id}`, [id]); const [body, setBody] = useState(''); const [note, setNote] = useState(false); const [busy, setBusy] = useState(false);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const t = d.ticket;
  const send = async (close) => { setBusy(true); try { await api.post(`/admin/tickets/${id}/reply`, { body, note, close }); setBody(''); toast(note ? 'Note saved' : close ? 'Sent and closed' : 'Reply sent'); reload(); onChanged(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const patch = async (o, msg) => { try { await api.patch(`/admin/tickets/${id}`, o); toast(msg); reload(); onChanged(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <header className="sup-head"><div><h2>{t.subject}</h2><p className="muted small">{t.student} · {t.email || 'no email'} · {t.categoryLabel} · opened {dt(t.createdAt)}</p></div><Badge tone={ST[t.status][1]}>{ST[t.status][0]}</Badge></header>
      <div className="sup-acts">
        {t.status === 'closed' ? <button className="btn btn-ghost btn-sm" onClick={() => patch({ status: 'open' }, 'Reopened')}>Reopen</button> : <button className="btn btn-ghost btn-sm" onClick={() => patch({ status: 'closed' }, 'Closed')}>Close</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => patch({ priority: t.priority === 'high' ? 'normal' : 'high' }, t.priority === 'high' ? 'Priority removed' : 'Marked high priority')}>{t.priority === 'high' ? 'Remove high priority' : 'Mark high priority'}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => patch({ assignedTo: t.assignedTo ? null : 'me' }, t.assignedTo ? 'Unassigned' : 'Assigned to you')}>{t.assignedTo ? `Assigned to ${t.assignee} · release` : 'Assign to me'}</button>
        <Link className="btn btn-ghost btn-sm" to={`/admin/users/${t.userId}`}>Open student</Link>
      </div>
      <ol className="sup-msgs" aria-label="Messages">{d.messages.map((m) => <li key={m.id} className={`${m.from === 'student' ? 'in' : 'out'}${m.note ? ' note' : ''}`}><div><b>{m.note ? `Private note by ${m.author}` : m.from === 'student' ? t.student : m.author}</b><small className="muted"> {dt(m.at)}</small></div><p>{m.body}</p></li>)}</ol>
      {<form className="sup-reply" onSubmit={(e) => { e.preventDefault(); send(false); }}>
        <label className="sr-only" htmlFor="rep">Your reply</label><textarea id="rep" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={note ? 'A private note. The student cannot see this.' : 'Write your reply. The student is notified.'} />
        <div className="sup-bar"><label className="sx-check"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} /> Private note (student cannot see)</label><span>{!note && <button type="button" className="btn btn-ghost" disabled={busy || !body.trim()} onClick={() => send(true)}>Send and close</button>} <button className="btn btn-primary" disabled={busy || !body.trim()}>{note ? 'Save note' : 'Send reply'}</button></span></div>
      </form>}
      {d.others.length > 0 && <p className="small muted">Also from this student: {d.others.map((o) => `${o.subject} (${o.status})`).join(', ')}</p>}
    </>
  );
}
