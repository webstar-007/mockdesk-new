import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, ConfirmModal, Empty, Err, Loading, PageHead, Stat, ago, dt, toast, useLoad } from './ui.jsx';
import { Switch } from '../components/Motion.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const DUR = [[15, '15 minutes'], [60, '1 hour'], [1440, '24 hours'], [0, 'Until I remove it']];
const left = (ms) => (ms == null ? 'Until removed' : ms > 3600000 ? `${Math.round(ms / 3600000)} h left` : `${Math.max(1, Math.round(ms / 60000))} min left`);

/** Requests per minute for the last hour. Red marks minutes when someone was slowed down. */
function Line({ line }) {
  const max = Math.max(10, ...line.map((x) => x.n)); const W = 600, H = 120, bw = W / line.length;
  return (
    <svg className="ab-chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Requests per minute over the last hour. Busiest minute ${fmt(max)}.`} preserveAspectRatio="none">
      {line.map((x, i) => { const h = Math.max(x.n ? 2 : 0, (x.n / max) * H); return <g key={i}><rect x={i * bw + 0.5} y={H - h} width={Math.max(1, bw - 1)} height={h} className={x.throttled || x.blocked ? 'bad' : ''} rx="1"><title>{new Date(x.minute).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}: {fmt(x.n)} requests{x.throttled ? `, ${x.throttled} slowed down` : ''}{x.blocked ? `, ${x.blocked} refused` : ''}</title></rect></g>; })}
      <text x="0" y={H + 14} className="ab-ax">60 min ago</text><text x={W} y={H + 14} textAnchor="end" className="ab-ax">now</text><text x="0" y="10" className="ab-ax">{fmt(max)}/min</text>
    </svg>
  );
}

function Rules({ d, onSaved }) {
  const [c, setC] = useState({ ...d.config, trusted: d.config.trusted.join('\n') }); const [busy, setBusy] = useState(false); const C = d.ceil; const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const save = async (reset) => { setBusy(true); try { await api.put('/admin/abuse/config', reset ? { reset: true } : { ...c, trusted: c.trusted.split(/[\s,]+/).filter(Boolean) }); toast(reset ? 'Back to defaults' : 'Rules saved'); onSaved(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const N = ({ k, label, hint, max }) => <label className="ad-field">{label}<input type="number" min="1" max={max} value={c[k]} onChange={(e) => set(k, Number(e.target.value))} /><small className="muted">{hint}</small></label>;
  return (
    <section className="card ab-rules" aria-label="Rules">
      <h3>Rules</h3>
      <Switch checked={c.enabled} onChange={(v) => set('enabled', v)} label="Slow down addresses that send too many requests" hint="They get a polite “try again in a moment” instead of the page. Everyone else is unaffected." />
      <div className="ad-grid g3">
        <N k="perIpPerMin" label="Any requests per minute" max={C.perIpPerMin} hint="Per address. A busy school network shares one address, so keep this generous." />
        <N k="heavyPerMin" label="Downloads and exports per minute" max={C.heavyPerMin} hint="PDF reports, exports, backups." />
        <N k="authPerMin" label="Sign-in and sign-up per minute" max={C.authPerMin} hint="Stops password guessing and code flooding." />
      </div>
      <Switch checked={c.autoBlock} onChange={(v) => set('autoBlock', v)} label="Pause an address automatically if it keeps going" hint="After it is slowed down again and again, it is blocked for a while. You can lift it any time." />
      {c.autoBlock && <div className="ad-grid g3"><N k="autoAfter" label="Block after this many slow-downs" max={C.autoAfter} hint="Counted over 10 minutes." /><N k="autoMinutes" label="Block for (minutes)" max={C.autoMinutes} hint="1440 is one day." /></div>}
      <label className="ad-field">Trusted addresses<textarea rows={3} value={c.trusted} onChange={(e) => set('trusted', e.target.value)} /><small className="muted">One per line. These are never slowed down or blocked: your office, your own server. Use <code>203.0.113.*</code> for a range. Your address is {d.yourIp}.</small></label>
      <div className="ad-row"><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(false)}>Save rules</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(true)}>Back to defaults</button></div>
    </section>
  );
}

function Host({ h, d, onBlock, onTrust }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={`ab-row ${h.signals.some((s) => s.level === 'bad') ? 'bad' : h.signals.length ? 'warn' : ''}`}>
        <td className="nm"><button type="button" className="ab-ip" aria-expanded={open} onClick={() => setOpen(!open)}><b>{h.ip}</b></button><small>{ago(h.last)}</small></td>
        <td className="num">{fmt(h.total60)}<small>{fmt(h.last5)} in 5 min</small></td><td className="num">{fmt(h.peakPerMin)}</td><td className="num">{h.e4 + h.e5 ? fmt(h.e4 + h.e5) : '–'}</td><td className="num">{h.throttled ? <b className="c-bad">{h.throttled}</b> : '–'}</td>
        <td>{h.blocked ? <Badge tone="bad">Blocked</Badge> : h.trusted ? <Badge tone="good">Trusted</Badge> : h.signals.length ? h.signals.slice(0, 2).map((s) => <Badge key={s.key} tone={s.level === 'bad' ? 'bad' : 'warn'}>{({ guessing: 'Password guessing', failed: 'Failed sign-ins', many_accounts: 'Many accounts', probing: 'Probing', heavy: 'Many downloads', throttled: 'Slowed down' })[s.key]}</Badge>) : <span className="muted small">Normal</span>}</td>
        <td className="ab-act">{!h.blocked && !h.trusted && <select aria-label={`Block ${h.ip}`} value="" onChange={(e) => { if (e.target.value !== '') onBlock(h.ip, Number(e.target.value)); }}><option value="">Block…</option>{DUR.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>}</td>
      </tr>
      {open && <tr className="ab-more"><td colSpan="7"><div className="ab-detail">
        {h.signals.length > 0 && <ul>{h.signals.map((s) => <li key={s.key} className={`t-${s.level}`}>{s.text}</li>)}</ul>}
        <div><b className="small">Most requested pages</b><ul className="plain">{h.paths.map((p) => <li key={p.path}><code>{p.path}</code> <span className="muted">{fmt(p.n)}</span></li>)}</ul></div>
        <div className="small muted">{h.users ? `${h.users} signed-in account${h.users > 1 ? 's' : ''}. ` : 'No signed-in accounts. '}First seen {ago(h.first)}.<br />{h.ua || 'No browser name sent.'}</div>
        {!h.trusted && !h.blocked && <div className="ad-row"><button className="btn btn-ghost btn-sm" onClick={() => onTrust(h.ip)}>Never limit this address</button></div>}
      </div></td></tr>}
    </>
  );
}

export default function Abuse() {
  const { data: d, err, loading, reload } = useLoad('/admin/abuse'); const [auto, setAuto] = useState(true); const [only, setOnly] = useState(false); const [ask, setAsk] = useState(null); const [manual, setManual] = useState({ ip: '', minutes: 60, reason: '' });
  useEffect(() => { if (!auto) return undefined; const t = setInterval(reload, 10000); return () => clearInterval(t); }, [auto, reload]);
  const rows = useMemo(() => (d?.hosts || []).filter((h) => !only || h.signals.length || h.blocked), [d, only]);
  if (loading && !d) return <Loading />; if (err && !d) return <Err>{err}</Err>;
  const block = async (ip, minutes, reason = '') => { try { await api.post('/admin/abuse/block', { ip, minutes, reason }); toast(`${ip} blocked`); setAsk(null); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const unblock = async (ip) => { try { await api.post('/admin/abuse/unblock', { ip }); toast(`${ip} can use the site again`); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const trust = async (ip) => { try { await api.put('/admin/abuse/config', { trusted: [...d.config.trusted, ip] }); toast(`${ip} is now trusted`); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const proxyHint = d.totals.addresses === 0 && d.totals.requests60 > 50;
  return (
    <>
      <PageHead title="Abuse and rate limits" sub="Who is sending the most requests, who is being slowed down, and who you have paused.">
        <button className={`btn btn-ghost ${auto ? 'on' : ''}`} aria-pressed={auto} onClick={() => setAuto(!auto)}>{auto ? 'Live: every 10 s' : 'Paused'}</button><button className="btn btn-ghost" onClick={reload}>↻ Refresh</button>
      </PageHead>
      <Err>{err}</Err>
      {!d.config.enabled && <p className="alert" role="status">Rate limiting is off. Requests are still counted, but nobody is slowed down. Turn it on under Rules.</p>}
      {proxyHint && <p className="alert" role="status">Every visitor looks like the same trusted address, so nobody can be limited. If the site sits behind Nginx or Caddy, set <code>MOCKDESK_TRUST_PROXY=1</code> and restart.</p>}
      <div className="ad-grid g4" style={{ marginBottom: 14 }}>
        <Stat icon="📈" label="Requests, last hour" value={d.totals.requests60} /><Stat icon="🐢" tone={d.totals.throttled60 ? 'warn' : ''} label="Slowed down" value={d.totals.throttled60} sub="asked to wait" />
        <Stat icon="⛔" tone={d.totals.blocked60 ? 'bad' : ''} label="Refused (blocked)" value={d.totals.blocked60} /><Stat icon="🚩" tone={d.totals.flagged ? 'warn' : ''} label="Addresses to look at" value={d.totals.flagged} sub={`of ${fmt(d.totals.addresses)} seen`} />
      </div>
      <section className="card" style={{ marginBottom: 14 }}><h3 style={{ marginTop: 0 }}>Requests per minute</h3><Line line={d.line} /><p className="small muted" style={{ margin: 0 }}>Red bars are minutes when someone was slowed down or refused. Admin pages and trusted addresses are counted but never limited.</p></section>
      <div className="ab-cols">
        <div className="ab-main">
          <section className="card nopad">
            <div className="ab-h"><h3>Addresses</h3><div className="dash-seg" role="group" aria-label="Show">{[[false, 'All'], [true, 'Needs a look']].map(([k, l]) => <button key={l} className={only === k ? 'on' : ''} aria-pressed={only === k} onClick={() => setOnly(k)}>{l}</button>)}</div></div>
            {!rows.length ? <Empty>{only ? 'Nothing unusual in the last hour.' : 'No visitors seen yet. They appear here as they use the site.'}</Empty> : (
              <div style={{ overflowX: 'auto' }}><table className="ad-table ab-t"><thead><tr><th>Address</th><th className="num">Requests (1 h)</th><th className="num">Peak per min</th><th className="num">Errors</th><th className="num">Slowed</th><th>Signals</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{rows.map((h) => <Host key={h.ip} h={h} d={d} onBlock={(ip, m) => setAsk({ ip, minutes: m })} onTrust={trust} />)}</tbody></table></div>)}
          </section>
          <section className="card ab-blocks"><h3>Paused addresses</h3>
            {!d.blocks.length ? <p className="muted small">None. Pause an address from the table, or add one here.</p> : <ul className="plain">{d.blocks.map((b) => <li key={b.ip}><span><b>{b.ip}</b> {b.auto && <Badge tone="warn">automatic</Badge>}<small className="muted"> {left(b.left)}{b.reason ? ` · ${b.reason}` : ''}{b.by ? ` · by ${b.by}` : ''}</small></span><button className="btn btn-ghost btn-sm" onClick={() => unblock(b.ip)}>Let back in</button></li>)}</ul>}
            <form className="ab-add" onSubmit={(e) => { e.preventDefault(); block(manual.ip.trim(), manual.minutes, manual.reason); setManual({ ...manual, ip: '', reason: '' }); }}>
              <input aria-label="Address to pause" placeholder="203.0.113.7 or 203.0.113.*" value={manual.ip} onChange={(e) => setManual({ ...manual, ip: e.target.value })} />
              <select aria-label="For how long" value={manual.minutes} onChange={(e) => setManual({ ...manual, minutes: Number(e.target.value) })}>{DUR.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
              <input aria-label="Reason" placeholder="Reason (optional)" maxLength={120} value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} />
              <button className="btn btn-ghost btn-sm" disabled={!manual.ip.trim()}>Pause</button>
            </form>
          </section>
        </div>
        <div className="ab-side">
          <Rules key={JSON.stringify(d.config)} d={d} onSaved={reload} />
          <section className="card ab-feed"><h3>What happened</h3>{!d.events.length ? <p className="muted small">Nothing yet.</p> : <ol className="lt-feed">{d.events.map((e, i) => <li key={`${e.at}-${i}`} className={e.kind === 'unblock' ? 't-good' : e.kind === 'throttled' ? 't-warn' : 't-bad'}><time>{dt(e.at).split(',').pop()}</time><span><b>{e.ip}</b> {e.detail}</span></li>)}</ol>}</section>
        </div>
      </div>
      {ask && <ConfirmModal title={`Pause ${ask.ip}?`} label="Pause" danger onClose={() => setAsk(null)} onConfirm={() => block(ask.ip, ask.minutes)}>Anyone on this address will see “Access from this address is paused” on every page. {ask.minutes ? `It lifts by itself after ${DUR.find((x) => x[0] === ask.minutes)?.[1]}.` : 'It stays until you let it back in.'} A school or office can share one address, so check the numbers first.</ConfirmModal>}
    </>
  );
}
