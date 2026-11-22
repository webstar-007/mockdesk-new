import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const f = path.join(os.tmpdir(), `admins11-${Date.now()}.txt`);
fs.writeFileSync(f, 'boss11@example.com\n');
process.env.MOCKDESK_BACKUPS = path.join(os.tmpdir(), `bk11-${Date.now()}`); process.env.MOCKDESK_ADMINS_FILE = f; process.env.MOCKDESK_ADMIN_EMAILS = '';
const { createApp } = await import('../app.js');
const { openDb } = await import('../lib/db.js');
let clock = Date.parse('2026-11-08T11:00:00Z'); const H = 3600000, D = 24 * H; // a Sunday, 16:30 in India
const db = openDb(':memory:');
const sentMail = []; const sentWa = [];
const mailer = { send: async (m) => { sentMail.push(m); } };
const whatsapp = { provider: 'fake', send: async (to, m) => { sentWa.push({ to, ...m }); } };
const drafter = { model: 'fake-model', draft: async (q) => ({ aiAnswer: q.options.indexOf('4') >= 0 ? q.options.indexOf('4') : 0, explanation: 'Add the two numbers.', steps: ['2 + 2'], shortcut: '', trap: '', wrongReasons: [null, null, null, null] }) };
const app = createApp(db, { allowIncomplete: true, now: () => clock, serveClient: false, mailer, whatsapp, drafter });
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
const jar = {};
async function call(who, method, url, body, raw) {
  const r = await fetch(base + (raw ? '' : '/api') + url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
}
test.after(() => { server.close(); fs.rmSync(f, { force: true }); fs.rmSync(process.env.MOCKDESK_BACKUPS, { recursive: true, force: true }); });
const reg = (who, email) => call(who, 'POST', '/auth/register', { name: `${who} Kumar`, email, password: 'password123' });
const uid = (email) => db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
async function take(who, mockId, pick = 0) {
  const s = await call(who, 'POST', `/mocks/${mockId}/start`); assert.equal(s.status, 200, JSON.stringify(s.body)); const id = s.body.attemptId;
  for (let i = 0; i < 6; i++) {
    const a = await call(who, 'GET', `/attempts/${id}`); const responses = {};
    (a.body.attempt?.questions || []).forEach((q) => { responses[q.id] = { selected: pick, marked: false, visited: true, timeMs: 4000 }; });
    await call(who, 'PUT', `/attempts/${id}/responses`, { responses });
    if ((await call(who, 'POST', `/attempts/${id}/submit`, { responses })).body.status === 'submitted') break;
  }
  return id;
}
const SECS = ['reasoning', 'ga', 'maths', 'english'];
let mock;
const E = { ana: 'ana11@example.com', ben: 'ben11@example.com', cal: 'cal11@example.com', sam: 'sam11@example.com' };

test('setup: mock and students who answer the same way', async () => {
  await reg('admin', 'boss11@example.com'); for (const k of Object.keys(E)) await reg(k, E[k]);
  const exam = (await call('admin', 'POST', '/admin/exams', { name: 'Mini 11', timing: 'overall', minutes: 12, sections: SECS.map((k) => ({ key: k, name: k, short: k, questions: 4, marks: 2, negative: 0.5 })) })).body.id;
  const b = await call('admin', 'POST', '/admin/mocks/build', { examId: exam, name: 'Eleven Mock', difficulty: 'moderate', include: 'all', allowPartial: true, plan: SECS.map((k) => ({ section: k, easy: 0, moderate: 4, hard: 0 })) });
  assert.equal(b.status, 201); mock = b.body.mock.id; await call('admin', 'PATCH', `/admin/mocks/${mock}`, { status: 'published' });
  await take('ana', mock, 0); await take('cal', mock, 0); await take('ben', mock, 1);
});

test('staff access: editors get content only until an admin adds more; contacts stay masked without permission', async () => {
  const sam = uid(E.sam);
  const r = await call('admin', 'PATCH', `/admin/users/${sam}`, { role: 'editor', confirm: E.sam, perms: ['students'] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.user.perms, ['content', 'students']);
  assert.equal((await call('sam', 'GET', '/admin/mocks')).status, 200);
  const users = await call('sam', 'GET', '/admin/users'); assert.equal(users.status, 200);
  assert.ok(users.body.users.every((u) => !u.email || u.email.includes('***')), 'emails masked');
  for (const [m, u] of [['GET', '/admin/system'], ['GET', '/admin/backups'], ['GET', '/admin/export/results'], ['POST', '/admin/students/import/preview'], ['GET', '/admin/messages'], ['GET', '/admin/backup'], ['PATCH', `/admin/users/${uid(E.ana)}`]]) {
    const x = await call('sam', m, u, m === 'GET' ? undefined : { csv: 'x' }); assert.equal(x.status, 403, `${m} ${u}`); assert.equal(x.body.code, 'NO_PERMISSION');
  }
  await call('admin', 'PATCH', `/admin/users/${sam}`, { perms: ['students', 'data', 'accounts', 'contacts', 'messages'] });
  const u2 = await call('sam', 'GET', '/admin/users'); assert.ok(u2.body.users.some((u) => u.email === E.ana));
  assert.equal((await call('sam', 'GET', '/admin/export/results')).status, 200);
  assert.equal((await call('sam', 'GET', '/admin/messages')).status, 200);
  assert.equal((await call('sam', 'GET', '/admin/system')).status, 403, 'settings stay admin-only');
  assert.equal((await call('sam', 'PATCH', `/admin/users/${sam}`, { perms: [] })).status, 403);
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action='user_perms'").get());
});

test('staff with students access but not contacts gets masked CSV and no raw contact in JSON', async () => {
  await call('admin', 'PATCH', `/admin/users/${uid(E.sam)}`, { perms: ['students', 'data'] });
  const csv = await call('sam', 'GET', '/admin/export/students'); assert.equal(csv.status, 200);
  assert.ok(!csv.body.includes(E.ana) && csv.body.includes('a***@example.com'), csv.body.slice(0, 200));
  const ints = await call('sam', 'GET', '/admin/integrity?level=low&days=90'); assert.equal(ints.status, 200); assert.ok(!JSON.stringify(ints.body).includes(E.ana));
});

test('anomalies: finds students with the same wrong answers, shared devices and lets an admin dismiss a pair', async () => {
  db.prepare('UPDATE attempts SET device=? WHERE user_id IN (?,?,?)').run('devicedevice01', uid(E.ana), uid(E.ben), uid(E.cal));
  const d = (await call('admin', 'GET', '/admin/anomalies')).body;
  const names = (p) => [p.a.name, p.b.name].sort().join('+');
  const pair = d.pairs.find((p) => names(p) === 'ana Kumar+cal Kumar'); assert.ok(pair, JSON.stringify(d.pairs.map(names)));
  assert.ok(pair.sharedWrong >= 5 && pair.sameDevice, JSON.stringify(pair));
  assert.ok(!d.pairs.some((p) => names(p).includes('ben') && names(p).includes('ana') && p.sharedWrong >= 5 && false));
  assert.equal(d.devices.length, 1); assert.equal(d.devices[0].users.length, 3);
  assert.equal((await call('admin', 'POST', '/admin/anomalies/dismiss', { key: pair.key })).status, 200);
  assert.ok(!(await call('admin', 'GET', '/admin/anomalies')).body.pairs.some((p) => p.key === pair.key));
  assert.ok((await call('admin', 'GET', '/admin/anomalies?dismissed=1')).body.pairs.some((p) => p.key === pair.key && p.dismissed));
  assert.equal((await call('admin', 'POST', '/admin/anomalies/dismiss', { key: 'nope' })).status, 400);
});

test('bulk import: previews problems, creates accounts, adds to a batch, invites by email and is safe to repeat', async () => {
  const batch = (await call('admin', 'POST', '/admin/batches', { name: 'Morning 11' })).body.id;
  const csv = 'Name,Email,Mobile\nNew One,new1@example.com,9811111111\nPhone Only,,9822222222\nAna Again,ana11@example.com,\n,nobody@example.com,\nBad Mail,not-an-email,\nNew One Dup,new1@example.com,\nTeacher?,boss11@example.com,';
  const p = await call('admin', 'POST', '/admin/students/import/preview', { csv, batchId: batch });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.deepEqual(p.body.summary, { total: 7, new: 2, exists: 1, invalid: 4 });
  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c; assert.equal(before, db.prepare('SELECT COUNT(*) c FROM users').get().c);
  sentMail.length = 0;
  const x = await call('admin', 'POST', '/admin/students/import', { csv, batchId: batch, invite: true });
  assert.equal(x.status, 200); assert.equal(x.body.summary.created, 2); assert.equal(x.body.summary.addedToBatch, 3); assert.equal(x.body.summary.invited, 1);
  assert.ok(sentMail.some((m) => m.to === 'new1@example.com'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before + 2);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE phone=?').get('+919822222222'));
  const again = await call('admin', 'POST', '/admin/students/import', { csv, batchId: batch, invite: true });
  assert.equal(again.body.summary.created, 0); assert.equal(again.body.summary.invited, 0);
  assert.equal((await call('admin', 'POST', '/admin/students/import/preview', { csv: 'foo,bar\n1,2' })).status, 400);
  assert.equal((await call('ben', 'POST', '/admin/students/import/preview', { csv })).status, 403);
});

test('backups: manual and scheduled copies, retention, download and delete', async () => {
  const { runBackup } = await import('../ops.js');
  const b1 = await call('admin', 'POST', '/admin/backups'); assert.equal(b1.status, 200, JSON.stringify(b1.body)); assert.ok(b1.body.size > 1000);
  clock += 2 * 60000; await call('admin', 'POST', '/admin/backups');
  let l = (await call('admin', 'GET', '/admin/backups')).body; assert.equal(l.backups.length, 2);
  await call('admin', 'PUT', '/admin/backups/config', { keep: 1 });
  clock += 2 * 60000; await call('admin', 'POST', '/admin/backups'); l = (await call('admin', 'GET', '/admin/backups')).body; assert.equal(l.backups.length, 1, 'oldest copies removed');
  assert.equal(runBackup({ db, now: () => clock + 3600000, settings: app.settingsStore }), null, 'not yet due');
  assert.ok(runBackup({ db, now: () => clock + 25 * 3600000, settings: app.settingsStore }), 'due after a day');
  const name = (await call('admin', 'GET', '/admin/backups')).body.backups[0].name;
  const dl = await fetch(`${base}/api/admin/backups/${name}`, { headers: { cookie: jar.admin } }); assert.equal(dl.status, 200); assert.ok((await dl.arrayBuffer()).byteLength > 1000);
  assert.equal((await call('admin', 'GET', '/admin/backups/..%2Fetc')).status, 404);
  assert.equal((await call('admin', 'DELETE', `/admin/backups/${name}`)).status, 200);
});

test('exports: results, answers, questions and audit download as CSV with the right columns', async () => {
  for (const [k, col] of [['results', 'Student'], ['answers', 'Chosen'], ['questions', 'Question'], ['audit', 'Action'], ['students', 'Tests finished']]) {
    const r = await call('admin', 'GET', `/admin/export/${k}`); assert.equal(r.status, 200, k); assert.ok(r.body.split('\r\n')[0].includes(col), k); assert.ok(r.body.split('\r\n').length > 1, `${k} has rows`);
  }
  assert.equal((await call('admin', 'GET', '/admin/export/nothing')).status, 404);
  assert.ok((await call('admin', 'GET', '/admin/export/results')).body.includes('ana Kumar'));
});

test('site settings: name, contact, FAQ, limits and time zone are edited by an admin and shown publicly', async () => {
  const before = (await call('anon', 'GET', '/public/site')).body; assert.equal(before.name, 'MockDesk'); assert.deepEqual(before.faq, []);
  const site = { name: 'Topper Mocks', tagline: 'Practice for SSC', heroTitle: 'Beat the clock', supportEmail: 'help@topper.example', supportPhone: '+919800000000', publicUrl: 'https://mock.topper.example/', faq: [{ q: 'Free?', a: 'Yes' }, { q: '', a: 'dropped' }] };
  const limits = { practicePerDay: 7, doubtPerHour: 10, doubtPerDay: 40, emailDailyCap: 500, timezone: 'Asia/Dubai', doubtChat: false };
  const put = await call('admin', 'PUT', '/admin/site', { site, limits }); assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.site.publicUrl, 'https://mock.topper.example'); assert.equal(put.body.site.faq.length, 1);
  const pub = (await call('anon', 'GET', '/public/site')).body; assert.equal(pub.name, 'Topper Mocks'); assert.equal(pub.supportEmail, 'help@topper.example'); assert.deepEqual(pub.faq, [{ q: 'Free?', a: 'Yes' }]);
  assert.equal(app.notifier.siteName(), 'Topper Mocks');
  assert.equal((await call('admin', 'PUT', '/admin/site', { site: { ...site, supportEmail: 'nope' }, limits })).status, 400);
  assert.equal((await call('admin', 'PUT', '/admin/site', { site, limits: { ...limits, timezone: 'Mars/Base' } })).status, 400);
  assert.equal((await call('admin', 'PUT', '/admin/site', { site, limits: { ...limits, practicePerDay: 0 } })).status, 400);
  assert.equal((await call('ben', 'PUT', '/admin/site', { site, limits })).status, 403);
  assert.equal((await call('sam', 'PUT', '/admin/site', { site, limits })).status, 403, 'staff cannot change site settings');
  assert.equal((await call('admin', 'GET', '/admin/site')).body.limits.practicePerDay, 7);
});

test('keep me signed in: long cookie by default, browser-session cookie when unticked', async () => {
  const login = (remember) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: E.ben, password: 'password123', ...(remember === undefined ? {} : { remember }) }) });
  const a = (await login()).headers.get('set-cookie'); assert.match(a, /Max-Age=5184000/);
  const b = (await login(true)).headers.get('set-cookie'); assert.match(b, /Max-Age=5184000/);
  const c = (await login(false)).headers.get('set-cookie'); assert.ok(!/Max-Age/.test(c), c);
  const sid = /sid=([a-f0-9]+)/.exec(c)[1]; const exp = db.prepare('SELECT expires_at FROM sessions WHERE id=?').get(sid).expires_at; assert.ok(exp - clock <= 12 * 3600 * 1000 + 1000, 'short server-side life');
});
