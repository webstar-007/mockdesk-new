// v19 admin alert centre: the bell in the top bar, the Alerts page, delivery settings, and the weekly auto-build of mocks.
import { makeAlerts, cleanAlertPrefs, DEFAULT_ALERT_PREFS } from './lib/alerts.js';
import { on } from './lib/credentials.js';

const DAY = 86400000;
export const DEFAULT_AUTOBUILD = { enabled: false, everyDays: 7, examId: '', difficulty: 'moderate', include: 'pool', prefix: 'Weekly mock', mode: 'draft', leadDays: 2, lastRun: 0, lastTry: 0, lastResult: '' };

export function mountAlertCentre({ r, db, now, audit, bad, settings, notifier, mailer, whatsapp, jobs, recentErrors, qx, assign, exams, BUILTIN_ID, runBuild, bust }) {
  const alerts = makeAlerts({ db, now, settings, mailer, whatsapp, notifier, jobs, recentErrors });
  jobs.alerts = alerts; // also reachable for tests and other modules

  // ---- questions that need a second look (from the quality loop) ----
  alerts.addCheck('quality', ({ raise, resolve }) => {
    const list = qx?.alertList?.() || [];
    if (!list.length) return resolve('quality');
    const sev3 = list.filter((x) => x.worst >= 3).length; const nobody = list.filter((x) => x.flags.some((f) => f.key === 'nobody_right')).length; const toppers = list.filter((x) => x.flags.some((f) => f.key === 'toppers_wrong')).length;
    const parts = []; if (nobody) parts.push(`${nobody} that nobody got right`); if (toppers) parts.push(`${toppers} that most toppers got wrong`);
    raise('quality', { kind: 'quality', level: sev3 ? 'bad' : 'warn', title: `${list.length} question${list.length > 1 ? 's' : ''} may need review or replacement`, body: (parts.length ? parts.join(', ') + '. ' : '') + 'Open Question quality to fix the key, replace the question, or mark it reviewed.', link: 'quality' });
  });
  // ---- assignments past due ----
  alerts.addCheck('assignments', ({ raise, resolve }) => {
    const o = assign?.overdue?.() || { assignments: 0, students: 0 };
    if (!o.assignments) return resolve('assign-overdue');
    raise('assign-overdue', { kind: 'assignments', level: 'info', title: `${o.assignments} teacher assignment${o.assignments > 1 ? 's are' : ' is'} past due`, body: `${o.students} student${o.students > 1 ? 's have' : ' has'} not finished. Teachers have been told.`, link: 'assignments' });
  });
  // ---- an auto-built mock stops being an alert once it is published or deleted ----
  alerts.addCheck('autobuild', ({ resolve }) => {
    for (const x of db.prepare("SELECT key FROM admin_alerts WHERE kind='autobuild' AND key LIKE 'autobuild:%' AND resolved_at IS NULL").all()) {
      const m = db.prepare('SELECT status FROM mocks WHERE id=?').get(x.key.slice(10)); if (!m || m.status !== 'draft') resolve(x.key);
    }
  });

  // ---- weekly auto-build ----
  const abOf = () => ({ ...DEFAULT_AUTOBUILD, ...(settings.get('auto_build', {}) || {}) });
  const planFor = (examId) => { const sec = exams.patternFor(examId).sections; return Object.entries(sec).map(([k, v]) => { const n = Number(v.questions) || 0; const e = Math.round(n * 0.4); const h = Math.round(n * 0.2); return { section: k, easy: e, moderate: n - e - h, hard: h }; }); };
  function autoBuild({ force = false } = {}) {
    const c = abOf(); const t = now();
    if (!force && (!c.enabled || t - c.lastRun < c.everyDays * DAY || t - c.lastTry < 6 * 3600000)) return 'Not due yet';
    const examId = c.examId && exams.get(c.examId) ? c.examId : BUILTIN_ID; const number = (db.prepare('SELECT MAX(number) n FROM mocks').get().n || 0) + 1;
    const o = runBuild({ examId, name: `${c.prefix || 'Weekly mock'} ${number}`, difficulty: c.difficulty, include: c.include, plan: planFor(examId), publishAt: c.mode === 'schedule' ? t + c.leadDays * DAY : null }, 'Auto-build');
    if (o.error) {
      const msg = o.code === 409 && o.extra?.shortages ? 'The bank is short: ' + o.extra.shortages.slice(0, 4).map((s) => `${s.section} ${s.difficulty} needs ${s.wanted - s.found} more`).join(', ') : o.error;
      settings.set('auto_build', { ...c, lastTry: t, lastResult: msg });
      alerts.raise('autobuild-short', { kind: 'autobuild', level: 'warn', title: 'The weekly mock could not be built', body: `${msg}. Add questions to the bank, or lower what the auto-build asks for.`, link: 'bank' });
      return msg;
    }
    alerts.resolve('autobuild-short');
    settings.set('auto_build', { ...c, lastRun: t, lastTry: t, lastResult: `Built “${o.n}”${o.scheduled ? ', scheduled' : ''}` });
    audit({ user: { id: null, name: 'Auto-build' }, ip: '' }, 'mock_build', o.n, `${o.picked.length} questions, automatic`);
    alerts.raise(`autobuild:${o.id}`, { kind: 'autobuild', level: 'info', title: o.scheduled ? `“${o.n}” is scheduled to open ${new Date(o.scheduled).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : `“${o.n}” is ready for review`, body: o.scheduled ? 'Built from the question bank. You can still change or unpublish it.' : 'Built from the question bank. Check it, then publish.', link: `mocks/${o.id}` });
    return `Built ${o.n}`;
  }
  jobs.reg('autobuild', 'Weekly mock builder', 'every 10 min (runs when due)', () => autoBuild());
  jobs.reg('alerts', 'Alert checks', 'every 10 min', () => { const o = alerts.runChecks(); alerts.tidy(); if (!o.ok) throw new Error(o.errors[0]); return 'Checked'; });

  // ---- routes ----
  const channels = () => ({ email: on(mailer), whatsapp: on(whatsapp) });
  r.get('/alert-center', (req, res) => res.json({ ...alerts.list({ all: req.query.all === '1' }), prefs: alerts.prefs(), channels: channels() }));
  r.get('/alert-center/summary', (req, res) => { const l = alerts.list(); res.json({ summary: l.summary, items: l.items.slice(0, 6) }); });
  r.post('/alert-center/check', (req, res) => { const o = alerts.runChecks(); res.json({ ...alerts.list(), check: o }); });
  r.post('/alert-center/read', (req, res) => { const id = req.body?.id === 'all' ? 'all' : Number(req.body?.id); if (id !== 'all' && !Number.isInteger(id)) return bad(res, 'Pick an alert'); res.json({ ok: true, changed: alerts.markRead(id) }); });
  r.post('/alert-center/:id/snooze', (req, res) => { const n = alerts.snooze(req.params.id, Number(req.body?.hours) || 24); if (!n) return bad(res, 'Alert not found', 404); res.json({ ok: true }); });
  r.put('/alert-center/prefs', (req, res) => {
    let p; try { p = cleanAlertPrefs(req.body || {}, alerts.prefs()); } catch (e) { return bad(res, e.message); }
    settings.set('alert_prefs', p); audit(req, 'alert_prefs', '', `email ${p.email ? 'on' : 'off'}, whatsapp ${p.whatsapp ? 'on' : 'off'}`); res.json({ prefs: p, channels: channels() });
  });
  r.post('/alert-center/test', async (req, res) => {
    const p = alerts.prefs(); const fake = { id: 0, title: 'Test alert', body: 'If you can read this, alerts will reach you here.' };
    const via = await alerts.deliver(fake, { ...p, email: p.email, whatsapp: p.whatsapp });
    if (!via.length) return bad(res, !on(mailer) && !on(whatsapp) ? 'Email and WhatsApp are not set up yet. Add them under Integrations.' : 'Nothing was sent. Turn on email or WhatsApp above, and check the address or number.');
    res.json({ ok: true, via });
  });
  r.get('/assignments', (req, res) => res.json({ items: assign?.adminList?.() || [] }));
  r.get('/auto-build', (req, res) => res.json({ config: abOf(), defaults: DEFAULT_AUTOBUILD, exams: exams.list ? exams.list().map((x) => ({ id: x.id, name: x.name })) : [] }));
  r.put('/auto-build', (req, res) => {
    const b = req.body || {}; const c = abOf();
    const next = { ...c, enabled: !!b.enabled, everyDays: Math.max(1, Math.min(60, Math.floor(Number(b.everyDays) || c.everyDays))), examId: b.examId && exams.get(b.examId) ? b.examId : '', difficulty: ['easy', 'moderate', 'hard'].includes(b.difficulty) ? b.difficulty : c.difficulty,
      include: b.include === 'all' ? 'all' : 'pool', prefix: String(b.prefix ?? c.prefix).trim().slice(0, 50) || 'Weekly mock', mode: b.mode === 'schedule' ? 'schedule' : 'draft', leadDays: Math.max(1, Math.min(30, Math.floor(Number(b.leadDays) || c.leadDays))) };
    if (next.enabled && !c.enabled) next.lastRun = now(); // first mock comes one interval after switching on, not at once
    settings.set('auto_build', next); audit(req, 'auto_build', next.enabled ? 'on' : 'off', `every ${next.everyDays} days, ${next.mode}`); res.json({ config: next });
  });
  r.post('/auto-build/run', (req, res) => { const msg = autoBuild({ force: true }); res.json({ ok: !/short|enough|Say how|No questions/.test(msg), message: msg, config: abOf() }); });
  void bust; void DEFAULT_ALERT_PREFS;
}
