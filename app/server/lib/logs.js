// Recent server log lines kept in memory for the admin log viewer. Cleared on restart; the full history is in the service log.
const MAX = 1000;
const buf = [];
let seq = 0;
const clean = (s) => String(s).replace(/\b[a-f0-9]{48,}\b/gi, '[token]').replace(/(sid|token|key|secret|password)=([^\s;&]+)/gi, '$1=[hidden]').slice(0, 2000);
export function pushLog(level, msg) { buf.push({ id: ++seq, at: Date.now(), level, msg: clean(msg) }); if (buf.length > MAX) buf.shift(); }
let patched = false;
/** Copy everything written with console.log/info/warn/error into the buffer. Call once at start-up. */
export function captureLogs() {
  if (patched) return; patched = true;
  for (const [fn, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
    const orig = console[fn].bind(console);
    console[fn] = (...a) => { try { pushLog(level, a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); } catch { /* never block logging */ } orig(...a); };
  }
}
export function readLogs({ level = 'all', q = '', limit = 200 } = {}) {
  const rank = { info: 0, warn: 1, error: 2 }; const min = level === 'all' ? 0 : rank[level] ?? 0; const s = String(q).toLowerCase();
  return buf.filter((x) => rank[x.level] >= min && (!s || x.msg.toLowerCase().includes(s))).slice(-Math.min(1000, Math.max(1, limit))).reverse();
}
export const clearLogs = () => { buf.length = 0; };
