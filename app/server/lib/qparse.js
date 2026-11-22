// Turn pasted text (or the text of a Word file) into question rows.
//   Q1. Question text            A) first option     B) ...     (A) / A. / (1) also work
//   Answer: B     Explanation: ...     Topic: ...     Difficulty: easy     Section: maths
const OPT = /^\s*(?:\(([A-Da-d1-4])\)|([A-Da-d])[.:)])\s*(.*)$/;
const ANS = /^\s*(?:correct\s+)?(?:ans(?:wer)?|key)\s*[:\-=]?\s*\(?([A-Da-d1-4])\)?\b/i;
const FIELD = /^\s*(explanation|solution|sol|shortcut|trap|topic|subtopic|difficulty|section|tags|revise|approach)\s*[:\-]\s*(.*)$/i;
const START = /^\s*(?:q(?:uestion)?\.?\s*)?(\d{1,4})\s*[.):\-]\s*(\S.*)$/i;
const idx = (c) => (/\d/.test(c) ? Number(c) - 1 : c.toUpperCase().charCodeAt(0) - 65);
const FKEY = { sol: 'explanation', solution: 'explanation' };

export function parseQuestions(lines, defaults = {}) {
  const blocks = []; let cur = null; let target = null;
  const open = (text) => { cur = { text, options: [], answer: null, fields: {}, line: blocks.length + 1 }; blocks.push(cur); target = { kind: 'text' }; };
  for (const raw of lines) {
    const line = String(raw).replace(/ /g, ' '); if (!line.trim()) continue;
    const ans = cur && ANS.exec(line); const opt = cur && !ans && OPT.exec(line); const fld = cur && !ans && !opt && FIELD.exec(line); const st = !ans && !opt && !fld && START.exec(line);
    if (st && (!cur || cur.answer !== null || cur.options.length >= 2 || cur.options.length === 0 && false)) { open(st[2].trim()); continue; }
    if (st && !cur) { open(st[2].trim()); continue; }
    if (ans) { cur.answer = idx(ans[1]); target = { kind: 'none' }; const rest = line.slice(ans[0].length).trim(); if (rest) target = { kind: 'none' }; continue; }
    if (opt && cur) { const i = opt[1] ? idx(opt[1]) : idx(opt[2]); cur.options[i >= 0 && i < 4 ? i : cur.options.length] = (opt[3] || '').trim(); target = { kind: 'opt', i: i >= 0 && i < 4 ? i : cur.options.length - 1 }; continue; }
    if (fld && cur) { const k = FKEY[fld[1].toLowerCase()] || fld[1].toLowerCase(); cur.fields[k] = fld[2].trim(); target = { kind: 'field', k }; continue; }
    if (!cur) { open(line.trim()); continue; }
    if (target.kind === 'text') cur.text += `\n${line.trim()}`; else if (target.kind === 'opt') cur.options[target.i] += ` ${line.trim()}`; else if (target.kind === 'field') cur.fields[target.k] += `\n${line.trim()}`;
  }
  const rows = []; const problems = [];
  blocks.forEach((b, n) => {
    const o = Array.from({ length: 4 }, (_, i) => b.options[i] || '');
    const errs = []; if (o.some((x) => !x)) errs.push('needs four options (A to D)'); if (b.answer === null || b.answer < 0 || b.answer > 3) errs.push('no correct answer found (add a line like “Answer: B”)');
    if (errs.length) { problems.push({ row: n + 1, error: errs.join('; '), text: b.text.slice(0, 80) }); return; }
    const f = b.fields;
    rows.push({ section: (f.section || defaults.section || '').toLowerCase(), difficulty: (f.difficulty || defaults.difficulty || 'moderate').toLowerCase(), topic: f.topic || defaults.topic || 'General', subtopic: f.subtopic || '', text: b.text, options: o, answer: b.answer, explanation: f.explanation || '', shortcut: f.shortcut || '', trap: f.trap || '', revise: f.revise || '', approach: f.approach || '', tags: f.tags ? f.tags.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [], _n: n + 1 });
  });
  return { rows, problems, found: blocks.length };
}
