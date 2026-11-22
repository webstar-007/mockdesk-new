import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const TABS = [['all', 'All'], ['reminders', 'Reminders'], ['progress', 'Progress'], ['teacher', 'Teacher'], ['news', 'News']];
const LABEL = { reminders: 'Reminder', progress: 'Progress', teacher: 'Teacher', news: 'News' };
const when = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined }); };

export default function Inbox() {
  const nav = useNavigate(); const [cat, setCat] = useState('all'); const [unread, setUnread] = useState(false);
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [more, setMore] = useState(false);
  const q = (before) => `/inbox?category=${cat}&limit=25${unread ? '&unread=1' : ''}${before ? `&before=${before}` : ''}`;
  const load = () => api.get(q()).then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); load(); }, [cat, unread]);
  const loadMore = async () => { setMore(true); try { const r = await api.get(q(d.items.at(-1).at)); setD((x) => ({ ...r, items: [...x.items, ...r.items] })); } catch (e) { setErr(e.message); } finally { setMore(false); } };
  const patch = (key, p) => setD((x) => ({ ...x, items: x.items.map((i) => (i.key === key ? { ...i, ...p } : i)) }));
  const go = (i) => {
    if (!i.read) { patch(i.key, { read: true }); setD((x) => ({ ...x, unread: Math.max(0, x.unread - 1) })); }
    if (i.type === 'announcement') api.post(`/announcements/${i.id}/click`).catch(() => {}); else api.post(`/inbox/n/${i.id}/click`).catch(() => {});
    if (!i.link) return; if (/^https?:/.test(i.link)) window.open(i.link, '_blank', 'noopener'); else nav(i.link);
  };
  const toggleRead = async (i) => { try { if (i.read) await api.post('/inbox/unread', { key: i.key }); else await api.post('/inbox/read', { keys: [i.key] }); patch(i.key, { read: !i.read }); load(); } catch (e) { setErr(e.message); } };
  const remove = async (i) => { try { await api.del(`/inbox/n/${i.id}`); setD((x) => ({ ...x, items: x.items.filter((y) => y.key !== i.key) })); load(); } catch (e) { setErr(e.message); } };
  const readAll = async () => { try { await api.post('/inbox/read', { category: cat }); load(); } catch (e) { setErr(e.message); } };
  const unreadIn = (k) => d?.unreadBy?.[k] || 0;
  return (
    <main className="inbox">
      <div className="inbox-head"><h1>Messages</h1><div className="inbox-tools">
        <label className="check inbox-only"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /><span>Unread only</span></label>
        <button className="btn btn-ghost btn-sm" disabled={!unreadIn(cat)} onClick={readAll}>Mark all read</button></div></div>
      <div className="inbox-tabs" role="tablist" aria-label="Message type">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={cat === k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{l}{unreadIn(k) > 0 && <span className="inbox-n">{unreadIn(k)}</span>}</button>)}</div>
      {err && <p className="alert" role="alert">{err}</p>}
      {!d ? <p className="muted" role="status">Loading…</p> : !d.items.length ? (
        <div className="card inbox-empty"><p><b>{unread ? 'You are all caught up.' : 'Nothing here yet.'}</b></p><p className="muted small">Reminders, results, teacher notes and news from MockDesk show up here.</p></div>
      ) : (
        <ul className="inbox-list">{d.items.map((i) => (
          <li key={i.key} className={`card inbox-item${i.read ? '' : ' unread'}`}>
            <button type="button" className="inbox-main" onClick={() => go(i)}>
              <span className="inbox-top"><span className={`inbox-tag c-${i.category}`}>{LABEL[i.category]}</span><small className="muted">{when(i.at)}</small></span>
              <b>{i.title}</b>{i.body && <span className="inbox-body">{i.body}</span>}{i.link && <span className="inbox-open">{i.linkLabel || 'Open'}</span>}
            </button>
            <span className="inbox-acts">
              {i.type === 'notification' ? <><button className="linkbtn" onClick={() => toggleRead(i)}>{i.read ? 'Mark unread' : 'Mark read'}</button><button className="linkbtn" onClick={() => remove(i)}>Delete</button></> : !i.read && <button className="linkbtn" onClick={() => toggleRead(i)}>Mark read</button>}
            </span>
          </li>))}</ul>)}
      {d?.hasMore && <p style={{ textAlign: 'center' }}><button className="btn btn-ghost" disabled={more} onClick={loadMore}>{more ? 'Loading…' : 'Show older'}</button></p>}
      <p className="small muted"><Link to="/profile#notifications">Choose how you get messages</Link></p>
    </main>
  );
}
