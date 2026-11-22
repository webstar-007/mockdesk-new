import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Empty, Err, Loading, PageHead, Pager, Stat, toast, useLoad } from './ui.jsx';

export default function Anomalies() {
  const [days, setDays] = useState(60); const [shown, setShown] = useState(false); const [page, setPage] = useState(1);
  const { data: d, err, loading, reload } = useLoad(`/admin/anomalies?days=${days}&dismissed=${shown ? 1 : 0}&page=${page}&size=20`);
  const dismiss = async (p) => { try { await api.post('/admin/anomalies/dismiss', { key: p.key, undo: p.dismissed }); toast(p.dismissed ? 'Reopened' : 'Marked as fine'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const s = d.summary;
  return (
    <>
      <PageHead title="Copy check" sub="Pairs of students who got the same questions wrong in the same way, and accounts that share a device or network. A match is a reason to look, not proof of cheating." />
      <div className="ad-grid g4">
        <Stat icon="🔴" tone={s.high ? 'bad' : ''} label="Strong matches" value={s.high} sub="Many identical wrong answers" />
        <Stat icon="🟠" tone={s.medium ? 'warn' : ''} label="Possible matches" value={s.medium} />
        <Stat icon="📱" label="Shared devices" value={d.devices.length} sub="3 or more students" />
        <Stat icon="🔎" label="Tests compared" value={s.checked} sub={`Last ${s.days} days`} />
      </div>
      <div className="card nopad" style={{ marginTop: 14 }}>
        <div className="ad-toolbar" style={{ padding: '12px 14px' }}>
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }} aria-label="Period"><option value={14}>Last 14 days</option><option value={60}>Last 60 days</option><option value={180}>Last 180 days</option></select>
          <label className="ad-chk"><input type="checkbox" checked={shown} onChange={(e) => { setShown(e.target.checked); setPage(1); }} /> Include ones marked fine</label>
        </div>
        {!d.pairs.length ? <Empty>No matching pairs found. 🎉</Empty> : <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Students</th><th>Mock</th><th>Same wrong answers</th><th>Also</th><th /></tr></thead>
          <tbody>{d.pairs.map((p) => (
            <tr key={p.key} className={p.dismissed ? 'ad-dim' : ''}>
              <td className="nm"><Link to={`/admin/users/${p.a.userId}`}><b>{p.a.name}</b></Link> <span className="muted">and</span> <Link to={`/admin/users/${p.b.userId}`}><b>{p.b.name}</b></Link><small style={{ display: 'block' }}>{p.a.score}/{p.a.max} and {p.b.score}/{p.b.max}</small></td>
              <td>{p.mockName}</td>
              <td><Badge tone={p.level === 'high' ? 'bad' : 'warn'}>{p.sharedWrong} identical</Badge><small style={{ display: 'block' }}>of {p.wrongA} and {p.wrongB} wrong. {p.agreement}% of shared answers match.</small></td>
              <td><div className="ad-flags">{p.sameDevice && <Badge tone="bad">Same device</Badge>}{p.sameIp && <Badge tone="warn">Same network</Badge>}{p.minutesApart <= 20 && <Badge tone="warn">Started {p.minutesApart} min apart</Badge>}{!p.sameDevice && !p.sameIp && p.minutesApart > 20 && <span className="muted">–</span>}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}><Link className="btn btn-ghost btn-sm" to={`/admin/attempts/${p.a.attemptId}`}>Open first</Link> <Link className="btn btn-ghost btn-sm" to={`/admin/attempts/${p.b.attemptId}`}>Open second</Link> <button className="btn btn-ghost btn-sm" onClick={() => dismiss(p)}>{p.dismissed ? 'Reopen' : 'Mark fine'}</button></td>
            </tr>))}</tbody></table></div>}
        <Pager page={page} size={20} total={d.total} onPage={setPage} />
      </div>
      <div className="ad-grid g2" style={{ marginTop: 14 }}>
        <section className="card"><h3>Shared devices</h3><p className="small muted">Several students signed in on the same browser. Classmates sharing a computer can cause this.</p>
          {!d.devices.length ? <p className="muted">None.</p> : d.devices.map((x) => <p key={x.id} style={{ margin: '8px 0' }}><b>{x.users.length} students</b> <span className="muted small">({x.id})</span><br />{x.users.map((u) => <Link key={u.id} to={`/admin/users/${u.id}`} style={{ marginRight: 10 }}>{u.name}</Link>)}</p>)}</section>
        <section className="card"><h3>Shared networks</h3><p className="small muted">Three or more students on one network address. A hostel or institute often does this.</p>
          {!d.networks.length ? <p className="muted">None.</p> : d.networks.map((x) => <p key={x.id} style={{ margin: '8px 0' }}><b>{x.users.length} students</b> <span className="muted small">({x.id})</span><br />{x.users.map((u) => <Link key={u.id} to={`/admin/users/${u.id}`} style={{ marginRight: 10 }}>{u.name}</Link>)}</p>)}</section>
      </div>
    </>
  );
}
