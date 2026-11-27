import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { busy, reduced } from '../lib/motion.js';

// The logo tick draws itself: used wherever the app is waiting.
export function TickLoader({ size = 44, label = 'Loading' }) {
  return (
    <span className="tk-load" role="status" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs><linearGradient id="tkg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--brand-2)" /><stop offset="1" stopColor="var(--brand)" /></linearGradient></defs>
        <rect className="tk-box" x="5" y="5" width="38" height="38" rx="11" pathLength="100" />
        <path className="tk-check" d="M15 25.5l6.5 6.5L33.5 17" pathLength="100" />
      </svg>
    </span>
  );
}

// Full-area loader for page boot and lazy routes. Waits a moment so quick loads never flash.
export function BootLoader({ text = 'Loading' }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 120); return () => clearTimeout(t); }, []);
  return <div className="center-page tk-boot" role="status">{show && <><TickLoader size={56} label={text} /><p className="muted tk-cap">{text}</p></>}</div>;
}

// Skeleton placeholder shaped like an admin page: stat tiles and a table. Appears only if loading takes over 150 ms.
export function PageSkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 150); return () => clearTimeout(t); }, []);
  if (!show) return <div style={{ minHeight: 240 }} role="status" aria-label="Loading" />;
  return (
    <div className="sk-page" role="status" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk-row">{[0, 1, 2, 3].map((i) => <div key={i} className="sk sk-tile" style={{ '--i': i }} />)}</div>
      <div className="sk-card">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="sk sk-line" style={{ '--i': i, width: `${96 - i * 9}%` }} />)}</div>
    </div>
  );
}

// Thin progress line at the very top: follows real requests and route changes.
export function TopProgress() {
  const [w, setW] = useState(0); const [on, setOn] = useState(false); const loc = useLocation(); const timer = useRef(0); const first = useRef(true); const live = useRef(false);
  const start = () => { clearInterval(timer.current); clearTimeout(timer.current); live.current = true; setOn(true); setW(8); timer.current = setInterval(() => setW((x) => x + (92 - x) * 0.12), 180); };
  const finish = () => { clearInterval(timer.current); clearTimeout(timer.current); live.current = false; setW(100); timer.current = setTimeout(() => { setOn(false); setW(0); }, 260); };
  useEffect(() => busy.sub((c) => { if (c > 0) { if (!live.current) start(); } else if (live.current) finish(); }), []); // eslint-disable-line
  useEffect(() => { if (first.current) { first.current = false; return; } if (reduced()) return; start(); const t = setTimeout(() => { if (!busy.count) finish(); }, 350); return () => clearTimeout(t); }, [loc.pathname]); // eslint-disable-line
  return <div className={`tp ${on ? 'on' : ''}`} aria-hidden="true"><i style={{ width: `${w}%` }} /></div>;
}

// Remounts its children on route change so the new page eases in.
export function PageIn({ children }) { const { pathname } = useLocation(); return <div key={pathname} className="page-in">{children}</div>; }

// Numbers count up to their value. Handles "1,234", "87%", "12.5 ms".
export function CountUp({ value }) {
  const m = typeof value === 'number' ? [value, '', String(value)] : typeof value === 'string' ? value.match(/^(-?\d[\d,]*\.?\d*)(.*)$/) : null;
  const target = m ? parseFloat(String(m[1]).replace(/,/g, '')) : NaN; const raw = m ? String(m[1]) : '';
  const [v, setV] = useState(Number.isFinite(target) ? 0 : target); const prev = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return undefined; if (reduced() || Math.abs(target) > 1e9) { setV(target); return undefined; }
    const from = prev.current; const t0 = performance.now(); const dur = 650; let raf;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - (1 - k) ** 3; setV(from + (target - from) * e); if (k < 1) raf = requestAnimationFrame(step); else prev.current = target; };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [target]);
  if (!Number.isFinite(target)) return value;
  const dec = (raw.split('.')[1] || '').length; const comma = raw.includes(',');
  const txt = v.toLocaleString(comma ? 'en-IN' : 'en-US', { useGrouping: comma, minimumFractionDigits: dec, maximumFractionDigits: dec });
  return <>{txt}{typeof value === 'string' ? m[2] : ''}</>;
}

// Tiny line chart that draws itself. data = array of numbers. Decorative unless label is given.
export function Spark({ data, width = 84, height = 28, className = '', label, color = 'currentColor' }) {
  const d = (data || []).filter((x) => Number.isFinite(x)); if (d.length < 2) return null;
  const mn = Math.min(...d), mx = Math.max(...d), span = mx - mn || 1, pad = 3;
  const pts = d.map((v, i) => [pad + (i * (width - pad * 2)) / (d.length - 1), height - pad - ((v - mn) / span) * (height - pad * 2)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '); const last = pts[pts.length - 1];
  const up = d[d.length - 1] >= d[0];
  return (
    <svg className={`spark ${up ? 'up' : 'down'} ${className}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ color }}>
      <path className="spark-area" d={`${path} L${last[0]} ${height} L${pts[0][0]} ${height} Z`} /><path className="spark-line" d={path} pathLength="100" /><circle className="spark-dot" cx={last[0]} cy={last[1]} r="2.6" />
    </svg>
  );
}

// A real switch for yes/no settings. Works as a checkbox for keyboards and screen readers.
export function Switch({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`sw-row ${disabled ? 'off' : ''}`}><span className="sw"><input type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} /><i aria-hidden="true" /></span><span className="sw-t"><b>{label}</b>{hint && <small>{hint}</small>}</span></label>
  );
}

// Hides until it scrolls into view, then rises in once. Used for the result reveal sequence.
export function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null); const [on, setOn] = useState(reduced());
  useEffect(() => { if (on) return undefined; const el = ref.current; if (!el || !('IntersectionObserver' in window)) { setOn(true); return undefined; } const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.15 }); io.observe(el); return () => io.disconnect(); }, [on]);
  return <div ref={ref} className={`rv ${on ? 'in' : ''} ${className}`} style={{ '--d': `${delay}ms` }}>{children}</div>;
}

// Ring that shows done out of total and fills once when it appears.
export function ProgressRing({ done = 0, total = 0, size = 48, tone, label }) {
  const pct = total ? Math.round((done / total) * 100) : 0; const t = tone || (pct >= 100 ? 'good' : pct >= 50 ? 'mid' : 'low');
  return (
    <span className={`pr ${t}`} style={{ width: size, height: size }} role="img" aria-label={label || `${done} of ${total} done`}>
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="pr-bg" cx="18" cy="18" r="15.5" /><circle className="pr-fg" cx="18" cy="18" r="15.5" pathLength="100" style={{ '--to': pct }} /></svg>
      <b>{done}<small>/{total}</small></b>
    </span>
  );
}

// Placeholder shaped like the student dashboard or the result page. Shows only if loading takes over 150 ms.
export function CardsSkeleton({ kind = 'dash' }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 150); return () => clearTimeout(t); }, []);
  if (!show) return <div style={{ minHeight: 320 }} role="status" aria-label="Loading" />;
  return (
    <div className={`sk-cards ${kind}`} role="status" aria-label="Loading">
      <div className="sk sk-title" />
      {kind === 'result' ? <div className="sk-r1"><div className="sk sk-hero" /><div className="sk-mini">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="sk" style={{ '--i': i }} />)}</div></div>
        : <div className="sk-r1"><div className="sk sk-hero" /><div className="sk sk-side" /></div>}
      <div className="sk-r2"><div className="sk-card">{[0, 1, 2, 3].map((i) => <div key={i} className="sk sk-line" style={{ '--i': i, width: `${96 - i * 8}%` }} />)}</div><div className="sk-card">{[0, 1, 2].map((i) => <div key={i} className="sk sk-line" style={{ '--i': i, width: `${90 - i * 12}%` }} />)}</div></div>
    </div>
  );
}
