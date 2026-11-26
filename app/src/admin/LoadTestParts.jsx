import { useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Empty, Stat, dt, toast } from './ui.jsx';

export const MB = 1048576;
export const bytes = (b) => (b == null ? '–' : b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
export const ms = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const TONE = { good: 'good', ok: 'good', warn: 'warn', bad: 'bad', info: '' };
export const SHAPES = [['steady', 'Steady', 'Students join over a short spread and keep working. Like a normal exam start.'], ['spike', 'All at once', 'Everyone joins in the first second. Like a live mock where the link goes out at 10:00.'], ['ramp', 'Gradual climb', 'Students join one by one all through the test. Finds the point where the server starts to struggle.'], ['steps', 'Staircase', 'Students join in equal groups, with a pause between. Shows how the server does at each size, step by step.'], ['waves', 'Two waves', 'Most students join at the start and a second group arrives halfway. Like latecomers or a second batch.']];
const SHAPE_NAME = Object.fromEntries(SHAPES.map(([k, n]) => [k, n]));
export const shapeName = (k) => SHAPE_NAME[k || 'steady'];
const KIND_NAMES = { open: 'Open the test', save: 'Autosave answers', poll: 'Check progress', submit: 'Submit the test', result: 'Open the result', review: 'Review page (4 calls each)', pdf: 'Download PDF report', section: 'Move to the next section', integrity: 'Tab-switch reports', home: 'Open the site home page' };
export const kindLabel = (k) => KIND_NAMES[k] || (k.startsWith('page:') ? `Page ${k.slice(5)}` : k.startsWith('custom:') ? `Custom ${k.slice(7)}` : k);
export const kindOrder = (ks) => [...Object.keys(KIND_NAMES).filter((k) => ks.includes(k)), ...ks.filter((k) => !KIND_NAMES[k]).sort()];
export const title = (x) => x.label || `${x.users} students, ${dt(x.at)}`;

/** Line chart. `lines` = [{data, key, color, name, dash}]. Optional vertical `marks` = [{t,label}]. */
export function Chart({ title: ttl, lines, max, unit = '', fmt = (v) => Math.round(v), note, marks = [], legend }) {
  const W = 360, H = 138, L = 38, R = 8, T = 10, B = 20; const iw = W - L - R, ih = H - T - B;
  const all = lines.flatMap((l) => l.data.map((d) => d[l.key] || 0)); const top = max || Math.max(1, ...all) * 1.15; const tMax = Math.max(1, ...lines.flatMap((l) => l.data.map((d) => d.t)));
  const x = (t) => L + (t / tMax) * iw; const y = (v) => T + ih - Math.min(1, (v || 0) / top) * ih;
  return (
    <figure className="lt-chart">
      <figcaption><b>{ttl}</b><span>{lines.map((l, i) => { const d = l.data[l.data.length - 1]; return d ? <em key={i} style={{ color: l.color }}>{fmt(d[l.key] ?? 0)}{unit}</em> : null; })}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ttl} over time`}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} className="lt-grid" /><text x={L - 5} y={y(top * f) + 3} textAnchor="end" className="lt-ax">{fmt(top * f)}</text></g>)}
        {marks.filter((m) => m.t <= tMax).map((m, i) => <g key={i}><line x1={x(m.t)} x2={x(m.t)} y1={T} y2={T + ih} className="lt-mark" /><text x={x(m.t) + 3} y={T + 9} className="lt-ax">{m.label}</text></g>)}
        {lines.map((l, i) => <path key={i} className="lt-line" style={{ stroke: l.color, strokeDasharray: l.dash }} d={l.data.map((d, j) => `${j ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d[l.key]).toFixed(1)}`).join('')} />)}
        <text x={L} y={H - 4} className="lt-ax">0s</text><text x={W - R} y={H - 4} textAnchor="end" className="lt-ax">{Math.round(tMax)}s</text>
      </svg>
      {legend && <div className="lt-legend">{lines.map((l, i) => <span key={i}><i style={{ background: l.color, opacity: l.dash ? 0.5 : 1 }} />{l.name}</span>)}</div>}
      {note && <small className="muted">{note}</small>}
    </figure>
  );
}

export function Charts({ s, cpus, marks }) {
  const one = (key, color, name) => [{ data: s, key, color, name }];
  return (
    <div className="lt-charts">
      <Chart title="Students active" lines={one('users', 'var(--brand)')} marks={marks} note="How many virtual students were working at each moment." />
      <Chart title="Requests per second" lines={one('rps', 'var(--brand)')} marks={marks} />
      <Chart title="Response time (95th percentile)" lines={one('p95', 'var(--bad)')} unit=" ms" marks={marks} note="95 out of 100 requests were faster than this." />
      <Chart title="Failed requests" lines={one('errors', 'var(--bad)')} marks={marks} note="Requests that failed in each second." />
      <Chart title="CPU" lines={[{ data: s, key: 'cpuProc', color: 'var(--brand)', name: 'App' }, { data: s, key: 'cpuSys', color: 'var(--muted)', name: `Whole server (${cpus} cores)` }]} max={100} unit="%" legend marks={marks} note="App = share of one core (the app uses one core)." />
      <Chart title="Memory used (whole server)" lines={one('memUsedPct', 'var(--warn)')} max={100} unit="%" marks={marks} />
      <Chart title="Database write time" lines={one('writeMs', 'var(--bad)')} unit=" ms" marks={marks} note="Time to commit one small change. Rises when the database is busy." />
      <Chart title="Server freezes (event loop)" lines={one('lagMs', 'var(--warn)')} unit=" ms" marks={marks} note="How long the server was too busy to answer. Students feel this as a frozen page." />
    </div>
  );
}

export function ScoreRing({ score, level }) {
  const c = 2 * Math.PI * 34; const col = level === 'bad' ? 'var(--bad)' : level === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (<svg className="lt-ring" viewBox="0 0 80 80" role="img" aria-label={`Health score ${score} out of 100`}><circle cx="40" cy="40" r="34" fill="none" stroke="var(--line)" strokeWidth="8" /><circle cx="40" cy="40" r="34" fill="none" stroke={col} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 40 40)" /><text x="40" y="45" textAnchor="middle" className="lt-ring-n">{score}</text></svg>);
}

export function Feed({ events }) {
  if (!events?.length) return null;
  return (<section className="card"><h3 style={{ marginTop: 0 }}>What happened</h3><ol className="lt-feed">{events.map((e, i) => <li key={i} className={`t-${e.level}`}><time>{Math.round(e.t)}s</time><span>{e.text}</span></li>)}</ol></section>);
}

/** Capacity curve for a "gradual climb" test: response time at each number of active students. */
function Curve({ curve, limit }) {
  if (!curve?.length) return null; const top = Math.max(1000, ...curve.map((c) => c.p95)) * 1.1;
  return (
    <section className="card"><h3 style={{ marginTop: 0 }}>Where it started to struggle</h3>
      <p className="muted small">Each bar is response time at that many students active together. Green bars were healthy (under 800 ms with no failures).{limit ? (limit.users > 0 ? ` The healthy zone ended at ${limit.users} students${limit.atLeast ? ', the highest tested.' : '.'}` : ' It struggled even at the first step.') : ''}</p>
      <div className="lt-curve" role="img" aria-label="Response time by number of students">{curve.map((c) => { const bad = c.p95 > 800 || c.errorPct >= 1; return (<div key={c.users} className="lt-bar-col"><span className="lt-bar-v">{ms(c.p95)}</span><i className={bad ? 'bad' : 'good'} style={{ height: `${Math.max(4, (c.p95 / top) * 100)}%` }} /><b>{c.users}</b>{c.errorPct > 0 && <small className="sx-bad">{c.errorPct}% failed</small>}</div>); })}</div>
    </section>
  );
}

/** The admin's own pass or fail targets, one line each. */
function Targets({ t }) {
  if (!t) return null;
  return (
    <section className={`card lt-targets ${t.pass ? 'ok' : 'no'}`} aria-label="Your targets">
      <h3 style={{ marginTop: 0 }}>{t.pass ? 'Meets all your targets' : `Misses ${t.total - t.passed} of ${t.total} targets`}{t.stoppedEarly ? ' (the test stopped early)' : ''}</h3>
      <ul className="lt-tlist">{t.items.map((x) => <li key={x.key} className={x.pass ? 'pass' : 'fail'}><span aria-hidden="true">{x.pass ? '✓' : '✗'}</span><b>{x.label}</b><em>{x.unit === 'ms' ? ms(x.actual) : `${x.actual}%`} <small>target {x.unit === 'ms' ? ms(x.limit) : `${x.limit}%`} or less</small></em></li>)}</ul>
    </section>
  );
}

/** Staircase result: how the server did at each step of more students. */
function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <section className="card" style={{ padding: 0, marginTop: 12 }}>
      <h3 style={{ padding: '12px 14px 0', margin: 0 }}>Step by step</h3><p className="muted small" style={{ padding: '0 14px' }}>The first moment after each group joined is skipped so the numbers show a settled server.</p>
      <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Step</th><th>Students</th><th>Requests per second</th><th>Slowest p95</th><th>Failed</th><th>App CPU peak</th></tr></thead>
        <tbody>{steps.map((x) => <tr key={x.step}><td>{x.step}</td><td>{x.users}</td><td>{x.rps}</td><td><b className={x.p95 > 800 ? 'sx-bad' : ''}>{ms(x.p95)}</b></td><td>{x.errorPct}%</td><td>{x.cpu}%</td></tr>)}</tbody></table></div>
    </section>
  );
}

/** Autosave speed across saved tests, oldest to newest: did the last change help? */
export function Trend({ h }) {
  const list = (h || []).filter((x) => x.hasReport && x.p95 != null).slice(0, 12).reverse(); if (list.length < 2) return null;
  const data = list.map((x, i) => ({ t: i, p95: x.p95, errors: x.errorPct * 100 })); const top = Math.max(300, ...list.map((x) => x.p95)) * 1.15;
  const W = 520, H = 120, L = 44, R = 10, T = 10, B = 22; const xs = (i) => L + (i / (list.length - 1)) * (W - L - R); const ys = (v) => T + (H - T - B) - Math.min(1, v / top) * (H - T - B);
  return (
    <section className="card" style={{ margin: '12px 0' }}>
      <h3 style={{ margin: '0 0 4px' }}>Autosave speed over your last {list.length} tests</h3><p className="muted small" style={{ margin: '0 0 6px' }}>Lower is better. Each dot is one test, oldest on the left.</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Autosave response time across saved tests" style={{ width: '100%', maxHeight: 150 }}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={ys(top * f)} y2={ys(top * f)} className="lt-grid" /><text x={L - 5} y={ys(top * f) + 3} textAnchor="end" className="lt-ax">{Math.round(top * f)} ms</text></g>)}
        <path className="lt-line" style={{ stroke: 'var(--brand)' }} d={data.map((d, j) => `${j ? 'L' : 'M'}${xs(j).toFixed(1)},${ys(d.p95).toFixed(1)}`).join('')} />
        {list.map((x, i) => <g key={x.id}><circle cx={xs(i)} cy={ys(x.p95)} r="4.5" fill={x.level === 'bad' ? 'var(--bad)' : x.level === 'warn' ? '#d99a1e' : 'var(--brand)'}><title>{`${x.label || `${x.users} students`}: ${Math.round(x.p95)} ms`}</title></circle><text x={xs(i)} y={H - 5} textAnchor="middle" className="lt-ax">{x.users}</text></g>)}
      </svg>
      <small className="muted">Numbers under the dots are the students in each test.</small>
    </section>
  );
}

/** "Will it handle N students?" using the numbers from this test. */
function Planner({ rep }) {
  const [n, setN] = useState(Math.max(rep.config.users * 2, 100)); const u = rep.config.users;
  const busy = (rep.samples || []).filter((x) => x.users >= Math.max(1, u * 0.5)); const avgCpu = busy.length ? busy.reduce((a, x) => a + x.cpuProc, 0) / busy.length : rep.peaks.cpuProc; const f = n / u; const cpu = Math.round(avgCpu * f); const base = rep.baseline?.rssMB || 0; const rss = Math.round(base + (rep.peaks.rssMB - base) * f); const mem = rep.peaks.memUsedPct + ((rss - rep.peaks.rssMB) / (rep.server.totalMem / MB)) * 100;
  const level = cpu >= 95 || mem >= 90 ? 'bad' : cpu >= 80 || mem >= 80 ? 'warn' : cpu >= 60 ? 'ok' : 'good';
  const words = { good: 'Should be comfortable.', ok: 'Should work, with little room to spare.', warn: 'Risky. Expect slow saves at the busiest moments.', bad: 'Likely to struggle. Test it for real before the exam.' }[level];
  return (
    <section className="card"><h3 style={{ marginTop: 0 }}>Planning an exam? Estimate for a bigger crowd</h3>
      <p className="muted small">Scales the busy-time numbers from this test ({u} students) up or down. It is an estimate: run a real test at that size to be sure.</p>
      <label className="ad-field" style={{ maxWidth: 220 }}>Students at the same time<input type="number" min="1" max="5000" value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} /></label>
      <div className="ad-grid g4" style={{ marginTop: 10 }}><Stat icon="🧠" label="App processor" value={cpu > 100 ? 'Over 100%' : `${cpu}%`} tone={cpu >= 80 ? 'bad' : ''} sub={cpu > 100 ? 'more than one core can do' : 'of one core, while busy'} /><Stat icon="💾" label="App memory" value={`${rss} MB`} /><Stat icon="🖥" label="Server memory used" value={`${Math.round(mem)}%`} tone={mem >= 85 ? 'bad' : ''} /><Stat icon="✅" label="Outlook" value={level === 'good' ? 'Comfortable' : level === 'ok' ? 'Tight' : level === 'warn' ? 'Risky' : 'Too much'} tone={TONE[level] === 'bad' ? 'bad' : ''} /></div>
      <p style={{ marginBottom: 0 }}><Badge tone={TONE[level]}>{words}</Badge></p>
    </section>
  );
}

const csv = (rep) => { const keys = Object.keys(rep.samples[0] || {}); return [keys.join(','), ...rep.samples.map((x) => keys.map((k) => x[k] ?? '').join(','))].join('\n'); };
const save = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

export function Report({ rep, onAgain, onRerun, onCompare, onChanged, prevId }) {
  const v = rep.verdict; const k = rep.kinds; const rows = kindOrder(Object.keys(k)).map((x) => [x, kindLabel(x)]);
  const stamp = new Date(rep.at).toISOString().slice(0, 16).replace(':', '-'); const [edit, setEdit] = useState(false); const [label, setLabel] = useState(rep.label || ''); const [note, setNote] = useState(rep.note || '');
  const patch = async (b) => { try { await api.put(`/admin/loadtest/report/${rep.id}`, b); onChanged?.(); } catch (e) { toast(e.message, 'bad'); } };
  const bn = rep.bottleneck; const sc = rep.scorecard || [];
  return (
    <section>
      <div className={`card lt-verdict t-${TONE[v.level]}`}>
        <ScoreRing score={rep.score ?? 0} level={v.level} />
        <div className="lt-vmain"><Badge tone={TONE[v.level]}>{v.title}</Badge>{rep.pinned && <Badge>Pinned</Badge>}
          <h2>{rep.label ? `${rep.label}: ` : ''}{rep.config.users} students for {rep.config.durationSec} seconds</h2>
          <p className="muted small" style={{ margin: '0 0 6px' }}>{dt(rep.at)} · {shapeName(rep.config.pattern)} · mock: {rep.server.mock}</p><p>{v.text}</p>
          {rep.stopped && <p className="small"><b>Stopped early:</b> {rep.stopReason}</p>}
          {rep.measuredLimit ? <p className="small"><b>Measured limit:</b> {rep.measuredLimit.users > 0 ? `healthy up to ${rep.measuredLimit.users} students${rep.measuredLimit.atLeast ? ' (the highest tested, so the real limit is higher)' : ''}` : 'below the smallest group tested'}.</p>
            : rep.estimate ? <p className="small">Rough ceiling on this server: <b>about {rep.estimate} students at once</b>. An estimate from how busy the app was, not a guarantee. Use "Gradual climb" for a measured limit.</p> : <p className="small">The app was barely busy, so the real limit is well above {rep.config.users}. Run again with more students, or use "Gradual climb", to find it.</p>}
          {bn && <p className="small"><b>{bn.title}.</b> {bn.text}</p>}
          {rep.note && !edit && <p className="small muted">Note: {rep.note}</p>}
          {edit && <div className="lt-edit"><input aria-label="Name" placeholder="Name, for example Before Sunday exam" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} /><input aria-label="Note" placeholder="Note (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn-primary btn-sm" onClick={async () => { await patch({ label, note }); setEdit(false); }}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancel</button></div>}
        </div>
        <div className="lt-actions">
          <button className="btn btn-primary" onClick={onAgain}>New test</button><button className="btn btn-ghost" onClick={() => onRerun(rep.config)}>Run again with the same settings</button>
          {prevId && <button className="btn btn-ghost" onClick={() => onCompare(prevId, rep.id)}>Compare with the test before</button>}
          <button className="btn btn-ghost" onClick={() => setEdit(true)}>Name and note</button><button className="btn btn-ghost" onClick={() => patch({ pinned: !rep.pinned })}>{rep.pinned ? 'Unpin' : 'Pin (keep)'}</button>
          <button className="btn btn-ghost" onClick={() => save(`load-test-${stamp}.json`, JSON.stringify(rep, null, 2), 'application/json')}>Download report</button><button className="btn btn-ghost" onClick={() => save(`load-test-${stamp}.csv`, csv(rep), 'text/csv')}>Download CSV</button>
        </div>
      </div>

      {rep.plain?.length > 0 && <section className="card" style={{ marginTop: 12 }}><h3 style={{ marginTop: 0 }}>In plain words</h3><ul className="lt-advice">{rep.plain.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}

      {sc.length > 0 && <div className="lt-sc" style={{ marginTop: 12 }}>{sc.map((c) => <div key={c.key} className={`lt-sc-i t-${TONE[c.status]} s-${c.status}`}><div><span className="lt-dot" aria-hidden="true" /><b>{c.label}</b></div><strong>{c.value}</strong><small>{c.meaning}</small></div>)}</div>}

      <div className="ad-grid g4" style={{ margin: '12px 0' }}>
        <Stat icon="📨" label="Requests sent" value={rep.totals.requests} sub={`${rep.totals.avgRps} per second on average`} /><Stat icon="⚡" label="Busiest second" value={`${rep.totals.peakRps}/s`} />
        <Stat icon="⏱" label="95th percentile, all requests" value={ms(rep.totals.p95)} sub={`slowest ${ms(rep.totals.max)}`} /><Stat icon="⚠" label="Failed requests" value={`${rep.totals.errors} (${rep.totals.errorPct}%)`} tone={rep.totals.errors ? 'bad' : 'good'} />
      </div>
      <Targets t={rep.targets} />
      <Steps steps={rep.steps} />
      <Curve curve={rep.curve} limit={rep.measuredLimit} />
      <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
        <section className="card" style={{ padding: 0 }}>
          <h3 style={{ padding: '12px 14px 0', margin: 0 }}>What students did</h3>
          <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Action</th><th>Count</th><th>Typical</th><th>p95</th><th>p99</th><th>Slowest</th><th>Failed</th></tr></thead>
            <tbody>{rows.map(([x, l]) => <tr key={x}><td>{l}</td><td>{k[x].n}</td><td>{ms(k[x].p50)}</td><td><b>{ms(k[x].p95)}</b></td><td>{ms(k[x].p99)}</td><td>{ms(k[x].max)}</td><td>{k[x].errors || '–'}</td></tr>)}</tbody></table></div>
          {Object.keys(rep.errors).length > 0 && <p className="small sx-bad" style={{ padding: '0 14px 10px' }}>Errors: {Object.entries(rep.errors).map(([c, n]) => `${c} ×${n}`).join(', ')}{rep.totals.busy ? ` · ${rep.totals.busy} database lock errors` : ''}</p>}
          <p className="small muted" style={{ padding: '0 14px 12px', margin: 0 }}>p95 = 95 out of 100 were faster. p99 = 99 out of 100 were faster.</p>
        </section>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Server load at the peak</h3>
          <dl className="sx-kv">
            <dt>App CPU (share of one core)</dt><dd>{rep.peaks.cpuProc}%</dd><dt>Whole-server CPU ({rep.server.cpus} cores)</dt><dd>{rep.peaks.cpuSys}%</dd>
            <dt>App memory</dt><dd>{rep.peaks.rssMB} MB{rep.baseline?.rssMB ? ` (${rep.baseline.rssMB} MB before)` : ''}</dd><dt>Server memory used</dt><dd>{rep.peaks.memUsedPct}% of {bytes(rep.server.totalMem)}</dd>
            <dt>Disk used</dt><dd>{rep.peaks.diskUsedPct ? `${rep.peaks.diskUsedPct}%` : '–'}</dd><dt>Database grew by</dt><dd>{rep.dbGrowthMB} MB (removed after the test)</dd>
            <dt>Slowest database write</dt><dd>{ms(rep.peaks.writeMs)}</dd><dt>Longest server freeze</dt><dd>{ms(rep.peaks.lagMs)}</dd>
            {rep.moments?.slowestAt != null && <><dt>Slowest moment</dt><dd>{rep.moments.slowestAt}s in: {ms(rep.moments.slowestP95)} with {rep.moments.slowestUsers} students</dd></>}
          </dl>
        </section>
      </div>
      <section className="card" style={{ marginTop: 12 }}><h3 style={{ marginTop: 0 }}>What to do about it</h3><ul className="lt-advice">{rep.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p className="small muted">The test runs on the server itself, so it is slightly harder on it than real students on separate devices. The app uses one database connection, so queued writes show up as write time and server freezes rather than lock errors.</p></section>
      <div style={{ marginTop: 12 }}><Planner rep={rep} /></div>
      <div style={{ marginTop: 12 }}><Feed events={rep.events} /></div>
      {rep.samples && <Charts s={rep.samples} cpus={rep.server.cpus} marks={rep.marks} />}
    </section>
  );
}

const arrow = (r) => (r.delta == null ? '' : r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '=');
const val = (v, u) => (v == null ? '–' : u === 'ms' ? ms(v) : `${v}${u === '%' ? '%' : u ? ` ${u}` : ''}`);

export function Compare({ a, b, cmp, onSwap, onBack }) {
  const Head = ({ r, tag }) => (<div className="card lt-cmp-h"><span className="muted small">{tag}</span><b>{r.label || `${r.config.users} students`}</b><span className="muted small">{dt(r.at)} · {r.config.users} students · {r.config.durationSec}s · {shapeName(r.config.pattern)}</span><div><Badge tone={TONE[r.verdict.level]}>{r.verdict.title}</Badge> <span className="small">score <b>{r.score ?? '–'}</b></span></div></div>);
  const two = (key, color = 'var(--bad)') => [{ data: a.samples || [], key, color: 'var(--muted)', name: `A: ${title({ ...a.config, at: a.at, label: a.label, users: a.config.users })}`, dash: '4 3' }, { data: b.samples || [], key, color, name: `B: ${title({ at: b.at, label: b.label, users: b.config.users })}` }];
  return (
    <section>
      <p><button className="btn btn-ghost btn-sm" onClick={onBack}>Back to results</button> <button className="btn btn-ghost btn-sm" onClick={onSwap}>Swap A and B</button></p>
      <div className="ad-grid g2"><Head r={a} tag="A (before)" /><Head r={b} tag="B (after)" /></div>
      <section className={`card lt-verdict ${cmp.worse > cmp.better ? 't-bad' : cmp.better > cmp.worse ? 't-good' : 't-warn'}`} style={{ marginTop: 12 }}>
        <div><h2 style={{ marginTop: 0 }}>{cmp.headline}</h2>{cmp.lines.map((l, i) => <p key={i} style={{ margin: '4px 0' }}>{l}</p>)}
          {cmp.caution && <p className="small"><b>Careful:</b> {cmp.caution}</p>}
          {cmp.diffs.length > 0 && <p className="small muted">What was different: {cmp.diffs.map((d) => `${d.label} ${String(d.a)} to ${String(d.b)}`).join(' · ')}</p>}</div>
      </section>
      <section className="card" style={{ padding: 0, marginTop: 12 }}><div style={{ overflowX: 'auto' }}><table className="ad-table lt-cmp"><thead><tr><th>Measure</th><th>A</th><th>B</th><th>Change</th></tr></thead>
        <tbody>{cmp.rows.map((r) => <tr key={r.key}><td>{r.label}</td><td>{val(r.a, r.unit)}</td><td><b>{val(r.b, r.unit)}</b></td><td className={`c-${r.verdict}`}>{r.delta == null ? '–' : `${arrow(r)} ${r.pct != null ? `${r.pct > 0 ? '+' : ''}${r.pct}%` : val(Math.abs(r.delta), r.unit)}`}{r.verdict !== 'same' && <span className="small"> {r.verdict}</span>}</td></tr>)}</tbody></table></div></section>
      <div className="lt-charts">
        <Chart title="Response time (p95)" lines={two('p95')} unit=" ms" legend /><Chart title="Students active" lines={two('users', 'var(--brand)')} legend />
        <Chart title="App CPU" lines={two('cpuProc', 'var(--brand)')} max={100} unit="%" legend /><Chart title="Server memory used" lines={two('memUsedPct', 'var(--warn)')} max={100} unit="%" legend />
        <Chart title="Database write time" lines={two('writeMs')} unit=" ms" legend /><Chart title="Server freezes" lines={two('lagMs', 'var(--warn)')} unit=" ms" legend />
      </div>
    </section>
  );
}

export function Results({ h, onOpen, onCompare, onChanged, onRerunId }) {
  const [sel, setSel] = useState([]); const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const [busy, setBusy] = useState('');
  if (!h?.length) return <Empty>No saved tests yet. Run a test and the result is saved here so you can compare it with later ones.</Empty>;
  const act = async (fn, id) => { setBusy(id); try { await fn(); onChanged(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); } };
  const ordered = sel.map((id) => h.find((x) => x.id === id)).filter(Boolean).sort((p, q) => p.at - q.at);
  return (
    <>
    <Trend h={h} />
    <section className="card" style={{ padding: 0 }}>
      <div className="lt-rbar"><h3 style={{ margin: 0 }}>Saved tests</h3><span className="muted small">Tick two tests to compare them. The last 15 are kept, plus any you pin.</span>
        <button className="btn btn-primary btn-sm" disabled={sel.length !== 2 || ordered.some((x) => !x.hasReport)} onClick={() => onCompare(ordered[0].id, ordered[1].id)}>Compare the two</button>
        <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.del('/admin/loadtest/history'), 'all')}>Clear unpinned</button></div>
      <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th><span className="sr-only">Compare</span></th><th>Test</th><th>Setup</th><th>Autosave p95</th><th>Failed</th><th>Peak CPU</th><th>Score</th><th>Result</th><th /></tr></thead>
        <tbody>{h.map((x) => <tr key={x.id}>
          <td><input type="checkbox" aria-label={`Select ${title(x)} to compare`} checked={sel.includes(x.id)} disabled={!x.hasReport} onChange={() => toggle(x.id)} /></td>
          <td>{x.hasReport ? <button className="sx-link" onClick={() => onOpen(x.id)}>{x.label || 'Untitled test'}</button> : <span>{x.label || 'Older test'}</span>}{x.pinned && <> <Badge>Pinned</Badge></>}<div className="muted small">{dt(x.at)}</div></td>
          <td>{x.users} for {x.durationSec}s<div className="muted small">{shapeName(x.pattern)}</div></td><td>{ms(x.p95)}</td><td>{x.errorPct}%</td><td>{x.peakCpu}%</td><td>{x.score ?? '–'}</td>
          <td><Badge tone={TONE[x.level]}>{x.title}{x.stopped ? ' (stopped)' : ''}</Badge>{x.targets && <div className={`small ${x.targets.pass ? '' : 'sx-bad'}`}>{x.targets.pass ? '✓ Targets met' : `✗ ${x.targets.total - x.targets.passed} target${x.targets.total - x.targets.passed > 1 ? 's' : ''} missed`}</div>}</td>
          <td className="lt-row-act">{x.hasReport ? <><button className="btn btn-ghost btn-sm" onClick={() => onOpen(x.id)}>Open</button><button className="btn btn-ghost btn-sm" disabled={busy === x.id} onClick={() => act(() => api.put(`/admin/loadtest/report/${x.id}`, { pinned: !x.pinned }), x.id)}>{x.pinned ? 'Unpin' : 'Pin'}</button><button className="btn btn-ghost btn-sm" onClick={() => onRerunId(x.id)}>Run again</button></> : <span className="muted small">Summary only</span>}
            <button className="btn btn-ghost btn-sm" disabled={busy === x.id} onClick={() => act(() => api.del(`/admin/loadtest/report/${x.id}`), x.id)}>Delete</button></td></tr>)}</tbody></table></div>
    </section>
    </>
  );
}
