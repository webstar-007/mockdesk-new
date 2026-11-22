// Automatic reminders. Runs every few minutes from the server (and on demand from the admin page).
import { DEFAULTS } from './settings.js';
const DAY = 86400000; const HOUR = 3600000;
let TZ = '';
/** The clock used for quiet hours, digests and "tomorrow at 10:00". Set from Admin > Settings. */
export const setTimezone = (z) => { TZ = z || ''; };
const tzOf = () => TZ || process.env.MOCKDESK_TZ || 'Asia/Kolkata';
export const reminderConfig = (settings) => { const s = settings.get('reminders', {}); const d = DEFAULTS.reminders; return { ...d, ...s, inactive: { ...d.inactive, ...s.inactive }, welcome: { ...d.welcome, ...s.welcome }, mockSoon: { ...d.mockSoon, ...s.mockSoon }, liveClosing: { ...d.liveClosing, ...s.liveClosing }, unfinished: { ...d.unfinished, ...s.unfinished }, streak: { ...d.streak, ...s.streak }, digest: { ...d.digest, ...s.digest }, events: { ...d.events, ...s.events }, channels: { ...d.channels, ...s.channels } }; };
export const localHour = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tzOf(), hour: '2-digit', hour12: false }).format(t)) % 24;
export const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: tzOf() }).format(t);
const clock = (t) => new Intl.DateTimeFormat('en-IN', { timeZone: tzOf(), hour: 'numeric', minute: '2-digit', hour12: true }).format(t).replace(/\s/g, ' ').toUpperCase();
const dateLabel = (t, now) => { const a = dayKey(t); if (a === dayKey(now)) return 'today'; if (a === dayKey(now + DAY)) return 'tomorrow'; return `on ${new Intl.DateTimeFormat('en-IN', { timeZone: tzOf(), day: 'numeric', month: 'short' }).format(t)}`; };
export const isQuiet = (cfg, t) => { const h = localHour(t); return cfg.quietFrom > cfg.quietTo ? h >= cfg.quietFrom || h < cfg.quietTo : h >= cfg.quietFrom && h < cfg.quietTo; };

export const localWeekday = (t) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tzOf(), weekday: 'short' }).format(t));
const SCALE = Number(process.env.MOCKDESK_TIME_SCALE) > 0 ? Number(process.env.MOCKDESK_TIME_SCALE) : 1;
/** Consecutive practice days ending yesterday or today, from a set of day keys. */
export function streakOf(days, t) { let n = 0; let probe = t; if (!days.has(dayKey(probe))) probe -= DAY; while (days.has(dayKey(probe))) { n++; probe -= DAY; } return n; }

const activeStudents = "COALESCE(u.role,'student')='student' AND COALESCE(u.status,'active')='active'";

/** Work out who should get which reminder now. With dryRun it only counts. */
export async function runReminders({ db, notifier, settings, now, dryRun = false, force = false, extras = [] }) {
  const t = now(); const cfg = reminderConfig(settings); const out = { ran: true, quiet: false, rules: {} };
  if (!force && !dryRun && isQuiet(cfg, t)) return { ran: false, quiet: true, rules: {} };
  const channels = { inapp: true, push: cfg.channels.push, email: cfg.channels.email, whatsapp: cfg.channels.whatsapp !== false };
  const done = (ref) => new Set(db.prepare('SELECT user_id FROM notifications WHERE ref=?').all(ref).map((x) => x.user_id));
  const send = async (rule, kind, list, ref, build) => {
    const have = done(ref); const todo = list.filter((x) => !have.has(x.id));
    out.rules[rule] = (out.rules[rule] || { eligible: 0, sent: 0 }); out.rules[rule].eligible += todo.length;
    if (dryRun) return;
    await notifier.pool(todo, 8, async (u) => { const m = build(u); const r = await notifier.notify(u.id, { kind, ref, channels, ...m }); if (!r.duplicate && !r.skipped) out.rules[rule].sent++; });
  };

  if (cfg.inactive.enabled) {
    const days = Math.max(1, Number(cfg.inactive.days) || 4); const rep = Math.max(1, Number(cfg.inactive.repeatDays) || 7);
    const rows = db.prepare(`SELECT u.id, u.name, MAX(a.started_at) last FROM users u JOIN attempts a ON a.user_id=u.id WHERE ${activeStudents} GROUP BY u.id HAVING last < ? LIMIT 5000`).all(t - days * DAY);
    await send('inactive', 'reminder', rows, `inactive:${Math.floor(t / (rep * DAY))}`, (u) => { const n = Math.floor((t - u.last) / DAY); return { title: `It has been ${n} days since you practised`, body: 'A short practice set on your weak topics keeps you in rhythm. It takes about 20 minutes.', link: '/' }; });
  }
  if (cfg.welcome.enabled) {
    const days = Math.max(1, Number(cfg.welcome.days) || 2);
    const rows = db.prepare(`SELECT u.id, u.name FROM users u WHERE ${activeStudents} AND u.created_at < ? AND u.created_at > ? AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id) LIMIT 5000`).all(new Date(t - days * DAY).toISOString(), new Date(t - 14 * DAY).toISOString());
    await send('welcome', 'reminder', rows, 'welcome', () => ({ title: 'Ready for your first mock?', body: 'One full paper shows you exactly which topics to fix. Pick one when you have a quiet stretch of time.', link: '/' }));
  }
  if (cfg.mockSoon.enabled) {
    for (const h of cfg.mockSoon.hours || []) {
      const mocks = db.prepare("SELECT id, name, available_from FROM mocks WHERE status='published' AND available_from>? AND available_from<=?").all(t, t + h * HOUR);
      if (!mocks.length) continue;
      const rows = db.prepare(`SELECT u.id FROM users u WHERE ${activeStudents} LIMIT 50000`).all();
      for (const m of mocks) await send('mockSoon', 'reminder', rows, `mock_soon:${m.id}:${h}`, () => ({ title: `${m.name} opens ${dateLabel(m.available_from, t)} at ${clock(m.available_from)}`, body: 'Be ready ten minutes early with a charged phone and a steady connection.', link: '/' }));
    }
  }
  if (cfg.liveClosing?.enabled) {
    for (const h of cfg.liveClosing.hours || []) {
      const mocks = db.prepare("SELECT id, name, live_until FROM mocks WHERE status='published' AND live_until>? AND live_until<=? AND (available_from IS NULL OR available_from<=?)").all(t, t + h * HOUR, t);
      for (const m of mocks) {
        const rows = db.prepare(`SELECT u.id FROM users u WHERE ${activeStudents} AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id AND a.mock_id=?) LIMIT 50000`).all(m.id);
        await send('liveClosing', 'reminder', rows, `live_closing:${m.id}:${h}`, () => ({ title: `${m.name} closes ${dateLabel(m.live_until, t)} at ${clock(m.live_until)}`, body: 'Take it any time before then. Ranks come out when the window closes.', link: `/mock/${m.id}` }));
      }
    }
  }
  if (cfg.unfinished?.enabled) {
    const rows = db.prepare(`SELECT a.id aid, a.mock_id, a.segment_index, a.segment_started_at seg, a.snapshot, u.id FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.status='in_progress' AND a.mock_id!='practice' AND ${activeStudents} AND a.segment_started_at>? AND COALESCE(u.last_seen,0)<? LIMIT 1000`).all(t - 6 * HOUR, t - 8 * 60000);
    for (const a of rows) {
      let snap; try { snap = JSON.parse(a.snapshot); } catch { continue; }
      const seg = snap?.segments?.[a.segment_index]; if (!seg) continue;
      const left = Math.floor((a.seg + seg.minutes * 60000 * SCALE - t) / 60000); if (left < 5) continue;
      await send('unfinished', 'reminder', [{ id: a.id }], `unfinished:${a.aid}`, () => ({ title: `${snap.meta?.name || 'Your mock'}: about ${left} min left in this section`, body: 'Your timer is still running. Open the test to carry on from where you stopped.', link: `/mock/${a.mock_id}` }));
    }
  }
  if (cfg.streak?.enabled && localHour(t) >= cfg.streak.hour) {
    const today = dayKey(t); const days = new Map();
    for (const r of db.prepare(`SELECT a.user_id uid, a.started_at s FROM attempts a JOIN users u ON u.id=a.user_id WHERE ${activeStudents} AND a.started_at>?`).all(t - 45 * DAY)) { if (!days.has(r.uid)) days.set(r.uid, new Set()); days.get(r.uid).add(dayKey(r.s)); }
    const rows = []; for (const [uid, set] of days) { if (set.has(today)) continue; const n = streakOf(set, t); if (n >= (cfg.streak.minDays || 3)) rows.push({ id: uid, n }); }
    await send('streak', 'reminder', rows, `streak:${today}`, (u) => ({ title: `Your ${u.n}-day practice streak ends tonight`, body: 'A short practice set keeps it going. Ten questions take about five minutes.', link: '/' }));
  }
  for (const fn of extras) { try { const r = await fn({ cfg, t, dryRun, force, channels }); if (r) out.rules = { ...out.rules, ...r }; } catch (e) { out.rules.error = { eligible: 0, sent: 0, message: String(e.message).slice(0, 120) }; } }
  return out;
}
