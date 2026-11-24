import { Link } from 'react-router-dom';

const KIND = { skips: 'Skipped run', misses: 'Missed run', mixed: 'Skips and misses' };
const TONE = { panic: 'bad', rush: 'bad', fade: 'warn', streaks: 'warn', strong: 'good', steady: 'good' };

function Curve({ b }) {
  const W = 640, H = 220, L = 40, R = 14, T = 16, B = 38; const iw = W - L - R, ih = H - T - B; const n = b.length; const step = iw / n;
  const maxSec = Math.max(30, ...b.map((x) => x.avgSec)); const x = (i) => L + step * i + step / 2;
  const yA = (v) => T + ih - (v / 100) * ih; const yS = (v) => T + ih - (v / maxSec) * ih;
  const pts = b.map((k, i) => (k.accuracy == null ? null : [x(i), yA(k.accuracy)]));
  const path = pts.reduce((s, p) => (p ? `${s}${s && !s.endsWith('M') ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : s), '');
  const firstFinal = b.findIndex((k) => k.inFinal);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="st-svg" role="img" aria-label={`Accuracy and time per question across ${n} parts of the paper`}>
      {[0, 50, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={yA(v)} y2={yA(v)} className="st-grid" /><text x={L - 6} y={yA(v) + 4} textAnchor="end" className="st-ax">{v}%</text></g>)}
      {firstFinal >= 0 && <rect x={L + step * firstFinal} y={T} width={iw - step * firstFinal} height={ih} className="st-final"><title>Final stretch</title></rect>}
      {b.map((k, i) => <g key={i}>
        <rect x={x(i) - step * 0.28} y={yS(k.avgSec)} width={step * 0.56} height={Math.max(1, T + ih - yS(k.avgSec))} className="st-bar"><title>{`Q${k.fromQ}–${k.toQ}: ${k.avgSec}s per question`}</title></rect>
        <text x={x(i)} y={H - 20} textAnchor="middle" className="st-ax">{`Q${k.fromQ}`}</text><text x={x(i)} y={H - 7} textAnchor="middle" className="st-ax st-min">{`${k.fromMin}m`}</text>
      </g>)}
      <path d={path} className="st-line" />
      {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="4.5" className="st-dot"><title>{`Q${b[i].fromQ}–${b[i].toQ}: ${b[i].accuracy}% correct of ${b[i].attempted} attempted, ${b[i].skipped} skipped`}</title></circle>)}
    </svg>
  );
}

export default function StaminaCard({ s, attemptId }) {
  if (!s) return null;
  if (!s.available) return <div className="card st-card"><h3>Stamina curve</h3><p className="muted small">{s.reason || 'Not enough data for this attempt.'}</p></div>;
  const v = s.verdict;
  const cell = (label, a) => <div className="st-cell"><span className="muted small">{label}</span><b>{a.accuracy == null ? '–' : `${a.accuracy}%`}</b><span className="small muted">{a.attempted}/{a.total} attempted · {a.avgSec}s each</span></div>;
  return (
    <div className="card st-card">
      <h3>Stamina curve <small className="muted">first half against the last {s.windowMin} minutes</small></h3>
      <div className={`st-verdict t-${TONE[v.kind] || 'good'}`}><b>{v.title}</b><p>{v.text}</p></div>
      <div className="st-cells">{cell('First half', s.firstHalf)}{cell(`Last ${s.windowMin} min`, s.final)}</div>
      <Curve b={s.buckets} />
      <ul className="marks-legend st-leg"><li><i className="st-key-line" />Accuracy</li><li><i className="st-key-bar" />Seconds per question</li><li><i className="st-key-final" />Final stretch</li></ul>
      <h4>Panic streaks <small className="muted">3 or more skipped or wrong in a row</small></h4>
      {!s.streaks.length ? <p className="small">None. You never had three bad questions in a row.</p> : (
        <>
          <ul className="st-streaks">{s.streaks.map((k) => (
            <li key={k.fromQ} className={k.inFinal ? 'late' : ''}>
              <Link to={`/review/${attemptId}?qid=${k.qids[0]}`}><b>Q{k.fromQ}–{k.toQ}</b></Link>
              <span>{KIND[k.kind]} · {k.length} in a row · around minute {k.atMin}{k.rushed ? ' · answered very fast' : ''}{k.inFinal ? ' · in the final stretch' : ''}</span>
              <em>{k.marksLost} marks</em>
            </li>))}
          </ul>
          <p className="small muted">These runs cost about {s.streakMarksLost} marks in total (including negative marking).</p>
        </>
      )}
      {v.tips.length > 0 && <ul className="st-tips">{v.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      <p className="small muted">{s.note}</p>
    </div>
  );
}
