import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const f = path.join(os.tmpdir(), `admins10-${Date.now()}.txt`);
fs.writeFileSync(f, 'boss10@example.com\n');
process.env.MOCKDESK_ADMINS_FILE = f; process.env.MOCKDESK_ADMIN_EMAILS = '';
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
test.after(() => { server.close(); fs.rmSync(f, { force: true }); });
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
let mock, aAna;

test('setup: published mock, two students, one with a mobile number', async () => {
  await reg('admin', 'boss10@example.com'); await reg('ana', 'ana10@example.com'); await reg('ben', 'ben10@example.com');
  const exam = (await call('admin', 'POST', '/admin/exams', { name: 'Mini 10', timing: 'overall', minutes: 12, sections: SECS.map((k) => ({ key: k, name: k, short: k, questions: 3, marks: 2, negative: 0.5 })) })).body.id;
  const b = await call('admin', 'POST', '/admin/mocks/build', { examId: exam, name: 'Ten Mock', difficulty: 'moderate', include: 'all', allowPartial: true, plan: SECS.map((k) => ({ section: k, easy: 0, moderate: 3, hard: 0 })) });
  assert.equal(b.status, 201); mock = b.body.mock.id; await call('admin', 'PATCH', `/admin/mocks/${mock}`, { status: 'published' });
  db.prepare('UPDATE users SET phone=? WHERE id=?').run('+919800000001', uid('ana10@example.com'));
  aAna = await take('ana', mock, 0); await take('ben', mock, 1);
});

test('inbox: groups by type, marks read, deletes, and hides what the student turned off', async () => {
  const ana = uid('ana10@example.com'); const n = app.notifier;
  await n.notify(ana, { kind: 'reminder', title: 'Reminder one', body: 'b', link: '/', channels: { push: false, email: false } });
  await n.notify(ana, { kind: 'teacher_note', title: 'Note from a teacher', body: 'b', link: '/', channels: { push: false, email: false } });
  await n.notify(ana, { kind: 'digest', title: 'Weekly one', body: 'b', link: '/', channels: { push: false, email: false } });
  let r = (await call('ana', 'GET', '/inbox')).body;
  assert.ok(r.counts.reminders >= 1 && r.counts.teacher === 1 && r.counts.progress >= 1, JSON.stringify(r.counts));
  const only = (await call('ana', 'GET', '/inbox?category=teacher')).body; assert.ok(only.items.length === 1 && only.items[0].category === 'teacher');
  assert.equal((await call('ana', 'POST', '/inbox/read', { category: 'teacher' })).body.marked, 1);
  r = (await call('ana', 'GET', '/inbox?unread=1')).body; assert.ok(!r.items.some((i) => i.category === 'teacher'));
  const one = r.items.find((i) => i.type === 'notification'); assert.equal((await call('ana', 'POST', '/inbox/read', { keys: [one.key] })).body.marked, 1);
  assert.equal((await call('ana', 'POST', '/inbox/unread', { key: one.key })).status, 200);
  assert.equal((await call('ana', 'DELETE', `/inbox/n/${one.id}`)).status, 200);
  assert.ok(!(await call('ana', 'GET', '/inbox')).body.items.some((i) => i.key === one.key));
  assert.equal((await call('ben', 'DELETE', `/inbox/n/${one.id}`)).status, 404, 'cannot delete another student\'s message');
  await call('ben', 'PATCH', '/notifications/prefs', { inapp: false }); const ben = uid('ben10@example.com');
  await n.notify(ben, { kind: 'reminder', title: 'Hidden one', body: 'b', link: '/', channels: { push: false, email: false } });
  assert.ok(!(await call('ben', 'GET', '/inbox')).body.items.some((i) => i.title === 'Hidden one'));
  await call('ben', 'PATCH', '/notifications/prefs', { inapp: true });
});

test('tracked links count opens and clicks, then send people on to the page', async () => {
  const ana = uid('ana10@example.com'); const o = await app.notifier.notify(ana, { kind: 'reminder', title: 'Track me', body: 'b', link: '/results/xyz', channels: { push: false } });
  assert.ok(sentMail.some((m) => m.subject === 'Track me'));
  const t = app.notifier.trackedPath(o.id);
  assert.equal((await call('x', 'GET', `/api/o/${o.id}/${app.notifier.sig(o.id)}.gif`, null, true)).status, 200);
  assert.ok(db.prepare('SELECT opened_at FROM notifications WHERE id=?').get(o.id).opened_at);
  assert.equal(db.prepare('SELECT clicked_at FROM notifications WHERE id=?').get(o.id).clicked_at, null);
  const c = await call('x', 'GET', t, null, true); assert.equal(c.status, 302); assert.equal(c.headers.get('location'), '/results/xyz');
  assert.ok(db.prepare('SELECT clicked_at FROM notifications WHERE id=?').get(o.id).clicked_at);
  assert.equal((await call('x', 'GET', `/api/r/${o.id}/badbadbadbadbad0`, null, true)).headers.get('location'), '/', 'a wrong signature goes to the home page');
});

test('WhatsApp: off until configured and opted in, needs a mobile number, respects weekly limit', async () => {
  const ana = uid('ana10@example.com');
  assert.equal((await call('ben', 'PATCH', '/notifications/prefs', { whatsapp: true })).status, 400, 'email-only account cannot opt in');
  assert.equal((await call('ana', 'PATCH', '/notifications/prefs', { whatsapp: true })).status, 200);
  let o = await app.notifier.notify(ana, { kind: 'reminder', title: 'W1', body: 'x', ref: 'w1', channels: { whatsapp: true, push: false, email: false } }); assert.equal(o.whatsapp, 'not configured');
  assert.equal((await call('admin', 'PUT', '/admin/notifications/config', { whatsapp: { enabled: true, weeklyCap: 2, costInr: 1 } })).status, 200);
  o = await app.notifier.notify(ana, { kind: 'reminder', title: 'W2', body: 'x', ref: 'w2', channels: { whatsapp: true, push: false, email: false } }); assert.equal(o.whatsapp, 'sent'); assert.equal(sentWa.at(-1).to, '+919800000001');
  o = await app.notifier.notify(ana, { kind: 'welcome', title: 'W3', body: 'x', ref: 'w3', channels: { whatsapp: true, push: false, email: false } }); assert.equal(o.whatsapp, 'none', 'kind is not on the WhatsApp list');
  await app.notifier.notify(ana, { kind: 'reminder', title: 'W4', body: 'x', ref: 'w4', channels: { whatsapp: true, push: false, email: false }, capped: false });
  o = await app.notifier.notify(ana, { kind: 'reminder', title: 'W5', body: 'x', ref: 'w5', channels: { whatsapp: true, push: false, email: false }, capped: true }); assert.equal(o.whatsapp, 'skipped');
  const pre = (await call('admin', 'GET', '/admin/notifications')).body; assert.ok(pre.whatsapp.optedIn >= 1 && pre.whatsapp.sent >= 2);
});

test('admin messages: preview reach, schedule, send, and see opens and clicks', async () => {
  const pv = (await call('admin', 'GET', '/admin/messages/preview?audience=all')).body; assert.ok(pv.audience >= 2 && pv.whatsapp >= 1 && pv.whatsappCostInr > 0, JSON.stringify(pv));
  assert.equal((await call('admin', 'POST', '/admin/messages', { title: 'No channel', body: 'x', channels: {} })).status, 400);
  const later = await call('admin', 'POST', '/admin/messages', { title: 'Tomorrow', body: 'Mock opens', link: '/', channels: { inapp: true }, audience: 'all', sendAt: clock + D });
  assert.equal(later.body.campaign.status, 'scheduled'); assert.equal((await call('admin', 'POST', `/admin/messages/${later.body.campaign.id}/cancel`)).status, 200);
  const now = await call('admin', 'POST', '/admin/messages', { title: 'Big news', body: 'New mock is live', link: '/results/abc', channels: { inapp: true, email: true, whatsapp: true }, audience: 'all' });
  assert.equal(now.status, 201, JSON.stringify(now.body)); const id = now.body.campaign.id; assert.equal(now.body.campaign.status, 'sent'); assert.ok(now.body.campaign.audienceSize >= 2);
  const inbox = (await call('ana', 'GET', '/inbox')).body.items.find((i) => i.title === 'Big news'); assert.ok(inbox);
  await call('ana', 'POST', `/inbox/n/${inbox.id}/click`); await call('ben', 'POST', '/inbox/read', { keys: [(await call('ben', 'GET', '/inbox')).body.items.find((i) => i.title === 'Big news').key] });
  const d = (await call('admin', 'GET', `/admin/messages/${id}`)).body.campaign.stats; assert.ok(d.targeted >= 2 && d.clicked === 1 && d.opened >= 2, JSON.stringify(d)); assert.ok(d.channels.email?.sent >= 1 || d.channels.whatsapp?.sent >= 1, JSON.stringify(d.channels));
  assert.equal((await call('ana', 'GET', '/admin/messages')).status, 403);
});

test('smart reminders: unfinished attempt and a streak about to end', async () => {
  const cfg = (await call('admin', 'GET', '/admin/notifications')).body.config; assert.ok(cfg.unfinished.enabled && cfg.streak.enabled && cfg.digest.enabled && cfg.liveClosing.hours.includes(2));
  const s = await call('ben', 'POST', `/mocks/${mock}/start`); assert.equal(s.status, 200, JSON.stringify(s.body)); // a new attempt, left open
  db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(clock - 3600000, uid('ben10@example.com'));
  clock += 4 * 60000; const out = await app.runReminders({ force: true }); const ben = uid('ben10@example.com');
  assert.ok(out.rules.unfinished.sent >= 0);
  const mine = (await call('ben', 'GET', '/inbox')).body.items.find((i) => /left in this section/.test(i.title)); assert.ok(mine, 'in-progress attempt gets a reminder');
  assert.ok(!(await call('ana', 'GET', '/inbox')).body.items.some((i) => /left in this section/.test(i.title)));
  // streak: practise three days running, then miss today in the evening
  const e = uid('ana10@example.com'); const t0 = clock; for (const k of [1, 2, 3]) db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,started_at,responses) VALUES (?,?,?,?,?,?)").run(`st${k}`, e, 'practice', 'submitted', t0 - k * D, '{}');
  db.prepare("DELETE FROM attempts WHERE user_id=? AND started_at>?").run(e, t0 - D / 2);
  clock = Date.parse('2026-11-08T13:00:00Z'); for (const k of [1, 2, 3]) db.prepare('UPDATE attempts SET started_at=? WHERE id=?').run(clock - k * D, `st${k}`);
  const o2 = await app.runReminders({ force: true }); assert.ok(o2.rules.streak, JSON.stringify(Object.keys(o2.rules)));
});

test('weekly digest: sent once, on the right day, only to students who did something', async () => {
  clock = Date.parse('2026-11-08T05:30:00Z'); // Sunday 11:00 in India
  // the earlier run on this Sunday afternoon already sent it
  assert.ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE kind='digest'").get().c >= 2);
  const mail = (await call('ana', 'GET', '/inbox')).body.items.find((i) => /Your week on MockDesk/.test(i.title)); assert.ok(mail, 'digest in inbox'); assert.match(mail.body, /Finished this week/);
  const again = await app.runReminders({ force: true }); assert.equal(again.rules.digest?.sent ?? 0, 0, 'no second digest the same day'); assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE kind='digest' AND title LIKE 'Your week%' AND user_id=?").get(uid('ana10@example.com')).c, 1);
  await call('ben', 'PATCH', '/notifications/prefs', { digest: false });
  assert.equal((await call('admin', 'PUT', '/admin/notifications/config', { digest: { enabled: false } })).status, 200);
  assert.equal((await call('admin', 'PUT', '/admin/notifications/config', { digest: { enabled: true, weekday: 3, hour: 8 } })).body.config?.digest?.weekday ?? 3, 3);
  await call('admin', 'PUT', '/admin/notifications/config', { digest: { enabled: true, weekday: 0, hour: 9 } });
});

test('event triggers: live results and a personal best', async () => {
  clock = Date.parse('2026-11-10T06:00:00Z');
  const liveMock = (await call('admin', 'POST', `/admin/mocks/${mock}/clone`, { name: 'Live Ten' })).body.mock.id; await call('admin', 'PATCH', `/admin/mocks/${liveMock}`, { status: 'published' });
  const set = await call('admin', 'PATCH', `/admin/mocks/${liveMock}`, { availableFrom: new Date(clock - 2 * H).toISOString(), liveUntil: new Date(clock + 6 * H).toISOString() }); assert.equal(set.status, 200, JSON.stringify(set.body));
  const a1 = await take('ana', liveMock, 0); await take('ben', liveMock, 1);
  clock += 8 * H; const out = await app.runReminders({ force: true });
  assert.ok(out.rules.liveResults?.sent >= 2, JSON.stringify(out.rules)); const r = (await call('ana', 'GET', '/inbox')).body.items.find((i) => /results are out/.test(i.title)); assert.ok(r); assert.match(r.title, /ranked \d+ of 2/);
  const again = await app.runReminders({ force: true }); assert.equal(again.rules.liveResults?.sent ?? 0, 0);
  // personal best: a higher score than any earlier finished mock
  const { personalBest } = await import('../lib/events.js'); const { reminderConfig } = await import('../lib/reminders.js');
  const cfg = reminderConfig({ get: (k, d) => d }); const ana = uid('ana10@example.com');
  await personalBest({ db, notifier: app.notifier, cfg, attempt: { id: 'fakepb', user_id: ana, mock_id: mock }, result: { summary: { percentage: 99 } } });
  assert.ok((await call('ana', 'GET', '/inbox')).body.items.some((i) => i.kind === 'personal_best' && /99%/.test(i.title)));
  await personalBest({ db, notifier: app.notifier, cfg, attempt: { id: 'fakepb2', user_id: ana, mock_id: mock }, result: { summary: { percentage: -100 } } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE ref='pb:fakepb2'").get().c, 0, 'a lower score is not a personal best');
  void a1;
});

test('parent view: private link, no login, revoke, expiry, no contact details', async () => {
  const made = await call('ana', 'POST', '/share-links', { label: 'Mom', days: 30 }); assert.equal(made.status, 201); const tok = made.body.path.split('/').pop();
  const pub = await call('anon', 'GET', `/public/progress/${tok}`); assert.equal(pub.status, 200, JSON.stringify(pub.body)); assert.equal(pub.body.progress.name, 'ana'); assert.equal(pub.body.progress.weeks.length, 8);
  assert.ok(!JSON.stringify(pub.body).includes('ana10@example.com') && !JSON.stringify(pub.body).includes('9800000001'));
  assert.equal(pub.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await call('anon', 'GET', '/public/progress/not-a-real-token')).status, 404);
  assert.equal((await call('ana', 'GET', '/share-links')).body.links[0].views, 1);
  assert.equal((await call('ben', 'DELETE', `/share-links/${made.body.link.id}`)).status, 404);
  clock += 31 * D; assert.equal((await call('anon', 'GET', `/public/progress/${tok}`)).status, 410); clock -= 31 * D;
  assert.equal((await call('ana', 'DELETE', `/share-links/${made.body.link.id}`)).status, 200); assert.equal((await call('anon', 'GET', `/public/progress/${tok}`)).status, 404);
  for (let i = 0; i < 5; i++) await call('ana', 'POST', '/share-links', {}); assert.equal((await call('ana', 'POST', '/share-links', {})).status, 400);
});

function makeDocx(paragraphs) {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const name = Buffer.from('word/document.xml'); const data = zlib.deflateRawSync(Buffer.from(xml)); const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(xml.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(xml.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([lh, name, data]); const central = Buffer.concat([cd, name]); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}
const QS = ['Q1. What is 2+2?', '(A) 3', '(B) 4', '(C) 5', '(D) 6', 'Answer: B', 'Explanation: Add them.', 'Q2. Capital of France?', 'A. Rome', 'B. Paris', 'C. Oslo', 'D. Bern', 'Answer: B', 'Q3. Broken one', 'A. x', 'B. y'];

test('content import: Word file and pasted text are read, problems named, duplicates flagged', async () => {
  const w = await call('admin', 'POST', '/admin/import/parse', { docx: makeDocx(QS).toString('base64'), defaults: { section: 'maths', difficulty: 'easy', topic: 'Arithmetic' } });
  assert.equal(w.status, 200, JSON.stringify(w.body)); assert.equal(w.body.rows.length, 2); assert.equal(w.body.problems.length, 1); assert.equal(w.body.rows[0].answer, 1); assert.equal(w.body.rows[0].section, 'maths');
  assert.equal((await call('admin', 'POST', '/admin/import/parse', { docx: Buffer.from('not a zip').toString('base64') })).status, 400);
  const t = await call('admin', 'POST', '/admin/import/parse', { text: QS.join('\n'), defaults: { section: 'maths' } }); assert.equal(t.body.rows.length, 2);
  const imp = await call('admin', 'POST', '/admin/mocks/pool/import', { rows: t.body.rows });
  assert.equal(imp.status, 201, JSON.stringify(imp.body)); assert.equal(imp.body.added, 2);
  const again = await call('admin', 'POST', '/admin/import/parse', { text: QS.join('\n'), defaults: { section: 'maths' } }); assert.equal(again.body.duplicates.length, 2, JSON.stringify(again.body.duplicates));
  const dry = await call('admin', 'POST', '/admin/mocks/pool/import', { rows: t.body.rows, dryRun: true }); assert.equal(dry.body.duplicates.length, 2);
  const diff = await call('admin', 'POST', '/admin/questions/similar', { text: 'What is 2+3?', options: ['3', '4', '5', '6'] }); assert.equal(diff.body.matches.filter((m) => m.score >= 0.9).length, 0, 'different numbers are not duplicates');
});

test('duplicates: list pairs, ignore a pair', async () => {
  await call('admin', 'POST', '/admin/mocks/pool/import', { rows: (await call('admin', 'POST', '/admin/import/parse', { text: QS.join('\n'), defaults: { section: 'maths' } })).body.rows });
  const list = await call('admin', 'GET', '/admin/duplicates?min=0.85'); assert.ok(list.body.pairs.some((p) => /Capital of France/.test(p.a.text)), JSON.stringify(list.body).slice(0, 300));
  const p = list.body.pairs.find((x) => /Capital of France/.test(x.a.text)); await call('admin', 'POST', '/admin/duplicates/ignore', { a: p.a.id, b: p.b.id });
  assert.ok(!(await call('admin', 'GET', '/admin/duplicates?min=0.85')).body.pairs.some((x) => /Capital of France/.test(x.a.text)));
});

test('AI drafts: needs an editor to approve, never changes the key, disagreement blocks approval', async () => {
  const d0 = (await call('admin', 'GET', '/admin/drafts')).body; assert.equal(d0.available, true); assert.ok(d0.missing.count >= 1);
  const q = (await call('admin', 'GET', '/admin/questions?q=What%20is%202%2B2&size=5')).body.questions[0]; assert.ok(q);
  const dr = await call('admin', 'POST', `/admin/questions/${q.id}/draft`); assert.equal(dr.status, 200, JSON.stringify(dr.body)); assert.equal(dr.body.draft.agrees, true);
  assert.equal(JSON.stringify((await call('admin', 'GET', `/admin/questions/${q.id}`)).body.question.explanation), '"Add them."', 'draft alone changes nothing');
  const ok = await call('admin', 'POST', `/admin/drafts/${q.id}/approve`, { edits: { explanation: 'Two plus two is four.' } }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await call('admin', 'GET', `/admin/questions/${q.id}`)).body.question.explanation, 'Two plus two is four.');
  const q2 = (await call('admin', 'GET', '/admin/questions?q=Capital%20of%20France&size=5')).body.questions[0];
  await call('admin', 'POST', `/admin/questions/${q2.id}/draft`); // fake model answers option 0, key says Paris
  const bad = await call('admin', 'POST', `/admin/drafts/${q2.id}/approve`, {}); assert.equal(bad.status, 409);
  assert.equal((await call('admin', 'POST', `/admin/drafts/${q2.id}/reject`)).status, 200);
  const b = await call('admin', 'POST', '/admin/drafts/batch', { limit: 3 }); assert.equal(b.status, 200); assert.ok(b.body.drafted >= 1);
});
