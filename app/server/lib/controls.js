// Switches an admin can flip without a deploy: maintenance mode, sign-up rules, feature switches and blocked addresses.
export const FEATURES = {
  practice: 'Practice sets',
  referrals: 'Invite-a-friend rewards',
  shareLinks: 'Parent progress links',
  notebook: 'Mistake notebook and bookmarks',
};
export const CONTROL_DEFAULTS = {
  maintenance: { mode: 'off', message: '' },            // off | soft (no new tests or sign-ups) | hard (students locked out)
  signups: { open: true, domains: [], message: '' },     // domains: only these email domains may sign up (empty = anyone)
  features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])),
  blockedIps: [],                                         // exact addresses, or a prefix ending in * (1.2.3.*)
};
export function controlsOf(settings) {
  const s = settings.get('controls', {}) || {};
  return {
    maintenance: { ...CONTROL_DEFAULTS.maintenance, ...(s.maintenance || {}) },
    signups: { ...CONTROL_DEFAULTS.signups, ...(s.signups || {}), domains: Array.isArray(s.signups?.domains) ? s.signups.domains : [] },
    features: { ...CONTROL_DEFAULTS.features, ...(s.features || {}) },
    blockedIps: Array.isArray(s.blockedIps) ? s.blockedIps : [],
  };
}
const str = (v, n) => String(v ?? '').trim().slice(0, n);
export function cleanControls(b = {}, { myIp = '' } = {}) {
  const mode = ['off', 'soft', 'hard'].includes(b.maintenance?.mode) ? b.maintenance.mode : 'off';
  const domains = [...new Set((Array.isArray(b.signups?.domains) ? b.signups.domains : String(b.signups?.domains || '').split(/[\s,;]+/)).map((d) => str(d, 80).toLowerCase().replace(/^@/, '')).filter(Boolean))].slice(0, 50);
  for (const d of domains) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error(`"${d}" is not a valid email domain. Use something like college.edu.in`);
  const ips = [...new Set((Array.isArray(b.blockedIps) ? b.blockedIps : String(b.blockedIps || '').split(/[\s,;]+/)).map((x) => str(x, 64)).filter(Boolean))].slice(0, 200);
  for (const ip of ips) if (!/^[0-9a-fA-F:.]+\*?$/.test(ip)) throw new Error(`"${ip}" is not an IP address. Use 1.2.3.4, or 1.2.3.* for a range`);
  if (myIp && ips.some((ip) => ipBlocked(myIp, [ip]))) throw new Error('That would block your own address. Remove it from the list.');
  const features = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, b.features?.[k] !== false]));
  return { maintenance: { mode, message: str(b.maintenance?.message, 400) }, signups: { open: b.signups?.open !== false, domains, message: str(b.signups?.message, 300) }, features, blockedIps: ips };
}
export const ipBlocked = (ip, list) => !!ip && list.some((x) => (x.endsWith('*') ? String(ip).replace(/^::ffff:/, '').startsWith(x.slice(0, -1)) : String(ip).replace(/^::ffff:/, '') === x.replace(/^::ffff:/, '')));
/** Cache for the hot path (every request asks), refreshed within a few seconds of a change. */
export function makeControlsCache(settings, now = Date.now) {
  let at = 0, v = null;
  const get = () => { if (!v || now() - at > 3000) { v = controlsOf(settings); at = now(); } return v; };
  get.reset = () => { v = null; };
  return get;
}
export const emailAllowed = (email, c) => !c.signups.domains.length || c.signups.domains.includes(String(email || '').split('@')[1]?.toLowerCase());

// ---------- live traffic and server samples ----------
import { monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
const norm = (url) => String(url || '').split('?')[0].replace(/\/[0-9a-f]{12,}(?=\/|$)/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id');
export function makeMetrics(now = Date.now) {
  const mins = new Map(); const routes = new Map(); const samples = []; const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  let lastCpu = process.cpuUsage(), lastAt = process.hrtime.bigint();
  const sample = () => {
    const c = process.cpuUsage(), t = process.hrtime.bigint(); const cpu = (((c.user - lastCpu.user) + (c.system - lastCpu.system)) / 1000) / (Number(t - lastAt) / 1e6) * 100; lastCpu = c; lastAt = t;
    samples.push({ t: now(), cpu: Math.round(cpu / os.cpus().length * 10) / 10, rss: process.memoryUsage().rss, lag: Math.round(lag.percentile(99) / 1e6 * 10) / 10 }); lag.reset(); if (samples.length > 180) samples.shift();
  };
  sample(); setInterval(sample, 10000).unref();
  const record = (req, status, ms) => {
    const k = Math.floor(now() / 60000); let b = mins.get(k); if (!b) { b = { n: 0, e4: 0, e5: 0, sum: 0, lat: [] }; mins.set(k, b); for (const old of mins.keys()) if (old < k - 240) mins.delete(old); }
    b.n++; b.sum += ms; if (status >= 500) b.e5++; else if (status >= 400) b.e4++; if (b.lat.length < 400) b.lat.push(ms);
    const rk = `${req.method} ${norm(req.originalUrl)}`; let r = routes.get(rk); if (!r) { if (routes.size > 400) return; r = { n: 0, sum: 0, max: 0, e5: 0 }; routes.set(rk, r); } r.n++; r.sum += ms; r.max = Math.max(r.max, ms); if (status >= 500) r.e5++;
  };
  const middleware = (req, res, next) => { const t0 = process.hrtime.bigint(); res.on('finish', () => record(req, res.statusCode, Number(process.hrtime.bigint() - t0) / 1e6)); next(); };
  const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : 0);
  const snapshot = (minutes = 60) => {
    const k = Math.floor(now() / 60000); const series = [];
    for (let i = minutes - 1; i >= 0; i--) { const b = mins.get(k - i); series.push({ t: (k - i) * 60000, n: b?.n || 0, e4: b?.e4 || 0, e5: b?.e5 || 0, avg: b ? Math.round(b.sum / b.n) : 0, p95: b ? Math.round(p95(b.lat)) : 0 }); }
    const top = [...routes].map(([route, r]) => ({ route, n: r.n, avgMs: Math.round(r.sum / r.n * 10) / 10, maxMs: Math.round(r.max), errors: r.e5 })).sort((a, b) => b.avgMs * b.n - a.avgMs * a.n).slice(0, 12);
    const last5 = series.slice(-5); const n5 = last5.reduce((a, x) => a + x.n, 0);
    return { series, top, rpsNow: Math.round(n5 / 300 * 100) / 100, samples: samples.slice(-60), loadavg: os.loadavg().map((x) => Math.round(x * 100) / 100), cpus: os.cpus().length };
  };
  return { record, middleware, snapshot, reset: () => { mins.clear(); routes.clear(); } };
}

// ---------- background jobs: one list so the admin can see, run and pause each ----------
export function makeJobs(now = Date.now) {
  const m = new Map();
  const reg = (name, label, every, fn) => m.set(name, { name, label, every, fn, paused: false, last: null, lastMs: 0, lastError: '', runs: 0 });
  const run = async (name) => {
    const j = m.get(name); const t0 = now();
    try { const out = await j.fn(); j.last = t0; j.lastMs = now() - t0; j.lastError = ''; j.runs++; return { ok: true, result: typeof out === 'object' ? undefined : out }; }
    catch (e) { j.last = t0; j.lastError = String(e.message || e).slice(0, 200); return { ok: false, error: j.lastError }; }
  };
  return {
    reg, get: (n) => m.get(n), run, setPaused: (n, v) => { m.get(n).paused = v; },
    list: () => [...m.values()].map(({ fn, ...j }) => j),
    async runAll() { for (const j of m.values()) if (!j.paused) await run(j.name); },
  };
}
