import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v22-'));
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

test('administrators: invite, promote, permissions, caps, removal and the safety rules', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss22@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss22@example.com'").run();
  await call('stu', 'POST', '/auth/register', { name: 'Sam Student', email: 'sam22@example.com', password: 'password123' });
  await call('tea', 'POST', '/auth/register', { name: 'Tina Teacher', email: 'tina22@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='tina22@example.com'").run();
  assert.equal((await call('stu', 'GET', '/admin/administrators')).status, 403, 'students cannot open it');

  const l0 = (await call('boss', 'GET', '/admin/administrators')).body;
  assert.equal(l0.counts.admins, 1); assert.equal(l0.counts.teachers, 1); assert.equal(l0.config.maxAdmins, 10); assert.ok(l0.presets.length >= 3); assert.ok(l0.perms.content);
  assert.ok(l0.people.find((p) => p.email === 'boss22@example.com').self);

  // inviting someone who has not signed up yet
  assert.equal((await call('boss', 'POST', '/admin/administrators/invite', { contact: 'nope', role: 'admin' })).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/administrators/invite', { contact: 'new22@example.com', role: 'owner' })).status, 400);
  const inv = await call('boss', 'POST', '/admin/administrators/invite', { contact: 'New22@Example.com', role: 'editor', preset: 'analyst' }); assert.equal(inv.status, 201); assert.equal(inv.body.status, 'invited');
  assert.equal((await call('boss', 'POST', '/admin/administrators/invite', { contact: 'new22@example.com', role: 'editor', preset: 'support' })).status, 201, 'inviting again updates it');
  const l1 = (await call('boss', 'GET', '/admin/administrators')).body; assert.equal(l1.invites.length, 1); assert.deepEqual(l1.invites[0].perms.includes('support'), true);
  await call('newbie', 'POST', '/auth/register', { name: 'Newbie Staff', email: 'new22@example.com', password: 'password123' });
  await call('newbie', 'POST', '/auth/login', { email: 'new22@example.com', password: 'password123' });
  const nb = db.prepare("SELECT role, perms FROM users WHERE email='new22@example.com'").get(); assert.equal(nb.role, 'editor'); assert.ok(JSON.parse(nb.perms).includes('support'));
  assert.equal((await call('boss', 'GET', '/admin/administrators')).body.invites.length, 0, 'invitation is used up');

  // promoting an existing student
  const pr = await call('boss', 'POST', '/admin/administrators/invite', { contact: 'sam22@example.com', role: 'editor', preset: 'content' }); assert.equal(pr.body.status, 'promoted');
  const samId = idOf('sam22@example.com'); assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(samId).role, 'editor');
  assert.equal((await call('boss', 'POST', '/admin/administrators/invite', { contact: 'sam22@example.com', role: 'editor' })).status, 400, 'already staff');

  // permissions and role changes
  const ch = await call('boss', 'PUT', `/admin/administrators/${samId}`, { preset: 'analyst' }); assert.equal(ch.status, 200); assert.equal(ch.body.person.preset, 'analyst'); assert.ok(ch.body.person.perms.includes('data'));
  assert.equal((await call('boss', 'PUT', `/admin/administrators/${samId}`, { perms: ['data', 'bogus'] })).body.person.preset, 'custom');
  assert.equal((await call('boss', 'PUT', `/admin/administrators/${idOf('boss22@example.com')}`, { role: 'editor' })).status, 400, 'not yourself');
  assert.equal((await call('boss', 'PUT', `/admin/administrators/${idOf('tina22@example.com')}`, { role: 'admin' })).status, 404, 'teachers are managed elsewhere');
  assert.equal((await call('boss', 'PUT', `/admin/administrators/${samId}`, { role: 'admin' })).body.person.role, 'admin');

  // the cap
  assert.equal((await call('boss', 'PUT', '/admin/administrators-config', { maxAdmins: 1 })).status, 400, 'cannot set a cap below the current admins');
  assert.equal((await call('boss', 'PUT', '/admin/administrators-config', { maxAdmins: 2, inactiveDays: 3, defaultPreset: 'support', notifyAdmins: false })).body.config.inactiveDays, 7, 'inactive days are at least 7');
  assert.equal((await call('boss', 'POST', '/admin/administrators/invite', { contact: 'third22@example.com', role: 'admin' })).status, 400, 'cap reached');
  assert.equal((await call('boss', 'POST', '/admin/administrators/invite', { contact: 'third22@example.com', role: 'editor' })).status, 201, 'staff do not count against the cap');
  await call('boss', 'PUT', '/admin/administrators-config', { maxAdmins: 10, inactiveDays: 7 });

  // inactive accounts
  db.prepare('UPDATE users SET last_seen=? WHERE email=?').run(clock - 40 * 86400000, 'new22@example.com');
  const l2 = (await call('boss', 'GET', '/admin/administrators')).body; assert.ok(l2.inactive.includes(idOf('new22@example.com')));
  assert.ok(!l2.inactive.includes(idOf('boss22@example.com')));
  const lk = await call('boss', 'POST', '/admin/administrators-lock-inactive'); assert.ok(lk.body.locked >= 1); assert.equal(db.prepare("SELECT status FROM users WHERE email='new22@example.com'").get().status, 'suspended');
  assert.equal(db.prepare("SELECT status FROM users WHERE email='boss22@example.com'").get().status ?? 'active', 'active');
  await call('boss', 'PUT', '/admin/administrators-config', { inactiveDays: 0 }); assert.equal((await call('boss', 'POST', '/admin/administrators-lock-inactive')).status, 400);

  // removing rights, and what can never be removed
  assert.equal((await call('boss', 'DELETE', `/admin/administrators/${idOf('boss22@example.com')}`)).status, 400, 'not yourself');
  assert.equal((await call('boss', 'DELETE', `/admin/administrators/${samId}`)).status, 200); assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(samId).role, 'student');
  await call('bi', 'POST', '/auth/register', { name: 'Built In', email: 'admin@gmail.com', password: 'password123' }); await call('bi', 'POST', '/auth/login', { email: 'admin@gmail.com', password: 'password123' });
  const bid = idOf('admin@gmail.com'); assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(bid).role, 'admin');
  assert.equal((await call('boss', 'DELETE', `/admin/administrators/${bid}`)).status, 400); assert.equal((await call('boss', 'PUT', `/admin/administrators/${bid}`, { role: 'editor' })).status, 400);
  assert.ok((await call('boss', 'GET', '/admin/administrators')).body.people.find((p) => p.id === bid).builtIn);
  // cancelling an invitation, and the audit trail
  const pending = (await call('boss', 'GET', '/admin/administrators')).body.invites; assert.equal(pending.length, 1); assert.equal((await call('boss', 'DELETE', `/admin/administrators/invites/${pending[0].id}`)).status, 200);
  const actions = db.prepare('SELECT DISTINCT action FROM audit').all().map((x) => x.action); for (const a of ['admin_invite', 'admin_promote', 'admin_remove', 'user_perms', 'admin_rules', 'staff_lockout', 'admin_invite_cancel']) assert.ok(actions.includes(a), a);
});

test('removed and merged screens: copy check is gone, system lives in server tools', async () => {
  assert.equal((await call('boss', 'GET', '/admin/anomalies')).status, 404);
  assert.ok((await call('boss', 'GET', '/admin/system')).body.checks.length >= 5, 'server health still has its numbers');
});

test('help: v22 topics, quick checks and page finder', async () => {
  const { KB } = await import('../helpkb.js');
  const ids = new Set(KB.map((e) => e.id));
  for (const id of ['admin-invite', 'admin-rules', 'site-config', 'server-tools', 'audit-log']) assert.ok(ids.has(id), id);
  const txt = JSON.stringify(KB);
  assert.ok(!txt.includes('/admin/team') && !txt.includes('/admin/system') && !txt.includes('/admin/anomalies'));
  const { search } = await import('../help.js');
  assert.equal(search('how do I invite a new admin').results[0].id, 'admin-invite');
  assert.equal(search('where did the system page go').results[0].id, 'server-tools');
});

test('help: quick checks and page finder endpoints', async () => {
  const c = (await call('boss', 'GET', '/admin/help/checks')).body.checks;
  assert.ok(c.length >= 4 && c.every((x) => ['good', 'warn', 'bad'].includes(x.tone) && x.to));
  const p = (await call('boss', 'GET', '/admin/help/pages?q=administr')).body.pages;
  assert.ok(p.some((x) => x.to === '/admin/administrators'));
  const a = (await call('boss', 'POST', '/admin/help/ask', { q: 'how many admins do I have' })).body;
  assert.ok(a.live && a.live.title === 'Admins and staff');
});
