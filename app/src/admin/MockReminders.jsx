import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, dt, toast, useLoad } from './ui.jsx';

const TONE = { sent: 'good', due: 'warn', later: 'mute' };
const WORD = { sent: 'Sent', due: 'Due now', later: 'Scheduled' };
/** Reminders for scheduled and live mocks. Lives on Messages > Reminder rules. */
export default function MockReminders() {
  const { data, reload } = useLoad('/admin/mock-reminders'); const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF(data.config); }, [data]);
  if (!data || !f) return null;
  async function save(next) { setBusy(true); try { const r = await api.put('/admin/mock-reminders', next); setF(r.config); toast('Mock reminders saved'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } }
  const flip = (k) => { const n = { ...f, [k]: !f[k] }; setF(n); save(n); };
  return (
    <section className="card" style={{ marginTop: 14 }} aria-label="Scheduled mock reminders">
      <h3>Scheduled mocks</h3>
      <p className="muted small">When you give a mock an opening time (Tests > Mocks > “Available from”), students who have not taken it are reminded automatically. For live tests, students who have not started are nudged a few minutes after it opens.</p>
      <div className="adm-checks">
        <label className="adm-check"><input type="checkbox" checked={f.enabled} disabled={busy} onChange={() => flip('enabled')} /> Send reminders for scheduled mocks</label>
        <label className="adm-check"><input type="checkbox" checked={f.dayBefore} disabled={busy || !f.enabled} onChange={() => flip('dayBefore')} /> 1 day before</label>
        <label className="adm-check"><input type="checkbox" checked={f.hourBefore} disabled={busy || !f.enabled} onChange={() => flip('hourBefore')} /> 1 hour before</label>
        <label className="adm-check"><input type="checkbox" checked={f.noStart} disabled={busy || !f.enabled} onChange={() => flip('noStart')} /> Live tests: nudge students who have not started, after <input type="number" min="5" max="60" style={{ width: 64 }} value={f.noStartMins} disabled={busy || !f.enabled || !f.noStart} onChange={(e) => setF({ ...f, noStartMins: e.target.value })} onBlur={() => save(f)} /> minutes</label>
      </div>
      {!data.upcoming.length ? <p className="muted small">No mock has an opening time yet. Set one on the Mocks page and its reminders appear here.</p> : (
        <div className="tbl-wrap"><table className="ad-table"><thead><tr><th>Mock</th><th>Opens</th><th>Reminders</th></tr></thead>
          <tbody>{data.upcoming.map((m) => <tr key={m.id}><td>{m.name}{m.live && <> <Badge tone="brand">Live</Badge></>}<br /><small className="muted">{m.audience} students to remind</small></td><td>{dt(m.opensAt)}{m.closesAt && <><br /><small className="muted">closes {dt(m.closesAt)}</small></>}</td><td>{m.steps.length ? m.steps.map((s) => <div key={s.key} className="small"><Badge tone={TONE[s.state]}>{WORD[s.state]}</Badge> {s.label}{s.sent ? ` (${s.sent} sent)` : ''}</div>) : <span className="muted small">None switched on</span>}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}
