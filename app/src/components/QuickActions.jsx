import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useSite } from '../lib/site.js';
import { useTheme } from '../lib/theme.js';
import { Switch } from './Motion.jsx';

const CATALOG = [
  ['home', '🏠', 'Dashboard', { to: '/' }], ['notebook', '📓', 'Notebook', { to: '/notebook' }], ['toolkit', '🧰', 'Toolkit', { to: '/toolkit' }], ['fixes', '🛠️', 'My fixes', { to: '/fixes' }],
  ['inbox', '✉️', 'Inbox', { to: '/inbox' }], ['support', '💬', 'Ask for help', { to: '/support' }], ['profile', '👤', 'Profile and goals', { to: '/profile' }],
  ['theme', '🌓', 'Switch light and dark', { act: 'theme' }], ['top', '⬆️', 'Back to top', { act: 'top' }],
];
const DEFAULT = ['home', 'notebook', 'toolkit', 'inbox'];
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };

/** A round button in the corner that opens a short list of shortcuts. Each person picks and orders their own. */
export default function QuickActions() {
  const { user } = useAuth(); const site = useSite(); const nav = useNavigate(); const { toggle } = useTheme(); const key = `md-quick-${user?.id}`;
  const [pref, setPref] = useState(() => read(key) || { items: DEFAULT, side: 'right', on: true }); const [open, setOpen] = useState(false); const [edit, setEdit] = useState(false); const box = useRef(null);
  const save = (p) => { setPref(p); write(key, p); };
  const cat = CATALOG.filter((c) => c[0] !== 'support' || site.features?.support !== false);
  const items = pref.items.map((id) => cat.find((c) => c[0] === id)).filter(Boolean);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setEdit(false); } };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); setEdit(false); } };
    document.addEventListener('pointerdown', out); document.addEventListener('keydown', esc); return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!pref.on && !open) return <button type="button" className={`fab-show ${pref.side}`} onClick={() => save({ ...pref, on: true })} aria-label="Show quick actions button">⚡</button>;
  const run = (c) => { setOpen(false); if (c[3].to) nav(c[3].to); else if (c[3].act === 'theme') toggle(); else window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const move = (id, d) => { const o = [...pref.items]; const i = o.indexOf(id); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...pref, items: o }); };
  const flip = (id, on) => save({ ...pref, items: on ? [...pref.items, id] : pref.items.filter((x) => x !== id) });
  return (
    <div className={`fab ${pref.side} ${open ? 'open' : ''}`} ref={box}>
      {open && !edit && <ul className="fab-list" role="menu" aria-label="Quick actions">{items.map((c, i) => <li key={c[0]} style={{ '--i': i }}><button type="button" role="menuitem" className="fab-i" onClick={() => run(c)}><span aria-hidden="true">{c[1]}</span>{c[2]}</button></li>)}<li style={{ '--i': items.length }}><button type="button" className="fab-i ghost" onClick={() => setEdit(true)}><span aria-hidden="true">✏️</span>Customize</button></li></ul>}
      {open && edit && (
        <div className="fab-edit" role="dialog" aria-label="Customize quick actions">
          <div className="fab-edit-h"><b>Your quick actions</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Done</button></div>
          <ul>{cat.map((c) => { const on = pref.items.includes(c[0]); const i = pref.items.indexOf(c[0]); return (
            <li key={c[0]}><Switch checked={on} onChange={(v) => flip(c[0], v)} label={<><span aria-hidden="true">{c[1]}</span> {c[2]}</>} />{on && <span className="fab-mv"><button type="button" aria-label={`Move ${c[2]} up`} disabled={i === 0} onClick={() => move(c[0], -1)}>↑</button><button type="button" aria-label={`Move ${c[2]} down`} disabled={i === pref.items.length - 1} onClick={() => move(c[0], 1)}>↓</button></span>}</li>); })}</ul>
          <div className="fab-edit-f"><button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ ...pref, side: pref.side === 'right' ? 'left' : 'right' })}>Move to the {pref.side === 'right' ? 'left' : 'right'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { save({ ...pref, on: false }); setOpen(false); setEdit(false); }}>Hide button</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ items: DEFAULT, side: 'right', on: true })}>Reset</button></div>
        </div>)}
      <button type="button" className="fab-btn" aria-label="Quick actions" aria-expanded={open} onClick={() => { setOpen(!open); setEdit(false); }}><span aria-hidden="true">⚡</span></button>
    </div>
  );
}
