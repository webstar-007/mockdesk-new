import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Err, Loading, PageHead, Stat, Bars, Badge, ago, mmss, toast } from './ui.jsx';

const mb = (b) => `${Math.round(b / 1048576)} MB`;
const hm = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
export default function Monitoring() {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [mins, setMins] = useState(60); const [auto, setAuto] = useState(true);
  const load = () => api.get(`/admin/monitor?minutes=${mins}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); if (!auto) return undefined; const t = setInterval(load, 10000); return () => clearInterval(t); }, [mins, auto]); // eslint-disable-line
  if (!d) return err ? <Err>{err}</Err> : <Loading />;
  const L = d.live; const cpu = d.samples.at(-1)?.cpu ?? 0; const lag = d.samples.at(-1)?.lag ?? 0;
  const series = d.series.map((x) => ({ label: `${hm(x.t)} · ${x.n} requests, avg ${x.avg} ms`, short: hm(x.t), n: x.n }));
  const errs = d.series.map((x) => ({ label: `${hm(x.t)} · ${x.e5} server errors, ${x.e4} refused`, short: hm(x.t), n: x.e5 }));
  const slow = d.series.map((x) => ({ label: `${hm(x.t)} · slowest 5% took ${x.p95} ms`, short: hm(x.t), n: x.p95 }));
  const every = Math.max(1, Math.round(d.series.length / 6));
  return (
    <>
      <PageHead title="Monitoring" sub="Live traffic and server health. Numbers start fresh when the server restarts.">
        <select value={mins} onChange={(e) => setMins(Number(e.target.value))} aria-label="Time range">{[[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']].map(([v, l]) => <option key={v} value={v}>Last {l}</option>)}</select>
        <label className="ad-chk"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
        <button className="btn btn-ghost" onClick={() => api.post('/admin/monitor/reset').then(() => { toast('Counters reset'); load(); }).catch((e) => toast(e.message, 'bad'))}>Reset counters</button>
      </PageHead>
      <div className="ad-grid g4" style={{ marginBottom: 14 }}>
        <Stat icon="🟢" tone="good" label="Students online (5 min)" value={L.onlineNow} sub={`${L.inTest} in a test now`} />
        <Stat icon="⚡" label="Requests per second" value={d.rpsNow} sub={`Errors: ${d.errorRate5}% of the last 5 min`} tone={d.errorRate5 > 2 ? 'bad' : ''} />
        <Stat icon="🖥" label="Server load" value={`${cpu}%`} sub={`Event loop delay ${lag} ms · ${d.cpus} CPU`} tone={cpu > 80 ? 'bad' : cpu > 60 ? 'warn' : ''} />
        <Stat icon="🧠" label="Memory used by the app" value={mb(d.rss)} sub={`${mb(d.freeMem)} free of ${mb(d.totalMem)}`} />
      </div>
      <div className="ad-grid g2" style={{ marginBottom: 14 }}>
        <section className="card"><h3>Requests per minute</h3><Bars data={series} unit="Requests" height={130} every={every} title="Requests per minute" /></section>
        <section className="card"><h3>Slow requests (95th percentile, ms)</h3><Bars data={slow} unit="ms" tone="warn" height={130} every={every} title="Response time" /></section>
      </div>
      <div className="ad-grid g2" style={{ marginBottom: 14 }}>
        <section className="card"><h3>Server errors per minute</h3><Bars data={errs} unit="Errors" tone="bad" height={100} every={every} title="Server errors" /></section>
        <section className="card"><h3>Right now</h3>
          <ul className="plain" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            <li>New sign-ups in 24 hours: <b>{L.signups24}</b></li><li>Tests submitted in the last hour: <b>{L.submits1h}</b></li><li>Active sign-in sessions: <b>{L.sessions}</b></li>
            <li>Server running for <b>{mmss(d.uptimeSec)}</b> · load average {d.loadavg.join(' / ')}</li></ul></section>
      </div>
      <section className="card" style={{ marginBottom: 14 }}>
        <h3>Busiest and slowest endpoints</h3>
        {!d.top.length ? <p className="muted">No traffic yet.</p> : <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Endpoint</th><th className="num">Calls</th><th className="num">Average</th><th className="num">Slowest</th><th className="num">Errors</th></tr></thead><tbody>
          {d.top.map((r) => <tr key={r.route}><td><code>{r.route}</code></td><td className="num">{r.n}</td><td className="num">{r.avgMs} ms</td><td className="num">{r.maxMs} ms</td><td className="num">{r.errors ? <Badge tone="bad">{r.errors}</Badge> : 0}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="card"><h3>Latest server errors</h3>{!d.errors.length ? <p className="muted">None since the server started.</p> : <ul className="plain" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>{d.errors.map((e, i) => <li key={i}><small className="muted">{ago(e.at)}</small> <code>{e.message || e.msg}</code></li>)}</ul>}</section>
    </>
  );
}
