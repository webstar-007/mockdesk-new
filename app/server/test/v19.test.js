import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v19-'));
process.env.MOCKDESK_ADMINS_FILE = path.join(dir, 'none.txt'); process.env.MOCKDESK_ADMIN_EMAILS = ''; process.env.MOCKDESK_BACKUPS = path.join(dir, 'backups');
const { createApp } = await import('../app.js');
const { openDb } = await import('../lib/db.js');
const { recordError } = await import('../lib/health.js');
const { RESULT_VERSION } = await import('../lib/scoring.js');
let clock = Date.now(); const bump = (ms = 20000) => { clock += ms; };
const db = openDb(path.join(dir, 't.db'));
const mails = [];
const app = createApp(db, { now: () => clock, allowIncomplete: true, serveClient: false, credKeyFile: path.join(dir, 'k'), mailer: { send: async (m) => { mails.push(m); } } });
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
const jars = {};
async function call(who, method, url, body) {
  const jar = (jars[who] ||= {});
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar[k] = v; else delete jar[k]; }
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; } return { status: r.status, body: j, text };
}
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const idOf = (email) => db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
const Q = (o = {}) => ({ section: 'maths', text: 'What is 12 × 12?', options: ['124', '144', '154', '164'], answer: 1, difficulty: 'easy', topic: 'Arithmetic', explanation: '12 × 12 = 144.', steps: ['12 × 12 = 144'], ...o });
const setting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));

test('set up people', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss19@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss19@example.com'").run();
  await call('tea', 'POST', '/auth/register', { name: 'Tina Teacher', email: 'tina19@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='tina19@example.com'").run();
  for (let i = 0; i < 12; i++) await call('s' + i, 'POST', '/auth/register', { name: 'Stu ' + i, email: `s${i}_19@example.com`, password: 'password123' });
  assert.equal((await call('s0', 'GET', '/admin/alert-center')).status, 403);
});

test('alert centre: errors spike, failed backup and downtime raise alerts; email goes out once; they clear themselves', async () => {
  const put = await call('boss', 'PUT', '/admin/alert-center/prefs', { email: true, emails: 'owner@example.com', errorSpike: 3, minLevel: 'bad' }); assert.equal(put.status, 200);
  assert.equal((await call('boss', 'PUT', '/admin/alert-center/prefs', { emails: 'not-an-email' })).status, 400);
  for (let i = 0; i < 4; i++) recordError('test', 'boom ' + i);
  app.jobs.get('backup').lastError = 'Disk write failed';
  setting('alerts_hb', clock - 90 * 60000);
  const c = (await call('boss', 'POST', '/admin/alert-center/check')).body;
  const keys = c.items.map((x) => x.key); assert.ok(keys.includes('errors') && keys.includes('backup-failed') && keys.some((k) => k.startsWith('down:')), keys.join(','));
  assert.ok(c.summary.bad >= 3 && c.summary.unread >= 3);
  await app.jobs.alerts.waitSends(); assert.ok(mails.length >= 3); assert.equal(mails[0].to, 'owner@example.com');
  const n = mails.length; await call('boss', 'POST', '/admin/alert-center/check'); await app.jobs.alerts.waitSends(); assert.equal(mails.length, n, 'no repeat emails for the same problem');
  // mark read, snooze
  const first = c.items[0]; await call('boss', 'POST', '/admin/alert-center/read', { id: first.id });
  assert.equal((await call('boss', 'GET', '/admin/alert-center/summary')).body.summary.unread, c.summary.unread - 1);
  const bk = c.items.find((x) => x.key === 'backup-failed'); await call('boss', 'POST', `/admin/alert-center/${bk.id}/snooze`, { hours: 24 });
  assert.ok(!(await call('boss', 'GET', '/admin/alert-center')).body.items.some((x) => x.key === 'backup-failed'));
  // fixing the cause resolves it
  app.jobs.get('backup').lastError = '';
  await call('boss', 'POST', '/admin/alert-center/check');
  const hist = (await call('boss', 'GET', '/admin/alert-center?all=1')).body; assert.ok(hist.history.some((x) => x.key === 'backup-failed'));
  assert.equal((await call('boss', 'POST', '/admin/alert-center/test')).status, 200);
});

let mockId, aId, bId;
test('quality loop flags “nobody got it right” and “toppers got it wrong”, then suggests and makes a replacement', async () => {
  mockId = (await call('boss', 'POST', '/admin/mocks', { name: 'QL mock', difficulty: 'moderate' })).body.mock.id;
  aId = (await call('boss', 'POST', `/admin/mocks/${mockId}/questions`, Q({ text: 'Nobody gets this one right?', difficulty: 'moderate', topic: 'Algebra' }))).body.question.id;
  bId = (await call('boss', 'POST', `/admin/mocks/${mockId}/questions`, Q({ text: 'Toppers miss this one?', difficulty: 'moderate', topic: 'Algebra' }))).body.question.id;
  const rq = (id, status, sel) => ({ id, section: 'maths', topic: 'Algebra', difficulty: 'moderate', text: 'x', options: ['a', 'b', 'c', 'd'], correct: 1, selected: sel, status, timeSec: 30, explanation: 'e', marks: 2 });
  for (let i = 0; i < 20; i++) {
    const pct = 100 - i * 2; const top = i < 5; // top quarter of 20 = first 5
    const qs = [rq(aId, 'incorrect', i % 2 ? 0 : 2), rq(bId, top ? 'incorrect' : 'correct', top ? 0 : 1)];
    const res = { version: RESULT_VERSION, summary: { score: pct, maxMarks: 100, percentage: pct, accuracy: 50, attempted: 2, correct: 1, incorrect: 1, skipped: 0, timeTakenSec: 600 }, sections: [], topics: [], questions: qs };
    
    db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,started_at,submitted_at,result) VALUES (?,?,?,'submitted',0,?,?,?)").run('att19_' + i, idOf(`s${i % 12}_19@example.com`), mockId, clock - 5000, clock - 4000, JSON.stringify(res));
  }
  bump();
  const q = (await call('boss', 'GET', '/admin/quality?min=5&flag=any')).body;
  const a = q.questions.find((x) => x.id === aId), b = q.questions.find((x) => x.id === bId);
  void ("DBG", JSON.stringify(q.questions.map((x)=>[x.id,x.attempts,x.flags.map((f)=>f.key)])), aId, bId);
assert.ok(a?.flags.some((f) => f.key === 'nobody_right') && a.suggest === 'replace', JSON.stringify(a?.flags));
  assert.ok(b?.flags.some((f) => f.key === 'toppers_wrong') && b.suggest, JSON.stringify(b?.flags));
  bump(400000); // the weak-question list is cached for five minutes
  await call('boss', 'POST', '/admin/alert-center/check');
  const al = (await call('boss', 'GET', '/admin/alert-center')).body.items.find((x) => x.key === 'quality'); assert.ok(al && /review or replacement/.test(al.title)); assert.equal(al.link, 'quality');
  // replacement candidates come from the bank, same section
  const p1 = (await call('boss', 'POST', '/admin/mocks/pool/questions', Q({ text: 'Replacement algebra question?', topic: 'Algebra', difficulty: 'moderate' }))).body.question.id;
  await call('boss', 'POST', '/admin/mocks/pool/questions', Q({ text: 'Unrelated arithmetic question?', topic: 'Arithmetic', difficulty: 'easy' }));
  const sug = (await call('boss', 'GET', `/admin/quality/${aId}/replacements`)).body; assert.equal(sug.replacements[0].id, p1); assert.equal(sug.replacements[0].sameTopic, true);
  assert.equal((await call('boss', 'POST', `/admin/quality/${aId}/replace`, { withId: 'nope' })).status, 400);
  const rep = await call('boss', 'POST', `/admin/quality/${aId}/replace`, { withId: p1 }); assert.equal(rep.status, 200);
  assert.equal(db.prepare('SELECT mock_id FROM questions WHERE id=?').get(aId).mock_id, 'pool', 'old question goes back to the bank');
  assert.equal(db.prepare('SELECT mock_id FROM questions WHERE id=?').get(p1).mock_id, mockId);
  const inMock = db.prepare("SELECT id FROM questions WHERE mock_id=? AND section='maths' ORDER BY position").all(mockId).map((x) => x.id); assert.equal(inMock[0], p1, 'takes the old position');
  assert.equal((await call('boss', 'POST', `/admin/quality/${bId}/reviewed`)).status, 200);
});

test('builder: topic filter, preview, scheduled publish falls back to draft with a reason', async () => {
  for (let i = 0; i < 4; i++) await call('boss', 'POST', '/admin/mocks/pool/questions', Q({ text: `Geometry bank question ${i}?`, topic: 'Geometry', difficulty: 'easy' }));
  const tp = (await call('boss', 'GET', '/admin/mocks/build/topics')).body.sections.maths; assert.ok(tp.find((x) => x.topic === 'Geometry').easy >= 4);
  const plan = [{ section: 'maths', easy: 3 }];
  const dry = (await call('boss', 'POST', '/admin/mocks/build', { dryRun: true, plan, topics: ['Geometry'] })).body; assert.equal(dry.summary.picked, 3); assert.ok(dry.preview.every((x) => x.topic === 'Geometry'));
  const none = (await call('boss', 'POST', '/admin/mocks/build', { dryRun: true, plan, topics: ['Nonexistent'] })).body; assert.equal(none.summary.picked, 0);
  const at = new Date(clock + 3 * 86400000).toISOString();
  const b = await call('boss', 'POST', '/admin/mocks/build', { name: 'Scheduled build', plan, topics: ['Geometry'], publishAt: at }); assert.equal(b.status, 201);
  assert.equal(b.body.mock.status, 'published'); assert.ok(b.body.scheduled > clock); assert.equal(b.body.warnings.length, 0);
  const g = await call('boss', 'POST', '/admin/mocks/build', { name: 'Bad time build', plan, publishAt: 'whenever', allowPartial: true }); assert.equal(g.status, 201);
  assert.equal(g.body.mock.status, 'draft'); assert.ok(g.body.warnings.length, 'explains why it was not published');
});

test('auto-build: settings, a shortage raises an alert, and nothing runs until due', async () => {
  const bad = await call('boss', 'PUT', '/admin/auto-build', { enabled: true, everyDays: 7, mode: 'schedule', leadDays: 2 }); assert.equal(bad.status, 200);
  assert.equal(bad.body.config.enabled, true); assert.ok(bad.body.config.lastRun > 0, 'first run is one interval after switching on');
  assert.equal((await app.jobs.run('autobuild')).result, 'Not due yet');
  const run = (await call('boss', 'POST', '/admin/auto-build/run')).body; assert.equal(run.ok, false); assert.match(run.message, /short|bank/i);
  assert.ok((await call('boss', 'GET', '/admin/alert-center')).body.items.some((x) => x.key === 'autobuild-short'));
});

let batchId, asgId, ann, mockPub;
test('teacher assignments: create, notify, track, remind, and the job sends due notices', async () => {
  const t = idOf('tina19@example.com'); batchId = Number(db.prepare("INSERT INTO batches(name, code, created_at, created_by) VALUES ('Batch Z','ZZZ19',?, 'x')").run(clock).lastInsertRowid);
  db.prepare('INSERT INTO batch_teachers(batch_id,user_id) VALUES (?,?)').run(batchId, t);
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO batch_members(batch_id,user_id,joined_at) VALUES (?,?,?)').run(batchId, idOf(`s${i}_19@example.com`), clock);
  mockPub = mockId; db.prepare("UPDATE mocks SET status='published' WHERE id=?").run(mockPub);
  const due = clock + 3 * 3600000;
  assert.equal((await call('s0', 'POST', '/teacher/assignments', { batchId, kind: 'mock', mockId: mockPub, dueAt: due })).status, 403);
  assert.equal((await call('tea', 'POST', '/teacher/assignments', { batchId, kind: 'mock', mockId: mockPub, dueAt: clock - 1000 })).status, 400);
  assert.equal((await call('tea', 'POST', '/teacher/assignments', { batchId: 99999, kind: 'mock', mockId: mockPub, dueAt: due })).status, 404);
  const c = await call('tea', 'POST', '/teacher/assignments', { batchId, kind: 'mock', mockId: mockPub, dueAt: due, note: 'Attempt in one sitting' }); assert.equal(c.status, 201); asgId = c.body.assignment.id; assert.equal(c.body.notified, 3);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND kind='assignment'").get(idOf('s1_19@example.com')));
  // s0 already submitted this mock earlier (see quality test), so they count as done
  bump();
  const d = (await call('tea', 'GET', `/teacher/assignments/${asgId}`)).body.assignment; assert.equal(d.total, 3); assert.equal(d.done, 3); // s0..s2 all have attempts
  // make s2 not done by removing their attempt
  db.prepare("DELETE FROM attempts WHERE user_id=? AND mock_id=?").run(idOf('s2_19@example.com'), mockPub);
  const d2 = (await call('tea', 'GET', `/teacher/assignments/${asgId}`)).body.assignment; assert.equal(d2.pending, 1); assert.equal(d2.students.find((s) => !s.done).name, 'Stu 2');
  // student sees it, others do not
  const mine = (await call('s2', 'GET', '/my/assignments')).body; assert.equal(mine.items.length, 1); assert.equal(mine.pending, 1); assert.equal(mine.items[0].link, '/mock/' + mockPub);
  assert.equal((await call('s5', 'GET', '/my/assignments')).body.items.length, 0);
  // manual reminder is limited
  assert.equal((await call('tea', 'POST', `/teacher/assignments/${asgId}/remind`)).body.sent, 1);
  assert.equal((await call('tea', 'POST', `/teacher/assignments/${asgId}/remind`)).status, 429);
  // job: within a day of the deadline -> "due tomorrow"; after -> past due + teacher summary
  await app.jobs.run('assignments');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title LIKE 'Due tomorrow%'").get(idOf('s2_19@example.com')));
  db.prepare('UPDATE assignments SET due_at=? WHERE id=?').run(clock - 60000, asgId);
  await app.jobs.run('assignments');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title LIKE 'Past due%'").get(idOf('s2_19@example.com')));
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND kind='assignment_teacher'").get(idOf('tina19@example.com')));
  const n = db.prepare("SELECT COUNT(*) c FROM notifications WHERE kind='assignment_teacher'").get().c; await app.jobs.run('assignments'); assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE kind='assignment_teacher'").get().c, n, 'each notice goes out once');
  // admin alert and admin list
  await call('boss', 'POST', '/admin/alert-center/check'); assert.ok((await call('boss', 'GET', '/admin/alert-center')).body.items.some((x) => x.key === 'assign-overdue'));
  assert.equal((await call('boss', 'GET', '/admin/assignments')).body.items[0].overdue, true);
  // doing it clears the overdue state
  const res = { version: RESULT_VERSION, summary: { score: 10, maxMarks: 100, percentage: 10, accuracy: 50, attempted: 2, correct: 1, incorrect: 1, skipped: 0, timeTakenSec: 60 }, sections: [], topics: [], questions: [] };
  db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,started_at,submitted_at,result) VALUES ('late19',?,?,'submitted',0,?,?,?)").run(idOf('s2_19@example.com'), mockPub, clock - 100, clock, JSON.stringify(res));
  const d3 = (await call('tea', 'GET', `/teacher/assignments/${asgId}`)).body.assignment; assert.equal(d3.pending, 0); assert.equal(d3.late, 1, 'only the one who finished after the deadline is late');
  await call('boss', 'POST', '/admin/alert-center/check'); assert.ok(!(await call('boss', 'GET', '/admin/alert-center')).body.items.some((x) => x.key === 'assign-overdue'));
  assert.equal((await call('tea', 'DELETE', `/teacher/assignments/${asgId}`)).status, 200); assert.equal((await call('tea', 'GET', '/teacher/assignments')).body.items.length, 0);
});

test('practice assignment completes after submitted practice sets', async () => {
  const c = await call('tea', 'POST', '/teacher/assignments', { batchId, kind: 'practice', practiceSets: 2, dueAt: clock + 86400000 * 5 }); assert.equal(c.status, 201); assert.equal(c.body.assignment.practiceSets, 2);
  const id = c.body.assignment.id; const u = idOf('s0_19@example.com');
  const ins = (n) => db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,started_at,submitted_at,result) VALUES (?,?,'practice','submitted',0,?,?,'{}')").run('pr19_' + n, u, clock, clock + 5 + n);
  ins(1); assert.equal((await call('tea', 'GET', `/teacher/assignments/${id}`)).body.assignment.students.find((s) => s.id === u).done, false);
  ins(2); assert.equal((await call('tea', 'GET', `/teacher/assignments/${id}`)).body.assignment.students.find((s) => s.id === u).done, true);
});
