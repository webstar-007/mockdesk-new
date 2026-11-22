import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v14-'));
const af = path.join(dir, 'admins.txt'); fs.writeFileSync(af, 'boss14@example.com\n');
process.env.MOCKDESK_ADMINS_FILE = af; process.env.MOCKDESK_ADMIN_EMAILS = '';
for (const k of ['SMTP_HOST', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SMS_PROVIDER', 'WHATSAPP_PROVIDER']) delete process.env[k];
const { createApp } = await import('../app.js');
const { openDb } = await import('../lib/db.js');
const db = openDb(':memory:'); const keyFile = path.join(dir, 'key1');
const app = createApp(db, { allowIncomplete: true, serveClient: false, credKeyFile: keyFile });
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
const jar = {};
async function call(who, method, url, body) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; } return { status: r.status, body: j, text };
}
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const field = (groups, id, key) => groups.find((g) => g.id === id).fields.find((f) => f.key === key);

test('only admins can open keys', async () => {
  await call('boss', 'POST', '/auth/register', { name: 'Boss', email: 'boss14@example.com', password: 'password123' });
  await call('stu', 'POST', '/auth/register', { name: 'Stu', email: 'stu14@example.com', password: 'password123' });
  assert.equal((await call('stu', 'GET', '/admin/credentials')).status, 403);
  assert.equal((await call('boss', 'GET', '/admin/credentials')).status, 200);
});
test('saving an AI key turns AI on, hides the key, and stores it encrypted', async () => {
  assert.equal((await call('boss', 'GET', '/admin/integrations')).body.items.find((i) => i.key === 'ai').on, false);
  const secret = 'sk-ant-SECRETVALUE-1234';
  const put = await call('boss', 'PUT', '/admin/credentials', { values: { ANTHROPIC_API_KEY: secret, MOCKDESK_AI_MODEL: 'claude-test-model' } });
  assert.equal(put.status, 200); assert.ok(!put.text.includes(secret));
  const g = await call('boss', 'GET', '/admin/credentials'); assert.ok(!g.text.includes(secret));
  const f = field(g.body.groups, 'ai', 'ANTHROPIC_API_KEY'); assert.equal(f.set, true); assert.equal(f.source, 'admin'); assert.equal(f.hint, '••••1234'); assert.equal(f.value, '');
  assert.equal(field(g.body.groups, 'ai', 'MOCKDESK_AI_MODEL').value, 'claude-test-model');
  const i = (await call('boss', 'GET', '/admin/integrations')).body.items.find((x) => x.key === 'ai'); assert.equal(i.on, true); assert.match(i.detail, /claude-test-model/);
  const raw = db.prepare("SELECT value FROM settings WHERE key='credentials'").get().value; assert.ok(!raw.includes(secret)); assert.ok(raw.includes('v1:'));
});
test('blank secret keeps the saved one; clear removes it', async () => {
  await call('boss', 'PUT', '/admin/credentials', { values: { ANTHROPIC_API_KEY: '' } });
  assert.equal(field((await call('boss', 'GET', '/admin/credentials')).body.groups, 'ai', 'ANTHROPIC_API_KEY').set, true);
  await call('boss', 'PUT', '/admin/credentials', { clear: ['ANTHROPIC_API_KEY'] });
  assert.equal(field((await call('boss', 'GET', '/admin/credentials')).body.groups, 'ai', 'ANTHROPIC_API_KEY').set, false);
  assert.equal((await call('boss', 'GET', '/admin/integrations')).body.items.find((x) => x.key === 'ai').on, false);
});
test('email settings take effect without a restart', async () => {
  assert.equal((await call('boss', 'GET', '/admin/integrations')).body.items.find((x) => x.key === 'email').on, false);
  await call('boss', 'PUT', '/admin/credentials', { values: { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '2525', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'Me <me@example.test>' } });
  const e = (await call('boss', 'GET', '/admin/integrations')).body.items.find((x) => x.key === 'email'); assert.equal(e.on, true); assert.match(e.detail, /smtp\.example\.test:2525/);
  assert.equal((await call('boss', 'POST', '/admin/credentials/test/email', { to: 'bad' })).status, 400);
  await call('boss', 'PUT', '/admin/credentials', { values: { SMTP_HOST: '' } });
  assert.equal((await call('boss', 'GET', '/admin/integrations')).body.items.find((x) => x.key === 'email').on, false);
});
test('validation: unknown names, bad choices, bad ports and multi-line values are refused', async () => {
  for (const values of [{ NOPE: 'x' }, { SMS_PROVIDER: 'carrier-pigeon' }, { SMTP_PORT: 'abc' }, { SMTP_USER: 'a\nb' }]) assert.equal((await call('boss', 'PUT', '/admin/credentials', { values })).status, 400, JSON.stringify(values));
});
test('values survive a restart with the same key file, and are unreadable with another', async () => {
  await call('boss', 'PUT', '/admin/credentials', { values: { OPENAI_API_KEY: 'sk-openai-ABCD', AI_PROVIDER: 'openai' } });
  const same = createApp(db, { allowIncomplete: true, serveClient: false, credKeyFile: keyFile }); const s1 = same.listen(0);
  const j1 = {}; const c = async (m, u, b) => { const r = await fetch(`http://127.0.0.1:${s1.address().port}/api${u}`, { method: m, headers: { 'content-type': 'application/json', cookie: j1.c || '' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) j1.c = sc.split(';')[0]; return r.json(); };
  await c('POST', '/auth/login', { email: 'boss14@example.com', password: 'password123' });
  assert.equal((await c('GET', '/admin/integrations')).items.find((x) => x.key === 'ai').on, true);
  s1.close();
  const other = createApp(db, { allowIncomplete: true, serveClient: false, credKeyFile: path.join(dir, 'key2') }); const s2 = other.listen(0);
  const j2 = {}; const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss14@example.com', password: 'password123' }) }); j2.c = r.headers.get('set-cookie').split(';')[0];
  const ai = await (await fetch(`http://127.0.0.1:${s2.address().port}/api/admin/integrations`, { headers: { cookie: j2.c } })).json(); assert.equal(ai.items.find((x) => x.key === 'ai').on, false);
  s2.close();
});
test('sign-in rules are editable: shortest password is enforced', async () => {
  const cur = await call('boss', 'GET', '/admin/site'); assert.equal(cur.status, 200);
  const limits = { ...cur.body.limits, minPassword: 12 };
  assert.equal((await call('boss', 'PUT', '/admin/site', { site: cur.body.site, limits })).status, 200);
  assert.equal((await call('anon', 'POST', '/auth/register', { name: 'Short', email: 'short14@example.com', password: 'password123' })).status, 400);
  assert.equal((await call('anon', 'POST', '/auth/register', { name: 'Long', email: 'long14@example.com', password: 'password12345' })).status, 201);
  assert.equal((await call('anon', 'GET', '/public/site')).body.minPassword, 12);
  assert.equal((await call('boss', 'PUT', '/admin/site', { site: cur.body.site, limits: { ...limits, otpMinutes: 1 } })).status, 400);
});
