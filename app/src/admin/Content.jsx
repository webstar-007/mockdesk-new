import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Empty, Err, Loading, PageHead, toast, useLoad } from './ui.jsx';

const TABS = [['import', 'Import'], ['dupes', 'Duplicates'], ['drafts', 'AI solutions']];
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const SAMPLE = `Q1. What is 15% of 200?
(A) 20
(B) 25
(C) 30
(D) 35
Answer: C
Explanation: 15% of 200 = 0.15 x 200 = 30.
Topic: Percentage

Q2. Who wrote the Indian national anthem?
A. Bankim Chandra Chatterjee
B. Rabindranath Tagore
C. Sarojini Naidu
D. Subhas Chandra Bose
Answer: B`;

function Import({ meta }) {
  const [text, setText] = useState(''); const [file, setFile] = useState(null); const [over, setOver] = useState(false);
  const [d, setD] = useState({ section: '', difficulty: 'moderate', topic: '' }); const [mock, setMock] = useState('pool');
  const [res, setRes] = useState(null); const [skip, setSkip] = useState({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(null); const inp = useRef(null);
  const mocks = useLoad('/admin/mocks').data?.mocks || [];
  const pick = async (f) => { setErr(''); setRes(null); if (!f) return; if (!/\.docx$/i.test(f.name)) { setErr('Choose a Word (.docx) file, or paste the text below.'); return; } setFile({ name: f.name, data: b64(await f.arrayBuffer()) }); };
  const read = async () => { setBusy(true); setErr(''); setDone(null); try { const r = await api.post('/admin/import/parse', { ...(file ? { docx: file.data } : { text }), defaults: d }); setRes(r); setSkip(Object.fromEntries(r.duplicates.map((x) => [x.row, true]))); } catch (e) { setErr(e.message); setRes(null); } finally { setBusy(false); } };
  const keep = res ? res.rows.filter((r) => !skip[r._n]) : []; const dupBy = res ? Object.fromEntries(res.duplicates.map((x) => [x.row, x])) : {};
  const missingSection = keep.some((r) => !r.section);
  const run = async () => { setBusy(true); setErr(''); try { const r = await api.post(`/admin/mocks/${mock}/import`, { rows: keep.map(({ _n, ...x }) => x), skipBad: true }); setDone(r.added); setRes(null); setText(''); setFile(null); toast(`${r.added} question${r.added === 1 ? '' : 's'} added`); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <>
      <section className="card"><h3>Bring in questions from Word or pasted text</h3>
        <p className="small muted">Number each question, give four options (A to D) and an “Answer: B” line. Optional lines: Explanation, Topic, Difficulty, Section. Existing CSV import is still on each mock’s page.</p>
        <div className={`ct-drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
          {file ? <p><b>{file.name}</b> <button className="linkbtn" onClick={() => setFile(null)}>Remove</button></p> : <p>Drop a Word file here, or <button className="linkbtn" onClick={() => inp.current?.click()}>choose one</button></p>}
          <input ref={inp} type="file" accept=".docx" hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
        {!file && <label className="ad-field" style={{ marginTop: 10 }}>Or paste the text <button type="button" className="linkbtn" onClick={() => setText(SAMPLE)}>Fill with an example</button><textarea className="ct-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} /></label>}
        <div className="ad-row"><label className="ad-field">Section if not in the text<select value={d.section} onChange={(e) => setD({ ...d, section: e.target.value })}><option value="">Choose…</option>{Object.entries(meta.sections).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}</select></label>
          <label className="ad-field">Difficulty<select value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value })}><option>easy</option><option>moderate</option><option>hard</option></select></label>
          <label className="ad-field">Topic if not in the text<input value={d.topic} onChange={(e) => setD({ ...d, topic: e.target.value })} placeholder="General" /></label></div>
        <Err>{err}</Err>
        <button className="btn btn-primary" disabled={busy || (!file && text.trim().length < 10)} onClick={read}>{busy && !res ? 'Reading…' : 'Check the questions'}</button>
        {done != null && <p className="okmsg" role="status">Added {done} question{done === 1 ? '' : 's'}.</p>}
      </section>
      {res && <section className="card" style={{ marginTop: 14 }}><h3>{res.rows.length} ready{res.problems.length ? `, ${res.problems.length} need a fix` : ''}{res.duplicates.length ? `, ${res.duplicates.length} look like duplicates` : ''}</h3>
        {res.problems.length > 0 && <div className="alert" role="alert"><b>Not imported</b><ul>{res.problems.map((p) => <li key={p.row}>Question {p.row} (“{p.text}”): {p.error}</li>)}</ul></div>}
        {res.rows.map((r) => { const du = dupBy[r._n]; return <div className="ct-row" key={r._n}><input type="checkbox" aria-label={`Import question ${r._n}`} checked={!skip[r._n]} onChange={(e) => setSkip({ ...skip, [r._n]: !e.target.checked })} />
          <div><p><b>{r._n}.</b> {r.text.slice(0, 160)}</p><p className="small muted">{r.options.map((o, i) => `${'ABCD'[i]}) ${o}`).join('   ')} · answer {'ABCD'[r.answer]}{r.section ? ` · ${r.section}` : ''}</p>{du && <p className="small"><Badge tone="warn">possible duplicate {Math.round(du.score * 100)}%</Badge> of “{du.of.text.slice(0, 80)}” in {du.of.mockName}</p>}</div></div>; })}
        <div className="ad-row" style={{ marginTop: 12 }}><label className="ad-field">Add them to<select value={mock} onChange={(e) => setMock(e.target.value)}><option value="pool">Question pool (not in any mock yet)</option>{mocks.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>
        {missingSection && <p className="small" style={{ color: 'var(--bad)' }}>Some questions have no section. Choose one above and check again.</p>}
        <button className="btn btn-primary" disabled={busy || !keep.length || missingSection} onClick={run}>{busy ? 'Adding…' : `Add ${keep.length} question${keep.length === 1 ? '' : 's'}`}</button>
      </section>}
    </>
  );
}

function Dupes() {
  const [min, setMin] = useState(0.85); const { data, err, loading, reload } = useLoad(`/admin/duplicates?min=${min}`, [min]);
  const ignore = async (p) => { try { await api.post('/admin/duplicates/ignore', { a: p.a.id, b: p.b.id }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const Q = ({ q }) => <div><p><b>{q.text}</b></p><p className="small muted">{q.mockName}{q.status ? ` (${q.status})` : ''} · {q.section} #{q.position + 1}</p><Link className="small" to={`/admin/mocks/${q.mockId}?q=${q.id}`}>Open question</Link></div>;
  return (
    <section className="card"><h3>Possible duplicates in the bank</h3>
      <p className="small muted">Questions with nearly the same wording and options. The same wording with different numbers or pictures is not counted.</p>
      <label className="ad-field" style={{ maxWidth: 260 }}>How alike<select value={min} onChange={(e) => setMin(Number(e.target.value))}><option value={0.95}>Almost identical</option><option value={0.85}>Very similar</option><option value={0.75}>Fairly similar</option></select></label>
      <Err>{err}</Err>{loading && !data ? <Loading /> : !data?.pairs.length ? <Empty>No duplicates at this level.</Empty> : <>{data.total > data.pairs.length && <p className="small muted">Showing {data.pairs.length} of {data.total}.</p>}
        {data.pairs.map((p) => <div className="ct-pair" key={p.a.id + p.b.id}><Q q={p.a} /><div><Q q={p.b} /><p style={{ margin: '6px 0 0' }}><Badge tone="warn">{Math.round(p.score * 100)}% alike</Badge> <button className="linkbtn" onClick={() => ignore(p)}>Not a duplicate</button></p></div></div>)}</>}
    </section>
  );
}

function Drafts() {
  const { data, err, loading, reload } = useLoad('/admin/drafts'); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState({});
  if (loading && !data) return <Loading />; if (err && !data) return <Err>{err}</Err>;
  const batch = async () => { setBusy(true); try { const r = await api.post('/admin/drafts/batch', { limit: 5 }); toast(`${r.drafted} drafted${r.failed.length ? `, ${r.failed.length} failed: ${r.failed[0].error}` : ''}`, r.failed.length ? 'bad' : 'good'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const approve = async (x) => { try { await api.post(`/admin/drafts/${x.questionId}/approve`, { edits: edit[x.questionId] ? { explanation: edit[x.questionId] } : {} }); toast('Solution saved to the question'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const reject = async (x) => { try { await api.post(`/admin/drafts/${x.questionId}/reject`); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <section className="card"><h3>AI-drafted solutions</h3>
        <p className="small muted">The AI solves each question on its own and writes a solution. Nothing reaches students until an editor approves it. If the AI picks a different answer from the key, the draft is blocked and the key should be checked.</p>
        {!data.available ? <div className="alert">AI drafts are not set up. Add ANTHROPIC_API_KEY to the server settings and restart.</div> : <p className="small">Model {data.model}. {data.usedToday} of {data.dailyCap} drafts used in the last 24 hours. Each draft is a paid API call.</p>}
        <p><b>{data.missing.count}</b> question{data.missing.count === 1 ? ' has' : 's have'} no solution yet.</p>
        {data.available && data.missing.count > 0 && <button className="btn btn-primary" disabled={busy} onClick={batch}>{busy ? 'Drafting…' : 'Draft 5 solutions'}</button>}
        {data.missing.sample.length > 0 && <ul className="small muted">{data.missing.sample.slice(0, 5).map((x) => <li key={x.id}>{x.text} <i>({x.mockName})</i></li>)}</ul>}
        <p className="small muted">You can also draft a single solution from a question’s edit screen.</p>
      </section>
      <section className="card" style={{ marginTop: 14 }}><h3>Waiting for approval ({data.pending.length})</h3>
        {!data.pending.length ? <Empty>No drafts waiting.</Empty> : data.pending.map((x) => (
          <div className="ct-draft" key={x.questionId}>
            <p><b>{x.text}</b></p><p className="small muted">{x.options.map((o, i) => `${'ABCD'[i]}) ${o}`).join('   ')} · key {'ABCD'[x.answer]} · {x.mockName}</p>
            {!x.agrees && <div className="alert" role="alert">The AI chose {x.aiAnswer == null ? 'no option' : `option ${'ABCD'[x.aiAnswer]}`}, but the key says {'ABCD'[x.answer]}. Check the key before using this. <Link to={`/admin/mocks/${x.mockId}?q=${x.questionId}`}>Open question</Link></div>}
            <label className="ad-field">Solution (you can edit it)<textarea rows={4} defaultValue={x.draft.explanation} onChange={(e) => setEdit({ ...edit, [x.questionId]: e.target.value })} disabled={!x.agrees} /></label>
            {x.draft.steps?.length > 0 && <pre>{x.draft.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}</pre>}
            <div className="ad-actions"><button className="btn btn-ghost btn-sm" onClick={() => reject(x)}>Discard</button><button className="btn btn-primary btn-sm" disabled={!x.agrees} onClick={() => approve(x)}>Approve and save</button></div>
          </div>))}
      </section>
    </>
  );
}

export default function Content() {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('ct-tab') || 'import'; } catch { return 'import'; } });
  useEffect(() => { try { sessionStorage.setItem('ct-tab', tab); } catch { /* optional */ } }, [tab]);
  const meta = useLoad('/admin/meta').data;
  return (
    <>
      <PageHead title="Content tools" sub="Bring in questions, clean up duplicates, and write solutions faster." />
      <div className="ct-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'import' && (meta ? <Import meta={meta} /> : <Loading />)}{tab === 'dupes' && <Dupes />}{tab === 'drafts' && <Drafts />}
    </>
  );
}
