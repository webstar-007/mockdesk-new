import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v26-'));
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
const DAY = 86400000;
const ask = async (q) => (await call('boss', 'POST', '/admin/help/ask', { q })).body;
const att = (id, email, mock, score, at) => db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,started_at,submitted_at,score,accuracy) VALUES (?,?,?,'submitted',0,?,?,?,?)").run(id, idOf(email), mock, at - 1000, at, score, score);

test('help data engine: people, lists, mocks, batches and activity from plain questions', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss Admin', email: 'boss26@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss26@example.com'").run();
  await call('t', 'POST', '/auth/register', { name: 'Tina Teacher', email: 'tina26@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='tina26@example.com'").run();
  for (const [n, nm] of [['a', 'Asha Verma'], ['b', 'Bharat Kumar'], ['c', 'Chitra Rao'], ['d', 'Asha Menon']]) await call(n, 'POST', '/auth/register', { name: nm, email: `${n}@26.example.com`, password: 'password123' });
  const bid = Number(db.prepare("INSERT INTO batches(name,code,created_at,created_by,archived) VALUES ('Evening Crash','EVE26',?,?,0)").run(clock, 'x').lastInsertRowid);
  db.prepare('INSERT INTO batch_members(batch_id,user_id,joined_at) VALUES (?,?,?)').run(bid, idOf('a@26.example.com'), clock);
  db.prepare("INSERT INTO batches(name,code,created_at,created_by,archived) VALUES ('Weekend',?,?,?,0)").run('WKD26', clock, 'x');
  for (let i = 1; i <= 2; i++) db.prepare("INSERT OR IGNORE INTO mocks(id,number,name,difficulty,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run('m26_' + i, 260 + i, 'Alpha Series ' + i, 'moderate', 'published', clock, clock);
  att('x1', 'a@26.example.com', 'm26_1', 80, clock - DAY); att('x2', 'a@26.example.com', 'm26_2', 90, clock - 2 * DAY); att('x3', 'b@26.example.com', 'm26_1', 40, clock - DAY);
  db.prepare('UPDATE users SET last_seen=? WHERE email=?').run(clock - 40000, 'a@26.example.com');
  db.prepare('UPDATE users SET last_seen=? WHERE email=?').run(clock - 30 * DAY, 'b@26.example.com');

  let r = await ask('how many students do I have'); assert.equal(r.kind, 'data'); assert.equal(r.data.kind, 'stats'); assert.equal(r.data.stats[0].value, 4);
  r = await ask('show top 2 students'); assert.equal(r.data.table.rows.length, 2); assert.equal(r.data.table.rows[0].cells[0], 'Asha Verma');
  r = await ask('lowest scoring students'); assert.equal(r.data.table.rows[0].cells[0], 'Bharat Kumar');
  r = await ask('which students have not logged in for 14 days'); assert.ok(r.data.table.rows.some((x) => x.cells[0] === 'Bharat Kumar')); assert.ok(!r.data.table.rows.some((x) => x.cells[0] === 'Asha Verma'));
  r = await ask('students who never started a test'); assert.ok(r.data.title.includes('never started')); assert.ok(r.data.table.rows.some((x) => x.cells[0] === 'Chitra Rao'));
  r = await ask('who is online now'); assert.ok(r.data.table.rows.some((x) => x.cells[0] === 'Asha Verma'));
  r = await ask('tell me about chitra rao'); assert.equal(r.data.kind, 'profile'); assert.equal(r.data.title, 'Chitra Rao');
  r = await ask('how is asha verma doing'); assert.equal(r.data.kind, 'profile'); assert.match(r.data.summary, /2 tests/); assert.equal(r.data.stats.find((x) => x.label === 'Average score').value, 85); assert.ok(r.data.table.rows[0].to.startsWith('/admin/attempts/'));
  r = await ask('asha'); assert.equal(r.data.kind, 'list'); assert.equal(r.data.table.rows.length, 2);
  r = await ask('details of tina teacher'); assert.equal(r.data.kind, 'profile'); assert.ok(r.data.stats.some((x) => x.label === 'Batches taught'));
  r = await ask('show all teachers'); assert.equal(r.data.table.rows[0].cells[0], 'Tina Teacher');
  r = await ask('how many admins'); assert.equal(r.data.stats[0].value, 1);
  r = await ask('Evening Crash batch'); assert.equal(r.data.kind, 'profile'); assert.equal(r.data.stats.find((x) => x.label === 'Students').value, 1);
  r = await ask('which batches have no teacher'); assert.equal(r.data.table.rows.length, 2);
  r = await ask('which students are not in any batch'); assert.equal(r.data.table.rows.length, 3);
  r = await ask('which mock is the hardest'); assert.equal(r.data.table.rows[0].cells[0], 'Alpha Series 1');
  r = await ask('Alpha Series 2'); assert.equal(r.data.kind, 'profile'); assert.equal(r.data.stats.find((x) => x.label === 'Highest').value, 90);
  r = await ask('how many tests finished this week'); assert.equal(r.data.stats[0].value, 3);
  r = await ask('platform overview'); assert.ok(r.data.stats.length >= 8);
  r = await ask('what did admins do recently'); assert.equal(r.data.kind, 'list');
  r = await ask('failed sign-ins today'); assert.equal(r.data.kind, 'list');
  // how-to questions still go to the guide, capacity questions never become a student count
  r = await ask('how do I lock a teacher account'); assert.equal(r.kind, 'answer'); assert.ok(r.card && !r.data);
  r = await ask('how many students can my server handle'); assert.ok(!r.data);
  // load-test accounts never appear
  db.prepare("INSERT INTO users(name,email,created_at,role) VALUES ('Sim','s1@loadtest.invalid',?,'student')").run(new Date().toISOString());
  r = await ask('how many students do I have'); assert.equal(r.data.stats[0].value, 4);
  assert.equal((await call('t', 'POST', '/admin/help/ask', { q: 'students' })).status, 403);
});
