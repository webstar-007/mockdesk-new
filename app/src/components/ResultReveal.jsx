import { useMemo } from 'react';
import { reduced } from '../lib/motion.js';

// Ring that fills to the score percentage once, right after the page opens.
export function ScoreRing({ pct = 0 }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0)); const tone = v >= 70 ? 'good' : v >= 40 ? 'mid' : 'low';
  return (
    <svg className={`rr-ring ${tone}`} viewBox="0 0 120 120" role="img" aria-label={`${v} percent`}>
      <circle className="rr-bg" cx="60" cy="60" r="52" /><circle className="rr-fg" cx="60" cy="60" r="52" pathLength="100" style={{ '--to': v }} />
    </svg>
  );
}

// A short shower of confetti for a better score than last time. Plays once and never blocks taps.
export function Burst() {
  const bits = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ x: Math.round((Math.random() - 0.5) * 360), y: -Math.round(60 + Math.random() * 120), r: Math.round(Math.random() * 540), d: Math.round(Math.random() * 250), c: i % 4 })), []);
  if (reduced()) return null;
  return <div className="rr-burst" aria-hidden="true">{bits.map((b, i) => <i key={i} className={`c${b.c}`} style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--r': `${b.r}deg`, animationDelay: `${900 + b.d}ms` }} />)}</div>;
}
