import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Err, Loading, Stat, toast } from './ui.jsx';
import { Charts, Compare, Feed, Report, Results, SHAPES, TONE, bytes, ms, shapeName } from './LoadTestParts.jsx';

const SCENARIOS = [
  ['Small class', 'Steady, 50 students', { users: 50, durationSec: 60, pattern: 'steady' }], ['Big batch', 'Steady, 100 students', { users: 100, durationSec: 60, pattern: 'steady' }],
  ['Live exam', '250 students join together', { users: 250, durationSec: 90, pattern: 'spike' }], ['Stress', '500 students', { users: 500, durationSec: 90, pattern: 'steady' }],
  ['Find my limit', 'Climbs until it struggles', { users: 400, durationSec: 120, pattern: 'ramp' }],
];

function Live({ run, info, onStop, stopping }) {
  const s = run.samples; const last = s[s.length - 1] || {}; const pctDone = Math.min(100, Math.round(((run.elapsed || 0) / (run.config.durationSec + 4)) * 100));
  const level = last.p95 > 2000 || last.errors > 3 ? 'bad' : last.p95 > 800 || last.errors ? 'warn' : 'good'; const word = { good: 'Healthy', warn: 'Slowing down', bad: 'Struggling' }[level];
  return (
    <section aria-live="polite">
      <div className="card lt-progress">
        <div><b>{run.phase === 'setup' ? 'Setting up…' : run.phase === 'cleanup' ? 'Cleaning up…' : `Running: ${run.config.users} virtual students, ${shapeName(run.config.pattern).toLowerCase()}`}</b> {run.phase === 'running' && <Badge tone={TONE[level]}>{word}</Badge>}<span className="muted small"> {run.note}</span></div>
        <div className="lt-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pctDone}%` }} /></div>
        <button className="btn btn-danger btn-sm" disabled={stopping || run.phase === 'cleanup'} onClick={onStop}>{stopping ? 'Stopping…' : 'Stop test'}</button>
      </div>
      <div className="ad-grid g4" style={{ margin: '12px 0' }}>
        <Stat icon="👩‍🎓" label="Students active" value={`${run.active} of ${run.config.users}`} /><Stat icon="⚡" label="Requests per second" value={last.rps ?? 0} />
        <Stat icon="⏱" label="Response time p95" value={ms(last.p95 || 0)} tone={last.p95 > 800 ? 'bad' : last.p95 > 300 ? 'warn' : ''} /><Stat icon="⚠" label="Failed in the last second" value={last.errors ?? 0} tone={last.errors ? 'bad' : ''} />
      </div>
      <div className="ad-grid g4" style={{ marginBottom: 12 }}>
        <Stat icon="🧠" label="App CPU (one core)" value={`${last.cpuProc ?? 0}%`} tone={last.cpuProc > 85 ? 'bad' : ''} /><Stat icon="💾" label="App memory" value={bytes(last.rss)} />
        <Stat icon="🖥" label="Server memory used" value={`${last.memUsedPct ?? 0}%`} tone={last.memUsedPct > 85 ? 'bad' : ''} /><Stat icon="📀" label="Disk used" value={last.diskUsedPct == null ? '–' : `${last.diskUsedPct}%`} />
      </div>
      <div className="ad-grid g2" style={{ alignItems: 'start' }}><Feed events={run.events} /><div /></div>
      <Charts s={s} cpus={info.cpus} marks={run.marks} />
    </section>
  );
}

function Num({ label, k, form, set, lim, hint, suffix, placeholder }) {
  return (<label className="ad-field">{label}<input type="number" inputMode="numeric" min={lim?.[0]} max={lim?.[1]} placeholder={placeholder} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} />{(hint || suffix) && <small className="muted">{hint}</small>}</label>);
}

function Setup({ info, d, form, set, setForm, onStart, hasLast }) {
  const L = info.limits; const [adv, setAdv] = useState(false); const [pname, setPname] = useState(''); const [busy, setBusy] = useState(false);
  const per = form.durationSec / Math.max(1, form.saveEverySec); const reqs = Math.round(form.users * (1 + per * (1 + form.pollPct / 100) + (form.submitAtEnd ? 1 + form.resultPct / 100 : 0)));
  const savePreset = async () => { setBusy(true); try { await api.post('/admin/loadtest/presets', { name: pname, config: form }); setPname(''); toast('Preset saved'); d.reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const apply = (c) => setForm((f) => ({ ...f, ...c }));
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Test how many students the server can handle</h3>
      <p className="muted">Creates temporary virtual students who sit a hidden copy of one of your mocks on this live server: they open it, autosave answers, submit and open the result. Real students are not affected, and everything created is deleted afterwards.</p>
      <h4 className="lt-h">1. Pick a scenario</h4>
      <div className="lt-presets" role="group" aria-label="Scenarios">{SCENARIOS.map(([n, sub, c]) => <button key={n} type="button" className={`chip ${form.users === c.users && form.pattern === c.pattern && form.durationSec === c.durationSec ? 'on' : ''}`} title={sub} onClick={() => apply(c)}><b>{n}</b> <span className="small">{sub}</span></button>)}</div>
      {d.presets.length > 0 && <div className="lt-presets" role="group" aria-label="Your saved presets" style={{ marginTop: 8 }}>{d.presets.map((p) => <span key={p.id} className="chip lt-mine"><button type="button" onClick={() => apply(p.config)}><b>{p.name}</b> <span className="small">{p.config.users} students</span></button><button type="button" className="lt-x" aria-label={`Delete preset ${p.name}`} onClick={async () => { await api.del(`/admin/loadtest/presets/${p.id}`); d.reload(); }}>×</button></span>)}</div>}
      <h4 className="lt-h">2. How do students arrive?</h4>
      <div className="lt-shape" role="radiogroup" aria-label="Traffic shape">{SHAPES.map(([k, n, t]) => <label key={k} className={form.pattern === k ? 'on' : ''}><input type="radio" name="shape" checked={form.pattern === k} onChange={() => set('pattern', k)} /><b>{n}</b><small>{t}</small></label>)}</div>
      <h4 className="lt-h">3. Size and length</h4>
      <div className="ad-grid g4">
        <Num label="Students at the same time" k="users" form={form} set={set} lim={L.users} hint="1 to 500" /><Num label="Test length (seconds)" k="durationSec" form={form} set={set} lim={L.durationSec} hint="5 to 120" />
        <Num label="Autosave every (seconds)" k="saveEverySec" form={form} set={set} lim={L.saveEverySec} hint="The exam page saves every 10 seconds." /><Num label="Already answered (%)" k="progress" form={form} set={set} lim={L.progress} hint="How far into the paper each student starts." />
      </div>
      <div className="ad-grid g2" style={{ marginTop: 6 }}>
        <label className="ad-field">Mock to copy<select value={form.mockId} onChange={(e) => set('mockId', e.target.value)}>{info.mocks.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.questions} questions)</option>)}</select></label>
        <label className="ad-field">Name this test (optional)<input maxLength={60} placeholder="For example: Before Sunday's mock" value={form.label} onChange={(e) => set('label', e.target.value)} /><small className="muted">Helps you find it later when comparing.</small></label>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adv} onClick={() => setAdv(!adv)} style={{ marginTop: 8 }}>{adv ? 'Hide' : 'Show'} more settings</button>
      {adv && (
        <div className="lt-adv">
          <div className="ad-grid g4">
            <Num label="Joining spread (seconds)" k="rampSec" form={form} set={set} lim={L.rampSec} placeholder="Automatic" hint="How long students take to arrive. Empty = automatic for the shape." />
            <Num label="Autosave timing variety (%)" k="jitter" form={form} set={set} lim={L.jitter} hint="0 = every student saves on the beat. Higher = more natural." />
            <Num label="Most answers per save" k="saveSize" form={form} set={set} lim={L.saveSize} hint="Each save carries 1 up to this many answers." />
            <Num label="Marked for review (%)" k="markPct" form={form} set={set} lim={L.markPct} />
            <Num label="Check progress (%)" k="pollPct" form={form} set={set} lim={L.pollPct} hint="Share of saves followed by a progress check." />
            <Num label="Open their result (%)" k="resultPct" form={form} set={set} lim={L.resultPct} hint="Share of students who open the result after submitting." />
            <Num label="Submit window (% of the test)" k="submitSpreadPct" form={form} set={set} lim={L.submitSpreadPct} hint="Everyone submits within the last part of the test. Smaller = a sharper rush." />
            <Num label="Stop if failures pass (%)" k="errStopPct" form={form} set={set} lim={L.errStopPct} hint="Safety stop for the test itself." />
          </div>
          <label className="ad-chk" style={{ marginTop: 8 }}><input type="checkbox" checked={form.submitAtEnd} onChange={(e) => set('submitAtEnd', e.target.checked)} /> Everyone submits near the end and opens their result (the heaviest moment)</label>
          <label className="ad-field" style={{ marginTop: 8 }}>Note (saved with the result)<input maxLength={300} placeholder="For example: after moving to a bigger instance" value={form.note || ''} onChange={(e) => set('note', e.target.value)} /></label>
          <div className="lt-save"><input aria-label="Preset name" maxLength={40} placeholder="Save these settings as a preset" value={pname} onChange={(e) => setPname(e.target.value)} /><button className="btn btn-ghost btn-sm" disabled={!pname.trim() || busy} onClick={savePreset}>Save preset</button></div>
        </div>
      )}
      <p className="lt-sum" role="status"><b>What will happen:</b> {form.users} virtual students, about {reqs.toLocaleString()} requests over roughly {form.durationSec + 15} seconds, about {Math.round(form.users / Math.max(1, form.saveEverySec))} autosaves per second once everyone has joined{form.pattern === 'ramp' ? '. Students join gradually, so the report shows where it started to struggle' : form.pattern === 'spike' ? '. Everyone joins at the start, a sharp rush' : ''}.</p>
      {!info.mocks.length && <p className="alert">There is no mock with at least 10 questions yet. Create one first.</p>}
      {info.activeStudents > 0 && <p className="alert" role="status">{info.activeStudents} real student{info.activeStudents > 1 ? 's were' : ' was'} active in the last 5 minutes. They may notice slowness during the test. A quiet time is better.</p>}
      {info.maintenance !== 'off' && <p className="alert" role="status">Maintenance mode is on. Turn it off first or the virtual students are blocked.</p>}
      <p style={{ marginTop: 12 }}><button className="btn btn-primary" disabled={!info.mocks.length || info.maintenance !== 'off'} onClick={onStart}>Start the test</button> {hasLast && <span className="muted small"> The result is saved automatically.</span>}</p>
    </div>
  );
}

export default function LoadTest() {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [form, setForm] = useState(null);
  const [view, setView] = useState({ name: 'new' }); const [dlg, setDlg] = useState(false); const [busy, setBusy] = useState(false); const [e2, setE2] = useState('');
  const timer = useRef(null); const wasRunning = useRef(false);
  const load = useCallback(() => api.get('/admin/loadtest').then((x) => { setD(x); setForm((f) => f || { ...x.defaults, mockId: x.info.mocks[0]?.id || '' }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const running = d?.run && !['done', 'failed'].includes(d.run.phase);
  useEffect(() => { clearInterval(timer.current); if (running) timer.current = setInterval(load, 1000); return () => clearInterval(timer.current); }, [running, load]);
  useEffect(() => { if (wasRunning.current && !running && d?.run?.report) setView({ name: 'report', id: d.run.report.id, rep: d.run.report }); wasRunning.current = !!running; }, [running, d]);
  if (err) return <Err>{err}</Err>; if (!d || !form) return <Loading />;
  const { info, run } = d; d.reload = load; const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const start = async () => { setBusy(true); setE2(''); try { await api.post('/admin/loadtest/start', { ...form, mockId: form.mockId || info.mocks[0]?.id, confirm: 'start' }); setDlg(false); toast('Test started'); load(); } catch (e) { setE2(e.message); } finally { setBusy(false); } };
  const stop = async () => { try { await api.post('/admin/loadtest/stop'); load(); } catch (e) { toast(e.message, 'bad'); } };
  const openReport = async (id) => { try { const { report } = await api.get(`/admin/loadtest/report/${id}`); setView({ name: 'report', id, rep: report }); } catch (e) { toast(e.message, 'bad'); load(); } };
  const compare = async (a, b) => { try { const x = await api.get(`/admin/loadtest/compare?a=${a}&b=${b}`); setView({ name: 'compare', data: x }); } catch (e) { toast(e.message, 'bad'); } };
  const rerun = (cfg) => { setForm((f) => ({ ...f, ...cfg, mockId: info.mocks.some((m) => m.id === cfg.mockId) ? cfg.mockId : f.mockId, note: '' })); setView({ name: 'new' }); window.scrollTo?.({ top: 0 }); };
  const rerunId = async (id) => { try { const { report } = await api.get(`/admin/loadtest/report/${id}`); rerun(report.config); } catch (e) { toast(e.message, 'bad'); } };

  if (running) return <Live run={run} info={info} onStop={stop} stopping={run.stopping} />;
  const hist = d.history; const idx = view.name === 'report' ? hist.findIndex((x) => x.id === view.id) : -1; const prev = idx >= 0 ? hist.slice(idx + 1).find((x) => x.hasReport) : null;
  const tab = view.name === 'new' ? 'new' : 'results';
  return (
    <section>
      <div className="lt-views" role="tablist" aria-label="Load test views">
        <button role="tab" aria-selected={tab === 'new'} className={`chip ${tab === 'new' ? 'on' : ''}`} onClick={() => setView({ name: 'new' })}>New test</button>
        <button role="tab" aria-selected={tab === 'results'} className={`chip ${tab === 'results' ? 'on' : ''}`} onClick={() => setView({ name: 'list' })}>Saved results ({hist.length})</button>
      </div>
      {tab === 'new' && <>
        {run?.error && <div className="alert" role="alert">The last test could not run: {run.error}</div>}
        <Setup info={info} d={d} form={form} set={set} setForm={setForm} onStart={() => setDlg(true)} hasLast />
        <div className="ad-grid g4" style={{ margin: '12px 0' }}>
          <Stat icon="🖥" label="Server" value={`${info.cpus} CPU`} sub={info.cpuModel.slice(0, 32)} /><Stat icon="🧠" label="Memory free" value={bytes(info.availMem)} sub={`of ${bytes(info.totalMem)}`} />
          <Stat icon="📀" label="Disk free" value={bytes(info.disk?.free)} sub={info.disk ? `${info.disk.usedPct}% used` : ''} /><Stat icon="🗄" label="Database size" value={bytes(info.dbBytes)} />
        </div>
        <p className="small muted">Safety: the test stops by itself if too many requests fail, the server runs low on memory or disk, or it freezes for several seconds. You can also stop it any time.</p>
      </>}
      {view.name === 'list' && <Results h={hist} onOpen={openReport} onCompare={compare} onChanged={load} onRerunId={rerunId} />}
      {view.name === 'report' && <Report rep={view.rep} prevId={prev?.id} onAgain={() => setView({ name: 'new' })} onRerun={rerun} onCompare={compare} onChanged={() => { load(); openReport(view.id); }} />}
      {view.name === 'compare' && <Compare a={view.data.a} b={view.data.b} cmp={view.data} onBack={() => setView({ name: 'list' })} onSwap={() => compare(view.data.b.id, view.data.a.id)} />}
      {dlg && <ConfirmModal title={`Run a ${form.durationSec}-second test with ${form.users} students?`} word="start" label="Start test" busy={busy} error={e2} onClose={() => setDlg(false)} onConfirm={start}>
        <p>The server will work hard for about {form.durationSec + 15} seconds. Pages may feel slower for anyone else using it. The virtual students and their data are removed when it ends, and the result is saved so you can compare it later.</p></ConfirmModal>}
    </section>
  );
}
