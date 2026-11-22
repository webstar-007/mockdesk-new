import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v18-'));
process.env.MOCKDESK_ADMINS_FILE = path.join(dir, 'none.txt'); process.env.MOCKDESK_ADMIN_EMAILS = ''; process.env.MOCKDESK_BACKUPS = path.join(dir, 'backups');
delete process.env.INVOCATION_ID; delete process.env.MOCKDESK_SUPERVISED; delete process.env.pm_id; delete process.env.KUBERNETES_SERVICE_HOST;
const { createApp } = await import('../app.js');
const { openDb } = await import('../lib/db.js');
const { pushLog } = await import('../lib/logs.js');
const { applyStagedRestore } = await import('../lib/restore.js');
const dbFile = path.join(dir, 't.db'); const db = openDb(dbFile);
let exits = 0;
const app = createApp(db, { allowIncomplete: true, serveClient: false, credKeyFile: path.join(dir, 'k'), exitFn: () => { exits++; } });
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
let sid;

test('set up an admin and two students', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss18@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss18@example.com'").run();
  for (const n of ['ann', 'bob']) await call(n, 'POST', '/auth/register', { name: n.toUpperCase(), email: `${n}18@example.com`, password: 'password123' });
  sid = idOf('ann18@example.com');
  assert.equal((await call('ann', 'GET', '/admin/server/info')).status, 403);
});

test('server page: info, and restart needs a service manager and a typed confirmation', async () => {
  const i = (await call('boss', 'GET', '/admin/server/info')).body; assert.ok(i.node); assert.equal(i.canRestart, false); assert.ok(Array.isArray(i.changelog) && i.changelog.length);
  assert.equal((await call('boss', 'POST', '/admin/server/restart', { confirm: 'restart' })).status, 409);
  process.env.MOCKDESK_SUPERVISED = '1';
  assert.equal((await call('boss', 'POST', '/admin/server/restart', {})).status, 400);
  assert.equal(exits, 0);
  const ok = await call('boss', 'POST', '/admin/server/restart', { confirm: 'restart' }); assert.equal(ok.status, 200);
  await new Promise((r) => setTimeout(r, 1000)); assert.equal(exits, 1);
  delete process.env.MOCKDESK_SUPERVISED;
});

test('database tools: sizes, optimise, integrity check', async () => {
  const d = (await call('boss', 'GET', '/admin/server/db')).body; assert.ok(d.size > 0); assert.ok(d.tables.find((t) => t.name === 'users').rows >= 3);
  const o = (await call('boss', 'POST', '/admin/server/db/optimize')).body; assert.equal(o.ok, true); assert.ok(o.after > 0);
  assert.equal((await call('boss', 'POST', '/admin/server/db/check')).body.ok, true);
});

test('log viewer filters, redacts tokens and downloads', async () => {
  pushLog('error', 'Boom in module X'); pushLog('info', 'cookie sid=abcdef123456 and ' + 'a'.repeat(64));
  const all = (await call('boss', 'GET', '/admin/server/logs')).body.lines; assert.ok(all.length >= 2);
  const errs = (await call('boss', 'GET', '/admin/server/logs?level=error&q=boom')).body.lines; assert.equal(errs.length, 1);
  assert.ok(!JSON.stringify(all).includes('abcdef123456') && !JSON.stringify(all).includes('a'.repeat(64)));
  const t = await call('boss', 'GET', '/admin/server/logs.txt'); assert.match(t.text, /ERROR\s+Boom/);
});

test('restore: a backup is checked, staged, swapped in at start-up, and the old database is kept', async () => {
  const b = (await call('boss', 'POST', '/admin/backups')).body; assert.ok(b.name);
  assert.equal((await call('boss', 'POST', `/admin/backups/${b.name}/restore`, {})).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/backups/mockdesk-2020-01-01-0000.db/restore', { confirm: 'restore' })).status, 404);
  const r = await call('boss', 'POST', `/admin/backups/${b.name}/restore`, { confirm: 'restore' }); assert.equal(r.status, 200);
  assert.ok(fs.existsSync(dbFile + '.restore')); assert.equal((await call('boss', 'GET', '/admin/server/info')).body.staged, true);
  assert.equal((await call('boss', 'DELETE', '/admin/server/restore')).body.cancelled, true); assert.ok(!fs.existsSync(dbFile + '.restore'));
  fs.writeFileSync(path.join(dir, 'junk.db'), 'not a database');
  await call('boss', 'POST', `/admin/backups/${b.name}/restore`, { confirm: 'restore' });
  const kept = applyStagedRestore(dbFile); assert.ok(kept && fs.existsSync(kept)); assert.ok(!fs.existsSync(dbFile + '.restore'));
});

test('release calendar lists scheduled opens, live windows and unscheduled drafts', async () => {
  const mocks = (await call('boss', 'GET', '/admin/mocks')).body.mocks; assert.ok(mocks.length);
  const at = Date.now() + 3 * 86400000;
  const p = await call('boss', 'PATCH', `/admin/mocks/${mocks[0].id}`, { availableFrom: new Date(at).toISOString() }); assert.equal(p.status, 200);
  const c = (await call('boss', 'GET', '/admin/calendar')).body; assert.ok(c.events.find((e) => e.mockId === mocks[0].id && e.type === 'mock-open'));
  assert.ok(Array.isArray(c.unscheduled));
});

test('view as student is read-only and returns to the admin', async () => {
  const v = await call('boss', 'POST', `/admin/users/${sid}/view-as`); assert.equal(v.status, 200);
  const me = (await call('boss', 'GET', '/me')).body; assert.equal(me.user.name, 'ANN'); assert.equal(me.viewAs.by, 'Boss');
  const blocked = await call('boss', 'POST', '/support', { subject: 'x', body: 'hello world 1234' }); assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'VIEW_ONLY');
  assert.equal((await call('boss', 'GET', '/mocks')).status, 200);
  assert.equal((await call('boss', 'POST', '/view-as/exit')).body.signedIn, true);
  assert.equal((await call('boss', 'GET', '/me')).body.user.name, 'Boss');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions WHERE view_by IS NOT NULL").get().c, 0);
  assert.equal((await call('ann', 'POST', `/admin/users/${idOf('bob18@example.com')}/view-as`)).status, 403);
  const adm = idOf('boss18@example.com'); assert.equal((await call('boss', 'POST', `/admin/users/${adm}/view-as`)).status, 400);
});

test('devices signed in can be listed and signed out one by one', async () => {
  await call('ann', 'POST', '/auth/login', { email: 'ann18@example.com', password: 'password123' });
  const l = (await call('boss', 'GET', `/admin/users/${sid}/sessions`)).body.sessions; assert.ok(l.length >= 2); assert.ok(l[0].ip !== undefined);
  assert.equal((await call('boss', 'DELETE', `/admin/users/${sid}/sessions/${l[0].id}`)).status, 200);
  assert.equal((await call('boss', 'GET', `/admin/users/${sid}/sessions`)).body.sessions.length, l.length - 1);
});

test('support inbox: student asks, staff replies, student is notified, rating and limits', async () => {
  assert.equal((await call('ann', 'POST', '/auth/login', { email: 'ann18@example.com', password: 'password123' })).status, 200);
  assert.equal((await call('ann', 'POST', '/support', { subject: '', body: 'hello there friend' })).status, 400);
  const c = await call('ann', 'POST', '/support', { subject: 'Cannot see my result', category: 'results', body: 'The analysis page is blank for mock 1.' }); assert.equal(c.status, 201);
  const id = c.body.ticket.id;
  assert.equal((await call('bob', 'GET', `/support/${id}`)).status, 404);
  const list = (await call('boss', 'GET', '/admin/tickets')).body; assert.equal(list.counts.open, 1); assert.equal(list.tickets[0].student, 'ANN');
  assert.equal((await call('boss', 'POST', `/admin/tickets/${id}/reply`, { body: 'Checking the logs first', note: true })).status, 200);
  assert.equal((await call('ann', 'GET', `/support/${id}`)).body.messages.length, 1);
  assert.equal((await call('boss', 'POST', `/admin/tickets/${id}/reply`, { body: 'Fixed. Please refresh and try again.' })).status, 200);
  const t = (await call('ann', 'GET', `/support/${id}`)).body; assert.equal(t.ticket.status, 'answered'); assert.equal(t.messages.length, 2); assert.equal(t.messages[1].from, 'staff');
  assert.ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND kind='support'").get(sid).c >= 1);
  await call('ann', 'POST', `/support/${id}/reply`, { body: 'Thanks, it works now.' }); assert.equal((await call('boss', 'GET', '/admin/tickets?status=open')).body.counts.open, 1);
  assert.equal((await call('boss', 'PATCH', `/admin/tickets/${id}`, { status: 'closed' })).status, 200);
  assert.equal((await call('ann', 'POST', `/support/${id}/rate`, { rating: 5 })).status, 200); assert.equal((await call('boss', 'GET', '/admin/tickets')).body.rating.avg, 5);
  for (let i = 0; i < 5; i++) await call('ann', 'POST', '/support', { subject: 'Q' + i, body: 'A question number ' + i + ' here' });
  assert.equal((await call('ann', 'POST', '/support', { subject: 'Too many', body: 'This should be refused now' })).status, 429);
  await call('boss', 'PUT', '/admin/controls', { ...(await call('boss', 'GET', '/admin/controls')).body.controls, features: { practice: true, referrals: true, shareLinks: true, notebook: true, support: false } });
  assert.equal((await call('ann', 'GET', '/support')).body.code, 'FEATURE_OFF');
});

test('staff with the support permission can answer; others cannot', async () => {
  await call('boss', 'PUT', '/admin/controls', { ...(await call('boss', 'GET', '/admin/controls')).body.controls, features: { practice: true, referrals: true, shareLinks: true, notebook: true, support: true } });
  await call('ed', 'POST', '/auth/register', { name: 'Ed', email: 'ed18@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='editor', perms=? WHERE email='ed18@example.com'").run(JSON.stringify(['content']));
  assert.equal((await call('ed', 'GET', '/admin/tickets')).status, 403);
  db.prepare("UPDATE users SET perms=? WHERE email='ed18@example.com'").run(JSON.stringify(['content', 'support']));
  assert.equal((await call('ed', 'GET', '/admin/tickets')).status, 200);
  assert.equal((await call('ed', 'GET', '/admin/server/info')).status, 403);
});

test('bulk actions: add to batch, message, target, remove', async () => {
  const b = db.prepare("INSERT INTO batches(name,code,created_at,created_by) VALUES ('Evening','EVE18',?,'x')").run(Date.now()).lastInsertRowid;
  const ids = [sid, idOf('bob18@example.com')];
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids, action: 'add-to-batch', batchId: Number(b) })).body.done, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM batch_members WHERE batch_id=?').get(b).c, 2);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids, action: 'add-to-batch' })).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids, action: 'message', title: 'Mock on Sunday', body: 'Be ready at 9 am.' })).body.done, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE title='Mock on Sunday'").get().c, 2);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids, action: 'message', title: '', body: '' })).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids, action: 'set-target', target: 280 })).body.done, 2);
  assert.equal(db.prepare('SELECT target_score t FROM users WHERE id=?').get(sid).t, 280);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids, action: 'remove-from-batch', batchId: Number(b) })).body.done, 2);
});

test('download and erase one person’s data', async () => {
  const bob = idOf('bob18@example.com');
  await call('bob', 'POST', '/auth/login', { email: 'bob18@example.com', password: 'password123' });
  await call('bob', 'POST', '/support', { subject: 'Hello', body: 'A question from Bob here.' });
  db.prepare('INSERT INTO login_log(at,user_id,who,ok,method) VALUES (?,?,?,1,?)').run(Date.now(), bob, 'bob18@example.com', 'password');
  const ex = await call('boss', 'GET', `/admin/users/${bob}/export`); assert.equal(ex.status, 200);
  assert.equal(ex.body.profile.email, 'bob18@example.com'); assert.ok(!('hash' in ex.body.profile) && !('salt' in ex.body.profile)); assert.ok(ex.body.data.tickets.length >= 1); assert.ok(ex.body.data.ticket_messages.length >= 1); assert.ok(!ex.body.data.sessions);
  assert.equal((await call('boss', 'POST', `/admin/users/${bob}/erase`, { confirm: 'wrong' })).status, 400);
  assert.equal((await call('boss', 'POST', `/admin/users/${idOf('boss18@example.com')}/erase`, { confirm: 'boss18@example.com' })).status, 400);
  const er = await call('boss', 'POST', `/admin/users/${bob}/erase`, { confirm: 'bob18@example.com' }); assert.equal(er.status, 200); assert.equal(er.body.removed.users, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(bob).c, 0);
  for (const t of ['tickets', 'sessions', 'login_log']) assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE user_id=?`).get(bob).c, 0);
});
