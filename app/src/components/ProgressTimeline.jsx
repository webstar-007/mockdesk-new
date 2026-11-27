import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, duration } from '../lib/format.js';
import { Spark } from './Motion.jsx';

/** Your finished mocks in order, with a small card for each. Tap or hover a dot to see how it went. */
export default function ProgressTimeline({ hist, maxMarks }) {
  const list = [...hist].sort((a, b) => a.submittedAt - b.submittedAt).slice(-12); const [at, setAt] = useState(list.length - 1);
  if (list.length < 1) return null;
  const pct = (h) => Math.round((h.score / (h.maxMarks || maxMarks || 1)) * 100); const cur = list[Math.min(at, list.length - 1)]; const prev = list[at - 1];
  const d = prev ? cur.score - prev.score : null; const best = Math.max(...list.map((h) => h.score));
  return (
    <section className="nd-card ptl" aria-label="Your progress timeline">
      <div className="nd-sec-h"><h2>Your journey</h2>{list.length > 2 && <span className="ptl-sp"><Spark data={list.map((h) => h.score)} width={96} height={30} label="Score trend" /></span>}</div>
      <ol className="ptl-line" style={{ '--n': list.length }}>
        {list.map((h, i) => (
          <li key={h.id} className={`${i === at ? 'on' : ''} ${i <= at ? 'past' : ''} ${h.score === best ? 'best' : ''}`} style={{ '--i': i }}>
            <button type="button" onClick={() => setAt(i)} onMouseEnter={() => setAt(i)} onFocus={() => setAt(i)} aria-label={`${h.mockName}, ${h.score} of ${h.maxMarks}${h.score === best ? ', your best' : ''}`} aria-current={i === at ? 'true' : undefined}><span>{pct(h)}</span></button>
            <small>{fmtDate(h.submittedAt).replace(/ \d{4}$/, '')}</small>
          </li>))}
      </ol>
      <div className="ptl-card" key={cur.id} role="status">
        <div><b>{cur.mockName.replace('CGL Tier-II ', '')}</b><small>{fmtDate(cur.submittedAt)}</small></div>
        <dl><div><dt>Score</dt><dd>{cur.score}<small>/{cur.maxMarks}</small></dd></div><div><dt>Accuracy</dt><dd>{cur.accuracy}%</dd></div>{cur.timeTakenSec != null && <div><dt>Time</dt><dd>{duration(cur.timeTakenSec)}</dd></div>}{d != null && <div><dt>Change</dt><dd className={d >= 0 ? 'c-good' : 'c-bad'}>{d >= 0 ? '▲ +' : '▼ −'}{Math.abs(d)}</dd></div>}</dl>
        <Link className="btn btn-ghost btn-sm" to={`/results/${cur.id}`}>Open analysis</Link>
      </div>
    </section>
  );
}
