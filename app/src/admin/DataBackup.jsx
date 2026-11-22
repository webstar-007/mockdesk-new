import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, ConfirmModal, Err, Loading, PageHead, dt, toast, useLoad } from './ui.jsx';

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Backups() {
  const { data: d, err, loading, reload } = useLoad('/admin/backups');
  const [busy, setBusy] = useState(false); const [del, setDel] = useState(null);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const save = async (patch) => { try { await api.put('/admin/backups/config', patch); toast('Saved'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const now = async () => { setBusy(true); try { await api.post('/admin/backups'); toast('Backup created'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const c = d.config;
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h3>Backups</h3>
      <p className="small muted">A backup is a full copy of the database: students, tests, questions and settings. Copies are kept on the server in <code>{d.dir}</code>. Also copy them somewhere else now and then, because a lost server takes its backups with it.</p>
      <div className="ad-toolbar">
        <label className="ad-chk"><input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Back up automatically</label>
        <label className="ad-field">Every<select value={c.everyHours} onChange={(e) => save({ everyHours: Number(e.target.value) })}>{[6, 12, 24, 48, 168].map((h) => <option key={h} value={h}>{h === 168 ? 'week' : h === 24 ? 'day' : h === 48 ? '2 days' : `${h} hours`}</option>)}</select></label>
        <label className="ad-field">Keep the latest<select value={c.keep} onChange={(e) => save({ keep: Number(e.target.value) })}>{[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} copies</option>)}</select></label>
        <button className="btn btn-primary" disabled={busy} onClick={now}>Back up now</button>
      </div>
      <p className="small muted">{d.last ? `Last backup: ${dt(d.last)}` : 'No backup has run yet.'}</p>
      {!d.backups.length ? <p className="muted">No backups yet.</p> : <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Copy</th><th>Created</th><th>Size</th><th /></tr></thead><tbody>{d.backups.map((x) => <tr key={x.name}><td><code>{x.name}</code></td><td>{dt(x.at)}</td><td className="num">{size(x.size)}</td><td style={{ whiteSpace: 'nowrap' }}><a className="btn btn-ghost btn-sm" href={`/api/admin/backups/${x.name}`} download>Download</a> <button className="btn btn-ghost btn-sm" onClick={() => setDel(x.name)}>Delete</button></td></tr>)}</tbody></table></div>}
      <details style={{ marginTop: 12 }}><summary><b>How to restore a backup</b></summary><ol className="small"><li>Stop the MockDesk server.</li><li>Download the backup you want.</li><li>Replace the database file (<code>data/mockdesk.db</code>, or the path in <code>MOCKDESK_DB</code>) with it, and delete the <code>.db-wal</code> and <code>.db-shm</code> files next to it.</li><li>Start the server again. Everything is back as it was at that time.</li></ol></details>
      {del && <ConfirmModal title="Delete this backup?" label="Delete" danger onClose={() => setDel(null)} onConfirm={async () => { try { await api.del(`/admin/backups/${del}`); toast('Deleted'); setDel(null); reload(); } catch (e) { toast(e.message, 'bad'); } }}><p><code>{del}</code> will be removed from the server.</p></ConfirmModal>}
    </section>
  );
}

export default function DataBackup() {
  const { user } = useAuth(); const { data: d, err, loading } = useLoad('/admin/export');
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  return (
    <>
      <PageHead title="Data and backup" sub="Download your data as spreadsheets, and keep safe copies of the whole database." />
      <section className="card"><h3>Export to CSV</h3><p className="small muted">Opens in Excel or Google Sheets. Every download is recorded in the audit log.{user.role !== 'admin' && !(user.perms || []).includes('contacts') && <> Emails and mobile numbers are masked for your access level. <Badge tone="warn">masked</Badge></>}</p>
        <div className="exp-grid">{d.exports.map((x) => <a key={x.key} className="exp-card" href={`/api/admin/export/${x.key}`} download><b>{x.label}</b><small>{x.hint}</small><span className="btn btn-ghost btn-sm">Download CSV</span></a>)}</div></section>
      {user.role === 'admin' && <Backups />}
    </>
  );
}
