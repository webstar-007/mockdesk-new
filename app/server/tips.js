// Topper Trick Corner: one-line "how I solved this fast" tips under a question on the review page.
// Students in the top slice of a mock (and teachers) can post. Anyone who finished the mock can upvote. Teachers can verify.
export const TIPS_DEFAULTS = { topPercent: 10, minCohort: 5, needCorrect: true, maxPerQuestion: 12, perDay: 20, reportsToHide: 3 };
const DAY = 86400000;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const first = (n) => clean(n).split(' ')[0] || 'Student';

export function initTips(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS tips(
    id INTEGER PRIMARY KEY AUTOINCREMENT, mock_id TEXT NOT NULL, question_id TEXT NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL,
    text TEXT NOT NULL, verified_by INTEGER, verified_at INTEGER, hidden INTEGER NOT NULL DEFAULT 0, hidden_why TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_tips_q ON tips(mock_id, question_id);
  CREATE TABLE IF NOT EXISTS tip_votes(tip_id INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(tip_id, user_id));
  CREATE TABLE IF NOT EXISTS tip_reports(tip_id INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(tip_id, user_id));`);
}

export function makeTips({ db, now, settings, readResult, notifier, controls, getMock }) {
  initTips(db);
  const cfg = () => ({ ...TIPS_DEFAULTS, ...(settings.get('tips', {}) || {}) });
  const on = () => controls().features.tips !== false;
  const one = (sql, ...a) => db.prepare(sql).get(...a); const all = (sql, ...a) => db.prepare(sql).all(...a);

  /** Is this student in the top slice of the mock? Compares each student's best score on it. */
  function standing(userId, mockId) {
    const rows = all("SELECT user_id, result FROM attempts WHERE mock_id=? AND status='submitted'", mockId);
    const best = new Map();
    for (const r of rows) { let p; try { p = readResult(r).summary.percentage; } catch { continue; } if (!best.has(r.user_id) || p > best.get(r.user_id)) best.set(r.user_id, p); }
    const mine = best.get(userId); const cohort = best.size; const c = cfg();
    if (mine == null) return { eligible: false, cohort, reason: 'Finish this mock to see tips.' };
    const rank = [...best.values()].filter((p) => p > mine).length + 1; const slots = Math.max(1, Math.ceil((cohort * c.topPercent) / 100));
    if (cohort < c.minCohort) return { eligible: false, cohort, rank, reason: `Tips open when ${c.minCohort} students have finished this mock. ${cohort} so far.` };
    if (rank > slots) return { eligible: false, cohort, rank, reason: `Only the top ${c.topPercent}% of this mock can post a trick. You are ranked ${rank} of ${cohort}.` };
    return { eligible: true, cohort, rank, reason: '' };
  }
  const attemptOf = (id, userId) => one("SELECT id, user_id, mock_id, status, result FROM attempts WHERE id=? AND user_id=?", id, userId);
  const view = (t, uid) => {
    const votes = one('SELECT COUNT(*) c FROM tip_votes WHERE tip_id=?', t.id).c;
    return { id: t.id, text: t.text, author: first(t.name), badge: t.role === 'teacher' ? 'teacher' : 'topper', verified: !!t.verified_by, verifiedBy: t.verified_by ? first(t.vname) : null, votes, voted: !!one('SELECT 1 FROM tip_votes WHERE tip_id=? AND user_id=?', t.id, uid), mine: t.user_id === uid, at: t.created_at };
  };
  const rowsFor = (mockId) => all(`SELECT t.*, u.name, v.name vname FROM tips t JOIN users u ON u.id=t.user_id LEFT JOIN users v ON v.id=t.verified_by WHERE t.mock_id=? AND t.hidden=0`, mockId);

  function validate(text) {
    const t = clean(text);
    if (t.length < 12) return { error: 'Write a little more. A good tip is one clear line, at least 12 characters.' };
    if (t.length > 140) return { error: 'Keep it to one line, up to 140 characters.' };
    if (/https?:|www\.|\.com\b|\.in\b|@\w/i.test(t)) return { error: 'Links and handles are not allowed in tips.' };
    return { text: t };
  }

  function post({ mockId, qid, user, text, role }) {
    const v = validate(text); if (v.error) return { status: 400, error: v.error };
    const c = cfg(); const t = now();
    if (one('SELECT 1 FROM tips WHERE mock_id=? AND question_id=? AND user_id=? AND hidden=0', mockId, qid, user.id)) return { status: 409, error: 'You already shared a trick for this question. Delete it first to write a new one.' };
    if (one('SELECT COUNT(*) c FROM tips WHERE user_id=? AND created_at>?', user.id, t - DAY).c >= c.perDay) return { status: 429, error: 'You have shared plenty today. Come back tomorrow.' };
    if (one('SELECT COUNT(*) c FROM tips WHERE mock_id=? AND question_id=? AND hidden=0', mockId, qid).c >= c.maxPerQuestion) return { status: 409, error: 'This question already has enough tips.' };
    const id = Number(db.prepare('INSERT INTO tips(mock_id,question_id,user_id,role,text,created_at) VALUES (?,?,?,?,?,?)').run(mockId, qid, user.id, role, v.text, t).lastInsertRowid);
    return { id };
  }

  function verify(id, teacher, on_) {
    const t = one('SELECT * FROM tips WHERE id=?', id); if (!t) return null;
    if (on_) { db.prepare('UPDATE tips SET verified_by=?, verified_at=? WHERE id=?').run(teacher.id, now(), id); if (t.user_id !== teacher.id) notifier?.notify?.(t.user_id, { kind: 'tip', title: 'A teacher verified your trick', body: `“${t.text.slice(0, 80)}” now has the Teacher Verified badge.`, link: '/progress', ref: `tip-v-${id}`, capped: false, channels: { push: true } }); }
    else db.prepare('UPDATE tips SET verified_by=NULL, verified_at=NULL WHERE id=?').run(id);
    return true;
  }
  return { cfg, on, standing, attemptOf, view, rowsFor, post, verify, validate, one, all };
}

export function mountTipsStudent(api, T, { db, now, notifier }) {
  const { one } = T;
  const gate = (req, res, next) => (T.on() ? next() : res.status(404).json({ error: 'Tricks are switched off right now.', code: 'OFF' }));
  api.get('/attempts/:id/tips', gate, (req, res) => {
    const a = T.attemptOf(req.params.id, req.user.id); if (!a || a.status !== 'submitted' || a.mock_id === 'practice') return res.json({ enabled: true, available: false, tips: {} });
    const st = T.standing(req.user.id, a.mock_id); const byQ = {};
    for (const t of T.rowsFor(a.mock_id)) (byQ[t.question_id] ||= []).push(T.view(t, req.user.id));
    for (const k of Object.keys(byQ)) byQ[k].sort((x, y) => Number(y.verified) - Number(x.verified) || y.votes - x.votes || x.at - y.at);
    // which questions this student got right (only those can carry their trick)
    let right = []; try { right = JSON.parse(a.result).questions.filter((q) => q.status === 'correct').map((q) => q.id); } catch { /* */ }
    res.json({ enabled: true, available: true, canPost: st.eligible, reason: st.reason, rank: st.rank ?? null, cohort: st.cohort, topPercent: T.cfg().topPercent, needCorrect: T.cfg().needCorrect, right, tips: byQ });
  });
  api.post('/attempts/:id/tips', gate, (req, res) => {
    const a = T.attemptOf(req.params.id, req.user.id); if (!a || a.status !== 'submitted' || a.mock_id === 'practice') return res.status(404).json({ error: 'Attempt not found' });
    const st = T.standing(req.user.id, a.mock_id); if (!st.eligible) return res.status(403).json({ error: st.reason });
    const qid = String(req.body?.questionId || '');
    let q; try { q = JSON.parse(a.result).questions.find((x) => x.id === qid); } catch { /* */ }
    if (!q) return res.status(400).json({ error: 'That question is not in this mock.' });
    if (T.cfg().needCorrect && q.status !== 'correct') return res.status(403).json({ error: 'You can share a trick for questions you answered correctly.' });
    const r = T.post({ mockId: a.mock_id, qid, user: req.user, text: req.body?.text, role: 'topper' });
    if (r.error) return res.status(r.status).json({ error: r.error }); res.status(201).json({ ok: true, id: r.id });
  });
  api.post('/tips/:id/vote', gate, (req, res) => {
    const t = one('SELECT * FROM tips WHERE id=? AND hidden=0', Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.user_id === req.user.id) return res.status(400).json({ error: 'You cannot upvote your own trick.' });
    if (!one("SELECT 1 FROM attempts WHERE user_id=? AND mock_id=? AND status='submitted'", req.user.id, t.mock_id)) return res.status(403).json({ error: 'Finish this mock to vote.' });
    const had = one('SELECT 1 FROM tip_votes WHERE tip_id=? AND user_id=?', t.id, req.user.id);
    if (had) db.prepare('DELETE FROM tip_votes WHERE tip_id=? AND user_id=?').run(t.id, req.user.id); else db.prepare('INSERT INTO tip_votes(tip_id,user_id,at) VALUES (?,?,?)').run(t.id, req.user.id, now());
    const votes = one('SELECT COUNT(*) c FROM tip_votes WHERE tip_id=?', t.id).c;
    if (!had && votes === 5) notifier?.notify?.(t.user_id, { kind: 'tip', title: 'Your trick got 5 upvotes', body: `“${t.text.slice(0, 80)}” is helping other students.`, link: '/progress', ref: `tip-5-${t.id}`, capped: false, channels: { push: true } });
    res.json({ ok: true, voted: !had, votes });
  });
  api.post('/tips/:id/report', gate, (req, res) => {
    const t = one('SELECT * FROM tips WHERE id=?', Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.user_id === req.user.id) return res.status(400).json({ error: 'That is your own trick.' });
    db.prepare('INSERT OR IGNORE INTO tip_reports(tip_id,user_id,at) VALUES (?,?,?)').run(t.id, req.user.id, now());
    const n = one('SELECT COUNT(*) c FROM tip_reports WHERE tip_id=?', t.id).c;
    if (n >= T.cfg().reportsToHide && !t.hidden) db.prepare("UPDATE tips SET hidden=1, hidden_why='Reported by students' WHERE id=?").run(t.id);
    res.json({ ok: true });
  });
  api.delete('/tips/:id', (req, res) => {
    const t = one('SELECT * FROM tips WHERE id=?', Number(req.params.id)); if (!t || t.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM tips WHERE id=?').run(t.id); db.prepare('DELETE FROM tip_votes WHERE tip_id=?').run(t.id); db.prepare('DELETE FROM tip_reports WHERE tip_id=?').run(t.id); res.json({ ok: true });
  });
}

export function mountTipsTeacher(api, T, { db, getMock, publishedMocks }) {
  const { one, all } = T;
  const guard = (req, res, next) => (req.user?.role === 'teacher' ? next() : res.status(403).json({ error: 'Teacher access only' }));
  api.get('/teacher/tips', guard, (req, res) => {
    const rows = all(`SELECT t.*, u.name, v.name vname, (SELECT COUNT(*) FROM tip_votes x WHERE x.tip_id=t.id) votes, (SELECT COUNT(*) FROM tip_reports x WHERE x.tip_id=t.id) reports, m.name mock FROM tips t JOIN users u ON u.id=t.user_id LEFT JOIN users v ON v.id=t.verified_by LEFT JOIN mocks m ON m.id=t.mock_id WHERE t.hidden=0 ORDER BY (t.verified_by IS NULL) DESC, votes DESC, t.id DESC LIMIT 200`);
    res.json({ tips: rows.map((t) => { let q = ''; try { const m = getMock(t.mock_id); const x = m.questions.find((z) => z.id === t.question_id); q = x ? `${x.text}`.slice(0, 140) : ''; } catch { /* */ } return { id: t.id, text: t.text, author: t.name, role: t.role, mock: t.mock || t.mock_id, mockId: t.mock_id, questionId: t.question_id, question: q, votes: t.votes, reports: t.reports, verified: !!t.verified_by, verifiedBy: t.vname || null, mine: t.user_id === req.user.id, at: t.created_at }; }) });
  });
  api.post('/teacher/tips/:id/verify', guard, (req, res) => { const ok = T.verify(Number(req.params.id), req.user, req.body?.on !== false); if (!ok) return res.status(404).json({ error: 'Not found' }); res.json({ ok: true }); });
  api.delete('/teacher/tips/:id', guard, (req, res) => { const t = one('SELECT * FROM tips WHERE id=?', Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Not found' }); db.prepare("UPDATE tips SET hidden=1, hidden_why='Removed by a teacher' WHERE id=?").run(t.id); res.json({ ok: true }); });
  api.get('/teacher/tips/mocks', guard, (req, res) => res.json({ mocks: publishedMocks() }));
  api.get('/teacher/tips/mocks/:id/questions', guard, (req, res) => {
    let m; try { m = getMock(req.params.id); } catch { m = null; } if (!m) return res.status(404).json({ error: 'Mock not found' });
    res.json({ questions: m.questions.map((q) => ({ id: q.id, section: q.section, index: q.index, text: String(q.text || '').slice(0, 160), shortcut: q.shortcut || '' })) });
  });
  api.post('/teacher/tips', guard, (req, res) => {
    const mockId = String(req.body?.mockId || ''), qid = String(req.body?.questionId || '');
    let m; try { m = getMock(mockId); } catch { m = null; } if (!m || !m.questions.some((q) => q.id === qid)) return res.status(400).json({ error: 'Pick a mock and a question.' });
    const r = T.post({ mockId, qid, user: req.user, text: req.body?.text, role: 'teacher' }); if (r.error) return res.status(r.status).json({ error: r.error });
    T.verify(r.id, req.user, true); res.status(201).json({ ok: true, id: r.id });
  });
}

export function mountTipsAdmin(r, T, { db, now, audit, bad, jobs, settings }) {
  const { one, all } = T;
  const rows = (where, args = []) => all(`SELECT t.*, u.name, u.email, (SELECT COUNT(*) FROM tip_votes x WHERE x.tip_id=t.id) votes, (SELECT COUNT(*) FROM tip_reports x WHERE x.tip_id=t.id) reports, m.name mock FROM tips t JOIN users u ON u.id=t.user_id LEFT JOIN mocks m ON m.id=t.mock_id ${where} ORDER BY t.id DESC LIMIT 200`, ...args);
  r.get('/tips', (req, res) => {
    const f = String(req.query.filter || 'all'); const q = String(req.query.q || '').trim();
    const where = [f === 'reported' ? 'EXISTS(SELECT 1 FROM tip_reports x WHERE x.tip_id=t.id) AND t.hidden=0' : f === 'hidden' ? 't.hidden=1' : f === 'unverified' ? 't.hidden=0 AND t.verified_by IS NULL' : f === 'verified' ? 't.hidden=0 AND t.verified_by IS NOT NULL' : 't.hidden=0'];
    const args = []; if (q) { where.push('(t.text LIKE ? OR u.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const stats = { total: one('SELECT COUNT(*) c FROM tips WHERE hidden=0').c, verified: one('SELECT COUNT(*) c FROM tips WHERE hidden=0 AND verified_by IS NOT NULL').c, reported: one('SELECT COUNT(DISTINCT x.tip_id) c FROM tip_reports x JOIN tips t ON t.id=x.tip_id WHERE t.hidden=0').c, hidden: one('SELECT COUNT(*) c FROM tips WHERE hidden=1').c, votes: one('SELECT COUNT(*) c FROM tip_votes').c };
    res.json({ stats, config: T.cfg(), enabled: T.on(), tips: rows(`WHERE ${where.join(' AND ')}`, args).map((t) => ({ id: t.id, text: t.text, author: t.name, email: t.email, role: t.role, mock: t.mock || t.mock_id, questionId: t.question_id, votes: t.votes, reports: t.reports, verified: !!t.verified_by, hidden: !!t.hidden, hiddenWhy: t.hidden_why, at: t.created_at })) });
  });
  r.put('/tips/config', (req, res) => {
    const b = req.body || {}; const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
    const c = { ...T.cfg(), topPercent: n(b.topPercent, 1, 50, 10), minCohort: n(b.minCohort, 1, 500, 5), needCorrect: b.needCorrect !== false, maxPerQuestion: n(b.maxPerQuestion, 1, 50, 12), reportsToHide: n(b.reportsToHide, 1, 20, 3) };
    settings.set('tips', c); audit(req, 'tips_config', 'tips', JSON.stringify(c)); res.json({ config: c });
  });
  const act = (name, fn) => r.post(`/tips/:id/${name}`, (req, res) => { const t = one('SELECT * FROM tips WHERE id=?', Number(req.params.id)); if (!t) return bad(res, 'Not found', 404); fn(t, req); audit(req, `tip_${name}`, String(t.id), t.text.slice(0, 80)); res.json({ ok: true }); });
  act('hide', (t) => db.prepare("UPDATE tips SET hidden=1, hidden_why='Hidden by an admin' WHERE id=?").run(t.id));
  act('unhide', (t) => { db.prepare('UPDATE tips SET hidden=0, hidden_why=NULL WHERE id=?').run(t.id); db.prepare('DELETE FROM tip_reports WHERE tip_id=?').run(t.id); });
  act('verify', (t, req) => T.verify(t.id, req.user, !t.verified_by));
  act('delete', (t) => { for (const x of ['tips', 'tip_votes', 'tip_reports']) db.prepare(`DELETE FROM ${x} WHERE ${x === 'tips' ? 'id' : 'tip_id'}=?`).run(t.id); });
  jobs?.alerts?.addCheck('tips', ({ raise, resolve }) => {
    const n = one('SELECT COUNT(DISTINCT x.tip_id) c FROM tip_reports x JOIN tips t ON t.id=x.tip_id WHERE t.hidden=0').c; const h = one("SELECT COUNT(*) c FROM tips WHERE hidden=1 AND hidden_why='Reported by students'").c;
    if (!n && !h) return resolve('tips-reported');
    raise('tips-reported', { kind: 'content', level: 'info', title: `${n + h} student trick${n + h > 1 ? 's were' : ' was'} reported`, body: `${h} hidden automatically, ${n} waiting for a look. Review them in Questions > Tricks.`, link: 'tricks' });
  });
}
