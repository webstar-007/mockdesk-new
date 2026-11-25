// v24: batch health board, doubt desk (ask a teacher), mock reminders and certificates.
import crypto from 'node:crypto';
import { dayKey, clock, dateLabel } from './lib/reminders.js';
const DAY = 86400000; const HOUR = 3600000;
const parse = (s, d = null) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const NOT_MOCK = "('practice','pool')";

export const MOCKREM_DEFAULTS = { enabled: true, dayBefore: true, hourBefore: true, noStart: true, noStartMins: 10 };
export const CERT_DEFAULTS = { enabled: true, orgName: '', signerName: '', signerTitle: '', completionMocks: 5, meritPct: 80, completionTitle: 'Certificate of Completion', meritTitle: 'Certificate of Merit' };
export const cleanMockRem = (b = {}) => ({ enabled: b.enabled !== false, dayBefore: b.dayBefore !== false, hourBefore: b.hourBefore !== false, noStart: b.noStart !== false, noStartMins: clampN(b.noStartMins, 5, 60, 10) });
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const cleanCert = (b = {}) => ({ enabled: b.enabled !== false, orgName: str(b.orgName, 80), signerName: str(b.signerName, 60), signerTitle: str(b.signerTitle, 60), completionMocks: clampN(b.completionMocks, 1, 100, 5), meritPct: clampN(b.meritPct, 30, 100, 80), completionTitle: str(b.completionTitle, 60) || CERT_DEFAULTS.completionTitle, meritTitle: str(b.meritTitle, 60) || CERT_DEFAULTS.meritTitle });

const NUDGES = {
  absent: 'We have not seen you for a few days. A short practice session today keeps your momentum going.',
  drop: 'Your last scores dipped a little. Review the mistakes from your latest mock, then try a short practice set.',
  overdue: 'You have an assignment past its due date. Please finish it when you can, and tell me if you are stuck.',
  idle: 'Take your first mock this week. It is the fastest way to find out where to focus.',
  low: 'Let us improve your recent scores together. Start with the topics marked weak in your result.',
  general: 'Just checking in. Keep going, every mock makes you stronger.',
};

export function makeV24({ db, now, notifier, settings, readResult }) {
  db.exec(`CREATE TABLE IF NOT EXISTS desk_doubts(id INTEGER PRIMARY KEY, user_id INTEGER, attempt_id TEXT, question_id TEXT, mock_id TEXT, batch_id INTEGER, text TEXT, status TEXT DEFAULT 'open', answer TEXT, answered_by INTEGER, answered_name TEXT, answered_at INTEGER, shared INTEGER DEFAULT 0, created_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_desk_status ON desk_doubts(status, created_at); CREATE INDEX IF NOT EXISTS idx_desk_user ON desk_doubts(user_id, attempt_id);
    CREATE TABLE IF NOT EXISTS certificates(code TEXT PRIMARY KEY, user_id INTEGER, kind TEXT, mock_id TEXT DEFAULT '', attempt_id TEXT, title TEXT, detail TEXT, pct REAL, issued_at INTEGER, revoked_at INTEGER, manual INTEGER DEFAULT 0, by_name TEXT, UNIQUE(user_id, kind, mock_id));
    CREATE INDEX IF NOT EXISTS idx_cert_user ON certificates(user_id);`);
  const one = (sql, ...a) => db.prepare(sql).get(...a); const all = (sql, ...a) => db.prepare(sql).all(...a);
  const ph = (n) => Array.from({ length: n }, () => '?').join(',');
  const mockName = (id) => one('SELECT name FROM mocks WHERE id=?', id)?.name || id;
  const pctOf = (r) => { try { return readResult(r).summary.percentage; } catch { return null; } };

  // ================= batch health board =================
  const batchesFor = (user) => (user.role === 'teacher'
    ? all('SELECT b.* FROM batches b JOIN batch_teachers bt ON bt.batch_id=b.id WHERE bt.user_id=? AND b.archived=0 ORDER BY b.name', user.id)
    : all('SELECT * FROM batches WHERE archived=0 ORDER BY name'));
  const cache = new Map();
  function healthOf(b) {
    const t = now(); const hit = cache.get(b.id); if (hit && t - hit.t < 45000) return hit.v;
    const ms = all("SELECT u.id, u.name, u.email, u.phone, u.last_seen, bm.joined_at FROM batch_members bm JOIN users u ON u.id=bm.user_id WHERE bm.batch_id=? AND COALESCE(u.role,'student')='student' AND COALESCE(u.status,'active')='active' ORDER BY u.name", b.id);
    const ids = ms.map((m) => m.id); const by = new Map();
    if (ids.length) for (const r of all(`SELECT id, user_id, mock_id, submitted_at, result FROM attempts WHERE status='submitted' AND mock_id NOT IN ${NOT_MOCK} AND user_id IN (${ph(ids.length)}) ORDER BY submitted_at`, ...ids)) (by.get(r.user_id) || by.set(r.user_id, []).get(r.user_id)).push(r);
    let asg = []; try { asg = all("SELECT * FROM assignments WHERE batch_id=? AND archived=0 AND kind='mock' AND due_at IS NOT NULL AND due_at<?", b.id, t); } catch { /* assignments not set up */ }
    const nudged = new Map(); if (ids.length) for (const x of all(`SELECT user_id, MAX(created_at) at FROM notifications WHERE kind='nudge' AND user_id IN (${ph(ids.length)}) GROUP BY user_id`, ...ids)) nudged.set(x.user_id, x.at);
    const students = ms.map((m) => {
      const a = by.get(m.id) || []; const last6 = a.slice(-6); const p = last6.map(pctOf).filter((x) => x != null);
      const recent = p.slice(-2); const earlier = p.slice(0, -2).slice(-3);
      const drop = p.length >= 3 && earlier.length ? Math.round((earlier.reduce((x, y) => x + y, 0) / earlier.length - recent.reduce((x, y) => x + y, 0) / recent.length) * 10) / 10 : 0;
      const lastAt = Math.max(m.last_seen || 0, a.length ? a[a.length - 1].submitted_at || 0 : 0, 0); const absentDays = lastAt ? Math.floor((t - lastAt) / DAY) : Math.floor((t - (m.joined_at || t)) / DAY);
      const done = new Set(a.map((r) => r.mock_id)); const overdue = asg.filter((x) => !done.has(x.mock_id)).length;
      const avg3 = p.slice(-3).length ? Math.round(p.slice(-3).reduce((x, y) => x + y, 0) / p.slice(-3).length * 10) / 10 : null;
      const reasons = []; let pts = 0; const keys = [];
      if (drop >= 8) { pts += 3; keys.push('drop'); reasons.push(`Scores down ${drop} points in the latest mocks`); }
      if (absentDays >= 7 && a.length + 0 >= 0 && lastAt) { pts += absentDays >= 14 ? 4 : 3; keys.push('absent'); reasons.push(`Not seen for ${absentDays} days`); }
      if (!a.length && t - (m.joined_at || t) > 3 * DAY) { pts += 2; keys.push('idle'); reasons.push(`Joined ${Math.floor((t - m.joined_at) / DAY)} days ago, no mock yet`); }
      if (overdue) { pts += Math.min(3, overdue); keys.push('overdue'); reasons.push(`${overdue} assignment${overdue > 1 ? 's' : ''} overdue`); }
      if (avg3 != null && avg3 < 35) { pts += 2; keys.push('low'); reasons.push(`Averaging ${avg3}% in recent mocks`); }
      return { id: m.id, name: m.name, contact: m.email || m.phone || '', level: pts >= 4 ? 'risk' : pts >= 2 ? 'watch' : 'ok', points: pts, reasons, keys, mocks: a.length, avgPct: avg3, lastPct: p.length ? p[p.length - 1] : null, drop, absentDays, lastActive: lastAt || null, overdue, nudgedAt: nudged.get(m.id) || null, spark: p };
    }).sort((x, y) => y.points - x.points || x.name.localeCompare(y.name));
    const c = { risk: 0, watch: 0, ok: 0 }; for (const s of students) c[s.level]++;
    const n = students.length; const v = { id: b.id, name: b.name, code: b.code, total: n, ...c, health: n ? Math.round(((c.ok + 0.5 * c.watch) / n) * 100) : null, students };
    cache.set(b.id, { t, v }); if (cache.size > 200) cache.clear(); return v;
  }
  const boardFor = (user) => { const list = batchesFor(user).map(healthOf); return { batches: list, totals: list.reduce((a, b) => ({ risk: a.risk + b.risk, watch: a.watch + b.watch, ok: a.ok + b.ok, students: a.students + b.total }), { risk: 0, watch: 0, ok: 0, students: 0 }) }; };
  async function nudge(user, body) {
    const b = batchesFor(user).find((x) => x.id === Number(body?.batchId)); if (!b) return { code: 404, error: 'Batch not found' };
    const h = healthOf(b); const want = new Set((Array.isArray(body?.userIds) ? body.userIds : []).map(Number)); const list = h.students.filter((s) => want.has(s.id));
    if (!list.length) return { code: 400, error: 'Pick at least one student from this batch' };
    if (list.length > 100) return { code: 400, error: 'Nudge up to 100 students at a time' };
    const custom = str(body?.message, 300); const t = now(); let sent = 0; let already = 0;
    await notifier.pool(list, 6, async (s) => {
      const main = s.keys[0] || 'general';
      const r = await notifier.notify(s.id, { kind: 'nudge', ref: `nudge:${s.id}:${dayKey(t)}`, title: `${str(user.name, 30)} is checking in`, body: custom || NUDGES[main], link: main === 'overdue' ? '/' : '/', channels: { inapp: true, push: true, email: false, whatsapp: false } });
      if (r.duplicate) already++; else if (!r.skipped) sent++;
    });
    cache.delete(b.id); return { ok: true, sent, already, skipped: list.length - sent - already };
  }

  // ================= doubt desk =================
  const deskScope = (user) => (user.role === 'teacher' ? ' AND d.user_id IN (SELECT user_id FROM batch_members WHERE batch_id IN (SELECT batch_id FROM batch_teachers WHERE user_id=' + Number(user.id) + '))' : '');
  function context(d) {
    const a = one('SELECT * FROM attempts WHERE id=?', d.attempt_id); if (!a?.result) return null;
    const res = (() => { try { return readResult(a); } catch { return null; } })(); const q = res?.questions?.find((x) => x.id === d.question_id); if (!q) return null;
    return { section: q.section, index: q.index, text: q.text, options: q.options, correct: q.correct, selected: q.selected, status: q.status };
  }
  const deskRow = (d) => ({ id: d.id, student: d.sname, userId: d.user_id, attemptId: d.attempt_id, questionId: d.question_id, mock: mockName(d.mock_id), text: d.text, status: d.status, answer: d.answer, answeredName: d.answered_name, answeredAt: d.answered_at, shared: !!d.shared, createdAt: d.created_at, q: context(d) });
  function deskList(user, status = 'open') {
    const st = ['open', 'answered', 'closed', 'all'].includes(status) ? status : 'open';
    const rows = all(`SELECT d.*, u.name sname FROM desk_doubts d JOIN users u ON u.id=d.user_id WHERE (?='all' OR d.status=?)${deskScope(user)} ORDER BY d.created_at DESC LIMIT 200`, st, st);
    if (st === 'open') rows.reverse(); // oldest first so nothing waits forever
    const scope = deskScope(user); const t = now();
    const open = one(`SELECT COUNT(*) c, MIN(d.created_at) oldest FROM desk_doubts d WHERE d.status='open'${scope}`);
    const resp = all(`SELECT d.answered_at - d.created_at ms FROM desk_doubts d WHERE d.status='answered' AND d.answered_at>?${scope}`, t - 30 * DAY).map((x) => x.ms).filter((x) => x > 0);
    return { doubts: rows.map(deskRow), stats: { open: open.c, oldest: open.oldest, answered30: resp.length, avgHours: resp.length ? Math.round(resp.reduce((a, b) => a + b, 0) / resp.length / HOUR * 10) / 10 : null } };
  }
  async function deskAnswer(user, id, body) {
    const d = one(`SELECT d.*, u.name sname FROM desk_doubts d JOIN users u ON u.id=d.user_id WHERE d.id=?${deskScope(user)}`, id); if (!d) return { code: 404, error: 'Doubt not found' };
    const answer = String(body?.answer ?? '').trim().slice(0, 2000); if (answer.length < 2) return { code: 400, error: 'Write the answer first' };
    const share = body?.share === true; const t = now();
    db.prepare("UPDATE desk_doubts SET status='answered', answer=?, answered_by=?, answered_name=?, answered_at=?, shared=? WHERE id=?").run(answer, user.id, user.name, t, share ? 1 : 0, id);
    await notifier.notify(d.user_id, { kind: 'desk', ref: `desk:${id}:${t}`, title: `${str(user.name, 30)} answered your doubt`, body: answer.slice(0, 140), link: `/review/${d.attempt_id}?qid=${encodeURIComponent(d.question_id)}`, channels: { inapp: true, push: true, email: false, whatsapp: false } }).catch(() => {});
    return { ok: true };
  }
  function deskClose(user, id) {
    const d = one(`SELECT d.* FROM desk_doubts d WHERE d.id=?${deskScope(user)}`, id); if (!d) return { code: 404, error: 'Doubt not found' };
    db.prepare("UPDATE desk_doubts SET status='closed', answered_name=COALESCE(answered_name, ?), answered_at=COALESCE(answered_at, ?) WHERE id=?").run(user.name, now(), id); return { ok: true };
  }

  // ================= certificates =================
  const certCfg = () => ({ ...CERT_DEFAULTS, ...(settings.get('certs', {}) || {}) });
  const codeGen = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += A[b[i] % A.length]; return `C-${s.slice(0, 4)}-${s.slice(4)}`; };
  function bestByMock(userId) {
    const best = new Map();
    for (const r of all(`SELECT id, mock_id, submitted_at, result FROM attempts WHERE user_id=? AND status='submitted' AND mock_id NOT IN ${NOT_MOCK} ORDER BY submitted_at`, userId)) {
      const p = pctOf(r); if (p == null) continue; const o = best.get(r.mock_id); if (!o || p > o.pct) best.set(r.mock_id, { id: r.id, mock: r.mock_id, pct: p, at: r.submitted_at });
    }
    return best;
  }
  function issueFor(user) {
    const c = certCfg(); if (!c.enabled) return { c, fresh: [], best: null };
    const best = bestByMock(user.id); const fresh = []; const t = now();
    const add = (kind, mock, attempt, title, detail, pct) => { const r = db.prepare('INSERT OR IGNORE INTO certificates(code,user_id,kind,mock_id,attempt_id,title,detail,pct,issued_at) VALUES (?,?,?,?,?,?,?,?,?)').run(codeGen(), user.id, kind, mock, attempt, title, detail, pct, t); if (r.changes) fresh.push(title); };
    if (best.size >= c.completionMocks) { const avg = Math.round([...best.values()].reduce((a, x) => a + x.pct, 0) / best.size * 10) / 10; add('completion', '', null, c.completionTitle, `Completed ${best.size} full mocks with an average of ${avg}%`, avg); }
    for (const x of best.values()) if (x.pct >= c.meritPct) add('merit', x.mock, x.id, c.meritTitle, `${mockName(x.mock)}: scored ${x.pct}%`, x.pct);
    return { c, fresh, best };
  }
  const certOut = (x) => ({ code: x.code, kind: x.kind, title: x.title, detail: x.detail, pct: x.pct, issuedAt: x.issued_at, revoked: !!x.revoked_at, url: `/c/${x.code}` });

  // ================= mock reminders =================
  const mrCfg = () => ({ ...MOCKREM_DEFAULTS, ...(settings.get('mockReminders', {}) || {}) });
  const activeStudents = "COALESCE(u.role,'student')='student' AND COALESCE(u.status,'active')='active'";
  const stepsOf = (m, c) => {
    const af = m.available_from; const s = [];
    if (c.dayBefore) s.push({ key: 'day', label: '1 day before', at: af - DAY });
    if (c.hourBefore) s.push({ key: 'hour', label: '1 hour before', at: af - HOUR });
    if (c.noStart && m.live_until) s.push({ key: 'start', label: `${c.noStartMins} minutes after it opens, if not started`, at: af + c.noStartMins * 60000 });
    return s;
  };
  const audienceOf = (m, step) => (step === 'start'
    ? all(`SELECT u.id, u.name FROM users u WHERE ${activeStudents} AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id AND a.mock_id=?)`, m.id)
    : all(`SELECT u.id, u.name FROM users u WHERE ${activeStudents} AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id AND a.mock_id=? AND a.status='submitted')`, m.id));
  const mockRunner = async ({ t, dryRun, channels }) => {
    const c = mrCfg(); if (!c.enabled) return null; const out = {};
    for (const m of all(`SELECT * FROM mocks WHERE status='published' AND available_from IS NOT NULL AND id NOT IN ${NOT_MOCK} AND available_from>?`, t - 2 * DAY)) {
      const af = m.available_from;
      for (const s of stepsOf(m, c)) {
        const due = s.key === 'start' ? t >= s.at && t < Math.min(m.live_until, s.at + HOUR) : s.key === 'hour' ? t >= s.at && t < af : t >= s.at && t < af - HOUR;
        if (!due) continue;
        const ref = `mockrem:${s.key}:${m.id}:${af}`; const have = new Set(all('SELECT user_id FROM notifications WHERE ref=?', ref).map((x) => x.user_id));
        const todo = audienceOf(m, s.key).filter((u) => !have.has(u.id)); const rule = (out[`mock_${s.key}`] ||= { eligible: 0, sent: 0 }); rule.eligible += todo.length; if (dryRun) continue;
        const live = !!m.live_until; const when = `${dateLabel(af, t)} at ${clock(af)}`;
        const title = s.key === 'start' ? `${m.name} is live now` : s.key === 'hour' ? `${m.name} opens at ${clock(af)}` : `${m.name} opens ${when}`;
        const body = s.key === 'start' ? `The live window closes at ${clock(m.live_until)}. Start now so you finish in time.` : live ? `It is a live test and closes at ${clock(m.live_until)}. Be ready five minutes early, in a quiet place.` : 'Plan the full time without interruptions, and keep rough paper ready.';
        await notifier.pool(todo, 8, async (u) => { const o = await notifier.notify(u.id, { kind: 'reminder', ref, title, body, link: `/mock/${m.id}`, channels }); if (!o.duplicate && !o.skipped) rule.sent++; });
      }
    }
    return Object.keys(out).length ? out : null;
  };

  // ================= route mounting =================
  const send = (res, r) => (r.error ? res.status(r.code || 400).json({ error: r.error }) : res.json(r));
  function mountPublic(api) {
    api.get('/public/certificate/:code', (req, res) => {
      res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      const x = one('SELECT c.*, u.name FROM certificates c JOIN users u ON u.id=c.user_id WHERE c.code=?', String(req.params.code || '').toUpperCase().slice(0, 20));
      if (!x) return res.status(404).json({ error: 'No certificate has this code.' });
      const c = certCfg();
      res.json({ valid: !x.revoked_at, revoked: !!x.revoked_at, code: x.code, name: x.name, kind: x.kind, title: x.title, detail: x.detail, issuedAt: x.issued_at, org: c.orgName || notifier.siteName(), signerName: c.signerName, signerTitle: c.signerTitle });
    });
  }
  function mountStudent(api) {
    api.get('/my/certificates', (req, res) => {
      const { c, fresh, best } = issueFor(req.user);
      if (fresh.length) notifier.notify(req.user.id, { kind: 'certificate', ref: `cert:${req.user.id}:${fresh.length}:${now()}`, title: `You earned: ${fresh[0]}`, body: 'Open Certificates in your profile to download or share it.', link: '/profile', channels: { inapp: true } }).catch(() => {});
      const list = all('SELECT * FROM certificates WHERE user_id=? AND revoked_at IS NULL ORDER BY issued_at DESC', req.user.id).map(certOut);
      const have = best ? best.size : 0; const topPct = best && best.size ? Math.max(...[...best.values()].map((x) => x.pct)) : 0;
      res.json({ enabled: c.enabled, certs: list, next: { completion: { have, need: c.completionMocks, done: have >= c.completionMocks }, merit: { need: c.meritPct, best: topPct } } });
    });
    api.get('/attempts/:id/desk', (req, res) => {
      const a = one("SELECT * FROM attempts WHERE id=? AND user_id=?", req.params.id, req.user.id); if (!a) return res.status(404).json({ error: 'Attempt not found' });
      const mine = all('SELECT * FROM desk_doubts WHERE attempt_id=? AND user_id=? ORDER BY created_at', a.id, req.user.id).map((d) => ({ id: d.id, questionId: d.question_id, text: d.text, status: d.status, answer: d.answer, answeredName: d.answered_name, answeredAt: d.answered_at, createdAt: d.created_at }));
      let ids = []; try { ids = readResult(a).questions.map((q) => q.id).slice(0, 300); } catch { /* unreadable */ }
      const shared = {}; if (ids.length) for (const d of all(`SELECT question_id, text, answer, answered_name, answered_at FROM desk_doubts WHERE shared=1 AND status='answered' AND user_id!=? AND question_id IN (${ph(ids.length)}) ORDER BY answered_at DESC LIMIT 200`, req.user.id, ...ids)) { const l = (shared[d.question_id] ||= []); if (l.length < 3) l.push({ asked: d.text, answer: d.answer, by: d.answered_name, at: d.answered_at }); }
      res.json({ mine, shared, open: one("SELECT COUNT(*) c FROM desk_doubts WHERE user_id=? AND status='open'", req.user.id).c, limit: 5 });
    });
    api.post('/attempts/:id/desk', (req, res) => {
      const a = one("SELECT * FROM attempts WHERE id=? AND user_id=? AND status='submitted'", req.params.id, req.user.id); if (!a) return res.status(404).json({ error: 'Finish the test first, then ask about its questions' });
      const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600); if (text.length < 5) return res.status(400).json({ error: 'Describe what you are stuck on, at least a few words' });
      let q = null; try { q = readResult(a).questions.find((x) => x.id === req.body?.questionId); } catch { /* unreadable */ } if (!q) return res.status(400).json({ error: 'Question not found in this test' });
      const t = now(); if (one("SELECT COUNT(*) c FROM desk_doubts WHERE user_id=? AND status='open'", req.user.id).c >= 5) return res.status(429).json({ error: 'You have 5 doubts waiting. Wait for answers before asking more.' });
      if (one('SELECT COUNT(*) c FROM desk_doubts WHERE user_id=? AND created_at>?', req.user.id, t - DAY).c >= 10) return res.status(429).json({ error: 'You can ask 10 doubts a day. Try again tomorrow.' });
      if (one("SELECT 1 x FROM desk_doubts WHERE user_id=? AND attempt_id=? AND question_id=? AND status='open'", req.user.id, a.id, q.id)) return res.status(409).json({ error: 'You already have a doubt waiting on this question' });
      const batch = one('SELECT bm.batch_id id FROM batch_members bm JOIN batches b ON b.id=bm.batch_id WHERE bm.user_id=? AND b.archived=0 ORDER BY bm.joined_at DESC LIMIT 1', req.user.id);
      const r = db.prepare('INSERT INTO desk_doubts(user_id,attempt_id,question_id,mock_id,batch_id,text,created_at) VALUES (?,?,?,?,?,?,?)').run(req.user.id, a.id, q.id, a.mock_id, batch?.id || null, text, t);
      if (batch) for (const tc of all('SELECT user_id FROM batch_teachers WHERE batch_id=?', batch.id)) notifier.notify(tc.user_id, { kind: 'desk', ref: `deskq:${r.lastInsertRowid}:${tc.user_id}`, title: `${str(req.user.name, 30)} asked a doubt`, body: text.slice(0, 140), link: '/teacher/doubts', channels: { inapp: true } }).catch(() => {});
      res.json({ ok: true, id: Number(r.lastInsertRowid) });
    });
  }
  function mountTeacher(api) {
    const guard = (req, res, next) => (req.user?.role === 'teacher' ? next() : res.status(403).json({ error: 'Teacher access only' }));
    api.get('/teacher/batch-health', guard, (req, res) => res.json(boardFor(req.user)));
    api.post('/teacher/batch-health/nudge', guard, async (req, res) => send(res, await nudge(req.user, req.body)));
    api.get('/teacher/desk', guard, (req, res) => res.json(deskList(req.user, req.query.status)));
    api.post('/teacher/desk/:id/answer', guard, async (req, res) => send(res, await deskAnswer(req.user, Number(req.params.id), req.body)));
    api.post('/teacher/desk/:id/close', guard, (req, res) => send(res, deskClose(req.user, Number(req.params.id))));
  }
  function mountAdmin({ r, audit, bad }) {
    r.get('/batch-health', (req, res) => res.json(boardFor(req.user)));
    r.post('/batch-health/nudge', async (req, res) => { const o = await nudge(req.user, req.body); if (o.ok) audit(req, 'batch_nudge', String(req.body.batchId), `${o.sent} students`); send(res, o); });
    r.get('/desk', (req, res) => res.json(deskList(req.user, req.query.status)));
    r.post('/desk/:id/answer', async (req, res) => { const o = await deskAnswer(req.user, Number(req.params.id), req.body); if (o.ok) audit(req, 'desk_answer', req.params.id); send(res, o); });
    r.post('/desk/:id/close', (req, res) => send(res, deskClose(req.user, Number(req.params.id))));

    r.get('/certificates', (req, res) => {
      const q = `%${str(req.query.q, 60)}%`; const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
      const where = 'WHERE (u.name LIKE ? OR u.email LIKE ? OR c.code LIKE ? OR c.title LIKE ?)';
      const rows = all(`SELECT c.*, u.name, u.email FROM certificates c JOIN users u ON u.id=c.user_id ${where} ORDER BY c.issued_at DESC LIMIT ? OFFSET ?`, q, q, q, q, size, (page - 1) * size);
      const total = one(`SELECT COUNT(*) c FROM certificates c JOIN users u ON u.id=c.user_id ${where}`, q, q, q, q).c;
      res.json({ config: certCfg(), total, page, size, certs: rows.map((x) => ({ ...certOut(x), student: x.name, userId: x.user_id, manual: !!x.manual })), counts: { issued: one('SELECT COUNT(*) c FROM certificates WHERE revoked_at IS NULL').c, revoked: one('SELECT COUNT(*) c FROM certificates WHERE revoked_at IS NOT NULL').c, students: one('SELECT COUNT(DISTINCT user_id) c FROM certificates WHERE revoked_at IS NULL').c } });
    });
    r.put('/certificates-config', (req, res) => { const v = cleanCert(req.body); settings.set('certs', v); audit(req, 'cert_config', '', `completion ${v.completionMocks}, merit ${v.meritPct}%`); res.json({ config: v }); });
    r.post('/certificates/issue', (req, res) => {
      const contact = str(req.body?.contact, 120).toLowerCase(); const u = one('SELECT id, name FROM users WHERE LOWER(email)=? OR phone=?', contact, contact.replace(/\D/g, '')); if (!u) return bad(res, 'No student has that email or phone', 404);
      const title = str(req.body?.title, 80); if (title.length < 3) return bad(res, 'Give the certificate a title');
      const code = codeGen(); db.prepare("INSERT INTO certificates(code,user_id,kind,mock_id,title,detail,issued_at,manual,by_name) VALUES (?,?,?,?,?,?,?,1,?)").run(code, u.id, 'special', `manual-${code}`, title, str(req.body?.detail, 160), now(), req.user.name);
      notifier.notify(u.id, { kind: 'certificate', ref: `cert:${code}`, title: `You received: ${title}`, body: 'Open Certificates in your profile to download or share it.', link: '/profile', channels: { inapp: true } }).catch(() => {});
      audit(req, 'cert_issue', code, `${u.name}: ${title}`); res.json({ ok: true, code });
    });
    r.post('/certificates/:code/revoke', (req, res) => {
      const x = one('SELECT * FROM certificates WHERE code=?', req.params.code); if (!x) return bad(res, 'Certificate not found', 404);
      db.prepare('UPDATE certificates SET revoked_at=? WHERE code=?').run(req.body?.undo ? null : now(), x.code); audit(req, req.body?.undo ? 'cert_restore' : 'cert_revoke', x.code); res.json({ ok: true });
    });

    r.get('/mock-reminders', (req, res) => {
      const c = mrCfg(); const t = now(); const out = [];
      for (const m of all(`SELECT * FROM mocks WHERE status='published' AND available_from IS NOT NULL AND id NOT IN ${NOT_MOCK} AND (available_from>? OR (live_until IS NOT NULL AND live_until>?)) ORDER BY available_from LIMIT 30`, t - HOUR, t)) {
        const steps = stepsOf(m, c).map((s) => { const sent = one('SELECT COUNT(*) c FROM notifications WHERE ref=?', `mockrem:${s.key}:${m.id}:${m.available_from}`).c; return { ...s, sent, state: sent ? 'sent' : t >= s.at ? 'due' : 'later' }; });
        out.push({ id: m.id, name: m.name, opensAt: m.available_from, closesAt: m.live_until, live: !!m.live_until, audience: audienceOf(m, 'day').length, steps });
      }
      res.json({ config: c, upcoming: out });
    });
    r.put('/mock-reminders', (req, res) => { const v = cleanMockRem(req.body); settings.set('mockReminders', v); audit(req, 'mock_reminders', '', v.enabled ? 'on' : 'off'); res.json({ config: v }); });
  }
  return { mountPublic, mountStudent, mountTeacher, mountAdmin, mockRunner, healthOf, issueFor, certCfg, nudge };
}
