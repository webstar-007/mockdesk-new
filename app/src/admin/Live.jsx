import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Bars, Empty, Err, Loading, PageHead, Stat, ago, mmss, useLoad } from './ui.jsx';

const initials = (n) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const stateOf = (a, l) => (a.overtime || a.leaves >= 5 ? 'bad' : (l != null && l <= 300) || (a.lastSeen && Date.now() - a.lastSeen > 180000) || a.leaves >= 2 ? 'warn' : 'ok');
/** One tile per student. The ring is progress; the glow shows who might need help. */
function Floor({ rows, d, left }) {
  return (
    <ul className="fl-grid" aria-label="Students in a test">
      {rows.map((a) => { const l = left(a); const st = stateOf(a, l); const pct = Math.min(100, Math.round((a.answeredSoFar / (d.totalQ || 1)) * 100));
        return (
          <li key={a.id} className={`fl-t ${st}`}>
            <Link to={`/admin/attempts/${a.id}`} aria-label={`${a.user}: ${a.answeredSoFar} of ${d.totalQ} answered, ${a.overtime ? 'timer ended' : `${mmss(l)} left`}${a.leaves ? `, left the tab ${a.leaves} times` : ''}`}>
              <svg viewBox="0 0 44 44" aria-hidden="true"><circle className="bg" cx="22" cy="22" r="19" /><circle className="fg" cx="22" cy="22" r="19" pathLength="100" style={{ strokeDasharray: `${pct} 100` }} /></svg><span className="fl-av">{initials(a.user)}</span>
              <b title={a.user}>{a.user}</b><small>{a.overtime ? 'Timer ended' : l != null ? mmss(l) : '–'}{a.leaves ? ` · ${a.leaves}↗` : ''}</small>
            </Link>
          </li>); })}
    </ul>
  );
}
export default function Live() {
  const { data: d, err, loading, reload } = useLoad('/admin/live'); const [, tick] = useState(0);
  const [auto, setAuto] = useState(true); const [q, setQ] = useState(''); const [mock, setMock] = useState(''); const [sort, setSort] = useState('left'); const [stamp, setStamp] = useState(Date.now()); const [view, setView] = useState(() => { try { return localStorage.getItem('md-live-view') || 'floor'; } catch { return 'floor'; } });
  useEffect(() => { const b = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(b); }, []);
  useEffect(() => { if (!auto) return; const a = setInterval(() => { reload(); setStamp(Date.now()); }, 15000); return () => clearInterval(a); }, [reload, auto]);
  useEffect(() => { if (d) setStamp(Date.now()); }, [d]);
  const left = (a) => (a.minutes ? Math.max(0, a.minutes * 60 - (Date.now() - a.segmentStartedAt) / 1000) : null);
  const rows = useMemo(() => {
    if (!d) return [];
    let r = d.live.filter((a) => (!mock || a.mockName === mock) && (!q || `${a.user} ${a.contact}`.toLowerCase().includes(q.toLowerCase())));
    const key = { left: (a) => left(a) ?? 1e9, progress: (a) => -a.answeredSoFar, started: (a) => a.startedAt }[sort];
    return [...r].sort((a, c) => key(a) - key(c));
  }, [d, q, mock, sort, tick]); // eslint-disable-line
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const n = d.live.length; const answered = d.live.reduce((a, x) => a + x.answeredSoFar, 0);
  const closing = d.live.filter((a) => { const l = left(a); return l != null && l <= 300; }).length;
  const over = d.live.filter((a) => a.overtime).length;
  const pick = (v) => { setView(v); try { localStorage.setItem('md-live-view', v); } catch { /* ignore */ } };
  const copy = (txt) => { try { navigator.clipboard.writeText(txt); } catch { /* ignore */ } };
  const secAgo = Math.max(0, Math.round((Date.now() - stamp) / 1000));
  return (
    <>
      <PageHead title="Live tests" sub="Who is taking a test right now, how far they are, and how today is going.">
        <label className="ad-chk"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh (15 s)</label>
        <button className="btn btn-ghost" onClick={() => { reload(); setStamp(Date.now()); }}>↻ Refresh now</button>
      </PageHead>
      <p className="small muted" style={{ margin: '-6px 0 12px' }}><span className={`ad-dot ${auto ? 'on' : ''}`} aria-hidden="true" /> {auto ? 'Live' : 'Paused'} · updated {secAgo}s ago</p>

      <div className="ad-grid g4">
        <Stat icon="🟢" tone="good" label="In a test now" value={n} sub={d.byMock.length ? d.byMock.map((m) => `${m.n} on ${m.name}`).join(' · ') : 'Nobody right now'} />
        <Stat icon="✎" label="Questions answered" value={answered} sub={n ? `Avg ${Math.round(answered / n)} of ${d.totalQ} per student` : 'Saved at the end of each section'} />
        <Stat icon="⏳" tone={closing ? 'warn' : ''} label="Closing a section soon" value={closing} sub="5 minutes or less left" />
        <Stat icon="⚠" tone={over || d.stale ? 'bad' : ''} label="Need a look" value={over + d.stale} sub={`${over} past the timer · ${d.stale} unfinished 4 h+`} />
      </div>
      <div className="ad-grid g4" style={{ marginTop: 14 }}>
        <Stat icon="▶" label="Started today" value={d.today.started} />
        <Stat icon="✓" tone="good" label="Finished today" value={d.today.finished} sub={d.today.started ? `${Math.round((d.today.finished / d.today.started) * 100)}% of today’s starts` : ''} />
        <Stat icon="🎯" label="Average score today" value={d.today.finished ? `${d.today.avgPct}%` : '–'} />
        <Stat icon="🏆" label="Best score today" value={d.today.best ?? '–'} />
      </div>

      <div className="card nopad" style={{ marginTop: 14 }}>
        <div className="ad-toolbar" style={{ padding: '12px 14px' }}>
          <input type="search" placeholder="Search student or contact…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search live students" />
          <select value={mock} onChange={(e) => setMock(e.target.value)} aria-label="Mock"><option value="">All mocks</option>{d.byMock.map((m) => <option key={m.name}>{m.name}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="left">Least time left first</option><option value="progress">Most answered first</option><option value="started">Started earliest first</option></select>
        </div>
        <div className="ad-toolbar" style={{ padding: '0 14px 10px' }}><div className="dash-seg" role="group" aria-label="View">{[['floor', 'Floor view'], ['table', 'Table']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => pick(k)}>{l}</button>)}</div>{view === 'floor' && <span className="fl-key small muted"><i className="ok" /> Working <i className="warn" /> Closing soon or quiet <i className="bad" /> Timer ended or leaving the tab</span>}</div>
        {view === 'floor' && rows.length > 0 && <Floor rows={rows} d={d} left={left} />}
        {view === 'table' && !rows.length ? <Empty>{n ? 'No one matches those filters.' : 'No one is taking a test right now.'}</Empty> : view === 'table' ? <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>Student</th><th>Mock</th><th>Section</th><th>Answered</th><th className="num">Time left</th><th>Started</th><th /></tr></thead>
          <tbody>{rows.map((a) => { const l = left(a); return (
            <tr key={a.id}>
              <td className="nm"><Link to={`/admin/users/${a.userId}`}><b>{a.user}</b></Link><small>{a.contact}</small></td>
              <td>{a.mockName}</td>
              <td>{a.segmentLabel} <small className="muted">({a.segment}/{a.segments})</small></td>
              <td><span className="ad-prog" style={{ display: 'inline-block', width: 90, verticalAlign: 'middle' }}><i style={{ width: `${Math.min(100, (a.answeredSoFar / d.totalQ) * 100)}%` }} /></span> <small className="muted">{a.answeredSoFar}/{d.totalQ}</small></td>
              <td className="num">{a.overtime ? <Badge tone="bad">Timer ended</Badge> : <span className={l != null && l <= 300 ? 'ad-warn-t' : ''}>{mmss(l)}</span>}</td>
              <td><small>{ago(a.startedAt)}</small></td>
              <td style={{ whiteSpace: 'nowrap' }}>{a.contact && <button className="btn btn-ghost btn-sm" onClick={() => copy(a.contact)} title="Copy contact">Copy contact</button>} <Link className="btn btn-ghost btn-sm" to={`/admin/users/${a.userId}`}>Profile</Link></td>
            </tr>); })}</tbody></table></div> : !rows.length && <Empty>{n ? 'No one matches those filters.' : 'No one is taking a test right now.'}</Empty>}
      </div>

      <div className="ad-grid g-main" style={{ marginTop: 14 }}>
        <section className="card"><h3>Tests started, last 24 hours</h3><Bars title="Tests started" unit="Starts" data={d.hourly} every={3} height={110} /><p className="small muted" style={{ marginBottom: 0 }}>By hour of day, in your local time. Shows when students prefer to practise.</p></section>
        <section className="card"><h3>Just finished</h3>
          {d.recent.length ? <ul className="ad-timeline">{d.recent.map((a) => <li key={a.id}><div><Link to={`/admin/attempts/${a.id}`}><b>{a.user}</b></Link> scored <b>{a.score}/{a.max}</b> ({a.pct}%) {a.auto && <Badge tone="warn">auto-submitted</Badge>}<br /><small className="muted">{a.mockName} · {ago(a.submittedAt)}</small></div></li>)}</ul> : <Empty>No finished tests yet.</Empty>}
        </section>
      </div>
    </>
  );
}
