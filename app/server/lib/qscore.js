// Question quality score: 0 to 100.
// 0 to 100: starts at 100 and loses points for each problem, so the reasons are always listable.
export const scoreOf = ({ flags, pctRight, disc, n, pctSkipped }) => {
  const parts = []; const lose = (label, pts) => { if (pts > 0) parts.push({ label, pts: Math.round(pts) }); };
  const has = (k) => flags.some((f) => f.key === k);
  if (has('wrong_key')) lose('Answer key may be wrong', 45); else if (has('nobody_right')) lose('Nobody got it right', 40); else if (has('ambiguous')) lose('Two options look right to students', 20);
  if (has('reported')) lose('Students reported it', 15);
  if (disc != null) { if (disc < 0) lose('Weak students beat strong ones on it', 30); else if (disc < 0.1) lose('Does not separate strong from weak', 20); else if (disc < 0.2) lose('Separates strong from weak only a little', 12); else if (disc < 0.3) lose('Separates strong from weak fairly', 5); }
  if (has('toppers_wrong') && !(disc != null && disc < 0)) lose('Most toppers got it wrong', 25);
  if (n >= 8) { if (pctRight > 90) lose('Almost everyone gets it right', Math.min(15, (pctRight - 90) * 1.5 + 4)); else if (pctRight < 20 && !has('nobody_right')) lose('Very few get it right', Math.min(15, (20 - pctRight) * 0.8 + 3)); }
  if (has('skipped') || pctSkipped >= 50) lose('Often skipped', 8);
  if (has('slow')) lose('Takes too long', 6);
  if (has('harder_than_tag') || has('easier_than_tag')) lose('Difficulty tag does not match', 5);
  if (has('no_explanation')) lose('No explanation for students', 5);
  const score = Math.max(0, 100 - parts.reduce((a, x) => a + x.pts, 0));
  return { score, grade: score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor', parts };
};
