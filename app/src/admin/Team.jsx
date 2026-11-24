import { useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Empty, Err, Loading, PageHead, Stat, ago, dt, toast, useLoad } from './ui.jsx';

const ROLE = { admin: 'Admin', editor: 'Staff', teacher: 'Teacher' };
const short = (ua) => { const s = String(ua || ''); const b = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser'; const o = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : ''; return o ? `${b} on ${o}` : b; };

function Detail({ id, onClose, onChanged, meId }) {
  const { data: d, err, loading } = useLoad(`/admin/team/${id}`);
  if (loading && !d) return <Loading />;
  if (err) return <Err>{err}</Err>;
  const p = d.person;
  return (
    <section className="card sx-team-detail" aria-label={`Activity of ${p.name}`}>
      <div className="sx-team-head"><div><h2>{p.name}</h2><span className="muted small">{p.email || p.phone} · {ROLE[p.role]}</span></div><button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>
      <div className="ad-grid g2">
        <div>
          <h3>Recent changes</h3>
          {!d.actions.length && !d.assignments.length ? <Empty>Nothing recorded yet.</Empty> : (
            <ul className="sx-feed">
              {d.assignments.map((a) => <li key={'a' + a.id}><b>Set assignment</b> <span>{a.title}{a.batch ? ` for ${a.batch}` : ''}</span><time>{dt(a.at)}</time></li>)}
              {d.actions.map((a, i) => <li key={i}><b>{a.action.replace(/_/g, ' ')}</b> <span>{a.target}{a.detail ? ` · ${a.detail}` : ''}</span><time>{dt(a.at)}</time></li>)}
            </ul>
          )}
        </div>
        <div>
          <h3>Signed in now ({d.sessions.length})</h3>
          {!d.sessions.length ? <p className="muted small">No active sign-ins.</p> : <ul className="sx-feed">{d.sessions.map((s) => <li key={s.id}><b>{short(s.ua)}</b> <span>{s.ip || 'unknown address'}</span><time>since {dt(s.createdAt)}</time></li>)}</ul>}
          <h3 style={{ marginTop: 16 }}>Recent sign-ins</h3>
          {!d.logins.length ? <p className="muted small">None yet.</p> : <ul className="sx-feed">{d.logins.map((l, i) => <li key={i}><b className={l.ok ? '' : 'sx-bad'}>{l.ok ? 'Signed in' : 'Failed'}</b> <span>{short(l.ua)} · {l.ip || ''}{l.note ? ` · ${l.note}` : ''}</span><time>{dt(l.at)}</time></li>)}</ul>}
        </div>
      </div>
    </section>
  );
}

export default function Team() {
  const { data: d, err, loading, reload } = useLoad('/admin/team');
  const [open, setOpen] = useState(null); const [dlg, setDlg] = useState(null); const [busy, setBusy] = useState(false); const [e2, setE2] = useState('');
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const run = async (fn, okMsg) => { setBusy(true); setE2(''); try { const r = await fn(); toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); setDlg(null); reload?.(); } catch (x) { setE2(x.message); } finally { setBusy(false); } };
  return (
    <>
      <PageHead title="Team activity" sub="Everyone with admin, staff or teacher access: who is signed in, what they changed, and a way to lock an account in one click.">
        <button className="btn btn-danger" onClick={() => setDlg({ kind: 'all' })}>Lock all staff and teachers</button>
      </PageHead>
      <div className="ad-grid g4" style={{ marginBottom: 14 }}>
        <Stat icon="👥" label="Team members" value={d.people.length} />
        <Stat icon="🟢" label="Active in the last 5 minutes" value={d.online} />
        <Stat icon="🔒" label="Locked" value={d.locked} tone={d.locked ? 'warn' : ''} />
      </div>
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}><table className="ad-table">
          <thead><tr><th>Person</th><th>Role</th><th>Last active</th><th>Signed in</th><th>Changes (7 days)</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.people.map((p) => (
            <tr key={p.id}>
              <td><button className="sx-link" onClick={() => setOpen(open === p.id ? null : p.id)}>{p.name}</button><br /><small className="muted">{p.email || p.phone}</small></td>
              <td>{ROLE[p.role]}</td>
              <td>{p.online ? <Badge tone="good">Active now</Badge> : ago(p.lastSeen)}{p.failed24 >= 3 && <><br /><small className="sx-bad">{p.failed24} failed sign-ins today</small></>}</td>
              <td>{p.sessions} device{p.sessions === 1 ? '' : 's'}</td>
              <td>{p.actions7}</td>
              <td>{p.status === 'suspended' ? <Badge tone="bad">Locked</Badge> : <Badge tone="good">Active</Badge>}</td>
              <td className="sx-acts">
                {p.self ? <small className="muted">You</small> : <>
                {p.sessions > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setDlg({ kind: 'out', p })}>Sign out</button>}
                {p.status === 'suspended'
                  ? <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.post(`/admin/team/${p.id}/unlock`), 'Unlocked')}>Unlock</button>
                  : <button className="btn btn-ghost btn-sm" onClick={() => setDlg({ kind: 'lock', p })}>Lock</button>}
                </>}
              </td>
            </tr>))}
          </tbody>
        </table></div>
      </section>
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
      {dlg?.kind === 'lock' && <ConfirmModal title={`Lock ${dlg.p.name}?`} label="Lock account" danger busy={busy} error={e2} onClose={() => setDlg(null)} onConfirm={() => run(() => api.post(`/admin/team/${dlg.p.id}/lock`, {}), 'Locked and signed out')}><p>They are signed out of every device right now and cannot sign in until you unlock them. Their work is kept.</p></ConfirmModal>}
      {dlg?.kind === 'out' && <ConfirmModal title={`Sign ${dlg.p.name} out?`} label="Sign out" busy={busy} error={e2} onClose={() => setDlg(null)} onConfirm={() => run(() => api.post(`/admin/team/${dlg.p.id}/signout`, {}), 'Signed out')}><p>Ends their sign-in on every device. They can sign in again.</p></ConfirmModal>}
      {dlg?.kind === 'all' && <ConfirmModal title="Lock all staff and teachers?" word="lock" label="Lock everyone" danger busy={busy} error={e2} onClose={() => setDlg(null)} onConfirm={() => run(() => api.post('/admin/team/lock-all', {}), (r) => `Locked ${r.locked} account${r.locked === 1 ? '' : 's'}`)}><p>Use this if you think an account was taken over. Every staff and teacher account is locked and signed out. Admins, including you, are not affected. You can unlock people one by one afterwards.</p></ConfirmModal>}
    </>
  );
}
