// Request tracking and rate limiting. Counts every API request per address, throttles addresses that go over their limits,
// keeps temporary blocks, and reads the sign-in log for patterns such as password guessing.
// Everything about one address is kept in memory for the last hour only; blocks are saved so a restart does not lift them.

export const CEIL = { perIpPerMin: 100000, heavyPerMin: 10000, authPerMin: 10000, autoAfter: 100, autoMinutes: 10080, windowMin: 60 };
export const DEFAULTS = {
  enabled: true, perIpPerMin: 600, heavyPerMin: 30, authPerMin: 30, autoBlock: false, autoAfter: 10, autoMinutes: 30,
  trusted: ['127.0.0.1', '::1'],
};
const HEAVY = /(\/pdf\b|\/export\b|\/download\b|\/report\.pdf|\/backup)/i;
const AUTHP = /^\/auth\/(login|register|otp|forgot|reset|verify)/i;
const MIN = 60000;

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
export function cleanConfig(raw, base = DEFAULTS) {
  const c = { ...base, ...(raw || {}) };
  const trusted = Array.isArray(c.trusted) ? c.trusted.map((x) => String(x).trim()).filter(Boolean).slice(0, 50) : DEFAULTS.trusted;
  for (const t of trusted) if (!/^[0-9a-fA-F:.*]{2,45}$/.test(t)) throw new Error(`“${t}” is not an address. Use something like 203.0.113.7 or 203.0.113.*`);
  return {
    enabled: !!c.enabled, perIpPerMin: num(c.perIpPerMin, 10, CEIL.perIpPerMin, DEFAULTS.perIpPerMin), heavyPerMin: num(c.heavyPerMin, 1, CEIL.heavyPerMin, DEFAULTS.heavyPerMin),
    authPerMin: num(c.authPerMin, 3, CEIL.authPerMin, DEFAULTS.authPerMin), autoBlock: !!c.autoBlock, autoAfter: num(c.autoAfter, 1, CEIL.autoAfter, DEFAULTS.autoAfter),
    autoMinutes: num(c.autoMinutes, 1, CEIL.autoMinutes, DEFAULTS.autoMinutes), trusted,
  };
}
const same = (ip, rule) => !!ip && (rule.endsWith('*') ? String(ip).replace(/^::ffff:/, '').startsWith(rule.slice(0, -1)) : String(ip).replace(/^::ffff:/, '') === rule);

export function makeAbuse({ now = Date.now, settings, db, skip }) {
  let cfg = cleanConfig(settings.get('abuse_config', {}));
  const hosts = new Map(); const events = []; const series = new Map(); // series: minute -> {n, t, b}
  let blocks = (settings.get('abuse_blocks', []) || []).filter((b) => !b.until || b.until > now());
  const saveBlocks = () => settings.set('abuse_blocks', blocks);
  const trusted = (ip) => cfg.trusted.some((t) => same(ip, t));
  const minute = () => Math.floor(now() / MIN);
  const log = (e) => { events.push({ at: now(), ...e }); if (events.length > 300) events.splice(0, events.length - 300); };
  const host = (ip) => {
    let h = hosts.get(ip);
    if (!h) { if (hosts.size >= 5000) prune(true); h = { ip, first: now(), last: now(), mins: new Map(), users: new Set(), paths: new Map(), ua: '', total: 0, e4: 0, e5: 0, throttled: 0, recent429: [] }; hosts.set(ip, h); }
    return h;
  };
  const prune = (hard) => {
    const m = minute(); const cut = m - CEIL.windowMin;
    for (const [ip, h] of hosts) { for (const k of h.mins.keys()) if (k < cut) h.mins.delete(k); if (!h.mins.size || (hard && now() - h.last > 5 * MIN)) hosts.delete(ip); }
    for (const k of series.keys()) if (k < cut) series.delete(k);
    const before = blocks.length; blocks = blocks.filter((b) => !b.until || b.until > now()); if (blocks.length !== before) saveBlocks();
  };
  setInterval(() => prune(false), MIN).unref?.();
  const blockOf = (ip) => blocks.find((b) => same(ip, b.ip) && (!b.until || b.until > now()));

  const addBlock = ({ ip, minutes = 0, reason = '', auto = false, by = '' }) => {
    if (!/^[0-9a-fA-F:.*]{2,45}$/.test(String(ip || ''))) throw new Error('Enter an address like 203.0.113.7 or 203.0.113.*');
    if (trusted(ip)) throw new Error('That address is on your trusted list, so it cannot be blocked. Remove it from the trusted list first.');
    blocks = blocks.filter((b) => b.ip !== ip); const b = { ip, at: now(), until: minutes > 0 ? now() + minutes * MIN : 0, reason: String(reason).slice(0, 120), auto, by };
    blocks.push(b); saveBlocks(); log({ ip, kind: auto ? 'auto_block' : 'block', detail: `${minutes > 0 ? `for ${minutes} min` : 'until you remove it'}${reason ? `: ${reason}` : ''}` }); return b;
  };
  const removeBlock = (ip) => { const n = blocks.length; blocks = blocks.filter((b) => b.ip !== ip); if (blocks.length !== n) { saveBlocks(); log({ ip, kind: 'unblock', detail: 'Block removed' }); } return n !== blocks.length; };

  const middleware = (req, res, next) => {
    if (skip && skip(req)) return next();
    const ip = String(req.ip || '').replace(/^::ffff:/, ''); if (!ip) return next();
    const t = now(); const m = minute(); const path = req.path;
    const sm = series.get(m) || series.set(m, { n: 0, t: 0, b: 0 }).get(m); sm.n++;
    if (trusted(ip)) { res.on('finish', () => { sm.n += 0; }); return next(); }
    const b = blockOf(ip);
    if (b) { sm.b++; const h = host(ip); h.last = t; return res.status(403).json({ error: 'Access from this address is paused.', code: 'BLOCKED', retryAfterSec: b.until ? Math.ceil((b.until - t) / 1000) : null }); }
    const h = host(ip); h.last = t; h.total++; h.ua = String(req.headers['user-agent'] || '').slice(0, 120);
    const bk = h.mins.get(m) || h.mins.set(m, { n: 0, heavy: 0, auth: 0, e4: 0, e5: 0, thr: 0 }).get(m); bk.n++;
    const p = path.replace(/\/[0-9a-f-]{6,}(?=\/|$)/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id'); if (h.paths.size < 40 || h.paths.has(p)) h.paths.set(p, (h.paths.get(p) || 0) + 1);
    const heavy = HEAVY.test(path); const authy = AUTHP.test(path); if (heavy) bk.heavy++; if (authy) bk.auth++;
    res.on('finish', () => { if (req.user?.id) { if (h.users.size < 200) h.users.add(req.user.id); } if (res.statusCode >= 500) { bk.e5++; h.e5++; } else if (res.statusCode >= 400 && res.statusCode !== 429) { bk.e4++; h.e4++; } });
    if (!cfg.enabled || path.startsWith('/admin')) return next(); // admin pages are only counted, so an admin can always reach this dashboard
    // the limit is counted over this minute and the one before, weighted, so a burst at a minute boundary is still caught
    const prev = h.mins.get(m - 1); const frac = (t % MIN) / MIN; const weigh = (k) => bk[k] + (prev ? prev[k] * (1 - frac) : 0);
    let why = '';
    if (authy && weigh('auth') > cfg.authPerMin) why = `sign-in and sign-up requests: over ${cfg.authPerMin} a minute`;
    else if (heavy && weigh('heavy') > cfg.heavyPerMin) why = `downloads and exports: over ${cfg.heavyPerMin} a minute`;
    else if (weigh('n') > cfg.perIpPerMin) why = `all requests: over ${cfg.perIpPerMin} a minute`;
    if (!why) return next();
    bk.thr++; h.throttled++; sm.t++; h.recent429.push(t); h.recent429 = h.recent429.filter((x) => t - x < 10 * MIN);
    if (h.throttled === 1 || h.throttled % 50 === 0) log({ ip, kind: 'throttled', detail: `Slowed down (${why})${h.throttled > 1 ? `, ${h.throttled} times so far` : ''}` });
    if (cfg.autoBlock && h.recent429.length >= cfg.autoAfter) { try { addBlock({ ip, minutes: cfg.autoMinutes, reason: `Slowed down ${h.recent429.length} times in 10 minutes`, auto: true }); } catch { /* trusted */ } h.recent429 = []; }
    res.set('Retry-After', '30'); return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.', code: 'RATE_LIMITED', retryAfterSec: 30 });
  };

  const sum = (h, k, from) => { let n = 0; for (const [mm, v] of h.mins) if (mm >= from) n += v[k]; return n; };
  const summary = ({ loginDb } = {}) => {
    const m = minute(); const rows = [];
    const failed = new Map();
    if (db) { try { for (const x of db.prepare('SELECT ip, COUNT(*) n, COUNT(DISTINCT who) w FROM login_log WHERE ok=0 AND at>? AND ip IS NOT NULL GROUP BY ip').all(now() - 86400000)) failed.set(String(x.ip).replace(/^::ffff:/, ''), x); } catch { /* table missing in tests */ } }
    for (const h of hosts.values()) {
      const r5 = sum(h, 'n', m - 4), r60 = sum(h, 'n', m - 59); const e4 = sum(h, 'e4', m - 59); const e5 = sum(h, 'e5', m - 59); const thr = sum(h, 'thr', m - 59); const heavy = sum(h, 'heavy', m - 59);
      const peak = Math.max(0, ...[...h.mins.values()].map((x) => x.n)); const f = failed.get(h.ip);
      const signals = [];
      if (f && f.n >= 5 && f.w >= 3) signals.push({ key: 'guessing', level: 'bad', text: `${f.n} failed sign-ins on ${f.w} different accounts in 24 hours. Looks like password guessing.` });
      else if (f && f.n >= 8) signals.push({ key: 'failed', level: 'warn', text: `${f.n} failed sign-ins in 24 hours.` });
      if (h.users.size >= 6) signals.push({ key: 'many_accounts', level: 'warn', text: `${h.users.size} different signed-in accounts from one address. Could be a shared network, or one person using many accounts.` });
      if (r60 >= 60 && e4 / r60 > 0.4) signals.push({ key: 'probing', level: 'warn', text: `${Math.round((e4 / r60) * 100)}% of its requests failed with an error. Looks like probing for pages.` });
      if (heavy >= 20) signals.push({ key: 'heavy', level: 'warn', text: `${heavy} downloads or exports in an hour.` });
      if (thr > 0) signals.push({ key: 'throttled', level: thr >= 10 ? 'bad' : 'warn', text: `Slowed down ${thr} time${thr > 1 ? 's' : ''} in the last hour.` });
      rows.push({ ip: h.ip, total60: r60, last5: r5, peakPerMin: peak, e4, e5, throttled: thr, heavy, users: h.users.size, ua: h.ua, last: h.last, first: h.first, paths: [...h.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) => ({ path: p, n })), signals, blocked: !!blockOf(h.ip), trusted: trusted(h.ip), score: signals.reduce((a, s) => a + (s.level === 'bad' ? 3 : 1), 0) });
    }
    rows.sort((a, b) => b.score - a.score || b.total60 - a.total60);
    const line = []; for (let k = m - 59; k <= m; k++) { const s = series.get(k); line.push({ minute: k * MIN, n: s?.n || 0, throttled: s?.t || 0, blocked: s?.b || 0 }); }
    const totals = { requests60: line.reduce((a, x) => a + x.n, 0), throttled60: line.reduce((a, x) => a + x.throttled, 0), blocked60: line.reduce((a, x) => a + x.blocked, 0), addresses: hosts.size, flagged: rows.filter((x) => x.signals.length).length };
    return { config: cfg, ceil: CEIL, totals, line, hosts: rows.slice(0, 50), blocks: blocks.map((b) => ({ ...b, left: b.until ? Math.max(0, b.until - now()) : null })), events: [...events].reverse().slice(0, 100) };
  };
  return { middleware, summary, addBlock, removeBlock, get config() { return cfg; }, setConfig(raw) { cfg = cleanConfig(raw, cfg); settings.set('abuse_config', cfg); return cfg; }, resetConfig() { cfg = cleanConfig({}); settings.set('abuse_config', cfg); return cfg; }, trusted, log };
}
