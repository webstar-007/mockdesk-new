/** The script an admin downloads and runs on their own computer. Plain Node 18+, no installs. */
export const CLIENT = String.raw`#!/usr/bin/env node
// MockDesk laptop load test. Needs Node 18 or newer. Nothing to install.
// Run:  node mockdesk-loadtest.mjs        Stop early with Ctrl+C (the result so far is still saved).
const CFG = __CFG__;
const BASE = CFG.base, KEY = CFG.key;
const T = process.stdout.isTTY ? { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' } : { g: '', y: '', r: '', b: '', d: '', x: '' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
const now = () => performance.now();
const round = (v) => Math.round(v * 10) / 10;
async function call(method, path, opt) {
  opt = opt || {}; const t0 = now();
  try {
    const res = await fetch(BASE + path, { method, headers: Object.assign({ 'content-type': 'application/json', 'x-loadtest': KEY }, opt.sid ? { cookie: 'sid=' + opt.sid } : {}), body: opt.body ? JSON.stringify(opt.body) : undefined, signal: AbortSignal.timeout(30000) });
    const txt = await res.text(); let json = null; try { json = JSON.parse(txt); } catch (e) { /* not json */ }
    return { ms: now() - t0, status: res.status, ok: res.ok, json };
  } catch (e) { return { ms: now() - t0, status: 0, ok: false, error: (e.cause && e.cause.code) || e.message }; }
}
const what = { signin: 'Sign-in rush', browse: 'Everyday browsing', both: 'Sign-ins and browsing' }[CFG.test];
const line = (s) => console.log(s);
const bar = (s) => { line(''); line(T.b + s + T.x); };

async function main() {
  line(T.b + 'MockDesk laptop test' + T.x + ': ' + what + ', ' + CFG.people + ' people for ' + CFG.seconds + ' seconds');
  line(T.d + 'Target: ' + BASE + T.x);
  if (typeof fetch !== 'function') { line(T.r + 'This needs Node 18 or newer. Get it from nodejs.org.' + T.x); process.exit(1); }
  const rtts = [];
  for (let i = 0; i < 5; i++) {
    const r = await call('GET', '/api/health');
    if (!r.ok && i === 0) { line(T.r + 'Cannot reach ' + BASE + ' (' + (r.error || 'HTTP ' + r.status) + '). Check the address and your internet.' + T.x); process.exit(1); }
    rtts.push(r.ms); await sleep(150);
  }
  rtts.sort((a, b) => a - b); const rtt = round(rtts[Math.floor(rtts.length / 2)]);
  line('Your connection to the server: about ' + rtt + ' ms round trip. The times below include this.');
  const j = await call('POST', '/api/lt/join', { body: { key: KEY, node: process.version, os: process.platform + ' ' + process.arch, rtt } });
  if (!j.ok) { line(T.r + ((j.json && j.json.error) || 'Could not start (HTTP ' + j.status + ')') + T.x); process.exit(1); }
  const users = j.json.users, pages = j.json.pages, password = j.json.password;
  line('Created ' + users.length + ' temporary test accounts. They are deleted when the test ends.');

  const kinds = {}; const all = []; const samples = []; let stop = false; let active = 0; let done = 0; let fail = 0; let recent = [];
  const record = (kind, r) => {
    const k = kinds[kind] || (kinds[kind] = { n: 0, err: 0, lat: [] });
    k.n++; if (!r.ok) { k.err++; fail++; } k.lat.push(r.ms); all.push(r.ms); done++; recent.push([now(), r.ms]);
  };
  process.on('SIGINT', () => { if (stop) process.exit(1); stop = true; line(T.y + '\nStopping and saving what was measured…' + T.x); });
  const t0 = now(); const endAt = t0 + CFG.seconds * 1000;
  const rampMs = CFG.test === 'signin' ? Math.min(3000, CFG.seconds * 100) : Math.min(CFG.seconds * 150, 15000);
  const perMin = { login: CFG.test === 'signin' ? 4 : CFG.test === 'both' ? 1 : 0, page: CFG.test === 'signin' ? 0 : 6 };
  const gap = (m) => (m ? (60000 / m) * (0.5 + Math.random()) : Infinity);
  const worker = async (u) => {
    await sleep(Math.random() * rampMs); if (stop) return; active++;
    try {
      if (CFG.test !== 'browse') record('login', await call('POST', '/api/auth/login', { body: { email: u.email, password, remember: false } }));
      const due = { login: now() + gap(perMin.login), page: now() + gap(perMin.page) };
      while (!stop && now() < endAt) {
        const next = Math.min(due.login, due.page, endAt);
        while (!stop && now() < next) await sleep(Math.min(250, Math.max(1, next - now())));
        if (stop || now() >= endAt) break;
        if (due.login <= due.page) { record('login', await call('POST', '/api/auth/login', { body: { email: u.email, password, remember: false } })); due.login = now() + gap(perMin.login); }
        else { const p = pages[Math.floor(Math.random() * pages.length)]; record('page:' + p, await call('GET', '/api' + p, { sid: u.sid })); due.page = now() + gap(perMin.page); }
      }
    } finally { active--; }
  };
  let lastDone = 0;
  const timer = setInterval(() => {
    const t = now(); recent = recent.filter((x) => t - x[0] < 5000); const lat = recent.map((x) => x[1]).sort((a, b) => a - b);
    const rps = done - lastDone; lastDone = done; const sec = Math.round((t - t0) / 1000);
    samples.push({ t: sec, users: active, rps, p95: round(pct(lat, 95)), err: fail });
    if (sec % 5 === 0) line('  ' + String(sec).padStart(3) + ' s   active ' + String(active).padStart(4) + '   requests/s ' + String(rps).padStart(4) + '   slower waits ' + String(Math.round(pct(lat, 95))).padStart(5) + ' ms   failed ' + fail);
  }, 1000);
  bar('Running…');
  await Promise.all(users.map(worker)); clearInterval(timer);

  const sum = (a) => { const s = a.slice().sort((x, y) => x - y); return { p50: round(pct(s, 50)), p95: round(pct(s, 95)), p99: round(pct(s, 99)), max: round(s[s.length - 1] || 0) }; };
  const out = {}; let pageLat = [];
  for (const k of Object.keys(kinds)) { const v = kinds[k]; out[k] = Object.assign({ n: v.n, err: v.err }, sum(v.lat)); if (k.indexOf('page:') === 0) pageLat = pageLat.concat(v.lat); }
  const result = { kinds: out, pages: pageLat.length ? Object.assign({ n: pageLat.length }, sum(pageLat)) : null, all: sum(all), requests: done, errors: fail, samples, rtt, seconds: Math.round((now() - t0) / 1000), stopped: stop, node: process.version, os: process.platform + ' ' + process.arch };
  const f = await call('POST', '/api/lt/finish', { body: { key: KEY, result } });
  if (!f.ok) { line(T.r + ((f.json && f.json.error) || 'Could not save the result (HTTP ' + f.status + ')') + T.x); process.exit(1); }
  const s = f.json; const col = (st) => (st === 'good' || st === 'ok' ? T.g : st === 'warn' ? T.y : T.r);
  bar(s.score + ' / 100  ' + s.band + ': ' + s.title);
  line(s.text); if (s.room) line(s.room);
  line('');
  for (const a of s.areas) line('  ' + col(a.status) + '●' + T.x + ' ' + a.label.padEnd(24) + String(a.value).padEnd(14) + T.d + a.say + T.x);
  if (s.fixes.length) { line(''); line(T.b + 'What to do' + T.x); s.fixes.forEach((x, i) => line('  ' + (i + 1) + '. ' + x)); }
  line(''); line(T.d + 'Saved. Open it in Admin > Server > Server tools > Load test > Saved results.' + T.x);
}
main().catch((e) => { console.error(e); process.exit(1); });
`;
