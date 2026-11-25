import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v24-'));
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


const rq = (id, status, sel = 1) => ({ id, section: 'maths', topic: 'Algebra', difficulty: 'moderate', text: 'What is x?', options: ['a', 'b', 'c', 'd'], correct: 1, selected: status === 'unattempted' ? null : sel, status, timeSec: 60, explanation: 'e', marks: 2, marksAwarded: status === 'correct' ? 2 : -0.5 });
function addAttempt(id, email, mockId, pct, at) {
  const qs = [rq('q1', pct >= 50 ? 'correct' : 'incorrect', pct >= 50 ? 1 : 0), rq('q2', 'correct')];
  const res = { version: RESULT_VERSION, attempt: { id, mockId, mockName: mockId }, summary: { score: pct, maxMarks: 100, percentage: pct, accuracy: pct, attempted: 2, correct: 1, incorrect: 1, unattempted: 0, timeTakenSec: 600, avgTimePerQuestionSec: 60, marked: 0 }, sections: [], qualifying: [], topics: [], questions: qs };
  db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,started_at,submitted_at,result) VALUES (?,?,?,'submitted',0,?,?,?)").run(id, idOf(email), mockId, at - 1000, at, JSON.stringify(res));
}
const mk = (id, n) => db.prepare("INSERT OR IGNORE INTO mocks(id,number,name,difficulty,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, n, 'Mock ' + n, 'moderate', 'published', clock, clock);
const DAY = 86400000;
let batchId;

test('set up people and a batch', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss24@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss24@example.com'").run();
  await call('tea', 'POST', '/auth/register', { name: 'Tina Teacher', email: 'tina24@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='tina24@example.com'").run();
  await call('tea2', 'POST', '/auth/register', { name: 'Other Teacher', email: 'other24@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='other24@example.com'").run();
  for (const n of ['good', 'drop', 'gone', 'idle']) await call(n, 'POST', '/auth/register', { name: `Stu ${n}`, email: `${n}@24.example.com`, password: 'password123' });
  batchId = Number(db.prepare("INSERT INTO batches(name,code,created_at,created_by,archived) VALUES ('Morning','MORN24',?,?,0)").run(clock, 'x').lastInsertRowid);
  db.prepare('INSERT INTO batch_teachers(batch_id,user_id) VALUES (?,?)').run(batchId, idOf('tina24@example.com'));
  for (const n of ['good', 'drop', 'gone', 'idle']) db.prepare('INSERT INTO batch_members(batch_id,user_id,joined_at) VALUES (?,?,?)').run(batchId, idOf(`${n}@24.example.com`), clock - 20 * DAY);
  for (let i = 1; i <= 6; i++) mk('m24_' + i, 240 + i);
});

test('batch health: flags slipping, absent and idle students; nudges once a day; scoping', async () => {
  [70, 72, 71].forEach((p, i) => addAttempt('g' + i, 'good@24.example.com', 'm24_' + (i + 1), p, clock - (10 - i) * DAY));
  [80, 82, 78, 55, 48].forEach((p, i) => addAttempt('d' + i, 'drop@24.example.com', 'm24_' + (i + 1), p, clock - (12 - i) * DAY));
  [60, 65].forEach((p, i) => addAttempt('x' + i, 'gone@24.example.com', 'm24_' + (i + 1), p, clock - (30 - i) * DAY));
  db.prepare('UPDATE users SET last_seen=? WHERE email=?').run(clock - 40000, 'good@24.example.com');
  db.prepare('UPDATE users SET last_seen=? WHERE email=?').run(clock - 2 * DAY, 'drop@24.example.com');
  db.prepare('UPDATE users SET last_seen=? WHERE email=?').run(clock - 20 * DAY, 'gone@24.example.com');
  db.prepare('UPDATE users SET last_seen=NULL WHERE email=?').run('idle@24.example.com');
  const r = await call('tea', 'GET', '/teacher/batch-health'); assert.equal(r.status, 200, r.text.slice(0, 200));
  const b = r.body.batches[0]; const by = Object.fromEntries(b.students.map((s) => [s.name, s]));
  assert.equal(by['Stu good'].level, 'ok');
  assert.ok(by['Stu drop'].keys.includes('drop'), JSON.stringify(by['Stu drop']));
  assert.ok(by['Stu gone'].keys.includes('absent') && by['Stu gone'].level === 'risk');
  assert.ok(by['Stu idle'].keys.includes('idle'));
  assert.equal(b.total, 4); assert.ok(b.risk >= 1 && b.health < 100);
  assert.equal(b.students[0].level !== 'ok', true); // worst first
  assert.equal((await call('tea2', 'GET', '/teacher/batch-health')).body.batches.length, 0);
  assert.equal((await call('tea2', 'POST', '/teacher/batch-health/nudge', { batchId, userIds: [idOf('gone@24.example.com')] })).status, 404);
  const n1 = await call('tea', 'POST', '/teacher/batch-health/nudge', { batchId, userIds: [idOf('gone@24.example.com'), idOf('idle@24.example.com'), 999999] }); assert.equal(n1.body.sent, 2, n1.text);
  const n2 = await call('tea', 'POST', '/teacher/batch-health/nudge', { batchId, userIds: [idOf('gone@24.example.com')] }); assert.equal(n2.body.sent, 0); assert.equal(n2.body.already, 1);
  assert.equal((await call('tea', 'POST', '/teacher/batch-health/nudge', { batchId, userIds: [] })).status, 400);
  const inbox = db.prepare("SELECT title, body FROM notifications WHERE user_id=? AND kind='nudge'").all(idOf('gone@24.example.com')); assert.equal(inbox.length, 1); assert.match(inbox[0].title, /Tina Teacher/);
  assert.equal((await call('good', 'GET', '/teacher/batch-health')).status, 403);
  const a = await call('boss', 'GET', '/admin/batch-health'); assert.equal(a.status, 200); assert.equal(a.body.totals.students, 4);
});

test('doubt desk: ask, queue, answer, share, caps and scoping', async () => {
  assert.equal((await call('drop', 'POST', '/attempts/d4/desk', { questionId: 'q1', text: 'Why is option b right?' })).status, 200);
  assert.equal((await call('drop', 'POST', '/attempts/d4/desk', { questionId: 'q1', text: 'Again the same one' })).status, 409);
  assert.equal((await call('drop', 'POST', '/attempts/d4/desk', { questionId: 'q1', text: 'hi' })).status, 400);
  assert.equal((await call('drop', 'POST', '/attempts/d4/desk', { questionId: 'nope', text: 'This question does not exist' })).status, 400);
  assert.equal((await call('good', 'POST', '/attempts/d4/desk', { questionId: 'q1', text: 'This is not my attempt' })).status, 404);
  const q = (await call('tea', 'GET', '/teacher/desk')).body; assert.equal(q.stats.open, 1); const d = q.doubts[0];
  assert.equal(d.student, 'Stu drop'); assert.equal(d.q.options.length, 4); assert.equal(d.text, 'Why is option b right?');
  assert.equal((await call('tea2', 'GET', '/teacher/desk')).body.doubts.length, 0);
  assert.equal((await call('tea2', 'POST', `/teacher/desk/${d.id}/answer`, { answer: 'Not my student' })).status, 404);
  assert.equal((await call('tea', 'POST', `/teacher/desk/${d.id}/answer`, { answer: '' })).status, 400);
  assert.equal((await call('tea', 'POST', `/teacher/desk/${d.id}/answer`, { answer: 'Substitute x = 1 and compare.', share: true })).status, 200);
  const mine = (await call('drop', 'GET', '/attempts/d4/desk')).body; assert.equal(mine.mine[0].status, 'answered'); assert.match(mine.mine[0].answer, /Substitute/); assert.equal(mine.mine[0].answeredName, 'Tina Teacher');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND kind='desk'").get(idOf('drop@24.example.com')));
  addAttempt('g_same', 'good@24.example.com', 'm24_5', 66, clock - DAY);
  const peer = (await call('good', 'GET', '/attempts/g_same/desk')).body; assert.equal(peer.shared.q1.length, 1); assert.match(peer.shared.q1[0].answer, /Substitute/);
  assert.equal((await call('drop', 'GET', '/attempts/d4/desk')).body.shared.q1, undefined, 'own doubt is not shown as shared');
  // caps: 5 open at once
  for (let i = 0; i < 5; i++) { addAttempt('cap' + i, 'drop@24.example.com', 'm24_6', 50, clock - i * 1000); await call('drop', 'POST', `/attempts/cap${i}/desk`, { questionId: 'q2', text: 'Cap test number ' + i }); }
  assert.equal((await call('drop', 'POST', '/attempts/d3/desk', { questionId: 'q1', text: 'One more please' })).status, 429);
  const adm = (await call('boss', 'GET', '/admin/desk')).body; assert.ok(adm.stats.open >= 5);
  assert.equal((await call('boss', 'POST', `/admin/desk/${adm.doubts[0].id}/close`, {})).status, 200);
  assert.equal((await call('boss', 'GET', '/admin/desk?status=closed')).body.doubts.length, 1);
});

test('mock reminders: day, hour and not-started nudges are sent once; settings can switch them off', async () => {
  const set = (id, from, until) => db.prepare('UPDATE mocks SET available_from=?, live_until=? WHERE id=?').run(from, until || null, id);
  set('m24_1', clock + 20 * HOUR_(), null); set('m24_2', clock + 30 * 60000, null); set('m24_3', clock - 15 * 60000, clock + 3 * HOUR_());
  const adm = await call('boss', 'GET', '/admin/mock-reminders'); assert.equal(adm.status, 200); assert.ok(adm.body.upcoming.length >= 3); assert.ok(adm.body.config.enabled);
  const r1 = await app.runReminders({ force: true }); const rules = r1.rules;
  assert.ok(rules.mock_day?.sent > 0, JSON.stringify(rules)); assert.ok(rules.mock_hour?.sent > 0); assert.ok(rules.mock_start?.sent > 0);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE ref LIKE 'mockrem:day:m24_1:%'").get());
  assert.match(db.prepare("SELECT title FROM notifications WHERE ref LIKE 'mockrem:hour:m24_2:%'").get().title, /opens at/);
  const r2 = await app.runReminders({ force: true }); assert.ok(!r2.rules.mock_day?.sent && !r2.rules.mock_hour?.sent && !r2.rules.mock_start?.sent, JSON.stringify(r2.rules));
  // students who already finished the mock are not nudged
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE ref LIKE 'mockrem:day:m24_1:%' AND user_id=?").get(idOf('good@24.example.com')).c, 0, 'good already finished m24_1');
  const off = await call('boss', 'PUT', '/admin/mock-reminders', { enabled: false, noStartMins: 999 }); assert.equal(off.status, 200); assert.equal(off.body.config.noStartMins, 60);
  set('m24_4', clock + 40 * 60000, null); const r3 = await app.runReminders({ force: true }); assert.ok(!r3.rules.mock_hour, 'disabled');
});
function HOUR_() { return 3600000; }

test('certificates: auto issue, public verify, revoke, manual issue, config limits', async () => {
  // student "good" has m24_1..m24_3 plus g_same on m24_5: 4 mocks, pct 70-72 and 66 so no merit yet
  let r = (await call('good', 'GET', '/my/certificates')).body; assert.equal(r.certs.length, 0); assert.equal(r.next.completion.have, 4); assert.equal(r.next.completion.need, 5);
  addAttempt('g_hi', 'good@24.example.com', 'm24_6', 91, clock - 3600000);
  r = (await call('good', 'GET', '/my/certificates')).body; assert.deepEqual(r.certs.map((c) => c.kind).sort(), ['completion', 'merit']);
  const again = (await call('good', 'GET', '/my/certificates')).body; assert.equal(again.certs.length, 2, 'no duplicates');
  const merit = r.certs.find((c) => c.kind === 'merit'); assert.match(merit.detail, /91/); assert.match(merit.code, /^C-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const pub = await fetch(`${base}/api/public/certificate/${merit.code}`); assert.equal(pub.status, 200); const pj = await pub.json();
  assert.equal(pj.valid, true); assert.equal(pj.name, 'Stu good'); assert.ok(!JSON.stringify(pj).includes('@'));
  assert.equal((await fetch(`${base}/api/public/certificate/C-NOPE-NOPE`)).status, 404);
  assert.equal((await call('good', 'POST', `/admin/certificates/${merit.code}/revoke`, {})).status, 403);
  assert.equal((await call('boss', 'POST', `/admin/certificates/${merit.code}/revoke`, {})).status, 200);
  assert.equal((await (await fetch(`${base}/api/public/certificate/${merit.code}`)).json()).valid, false);
  assert.equal((await call('good', 'GET', '/my/certificates')).body.certs.length, 1, 'revoked ones are hidden and not re-issued');
  assert.equal((await call('good', 'GET', '/my/certificates')).body.certs.some((c) => c.kind === 'merit'), false);
  await call('boss', 'POST', `/admin/certificates/${merit.code}/revoke`, { undo: true }); assert.equal((await call('good', 'GET', '/my/certificates')).body.certs.length, 2);
  const man = await call('boss', 'POST', '/admin/certificates/issue', { contact: 'idle@24.example.com', title: 'Best improver of the month', detail: 'Keep it up' }); assert.equal(man.status, 200, man.text);
  assert.equal((await call('boss', 'POST', '/admin/certificates/issue', { contact: 'nobody@x.com', title: 'Whatever' })).status, 404);
  assert.equal((await call('idle', 'GET', '/my/certificates')).body.certs[0].title, 'Best improver of the month');
  const list = (await call('boss', 'GET', '/admin/certificates?q=Stu')).body; assert.ok(list.total >= 3); assert.ok(list.counts.issued >= 3);
  const cfg = await call('boss', 'PUT', '/admin/certificates-config', { completionMocks: 0, meritPct: 5, signerName: '  Dr  Rao ', orgName: 'Test Academy' }); assert.equal(cfg.body.config.completionMocks, 1); assert.equal(cfg.body.config.meritPct, 30); assert.equal(cfg.body.config.signerName, 'Dr Rao');
  assert.equal((await (await fetch(`${base}/api/public/certificate/${merit.code}`)).json()).org, 'Test Academy');
  await call('boss', 'PUT', '/admin/certificates-config', { enabled: false }); assert.equal((await call('drop', 'GET', '/my/certificates')).body.certs.length, 0);
});

test('staff permissions for the new pages', async () => {
  await call('ed', 'POST', '/auth/register', { name: 'Ed', email: 'ed24@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='editor', perms='[\"content\"]' WHERE email='ed24@example.com'").run();
  assert.equal((await call('ed', 'GET', '/admin/batch-health')).status, 403); assert.equal((await call('ed', 'GET', '/admin/desk')).status, 403); assert.equal((await call('ed', 'GET', '/admin/certificates')).status, 403);
  assert.equal((await call('ed', 'GET', '/admin/mock-reminders')).status, 200);
  db.prepare("UPDATE users SET perms='[\"content\",\"students\",\"support\"]' WHERE email='ed24@example.com'").run();
  assert.equal((await call('ed', 'GET', '/admin/batch-health')).status, 200); assert.equal((await call('ed', 'GET', '/admin/desk')).status, 200); assert.equal((await call('ed', 'GET', '/admin/certificates')).status, 200);
  assert.equal((await call('ed', 'PUT', '/admin/certificates-config', {})).status, 403);
});
