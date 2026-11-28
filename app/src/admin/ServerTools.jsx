import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import LoadTest from './LoadTest.jsx';
import Health from './System.jsx';
import WhatsNew, { newsSeen } from './WhatsNew.jsx';
import { Badge, ConfirmModal, Empty, Err, Loading, PageHead, Stat, ago, dt, toast, useLoad } from './ui.jsx';

const bytes = (b) => (b == null ? '–' : b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
const span = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const TABS = [['overview', 'Health and restart'], ['database', 'Database'], ['logs', 'Logs'], ['load', 'Load test'], ['new', 'What’s new']];

export default function ServerTools() {
  const [tab, setTab] = useState('overview'); const { data: info } = useLoad('/admin/server/info'); const [, bump] = useState(0);
  const fresh = info?.changelog?.[0] && Number(String(info.changelog[0].version).replace(/\D/g, '')) > (Number(String(newsSeen()).replace(/\D/g, '')) || 0);
  return (
    <>
      <PageHead title="Server tools" sub="Check the server is healthy, restart the app, look after the database, read logs, and test how many students it can handle." />
      <nav className="ad-tabs" aria-label="Server tools">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{k === 'new' && fresh && <span className="wn-pip" aria-label="new" />}</button>)}</nav>
      {tab === 'overview' && <Overview />}{tab === 'database' && <Database />}{tab === 'logs' && <Logs />}{tab === 'load' && <LoadTest />}{tab === 'new' && <WhatsNew onSeen={() => bump((n) => n + 1)} />}
    </>
  );
}

function Overview() {
  const { data: d, err, loading, reload } = useLoad('/admin/server/info');
  const [dlg, setDlg] = useState(false); const [down, setDown] = useState(false); const [busy, setBusy] = useState(false); const [cancelling, setCancelling] = useState(false);
  useEffect(() => { if (!down) return undefined; let n = 0; const t = setInterval(async () => { n++; try { await api.get('/config'); if (n > 2) window.location.reload(); } catch { /* still restarting */ } if (n > 60) setDown(false); }, 2000); return () => clearInterval(t); }, [down]);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const restart = async () => { setBusy(true); try { await api.post('/admin/server/restart', { confirm: 'restart' }); setDlg(false); setDown(true); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  if (down) return <section className="card" role="status"><h3>Restarting…</h3><p className="muted">The app is starting again. This page reloads by itself as soon as it is back, usually within 10 seconds.</p></section>;
  return (
    <>
      {d.staged && <div className="alert" role="status"><b>A restored backup is waiting.</b> It is applied when the server restarts. <button className="btn btn-ghost btn-sm" disabled={cancelling} onClick={async () => { setCancelling(true); try { await api.del('/admin/server/restore'); toast('Restore cancelled'); reload(); } finally { setCancelling(false); } }}>Cancel restore</button></div>}
      <Health embedded />
      <section className="card" style={{ marginTop: 14 }}>
        <h3>Restart the app</h3>
        <p className="muted">A restart takes about 10 seconds. Students in a test keep their answers and timer, and the page reconnects. Use it after changing keys that need a fresh start, or if something looks stuck.</p>
        {!d.canRestart && <p className="alert" role="status">{d.restartHint}</p>}
        <button className="btn btn-danger" disabled={!d.canRestart} onClick={() => setDlg(true)}>Restart now</button>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <h3>Running now</h3>
        <dl className="sx-kv"><div><dt>MockDesk version</dt><dd>{d.app}{d.latest && <> <Badge tone="brand">{d.latest}</Badge></>}</dd></div><div><dt>Node.js</dt><dd>{d.node}</dd></div><div><dt>System</dt><dd>{d.platform}</dd></div><div><dt>Mode</dt><dd>{d.mode}</dd></div><div><dt>Built</dt><dd>{d.builtAt ? dt(d.builtAt) : 'not built here'}</dd></div></dl>
        <p className="small muted" style={{ marginBottom: 0 }}>To install a newer version, replace the <code>app/</code> folder and run the Jenkins <code>update</code> job. See “What’s new” for what each version changed.</p>
      </section>
      {dlg && <ConfirmModal title="Restart MockDesk?" word="restart" label="Restart" danger busy={busy} onClose={() => setDlg(false)} onConfirm={restart}><p>The site is unavailable for a few seconds. Avoid doing this during a live test window.</p></ConfirmModal>}
    </>
  );
}

function Database() {
  const { data: d, err, loading, reload } = useLoad('/admin/server/db'); const [busy, setBusy] = useState(''); const [res, setRes] = useState(null);
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  const act = async (k, url, done) => { setBusy(k); setRes(null); try { const r = await api.post(url); setRes(done(r)); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); } };
  const max = Math.max(1, ...d.tables.map((t) => t.bytes ?? t.rows));
  return (
    <>
      <div className="ad-grid g4">
        <Stat icon="🗄" label="Database size" value={bytes(d.size + d.wal)} sub={d.file} /><Stat icon="♻" label="Can be reclaimed" value={bytes(d.reclaimable)} sub="by optimising" />
        <Stat icon="💾" label="Disk free" value={d.disk ? bytes(d.disk.free) : '–'} sub={d.disk ? `of ${bytes(d.disk.total)}` : ''} tone={d.disk && d.disk.free / d.disk.total < 0.1 ? 'bad' : ''} /><Stat icon="🛠" label="Last optimised" value={d.lastOptimized ? ago(d.lastOptimized) : 'never'} />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <h3>Maintenance</h3>
        <p className="muted">Optimising packs the database file and refreshes its search indexes, which keeps pages fast as data grows. It pauses writes for a moment, so do it when few students are online. A backup is not needed first, but one is cheap: <Link to="/admin/data">Data and backup</Link>.</p>
        <div className="ad-pill-row"><button className="btn btn-primary" disabled={!!busy} onClick={() => act('opt', '/admin/server/db/optimize', (r) => ({ ok: true, text: `Done. ${r.saved > 0 ? `Saved ${bytes(r.saved)}.` : 'The file was already compact.'}` }))}>{busy === 'opt' ? 'Optimising…' : 'Optimise now'}</button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={() => act('chk', '/admin/server/db/check', (r) => ({ ok: r.ok, text: r.ok ? 'The database passed its integrity check.' : `Problems found: ${r.messages.join('; ')}` }))}>{busy === 'chk' ? 'Checking…' : 'Check for damage'}</button></div>
        {res && <p className={res.ok ? 'ad-ok' : 'alert'} role="status" style={{ marginTop: 12 }}>{res.text}</p>}
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <h3>What takes the space</h3>
        {!d.tables.length ? <Empty>No tables.</Empty> : <ul className="ad-tblsize">{d.tables.slice(0, 14).map((t) => <li key={t.name}><span>{t.name}</span><i aria-hidden="true"><u style={{ width: `${Math.max(1, ((t.bytes ?? t.rows) / max) * 100)}%` }} /></i><b>{t.rows.toLocaleString()} rows{t.bytes != null && <small className="muted"> · {bytes(t.bytes)}</small>}</b></li>)}</ul>}
      </section>
    </>
  );
}

function Logs() {
  const [level, setLevel] = useState('all'); const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [auto, setAuto] = useState(false); const [clear, setClear] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ level, q: dq, limit: 300 }).toString(); const { data: d, err, loading, reload } = useLoad(`/admin/server/logs?${qs}`, [qs]);
  useEffect(() => { if (!auto) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [auto, reload]);
  return (
    <>
      <div className="ad-toolbar">
        <div className="tc-seg" role="group" aria-label="Level">{[['all', 'All'], ['warn', 'Warnings'], ['error', 'Errors']].map(([k, l]) => <button key={k} className={level === k ? 'on' : ''} aria-pressed={level === k} onClick={() => setLevel(k)}>{l}</button>)}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the log" aria-label="Search the log" />
        <label className="sx-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Refresh every 5 seconds</label>
        <button className="btn btn-ghost btn-sm" onClick={reload}>Refresh</button><a className="btn btn-ghost btn-sm" href={`/api/admin/server/logs.txt?level=${level}&q=${encodeURIComponent(dq)}`} download>Download</a><button className="btn btn-ghost btn-sm dng" onClick={() => setClear(true)}>Clear</button>
      </div>
      {err && <Err>{err}</Err>}{loading && !d ? <Loading /> : !d?.lines.length ? <Empty>Nothing logged yet{dq || level !== 'all' ? ' for this filter' : ''}. This view shows the most recent lines since the last restart. The full history is in the service log.</Empty>
        : <div className="ad-log" role="log" aria-label="Server log">{d.lines.map((l) => <div key={l.id} className={`l-${l.level}`}><time>{new Date(l.at).toLocaleTimeString()}</time><b>{l.level}</b><span>{l.msg}</span></div>)}</div>}
      <p className="small muted">Keys, tokens and passwords are hidden automatically. Showing the newest 300 matching lines of the last 1,000.</p>
      {clear && <ConfirmModal title="Clear the log view?" label="Clear" onClose={() => setClear(false)} onConfirm={async () => { await api.del('/admin/server/logs'); setClear(false); reload(); }}><p>This only empties the view. The service log on the server keeps its history.</p></ConfirmModal>}
    </>
  );
}

