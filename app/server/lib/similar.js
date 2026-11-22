// Find near-duplicate questions. Same wording with different numbers is NOT a duplicate (25% of 80 vs 25% of 60).
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}%.\s]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
const NUM = /\d/;
const jac = (a, b) => { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
export function fingerprint(q) {
  const w = words(q.text); const stem = new Set(w); const nums = new Set(w.filter((x) => NUM.test(x)));
  const opts = new Set((q.options || []).map((o) => words(o).join(' ')).filter(Boolean)); const art = JSON.stringify([q.figure || '', q.optionFigures || [], q.image || '', q.optionImages || [], q.table || null, q.passage || '']);
  return { stem, nums, opts, key: w.join(' '), art };
}
export function score(a, b) {
  if (a.art !== b.art) return Math.round(0.3 * scoreText(a, b) * 1000) / 1000; // a different picture, table or passage means a different question
  return scoreText(a, b);
}
function scoreText(a, b) {
  if (a.key && a.key === b.key && jac(a.opts, b.opts) > 0.5) return 1;
  let s = jac(a.stem, b.stem); if (a.nums.size || b.nums.size) { const nj = jac(a.nums, b.nums); if (nj < 1) s *= 0.4 + 0.6 * nj * nj; }
  return Math.round((0.7 * s + 0.3 * jac(a.opts, b.opts)) * 1000) / 1000;
}
/** Similar existing questions for one candidate. */
export function matchesFor(candidate, pool, { min = 0.8, limit = 3, skipId = null } = {}) {
  const f = fingerprint(candidate); const out = [];
  for (const p of pool) { if (p.id === skipId) continue; const s = score(f, p.fp || (p.fp = fingerprint(p))); if (s >= min) out.push({ id: p.id, score: s, p }); }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
/** All near-duplicate pairs in a pool, using an inverted index so thousands of questions stay fast. */
export function findPairs(pool, { min = 0.85, max = 200 } = {}) {
  for (const p of pool) p.fp ||= fingerprint(p);
  const post = new Map(); pool.forEach((p, i) => { for (const t of p.fp.stem) { if (!post.has(t)) post.set(t, []); post.get(t).push(i); } });
  const common = Math.max(30, pool.length * 0.25); const pairs = [];
  pool.forEach((p, i) => {
    const hits = new Map(); for (const t of p.fp.stem) { const l = post.get(t); if (l.length > common) continue; for (const j of l) if (j > i) hits.set(j, (hits.get(j) || 0) + 1); }
    for (const [j, c] of hits) { if (c < Math.max(2, 0.5 * Math.min(p.fp.stem.size, pool[j].fp.stem.size))) continue; const s = score(p.fp, pool[j].fp); if (s >= min) pairs.push({ a: p, b: pool[j], score: s }); }
  });
  return pairs.sort((x, y) => y.score - x.score).slice(0, max);
}
