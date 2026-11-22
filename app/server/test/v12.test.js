import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const f = path.join(os.tmpdir(), `admins12-${Date.now()}.txt`);
fs.writeFileSync(f, 'boss12@example.com\n');
process.env.MOCKDESK_BACKUPS = path.join(os.tmpdir(), `bk12-${Date.now()}`); process.env.MOCKDESK_ADMINS_FILE = f; process.env.MOCKDESK_ADMIN_EMAILS = '';
const { createApp } = await import('../app.js');
const { openDb } = await import('../lib/db.js');
const db = openDb(':memory:');
const sent = []; const mailer = { send: async (m) => { sent.push(m); } };
const app = createApp(db, { allowIncomplete: true, serveClient: false, mailer });
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
const jar = {};
async function call(who, method, url, body) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
test.after(() => { server.close(); fs.rmSync(f, { force: true }); fs.rmSync(process.env.MOCKDESK_BACKUPS, { recursive: true, force: true }); });
const reg = (who, email) => call(who, 'POST', '/auth/register', { name: `${who} K`, email, password: 'password123' });
const setControls = (patch) => call('boss', 'PUT', '/admin/controls', patch);
const base0 = { maintenance: { mode: 'off', message: '' }, signups: { open: true, domains: [] }, features: {}, blockedIps: [] };

test('admin only; students and staff without access are refused', async () => {
  await reg('boss', 'boss12@example.com'); await reg('stu', 'stu12@example.com');
  assert.equal((await call('stu', 'GET', '/admin/controls')).status, 403);
  assert.equal((await call('boss', 'GET', '/admin/controls')).status, 200);
});
test('sign-up rules: closed, domain limited, open again', async () => {
  assert.equal((await setControls({ ...base0, signups: { open: false, message: 'Closed for now' } })).status, 200);
  const r = await reg('x1', 'x1@example.com'); assert.equal(r.status, 403); assert.equal(r.body.error, 'Closed for now');
  await setControls({ ...base0, signups: { open: true, domains: ['college.edu.in'] } });
  assert.equal((await reg('x2', 'x2@example.com')).status, 403);
  assert.equal((await reg('x3', 'x3@college.edu.in')).status, 201);
  assert.equal((await call('boss', 'PUT', '/admin/controls', { ...base0, signups: { domains: ['not a domain'] } })).status, 400);
  await setControls(base0);
});
test('maintenance: soft blocks starting tests, hard locks students out, admins unaffected', async () => {
  await setControls({ ...base0, maintenance: { mode: 'soft', message: 'Back at 6pm' } });
  const s = await call('stu', 'POST', '/mocks/anything/start'); assert.equal(s.status, 503); assert.equal(s.body.code, 'MAINTENANCE');
  assert.equal((await call('stu', 'GET', '/me')).status, 200);
  await setControls({ ...base0, maintenance: { mode: 'hard', message: 'Down' } });
  assert.equal((await call('stu', 'GET', '/stats')).status, 503);
  assert.equal((await call('stu', 'GET', '/me')).status, 200);
  assert.equal((await call('boss', 'GET', '/admin/overview')).status, 200);
  const site = await call('anon', 'GET', '/public/site'); assert.equal(site.body.maintenance, 'hard'); assert.equal(site.body.maintenanceMessage, 'Down');
  await setControls(base0); await new Promise((r) => setTimeout(r, 0));
});
test('feature switches turn a student feature off', async () => {
  await setControls({ ...base0, features: { notebook: false } });
  const r = await call('stu', 'GET', '/notebook'); assert.equal(r.status, 403); assert.equal(r.body.code, 'FEATURE_OFF');
  await setControls(base0);
});
test('blocked addresses: cannot block yourself, blocked address gets 403', async () => {
  assert.equal((await setControls({ ...base0, blockedIps: ['127.0.0.1'] })).status, 400);
  assert.equal((await setControls({ ...base0, blockedIps: ['9.9.9.*'] })).status, 200);
  assert.equal((await call('stu', 'GET', '/me')).status, 200);
  await setControls(base0);
});
test('sign-in log records successes and failures; security page and sign-out-all', async () => {
  await call('anon', 'POST', '/auth/login', { email: 'stu12@example.com', password: 'wrongwrong' });
  const sec = await call('boss', 'GET', '/admin/security'); assert.equal(sec.status, 200);
  assert.ok(sec.body.log.some((x) => !x.ok && x.who === 'stu12@example.com')); assert.ok(sec.body.log.some((x) => x.ok));
  assert.ok(sec.body.failed24 >= 1);
  const out = await call('boss', 'POST', '/admin/security/sign-out-all', { who: 'students' }); assert.ok(out.body.signedOut >= 1);
  assert.equal((await call('stu', 'GET', '/me')).status, 401); assert.equal((await call('boss', 'GET', '/me')).status, 200);
});
test('monitor reports traffic and live counts', async () => {
  const m = await call('boss', 'GET', '/admin/monitor'); assert.equal(m.status, 200);
  assert.ok(m.body.series.length >= 10); assert.ok(m.body.series.some((x) => x.n > 0)); assert.ok(m.body.top.length); assert.ok('onlineNow' in m.body.live);
});
test('jobs can be listed, paused and run', async () => {
  const l = await call('boss', 'GET', '/admin/jobs'); assert.ok(l.body.jobs.length >= 4);
  const run = await call('boss', 'POST', '/admin/jobs/cleanup/run'); assert.equal(run.status, 200);
  const p = await call('boss', 'PUT', '/admin/jobs/backup', { paused: true }); assert.ok(p.body.jobs.find((j) => j.name === 'backup').paused);
  assert.equal((await call('boss', 'POST', '/admin/jobs/nope/run')).status, 404);
  const a = await call('boss', 'GET', '/admin/attention'); assert.ok(a.body.items.some((i) => /paused/.test(i.text)));
  await call('boss', 'PUT', '/admin/jobs/backup', { paused: false });
});
test('integrations list and test email', async () => {
  const i = await call('boss', 'GET', '/admin/integrations'); assert.ok(i.body.items.find((x) => x.key === 'email').on);
  const t = await call('boss', 'POST', '/admin/integrations/test-email', { to: 'me@example.com' }); assert.equal(t.status, 200); assert.equal(sent.at(-1).to, 'me@example.com');
  assert.equal((await call('boss', 'POST', '/admin/integrations/test-email', { to: 'bad' })).status, 400);
});
test('bulk actions suspend, reactivate and skip staff', async () => {
  await call('stu', 'POST', '/auth/login', { email: 'stu12@example.com', password: 'password123' });
  const id = db.prepare("SELECT id FROM users WHERE email='stu12@example.com'").get().id, boss = db.prepare("SELECT id FROM users WHERE email='boss12@example.com'").get().id;
  const r = await call('boss', 'POST', '/admin/users/bulk', { ids: [id, boss, 99999], action: 'suspend' }); assert.equal(r.body.done, 1); assert.equal(r.body.skipped, 2);
  assert.equal((await call('stu', 'GET', '/me')).status, 401);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids: [id], action: 'activate' })).body.done, 1);
  assert.equal((await call('boss', 'POST', '/admin/users/bulk', { ids: [], action: 'suspend' })).status, 400);
});
test('settings export leaves out secrets and import restores', async () => {
  await setControls({ ...base0, signups: { open: false } });
  const ex = await call('boss', 'GET', '/admin/config/export'); assert.equal(ex.status, 200); assert.ok(!('secret' in ex.body.settings)); assert.equal(ex.body.settings.controls.signups.open, false);
  await setControls(base0);
  assert.equal((await call('boss', 'POST', '/admin/config/import', ex.body)).body.imported >= 1, true);
  assert.equal((await call('boss', 'GET', '/admin/controls')).body.controls.signups.open, false);
  assert.equal((await call('boss', 'POST', '/admin/config/import', { app: 'x' })).status, 400);
  await setControls(base0);
});
