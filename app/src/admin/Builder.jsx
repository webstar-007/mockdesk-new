import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Dialog, Err, Loading, diffTone, toast, useLoad } from './ui.jsx';

// Build a draft mock automatically from the question bank: pick how many questions per section and difficulty.
export default function Builder({ sections: allSecs, difficulties, exams = [], onClose }) {
  const nav = useNavigate();
  const [examId, setExamId] = useState('ssc-cgl-t2');
  const examDef = exams.find((x) => x.id === examId);
  const sections = examDef ? Object.fromEntries(examDef.sections.map((x) => [x.key, { ...allSecs[x.key], ...x }])) : allSecs;
  const keys = Object.keys(sections);
  const [name, setName] = useState(''); const [difficulty, setDifficulty] = useState('moderate'); const [include, setInclude] = useState('pool');
  const [plan, setPlan] = useState({});
  const [tab, setTab] = useState('once'); const [topicsAvail, setTopicsAvail] = useState({}); const [topics, setTopics] = useState([]); const [pub, setPub] = useState(false); const [pubAt, setPubAt] = useState('');
  useEffect(() => { api.get(`/admin/mocks/build/topics?examId=${examId}`).then((r) => setTopicsAvail(r.sections || {})).catch(() => {}); setTopics([]); }, [examId]);
  const allTopics = [...new Set(Object.values(topicsAvail).flat().map((x) => x.topic))].sort();
  const toggleTopic = (t) => { setTopics((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t])); setPrev(null); };
  const pl = (k) => plan[k] || { easy: 0, moderate: 0, hard: 0 };
  const [prev, setPrev] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [partial, setPartial] = useState(false); const [show, setShow] = useState(false);
  const set = (k, d, v) => { setPlan((p) => ({ ...p, [k]: { ...(p[k] || { easy: 0, moderate: 0, hard: 0 }), [d]: Math.max(0, Math.min(150, Number(v) || 0)) } })); setPrev(null); };
  const total = keys.reduce((a, k) => a + difficulties.reduce((b, d) => b + (pl(k)[d] || 0), 0), 0);
  // Fill the exam pattern: each section's question count split 40 / 40 / 20.
  const preset = () => { setPlan(Object.fromEntries(keys.map((k) => { const n = sections[k].questions; const e = Math.round(n * 0.4), h = Math.round(n * 0.2); return [k, { easy: e, moderate: n - e - h, hard: h }]; }))); setPrev(null); };
  const body = (dryRun) => ({ examId, name, difficulty, include, dryRun, allowPartial: partial, topics, publishAt: pub && pubAt ? new Date(pubAt).toISOString() : undefined, plan: keys.map((k) => ({ section: k, ...pl(k) })) });
  const preview = async () => { setBusy(true); setErr(''); try { setPrev(await api.post('/admin/mocks/build', body(true))); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const create = async () => {
    if (!name.trim()) { setErr('Give the mock a name'); return; }
    if (pub && !pubAt) { setErr('Pick when the mock should open, or turn scheduling off'); return; }
    setBusy(true); setErr('');
    try { const r = await api.post('/admin/mocks/build', body(false)); toast(r.scheduled ? `Created and scheduled to open ${new Date(r.scheduled).toLocaleString()}` : `Draft created with ${r.summary.picked} questions${r.warnings?.length ? '. ' + r.warnings[0] : ''}`); nav(`/admin/mocks/${r.mock.id}`); }
    catch (e) { setErr(e.message); if (e.code === 'SHORT') preview(); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Build a mock from the question bank" onClose={onClose} wide>
      <div className="sx-chips" role="tablist" aria-label="Build type"><button role="tab" aria-selected={tab === 'once'} className={tab === 'once' ? 'on' : ''} onClick={() => setTab('once')}>Build one now</button><button role="tab" aria-selected={tab === 'auto'} className={tab === 'auto' ? 'on' : ''} onClick={() => setTab('auto')}>Build one every week</button></div>
      {tab === 'auto' ? <AutoBuild exams={exams} difficulties={difficulties} onClose={onClose} /> : <>
      <p className="small muted" style={{ marginTop: 0 }}>Say how many questions you want. MockDesk picks them at random, spreads them over topics, and puts them in a new <b>draft</b> you can edit before publishing. Questions taken from the bank move into the new mock.</p>
      {exams.length > 1 && <label className="ad-field">Exam<select value={examId} onChange={(e) => { setExamId(e.target.value); setPlan({}); setPrev(null); }}>{exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      <div className="ad-grid g2">
        <label className="ad-field">Mock name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mock 6 · Mixed" autoFocus /></label>
        <label className="ad-field">Overall difficulty tag<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>{difficulties.map((d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      <label className="ad-field">Take questions from<select value={include} onChange={(e) => { setInclude(e.target.value); setPrev(null); }}><option value="pool">The question bank only (not yet in a mock)</option><option value="all">The bank first, then copies from other mocks if short</option></select></label>
      {allTopics.length > 0 && <details className="ad-field" open={topics.length > 0}><summary>Only use certain topics{topics.length ? ` (${topics.length} chosen)` : ' (optional)'}</summary><div className="sx-topics">{allTopics.map((t) => <label key={t} className={topics.includes(t) ? 'on' : ''}><input type="checkbox" checked={topics.includes(t)} onChange={() => toggleTopic(t)} />{t}</label>)}</div><small className="muted">Leave all unticked to draw from every topic. Topics shown are the ones in the question bank.</small></details>}
      <div className="bd-grid" role="group" aria-label="Questions wanted">
        <span className="h" style={{ textAlign: 'left' }}>Section <button className="btn btn-ghost btn-sm" type="button" onClick={preset}>Use exam pattern</button></span>{difficulties.map((d) => <span className="h" key={d}>{d}</span>)}
        {keys.map((k) => [<span key={k + 'n'}><b>{sections[k].short}</b> <small className="muted">of {sections[k].questions}</small></span>, ...difficulties.map((d) => <input key={k + d} type="number" min="0" max="150" inputMode="numeric" value={pl(k)[d] || ''} placeholder="0" aria-label={`${sections[k].short} ${d}`} onChange={(e) => set(k, d, e.target.value)} />)])}
      </div>
      <p className="small" style={{ margin: '10px 0 0' }}><b>{total}</b> questions requested.</p>
      <label className="ad-chk" style={{ marginTop: 8 }}><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> Publish it automatically at a set time</label>
      {pub && <label className="ad-field">Opens for students at<input type="datetime-local" value={pubAt} onChange={(e) => setPubAt(e.target.value)} /><small className="muted">The mock is published now but students only see it from this time. If it fails the usual publish checks it stays a draft and you are told why.</small></label>}
      <Err>{err}</Err>
      {prev && (
        <div style={{ marginTop: 10 }}>
          <div className={`ad-check ${prev.shortages.length ? 'warn' : 'good'}`}>
            <b>{prev.summary.picked} of {prev.summary.wanted} found</b> · {prev.summary.topics} topics · {prev.summary.fromBank} from the bank{prev.summary.fromMocks ? `, ${prev.summary.fromMocks} copied from mocks` : ''}
            {prev.shortages.length > 0 && <ul>{prev.shortages.map((s) => <li key={s.section + s.difficulty}>{sections[s.section].short} {s.difficulty}: wanted {s.wanted}, found {s.found}</li>)}</ul>}
          </div>
          {prev.shortages.length > 0 && <label className="ad-chk" style={{ marginTop: 8 }}><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Create the draft anyway with what was found</label>}
          <button className="btn btn-ghost btn-sm" type="button" style={{ marginTop: 8 }} onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'} the picked questions</button>
          {show && <div className="bd-prev">{prev.preview.map((x) => <div key={x.id}><Badge tone={diffTone[x.difficulty]}>{x.difficulty}</Badge> <b>{sections[x.section].short}</b> · {x.topic} <br /><span className="muted">{x.text}</span> <small className="muted">({x.from})</small></div>)}</div>}
        </div>
      )}
      <div className="modal-act"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-ghost" disabled={busy || !total} onClick={preview}>Preview picks</button><button className="btn btn-primary" disabled={busy || !total} onClick={create}>{busy ? 'Working…' : 'Create draft'}</button></div>
      </>}
    </Dialog>
  );
}

// A mock built from the bank on a repeating schedule, using the exam pattern (40% easy, 40% moderate, 20% hard in every section).
function AutoBuild({ exams, difficulties, onClose }) {
  const { data, err, loading, reload } = useLoad('/admin/auto-build'); const [c, setC] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) setC(data.config); }, [data]);
  if (loading && !c) return <Loading />; if (err) return <Err>{err}</Err>; if (!c) return null;
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const save = async () => { setBusy(true); setMsg(''); try { await api.put('/admin/auto-build', c); toast(c.enabled ? 'Weekly build is on' : 'Weekly build is off'); reload(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const now = async () => { setBusy(true); setMsg(''); try { await api.put('/admin/auto-build', c); const r = await api.post('/admin/auto-build/run'); setMsg(r.message); toast(r.ok ? r.message : 'Could not build', r.ok ? 'good' : 'bad'); reload(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>MockDesk builds a new mock by itself on a schedule, from the question bank, using the exam pattern. You get an alert when it is ready, or when the bank is running short.</p>
      <label className="ad-chk"><input type="checkbox" checked={c.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Build a mock automatically</label>
      <div className="ad-grid g2">
        <label className="ad-field">Every (days)<input type="number" min="1" max="60" value={c.everyDays} onChange={(e) => set('everyDays', e.target.value)} /></label>
        <label className="ad-field">Name starts with<input value={c.prefix} onChange={(e) => set('prefix', e.target.value)} /></label>
        {exams.length > 1 && <label className="ad-field">Exam<select value={c.examId} onChange={(e) => set('examId', e.target.value)}><option value="">Default exam</option>{exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="ad-field">Difficulty tag<select value={c.difficulty} onChange={(e) => set('difficulty', e.target.value)}>{difficulties.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label className="ad-field">Take questions from<select value={c.include} onChange={(e) => set('include', e.target.value)}><option value="pool">The question bank only</option><option value="all">The bank, then copies from other mocks</option></select></label>
        <label className="ad-field">When it is built<select value={c.mode} onChange={(e) => set('mode', e.target.value)}><option value="draft">Keep it as a draft for me to review</option><option value="schedule">Publish it to open after a delay</option></select></label>
        {c.mode === 'schedule' && <label className="ad-field">Opens after (days)<input type="number" min="1" max="30" value={c.leadDays} onChange={(e) => set('leadDays', e.target.value)} /></label>}
      </div>
      {c.lastResult && <p className="small muted">Last run: {c.lastResult}{c.lastRun ? ` · ${new Date(c.lastRun).toLocaleDateString()}` : ''}</p>}
      <Err>{msg}</Err>
      <div className="modal-act"><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-ghost" disabled={busy} onClick={now}>Save and build one now</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></div>
    </>
  );
}
