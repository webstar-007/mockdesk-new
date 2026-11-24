import { useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Empty, Err, Loading, PageHead, Stat, ago, toast, useLoad } from './ui.jsx';

const FILTERS = [['all', 'All'], ['reported', 'Reported'], ['hidden', 'Hidden'], ['unverified', 'Not verified'], ['verified', 'Verified']];

export default function Tricks() {
  const [f, setF] = useState('all'); const [q, setQ] = useState('');
  const { data: d, err, loading, reload } = useLoad(`/admin/tips?filter=${f}&q=${encodeURIComponent(q)}`, [f, q]);
  const [cfg, setCfg] = useState(null); const [busy, setBusy] = useState(false);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const c = cfg || d.config; const set = (k, v) => setCfg({ ...c, [k]: v });
  const act = async (id, name, msg) => { try { await api.post(`/admin/tips/${id}/${name}`); toast(msg); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const save = async () => { setBusy(true); try { await api.put('/admin/tips/config', c); setCfg(null); toast('Saved'); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  return (
    <>
      <PageHead title="Topper tricks" sub="One-line shortcuts that top scorers and teachers share under questions on the review page. Moderate them here." />
      {!d.enabled && <div className="alert" role="status">This feature is switched off. Turn it on under Server > Control room > Feature switches.</div>}
      <div className="ad-grid g4" style={{ marginBottom: 14 }}>
        <Stat icon="💡" label="Tricks shared" value={d.stats.total} /><Stat icon="✔" tone="good" label="Teacher verified" value={d.stats.verified} />
        <Stat icon="⚑" tone={d.stats.reported ? 'warn' : ''} label="Reported" value={d.stats.reported} /><Stat icon="▲" label="Upvotes" value={d.stats.votes} />
      </div>
      <section className="card" style={{ marginBottom: 14 }}>
        <h3>Who can post</h3>
        <div className="ad-grid g4">
          <label className="ad-field">Top percent of a mock<input type="number" min="1" max="50" value={c.topPercent} onChange={(e) => set('topPercent', e.target.value)} /></label>
          <label className="ad-field">Students needed first<input type="number" min="1" max="500" value={c.minCohort} onChange={(e) => set('minCohort', e.target.value)} /><small className="muted">Tricks open once this many have finished the mock.</small></label>
          <label className="ad-field">Reports before hiding<input type="number" min="1" max="20" value={c.reportsToHide} onChange={(e) => set('reportsToHide', e.target.value)} /></label>
          <label className="ad-field">Tips per question<input type="number" min="1" max="50" value={c.maxPerQuestion} onChange={(e) => set('maxPerQuestion', e.target.value)} /></label>
        </div>
        <label className="ad-chk" style={{ marginTop: 8 }}><input type="checkbox" checked={c.needCorrect} onChange={(e) => set('needCorrect', e.target.checked)} /> Only for questions the student answered correctly</label>
        {cfg && <div style={{ marginTop: 10 }}><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button> <button className="btn btn-ghost" onClick={() => setCfg(null)}>Cancel</button></div>}
      </section>
      <section className="card" style={{ padding: 0 }}>
        <div className="ad-bar" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTERS.map(([k, l]) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
          <input type="search" placeholder="Search text or name" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: 'auto', maxWidth: 240 }} />
        </div>
        {!d.tips.length ? <Empty>No tricks match. They appear after top scorers share them on the review page.</Empty> : (
          <div style={{ overflowX: 'auto' }}><table className="ad-table">
            <thead><tr><th>Trick</th><th>Author</th><th>Mock</th><th>Upvotes</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.tips.map((t) => (
              <tr key={t.id}>
                <td style={{ maxWidth: 360 }}>{t.text}<br /><small className="muted">{ago(t.at)}</small></td>
                <td>{t.author}<br /><small className="muted">{t.role === 'teacher' ? 'Teacher' : 'Student'}</small></td>
                <td>{t.mock}</td><td>{t.votes}</td>
                <td>{t.hidden ? <Badge tone="bad">Hidden</Badge> : t.verified ? <Badge tone="good">Verified</Badge> : <Badge>Live</Badge>}{t.reports > 0 && <><br /><small className="sx-bad">{t.reports} report{t.reports > 1 ? 's' : ''}</small></>}{t.hidden && t.hiddenWhy && <><br /><small className="muted">{t.hiddenWhy}</small></>}</td>
                <td className="sx-acts">
                  {t.hidden ? <button className="btn btn-ghost btn-sm" onClick={() => act(t.id, 'unhide', 'Restored')}>Restore</button> : <button className="btn btn-ghost btn-sm" onClick={() => act(t.id, 'hide', 'Hidden')}>Hide</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => act(t.id, 'verify', t.verified ? 'Unverified' : 'Verified')}>{t.verified ? 'Unverify' : 'Verify'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Delete this trick for good?') && act(t.id, 'delete', 'Deleted')}>Delete</button>
                </td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
