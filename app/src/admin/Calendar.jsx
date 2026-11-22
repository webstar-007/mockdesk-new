import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Empty, Err, Loading, PageHead, dt, useLoad } from './ui.jsx';

const KIND = { 'mock-open': ['Opens', 'brand'], 'live-open': ['Live starts', 'bad'], 'live-close': ['Live ends', 'warn'], message: ['Message', 'mute'], announcement: ['Notice', 'good'] };
const day0 = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hm = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const link = (e) => (e.mockId ? `/admin/mocks/${e.mockId}` : e.campaignId ? '/admin/messages' : '/admin/announcements');

export default function Calendar() {
  const nav = useNavigate(); const { data: d, err, loading } = useLoad('/admin/calendar'); const [m, setM] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [exam, setExam] = useState('');
  const cells = useMemo(() => { const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7)); return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; }); }, [m]);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const exams = [...new Set(d.events.map((e) => e.exam).filter(Boolean))];
  const ev = d.events.filter((e) => !exam || !e.exam || e.exam === exam); const by = new Map();
  for (const e of ev) { const k = day0(e.at); (by.get(k) || by.set(k, []).get(k)).push(e); }
  const today = day0(d.now); const soon = ev.filter((e) => e.at >= d.now && e.at < d.now + 14 * 86400000);
  const shift = (n) => setM(new Date(m.getFullYear(), m.getMonth() + n, 1));
  const empty = !d.events.length;
  return (
    <>
      <PageHead title="Release calendar" sub="When mocks open, live windows start and end, and messages go out. Click anything to edit it.">
        {exams.length > 1 && <select value={exam} onChange={(e) => setExam(e.target.value)} aria-label="Exam"><option value="">All exams</option>{exams.map((x) => <option key={x}>{x}</option>)}</select>}
        <Link className="btn btn-primary" to="/admin/mocks">Schedule a mock</Link>
      </PageHead>
      <div className="cal-wrap">
        <section className="card cal">
          <div className="cal-bar"><button className="btn btn-ghost btn-sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button><h2>{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><button className="btn btn-ghost btn-sm" onClick={() => shift(1)} aria-label="Next month">›</button><button className="btn btn-ghost btn-sm" onClick={() => { const n = new Date(); setM(new Date(n.getFullYear(), n.getMonth(), 1)); }}>Today</button></div>
          <div className="cal-grid" role="grid" aria-label="Month">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
            {cells.map((c) => { const k = c.getTime(); const list = by.get(k) || []; const out = c.getMonth() !== m.getMonth();
              return <div key={k} role="gridcell" className={`cal-day${out ? ' out' : ''}${k === today ? ' today' : ''}`}><span className="cal-n">{c.getDate()}</span>
                {list.slice(0, 3).map((e, i) => <button key={i} type="button" className={`cal-ev t-${KIND[e.type][1]}${e.at < d.now ? ' past' : ''}`} title={`${KIND[e.type][0]}: ${e.title} at ${hm(e.at)}`} onClick={() => nav(link(e))}>{e.title.replace("CGL Tier-II ", "")}</button>)}
                {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}</div>; })}
          </div>
          <div className="cal-key">{Object.values(KIND).map(([l, t]) => <span key={l} className={`t-${t}`}><i />{l}</span>)}</div>
        </section>
        <aside className="cal-side">
          <section className="card"><h3>Next 14 days</h3>{!soon.length ? <p className="muted" style={{ margin: 0 }}>{empty ? 'Nothing is scheduled yet. Set “Available from” on a mock, or start a live window.' : 'Nothing is due in the next two weeks.'}</p> : <ul className="cal-list">{soon.slice(0, 10).map((e, i) => <li key={i}><Link to={link(e)}><b>{e.title}</b><small className="muted">{dt(e.at)}</small></Link><Badge tone={KIND[e.type][1]}>{KIND[e.type][0]}</Badge></li>)}</ul>}</section>
          <section className="card"><h3>Not scheduled</h3>{!d.unscheduled.length ? <p className="muted" style={{ margin: 0 }}>Every mock is either published or has an opening date.</p> : <><p className="small muted" style={{ marginTop: 0 }}>Drafts with no opening date.</p><ul className="cal-list">{d.unscheduled.slice(0, 8).map((x) => <li key={x.id}><Link to={`/admin/mocks/${x.id}`}><b>{x.name}</b><small className="muted">{x.exam || 'Draft'}</small></Link><Badge tone="warn">{x.status}</Badge></li>)}</ul></>}</section>
        </aside>
      </div>
      {empty && <Empty>Nothing is scheduled yet.</Empty>}
    </>
  );
}
