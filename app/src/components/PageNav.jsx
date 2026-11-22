import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/* Back and forward for every console, plus a breadcrumb trail.
   BrowserRouter keeps the position in history.state.idx. We remember the furthest position seen so Forward
   is only offered when there is a page to go forward to. Back never leaves the site: on the first page of a
   visit it goes to the parent page instead. */
const KEY = 'md-hist-max';
const readMax = () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; } };
const writeMax = (n) => { try { sessionStorage.setItem(KEY, String(n)); } catch { /* private mode */ } };

function useHistory() {
  const loc = useLocation(); const type = useNavigationType();
  const idx = (typeof window !== 'undefined' && window.history.state?.idx) || 0;
  let max = readMax();
  if (type !== 'POP' || idx > max) max = idx; // a new page cuts off anything that was ahead
  writeMax(max);
  void loc;
  return { idx, canBack: idx > 0, canForward: idx < max };
}

// Pages register a readable name for their address ("Evening batch"), so breadcrumbs never show ids.
const names = new Map();
export function useCrumb(path, label) {
  useEffect(() => { if (!label) return undefined; names.set(path, label); window.dispatchEvent(new Event('md-crumb')); return () => { names.delete(path); }; }, [path, label]);
}
function useNames() { const [, bump] = useState(0); useEffect(() => { const f = () => bump((n) => n + 1); window.addEventListener('md-crumb', f); return () => window.removeEventListener('md-crumb', f); }, []); return names; }

/** trail: [[label, path?], ...]. The last item is the current page. */
export default function PageNav({ trail, home }) {
  const nav = useNavigate(); const { canBack, canForward } = useHistory(); const nm = useNames();
  const items = trail.map(([l, to]) => [(to && nm.get(to)) || l, to]);
  const parent = [...trail].reverse().find(([, to], i) => i > 0 && to)?.[1] || home || '/';
  const back = () => (canBack ? nav(-1) : nav(parent));
  return (
    <div className="pn">
      <div className="pn-btns" role="group" aria-label="History">
        <button type="button" onClick={back} aria-label="Go back" title="Back (Alt + Left)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg></button>
        <button type="button" onClick={() => nav(1)} disabled={!canForward} aria-label="Go forward" title="Forward (Alt + Right)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.500 13 10l-5.5 5.5" /></svg></button>
      </div>
      <nav aria-label="Breadcrumb"><ol className="pn-trail">{items.map(([l, to], i) => <li key={i} aria-current={i === items.length - 1 ? 'page' : undefined}>{to && i < items.length - 1 ? <Link to={to}>{l}</Link> : <span>{l}</span>}</li>)}</ol></nav>
    </div>
  );
}

export function studentTrail(p) {
  const d = ['Dashboard', '/']; const seg = p.split('/').filter(Boolean);
  const one = { profile: 'Profile', toolkit: 'Exam toolkit', notebook: 'Notebook', fixes: 'Corrections', inbox: 'Inbox', support: 'Help and support' };
  if (!seg.length) return null;
  if (seg[0] === 'support' && seg[1]) return [d, ['Help and support', '/support'], ['Question']];
  if (one[seg[0]]) return [d, [one[seg[0]]]];
  if (seg[0] === 'mock') return [d, ['Instructions']];
  if (seg[0] === 'live') return [d, ['Live mock']];
  if (seg[0] === 'results') return [d, ['Result']];
  if (seg[0] === 'review') return [d, ['Result', `/results/${seg[1]}`], ['Review answers']];
  return [d, ['Page']];
}
export function teacherTrail(p) {
  const seg = p.split('/').filter(Boolean).slice(1); const d = ['Dashboard', '/teacher'];
  if (!seg.length) return null;
  if (seg.length === 1) return [d, ['Batch', `/teacher/${seg[0]}`]];
  return [d, ['Batch', `/teacher/${seg[0]}`], ['Student', `/teacher/${seg[0]}/${seg[1]}`]];
}
