// Admin operations added in v11: answer-copy and shared-device signals, bulk student import, backups and data export.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normEmail, normPhone } from './lib/otp.js';
import { parseCsv, csvText } from './lib/csvparse.js';
import { maskEmail, maskPhone } from './lib/perms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
export const backupDir = () => process.env.MOCKDESK_BACKUPS || path.join(ROOT, 'data', 'backups');
export const BACKUP_DEFAULTS = { enabled: true, everyHours: 24, keep: 7 };
const NAME_RE = /^mockdesk-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;

/** Make one backup file now (a consistent copy of the live database) and delete the oldest ones beyond `keep`. */
export function runBackup({ db, now, settings, force = false }) {
  const cfg = { ...BACKUP_DEFAULTS, ...settings.get('backup', {}) };
  if (!force && !cfg.enabled) return null;
  const last = settings.get('backup_last', 0);
  if (!force && now() - last < cfg.everyHours * 3600000 - 60000) return null;
  const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
  const d = new Date(now()); const p = (n) => String(n).padStart(2, '0');
  const name = `mockdesk-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.db`;
  const f = path.join(dir, name); fs.rmSync(f, { force: true });
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  settings.set('backup_last', now());
  const all = fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - Math.max(1, cfg.keep)))) fs.rmSync(path.join(dir, old), { force: true });
  return { name, size: fs.statSync(f).size };
}
export const listBackups = () => { try { return fs.readdirSync(backupDir()).filter((n) => NAME_RE.test(n)).sort().reverse().map((n) => { const st = fs.statSync(path.join(backupDir(), n)); return { name: n, size: st.size, at: st.mtimeMs }; }); } catch { return []; } };

const HEADS = { name: ['name', 'student', 'student_name', 'full_name', 'fullname'], email: ['email', 'email_id', 'e-mail', 'mail', 'email_address'], phone: ['phone', 'mobile', 'mobile_number', 'whatsapp', 'contact', 'phone_number', 'mobile_no'], batch: ['batch', 'class', 'group'] };
const key = (h) => String(h || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function mountOps({ r, db, now, audit, bad, results, settings, notifier, page }) {
  // ---------- answer-copy and shared-device signals ----------
  const pairKey = (a, b) => [a, b].sort().join('|');
  r.get('/anomalies', (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 60)); const since = now() - days * DAY; const showAll = req.query.dismissed === '1';
    const meta = new Map(db.prepare("SELECT a.id, a.ip, a.device, u.name FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.mock_id!='practice' AND a.started_at>? AND COALESCE(u.role,'student')='student'").all(since).map((x) => [x.id, x]));
    const names = new Map(db.prepare('SELECT id, name FROM mocks').all().map((m) => [m.id, m.name]));
    const gone = new Set(db.prepare('SELECT key FROM anomaly_dismissed').all().map((x) => x.key));
    const byMock = new Map(); let checked = 0;
    for (const { row, res: rr } of results()) { if (!meta.has(row.id) || (row.submitted_at || 0) < since) continue; checked++; (byMock.get(row.mock_id) || byMock.set(row.mock_id, []).get(row.mock_id)).push({ row, rr }); }
    const pairs = [];
    for (const [mockId, list0] of byMock) {
      const list = list0.sort((a, b) => b.row.submitted_at - a.row.submitted_at).slice(0, 300).map(({ row, rr }) => {
        const m = new Map(); let wrong = 0; for (const q of rr.questions) if (q.selected != null) { m.set(q.id, q.selected); if (q.status === 'incorrect') wrong++; }
        return { id: row.id, userId: row.user_id, startedAt: row.started_at, m, wrong, wrongIds: rr.questions.filter((q) => q.status === 'incorrect').map((q) => q.id), score: rr.summary.score, max: rr.summary.maxMarks };
      });
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j]; if (A.userId === B.userId) continue;
        const small = A.wrongIds.length <= B.wrongIds.length ? A : B, big = small === A ? B : A;
        let shared = 0; for (const id of small.wrongIds) if (big.m.get(id) === small.m.get(id) && big.m.has(id)) shared++;
        const lowest = Math.min(A.wrong, B.wrong); if (shared < 5 || !lowest || shared / lowest < 0.6) continue;
        let common = 0, same = 0; for (const [id, s] of small.m) if (big.m.has(id)) { common++; if (big.m.get(id) === s) same++; }
        const ma = meta.get(A.id), mb = meta.get(B.id);
        const sameIp = !!(ma.ip && ma.ip === mb.ip), sameDevice = !!(ma.device && ma.device === mb.device);
        const level = (shared >= 10 && shared / lowest >= 0.8) || (shared >= 6 && (sameIp || sameDevice)) ? 'high' : 'medium';
        const k = pairKey(A.id, B.id); if (gone.has(k) && !showAll) continue;
        pairs.push({ key: k, dismissed: gone.has(k), mockId, mockName: names.get(mockId) || mockId, level, sharedWrong: shared, wrongA: A.wrong, wrongB: B.wrong, agreement: common ? Math.round((same / common) * 100) : 0, minutesApart: Math.round(Math.abs(A.startedAt - B.startedAt) / 60000), sameIp, sameDevice,
          a: { userId: A.userId, name: ma.name, attemptId: A.id, score: A.score, max: A.max }, b: { userId: B.userId, name: mb.name, attemptId: B.id, score: B.score, max: B.max } });
      }
    }
    pairs.sort((x, y) => (y.level === 'high') - (x.level === 'high') || y.sharedWrong - x.sharedWrong);
    // Users per device/IP need ids too, so build the id list separately for linking.
    const usersBy = (col) => { const m = new Map(); for (const x of db.prepare(`SELECT DISTINCT a.${col} v, u.id, u.name FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.${col} IS NOT NULL AND a.mock_id!='practice' AND a.started_at>? AND COALESCE(u.role,'student')='student'`).all(since)) (m.get(x.v) || m.set(x.v, []).get(x.v)).push({ id: x.id, name: x.name }); return [...m].filter(([, u]) => u.length >= 3).map(([v, u]) => ({ id: col === 'device' ? `${String(v).slice(0, 6)}…` : v, users: u })).sort((a, b) => b.users.length - a.users.length).slice(0, 10); };
    const { size, off } = page(req, 30);
    res.json({ summary: { checked, days, pairs: pairs.length, high: pairs.filter((p) => p.level === 'high').length, medium: pairs.filter((p) => p.level === 'medium').length }, total: pairs.length, pairs: pairs.slice(off, off + size), devices: usersBy('device'), networks: usersBy('ip') });
  });
  r.post('/anomalies/dismiss', (req, res) => {
    const k = String(req.body?.key || ''); if (!/^[\w-]{8,80}\|[\w-]{8,80}$/.test(k)) return bad(res, 'Invalid pair');
    if (req.body?.undo) db.prepare('DELETE FROM anomaly_dismissed WHERE key=?').run(k); else db.prepare('INSERT OR IGNORE INTO anomaly_dismissed(key,at,by) VALUES (?,?,?)').run(k, now(), req.user.name);
    audit(req, req.body?.undo ? 'anomaly_reopen' : 'anomaly_dismiss', k); res.json({ ok: true });
  });

  // ---------- bulk student import ----------
  const batchByName = () => new Map(db.prepare('SELECT id, name FROM batches').all().map((b) => [b.name.trim().toLowerCase(), b]));
  function readRows(csv, batchId) {
    const rows = parseCsv(csv); if (rows.length < 2) return { error: 'Add a header row (name, email, mobile) and at least one student' };
    const head = rows[0].map(key); const col = Object.fromEntries(Object.entries(HEADS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
    if (col.name < 0 || (col.email < 0 && col.phone < 0)) return { error: 'The first row must have a "name" column and an "email" or "mobile" column' };
    if (rows.length - 1 > 500) return { error: 'Import at most 500 students at a time' };
    const batches = batchByName(); const chosen = batchId ? db.prepare('SELECT id, name FROM batches WHERE id=?').get(batchId) : null;
    if (batchId && !chosen) return { error: 'Choose a batch' };
    const seen = new Set(); const out = [];
    rows.slice(1).forEach((c, i) => {
      const at = (n) => (col[n] >= 0 ? String(c[col[n]] || '').trim() : '');
      const name = at('name').slice(0, 80), rawE = at('email'), rawP = at('phone');
      const email = rawE ? normEmail(rawE) : null, phone = rawP ? normPhone(rawP) : null;
      const bn = at('batch'); const batch = bn ? batches.get(bn.toLowerCase()) || null : chosen;
      const row = { line: i + 2, name, email, phone, batchId: batch?.id || null, batchName: batch?.name || (bn ? `${bn} (not found)` : ''), status: 'new', reason: '' };
      const bad_ = (reason) => { row.status = 'invalid'; row.reason = reason; };
      if (!name) bad_('Name is missing');
      else if (rawE && !email) bad_('Email looks wrong');
      else if (rawP && !phone) bad_('Mobile number looks wrong');
      else if (!email && !phone) bad_('Add an email or a mobile number');
      else {
        const ids = [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean);
        if (ids.some((x) => seen.has(x))) bad_('Appears twice in this file'); else {
          ids.forEach((x) => seen.add(x));
          const ue = email ? db.prepare('SELECT id, role FROM users WHERE email=?').get(email) : null; const up = phone ? db.prepare('SELECT id, role FROM users WHERE phone=?').get(phone) : null;
          if (ue && up && ue.id !== up.id) bad_('Email and mobile belong to two different accounts');
          else if (ue || up) { const u = ue || up; if ((u.role || 'student') !== 'student') bad_('This person is staff, not a student'); else { row.status = 'exists'; row.userId = u.id; row.reason = batch ? 'Already has an account. Will be added to the batch.' : 'Already has an account'; } }
          else if (bn && !batch) row.reason = 'Batch not found. Account is created without a batch.';
        }
      }
      out.push(row);
    });
    return { rows: out };
  }
  const summarize = (rows) => ({ total: rows.length, new: rows.filter((x) => x.status === 'new').length, exists: rows.filter((x) => x.status === 'exists').length, invalid: rows.filter((x) => x.status === 'invalid').length });
  r.post('/students/import/preview', (req, res) => {
    const out = readRows(req.body?.csv, Number(req.body?.batchId) || null); if (out.error) return bad(res, out.error);
    res.json({ summary: summarize(out.rows), rows: out.rows.slice(0, 500) });
  });
  r.post('/students/import', async (req, res) => {
    const out = readRows(req.body?.csv, Number(req.body?.batchId) || null); if (out.error) return bad(res, out.error);
    const invite = !!req.body?.invite; let created = 0, added = 0, invited = 0; const t = now();
    for (const x of out.rows) {
      if (x.status === 'invalid') continue;
      let uid = x.userId;
      if (x.status === 'new') {
        try { uid = Number(db.prepare('INSERT INTO users(name,email,phone,role,created_at) VALUES (?,?,?,?,?)').run(x.name, x.email, x.phone, 'student', new Date(t).toISOString()).lastInsertRowid); created++; x.userId = uid; }
        catch { x.status = 'invalid'; x.reason = 'Could not create this account'; continue; }
      }
      if (x.batchId && uid) added += Number(db.prepare('INSERT OR IGNORE INTO batch_members(batch_id,user_id,joined_at) VALUES (?,?,?)').run(x.batchId, uid, t).changes);
      if (invite && x.status === 'new' && x.email) {
        const r2 = await notifier.notify(uid, { kind: 'invite', title: `Welcome to ${notifier.siteName()}`, body: `${x.name}, you have been added to ${notifier.siteName()}${x.batchName && !x.batchName.includes('not found') ? ` (${x.batchName})` : ''}. Open the site and sign in with ${x.email}. We will email you a one-time code.`, link: '/', ref: `invite:${uid}`, channels: { inapp: false, push: false, email: true, whatsapp: false }, capped: false });
        if (r2?.email === 'sent') invited++;
      }
    }
    audit(req, 'students_import', `${created} new, ${added} added to batches`, `${out.rows.length} rows`);
    res.json({ summary: { ...summarize(out.rows), created, addedToBatch: added, invited }, rows: out.rows });
  });

  // ---------- backups ----------
  r.get('/backups', (req, res) => { const cfg = { ...BACKUP_DEFAULTS, ...settings.get('backup', {}) }; res.json({ config: cfg, last: settings.get('backup_last', 0) || null, backups: listBackups(), dir: backupDir() }); });
  r.put('/backups/config', (req, res) => {
    const b = req.body || {}; const cur = { ...BACKUP_DEFAULTS, ...settings.get('backup', {}) };
    const next = { enabled: b.enabled === undefined ? cur.enabled : !!b.enabled, everyHours: Math.min(168, Math.max(1, Number(b.everyHours ?? cur.everyHours) || 24)), keep: Math.min(60, Math.max(1, Number(b.keep ?? cur.keep) || 7)) };
    settings.set('backup', next); audit(req, 'backup_config', '', JSON.stringify(next)); res.json({ config: next });
  });
  r.post('/backups', (req, res) => { try { const out = runBackup({ db, now, settings, force: true }); audit(req, 'backup_create', out.name); res.json(out); } catch (e) { bad(res, `Could not create a backup: ${e.message}`, 500); } });
  r.get('/backups/:name', (req, res) => { if (!NAME_RE.test(req.params.name)) return bad(res, 'Not found', 404); const f = path.join(backupDir(), req.params.name); if (!fs.existsSync(f)) return bad(res, 'Not found', 404); audit(req, 'backup_download', req.params.name); res.download(f); });
  r.delete('/backups/:name', (req, res) => { if (!NAME_RE.test(req.params.name)) return bad(res, 'Not found', 404); fs.rmSync(path.join(backupDir(), req.params.name), { force: true }); audit(req, 'backup_delete', req.params.name); res.json({ ok: true }); });

  // ---------- CSV export ----------
  const EXPORTS = {
    students: { label: 'Students', hint: 'One row per student with tests started, finished and average.', head: ['Name', 'Email', 'Mobile', 'Status', 'Joined', 'Last active', 'Tests finished', 'Average %'],
      rows: (c) => db.prepare("SELECT id, name, email, phone, status, created_at, last_seen FROM users WHERE COALESCE(role,'student')='student' ORDER BY id").all().map((u) => { const mine = results().filter((x) => x.row.user_id === u.id); const done = mine.map((x) => x.res.summary.percentage); return [u.name, c(u.email, 'e'), c(u.phone, 'p'), u.status || 'active', u.created_at, u.last_seen ? new Date(u.last_seen).toISOString() : '', done.length, done.length ? Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10 : '']; }) },
    results: { label: 'Test results', hint: 'One row per finished test: score, accuracy, time and sections.', head: ['Student', 'Email', 'Mock', 'Submitted', 'Score', 'Out of', 'Percent', 'Accuracy %', 'Time (s)'],
      rows: (c) => { const u = new Map(db.prepare('SELECT id, name, email FROM users').all().map((x) => [x.id, x])); const m = new Map(db.prepare('SELECT id, name FROM mocks').all().map((x) => [x.id, x.name])); return results().map(({ row, res }) => { const us = u.get(row.user_id) || {}; return [us.name, c(us.email, 'e'), m.get(row.mock_id) || row.mock_id, new Date(row.submitted_at).toISOString(), res.summary.score, res.summary.maxMarks, res.summary.percentage, res.summary.accuracy, res.summary.timeTakenSec]; }); } },
    answers: { label: 'Answers by question', hint: 'One row per question per finished test. Can be large.', head: ['Student', 'Mock', 'Section', 'Question', 'Topic', 'Chosen', 'Correct', 'Result', 'Time (s)'],
      rows: () => { const u = new Map(db.prepare('SELECT id, name FROM users').all().map((x) => [x.id, x.name])); const m = new Map(db.prepare('SELECT id, name FROM mocks').all().map((x) => [x.id, x.name])); const out = []; for (const { row, res } of results()) for (const q of res.questions) out.push([u.get(row.user_id), m.get(row.mock_id) || row.mock_id, q.section, q.id, q.topic || '', q.selected == null ? '' : 'ABCD'[q.selected], 'ABCD'[q.correct] ?? '', q.status, q.timeSec ?? '']); return out; } },
    questions: { label: 'Question bank', hint: 'Every question with options, answer, topic and difficulty.', head: ['Id', 'Mock', 'Section', 'Topic', 'Difficulty', 'Question', 'A', 'B', 'C', 'D', 'Answer'],
      rows: () => db.prepare('SELECT id, mock_id, section, data FROM questions ORDER BY mock_id, section, id').all().map((x) => { const q = JSON.parse(x.data); return [x.id, x.mock_id, x.section, q.topic || '', q.difficulty || '', q.text, ...(q.options || []).slice(0, 4), ...Array(Math.max(0, 4 - (q.options || []).length)).fill(''), 'ABCD'[q.answer] ?? '']; }) },
    audit: { label: 'Audit log', hint: 'Who changed what and when.', head: ['When', 'Admin', 'Action', 'Target', 'Detail'], rows: () => db.prepare('SELECT at, admin_name, action, target, detail FROM audit ORDER BY id DESC LIMIT 20000').all().map((x) => [new Date(x.at).toISOString(), x.admin_name, x.action, x.target, x.detail]) },
  };
  r.get('/export', (req, res) => res.json({ exports: Object.entries(EXPORTS).map(([k, v]) => ({ key: k, label: v.label, hint: v.hint })) }));
  r.get('/export/:kind', (req, res) => {
    const e = EXPORTS[req.params.kind]; if (!e) return bad(res, 'Unknown export', 404);
    const c = (v, t) => (req.can('contacts') ? v : v == null ? '' : t === 'e' ? maskEmail(v) : maskPhone(v));
    audit(req, 'export', req.params.kind);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="mockdesk-${req.params.kind}-${new Date(now()).toISOString().slice(0, 10)}.csv"`);
    res.send(csvText(e.head, e.rows(c)));
  });
  void os;
}
