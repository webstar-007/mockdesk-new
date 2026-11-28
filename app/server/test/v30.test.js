import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v30-'));
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


test('abuse: counts requests, slows down heavy users, blocks and unblocks, refuses to block yourself', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss Admin', email: 'boss30@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss30@example.com'").run();
  let r = await call('boss', 'GET', '/admin/abuse'); assert.equal(r.status, 200); assert.equal(r.body.config.enabled, true); assert.deepEqual(r.body.config.trusted, ['127.0.0.1', '::1']);
  assert.equal((await call('boss', 'PUT', '/admin/abuse/config', { trusted: ['nonsense address'] })).status, 400);
  // the test machine is on loopback, so take it off the trusted list to see the limit work
  r = await call('boss', 'PUT', '/admin/abuse/config', { trusted: [], perIpPerMin: 40 }); assert.equal(r.status, 200); assert.equal(r.body.config.perIpPerMin, 40);
  let limited = 0; for (let i = 0; i < 60; i++) { const x = await call('anon', 'GET', '/mocks'); if (x.status === 429) limited++; }
  assert.ok(limited > 0, 'some requests were slowed down');
  r = await call('boss', 'GET', '/admin/abuse'); assert.ok(r.body.totals.requests60 > 40); assert.ok(r.body.hosts.length >= 1);
  assert.ok(r.body.events.some((e) => e.kind === 'throttled'));
  // an admin stuck behind the limit can still reach the dashboard once the window passes; widen it again
  clock += 120000; r = await call('boss', 'PUT', '/admin/abuse/config', { perIpPerMin: 5000 }); assert.equal(r.status, 200);
  assert.equal((await call('boss', 'POST', '/admin/abuse/block', { ip: '127.0.0.1' })).status, 400, 'cannot block yourself');
  assert.equal((await call('boss', 'POST', '/admin/abuse/block', { ip: 'not an ip' })).status, 400);
  r = await call('boss', 'POST', '/admin/abuse/block', { ip: '203.0.113.9', minutes: 30, reason: 'test' }); assert.equal(r.status, 200);
  r = await call('boss', 'GET', '/admin/abuse'); assert.equal(r.body.blocks.length, 1); assert.ok(r.body.blocks[0].left > 0);
  r = await call('boss', 'POST', '/admin/abuse/unblock', { ip: '203.0.113.9' }); assert.equal(r.status, 200);
  assert.equal((await call('boss', 'POST', '/admin/abuse/unblock', { ip: '203.0.113.9' })).status, 404);
  r = await call('boss', 'PUT', '/admin/abuse/config', { reset: true }); assert.equal(r.body.config.perIpPerMin, 600);
});

test('question scores: every measured question gets 0-100 with reasons, plus grades and per-mock averages', async () => {
  db.prepare("INSERT OR IGNORE INTO mocks(id,number,name,difficulty,status,created_at,updated_at) VALUES ('mq30',300,'Quality 30','moderate','published',?,?)").run(clock, clock);
  const { scoreOf } = await import('../lib/qscore.js');
  const good = scoreOf({ flags: [], pctRight: 62, disc: 0.45, n: 40, pctSkipped: 4 }); assert.equal(good.score, 100); assert.equal(good.grade, 'good');
  const bad = scoreOf({ flags: [{ key: 'wrong_key' }], pctRight: 8, disc: -0.2, n: 40, pctSkipped: 4 }); assert.ok(bad.score < 40); assert.equal(bad.grade, 'poor'); assert.ok(bad.parts.length >= 2);
  const mid = scoreOf({ flags: [{ key: 'no_explanation' }], pctRight: 55, disc: 0.15, n: 40, pctSkipped: 2 }); assert.equal(mid.grade, 'good'.replace('good', mid.score >= 80 ? 'good' : 'fair'));
  const r = await call('boss', 'GET', '/admin/quality?min=1'); assert.equal(r.status, 200); assert.ok('grades' in r.body && 'avgScore' in r.body && Array.isArray(r.body.mockScores));
});
