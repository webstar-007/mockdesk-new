import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useSite } from '../lib/site.js';
import { useTheme } from '../lib/theme.js';
import { api } from '../lib/api.js';
import { Switch } from './Motion.jsx';

const COMMON = [['theme', '🌓', 'Switch light and dark', { act: 'theme' }], ['top', '⬆️', 'Back to top', { act: 'top' }]];
const CATALOGS = {
  student: { def: ['home', 'notebook', 'toolkit', 'inbox'], list: [
    ['home', '🏠', 'Dashboard', { to: '/' }], ['notebook', '📓', 'Notebook', { to: '/notebook' }], ['toolkit', '🧰', 'Toolkit', { to: '/toolkit' }], ['fixes', '🛠️', 'My fixes', { to: '/fixes' }],
    ['inbox', '✉️', 'Inbox', { to: '/inbox' }], ['support', '💬', 'Ask for help', { to: '/support' }], ['profile', '👤', 'Profile and goals', { to: '/profile' }], ...COMMON] },
  teacher: { def: ['batches', 'assignments', 'doubts', 'health'], list: [
    ['batches', '👥', 'My batches', { to: '/teacher' }], ['assignments', '📝', 'Assignments', { to: '/teacher/assignments' }], ['doubts', '❓', 'Doubts', { to: '/teacher/doubts' }],
    ['health', '📈', 'Batch health', { to: '/teacher/health' }], ['tricks', '💡', 'Tricks', { to: '/teacher/tricks' }], ...COMMON] },
  admin: { def: ['search', 'alerts', 'users', 'live'], list: [
    ['search', '🔍', 'Search everything', { act: 'search' }], ['alerts', '🔔', 'Alerts', { to: '/admin/alerts' }], ['users', '👤', 'Users', { to: '/admin/users' }], ['live', '🔴', 'Live exams', { to: '/admin/live' }],
    ['mocks', '📚', 'Mocks', { to: '/admin/mocks' }], ['quality', '🎯', 'Question quality', { to: '/admin/quality' }], ['abuse', '🛡️', 'Abuse and limits', { to: '/admin/abuse' }],
    ['support', '💬', 'Support', { to: '/admin/support' }], ['tools', '🧰', 'Server tools', { to: '/admin/tools' }], ...COMMON] },
};
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };
const clamp = (v) => Math.min(88, Math.max(12, v));

/** A slim tab on the screen edge that opens a list of shortcuts. Drag it up or down, flip it to the other side, pick and order your own actions. Alt+Q opens it. */
export default function QuickActions({ role = 'student' }) {
  const { user } = useAuth(); const site = useSite(); const nav = useNavigate(); const { toggle } = useTheme(); const key = `md-quick-${user?.id}`;
  const C = CATALOGS[role] || CATALOGS.student;
  const [pref, setPref] = useState(() => { const p = read(key); return p && p.role === role ? p : { role, items: C.def, side: 'right', on: true, y: 55 }; });
  const [open, setOpen] = useState(false); const [edit, setEdit] = useState(false); const [badge, setBadge] = useState(0); const [drag, setDrag] = useState(null); const box = useRef(null); const moved = useRef(false);
  const save = (p) => { setPref(p); write(key, p); };
  const cat = C.list.filter((c) => c[0] !== 'support' || site.features?.support !== false);
  const items = pref.items.map((id) => cat.find((c) => c[0] === id)).filter(Boolean);
  const close = () => { setOpen(false); setEdit(false); };
  useEffect(() => { if (role !== 'student') return undefined; let on = true; api.get('/inbox?limit=1').then((d) => on && setBadge(d?.unread || 0)).catch(() => {}); return () => { on = false; }; }, [role, open]);
  useEffect(() => {
    const k = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.altKey && e.key.toLowerCase() === 'q') { e.preventDefault(); setOpen((o) => !o); setEdit(false); return; }
      if (open && !edit && e.key === 'Escape') close();
      if (open && !edit && !['input', 'textarea', 'select'].includes(tag) && /^[1-9]$/.test(e.key) && items[+e.key - 1]) { e.preventDefault(); run(items[+e.key - 1]); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (box.current && !box.current.contains(e.target)) close(); };
    document.addEventListener('pointerdown', out); return () => document.removeEventListener('pointerdown', out);
  }, [open]);
  const run = (c) => {
    close();
    if (c[3].to) nav(c[3].to); else if (c[3].act === 'theme') toggle(); else if (c[3].act === 'search') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const move = (id, d) => { const o = [...pref.items]; const i = o.indexOf(id); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...pref, items: o }); };
  const flip = (id, on) => save({ ...pref, items: on ? [...pref.items, id] : pref.items.filter((x) => x !== id) });
  const down = (e) => { moved.current = false; e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ y0: e.clientY, p0: pref.y ?? 55 }); };
  const mv = (e) => { if (!drag) return; const dy = e.clientY - drag.y0; if (Math.abs(dy) > 5) moved.current = true; if (moved.current) setPref((p) => ({ ...p, y: clamp(drag.p0 + (dy / window.innerHeight) * 100) })); };
  const up = () => { if (drag && moved.current) save(pref); setDrag(null); };
  const click = () => { if (moved.current) { moved.current = false; return; } setOpen(!open); setEdit(false); };
  const tabKey = (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); save({ ...pref, y: clamp((pref.y ?? 55) + (e.key === 'ArrowUp' ? -4 : 4)) }); } };
  const style = { top: `${pref.y ?? 55}%` };
  if (!pref.on && !open) return <button type="button" className={`fab-show ${pref.side}`} style={style} onClick={() => save({ ...pref, on: true })} aria-label="Show quick actions tab">⚡</button>;
  return (
    <div className={`fab ${pref.side} ${open ? 'open' : ''} ${drag && moved.current ? 'dragging' : ''}`} style={style} ref={box}>
      <button type="button" className="fab-btn" aria-label="Quick actions (Alt+Q). Drag to move, arrow keys also move it." aria-expanded={open} aria-keyshortcuts="Alt+Q" onPointerDown={down} onPointerMove={mv} onPointerUp={up} onPointerCancel={up} onClick={click} onKeyDown={tabKey}>
        <span aria-hidden="true">⚡</span>{badge > 0 && !open && <i className="fab-badge">{badge > 9 ? '9+' : badge}</i>}
      </button>
      {open && !edit && <ul className="fab-list" role="menu" aria-label="Quick actions">{items.map((c, i) => <li key={c[0]} style={{ '--i': i }}><button type="button" role="menuitem" className="fab-i" onClick={() => run(c)}><span aria-hidden="true">{c[1]}</span>{c[2]}{c[0] === 'inbox' && badge > 0 && <b className="fab-n">{badge}</b>}{i < 9 && <kbd>{i + 1}</kbd>}</button></li>)}<li style={{ '--i': items.length }}><button type="button" className="fab-i ghost" onClick={() => setEdit(true)}><span aria-hidden="true">✏️</span>Customize</button></li></ul>}
      {open && edit && (
        <div className="fab-edit" role="dialog" aria-label="Customize quick actions">
          <div className="fab-edit-h"><b>Your quick actions</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Done</button></div>
          <ul>{cat.map((c) => { const on = pref.items.includes(c[0]); const i = pref.items.indexOf(c[0]); return (
            <li key={c[0]}><Switch checked={on} onChange={(v) => flip(c[0], v)} label={<><span aria-hidden="true">{c[1]}</span> {c[2]}</>} />{on && <span className="fab-mv"><button type="button" aria-label={`Move ${c[2]} up`} disabled={i === 0} onClick={() => move(c[0], -1)}>↑</button><button type="button" aria-label={`Move ${c[2]} down`} disabled={i === pref.items.length - 1} onClick={() => move(c[0], 1)}>↓</button></span>}</li>); })}</ul>
          <p className="muted fab-tip">Drag the tab up or down to place it. Alt+Q opens it, and 1 to 9 picks an action.</p>
          <div className="fab-edit-f"><button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ ...pref, side: pref.side === 'right' ? 'left' : 'right' })}>Move to the {pref.side === 'right' ? 'left' : 'right'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { save({ ...pref, on: false }); close(); }}>Hide tab</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ role, items: C.def, side: 'right', on: true, y: 55 })}>Reset</button></div>
        </div>)}
    </div>
  );
}
