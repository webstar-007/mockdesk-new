// Content tools for editors: import from Word or pasted text, find duplicates, and AI solution drafts that an editor approves.
import { on } from './lib/credentials.js';
import { docxLines } from './lib/docx.js';
import { parseQuestions } from './lib/qparse.js';
import { fingerprint, matchesFor, findPairs } from './lib/similar.js';
const DAY = 86400000;
const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

export function mountContent({ r, db, now, audit, bad, settings, drafter, cleanQuestion, saveQuestion, qOut }) {
  const mocks = () => new Map(db.prepare('SELECT id, name, status FROM mocks').all().map((m) => [m.id, m]));
  const pool = () => db.prepare('SELECT id, mock_id, section, position, data FROM questions').all().map((x) => { const d = parse(x.data); return { id: x.id, mockId: x.mock_id, section: x.section, position: x.position, text: d.text || '', options: d.options || [], topic: d.topic, figure: d.figure, optionFigures: d.optionFigures, image: d.image, optionImages: d.optionImages, table: d.table, passage: d.passage }; });
  const brief = (p, mm) => ({ id: p.id, text: p.text.slice(0, 160), mockId: p.mockId, mockName: mm.get(p.mockId)?.name || 'Question pool', status: mm.get(p.mockId)?.status || '', section: p.section, position: p.position });

  // ---- import: read a Word file or pasted text, show what will happen, flag duplicates ----
  r.post('/import/parse', (req, res) => {
    let lines;
    try {
      if (req.body?.docx) { const buf = Buffer.from(String(req.body.docx), 'base64'); if (buf.length > 8 * 1024 * 1024) return bad(res, 'That file is larger than 8 MB'); lines = docxLines(buf); }
      else lines = String(req.body?.text || '').split(/\r?\n/);
    } catch (e) { return bad(res, e.message); }
    const d = req.body?.defaults || {}; const out = parseQuestions(lines, { section: d.section, difficulty: d.difficulty, topic: d.topic });
    if (!out.found) return bad(res, 'No questions found. Number each question (Q1., 2.), give four options (A to D) and an “Answer: B” line.');
    const existing = pool(); const batch = out.rows.map((x) => ({ id: `new${x._n}`, text: x.text, options: x.options }));
    const dupes = []; const rows = out.rows.map((x, i) => {
      const hit = matchesFor(batch[i], existing, { min: 0.82, limit: 1 })[0]; const inside = matchesFor(batch[i], batch.slice(0, i), { min: 0.9, limit: 1 })[0];
      if (hit) dupes.push({ row: x._n, score: hit.score, of: brief(hit.p, mocks()) }); else if (inside) dupes.push({ row: x._n, score: inside.score, of: { id: inside.id, text: inside.p.text.slice(0, 160), mockName: 'This file' } });
      return x;
    });
    res.json({ rows, problems: out.problems, duplicates: dupes, found: out.found });
  });

  // ---- duplicates ----
  const ign = () => new Set(db.prepare('SELECT a, b FROM dup_ignored').all().map((x) => `${x.a}|${x.b}`));
  const ordered = (a, b) => (a < b ? [a, b] : [b, a]);
  r.get('/duplicates', (req, res) => {
    const min = Math.max(0.6, Math.min(0.99, Number(req.query.min) || 0.85)); const mm = mocks(); const skip = ign();
    const pairs = findPairs(pool(), { min, max: 300 }).filter((p) => !skip.has(ordered(p.a.id, p.b.id).join('|')));
    res.json({ pairs: pairs.slice(0, 100).map((p) => ({ score: p.score, a: brief(p.a, mm), b: brief(p.b, mm) })), total: pairs.length });
  });
  r.post('/duplicates/ignore', (req, res) => {
    const { a, b } = req.body || {}; if (!a || !b || a === b) return bad(res, 'Pick two questions');
    const [x, y] = ordered(String(a), String(b)); db.prepare('INSERT OR IGNORE INTO dup_ignored(a,b) VALUES (?,?)').run(x, y); audit(req, 'duplicate_ignored', x, y); res.json({ ok: true });
  });
  r.post('/questions/similar', (req, res) => {
    const text = String(req.body?.text || ''); if (text.trim().length < 12) return res.json({ matches: [] });
    const mm = mocks(); const m = matchesFor({ text, options: Array.isArray(req.body?.options) ? req.body.options.map(String) : [] }, pool(), { min: 0.7, limit: 4, skipId: req.body?.excludeId || null });
    res.json({ matches: m.map((x) => ({ score: x.score, ...brief(x.p, mm) })) });
  });

  // ---- AI solution drafts ----
  const cap = () => Number(settings.get('ai', {}).dailyCap) || 100;
  const usedToday = () => db.prepare('SELECT COUNT(*) c FROM solution_drafts WHERE created_at>?').get(now() - DAY).c;
  const needsDraft = (d) => !String(d.explanation || '').trim();
  async function draftOne(qid, by) {
    const row = db.prepare('SELECT * FROM questions WHERE id=?').get(qid); if (!row) { const e = new Error('Question not found'); e.status = 404; throw e; }
    if (!on(drafter)) { const e = new Error('AI drafts are not set up. Add an AI key in Admin > Integrations.'); e.status = 503; throw e; }
    if (usedToday() >= cap()) { const e = new Error(`Daily limit of ${cap()} AI drafts reached. It resets in 24 hours.`); e.status = 429; throw e; }
    const q = parse(row.data); const d = await drafter.draft({ text: q.text, options: q.options, passage: q.passage });
    db.prepare("INSERT OR REPLACE INTO solution_drafts(question_id,data,ai_answer,model,status,created_at,created_by) VALUES (?,?,?,?, 'pending', ?, ?)").run(qid, JSON.stringify(d), d.aiAnswer, drafter.model, now(), by);
    return d;
  }
  const shape = (x, mm) => { const row = db.prepare('SELECT * FROM questions WHERE id=?').get(x.question_id); if (!row) return null; const q = parse(row.data); const d = parse(x.data); return { questionId: x.question_id, text: q.text, options: q.options, answer: q.answer, draft: d, aiAnswer: x.ai_answer, agrees: x.ai_answer === q.answer, model: x.model, createdAt: x.created_at, by: x.created_by, mockId: row.mock_id, mockName: mm.get(row.mock_id)?.name || 'Question pool', section: row.section, status: x.status }; };
  r.get('/drafts', (req, res) => {
    const mm = mocks(); const have = new Set(db.prepare("SELECT question_id FROM solution_drafts WHERE status='pending'").all().map((x) => x.question_id));
    const missing = db.prepare('SELECT id, mock_id, section, position, data FROM questions').all().filter((x) => !have.has(x.id) && needsDraft(parse(x.data)));
    res.json({ available: on(drafter), model: on(drafter) ? drafter.model : null, dailyCap: cap(), usedToday: usedToday(),
      pending: db.prepare("SELECT * FROM solution_drafts WHERE status='pending' ORDER BY created_at DESC LIMIT 100").all().map((x) => shape(x, mm)).filter(Boolean),
      missing: { count: missing.length, sample: missing.slice(0, 20).map((x) => ({ id: x.id, text: String(parse(x.data).text || '').slice(0, 110), mockName: mm.get(x.mock_id)?.name || 'Question pool', section: x.section })) } });
  });
  r.post('/questions/:qid/draft', async (req, res) => {
    try { const d = await draftOne(req.params.qid, req.user.name); audit(req, 'ai_draft', req.params.qid); const row = db.prepare('SELECT * FROM solution_drafts WHERE question_id=?').get(req.params.qid); res.json({ draft: shape(row, mocks()) }); }
    catch (e) { bad(res, e.message, e.status || 502); }
  });
  r.post('/drafts/batch', async (req, res) => {
    if (!on(drafter)) return bad(res, 'AI drafts are not set up. Add an AI key in Admin > Integrations.', 503);
    const have = new Set(db.prepare("SELECT question_id FROM solution_drafts WHERE status='pending'").all().map((x) => x.question_id));
    const want = Math.max(1, Math.min(10, Number(req.body?.limit) || 5));
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, want) : db.prepare('SELECT id, data FROM questions').all().filter((x) => !have.has(x.id) && needsDraft(parse(x.data))).slice(0, want).map((x) => x.id));
    let drafted = 0; const failed = [];
    for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(async (id) => { try { await draftOne(id, req.user.name); drafted++; } catch (e) { failed.push({ id, error: e.message }); } }));
    audit(req, 'ai_draft_batch', String(ids.length), `${drafted} drafted`); res.json({ drafted, failed });
  });
  r.post('/drafts/:qid/reject', (req, res) => { const x = db.prepare("UPDATE solution_drafts SET status='rejected', decided_at=?, decided_by=? WHERE question_id=? AND status='pending'").run(now(), req.user.name, req.params.qid); if (!x.changes) return bad(res, 'Draft not found', 404); res.json({ ok: true }); });
  r.post('/drafts/:qid/approve', (req, res) => {
    const dr = db.prepare("SELECT * FROM solution_drafts WHERE question_id=? AND status='pending'").get(req.params.qid); if (!dr) return bad(res, 'Draft not found', 404);
    const row = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.qid); if (!row) return bad(res, 'Question not found', 404);
    const before = parse(row.data); if (dr.ai_answer !== before.answer) return bad(res, 'The AI picked a different answer from the key. Check the key in the question first; this draft cannot be used as it is.', 409);
    const e = req.body?.edits || {}; const d = { ...parse(dr.data), ...Object.fromEntries(['explanation', 'steps', 'shortcut', 'trap', 'wrongReasons'].filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) };
    const { section, q, errors } = cleanQuestion({ ...before, section: row.section, explanation: d.explanation, steps: d.steps, shortcut: d.shortcut || before.shortcut, trap: d.trap || before.trap, wrongReasons: d.wrongReasons?.length ? d.wrongReasons : before.wrongReasons }); if (errors.length) return bad(res, errors[0]);
    saveQuestion(row, section, q, { by: req.user.name }); db.prepare("UPDATE solution_drafts SET status='approved', decided_at=?, decided_by=? WHERE question_id=?").run(now(), req.user.name, row.id);
    audit(req, 'ai_draft_approved', row.mock_id, row.id); res.json({ question: qOut(row.id) });
  });
}
