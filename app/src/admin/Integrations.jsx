import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Err, Loading, PageHead, toast, useLoad } from './ui.jsx';

function Group({ g, status, reload, email }) {
  const providerKey = g.fields.find((f) => /PROVIDER$/.test(f.key))?.key;
  const [draft, setDraft] = useState({}); const [busy, setBusy] = useState(false); const [to, setTo] = useState(g.id === 'email' ? email : ''); const [res, setRes] = useState(null);
  const cur = (f) => (f.key in draft ? draft[f.key] : f.value);
  const provider = providerKey ? cur(g.fields.find((f) => f.key === providerKey)) : null;
  const shown = g.fields.filter((f) => f.when === undefined || f.when === provider);
  const dirty = Object.keys(draft).length > 0;
  const save = async () => { setBusy(true); setRes(null); try { await api.put('/admin/credentials', { values: draft }); toast('Saved. The change is live now.'); setDraft({}); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const remove = async (f) => { if (!window.confirm(`Remove the saved ${f.label}?`)) return; try { await api.put('/admin/credentials', { clear: [f.key] }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const test = async () => { setBusy(true); setRes(null); try { const r = await api.post(`/admin/credentials/test/${g.id}`, { to }); setRes({ ok: true, text: r.message }); } catch (e) { setRes({ ok: false, text: e.message }); } finally { setBusy(false); } };
  const needsTo = ['email', 'sms', 'whatsapp'].includes(g.id); const canTest = ['email', 'sms', 'whatsapp', 'ai'].includes(g.id);
  return (
    <section className="card int-card">
      <div className="int-h"><h3>{g.name}</h3>{status && (status.on ? <Badge tone="good">Connected</Badge> : <Badge tone="mute">Not set up</Badge>)}</div>
      <p className="small muted">{g.help}</p>
      {status?.detail && <p className="small">{status.detail}</p>}
      <div className="ad-grid g2 int-fields">
        {shown.map((f) => (
          <label className="ad-field" key={f.key}>{f.label}
            {f.type === 'select'
              ? <select value={cur(f)} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : <input type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck="false" value={cur(f)} placeholder={f.secret && f.set ? `${f.hint} saved. Type to replace` : f.ph} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />}
            <small className="muted">{f.source === 'admin' ? 'Saved here' : f.source === 'server' ? 'Using the server setting. Save here to override it.' : 'Not set'}
              {f.secret && f.source === 'admin' && <> · <button type="button" className="linklike" onClick={() => remove(f)}>Remove</button></>}</small>
          </label>))}
      </div>
      <div className="ad-toolbar" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Working…' : 'Save'}</button>
        {dirty && <button className="btn btn-ghost" onClick={() => setDraft({})}>Undo changes</button>}
        {canTest && <>{needsTo && <input className="grow" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send test to" placeholder={g.id === 'email' ? 'you@example.com' : '+919876543210'} />}<button className="btn btn-ghost" disabled={busy || dirty} title={dirty ? 'Save first' : ''} onClick={test}>{g.id === 'ai' ? 'Test the key' : 'Send a test'}</button></>}
      </div>
      {res && <p className={`small ${res.ok ? 'int-ok' : 'int-bad'}`} role="status">{res.ok ? '✓ ' : '✕ '}{res.text}</p>}
    </section>
  );
}

export default function Integrations() {
  const { user } = useAuth(); const a = useLoad('/admin/credentials'); const b = useLoad('/admin/integrations');
  if ((a.loading && !a.data) || (b.loading && !b.data)) return <Loading />; if (a.err || b.err) return <Err>{a.err || b.err}</Err>;
  const st = Object.fromEntries(b.data.items.map((i) => [i.key, i])); const reload = () => { a.reload(); b.reload(); };
  return (
    <>
      <PageHead title="Integrations and keys" sub="Connect email, SMS, WhatsApp and AI by typing the details here. No server access or restart needed." />
      <p className="small muted" style={{ marginTop: -6 }}>🔒 Keys are stored encrypted and are never shown again after saving. Anything you save here overrides the same setting on the server.</p>
      <div className="int-list">{a.data.groups.map((g) => <Group key={g.id} g={g} status={st[g.id]} reload={reload} email={user?.email || ''} />)}</div>
    </>
  );
}
