import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Empty, PageHead, ago, toast } from './ui.jsx';

const KEY = 'md-help-chat';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-30))); } catch { /* private mode */ } };
let seq = 0; const nid = () => `${Date.now()}-${seq++}`;

function Steps({ steps, id }) {
  const [done, setDone] = useState({});
  return (
    <ol className="hp-steps">{steps.map((s, i) => (
      <li key={i} className={done[i] ? 'done' : ''}><label><input type="checkbox" checked={!!done[i]} onChange={() => setDone((d) => ({ ...d, [i]: !d[i] }))} aria-label={`Step ${i + 1} done`} /><span>{s}</span></label></li>))}
    </ol>
  );
}

function Feedback({ logId }) {
  const [state, setState] = useState(''); const [note, setNote] = useState('');
  const send = async (helpful, n = '') => { try { await api.post('/admin/help/feedback', { logId, helpful, note: n }); setState(helpful ? 'yes' : 'sent'); } catch { /* feedback is optional */ } };
  if (state === 'yes') return <p className="small muted hp-fb">Thanks, glad it helped.</p>;
  if (state === 'sent') return <p className="small muted hp-fb">Thanks. This will help improve the answers.</p>;
  if (state === 'no') return <form className="hp-fb hp-fb-note" onSubmit={(e) => { e.preventDefault(); send(false, note); }}><input aria-label="What were you looking for?" placeholder="What were you looking for?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /><button className="btn btn-ghost btn-sm">Send</button></form>;
  return <div className="hp-fb small muted">Was this helpful? <button className="hp-thumb" onClick={() => send(true)} aria-label="Yes, helpful">👍</button><button className="hp-thumb" onClick={() => { setState('no'); send(false); }} aria-label="No, not helpful">👎</button></div>;
}

function Answer({ m, onAsk, onOpen, onRefresh }) {
  const c = m.card; const lv = m.live;
  const copy = async () => { try { await navigator.clipboard.writeText(`${c.title}\n${c.answer}${c.steps.length ? `\n${c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}`); toast('Copied'); } catch { toast('Could not copy', 'bad'); } };
  return (
    <div className="hp-msg bot">
      {m.say && <p>{m.say}</p>}
      {m.fixed && c && <p className="small muted">Showing results for what I think you meant.</p>}
      {lv && (
        <section className="hp-live" aria-label={lv.title}>
          <header><b>{lv.title}</b><span className="small muted">live</span><button className="btn btn-ghost btn-sm" onClick={() => onRefresh(m.q)}>Refresh</button></header>
          <dl>{lv.lines.map((x) => <div key={x.label}><dt>{x.label}</dt><dd>{String(x.value)}</dd></div>)}</dl>
          {lv.go.length > 0 && <p className="hp-go">{lv.go.map((g) => <Link key={g.to} className="btn btn-ghost btn-sm" to={g.to}>{g.label}</Link>)}</p>}
        </section>
      )}
      {c && (
        <article className="hp-card">
          <header><Badge>{c.area}</Badge><button className="hp-copy" onClick={copy} aria-label="Copy this answer">Copy</button></header>
          <h3>{c.title}</h3>
          <p>{c.answer}</p>
          {c.steps.length > 0 && <><h4>Steps</h4><Steps steps={c.steps} id={c.id} /></>}
          {c.go.length > 0 && <p className="hp-go">{c.go.map((g) => <Link key={g.to + g.label} className="btn btn-primary btn-sm" to={g.to}>{g.label}</Link>)}</p>}
          {c.related.length > 0 && <div className="hp-rel"><span className="small muted">Related</span>{c.related.map((x) => <button key={x.id} className="chip" onClick={() => onOpen(x.id)}>{x.title}</button>)}</div>}
          {m.logId && <Feedback logId={m.logId} />}
        </article>
      )}
      {!c && m.alternatives?.length > 0 && <div className="hp-alts">{m.alternatives.map((x) => <button key={x.title} className="chip" onClick={() => (x.ask ? onAsk(x.title) : onOpen(x.id))}>{x.title}</button>)}</div>}
      {c && m.alternatives?.length > 0 && <div className="hp-alts"><span className="small muted">Others people ask</span>{m.alternatives.map((x) => <button key={x.id} className="chip" onClick={() => onOpen(x.id)}>{x.title}</button>)}</div>}
      {m.kind === 'none' && m.logId && <Feedback logId={m.logId} />}
    </div>
  );
}

function Gaps() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/admin/help/gaps').then(setD).catch(() => setD({ gaps: [], asked: 0, answered: 0 })); }, []);
  if (!d) return <p className="muted" role="status">Loading…</p>;
  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Questions Help could not answer</h3>
      <p className="muted small">{d.asked} questions asked, {d.answered} answered. Questions that found nothing, or that someone marked not helpful, are listed here.</p>
      {!d.gaps.length ? <Empty>Nothing missing so far.</Empty> : <ul className="hp-gaps">{d.gaps.map((g) => <li key={g.q}><span>{g.q}</span><small className="muted">{g.n}× · {ago(g.last)}{g.unhelpful ? ` · ${g.unhelpful} marked not helpful` : ''}</small></li>)}</ul>}
    </section>
  );
}

export default function Help() {
  const [sp] = useSearchParams(); const from = sp.get('from') || ''; const initQ = sp.get('q') || '';
  const [msgs, setMsgs] = useState(load); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [meta, setMeta] = useState(null); const [area, setArea] = useState(null); const [pageTopics, setPageTopics] = useState([]); const [tab, setTab] = useState('ask');
  const box = useRef(null); const inp = useRef(null); const end = useRef(null);
  const [checks, setChecks] = useState([]); const [pf, setPf] = useState(''); const [pages, setPages] = useState([]);
  useEffect(() => { api.get('/admin/help/checks').then((d) => setChecks(d.checks || [])).catch(() => {}); }, []);
  useEffect(() => { const h = setTimeout(() => { api.get(`/admin/help/pages?q=${encodeURIComponent(pf)}`).then((d) => setPages(d.pages || [])).catch(() => {}); }, 200); return () => clearTimeout(h); }, [pf]);
  useEffect(() => { api.get('/admin/help').then(setMeta).catch(() => setMeta({ areas: [], suggested: [], popular: [], recent: [] })); }, []);
  useEffect(() => { if (from) api.get(`/admin/help/page?path=${encodeURIComponent(from)}`).then((r) => setPageTopics(r.topics)).catch(() => {}); }, [from]);
  useEffect(() => { save(msgs); end.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { const h = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); inp.current?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const push = (m) => setMsgs((x) => [...x, { id: nid(), ...m }]);
  const ask = useCallback(async (text, replaceLast = false) => {
    const t = String(text || '').trim(); if (!t || busy) return; setBusy(true); setQ('');
    if (!replaceLast) push({ from: 'me', text: t });
    try { const r = await api.post('/admin/help/ask', { q: t }); const m = { from: 'bot', ...r, text: '' }; if (replaceLast) setMsgs((x) => { const i = x.map((y) => y.q).lastIndexOf(t); return i < 0 ? [...x, { id: nid(), ...m }] : x.map((y, k) => (k === i ? { ...y, ...m } : y)); }); else push(m); }
    catch (e) { push({ from: 'bot', kind: 'error', say: e.message || 'Something went wrong. Try again.' }); } finally { setBusy(false); inp.current?.focus(); }
  }, [busy]);
  const open = useCallback(async (id) => { setBusy(true); try { const r = await api.get(`/admin/help/topic/${id}`); push({ from: 'me', text: r.card.title }); push({ from: 'bot', kind: 'answer', card: r.card, alternatives: [] }); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } }, []);
  useEffect(() => { if (initQ) ask(initQ); /* eslint-disable-next-line */ }, []);
  const pickArea = async (name) => { setArea({ name, topics: null }); try { const r = await api.get(`/admin/help/area/${encodeURIComponent(name)}`); setArea(r.area ? { name: r.area, topics: r.topics } : null); } catch { setArea(null); } };
  const clear = async () => { setMsgs([]); try { await api.del('/admin/help/history'); sessionStorage.removeItem(KEY); } catch { /* */ } api.get('/admin/help').then(setMeta).catch(() => {}); };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } if (e.key === 'Escape') setQ(''); };

  return (
    <>
      <PageHead title="Help" sub="Ask anything about running the platform. Get the answer, the steps, and a button that opens the right page.">
        <div className="ad-tabs" style={{ margin: 0, border: 0 }} role="tablist">{[['ask', 'Ask'], ...(meta?.canGaps ? [['gaps', 'Missing answers']] : [])].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </PageHead>
      {tab === 'gaps' ? <Gaps /> : (
        <div className="hp-wrap">
          <section className="hp-chat card" aria-label="Conversation">
            <div className="hp-log" ref={box} role="log" aria-live="polite">
              {!msgs.length && (
                <div className="hp-empty">
                  <h3>What do you want to do?</h3>
                  <p className="muted">Type a question in your own words. For example “how do I lock a teacher’s account” or “how much disk space is left”.</p>
                  {checks.length > 0 && <div className="hp-checks" aria-label="Quick checks">{checks.map((c) => <Link key={c.key} to={c.to} className={`hp-check t-${c.tone}`}><span>{c.label}</span><b>{c.value}</b></Link>)}</div>}
                  <p className="small muted" style={{ marginTop: 14 }}>Find a page</p>
                  <input className="input" value={pf} onChange={(e) => setPf(e.target.value)} placeholder="Type a page name, for example backup" aria-label="Find a page" style={{ maxWidth: 320 }} />
                  <div className="hp-chips" style={{ marginTop: 8 }}>{pages.map((g) => <Link key={g.to} className="chip" to={g.to}>{g.label}</Link>)}</div>
                  <div className="hp-chips">{(meta?.suggested || []).map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
                  {meta?.recent?.length > 0 && <><p className="small muted" style={{ marginTop: 14 }}>Your recent questions</p><div className="hp-chips">{meta.recent.map((s) => <button key={s} className="chip ghost" onClick={() => ask(s)}>{s}</button>)}</div></>}
                </div>)}
              {msgs.map((m) => m.from === 'me' ? <div key={m.id} className="hp-msg me">{m.text}</div> : m.kind === 'error' ? <div key={m.id} className="hp-msg bot"><p className="sx-bad">{m.say}</p></div> : <Answer key={m.id} m={m} onAsk={(t) => ask(t)} onOpen={open} onRefresh={(t) => ask(t, true)} />)}
              {busy && <div className="hp-msg bot hp-typing" role="status" aria-label="Looking for an answer"><i /><i /><i /></div>}
              <div ref={end} />
            </div>
            <form className="hp-input" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
              <textarea ref={inp} rows={1} value={q} maxLength={300} placeholder="Ask a question…  (press / to jump here)" aria-label="Your question" onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
              <button className="btn btn-primary" disabled={busy || q.trim().length < 2}>Ask</button>
            </form>
            {msgs.length > 0 && <p className="hp-clear"><button className="btn btn-ghost btn-sm" onClick={clear}>Clear conversation</button></p>}
          </section>
          <aside className="hp-side">
            {pageTopics.length > 0 && <section className="card"><h3>About the page you came from</h3><ul className="hp-list">{pageTopics.map((t) => <li key={t.id}><button className="hp-link" onClick={() => open(t.id)}>{t.title}</button></li>)}</ul></section>}
            <section className="card"><h3>Browse by topic</h3>
              <div className="hp-areas">{(meta?.areas || []).map((a) => <button key={a.name} className={`chip ${area?.name === a.name ? 'on' : ''}`} aria-pressed={area?.name === a.name} onClick={() => (area?.name === a.name ? setArea(null) : pickArea(a.name))}>{a.name} <small>{a.count}</small></button>)}</div>
              {area && <ul className="hp-list" style={{ marginTop: 10 }}>{!area.topics ? <li className="muted small">Loading…</li> : area.topics.map((t) => <li key={t.id}><button className="hp-link" onClick={() => open(t.id)}>{t.title}</button></li>)}</ul>}
            </section>
            {meta?.popular?.length > 0 && <section className="card"><h3>Often asked</h3><ul className="hp-list">{meta.popular.map((t) => <li key={t.id}><button className="hp-link" onClick={() => open(t.id)}>{t.title}</button></li>)}</ul></section>}
          </aside>
        </div>
      )}
    </>
  );
}
