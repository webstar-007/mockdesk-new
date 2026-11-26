import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Err, Loading, Stat, toast } from './ui.jsx';
import { Charts, Compare, LiveFeed, Report, Results, SHAPES, TONE, bytes, kindLabel, ms, shapeName } from './LoadTestParts.jsx';

const fmtN = (n) => Number(n || 0).toLocaleString('en-IN');
const clock = (sec) => { const s = Math.max(0, Math.round(sec || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const lenText = (sec) => (sec >= 3600 && sec % 3600 === 0 ? `${sec / 3600} hour${sec === 3600 ? '' : 's'}` : sec >= 60 && sec % 60 === 0 ? `${sec / 60} minute${sec === 60 ? '' : 's'}` : `${sec} seconds`);
const TARGETS = [['p95Ms', 'Autosave response time (ms, p95)', 'Most students should wait less than this.'], ['submitP95Ms', 'Submit response time (ms, p95)', 'The end-of-test rush.'], ['errorPct', 'Failed requests (%)', '0 means none allowed.'], ['cpuPct', 'App processor use (%)', 'Of one core.'], ['memPct', 'Server memory used (%)', ''], ['writeMs', 'Database write time (ms)', '']];
const METHODS = ['GET', 'POST', 'PUT'];
const WRITE_OK = /^\/(attempts\/\{attempt\}\/(integrity|errors\/[A-Za-z0-9_\-{}]+)|bookmarks|notebook|practice)(\/|$|\?)/;
const SIZES = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const LENGTHS = [30, 60, 120, 300, 600, 1800, 3600];

/** Ready-made situations. Each only sets the numbers below, which you can still change. */
const SCENARIOS = [
  { id: 'quick', icon: '⚡', name: 'Quick check', text: 'Is everything working? 25 students, one minute.', cfg: { users: 25, durationSec: 60, pattern: 'steady' } },
  { id: 'class', icon: '🏫', name: 'Normal class', text: '100 students sitting a test together.', cfg: { users: 100, durationSec: 120, pattern: 'steady' } },
  { id: 'live', icon: '🚀', name: 'Live exam start', text: 'Everyone joins in the same second.', cfg: { users: 500, durationSec: 120, pattern: 'spike' } },
  { id: 'rush', icon: '🏁', name: 'Submit rush', text: 'Students finish and open results together.', cfg: { users: 500, durationSec: 120, pattern: 'steady', progress: 60, submitSpreadPct: 8, resultPct: 100, reviewPct: 30 } },
  { id: 'limit', icon: '📈', name: 'Find my limit', text: 'Climbs steadily until it struggles.', cfg: { users: 1000, durationSec: 300, pattern: 'ramp' } },
  { id: 'stairs', icon: '🪜', name: 'Staircase', text: 'Adds students in equal steps.', cfg: { users: 1000, durationSec: 300, pattern: 'steps', stepCount: 5, warmupSec: 5 } },
  { id: 'waves', icon: '🌊', name: 'Two batches', text: 'Most now, the rest halfway through.', cfg: { users: 600, durationSec: 180, pattern: 'waves' } },
  { id: 'busy', icon: '🛒', name: 'Busy site', text: 'Test-takers plus many people browsing.', cfg: { users: 100, durationSec: 120, pattern: 'steady', browsers: 300, browsePerMin: 3, browserPerMin: 6 } },
  { id: 'soak', icon: '⏳', name: 'Soak', text: 'Steady load for 15 minutes to find slow leaks.', cfg: { users: 100, durationSec: 900, pattern: 'steady', warmupSec: 10 } },
  { id: 'big', icon: '🏔', name: 'Biggest possible', text: 'The most students your limits allow.', max: true, cfg: { durationSec: 300, pattern: 'ramp', warmupSec: 10 } },
];

/** Meter bar for one resource, with the colour showing how close it is to trouble. */
function Meter({ label, value, text, pct, warn = 70, bad = 90, hint }) {
  const tone = pct >= bad ? 'bad' : pct >= warn ? 'warn' : 'good';
  return (<div className={`lx-meter t-${tone}`} title={hint}><div><span>{label}</span><b>{text}</b></div><i style={{ '--w': `${Math.min(100, Math.max(2, pct || 0))}%` }} /></div>);
}

function Live({ run, info, onStop, stopping }) {
  const s = run.samples; const last = s[s.length - 1] || {}; const cfg = run.config; const everyone = cfg.users + (cfg.browsers || 0); const tot = run.totals || { req: 0, err: 0, peakRps: 0 };
  const total = cfg.durationSec + 4; const done = Math.min(100, Math.round(((run.elapsed || 0) / total) * 100)); const setup = run.phase === 'setup';
  const level = last.p95 > 2000 || last.errors > 3 ? 'bad' : last.p95 > 800 || last.errors ? 'warn' : 'good'; const word = { good: 'Healthy', warn: 'Slowing down', bad: 'Struggling' }[level];
  const errPct = tot.req ? Math.round((tot.err / tot.req) * 1000) / 10 : 0; const errs = Object.entries(run.errors || {}).sort((a, b) => b[1] - a[1]);
  const left = Math.max(0, total - (run.elapsed || 0));
  return (
    <section aria-live="polite" className="lx-live">
      <div className="card lx-head">
        <div className="lx-head-t">
          <h3>{setup ? 'Setting up' : run.phase === 'cleanup' ? 'Cleaning up' : 'Test running'} {run.phase === 'running' && <Badge tone={TONE[level]}>{word}</Badge>}</h3>
          <p className="muted small">{fmtN(cfg.users)} students{cfg.browsers ? ` + ${fmtN(cfg.browsers)} browsing` : ''} · {shapeName(cfg.pattern).toLowerCase()} · {lenText(cfg.durationSec)}{cfg.warmupSec ? ` · first ${cfg.warmupSec}s is warm-up` : ''}</p>
        </div>
        <div className="lx-head-r"><span className="lx-time">{setup ? (run.setupPct != null ? `${run.setupPct}%` : '…') : `${clock(run.elapsed)} / ${clock(total)}`}</span><button className="btn btn-danger btn-sm" disabled={stopping || run.phase === 'cleanup'} onClick={onStop}>{stopping ? 'Stopping…' : 'Stop test'}</button></div>
        <div className="lt-bar" role="progressbar" aria-valuenow={setup ? run.setupPct || 0 : done} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${setup ? run.setupPct || 3 : done}%` }} /></div>
        <p className="muted small lx-note">{run.note || (run.phase === 'running' ? `About ${clock(left)} left. Charts show the last ${Math.min(150, s.length)} seconds.` : '')}</p>
      </div>

      <div className="lx-kpis">
        <div className="lx-kpi"><span>Students active</span><b>{fmtN(run.active)}<small> of {fmtN(everyone)}</small></b><i className="lx-mini" style={{ '--w': `${Math.min(100, (run.active / Math.max(1, everyone)) * 100)}%` }} /></div>
        <div className="lx-kpi"><span>Requests per second</span><b>{fmtN(last.rps ?? 0)}</b><small>busiest {fmtN(tot.peakRps)} · {fmtN(tot.req)} so far</small></div>
        <div className={`lx-kpi ${last.p95 > 800 ? 't-bad' : last.p95 > 300 ? 't-warn' : ''}`}><span>Response time (p95)</span><b>{ms(last.p95 || 0)}</b><small>slowest 1 in 100: {ms(last.p99 || 0)}</small></div>
        <div className={`lx-kpi ${tot.err ? 't-bad' : ''}`}><span>Failed requests</span><b>{fmtN(tot.err)}</b><small>{errPct}% of all · {last.errors ?? 0} this second</small></div>
        <div className={`lx-kpi ${last.inflight > 1500 ? 't-warn' : ''}`}><span>Waiting for an answer</span><b>{fmtN(last.inflight ?? 0)}</b><small>requests in flight now</small></div>
      </div>

      <div className="lx-meters card">
        <Meter label="App CPU" text={`${last.cpuProc ?? 0}%`} pct={last.cpuProc ?? 0} warn={65} bad={85} hint="Share of one core. The app uses one core." />
        <Meter label="Server CPU" text={`${last.cpuSys ?? 0}%`} pct={last.cpuSys ?? 0} hint={`All ${info.cpus} cores together`} />
        <Meter label="Server memory" text={`${last.memUsedPct ?? 0}%`} pct={last.memUsedPct ?? 0} warn={75} bad={88} />
        <Meter label="App memory" text={bytes(last.rss)} pct={info.totalMem ? ((last.rss || 0) / info.totalMem) * 100 : 0} warn={40} bad={70} />
        <Meter label="Disk" text={last.diskUsedPct == null ? '–' : `${last.diskUsedPct}%`} pct={last.diskUsedPct || 0} warn={80} bad={93} />
        <Meter label="Database write" text={ms(last.writeMs || 0)} pct={((last.writeMs || 0) / 300) * 100} warn={35} bad={60} hint="Time to save one small change" />
        <Meter label="Server freeze" text={ms(last.lagMs || 0)} pct={((last.lagMs || 0) / 1000) * 100} warn={20} bad={50} hint="How long the server was too busy to answer" />
      </div>

      <div className="lx-cols">
        <div><Charts s={s} cpus={info.cpus} marks={run.marks} /></div>
        <aside className="lx-side">
          <LiveFeed events={run.events} live />
          {Object.keys(run.kinds || {}).length > 0 && <section className="card lx-actions"><h3>What students are doing</h3><div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Action</th><th>Done</th><th>p95</th><th>Failed</th></tr></thead><tbody>{Object.entries(run.kinds).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, v]) => <tr key={k}><td>{kindLabel(k)}</td><td>{fmtN(v.n)}</td><td><b className={v.p95 > 800 ? 'sx-bad' : ''}>{ms(v.p95)}</b></td><td>{v.errors ? <b className="sx-bad">{fmtN(v.errors)}</b> : '–'}</td></tr>)}</tbody></table></div></section>}
          {errs.length > 0 && <section className="card"><h3>Failures by type</h3><ul className="lx-errs">{errs.map(([k, n]) => <li key={k}><span>{/^\d+$/.test(k) ? `HTTP ${k}` : k}</span><b>{fmtN(n)}</b></li>)}</ul></section>}
        </aside>
      </div>
    </section>
  );
}

function Num({ label, k, form, set, lim, hint, placeholder, disabled, wide }) {
  const v = form[k]; const over = lim && v != null && v > lim[1];
  return (
    <label className={`ad-field lx-num ${wide ? 'wide' : ''}`}>{label}
      <input type="number" inputMode="numeric" disabled={disabled} min={lim?.[0]} max={lim?.[1]} placeholder={placeholder} value={v ?? ''} aria-invalid={over || undefined} onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} onBlur={() => { if (lim && v != null) set(k, Math.min(lim[1], Math.max(lim[0], v))); }} />
      {over ? <small className="sx-bad">Above your limit of {fmtN(lim[1])}.</small> : hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** A switch row: title and one line, with its own settings tucked underneath when it is on. */
function Row({ title, desc, on, onChange, locked, children }) {
  return (
    <div className={`lx-row ${on ? 'on' : ''}`}>
      <label className="lx-row-h"><span className="lx-sw"><input type="checkbox" role="switch" checked={on} disabled={locked} onChange={(e) => onChange?.(e.target.checked)} /><i /></span><span><b>{title}</b><small>{desc}</small></span></label>
      {on && children && <div className="lx-row-b">{children}</div>}
    </div>
  );
}

function Section({ n, title, sub, children, right }) {
  return (<section className="lx-sec"><header><h3><span>{n}</span>{title}</h3>{right}</header>{sub && <p className="muted small lx-sub">{sub}</p>}{children}</section>);
}

function Duration({ value, onChange, lim }) {
  const [unit, setUnit] = useState(value >= 3600 && value % 3600 === 0 ? 3600 : value >= 60 && value % 60 === 0 ? 60 : 1);
  const shown = value == null ? '' : Math.round((value / unit) * 100) / 100; const over = value != null && value > lim[1];
  return (
    <div className="ad-field lx-num"><span>Test length</span>
      <div className="lx-dur"><input type="number" min="0" aria-label="Test length" value={shown} aria-invalid={over || undefined} onChange={(e) => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * unit))} onBlur={() => value != null && onChange(Math.min(lim[1], Math.max(lim[0], value)))} />
        <select aria-label="Unit" value={unit} onChange={(e) => setUnit(Number(e.target.value))}><option value={1}>seconds</option><option value={60}>minutes</option><option value={3600}>hours</option></select></div>
      <div className="lx-chips">{LENGTHS.filter((x) => x <= lim[1]).map((x) => <button key={x} type="button" className={value === x ? 'on' : ''} onClick={() => { onChange(x); setUnit(x >= 3600 && x % 3600 === 0 ? 3600 : x >= 60 ? 60 : 1); }}>{x >= 3600 ? `${x / 3600}h` : x >= 60 ? `${x / 60}m` : `${x}s`}</button>)}</div>
      {over && <small className="sx-bad">Above your limit of {lenText(lim[1])}.</small>}
    </div>
  );
}

function Limits({ info, onClose, onSaved }) {
  const [v, setV] = useState({ ...Object.fromEntries(Object.entries(info.limits).map(([k, x]) => [k, k === 'customMax' ? x : x[1]])) }); const [busy, setBusy] = useState(false); const C = info.ceil;
  const FIELDS = [['users', 'Most students in one test', 'students'], ['browsers', 'Most extra browsing students', 'students'], ['durationSec', 'Longest test', 'seconds'], ['warmupSec', 'Longest warm-up', 'seconds'], ['stepCount', 'Most steps in a staircase', 'steps'], ['customMax', 'Most custom requests', 'requests']];
  const save = async (reset) => { setBusy(true); try { await api.put('/admin/loadtest/limits', reset ? { reset: true } : v); toast(reset ? 'Limits reset' : 'Limits saved'); onSaved(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  return (
    <section className="card lx-limits" aria-label="Test limits">
      <div className="lx-limits-h"><div><h3>Your limits</h3><p className="muted small">The largest values the setup form accepts. Raise them when your server is strong enough, lower them to stop a slip from running something huge. These apply to every new test.</p></div><button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>
      <div className="ad-grid g3">{FIELDS.map(([k, l, u]) => (<label key={k} className="ad-field">{l}<input type="number" min="1" max={C[k]} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: Number(e.target.value) }))} /><small className="muted">Up to {fmtN(C[k])} {u}{k === 'durationSec' ? ` (${lenText(C[k])})` : ''}</small></label>))}</div>
      <div className="lx-limits-f"><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(false)}>Save limits</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(true)}>Back to defaults</button></div>
    </section>
  );
}

function Setup({ info, d, form, set, setForm, onStart }) {
  const L = info.limits; const real = info.real || { students: 0, batches: [] }; const [adv, setAdv] = useState(false); const [showLimits, setShowLimits] = useState(false); const [pname, setPname] = useState(''); const [busy, setBusy] = useState(false); const [notes, setNotes] = useState(false);
  const pages = form.pages || []; const custom = form.custom || []; const sub = form.submitAtEnd; const tg = form.targets || {}; const total = (form.users || 0) + (form.browsers || 0);
  const [pre, setPre] = useState(null); const cfgKey = JSON.stringify({ ...form, note: '', label: '' });
  useEffect(() => { const h = setTimeout(() => { api.post('/admin/loadtest/preflight', form).then(setPre).catch(() => setPre(null)); }, 500); return () => clearTimeout(h); }, [cfgKey]); // eslint-disable-line
  const setTg = (k, v) => set('targets', { ...tg, [k]: v });
  const apply = (c) => setForm((f) => ({ ...d.defaults, mockId: f.mockId, targets: f.targets, custom: f.custom, pages: f.pages, label: f.label, ...c }));
  const savePreset = async () => { setBusy(true); try { await api.post('/admin/loadtest/presets', { name: pname, config: form }); setPname(''); toast('Preset saved'); d.reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const togglePage = (k) => set('pages', pages.includes(k) ? pages.filter((x) => x !== k) : [...pages, k]);
  const setCustom = (n, patch) => set('custom', custom.map((c, i) => (i === n ? { ...c, ...patch } : c)));
  const flip = (k, onVal) => (on) => set(k, on ? onVal : 0);
  const scen = useMemo(() => {
    const list = SCENARIOS.map((x) => ({ ...x, cfg: x.max ? { ...x.cfg, users: L.users[1] } : { ...x.cfg, users: Math.min(x.cfg.users, L.users[1]), ...(x.cfg.browsers ? { browsers: Math.min(x.cfg.browsers, L.browsers[1]) } : {}) }, text: x.max ? `${fmtN(L.users[1])} students, climbing gradually.` : x.text }));
    if (real.students > 1) list.push({ id: 'real', icon: '🎓', name: 'All my students', text: `${fmtN(real.students)} registered students join at once.`, cfg: { users: Math.min(real.students, L.users[1]), durationSec: 180, pattern: 'spike' } });
    if (real.batches[0]?.n > 1) list.push({ id: 'batch', icon: '👥', name: `Batch: ${real.batches[0].name}`, text: `${fmtN(real.batches[0].n)} students, steady.`, cfg: { users: Math.min(real.batches[0].n, L.users[1]), durationSec: 120, pattern: 'steady' } });
    return list;
  }, [L.users, L.browsers, real.students, real.batches]);
  const picked = scen.find((x) => form.users === x.cfg.users && form.pattern === x.cfg.pattern && form.durationSec === x.cfg.durationSec)?.id;
  const shape = SHAPES.find((x) => x[0] === form.pattern);
  const est = pre?.est;

  return (
    <div className="lx-setup">
      <div className="lx-top"><div><h3>Load test</h3><p className="muted">Send virtual students at this server and see where it bends. They sit a hidden copy of one of your mocks. Real students are not touched and everything is deleted afterwards.</p></div>
        <div className="lx-top-r"><button className="btn btn-ghost btn-sm" onClick={() => setShowLimits((x) => !x)} aria-expanded={showLimits}>Limits</button><button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...d.defaults, mockId: form.mockId })}>Reset</button></div></div>
      {showLimits && <Limits info={info} onClose={() => setShowLimits(false)} onSaved={() => { setShowLimits(false); d.reload(); }} />}

      <Section n="1" title="Choose a scenario" sub="A starting point. Everything below can still be changed.">
        <div className="lx-scen" role="group" aria-label="Scenarios">{scen.map((x) => <button key={x.id} type="button" className={`lx-sc ${picked === x.id ? 'on' : ''}`} aria-pressed={picked === x.id} onClick={() => apply(x.cfg)}><span aria-hidden="true">{x.icon}</span><b>{x.name}</b><small>{x.text}</small></button>)}</div>
        {d.presets.length > 0 && <div className="lx-mine" role="group" aria-label="Your saved presets"><span className="muted small">Yours</span>{d.presets.map((p) => <span key={p.id} className="chip lt-mine"><button type="button" onClick={() => apply({ ...p.config })}><b>{p.name}</b> <span className="small">{fmtN(p.config.users)} students</span></button><button type="button" className="lt-x" aria-label={`Delete preset ${p.name}`} onClick={async () => { await api.del(`/admin/loadtest/presets/${p.id}`); d.reload(); }}>×</button></span>)}</div>}
      </Section>

      <Section n="2" title="How big and how long" right={<button className="lx-link" onClick={() => setShowLimits(true)}>Change limits</button>}>
        <div className="lx-grid">
          <div className="ad-field lx-num"><span>Students sitting the test</span>
            <input type="number" min={L.users[0]} max={L.users[1]} aria-label="Students" value={form.users ?? ''} aria-invalid={form.users > L.users[1] || undefined} onChange={(e) => set('users', e.target.value === '' ? null : Number(e.target.value))} onBlur={() => form.users != null && set('users', Math.min(L.users[1], Math.max(L.users[0], form.users)))} />
            <div className="lx-chips">{SIZES.filter((x) => x <= L.users[1]).map((x) => <button key={x} type="button" className={form.users === x ? 'on' : ''} onClick={() => set('users', x)}>{fmtN(x)}</button>)}{!SIZES.includes(L.users[1]) && <button type="button" className={form.users === L.users[1] ? 'on' : ''} onClick={() => set('users', L.users[1])}>Max {fmtN(L.users[1])}</button>}</div>
            {form.users > L.users[1] && <small className="sx-bad">Above your limit of {fmtN(L.users[1])}.</small>}</div>
          <Duration value={form.durationSec} onChange={(v) => set('durationSec', v)} lim={L.durationSec} />
          <label className="ad-field lx-num">Mock to copy<select value={form.mockId} onChange={(e) => set('mockId', e.target.value)}>{info.mocks.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.questions} questions)</option>)}</select><small className="muted">Its first section is what students answer.</small></label>
        </div>
        <div className="lx-field-l"><span>How do students arrive?</span>
          <div className="lx-seg" role="radiogroup" aria-label="Arrival pattern">{SHAPES.map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={form.pattern === k} className={form.pattern === k ? 'on' : ''} onClick={() => set('pattern', k)}>{n}</button>)}</div>
          {shape && <p className="muted small lx-sub">{shape[2]}</p>}
          {form.pattern === 'steps' && <div style={{ maxWidth: 220 }}><Num label="Number of steps" k="stepCount" form={form} set={set} lim={L.stepCount} hint="Equal groups, one after another." /></div>}
        </div>
      </Section>

      <Section n="3" title="What students do" sub="Switch on what you want to test. Settings appear under each one.">
        <h4 className="lx-grp">During the test</h4>
        <Row title="Open the test" desc="Every student opens their test first." on locked />
        <Row title="Autosave answers" desc="The exam page saves answers on a timer. This is the main load." on locked>
          <Num label="Save every (seconds)" k="saveEverySec" form={form} set={set} lim={L.saveEverySec} /><Num label="Answers per save (up to)" k="saveSize" form={form} set={set} lim={L.saveSize} /><Num label="Already answered at start (%)" k="progress" form={form} set={set} lim={L.progress} hint="How far into the paper each student begins." />
        </Row>
        <Row title="Check progress" desc="The page re-reads the attempt now and then." on={form.pollPct > 0} onChange={flip('pollPct', 20)}><Num label="After this share of saves (%)" k="pollPct" form={form} set={set} lim={L.pollPct} /></Row>
        <Row title="Change section" desc="Students finish section 1 and start section 2. Needs a mock with two sections." on={!!form.sectionMoves} onChange={(on) => set('sectionMoves', on)}><Num label="At this point of the test (%)" k="sectionAtPct" form={form} set={set} lim={L.sectionAtPct} /></Row>
        <Row title="Tab-switch reports" desc="The page tells the server when a student leaves the tab (Integrity page)." on={form.integrityPerMin > 0} onChange={flip('integrityPerMin', 2)}><Num label="Reports per minute each" k="integrityPerMin" form={form} set={set} lim={L.integrityPerMin} /></Row>
        <Row title="Browse other pages" desc="Students open the pages you pick below while testing." on={form.browsePerMin > 0} onChange={flip('browsePerMin', 3)}><Num label="Page views per minute each" k="browsePerMin" form={form} set={set} lim={L.browsePerMin} /></Row>
        <Row title="Open the site home page" desc="Loads the page itself, not just data. Skipped if a web server in front serves it." on={form.homePerMin > 0} onChange={flip('homePerMin', 2)}><Num label="Views per minute each" k="homePerMin" form={form} set={set} lim={L.homePerMin} /></Row>
        <h4 className="lx-grp">At the end</h4>
        <Row title="Submit" desc="Students submit near the end. The heaviest moment." on={sub} onChange={(on) => set('submitAtEnd', on)}><Num label="Submit within the last (%)" k="submitSpreadPct" form={form} set={set} lim={L.submitSpreadPct} hint="Smaller is a sharper rush." /></Row>
        <Row title="Open the result" desc="Score and analysis page." on={sub && form.resultPct > 0} locked={!sub} onChange={flip('resultPct', 70)}><Num label="Share of students (%)" k="resultPct" form={form} set={set} lim={L.resultPct} /></Row>
        <Row title="Open the review page" desc="Answers, mistakes and the trick corner." on={sub && form.reviewPct > 0} locked={!sub} onChange={flip('reviewPct', 30)}><Num label="Share of students (%)" k="reviewPct" form={form} set={set} lim={L.reviewPct} /></Row>
        <Row title="Download the PDF report" desc="Building a PDF is heavy. Good to test before results go out." on={sub && form.pdfPct > 0} locked={!sub} onChange={flip('pdfPct', 20)}><Num label="Share of students (%)" k="pdfPct" form={form} set={set} lim={L.pdfPct} /></Row>
        <h4 className="lx-grp">Other people on the site</h4>
        <Row title="Students who only browse" desc="Dashboard, inbox, mock list: people using the site while others sit the test." on={form.browsers > 0} onChange={flip('browsers', 50)}><Num label="How many" k="browsers" form={form} set={set} lim={L.browsers} /><Num label="Page views per minute each" k="browserPerMin" form={form} set={set} lim={L.browserPerMin} /></Row>
        {(form.browsePerMin > 0 || form.browsers > 0) && <div className="lx-pages"><span className="small"><b>Pages they open</b> (read-only)</span><div className="lx-chips wrap">{(d.pages || []).map(([k, l]) => <button key={k} type="button" className={pages.includes(k) ? 'on' : ''} aria-pressed={pages.includes(k)} onClick={() => togglePage(k)}>{l}</button>)}<button type="button" className="lx-all" onClick={() => set('pages', (d.pages || []).map((x) => x[0]))}>All</button><button type="button" className="lx-all" onClick={() => set('pages', [])}>None</button></div></div>}
        <h4 className="lx-grp">Your own requests</h4>
        <details className="lx-det" open={custom.length > 0}><summary>{custom.length ? `${custom.length} custom request${custom.length > 1 ? 's' : ''}` : 'Add a request of your own'}</summary>
          <p className="small muted">Every virtual student is signed in. Use <code>{'{attempt}'}</code> for the student's test id and <code>{'{question}'}</code> for a question id. GET works on any student page. POST and PUT are limited to <code>/bookmarks</code>, <code>/notebook</code>, <code>/practice</code>, <code>{'/attempts/{attempt}/integrity'}</code> and <code>{'/attempts/{attempt}/errors/{question}'}</code>, and what they write is removed afterwards.</p>
          {custom.map((c, n) => { const m = c.method || 'GET'; const blocked = m !== 'GET' && c.path && !WRITE_OK.test(c.path); return (
            <div key={n} className="lt-custom lt-custom2">
              <select aria-label={`Request ${n + 1} method`} value={m} onChange={(e) => setCustom(n, { method: e.target.value })}>{METHODS.map((x) => <option key={x}>{x}</option>)}</select>
              <input aria-label={`Request ${n + 1} path`} placeholder="/mocks" value={c.path} maxLength={160} onChange={(e) => setCustom(n, { path: e.target.value })} />
              <label>per minute each <input type="number" min="1" max="60" value={c.perMin} onChange={(e) => setCustom(n, { perMin: Number(e.target.value) || 1 })} /></label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('custom', custom.filter((_, i) => i !== n))}>Remove</button>
              {m !== 'GET' && <input className="lt-body" aria-label={`Request ${n + 1} body`} placeholder='JSON body, for example {"leaves": 1}' value={c.body || ''} maxLength={800} onChange={(e) => setCustom(n, { body: e.target.value })} />}
              {blocked && <small className="sx-bad lt-warn">{m} is not allowed on this path, so it will be skipped.</small>}
            </div>); })}
          {custom.length < (L.customMax || 12) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('custom', [...custom, { path: '', method: 'GET', body: '', perMin: 6 }])}>Add a request</button> : <small className="muted">You reached your limit of {L.customMax} requests.</small>}
        </details>
      </Section>

      <Section n="4" title="What counts as a pass" sub="Optional. Set your own targets and the result is marked pass or fail.">
        <Row title="Check this test against my targets" desc="Shown as a pass or fail list at the top of the result." on={!!tg.enabled} onChange={(on) => setTg('enabled', on)}>
          {TARGETS.map(([k, l, hnt]) => <label key={k} className="ad-field lx-num">{l}<input type="number" inputMode="numeric" value={tg[k] ?? ''} onChange={(e) => setTg(k, e.target.value === '' ? '' : Number(e.target.value))} />{hnt && <small className="muted">{hnt}</small>}</label>)}
        </Row>
      </Section>

      <section className="lx-sec">
        <button type="button" className="lx-adv-t" aria-expanded={adv} onClick={() => setAdv(!adv)}><span>{adv ? '▾' : '▸'}</span> Advanced settings <small className="muted">timing, safety stop, warm-up, notes and presets</small></button>
        {adv && (
          <div className="lx-adv">
            <div className="lx-grid">
              <Num label="Joining spread (seconds)" k="rampSec" form={form} set={set} lim={L.rampSec} placeholder="Automatic" hint="How long students take to arrive." />
              <Num label="Warm-up to ignore (seconds)" k="warmupSec" form={form} set={set} lim={L.warmupSec} hint="Cold-start seconds left out of the result." />
              <Num label="Timing variety (%)" k="jitter" form={form} set={set} lim={L.jitter} hint="0 = every student saves on the beat." />
              <Num label="Marked for review (%)" k="markPct" form={form} set={set} lim={L.markPct} />
              <Num label="Stop if failures pass (%)" k="errStopPct" form={form} set={set} lim={L.errStopPct} hint="Safety stop for the test itself." />
              <Num label="Give up on a request after (seconds)" k="timeoutSec" form={form} set={set} lim={L.timeoutSec} hint="Slower than this counts as a failure." />
            </div>
            <div className="lx-grid">
              <label className="ad-field lx-num">Name this test<input maxLength={60} placeholder="Before Sunday's mock" value={form.label} onChange={(e) => set('label', e.target.value)} /></label>
              <label className="ad-field lx-num">Note saved with the result<input maxLength={300} placeholder="After moving to a bigger server" value={form.note || ''} onChange={(e) => set('note', e.target.value)} /></label>
              <div className="ad-field lx-num"><span>Keep these settings</span><div className="lt-save"><input aria-label="Preset name" maxLength={40} placeholder="Preset name" value={pname} onChange={(e) => setPname(e.target.value)} /><button className="btn btn-ghost btn-sm" disabled={!pname.trim() || busy} onClick={savePreset}>Save</button></div></div>
            </div>
          </div>)}
      </section>

      {!info.mocks.length && <p className="alert">There is no mock with at least 10 questions yet. Create one first.</p>}
      {info.maintenance !== 'off' && <p className="alert" role="status">Maintenance mode is on. Turn it off first or the virtual students are blocked.</p>}
      {pre?.blockers?.map((b2, i) => <p key={i} className="alert" role="alert"><b>Cannot start:</b> {b2}</p>)}

      <div className="lx-bar">
        <div className="lx-bar-t" role="status">
          <b>{fmtN(total)} virtual students</b>{form.browsers ? <span className="muted"> ({fmtN(form.users)} testing, {fmtN(form.browsers)} browsing)</span> : null}
          <span className="muted"> · {lenText(form.durationSec || 0)}{est ? ` · about ${fmtN(est.requests)} requests (${fmtN(est.rps)}/s)` : ''}{est?.setupSec > 5 ? ` · ${Math.round(est.setupSec)}s setup` : ''}{est?.dbMB > 50 ? ` · +${fmtN(est.dbMB)} MB temporary data` : ''}</span>
          {pre?.warnings?.length > 0 && <button type="button" className="lx-warns" aria-expanded={notes} onClick={() => setNotes(!notes)}>⚠ {pre.warnings.length} note{pre.warnings.length > 1 ? 's' : ''}</button>}
        </div>
        <button className="btn btn-primary" disabled={!info.mocks.length || info.maintenance !== 'off' || !form.users || !!pre?.blockers?.length} onClick={onStart}>Start the test</button>
        {notes && pre?.warnings?.length > 0 && <ul className="lx-notes">{pre.warnings.map((w, i) => <li key={i}>{w}</li>)}{est?.sharedCpuNote && <li className="muted">{est.sharedCpuNote}</li>}</ul>}
      </div>
    </div>
  );
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

export default function LoadTest() {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [form, setForm] = useState(null);
  const [view, setView] = useState({ name: 'new' }); const [dlg, setDlg] = useState(false); const [busy, setBusy] = useState(false); const [e2, setE2] = useState('');
  const timer = useRef(null); const wasRunning = useRef(false);
  const load = useCallback(() => api.get('/admin/loadtest').then((x) => { setD(x); setForm((f) => f || { ...x.defaults, mockId: x.info.mocks[0]?.id || '' }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const running = d?.run && !['done', 'failed'].includes(d.run.phase);
  const poll = useCallback(() => api.get('/admin/loadtest/live').then((x) => setD((p) => (p ? { ...p, run: x.run } : p))).catch(() => {}), []);
  useEffect(() => { clearInterval(timer.current); if (running) timer.current = setInterval(poll, 1000); return () => clearInterval(timer.current); }, [running, poll]);
  useEffect(() => { if (wasRunning.current && !running) { load(); if (d?.run?.report) openReport(d.run.report.id); } wasRunning.current = !!running; }, [running, d, load]);
  if (err) return <Err>{err}</Err>; if (!d || !form) return <Loading />;
  const { info, run } = d; d.reload = load; const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const start = async () => { setBusy(true); setE2(''); try { await api.post('/admin/loadtest/start', { ...form, mockId: form.mockId || info.mocks[0]?.id, confirm: 'start' }); setDlg(false); toast('Test started'); load(); } catch (e) { setE2(e.message); } finally { setBusy(false); } };
  const stop = async () => { try { await api.post('/admin/loadtest/stop'); load(); } catch (e) { toast(e.message, 'bad'); } };
  const openReport = async (id) => { try { const { report, vsBaseline } = await api.get(`/admin/loadtest/report/${id}`); setView({ name: 'report', id, rep: report, vs: vsBaseline }); } catch (e) { toast(e.message, 'bad'); load(); } };
  const compare = async (a, b) => { try { const x = await api.get(`/admin/loadtest/compare?a=${a}&b=${b}`); setView({ name: 'compare', data: x }); } catch (e) { toast(e.message, 'bad'); } };
  const setBase = async (id) => { try { await api.put('/admin/loadtest/baseline', { id }); toast('Baseline set. Later tests compare against it.'); load(); openReport(id); } catch (e) { toast(e.message, 'bad'); } };
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
      {view.name === 'list' && <Results baselineId={d.baselineId} h={hist} onOpen={openReport} onCompare={compare} onChanged={load} onRerunId={rerunId} />}
      {view.name === 'report' && <Report rep={view.rep} baselineId={d.baselineId} vs={view.vs} onBaseline={setBase} prevId={prev?.id} onAgain={() => setView({ name: 'new' })} onRerun={rerun} onCompare={compare} onChanged={() => { load(); openReport(view.id); }} />}
      {view.name === 'compare' && <Compare a={view.data.a} b={view.data.b} cmp={view.data} onBack={() => setView({ name: 'list' })} onSwap={() => compare(view.data.b.id, view.data.a.id)} />}
      {dlg && <ConfirmModal title={`Run a ${lenText(form.durationSec)} test with ${fmtN(form.users + form.browsers)} students?`} word="start" label="Start test" busy={busy} error={e2} onClose={() => setDlg(false)} onConfirm={start}>
        <p>The server will work hard for about {lenText(form.durationSec + 15)}. Pages may feel slower for anyone else using it. The virtual students and their data are removed when it ends, and the result is saved so you can compare it later.</p></ConfirmModal>}
    </section>
  );
}
