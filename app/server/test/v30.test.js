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

test('load test: sign-in rush, browsing, and admin dashboards, each with a plain result', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss LT', email: 'boss30lt@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss30lt@example.com'").run();
  await call('boss', 'PUT', '/admin/abuse/config', { trusted: ['127.0.0.1', '::1'] });
  const run = async (body) => {
    const st = await call('boss', 'POST', '/admin/loadtest/start', { confirm: 'start', ...body }); assert.equal(st.status, 202, st.text);
    let g; for (let n = 0; n < 120; n++) { await new Promise((r) => setTimeout(r, 400)); g = (await call('boss', 'GET', '/admin/loadtest')).body; if (['done', 'failed'].includes(g.run?.phase)) break; }
    assert.equal(g.run.phase, 'done', g.run.error); return (await call('boss', 'GET', `/admin/loadtest/report/${g.history[0].id}`)).body.report;
  };
  // no mock is needed when nobody sits an exam
  const a = await run({ focus: 'signin', users: 8, durationSec: 5, signinPerMin: 30 });
  assert.equal(a.config.users, 0); assert.equal(a.people, 8); assert.ok(a.kinds.login.n >= 8, 'sign-ins were sent'); assert.equal(a.kinds.login.errors, 0, 'the per-IP sign-in limit does not block the test');
  assert.ok(a.areas.some((x) => x.key === 'signin') && !a.areas.some((x) => x.key === 'save'), 'only tested areas are listed');
  assert.ok(a.score >= 85 && a.scoreWhy.small && a.simple.note, 'a small clean test scores high but is flagged as small'); assert.equal(a.scoreV, 2);
  assert.ok(a.simple.title && a.simple.numbers.length === 4 && Array.isArray(a.simple.fixes));
  const b = await run({ focus: 'browse', users: 6, durationSec: 5, browserPerMin: 30, pages: ['me', 'mocks'] });
  assert.ok(b.pages && b.pages.n > 0 && b.areas.some((x) => x.key === 'browse'));
  const c = await run({ focus: 'staff', users: 3, durationSec: 5, staffPerMin: 30 });
  assert.ok(c.admin && c.admin.n > 0, 'admin pages were opened'); assert.equal(c.totals.coreErrorPct, 0, 'virtual admins can open the dashboards');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@loadtest.invalid'").get().c, 0, 'virtual accounts removed');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions WHERE ua='loadtest'").get().c, 0);
});

test('load test score: one red or amber part caps it, and a clean run is not capped', async () => {
  const { scoreDetail, areasOf, bandOf } = await import('../loadtest.js');
  const mk = (save, errs = 0, extra = {}) => { const r = { config: { users: 100, browsers: 0, staff: 0, durationSec: 120 }, kinds: { save: { p95: save, p50: 50, n: 10 } }, peaks: { cpuProc: 30, memUsedPct: 40, writeMs: 10, lagMs: 20, diskUsedPct: 30 }, totals: { requests: 1000, errorPct: errs, coreErrorPct: errs, p95: save }, pages: null, admin: null, ...extra }; r.areas = areasOf(r); return scoreDetail(r); };
  const fine = mk(100); assert.ok(fine.score >= 90 && fine.caps.length === 0 && fine.band === 'Excellent', JSON.stringify(fine));
  const amber = mk(1200); assert.ok(amber.score <= 74 && amber.band === 'Shaky' && amber.caps.length === 1);
  const red = mk(5000); assert.ok(red.score <= 49 && red.band === 'Poor');
  const failing = mk(100, 8); assert.ok(failing.score <= 49, 'many failed requests make it poor even when the fast ones were fast');
  const halted = mk(100, 0, { stopped: 'safety' }); assert.ok(halted.score <= 25);
  assert.equal(bandOf(75), 'Good'); assert.equal(bandOf(74), 'Shaky');
});
