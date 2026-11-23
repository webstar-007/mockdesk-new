// v19 alert centre: one place where problems are raised, shown in the admin bell, and (optionally) sent to the admin by email or WhatsApp.
// An alert has a stable key, so the same problem is one alert that updates, not a new one every check. When the cause clears, the alert resolves itself.
import fs from 'node:fs';

const DAY = 86400000;
const RANK = { bad: 0, warn: 1, info: 2 };
export const DEFAULT_ALERT_PREFS = {
  email: true, whatsapp: false, phone: '', emails: [], minLevel: 'bad',
  diskWarnPct: 85, diskBadPct: 92, errorSpike: 5, backupDays: 3, downMinutes: 25,
};

export function cleanAlertPrefs(b = {}, cur = DEFAULT_ALERT_PREFS) {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
  const emails = (Array.isArray(b.emails) ? b.emails : String(b.emails ?? cur.emails.join(',')).split(/[,\s;]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  for (const e of emails) if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error(`“${e}” is not a valid email address`);
  const phone = String(b.phone ?? cur.phone ?? '').replace(/[\s()-]/g, '');
  if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new Error('Enter the WhatsApp number with country code, like +919876543210');
  const minLevel = ['bad', 'warn'].includes(b.minLevel) ? b.minLevel : cur.minLevel;
  const out = {
    email: b.email === undefined ? cur.email : !!b.email, whatsapp: b.whatsapp === undefined ? cur.whatsapp : !!b.whatsapp, phone, emails: emails.slice(0, 10), minLevel,
    diskWarnPct: num(b.diskWarnPct ?? cur.diskWarnPct, 50, 98, 85), diskBadPct: num(b.diskBadPct ?? cur.diskBadPct, 60, 99, 92),
    errorSpike: num(b.errorSpike ?? cur.errorSpike, 2, 200, 5), backupDays: num(b.backupDays ?? cur.backupDays, 1, 30, 3), downMinutes: num(b.downMinutes ?? cur.downMinutes, 15, 240, 25),
  };
  if (out.diskBadPct <= out.diskWarnPct) throw new Error('The “critical” disk level must be higher than the “warning” level');
  return out;
}

export function makeAlerts({ db, now, settings, mailer, whatsapp, notifier, jobs, recentErrors = () => [], extraChecks = [] }) {
  db.exec(`CREATE TABLE IF NOT EXISTS admin_alerts (
    id INTEGER PRIMARY KEY, key TEXT UNIQUE, kind TEXT, level TEXT, title TEXT, body TEXT, link TEXT,
    first_at INTEGER, last_at INTEGER, count INTEGER DEFAULT 1, read_at INTEGER, resolved_at INTEGER, snooze_until INTEGER, sent_at INTEGER, sent_via TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_admin_alerts_open ON admin_alerts(resolved_at, last_at);`);
  const prefs = () => ({ ...DEFAULT_ALERT_PREFS, ...(settings.get('alert_prefs', {}) || {}) });
  const extra = [...extraChecks];
  const outbox = []; // sends in flight, awaited by tests
  const waitSends = () => Promise.all(outbox.splice(0));

  function recipients(p) {
    if (p.emails.length) return p.emails;
    return db.prepare("SELECT email FROM users WHERE role='admin' AND email IS NOT NULL AND email!=''").all().map((x) => x.email);
  }
  async function deliver(row, p = prefs()) {
    const via = []; const site = notifier?.siteName?.() || 'MockDesk';
    const text = `${row.title}\n${row.body || ''}\n\nOpen the admin dashboard to see details.`.trim();
    if (p.email && mailer) { const to = recipients(p); if (to.length) { try { await mailer.send({ to: to.join(','), subject: `[${site}] ${row.title}`, text }); via.push('email'); } catch { /* shown as not sent */ } } }
    if (p.whatsapp && whatsapp && p.phone) { try { await whatsapp.send(p.phone, { title: `${site} alert`, text: `${row.title}. ${row.body || ''}`.slice(0, 600) }); via.push('whatsapp'); } catch { /* shown as not sent */ } }
    if (via.length) db.prepare('UPDATE admin_alerts SET sent_at=?, sent_via=? WHERE id=?').run(now(), via.join(','), row.id);
    return via;
  }
  const wants = (level, p) => (p.minLevel === 'warn' ? level === 'bad' || level === 'warn' : level === 'bad');

  /** Raise or update an alert. Returns the row. New and re-opened alerts are unread and may be sent out. */
  function raise(key, { kind = 'general', level = 'warn', title, body = '', link = '' }) {
    const t = now(); const cur = db.prepare('SELECT * FROM admin_alerts WHERE key=?').get(key); let fresh = false;
    if (!cur) { db.prepare('INSERT INTO admin_alerts(key,kind,level,title,body,link,first_at,last_at) VALUES (?,?,?,?,?,?,?,?)').run(key, kind, level, title, body, link, t, t); fresh = true; }
    else if (cur.resolved_at) { db.prepare('UPDATE admin_alerts SET kind=?, level=?, title=?, body=?, link=?, first_at=?, last_at=?, count=count+1, read_at=NULL, resolved_at=NULL, snooze_until=NULL, sent_at=NULL, sent_via=NULL WHERE id=?').run(kind, level, title, body, link, t, t, cur.id); fresh = true; }
    else {
      const worse = RANK[level] < RANK[cur.level];
      db.prepare('UPDATE admin_alerts SET level=?, title=?, body=?, link=?, last_at=?, count=count+1, read_at=CASE WHEN ? THEN NULL ELSE read_at END WHERE id=?').run(level, title, body, link, t, worse ? 1 : 0, cur.id); fresh = worse && !cur.sent_at;
    }
    const row = db.prepare('SELECT * FROM admin_alerts WHERE key=?').get(key);
    const p = prefs();
    if (fresh && wants(level, p) && (p.email && mailer || p.whatsapp && whatsapp)) outbox.push(deliver(row, p).catch(() => {}));
    return row;
  }
  const resolve = (key) => Number(db.prepare('UPDATE admin_alerts SET resolved_at=?, snooze_until=NULL WHERE key=? AND resolved_at IS NULL').run(now(), key).changes);
  /** Resolve every open alert of a kind whose key is not in `keep`. */
  function resolveKind(kind, keep = []) {
    let n = 0; for (const x of db.prepare('SELECT key FROM admin_alerts WHERE kind=? AND resolved_at IS NULL').all(kind)) if (!keep.includes(x.key)) n += resolve(x.key); return n;
  }
  const visible = (t = now()) => db.prepare('SELECT * FROM admin_alerts WHERE resolved_at IS NULL AND (snooze_until IS NULL OR snooze_until<=?)').all(t)
    .sort((a, b) => RANK[a.level] - RANK[b.level] || b.last_at - a.last_at);
  const shape = (x) => ({ id: x.id, key: x.key, kind: x.kind, level: x.level, title: x.title, body: x.body, link: x.link, firstAt: x.first_at, lastAt: x.last_at, count: x.count, unread: !x.read_at, sentVia: x.sent_via || '', snoozedUntil: x.snooze_until && x.snooze_until > now() ? x.snooze_until : null });
  function list({ all = false } = {}) {
    const t = now(); const items = visible(t).map(shape);
    const out = { items, summary: { total: items.length, unread: items.filter((x) => x.unread).length, bad: items.filter((x) => x.level === 'bad').length, warn: items.filter((x) => x.level === 'warn').length, info: items.filter((x) => x.level === 'info').length } };
    out.snoozed = db.prepare('SELECT COUNT(*) c FROM admin_alerts WHERE resolved_at IS NULL AND snooze_until>?').get(t).c;
    if (all) out.history = db.prepare('SELECT * FROM admin_alerts WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 30').all().map((x) => ({ ...shape(x), resolvedAt: x.resolved_at }));
    return out;
  }
  const markRead = (id) => Number((id === 'all' ? db.prepare('UPDATE admin_alerts SET read_at=? WHERE read_at IS NULL AND resolved_at IS NULL').run(now()) : db.prepare('UPDATE admin_alerts SET read_at=? WHERE id=? AND read_at IS NULL').run(now(), Number(id))).changes);
  const snooze = (id, hours) => Number(db.prepare('UPDATE admin_alerts SET snooze_until=?, read_at=COALESCE(read_at,?) WHERE id=? AND resolved_at IS NULL').run(now() + Math.max(1, Math.min(24 * 30, hours)) * 3600000, now(), Number(id)).changes);

  // ----- the checks -----
  function runChecks() {
    const t = now(); const p = prefs(); const out = [];
    const safe = (name, fn) => { try { fn(); } catch (e) { out.push(`${name}: ${e.message}`); } };

    safe('disk', () => {
      let used = null; try { const st = fs.statfsSync(process.cwd()); used = Math.round(100 - st.bavail / st.blocks * 100); } catch { /* unsupported */ }
      if (used !== null && used >= p.diskWarnPct) raise('disk', { kind: 'disk', level: used >= p.diskBadPct ? 'bad' : 'warn', title: `Disk is ${used}% full`, body: used >= p.diskBadPct ? 'The server may stop saving data soon. Free up space or enlarge the disk.' : 'Free up space soon: delete old backups or logs, or enlarge the disk.', link: 'data' });
      else resolve('disk');
    });
    safe('errors', () => {
      const n = recentErrors().filter((e) => t - e.at < 10 * 60000).length;
      if (n >= p.errorSpike) raise('errors', { kind: 'errors', level: 'bad', title: `${n} server errors in the last 10 minutes`, body: 'Something is failing repeatedly. Open Monitoring to see the messages.', link: 'monitor' });
      else resolve('errors');
    });
    safe('backup', () => {
      const j = jobs?.get?.('backup'); const lastBk = settings.get('backup_last', 0);
      if (j?.lastError) raise('backup-failed', { kind: 'backup', level: 'bad', title: 'The last backup failed', body: j.lastError, link: 'data' });
      else resolve('backup-failed');
      const age = lastBk ? Math.floor((t - lastBk) / DAY) : null;
      if (lastBk ? t - lastBk > p.backupDays * DAY : t - (settings.get('alerts_first', t)) > DAY) raise('backup-stale', { kind: 'backup', level: 'warn', title: lastBk ? `No backup for ${age} days` : 'No backup has been made yet', body: 'Open Data and backup and press “Back up now”, or check that the backup job is not paused.', link: 'data' });
      else resolve('backup-stale');
    });
    safe('jobs', () => {
      const bad = (jobs?.list?.() || []).filter((j) => !j.paused && j.lastError && j.name !== 'backup');
      for (const j of bad) raise(`job:${j.name}`, { kind: 'job', level: 'bad', title: `Background job failed: ${j.label}`, body: j.lastError, link: 'control' });
      resolveKind('job', bad.map((j) => `job:${j.name}`));
      const paused = (jobs?.list?.() || []).filter((j) => j.paused);
      if (paused.length) raise('jobs-paused', { kind: 'jobs-paused', level: 'warn', title: `${paused.length} background job${paused.length > 1 ? 's are' : ' is'} paused`, body: paused.map((j) => j.label).join(', '), link: 'control' }); else resolve('jobs-paused');
    });
    // The server cannot report its own death, but it can notice, on the next run, that it was away. Use the watchdog script for live outage alerts.
    safe('downtime', () => {
      const prev = settings.get('alerts_hb', 0); settings.set('alerts_hb', t); if (!settings.get('alerts_first')) settings.set('alerts_first', t);
      if (prev && t - prev > p.downMinutes * 60000) raise(`down:${prev}`, { kind: 'downtime', level: 'bad', title: `The server was not responding for about ${Math.round((t - prev) / 60000)} minutes`, body: `It stopped checking in at ${new Date(prev).toLocaleString('en-IN')} and has just come back. Check Logs for a crash or restart.`, link: 'server' });
      for (const x of db.prepare("SELECT key, first_at FROM admin_alerts WHERE kind='downtime' AND resolved_at IS NULL").all()) if (t - x.first_at > DAY) resolve(x.key);
    });
    for (const [name, fn] of extra) safe(name, () => fn({ raise, resolve, resolveKind, prefs: p, t }));
    return { ok: !out.length, errors: out };
  }

  return { addCheck: (n, f) => extra.push([n, f]), raise, resolve, resolveKind, list, markRead, snooze, runChecks, prefs, deliver, waitSends, tidy: () => db.prepare('DELETE FROM admin_alerts WHERE resolved_at IS NOT NULL AND resolved_at<?').run(now() - 60 * DAY) };
}
