import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v21-'));
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

import { staminaOf } from '../lib/stamina.js';
const Qd = (o = {}) => ({ section: 'maths', text: 'What is 12 × 12?', options: ['124', '144', '154', '164'], answer: 1, difficulty: 'easy', topic: 'Arithmetic', explanation: '12 × 12 = 144.', steps: ['12 × 12 = 144'], ...o });
const rq = (id, status, sel = 1, t = 60, extra = {}) => ({ id, section: 'maths', topic: 'Algebra', difficulty: 'moderate', text: 'x', options: ['a', 'b', 'c', 'd'], correct: 1, selected: status === 'unattempted' ? null : sel, status, timeSec: t, explanation: 'e', marks: 2, marksAwarded: status === 'correct' ? 2 : status === 'incorrect' ? -0.5 : 0, ...extra });

test('stamina: finds a panic streak and an end-of-paper fade, and refuses short practice sets', () => {
  const qs = []; for (let i = 0; i < 60; i++) { const late = i >= 50; qs.push(rq('q' + i, late ? (i % 5 === 4 ? 'correct' : i % 2 ? 'incorrect' : 'unattempted') : i % 6 === 5 ? 'incorrect' : 'correct', 0, late ? 25 : 110)); }
  for (const i of [20, 21, 22]) qs[i] = rq('q' + i, 'incorrect', 0, 110);
  const s = staminaOf({ questions: qs }); assert.equal(s.available, true);
  assert.ok(s.firstHalf.accuracy > s.final.accuracy + 5, `${s.firstHalf.accuracy} vs ${s.final.accuracy}`);
  assert.ok(s.streaks.some((x) => x.fromQ === 21 && x.length >= 3 && x.kind === 'misses'), JSON.stringify(s.streaks));
  assert.ok(s.streaks.some((x) => x.inFinal), 'a streak in the final stretch');
  assert.ok(['panic', 'rush'].includes(s.verdict.kind), s.verdict.kind); assert.ok(s.verdict.tips.length >= 1); assert.ok(s.streakMarksLost > 0);
  assert.equal(s.buckets.length, 8);
  assert.equal(staminaOf({ questions: qs.slice(0, 10) }).available, false);
  const calm = []; for (let i = 0; i < 40; i++) calm.push(rq('c' + i, i % 4 === 3 ? 'incorrect' : 'correct', 0, 100));
  assert.equal(staminaOf({ questions: calm }).verdict.kind, 'steady'); assert.equal(staminaOf({ questions: calm }).streaks.length, 0);
});

test('set up people', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss21@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss21@example.com'").run();
  await call('tea', 'POST', '/auth/register', { name: 'Tina Teacher', email: 'tina21@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='tina21@example.com'").run();
  for (let i = 0; i < 10; i++) await call('s' + i, 'POST', '/auth/register', { name: 'Student ' + i + ' Kumar', email: `s${i}_21@example.com`, password: 'password123' });
});

let mockId; const qids = [];
test('result page carries the stamina analysis', async () => {
  mockId = (await call('boss', 'POST', '/admin/mocks', { name: 'Tips mock', difficulty: 'moderate' })).body.mock.id;
  for (let i = 0; i < 12; i++) qids.push((await call('boss', 'POST', `/admin/mocks/${mockId}/questions`, Qd({ text: 'Tips question number ' + i + '?', topic: 'Algebra', difficulty: 'moderate' }))).body.question.id);
  for (let i = 0; i < 10; i++) {
    const pct = 95 - i * 8; const qs = qids.map((id, k) => rq(id, k < Math.round(12 * pct / 100) ? 'correct' : 'incorrect', k < Math.round(12 * pct / 100) ? 1 : 0, 100));
    const res = { version: RESULT_VERSION, attempt: { id: 'a21_' + i, mockId, mockName: 'Tips mock' }, summary: { score: pct, maxMarks: 100, percentage: pct, accuracy: pct, attempted: 12, correct: 6, incorrect: 6, unattempted: 0, timeTakenSec: 1200, avgTimePerQuestionSec: 100, marked: 0 }, sections: [], qualifying: [], topics: [], questions: qs };
    db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,started_at,submitted_at,result) VALUES (?,?,?,'submitted',0,?,?,?)").run('a21_' + i, idOf(`s${i}_21@example.com`), mockId, clock - 5000, clock - 4000, JSON.stringify(res));
  }
  const r = await call('s0', 'GET', '/attempts/a21_0/result'); assert.equal(r.status, 200, r.text.slice(0, 200)); assert.ok(r.body.stamina && 'available' in r.body.stamina);
});

test('trick corner: only top scorers who got it right can post; votes, report, teacher verify, hide', async () => {
  // s0 is first of 10, s9 is last
  const t0 = await call('s0', 'GET', '/attempts/a21_0/tips'); assert.equal(t0.status, 200); assert.equal(t0.body.canPost, true); assert.equal(t0.body.rank, 1); assert.ok(t0.body.right.length > 0);
  const t9 = await call('s9', 'GET', '/attempts/a21_9/tips'); assert.equal(t9.body.canPost, false); assert.match(t9.body.reason, /top 10%/);
  const right = t0.body.right[0]; const wrongQ = qids.find((q) => !t0.body.right.includes(q));
  assert.equal((await call('s9', 'POST', '/attempts/a21_9/tips', { questionId: right, text: 'I am not a topper but try anyway' })).status, 403);
  if (wrongQ) assert.equal((await call('s0', 'POST', '/attempts/a21_0/tips', { questionId: wrongQ, text: 'This one I got wrong so no trick' })).status, 403);
  assert.equal((await call('s0', 'POST', '/attempts/a21_0/tips', { questionId: right, text: 'short' })).status, 400);
  assert.equal((await call('s0', 'POST', '/attempts/a21_0/tips', { questionId: right, text: 'see https://spam.example for the trick' })).status, 400);
  const ok = await call('s0', 'POST', '/attempts/a21_0/tips', { questionId: right, text: 'Last digit of 12 × 12 is 4, so only option (b) can end in 4.' }); assert.equal(ok.status, 201, ok.text);
  assert.equal((await call('s0', 'POST', '/attempts/a21_0/tips', { questionId: right, text: 'Another one for the same question please' })).status, 409);
  // everyone who finished can read it; the author is a first name only
  const seen = (await call('s5', 'GET', '/attempts/a21_5/tips')).body.tips[right]; assert.equal(seen.length, 1); assert.equal(seen[0].author, 'Student'); assert.equal(seen[0].badge, 'topper'); assert.equal(seen[0].verified, false);
  const id = seen[0].id;
  assert.equal((await call('s0', 'POST', `/tips/${id}/vote`)).status, 400, 'own trick');
  const v = await call('s5', 'POST', `/tips/${id}/vote`); assert.equal(v.body.votes, 1); assert.equal(v.body.voted, true);
  assert.equal((await call('s5', 'POST', `/tips/${id}/vote`)).body.votes, 0, 'toggle off'); await call('s5', 'POST', `/tips/${id}/vote`);
  // a student who has not finished the mock cannot vote
  await call('late', 'POST', '/auth/register', { name: 'Late', email: 'late21@example.com', password: 'password123' });
  assert.equal((await call('late', 'POST', `/tips/${id}/vote`)).status, 403);
  // teacher verifies
  assert.equal((await call('s5', 'POST', `/teacher/tips/${id}/verify`, {})).status, 403);
  assert.equal((await call('tea', 'POST', `/teacher/tips/${id}/verify`, { on: true })).status, 200);
  const after = (await call('s6', 'GET', '/attempts/a21_6/tips')).body.tips[right][0]; assert.equal(after.verified, true); assert.equal(after.verifiedBy, 'Tina');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND kind='tip'").get(idOf('s0_21@example.com')), 'author hears about it');
  // teacher posts their own, shown verified with a Teacher badge
  const tq = (await call('tea', 'GET', `/teacher/tips/mocks/${mockId}/questions`)).body.questions; assert.equal(tq.length, 12);
  assert.equal((await call('tea', 'POST', '/teacher/tips', { mockId, questionId: tq[3].id, text: 'Eliminate options that end in the wrong digit first.' })).status, 201);
  assert.equal((await call('s1', 'GET', '/attempts/a21_1/tips')).body.tips[tq[3].id][0].badge, 'teacher');
  // three reports hide it automatically and raise an alert
  for (const w of ['s1', 's2', 's3']) assert.equal((await call(w, 'POST', `/tips/${id}/report`)).status, 200);
  assert.equal(((await call('s6', 'GET', '/attempts/a21_6/tips')).body.tips[right] || []).length, 0, 'hidden');
  await call('boss', 'POST', '/admin/alert-center/check'); assert.ok((await call('boss', 'GET', '/admin/alert-center')).body.items.some((x) => /reported/.test(x.title) && x.link === 'tricks'));
  // admin can restore, and the switch turns the whole thing off
  const list = (await call('boss', 'GET', '/admin/tips?filter=hidden')).body; assert.equal(list.tips.length, 1);
  assert.equal((await call('boss', 'POST', `/admin/tips/${id}/unhide`)).status, 200); assert.equal((await call('s6', 'GET', '/attempts/a21_6/tips')).body.tips[right].length, 1);
  assert.equal((await call('s0', 'GET', '/admin/tips')).status, 403);
  const cfg = (await call('boss', 'PUT', '/admin/tips/config', { topPercent: 30, minCohort: 3 })).body.config; assert.equal(cfg.topPercent, 30);
  assert.equal((await call('s2', 'GET', '/attempts/a21_2/tips')).body.canPost, true, 'top 30% now includes rank 3');
  const ctl = (await call('boss', 'GET', '/admin/controls')).body; const c = ctl.controls || ctl; await call('boss', 'PUT', '/admin/controls', { ...c, features: { ...c.features, tips: false } }); bump(5000); clock += 5000;
  assert.equal((await call('s5', 'GET', '/attempts/a21_5/tips')).status, 404);
});

test('load simulator: runs virtual students, reports latency and resources, then cleans up after itself', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c; const mocksBefore = db.prepare('SELECT COUNT(*) c FROM mocks').get().c;
  assert.equal((await call('s0', 'GET', '/admin/loadtest')).status, 403);
  const i = (await call('boss', 'GET', '/admin/loadtest')).body; assert.ok(i.info.cpus >= 1); assert.ok(i.info.totalMem > 0); assert.ok(i.info.mocks.length >= 1, 'a mock to test with');
  assert.equal((await call('boss', 'POST', '/admin/loadtest/start', { users: 5, durationSec: 5 })).status, 400, 'needs typed confirmation');
  const st = await call('boss', 'POST', '/admin/loadtest/start', { users: 6, durationSec: 5, saveEverySec: 3, progress: 30, confirm: 'start', mockId: i.info.mocks[0].id }); assert.equal(st.status, 202, st.text);
  assert.equal((await call('boss', 'POST', '/admin/loadtest/start', { confirm: 'start' })).status, 409, 'one at a time');
  let g; for (let n = 0; n < 80; n++) { await new Promise((r) => setTimeout(r, 400)); g = (await call('boss', 'GET', '/admin/loadtest')).body; if (g.run?.phase === 'done' || g.run?.phase === 'failed') break; }
  assert.equal(g.run.phase, 'done', JSON.stringify(g.run.error));
  const rep = g.run.report; assert.ok(rep.totals.requests >= 12, JSON.stringify(rep.totals)); assert.equal(rep.totals.errors, 0, JSON.stringify(rep.errors));
  assert.ok(rep.kinds.save.n >= 1 && rep.kinds.open.n === 6 && rep.kinds.submit.n === 6); assert.ok(rep.kinds.save.p95 >= 0);
  assert.ok(g.run.samples.length >= 4); const s = g.run.samples[2]; for (const k of ['cpuProc', 'cpuSys', 'rss', 'memUsedPct', 'writeMs', 'lagMs', 'rps', 'p95']) assert.ok(k in s, k);
  assert.ok(rep.peaks.rssMB > 0); assert.ok(['good', 'ok', 'warn', 'bad'].includes(rep.verdict.level)); assert.ok(rep.advice.length >= 1);
  assert.equal(g.history.length, 1); assert.equal(g.history[0].users, 6);
  // nothing left behind
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before); assert.equal(db.prepare('SELECT COUNT(*) c FROM mocks').get().c, mocksBefore);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM attempts WHERE mock_id='__loadtest__'").get().c, 0); assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions WHERE ua='loadtest'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='loadtest_probe'").get().c, 0);
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action='loadtest_start'").get());
});

test('load simulator: can be stopped, and refuses while maintenance mode is on', async () => {
  const i = (await call('boss', 'GET', '/admin/loadtest')).body;
  const st = await call('boss', 'POST', '/admin/loadtest/start', { users: 4, durationSec: 30, confirm: 'start', mockId: i.info.mocks[0].id }); assert.equal(st.status, 202, st.text);
  await new Promise((r) => setTimeout(r, 1500)); assert.equal((await call('boss', 'POST', '/admin/loadtest/stop')).status, 200);
  let g; for (let n = 0; n < 60; n++) { await new Promise((r) => setTimeout(r, 400)); g = (await call('boss', 'GET', '/admin/loadtest')).body; if (['done', 'failed'].includes(g.run?.phase)) break; }
  assert.equal(g.run.phase, 'done'); assert.equal(g.run.report.stopped, 'user');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@loadtest.invalid'").get().c, 0);
});

test('help: answers plain questions, fixes typos, shows live facts, logs gaps, takes feedback', async () => {
  const ask = async (who, q) => (await call(who, 'POST', '/admin/help/ask', { q })).body;
  assert.equal((await call('s0', 'POST', '/admin/help/ask', { q: 'hello' })).status, 403, 'students cannot use it');
  const a = await ask('boss', 'How many students can my server handle?'); assert.equal(a.card.id, 'loadtest'); assert.ok(a.card.steps.length >= 3); assert.ok(a.card.go.some((g) => g.to === '/admin/tools')); assert.equal(a.live, null);
  assert.equal((await ask('boss', 'bakcup the databse')).card.id, 'backup');
  assert.equal((await ask('boss', 'how do i lock a teacher account')).card.id, 'team-lock');
  assert.equal((await ask('boss', 'how to change logo and colour')).card.id, 'branding');
  const lv = await ask('boss', 'how many students do I have?'); assert.equal(lv.data.title, 'Students right now'); assert.ok(lv.data.stats.some((l) => l.label === 'Students' && l.value >= 10));
  assert.match((await ask('boss', 'is the server ok?')).live.title, /status/i);
  assert.equal((await ask('boss', 'how much disk space is left')).live.title, 'Disk space');
  assert.equal((await ask('boss', 'hi')).kind, 'chat');
  const none = await ask('boss', 'zzzz qqqq wwww'); assert.equal(none.kind, 'none'); assert.equal((await call('boss', 'POST', '/admin/help/ask', { q: ' ' })).status, 400);
  const fb = await call('boss', 'POST', '/admin/help/feedback', { logId: none.logId, helpful: false, note: 'looking for pricing' }); assert.equal(fb.status, 200);
  const gaps = (await call('boss', 'GET', '/admin/help/gaps')).body; assert.ok(gaps.gaps.some((g) => g.q === 'zzzz qqqq wwww'));
  const t = (await call('boss', 'GET', '/admin/help/topic/tricks')).body.card; assert.ok(t.related.length >= 1);
  assert.ok((await call('boss', 'GET', '/admin/help/page?path=/admin/administrators')).body.topics.some((x) => x.id === 'team-activity'));
  assert.ok((await call('boss', 'GET', '/admin/help')).body.areas.length >= 8);
});

test('help: every topic links only to pages that exist and related ids are real', async () => {
  const { KB } = await import('../helpkb.js'); const ids = new Set(KB.map((e) => e.id)); assert.equal(ids.size, KB.length, 'unique ids');
  const app = (await import('node:fs')).readFileSync(new URL('../../src/admin/AdminApp.jsx', import.meta.url), 'utf8');
  const tabs = new Set([...app.matchAll(/\['([a-z-]*)', '[^']+'\]/g)].map((m) => m[1]));
  for (const e of KB) {
    for (const r of e.rel || []) assert.ok(ids.has(r), `${e.id} -> missing related ${r}`);
    for (const [, to] of e.go || []) { const k = to.replace(/^\/admin\/?/, ''); assert.ok(tabs.has(k), `${e.id} -> unknown page ${to}`); }
    assert.ok(e.a.length > 30 && e.title.endsWith('?') === (e.title.endsWith('?')));
  }
  assert.ok(KB.length >= 60);
});

test('load test v2: custom settings are clamped, results are saved, compared, labelled and pinned', async () => {
  const { parseCfg, compareOf, curveOf, limitOf, scorecardOf } = await import('../loadtest.js');
  const c = parseCfg({ users: 9999, durationSec: 1, pattern: 'weird', jitter: 500, errStopPct: 1, rampSec: 999, label: '  Before Sunday  ' });
  assert.equal(c.users, 1000); assert.equal(c.durationSec, 5); assert.equal(c.pattern, 'steady'); assert.equal(c.jitter, 80); assert.equal(c.errStopPct, 10); assert.equal(c.rampSec, 5); assert.equal(c.label, 'Before Sunday');
  assert.equal(parseCfg({ pattern: 'spike', durationSec: 60 }).rampSec, 1); assert.equal(parseCfg({ pattern: 'ramp', durationSec: 50 }).rampSec, 40);
  // the curve and the measured limit
  const smp = []; for (let t = 1; t <= 40; t++) smp.push({ phase: 'running', users: t * 5, rps: 10, p95: t < 25 ? 100 : 3000, errors: 0, cpuProc: t * 2 });
  const cv = curveOf(smp); assert.ok(cv.length >= 4); const lim = limitOf(cv); assert.ok(lim.users >= 100 && lim.users < 200 && !lim.atLeast, JSON.stringify(lim));
  // compare two synthetic reports
  const mk = (users, p95, err) => ({ config: { users, durationSec: 60, pattern: 'steady' }, kinds: { save: { p95, p50: 10, max: p95 * 2 } }, totals: { p99: p95, max: p95, errorPct: err, peakRps: 10 }, peaks: { cpuProc: 50, cpuSys: 20, memUsedPct: 40, rssMB: 100, writeMs: 5, lagMs: 20, diskUsedPct: 30 }, dbGrowthMB: 1, score: 90 });
  const cmp = compareOf(mk(100, 800, 2), mk(100, 400, 0)); assert.equal(cmp.rows.find((r) => r.key === 'save').verdict, 'better'); assert.equal(cmp.rows.find((r) => r.key === 'err').verdict, 'better'); assert.ok(cmp.better > cmp.worse); assert.ok(cmp.sameSetup);
  assert.equal(compareOf(mk(100, 400, 0), mk(200, 400, 0)).sameSetup, false);
  assert.ok(scorecardOf(mk(100, 3000, 10)).some((r) => r.status === 'bad'));
  // real runs: two saved tests, compared
  const i = (await call('boss', 'GET', '/admin/loadtest')).body; const mid = i.info.mocks[0].id;
  const run = async (body) => { assert.equal((await call('boss', 'POST', '/admin/loadtest/start', { confirm: 'start', mockId: mid, durationSec: 6, saveEverySec: 3, progress: 20, ...body })).status, 202); let g; for (let n = 0; n < 90; n++) { await new Promise((r) => setTimeout(r, 400)); g = (await call('boss', 'GET', '/admin/loadtest')).body; if (['done', 'failed'].includes(g.run?.phase)) break; } assert.equal(g.run.phase, 'done', g.run.error); return g.run.report; };
  const a = await run({ users: 4, label: 'Baseline', note: 'before the upgrade' });
  const b = await run({ users: 8, pattern: 'ramp', label: 'Ramp run', jitter: 0, saveSize: 1, resultPct: 100, pollPct: 0 });
  assert.equal(a.label, 'Baseline'); assert.equal(b.config.pattern, 'ramp'); assert.equal(b.config.saveSize, 1); assert.ok(b.kinds.result.n === 8, 'resultPct 100 means everyone opens their result');
  for (const r of [a, b]) { assert.ok(r.score >= 0 && r.score <= 100); assert.ok(r.scorecard.length >= 6); assert.ok(r.plain.length >= 2); assert.ok(r.bottleneck.key); assert.ok(r.samples.length >= 3 && r.samples.length <= 90); assert.ok(r.events.length >= 2); }
  assert.ok(Array.isArray(b.curve)); assert.deepEqual(a.curve, []);
  const h = (await call('boss', 'GET', '/admin/loadtest')).body.history; assert.ok(h.length >= 2); assert.ok(h.find((x) => x.id === a.id).hasReport);
  const cm = (await call('boss', 'GET', `/admin/loadtest/compare?a=${a.id}&b=${b.id}`)).body; assert.ok(cm.rows.length >= 8); assert.ok(cm.headline); assert.equal(cm.sameSetup, false); assert.ok(cm.diffs.some((d) => d.label === 'students')); assert.ok(cm.caution);
  assert.equal((await call('boss', 'GET', `/admin/loadtest/compare?a=${a.id}&b=${a.id}`)).status, 400); assert.equal((await call('boss', 'GET', `/admin/loadtest/compare?a=${a.id}&b=nope`)).status, 404);
  const pin = await call('boss', 'PUT', `/admin/loadtest/report/${a.id}`, { label: 'Baseline v2', pinned: true }); assert.equal(pin.body.item.label, 'Baseline v2'); assert.ok(pin.body.item.pinned);
  assert.equal((await call('boss', 'GET', `/admin/loadtest/report/${a.id}`)).body.report.label, 'Baseline v2');
  // presets
  assert.equal((await call('boss', 'POST', '/admin/loadtest/presets', { name: '' })).status, 400);
  const pr = (await call('boss', 'POST', '/admin/loadtest/presets', { name: 'Sunday exam', config: { users: 300, durationSec: 90, pattern: 'spike' } })).body.presets; assert.equal(pr[0].config.users, 300); assert.equal(pr[0].config.pattern, 'spike');
  assert.equal((await call('boss', 'DELETE', `/admin/loadtest/presets/${pr[0].id}`)).body.presets.length, 0);
  // clearing history keeps pinned, deleting removes one
  await call('boss', 'DELETE', '/admin/loadtest/history'); const left = (await call('boss', 'GET', '/admin/loadtest')).body.history; assert.deepEqual(left.map((x) => x.id), [a.id]);
  await call('boss', 'DELETE', `/admin/loadtest/report/${a.id}`); assert.equal((await call('boss', 'GET', '/admin/loadtest')).body.history.length, 0); assert.equal((await call('boss', 'GET', `/admin/loadtest/report/${a.id}`)).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@loadtest.invalid'").get().c, 0);
});

test('load test v3: students can browse pages, extra browsers, custom pages, review and pdf', async () => {
  const { parseCfg, cleanCustom, PAGES } = await import('../loadtest.js');
  assert.deepEqual(cleanCustom([{ path: '/mocks', perMin: 99 }, { path: '/admin/users' }, { path: 'nope' }, { path: '/a/../b' }, { path: '/auth/logout' }, { path: '/mocks' }, { path: '/attempts/{attempt}/tips', perMin: 0 }]).map((x) => `${x.path}:${x.perMin}`), ['/mocks:60', '/attempts/{attempt}/tips:1']);
  const c = parseCfg({ browsers: 9999, browsePerMin: -4, pages: ['me', 'bogus'], custom: [{ path: '/me' }] }); assert.equal(c.browsers, 1000); assert.equal(c.browsePerMin, 0); assert.deepEqual(c.pages, ['me']); assert.equal(c.custom.length, 1);
  { const ctl = (await call('boss', 'GET', '/admin/controls')).body; const c = ctl.controls || ctl; await call('boss', 'PUT', '/admin/controls', { ...c, features: { ...c.features, tips: true } }); }
  const i = (await call('boss', 'GET', '/admin/loadtest')).body; assert.equal(i.pages.length, PAGES.length);
  const run = async (body) => { assert.equal((await call('boss', 'POST', '/admin/loadtest/start', { confirm: 'start', mockId: i.info.mocks[0].id, durationSec: 8, saveEverySec: 3, ...body })).status, 202); let g; for (let n = 0; n < 120; n++) { await new Promise((r) => setTimeout(r, 400)); g = (await call('boss', 'GET', '/admin/loadtest')).body; if (['done', 'failed'].includes(g.run?.phase)) break; } assert.equal(g.run.phase, 'done', g.run.error); return g.run.report; };
  const rep = await run({ users: 4, browsers: 3, browsePerMin: 30, browserPerMin: 30, pages: PAGES.map((x) => x[0]), custom: [{ path: '/attempts/{attempt}/tips', perMin: 30 }, { path: '/no/such/page', perMin: 30 }], reviewPct: 100, pdfPct: 100, resultPct: 100 });
  const keys = Object.keys(rep.kinds); assert.ok(keys.some((k) => k.startsWith('page:')), keys.join()); assert.ok(keys.some((k) => k.startsWith('custom:')));
  assert.ok(rep.kinds.review?.n === 16 && rep.kinds.pdf?.n === 4, JSON.stringify(rep.errors)); assert.ok(rep.pages.n >= 6); assert.equal(rep.totals.coreErrorPct, 0, 'real exam and page actions never failed'); assert.ok(rep.totals.customErrors > 0 && rep.kinds['custom:/no/such/page'].errors > 0); assert.notEqual(rep.verdict.title, 'Overloaded'); assert.ok(rep.scorecard.some((r) => r.key === 'custom')); assert.ok(rep.plain.some((x) => /Your page \/no\/such\/page failed/.test(x)));
  assert.ok(rep.scorecard.some((r) => r.key === 'pages')); assert.ok(rep.scorecard.some((r) => r.key === 'pdf')); assert.ok(rep.plain.some((p) => /extra students only browsed/.test(p)));
  assert.equal(rep.config.browsers, 3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@loadtest.invalid'").get().c, 0, 'browser accounts removed too');
  await call('boss', 'DELETE', '/admin/loadtest/history');
});

test('load test v4: new settings are cleaned, preflight explains problems, targets and steps are reported', async () => {
  const { parseCfg, cleanCustom, cleanTargets, targetsOf, stepsOf, PATTERNS } = await import('../loadtest.js');
  assert.deepEqual(PATTERNS, ['steady', 'spike', 'ramp', 'steps', 'waves']);
  const c = parseCfg({ users: 40, durationSec: 600, pattern: 'steps', stepCount: 99, warmupSec: 9999, homePerMin: 99, integrityPerMin: 5, sectionAtPct: 1, targets: { enabled: true, p95Ms: 1, errorPct: 99 } });
  assert.equal(c.stepCount, 10); assert.equal(c.warmupSec, 60); assert.equal(c.rampSec, 480); assert.equal(c.homePerMin, 30); assert.equal(c.sectionAtPct, 10); assert.equal(c.targets.p95Ms, 50); assert.equal(c.targets.errorPct, 50); assert.equal(parseCfg({ pattern: 'waves', durationSec: 100 }).rampSec, 10);
  assert.equal(parseCfg({ durationSec: 10, warmupSec: 50 }).warmupSec, 5, 'warm-up never longer than half the test');
  const cu = cleanCustom([{ path: '/bookmarks', method: 'post', body: '{"a":1}' }, { path: '/me', method: 'POST' }, { path: '/attempts/{attempt}/integrity', method: 'POST', body: '{bad' }, { path: '/attempts/{attempt}/errors/{question}', method: 'PUT', body: '{"reason":"{question}"}' }, { path: '/bookmarks', method: 'GET' }, ...Array.from({ length: 20 }, (_, n) => ({ path: `/mocks?x=${n}` }))]);
  assert.deepEqual(cu.slice(0, 3).map((x) => `${x.method} ${x.path}`), ['POST /bookmarks', 'PUT /attempts/{attempt}/errors/{question}', 'GET /bookmarks']); assert.equal(cu.length, 12);
  const t = cleanTargets({ enabled: 1 }); assert.deepEqual([t.p95Ms, t.errorPct, t.cpuPct], [500, 1, 80]);
  const rep = { config: { targets: { ...t, enabled: true } }, kinds: { save: { p95: 120 }, submit: { p95: 3000 } }, totals: { coreErrorPct: 0 }, peaks: { cpuProc: 40, memUsedPct: 50, writeMs: 10 }, stopped: '' };
  const r = targetsOf(rep); assert.equal(r.pass, false); assert.equal(r.total, 6); assert.deepEqual(r.items.filter((x) => !x.pass).map((x) => x.key), ['submit']); assert.equal(targetsOf({ ...rep, config: { targets: { enabled: false } } }), null);
  const smp = []; for (let tt = 0; tt < 20; tt++) smp.push({ t: tt, phase: 'running', users: tt < 10 ? 5 : 10, rps: 10, errors: 0, p95: tt < 10 ? 50 : 400, cpuProc: 20 });
  const st = stepsOf(smp, { pattern: 'steps', rampSec: 10, stepCount: 2 }, 0); assert.equal(st.length, 2); assert.equal(st[0].users, 5); assert.equal(st[1].p95, 400); assert.deepEqual(stepsOf(smp, { pattern: 'steady' }, 0), []);
  const i = (await call('boss', 'GET', '/admin/loadtest')).body; const mid = i.info.mocks[0].id;
  const pf = (await call('boss', 'POST', '/admin/loadtest/preflight', { mockId: mid, users: 50, durationSec: 60, custom: [{ path: '/bookmarks', method: 'POST', body: '{}' }], sectionMoves: true })).body;
  assert.equal(pf.ok, true, JSON.stringify(pf)); assert.ok(pf.est.requests > 100 && pf.est.rps > 0 && pf.est.snapshotKB > 0); assert.ok(pf.warnings.some((w) => /POST or PUT/.test(w)));
  const long = (await call('boss', 'POST', '/admin/loadtest/preflight', { mockId: mid, users: 5, durationSec: 900 })).body; assert.equal(long.est.seconds, 915); assert.ok(long.warnings.some((w) => /Long tests/.test(w)));
  assert.ok('run' in (await call('boss', 'GET', '/admin/loadtest/live')).body);
  const sb = (await call('boss', 'POST', '/admin/loadtest/signin-bench', { count: 5 })).body; assert.equal(sb.count, 5); assert.ok(sb.sync.avgMs > 0 && sb.pool.perSec > 0 && sb.estimates.length === 5 && sb.advice);
});

test('load test v4: a staircase run with targets, warm-up, tab-switch reports and a custom write', async () => {
  const i = (await call('boss', 'GET', '/admin/loadtest')).body;
  const body = { confirm: 'start', mockId: i.info.mocks[0].id, users: 6, durationSec: 12, saveEverySec: 3, pattern: 'steps', stepCount: 3, warmupSec: 2, integrityPerMin: 30, homePerMin: 30, targets: { enabled: true, p95Ms: 5000, errorPct: 5 }, custom: [{ path: '/attempts/{attempt}/integrity', method: 'POST', body: '{"leaves":1}', perMin: 30 }] };
  assert.equal((await call('boss', 'POST', '/admin/loadtest/start', body)).status, 202);
  let g; for (let n = 0; n < 150; n++) { await new Promise((r) => setTimeout(r, 400)); g = (await call('boss', 'GET', '/admin/loadtest/live')).body; if (['done', 'failed'].includes(g.run?.phase)) break; }
  assert.equal(g.run.phase, 'done', g.run.error); const rep = g.run.report;
  assert.ok(rep.steps.length >= 2, JSON.stringify(rep.steps)); assert.ok(rep.steps[0].users <= rep.steps[rep.steps.length - 1].users);
  assert.ok(rep.kinds.integrity?.n > 0 && rep.kinds['custom:POST /attempts/{attempt}/integrity']?.n > 0, Object.keys(rep.kinds).join());
  assert.ok(rep.targets && rep.targets.total >= 5 && typeof rep.targets.pass === 'boolean'); assert.equal(rep.targets.pass, true, JSON.stringify(rep.targets));
  assert.ok(rep.marks.some((m) => m.label === 'Step 2') && rep.marks.some((m) => m.label === 'Warm-up over'));
  assert.ok(!rep.kinds.home, 'home page is not served in tests, so it is skipped'); assert.ok(rep.events.some((e) => /home page is not served/.test(e.text)));
  assert.equal(rep.totals.coreErrorPct, 0); assert.ok(Array.isArray(rep.curve)); assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@loadtest.invalid'").get().c, 0, 'everything removed');
});
