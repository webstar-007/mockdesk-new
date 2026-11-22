import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Empty, Err, Loading, PageHead, dt, toast, useLoad } from './ui.jsx';

const CH = [['inapp', 'In the app', 'Shows in the student’s inbox.'], ['push', 'Push', 'Free. Only students who turned it on.'], ['email', 'Email', 'Only students with an email address.'], ['whatsapp', 'WhatsApp', 'Only students who opted in. Costs money per message.']];
const local = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const STATUS = { scheduled: ['warn', 'Scheduled'], sending: ['warn', 'Sending'], sent: ['good', 'Sent'], cancelled: ['mute', 'Cancelled'] };

export default function Messages() {
  const { data, err, loading, reload } = useLoad('/admin/messages');
  const [f, setF] = useState({ title: '', body: '', link: '/', channels: { inapp: true }, audience: 'all', batchId: '', when: 'now', at: local(Date.now() + 3600000), ignoreLimits: false });
  const [reach, setReach] = useState(null); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(null); const [detail, setDetail] = useState(null);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { const t = setTimeout(() => api.get(`/admin/messages/preview?audience=${f.audience}${f.audience === 'batch' && f.batchId ? `&batchId=${f.batchId}` : ''}`).then(setReach).catch(() => setReach(null)), 250); return () => clearTimeout(t); }, [f.audience, f.batchId]);
  useEffect(() => { if (open) api.get(`/admin/messages/${open}`).then(setDetail).catch(() => setDetail(null)); else setDetail(null); }, [open]);
  if (loading && !data) return <Loading />; if (err && !data) return <Err>{err}</Err>;
  const av = data.available; const body = () => ({ title: f.title, body: f.body, link: f.link, channels: f.channels, audience: f.audience, batchId: f.batchId, ignoreLimits: f.ignoreLimits, sendAt: f.when === 'later' ? new Date(f.at).getTime() : null });
  const send = async () => {
    const later = f.when === 'later'; if (!later && !window.confirm(`Send this now to ${reach?.audience ?? 'the selected'} students?`)) return;
    setBusy(true); try { await api.post('/admin/messages', body()); toast(later ? 'Scheduled' : 'Sent'); setF((x) => ({ ...x, title: '', body: '' })); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const test = async () => { try { const r = await api.post('/admin/messages/test', body()); toast(`Test sent to you: ${Object.entries(r.result).filter(([k]) => k !== 'id').map(([k, v]) => `${k} ${v}`).join(', ')}`); } catch (e) { toast(e.message, 'bad'); } };
  const cancel = async (id) => { try { await api.post(`/admin/messages/${id}/cancel`); toast('Cancelled'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const sel = Object.entries(f.channels).filter(([, v]) => v).map(([k]) => k);
  return (
    <>
      <PageHead title="Messages" sub="Send a one-off message to students. Pick who, how, and when, then see who opened it." />
      <div className="ms-grid">
        <section className="card"><h3>New message</h3>
          <label className="ad-field">Title<input maxLength={80} value={f.title} onChange={(e) => up('title', e.target.value)} placeholder="e.g. Mock 7 is live" /></label>
          <label className="ad-field">Message<textarea rows={3} maxLength={300} value={f.body} onChange={(e) => up('body', e.target.value)} placeholder="One or two short sentences" /><small className="muted">{f.body.length}/300</small></label>
          <label className="ad-field">Opens this page<input value={f.link} onChange={(e) => up('link', e.target.value)} placeholder="/" /></label>
          <div className="ad-row">
            <label className="ad-field">Send to<select value={f.audience} onChange={(e) => up('audience', e.target.value)}>{data.audiences.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
            {f.audience === 'batch' && <label className="ad-field">Batch<select value={f.batchId} onChange={(e) => up('batchId', e.target.value)}><option value="">Choose…</option>{data.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          </div>
          <fieldset className="ms-chan"><legend className="small"><b>Send by</b></legend>
            {CH.map(([k, name, hint]) => <label key={k} className="check"><input type="checkbox" checked={!!f.channels[k]} disabled={!av[k]} onChange={(e) => up('channels', { ...f.channels, [k]: e.target.checked })} /><span>{name}{!av[k] && <Badge tone="warn"> not set up</Badge>}<small>{hint}</small></span></label>)}
          </fieldset>
          <div className="ad-row"><label className="ad-field">When<select value={f.when} onChange={(e) => up('when', e.target.value)}><option value="now">Send now</option><option value="later">Schedule</option></select></label>
            {f.when === 'later' && <label className="ad-field">Date and time<input type="datetime-local" value={f.at} onChange={(e) => up('at', e.target.value)} /></label>}</div>
          <label className="check"><input type="checkbox" checked={f.ignoreLimits} onChange={(e) => up('ignoreLimits', e.target.checked)} /><span>Urgent: ignore each student’s weekly and daily limits<small className="muted" style={{ display: 'block' }}>Use sparingly. Students’ own on/off choices still apply.</small></span></label>
          <div className="ad-actions" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn btn-ghost" disabled={!sel.length || !f.title || !f.body} onClick={test}>Send me a test</button><button className="btn btn-primary" disabled={busy || !sel.length || !f.title || !f.body || (f.audience === 'batch' && !f.batchId)} onClick={send}>{busy ? 'Working…' : f.when === 'later' ? 'Schedule' : 'Send'}</button></div>
        </section>
        <section className="card"><h3>Who will get it</h3>
          {reach ? <><p className="small muted">{reach.audience} student{reach.audience === 1 ? '' : 's'} in this group. Reach by route, after each student’s own choices:</p>
            <div className="ms-reach"><div><b>{reach.inapp}</b><span>in the app</span></div><div><b>{reach.push}</b><span>push</span></div><div><b>{reach.email}</b><span>email</span></div><div><b>{reach.whatsapp}</b><span>WhatsApp</span></div></div>
            {sel.includes('whatsapp') && <p className="small">WhatsApp cost about ₹{reach.whatsappCostInr} at the rate set in Notifications.</p>}</> : <Loading />}
          <h3 style={{ marginTop: 18 }}>Preview</h3>
          <div className="card" style={{ background: 'var(--surface-2, var(--brand-soft))' }}><b>{f.title || 'Title'}</b><p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{f.body || 'Your message appears here.'}</p></div>
        </section>
      </div>
      <section className="card" style={{ marginTop: 14 }}><h3>Sent and scheduled</h3>
        {!data.campaigns.length ? <Empty>No messages yet. Write one above.</Empty> : <ul className="ms-list">{data.campaigns.map((c) => { const [tone, label] = STATUS[c.status] || ['mute', c.status]; const s = c.stats; return (
          <li key={c.id}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><b>{c.title}</b> <Badge tone={tone}>{label}</Badge><p className="small muted" style={{ margin: '2px 0' }}>{c.body}</p><p className="small muted" style={{ margin: 0 }}>{c.status === 'scheduled' ? `Goes out ${dt(c.sendAt)}` : c.sentAt ? `Sent ${dt(c.sentAt)}` : ''} · {Object.keys(c.channels).filter((k) => c.channels[k]).join(', ')} · {c.audience}</p></div>
            {c.status === 'scheduled' ? <button className="btn btn-ghost btn-sm" onClick={() => cancel(c.id)}>Cancel</button> : <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide details' : 'Details'}</button>}</div>
            {s && <><div className="ms-bar" aria-hidden="true"><i style={{ width: pct(s.opened, s.targeted) === '–' ? 0 : `${Math.round((s.opened / s.targeted) * 100)}%` }} /></div><div className="ms-stats"><span>Reached <b>{s.targeted}</b></span><span>Opened <b>{pct(s.opened, s.targeted)}</b></span><span>Clicked <b>{pct(s.clicked, s.targeted)}</b></span>{Object.entries(s.channels).map(([ch, v]) => <span key={ch}>{ch} sent <b>{v.sent || 0}</b>{v.failed ? <> · failed <b>{v.failed}</b></> : null}{v.skipped ? <> · held back <b>{v.skipped}</b></> : null}</span>)}</div></>}
            {open === c.id && detail && <div className="small" style={{ marginTop: 8 }}>{detail.failures.length ? <><b>Problems</b><ul>{detail.failures.map((x, i) => <li key={i}>{x.name || 'Student'} · {x.channel}: {x.error || 'held back'}</li>)}</ul></> : <p className="muted">No failed or held-back sends.</p>}</div>}
          </li>); })}</ul>}
      </section>
    </>
  );
}
