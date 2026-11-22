import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSite } from '../lib/site.js';

const d = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export default function Progress() {
  const site = useSite();
  const { token } = useParams(); const [r, setR] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { document.title = 'Progress summary'; api.get(`/public/progress/${encodeURIComponent(token)}`).then(setR).catch((e) => setErr(e.message)); }, [token]);
  if (err) return <main className="pg-wrap"><div className="card pg-card"><h1>This link is not available</h1><p className="muted">{err}</p></div></main>;
  if (!r) return <main className="pg-wrap"><p className="muted" role="status">Loading…</p></main>;
  const p = r.progress; const max = Math.max(5, ...p.weeks.map((w) => w.tests)); const act = p.lastActive ? Math.floor((Date.now() - p.lastActive) / 86400000) : null;
  return (
    <main className="pg-wrap">
      <header className="pg-head"><p className="pg-brand">{site.name}</p><h1>{p.name}’s weekly progress</h1><p className="muted">A read-only summary shared by {p.name}. {act === null ? 'No tests started yet.' : act === 0 ? 'Active today.' : `Last active ${act} day${act === 1 ? '' : 's'} ago.`} Link valid until {d(r.expiresAt)}.</p></header>
      <section className="pg-stats">
        <div><b>{p.testsLast30}</b><span>mocks finished in 30 days</span></div>
        <div><b>{p.practiceDaysThisWeek}<small>/7</small></b><span>days practised this week</span></div>
        <div><b>{p.streak}</b><span>day streak</span></div>
      </section>
      <section className="card pg-card"><h2>Mocks finished each week</h2>
        <ol className="pg-bars" aria-label="Mocks finished per week, oldest first">{p.weeks.map((w) => <li key={w.endsOn} title={`Week ending ${w.endsOn}: ${w.tests} mock${w.tests === 1 ? '' : 's'}${w.avg != null ? `, average ${w.avg}%` : ''}`}><span className="pg-bar"><i style={{ height: `${(w.tests / max) * 100}%` }} /></span><b>{w.tests}</b><small>{w.avg != null ? `${w.avg}%` : '–'}</small></li>)}</ol>
        <p className="small muted">Under each bar: number of mocks, then the average score for that week.</p></section>
      <section className="card pg-card"><h2>Recent mocks</h2>
        {p.recent.length ? <table className="pg-table"><thead><tr><th>Mock</th><th>Finished</th><th>Score</th><th>Accuracy</th></tr></thead><tbody>{p.recent.map((x, i) => <tr key={i}><td>{x.mock}</td><td>{d(x.at)}</td><td>{Math.round(x.percentage)}%</td><td>{Math.round(x.accuracy)}%</td></tr>)}</tbody></table> : <p className="muted">No finished mocks in the last 60 days.</p>}</section>
      {(p.strongest.length > 0 || p.weakest.length > 0) && <section className="pg-two">
        <div className="card pg-card"><h2>Strongest topics</h2><ul className="pg-topics">{p.strongest.map((t) => <li key={t.topic}><span>{t.topic}</span><b>{t.pct}%</b></li>)}</ul></div>
        <div className="card pg-card"><h2>Needs more practice</h2>{p.weakest.length ? <ul className="pg-topics">{p.weakest.map((t) => <li key={t.topic}><span>{t.topic}</span><b>{t.pct}%</b></li>)}</ul> : <p className="muted">Not enough answers yet.</p>}</div>
      </section>}
      <p className="small muted pg-foot">Topic figures use the last 30 days and need at least four answered questions. {p.name} can stop sharing this link at any time.</p>
    </main>
  );
}
