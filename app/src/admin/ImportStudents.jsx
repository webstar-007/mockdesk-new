import { useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Err, PageHead, Stat, toast, useLoad } from './ui.jsx';

const TEMPLATE = 'Name,Email,Mobile,Batch\nAsha Verma,asha@example.com,9876543210,\nRavi Kumar,,9811122233,\n';
const tone = { new: 'good', exists: 'brand', invalid: 'bad' };
const word = { new: 'New', exists: 'Already here', invalid: 'Skipped' };

export default function ImportStudents() {
  const { data: b } = useLoad('/admin/batches');
  const [csv, setCsv] = useState(''); const [batch, setBatch] = useState(''); const [invite, setInvite] = useState(true);
  const [pre, setPre] = useState(null); const [done, setDone] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const body = () => ({ csv, batchId: batch ? Number(batch) : null, invite });
  const check = async () => { setBusy(true); setErr(''); setDone(null); try { setPre(await api.post('/admin/students/import/preview', body())); } catch (e) { setPre(null); setErr(e.message); } finally { setBusy(false); } };
  const go = async () => { setBusy(true); setErr(''); try { const r = await api.post('/admin/students/import', body()); setDone(r); setPre(null); toast(`${r.summary.created} accounts created`); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const file = (f) => { if (!f) return; if (f.size > 1024 * 1024) { setErr('That file is larger than 1 MB'); return; } const rd = new FileReader(); rd.onload = () => { setCsv(String(rd.result)); setPre(null); setDone(null); setErr(''); }; rd.readAsText(f); };
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })); a.download = 'students-template.csv'; a.click(); URL.revokeObjectURL(a.href); };
  const rows = (done || pre)?.rows || []; const s = (done || pre)?.summary;
  return (
    <>
      <PageHead title="Import students" sub="Create many student accounts from a spreadsheet. Students sign in with a one-time code sent to their email or mobile, so no password is needed." />
      <section className="card">
        <p className="small">Save your sheet as CSV with the columns <b>Name</b>, <b>Email</b> and/or <b>Mobile</b>. An optional <b>Batch</b> column adds each student to a batch you already created. Up to 500 rows at a time. <button className="btn btn-ghost btn-sm" onClick={dl}>Download template</button></p>
        <div className="imp-drop"><label className="btn btn-ghost">Choose a CSV file<input type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => file(e.target.files[0])} /></label><span className="muted small">or paste the rows below</span></div>
        <textarea className="imp-text" rows={7} value={csv} onChange={(e) => { setCsv(e.target.value); setPre(null); setDone(null); }} placeholder={TEMPLATE} aria-label="Student rows" />
        <div className="ad-toolbar" style={{ marginTop: 10 }}>
          <label className="ad-field" style={{ minWidth: 220 }}>Add everyone to a batch<select value={batch} onChange={(e) => { setBatch(e.target.value); setPre(null); }}><option value="">No batch</option>{(b?.batches || []).filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="ad-chk"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Email an invitation to new students who have an email address</label>
        </div>
        <Err>{err}</Err>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn btn-ghost" disabled={busy || !csv.trim()} onClick={check}>Check the sheet</button>
          <button className="btn btn-primary" disabled={busy || !pre || !pre.summary.new + pre.summary.exists} onClick={go}>{pre ? `Create ${pre.summary.new} accounts` : 'Create accounts'}</button>
        </div>
      </section>
      {s && <div className="ad-grid g4" style={{ marginTop: 14 }}>
        <Stat icon="🆕" tone="good" label={done ? 'Created' : 'New accounts'} value={done ? s.created : s.new} /><Stat icon="👤" label="Already have accounts" value={s.exists} sub={done ? `${s.addedToBatch} added to a batch` : undefined} /><Stat icon="⛔" tone={s.invalid ? 'bad' : ''} label="Skipped" value={s.invalid} sub="Fix these rows and run again" />{done ? <Stat icon="✉" label="Invitations sent" value={s.invited} /> : <Stat icon="📄" label="Rows read" value={s.total} />}
      </div>}
      {!!rows.length && <div className="card nopad" style={{ marginTop: 14, overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Mobile</th><th>Batch</th><th>Result</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.line} className={x.status === 'invalid' ? 'ad-dim' : ''}><td className="num">{x.line}</td><td>{x.name || '–'}</td><td>{x.email || '–'}</td><td>{x.phone || '–'}</td><td>{x.batchName || '–'}</td><td><Badge tone={tone[x.status]}>{word[x.status]}</Badge>{x.reason && <small style={{ display: 'block' }}>{x.reason}</small>}</td></tr>)}</tbody></table></div>}
    </>
  );
}
