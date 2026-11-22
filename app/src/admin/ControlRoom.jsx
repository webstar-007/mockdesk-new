import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { refreshSite } from '../lib/site.js';
import { Badge, Err, Loading, PageHead, ago, toast, useLoad } from './ui.jsx';

function Switches({ d, reload }) {
  const [c, setC] = useState(d.controls); const [busy, setBusy] = useState(false);
  const [ips, setIps] = useState(d.controls.blockedIps.join('\n')); const [doms, setDoms] = useState(d.controls.signups.domains.join(', '));
  const set = (path, v) => setC((x) => { const n = structuredClone(x); const k = path.split('.'); let o = n; k.slice(0, -1).forEach((p) => { o = o[p]; }); o[k.at(-1)] = v; return n; });
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/controls', { ...c, signups: { ...c.signups, domains: doms }, blockedIps: ips }); toast('Saved. Changes apply within a few seconds.'); refreshSite(); reload(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const m = c.maintenance.mode;
  return (
    <>
      <section className={`card cr-maint m-${m}`}>
        <h3>Maintenance mode</h3>
        <p className="small muted">Use this before an update or while fixing a problem. Admins and staff can always sign in.</p>
        <div className="cr-seg" role="radiogroup" aria-label="Maintenance mode">
          {[['off', 'Off', 'Everything works normally'], ['soft', 'Pause tests', 'Students can look around, but cannot start tests or sign up'], ['hard', 'Lock out', 'Students see a maintenance screen']].map(([k, l, h]) => (
            <label key={k} className={m === k ? 'on' : ''}><input type="radio" name="mm" checked={m === k} onChange={() => set('maintenance.mode', k)} /><b>{l}</b><small>{h}</small></label>))}
        </div>
        {m !== 'off' && <label className="ad-field" style={{ marginTop: 10 }}>Message students will see<textarea rows={2} maxLength={400} value={c.maintenance.message} onChange={(e) => set('maintenance.message', e.target.value)} placeholder="We are updating MockDesk and will be back by 6 pm." /></label>}
      </section>
      <section className="card">
        <h3>Sign-ups</h3>
        <label className="ad-chk"><input type="checkbox" checked={c.signups.open} onChange={(e) => set('signups.open', e.target.checked)} /> Allow new students to create accounts</label>
        <label className="ad-field" style={{ marginTop: 10 }}>Only allow these email domains <small className="muted">(leave empty to allow any)</small><input value={doms} onChange={(e) => setDoms(e.target.value)} placeholder="college.edu.in, school.org" /></label>
        <label className="ad-field" style={{ marginTop: 10 }}>Message when sign-up is refused <small className="muted">(optional)</small><input maxLength={300} value={c.signups.message} onChange={(e) => set('signups.message', e.target.value)} placeholder="Sign-ups are open to members only. Ask your teacher for an invite." /></label>
        <p className="small muted">Existing students are not affected. Accounts you import in bulk are not affected either.</p>
      </section>
      <section className="card">
        <h3>Features</h3>
        <p className="small muted">Switch a student feature off everywhere without a deploy.</p>
        <div className="cr-feats">{Object.entries(d.features).map(([k, label]) => <label key={k} className="ad-chk"><input type="checkbox" checked={c.features[k] !== false} onChange={(e) => set(`features.${k}`, e.target.checked)} /> {label}</label>)}</div>
      </section>
      <section className="card">
        <h3>Blocked network addresses</h3>
        <label className="ad-field">One per line. Use <code>1.2.3.4</code> or <code>1.2.3.*</code> for a range.<textarea rows={3} value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.7" /></label>
        <p className="small muted">Your address is {d.yourIp || 'unknown'}. You cannot block it.</p>
      </section>
      <div className="cr-save"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save controls'}</button></div>
    </>
  );
}

function Jobs() {
  const { data, err, loading, reload } = useLoad('/admin/jobs'); const [busy, setBusy] = useState('');
  if (loading && !data) return <Loading />; if (err) return <Err>{err}</Err>;
  const run = async (n) => { setBusy(n); try { const r = await api.post(`/admin/jobs/${n}/run`); toast(r.result ? String(r.result) : 'Done'); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); reload(); } };
  const pause = async (j) => { try { await api.put(`/admin/jobs/${j.name}`, { paused: !j.paused }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <section className="card">
      <h3>Background jobs</h3>
      <p className="small muted">These run by themselves on the server. Run one now, or pause it while you investigate. A pause lasts until the server restarts.</p>
      <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Job</th><th>Runs</th><th>Last run</th><th>Status</th><th /></tr></thead><tbody>
        {data.jobs.map((j) => (
          <tr key={j.name}><td className="nm"><b>{j.label}</b><small>{j.every}</small></td><td>{j.runs}</td><td>{j.last ? `${ago(j.last)} (${j.lastMs} ms)` : 'not yet'}</td>
            <td>{j.paused ? <Badge tone="warn">Paused</Badge> : j.lastError ? <Badge tone="bad" >Failed</Badge> : <Badge tone="good">OK</Badge>}{j.lastError && <small className="muted" style={{ display: 'block' }}>{j.lastError}</small>}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-ghost btn-sm" disabled={busy === j.name} onClick={() => run(j.name)}>Run now</button> <button className="btn btn-ghost btn-sm" onClick={() => pause(j)}>{j.paused ? 'Resume' : 'Pause'}</button></td></tr>))}
      </tbody></table></div>
    </section>
  );
}

function Config() {
  const file = useRef(null); const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (!window.confirm('Replace the settings on this server with the ones in this file? Students, tests and questions are not touched.')) return;
    setBusy(true); try { const j = JSON.parse(await f.text()); const r = await api.post('/admin/config/import', j); toast(`Imported ${r.imported} setting group(s)`); refreshSite(); } catch (x) { toast(x.message || 'Not a valid settings file', 'bad'); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <h3>Move your settings</h3>
      <p className="small muted">Download branding, limits, reminder rules, backup schedule and the switches above as one file. Import it on another server to set up the same way. Passwords and keys are never included.</p>
      <div className="ad-toolbar"><a className="btn btn-ghost" href="/api/admin/config/export" download>⬇ Download settings</a><button className="btn btn-ghost" disabled={busy} onClick={() => file.current.click()}>⬆ Import settings</button><input ref={file} type="file" accept="application/json,.json" hidden onChange={pick} /></div>
    </section>
  );
}

export default function ControlRoom() {
  const { data, err, loading, reload } = useLoad('/admin/controls'); const [tab, setTab] = useState('switches');
  useEffect(() => { document.title = 'Control room'; }, []);
  if (loading && !data) return <Loading />; if (err) return <Err>{err}</Err>;
  return (
    <>
      <PageHead title="Control room" sub="Switch things on and off, pause jobs, and move your setup, all without a deploy." />
      <div className="ad-pill-row" role="tablist" style={{ marginBottom: 12 }}>{[['switches', 'Switches'], ['jobs', 'Background jobs'], ['config', 'Settings file']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`ad-pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'switches' && <Switches d={data} reload={reload} />}{tab === 'jobs' && <Jobs />}{tab === 'config' && <Config />}
    </>
  );
}
