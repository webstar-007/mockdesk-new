import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Empty, Err, Loading, PageHead, Stat, ago, dt, toast, useLoad } from './ui.jsx';

const ROLE = { admin: 'Admin', editor: 'Staff', teacher: 'Teacher' };
const ROLE_NOTE = { admin: 'Can do everything, including this page.', editor: 'Works on content, and only on what you tick below.', teacher: 'Teachers are managed by their batches and assignments. Here you can see their activity and lock the account.' };
const short = (ua) => { const s = String(ua || ''); const b = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser'; const o = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : ''; return o ? `${b} on ${o}` : b; };
const FILTERS = [['all', 'Everyone'], ['admin', 'Admins'], ['editor', 'Staff'], ['teacher', 'Teachers'], ['online', 'Online now'], ['locked', 'Locked']];

function Avatar({ name }) { const t = String(name || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase()).join(''); return <span className="adm-av" aria-hidden="true">{t || '?'}</span>; }

/** Presets on top, then every permission as a tick box. Content is always on. */
function PermPicker({ d, perms, setPerms, disabled }) {
  const sel = new Set(perms); const same = (a) => a.length === perms.length && a.every((x) => sel.has(x));
  return (
    <div>
      <div className="adm-presets" role="group" aria-label="Starting points">{d.presets.map((p) => <button key={p.key} type="button" disabled={disabled} className={`chip ${same(p.perms) ? 'on' : ''}`} onClick={() => setPerms(p.perms)}>{p.label}</button>)}</div>
      <ul className="adm-perms">{Object.entries(d.perms).map(([k, text]) => (
        <li key={k}><label className={sel.has(k) ? 'on' : ''}><input type="checkbox" checked={sel.has(k)} disabled={disabled || k === 'content'} onChange={() => setPerms(sel.has(k) ? perms.filter((x) => x !== k) : [...perms, k])} /><span><b>{k === 'content' ? 'Content (always on)' : k[0].toUpperCase() + k.slice(1)}</b><small>{text}</small></span></label></li>
      ))}</ul>
    </div>
  );
}

function Activity({ id }) {
  const { data: d, err, loading } = useLoad(`/admin/team/${id}`);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  return (
    <div className="ad-grid g2">
      <div><h4 className="adm-h">Recent changes</h4>
        {!d.actions.length && !d.assignments.length ? <Empty>Nothing recorded yet.</Empty> : <ul className="sx-feed">{d.assignments.map((a) => <li key={'a' + a.id}><b>Set assignment</b> <span>{a.title}{a.batch ? ` for ${a.batch}` : ''}</span><time>{dt(a.at)}</time></li>)}{d.actions.slice(0, 30).map((a, i) => <li key={i}><b>{a.action.replace(/_/g, ' ')}</b> <span>{a.target}{a.detail ? ` · ${a.detail}` : ''}</span><time>{dt(a.at)}</time></li>)}</ul>}</div>
      <div><h4 className="adm-h">Signed in now ({d.sessions.length})</h4>
        {!d.sessions.length ? <p className="muted small">No active sign-ins.</p> : <ul className="sx-feed">{d.sessions.map((s) => <li key={s.id}><b>{short(s.ua)}</b> <span>{s.ip || 'unknown address'}</span><time>since {dt(s.createdAt)}</time></li>)}</ul>}
        <h4 className="adm-h" style={{ marginTop: 14 }}>Recent sign-ins</h4>
        {!d.logins.length ? <p className="muted small">None yet.</p> : <ul className="sx-feed">{d.logins.map((l, i) => <li key={i}><b className={l.ok ? '' : 'sx-bad'}>{l.ok ? 'Signed in' : 'Failed'}</b> <span>{short(l.ua)} · {l.ip || ''}{l.note ? ` · ${l.note}` : ''}</span><time>{dt(l.at)}</time></li>)}</ul>}</div>
    </div>
  );
}

function Manage({ p, d, reload, ask }) {
  const [tab, setTab] = useState(p.role === 'teacher' ? 'activity' : 'access'); const [perms, setPerms] = useState(p.perms.length ? p.perms : ['content']); const [role, setRole] = useState(p.role); const [busy, setBusy] = useState(false);
  const changed = role !== p.role || (role === 'editor' && [...perms].sort().join() !== [...p.perms].sort().join());
  const save = async () => { setBusy(true); try { await api.put(`/admin/administrators/${p.id}`, role === p.role ? { perms } : { role, perms }); toast('Saved'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const locked = p.self || p.builtIn;
  return (
    <div className="adm-manage">
      <div className="lt-views" role="tablist">{[['access', 'Access', p.role !== 'teacher'], ['activity', 'Activity and sign-ins', true], ['actions', 'Account actions', !p.self]].filter((x) => x[2]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'access' && (
        <div>
          <p className="muted small" style={{ marginTop: 0 }}>{ROLE_NOTE[role]}</p>
          <div className="adm-roles" role="radiogroup" aria-label="Role">{[['admin', 'Admin', 'Full access'], ['editor', 'Staff', 'Only what you tick']].map(([k, l, t]) => <label key={k} className={role === k ? 'on' : ''}><input type="radio" name={`role-${p.id}`} disabled={locked} checked={role === k} onChange={() => setRole(k)} /><b>{l}</b><small>{t}</small></label>)}</div>
          {locked && <p className="small muted">{p.self ? 'You cannot change your own access.' : 'The built-in admin account always stays an admin.'}</p>}
          {role === 'editor' && <PermPicker d={d} perms={perms} setPerms={setPerms} disabled={p.self} />}
          {role === 'admin' && p.role === 'editor' && <p className="alert" role="status">Making {p.name} an admin gives full access, including student contact details and this page.</p>}
          <p><button className="btn btn-primary" disabled={!changed || busy || p.self} onClick={save}>Save changes</button></p>
        </div>
      )}
      {tab === 'activity' && <Activity id={p.id} />}
      {tab === 'actions' && (
        <div className="adm-acts">
          <div><b>Sign out everywhere</b><small>Ends every session now. They can sign in again.</small><button className="btn btn-ghost btn-sm" disabled={!p.sessions} onClick={() => ask({ kind: 'out', p })}>Sign out ({p.sessions})</button></div>
          {p.status === 'suspended' ? <div><b>Unlock the account</b><small>Lets them sign in again.</small><button className="btn btn-primary btn-sm" onClick={() => ask({ kind: 'unlock', p })}>Unlock</button></div>
            : <div><b>Lock the account</b><small>Ends every session and blocks sign-in until you unlock it.</small><button className="btn btn-danger btn-sm" disabled={p.builtIn} onClick={() => ask({ kind: 'lock', p })}>Lock</button></div>}
          {p.role !== 'teacher' && <div><b>Remove access</b><small>They go back to being a normal student account.</small><button className="btn btn-danger btn-sm" disabled={p.builtIn} onClick={() => ask({ kind: 'remove', p })}>Remove {p.role === 'admin' ? 'admin' : 'staff'} access</button></div>}
        </div>
      )}
    </div>
  );
}

function Invite({ d, onDone }) {
  const [contact, setContact] = useState(''); const [role, setRole] = useState('editor'); const [perms, setPerms] = useState(d.presets.find((x) => x.key === d.config.defaultPreset)?.perms || ['content']); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api.post('/admin/administrators/invite', { contact, role, perms }); toast(r.status === 'promoted' ? `${r.name} now has access` : 'Invitation saved. Access starts when they sign up or sign in.'); setContact(''); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <form className="card adm-invite" onSubmit={go}>
      <h3 style={{ marginTop: 0 }}>Give someone access</h3>
      <p className="muted small">Enter their email or mobile number. If they already have an account, access starts now. If not, it starts the first time they sign up or sign in with it.</p>
      <label className="ad-field" style={{ maxWidth: 420 }}>Email or mobile number<input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="teacher@example.com" autoComplete="off" required /></label>
      <div className="adm-roles" role="radiogroup" aria-label="Role">{[['editor', 'Staff', 'Only what you tick'], ['admin', 'Admin', `Full access (${d.counts.admins + d.invites.filter((i) => i.role === 'admin').length} of ${d.config.maxAdmins} used)`]].map(([k, l, t]) => <label key={k} className={role === k ? 'on' : ''}><input type="radio" name="inv-role" checked={role === k} onChange={() => setRole(k)} /><b>{l}</b><small>{t}</small></label>)}</div>
      {role === 'editor' && <PermPicker d={d} perms={perms} setPerms={setPerms} />}
      {err && <p className="alert" role="alert">{err}</p>}
      <p style={{ marginBottom: 0 }}><button className="btn btn-primary" disabled={busy || !contact.trim()}>{busy ? 'Saving…' : 'Give access'}</button></p>
    </form>
  );
}

function Rules({ d, reload }) {
  const [f, setF] = useState(d.config); const [busy, setBusy] = useState(false); const dirty = JSON.stringify(f) !== JSON.stringify(d.config);
  const save = async () => { setBusy(true); try { await api.put('/admin/administrators-config', f); toast('Rules saved'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Team rules</h3>
      <div className="ad-grid g2">
        <label className="ad-field">Most admins allowed<input type="number" min="1" max="50" value={f.maxAdmins} onChange={(e) => setF({ ...f, maxAdmins: Number(e.target.value) })} /><small className="muted">Stops admin access spreading. You have {d.counts.admins} now.</small></label>
        <label className="ad-field">New staff start as<select value={f.defaultPreset} onChange={(e) => setF({ ...f, defaultPreset: e.target.value })}>{d.presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select><small className="muted">The access ticked by default when you give someone staff access.</small></label>
        <label className="ad-field">Flag accounts nobody uses<select value={f.inactiveDays} onChange={(e) => setF({ ...f, inactiveDays: Number(e.target.value) })}>{[[0, 'Off'], [30, 'After 30 days'], [60, 'After 60 days'], [90, 'After 90 days'], [180, 'After 180 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><small className="muted">Shows an alert and a Lock button for staff who have not signed in.</small></label>
        <label className="ad-chk" style={{ alignSelf: 'center' }}><input type="checkbox" checked={f.notifyAdmins} onChange={(e) => setF({ ...f, notifyAdmins: e.target.checked })} /> Tell the other admins when someone is added, changed or removed</label>
      </div>
      <p style={{ marginBottom: 0 }}><button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>Save rules</button></p>
    </section>
  );
}

export default function Administrators() {
  const { data: d, err, loading, reload } = useLoad('/admin/administrators'); const [q, setQ] = useState(''); const [flt, setFlt] = useState('all'); const [open, setOpen] = useState(null); const [inv, setInv] = useState(false); const [dlg, setDlg] = useState(null); const [busy, setBusy] = useState(false); const [e2, setE2] = useState('');
  const refresh = useCallback(() => reload(), [reload]); const timer = useRef(null);
  useEffect(() => { timer.current = setInterval(() => { if (!document.hidden) refresh(); }, 30000); return () => clearInterval(timer.current); }, [refresh]);
  const list = useMemo(() => (d?.people || []).filter((p) => {
    if (flt === 'online' && !p.online) return false; if (flt === 'locked' && p.status !== 'suspended') return false; if (['admin', 'editor', 'teacher'].includes(flt) && p.role !== flt) return false;
    const s = q.trim().toLowerCase(); return !s || [p.name, p.email, p.phone].some((x) => String(x || '').toLowerCase().includes(s));
  }), [d, q, flt]);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const c = d.counts; const idle = new Set(d.inactive);
  const run = async (fn, ok) => { setBusy(true); setE2(''); try { await fn(); if (ok) toast(ok); setDlg(null); reload(); } catch (e) { setE2(e.message); } finally { setBusy(false); } };
  const confirm = () => {
    const p = dlg.p; const k = dlg.kind;
    if (k === 'lock') return run(() => api.post(`/admin/team/${p.id}/lock`, { reason: dlg.reason || '' }), 'Locked');
    if (k === 'unlock') return run(() => api.post(`/admin/team/${p.id}/unlock`), 'Unlocked');
    if (k === 'out') return run(() => api.post(`/admin/team/${p.id}/signout`), 'Signed out');
    if (k === 'remove') return run(() => api.del(`/admin/administrators/${p.id}`), 'Access removed');
    if (k === 'all') return run(async () => { const r = await api.post('/admin/team/lock-all'); toast(`${r.locked} account${r.locked === 1 ? '' : 's'} locked`); });
    if (k === 'idle') return run(async () => { const r = await api.post('/admin/administrators-lock-inactive'); toast(`${r.locked} account${r.locked === 1 ? '' : 's'} locked`); });
    return null;
  };
  const T = { lock: ['Lock', 'Lock account', true], unlock: ['Unlock', 'Unlock', false], out: ['Sign out', 'Sign out', false], remove: ['Remove access for', 'Remove access', true] };
  return (
    <>
      <PageHead title="Administrators" sub="Everyone who runs MockDesk, what each person may do, and the rules that keep the team safe.">
        <button className="btn btn-primary" onClick={() => setInv(!inv)} aria-expanded={inv}>{inv ? 'Close' : 'Give someone access'}</button>
      </PageHead>
      <div className="ad-grid g4" style={{ marginBottom: 12 }}>
        <Stat icon="🛡" label="Admins" value={`${c.admins} of ${d.config.maxAdmins}`} /><Stat icon="🧰" label="Staff" value={c.staff} /><Stat icon="👩‍🏫" label="Teachers" value={c.teachers} /><Stat icon="🟢" label="Online now" value={c.online} sub={c.locked ? `${c.locked} locked` : 'none locked'} />
      </div>
      {d.inactive.length > 0 && <div className="alert" role="status"><b>{d.inactive.length} account{d.inactive.length > 1 ? 's have' : ' has'} not been used for {d.config.inactiveDays}+ days.</b> <button className="btn btn-ghost btn-sm" onClick={() => setDlg({ kind: 'idle' })}>Lock them</button></div>}
      {inv && <Invite d={d} onDone={() => { reload(); }} />}
      {d.invites.length > 0 && <section className="card" style={{ marginBottom: 12 }}><h3 style={{ marginTop: 0 }}>Waiting for sign-up</h3><ul className="adm-inv">{d.invites.map((i) => <li key={i.id}><span><b>{i.contact}</b> <Badge tone={i.role === 'admin' ? 'brand' : 'warn'}>{ROLE[i.role]}</Badge> <small className="muted">invited by {i.byName} {ago(i.at)}</small></span><button className="btn btn-ghost btn-sm" onClick={() => run(() => api.del(`/admin/administrators/invites/${i.id}`), 'Invitation cancelled')}>Cancel</button></li>)}</ul></section>}

      <div className="adm-bar">
        <input type="search" className="adm-search" aria-label="Search people" placeholder="Search by name, email or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="adm-filters" role="group" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k} type="button" className={`chip ${flt === k ? 'on' : ''}`} aria-pressed={flt === k} onClick={() => setFlt(k)}>{l}</button>)}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setDlg({ kind: 'all' })}>Lock all staff and teachers</button>
      </div>
      {!list.length ? <Empty>No one matches. Clear the search or choose Everyone.</Empty> : (
        <ul className="adm-list">{list.map((p) => (
          <li key={p.id} className={`adm-p ${p.status === 'suspended' ? 'locked' : ''}`}>
            <div className="adm-row">
              <Avatar name={p.name} />
              <div className="adm-main">
                <div><b>{p.name}</b> <Badge tone={p.role === 'admin' ? 'brand' : p.role === 'editor' ? 'warn' : ''}>{ROLE[p.role]}</Badge>{p.self && <> <Badge>You</Badge></>}{p.builtIn && <> <Badge>Built-in</Badge></>}{p.status === 'suspended' && <> <Badge tone="bad">Locked</Badge></>}{p.online && <> <Badge tone="good">Online</Badge></>}{idle.has(p.id) && <> <Badge tone="warn">Unused</Badge></>}</div>
                <small className="muted">{p.email || p.phone}</small>
                <small className="muted">{p.lastSeen ? `Seen ${ago(p.lastSeen)}` : 'Never seen'} · {p.sessions} sign-in{p.sessions === 1 ? '' : 's'} · {p.actions7} {p.role === 'teacher' ? 'assignment' : 'change'}{p.actions7 === 1 ? '' : 's'} this week{p.failed24 > 0 && <b className="sx-bad"> · {p.failed24} failed sign-in{p.failed24 > 1 ? 's' : ''} today</b>}</small>
                {p.role === 'editor' && <small className="adm-pills">{p.perms.map((x) => <span key={x}>{x}</span>)}</small>}
              </div>
              <button className="btn btn-ghost btn-sm" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Close' : 'Manage'}</button>
            </div>
            {open === p.id && <Manage key={`${p.id}-${p.role}-${p.perms.join()}-${p.status}`} p={p} d={d} reload={reload} ask={setDlg} />}
          </li>))}</ul>
      )}

      <div className="ad-grid g2" style={{ marginTop: 14, alignItems: 'start' }}>
        <Rules key={JSON.stringify(d.config)} d={d} reload={reload} />
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Who can do what</h3>
          <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Access</th>{d.presets.map((p) => <th key={p.key}>{p.label}</th>)}<th>Admin</th></tr></thead>
            <tbody>{Object.entries(d.perms).map(([k, t]) => <tr key={k}><td><b>{k}</b><br /><small className="muted">{t}</small></td>{d.presets.map((p) => <td key={p.key}>{p.perms.includes(k) ? '✓' : '–'}</td>)}<td>✓</td></tr>)}</tbody></table></div>
          <details style={{ marginTop: 10 }}><summary className="small">Advanced: the admins.txt file</summary>
            <p className="small">You can also list emails or mobile numbers in <code>{d.file.path}</code>, one per line (add the word <code>editor</code> for staff). People listed there get access the next time they sign in. Removing a line later does not take access away; use Remove access here.</p>
            {d.file.listed.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.file.listed.map((x) => <li key={x.contact}>{x.contact} ({x.role})</li>)}</ul> : <p className="small muted">Nothing listed yet.</p>}
            {d.file.ignored.length > 0 && <p className="small sx-bad">Could not read: {d.file.ignored.join(', ')}</p>}
          </details>
        </section>
      </div>

      {dlg && T[dlg.kind] && <ConfirmModal title={`${T[dlg.kind][0]} ${dlg.p.name}?`} label={T[dlg.kind][1]} danger={T[dlg.kind][2]} busy={busy} error={e2} onClose={() => { setDlg(null); setE2(''); }} onConfirm={confirm}>
        {dlg.kind === 'lock' && <><p>{dlg.p.name} is signed out everywhere and cannot sign in until you unlock them.</p><label className="ad-field">Reason (optional, saved in the audit log)<input value={dlg.reason || ''} maxLength={200} onChange={(e) => setDlg({ ...dlg, reason: e.target.value })} /></label></>}
        {dlg.kind === 'remove' && <p>{dlg.p.name} goes back to a normal student account and is signed out. You can give access again later.</p>}
        {dlg.kind === 'out' && <p>This ends {dlg.p.sessions} active session{dlg.p.sessions === 1 ? '' : 's'}. They can sign in again.</p>}
        {dlg.kind === 'unlock' && <p>{dlg.p.name} will be able to sign in again.</p>}</ConfirmModal>}
      {dlg?.kind === 'all' && <ConfirmModal title="Lock all staff and teachers?" word="lock" label="Lock everyone" danger busy={busy} error={e2} onClose={() => { setDlg(null); setE2(''); }} onConfirm={confirm}><p>Every staff and teacher account is signed out and locked. Admins and you are not affected. Use this if you think an account was misused.</p></ConfirmModal>}
      {dlg?.kind === 'idle' && <ConfirmModal title="Lock unused accounts?" label="Lock them" danger busy={busy} error={e2} onClose={() => { setDlg(null); setE2(''); }} onConfirm={confirm}><p>Locks the {d.inactive.length} account{d.inactive.length > 1 ? 's' : ''} marked Unused. You can unlock anyone later.</p></ConfirmModal>}
    </>
  );
}
