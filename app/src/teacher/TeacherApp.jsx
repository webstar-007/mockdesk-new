import { useSite } from '../lib/site.js';
import { ToastHost } from '../admin/ui.jsx';
import QuickActions from '../components/QuickActions.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import PageNav, { teacherTrail, useCrumb } from '../components/PageNav.jsx';
import { AssignmentList, AssignmentDetail } from './Assignments.jsx';
import Tricks from './Tricks.jsx';
import HealthBoard from '../components/HealthBoard.jsx';
import DeskQueue from '../components/DeskQueue.jsx';

const ago = (ms) => { if (!ms) return 'never'; const d = Math.floor((Date.now() - ms) / 86400000); return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const useGet = (url) => { const [s, set] = useState({ data: null, err: '' }); useEffect(() => { set({ data: null, err: '' }); api.get(url).then((data) => set({ data, err: '' })).catch((e) => set({ data: null, err: e.message })); }, [url]); return s; };
const Bar = ({ v, tone }) => <span className="tc-bar" role="img" aria-label={`${v}%`}><i className={tone} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /></span>;
const tone = (p) => (p >= 70 ? 'good' : p >= 45 ? 'mid' : 'low');
const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
const hue = (n = '') => [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const Avatar = ({ name, size = 36 }) => <span className="tc-av" aria-hidden="true" style={{ width: size, height: size, background: `hsl(${hue(name)} 60% 90%)`, color: `hsl(${hue(name)} 55% 28%)`, fontSize: size * 0.38 }}>{initials(name)}</span>;
const Spark = ({ data = [], w = 84, h = 26 }) => {
  if (data.length < 2) return <span className="muted tc-dash">–</span>;
  const lo = Math.min(...data), hi = Math.max(...data), r = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * (w - 4) + 2},${h - 3 - ((v - lo) / r) * (h - 6)}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return <svg className={`tc-spark ${up ? 'up' : 'down'}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={up ? 'Trending up' : 'Trending down'}><polyline points={pts} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
};
const Days = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.n));
  return <div className="tc-days" role="img" aria-label={`${data.reduce((a, d) => a + d.n, 0)} tests finished in the last 14 days`}>{data.map((d, i) => <div key={i} title={`${new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${d.n}`}><i className={d.n ? 'on' : ''} style={{ height: `${d.n ? 12 + (d.n / max) * 88 : 6}%` }} /><span>{new Date(d.day).getDate()}</span></div>)}</div>;
};
const Stat = ({ label, value, sub, tone: t }) => <div className={`tc-stat ${t || ''}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
const Head = ({ children }) => <div className="tc-h">{children}</div>;
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const Loading = () => <div className="tc-skel" role="status" aria-label="Loading"><i /><i /><i /></div>;

function AsgBanner() {
  const { data } = useGet('/teacher/assignments'); if (!data) return null; const sm = data.summary;
  if (!data.items.length) return <div className="tc-asg-banner"><span>Set a mock or practice for a batch with a due date. Reminders go out by themselves.</span><Link className="btn btn-primary btn-sm" to="/teacher/assignments">Set an assignment</Link></div>;
  return <div className="tc-asg-banner" style={sm.overdue ? { borderLeftColor: 'var(--bad)' } : undefined}><span><b>{sm.open}</b> open assignment{sm.open === 1 ? '' : 's'}{sm.overdue ? <>, <b>{sm.overdue}</b> past due with students still to finish</> : ''}.</span><Link className="btn btn-ghost btn-sm" to="/teacher/assignments">See who has not done it</Link></div>;
}

function Batches() {
  const { data, err } = useGet('/teacher/overview');
  if (err) return <p className="alert" role="alert">{err}</p>;
  if (!data) return <Loading />;
  const t = data.totals; const first = (data.teacher.name || '').split(' ')[0];
  if (!data.batches.length) return <><div className="tc-hello"><h1>{greet()}, {first}</h1></div><p className="card">You have not been given a batch yet. Ask your administrator to add you to one.</p></>;
  return (<div className="tc-page">
    <div className="tc-hello"><div><h1>{greet()}, {first}</h1><p className="muted">{t.students} student{t.students === 1 ? '' : 's'} across {t.batches} batch{t.batches === 1 ? '' : 'es'}{data.attention.length ? ` · ${data.attention.length} need${data.attention.length === 1 ? 's' : ''} your attention` : ' · everyone is on track'}</p></div></div>
    <AsgBanner />
    <div className="tc-stats">
      <Stat label="Students" value={t.students} sub={`${t.batches} batch${t.batches === 1 ? '' : 'es'}`} />
      <Stat label="Active this week" value={t.active7} sub={t.students ? `${Math.round((t.active7 / t.students) * 100)}% of students` : ''} tone="good" />
      <Stat label="Average score" value={`${t.avgPct}%`} sub="across all mocks" />
      <Stat label="Tests finished" value={t.submissions14} sub="last 14 days" />
    </div>

    <div className="tc-row2">
      <section className="card tc-sec"><Head><h2>Activity</h2><small className="muted">Tests finished per day, last 14 days</small></Head><Days data={data.activity} />
        <div className="tc-sub"><h3>Recent submissions</h3>{!data.recent.length ? <p className="muted">Nothing yet. Results appear here as students finish.</p> : <ul className="tc-feed">{data.recent.slice(0, 5).map((r) => <li key={r.id}><Avatar name={r.student} size={30} /><div><Link to={`/teacher/${r.batchId}/${r.uid}`}>{r.student}</Link><small className="muted">{r.mock} · {ago(r.at)}</small></div><b className={`c-${tone(r.pct)}`}>{r.pct}%</b></li>)}</ul>}</div></section>
      <section className="card tc-sec"><Head><h2>Needs attention</h2>{data.attention.length > 0 && <span className="tc-count">{data.attention.length}</span>}</Head>
        {!data.attention.length ? <p className="tc-ok">Nobody is falling behind. Inactive students and sharp score drops show up here.</p> : <ul className="tc-feed att">{data.attention.map((x) => <li key={x.batchId + '-' + x.id}><Avatar name={x.name} size={32} /><div><Link to={`/teacher/${x.batchId}/${x.id}`}>{x.name}</Link><small className="muted">{x.batch}</small></div><span className={`tc-chip ${x.tone}`}>{x.reason}</span></li>)}</ul>}</section>
    </div>

    <section aria-label="Your batches"><Head><h2>Your batches</h2></Head>
      <div className="tc-cards">{data.batches.map((b) => (
        <Link key={b.id} className="card tc-card" to={`/teacher/${b.id}`}>
          <div className="tc-card-h"><h3>{b.name}</h3>{b.needs > 0 && <span className="tc-chip idle">{b.needs} inactive</span>}</div>
          <div className="tc-mini" aria-hidden="true">{b.activity.map((n, i) => <i key={i} style={{ height: `${Math.max(8, Math.min(100, n * 24))}%` }} className={n ? 'on' : ''} />)}</div>
          <dl><div><dt>Students</dt><dd>{b.students}</dd></div><div><dt>Average</dt><dd>{b.avgPct}%</dd></div><div><dt>Active</dt><dd>{b.active7}<small>/{b.students}</small></dd></div></dl>
          <small className="muted">Join code <code>{b.code}</code></small></Link>))}</div></section>

    <div className="tc-row2">
      <section className="card tc-sec"><Head><h2>Top performers</h2></Head>{!data.top.length ? <p className="muted">Shows once students finish a mock.</p> : <ol className="tc-feed rank">{data.top.map((x, i) => <li key={x.batchId + '-' + x.id}><span className="tc-rank">{i + 1}</span><Avatar name={x.name} size={30} /><div><Link to={`/teacher/${x.batchId}/${x.id}`}>{x.name}</Link><small className="muted">{x.batch} · {x.mocks} mock{x.mocks === 1 ? '' : 's'}</small></div><b>{x.avgPct}%</b></li>)}</ol>}</section>
      <section className="card tc-sec"><Head><h2>Weakest topics</h2><small className="muted">Across all your batches</small></Head>{!data.weakTopics.length ? <p className="muted">Appears once students have answered enough questions.</p> : <ul className="tc-list">{data.weakTopics.map((w) => <li key={w.section + w.topic}><span>{w.topic}<small className="muted"> · {w.total} answers</small></span><Bar v={w.pct} tone={tone(w.pct)} /><b>{w.pct}%</b></li>)}</ul>}</section>
    </div>
  </div>);
}

/** Students down the side, topics across the top. Darker red means weaker. Click a name to open the student. */
function Heat({ heat, id }) {
  const [sel, setSel] = useState(null); const [sort, setSort] = useState('name'); if (!heat?.cols.length || !heat.rows.length) return <p className="muted">Shows up once students have answered enough questions on a few topics.</p>;
  const avg = (r) => { const v = r.cells.filter(Boolean); return v.length ? v.reduce((a, c) => a + c.pct, 0) / v.length : 101; };
  const rows = [...heat.rows].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : avg(a) - avg(b)));
  const shade = (p) => `color-mix(in srgb, ${p >= 70 ? 'var(--good)' : p >= 45 ? 'var(--warn,#f59e0b)' : 'var(--bad)'} ${Math.round(18 + (p >= 70 ? (p - 70) / 30 : p >= 45 ? 0.5 : (45 - p) / 45) * 62)}%, var(--surface))`;
  const cell = sel && rows[sel[0]]?.cells[sel[1]]; const col = sel && heat.cols[sel[1]];
  return (
    <div className="hx">
      <div className="hx-bar"><div className="tc-seg" role="group" aria-label="Sort students">{[['name', 'Name'], ['weak', 'Weakest first']].map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}</div>
        <span className="hx-key small muted"><i style={{ background: shade(20) }} /> under 45% <i style={{ background: shade(55) }} /> 45–70% <i style={{ background: shade(90) }} /> 70%+ <i className="none" /> not enough answers</span></div>
      <div className="hx-wrap"><table className="hx-t"><thead><tr><th scope="col">Student</th>{heat.cols.map((c, j) => <th key={c.key} scope="col" className={sel?.[1] === j ? 'sel' : ''}><span title={`${c.topic}, batch ${c.pct}%`}>{c.topic}</span></th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id} style={{ '--i': i }}><th scope="row"><Link to={`/teacher/${id}/${r.id}`}>{r.name}</Link></th>{r.cells.map((c, j) => <td key={j}>{c ? <button type="button" className={`hx-cell ${sel && sel[0] === i && sel[1] === j ? 'sel' : ''}`} style={{ background: shade(c.pct) }} aria-label={`${r.name}, ${heat.cols[j].topic}: ${c.pct}% from ${c.n} questions`} onClick={() => setSel(sel && sel[0] === i && sel[1] === j ? null : [i, j])}>{c.pct}</button> : <span className="hx-cell none" aria-label="Not enough answers">·</span>}</td>)}</tr>)}</tbody></table></div>
      {cell && <p className="hx-pop" role="status"><b>{rows[sel[0]].name}</b> got <b>{cell.pct}%</b> on {col.topic} ({cell.n} questions). Batch average {col.pct}%. <Link to={`/teacher/${id}/${rows[sel[0]].id}`}>Open student</Link></p>}
    </div>
  );
}
function Batch() {
  const { id } = useParams(); const { data, err } = useGet(`/teacher/batches/${id}`); const [q, setQ] = useState(''); const [sort, setSort] = useState('name'); const [view, setView] = useState('all');
  if (err) return <><p className="alert" role="alert">{err}</p></>;
  useCrumb(`/teacher/${id}`, data?.batch.name);
  if (!data) return <Loading />;
  const all = data.students; const withM = all.filter((s) => s.mocks);
  const avgAll = withM.length ? Math.round((withM.reduce((a, s) => a + s.avgPct, 0) / withM.length) * 10) / 10 : 0;
  const idle = all.filter((s) => s.inactive); const risk = all.filter((s) => s.mocks && (s.avgPct < 40 || (s.trend != null && s.trend <= -8)));
  const best = [...withM].sort((a, b) => b.avgPct - a.avgPct)[0];
  const filt = { all, idle, risk, top: withM.filter((s) => s.avgPct >= 70) }[view];
  const rows = filt.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'avg' ? b.avgPct - a.avgPct : sort === 'low' ? a.avgPct - b.avgPct : (b.lastActive || 0) - (a.lastActive || 0)));
  const dmax = Math.max(1, ...data.dist); const bands = ['0–20', '20–40', '40–60', '60–80', '80–100'];
  return (<div className="tc-page">
    
    <div className="tc-hello"><div><h1>{data.batch.name}</h1><p className="muted">Join code <code>{data.batch.code}</code></p></div><a className="btn btn-ghost" href={`/api/teacher/batches/${id}/export.csv`}>Download CSV</a></div>
    <div className="tc-stats">
      <Stat label="Students" value={all.length} sub={`${withM.length} have taken a mock`} />
      <Stat label="Batch average" value={`${avgAll}%`} sub="of students with a mock" />
      <Stat label="Active this week" value={all.length - idle.length} sub={idle.length ? `${idle.length} inactive` : 'everyone active'} tone={idle.length ? '' : 'good'} />
      <Stat label="Top scorer" value={best ? `${best.avgPct}%` : '–'} sub={best ? best.name : 'no results yet'} />
    </div>
    <div className="tc-row3">
      <section className="card tc-sec"><Head><h2>Score spread</h2><small className="muted">Students by average score</small></Head>
        <div className="tc-dist" role="img" aria-label="Number of students in each average-score band">{data.dist.map((n, i) => <div key={i}><b>{n}</b><i className={`b${i}`} style={{ height: `${8 + (n / dmax) * 92}%` }} /><span>{bands[i]}%</span></div>)}</div></section>
      <section className="card tc-sec"><Head><h2>Activity</h2><small className="muted">Last 14 days</small></Head><Days data={data.activity} />
        {data.recent.length > 0 && <small className="muted tc-last">Latest: {data.recent[0].student} finished {data.recent[0].mock} ({ago(data.recent[0].at)})</small>}</section>
      <section className="card tc-sec"><Head><h2>Mock averages</h2></Head>{!data.perMock.length ? <p className="muted">No one has finished a mock yet.</p> : <ul className="tc-list">{data.perMock.map((m) => <li key={m.mockId}><span>{m.name.replace('CGL Tier-II ', '')}<small className="muted"> · {m.finished}</small></span><Bar v={m.avgPct} tone={tone(m.avgPct)} /><b>{m.avgPct}%</b></li>)}</ul>}</section>
    </div>
    <section className="card tc-sec"><Head><h2>Weakest topics in this batch</h2><small className="muted">Plan your next class around these</small></Head>{!data.weakTopics.length ? <p className="muted">Shows up once students have answered enough questions.</p> : <ul className="tc-list two">{data.weakTopics.map((t) => <li key={t.section + t.topic}><span>{t.topic}<small className="muted"> · {t.total} answers</small></span><Bar v={t.pct} tone={tone(t.pct)} /><b>{t.pct}%</b></li>)}</ul>}</section>

    <section className="card tc-sec" aria-label="Topic heat map"><Head><h2>Who is weak where</h2><small className="muted">Accuracy by student and topic. Tap a cell for detail.</small></Head><Heat heat={data.heat} id={id} /></section>

    <section aria-label="Students"><Head><h2>Students</h2></Head>
      <div className="tc-tools">
        <div className="tc-seg" role="group" aria-label="Show">{[['all', `All ${all.length}`], ['risk', `At risk ${risk.length}`], ['idle', `Inactive ${idle.length}`], ['top', 'Top 70%+']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students" aria-label="Search students" /><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by"><option value="name">Name</option><option value="avg">Highest average</option><option value="low">Lowest average</option><option value="active">Most recently active</option></select></div>
      <div className="tbl-wrap card nopad"><table className="dtable tc-table"><thead><tr><th>Student</th><th>Mocks</th><th>Average</th><th>Trend</th><th>Latest</th><th>Last active</th></tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id}><th scope="row"><Link to={`/teacher/${id}/${s.id}`} className="tc-who"><Avatar name={s.name} /><span>{s.name}<small className="muted">{s.contact}</small></span></Link></th><td>{s.mocks}</td><td>{s.mocks ? <span className="tc-avg"><Bar v={s.avgPct} tone={tone(s.avgPct)} /><b>{s.avgPct}%</b></span> : '–'}</td><td><Spark data={s.series} /></td><td>{s.lastPct != null ? `${s.lastPct}%` : '–'}{s.trend != null && <small className={s.trend > 0 ? 'c-good' : s.trend < 0 ? 'c-bad' : 'muted'} style={{ display: 'block' }}>{s.trend > 0 ? '+' : ''}{s.trend}% overall</small>}</td><td>{s.inactive ? <span className="tc-chip idle">{ago(s.lastActive)}</span> : ago(s.lastActive)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="muted tc-none">No students match.</p>}</section>
  </div>);
}

function Notes({ uid, attempts }) {
  const [notes, setNotes] = useState(null); const [aid, setAid] = useState(attempts[0]?.id || ''); const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api.get(`/teacher/students/${uid}/notes`).then((r) => setNotes(r.notes)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [uid]);
  const add = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post(`/teacher/students/${uid}/notes`, { attemptId: aid, note: text }); setText(''); await load(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const del = async (id) => { try { await api.del(`/teacher/notes/${id}`); await load(); } catch (x) { setErr(x.message); } };
  const mockOf = (id) => attempts.find((a) => a.id === id)?.mock || 'a test';
  return (
    <section className="card tc-notes"><h2>Notes for the student</h2>
      <p className="small muted">The student sees your note on that result and gets a notification.</p>
      {err && <p className="alert" role="alert">{err}</p>}
      {attempts.length > 0 && <form onSubmit={add} className="tn-form"><label>About<select value={aid} onChange={(e) => setAid(e.target.value)}>{attempts.map((a) => <option key={a.id} value={a.id}>{a.mock} · {new Date(a.at).toLocaleDateString()}</option>)}</select></label><label>Note<textarea rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="What went well, and one thing to work on" /></label><button className="btn btn-primary" disabled={busy || text.trim().length < 2}>{busy ? 'Saving…' : 'Save note'}</button></form>}
      {notes && (notes.length ? <ul className="tn-list">{notes.map((n) => <li key={n.id}><small className="muted">{mockOf(n.attemptId)} · {n.teacher} · {new Date(n.at).toLocaleDateString()}</small><p>{n.note}</p>{n.mine && <button className="btn btn-ghost btn-sm" onClick={() => del(n.id)}>Delete</button>}</li>)}</ul> : <p className="muted">No notes yet.</p>)}
    </section>);
}

function Student() {
  const { id, uid } = useParams(); const { data, err } = useGet(`/teacher/batches/${id}/students/${uid}`);
  if (err) return <><p className="alert" role="alert">{err}</p></>;
  useCrumb(`/teacher/${id}`, data?.batch?.name); useCrumb(`/teacher/${id}/${uid}`, data?.student.name);
  if (!data) return <Loading />;
  const at = [...data.attempts].reverse(); const series = at.map((a) => a.pct); const n = at.length;
  const avgP = n ? Math.round((series.reduce((a, b) => a + b, 0) / n) * 10) / 10 : 0; const bestP = n ? Math.max(...series) : 0;
  const delta = n > 1 ? Math.round((series[n - 1] - series[0]) * 10) / 10 : null; const accAvg = n ? Math.round(at.reduce((a, b) => a + b.accuracy, 0) / n) : 0;
  const weak = data.topics.slice(0, 3);
  return (<div className="tc-page">
    
    <div className="tc-hello tc-prof"><Avatar name={data.student.name} size={56} /><div><h1>{data.student.name}</h1><p className="muted">{data.student.contact}{data.student.joinedAt ? ` · joined ${new Date(data.student.joinedAt).toLocaleDateString()}` : ''}</p></div></div>
    <div className="tc-stats">
      <Stat label="Mocks finished" value={n} />
      <Stat label="Average score" value={n ? `${avgP}%` : '–'} sub={n ? `best ${bestP}%` : ''} />
      <Stat label="Accuracy" value={n ? `${accAvg}%` : '–'} sub="average across mocks" />
      <Stat label="Change since first" value={delta == null ? '–' : `${delta > 0 ? '+' : ''}${delta}%`} tone={delta > 0 ? 'good' : delta < 0 ? 'bad' : ''} sub={delta == null ? 'needs two mocks' : delta >= 0 ? 'improving' : 'slipping'} />
    </div>
    <div className="tc-row2">
      <section className="card tc-sec"><Head><h2>Score trend</h2></Head>{n < 2 ? <p className="muted">A trend line appears after two finished mocks.</p> : <div className="tc-trend"><Spark data={series} w={420} h={110} /><div className="tc-axis"><span>{at[0].mock}</span><span>{at[n - 1].mock}</span></div></div>}
        {weak.length > 0 && <div className="tc-sub"><h3>Focus areas</h3><div className="tc-tags">{weak.map((t) => <span key={t.section + t.topic} className={`tc-chip ${tone(t.pct) === 'low' ? 'low' : 'idle'}`}>{t.topic} {t.pct}%</span>)}</div></div>}</section>
      {data.plain ? <section className="card tc-sec plainsum"><Head><h2>Latest result in plain words</h2></Head><p className="ps-head">{data.plain.headline}</p><ul>{data.plain.points.map((p, i) => <li key={i}>{p}</li>)}</ul></section> : <section className="card tc-sec"><Head><h2>Latest result</h2></Head><p className="muted">Nothing to summarise yet.</p></section>}
    </div>
    <div className="tc-row2">
      <section className="card tc-sec"><Head><h2>Mocks finished</h2></Head>{!data.attempts.length ? <p className="muted">None yet.</p> : <div className="tbl-wrap"><table className="dtable"><thead><tr><th>Mock</th><th>Score</th><th>Accuracy</th></tr></thead><tbody>{data.attempts.map((a) => <tr key={a.id}><th scope="row">{a.mock}<small className="muted" style={{ display: 'block' }}>{new Date(a.at).toLocaleDateString()}</small></th><td>{a.score}/{a.max} <small className={`c-${tone(a.pct)}`}>({a.pct}%)</small></td><td>{a.accuracy}%</td></tr>)}</tbody></table></div>}</section>
      <section className="card tc-sec"><Head><h2>Topics, weakest first</h2></Head>{!data.topics.length ? <p className="muted">No topic data yet.</p> : <ul className="tc-list">{data.topics.slice(0, 10).map((t) => <li key={t.section + t.topic}><span>{t.topic}<small className="muted"> · {t.correct}/{t.total}</small></span><Bar v={t.pct} tone={tone(t.pct)} /><b>{t.pct}%</b></li>)}</ul>}</section>
    </div>
    <Notes uid={uid} attempts={data.attempts} />
  </div>);
}

const TeacherNav = () => { const t = teacherTrail(useLocation().pathname); return t ? <PageNav trail={t} home="/teacher" /> : null; };

export default function TeacherApp() {
  const site = useSite();
  const { user, logout } = useAuth();
  if (user?.role !== 'teacher') return <Navigate to="/" replace />;
  return (
    <div className="tc"><ToastHost /><QuickActions role="teacher" />
      <header className="topbar"><div className="topbar-in"><Link to="/teacher" className="brand"><BrandMark /><span>{site.name} <small className="muted">Teacher</small></span></Link><div className="topbar-user"><Link className="btn btn-ghost btn-sm" to="/teacher/health">Health</Link><Link className="btn btn-ghost btn-sm" to="/teacher/doubts">Doubts</Link><Link className="btn btn-ghost btn-sm" to="/teacher/assignments">Assignments</Link><Link className="btn btn-ghost btn-sm" to="/teacher/tricks">Tricks</Link><ThemeToggle /><span className="who">{user.name}</span><button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button></div></div></header>
      <main className="shell" id="main"><TeacherNav /><Routes><Route index element={<Batches />} /><Route path="assignments" element={<AssignmentList />} /><Route path="tricks" element={<Tricks />} /><Route path="health" element={<div><div className="pagehead"><div><h1>Batch health</h1><p className="muted small">Who is slipping in your batches. Nudge them in one click.</p></div></div><HealthBoard base="/teacher" /></div>} /><Route path="doubts" element={<div><div className="pagehead"><div><h1>Doubts</h1><p className="muted small">Questions your students ask from their review page.</p></div></div><DeskQueue base="/teacher" /></div>} /><Route path="assignments/:id" element={<AssignmentDetail />} /><Route path=":id" element={<Batch />} /><Route path=":id/:uid" element={<Student />} /><Route path="*" element={<Navigate to="/teacher" replace />} /></Routes></main>
    </div>
  );
}
