import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { duration, fmtDate, fmtDateTime, num } from '../lib/format.js';
import { EXAMS } from '../lib/exams.js';
import { tip } from '../components/Tip.jsx';
import PdfMenu from '../components/PdfMenu.jsx';
import Blueprint from '../components/Blueprint.jsx';
import PracticeCard from '../components/PracticeCard.jsx';
import { CardsSkeleton, CountUp, Spark } from '../components/Motion.jsx';
import { BlockBoard } from '../components/Blocks.jsx';
import ProgressTimeline from '../components/ProgressTimeline.jsx';
import { ActivityMap, LockedInsights, ToolTiles, ReadinessGauge, SkillRadar, StudyPlanner, Trajectory, readinessOf } from '../components/Insights.jsx';

const DASH_BLOCKS = [['asg', 'Set by your teacher'], ['next', 'Next step and snapshot'], ['mocks', 'Your mocks and focus'], ['practice', 'Practice and recent results'], ['journey', 'Your journey'], ['analysis', 'Guides and detailed analysis'], ['tools', 'Toolkit']];
const STATUS = { not_attempted: ['Not attempted', 'st-none'], in_progress: ['In progress', 'st-prog'], completed: ['Completed', 'st-done'] };
export default function Dashboard() {
  const { user, config } = useAuth();
  const nav = useNavigate();
  const exams = config?.exams?.length ? config.exams : EXAMS; const [examPick, setExam] = useState(null); const exam = examPick && exams.some((x) => x.id === examPick) ? examPick : exams[0].id; const [filter, setFilter] = useState('all'); const [allMocks, setMocks] = useState(null); const [stats, setStats] = useState(null); const [hist, setHist] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  useEffect(() => {
    Promise.all([api.get('/mocks'), api.get('/stats'), api.get('/attempts')])
      .then(([m, s, h]) => { setMocks(m.mocks); setStats(s); setHist(h.attempts.filter((a) => a.status === 'submitted')); })
      .catch((e) => setErr(e.message));
  }, []);
  const [asg, setAsg] = useState([]);
  useEffect(() => { api.get('/my/assignments').then((d) => setAsg(d.items || [])).catch(() => {}); }, []);
  const start = async (m) => {
    if (m.locked) return nav('/profile#invite');
    if (m.status === 'in_progress') return nav(`/exam/${m.inProgressAttemptId}`);
    nav(`/mock/${m.id}`);
  };
  if (err) return <div className="alert" role="alert">{err}</div>;
  if (!allMocks) return <CardsSkeleton kind="dash" />;
  const mocks = allMocks.filter((m) => (m.examId || 'ssc-cgl-t2') === exam);
  const pat = config?.patterns?.[exam]; const bpConfig = pat ? { ...config, sections: pat.sections, segments: pat.segments } : config;
  const gap = user?.targetScore && stats?.bestScore != null ? user.targetScore - stats.bestScore : null;
  const first = user.name.split(' ')[0];
  const daysLeft = user.examDate ? Math.ceil((new Date(user.examDate + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000) : null;
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const done = mocks.filter((m) => m.status === 'completed').length;
  const inProg = mocks.find((m) => m.status === 'in_progress');
  const open_ = mocks.filter((m) => !m.locked && !m.upcoming && m.live?.state !== 'closed');
  const nextMock = inProg || open_.find((m) => m.status === 'not_attempted') || open_.slice().sort((x, y) => (x.best?.percentage ?? 0) - (y.best?.percentage ?? 0))[0];
  const lastDone = hist[0];
  const totalQs = mocks.reduce((a, m) => a + m.totalQuestions + (m.qualifying || []).reduce((b, x) => b + x.questions, 0), 0);
  const counts = { all: mocks.length, live: mocks.filter((m) => m.live).length, pyq: mocks.filter((m) => m.kind === 'pyq').length, not_attempted: mocks.filter((m) => m.status === 'not_attempted').length, in_progress: mocks.filter((m) => m.status === 'in_progress').length, completed: done };
  const shown = mocks.filter((m) => filter === 'all' || (filter === 'live' ? !!m.live : filter === 'pyq' ? m.kind === 'pyq' : m.status === filter));
  const examName = exams.find((x) => x.id === exam)?.name;
  const maxMarks = pat?.scoredMarks || config?.scoredMarks || 390;
  const primary = exam === exams[0].id; const mine = mocks.filter((m) => m.best); const kBest = mine.length ? Math.max(...mine.map((m) => m.best.score)) : null; const kAvg = mine.length ? mine.reduce((a, m) => a + m.best.percentage, 0) / mine.length : null;
  const examHist = hist.filter((h) => mocks.some((m) => m.id === h.mockId));
  const readiness = stats?.completed && primary ? readinessOf({ stats, mocksTotal: mocks.length, target: user.targetScore, maxMarks }) : null;
  const secs = Object.entries(config?.sections || {});
  const minsOf = (k) => config?.segments?.find((sg) => sg.sections.includes(k))?.minutes;
  const targetPct = user?.targetScore && stats?.bestScore != null ? Math.min(100, Math.round((stats.bestScore / user.targetScore) * 100)) : null;
  const ring = (pct, label, sub) => (
    <div className="hm-ring" role="img" aria-label={`${label}: ${sub}`}>
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="hm-ring-bg" cx="18" cy="18" r="15.9" /><circle className="hm-ring-fg" cx="18" cy="18" r="15.9" strokeDasharray={`${pct} 100`} style={pct ? undefined : { opacity: 0 }} /></svg>
      <b>{sub}</b><span>{label}</span>
    </div>
  );
  const pSecs = Object.values(pat?.sections || config?.sections || {}); const sc = pSecs.find((x) => !x.qualifying) || { marksPerQuestion: 3, negativeMarks: 1 }; const qs = pSecs.find((x) => x.qualifying);
  const tips = [
    ['Start with your strongest section', pat && pat.segments.length > 1 ? 'Sections are timed and locked one after another, so bank the sure marks first.' : 'Spend the first pass on the questions you are sure about, then come back for the rest.'],
    [`Every wrong answer costs ${sc.negativeMarks} mark${sc.negativeMarks === 1 ? '' : 's'}`, `Each question is worth ${sc.marksPerQuestion} marks, so skip a question when you cannot cut at least two options.`],
    qs ? ['Computer is qualifying only', `You need ${qs.qualifyingMarks} of ${qs.questions * qs.marksPerQuestion} to qualify and its marks are not added to your total.`] : ['Keep an eye on the clock', 'Aim to finish a first pass with a few minutes spare, then revisit the questions you marked.'],
    ['Review every mock within a day', 'Read the “Common mistake” note even on questions you got right.'],
  ];
  const bestOf = (m) => (m.best ? Math.round(m.best.percentage) : null);
  const mockAction = (m) => (m.upcoming ? 'Not open yet' : m.locked ? 'Invite to unlock' : m.status === 'in_progress' ? 'Resume' : m.status === 'completed' ? 'Retake' : 'Start');
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const actDays = new Set((stats?.activity || []).map(dayKey));
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return { on: actDays.has(dayKey(d)), l: d.toLocaleDateString(undefined, { weekday: 'narrow' }), today: i === 6 }; });
  let streak = 0; { const p = new Date(); p.setHours(0, 0, 0, 0); if (!actDays.has(dayKey(p))) p.setDate(p.getDate() - 1); while (actDays.has(dayKey(p))) { streak++; p.setDate(p.getDate() - 1); } }
  const R = 42, C = 2 * Math.PI * R; const ringPct = mocks.length ? Math.round((done / mocks.length) * 100) : 0;
  const hasData = primary && stats?.completed > 0; const weak = hasData ? (stats.weakTopics || []).slice(0, 3) : [];
  const glance = Object.entries(pat?.sections || config?.sections || {});
  const segMin = (k) => (pat?.segments || config?.segments || []).find((g) => g.sections.includes(k))?.minutes;
  const pathList = mocks.slice(0, 12);
  const statusOf = (m) => (m.status === 'completed' ? 'done' : m.status === 'in_progress' ? 'prog' : m.locked || m.upcoming ? 'lock' : 'todo');
  const NODES = {
    asg: asg.length > 0 ? (<section className="nd-asg" aria-label="Set by your teacher">
          <h2>Set by your teacher</h2>
          <ul>{asg.map((a) => {
            const d = new Date(a.dueAt);
            return (
              <li key={a.id} className={a.done ? 'done' : a.overdue ? 'late' : ''}>
                <div><b>{a.title}</b><span>{a.batch}{a.teacher ? ` · ${a.teacher}` : ''}{a.note ? ` · ${a.note}` : ''}</span></div>
                <span className="nd-asg-due">{a.done ? (a.late ? 'Done, late' : 'Done') : `${a.overdue ? 'Was due' : 'Due'} ${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}</span>
                {!a.done && <Link className="btn btn-sm" to={a.link}>{a.kind === 'practice' ? `Practice (${a.sets}/${a.setsNeeded})` : a.started ? 'Continue' : 'Start'}</Link>}
              </li>
            );
          })}</ul>
        </section>) : null,
    next: (<div className="nd-r1">
        <section className="nd-hero" aria-label="Your next step">
          <div className="nd-hero-top">
            {nextMock ? <>
              <span className="nd-eyebrow">{inProg ? 'Continue where you stopped' : done ? 'Up next' : 'Start here'}</span>
              <h2>{nextMock.name.replace('CGL Tier-II ', '')}</h2>
              <ul className="nd-chips"><li>{nextMock.totalQuestions + (nextMock.qualifying || []).reduce((b, x) => b + x.questions, 0)} questions</li><li>{nextMock.totalMarks} marks</li><li>{nextMock.totalMinutes} minutes</li><li className="cap">{nextMock.difficulty}</li></ul>
              <div className="nd-hero-cta"><button onClick={() => start(nextMock)}>{inProg ? 'Resume test' : done ? 'Start next mock' : 'Start first mock'}</button>{lastDone && <Link to={`/results/${lastDone.id}`}>See last analysis</Link>}</div>
            </> : <>
              <span className="nd-eyebrow">{mocks.length ? 'All caught up' : 'Coming soon'}</span>
              <h2>{mocks.length ? 'You have finished every open mock' : `No ${examName} mocks yet`}</h2>
              <p className="nd-hero-facts">{mocks.length ? 'Review your mistakes while new papers are added.' : 'Check back soon.'}</p>
              {lastDone && <div className="nd-hero-cta"><Link to={`/results/${lastDone.id}`}>See last analysis</Link></div>}
            </>}
          </div>
          {mocks.length > 0 && <div className="nd-path"><p>Your path · {done} of {mocks.length} done</p>
            {mocks.length <= 12 ? <ol aria-label="Mocks in order">{pathList.map((m, i) => <li key={m.id} className={`${statusOf(m)} ${m.id === nextMock?.id ? 'now' : ''}`}><i>{statusOf(m) === 'done' ? '✓' : i + 1}</i></li>)}</ol>
              : <div className="nd-pbar"><u style={{ width: `${ringPct}%` }} /></div>}</div>}
        </section>

        {hasData ? (
          <section className="nd-card nd-snap" aria-label="Your snapshot">
            <div className="nd-snap-h">
              <div className="nd-gauge" role="img" aria-label={`Readiness ${readiness.value} out of 100, ${readiness.band}`}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r={R} className="bg" /><circle cx="50" cy="50" r={R} className="fg" strokeDasharray={`${(readiness.value / 100) * C} ${C}`} transform="rotate(-90 50 50)" /></svg><b>{readiness.value}</b></div>
              <div><span className="nd-k">Exam readiness</span><strong>{readiness.band}</strong></div>{examHist.length > 2 && <Spark className="nd-spark" data={[...examHist].reverse().map((h) => h.score)} width={80} height={30} label="Your recent scores" />}
            </div>
            <dl className="nd-kv">
              <div><dt>Best score</dt><dd><CountUp value={kBest} /><small>/{maxMarks}</small></dd></div>
              <div><dt>Average</dt><dd><CountUp value={`${num(kAvg)}%`} /></dd></div>
              <div><dt>Accuracy</dt><dd><CountUp value={`${num(stats.avgAccuracy)}%`} /></dd></div>
              <div><dt>{targetPct != null ? 'Of target' : 'Mocks done'}</dt><dd>{targetPct != null ? `${targetPct}%` : `${done}/${mocks.length}`}</dd></div>
            </dl>
          </section>
        ) : (
          <section className="nd-card nd-how" aria-label="How it works"><h3>How it works</h3>
            <ol><li><b>Take a full mock</b><span>Real exam timing and sectional locks.</span></li><li><b>Get your analysis</b><span>Scores, accuracy and weak topics.</span></li><li><b>Practise and improve</b><span>Targeted sets built from your mistakes.</span></li></ol></section>
        )}
      </div>),
    mocks: (<div className="nd-r2">
        <section className="nd-card nd-mocks-box" aria-label="Your mocks">
          <div className="nd-sec-h"><h2>Your mocks</h2>
            <div className="nd-seg sm" role="group" aria-label="Filter mocks">
              {[['all', 'All'], ['not_attempted', 'New'], ['in_progress', 'Started'], ['completed', 'Done'], ...(counts.live ? [['live', 'Live']] : []), ...(counts.pyq ? [['pyq', 'Past papers']] : [])].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div></div>
          {shown.length === 0 && <p className="nd-empty">{mocks.length === 0 ? `No ${examName} mocks have been published yet. Check back soon.` : 'Nothing in this view yet.'}</p>}
          <ul className="nd-list">
            {shown.map((m) => {
              const i = mocks.indexOf(m); const [label, cls] = STATUS[m.status]; const b = bestOf(m); const lvl = { easy: 1, moderate: 2, hard: 3 }[m.difficulty] || 2;
              return (
                <li key={m.id} className={`nd-item d${lvl} ${m.id === nextMock?.id ? 'is-next' : ''} ${m.locked ? 'is-locked' : ''}`}>
                  <span className="nd-n" aria-hidden="true">{i + 1}</span>
                  <div className="nd-info">
                    <h3>{m.name.replace('CGL Tier-II ', '')}{m.kind === 'pyq' && <em>Past paper{m.paperYear ? ` ${m.paperYear}` : ''}</em>}{m.live && <em className="live">Live</em>}{m.locked && <em>Locked</em>}</h3>
                    <p>{m.totalMinutes} min · {m.totalQuestions + (m.qualifying || []).reduce((x, y) => x + y.questions, 0)} Qs · {m.totalMarks} marks · <span className="cap">{m.difficulty}</span></p>
                    {m.live && <p className="nd-live">{m.live.state === 'upcoming' ? `Opens ${fmtDateTime(m.live.opensAt)}` : m.live.state === 'open' ? `Open until ${fmtDateTime(m.live.closesAt)}. First finished attempt counts for rank.` : (m.live.rank ? `You ranked #${m.live.rank} of ${m.live.of}` : 'Window closed. Ranks are final.')}</p>}
                  </div>
                  <div className="nd-sc">{b != null ? <><b>{m.best.score}<small>/{m.totalMarks}</small></b><i aria-hidden="true"><u style={{ width: `${Math.min(100, b)}%` }} /></i></> : <span className={`status ${cls}`}>{m.id === nextMock?.id && m.status === 'not_attempted' ? 'Up next' : label}</span>}</div>
                  <div className="nd-act">
                    <button className={m.status === 'completed' ? 'ghost' : 'pri'} disabled={busy === m.id || m.upcoming} onClick={() => start(m)}>{mockAction(m)}</button>
                    {m.last && <Link to={`/results/${m.last.attemptId}`}>Result</Link>}{m.live && <Link to={`/live/${m.id}`}>{m.live.state === 'closed' ? 'Leaderboard' : 'Details'}</Link>}
                  </div>
                </li>);
            })}
          </ul>
        </section>

        <aside className="nd-side" aria-label="Focus and activity">
          {hasData ? <>
            {weak.length > 0 && <section className="nd-card"><h3>Focus on these</h3>
              <ul className="nd-weak">{weak.map((t) => <li key={t.topic + t.section}><div><span>{t.topic}<small>{config?.sections[t.section]?.short}</small></span><b>{t.accuracy}%</b></div><i><u style={{ width: `${t.accuracy}%` }} /></i></li>)}</ul>
              {lastDone && <Link className="nd-more" to={`/review/${lastDone.id}?filter=incorrect`}>Review last mock’s mistakes →</Link>}</section>}
            <section className="nd-card"><h3>This week</h3>
              <div className="nd-week"><div className="nd-streak"><b>{streak}</b><span>day streak</span></div>
                <ol aria-label="Last 7 days">{week.map((d, i) => <li key={i} className={`${d.on ? 'on' : ''} ${d.today ? 'today' : ''}`}><i /><span>{d.l}</span></li>)}</ol></div></section>
          </> : glance.length > 0 && <section className="nd-card nd-glance"><h3>The paper at a glance</h3>
            <ul>{glance.map(([k, c]) => <li key={k}><span>{c.short}{c.qualifying && <em>Qualifying</em>}</span><b>{c.questions} Qs</b><small>{segMin(k) ? `${segMin(k)} min` : ''}</small></li>)}</ul>
            <p>+{sc.marksPerQuestion} for each correct answer, −{sc.negativeMarks} for each wrong one.</p></section>}
        </aside>
      </div>),
    practice: (<div className={`nd-r3 ${examHist.length > 0 ? '' : 'solo'}`}>
        <div className="nd-practice"><PracticeCard /></div>
        {examHist.length > 0 && <section className="nd-card nd-recent"><div className="nd-sec-h"><h3>Recent results</h3></div>
          <ul>{examHist.slice(0, 4).map((h) => <li key={h.id}><div><b>{h.mockName.replace('CGL Tier-II ', '')}</b><small>{fmtDate(h.submittedAt)} · {h.accuracy}% accuracy</small></div><span>{h.score}<small>/{h.maxMarks}</small></span><Link to={`/results/${h.id}`}>Analysis</Link></li>)}</ul></section>}
      </div>),
    journey: examHist.length > 0 ? <ProgressTimeline hist={examHist} maxMarks={maxMarks} /> : null,
    analysis: (<div className="nd-r4">
        {hasData && <details className="nd-details"><summary><span>Detailed analysis</span><small>Skills, study plan, trend, activity, history</small></summary>
          <div className="ix-grid">
            <ReadinessGauge r={readiness} /><SkillRadar sections={stats.sections} />
            <div className="ix-plan"><StudyPlanner stats={stats} nextMock={nextMock} mocksLeft={mocks.filter((m) => m.status === 'not_attempted').length} daysLeft={daysLeft} lastId={lastDone?.id} sectionName={config?.sections[stats.weakest]?.short} /></div>
            <Trajectory trend={stats.trend} target={user.targetScore} maxMarks={maxMarks} />
            <div className="ix-full"><ActivityMap stamps={stats.activity} /></div>
            {examHist.length > 0 && <div className="ix-full"><h3>Attempt history</h3><div className="tbl-wrap card nopad"><table className="dtable hist">
              <thead><tr><th>Test</th><th>Date</th><th>Score</th><th>Accuracy</th><th>Computer</th><th>Time</th><th /></tr></thead>
              <tbody>{examHist.map((h) => <tr key={h.id}><th scope="row">{h.mockName}</th><td>{fmtDate(h.submittedAt)}</td><td>{h.score}/{h.maxMarks}</td><td>{h.accuracy}%</td><td>{h.qualified === null || h.qualified === undefined ? '–' : <span className={`qchip ${h.qualified ? 'q-pass' : 'q-fail'}`}>{h.qualified ? 'Qualified' : 'Not qualified'}</span>}</td><td>{duration(h.timeTakenSec)}</td><td><Link to={`/results/${h.id}`}>Analysis</Link> · <Link to={`/review/${h.id}`}>Review</Link> · <PdfMenu id={h.id} compact /></td></tr>)}</tbody>
            </table></div></div>}
          </div></details>}
        <details className="nd-details"><summary><span>Exam guide</span><small>Paper pattern, marking and exam-day tips</small></summary>
          <div className="nd-guide"><Blueprint config={bpConfig} examName={examName} />
            <div className="hm-tip-grid">{tips.map(([t, d], i) => <div className="hm-tip" key={t}><b aria-hidden="true">{['①', '②', '③', '④'][i]}</b><div><h4>{t}</h4><p>{d}</p></div></div>)}</div></div></details>
      </div>),
    tools: stats?.completed ? <ToolTiles /> : null,
  };
  return (
    <div className="nd">
      <header className="nd-top">
        <div><h1>{greet}, {first}</h1>
          <p>{daysLeft != null && daysLeft >= 0 ? (daysLeft === 0 ? 'Your exam is today. Good luck!' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} to your exam`) : done ? `${done} of ${mocks.length} mocks done` : 'Let’s set your baseline with a first mock'}</p></div>
        {exams.length > 1 && <div className="nd-seg" role="group" aria-label="Choose exam">{exams.map((x) => <button key={x.id} className={exam === x.id ? 'on' : ''} aria-pressed={exam === x.id} onClick={() => { setExam(x.id); setFilter('all'); }}>{x.name}</button>)}</div>}
      </header>
      <BlockBoard uid={user.id} ids={DASH_BLOCKS} nodes={NODES} />
    </div>
  );
}
