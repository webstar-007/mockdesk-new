import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Err, Loading, PageHead, Stat, ago, dt, toast, useLoad } from './ui.jsx';

export default function Security() {
  const [only, setOnly] = useState(''); const { data, err, loading, reload } = useLoad(`/admin/security?only=${only}`, [only]); const [ask, setAsk] = useState(null);
  if (loading && !data) return <Loading />; if (err) return <Err>{err}</Err>;
  const out = async (who) => { try { const r = await api.post('/admin/security/sign-out-all', { who }); toast(`${r.signedOut} sign-in(s) ended`); setAsk(null); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Security" sub="Who signed in, who failed to, and how to end sign-ins quickly."><button className="btn btn-ghost" onClick={reload}>↻ Refresh</button></PageHead>
      <div className="ad-grid g4" style={{ marginBottom: 14 }}>
        <Stat icon="✅" tone="good" label="Sign-ins, 24 hours" value={data.ok24} /><Stat icon="⛔" tone={data.failed24 > 20 ? 'bad' : ''} label="Failed attempts, 24 hours" value={data.failed24} />
        <Stat icon="🔑" label="Active sign-ins" value={data.sessions} /><Stat icon="🚫" tone={data.noisy.length ? 'warn' : ''} label="Addresses with 5+ failures" value={data.noisy.length} />
      </div>
      <div className="ad-grid g2" style={{ marginBottom: 14 }}>
        <section className="card"><h3>Emergency actions</h3><p className="small muted">Ends sign-ins immediately. People sign in again with their password or a code. You stay signed in.</p>
          <div className="ad-pill-row"><button className="btn btn-ghost btn-sm" onClick={() => setAsk('students')}>Sign out all students</button><button className="btn btn-ghost btn-sm" onClick={() => setAsk('everyone')}>Sign out everyone else</button></div>
          <p className="small muted" style={{ marginTop: 10 }}>To stop a repeat offender, <Link to="/admin/control">block their address</Link>. To lock one student out, suspend them on their page.</p></section>
        <section className="card"><h3>Addresses with many failures</h3>{!data.noisy.length ? <p className="muted">None in the last 24 hours.</p> : <ul className="plain" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>{data.noisy.map((x) => <li key={x.ip}><code>{x.ip}</code> <Badge tone="bad">{x.n} failed</Badge></li>)}</ul>}</section>
      </div>
      <section className="card" style={{ marginBottom: 14 }}><h3>Admins and staff</h3><div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Name</th><th>Role</th><th>Last active</th><th>Last address</th></tr></thead><tbody>
        {data.staff.map((s) => <tr key={s.id} className="click"><td className="nm"><b>{s.name}</b><small>{s.email}</small></td><td><Badge tone={s.role === 'admin' ? 'good' : 'mute'}>{s.role === 'admin' ? 'Admin' : 'Staff'}</Badge></td><td>{ago(s.last_seen)}</td><td><code>{s.last_ip || '–'}</code></td></tr>)}</tbody></table></div></section>
      <section className="card nopad">
        <div style={{ padding: '14px 16px 0' }}><h3>Sign-in log</h3><div className="ad-pill-row" style={{ marginBottom: 10 }}>{[['', 'All'], ['failed', 'Failed only']].map(([k, l]) => <button key={k} className={`ad-pill ${only === k ? 'on' : ''}`} onClick={() => setOnly(k)}>{l}</button>)}</div></div>
        {!data.log.length ? <p className="muted" style={{ padding: 16 }}>Nothing recorded yet.</p> : <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>When</th><th>Who</th><th>Result</th><th>How</th><th>Address</th><th>Device</th></tr></thead><tbody>
          {data.log.map((x) => <tr key={x.id}><td>{dt(x.at)}</td><td className="nm"><b>{x.name || x.who || '–'}</b>{x.name && <small>{x.who}</small>}</td><td>{x.ok ? <Badge tone="good">Signed in</Badge> : <Badge tone="bad">Failed</Badge>}{x.note && <small className="muted" style={{ display: 'block' }}>{x.note}</small>}</td><td>{x.method}</td><td><code>{x.ip || '–'}</code></td><td><small className="muted">{(x.ua || '').slice(0, 60)}</small></td></tr>)}</tbody></table></div>}
        <p className="small muted" style={{ padding: '0 16px 14px' }}>The log keeps 90 days.</p>
      </section>
      {ask && <ConfirmModal title={ask === 'students' ? 'Sign out all students?' : 'Sign out everyone else?'} label="Sign out" danger onClose={() => setAsk(null)} onConfirm={() => out(ask)}>Everyone signed in will need to sign in again. Tests in progress keep their answers.</ConfirmModal>}
    </>
  );
}
