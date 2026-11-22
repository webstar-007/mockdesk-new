// Weekly digest: one summary per student instead of many small nudges. Sent once, on the day and hour the admin chooses.
import { prefsOf } from './notify.js';
import { dayKey, localHour, localWeekday, streakOf } from './reminders.js';
const DAY = 86400000;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const pctOf = (x) => { const v = Number(x?.summary?.percentage); return Number.isFinite(v) ? v : null; };
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

/** The numbers and the message for one student, or null when they did nothing this week. */
export function buildDigest(db, uid, t, brand = 'MockDesk') {
  const rows = db.prepare("SELECT mock_id, result, submitted_at FROM attempts WHERE user_id=? AND status='submitted' AND submitted_at>? AND result IS NOT NULL").all(uid, t - 14 * DAY);
  const mine = rows.filter((r) => r.submitted_at > t - 7 * DAY); if (!mine.length) return null;
  const tests = mine.filter((r) => r.mock_id !== 'practice'); const practice = mine.length - tests.length;
  const cur = avg(tests.map((r) => pctOf(parse(r.result))).filter((v) => v != null));
  const prev = avg(rows.filter((r) => r.submitted_at <= t - 7 * DAY && r.mock_id !== 'practice').map((r) => pctOf(parse(r.result))).filter((v) => v != null));
  const topics = new Map();
  for (const r of mine) for (const x of parse(r.result)?.topics || []) { if (x.qualifying) continue; const k = `${x.section}:${x.topic}`; const o = topics.get(k) || { topic: x.topic, total: 0, correct: 0 }; o.total += x.total || 0; o.correct += x.correct || 0; topics.set(k, o); }
  const ranked = [...topics.values()].filter((x) => x.total >= 3).map((x) => ({ ...x, pct: Math.round((x.correct / x.total) * 100) })).sort((a, b) => a.pct - b.pct);
  const weak = ranked.length > 1 ? ranked[0] : null; const strong = ranked.length > 1 ? ranked.at(-1) : null;
  const done = new Set(db.prepare("SELECT DISTINCT mock_id FROM attempts WHERE user_id=? AND status='submitted'").all(uid).map((x) => x.mock_id));
  const next = db.prepare("SELECT id, name FROM mocks WHERE status='published' AND id NOT IN ('pool','practice') AND COALESCE(ref_locked,0)=0 AND (available_from IS NULL OR available_from<=?) AND (live_until IS NULL OR live_until>?) ORDER BY number").all(t, t).find((m) => !done.has(m.id));
  const days = new Set(db.prepare('SELECT started_at s FROM attempts WHERE user_id=? AND started_at>?').all(uid, t - 45 * DAY).map((x) => dayKey(x.s))); const streak = streakOf(days, t);
  const lines = [];
  lines.push(`Finished this week: ${tests.length} mock${tests.length === 1 ? '' : 's'}${practice ? ` and ${practice} practice set${practice === 1 ? '' : 's'}` : ''}.`);
  if (cur != null) lines.push(`Average score: ${cur}%${prev != null ? (cur > prev ? ` (up ${cur - prev} points on the week before)` : cur < prev ? ` (down ${prev - cur} points on the week before)` : ' (same as the week before)') : ''}.`);
  if (strong) lines.push(`Strongest topic: ${strong.topic} (${strong.pct}%).`);
  if (weak) lines.push(`Needs work: ${weak.topic} (${weak.pct}%).`);
  if (streak >= 2) lines.push(`Practice streak: ${streak} days.`);
  if (next) lines.push(`Next up: ${next.name}.`);
  return { title: `Your week on ${brand}${cur != null ? `: ${cur}% average` : ''}`, body: lines.join('\n'), stats: { tests: tests.length, practice, avg: cur, prevAvg: prev, weak: weak?.topic || null, strong: strong?.topic || null, streak } };
}

const students = "COALESCE(u.role,'student')='student' AND COALESCE(u.status,'active')='active'";
export function digestRunner({ db, notifier }) {
  return async ({ cfg, t, dryRun, channels }) => {
    const d = cfg.digest; if (!d?.enabled || localWeekday(t) !== d.weekday || localHour(t) < d.hour) return null;
    const ref = `digest:${dayKey(t)}`; const have = new Set(db.prepare('SELECT user_id FROM notifications WHERE ref=?').all(ref).map((x) => x.user_id));
    const ids = db.prepare(`SELECT u.id, u.notify_prefs FROM users u WHERE ${students} AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id AND a.submitted_at>?) LIMIT 20000`).all(t - 7 * DAY).filter((u) => !have.has(u.id) && prefsOf(u).digest !== false);
    const rule = { eligible: ids.length, sent: 0 }; if (dryRun) return { digest: rule };
    await notifier.pool(ids, 8, async (u) => { const m = buildDigest(db, u.id, t, notifier.siteName()); if (!m) { rule.eligible--; return; } const r = await notifier.notify(u.id, { kind: 'digest', ref, title: m.title, body: m.body, link: '/', channels }); if (!r.duplicate && !r.skipped) rule.sent++; });
    return { digest: rule };
  };
}
