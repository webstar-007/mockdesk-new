// Event triggers: messages sent because something happened to the student, not because of the clock.
import { prefsOf } from './notify.js';
const DAY = 86400000;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** When a live window closes, tell each student where they ranked. */
export function liveResultsRunner({ db, notifier, board }) {
  return async ({ cfg, t, dryRun, channels }) => {
    if (!cfg.events?.liveResults) return null;
    const rule = { eligible: 0, sent: 0 };
    for (const m of db.prepare("SELECT * FROM mocks WHERE status='published' AND live_until IS NOT NULL AND live_until<? AND live_until>?").all(t, t - 3 * DAY)) {
      const ref = `live_results:${m.id}`; const have = new Set(db.prepare('SELECT user_id FROM notifications WHERE ref=?').all(ref).map((x) => x.user_id));
      const b = board(m); const n = b.list.length;
      const todo = b.list.filter((r) => !have.has(r.user_id) && prefsOf(db.prepare('SELECT notify_prefs FROM users WHERE id=?').get(r.user_id)).events !== false);
      rule.eligible += todo.length; if (dryRun) continue;
      await notifier.pool(todo, 8, async (r) => {
        const beat = n > 1 ? Math.round(((n - r.rank) / (n - 1)) * 100) : 100;
        const o = await notifier.notify(r.user_id, { kind: 'live_results', ref, title: `${m.name} results are out: you ranked ${r.rank} of ${n}`, body: `You scored ${r.score} and beat ${beat}% of the students who took it in the window.`, link: `/live/${m.id}`, channels });
        if (!o.duplicate && !o.skipped) rule.sent++;
      });
    }
    return rule.eligible || rule.sent ? { liveResults: rule } : null;
  };
}

/** After a submit: celebrate a new best score. In-app only, because the student is looking at the result right now. */
export async function personalBest({ db, notifier, cfg, attempt, result }) {
  if (!cfg.events?.personalBest || attempt.mock_id === 'practice') return;
  const u = db.prepare('SELECT notify_prefs FROM users WHERE id=?').get(attempt.user_id); if (prefsOf(u).events === false) return;
  const prev = db.prepare("SELECT result FROM attempts WHERE user_id=? AND status='submitted' AND mock_id!='practice' AND id!=? AND result IS NOT NULL").all(attempt.user_id, attempt.id)
    .map((r) => Number(parse(r.result)?.summary?.percentage)).filter(Number.isFinite);
  const cur = Number(result?.summary?.percentage); if (!prev.length || !Number.isFinite(cur)) return;
  const best = Math.max(...prev); if (cur <= best) return;
  await notifier.notify(attempt.user_id, { kind: 'personal_best', ref: `pb:${attempt.id}`, title: `New personal best: ${cur}%`, body: `Your previous best was ${best}%. Open the analysis to see what moved.`, link: `/results/${attempt.id}`, channels: { push: false, email: false, whatsapp: false }, capped: false });
}
