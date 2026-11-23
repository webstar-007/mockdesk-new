import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ago } from './ui.jsx';

export const LEVEL = { bad: 'Urgent', warn: 'Warning', info: 'Notice' };
export const refreshAlerts = () => window.dispatchEvent(new Event('ad-alerts'));

/** Bell in the admin top bar: unread count, a short list, and a way into the full Alerts page. */
export default function AlertBell() {
  const nav = useNavigate(); const [d, setD] = useState(null); const [open, setOpen] = useState(false); const box = useRef(null);
  const load = useCallback(() => api.get('/admin/alert-center/summary').then(setD).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 30000); window.addEventListener('ad-alerts', load); return () => { clearInterval(t); window.removeEventListener('ad-alerts', load); }; }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc); return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const s = d?.summary; const items = d?.items || []; const unread = s?.unread || 0; const urgent = items.some((x) => x.unread && x.level === 'bad');
  const go = async (x) => { setOpen(false); try { if (x.unread) await api.post('/admin/alert-center/read', { id: x.id }); } catch { /* keep going */ } load(); if (x.link) nav(`/admin/${x.link}`); else nav('/admin/alerts'); };
  const readAll = async () => { try { await api.post('/admin/alert-center/read', { id: 'all' }); } catch { /* ignore */ } load(); };
  return (
    <div className="sx-bell" ref={box}>
      <button className={`sx-bell-btn ${urgent ? 'urgent' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts, none unread'}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.5L4.5 16h15L18 12.5V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unread > 0 && <span className="sx-bell-n">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="sx-pop" role="dialog" aria-label="Alerts">
          <div className="sx-pop-h"><b>Alerts</b>{unread > 0 && <button className="sx-link" onClick={readAll}>Mark all read</button>}</div>
          {items.length ? <ul>{items.map((x) => (
            <li key={x.id}><button className={`sx-al ${x.unread ? 'unread' : ''}`} onClick={() => go(x)}>
              <i className={`sx-dot ${x.level}`} role="img" aria-label={LEVEL[x.level]} />
              <span><b>{x.title}</b><small>{x.body}</small><small className="t">{ago(x.lastAt)}</small></span>
            </button></li>))}</ul>
            : <p className="sx-pop-empty">All clear. Nothing needs you right now.</p>}
          <Link to="/admin/alerts" className="sx-pop-f" onClick={() => setOpen(false)}>See all alerts and settings</Link>
        </div>
      )}
    </div>
  );
}
