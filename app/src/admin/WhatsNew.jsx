import { Fragment, useEffect, useMemo, useState } from 'react';
import { Badge, Err, Loading, toast, useLoad } from './ui.jsx';

const SEEN = 'md-news-seen';
export const newsSeen = () => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
const markSeen = (v) => { try { localStorage.setItem(SEEN, v); } catch { /* not remembered */ } };
const TAGS = { students: ['Students', '🎓'], teachers: ['Teachers', '🧑‍🏫'], admin: ['Admin', '🛠️'], everywhere: ['Everywhere', '🌐'], fixed: ['Fixes', '🩹'], other: ['More', '✨'] };
const num = (v) => Number(String(v).replace(/\D/g, '')) || 0;

// **bold** and `code` inside a sentence. Nothing else is interpreted, and nothing is injected as HTML.
function Rich({ text }) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
}
const plain = (c, audiences) => `${c.version}: ${c.title}\n${c.items.filter((x) => audiences.includes(x.tag)).map((x) => `• ${x.label}: ${x.text.replace(/[`*]/g, '')}`).join('\n')}`;

export default function WhatsNew({ onSeen }) {
  const { data: d, err, loading } = useLoad('/admin/server/info'); const [tag, setTag] = useState('all'); const [q, setQ] = useState(''); const [open, setOpen] = useState({}); const log = d?.changelog || [];
  const seenBefore = useMemo(() => newsSeen(), []); // what they had seen when they opened the page, so new ones stay marked
  useEffect(() => { if (log[0]) { markSeen(log[0].version); onSeen?.(); } }, [log[0]?.version]); // eslint-disable-line
  const counts = useMemo(() => { const c = {}; for (const v of log) for (const x of v.items) c[x.tag] = (c[x.tag] || 0) + 1; return c; }, [log]);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const needle = q.trim().toLowerCase();
  const shown = log.map((v) => ({ ...v, items: v.items.filter((x) => (tag === 'all' || x.tag === tag) && (!needle || `${x.label} ${x.text} ${v.title}`.toLowerCase().includes(needle))) })).filter((v) => v.items.length || (!needle && tag === 'all' && v.intro));
  const unseen = (v) => num(v.version) > num(seenBefore);
  const latest = log[0];
  const copy = async (c, aud) => { try { await navigator.clipboard.writeText(plain(c, aud)); toast('Copied. Paste it into an announcement.'); } catch { toast('Could not copy. Select the text instead.', 'bad'); } };
  return (
    <div className="wn">
      <section className="wn-hero card">
        <div><span className="wn-ver">You are running {d.app || 'this version'}</span><h3>{latest ? `${latest.version}: ${latest.title}` : 'No release notes yet'}</h3>{latest?.intro && <p className="muted"><Rich text={latest.intro} /></p>}</div>
        <div className="wn-chips" aria-label="Changes in the latest version">{latest && Object.entries(TAGS).map(([k, [l, ic]]) => { const n = latest.items.filter((x) => x.tag === k).length; return n ? <button key={k} type="button" className="wn-chip" onClick={() => { setTag(k); setOpen({ [latest.version]: true }); }}><span aria-hidden="true">{ic}</span>{n} for {l.toLowerCase()}</button> : null; })}</div>
      </section>
      <div className="wn-bar">
        <div className="ad-pill-row" role="group" aria-label="Who is it for">{[['all', 'Everything', log.reduce((a, v) => a + v.items.length, 0)], ...Object.entries(TAGS).filter(([k]) => counts[k]).map(([k, [l]]) => [k, l, counts[k]])].map(([k, l, n]) => <button key={k} className={`ad-pill ${tag === k ? 'on' : ''}`} aria-pressed={tag === k} onClick={() => setTag(k)}>{l} <span className="muted">{n}</span></button>)}</div>
        <input className="wn-search" type="search" aria-label="Search release notes" placeholder="Search, for example “heat map”" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!shown.length ? <p className="muted">Nothing matches. Try another filter or word.</p> : (
        <ol className="wn-line">{shown.map((v, i) => { const isOpen = open[v.version] ?? (i === 0 || !!needle || tag !== 'all'); return (
          <li key={v.version} className={`wn-v ${unseen(v) ? 'new' : ''}`}>
            <span className="wn-dot" aria-hidden="true" />
            <details open={isOpen} onToggle={(e) => { if (e.currentTarget.open !== isOpen) setOpen((o) => ({ ...o, [v.version]: e.currentTarget.open })); }}>
              <summary><span className="wn-vn">{v.version}</span><b>{v.title}</b>{unseen(v) && <Badge tone="brand">New</Badge>}{i === 0 && tag === 'all' && !needle && <Badge tone="good">Latest</Badge>}<span className="wn-tags">{[...new Set(v.items.map((x) => x.tag))].map((k) => <i key={k} title={TAGS[k][0]} aria-label={TAGS[k][0]}>{TAGS[k][1]}</i>)}</span></summary>
              <div className="wn-body">
                {v.intro && <p className="muted"><Rich text={v.intro} /></p>}
                {v.items.map((x, j) => <div key={j} className={`wn-item t-${x.tag}`}><span className="wn-tag">{TAGS[x.tag][1]} {x.label}</span><p><Rich text={x.text} /></p></div>)}
                <div className="wn-act"><button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(v, ['students', 'teachers', 'everywhere'])}>Copy student and teacher notes</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(v, Object.keys(TAGS))}>Copy everything</button></div>
              </div>
            </details>
          </li>); })}</ol>)}
      {d.changelogTotal > log.length && <p className="small muted">Showing the latest {log.length} of {d.changelogTotal} versions. Older notes are in <code>CHANGELOG.md</code>.</p>}
    </div>
  );
}
