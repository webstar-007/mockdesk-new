import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Bars, Err, Loading, ago, dayLabel, statusTone, useLoad } from './ui.jsx';

function Spark({ data, color = '#2547b8' }) {
  const mx = Math.max(1, ...data); const w = 100, h = 32; const pts = data.map((n, i) => [(i / Math.max(1, data.length - 1)) * w, h - 3 - (n / mx) * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity=".12" /><path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}
const Delta = ({ c, what = 'yesterday' }) => { const diff = c.today - c.yesterday; if (!c.today && !c.yesterday) return null; return <span className={`ad-delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`} title={`${c.today} today, ${c.yesterday} ${what}`}>{diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(diff)} vs {what}</span>; };
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function Overview() {
  const { user } = useAuth(); const { data: d, err, loading, reload } = useLoad('/admin/overview'); const { data: al } = useLoad('/admin/alerts');
  const [plat, setPlat] = useState([]); const [range, setRange] = useState('signups'); const [days, setDays] = useState(14);
  useEffect(() => { const f = () => api.get('/admin/attention').then((x) => setPlat(x.items)).catch(() => {}); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, []);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const t = d.totals; const first = (user?.name || '').split(' ')[0];
  const sig = d.signups.map((x) => x.n); const att = d.attempts.map((x) => x.n);
  const todo = [
    ...plat.map((i) => ({ tone: i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : 'info', to: `/admin/${i.to}`, text: i.text })),
    t.openReports > 0 && { tone: 'warn', to: '/admin/reports', text: `${t.openReports} student report${t.openReports > 1 ? 's' : ''} to review` },
    al?.count > 0 && { tone: 'bad', to: '/admin/quality', text: `${al.count} question${al.count > 1 ? 's' : ''} may have a wrong answer key${al.fresh ? ` (${al.fresh} new)` : ''}` },
    d.flagged.length > 0 && { tone: 'warn', to: '/admin/quality', text: `${d.flagged.length} question${d.flagged.length > 1 ? 's' : ''} almost nobody gets right` },
    d.health.neverStarted > 0 && { tone: 'info', to: '/admin/users?segment=never', text: `${d.health.neverStarted} student${d.health.neverStarted > 1 ? 's' : ''} never took a test` },
    d.health.inactive7 > 0 && { tone: 'info', to: '/admin/users?segment=inactive', text: `${d.health.inactive7} student${d.health.inactive7 > 1 ? 's' : ''} inactive for 7+ days` },
  ].filter(Boolean);
  const chart = (range === 'signups' ? d.signups : d.attempts).slice(-days).map(dayLabel);
  const hrs = d.hours.map((n, h) => ({ label: `${String(h).padStart(2, '0')}:00`, short: String(h).padStart(2, '0'), n })); const peak = d.hours.indexOf(Math.max(...d.hours));
  const rate = t.attempts ? Math.round((t.completed / t.attempts) * 100) : null;
  return (
    <>
      <section className="dash-hero">
        <div>
          <h1>{hello()}{first ? `, ${first}` : ''}</h1>
          <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}. {t.today ? `${t.today} test${t.today > 1 ? 's' : ''} started in the last 24 hours.` : 'No tests started yet today.'}</p>
          <span className="dash-live" role="status"><i aria-hidden="true" />{t.liveNow} in a test now · {t.active24h} active today</span>
        </div>
        <div className="dash-act"><Link className="btn pri" to="/admin/mocks">＋ New mock</Link><Link className="btn" to="/admin/messages">📣 Send message</Link><button className="btn" onClick={reload}>↻ Refresh</button></div>
      </section>

      <div className="ad-grid g4">
        <Link className="kpi" to="/admin/users"><span className="l">Students</span><b>{t.users}</b><small>+{t.newWeek} this week <Delta c={d.compare.signups} /></small><Spark data={sig} /></Link>
        <Link className="kpi" to="/admin/attempts"><span className="l">Tests started</span><b>{t.attempts}</b><small>{t.completed} finished <Delta c={d.compare.attempts} /></small><Spark data={att} color="#15803d" /></Link>
        <Link className="kpi good" to="/admin/analytics"><span className="l">Average score</span><b>{t.avgPct}%</b><small>Accuracy {t.avgAccuracy}%</small></Link>
        <Link className={`kpi ${rate !== null && rate < 50 ? 'warn' : ''}`} to="/admin/analytics"><span className="l">Completion rate</span><b>{rate === null ? '–' : `${rate}%`}</b><small>Started, then finished</small></Link>
      </div>

      <div className="dash-cols">
        <div className="dash-col">
          <section className="card">
            <div className="dash-sec-h"><h3>Needs your attention {todo.length > 0 && <Badge tone="warn">{todo.length}</Badge>}</h3></div>
            {todo.length ? <ul className="dash-todo">{todo.slice(0, 8).map((x) => <li key={x.text}><Link to={x.to} className={`t-${x.tone}`}><span>{x.text}</span><span className="go" aria-hidden="true">Open →</span></Link></li>)}</ul> : <div className="dash-ok">✅ All clear. Nothing needs you right now.</div>}
          </section>
          <section className="card">
            <div className="dash-sec-h"><h3>Trend</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div className="dash-seg" role="group" aria-label="Metric">{[['signups', 'New students'], ['attempts', 'Tests started']].map(([k, l]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
                <div className="dash-seg" role="group" aria-label="Range">{[7, 14, 30].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} days</button>)}</div>
              </div></div>
            <Bars title={range === 'signups' ? 'New students' : 'Tests started'} tone={range === 'signups' ? 'brand' : 'good'} unit={range === 'signups' ? 'Signups' : 'Tests'} data={chart} height={140} every={days > 14 ? 5 : 2} />
          </section>
          <section className="card nopad"><div style={{ padding: '14px 16px 0' }}><div className="dash-sec-h"><h3>Mocks by popularity</h3><Link to="/admin/mocks" className="small">All mocks</Link></div></div>
            <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Mock</th><th>Status</th><th className="num">Started</th><th className="num">Finished</th><th className="num">Avg score</th></tr></thead>
              <tbody>{d.popular.slice(0, 6).map((m) => <tr key={m.id} className="click"><td><Link to={`/admin/mocks/${m.id}`}><b>{m.name}</b></Link></td><td><Badge tone={statusTone[m.status]}>{m.status}</Badge></td><td className="num">{m.attempts}</td><td className="num">{m.completed}</td><td className="num">{m.completed ? `${m.avgPct}%` : '–'}</td></tr>)}</tbody></table></div></section>
        </div>

        <div className="dash-col">
          <section className="card"><h3>Quick actions</h3>
            <div className="dash-qa"><Link to="/admin/mocks">🗂 New mock</Link><Link to="/admin/bank">❓ Add question</Link><Link to="/admin/import-students">📋 Import students</Link><Link to="/admin/announcements">📢 Announce</Link><Link to="/admin/live">🟢 Live tests</Link><Link to="/admin/data">💾 Back up now</Link></div></section>
          <section className="card"><div className="dash-sec-h"><h3>Recent activity</h3><Link to="/admin/attempts" className="small">All</Link></div>
            {d.recent.length ? <ul className="ad-timeline">{d.recent.slice(0, 6).map((a) => <li key={a.id}><div><Link to={`/admin/attempts/${a.id}`}><b>{a.name}</b></Link> {a.status === 'submitted' ? 'finished' : 'started'} <b>{a.mockName}</b><br /><small className="muted">{ago(a.started_at)}</small></div></li>)}</ul> : <p className="muted">No tests taken yet.</p>}</section>
          <section className="card"><h3>Top students</h3>
            {d.topStudents.length ? <ol className="ad-rank">{d.topStudents.map((u, i) => <li key={u.id}><span className="n">{i + 1}</span><span className="t"><Link to={`/admin/users/${u.id}`}><b>{u.name}</b></Link><small className="muted">Best {u.score}/{u.max}</small></span><Badge tone="good">{u.pct}%</Badge></li>)}</ol> : <p className="muted">Rankings appear after the first finished test.</p>}</section>
          <section className="card"><h3>When students practise</h3><Bars title="Tests started" unit="Starts" data={hrs} every={4} height={90} />
            <p className="small muted" style={{ marginBottom: 0 }}>{Math.max(...d.hours) ? <>Busiest hour: <b>{String(peak).padStart(2, '0')}:00</b>, last 14 days.</> : 'Not enough data yet.'}</p></section>
        </div>
      </div>
    </>
  );
}
