import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Err, Loading, Stat, dt, toast } from './ui.jsx';

const MB = 1048576;
const bytes = (b) => (b == null ? '–' : b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const ms = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const PRESETS = [[50, 'Small class'], [100, 'Big batch'], [250, 'Live exam'], [500, 'Stress']];
const TONE = { good: 'good', ok: 'good', warn: 'warn', bad: 'bad' };

/** A small line chart with a labelled axis. `series` is [{key, label, color}], data is the samples array. */
function Chart({ title, data, series, max, unit = '', fmt = (v) => Math.round(v), note }) {
  const W = 360, H = 130, L = 36, R = 8, T = 8, B = 20; const iw = W - L - R, ih = H - T - B;
  const top = max || Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))) * 1.15; const n = Math.max(2, data.length);
  const x = (i) => L + (i / (n - 1)) * iw; const y = (v) => T + ih - Math.min(1, (v || 0) / top) * ih;
  const last = data[data.length - 1];
  return (
    <figure className="lt-chart">
      <figcaption><b>{title}</b><span>{last ? series.map((s) => <em key={s.key} style={{ color: s.color }}>{fmt(last[s.key] ?? 0)}{unit}</em>) : null}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} over time`}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} className="lt-grid" /><text x={L - 5} y={y(top * f) + 3} textAnchor="end" className="lt-ax">{fmt(top * f)}</text></g>)}
        {series.map((s) => <path key={s.key} className="lt-line" style={{ stroke: s.color }} d={data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`).join('')} />)}
        <text x={L} y={H - 4} className="lt-ax">0s</text><text x={W - R} y={H - 4} textAnchor="end" className="lt-ax">{data.length ? `${Math.round(data[data.length - 1].t)}s` : ''}</text>
      </svg>
      {note && <small className="muted">{note}</small>}
    </figure>
  );
}

function Charts({ s, cpus }) {
  return (
    <div className="lt-charts">
      <Chart title="Requests per second" data={s} series={[{ key: 'rps', color: 'var(--brand)' }]} />
      <Chart title="Response time (95th percentile)" data={s} series={[{ key: 'p95', color: 'var(--bad)' }]} unit=" ms" note="95 out of 100 requests were faster than this." />
      <Chart title="CPU" data={s} series={[{ key: 'cpuProc', color: 'var(--brand)', label: 'App' }, { key: 'cpuSys', color: 'var(--muted)', label: 'Whole server' }]} max={100} unit="%" note={`App = share of one core (the app uses one core). Whole server = all ${cpus} core${cpus > 1 ? 's' : ''}.`} />
      <Chart title="Memory used (whole server)" data={s} series={[{ key: 'memUsedPct', color: 'var(--warn)' }]} max={100} unit="%" />
      <Chart title="Database write time" data={s} series={[{ key: 'writeMs', color: 'var(--bad)' }]} unit=" ms" note="Time to take the write lock and commit one small change. Rises when the database is busy." />
      <Chart title="Server pauses (event loop)" data={s} series={[{ key: 'lagMs', color: 'var(--warn)' }]} unit=" ms" note="How long the server was too busy to answer anything. Students feel this as a freeze." />
    </div>
  );
}

function Live({ run, info, onStop, stopping }) {
  const s = run.samples; const last = s[s.length - 1] || {}; const pctDone = Math.min(100, Math.round(((run.elapsed || 0) / run.config.durationSec) * 100));
  return (
    <section aria-live="polite">
      <div className="card lt-progress">
        <div><b>{run.phase === 'setup' ? 'Setting up…' : run.phase === 'cleanup' ? 'Cleaning up…' : `Running: ${run.config.users} virtual students`}</b><span className="muted small"> {run.note}</span></div>
        <div className="lt-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pctDone}%` }} /></div>
        <button className="btn btn-danger btn-sm" disabled={stopping || run.phase === 'cleanup'} onClick={onStop}>{stopping ? 'Stopping…' : 'Stop test'}</button>
      </div>
      <div className="ad-grid g4" style={{ margin: '12px 0' }}>
        <Stat icon="👩‍🎓" label="Students active" value={run.active} /><Stat icon="⚡" label="Requests per second" value={last.rps ?? 0} />
        <Stat icon="⏱" label="Response time p95" value={ms(last.p95 || 0)} tone={last.p95 > 800 ? 'bad' : last.p95 > 300 ? 'warn' : ''} /><Stat icon="⚠" label="Failed in the last second" value={last.errors ?? 0} tone={last.errors ? 'bad' : ''} />
      </div>
      <div className="ad-grid g4" style={{ marginBottom: 12 }}>
        <Stat icon="🧠" label="App CPU (one core)" value={`${last.cpuProc ?? 0}%`} tone={last.cpuProc > 85 ? 'bad' : ''} /><Stat icon="💾" label="App memory" value={bytes(last.rss)} />
        <Stat icon="🖥" label="Server memory used" value={`${last.memUsedPct ?? 0}%`} tone={last.memUsedPct > 85 ? 'bad' : ''} /><Stat icon="📀" label="Disk used" value={last.diskUsedPct == null ? '–' : `${last.diskUsedPct}%`} />
      </div>
      <Charts s={s} cpus={info.cpus} />
    </section>
  );
}

function Report({ rep, onAgain }) {
  const v = rep.verdict; const k = rep.kinds; const rows = [['open', 'Open the test'], ['save', 'Autosave answers'], ['poll', 'Check progress'], ['submit', 'Submit the test'], ['result', 'Open the result']].filter(([x]) => k[x]);
  const download = () => { const b = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `load-test-${new Date(rep.at).toISOString().slice(0, 16)}.json`; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <section>
      <div className={`card lt-verdict t-${TONE[v.level]}`}>
        <div><Badge tone={TONE[v.level]}>{v.title}</Badge><h2>{rep.config.users} students for {rep.config.durationSec} seconds</h2><p>{v.text}</p>
          {rep.stopped && <p className="small"><b>Stopped early:</b> {rep.stopReason}</p>}
          {rep.estimate ? <p className="small">Rough ceiling on this server: <b>about {rep.estimate} students at once</b>. This is an estimate from how busy the app was, not a guarantee.</p> : <p className="small">The app was barely busy, so the real limit is well above {rep.config.users}. Run again with more students to find it.</p>}</div>
        <div className="lt-actions"><button className="btn btn-primary" onClick={onAgain}>Run another test</button><button className="btn btn-ghost" onClick={download}>Download report</button></div>
      </div>
      <div className="ad-grid g4" style={{ margin: '12px 0' }}>
        <Stat icon="📨" label="Requests sent" value={rep.totals.requests} /><Stat icon="⚡" label="Busiest second" value={`${rep.totals.peakRps}/s`} />
        <Stat icon="⏱" label="95th percentile, all requests" value={ms(rep.totals.p95)} /><Stat icon="⚠" label="Failed requests" value={`${rep.totals.errors} (${rep.totals.errorPct}%)`} tone={rep.totals.errors ? 'bad' : 'good'} />
      </div>
      <div className="ad-grid g2">
        <section className="card" style={{ padding: 0 }}>
          <h3 style={{ padding: '12px 14px 0', margin: 0 }}>What students did</h3>
          <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Action</th><th>Count</th><th>Typical</th><th>p95</th><th>p99</th><th>Slowest</th><th>Failed</th></tr></thead>
            <tbody>{rows.map(([x, l]) => <tr key={x}><td>{l}</td><td>{k[x].n}</td><td>{ms(k[x].p50)}</td><td><b>{ms(k[x].p95)}</b></td><td>{ms(k[x].p99)}</td><td>{ms(k[x].max)}</td><td>{k[x].errors || '–'}</td></tr>)}</tbody></table></div>
          {Object.keys(rep.errors).length > 0 && <p className="small sx-bad" style={{ padding: '0 14px 10px' }}>Errors: {Object.entries(rep.errors).map(([c, n]) => `${c} ×${n}`).join(', ')}{rep.totals.busy ? ` · ${rep.totals.busy} database lock errors` : ''}</p>}
        </section>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Server load at the peak</h3>
          <dl className="sx-kv">
            <dt>App CPU (share of one core)</dt><dd>{rep.peaks.cpuProc}%</dd>
            <dt>Whole-server CPU ({rep.server.cpus} cores)</dt><dd>{rep.peaks.cpuSys}%</dd>
            <dt>App memory</dt><dd>{rep.peaks.rssMB} MB</dd>
            <dt>Server memory used</dt><dd>{rep.peaks.memUsedPct}% of {bytes(rep.server.totalMem)}</dd>
            <dt>Disk used</dt><dd>{rep.peaks.diskUsedPct ? `${rep.peaks.diskUsedPct}%` : '–'}</dd>
            <dt>Database grew by</dt><dd>{rep.dbGrowthMB} MB (removed after the test)</dd>
            <dt>Slowest database write</dt><dd>{ms(rep.peaks.writeMs)}</dd>
            <dt>Longest server pause</dt><dd>{ms(rep.peaks.lagMs)}</dd>
          </dl>
        </section>
      </div>
      <section className="card" style={{ marginTop: 12 }}><h3 style={{ marginTop: 0 }}>What to do about it</h3><ul className="lt-advice">{rep.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p className="small muted">The test runs on the server itself, so it is slightly harder on it than real students on separate devices. Database lock waits are measured by timing a small write once a second. The app uses one database connection, so queued writes show up as write time and server pauses rather than lock errors.</p></section>
      {rep.samples && <Charts s={rep.samples} cpus={rep.server.cpus} />}
    </section>
  );
}

export default function LoadTest() {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [form, setForm] = useState({ users: 100, durationSec: 60, saveEverySec: 10, progress: 40, submitAtEnd: true, mockId: '' });
  const [dlg, setDlg] = useState(false); const [busy, setBusy] = useState(false); const [e2, setE2] = useState(''); const [showSetup, setShowSetup] = useState(false);
  const timer = useRef(null);
  const load = useCallback(() => api.get('/admin/loadtest').then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const running = d?.run && !['done', 'failed'].includes(d.run.phase);
  useEffect(() => { clearInterval(timer.current); if (running) timer.current = setInterval(load, 1000); return () => clearInterval(timer.current); }, [running, load]);
  if (err) return <Err>{err}</Err>; if (!d) return <Loading />;
  const { info, run } = d; const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const start = async () => { setBusy(true); setE2(''); try { await api.post('/admin/loadtest/start', { ...form, mockId: form.mockId || info.mocks[0]?.id, confirm: 'start' }); setDlg(false); setShowSetup(false); toast('Test started'); load(); } catch (e) { setE2(e.message); } finally { setBusy(false); } };
  const stop = async () => { try { await api.post('/admin/loadtest/stop'); load(); } catch (e) { toast(e.message, 'bad'); } };
  const free = info.disk?.free;

  if (running) return <Live run={run} info={info} onStop={stop} stopping={run.stopping} />;
  if (run?.report && !showSetup) return <><Report rep={{ ...run.report, samples: run.samples }} onAgain={() => setShowSetup(true)} /><History h={d.history} onClear={async () => { await api.del('/admin/loadtest/history'); load(); }} /></>;
  return (
    <section>
      {run?.error && <div className="alert" role="alert">The last test could not run: {run.error}</div>}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Test how many students the server can handle</h3>
        <p className="muted">Creates temporary virtual students who sit a hidden copy of one of your mocks on this live server: they open it, autosave answers, submit and open the result. Real students are not affected, and everything created is deleted afterwards.</p>
        <div className="lt-presets" role="group" aria-label="Number of students">{PRESETS.map(([n, l]) => <button key={n} type="button" className={`chip ${form.users === n ? 'on' : ''}`} aria-pressed={form.users === n} onClick={() => set('users', n)}><b>{n}</b> {l}</button>)}</div>
        <div className="ad-grid g4" style={{ marginTop: 12 }}>
          <label className="ad-field">Students at the same time<input type="number" min={info.limits.users[0]} max={info.limits.users[1]} value={form.users} onChange={(e) => set('users', Number(e.target.value))} /></label>
          <label className="ad-field">Test length (seconds)<input type="number" min={info.limits.durationSec[0]} max={info.limits.durationSec[1]} value={form.durationSec} onChange={(e) => set('durationSec', Number(e.target.value))} /></label>
          <label className="ad-field">Autosave every (seconds)<input type="number" min={info.limits.saveEverySec[0]} max={info.limits.saveEverySec[1]} value={form.saveEverySec} onChange={(e) => set('saveEverySec', Number(e.target.value))} /><small className="muted">The exam page saves every 10 seconds.</small></label>
          <label className="ad-field">Already answered (%)<input type="number" min="0" max="90" value={form.progress} onChange={(e) => set('progress', Number(e.target.value))} /><small className="muted">How far into the paper each student starts.</small></label>
        </div>
        <div className="ad-grid g2" style={{ marginTop: 6 }}>
          <label className="ad-field">Mock to copy<select value={form.mockId} onChange={(e) => set('mockId', e.target.value)}>{info.mocks.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.questions} questions)</option>)}</select></label>
          <label className="ad-chk" style={{ alignSelf: 'end' }}><input type="checkbox" checked={form.submitAtEnd} onChange={(e) => set('submitAtEnd', e.target.checked)} /> Everyone submits near the end and opens their result (the heaviest moment)</label>
        </div>
        {!info.mocks.length && <p className="alert">There is no mock with at least 10 questions yet. Create one first.</p>}
        {info.activeStudents > 0 && <p className="alert" role="status">{info.activeStudents} real student{info.activeStudents > 1 ? 's were' : ' was'} active in the last 5 minutes. They may notice slowness during the test. A quiet time is better.</p>}
        {info.maintenance !== 'off' && <p className="alert" role="status">Maintenance mode is on. Turn it off first or the virtual students are blocked.</p>}
        <p style={{ marginTop: 12 }}><button className="btn btn-primary" disabled={!info.mocks.length || info.maintenance !== 'off'} onClick={() => setDlg(true)}>Start the test</button> {run?.report && <button className="btn btn-ghost" onClick={() => setShowSetup(false)}>Back to last report</button>}</p>
      </div>
      <div className="ad-grid g4" style={{ margin: '12px 0' }}>
        <Stat icon="🖥" label="Server" value={`${info.cpus} CPU`} sub={info.cpuModel.slice(0, 32)} /><Stat icon="🧠" label="Memory free" value={bytes(info.availMem)} sub={`of ${bytes(info.totalMem)}`} />
        <Stat icon="📀" label="Disk free" value={bytes(free)} sub={info.disk ? `${info.disk.usedPct}% used` : ''} /><Stat icon="🗄" label="Database size" value={bytes(info.dbBytes)} />
      </div>
      <p className="small muted">Safety: the test stops by itself if over 40% of requests fail, the server runs low on memory or disk, or it freezes for several seconds. You can also stop it any time.</p>
      <History h={d.history} onClear={async () => { await api.del('/admin/loadtest/history'); load(); }} />
      {dlg && <ConfirmModal title={`Run a ${form.durationSec}-second test with ${form.users} students?`} word="start" label="Start test" busy={busy} error={e2} onClose={() => setDlg(false)} onConfirm={start}>
        <p>The server will work hard for about {form.durationSec + 15} seconds. Pages may feel slower for anyone else using it. The virtual students and their data are removed when it ends.</p></ConfirmModal>}
    </section>
  );
}

function History({ h, onClear }) {
  if (!h?.length) return null;
  return (
    <section className="card" style={{ padding: 0, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px 0' }}><h3 style={{ margin: 0 }}>Past tests</h3><button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button></div>
      <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>When</th><th>Students</th><th>Autosave p95</th><th>Failed</th><th>Peak CPU</th><th>Peak memory</th><th>Result</th></tr></thead>
        <tbody>{h.map((x) => <tr key={x.id}><td>{dt(x.at)}</td><td>{x.users} for {x.durationSec}s</td><td>{ms(x.p95)}</td><td>{x.errorPct}%</td><td>{x.peakCpu}%</td><td>{x.peakMem}%</td><td><Badge tone={TONE[x.level]}>{x.title}{x.stopped ? ' (stopped)' : ''}</Badge></td></tr>)}</tbody></table></div>
    </section>
  );
}
