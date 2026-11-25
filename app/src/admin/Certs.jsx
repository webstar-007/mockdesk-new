import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Empty, Err, Loading, PageHead, Pager, Stat, dt, toast, useLoad } from './ui.jsx';

function Rules({ config, onSaved }) {
  const [f, setF] = useState(config); const [busy, setBusy] = useState(false);
  useEffect(() => setF(config), [config]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() { setBusy(true); try { const r = await api.put('/admin/certificates-config', f); setF(r.config); toast('Certificate rules saved'); onSaved(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } }
  return (
    <section className="card">
      <h3>When are certificates issued?</h3>
      <p className="muted small">Students get them automatically as soon as they qualify. Turning this off hides every certificate from students until you turn it back on.</p>
      <label className="adm-check"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Issue certificates</label>
      <div className="adm-grid2">
        <label>Completion: finish this many different mocks<input type="number" min="1" max="100" value={f.completionMocks} onChange={(e) => set('completionMocks', e.target.value)} /></label>
        <label>Merit: score at least this percent in a mock<input type="number" min="30" max="100" value={f.meritPct} onChange={(e) => set('meritPct', e.target.value)} /></label>
        <label>Completion title<input value={f.completionTitle} maxLength={60} onChange={(e) => set('completionTitle', e.target.value)} /></label>
        <label>Merit title<input value={f.meritTitle} maxLength={60} onChange={(e) => set('meritTitle', e.target.value)} /></label>
        <label>Name shown at the top (blank uses the site name)<input value={f.orgName} maxLength={80} onChange={(e) => set('orgName', e.target.value)} /></label>
        <label>Signed by<input value={f.signerName} maxLength={60} placeholder="For example Dr. R. Rao" onChange={(e) => set('signerName', e.target.value)} /></label>
        <label>Signer’s role<input value={f.signerTitle} maxLength={60} placeholder="For example Director" onChange={(e) => set('signerTitle', e.target.value)} /></label>
      </div>
      <p><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button></p>
    </section>
  );
}

function Issue({ onDone }) {
  const [f, setF] = useState({ contact: '', title: '', detail: '' }); const [busy, setBusy] = useState(false);
  async function go(e) { e.preventDefault(); setBusy(true); try { const r = await api.post('/admin/certificates/issue', f); toast(`Issued ${r.code}`); setF({ contact: '', title: '', detail: '' }); onDone(); } catch (x) { toast(x.message, 'bad'); } finally { setBusy(false); } }
  return (
    <form className="card" onSubmit={go}>
      <h3>Give a special certificate</h3>
      <p className="muted small">For things the rules cannot see, such as “Best improver of the month”.</p>
      <div className="adm-grid2">
        <label>Student’s email or mobile<input required value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
        <label>Title<input required minLength={3} maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Best improver of the month" /></label>
        <label style={{ gridColumn: '1 / -1' }}>Line under the name (optional)<input maxLength={160} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="Raised the average score by 18 points in October" /></label>
      </div>
      <p><button className="btn btn-primary" disabled={busy}>{busy ? 'Issuing…' : 'Issue certificate'}</button></p>
    </form>
  );
}

export default function Certs() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [ask, setAsk] = useState(null);
  const { data, err, loading, reload } = useLoad(`/admin/certificates?q=${encodeURIComponent(q)}&page=${page}`, [q, page]);
  async function revoke(c, undo) { try { await api.post(`/admin/certificates/${c.code}/revoke`, { undo }); toast(undo ? 'Certificate restored' : 'Certificate withdrawn'); setAsk(null); reload(); } catch (e) { toast(e.message, 'bad'); } }
  return (
    <>
      <PageHead title="Certificates" sub="Completion and merit certificates that students earn automatically, with a public page that proves each one is real." />
      <Err err={err} />
      {!data ? (loading ? <Loading /> : null) : (
        <>
          <div className="ad-grid g3"><Stat icon="🎓" label="Certificates issued" value={data.counts.issued} /><Stat icon="👩‍🎓" label="Students with one" value={data.counts.students} /><Stat icon="🚫" label="Withdrawn" value={data.counts.revoked} tone={data.counts.revoked ? 'warn' : ''} /></div>
          <div className="ad-grid g2" style={{ margin: '14px 0' }}><Rules config={data.config} onSaved={reload} /><Issue onDone={reload} /></div>
          <section className="card">
            <div className="adm-bar"><h3 style={{ margin: 0 }}>Issued certificates</h3><input type="search" placeholder="Search name, email, code or title" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search certificates" /></div>
            {!data.certs.length ? <Empty>No certificates yet. They appear when students finish mocks.</Empty> : (
              <div className="tbl-wrap"><table className="ad-table"><thead><tr><th>Student</th><th>Certificate</th><th>Code</th><th>Issued</th><th>Status</th><th /></tr></thead>
                <tbody>{data.certs.map((c) => <tr key={c.code}><td>{c.student}</td><td>{c.title}<br /><small className="muted">{c.detail}</small></td><td><Link to={c.url} target="_blank">{c.code}</Link></td><td>{dt(c.issuedAt)}</td><td>{c.revoked ? <Badge tone="bad">Withdrawn</Badge> : <Badge tone="good">{c.manual ? 'Special' : 'Valid'}</Badge>}</td><td className="num">{c.revoked ? <button className="btn btn-ghost btn-sm" onClick={() => revoke(c, true)}>Restore</button> : <button className="btn btn-ghost btn-sm" onClick={() => setAsk(c)}>Withdraw</button>}</td></tr>)}</tbody></table></div>)}
            <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
          </section>
        </>)}
      {ask && <ConfirmModal title="Withdraw this certificate?" danger label="Withdraw" onConfirm={() => revoke(ask, false)} onClose={() => setAsk(null)}><p>{ask.student}’s “{ask.title}” will show as withdrawn on its public page, and it will not be issued again. You can restore it later.</p></ConfirmModal>}
    </>
  );
}
