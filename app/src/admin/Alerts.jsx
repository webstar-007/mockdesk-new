import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Empty, Err, Loading, PageHead, ago, dt, toast, useLoad } from './ui.jsx';
import { LEVEL, refreshAlerts } from './AlertBell.jsx';

const TONE = { bad: 'bad', warn: 'warn', info: 'mute' };

function Settings({ d, reload }) {
  const [p, setP] = useState(d.prefs); const [emails, setEmails] = useState((d.prefs.emails || []).join(', ')); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { setP(d.prefs); setEmails((d.prefs.emails || []).join(', ')); }, [d.prefs]);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const save = async () => { setBusy(true); setErr(''); try { await api.put('/admin/alert-center/prefs', { ...p, emails }); toast('Alert settings saved'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); setErr(''); try { await api.put('/admin/alert-center/prefs', { ...p, emails }); const r = await api.post('/admin/alert-center/test'); toast(`Test sent by ${r.via.join(' and ')}`); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const num = (k, label, hint, min, max) => <label className="ad-field">{label}<input type="number" min={min} max={max} value={p[k]} onChange={(e) => set(k, e.target.value)} /><small className="muted">{hint}</small></label>;
  return (
    <div className="ad-grid g2">
      <section className="card">
        <h3>Where to send urgent alerts</h3>
        <p className="small muted">The bell always shows every alert. These extra messages go out once per problem, so you will not be flooded.</p>
        <label className="ad-chk"><input type="checkbox" checked={p.email} onChange={(e) => set('email', e.target.checked)} /> Email me {!d.channels.email && <Badge tone="warn">Email not set up</Badge>}</label>
        <label className="ad-field">Send to<input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Leave empty to use every admin's email" /></label>
        <label className="ad-chk"><input type="checkbox" checked={p.whatsapp} onChange={(e) => set('whatsapp', e.target.checked)} /> WhatsApp me {!d.channels.whatsapp && <Badge tone="warn">WhatsApp not set up</Badge>}</label>
        <label className="ad-field">WhatsApp number<input value={p.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+919876543210" inputMode="tel" /></label>
        <label className="ad-field">Send a message for<select value={p.minLevel} onChange={(e) => set('minLevel', e.target.value)}><option value="bad">Urgent alerts only</option><option value="warn">Urgent and warnings</option></select></label>
        {(!d.channels.email || !d.channels.whatsapp) && <p className="small muted">Set up email and WhatsApp under <Link to="/admin/integrations">Integrations</Link>.</p>}
        <Err>{err}</Err>
        <div className="modal-act" style={{ justifyContent: 'flex-start' }}><button className="btn btn-primary" disabled={busy} onClick={save}>Save settings</button><button className="btn btn-ghost" disabled={busy} onClick={test}>Send a test</button></div>
      </section>
      <section className="card">
        <h3>When to raise an alert</h3>
        <div className="ad-grid g2">
          {num('diskWarnPct', 'Disk warning at (% full)', 'A warning appears at this level.', 50, 98)}
          {num('diskBadPct', 'Disk urgent at (% full)', 'Must be higher than the warning.', 60, 99)}
          {num('errorSpike', 'Errors in 10 minutes', 'This many or more is an urgent alert.', 2, 200)}
          {num('backupDays', 'Days without a backup', 'A warning appears after this long.', 1, 30)}
          {num('downMinutes', 'Server gap (minutes)', 'If it was away longer than this, you are told.', 15, 240)}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}><b>If the whole server stops,</b> it cannot warn you itself. After it comes back you will see how long it was away. To be told at the moment it stops, run the small watchdog script from another computer or a free uptime service. It is explained in the Admin guide.</p>
      </section>
    </div>
  );
}

export default function Alerts() {
  const [tab, setTab] = useState('active'); const { data: d, err, loading, reload } = useLoad(`/admin/alert-center?all=${tab === 'history' ? 1 : 0}`); const { data: asg } = useLoad('/admin/assignments');
  const [busy, setBusy] = useState(false);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const act = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'bad'); } reload(); refreshAlerts(); };
  const check = async () => { setBusy(true); try { await api.post('/admin/alert-center/check'); toast('Checked just now'); reload(); refreshAlerts(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const s = d.summary;
  return (
    <>
      <PageHead title="Alerts" sub="Problems the platform found by itself, and what needs a decision."><button className="btn btn-ghost" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check now'}</button>{s.unread > 0 && <button className="btn btn-ghost" onClick={() => act(() => api.post('/admin/alert-center/read', { id: 'all' }))}>Mark all read</button>}</PageHead>
      <div className="sx-chips" role="tablist" aria-label="Alerts view">
        {[['active', `Active${s.total ? ` (${s.total})` : ''}`], ['history', 'Resolved'], ['settings', 'Delivery and thresholds']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'settings' && <Settings d={d} reload={reload} />}
      {tab === 'active' && (
        <>
          {d.items.length ? <ul className="sx-list">{d.items.map((x) => (
            <li key={x.id} className={`sx-row ${x.unread ? 'unread' : ''}`}>
              <i className={`sx-dot ${x.level}`} role="img" aria-label={LEVEL[x.level]} />
              <div className="sx-main"><b>{x.title}</b><p>{x.body}</p><small className="muted">{LEVEL[x.level]} · first seen {ago(x.firstAt)}{x.sentVia ? ` · sent by ${x.sentVia.replace(',', ' and ')}` : ''}</small></div>
              <div className="sx-act">{x.link && <Link className="btn btn-ghost btn-sm" to={`/admin/${x.link}`} onClick={() => api.post('/admin/alert-center/read', { id: x.id }).catch(() => {})}>Open</Link>}
                {x.unread && <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.post('/admin/alert-center/read', { id: x.id }))}>Mark read</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.post(`/admin/alert-center/${x.id}/snooze`, { hours: 24 }))}>Hide for a day</button></div>
            </li>))}</ul> : <Empty>All clear. Nothing needs you right now.</Empty>}
          {d.snoozed > 0 && <p className="small muted">{d.snoozed} hidden for now. They come back after a day if the problem is still there.</p>}
          <section className="card" style={{ marginTop: 16 }}>
            <h3>Teacher assignments</h3>
            {asg?.items?.length ? <div className="ad-tablewrap"><table className="ad-table"><thead><tr><th>Assignment</th><th>Batch</th><th>Teacher</th><th>Due</th><th>Finished</th></tr></thead><tbody>
              {asg.items.map((a) => <tr key={a.id}><td><b>{a.title}</b></td><td>{a.batch}</td><td>{a.teacher}</td><td>{dt(a.dueAt)} {a.overdue && <Badge tone="bad">Past due</Badge>}</td><td>{a.done} of {a.total}{a.late > 0 ? <small className="muted"> ({a.late} late)</small> : null}</td></tr>)}
            </tbody></table></div> : <p className="muted small" style={{ margin: 0 }}>No assignments yet. Teachers set them from their own dashboard.</p>}
          </section>
        </>
      )}
      {tab === 'history' && (d.history?.length ? <ul className="sx-list">{d.history.map((x) => <li key={x.id} className="sx-row done"><i className={`sx-dot ${x.level}`} aria-hidden="true" /><div className="sx-main"><b>{x.title}</b><small className="muted">Resolved {dt(x.resolvedAt)} · <Badge tone={TONE[x.level]}>{LEVEL[x.level]}</Badge></small></div></li>)}</ul> : <Empty>Nothing resolved yet.</Empty>)}
    </>
  );
}
