// Admin tools (v18): server page, database tools, restore, logs, release calendar, view as student, personal data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readLogs, clearLogs } from './lib/logs.js';
import { dbFile, stageRestore, cancelRestore, stagedPath } from './lib/restore.js';
import { exportUser, eraseUser } from './lib/userdata.js';
import { backupDir, NAME_RE } from './ops.js';
import { startedAt } from './lib/health.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
const fsize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const canRestart = () => process.env.MOCKDESK_RESTART !== 'off' && !!(process.env.INVOCATION_ID || process.env.MOCKDESK_SUPERVISED === '1' || process.env.pm_id || process.env.KUBERNETES_SERVICE_HOST);

function changelog() {
  try {
    return fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/^## /m).slice(1).map((blk) => { const [head, ...rest] = blk.split('\n'); const [v, ...t] = head.split(':'); return { version: v.trim(), title: t.join(':').trim(), text: rest.join('\n').trim() }; });
  } catch { return []; }
}
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return ''; } };

export function mountTools({ r, db, now, audit, bad, settings, exitFn = () => process.exit(0) }) {
  // ----- server page: what is running, restart -----
  r.get('/server/info', (req, res) => {
    const f = dbFile(db); const dist = path.join(ROOT, 'dist', 'index.html'); const log = changelog();
    res.json({
      app: version(), latest: log[0]?.version || '', node: process.version, platform: `${os.type()} ${os.release()}`, mode: process.env.NODE_ENV || 'development',
      startedAt, uptimeSec: Math.round(process.uptime()), builtAt: fsize(dist) ? fs.statSync(dist).mtimeMs : null, pid: process.pid,
      cpus: os.cpus().length, load: os.loadavg().map((x) => Math.round(x * 100) / 100), totalMem: os.totalmem(), freeMem: os.freemem(), rss: process.memoryUsage().rss,
      canRestart: canRestart(), restartHint: canRestart() ? '' : 'This server is not running under a service manager, so it would not start again by itself. On your AWS server this works. Set MOCKDESK_SUPERVISED=1 if you run it under pm2, Docker or similar.',
      database: { file: f ? path.basename(f) : 'memory', size: fsize(f), wal: fsize(f + '-wal') }, staged: !!(stagedPath(db) && fs.existsSync(stagedPath(db))), changelog: log.slice(0, 8),
    });
  });
  r.post('/server/restart', (req, res) => {
    if (req.body?.confirm !== 'restart') return bad(res, 'Type restart to confirm.', 400, { code: 'CONFIRM' });
    if (!canRestart()) return bad(res, 'This server is not running under a service manager, so it would not come back by itself.', 409);
    audit(req, 'server_restart'); res.json({ ok: true, message: 'Restarting. This page will reconnect in a few seconds.' });
    setTimeout(() => exitFn(), 800).unref?.();
  });

  // ----- database tools -----
  r.get('/server/db', (req, res) => {
    const f = dbFile(db); const pages = db.prepare('PRAGMA page_count').get().page_count; const size = db.prepare('PRAGMA page_size').get().page_size; const free = db.prepare('PRAGMA freelist_count').get().freelist_count;
    let bytes = null; try { bytes = new Map(db.prepare('SELECT name, SUM(pgsize) b FROM dbstat GROUP BY name').all().map((x) => [x.name, x.b])); } catch { /* not built in */ }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => ({ name, rows: db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c, bytes: bytes ? bytes.get(name) || 0 : null })).sort((a, b) => (b.bytes ?? b.rows) - (a.bytes ?? a.rows));
    let disk = null; try { const st = fs.statfsSync(f ? path.dirname(f) : process.cwd()); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { /* unsupported */ }
    res.json({ file: f ? path.basename(f) : 'memory', size: fsize(f), wal: fsize(f + '-wal'), pages, pageSize: size, reclaimable: free * size, tables, disk, lastOptimized: settings.get('db_optimized', 0) || null });
  });
  r.post('/server/db/optimize', (req, res) => {
    const f = dbFile(db); const before = fsize(f) + fsize(f + '-wal');
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('ANALYZE'); db.exec('PRAGMA optimize'); db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch (e) { return bad(res, `Could not optimise: ${e.message}`, 500); }
    const after = fsize(f) + fsize(f + '-wal'); settings.set('db_optimized', now()); audit(req, 'db_optimize', '', `${before} → ${after} bytes`); res.json({ ok: true, before, after, saved: Math.max(0, before - after) });
  });
  r.post('/server/db/check', (req, res) => {
    const rows = db.prepare('PRAGMA integrity_check').all().map((x) => Object.values(x)[0]); const ok = rows.length === 1 && rows[0] === 'ok';
    audit(req, 'db_check', '', ok ? 'ok' : 'problems found'); res.json({ ok, messages: rows.slice(0, 20) });
  });

  // ----- restore a backup (takes effect at the next restart) -----
  r.post('/backups/:name/restore', (req, res) => {
    if (!NAME_RE.test(req.params.name)) return bad(res, 'Not found', 404); const src = path.join(backupDir(), req.params.name); if (!fs.existsSync(src)) return bad(res, 'Not found', 404);
    if (req.body?.confirm !== 'restore') return bad(res, 'Type restore to confirm.', 400, { code: 'CONFIRM' });
    try { stageRestore(db, src); } catch (e) { return bad(res, e.message); }
    audit(req, 'backup_restore_staged', req.params.name); res.json({ ok: true, staged: req.params.name, canRestart: canRestart() });
  });
  r.delete('/server/restore', (req, res) => { const had = cancelRestore(db); if (had) audit(req, 'backup_restore_cancel'); res.json({ ok: true, cancelled: had }); });

  // ----- logs -----
  r.get('/server/logs', (req, res) => res.json({ lines: readLogs({ level: String(req.query.level || 'all'), q: String(req.query.q || ''), limit: Number(req.query.limit) || 200 }) }));
  r.get('/server/logs.txt', (req, res) => {
    const lines = readLogs({ level: String(req.query.level || 'all'), q: String(req.query.q || ''), limit: 1000 }).reverse(); audit(req, 'logs_download', '', `${lines.length} lines`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="mockdesk-log-${new Date(now()).toISOString().slice(0, 10)}.txt"`);
    res.send(lines.map((l) => `${new Date(l.at).toISOString()} ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join('\n') + '\n');
  });
  r.delete('/server/logs', (req, res) => { clearLogs(); audit(req, 'logs_clear'); res.json({ ok: true }); });

  // ----- release calendar -----
  r.get('/calendar', (req, res) => {
    const t = now(); const ex = new Map(db.prepare('SELECT id, short FROM exams').all().map((e) => [e.id, e.short]));
    const mocks = db.prepare("SELECT id, name, status, kind, exam_id, available_from, live_until FROM mocks WHERE id NOT IN ('practice','pool')").all();
    const events = [];
    for (const m of mocks) {
      const base = { mockId: m.id, title: m.name, exam: ex.get(m.exam_id) || '', status: m.status, kind: m.kind };
      if (m.available_from) events.push({ ...base, type: m.live_until ? 'live-open' : 'mock-open', at: m.available_from, until: m.live_until || null });
      if (m.live_until) events.push({ ...base, type: 'live-close', at: m.live_until });
    }
    try { for (const c of db.prepare("SELECT id, title, send_at, status FROM campaigns WHERE send_at IS NOT NULL AND sent_at IS NULL AND send_at>?").all(t)) events.push({ type: 'message', at: c.send_at, title: c.title, campaignId: c.id }); } catch { /* optional */ }
    try { for (const a of db.prepare('SELECT id, title, text, starts_at, ends_at FROM announcements WHERE active=1 AND starts_at IS NOT NULL AND starts_at>?').all(t - 30 * DAY)) events.push({ type: 'announcement', at: a.starts_at, title: a.title || a.text.slice(0, 60), announcementId: a.id }); } catch { /* optional */ }
    events.sort((a, b) => a.at - b.at);
    res.json({ now: t, events, unscheduled: mocks.filter((m) => !m.available_from && m.status === 'draft').map((m) => ({ id: m.id, name: m.name, status: m.status, exam: ex.get(m.exam_id) || '' })) });
  });

  // ----- one person's data -----
  r.get('/users/:id/export', (req, res) => {
    const out = exportUser(db, Number(req.params.id)); if (!out) return bad(res, 'User not found', 404);
    audit(req, 'user_data_export', out.profile.email || out.profile.phone || String(out.profile.id));
    res.setHeader('Content-Disposition', `attachment; filename="mockdesk-data-${out.profile.id}.json"`); res.json(out);
  });
  r.post('/users/:id/erase', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id)); if (!u) return bad(res, 'User not found', 404);
    if (u.id === req.user.id) return bad(res, 'You cannot erase your own account');
    if (req.body?.confirm !== (u.email || u.phone)) return bad(res, 'Type the person’s email or number to confirm.', 400, { code: 'CONFIRM' });
    const removed = eraseUser(db, u.id); audit(req, 'user_erase', u.email || u.phone, `${Object.values(removed).reduce((a, b) => a + b, 0)} row(s)`); res.json({ ok: true, removed });
  });

  // ----- devices signed in -----
  r.get('/users/:id/sessions', (req, res) => {
    const rows = db.prepare('SELECT id, ip, ua, created_at, expires_at, view_by FROM sessions WHERE user_id=? AND expires_at>? AND view_by IS NULL ORDER BY COALESCE(created_at,0) DESC').all(Number(req.params.id), now());
    res.json({ sessions: rows.map((s) => ({ id: crypto.createHash('sha256').update(s.id).digest('hex').slice(0, 12), ip: s.ip, ua: s.ua, at: s.created_at, expiresAt: s.expires_at })) });
  });
  r.delete('/users/:id/sessions/:sid', (req, res) => {
    const rows = db.prepare('SELECT id FROM sessions WHERE user_id=?').all(Number(req.params.id)); const hit = rows.find((s) => crypto.createHash('sha256').update(s.id).digest('hex').slice(0, 12) === req.params.sid);
    if (!hit) return bad(res, 'That device is already signed out.', 404); db.prepare('DELETE FROM sessions WHERE id=?').run(hit.id); audit(req, 'user_signout_device', String(req.params.id)); res.json({ ok: true });
  });
}
