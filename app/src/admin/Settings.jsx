import { useState } from 'react';
import { api } from '../lib/api.js';
import { refreshSite } from '../lib/site.js';
import { Badge, Empty, Err, Loading, PageHead, Pager, dt, toast, useLoad } from './ui.jsx';

export default function Settings() {
  return (<>
    <PageHead title="Site configuration" sub="Site name and contact, logo and colour, home page text, limits and sign-in rules. People who can run the platform are under Administrators; backups are under Data and backup." />
    <Site />
  </>);
}

export function AuditPage() {
  return (<>
    <PageHead title="Audit log" sub="Every change an admin or staff member made, newest first." />
    <Audit />
  </>);
}

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];
function Site() {
  const { data: d, err, loading } = useLoad('/admin/site');
  const [f, setF] = useState(null); const [lim, setLim] = useState(null); const [msg, setMsg] = useState(''); const [bad, setBad] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <Loading />; if (err) return <Err>{err}</Err>;
  const site = f || { ...d.site, faq: d.site.faq || [] }; const limits = lim || d.limits;
  const up = (k, v) => { setF({ ...site, [k]: v }); setMsg(''); }; const upl = (k, v) => { setLim({ ...limits, [k]: v }); setMsg(''); };
  const faq = site.faq; const setFaq = (i, k, v) => up('faq', faq.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => { setBusy(true); setBad(''); try { await api.put('/admin/site', { site, limits }); refreshSite(); setMsg('Saved. Students see the new text within a minute.'); toast('Saved'); } catch (e) { setBad(e.message); } finally { setBusy(false); } };
  const T = ({ k, label, hint, max, area }) => (<label className="ad-field" style={{ display: 'block', marginBottom: 12 }}>{label}{area ? <textarea rows={3} maxLength={max} value={site[k] || ''} onChange={(e) => up(k, e.target.value)} /> : <input maxLength={max} value={site[k] || ''} onChange={(e) => up(k, e.target.value)} />}{hint && <small className="muted" style={{ display: 'block' }}>{hint}</small>}</label>);
  const N = ({ k, label, hint }) => (<label className="ad-field" style={{ display: 'block', marginBottom: 12 }}>{label}<input type="number" min="0" value={limits[k]} onChange={(e) => upl(k, e.target.value)} />{hint && <small className="muted" style={{ display: 'block' }}>{hint}</small>}</label>);
  return (
    <>
      <div className="ad-grid g2">
        <section className="card"><h3>Name and contact</h3>
          <T k="name" label="Site name" hint="Shown in the header, emails, PDF reports and share cards." max={40} />
          <T k="tagline" label="Tagline" max={120} />
          <T k="publicUrl" label="Site address" hint="For example https://mock.example.com. Used in emails, WhatsApp and invite links." max={200} />
          <T k="supportEmail" label="Support email" hint="Shown in the footer of the home page." max={120} />
          <T k="supportPhone" label="Support phone or WhatsApp" max={30} />
        </section>
        <section className="card"><h3>Logo and colour</h3>
          <div className="sx-brand">
            <span className="sx-logo" style={{ background: site.accent || undefined }}>{site.logoUrl ? <img src={site.logoUrl} alt="Current logo" /> : <span aria-hidden="true">✓</span>}</span>
            <div>
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>{site.logoUrl ? 'Change logo' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async (e) => { const fl = e.target.files[0]; if (!fl) return; try { const r = await api.upload(fl); up('logoUrl', r.url); } catch (x) { setBad(x.message); } e.target.value = ''; }} /></label>
              {site.logoUrl && <button type="button" className="btn btn-ghost btn-sm" onClick={() => up('logoUrl', '')}>Use the default tick</button>}
              <small className="muted" style={{ display: 'block', marginTop: 6 }}>A square PNG on a transparent background works best. It also becomes the browser tab icon.</small>
            </div>
          </div>
          <label className="ad-field" style={{ display: 'block', marginBottom: 12 }}>Brand colour
            <span className="sx-colour"><input type="color" aria-label="Pick a colour" value={site.accent || '#1e3a8a'} onChange={(e) => up('accent', e.target.value)} /><input value={site.accent || ''} placeholder="#1e3a8a" maxLength={7} onChange={(e) => up('accent', e.target.value)} />{site.accent && <button type="button" className="btn btn-ghost btn-sm" onClick={() => up('accent', '')}>Reset</button>}</span>
            <small className="muted">Used for buttons, links and highlights everywhere. Pick a dark colour so white text stays readable. Leave empty for the default blue.</small>
          </label>
          <T k="footerText" label="Footer line on student pages" hint="Leave empty to show the tagline." max={200} />
        </section>
        <section className="card"><h3>Home page text</h3>
          <T k="heroTitle" label="Headline" hint="Leave empty to use the built-in headline." max={160} area />
          <T k="heroText" label="Short description under the headline" max={300} area />
          <T k="disclaimer" label="Footer small print" hint="Leave empty to use the built-in note that the site is independent." max={300} area />
        </section>
      </div>
      <section className="card" style={{ marginTop: 14 }}><h3>Questions and answers on the home page</h3>
        <p className="small muted">Leave this list empty to show the built-in questions. Up to 20.</p>
        {faq.map((x, i) => (<div key={i} className="ad-faq"><input aria-label="Question" placeholder="Question" maxLength={200} value={x.q} onChange={(e) => setFaq(i, 'q', e.target.value)} /><textarea aria-label="Answer" placeholder="Answer" rows={2} maxLength={1000} value={x.a} onChange={(e) => setFaq(i, 'a', e.target.value)} /><button type="button" className="btn btn-ghost btn-sm" onClick={() => up('faq', faq.filter((_, j) => j !== i))}>Remove</button></div>))}
        {faq.length < 20 && <button type="button" className="btn btn-ghost" onClick={() => up('faq', [...faq, { q: '', a: '' }])}>Add a question</button>}
      </section>
      <section className="card" style={{ marginTop: 14 }}><h3>Limits and time</h3>
        <div className="ad-grid g2">
          <N k="practicePerDay" label="Practice sets per student per day" />
          <N k="emailDailyCap" label="Reminder emails per day (whole site)" hint="Protects your email quota. 0 stops reminder emails. Sign-in codes are not counted." />
          <N k="doubtPerHour" label="Doubt questions per student per hour" />
          <N k="doubtPerDay" label="Doubt questions per student per day" />
          <label className="ad-field">Time zone<select value={limits.timezone} onChange={(e) => upl('timezone', e.target.value)}>{[...new Set([limits.timezone, ...ZONES])].map((z) => <option key={z}>{z}</option>)}</select><small className="muted" style={{ display: 'block' }}>Used for quiet hours, digests and "tomorrow at 10:00".</small></label>
          <label className="ad-chk"><input type="checkbox" checked={!!limits.doubtChat} onChange={(e) => upl('doubtChat', e.target.checked)} /> Let students ask the AI doubt assistant</label>
        </div>
      </section>
      <section className="card" style={{ marginTop: 14 }}><h3>Sign-in and security</h3>
        <p className="small muted">Applies to new sign-ins and new codes. People already signed in keep their current session.</p>
        <div className="ad-grid g2">
          <N k="sessionDays" label="Stay signed in for (days)" hint="When a student ticks Keep me signed in." />
          <N k="sessionHours" label="Short session length (hours)" hint="When Keep me signed in is not ticked." />
          <N k="otpMinutes" label="Sign-in code is valid for (minutes)" />
          <N k="otpPerHour" label="Codes one person can ask for per hour" />
          <N k="otpMaxWrong" label="Wrong code tries before the code is cancelled" />
          <N k="minPassword" label="Shortest allowed password (characters)" />
        </div>
      </section>
      <Err>{bad}</Err>{msg && <p className="okmsg" role="status">{msg}</p>}
      <div style={{ marginTop: 14 }}><button className="btn btn-primary" disabled={busy} onClick={save}>Save changes</button></div>
    </>
  );
}
function Audit() {
  const [page, setPage] = useState(1); const { data, err, loading } = useLoad(`/admin/audit?page=${page}&size=40`, [page]);
  return (<><Err>{err}</Err><div className="card nopad">{loading && !data ? <Loading /> : !data?.entries.length ? <Empty>No activity recorded yet.</Empty> : <div style={{ overflowX: 'auto' }}><table className="ad-table ad-audit"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>{data.entries.map((e) => <tr key={e.id}><td>{dt(e.at)}</td><td>{e.admin}</td><td><Badge tone="brand">{e.action.replace(/_/g, ' ')}</Badge></td><td>{e.target}</td><td className="muted">{e.detail}</td></tr>)}</tbody></table></div>}{data && <Pager page={page} size={40} total={data.total} onPage={setPage} />}</div></>);
}
