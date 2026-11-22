import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Err, Loading, PageHead, Stat, dt, toast, useLoad } from './ui.jsx';

const hr = (h) => `${String(h).padStart(2, '0')}:00`;
export default function Notifications() {
  const { data, err, loading, reload } = useLoad('/admin/notifications'); const [c, setC] = useState(null); const [busy, setBusy] = useState(false); const [run, setRun] = useState(null); const [wa, setWa] = useState(null);
  useEffect(() => { if (data && !c) { setC(JSON.parse(JSON.stringify(data.config))); setWa(JSON.parse(JSON.stringify(data.whatsapp.config))); } }, [data]); // eslint-disable-line
  if ((loading && !data) || !c || !wa) return <><Err>{err}</Err><Loading /></>;
  const up = (path, v) => setC((x) => { const n = JSON.parse(JSON.stringify(x)); let o = n; const ks = path.split('.'); ks.slice(0, -1).forEach((k) => { o = o[k]; }); o[ks.at(-1)] = v; return n; });
  const save = async () => { setBusy(true); try { await api.put('/admin/notifications/config', { ...c, whatsapp: wa }); toast('Saved'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const runNow = async () => { if (!window.confirm('Send reminders now to everyone who is due one? Quiet hours are ignored.')) return; setBusy(true); try { const r = await api.post('/admin/notifications/run'); setRun(r); toast('Reminders sent'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const test = async () => { try { const r = await api.post('/admin/notifications/test'); toast(`Test sent to you: ${Object.entries(r.result).map(([k, v]) => `${k} ${v}`).join(', ')}`); } catch (e) { toast(e.message, 'bad'); } };
  const kindName = { reminder: 'Reminders', digest: 'Weekly summary', live_results: 'Live mock results', welcome: 'Welcome', nudge: 'Nudges', campaign: 'Admin messages', fix: 'Score corrections', teacher_note: 'Teacher notes', personal_best: 'Personal bests', announcement: 'Announcements', test: 'Tests' };
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const w = data.whatsapp;
  const f = data.flags; const st = data.stats; const pv = data.preview?.rules || {};
  const rules = [
    ['inactive', 'Haven’t practised', `“It has been N days since you practised”`, <span>Send after <input className="num" type="number" min="2" max="60" value={c.inactive.days} onChange={(e) => up('inactive.days', Number(e.target.value))} /> days without a test, then at most every <input className="num" type="number" min="2" max="60" value={c.inactive.repeatDays} onChange={(e) => up('inactive.repeatDays', Number(e.target.value))} /> days.</span>],
    ['welcome', 'New student nudge', '“Ready for your first mock?”', <span>Send <input className="num" type="number" min="1" max="14" value={c.welcome.days} onChange={(e) => up('welcome.days', Number(e.target.value))} /> days after sign-up if they have not started a mock. Once only.</span>],
    ['liveClosing', 'Live window closing', '“Mock 6 closes today at 10:00 PM”', <span>Send <input className="num wide" value={(c.liveClosing?.hours || [6]).join(', ')} onChange={(e) => up('liveClosing.hours', e.target.value.split(/[ ,]+/).map(Number).filter(Boolean))} /> hours before a live window closes, only to students who have not started it.</span>],
    ['mockSoon', 'Live mock reminder', '“Mock 6 opens tomorrow at 10:00 AM”', <span>Send <input className="num wide" value={c.mockSoon.hours.join(', ')} onChange={(e) => up('mockSoon.hours', e.target.value.split(/[ ,]+/).map(Number).filter(Boolean))} /> hours before a mock’s release time. Uses the “Available from” time of each mock.</span>],
    ['unfinished', 'Unfinished mock', '“About 23 min left in this section”', <span>Sent once when a student has left a running test for 8 minutes or more and at least 5 minutes remain.</span>],
    ['streak', 'Streak about to end', '“Your 5-day practice streak ends tonight”', <span>Send after <select className="num" value={c.streak.hour} onChange={(e) => up('streak.hour', Number(e.target.value))}>{[16, 17, 18, 19, 20, 21].map((h) => <option key={h} value={h}>{hr(h)}</option>)}</select> to students on a streak of <input className="num" type="number" min="2" max="30" value={c.streak.minDays} onChange={(e) => up('streak.minDays', Number(e.target.value))} /> days or more who have not practised today.</span>],
    ['digest', 'Weekly summary', '“Your week on MockDesk: 62% average”', <span>Send on <select className="num wide" value={c.digest.weekday} onChange={(e) => up('digest.weekday', Number(e.target.value))}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select> at <select className="num" value={c.digest.hour} onChange={(e) => up('digest.hour', Number(e.target.value))}>{[7, 8, 9, 10, 11, 12, 17, 18, 19, 20].map((h) => <option key={h} value={h}>{hr(h)}</option>)}</select> to students who finished something that week.</span>],
  ];
  return (
    <>
      <PageHead title="Notifications" sub="Automatic reminders by push and email. Push is free. Email costs about $0.10 per 1,000."><button className="btn btn-ghost" onClick={test}>Send me a test</button><button className="btn btn-primary" onClick={save} disabled={busy}>Save settings</button></PageHead>
      <Err>{err}</Err>
      <div className="ad-grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Push subscribers" value={data.subscribers.push} sub={`of ${data.subscribers.students} students`} icon="🔔" />
        <Stat label="Emails sent, 30 days" value={st.email.sent} sub={`about $${st.emailCostUsd.toFixed(2)}`} icon="✉" />
        <Stat label="Push sent, 30 days" value={st.push.sent} sub={st.push.failed ? `${st.push.failed} failed` : 'free'} icon="📲" tone={st.push.failed ? 'warn' : ''} />
        <Stat label="Turned email off" value={data.subscribers.emailOff} icon="🚫" />
      </div>
      <div className="ad-grid g2">
        <section className="card"><h3>Channels</h3>
          <ul className="ntf-flags">
            <li><Badge tone={f.pushReady ? 'good' : 'warn'}>{f.pushReady ? 'ready' : 'unavailable'}</Badge> Push notifications. Students can turn them on from their profile, and only over https.</li>
            <li><Badge tone={f.emailReady ? 'good' : 'warn'}>{f.emailReady ? 'ready' : 'not set up'}</Badge> Email. {f.emailReady ? `Capped at ${f.emailDailyCap} a day.` : 'Add the SMTP settings (SMTP_HOST, SMTP_USER and so on) to the server settings file, the same ones used for email sign-in codes.'}</li>
            <li><Badge tone={f.publicUrl ? 'good' : 'warn'}>{f.publicUrl ? 'set' : 'missing'}</Badge> Site address (MOCKDESK_PUBLIC_URL) so email buttons link to the right place.</li>
          </ul>
          <label className="check"><input type="checkbox" checked={c.channels.push} onChange={(e) => up('channels.push', e.target.checked)} /><span>Send reminders by push</span></label>
          <label className="check"><input type="checkbox" checked={c.channels.email} onChange={(e) => up('channels.email', e.target.checked)} /><span>Send reminders by email</span></label>
          <label className="check"><input type="checkbox" checked={c.channels.whatsapp !== false} onChange={(e) => up('channels.whatsapp', e.target.checked)} /><span>Send reminders by WhatsApp<small className="muted" style={{ display: 'block' }}>Only to students who opted in, and only for the types chosen under WhatsApp below.</small></span></label>
          <div className="ad-row" style={{ marginTop: 10 }}>
            <label className="ad-field">Most per student per week<input type="number" min="1" max="20" value={c.weeklyCap} onChange={(e) => up('weeklyCap', Number(e.target.value))} /></label>
            <label className="ad-field">Most per student per day<input type="number" min="1" max="10" value={c.dailyCap} onChange={(e) => up('dailyCap', Number(e.target.value))} /></label>
            <label className="ad-field">Quiet hours ({f.tz})<span className="ntf-quiet"><select value={c.quietFrom} onChange={(e) => up('quietFrom', Number(e.target.value))} aria-label="Quiet from">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hr(h)}</option>)}</select> to <select value={c.quietTo} onChange={(e) => up('quietTo', Number(e.target.value))} aria-label="Quiet until">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hr(h)}</option>)}</select></span></label>
          </div>
          <p className="small muted">In-app messages are always saved to the student’s bell. The limits above apply to push and email only.</p>
        </section>
        <section className="card"><h3>Automatic reminders</h3>
          {rules.map(([k, name, ex, ctl]) => (
            <div className="ntf-rule" key={k}>
              <label className="check"><input type="checkbox" checked={c[k].enabled} onChange={(e) => up(`${k}.enabled`, e.target.checked)} /><span><b>{name}</b><small className="muted" style={{ display: 'block' }}>{ex}</small></span></label>
              <div className="small">{ctl}</div>
              <p className="small muted">{pv[k] ? `${pv[k].eligible} student${pv[k].eligible === 1 ? '' : 's'} would get this on the next run.` : 'Nobody is due right now.'}</p>
            </div>))}
          <p className="small muted">The server checks every 10 minutes. Nobody gets the same reminder twice.</p>
          <button className="btn btn-ghost" onClick={runNow} disabled={busy}>Run reminders now</button>
          {run && <p className="small" role="status">Sent: {Object.entries(run.rules).map(([k, v]) => `${k} ${v.sent}/${v.eligible}`).join(' · ') || 'nothing was due'}.</p>}
        </section>
      </div>

      <div className="ad-grid g2" style={{ marginTop: 14 }}>
        <section className="card"><h3>Result updates</h3>
          <label className="check"><input type="checkbox" checked={c.events.liveResults} onChange={(e) => up('events.liveResults', e.target.checked)} /><span><b>Live mock results</b><small className="muted" style={{ display: 'block' }}>“Mock 6 results are out: you ranked 12 of 340”, sent when the window closes.</small></span></label>
          <label className="check"><input type="checkbox" checked={c.events.personalBest} onChange={(e) => up('events.personalBest', e.target.checked)} /><span><b>New personal best</b><small className="muted" style={{ display: 'block' }}>Shown in the student’s inbox only, right after the score beats their previous best.</small></span></label>
          <p className="small muted">Score corrections and teacher notes are always sent. Students can switch these updates and the weekly summary off in their profile.</p>
        </section>
        <section className="card"><h3>WhatsApp</h3>
          <ul className="ntf-flags"><li><Badge tone={w.ready ? 'good' : 'warn'}>{w.ready ? `ready (${w.provider})` : 'not set up'}</Badge> {w.ready ? `${w.optedIn} student${w.optedIn === 1 ? ' has' : 's have'} opted in.` : 'Set WHATSAPP_PROVIDER (meta or twilio) and its keys in the server settings, then restart. Meta needs an approved message template with two variables.'}</li></ul>
          <label className="check"><input type="checkbox" checked={wa.enabled} disabled={!w.ready} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} /><span>Send WhatsApp messages</span></label>
          <div className="ad-row"><label className="ad-field">Most per student per week<input type="number" min="1" max="14" value={wa.weeklyCap} onChange={(e) => setWa({ ...wa, weeklyCap: Number(e.target.value) })} /></label><label className="ad-field">Cost per message (₹, estimate)<input type="number" min="0" step="0.05" value={wa.costInr} onChange={(e) => setWa({ ...wa, costInr: Number(e.target.value) })} /></label></div>
          <p className="small"><b>Send for</b></p>
          {w.kinds.map((k) => <label className="check" key={k}><input type="checkbox" checked={wa.kinds.includes(k)} onChange={(e) => setWa({ ...wa, kinds: e.target.checked ? [...wa.kinds, k] : wa.kinds.filter((x) => x !== k) })} /><span>{kindName[k]}</span></label>)}
          <p className="small muted">Last 30 days: {w.sent} sent, {w.failed} failed, {w.skipped} held back by the limit. About ₹{Math.round(w.sent * (wa.costInr || 0))}. Admin messages can also use WhatsApp.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 14 }}><h3>How messages perform</h3><p className="small muted">Last 30 days. “Opened” counts reads in the inbox and email opens. “Clicked” counts taps on the link.</p>
        {!data.engagement.length ? <p className="muted small">Nothing sent yet.</p> : <div className="tbl-wrap"><table className="dtable"><thead><tr><th>Type</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead><tbody>{data.engagement.map((x) => <tr key={x.kind}><td>{kindName[x.kind] || x.kind}</td><td>{x.sent}</td><td>{pct(x.opened, x.sent)}</td><td>{pct(x.clicked, x.sent)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="card" style={{ marginTop: 14 }}><h3>Recent failures</h3>
        {!data.failures.length ? <p className="muted small">No failed sends.</p> : <div className="tbl-wrap"><table className="dtable"><thead><tr><th>When</th><th>Student</th><th>Channel</th><th>Reason</th></tr></thead><tbody>{data.failures.map((x, i) => <tr key={i}><td>{dt(x.at)}</td><td>{x.name || '–'}</td><td>{x.channel}</td><td>{x.error}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
