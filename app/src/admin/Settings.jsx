import { useState } from 'react';
import { api } from '../lib/api.js';
import { refreshSite } from '../lib/site.js';
import { Badge, Empty, Err, Loading, PageHead, Pager, dt, toast, useLoad } from './ui.jsx';

export default function Settings() {
  const [tab, setTab] = useState('site');
  return (<>
    <PageHead title="Settings" sub="Site name and contact, limits, administrators, the exam pattern and the activity log. Backups are under Data and backup." />
    <div className="ad-tabs" role="tablist">{[['site', 'Site and limits'], ['adm', 'Administrators'], ['pat', 'Exam pattern'], ['aud', 'Audit log']].map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</div>
    {tab === 'site' && <Site />}{tab === 'adm' && <Admins />}{tab === 'pat' && <Pattern />}{tab === 'aud' && <Audit />}
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
function Pattern() {
  const { data: d, err, loading } = useLoad('/admin/pattern'); if (loading) return <Loading />; if (err) return <Err>{err}</Err>;
  return (
    <div className="ad-grid g2">
      <section className="card"><h3>{d.exam.name}</h3><dl className="ad-kv">{Object.entries(d.sections).map(([k, s]) => <><dt key={k + 'a'}>{s.name}</dt><dd key={k + 'b'}>{s.questions} q · +{s.marksPerQuestion}/−{s.negativeMarks}{s.qualifying ? ` · qualifying ${s.qualifyingMarks}` : ''}</dd></>)}</dl></section>
      <section className="card"><h3>Timing and facts</h3><dl className="ad-kv">{d.segments.map((g) => <><dt key={g.id + 'a'}>{g.sections.map((x) => d.sections[x].short).join(' + ')}</dt><dd key={g.id + 'b'}>{g.minutes} min</dd></>)}<dt>Options per question</dt><dd>{d.optionsPerQuestion}</dd><dt>Uploaded images</dt><dd>{d.uploads}</dd></dl>
        <h4 style={{ marginTop: 16 }}>Admins</h4><ul style={{ margin: 0, paddingLeft: 18 }}>{d.admins.map((a) => <li key={a.email}>{a.name} <small className="muted">{a.email}</small></li>)}</ul>
        <p className="small muted" style={{ marginTop: 14 }}>The pattern itself lives in <code>config/exam.config.js</code> and is applied to every mock, the timer, scoring and results. Edit that file and restart the server when SSC changes the paper.</p></section>
    </div>
  );
}
function Admins() {
  const { data: d, err, loading } = useLoad('/admin/pattern'); if (loading) return <Loading />; if (err) return <Err>{err}</Err>;
  const e = d.adminEntries;
  return (
    <div className="ad-grid g2">
      <section className="card"><h3>Admins and editors</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{d.admins.map((a) => <li key={a.email}>{a.name} <small className="muted">{a.email}</small> <Badge tone={a.role === 'admin' ? 'brand' : 'warn'}>{a.role}</Badge></li>)}</ul><p className="small muted" style={{ marginTop: 12 }}>Change a role from Users → the user → Change role. Admins can do everything. Editors can only manage mocks, questions and reports, and cannot see student data.</p></section>
      <section className="card"><h3>The admins.txt file</h3><p className="small">Open <code>admins.txt</code> in the MockDesk folder and paste emails or mobile numbers, one per line. Those people become admins the next time they sign in or sign up. Add the word <code>editor</code> after a line (for example <code>teacher@gmail.com editor</code>) to give content rights only.</p><p className="small muted">File location: <code>{d.adminsFile}</code></p>
        <h4>Listed in the file now</h4>{e.emails.length + e.phones.length + e.editorEmails.length + e.editorPhones.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{[...e.emails, ...e.phones].map((x) => <li key={x}>{x} <Badge tone="brand">admin</Badge></li>)}{[...e.editorEmails, ...e.editorPhones].map((x) => <li key={x}>{x} <Badge tone="warn">editor</Badge></li>)}</ul> : <p className="small muted">Nothing yet.</p>}
        {e.ignored.length > 0 && <div className="ad-check warn" style={{ marginTop: 10 }}><b>Could not read these lines</b><ul>{e.ignored.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        <p className="small muted" style={{ marginTop: 12 }}>Removing a line later does not take rights away. Use Remove admin rights on the user page for that.</p></section>
    </div>
  );
}
function Audit() {
  const [page, setPage] = useState(1); const { data, err, loading } = useLoad(`/admin/audit?page=${page}&size=40`, [page]);
  return (<><Err>{err}</Err><div className="card nopad">{loading && !data ? <Loading /> : !data?.entries.length ? <Empty>No activity recorded yet.</Empty> : <div style={{ overflowX: 'auto' }}><table className="ad-table"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>{data.entries.map((e) => <tr key={e.id}><td>{dt(e.at)}</td><td>{e.admin}</td><td><Badge tone="brand">{e.action.replace(/_/g, ' ')}</Badge></td><td>{e.target}</td><td className="muted">{e.detail}</td></tr>)}</tbody></table></div>}{data && <Pager page={page} size={40} total={data.total} onPage={setPage} />}</div></>);
}
