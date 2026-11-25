import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v20-'));
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
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss20@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss20@example.com'").run();
  await call('boss2', 'POST', '/auth/register', { name: 'Second Admin', email: 'boss2_20@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='admin' WHERE email='boss2_20@example.com'").run();
  await call('tea', 'POST', '/auth/register', { name: 'Tina Teacher', email: 'tina20@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='teacher' WHERE email='tina20@example.com'").run();
  await call('ed', 'POST', '/auth/register', { name: 'Ed Editor', email: 'ed20@example.com', password: 'password123' });
  db.prepare("UPDATE users SET role='editor', perms='[\"content\"]' WHERE email='ed20@example.com'").run();
  await call('s0', 'POST', '/auth/register', { name: 'Stu', email: 's0_20@example.com', password: 'password123' });
  for (const w of ['boss', 'boss2', 'tea', 'ed', 's0']) await call(w, 'POST', '/auth/login', { email: { boss: 'boss20', boss2: 'boss2_20', tea: 'tina20', ed: 'ed20', s0: 's0_20' }[w] + '@example.com', password: 'password123' });
  assert.equal((await call('s0', 'GET', '/admin/team')).status, 403);
  assert.equal((await call('tea', 'GET', '/admin/team')).status, 403);
  assert.equal((await call('ed', 'GET', '/admin/team')).status, 403, 'staff need no access to the team page');
});

test('branding: logo, colour and footer are saved, validated and shown on the public site', async () => {
  const cur = (await call('boss', 'GET', '/admin/site')).body; const base0 = { site: cur.site, limits: cur.limits };
  const put = (patch) => call('boss', 'PUT', '/admin/site', { ...base0, site: { ...cur.site, ...patch } });
  assert.equal((await put({ accent: 'red' })).status, 400);
  assert.equal((await put({ accent: '#ffff00' })).status, 400, 'too light for white text');
  assert.equal((await put({ logoUrl: 'https://evil.example/x.png' })).status, 400, 'only our own uploads');
  assert.equal((await put({ logoUrl: '/uploads/../../etc/passwd' })).status, 400);
  const ok = await put({ accent: '#0F766E', logoUrl: '/uploads/abc123.png', footerText: 'Made in Pune' }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const pub = (await call('s0', 'GET', '/public/site')).body;
  assert.equal(pub.accent, '#0f766e'); assert.equal(pub.logoUrl, '/uploads/abc123.png'); assert.equal(pub.footerText, 'Made in Pune');
  assert.equal((await put({ accent: '', logoUrl: '', footerText: '' })).status, 200);
  assert.equal((await call('s0', 'GET', '/public/site')).body.accent, '');
});

test('team: list, activity, sign-out, lockout, unlock, lock-all', async () => {
  const list = (await call('boss', 'GET', '/admin/team')).body;
  assert.deepEqual(list.people.map((p) => p.role).sort(), ['admin', 'admin', 'editor', 'teacher']);
  const me = list.people.find((p) => p.self); assert.equal(me.email, 'boss20@example.com'); assert.ok(me.sessions >= 1);
  const tina = list.people.find((p) => p.email === 'tina20@example.com'); const ed = list.people.find((p) => p.email === 'ed20@example.com'); const b2 = list.people.find((p) => p.email === 'boss2_20@example.com');
  assert.ok(tina.sessions >= 1);
  const det = await call('boss', 'GET', `/admin/team/${tina.id}`); assert.equal(det.status, 200); assert.ok(det.body.logins.length >= 1);
  assert.equal((await call('boss', 'GET', '/admin/team/' + idOf('s0_20@example.com'))).status, 404, 'students are not team members');
  assert.equal((await call('boss', 'POST', `/admin/team/${me.id}/lock`, {})).status, 400, 'cannot lock yourself');
  // sign out
  const so = await call('boss', 'POST', `/admin/team/${tina.id}/signout`, {}); assert.equal(so.status, 200); assert.ok(so.body.signedOut >= 1);
  assert.equal((await call('tea', 'GET', '/me')).body.user ?? null, null);
  // lock a teacher: cannot sign in again
  assert.equal((await call('boss', 'POST', `/admin/team/${tina.id}/lock`, { reason: 'test' })).status, 200);
  const re = await call('tea', 'POST', '/auth/login', { email: 'tina20@example.com', password: 'password123' }); assert.equal(re.status, 403); assert.equal(re.body.code, 'SUSPENDED');
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action='staff_lockout'").get());
  assert.equal((await call('boss', 'POST', `/admin/team/${tina.id}/unlock`)).status, 200);
  assert.equal((await call('tea', 'POST', '/auth/login', { email: 'tina20@example.com', password: 'password123' })).status, 200);
  // the last other admin cannot be locked if it would leave none: lock b2 is fine because boss remains
  assert.equal((await call('boss', 'POST', `/admin/team/${b2.id}/lock`, {})).status, 200);
  assert.equal((await call('boss2', 'GET', '/admin/team')).status, 401, 'locked admin is signed out');
  await call('boss', 'POST', `/admin/team/${b2.id}/unlock`);
  // lock-all spares admins
  const all = await call('boss', 'POST', '/admin/team/lock-all'); assert.equal(all.status, 200); assert.equal(all.body.locked, 2);
  assert.equal(db.prepare("SELECT status FROM users WHERE id=?").get(ed.id).status, 'suspended');
  assert.notEqual(db.prepare("SELECT status FROM users WHERE id=?").get(b2.id).status, 'suspended');
  assert.equal((await call('ed', 'GET', '/me')).body.user ?? null, null);
});

test('team: repeated failed staff sign-ins raise an alert', async () => {
  for (let i = 0; i < 6; i++) db.prepare('INSERT INTO login_log(at,user_id,who,ok,method,ip,ua,note) VALUES (?,?,?,?,?,?,?,?)').run(clock, idOf('boss2_20@example.com'), 'boss2_20@example.com', 0, 'password', '1.2.3.4', 'x', 'bad password');
  await call('boss', 'POST', '/admin/alert-center/check');
  const a = (await call('boss', 'GET', '/admin/alert-center')).body.items; assert.ok(a.some((x) => /failed sign-ins/.test(x.title) && x.link === 'administrators'), JSON.stringify(a.map((x) => x.title)));
});
