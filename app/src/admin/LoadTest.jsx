import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Err, Loading, Stat, toast } from './ui.jsx';
import { Charts, Compare, Feed, Report, Results, SHAPES, TONE, bytes, kindLabel, ms, shapeName } from './LoadTestParts.jsx';

const TARGETS = [['p95Ms', 'Autosave response time (ms, p95)', 'Most students should wait less than this.'], ['submitP95Ms', 'Submit response time (ms, p95)', 'The end-of-test rush.'], ['errorPct', 'Failed requests (%)', '0 means none allowed.'], ['cpuPct', 'App processor use (%)', 'Of one core.'], ['memPct', 'Server memory used (%)', ''], ['writeMs', 'Database write time (ms)', '']];
const METHODS = ['GET', 'POST', 'PUT'];
const WRITE_OK = /^\/(attempts\/\{attempt\}\/(integrity|errors\/[A-Za-z0-9_\-{}]+)|bookmarks|notebook|practice)(\/|$|\?)/;

const SCENARIOS = [
  ['Small class', 'Steady, 50 students', { users: 50, durationSec: 60, pattern: 'steady' }], ['Big batch', 'Steady, 100 students', { users: 100, durationSec: 60, pattern: 'steady' }],
  ['Live exam', '250 students join together', { users: 250, durationSec: 90, pattern: 'spike' }], ['Stress', '500 students', { users: 500, durationSec: 90, pattern: 'steady' }],
  ['Find my limit', 'Climbs until it struggles', { users: 400, durationSec: 120, pattern: 'ramp' }],
  ['Staircase', '400 students in 4 steps', { users: 400, durationSec: 120, pattern: 'steps', stepCount: 4, warmupSec: 5 }], ['Two batches', '300 now, 200 more halfway', { users: 500, durationSec: 120, pattern: 'waves' }],
  ['Soak', '100 students for 10 minutes', { users: 100, durationSec: 600, pattern: 'steady', warmupSec: 10 }],
];

function Live({ run, info, onStop, stopping }) {
  const s = run.samples; const last = s[s.length - 1] || {}; const pctDone = Math.min(100, Math.round(((run.elapsed || 0) / (run.config.durationSec + 4)) * 100));
  const level = last.p95 > 2000 || last.errors > 3 ? 'bad' : last.p95 > 800 || last.errors ? 'warn' : 'good'; const word = { good: 'Healthy', warn: 'Slowing down', bad: 'Struggling' }[level];
  return (
    <section aria-live="polite">
      <div className="card lt-progress">
        <div><b>{run.phase === 'setup' ? 'Setting up…' : run.phase === 'cleanup' ? 'Cleaning up…' : `Running: ${run.config.users}${run.config.browsers ? ` + ${run.config.browsers} browsing` : ''} virtual students, ${shapeName(run.config.pattern).toLowerCase()}`}</b> {run.phase === 'running' && <Badge tone={TONE[level]}>{word}</Badge>}<span className="muted small"> {run.note}</span></div>
        <div className="lt-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pctDone}%` }} /></div>
        <button className="btn btn-danger btn-sm" disabled={stopping || run.phase === 'cleanup'} onClick={onStop}>{stopping ? 'Stopping…' : 'Stop test'}</button>
      </div>
      <div className="ad-grid g4" style={{ margin: '12px 0' }}>
        <Stat icon="👩‍🎓" label="Students active" value={`${run.active} of ${run.config.users + (run.config.browsers || 0)}`} /><Stat icon="⚡" label="Requests per second" value={last.rps ?? 0} />
        <Stat icon="⏱" label="Response time p95" value={ms(last.p95 || 0)} tone={last.p95 > 800 ? 'bad' : last.p95 > 300 ? 'warn' : ''} /><Stat icon="⚠" label="Failed in the last second" value={last.errors ?? 0} tone={last.errors ? 'bad' : ''} />
      </div>
      <div className="ad-grid g4" style={{ marginBottom: 12 }}>
        <Stat icon="🧠" label="App CPU (one core)" value={`${last.cpuProc ?? 0}%`} tone={last.cpuProc > 85 ? 'bad' : ''} /><Stat icon="💾" label="App memory" value={bytes(last.rss)} />
        <Stat icon="🖥" label="Server memory used" value={`${last.memUsedPct ?? 0}%`} tone={last.memUsedPct > 85 ? 'bad' : ''} /><Stat icon="📀" label="Disk used" value={last.diskUsedPct == null ? '–' : `${last.diskUsedPct}%`} />
      </div>
      {Object.keys(run.kinds || {}).length > 0 && <section className="card" style={{ padding: 0, marginBottom: 12 }}><h3 style={{ padding: '12px 14px 0', margin: 0 }}>What students are doing</h3><div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Action</th><th>Done</th><th>Typical</th><th>p95</th><th>Failed</th></tr></thead><tbody>{Object.entries(run.kinds).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => <tr key={k}><td>{kindLabel(k)}</td><td>{v.n}</td><td>{ms(v.p50)}</td><td><b className={v.p95 > 800 ? 'sx-bad' : ''}>{ms(v.p95)}</b></td><td>{v.errors || '–'}</td></tr>)}</tbody></table></div></section>}
      <div className="ad-grid g2" style={{ alignItems: 'start' }}><Feed events={run.events} /><div /></div>
      <Charts s={s} cpus={info.cpus} marks={run.marks} />
    </section>
  );
}

function Num({ label, k, form, set, lim, hint, placeholder, disabled }) {
  return (<label className="ad-field">{label}<input type="number" inputMode="numeric" disabled={disabled} min={lim?.[0]} max={lim?.[1]} placeholder={placeholder} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} />{hint && <small className="muted">{hint}</small>}</label>);
}

function Act({ title: t, desc, on = true, children }) {
  return (<div className={`lt-act ${on ? '' : 'off'}`}><div className="lt-act-h"><b>{t}</b><small>{desc}</small></div><div className="lt-act-f">{children}</div></div>);
}

function SignIn() {
  const [r, setR] = useState(null); const [busy, setBusy] = useState(false); const [n, setN] = useState(20);
  const go = async () => { setBusy(true); try { setR(await api.post('/admin/loadtest/signin-bench', { count: n })); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  return (
    <section className="card" style={{ marginTop: 12 }} aria-label="Sign-in speed check">
      <h3 style={{ marginTop: 0 }}>How fast can students sign in?</h3>
      <p className="muted small">Signing in is the heaviest thing a single student does, and everyone does it in the same minutes before a live mock. This times real password checks on this server. It takes a few seconds and creates nothing.</p>
      <div className="lt-save"><label className="small">Sign-ins to time <input type="number" min="5" max="60" value={n} onChange={(e) => setN(Number(e.target.value) || 20)} style={{ width: 70 }} /></label><button className="btn btn-primary btn-sm" disabled={busy} onClick={go}>{busy ? 'Measuring…' : 'Measure sign-in speed'}</button></div>
      {r && <div style={{ marginTop: 12 }}>
        <div className="ad-grid g3"><Stat icon="🔑" label="Sign-ins per second" value={r.pool.perSec} sub={`${ms(r.pool.avgMs)} each when several happen together`} /><Stat icon="🧊" label="Longest freeze for others" value={ms(r.pool.lagMaxMs)} tone={r.pool.lagMaxMs > 250 ? 'warn' : ''} sub="while those sign-ins ran" /><Stat icon="🖥" label="CPU cores" value={r.cores} /></div>
        <div style={{ overflowX: 'auto' }}><table className="ad-table" style={{ marginTop: 10 }}><thead><tr><th>Students signing in at once</th>{r.estimates.map((e) => <th key={e.students}>{e.students}</th>)}</tr></thead><tbody><tr><td>Time for all of them</td>{r.estimates.map((e) => <td key={e.students}><b>{e.seconds < 90 ? `${e.seconds} s` : `${Math.round(e.seconds / 6) / 10} min`}</b></td>)}</tr></tbody></table></div>
        <p className="small" style={{ marginBottom: 0 }}>{r.advice}</p>
      </div>}
    </section>
  );
}

function Setup({ info, d, form, set, setForm, onStart }) {
  const L = info.limits; const [adv, setAdv] = useState(false); const [pname, setPname] = useState(''); const [busy, setBusy] = useState(false);
  const dur = form.durationSec || 0; const sub = form.submitAtEnd; const pages = form.pages || []; const custom = form.custom || [];
  const per = dur / Math.max(1, form.saveEverySec || 1);
  const reqs = Math.round(form.users * (1 + per * (1 + form.pollPct / 100) + (sub ? 1 + (form.resultPct + form.reviewPct + form.pdfPct) / 100 : 0) + (pages.length ? (form.browsePerMin * dur) / 60 : 0)) + (pages.length ? (form.browsers * form.browserPerMin * dur) / 60 : 0) + custom.reduce((a, c) => a + ((form.users + form.browsers) * c.perMin * dur) / 60, 0));
  const total = form.users + form.browsers;
  const [pre, setPre] = useState(null); const tg = form.targets || {};
  const cfgKey = JSON.stringify({ ...form, note: '', label: '' });
  useEffect(() => { const h = setTimeout(() => { api.post('/admin/loadtest/preflight', form).then(setPre).catch(() => setPre(null)); }, 500); return () => clearTimeout(h); }, [cfgKey]); // eslint-disable-line
  const setTg = (k, v) => set('targets', { ...tg, [k]: v });
  const savePreset = async () => { setBusy(true); try { await api.post('/admin/loadtest/presets', { name: pname, config: form }); setPname(''); toast('Preset saved'); d.reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const apply = (c) => setForm((f) => ({ ...f, ...c }));
  const togglePage = (k) => set('pages', pages.includes(k) ? pages.filter((x) => x !== k) : [...pages, k]);
  const setCustom = (n, patch) => set('custom', custom.map((c, i) => (i === n ? { ...c, ...patch } : c)));
  return (
    <div className="card lt-setup">
      <div className="lt-top"><h3 style={{ margin: 0 }}>Test how many students the server can handle</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...d.defaults, mockId: form.mockId })}>Reset to defaults</button></div>
      <p className="muted">Creates temporary virtual students on this live server. They sit a hidden copy of one of your mocks and do the things you choose below. Real students are not affected, and everything created is deleted afterwards.</p>
      <h4 className="lt-h">1. Pick a scenario</h4>
      <div className="lt-presets" role="group" aria-label="Scenarios">{SCENARIOS.map(([n, sub2, c]) => <button key={n} type="button" className={`chip ${form.users === c.users && form.pattern === c.pattern && form.durationSec === c.durationSec ? 'on' : ''}`} title={sub2} onClick={() => apply(c)}><b>{n}</b> <span className="small">{sub2}</span></button>)}</div>
      {d.presets.length > 0 && <div className="lt-presets" role="group" aria-label="Your saved presets" style={{ marginTop: 8 }}>{d.presets.map((p) => <span key={p.id} className="chip lt-mine"><button type="button" onClick={() => apply({ ...d.defaults, ...p.config })}><b>{p.name}</b> <span className="small">{p.config.users} students</span></button><button type="button" className="lt-x" aria-label={`Delete preset ${p.name}`} onClick={async () => { await api.del(`/admin/loadtest/presets/${p.id}`); d.reload(); }}>×</button></span>)}</div>}
      <h4 className="lt-h">2. How do students arrive?</h4>
      <div className="lt-shape" role="radiogroup" aria-label="Traffic shape">{SHAPES.map(([k, n, t]) => <label key={k} className={form.pattern === k ? 'on' : ''}><input type="radio" name="shape" checked={form.pattern === k} onChange={() => set('pattern', k)} /><b>{n}</b><small>{t}</small></label>)}</div>
      {form.pattern === 'steps' && <div style={{ maxWidth: 260 }}><Num label="Number of steps" k="stepCount" form={form} set={set} lim={L.stepCount} hint="Students are split equally across the steps." /></div>}
      <h4 className="lt-h">3. Size and length</h4>
      <div className="ad-grid g4">
        <Num label="Students sitting the test" k="users" form={form} set={set} lim={L.users} hint={`${L.users[0]} to ${L.users[1]}`} /><Num label="Test length (seconds)" k="durationSec" form={form} set={set} lim={L.durationSec} hint={`${L.durationSec[0]} to ${L.durationSec[1]} (${Math.round(L.durationSec[1] / 60)} minutes)`} />
        <Num label="Already answered (%)" k="progress" form={form} set={set} lim={L.progress} hint="How far into the paper each student starts." />
        <label className="ad-field">Mock to copy<select value={form.mockId} onChange={(e) => set('mockId', e.target.value)}>{info.mocks.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.questions} questions)</option>)}</select></label>
      </div>
      <label className="ad-field" style={{ maxWidth: 420 }}>Name this test (optional)<input maxLength={60} placeholder="For example: Before Sunday's mock" value={form.label} onChange={(e) => set('label', e.target.value)} /><small className="muted">Helps you find it later when comparing.</small></label>

      <h4 className="lt-h">4. What do students do? <span className="muted small">Switch on only what you want to test.</span></h4>
      <div className="lt-acts">
        <Act title="Open the test" desc="Always on: every student opens their test first."><span className="muted small">Always</span></Act>
        <Act title="Autosave answers" desc="The exam page saves answers on a timer. This is the main load during a test."><Num label="Every (seconds)" k="saveEverySec" form={form} set={set} lim={L.saveEverySec} /><Num label="Up to (answers per save)" k="saveSize" form={form} set={set} lim={L.saveSize} /></Act>
        <Act title="Check progress" desc="The page re-reads the attempt now and then." on={form.pollPct > 0}><Num label="After saves (%)" k="pollPct" form={form} set={set} lim={L.pollPct} hint="0 = never" /></Act>
        <Act title="Browse other pages while testing" desc="Students also open the pages ticked in step 5." on={form.browsePerMin > 0}><Num label="Page views per minute" k="browsePerMin" form={form} set={set} lim={L.browsePerMin} hint="0 = none" /></Act>
        <Act title="Submit and finish" desc="Everyone submits near the end. This is the heaviest moment." on={sub}><label className="ad-chk"><input type="checkbox" checked={sub} onChange={(e) => set('submitAtEnd', e.target.checked)} /> Submit near the end</label><Num label="Submit within the last (%)" k="submitSpreadPct" form={form} set={set} lim={L.submitSpreadPct} disabled={!sub} hint="Smaller = sharper rush" /></Act>
        <Act title="Open the result" desc="After submitting, students open their result and score analysis." on={sub && form.resultPct > 0}><Num label="Share of students (%)" k="resultPct" form={form} set={set} lim={L.resultPct} disabled={!sub} hint={sub ? '' : 'Needs Submit'} /></Act>
        <Act title="Review page" desc="Students open the review page with the trick corner." on={sub && form.reviewPct > 0}><Num label="Share of students (%)" k="reviewPct" form={form} set={set} lim={L.reviewPct} disabled={!sub} hint={sub ? '0 = none' : 'Needs Submit'} /></Act>
        <Act title="Download PDF report" desc="Building a PDF is heavy. Good to test before exam results go out." on={sub && form.pdfPct > 0}><Num label="Share of students (%)" k="pdfPct" form={form} set={set} lim={L.pdfPct} disabled={!sub} hint={sub ? '0 = none' : 'Needs Submit'} /></Act>
        <Act title="Extra students who only browse" desc="People using the site while others sit the test: dashboard, inbox, mock list." on={form.browsers > 0}><Num label="How many" k="browsers" form={form} set={set} lim={L.browsers} hint="0 = none" /><Num label="Page views per minute each" k="browserPerMin" form={form} set={set} lim={L.browserPerMin} disabled={!form.browsers} /></Act>
        <Act title="Move to the next section" desc="Students finish section 1 and start section 2, like a real paper. Needs a mock with two or more sections." on={!!form.sectionMoves}><label className="ad-chk"><input type="checkbox" checked={!!form.sectionMoves} onChange={(e) => set('sectionMoves', e.target.checked)} /> Switch section during the test</label><Num label="At this point of the test (%)" k="sectionAtPct" form={form} set={set} lim={L.sectionAtPct} disabled={!form.sectionMoves} /></Act>
        <Act title="Tab-switch reports" desc="The exam page tells the server when a student leaves the tab. Used by the Integrity page." on={form.integrityPerMin > 0}><Num label="Reports per minute each" k="integrityPerMin" form={form} set={set} lim={L.integrityPerMin} hint="0 = none" /></Act>
        <Act title="Open the site home page" desc="Loads the page itself, not just data. Skipped if a web server in front serves it." on={form.homePerMin > 0}><Num label="Views per minute each" k="homePerMin" form={form} set={set} lim={L.homePerMin} hint="0 = none" /></Act>
      </div>

      <h4 className="lt-h">5. Which pages do browsing students open?</h4>
      <div className="lt-presets" role="group" aria-label="Pages to browse">{(d.pages || []).map(([k, l]) => <label key={k} className={`chip lt-pg ${pages.includes(k) ? 'on' : ''}`}><input type="checkbox" checked={pages.includes(k)} onChange={() => togglePage(k)} />{l}</label>)}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('pages', (d.pages || []).map((x) => x[0]))}>All</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => set('pages', [])}>None</button></div>
      <p className="small muted">These are read-only pages. Only used if "Browse other pages" or "Extra students who only browse" is above zero.</p>

      <h4 className="lt-h">6. Any other request you want to test?</h4>
      <p className="small muted" style={{ marginTop: 0 }}>Every virtual student is signed in. Write <code>{'{attempt}'}</code> where the student's test id goes and <code>{'{question}'}</code> for a question id, for example <code>{'/attempts/{attempt}/errors'}</code>. GET works on any student page. POST and PUT are allowed only for <code>/bookmarks</code>, <code>/notebook</code>, <code>/practice</code>, <code>{'/attempts/{attempt}/integrity'}</code> and <code>{'/attempts/{attempt}/errors/{question}'}</code>, and what they write is removed afterwards. Admin and sign-in pages are not allowed.</p>
      {custom.map((c, n) => {
        const m = c.method || 'GET'; const blocked = m !== 'GET' && c.path && !WRITE_OK.test(c.path);
        return (
          <div key={n} className="lt-custom lt-custom2">
            <select aria-label={`Request ${n + 1} method`} value={m} onChange={(e) => setCustom(n, { method: e.target.value })}>{METHODS.map((x) => <option key={x}>{x}</option>)}</select>
            <input aria-label={`Request ${n + 1} path`} placeholder="/mocks" value={c.path} maxLength={160} onChange={(e) => setCustom(n, { path: e.target.value })} />
            <label>per minute each <input type="number" min="1" max="60" value={c.perMin} onChange={(e) => setCustom(n, { perMin: Number(e.target.value) || 1 })} /></label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('custom', custom.filter((_, i) => i !== n))}>Remove</button>
            {m !== 'GET' && <input className="lt-body" aria-label={`Request ${n + 1} body`} placeholder='JSON body, for example {"leaves": 1}' value={c.body || ''} maxLength={800} onChange={(e) => setCustom(n, { body: e.target.value })} />}
            {blocked && <small className="sx-bad lt-warn">{m} is not allowed on this path, so it will be skipped.</small>}
          </div>);
      })}
      {custom.length < (L.customMax || 12) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('custom', [...custom, { path: '', method: 'GET', body: '', perMin: 6 }])}>Add a request</button>}

      <h4 className="lt-h">7. What counts as a pass? <span className="muted small">Optional. Your own targets, marked pass or fail in the result.</span></h4>
      <label className="ad-chk"><input type="checkbox" checked={!!tg.enabled} onChange={(e) => setTg('enabled', e.target.checked)} /> Check this test against my targets</label>
      {tg.enabled && <div className="ad-grid g3" style={{ marginTop: 8 }}>{TARGETS.map(([k, l, hnt]) => <label key={k} className="ad-field">{l}<input type="number" inputMode="numeric" value={tg[k] ?? ''} onChange={(e) => setTg(k, e.target.value === '' ? '' : Number(e.target.value))} />{hnt && <small className="muted">{hnt}</small>}</label>)}</div>}

      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adv} onClick={() => setAdv(!adv)} style={{ marginTop: 14 }}>{adv ? 'Hide' : 'Show'} advanced settings</button>
      {adv && (
        <div className="lt-adv">
          <div className="ad-grid g4">
            <Num label="Joining spread (seconds)" k="rampSec" form={form} set={set} lim={L.rampSec} placeholder="Automatic" hint="How long students take to arrive. Empty = automatic." />
            <Num label="Autosave timing variety (%)" k="jitter" form={form} set={set} lim={L.jitter} hint="0 = every student saves on the beat." />
            <Num label="Marked for review (%)" k="markPct" form={form} set={set} lim={L.markPct} />
            <Num label="Stop if failures pass (%)" k="errStopPct" form={form} set={set} lim={L.errStopPct} hint="Safety stop for the test itself." />
            <Num label="Warm-up to ignore (seconds)" k="warmupSec" form={form} set={set} lim={L.warmupSec} hint="The first seconds, when caches are cold, are left out of the result." />
          </div>
          <label className="ad-field" style={{ marginTop: 8 }}>Note (saved with the result)<input maxLength={300} placeholder="For example: after moving to a bigger instance" value={form.note || ''} onChange={(e) => set('note', e.target.value)} /></label>
          <div className="lt-save"><input aria-label="Preset name" maxLength={40} placeholder="Save these settings as a preset" value={pname} onChange={(e) => setPname(e.target.value)} /><button className="btn btn-ghost btn-sm" disabled={!pname.trim() || busy} onClick={savePreset}>Save preset</button></div>
        </div>
      )}
      {!info.mocks.length && <p className="alert">There is no mock with at least 10 questions yet. Create one first.</p>}
      {pre?.blockers?.map((b2, i) => <p key={i} className="alert" role="alert"><b>Cannot start:</b> {b2}</p>)}
      {pre?.warnings?.map((w, i) => <p key={i} className="lt-warnline" role="status">⚠ {w}</p>)}
      {pre && <p className="small muted" style={{ margin: '6px 0 0' }}>{pre.est.sharedCpuNote}</p>}
      {info.maintenance !== 'off' && <p className="alert" role="status">Maintenance mode is on. Turn it off first or the virtual students are blocked.</p>}
      <div className="lt-sticky">
        <p className="lt-sum" role="status"><b>{total} virtual students</b>{form.browsers ? ` (${form.users} sitting the test, ${form.browsers} browsing)` : ''}, about <b>{(pre?.est.requests ?? reqs).toLocaleString()} requests</b> (around {pre ? pre.est.rps : Math.round(reqs / Math.max(1, dur))} a second) over roughly {dur + 15} seconds{pre?.est.dbMB > 50 ? `, adding about ${pre.est.dbMB} MB of temporary data` : ''}{form.pattern === 'steps' ? `. Students join in ${form.stepCount} steps` : form.pattern === 'waves' ? '. A second wave arrives halfway' : form.pattern === 'ramp' ? '. Students join gradually, so the report shows where it started to struggle' : form.pattern === 'spike' ? '. Everyone joins at the start' : ''}.</p>
        <button className="btn btn-primary" disabled={!info.mocks.length || info.maintenance !== 'off' || !form.users || !!pre?.blockers?.length} onClick={onStart}>Start the test</button>
      </div>
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
  const poll = useCallback(() => api.get('/admin/loadtest/live').then((x) => setD((p) => (p ? { ...p, run: x.run } : p))).catch(() => {}), []);
  useEffect(() => { clearInterval(timer.current); if (running) timer.current = setInterval(poll, 1000); return () => clearInterval(timer.current); }, [running, poll]);
  useEffect(() => { if (wasRunning.current && !running) { load(); if (d?.run?.report) setView({ name: 'report', id: d.run.report.id, rep: d.run.report }); } wasRunning.current = !!running; }, [running, d, load]);
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
        <Setup info={info} d={d} form={form} set={set} setForm={setForm} onStart={() => setDlg(true)} />
        <div className="ad-grid g4" style={{ margin: '12px 0' }}>
          <Stat icon="🖥" label="Server" value={`${info.cpus} CPU`} sub={info.cpuModel.slice(0, 32)} /><Stat icon="🧠" label="Memory free" value={bytes(info.availMem)} sub={`of ${bytes(info.totalMem)}`} />
          <Stat icon="📀" label="Disk free" value={bytes(info.disk?.free)} sub={info.disk ? `${info.disk.usedPct}% used` : ''} /><Stat icon="🗄" label="Database size" value={bytes(info.dbBytes)} />
        </div>
        <SignIn />
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
