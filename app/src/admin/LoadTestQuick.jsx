import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Dialog, Err, toast } from './ui.jsx';

const TESTS = [['signin', '🔑', 'Sign-in rush', 'Everyone signs in at once.'], ['browse', '🧭', 'Browsing', 'People open dashboard pages.'], ['both', '🌐', 'Both', 'Browsing with sign-ins mixed in.']];
const PEOPLE = [25, 50, 100, 250, 500];
const SECS = [30, 60, 120, 300];

/** One-click starting points above the full setup. */
export function QuickStart({ info, d, setForm, onStart, onLaptop }) {
  const L = info.limits; const hasMock = info.mocks.length > 0; const [n, setN] = useState(200);
  const go = (patch) => { setForm((f) => ({ ...d.defaults, mockId: f.mockId, targets: f.targets, custom: [], ...patch })); onStart(); };
  return (
    <section className="card lx-quick" aria-label="Quick start">
      <h3>Start here</h3>
      <div className="lx-qgrid">
        <div className="lx-q"><span aria-hidden="true">⚡</span><b>Quick check</b><small>30 seconds, 30 people browsing and signing in. A fast health check after an update.</small>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => go({ focus: 'browse', users: 30, durationSec: 30, pattern: 'steady', browserPerMin: 6, signinPerMin: 1 })}>Run quick check</button></div>
        <div className="lx-q"><span aria-hidden="true">🎓</span><b>Exam-day check</b><small>Is the server ready for a live mock? Students open it, answer and submit together.</small>
          <label className="lx-qn">Students expected <input type="number" inputMode="numeric" min="1" max={L.users[1]} value={n} onChange={(e) => setN(Math.max(1, Math.min(L.users[1], Number(e.target.value) || 1)))} /></label>
          <button type="button" className="btn btn-primary btn-sm" disabled={!hasMock} title={hasMock ? '' : 'Create a mock first'} onClick={() => go({ focus: 'exam', users: n, durationSec: 120, pattern: 'spike' })}>Check for {n.toLocaleString('en-IN')}</button></div>
        <div className="lx-q"><span aria-hidden="true">📈</span><b>Find my limit</b><small>Adds more students every few seconds until it struggles, then tells you how many it can take.</small>
          <button type="button" className="btn btn-primary btn-sm" disabled={!hasMock} title={hasMock ? '' : 'Create a mock first'} onClick={() => go({ focus: 'exam', users: Math.min(L.users[1], 1000), durationSec: 180, pattern: 'ramp' })}>Find the limit</button></div>
        <div className="lx-q lx-q-lap"><span aria-hidden="true">💻</span><b>Test from my laptop</b><small>Download a small script and run it on your own computer. The requests cross the real internet, so it also tests your proxy and connection.</small>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onLaptop}>Set up</button></div>
      </div>
    </section>
  );
}

const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select the text and copy it', 'warn'); } };

/** Create a script, show how to run it, and follow its progress. */
export function RemoteModal({ onClose, onOpen }) {
  const [test, setTest] = useState('both'); const [people, setPeople] = useState(100); const [secs, setSecs] = useState(60);
  const [made, setMade] = useState(null); const [st, setSt] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const timer = useRef(null);
  const base = window.location.origin; const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const create = async () => { setBusy(true); setErr(''); try { const r = await api.post('/admin/loadtest/remote', { test, people, seconds: secs, base }); setMade(r); setSt({ state: 'waiting' }); } catch (e) { setErr(e.message); } setBusy(false); };
  const download = () => { const url = URL.createObjectURL(new Blob([made.script], { type: 'text/javascript' })); const a = document.createElement('a'); a.href = url; a.download = made.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  useEffect(() => {
    if (!made) return undefined;
    const poll = async () => { try { const s = await api.get('/admin/loadtest/remote'); setSt(s); if (s.state === 'done' || s.state === 'idle' || s.state === 'expired') return; } catch { /* retry */ } timer.current = setTimeout(poll, 2000); };
    timer.current = setTimeout(poll, 1500); return () => clearTimeout(timer.current);
  }, [made]);
  const cancel = async () => { try { await api.del('/admin/loadtest/remote'); } catch { /* already gone */ } onClose(); };
  return (
    <Dialog title="Test from my laptop" onClose={onClose} wide>
      {!made && <>
        <p className="muted">You run a small script on your own computer. It sends real requests to this site over your internet connection, so the times include your network, proxy and TLS. Temporary test accounts are created and deleted afterwards.</p>
        {local && <p className="alert">You opened the admin page on a local address. The script will try to reach {base}, which works only on this computer. Open the admin page from your public address (for example https://mocks.example.com) and try again.</p>}
        <fieldset className="lx-rf"><legend>What to test</legend><div className="lx-rt">{TESTS.map(([k, icon, name, text]) => <button key={k} type="button" role="radio" aria-checked={test === k} className={`lx-fc ${test === k ? 'on' : ''}`} onClick={() => setTest(k)}><span aria-hidden="true">{icon}</span><b>{name}</b><small>{text}</small></button>)}</div></fieldset>
        <fieldset className="lx-rf"><legend>How many people</legend><div className="lx-chips">{PEOPLE.map((x) => <button key={x} type="button" className={people === x ? 'on' : ''} aria-pressed={people === x} onClick={() => setPeople(x)}>{x}</button>)}</div></fieldset>
        <fieldset className="lx-rf"><legend>How long</legend><div className="lx-chips">{SECS.map((x) => <button key={x} type="button" className={secs === x ? 'on' : ''} aria-pressed={secs === x} onClick={() => setSecs(x)}>{x < 60 ? `${x} s` : `${x / 60} min`}</button>)}</div></fieldset>
        <Err>{err}</Err>
        <div className="ad-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create the script'}</button></div>
      </>}
      {made && <>
        <ol className="lx-steps">
          <li><b>Download the script.</b> <button type="button" className="btn btn-ghost btn-sm" onClick={download}>Download {made.filename}</button><small className="muted">It contains a key that works once and stops after an hour. Do not share it.</small></li>
          <li><b>Open a terminal where you saved it and run:</b><div className="lx-cmd"><code>node {made.filename}</code><button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(`node ${made.filename}`)}>Copy</button></div><small className="muted">Needs Node 18 or newer (free from nodejs.org). Nothing else to install. Press Ctrl+C to stop early and still get a result.</small></li>
          <li><b>Come back here.</b> The result appears when it finishes.</li>
        </ol>
        <div className={`lx-rstate s-${st?.state}`} role="status" aria-live="polite">
          {st?.state === 'waiting' && <>⏳ Waiting for your laptop to start the script…</>}
          {st?.state === 'running' && <>🏃 Running from {st.from || 'your laptop'}. This takes about {made.cfg.seconds} seconds.</>}
          {st?.state === 'done' && <>✅ Finished. <button type="button" className="btn btn-primary btn-sm" onClick={() => { onOpen(st.reportId); onClose(); }}>See the result</button></>}
          {(st?.state === 'idle' || st?.state === 'expired') && <>The script expired or was cancelled. Create a new one.</>}
        </div>
        <div className="ad-actions">{st?.state === 'done' ? <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button> : <button type="button" className="btn btn-ghost" onClick={st?.state === 'running' ? onClose : cancel}>{st?.state === 'running' ? 'Close (the test keeps running)' : 'Cancel this script'}</button>}</div>
      </>}
    </Dialog>
  );
}
