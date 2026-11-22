// v12 control room: switches, security, live monitoring, background jobs, integrations, bulk actions, config export/import.
import fs from 'node:fs';
import os from 'node:os';
import { cleanControls, controlsOf, FEATURES } from './lib/controls.js';
import { on } from './lib/credentials.js';

const DAY = 86400000;
const SECRET_KEYS = new Set(['secret', 'vapid', 'whatsapp', 'backup_last']);

export function mountControl({ r, db, now, audit, bad, settings, notifier, mailer, creds, live, drafter, otpSender, whatsapp, jobs, metrics, controlsCache, recentErrors }) {
  // ----- switches -----
  r.get('/controls', (req, res) => res.json({ controls: controlsOf(settings), features: FEATURES, yourIp: req.ip }));
  r.put('/controls', (req, res) => {
    let c; try { c = cleanControls(req.body, { myIp: req.ip }); } catch (e) { return bad(res, e.message); }
    const before = controlsOf(settings); settings.set('controls', c); controlsCache.reset();
    if (before.maintenance.mode !== c.maintenance.mode) audit(req, 'maintenance_' + c.maintenance.mode, '', c.maintenance.message.slice(0, 100));
    audit(req, 'controls_update', '', `signups ${c.signups.open ? 'open' : 'closed'}, ${c.blockedIps.length} blocked address(es)`);
    res.json({ controls: c });
  });

  // ----- security: sign-in log, sessions -----
  r.get('/security', (req, res) => {
    const t = now(); const only = req.query.only === 'failed';
    const log = db.prepare(`SELECT l.*, u.name FROM login_log l LEFT JOIN users u ON u.id=l.user_id ${only ? 'WHERE l.ok=0' : ''} ORDER BY l.id DESC LIMIT 100`).all()
      .map((x) => ({ id: x.id, at: x.at, who: x.who, name: x.name || null, ok: !!x.ok, method: x.method, ip: x.ip, ua: x.ua, note: x.note }));
    const failed24 = db.prepare('SELECT COUNT(*) c FROM login_log WHERE ok=0 AND at>?').get(t - DAY).c;
    const ok24 = db.prepare('SELECT COUNT(*) c FROM login_log WHERE ok=1 AND at>?').get(t - DAY).c;
    const noisy = db.prepare('SELECT ip, COUNT(*) n FROM login_log WHERE ok=0 AND at>? AND ip IS NOT NULL GROUP BY ip HAVING n>=5 ORDER BY n DESC LIMIT 10').all(t - DAY);
    const sessions = db.prepare('SELECT COUNT(*) c FROM sessions WHERE expires_at>?').get(t).c;
    const staff = db.prepare("SELECT id,name,email,role,last_seen,last_ip FROM users WHERE role IN ('admin','editor') ORDER BY role, name").all();
    res.json({ log, failed24, ok24, noisy, sessions, staff });
  });
  r.post('/security/sign-out-all', (req, res) => {
    const keepMe = req.body?.includeMe !== true; const roles = req.body?.who === 'students' ? "AND COALESCE(u.role,'student')='student'" : '';
    const n = db.prepare(`DELETE FROM sessions WHERE id IN (SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE 1=1 ${roles} ${keepMe ? 'AND s.user_id!=' + Number(req.user.id) : ''})`).run().changes;
    audit(req, 'sign_out_all', req.body?.who === 'students' ? 'students' : 'everyone', `${n} session(s)`); res.json({ ok: true, signedOut: n });
  });
  r.post('/security/clear-log', (req, res) => { const n = db.prepare('DELETE FROM login_log WHERE at<?').run(now() - 30 * DAY).changes; audit(req, 'login_log_trim', '', `${n} row(s)`); res.json({ ok: true, removed: n }); });

  // ----- live monitoring -----
  r.get('/monitor', (req, res) => {
    const t = now(); const snap = metrics.snapshot(Math.min(240, Math.max(10, Number(req.query.minutes) || 60)));
    const one = (q, ...a) => db.prepare(q).get(...a).c;
    const live = {
      onlineNow: one("SELECT COUNT(*) c FROM users WHERE last_seen>? AND COALESCE(role,'student')='student'", t - 5 * 60000),
      inTest: one("SELECT COUNT(*) c FROM attempts WHERE status='in_progress' AND mock_id!='practice'"),
      signups24: one('SELECT COUNT(*) c FROM users WHERE created_at>?', new Date(t - DAY).toISOString()),
      submits1h: one("SELECT COUNT(*) c FROM attempts WHERE status='submitted' AND submitted_at>?", t - 3600000),
      sessions: one('SELECT COUNT(*) c FROM sessions WHERE expires_at>?', t),
    };
    const mem = process.memoryUsage(); const errs = recentErrors();
    const last = snap.series.slice(-5); const n = last.reduce((a, x) => a + x.n, 0);
    res.json({ at: t, ...snap, live, errorRate5: n ? Math.round(last.reduce((a, x) => a + x.e5, 0) / n * 1000) / 10 : 0, rss: mem.rss, totalMem: os.totalmem(), freeMem: os.freemem(), uptimeSec: Math.round(process.uptime()), errors: errs.slice(0, 8) });
  });
  r.post('/monitor/reset', (req, res) => { metrics.reset(); audit(req, 'metrics_reset'); res.json({ ok: true }); });

  // ----- background jobs -----
  r.get('/jobs', (req, res) => res.json({ jobs: jobs.list() }));
  r.post('/jobs/:name/run', async (req, res) => {
    const j = jobs.get(req.params.name); if (!j) return bad(res, 'Unknown job', 404);
    const out = await jobs.run(req.params.name); audit(req, 'job_run', req.params.name, out.ok ? 'ok' : out.error);
    res.status(out.ok ? 200 : 500).json({ ...out, jobs: jobs.list() });
  });
  r.put('/jobs/:name', (req, res) => { const j = jobs.get(req.params.name); if (!j) return bad(res, 'Unknown job', 404); jobs.setPaused(req.params.name, !!req.body?.paused); audit(req, req.body?.paused ? 'job_pause' : 'job_resume', req.params.name); res.json({ jobs: jobs.list() }); });

  // ----- integrations (what is connected; secrets are never sent) -----
  r.get('/integrations', (req, res) => {
    const env = live.env; const wa = settings.get('whatsapp', {});
    res.json({ items: [
      { key: 'email', name: 'Email (SMTP)', on: on(mailer), detail: on(mailer) ? `${env.SMTP_HOST}:${env.SMTP_PORT || 587}, from ${env.MAIL_FROM || env.SMTP_USER || 'not set'}` : 'Not set. Fill in the form below.', test: true, used: 'Sign-in codes, reminders, digests, broadcasts' },
      { key: 'sms', name: 'SMS sign-in codes', on: !!env.SMS_PROVIDER, detail: env.SMS_PROVIDER ? `Provider: ${env.SMS_PROVIDER}` : 'Not set. Mobile number sign-in is off.', used: 'Mobile number sign-in' },
      { key: 'whatsapp', name: 'WhatsApp', on: !!notifier.hasWhatsApp, detail: notifier.hasWhatsApp ? `Provider: ${notifier.whatsappProvider || wa.provider || 'set'}` : 'Not set. Fill in the form below.', used: 'Reminders and broadcasts by WhatsApp' },
      { key: 'push', name: 'Browser notifications', on: !!notifier.hasPush, detail: notifier.hasPush ? 'Ready. Needs HTTPS in the browser.' : 'Not available', used: 'Push reminders' },
      { key: 'ai', name: 'AI solution drafts', on: on(drafter), detail: `${drafter?.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · ${drafter?.model || 'no key'} · daily cap ${settings.get('ai', {}).dailyCap ?? 'default'}`, used: 'Question solutions in the content tools' },
    ] });
  });
  r.post('/integrations/test-email', async (req, res) => {
    if (!on(mailer)) return bad(res, 'Email is not set up yet. Add the SMTP details above first.'); const to = String(req.body?.to || req.user.email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) return bad(res, 'Enter an email address to send the test to.');
    try { await mailer.send({ to, subject: `Test email from ${notifier.siteName()}`, text: 'Email is working. You can ignore this message.' }); audit(req, 'test_email', to); res.json({ ok: true, to }); }
    catch (e) { res.status(502).json({ error: `Could not send: ${String(e.message || e).slice(0, 200)}` }); }
  });

  // ----- keys and connection details typed in by the admin (encrypted; secrets are never sent back) -----
  r.get('/credentials', (req, res) => res.json({ groups: creds.view() }));
  r.put('/credentials', (req, res) => {
    try { const changed = creds.update(req.body?.values, req.body?.clear); audit(req, 'credentials_update', '', changed.join(', ').slice(0, 200) || 'no change'); res.json({ ok: true, changed, groups: creds.view() }); }
    catch (e) { bad(res, e.message); }
  });
  r.post('/credentials/test/:group', async (req, res) => {
    const to = String(req.body?.to || '').trim(); const g = req.params.group;
    try {
      if (g === 'email') { if (!on(mailer)) return bad(res, 'Email is not set up yet.'); if (!/^\S+@\S+\.\S+$/.test(to)) return bad(res, 'Enter an email address to send the test to.'); await mailer.send({ to, subject: `Test email from ${notifier.siteName()}`, text: 'Email is working. You can ignore this message.' }); return res.json({ ok: true, message: `Test email sent to ${to}` }); }
      if (g === 'sms') { if (!live.env.SMS_PROVIDER) return bad(res, 'Choose an SMS provider first.'); if (!/^\+\d{8,15}$/.test(to)) return bad(res, 'Enter a phone number with country code, like +919876543210.'); await otpSender({ channel: 'sms', to, code: '000000', brand: notifier.siteName() }); return res.json({ ok: true, message: `Test SMS sent to ${to}. The code in it is a test.` }); }
      if (g === 'whatsapp') { if (!on(whatsapp)) return bad(res, 'WhatsApp is not fully set up yet. Check every field for the chosen provider.'); if (!/^\+?\d{8,15}$/.test(to)) return bad(res, 'Enter a phone number with country code.'); await whatsapp.send(to, { title: 'Test message', text: `WhatsApp is working on ${notifier.siteName()}.` }); return res.json({ ok: true, message: `Test message sent to ${to}` }); }
      if (g === 'ai') { if (!on(drafter)) return bad(res, 'Add an AI key first.'); const out = await drafter.ask('Reply with the single word: ready', 20); return res.json({ ok: true, message: `The AI answered: ${String(out).slice(0, 60) || '(empty reply)'}` }); }
      return bad(res, 'Nothing to test for this service.');
    } catch (e) { res.status(502).json({ error: `Test failed: ${String(e.message || e).slice(0, 220)}` }); }
  });

  // ----- what needs attention (powers the dashboard strip) -----
  r.get('/attention', (req, res) => {
    const t = now(); const items = []; const add = (level, text, to) => items.push({ level, text, to });
    const c = controlsOf(settings);
    if (c.maintenance.mode !== 'off') add('bad', c.maintenance.mode === 'hard' ? 'Maintenance mode is ON. Students are locked out.' : 'Maintenance mode is ON. Students cannot start tests or sign up.', 'control');
    if (!c.signups.open) add('warn', 'Sign-ups are closed.', 'control');
    const errs = recentErrors().filter((e) => t - e.at < 3600000).length; if (errs) add('bad', `${errs} server error(s) in the last hour.`, 'monitor');
    const failed = db.prepare('SELECT COUNT(*) c FROM login_log WHERE ok=0 AND at>?').get(t - 3600000).c; if (failed >= 10) add('warn', `${failed} failed sign-ins in the last hour.`, 'security');
    const anomalies = db.prepare("SELECT COUNT(*) c FROM audit WHERE action='anomaly_flag' AND at>?").get(t - DAY).c; void anomalies;
    const lastBk = settings.get('backup_last', 0); if (!lastBk || t - lastBk > 3 * DAY) add('warn', lastBk ? 'No backup in the last 3 days.' : 'No automatic backup has run yet.', 'data');
    const doubts = (() => { try { return db.prepare("SELECT COUNT(*) c FROM doubts WHERE status='open'").get().c; } catch { return 0; } })(); if (doubts) add('info', `${doubts} open student doubt(s).`, 'doubts');
    const paused = jobs.list().filter((j) => j.paused); if (paused.length) add('warn', `${paused.length} background job(s) paused.`, 'control');
    const stale = jobs.list().filter((j) => !j.paused && j.lastError); if (stale.length) add('bad', `Background job failed: ${stale[0].label}.`, 'monitor');
    try { const st = fs.statfsSync(process.cwd()); const pct = st.bavail / st.blocks * 100; if (pct < 15) add('bad', `Disk is ${Math.round(100 - pct)}% full.`, 'system'); } catch { /* unsupported */ }
    res.json({ items });
  });

  // ----- bulk student actions -----
  r.post('/users/bulk', (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))].slice(0, 500);
    const action = req.body?.action; if (!ids.length) return bad(res, 'Pick at least one student.');
    if (!['suspend', 'activate', 'sign-out'].includes(action)) return bad(res, 'Unknown action');
    let done = 0;
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        const u = db.prepare('SELECT id, role FROM users WHERE id=?').get(id); if (!u || u.id === req.user.id || (u.role || 'student') !== 'student') continue;
        if (action === 'sign-out') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        else { db.prepare('UPDATE users SET status=? WHERE id=?').run(action === 'suspend' ? 'suspended' : 'active', id); if (action === 'suspend') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
        done++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(req, 'users_bulk_' + action.replace('-', '_'), `${done} student(s)`); res.json({ ok: true, done, skipped: ids.length - done });
  });

  // ----- settings export / import (move a setup between servers) -----
  r.get('/config/export', (req, res) => {
    const out = {}; for (const row of db.prepare('SELECT key,value FROM settings').all()) { if (SECRET_KEYS.has(row.key)) continue; try { out[row.key] = JSON.parse(row.value); } catch { /* skip */ } }
    audit(req, 'config_export'); res.setHeader('Content-Disposition', 'attachment; filename="mockdesk-settings.json"'); res.json({ app: 'mockdesk', version: 12, exportedAt: new Date(now()).toISOString(), settings: out });
  });
  r.post('/config/import', (req, res) => {
    const b = req.body; if (b?.app !== 'mockdesk' || typeof b.settings !== 'object' || !b.settings) return bad(res, 'This is not a MockDesk settings file.');
    let n = 0; for (const [k, v] of Object.entries(b.settings)) { if (SECRET_KEYS.has(k) || !/^[a-z_]{1,40}$/.test(k)) continue; settings.set(k, v); n++; }
    controlsCache.reset(); audit(req, 'config_import', '', `${n} setting group(s)`); res.json({ ok: true, imported: n });
  });
}
