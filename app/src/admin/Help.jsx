import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Empty, PageHead, ago, toast } from './ui.jsx';

const KEY = 'md-help-thread';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-20))); } catch { /* private mode */ } };
let seq = 0; const nid = () => `${Date.now()}-${seq++}`;

const IDEAS = {
  People: ['Show top 10 students', 'Which students have not logged in for 14 days', 'Students who never started a test', 'Show all teachers', 'How many admins do I have'],
  'Mocks and results': ['Which mock is the hardest', 'Which mock is attempted the most', 'How many tests were finished this week', 'Which tests are in progress now'],
  Platform: ['Platform overview', 'Which batches have no teacher', 'Show open support tickets', 'What did admins do recently', 'Failed sign-ins today'],
  'How do I…': ['How do I add a teacher?', 'How do I back up the data?', 'How do I put the site in maintenance mode?', 'How many students can my server handle?'],
};

const toCsv = (t) => [t.cols, ...t.rows.map((r) => r.cells)].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && /\d/.test(String(v)) && !/[a-z]{3,}/i.test(String(v)) ? n : null; };

function Table({ t }) {
  const [sort, setSort] = useState({ i: -1, dir: 1 }); const [f, setF] = useState('');
  const rows = useMemo(() => {
    let r = t.rows; if (f.trim()) r = r.filter((x) => x.cells.join(' ').toLowerCase().includes(f.trim().toLowerCase()));
    if (sort.i >= 0) r = [...r].sort((a, b) => { const x = a.cells[sort.i], y = b.cells[sort.i]; const nx = num(x), ny = num(y); const c = nx != null && ny != null ? nx - ny : String(x).localeCompare(String(y)); return c * sort.dir; });
    return r;
  }, [t, sort, f]);
  const nav = useNavigate();
  const toggle = (i) => setSort((s) => (s.i === i ? { i, dir: -s.dir } : { i, dir: 1 }));
  return (
    <div className="hx-table">
      {t.rows.length > 8 && <input className="hx-filter" value={f} onChange={(e) => setF(e.target.value)} placeholder="Filter these rows" aria-label="Filter rows" />}
      <div className="hx-scroll"><table>
        <thead><tr>{t.cols.map((c, i) => <th key={c + i} aria-sort={sort.i === i ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}><button onClick={() => toggle(i)}>{c}{sort.i === i ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>)}</tr></thead>
        <tbody>{rows.map((r, k) => (
          <tr key={k} className={r.to ? 'go' : ''} onClick={r.to ? () => nav(r.to) : undefined}>{r.cells.map((c, i) => <td key={i}>{i === 0 && r.to ? <Link to={r.to} onClick={(e) => e.stopPropagation()}>{String(c)}</Link> : String(c)}</td>)}</tr>))}
        </tbody>
      </table></div>
      {!rows.length && <p className="hx-none">No rows match “{f}”.</p>}
    </div>
  );
}

function Stats({ list }) {
  return <dl className="hx-stats">{list.map((s) => <div key={s.label} className={s.tone ? `t-${s.tone}` : ''}><dt>{s.label}</dt><dd>{String(s.value)}</dd></div>)}</dl>;
}

function Actions({ d, onRefresh, copyText }) {
  const copy = async () => { try { await navigator.clipboard.writeText(copyText); toast('Copied'); } catch { toast('Could not copy', 'bad'); } };
  const csv = () => { const b = new Blob([toCsv(d.table)], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(d.title || 'help').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  return (
    <div className="hx-acts">
      {onRefresh && <button onClick={onRefresh} title="Re-run with the latest data">Refresh</button>}
      <button onClick={copy}>Copy</button>
      {d?.table && <button onClick={csv}>Download CSV</button>}
    </div>
  );
}

function DataCard({ d, onAsk, onRefresh }) {
  const text = [d.title, d.summary, ...(d.stats || []).map((s) => `${s.label}: ${s.value}`), ...(d.table ? [d.table.cols.join('\t'), ...d.table.rows.map((r) => r.cells.join('\t'))] : [])].filter(Boolean).join('\n');
  return (
    <article className="hx-card">
      <header><h3>{d.title}</h3><Actions d={d} onRefresh={onRefresh} copyText={text} /></header>
      {d.summary && <p className="hx-sum">{d.summary}</p>}
      {d.stats?.length > 0 && <Stats list={d.stats} />}
      {d.table && <Table t={d.table} />}
      {d.empty && <p className="hx-none">{d.empty}</p>}
      {(d.go?.length > 0 || d.follow?.length > 0) && (
        <footer>
          {d.go?.map((g) => <Link key={g.to} className="hx-open" to={g.to}>{g.label}</Link>)}
          {d.follow?.map((f) => <button key={f} className="hx-chip" onClick={() => onAsk(f)}>{f}</button>)}
        </footer>)}
    </article>
  );
}

function Feedback({ logId }) {
  const [state, setState] = useState('');
  const send = async (helpful) => { try { await api.post('/admin/help/feedback', { logId, helpful }); setState(helpful ? 'yes' : 'no'); } catch { /* optional */ } };
  if (state) return <span className="hx-fb">{state === 'yes' ? 'Thanks.' : 'Noted. This will help improve the answers.'}</span>;
  return <span className="hx-fb">Helpful? <button onClick={() => send(true)} aria-label="Yes">👍</button><button onClick={() => send(false)} aria-label="No">👎</button></span>;
}

function Guide({ c, logId, onOpen }) {
  const [done, setDone] = useState({}); const [open, setOpen] = useState(true);
  return (
    <article className="hx-card hx-guide">
      <header><div><span className="hx-tag">{c.area}</span><h3>{c.title}</h3></div></header>
      <p>{c.answer}</p>
      {c.steps.length > 0 && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>{c.steps.length} steps</summary>
          <ol>{c.steps.map((s, i) => <li key={i} className={done[i] ? 'done' : ''}><label><input type="checkbox" checked={!!done[i]} onChange={() => setDone((d) => ({ ...d, [i]: !d[i] }))} /><span>{s}</span></label></li>)}</ol>
        </details>)}
      <footer>
        {c.go.map((g) => <Link key={g.to + g.label} className="hx-open primary" to={g.to}>{g.label}</Link>)}
        {c.related.slice(0, 3).map((x) => <button key={x.id} className="hx-chip" onClick={() => onOpen(x.id)}>{x.title}</button>)}
        {logId && <Feedback logId={logId} />}
      </footer>
    </article>
  );
}

function Live({ lv, onRefresh }) {
  return (
    <article className="hx-card">
      <header><h3>{lv.title}</h3><Actions d={lv} onRefresh={onRefresh} copyText={`${lv.title}\n${lv.lines.map((x) => `${x.label}: ${x.value}`).join('\n')}`} /></header>
      <Stats list={lv.lines} />
      {lv.go?.length > 0 && <footer>{lv.go.map((g) => <Link key={g.to} className="hx-open" to={g.to}>{g.label}</Link>)}</footer>}
    </article>
  );
}

function Answer({ e, onAsk, onOpen, onRefresh }) {
  const r = e.res;
  if (!r) return <div className="hx-typing" role="status" aria-label="Looking for an answer"><i /><i /><i /></div>;
  if (r.error) return <p className="hx-err">{r.error}</p>;
  return (
    <div className="hx-ans">
      {r.say && <p className="hx-say">{r.say}</p>}
      {r.fixed && r.card && <p className="hx-note">Showing results for what I think you meant.</p>}
      {r.data && <DataCard d={r.data} onAsk={onAsk} onRefresh={() => onRefresh(e)} />}
      {r.live && <Live lv={r.live} onRefresh={() => onRefresh(e)} />}
      {r.card && !r.data && <Guide c={r.card} logId={r.logId} onOpen={onOpen} />}
      {r.alternatives?.length > 0 && <div className="hx-alts">{r.data || r.card ? <span>Guides on this</span> : null}{r.alternatives.map((x) => <button key={x.title} className="hx-chip" onClick={() => (x.ask ? onAsk(x.title) : onOpen(x.id))}>{x.title}</button>)}</div>}
      {r.kind === 'none' && r.logId && <Feedback logId={r.logId} />}
    </div>
  );
}

function Gaps({ onBack }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/admin/help/gaps').then(setD).catch(() => setD({ gaps: [], asked: 0, answered: 0 })); }, []);
  return (
    <section className="hx-gaps">
      <button className="hx-back" onClick={onBack}>← Back to Help</button>
      <h3>Questions Help could not answer</h3>
      {!d ? <p className="muted" role="status">Loading…</p> : <>
        <p className="muted small">{d.asked} asked, {d.answered} answered. Questions that found nothing, or were marked not helpful, are listed here.</p>
        {!d.gaps.length ? <Empty>Nothing missing so far.</Empty> : <ul>{d.gaps.map((g) => <li key={g.q}><span>{g.q}</span><small>{g.n}× · {ago(g.last)}{g.unhelpful ? ` · ${g.unhelpful} not helpful` : ''}</small></li>)}</ul>}
      </>}
    </section>
  );
}

export default function Help() {
  const [sp] = useSearchParams(); const from = sp.get('from') || ''; const initQ = sp.get('q') || '';
  const [thread, setThread] = useState(load); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null); const [checks, setChecks] = useState([]); const [pageTopics, setPageTopics] = useState([]);
  const [idea, setIdea] = useState(Object.keys(IDEAS)[0]); const [sug, setSug] = useState([]); const [hi, setHi] = useState(-1); const [browse, setBrowse] = useState(false); const [area, setArea] = useState(null); const [view, setView] = useState('help');
  const inp = useRef(null); const end = useRef(null);
  useEffect(() => { api.get('/admin/help').then(setMeta).catch(() => setMeta({ areas: [] })); api.get('/admin/help/checks').then((d) => setChecks(d.checks || [])).catch(() => {}); }, []);
  useEffect(() => { if (from) api.get(`/admin/help/page?path=${encodeURIComponent(from)}`).then((r) => setPageTopics(r.topics)).catch(() => {}); }, [from]);
  useEffect(() => { save(thread.filter((x) => x.res)); }, [thread]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [thread.length]);
  useEffect(() => { const h = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); inp.current?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  useEffect(() => { if (q.trim().length < 2) { setSug([]); return undefined; } const h = setTimeout(() => api.get(`/admin/help/suggest?q=${encodeURIComponent(q)}`).then((d) => { setSug(d.items || []); setHi(-1); }).catch(() => {}), 150); return () => clearTimeout(h); }, [q]);

  const run = useCallback(async (text, id) => {
    const t = String(text || '').trim(); if (!t) return; setSug([]); setQ('');
    const eid = id || nid(); if (!id) setThread((x) => [...x, { id: eid, q: t, res: null }]); else setThread((x) => x.map((y) => (y.id === id ? { ...y, res: null } : y)));
    setBusy(true);
    try { const res = await api.post('/admin/help/ask', { q: t }); setThread((x) => x.map((y) => (y.id === eid ? { ...y, res } : y))); }
    catch (e) { setThread((x) => x.map((y) => (y.id === eid ? { ...y, res: { error: e.message || 'Something went wrong. Try again.' } } : y))); }
    finally { setBusy(false); }
  }, []);
  const open = useCallback(async (id) => { const eid = nid(); try { const r = await api.get(`/admin/help/topic/${id}`); setThread((x) => [...x, { id: eid, q: r.card.title, res: { kind: 'answer', card: r.card, alternatives: [] } }]); } catch (e) { toast(e.message, 'bad'); } }, []);
  useEffect(() => { if (initQ) run(initQ); /* eslint-disable-next-line */ }, []);
  const pickArea = async (name) => { setArea({ name, topics: null }); try { const r = await api.get(`/admin/help/area/${encodeURIComponent(name)}`); setArea({ name, topics: r.topics }); } catch { setArea(null); } };
  const clear = async () => { setThread([]); try { await api.del('/admin/help/history'); sessionStorage.removeItem(KEY); } catch { /* */ } };
  const choose = (s) => { if (s.type === 'topic') { setQ(''); setSug([]); open(s.id); } else run(s.text); };
  const onKey = (e) => {
    if (sug.length && e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % sug.length); }
    else if (sug.length && e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h <= 0 ? sug.length - 1 : h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0 && sug[hi]) choose(sug[hi]); else run(q); }
    else if (e.key === 'Escape') { setSug([]); setQ(''); }
  };
  const empty = !thread.length;

  const box = (
    <div className="hx-box">
      <div className="hx-field">
        <input ref={inp} value={q} maxLength={300} placeholder="Ask about students, teachers, mocks, or how to do something" aria-label="Ask Help" autoComplete="off" role="combobox" aria-expanded={sug.length > 0} aria-controls="hx-sug" onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <button className="btn btn-primary" disabled={busy || q.trim().length < 2} onClick={() => run(q)}>Ask</button>
      </div>
      {sug.length > 0 && <ul id="hx-sug" className="hx-sug" role="listbox">{sug.map((s, i) => <li key={s.text} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(s); }}><span>{s.text}</span><small>{s.type === 'topic' ? 'Guide' : 'Data'}</small></li>)}</ul>}
    </div>
  );

  if (view === 'gaps') return <><PageHead title="Help" /><Gaps onBack={() => setView('help')} /></>;
  return (
    <div className="hx">
      <PageHead title="Help" sub="Ask in plain words. Get live data or step-by-step guidance." />
      {empty ? (
        <div className="hx-start">
          {box}
          {checks.length > 0 && <div className="hx-checks" aria-label="Quick checks">{checks.map((c) => <Link key={c.key} to={c.to} className={`t-${c.tone}`}><i aria-hidden="true" />{c.label}<b>{c.value}</b></Link>)}</div>}
          <div className="hx-ideas">
            <div className="hx-itabs" role="tablist">{Object.keys(IDEAS).map((k) => <button key={k} role="tab" aria-selected={idea === k} className={idea === k ? 'on' : ''} onClick={() => setIdea(k)}>{k}</button>)}</div>
            <ul>{IDEAS[idea].map((s) => <li key={s}><button onClick={() => run(s)}>{s}</button></li>)}</ul>
          </div>
          {pageTopics.length > 0 && <div className="hx-here"><span>About the page you came from</span>{pageTopics.map((t) => <button key={t.id} className="hx-chip" onClick={() => open(t.id)}>{t.title}</button>)}</div>}
        </div>
      ) : (
        <div className="hx-thread" role="log" aria-live="polite">
          {thread.map((e) => (
            <section key={e.id} className="hx-turn">
              <h2 className="hx-q">{e.q}</h2>
              <Answer e={e} onAsk={(t) => run(t)} onOpen={open} onRefresh={(x) => run(x.q, x.id)} />
            </section>))}
          <div ref={end} />
        </div>
      )}
      {!empty && <div className="hx-dock">{box}</div>}
      <footer className="hx-foot">
        <button onClick={() => setBrowse((b) => !b)} aria-expanded={browse}>{browse ? 'Hide topics' : `Browse all ${meta?.total || ''} topics`}</button>
        {!empty && <button onClick={clear}>Clear conversation</button>}
        {meta?.canGaps && <button onClick={() => setView('gaps')}>Missing answers</button>}
      </footer>
      {browse && (
        <div className="hx-browse">
          <div className="hx-areas">{(meta?.areas || []).map((a) => <button key={a.name} className={area?.name === a.name ? 'on' : ''} aria-pressed={area?.name === a.name} onClick={() => (area?.name === a.name ? setArea(null) : pickArea(a.name))}>{a.name}<small>{a.count}</small></button>)}</div>
          {area && <ul>{!area.topics ? <li className="muted small">Loading…</li> : area.topics.map((t) => <li key={t.id}><button onClick={() => { open(t.id); setBrowse(false); }}>{t.title}</button></li>)}</ul>}
        </div>)}
    </div>
  );
}
