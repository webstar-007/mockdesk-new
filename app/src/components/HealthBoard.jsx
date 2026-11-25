import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from './Modal.jsx';

const ago = (ms) => { if (!ms) return 'never'; const d = Math.floor((Date.now() - ms) / 86400000); return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const LEVEL = { risk: 'Needs attention', watch: 'Keep an eye', ok: 'On track' };
const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
function Spark({ data }) {
  if (!data || data.length < 2) return <span className="muted small">–</span>;
  const lo = Math.min(...data), hi = Math.max(...data), r = hi - lo || 1; const w = 70, h = 24;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * (w - 4) + 2},${h - 3 - ((v - lo) / r) * (h - 6)}`).join(' ');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Recent scores ${data.join(', ')} percent`}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** One screen for "who is slipping?": used by teachers (/teacher/health) and admins (Students > Batch health). */
export default function HealthBoard({ base }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [bid, setBid] = useState(null);
  const [level, setLevel] = useState('attention'); const [pick, setPick] = useState(new Set()); const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const load = useCallback(() => api.get(`${base}/batch-health`).then((x) => { setD(x); setBid((b) => b ?? x.batches[0]?.id ?? null); }).catch((e) => setErr(e.message)), [base]);
  useEffect(() => { load(); }, [load]);
  const batch = d?.batches.find((b) => b.id === bid);
  const rows = useMemo(() => (batch?.students || []).filter((s) => (level === 'all' ? true : level === 'attention' ? s.level !== 'ok' : s.level === level)), [batch, level]);
  const toggle = (id) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAttention = () => setPick(new Set((batch?.students || []).filter((s) => s.level !== 'ok').map((s) => s.id)));
  async function send(ids) {
    setBusy(true); setNote('');
    try {
      const r = await api.post(`${base}/batch-health/nudge`, { batchId: bid, userIds: ids, message: msg });
      setNote(`Sent to ${r.sent} student${r.sent === 1 ? '' : 's'}${r.already ? `. ${r.already} already got a nudge today` : ''}.`); setAsk(false); setMsg(''); setPick(new Set()); load();
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  }
  if (err) return <p className="alert" role="alert">{err}</p>;
  if (!d) return <p className="muted" role="status">Loading…</p>;
  if (!d.batches.length) return <div className="card v24-empty"><h3>No batches yet</h3><p className="muted">Create a batch and add students. This board then shows who is slipping.</p></div>;
  const t = d.totals;
  return (
    <div className="hb">
      <div className="hb-tiles">
        <div className="hb-tile bad"><b>{t.risk}</b><span>need attention</span></div>
        <div className="hb-tile warn"><b>{t.watch}</b><span>to keep an eye on</span></div>
        <div className="hb-tile good"><b>{t.ok}</b><span>on track</span></div>
        <div className="hb-tile"><b>{t.students}</b><span>students in {d.batches.length} batch{d.batches.length === 1 ? '' : 'es'}</span></div>
      </div>
      <div className="hb-batches" role="tablist" aria-label="Batches">
        {d.batches.map((b) => (
          <button key={b.id} role="tab" aria-selected={bid === b.id} className={`hb-batch ${bid === b.id ? 'on' : ''}`} onClick={() => { setBid(b.id); setPick(new Set()); setNote(''); }}>
            <span className="hb-name">{b.name}</span>
            <span className="hb-meter" role="img" aria-label={`Health ${b.health ?? 0} percent`}><i className="r" style={{ flex: b.risk }} /><i className="w" style={{ flex: b.watch }} /><i className="o" style={{ flex: b.ok }} /></span>
            <small className="muted">{b.total ? `${b.health}% healthy · ${b.risk} at risk` : 'No students'}</small>
          </button>))}
      </div>
      {batch && (
        <section className="card hb-list">
          <div className="hb-bar">
            <div className="chips" role="group" aria-label="Show">
              {[['attention', `Needs a look (${batch.risk + batch.watch})`], ['risk', `Attention (${batch.risk})`], ['ok', `On track (${batch.ok})`], ['all', `Everyone (${batch.total})`]].map(([k, l]) => <button key={k} className={`chip ${level === k ? 'on' : ''}`} aria-pressed={level === k} onClick={() => setLevel(k)}>{l}</button>)}
            </div>
            <div className="hb-acts">
              <button className="btn btn-ghost btn-sm" onClick={selectAttention} disabled={!batch.risk && !batch.watch}>Select everyone who needs a look</button>
              <button className="btn btn-primary btn-sm" disabled={!pick.size} onClick={() => setAsk(true)}>Nudge {pick.size || ''} selected</button>
            </div>
          </div>
          {note && <p className="hb-note" role="status">{note}</p>}
          {!rows.length ? <p className="muted v24-pad">{level === 'attention' ? 'Nobody in this batch needs attention right now. Nice.' : 'Nobody here.'}</p> : (
            <ul className="hb-rows">
              {rows.map((s) => (
                <li key={s.id} className={`hb-row l-${s.level}`}>
                  <input type="checkbox" checked={pick.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} />
                  <span className="hb-av" aria-hidden="true">{initials(s.name)}</span>
                  <div className="hb-who"><b>{s.name}</b><small className="muted">{s.contact}</small></div>
                  <div className="hb-why"><span className={`hb-lvl l-${s.level}`}>{LEVEL[s.level]}</span>{s.reasons.map((r) => <span key={r} className="hb-reason">{r}</span>)}</div>
                  <div className="hb-num" title="Latest scores"><Spark data={s.spark} /><small className="muted">{s.avgPct != null ? `${s.avgPct}% avg` : 'no mocks'}</small></div>
                  <div className="hb-seen"><small className="muted">Seen {ago(s.lastActive)}</small>{s.nudgedAt && <small className="muted">Nudged {ago(s.nudgedAt)}</small>}</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setPick(new Set([s.id])); setAsk(true); }}>Nudge</button>
                </li>))}
            </ul>)}
        </section>)}
      {ask && (
        <Modal title={`Nudge ${pick.size} student${pick.size === 1 ? '' : 's'}`} onClose={() => setAsk(false)} actions={<><button className="btn btn-ghost" onClick={() => setAsk(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => send([...pick])}>{busy ? 'Sending…' : 'Send nudge'}</button></>}>
          <p className="muted small">Leave the message empty and each student gets a short note that fits their situation (for example “we have not seen you for a few days”). Each student can be nudged once a day.</p>
          <label htmlFor="hb-msg" className="small"><b>Your own message (optional)</b></label>
          <textarea id="hb-msg" rows={3} maxLength={300} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="For example: Come to the doubt class on Saturday." />
        </Modal>)}
    </div>
  );
}
