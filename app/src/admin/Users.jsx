import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Dialog, Empty, toast, Err, Loading, PageHead, Pager, SortTh, ago, dOnly, statusTone, useLoad, useSort } from './ui.jsx';

export default function Users() {
  const nav = useNavigate(); const [urlq] = useSearchParams();
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [role, setRole] = useState(''); const [status, setStatus] = useState(urlq.get('status') || ''); const [seg, setSeg] = useState(urlq.get('segment') || ''); const [page, setPage] = useState(1); const [{ sort, dir }, setSort] = useSort('joined');
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const [sel, setSel] = useState([]); const [bulk, setBulk] = useState(null); const [bf, setBf] = useState({ batchId: '', title: '', body: '', target: '' }); const { data: bd } = useLoad('/admin/batches', []);
  const size = 25;
  const qs = new URLSearchParams({ q: dq, role, status, segment: seg, sort, dir, page, size }).toString();
  const { data, err, loading, reload } = useLoad(`/admin/users?${qs}`, [qs]);
  useEffect(() => setSel([]), [qs]);
  const students = (data?.users || []).filter((u) => u.role === 'student'); const allOn = students.length > 0 && students.every((u) => sel.includes(u.id));
  const doBulk = async () => { try { const r = await api.post('/admin/users/bulk', { ids: sel, action: bulk, batchId: Number(bf.batchId) || undefined, title: bf.title, body: bf.body, target: bf.target === '' ? undefined : Number(bf.target) }); toast(`${r.done} student(s) updated${r.skipped ? `, ${r.skipped} skipped` : ''}`); setBulk(null); setSel([]); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const exportSel = () => { const rows = (data?.users || []).filter((u) => sel.includes(u.id)); const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; const csv = ['Name,Email,Phone,Status', ...rows.map((u) => [u.name, u.email, u.phone, u.status].map(q).join(','))].join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'selected-students.csv'; a.click(); URL.revokeObjectURL(a.href); };
  const bulkPick = ['add-to-batch', 'remove-from-batch'].includes(bulk); const bulkForm = ['message', 'set-target'].includes(bulk);
  const sp = (k, children, cls) => <SortTh k={k} sort={sort} dir={dir} onSort={(a, b) => { setSort(a, b); setPage(1); }} className={cls}>{children}</SortTh>;
  return (
    <>
      <PageHead title="Users" sub="Every student and admin on the platform."><a className="btn btn-ghost" href={`/api/admin/users.csv`} download>⬇ Export CSV</a></PageHead>
      <div className="ad-toolbar">
        <input className="grow" type="search" placeholder="Search name, email or mobile…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role"><option value="">All roles</option><option value="student">Students</option><option value="teacher">Teachers</option><option value="editor">Editors</option><option value="admin">Admins</option></select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
      </div>
      <div className="ad-pill-row" style={{ marginBottom: 12 }} role="group" aria-label="Student segments">{[['', 'Everyone'], ['new', 'New this week'], ['never', 'Never took a test'], ['inactive', 'Inactive 7+ days'], ['top', 'Top performers (70%+)'], ['struggling', 'Struggling (under 35%)']].map(([k, n]) => <button key={k} className={`ad-pill ${seg === k ? 'on' : ''}`} onClick={() => { setSeg(k); setPage(1); }}>{n}</button>)}</div>
      {sel.length > 0 && <div className="ad-bulk" role="region" aria-label="Bulk actions"><b>{sel.length} selected</b><button className="btn btn-ghost btn-sm" onClick={() => setBulk('suspend')}>Suspend</button><button className="btn btn-ghost btn-sm" onClick={() => setBulk('activate')}>Reactivate</button><button className="btn btn-ghost btn-sm" onClick={() => setBulk('sign-out')}>Sign out</button><button className="btn btn-ghost btn-sm" onClick={() => setBulk('add-to-batch')}>Add to batch</button><button className="btn btn-ghost btn-sm" onClick={() => setBulk('remove-from-batch')}>Remove from batch</button><button className="btn btn-ghost btn-sm" onClick={() => setBulk('message')}>Send message</button><button className="btn btn-ghost btn-sm" onClick={() => setBulk('set-target')}>Set target score</button><button className="btn btn-ghost btn-sm" onClick={exportSel}>Download list</button><button className="btn btn-ghost btn-sm" onClick={() => setSel([])}>Clear</button></div>}
      <Err>{err}</Err>
      <div className="card nopad">
        {loading && !data ? <Loading /> : !data?.users.length ? <Empty>No users match.</Empty> : (
          <div style={{ overflowX: 'auto' }}><table className="ad-table">
            <thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Select all students on this page" checked={allOn} onChange={(e) => setSel(e.target.checked ? students.map((u) => u.id) : [])} /></th>{sp('name', 'User')}<th>Role</th><th>Status</th>{sp('joined', 'Joined')}{sp('active', 'Last active')}{sp('attempts', 'Tests', 'num')}{sp('avg', 'Avg %', 'num')}{sp('best', 'Best', 'num')}</tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.id} className="click" onClick={() => nav(`/admin/users/${u.id}`)}>
                <td onClick={(e) => e.stopPropagation()}>{u.role === 'student' && <input type="checkbox" aria-label={`Select ${u.name}`} checked={sel.includes(u.id)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, u.id] : x.filter((i) => i !== u.id)))} />}</td><td className="nm"><b>{u.name}</b><small>{u.email || u.phone}</small></td><td><Badge tone={statusTone[u.role]}>{u.role}</Badge></td><td><Badge tone={statusTone[u.status]}>{u.status}</Badge></td>
                <td>{dOnly(Date.parse(u.createdAt))}</td><td>{ago(u.lastSeen)}</td><td className="num">{u.completed}<small className="muted"> / {u.started}</small></td>
                <td className="num">{u.avgPct == null ? '–' : <><span className="ad-meter"><i className={u.avgPct < 40 ? 'low' : u.avgPct < 65 ? 'mid' : ''} style={{ width: `${u.avgPct}%` }} /></span>{u.avgPct}</>}</td><td className="num">{u.best ?? '–'}</td>
              </tr>))}</tbody></table></div>
        )}
        {data && <Pager page={page} size={size} total={data.total} onPage={setPage} />}
      </div>
      {bulk && (bulkPick || bulkForm) && <Dialog title={{ 'add-to-batch': 'Add to a batch', 'remove-from-batch': 'Remove from a batch', message: 'Send a message', 'set-target': 'Set a target score' }[bulk]} onClose={() => setBulk(null)}>
        <p className="muted">{sel.length} student(s) selected.</p>
        {bulkPick && <label className="ad-field">Batch<select value={bf.batchId} onChange={(e) => setBf({ ...bf, batchId: e.target.value })}><option value="">Choose a batch</option>{(bd?.batches || []).filter((b) => !b.archived).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.students})</option>)}</select></label>}
        {bulk === 'message' && <><label className="ad-field">Title<input value={bf.title} maxLength={80} onChange={(e) => setBf({ ...bf, title: e.target.value })} autoFocus /></label><label className="ad-field">Message<textarea rows={4} maxLength={600} value={bf.body} onChange={(e) => setBf({ ...bf, body: e.target.value })} /></label><p className="small muted">It appears in each student’s inbox, and goes to their email and phone alerts if they have those on.</p></>}
        {bulk === 'set-target' && <label className="ad-field">Target score (marks out of the paper total)<input type="number" min="0" max="1000" value={bf.target} onChange={(e) => setBf({ ...bf, target: e.target.value })} autoFocus /></label>}
        <div className="modal-act"><button className="btn btn-ghost" onClick={() => setBulk(null)}>Cancel</button><button className="btn btn-primary" disabled={(bulkPick && !bf.batchId) || (bulk === 'message' && (!bf.title.trim() || !bf.body.trim())) || (bulk === 'set-target' && bf.target === '')} onClick={doBulk}>{bulk === 'message' ? 'Send' : 'Apply'}</button></div>
      </Dialog>}
      {bulk && !bulkPick && !bulkForm && <ConfirmModal title={`${{ suspend: 'Suspend', activate: 'Reactivate', 'sign-out': 'Sign out' }[bulk]} ${sel.length} student(s)?`} label="Confirm" danger={bulk === 'suspend'} onClose={() => setBulk(null)} onConfirm={doBulk}>{bulk === 'suspend' ? 'They are signed out now and cannot sign in until you reactivate them.' : bulk === 'activate' ? 'They can sign in again.' : 'They need to sign in again.'}</ConfirmModal>}
    </>
  );
}
