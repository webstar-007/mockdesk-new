import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useCrumb } from '../components/PageNav.jsx';
import { Dialog, toast } from '../admin/ui.jsx';

const when = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const left = (ms) => { const d = ms - Date.now(); if (d < 0) return 'Past due'; const h = Math.floor(d / 3600000); return h < 24 ? `${Math.max(1, h)} hour${h === 1 ? '' : 's'} left` : `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'} left`; };
const Loading = () => <div className="tc-skel" role="status" aria-label="Loading"><i /><i /><i /></div>;
// Next evening at 8 pm local time as the default due time, in the format a datetime-local box wants.
const defaultDue = () => { const d = new Date(Date.now() + 2 * 86400000); d.setHours(20, 0, 0, 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function Create({ mocks, batches, defaultBatch, onClose, onDone }) {
  const [f, setF] = useState({ batchId: defaultBatch || batches[0]?.id || '', kind: 'mock', mockId: mocks[0]?.id || '', practiceSets: 1, due: defaultDue(), note: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/teacher/assignments', { batchId: Number(f.batchId), kind: f.kind, mockId: f.kind === 'mock' ? f.mockId : undefined, practiceSets: Number(f.practiceSets), dueAt: new Date(f.due).getTime(), note: f.note }); toast(`Assigned. ${r.notified} student${r.notified === 1 ? ' was' : 's were'} notified.`); onDone(r.assignment); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Set an assignment" onClose={onClose}>
      <form onSubmit={save}>
        <label className="ad-field">Batch<select value={f.batchId} onChange={(e) => set('batchId', e.target.value)}>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <div className="sx-chips" role="group" aria-label="What to set"><button type="button" className={f.kind === 'mock' ? 'on' : ''} onClick={() => set('kind', 'mock')}>A full mock</button><button type="button" className={f.kind === 'practice' ? 'on' : ''} onClick={() => set('kind', 'practice')}>Practice sets</button></div>
        {f.kind === 'mock'
          ? <label className="ad-field">Mock<select value={f.mockId} onChange={(e) => set('mockId', e.target.value)}>{mocks.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>{!mocks.length && <small>No published mocks yet.</small>}</label>
          : <label className="ad-field">How many practice sets<input type="number" min="1" max="10" value={f.practiceSets} onChange={(e) => set('practiceSets', e.target.value)} /><small>Each student builds sets from their own weak topics.</small></label>}
        <label className="ad-field">Due<input type="datetime-local" value={f.due} onChange={(e) => set('due', e.target.value)} required /><small>Students get a reminder a day before, and you get a summary when it passes.</small></label>
        <label className="ad-field">Note for students (optional)<input value={f.note} maxLength={200} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Attempt it in one sitting" /></label>
        {err && <p className="alert" role="alert">{err}</p>}
        <div className="modal-act"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (f.kind === 'mock' && !f.mockId)}>{busy ? 'Assigning…' : 'Assign'}</button></div>
      </form>
    </Dialog>
  );
}

export function AssignmentList() {
  const nav = useNavigate(); const [d, setD] = useState(null); const [err, setErr] = useState(''); const [batches, setBatches] = useState([]); const [make, setMake] = useState(false);
  const load = () => api.get('/teacher/assignments').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.get('/teacher/batches').then((r) => setBatches(r.batches)).catch(() => {}); }, []);
  if (err) return <p className="alert" role="alert">{err}</p>; if (!d) return <Loading />;
  const open = d.items.filter((x) => !x.overdue && x.dueAt > Date.now()); const past = d.items.filter((x) => !open.includes(x));
  const row = (a) => (
    <li key={a.id}><Link to={`/teacher/assignments/${a.id}`} className="tc-asg">
      <div><b>{a.title}</b><small className="muted">{a.batch} · {a.kind === 'practice' ? `${a.practiceSets} practice set${a.practiceSets > 1 ? 's' : ''}` : 'Mock'} · due {when(a.dueAt)}</small></div>
      <div className="tc-asg-p"><span className="tc-bar" role="img" aria-label={`${a.done} of ${a.total} finished`}><i className={a.done === a.total ? 'good' : a.overdue ? 'low' : 'mid'} style={{ width: `${a.total ? Math.max(3, Math.round(a.done / a.total * 100)) : 0}%` }} /></span><small>{a.done} of {a.total} finished</small></div>
      <span className={`tc-chip ${a.overdue ? 'low' : ''}`}>{a.overdue ? `${a.pending} pending` : left(a.dueAt)}</span>
    </Link></li>);
  return (
    <div className="tc-page">
      <div className="tc-hello"><div><h1>Assignments</h1><p className="muted">Set a mock or practice for a batch, and see who has not done it.</p></div><button className="btn btn-primary" onClick={() => setMake(true)} disabled={!batches.length}>Set an assignment</button></div>
      <div className="tc-stats three"><div className="tc-stat"><span>Open</span><b>{d.summary.open}</b></div><div className={`tc-stat ${d.summary.overdue ? 'bad' : ''}`}><span>Past due, not finished</span><b>{d.summary.overdue}</b></div><div className="tc-stat"><span>Students still to do</span><b>{d.summary.pendingStudents}</b></div></div>
      {!d.items.length ? <section className="card tc-sec"><p className="muted" style={{ margin: 0 }}>Nothing set yet. Choose “Set an assignment” to give a batch a mock or practice with a due date. Reminders go out by themselves.</p></section> : (
        <>
          {open.length > 0 && <section className="card tc-sec"><h2>Open</h2><ul className="tc-asg-list">{open.map(row)}</ul></section>}
          {past.length > 0 && <section className="card tc-sec"><h2>Past due or finished</h2><ul className="tc-asg-list">{past.map(row)}</ul></section>}
        </>)}
      {make && <Create mocks={d.mocks} batches={batches} onClose={() => setMake(false)} onDone={(a) => { setMake(false); nav(`/teacher/assignments/${a.id}`); }} />}
    </div>
  );
}

export function AssignmentDetail() {
  const { id } = useParams(); const nav = useNavigate(); const [a, setA] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ext, setExt] = useState('');
  const load = () => api.get(`/teacher/assignments/${id}`).then((r) => setA(r.assignment)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useCrumb(`/teacher/assignments/${id}`, a?.title || 'Assignment');
  if (err) return <p className="alert" role="alert">{err}</p>; if (!a) return <Loading />;
  const todo = a.students.filter((s) => !s.done); const done = a.students.filter((s) => s.done);
  const remind = async () => { setBusy(true); try { const r = await api.post(`/teacher/assignments/${id}/remind`); toast(r.message); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const extend = async () => { if (!ext) return; setBusy(true); try { await api.patch(`/teacher/assignments/${id}`, { dueAt: new Date(ext).getTime() }); toast('Due date changed. Reminders will go out again.'); setExt(''); load(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove this assignment? Students will no longer see it.')) return; try { await api.delete(`/teacher/assignments/${id}`); nav('/teacher/assignments'); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="tc-page">
      <div className="tc-hello"><div><h1>{a.title}</h1><p className="muted">{a.batch} · due {when(a.dueAt)} · {left(a.dueAt)}{a.note ? ` · “${a.note}”` : ''}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn-primary" disabled={busy || !todo.length} onClick={remind}>Remind {todo.length} student{todo.length === 1 ? '' : 's'}</button><button className="btn btn-ghost" onClick={remove}>Remove</button></div></div>
      <div className="tc-stats three"><div className="tc-stat good"><span>Finished</span><b>{a.done}</b><small>of {a.total}</small></div><div className={`tc-stat ${todo.length && a.overdue ? 'bad' : ''}`}><span>Not yet</span><b>{a.pending}</b></div><div className="tc-stat"><span>Finished late</span><b>{a.late}</b></div></div>
      <div className="tc-row2">
        <section className="card tc-sec"><h2>Has not done it {todo.length > 0 && <span className="tc-count">{todo.length}</span>}</h2>
          {todo.length ? <ul className="tc-feed">{todo.map((s) => <li key={s.id}><div><Link to={`/teacher/${a.batchId}/${s.id}`}>{s.name}</Link><small className="muted">{s.started ? (a.kind === 'practice' ? `${s.sets} of ${a.practiceSets} sets done` : 'Started, not finished') : 'Not started'} · last seen {s.lastSeen ? new Date(s.lastSeen).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'never'}</small></div></li>)}</ul> : <p className="tc-ok">Everyone has finished.</p>}
          <div className="ad-row" style={{ marginTop: 14, gap: 8, alignItems: 'end' }}><label className="ad-field" style={{ margin: 0 }}>Need more time? New due date<input type="datetime-local" value={ext} onChange={(e) => setExt(e.target.value)} /></label><button className="btn btn-ghost" disabled={busy || !ext} onClick={extend}>Change due date</button></div>
        </section>
        <section className="card tc-sec"><h2>Finished</h2>
          {done.length ? <ul className="tc-feed">{done.sort((x, y) => x.doneAt - y.doneAt).map((s) => <li key={s.id}><div><Link to={`/teacher/${a.batchId}/${s.id}`}>{s.name}</Link><small className="muted">{when(s.doneAt)}{s.late ? ' · late' : ''}{s.pct != null ? ` · ${Math.round(s.pct)}%` : ''}</small></div></li>)}</ul> : <p className="muted">Nobody yet.</p>}
        </section>
      </div>
    </div>
  );
}
