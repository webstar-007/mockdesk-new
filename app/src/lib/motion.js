// Tiny store that counts requests in flight, so the top progress bar can follow real network activity.
let n = 0; const subs = new Set();
const emit = () => subs.forEach((f) => f(n));
export const busy = { start() { n++; emit(); }, end() { n = Math.max(0, n - 1); emit(); }, sub(f) { subs.add(f); return () => subs.delete(f); }, get count() { return n; } };
export const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
