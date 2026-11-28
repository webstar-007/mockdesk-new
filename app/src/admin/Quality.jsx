import { useState } from 'react';
import { api } from '../lib/api.js';
import { Link } from 'react-router-dom';
import { Badge, Empty, Err, Loading, PageHead, Stat, mmss, toast, useLoad } from './ui.jsx';
import { refreshAlerts } from './AlertBell.jsx';
import { ProgressRing } from '../components/Motion.jsx';

const GRADE = { good: ['Good', 'good'], fair: ['Fair', 'warn'], poor: ['Poor', 'bad'] };
/** Score badge. Open it to see exactly where the points went. */
function ScoreBadge({ q }) {
  const [g, tone] = GRADE[q.grade];
  return (
    <details className="qs"><summary><span className={`qs-n t-${tone}`}>{q.score}</span><span className="small">{g}{q.early ? ' · early read' : ''}</span></summary>
      <div className="qs-pop"><b>Score {q.score} out of 100</b>{(q.scoreParts || []).length ? <ul>{q.scoreParts.map((x) => <li key={x.label}><span>{x.label}</span><b>−{x.pts}</b></li>)}</ul> : <p className="small muted">No problems found.</p>}
        <p className="small muted">{q.disc == null ? 'Not enough strong and weak students yet to measure how well it separates them.' : `Separation index ${q.disc >= 0 ? '+' : ''}${q.disc}. Above +0.30 is healthy.`}{q.early ? ' Based on fewer than 15 attempts, so it may still move.' : ''}</p></div></details>
  );
}

const FLAGS = [['any', 'Any flag'], ['nobody_right', 'Nobody got it right'], ['toppers_wrong', 'Toppers got it wrong'], ['wrong_key', 'Key may be wrong'], ['ambiguous', 'Ambiguous'], ['reported', 'Reported'], ['harder_than_tag', 'Harder than tag'], ['easier_than_tag', 'Easier than tag'], ['skipped', 'Often skipped'], ['slow', 'Slow'], ['no_explanation', 'No explanation']];
const SEV = ['mute', 'warn', 'warn', 'bad'];
// Suggested next step for a flagged question: fix the key, or swap it for a bank question.
function NextStep({ q, onDone, openTo }) {
  const [reps, setReps] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!q.suggest) return null;
  const replace = q.suggest === 'replace';
  const find = async () => { setBusy(true); setErr(''); try { setReps((await api.get(`/admin/quality/${q.id}/replacements`)).replacements); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const swap = async (id) => { if (!q.mockId) return; setBusy(true); setErr(''); try { const r = await api.post(`/admin/quality/${q.id}/replace`, { withId: id }); toast(r.message); refreshAlerts(); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const reviewed = async () => { setBusy(true); try { await api.post(`/admin/quality/${q.id}/reviewed`); toast('Marked as reviewed'); refreshAlerts(); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="sx-sug">
      <h4>{replace ? 'Suggested: replace this question' : 'Suggested: check the answer key'}</h4>
      <p className="small muted" style={{ margin: '0 0 8px' }}>{replace ? 'It is not working as a question. Fix it if the key is wrong, or swap in one from the bank.' : 'Read the question and key again. If the key is right, mark it reviewed.'}</p>
      <div className="ad-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn btn-ghost btn-sm" to={openTo}>Open to fix</Link>
        {q.mockId && q.mockId !== 'pool' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={find}>{reps ? 'Look again' : 'Find replacements'}</button>}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={reviewed}>Mark reviewed</button>
      </div>
      <Err>{err}</Err>
      {reps && (reps.length ? <ul style={{ marginTop: 8 }}>{reps.map((x) => <li key={x.id}><span>{x.text}<br /><small className="muted">{x.topic} · {x.difficulty}{x.sameTopic ? ' · same topic' : ''}</small></span><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => swap(x.id)}>Use this</button></li>)}</ul>
        : <p className="small muted" style={{ marginBottom: 0 }}>The question bank has no unused question in this section. Add some under <Link to="/admin/bank">Question bank</Link>.</p>)}
    </div>
  );
}

export default function Quality() {
  const [flag, setFlag] = useState('any'); const [mock, setMock] = useState(''); const [min, setMin] = useState(5); const [section, setSection] = useState(''); const [shown, setShown] = useState(30); const [grade, setGrade] = useState(''); const [sort, setSort] = useState('worst');
  const { data, err, loading, reload } = useLoad(`/admin/quality?flag=${flag === 'all' ? '' : flag}&mock=${mock}&min=${min}&section=${section}&grade=${grade}&sort=${sort}`, [flag, mock, min, section, grade, sort]);
  const open = (q) => (q.mockId ? `/admin/mocks/${q.mockId}?q=${q.id}` : '/admin/bank');
  return (
    <>
      <PageHead title="Question quality" sub="How each question performed with real students, and which ones may be wrong or unclear." />
      <Err>{err}</Err>
      {data && <div className="ad-grid g4" style={{ marginBottom: 14 }}><Stat label="Questions measured" value={data.total} sub={`at least ${data.minAttempts} attempts`} icon="📊" /><Stat label="Need a look" value={data.flagged} tone={data.flagged ? 'warn' : ''} icon="🚩" /><Stat label="Key may be wrong" value={data.counts.wrong_key || 0} tone={data.counts.wrong_key ? 'bad' : ''} icon="⚠" /><Stat label="Ambiguous" value={data.counts.ambiguous || 0} icon="❔" /></div>}
      {data && data.total > 0 && (
        <section className="card qs-sum" aria-label="Quality scores">
          <div className="qs-ring"><ProgressRing done={data.avgScore} total={100} size={84} tone={data.avgScore >= 80 ? 'good' : data.avgScore >= 60 ? 'mid' : 'low'} label={`Average score ${data.avgScore} out of 100`} /><div><b>Average question score</b><small className="muted">Out of 100, across {data.total} questions</small></div></div>
          <div className="qs-grades" role="group" aria-label="Filter by grade">{['good', 'fair', 'poor'].map((k) => <button key={k} type="button" className={`${grade === k ? 'on' : ''} t-${GRADE[k][1]}`} aria-pressed={grade === k} onClick={() => setGrade(grade === k ? '' : k)}><b>{data.grades[k]}</b><span>{GRADE[k][0]}</span><i style={{ '--w': `${Math.round((data.grades[k] / data.total) * 100)}%` }} /></button>)}</div>
          <div className="qs-mocks"><b className="small">By mock</b>{data.mockScores.slice(0, 5).map((m) => <button key={m.id} type="button" className={mock === m.id ? 'on' : ''} onClick={() => setMock(mock === m.id ? '' : m.id)}><span>{m.name}</span><i className={m.score >= 80 ? 'good' : m.score >= 60 ? 'warn' : 'bad'} style={{ '--w': `${m.score}%` }} /><b>{m.score}</b></button>)}</div>
        </section>)}
      <div className="card qa-filters">
        <div className="ad-pill-row">{[['all', 'All'], ...FLAGS].map(([k, n]) => <button key={k} className={`ad-pill ${flag === k ? 'on' : ''}`} onClick={() => setFlag(k)}>{n}{k !== 'all' && k !== 'any' && data?.counts[k] ? ` (${data.counts[k]})` : ''}</button>)}</div>
        <div className="ad-row">
          <label className="ad-field">Mock<select value={mock} onChange={(e) => setMock(e.target.value)}><option value="">All mocks</option>{(data?.mocks || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label className="ad-field">Section<select value={section} onChange={(e) => setSection(e.target.value)}><option value="">All sections</option>{['maths', 'reasoning', 'english', 'ga'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label className="ad-field">Sort by<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="worst">Most urgent</option><option value="score">Lowest score</option><option value="best">Highest score</option></select></label>
          <label className="ad-field">At least this many attempts<input type="number" min="1" max="200" value={min} onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))} /></label>
        </div>
      </div>
      {loading && !data ? <Loading /> : !data?.questions.length ? <div className="card" style={{ marginTop: 14 }}><Empty>{data?.total ? 'No questions match these filters.' : 'No question has enough attempts yet. This fills in as students finish mocks.'}</Empty></div> : (
        <div className="qa-list">{data.questions.slice(0, shown).map((q) => (
          <article className="card qa-item" key={q.id}>
            <div className="qa-top"><span className="qa-meta">{q.mockName} · {q.section} · {q.topic} · <i className={`diff d-${q.difficulty}`}>{q.difficulty}</i></span><ScoreBadge q={q} /><Link className="btn btn-ghost btn-sm" to={open(q)}>Open to fix</Link></div>
            <p className="qa-text">{q.text}</p>
            <div className="qa-nums"><span><b className={q.pctRight < 25 ? 'c-bad' : ''}>{q.pctRight}%</b> right</span><span><b>{q.pctWrong}%</b> wrong</span><span><b>{q.pctSkipped}%</b> skipped</span><span><b>{mmss(q.avgTimeSec)}</b> average time{q.sectionAvgSec ? <small className="muted"> (section {mmss(q.sectionAvgSec)})</small> : ''}</span><span className="muted">{q.attempts} attempts{q.reports ? ` · ${q.reports} report${q.reports > 1 ? 's' : ''}` : ''}</span></div>
            <div className="qa-opts" role="img" aria-label={q.options.map((v, i) => `Option ${'ABCD'[i]} ${v}%${i === q.keyIndex ? ' (key)' : ''}`).join(', ')}>{q.options.map((v, i) => <div key={i} className={i === q.keyIndex ? 'key' : ''}><i style={{ width: `${Math.max(2, v)}%` }} /><span>{'ABCD'[i]} {v}%{i === q.keyIndex ? ' · key' : ''}</span></div>)}</div>
            {q.flags.length > 0 && <ul className="qa-flags">{q.flags.map((f) => <li key={f.key}><Badge tone={SEV[f.severity]}>{f.label}</Badge> <span className="small">{f.detail}</span></li>)}</ul>}
            <NextStep q={q} onDone={reload} openTo={open(q)} />
          </article>))}
          {data.questions.length > shown && <button className="btn btn-ghost" onClick={() => setShown(shown + 30)}>Show more ({data.questions.length - shown} left)</button>}
        </div>)}
    </>
  );
}
