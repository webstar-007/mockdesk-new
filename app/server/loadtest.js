// v21 load and capacity simulator. Virtual students (temporary accounts) sit a hidden copy of a mock on this very server, going through the
// real HTTP routes: open the test, autosave answers, submit, open the result. Meanwhile we sample CPU, memory, disk and database write time.
// Everything the test creates is removed afterwards.
import fs from 'node:fs';
import os from 'node:os';
import { CLIENT } from './ltclient.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { dbFile } from './lib/restore.js';
import { owned } from './lib/userdata.js';

const SIM = '%@loadtest.invalid';
const HIDDEN = '__loadtest__';
/** Hard ceilings: the most any limit can be raised to. The limits inside them are the admin's to change (Limits panel). */
export const CEIL = { users: 10000, browsers: 10000, durationSec: 86400, warmupSec: 3600, stepCount: 20, customMax: 40 };
export const LIMIT_DEFAULTS = { users: 10000, browsers: 10000, durationSec: 3600, warmupSec: 300, stepCount: 10, customMax: 12 };
export const LIMITS = { users: [1, 10000], durationSec: [5, 3600], saveEverySec: [3, 600], progress: [0, 90], rampSec: [0, 3600], jitter: [0, 80], saveSize: [1, 10], resultPct: [0, 100], pollPct: [0, 100], markPct: [0, 50], submitSpreadPct: [5, 100], errStopPct: [10, 90], browsers: [0, 10000], browsePerMin: [0, 60], browserPerMin: [1, 60], reviewPct: [0, 100], pdfPct: [0, 100], warmupSec: [0, 300], stepCount: [2, 10], integrityPerMin: [0, 60], homePerMin: [0, 60], sectionAtPct: [10, 90], timeoutSec: [2, 120], customMax: 12 };
const LOW = { users: 1, browsers: 1, durationSec: 5, warmupSec: 0, stepCount: 2, customMax: 1 };
/** Set the admin's own maximums (students, length, ...) inside the hard ceilings. Returns the limits now in force. */
export function applyLimits(raw = {}) {
  for (const k of Object.keys(LIMIT_DEFAULTS)) {
    const n = Math.round(Number(raw?.[k])); const v = Number.isFinite(n) ? Math.min(CEIL[k], Math.max(LOW[k], n)) : LIMIT_DEFAULTS[k];
    if (k === 'customMax') LIMITS.customMax = v; else LIMITS[k] = [k === 'browsers' || k === 'warmupSec' ? 0 : LOW[k], v];
  }
  return limitsNow();
}
export const limitsNow = () => Object.fromEntries(Object.keys(LIMIT_DEFAULTS).map((k) => [k, k === 'customMax' ? LIMITS.customMax : LIMITS[k][1]]));
/** Pages a signed-in student opens on their own: [key, label, path]. All are read-only. */
export const PAGES = [['me', 'Profile', '/me'], ['mocks', 'Mock list', '/mocks'], ['announcements', 'Announcements', '/announcements'], ['inbox', 'Inbox', '/inbox'], ['assignments', 'Assignments', '/my/assignments'], ['practice', 'Practice overview', '/practice/overview'], ['stats', 'My stats', '/stats'], ['notebook', 'Notebook', '/notebook'], ['bookmarks', 'Bookmarks', '/bookmarks/ids'], ['errors', 'Error log summary', '/errors/summary'], ['batches', 'My batches', '/my/batches'], ['support', 'Support tickets', '/support'], ['referral', 'Referral', '/referral'], ['config', 'Site settings', '/config']];
const PAGE_KEYS = PAGES.map((x) => x[0]); const DEFAULT_PAGES = ['me', 'mocks', 'announcements', 'inbox', 'assignments', 'practice', 'stats'];
const PATH_OK = /^\/[A-Za-z0-9_\-/.:?=&%,{}]{0,160}$/;
/** Extra requests the admin wants to send. GET works anywhere safe; POST and PUT only inside student areas that clean up after themselves.
 *  {attempt} becomes the student's test id and {question} a random question id from the section they are in. */
const WRITE_OK = /^\/(attempts\/\{attempt\}\/(integrity|errors\/[A-Za-z0-9_\-{}]+)|bookmarks|notebook|practice)(\/|$|\?)/;
export function cleanCustom(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const path = String(x?.path || '').trim(); if (!path) continue;
    if (!PATH_OK.test(path) || path.includes('..') || /^\/(admin|auth|teacher)(\/|$|\?)/i.test(path) || /logout|delete|reset|restore|loadtest/i.test(path)) continue;
    const method = ['GET', 'POST', 'PUT'].includes(String(x?.method || '').toUpperCase()) ? String(x.method).toUpperCase() : 'GET';
    if (method !== 'GET' && !WRITE_OK.test(path)) continue;
    let body = '';
    if (method !== 'GET' && x.body) { body = String(x.body).trim().slice(0, 800); try { const t = JSON.parse(body.replace(/\{(attempt|question)\}/g, 'x')); if (!t || typeof t !== 'object') body = ''; } catch { continue; } }
    if (out.some((o) => o.path === path && o.method === method)) continue;
    out.push({ path, method, body, perMin: clamp(x.perMin, [1, 60], 6) }); if (out.length >= LIMITS.customMax) break;
  }
  return out;
}
const T_DEFAULTS = { enabled: false, p95Ms: 500, errorPct: 1, cpuPct: 80, memPct: 85, submitP95Ms: 2000, writeMs: 150 };
/** The admin's own pass/fail targets for a test. */
export function cleanTargets(t = {}) {
  return { enabled: !!t.enabled, p95Ms: clamp(t.p95Ms, [50, 10000], T_DEFAULTS.p95Ms), errorPct: clamp(t.errorPct, [0, 50], T_DEFAULTS.errorPct), cpuPct: clamp(t.cpuPct, [10, 100], T_DEFAULTS.cpuPct), memPct: clamp(t.memPct, [30, 100], T_DEFAULTS.memPct), submitP95Ms: clamp(t.submitP95Ms, [100, 20000], T_DEFAULTS.submitP95Ms), writeMs: clamp(t.writeMs, [10, 2000], T_DEFAULTS.writeMs) };
}
export function targetsOf(rep) {
  const t = rep.config.targets; if (!t?.enabled) return null; const k = rep.kinds; const main = mainOf(rep);
  const items = [
    { key: 'p95', label: `${main.label} response time (p95)`, limit: t.p95Ms, actual: main.p95, unit: 'ms' },
    { key: 'errors', label: 'Failed requests', limit: t.errorPct, actual: rep.totals.coreErrorPct ?? rep.totals.errorPct, unit: '%' },
    { key: 'cpu', label: 'App processor use (one core, peak)', limit: t.cpuPct, actual: rep.peaks.cpuProc, unit: '%' },
    { key: 'mem', label: 'Server memory used (peak)', limit: t.memPct, actual: rep.peaks.memUsedPct, unit: '%' },
    { key: 'db', label: 'Database write time (peak)', limit: t.writeMs, actual: rep.peaks.writeMs, unit: 'ms' },
  ];
  if (k.submit) items.splice(2, 0, { key: 'submit', label: 'Submit response time (p95)', limit: t.submitP95Ms, actual: k.submit.p95, unit: 'ms' });
  for (const x of items) { x.actual = Math.round(x.actual * 10) / 10; x.pass = x.actual <= x.limit; }
  const failed = items.filter((x) => !x.pass); return { pass: !failed.length && !rep.stopped, passed: items.length - failed.length, total: items.length, stoppedEarly: !!rep.stopped, items };
}
/** For a staircase test: how the server did at each step of "more students". */
export function stepsOf(samples, cfg, startT) {
  if (cfg.pattern !== 'steps') return []; const gap = cfg.rampSec / cfg.stepCount; const live = samples.filter((x) => x.phase === 'running'); const out = [];
  for (let g = 0; g < cfg.stepCount; g++) {
    const from = startT + g * gap; const to = g === cfg.stepCount - 1 ? Infinity : startT + (g + 1) * gap; const w = live.filter((x) => x.t >= from + Math.min(2, gap / 3) && x.t < to && x.users > 0); if (!w.length) continue;
    const reqs = w.reduce((a, x) => a + x.rps, 0); const errs = w.reduce((a, x) => a + x.errors, 0);
    out.push({ step: g + 1, users: Math.max(...w.map((x) => x.users)), p95: Math.max(...w.map((x) => x.p95)), rps: Math.round(reqs / w.length), errorPct: reqs ? Math.round((errs / reqs) * 1000) / 10 : 0, cpu: Math.max(...w.map((x) => x.cpuProc)), seconds: w.length });
  }
  return out;
}
export const PATTERNS = ['steady', 'spike', 'ramp', 'steps', 'waves'];
export const DEFAULTS = { focus: 'exam', signinPerMin: 0, staff: 0, staffPerMin: 6, users: 100, durationSec: 60, saveEverySec: 10, progress: 40, submitAtEnd: true, pattern: 'steady', rampSec: null, jitter: 20, saveSize: 3, resultPct: 70, pollPct: 20, markPct: 10, submitSpreadPct: 18, errStopPct: 40, label: '', mockId: '', browsers: 0, browsePerMin: 0, browserPerMin: 6, reviewPct: 0, pdfPct: 0, pages: DEFAULT_PAGES, custom: [], warmupSec: 0, stepCount: 4, integrityPerMin: 0, homePerMin: 0, sectionMoves: false, sectionAtPct: 50, timeoutSec: 30, targets: T_DEFAULTS };
/** Turn whatever the browser sent into a safe, complete test configuration. */
function parseCore(b = {}) {
  const pattern = PATTERNS.includes(b.pattern) ? b.pattern : 'steady'; const durationSec = clamp(b.durationSec, LIMITS.durationSec, 60);
  const auto = pattern === 'spike' ? 1 : pattern === 'ramp' || pattern === 'steps' ? Math.round(durationSec * 0.8) : pattern === 'waves' ? Math.max(1, Math.round(durationSec * 0.1)) : Math.min(Math.round(durationSec * 0.15), 10);
  const hasRamp = b.rampSec !== null && b.rampSec !== undefined && b.rampSec !== '';
  return { users: clamp(b.users, LIMITS.users, 100), durationSec, saveEverySec: clamp(b.saveEverySec, LIMITS.saveEverySec, 10), progress: clamp(b.progress, LIMITS.progress, 40), submitAtEnd: b.submitAtEnd !== false, mockId: String(b.mockId || ''),
    pattern, rampSec: hasRamp ? Math.min(durationSec, clamp(b.rampSec, LIMITS.rampSec, auto)) : auto, jitter: clamp(b.jitter, LIMITS.jitter, 20), saveSize: clamp(b.saveSize, LIMITS.saveSize, 3), resultPct: clamp(b.resultPct, LIMITS.resultPct, 70), pollPct: clamp(b.pollPct, LIMITS.pollPct, 20),
    markPct: clamp(b.markPct, LIMITS.markPct, 10), submitSpreadPct: clamp(b.submitSpreadPct, LIMITS.submitSpreadPct, 18), errStopPct: clamp(b.errStopPct, LIMITS.errStopPct, 40), browsers: clamp(b.browsers, LIMITS.browsers, 0), browsePerMin: clamp(b.browsePerMin, LIMITS.browsePerMin, 0), browserPerMin: clamp(b.browserPerMin, LIMITS.browserPerMin, 6), reviewPct: clamp(b.reviewPct, LIMITS.reviewPct, 0), pdfPct: clamp(b.pdfPct, LIMITS.pdfPct, 0),
    warmupSec: Math.min(Math.floor(durationSec / 2), clamp(b.warmupSec, LIMITS.warmupSec, 0)), stepCount: clamp(b.stepCount, LIMITS.stepCount, 4), integrityPerMin: clamp(b.integrityPerMin, LIMITS.integrityPerMin, 0), homePerMin: clamp(b.homePerMin, LIMITS.homePerMin, 0), sectionMoves: b.sectionMoves === true, sectionAtPct: clamp(b.sectionAtPct, LIMITS.sectionAtPct, 50), timeoutSec: clamp(b.timeoutSec, LIMITS.timeoutSec, 30), targets: cleanTargets(b.targets),
    pages: Array.isArray(b.pages) ? PAGE_KEYS.filter((k) => b.pages.includes(k)) : DEFAULT_PAGES, custom: cleanCustom(b.custom), label: String(b.label || '').trim().slice(0, 60) };
}
export const FOCUS = ['exam', 'results', 'signin', 'browse', 'practice', 'staff', 'mixed'];
export const FOCUS_NAME = { exam: 'Live exam', results: 'Results rush', signin: 'Sign-in rush', browse: 'Everyday browsing', practice: 'Practice and notebook', staff: 'Admin dashboards', mixed: 'A busy day' };
const EXAM_FOCUS = ['exam', 'results', 'mixed'];
export const ppl = (c) => (c.users || 0) + (c.browsers || 0) + (c.staff || 0);
/** The full test configuration. Besides a live exam it can be a sign-in rush, everyday browsing, admin dashboards or a mix. */
export function parseCfg(b = {}) {
  const focus = FOCUS.includes(b.focus) ? b.focus : 'exam'; const c = parseCore(b);
  c.focus = focus; c.signinPerMin = clamp(b.signinPerMin, [0, 30], 0); c.staff = clamp(b.staff, [0, 300], 0); c.staffPerMin = clamp(b.staffPerMin, [1, 60], 6);
  if (!EXAM_FOCUS.includes(focus)) {
    // no exam to sit: the head count is people using the site
    const n = Number(b.users) > 0 ? Number(b.users) : Math.max(Number(b.browsers) || 0, Number(b.staff) || 0, 1); const people = clamp(n, [1, LIMITS.users[1]], 100);
    c.users = 0; c.submitAtEnd = false; c.sectionMoves = false; c.integrityPerMin = 0;
    if (focus === 'staff') { c.staff = Math.min(300, people); c.browsers = 0; c.signinPerMin = 0; } else { c.browsers = Math.min(LIMITS.browsers[1], people); c.staff = 0; }
    if (focus === 'signin' && !c.signinPerMin) c.signinPerMin = 4;
  }
  return c;
}
const clamp = (v, [lo, hi], d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const MB = 1048576;

function memInfo() {
  try { const t = fs.readFileSync('/proc/meminfo', 'utf8'); const g = (k) => Number((t.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1]) * 1024; const total = g('MemTotal'), avail = g('MemAvailable'); if (total && avail) return { total, avail }; } catch { /* not Linux */ }
  return { total: os.totalmem(), avail: os.freemem() };
}
function cpuTimes() { let idle = 0, tot = 0; for (const c of os.cpus()) { for (const k of Object.keys(c.times)) tot += c.times[k]; idle += c.times.idle; } return { idle, tot }; }
function diskOf(file) {
  try { const s = fs.statfsSync(path.dirname(file)); const total = s.blocks * s.bsize, free = s.bavail * s.bsize; return { total, free, usedPct: total ? r1(((total - free) / total) * 100) : 0 }; } catch { return null; }
}
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };

/** The one response time that best stands for this kind of test. */
export function mainOf(rep) {
  const k = rep.kinds;
  if (k.save) return { label: 'Autosave', p95: k.save.p95 }; if (k.open) return { label: 'Opening the test', p95: k.open.p95 }; if (k.login) return { label: 'Sign-in', p95: k.login.p95 };
  if (rep.pages) return { label: 'Page loading', p95: rep.pages.p95 }; if (rep.admin) return { label: 'Admin pages', p95: rep.admin.p95 };
  return { label: 'Requests', p95: rep.totals.p95 || 0 };
}
export function verdictOf(rep) {
  const save = mainOf(rep); const errPct = rep.totals.coreErrorPct ?? rep.totals.errorPct; const p95 = save.p95;
  let level = 'good', title = 'Comfortable', text = `${save.label} answered in ${Math.round(p95)} ms at the 95th percentile with ${errPct}% errors. The server handled ${ppl(rep.config)} students at once with room to spare.`;
  if (errPct > 5 || p95 > 2000 || rep.stopped === 'safety') { level = 'bad'; title = 'Overloaded'; text = `At ${ppl(rep.config)} students the server slowed down badly (${save.label.toLowerCase()} p95 ${Math.round(p95)} ms, ${errPct}% errors). Students would notice lag or lose saves.`; }
  else if (errPct > 1 || p95 > 800) { level = 'warn'; title = 'Tight'; text = `It coped, but ${save.label.toLowerCase()} p95 reached ${Math.round(p95)} ms (${errPct}% errors). Expect lag on a busier day.`; }
  else if (p95 > 300) { level = 'ok'; title = 'Fine, with little headroom'; text = `${save.label} p95 was ${Math.round(p95)} ms. Fine for ${ppl(rep.config)} students, but do not expect much more on this server.`; }
  return { level, title, text };
}

export function adviceOf(rep) {
  const a = []; const pk = rep.peaks;
  if (pk.cpuProc >= 85) a.push('The app process used most of a CPU core. Node runs on one core, so a larger instance helps only a little. Splitting heavy work (PDF, drafts) away from exam time helps more.');
  if (pk.memUsedPct >= 85) a.push(`Memory reached ${pk.memUsedPct}%. Move to an instance with more RAM before a big exam.`);
  if (pk.diskUsedPct >= 85) a.push(`The disk is ${pk.diskUsedPct}% full. Free up space or enlarge the volume.`);
  if (pk.writeMs >= 150) a.push(`Database writes took up to ${Math.round(pk.writeMs)} ms. Put the database on faster storage (gp3 SSD) and check backups are not running during exams.`);
  if (pk.lagMs >= 250) a.push(`The server stalled for up to ${Math.round(pk.lagMs)} ms at a time. Students see this as a frozen page for a moment.`);
  const sub = rep.kinds.submit; if (sub && sub.p95 > 2500) a.push(`Submitting was slow (p95 ${Math.round(sub.p95)} ms) because everyone finished together. Stagger section end times or live-mock windows.`);
  const res = rep.kinds.result; if (res && res.p95 > 2500) a.push(`Opening results was slow (p95 ${Math.round(res.p95)} ms). Many students looking at results at once is the heaviest part of a test.`);
  const lg = rep.kinds.login; if (lg && lg.p95 > 2500) a.push(`Signing in was slow (p95 ${Math.round(lg.p95)} ms) when many people arrived together. Open live mocks a few minutes early so students sign in before the start, and keep the app on a server with more than one core.`);
  if (rep.admin && rep.admin.p95 > 3000) a.push(`Admin pages were slow (p95 ${Math.round(rep.admin.p95)} ms). Avoid heavy analytics while a live exam runs.`);
  if (rep.pages && rep.pages.p95 > 1500) a.push(`Everyday pages were slow (p95 ${Math.round(rep.pages.p95)} ms). A reverse proxy cache or a bigger instance would help.`);
  if (!a.length) a.push('Nothing needs fixing at this size. To find the limit, run again with more students.');
  return a;
}


const lvl = (v, [a, b, c]) => (v < a ? 'good' : v < b ? 'ok' : v < c ? 'warn' : 'bad');
const PEN = { good: 0, ok: 6, warn: 16, bad: 32 };
const msT = (v) => (v >= 1000 ? `${r1(v / 1000)} s` : `${Math.round(v)} ms`);

/** One row per thing that can go wrong, each with a status and a plain-language meaning. */
export function scorecardOf(rep) {
  const save = mainOf(rep); const pk = rep.peaks; const out = []; const sub = rep.kinds.submit;
  const add = (key, label, value, status, meaning) => out.push({ key, label, value, status, meaning });
  add('speed', `${save.label} speed`, msT(save.p95), lvl(save.p95, [300, 800, 2000]), save.label === 'Autosave' ? 'How long a student waits after the page saves their answers (95 out of 100 saves were faster). Under 300 ms is invisible; over 2 seconds feels broken.' : 'How long people wait for this part of the site (95 out of 100 waits were shorter). Under 300 ms is invisible; over 2 seconds feels broken.');
  if (rep.kinds.login) add('login', 'Sign-in', msT(rep.kinds.login.p95), lvl(rep.kinds.login.p95, [600, 2000, 5000]), 'Signing in checks a password on purpose slowly, so it is the heaviest request a student makes. Slow here means a queue at the start of a live mock.');
  if (rep.admin) add('admin', 'Admin pages', msT(rep.admin.p95), lvl(rep.admin.p95, [800, 2500, 6000]), 'How long dashboards, user lists and analytics took to open for staff while the test ran.');
  const ce = rep.totals.coreErrorPct ?? rep.totals.errorPct;
  add('errors', 'Failed requests', `${ce}%`, ce === 0 ? 'good' : ce < 1 ? 'ok' : ce < 5 ? 'warn' : 'bad', 'Requests that got an error or no answer. Every failed save is an answer a student might lose.');
  if (rep.totals.customErrors) add('custom', 'Pages you added', `${rep.totals.customErrors} failed`, 'warn', 'Some of the extra pages you chose returned errors. That usually means the path is wrong, or the page needs a state the virtual students do not have (for example a submitted test). It does not mean the server is overloaded.');
  if (sub) add('submit', 'Submitting', msT(sub.p95), lvl(sub.p95, [500, 1500, 4000]), 'Time to submit a test while others submit too. This is the moment students are most anxious.');
  if (rep.pages) add('pages', 'Browsing pages', msT(rep.pages.p95), lvl(rep.pages.p95, [400, 1200, 3000]), 'How long dashboard, inbox, mock list and similar pages took while the test ran (95 out of 100 were faster).');
  if (rep.kinds.pdf) add('pdf', 'PDF report download', msT(rep.kinds.pdf.p95), lvl(rep.kinds.pdf.p95, [1500, 4000, 10000]), 'Building a result PDF is one of the heaviest things a student can do. Slow here means many students downloading at once will queue.');
  add('cpu', 'App processor', `${pk.cpuProc}% of one core`, lvl(pk.cpuProc, [60, 80, 95]), 'The app handles requests on one core. Near 100% means it cannot go any faster, however big the server is.');
  add('memory', 'Server memory', `${pk.memUsedPct}% used`, lvl(pk.memUsedPct, [70, 85, 95]), 'If memory runs out the server slows down badly or the app is killed.');
  add('disk', 'Disk space', pk.diskUsedPct ? `${pk.diskUsedPct}% used` : 'unknown', pk.diskUsedPct ? lvl(pk.diskUsedPct, [80, 90, 96]) : 'ok', 'A full disk stops saves and backups.');
  add('db', 'Database writes', msT(pk.writeMs), lvl(pk.writeMs, [50, 150, 500]), 'Time for one small database write at its slowest. Every autosave is a write, and the database does one write at a time.');
  add('pause', 'Server freezes', msT(pk.lagMs), lvl(pk.lagMs, [100, 250, 1000]), 'The longest stretch the server was too busy to answer anyone. Students feel it as a frozen page.');
  return out;
}
/** 0 to 100 for one measured thing: 100 to 85 is green, 85 to 70 fine, 70 to 40 amber, under 40 red. */
const pts = (v, [a, b, c]) => (v < a ? 100 - 15 * (v / a) : v < b ? 85 - 15 * ((v - a) / (b - a)) : v < c ? 70 - 30 * ((v - b) / (c - b)) : Math.max(0, 40 * (1 - (v - c) / c)));
export const bandOf = (sc) => (sc >= 90 ? 'Excellent' : sc >= 75 ? 'Good' : sc >= 50 ? 'Shaky' : 'Poor');
/**
 * The readiness score. It answers one question: how did the people using the site get on?
 * It is the average of the parts that were tested (waits, failures), so a green test is 85 to 100, depending on how far inside the limits it stayed.
 * A red part caps the score at 49, an amber part at 74, a struggling server at 74 and an emergency stop at 25, so the number can never look better than the colours.
 */
export function scoreDetail(rep) {
  const user = rep.areas.filter((x) => x.key !== 'server'); const srv = rep.areas.find((x) => x.key === 'server');
  const mean = user.length ? user.reduce((a, x) => a + x.pts, 0) / user.length : 100; let score = mean; const caps = [];
  const cap = (n, why) => { if (score > n) { score = n; } caps.push({ at: n, why }); };
  const reds = user.filter((x) => x.status === 'bad'); const ambers = user.filter((x) => x.status === 'warn');
  if (reds.length) cap(49, `${reds.map((x) => x.label).join(' and ')} ${reds.length > 1 ? 'were' : 'was'} too slow or failing`); else if (ambers.length) cap(74, `${ambers.map((x) => x.label).join(' and ')} ${ambers.length > 1 ? 'were' : 'was'} slow`);
  if (srv && srv.status === 'bad') cap(74, 'the server ran out of room');
  if (rep.stopped === 'safety') cap(25, 'the safety stop ended the test early');
  score = Math.max(0, Math.round(score)); const people = ppl(rep.config);
  const small = people < 30 || rep.config.durationSec < 30;
  return { score, band: bandOf(score), mean: Math.round(mean), caps, small, parts: user.map((x) => ({ key: x.key, label: x.label, pts: Math.round(x.pts), status: x.status })) };
}
export const scoreOf = (rep) => scoreDetail(rep).score;
/** Everything derived from a finished run, in one place, so older saved results can be brought up to date the same way. */
export function finishReport(rep) {
  rep.focus = rep.config.focus || 'exam'; rep.people = ppl(rep.config); rep.areas = areasOf(rep);
  const d = scoreDetail(rep); rep.score = d.score; rep.scoreWhy = d; rep.scoreV = 2;
  rep.scorecard = scorecardOf(rep); rep.bottleneck = bottleneckOf(rep); rep.plain = plainOf(rep); rep.simple = simpleOf(rep);
  if (rep.verdict) rep.verdict = { ...rep.verdict, level: rep.simple.level, title: rep.simple.title };
  return rep;
}
const BOT = {
  cpu: ['The app processor', 'The app runs on one core and that core got busy first. A bigger instance helps only a little; spreading heavy jobs away from exam time helps more.'],
  mem: ['Server memory', 'Memory filled up first. A server with more RAM is the fix.'],
  disk: ['Disk space', 'Disk space is the first thing to run out. Free up space or enlarge the volume.'],
  db: ['Database writes', 'Database writes got slow first. Every autosave is a write and they happen one at a time, so faster disk storage (gp3 SSD) helps most.'],
  pause: ['Server freezes', 'The server kept freezing for moments. Something heavy blocks it: check backups, reports and PDFs are not running during exams.'],
};
export function bottleneckOf(rep) {
  const pk = rep.peaks; const c = [['cpu', pk.cpuProc / 85], ['mem', pk.memUsedPct / 85], ['disk', (pk.diskUsedPct || 0) >= 93 ? pk.diskUsedPct / 96 : 0], ['db', pk.writeMs / 150], ['pause', pk.lagMs / 250]].sort((a, b) => b[1] - a[1]);
  if (c[0][1] < 0.6) return { key: 'none', title: 'No bottleneck found', text: `Nothing came close to its limit with ${ppl(rep.config)} students. Run a bigger test to find where it starts to struggle.` };
  return { key: c[0][0], title: `${BOT[c[0][0]][0]} is the first thing to give`, text: BOT[c[0][0]][1] };
}
/** The result told as a short story an admin can read without knowing what p95 means. */
export function plainOf(rep) {
  const k = rep.kinds; const a = []; const u = ppl(rep.config);
  if (k.save) a.push(`A student's answers were saved in ${msT(k.save.p50)} usually, and in ${msT(k.save.p95)} or less 95 times out of 100. The slowest save took ${msT(k.save.max)}.`);
  if (k.submit) a.push(`Submitting took ${msT(k.submit.p50)} usually and up to ${msT(k.submit.p95)} for the slower ones, with ${u} students finishing within ${rep.config.submitSpreadPct}% of the test.`);
  if (k.result) a.push(`Opening the result took ${msT(k.result.p50)} usually and up to ${msT(k.result.p95)} for the slower ones.`);
  for (const [kk, v] of Object.entries(k)) if (kk.startsWith('custom:') && v.errors) a.push(`Your page ${kk.slice(7)} failed ${v.errors} of ${v.n} times. Check the path is right and that it works for a signed-in student at that point in the test.`);
  a.push(`The server answered ${rep.totals.requests} requests; at its busiest it handled ${rep.totals.peakRps} in one second. ${rep.totals.errors ? `${rep.totals.errors} of them failed (${rep.totals.errorPct}%).` : 'None of them failed.'}`);
  if (rep.pages) a.push(`Other pages (dashboard, inbox and so on) opened in ${msT(rep.pages.p50)} usually and ${msT(rep.pages.p95)} or less 95 times out of 100, across ${rep.pages.n} page views.`);
  if (k.login) a.push(`Signing in took ${msT(k.login.p50)} usually and up to ${msT(k.login.p95)} for the slower ones (${k.login.n} sign-ins${k.login.errors ? `, ${k.login.errors} failed` : ''}).`);
  if (rep.admin) a.push(`Admin pages opened in ${msT(rep.admin.p50)} usually and ${msT(rep.admin.p95)} or less 95 times out of 100 (${rep.admin.n} page views).`);
  if (k.pdf) a.push(`Downloading the PDF report took ${msT(k.pdf.p50)} usually and up to ${msT(k.pdf.p95)} for the slower ones (${k.pdf.n} downloads).`);
  if (rep.config.browsers) a.push(`${rep.config.browsers} extra students only browsed pages while the others sat the test.`);
  if (rep.moments?.firstSlowAt != null) a.push(`It first became slow (over 800 ms) ${rep.moments.firstSlowAt} seconds in, with about ${rep.moments.firstSlowUsers} students active. That is the point to stay below.`);
  else if (rep.totals.p95 > 0) a.push('It never became slow during the test: response times stayed under 800 ms.');
  if (rep.measuredLimit) a.push(rep.measuredLimit.users > 0 ? `Measured limit: response times stayed healthy up to ${rep.measuredLimit.users} students${rep.measuredLimit.atLeast ? ' (the highest tested, so the real limit is higher)' : ''}.` : 'It struggled even at the first step, so the limit is below the smallest group tested.');
  return a;
}
const ORDER = { good: 0, ok: 1, warn: 2, bad: 3 };
const SAY = {
  signin: ['Students sign in without waiting.', 'Sign-in is quick enough.', 'Sign-in drags when many people arrive together.', 'Sign-in is too slow. Students would retry or give up.'],
  save: ['Answers save instantly.', 'Answers save quickly.', 'Saving lags a little. Students may notice.', 'Saving is too slow. Students could lose answers.'],
  submit: ['Submitting is smooth, even with a rush.', 'Submitting is fine.', 'Submitting slows down in a rush.', 'Submitting is too slow in a rush.'],
  results: ['Results and PDFs open quickly.', 'Results and PDFs are fine.', 'Results and PDFs are slow when many open together.', 'Results and PDFs are too slow in a rush.'],
  browse: ['Pages open instantly.', 'Pages open quickly.', 'Pages feel slow.', 'Pages are too slow.'],
  admin: ['Admin dashboards open quickly.', 'Admin dashboards are fine.', 'Admin dashboards are slow.', 'Admin dashboards are too slow.'],
  reliable: ['Nothing failed.', 'A handful of requests failed.', 'Some requests failed.', 'Many requests failed.'],
  server: ['The server has plenty of room.', 'The server is comfortable.', 'The server is working hard.', 'The server ran out of room.'],
};
/** One simple card per thing that was tested: a status and one plain sentence. Untested things are left out. */
export function areasOf(rep) {
  const k = rep.kinds; const pk = rep.peaks; const out = [];
  const add = (key, icon, label, value, status, p) => out.push({ key, icon, label, value, status, pts: p, say: SAY[key][ORDER[status]] });
  if (k.login) add('signin', '🔑', 'Signing in', msT(k.login.p95), lvl(k.login.p95, [600, 2000, 5000]), pts(k.login.p95, [600, 2000, 5000]));
  if (k.save) add('save', '💾', 'Saving answers', msT(k.save.p95), lvl(k.save.p95, [300, 800, 2000]), pts(k.save.p95, [300, 800, 2000]));
  if (k.submit) add('submit', '📤', 'Submitting', msT(k.submit.p95), lvl(k.submit.p95, [500, 1500, 4000]), pts(k.submit.p95, [500, 1500, 4000]));
  const rs = ['result', 'review', 'pdf'].map((x) => k[x]).filter(Boolean); if (rs.length) { const w = Math.max(...rs.map((x) => x.p95)); add('results', '📊', 'Results and reports', msT(w), lvl(w, [1000, 3000, 8000]), pts(w, [1000, 3000, 8000])); }
  if (rep.pages) add('browse', '🧭', 'Browsing pages', msT(rep.pages.p95), lvl(rep.pages.p95, [400, 1200, 3000]), pts(rep.pages.p95, [400, 1200, 3000]));
  if (rep.admin) add('admin', '🛠️', 'Admin dashboards', msT(rep.admin.p95), lvl(rep.admin.p95, [800, 2500, 6000]), pts(rep.admin.p95, [800, 2500, 6000]));
  const ce = rep.totals.coreErrorPct ?? rep.totals.errorPct; add('reliable', '✅', 'Requests that worked', `${r1(100 - ce)}%`, ce === 0 ? 'good' : ce < 1 ? 'ok' : ce < 5 ? 'warn' : 'bad', ce === 0 ? 100 : ce < 1 ? 85 - 15 * ce : ce < 5 ? 70 - 30 * ((ce - 1) / 4) : Math.max(0, 40 - (ce - 5) * 4));
  const hw = [['cpu', `Processor ${pk.cpuProc}%`, lvl(pk.cpuProc, [60, 80, 95]), pts(pk.cpuProc, [60, 80, 95])], ['mem', `Memory ${pk.memUsedPct}%`, lvl(pk.memUsedPct, [70, 85, 95]), pts(pk.memUsedPct, [70, 85, 95])], ['db', `Database write ${msT(pk.writeMs)}`, lvl(pk.writeMs, [50, 150, 500]), pts(pk.writeMs, [50, 150, 500])], ['pause', `Freeze ${msT(pk.lagMs)}`, lvl(pk.lagMs, [100, 250, 1000]), pts(pk.lagMs, [100, 250, 1000])], ['disk', `Disk ${pk.diskUsedPct}%`, pk.diskUsedPct ? lvl(pk.diskUsedPct, [80, 90, 96]) : 'good', pk.diskUsedPct ? pts(pk.diskUsedPct, [80, 90, 96]) : 100]];
  const wh = hw.reduce((a, x) => (ORDER[x[2]] > ORDER[a[2]] ? x : a), hw[0]); add('server', '🖥️', 'Server health', wh[2] === 'good' ? 'Healthy' : wh[1], wh[2], Math.min(...hw.map((x) => x[3])));
  return out;
}
/** The whole result in a few lines: one verdict, four numbers and up to three things to do. */
export function simpleOf(rep) {
  const d = rep.scoreWhy; const level = d.score >= 75 ? 'good' : d.score >= 50 ? 'warn' : 'bad';
  const n = ppl(rep.config); const what = { exam: 'sitting a live exam', results: 'opening results at once', signin: 'signing in together', browse: 'browsing the site', practice: 'practising', staff: 'using admin dashboards', mixed: 'using the site on a busy day' }[rep.config.focus || 'exam'];
  const title = { Excellent: 'Handled it easily', Good: 'Handled it well', Shaky: 'Handled it, but it struggled', Poor: 'It could not keep up' }[d.band];
  const problems = rep.areas.filter((x) => x.status === 'warn' || x.status === 'bad');
  const text = problems.length ? `With ${n.toLocaleString()} people ${what}, trouble showed up in: ${problems.map((x) => x.label.toLowerCase()).join(', ')}.` : `With ${n.toLocaleString()} people ${what}, every part stayed fast and nothing failed.`;
  const fixes = []; if (rep.bottleneck && rep.bottleneck.key !== 'none') fixes.push(rep.bottleneck.text); for (const a of rep.advice) if (fixes.length < 3 && !fixes.includes(a) && !/^Nothing needs fixing/.test(a)) fixes.push(a);
  const main = mainOf(rep); const numbers = [{ label: 'People simulated', value: n.toLocaleString() }, { label: 'Requests handled', value: rep.totals.requests.toLocaleString() }, { label: 'Failed', value: `${rep.totals.coreErrorPct ?? rep.totals.errorPct}%` }, { label: `${main.label}, typical worst case`, value: msT(main.p95) }];
  // the capacity answer matters more than the score: how many people can it take?
  let room = ''; const cap = rep.measuredLimit && rep.measuredLimit.users > 0 ? rep.measuredLimit.users : rep.estimate;
  if (rep.measuredLimit && rep.measuredLimit.users === 0) room = 'It struggled even with the smallest group.';
  else if (rep.measuredLimit && rep.measuredLimit.users > 0) room = `Stayed healthy up to ${Number(rep.measuredLimit.users).toLocaleString()} people${rep.measuredLimit.atLeast ? ' or more' : ''}.`;
  else if (cap) room = `Rough guess from how hard the processor worked: about ${Number(cap).toLocaleString()} people. Run a bigger test to confirm.`;
  else if (level !== 'bad') room = 'The server barely noticed this load. Run a bigger test to find its limit.';
  const note = d.small ? 'This was a small test. A good result here does not prove it copes with a real crowd. Try a larger group or a longer run.' : '';
  return { level, title, text, room, note, numbers, fixes };
}
const KEYS = ['t', 'rps', 'p95', 'p99', 'inflight', 'errors', 'users', 'cpuProc', 'cpuSys', 'memUsedPct', 'rss', 'writeMs', 'lagMs', 'diskUsedPct'];
export function downsample(samples, max = 90) {
  const pick = samples.length <= max ? samples : samples.filter((_, i) => i % Math.ceil(samples.length / max) === 0 || i === samples.length - 1);
  return pick.map((x) => Object.fromEntries(KEYS.map((k) => [k, x[k]])));
}
/** For a ramp test: latency and errors at each step of "how many students were active". */
export function curveOf(samples) {
  const live = samples.filter((x) => x.phase === 'running' && x.users > 0 && x.rps > 0); if (live.length < 3) return [];
  const top = Math.max(...live.map((x) => x.users)); const step = Math.max(1, Math.ceil(top / 8)); const groups = new Map();
  for (const x of live) { const g = Math.ceil(x.users / step) * step; (groups.get(g) || groups.set(g, []).get(g)).push(x); }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([users, xs]) => { const p = xs.map((x) => x.p95).sort((a, b) => a - b); const reqs = xs.reduce((a, x) => a + x.rps, 0); return { users: Math.min(users, top), p95: r1(p[Math.floor(p.length / 2)]), errorPct: reqs ? r1((xs.reduce((a, x) => a + x.errors, 0) / reqs) * 100) : 0, cpu: r1(xs.reduce((a, x) => a + x.cpuProc, 0) / xs.length), n: xs.length }; });
}
export function limitOf(curve) {
  if (curve.length < 2) return null; let ok = 0; for (const c of curve) { if (c.p95 <= 800 && c.errorPct < 1) ok = c.users; else break; }
  return { users: ok, atLeast: ok === curve[curve.length - 1].users };
}

const M = [ // [key, label, getter, better, unit]
  ['users', 'Students', (r) => ppl(r.config), null, ''], ['save', 'Autosave, 95th percentile', (r) => r.kinds.save?.p95, 'low', 'ms'], ['open', 'Opening the test, 95th percentile', (r) => r.kinds.open?.p95, 'low', 'ms'],
  ['submit', 'Submitting, 95th percentile', (r) => r.kinds.submit?.p95, 'low', 'ms'], ['result', 'Opening the result, 95th percentile', (r) => r.kinds.result?.p95, 'low', 'ms'], ['pages', 'Browsing pages, 95th percentile', (r) => r.pages?.p95, 'low', 'ms'], ['pdf', 'PDF download, 95th percentile', (r) => r.kinds.pdf?.p95, 'low', 'ms'], ['review', 'Review page, 95th percentile', (r) => r.kinds.review?.p95, 'low', 'ms'], ['all99', 'All requests, 99th percentile', (r) => r.totals.p99, 'low', 'ms'],
  ['slowest', 'Slowest request', (r) => r.totals.max, 'low', 'ms'], ['err', 'Failed requests', (r) => r.totals.errorPct, 'low', '%'], ['rps', 'Busiest second', (r) => r.totals.peakRps, 'high', '/s'],
  ['cpu', 'App processor (one core)', (r) => r.peaks.cpuProc, 'low', '%'], ['cpuSys', 'Whole-server processor', (r) => r.peaks.cpuSys, 'low', '%'], ['mem', 'Server memory used', (r) => r.peaks.memUsedPct, 'low', '%'], ['rss', 'App memory', (r) => r.peaks.rssMB, 'low', 'MB'],
  ['db', 'Slowest database write', (r) => r.peaks.writeMs, 'low', 'ms'], ['lag', 'Longest freeze', (r) => r.peaks.lagMs, 'low', 'ms'], ['grow', 'Database growth', (r) => r.dbGrowthMB, 'low', 'MB'], ['score', 'Readiness score', (r) => r.score, 'high', '/100'],
  ['limit', 'Measured limit', (r) => (r.measuredLimit ? r.measuredLimit.users : null), 'high', 'students'],
];
// A change smaller than this is noise, not better or worse.
const FLOOR = { ms: 50, '%': 3, MB: 25, '/s': 3, '/100': 3, students: 5 };
export function compareOf(a, b) {
  const rows = []; let better = 0, worse = 0;
  for (const [key, label, get, dir, unit] of M) {
    const x = get(a), y = get(b); if (x == null && y == null) continue;
    const delta = x != null && y != null ? r1(y - x) : null; const pctv = x != null && y != null && x !== 0 ? r1(((y - x) / Math.abs(x)) * 100) : null;
    let verdict = 'same'; if (dir && delta != null && Math.abs(delta) >= (key === 'err' ? 0.5 : FLOOR[unit] ?? 1) && (pctv == null || Math.abs(pctv) >= 5)) { verdict = (dir === 'low') === (delta < 0) ? 'better' : 'worse'; }
    if (verdict === 'better') better++; if (verdict === 'worse') worse++; rows.push({ key, label, unit, a: x, b: y, delta, pct: pctv, verdict });
  }
  const sameSetup = a.config.users === b.config.users && a.config.durationSec === b.config.durationSec && (a.config.pattern || 'steady') === (b.config.pattern || 'steady');
  const diffs = []; for (const [k, l] of [['users', 'students'], ['durationSec', 'length (s)'], ['pattern', 'traffic shape'], ['saveEverySec', 'autosave every (s)'], ['progress', 'already answered %'], ['submitAtEnd', 'submit at end']]) { const x = a.config[k] ?? DEFAULTS[k], y = b.config[k] ?? DEFAULTS[k]; if (x !== y) diffs.push({ label: l, a: x, b: y }); }
  const sv = rows.find((r) => r.key === 'save'); const lines = [];
  if (sv && sv.a != null && sv.b != null) lines.push(`Autosave got ${Math.abs(sv.pct ?? 0) < 5 ? 'about the same' : sv.pct < 0 ? `${Math.abs(sv.pct)}% faster` : `${sv.pct}% slower`} (${msT(sv.a)} to ${msT(sv.b)}).`);
  const er = rows.find((r) => r.key === 'err'); if (er && er.a !== er.b) lines.push(`Failed requests went from ${er.a}% to ${er.b}%.`);
  const u = rows.find((r) => r.key === 'users'); if (u && u.a !== u.b) lines.push(`The second test had ${u.b > u.a ? 'more' : 'fewer'} students (${u.a} to ${u.b}), so some numbers will naturally be ${u.b > u.a ? 'higher' : 'lower'}.`);
  const headline = better + worse === 0 ? 'The two tests performed about the same.' : better > worse ? `The second test did better on ${better} measures and worse on ${worse}.` : worse > better ? `The second test did worse on ${worse} measures and better on ${better}.` : `Mixed: better on ${better}, worse on ${worse}.`;
  return { rows, better, worse, headline, lines, sameSetup, diffs, caution: sameSetup ? '' : 'The two tests used different setups, so differences may come from the setup, not from the server.' };
}

export function mountLoadTest({ r, db, now, audit, bad, settings, getMock, controls, jobs, hashPw, ltKey, ltRouter }) {
  let cur = null; // the run in progress or the last one finished
  const file = () => dbFile(db);

  // ---- clean up everything a test creates ----
  function cleanup() {
    const where = `SELECT id FROM users WHERE email LIKE '${SIM}'`; db.exec('BEGIN');
    try {
      for (const { table, keys } of owned(db)) { if (table === 'users') continue; db.prepare(`DELETE FROM ${table} WHERE ${keys.map((k) => `${k} IN (${where})`).join(' OR ')}`).run(); }
      db.prepare(`DELETE FROM users WHERE email LIKE '${SIM}'`).run();
      db.prepare('DELETE FROM questions WHERE mock_id=?').run(HIDDEN); db.prepare('DELETE FROM mocks WHERE id=?').run(HIDDEN);
      db.exec('DROP TABLE IF EXISTS loadtest_probe'); db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
  }
  try { cleanup(); } catch { /* first start: nothing to remove */ }

  function pickSource(id) {
    const rows = db.prepare("SELECT id, name FROM mocks WHERE id NOT IN ('practice','pool') AND id!=? ORDER BY (status='published') DESC, number, created_at").all(HIDDEN);
    for (const m of (id ? rows.filter((x) => x.id === id) : rows)) { const g = getMock(m.id); if (g && g.questions.length >= 10) return { row: m, mock: g }; }
    return null;
  }
  let mocksCache = { at: 0, v: [] };
  const mockOptions = () => { if (now() - mocksCache.at < 30000) return mocksCache.v; const v = mockOptionsRaw(); mocksCache = { at: now(), v }; return v; };
  const mockOptionsRaw = () => db.prepare("SELECT id, name, status FROM mocks WHERE id NOT IN ('practice','pool') AND id!=? ORDER BY (status='published') DESC, number, created_at").all(HIDDEN).map((m) => { const g = getMock(m.id); return g && g.questions.length >= 10 ? { id: m.id, name: m.name, questions: g.questions.length } : null; }).filter(Boolean);

  const realFacts = () => { try { const students = db.prepare(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND email NOT LIKE '${SIM}'`).get().c; const batches = db.prepare(`SELECT b.name, COUNT(bm.user_id) n FROM batches b LEFT JOIN batch_members bm ON bm.batch_id=b.id WHERE COALESCE(b.archived,0)=0 GROUP BY b.id ORDER BY n DESC LIMIT 4`).all(); return { students, batches }; } catch { return { students: 0, batches: [] }; } };
  const openFiles = () => { try { const m = fs.readFileSync('/proc/self/limits', 'utf8').match(/Max open files\s+(\d+|unlimited)/); return m ? (m[1] === 'unlimited' ? Infinity : Number(m[1])) : null; } catch { return null; } };
  function info() {
    const f = file(); const d = f ? diskOf(f) : null; const m = memInfo();
    const active = db.prepare(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND last_seen>? AND email NOT LIKE '${SIM}'`).get(now() - 5 * 60000).c;
    const inTest = db.prepare("SELECT COUNT(*) c FROM attempts WHERE status='in_progress' AND mock_id!=?").get(HIDDEN).c;
    return { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || '', totalMem: m.total, availMem: m.avail, disk: d, dbBytes: sizeOf(f), activeStudents: active, inTest, maintenance: controls().maintenance.mode, mocks: mockOptions(), limits: LIMITS, ceil: CEIL, limitDefaults: LIMIT_DEFAULTS, real: realFacts(), node: process.version, platform: `${os.type()} ${os.release()}` };
  }

  // ---- the run ----
  async function execute(run, base) {
    const { cfg } = run; const T0 = performance.now(); const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
    const CAP = 20000; const tot = { req: 0, err: 0, peakRps: 0 }; let inflight = 0; const kinds = {}; const win = { n: 0, err: 0, lat: [] }; let recent = []; const samples = []; const errors = {}; let busy = 0; let warmUntil = 0; const peaks = { cpuProc: 0, cpuSys: 0, rss: 0, heap: 0, memUsedPct: 0, diskUsedPct: 0, writeMs: 0, lagMs: 0, rps: 0 };
    const record = (kind, ms, status, text) => {
      const warm = performance.now() < warmUntil; const k = (kinds[kind] ||= { lat: [], n: 0, err: 0 }); if (!warm) { k.n++; if (k.lat.length < CAP) k.lat.push(ms); else { const j = Math.floor(Math.random() * k.n); if (j < CAP) k.lat[j] = ms; } } win.n++; win.lat.push(ms); tot.req++;
      const bad_ = status < 200 || status >= 400; if (bad_) { win.err++; tot.err++; if (!warm) { k.err++; const key = status === -1 ? 'timeout' : status === -2 ? 'connection failed' : String(status); errors[key] = (errors[key] || 0) + 1; if (/locked|busy/i.test(text || '')) busy++; } }
      recent.push(bad_ ? 1 : 0); if (recent.length > 60) recent.shift();
    };
    const hit = async (kind, method, url, sid, body, raw = false) => {
      const t0 = performance.now(); let status = 0, text = ''; inflight++;
      try { const rs = await fetch(`${base}${raw ? '' : '/api'}${url}`, { method, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json', 'x-loadtest': run.token }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(cfg.timeoutSec * 1000) }); status = rs.status; if (status >= 400) text = (await rs.text()).slice(0, 200); else await rs.arrayBuffer(); }
      catch (e) { status = e?.name === 'TimeoutError' ? -1 : -2; } finally { inflight--; }
      record(kind, performance.now() - t0, status, text); return status;
    };
    let stop = ''; const abort = (why) => { if (!stop) stop = why; };
    run.abort = abort;

    // 1. set up the hidden mock, accounts and attempts
    run.phase = 'setup'; run.note = 'Creating virtual students…';
    const examOn = cfg.users > 0; const src = examOn ? pickSource(cfg.mockId) : null; if (examOn && !src) throw new Error('Create a mock with at least 10 questions first, then run the test.');
    const m = src?.mock; const t = now(); run.token = crypto.randomBytes(8).toString('hex'); if (ltKey) ltKey.token = run.token;
    const segIdx = 0; const seg = examOn ? m.segments[segIdx] : null; const segQs = examOn ? m.questions.filter((q) => seg.sections.includes(q.section)) : []; if (examOn && !segQs.length) throw new Error('That mock has no questions in its first section.');
    const snapshot = !examOn ? '' : JSON.stringify({ meta: { ...m.meta, id: HIDDEN, name: 'Load test (temporary)', status: 'draft' }, questions: m.questions, segments: m.segments, sectionsCfg: m.sectionsCfg, complete: m.complete });
    run.snapshotKB = Math.round(snapshot.length / 1024); const needBytes = snapshot.length * cfg.users * 3 + 200 * MB; const dsk = file() ? diskOf(file()) : null;
    if (dsk && dsk.free < needBytes) throw new Error(`Not enough free disk space for this test. It needs about ${Math.round(needBytes / MB)} MB free and ${Math.round(dsk.free / MB)} MB is available. Try fewer students.`);
    const segMs = examOn ? seg.minutes * 60000 : 0; const need = (cfg.durationSec + 90) * 1000; if (examOn && segMs < need) throw new Error('The first section of that mock is too short to test with. Pick another mock or a shorter test.');
    const segQs2 = examOn && cfg.sectionMoves && m.segments.length > 1 ? m.questions.filter((q) => m.segments[1].sections.includes(q.section)) : null;
    if (segQs2 && (!segQs2.length || m.segments[1].minutes * 60000 < need)) throw new Error('The second section of that mock is too short or empty for a section-change test. Turn that option off or pick another mock.');
    const elapsed = examOn ? Math.min(Math.round((cfg.progress / 100) * segMs * 0.8), segMs - need) : 0;
    if (examOn) db.prepare("INSERT OR REPLACE INTO mocks(id,number,name,difficulty,description,status,tags,source,created_at,updated_at) VALUES (?,?,?,?,?,'draft','[]','admin',?,?)").run(HIDDEN, 9999, 'Load test (temporary)', m.meta.difficulty || 'moderate', 'Created by the load simulator. Removed automatically.', t, t);
    const PW = `lt-${crypto.randomBytes(4).toString('hex')}`; const pwSalt = crypto.randomBytes(8).toString('hex'); const pwHash = cfg.signinPerMin && hashPw ? hashPw(PW, pwSalt) : 'x';
    db.exec('CREATE TABLE IF NOT EXISTS loadtest_probe(id INTEGER PRIMARY KEY, at INTEGER)');
    const students = []; const runId = crypto.randomBytes(3).toString('hex');
    const insU = db.prepare('INSERT INTO users(name,email,salt,hash,role,created_at,last_seen) VALUES (?,?,?,?,?,?,?)'); const insS = db.prepare('INSERT INTO sessions(id,user_id,expires_at,ip,ua,created_at) VALUES (?,?,?,?,?,?)');
    const insA = db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,segment_started_at,started_at,snapshot,responses) VALUES (?,?,?,'in_progress',?,?,?,?,?)");
    const mkUser = (i, browser, staff) => {
      const email = `lt-${runId}-${staff ? 's' : browser ? 'b' : ''}${i}@loadtest.invalid`;
      const uid = Number(insU.run(staff ? `Virtual admin ${i + 1}` : browser ? `Virtual browser ${i + 1}` : `Virtual student ${i + 1}`, email, pwSalt, pwHash, staff ? 'admin' : null, new Date(t).toISOString(), t).lastInsertRowid);
      const sid = crypto.randomBytes(32).toString('hex'); insS.run(sid, uid, t + 3600000, '127.0.0.1', 'loadtest', t);
      if (staff) { students.push({ uid, sid, email, staff: true }); return; }
      if (browser) { students.push({ uid, sid, email, aid: null, browser: true }); return; }
      const resp = {}; for (const q of segQs) if (Math.random() * 100 < cfg.progress) resp[q.id] = { selected: Math.floor(Math.random() * 4), marked: false, visited: true, timeMs: 15000 + Math.floor(Math.random() * 60000) };
      const aid = crypto.randomUUID(); insA.run(aid, uid, HIDDEN, segIdx, t - elapsed, t - elapsed, snapshot, JSON.stringify(resp)); students.push({ uid, sid, email, aid, done: Object.keys(resp).length });
    };
    // in slices, so the site stays responsive while thousands of accounts are created, and so Stop works during setup
    const total = cfg.users + cfg.browsers + cfg.staff; const SLICE = Math.max(25, Math.min(400, Math.floor(40000 / Math.max(10, run.snapshotKB))));
    let made = 0; const setupT0 = performance.now();
    while (made < total) {
      if (stop) throw new Error('You stopped the test during setup.');
      db.exec('BEGIN');
      try { for (let n = 0; n < SLICE && made < total; n++, made++) { if (made < cfg.users) mkUser(made, false); else if (made < cfg.users + cfg.browsers) mkUser(made - cfg.users, true); else mkUser(made - cfg.users - cfg.browsers, false, true); } db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
      run.note = `Creating virtual students: ${made.toLocaleString()} of ${total.toLocaleString()}`; run.setupPct = Math.round((made / total) * 100); await sleep(0);
    }
    run.setupSec = r1((performance.now() - setupT0) / 1000);
    const dbBefore = sizeOf(file()) + sizeOf(`${file()}-wal`);

    // 2. samplers: once a second, resources and the rolling latency
    const probeDel = () => { try { db.prepare('DELETE FROM loadtest_probe').run(); } catch { /* */ } };
    const flags = {}; run.events = []; run.marks = []; run.events.push({ t: 0, text: `Test started: ${cfg.users} students for ${cfg.durationSec} seconds.`, level: 'info' });
    let recov = 0, peakEv = 0, lastPeakAt = -99; let lastCpu = process.cpuUsage(), lastAt = performance.now(), lastSys = cpuTimes(); const cores = os.cpus().length; let lagStrikes = 0;
    const tick = () => {
      const tt = (performance.now() - T0) / 1000; const c = process.cpuUsage(), at = performance.now(); const wall = Math.max(1, at - lastAt);
      const cpuProc = ((c.user - lastCpu.user + (c.system - lastCpu.system)) / 1000 / wall) * 100; lastCpu = c; lastAt = at; // percent of ONE core
      const sy = cpuTimes(); const cpuSys = sy.tot - lastSys.tot ? (1 - (sy.idle - lastSys.idle) / (sy.tot - lastSys.tot)) * 100 : 0; lastSys = sy;
      const mem = memInfo(); const mu = process.memoryUsage(); const dsk2 = file() ? diskOf(file()) : null;
      let writeMs = 0; try { const w0 = performance.now(); db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO loadtest_probe(at) VALUES (?)').run(Date.now()); db.exec('COMMIT'); writeMs = performance.now() - w0; if (Math.random() < 0.2) probeDel(); } catch { try { db.exec('ROLLBACK'); } catch { /* */ } }
      const sorted = win.lat.slice().sort((a, b) => a - b); const lagMs = lag.percentile(99) / 1e6; lag.reset();
      const win0 = win.n; const s = { t: r1(tt), rps: win.n, p50: r1(pct(sorted, 50)), p95: r1(pct(sorted, 95)), errors: win.err, users: run.active, cpuProc: r1(cpuProc), cpuSys: r1(cpuSys), rss: mu.rss, heap: mu.heapUsed, memUsedPct: r1(((mem.total - mem.avail) / mem.total) * 100), memAvail: mem.avail, diskUsedPct: dsk2?.usedPct ?? null, dbBytes: sizeOf(file()) + sizeOf(`${file()}-wal`), writeMs: r1(writeMs), lagMs: r1(lagMs), phase: run.phase, p99: r1(pct(sorted, 99)), inflight };
      tot.peakRps = Math.max(tot.peakRps, s.rps); run.totals = { req: tot.req, err: tot.err, peakRps: tot.peakRps, peakP95: Math.max(run.totals?.peakP95 || 0, s.p95) }; run.errorsLive = errors;
      win.n = 0; win.err = 0; win.lat = []; samples.push(s);
      if (run.phase === 'running' && performance.now() >= warmUntil) { peaks.cpuProc = Math.max(peaks.cpuProc, s.cpuProc); peaks.cpuSys = Math.max(peaks.cpuSys, s.cpuSys); peaks.rss = Math.max(peaks.rss, s.rss); peaks.heap = Math.max(peaks.heap, s.heap); peaks.memUsedPct = Math.max(peaks.memUsedPct, s.memUsedPct); peaks.diskUsedPct = Math.max(peaks.diskUsedPct, s.diskUsedPct || 0); peaks.writeMs = Math.max(peaks.writeMs, s.writeMs); peaks.lagMs = Math.max(peaks.lagMs, s.lagMs); peaks.rps = Math.max(peaks.rps, s.rps); } // set-up of the accounts is not exam load
      run.samples = samples; run.elapsed = r1(tt);
      if (samples.length % 2 === 0) run.kindsLive = Object.fromEntries(Object.entries(kinds).map(([k, v]) => { const so = v.lat.slice().sort((a, b) => a - b); return [k, { n: v.n, errors: v.err, p50: r1(pct(so, 50)), p95: r1(pct(so, 95)) }]; }));
      const once = (k, text, level) => { if (!flags[k]) { flags[k] = 1; run.events.push({ t: r1(tt), text, level }); } };
      if (run.phase === 'running' && performance.now() >= warmUntil) {
        if (s.p95 > 800 && win0 > 2) { once('slow', `Response time passed 800 ms with ${run.active} students active.`, 'warn'); if (run.firstSlow == null) run.firstSlow = { t: r1(tt), users: run.active }; }
        if (s.p95 > 2000) once('crit', `Response time passed 2 seconds with ${run.active} students active.`, 'bad');
        if (s.errors > 0) once('err', `The first failed request appeared with ${run.active} students active.`, 'bad');
      }
      if (s.cpuProc >= 85) once('cpu', 'The app used most of its processor core.', 'warn'); if (s.memUsedPct >= 85) once('mem', 'Server memory passed 85%.', 'warn');
      if (s.lagMs >= 1000) once('lag', `The server froze for ${msT(s.lagMs)}.`, 'bad'); if (s.writeMs >= 150) once('db', `A database write took ${msT(s.writeMs)}.`, 'warn');
      if (cfg.submitAtEnd && run.submitFromAt && performance.now() >= run.submitFromAt) once('wave', 'Submit wave started: students are finishing.', 'info');
      // live feed: milestones, new kinds of errors, recovery, busiest second
      if (run.phase === 'running') {
        const all_ = cfg.users + cfg.browsers + cfg.staff; for (const m_ of [25, 50, 75, 100]) if (run.active >= all_ * (m_ / 100) && all_ >= 8) once(`m${m_}`, m_ === 100 ? `Everyone is active: ${run.active.toLocaleString()} students.` : `${m_}% of students are active (${run.active.toLocaleString()}).`, 'good');
        for (const k_ of Object.keys(errors)) if (!flags[`e:${k_}`]) { flags[`e:${k_}`] = 1; run.events.push({ t: r1(tt), text: `New kind of failure: ${k_}.`, level: 'bad' }); }
        if (flags.slow && s.p95 < 500 && win0 > 2) { recov++; if (recov >= 5 && !flags.recov) { flags.recov = 1; run.events.push({ t: r1(tt), text: 'Response time is back under 500 ms.', level: 'good' }); } } else recov = 0;
        if (s.rps >= 50 && s.rps > peakEv * 1.25 && tt - lastPeakAt > 10) { peakEv = s.rps; lastPeakAt = tt; run.events.push({ t: r1(tt), text: `Busiest second so far: ${s.rps.toLocaleString()} requests.`, level: 'info' }); }
        if (inflight > 1500) once('inflight', `${inflight.toLocaleString()} requests are waiting at once. The server is falling behind.`, 'warn');
        if (run.events.length > 400) run.events.splice(1, run.events.length - 400);
      }
      // safety stops
      const errRate = recent.length >= 30 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
      if (errRate > cfg.errStopPct / 100) abort(`More than ${cfg.errStopPct}% of requests were failing, so the test was stopped to protect the server.`);
      if (s.memAvail < Math.max(120 * MB, mem.total * 0.08)) abort('The server was running out of memory, so the test was stopped.');
      if (s.diskUsedPct != null && s.diskUsedPct > 96) abort('The disk was almost full, so the test was stopped.');
      lagStrikes = s.lagMs > 4000 ? lagStrikes + 1 : 0; if (lagStrikes >= 3) abort('The server stopped responding for several seconds, so the test was stopped.');
    };
    const sampler = setInterval(tick, 1000); tick();

    // 3. the virtual students
    let homeOk = false; if (cfg.homePerMin) { try { const pr = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) }); homeOk = pr.ok; await pr.arrayBuffer(); } catch { /* not served here */ } if (!homeOk) run.events.push({ t: 0, text: 'The home page is not served by this app (a web server in front may serve it), so that action was skipped.', level: 'info' }); }
    run.phase = 'running'; run.note = ''; warmUntil = performance.now() + cfg.warmupSec * 1000; if (cfg.warmupSec) run.marks.push({ t: r1((performance.now() - T0) / 1000 + cfg.warmupSec), label: 'Warm-up over' }); const tEnd = performance.now() + cfg.durationSec * 1000; const ramp = cfg.rampSec * 1000; const submitFrom = tEnd - cfg.durationSec * 1000 * (cfg.submitSpreadPct / 100); run.submitFromAt = submitFrom; const tNow = (performance.now() - T0) / 1000;
    if (ramp > 0) run.marks.push({ t: r1(tNow + cfg.rampSec), label: 'Everyone joined' }); if (cfg.submitAtEnd) run.marks.push({ t: r1(tNow + (submitFrom - performance.now()) / 1000), label: 'Submit wave' });
    run.events.push({ t: r1(tNow), text: cfg.pattern === 'spike' ? 'All students joined at once.' : cfg.pattern === 'steps' ? `Students are joining in ${cfg.stepCount} steps.` : cfg.pattern === 'waves' ? 'First wave of students is joining; a second wave comes halfway.' : cfg.pattern === 'ramp' ? `Students are joining gradually over ${cfg.rampSec} seconds.` : 'Students are joining.', level: 'info' });
    run.active = 0; let finished = 0; run.runStartT = tNow; const nS = students.length; const perStep = Math.ceil(nS / cfg.stepCount);
    const joinDelay = (i) => (cfg.pattern === 'ramp' ? (i / Math.max(1, nS)) * ramp : cfg.pattern === 'steps' ? Math.floor(i / perStep) * (ramp / cfg.stepCount) + Math.random() * 800 : cfg.pattern === 'waves' ? (i < nS * 0.6 ? Math.random() * ramp : cfg.durationSec * 500 + Math.random() * ramp) : Math.random() * ramp);
    if (cfg.pattern === 'steps') for (let g = 1; g < cfg.stepCount; g++) run.marks.push({ t: r1(tNow + (g * ramp) / (cfg.stepCount * 1000)), label: `Step ${g + 1}` });
    if (cfg.pattern === 'waves') run.marks.push({ t: r1(tNow + cfg.durationSec * 0.5), label: 'Second wave' });
    const moveAt = performance.now() + (submitFrom - performance.now()) * (cfg.sectionAtPct / 100);
    const pagePaths = PAGES.filter((x) => cfg.pages.includes(x[0])).map((x) => x[2]);
    /** Something a student does at a steady rate until the test ends, with a little randomness so they do not move in step. */
    const rateLoop = async (perMin, act) => {
      if (!perMin) return;
      while (!stop) { const wait = (60000 / perMin) * (0.5 + Math.random()); if (performance.now() + wait > tEnd - 200) break; await sleep(wait); if (stop) break; await act(); }
    };
    const curQs = (s) => s.qs || segQs;
    const customHit = (c, s) => {
      const q = curQs(s)[Math.floor(Math.random() * curQs(s).length)]; const fill = (x) => x.replace(/\{attempt\}/g, s.aid || '').replace(/\{question\}/g, q?.id || '');
      let body; if (c.method !== 'GET' && c.body) { try { body = JSON.parse(fill(c.body)); } catch { body = {}; } } else if (c.method !== 'GET') body = {};
      return hit(`custom:${c.method === 'GET' ? '' : `${c.method} `}${c.path}`, c.method, fill(c.path), s.sid, body);
    };
    const background = (s, perMin) => Promise.all([
      pagePaths.length ? rateLoop(perMin, () => { const pth = pagePaths[Math.floor(Math.random() * pagePaths.length)]; return hit(`page:${pth}`, 'GET', pth, s.sid); }) : null,
      ...cfg.custom.filter((c) => s.aid || !/\{attempt\}|\{question\}/.test(c.path + c.body)).map((c) => rateLoop(c.perMin, () => customHit(c, s))),
      s.aid && cfg.integrityPerMin ? rateLoop(cfg.integrityPerMin, () => (s.submitted ? null : hit('integrity', 'POST', `/attempts/${s.aid}/integrity`, s.sid, { leaves: (s.leaves = (s.leaves || 0) + 1), fsExits: 0 }))) : null,
      cfg.signinPerMin && s.email ? rateLoop(cfg.signinPerMin, () => hit('login', 'POST', '/auth/login', s.sid, { email: s.email, password: PW, remember: false })) : null,
      homeOk ? rateLoop(cfg.homePerMin, () => hit('home', 'GET', '/', s.sid, undefined, true)) : null,
    ]);
    const ADMIN_PAGES = ['/admin/overview', '/admin/users?size=25', '/admin/attempts?size=25', '/admin/analytics', '/admin/live', '/admin/quality', '/admin/alerts'];
    const student = async (s, i) => {
      await sleep(joinDelay(i)); if (stop) return; run.active++;
      try {
        if (s.staff) { await rateLoop(cfg.staffPerMin, () => { const p = ADMIN_PAGES[Math.floor(Math.random() * ADMIN_PAGES.length)]; return hit(`staff:${p.split('?')[0]}`, 'GET', p, s.sid); }); return; }
        if (cfg.signinPerMin && s.email) await hit('login', 'POST', '/auth/login', s.sid, { email: s.email, password: PW, remember: false });
        if (s.browser) { await background(s, cfg.browserPerMin); return; }
        const bg = background(s, cfg.browsePerMin); let moved = false;
        await hit('open', 'GET', `/attempts/${s.aid}`, s.sid);
        let cum = 0;
        while (!stop && performance.now() < (cfg.submitAtEnd ? submitFrom : tEnd) - 200) {
          const wait = cfg.saveEverySec * 1000 * (1 - cfg.jitter / 100 + Math.random() * 2 * (cfg.jitter / 100)); const limit = cfg.submitAtEnd ? submitFrom : tEnd;
          if (performance.now() + wait > limit - 200) break; // the next save would fall after the end: do not fire it, or every student saves in the same instant
          await sleep(wait);
          if (stop) break;
          if (segQs2 && !moved && performance.now() >= moveAt) { moved = true; await hit('section', 'POST', `/attempts/${s.aid}/segment/submit`, s.sid, { responses: {} }); s.qs = segQs2; cum = 0; }
          const qs = curQs(s); const body = { responses: {}, lastQid: null }; const n = 1 + Math.floor(Math.random() * cfg.saveSize);
          for (let k = 0; k < n; k++) { const q = qs[Math.floor(Math.random() * qs.length)]; cum += 8000 + Math.floor(Math.random() * 30000); body.responses[q.id] = { selected: Math.floor(Math.random() * 4), marked: Math.random() * 100 < cfg.markPct, visited: true, timeMs: cum }; body.lastQid = q.id; }
          await hit('save', 'PUT', `/attempts/${s.aid}/responses`, s.sid, body);
          if (Math.random() * 100 < cfg.pollPct) await hit('poll', 'GET', `/attempts/${s.aid}`, s.sid);
        }
        if (cfg.submitAtEnd && !stop) {
          await sleep(Math.max(0, submitFrom + Math.random() * (tEnd - submitFrom) * 0.9 - performance.now())); if (stop) return;
          s.submitted = true; await hit('submit', 'POST', `/attempts/${s.aid}/submit`, s.sid, { responses: {} });
          if (Math.random() * 100 < cfg.resultPct) await hit('result', 'GET', `/attempts/${s.aid}/result`, s.sid);
          if (Math.random() * 100 < cfg.reviewPct) for (const part of ['result', 'errors', 'tips', 'desk']) await hit('review', 'GET', `/attempts/${s.aid}/${part}`, s.sid);
          if (Math.random() * 100 < cfg.pdfPct) await hit('pdf', 'GET', `/attempts/${s.aid}/report.pdf`, s.sid);
        }
        await bg;
      } finally { run.active--; finished++; }
    };
    const all = students.map((s, i) => student(s, i));
    // wait for the clock, a stop request, or everyone to finish
    await Promise.race([Promise.all(all), (async () => { while (performance.now() < tEnd + 20000 && !stop && finished < students.length) await sleep(250); })()]);
    if (!stop && finished < students.length) await Promise.race([Promise.all(all), sleep(15000)]);
    run.phase = 'cleanup'; run.note = 'Removing the virtual students…'; await sleep(1100); clearInterval(sampler); tick(); lag.disable();

    // 4. report
    const kOut = {}; let nAll = 0, eAll = 0; const lats = [];
    for (const [k, v] of Object.entries(kinds)) { const s = v.lat.slice().sort((a, b) => a - b); nAll += v.n; eAll += v.err; for (const x of v.lat) lats.push(x); kOut[k] = { n: v.n, errors: v.err, p50: r1(pct(s, 50)), p95: r1(pct(s, 95)), p99: r1(pct(s, 99)), max: r1(s[s.length - 1] || 0), avg: r1(s.reduce((a, b) => a + b, 0) / (s.length || 1)) }; }
    const pageLat = Object.entries(kinds).filter(([k]) => k.startsWith('page:')).flatMap(([, v]) => v.lat).sort((a, b) => a - b); const pagesOut = pageLat.length ? { n: pageLat.length, p50: r1(pct(pageLat, 50)), p95: r1(pct(pageLat, 95)), max: r1(pageLat[pageLat.length - 1]) } : null;
    lats.sort((a, b) => a - b); const staffLat = Object.entries(kinds).filter(([k]) => k.startsWith('staff:')).flatMap(([, v]) => v.lat).sort((a, b) => a - b); const dbAfter = Math.max(...samples.map((x) => x.dbBytes), dbBefore);
    const rep = {
      id: run.id, at: run.startedAt, config: cfg, stopped: stop ? (run.userStop ? 'user' : 'safety') : '', stopReason: stop, durationSec: r1((performance.now() - T0) / 1000),
      totals: { customErrors: Object.entries(kinds).filter(([k]) => k.startsWith('custom:')).reduce((a, [, v]) => a + v.err, 0), coreErrorPct: (() => { let n = 0, e = 0; for (const [k, v] of Object.entries(kinds)) if (!k.startsWith('custom:')) { n += v.n; e += v.err; } return n ? r1((e / n) * 100) : 0; })(), requests: nAll, errors: eAll, errorPct: nAll ? r1((eAll / nAll) * 100) : 0, p50: r1(pct(lats, 50)), p95: r1(pct(lats, 95)), p99: r1(pct(lats, 99)), max: r1(lats[lats.length - 1] || 0), peakRps: peaks.rps, avgRps: r1(nAll / Math.max(1, cfg.durationSec)), busy },
      kinds: kOut, pages: pagesOut, admin: staffLat.length ? { n: staffLat.length, p50: r1(pct(staffLat, 50)), p95: r1(pct(staffLat, 95)), max: r1(staffLat[staffLat.length - 1]) } : null, errors, peaks: { ...peaks, rssMB: Math.round(peaks.rss / MB), heapMB: Math.round(peaks.heap / MB) }, dbGrowthMB: r1((dbAfter - dbBefore) / MB), snapshotKB: run.snapshotKB,
      server: { cpus: cores, totalMem: memInfo().total, node: process.version, mock: src?.row.name || '' },
    };
    rep.label = cfg.label; rep.verdict = verdictOf(rep); rep.advice = adviceOf(rep); rep.events = run.events; rep.marks = run.marks;
    run.events.push({ t: r1((performance.now() - T0) / 1000), text: stop ? 'Test ended early.' : 'Test finished.', level: 'info' });
    rep.moments = { firstSlowAt: run.firstSlow ? r1(run.firstSlow.t - (run.marks[0] ? 0 : 0)) : null, firstSlowUsers: run.firstSlow?.users ?? null };
    const live = samples.filter((x) => x.phase === 'running' && x.rps > 0); const worst = live.reduce((m, x) => (x.p95 > (m?.p95 ?? -1) ? x : m), null); rep.moments.slowestAt = worst ? worst.t : null; rep.moments.slowestP95 = worst ? worst.p95 : null; rep.moments.slowestUsers = worst ? worst.users : null;
    rep.baseline = { rssMB: Math.round((samples[0]?.rss || 0) / MB) }; const climbs = cfg.pattern === 'ramp' || cfg.pattern === 'steps'; rep.curve = climbs ? curveOf(samples) : []; rep.measuredLimit = climbs ? limitOf(rep.curve) : null;
    rep.steps = stepsOf(samples, cfg, run.runStartT || 0); rep.targets = targetsOf(rep);
    // a rough ceiling from how much of one core the app used
    const base_ = Math.max(1, rep.peaks.cpuProc); const heads = ppl(cfg); rep.estimate = rep.stopped === 'safety' ? Math.max(1, Math.floor(heads * 0.6)) : base_ < 8 ? null : Math.floor(heads * Math.min(2.5, 70 / base_));
    rep.samples = downsample(samples); rep.events = run.events; finishReport(rep);
    return rep;
  }

  const summary = (rep) => ({ id: rep.id, at: rep.at, label: rep.label || '', note: rep.note || '', pinned: !!rep.pinned, hasReport: true, users: ppl(rep.config), durationSec: rep.config.durationSec, pattern: rep.config.pattern || 'steady', p95: mainOf(rep).p95, errorPct: rep.totals.errorPct, peakCpu: rep.peaks.cpuProc, peakMem: rep.peaks.memUsedPct, level: rep.verdict.level, title: rep.verdict.title, stopped: rep.stopped, estimate: rep.estimate, targets: rep.targets ? { pass: rep.targets.pass, passed: rep.targets.passed, total: rep.targets.total } : null, score: rep.score ?? null, limit: rep.measuredLimit?.users ?? null });
  const upgrade = (x) => (x.scoreV === 2 ? x : (x.kinds && x.peaks && x.totals ? finishReport(x) : x));
  const reports = () => settings.get('loadtest_reports', []).map(upgrade);
  const saveReports = (list) => { const keep = []; let free = 15; for (const x of list) { if (x.pinned) keep.push(x); else if (free-- > 0) keep.push(x); } settings.set('loadtest_reports', keep); };
  const legacy = () => settings.get('loadtests', []).map((x) => ({ ...x, hasReport: false, label: x.label || '', pinned: false }));
  const history = () => { const rs = reports(); const ids = new Set(rs.map((x) => x.id)); return [...rs.map(summary), ...legacy().filter((x) => !ids.has(x.id))].sort((a, b) => b.at - a.at); };
  const presets = () => settings.get('loadtest_presets', []);
  const find = (id) => reports().find((x) => x.id === id);

  // ---- check a configuration before anything is created ----
  const isRunning = () => !!cur && !['done', 'failed'].includes(cur.phase);
  function preflight(cfg) {
    const blockers = []; const warnings = []; const src = cfg.users > 0 ? pickSource(cfg.mockId) : null;
    if (isRunning()) blockers.push('A test is already running.');
    if (remote.state === 'running') blockers.push('A test from your laptop is running. Wait for it to finish.');
    if (controls().maintenance.mode !== 'off') blockers.push('Maintenance mode is on. Turn it off first or the virtual students are blocked.');
    let snapKB = 0; let sections = 1;
    if (cfg.users > 0 && !src) blockers.push('Create a mock with at least 10 questions first, then run the test.');
    else if (src) {
      const m = src.mock; sections = m.segments.length; const need = (cfg.durationSec + 90) * 1000;
      snapKB = Math.round(JSON.stringify({ meta: m.meta, questions: m.questions, segments: m.segments, sectionsCfg: m.sectionsCfg }).length / 1024);
      if (m.segments[0].minutes * 60000 < need) blockers.push(`The first section of "${src.row.name}" lasts ${m.segments[0].minutes} minutes, which is too short for a ${cfg.durationSec}-second test. Pick another mock or a shorter test.`);
      if (cfg.sectionMoves) { if (m.segments.length < 2) warnings.push(`"${src.row.name}" has only one section, so "move to the next section" will be skipped.`); else if (m.segments[1].minutes * 60000 < need) blockers.push('The second section of that mock is too short for this test length.'); }
      const dsk = file() ? diskOf(file()) : null; const needMB = Math.round((snapKB * 1024 * cfg.users * 3) / MB + 200);
      if (dsk && dsk.free < needMB * MB) blockers.push(`Not enough free disk space. The test needs about ${needMB} MB free and ${Math.round(dsk.free / MB)} MB is available. Try fewer students.`);
    }
    const inf = info();
    if (inf.activeStudents > 0) warnings.push(`${inf.activeStudents} real student${inf.activeStudents > 1 ? 's were' : ' was'} active in the last 5 minutes. They may notice slowness.`);
    if (inf.inTest > 0) warnings.push(`${inf.inTest} real student${inf.inTest > 1 ? 's are' : ' is'} sitting a test right now. Do not run a heavy test during an exam.`);
    if (ppl(cfg) >= 600) warnings.push('This is a very large test. Watch the first seconds and press Stop if the site feels frozen.');
    if (cfg.durationSec >= 300) warnings.push('Long tests keep the server busy for a while. Run them at a quiet time.');
    if (cfg.custom.some((c) => c.method !== 'GET')) warnings.push('Your custom requests include POST or PUT. They only write data owned by the virtual students, which is removed afterwards.');
    const dur = cfg.durationSec; const per = dur / cfg.saveEverySec; const sub = cfg.submitAtEnd ? 1 + (cfg.resultPct + cfg.reviewPct * 4 + cfg.pdfPct) / 100 : 0;
    const browse = (cfg.users * cfg.browsePerMin * dur) / 60 * (cfg.pages.length ? 1 : 0) + (cfg.browsers * cfg.browserPerMin * dur) / 60 * (cfg.pages.length ? 1 : 0);
    const custom = cfg.custom.reduce((a, c) => a + c.perMin, 0) * (dur / 60) * cfg.users; const extra = (cfg.users * cfg.integrityPerMin * dur) / 60 + ((cfg.users + cfg.browsers) * cfg.homePerMin * dur) / 60;
    const signinReq = ((cfg.users + cfg.browsers) * cfg.signinPerMin * dur) / 60 + (cfg.signinPerMin ? cfg.users + cfg.browsers : 0); const staffReq = (cfg.staff * cfg.staffPerMin * dur) / 60;
    if (cfg.signinPerMin) warnings.push('Each sign-in runs a real password check, which is deliberately slow. This tests the heaviest thing students do, so expect high CPU. If your abuse rules do not trust 127.0.0.1, the test traffic may be throttled.');
    if (cfg.staff) warnings.push('Virtual admin accounts exist only while the test runs and are deleted afterwards. They only open read-only dashboard pages.');
    const requests = Math.round((cfg.users ? cfg.users * (1 + per * (1 + cfg.pollPct / 100) + sub + (cfg.sectionMoves && sections > 1 ? 1 : 0)) : 0) + browse + custom + extra + signinReq + staffReq);
    const total = ppl(cfg); const of_ = openFiles(); const m_ = memInfo();
    const genMB = Math.round(total * 0.05 + 80); if (genMB * MB > m_.avail * 0.5) warnings.push(`Simulating ${total.toLocaleString()} students needs roughly ${genMB} MB of memory and about half of what is free (${Math.round(m_.avail / MB)} MB). The server could run low.`);
    if (of_ && total * 1.2 > of_) warnings.push(`This server allows ${of_.toLocaleString()} open connections at once, fewer than the ${total.toLocaleString()} students. Some will fail to connect. Raise the open-files limit (ulimit -n) or use fewer students.`);
    const setupSec = Math.round(total * (0.0004 + snapKB / 400000) * 10) / 10; if (setupSec > 20) warnings.push(`Creating ${total.toLocaleString()} virtual students takes about ${setupSec > 90 ? Math.round(setupSec / 60) + ' minutes' : Math.round(setupSec) + ' seconds'} before the test starts.`);
    const rps = Math.round(requests / Math.max(1, dur)); if (rps > 1500) warnings.push(`About ${rps} requests a second is more than one test generator on this server can send reliably. The numbers will look worse than real life.`);
    return { ok: !blockers.length, blockers, warnings, est: { requests, rps, setupSec, genMB, openFiles: of_, snapshotKB: snapKB, dbMB: Math.round((snapKB * cfg.users * 1.1) / 1024), seconds: dur + 15, sections, sharedCpuNote: 'The test runs on the server it measures, so it uses some of its processor. Real students arrive from outside, so real life is a little lighter than the test.' } };
  }
  r.post('/loadtest/preflight', (req, res) => { const cfg = parseCfg(req.body || {}); res.json({ config: cfg, ...preflight(cfg) }); });
  // a light status call for the page to poll while a test runs: no database or mock work, so the check does not disturb the test
  r.get('/loadtest/live', (req, res) => {
    const run = cur && { id: cur.id, phase: cur.phase, note: cur.note, config: cur.cfg, elapsed: cur.elapsed || 0, active: cur.active || 0, samples: (cur.samples || []).slice(-150), events: cur.events || [], marks: cur.marks || [], kinds: cur.kindsLive || {}, totals: cur.totals || null, errors: cur.errorsLive || {}, setupPct: cur.setupPct ?? null, setupSec: cur.setupSec ?? null, stopping: !!cur.stopping, error: cur.error || '', report: cur.report || null, startedAt: cur.startedAt };
    res.json({ run });
  });
  // how fast the server can sign students in, the part of an exam start that real traffic stresses most
  r.post('/loadtest/signin-bench', async (req, res) => {
    if (isRunning()) return bad(res, 'A test is running. Wait for it to finish.', 409); if (!hashPw) return bad(res, 'Not available on this server.', 501);
    const n = clamp(req.body?.count, [5, 60], 20); const salt = crypto.randomBytes(16).toString('hex'); const one = []; const t0 = performance.now();
    for (let i = 0; i < n; i++) { const a = performance.now(); hashPw(`bench-${i}`, salt); one.push(performance.now() - a); }
    const syncTotal = performance.now() - t0; await sleep(80);
    const lag = monitorEventLoopDelay({ resolution: 5 }); lag.enable(); const b0 = performance.now();
    await Promise.all(Array.from({ length: n }, (_, i) => new Promise((ok, no) => crypto.scrypt(`bench-${i}`, salt, 64, (e, k) => (e ? no(e) : ok(k))))));
    const poolTotal = performance.now() - b0; const lagMax = lag.max / 1e6; lag.disable();
    const sorted = one.slice().sort((a, b) => a - b); const avg = syncTotal / n; const poolPerSec = (n / poolTotal) * 1000; const syncPerSec = 1000 / avg;
    audit(req, 'loadtest_signin_bench', `${n} sign-ins`);
    res.json({ count: n, sync: { avgMs: r1(avg), p95Ms: r1(pct(sorted, 95)), totalMs: Math.round(syncTotal), perSec: r1(syncPerSec) }, pool: { totalMs: Math.round(poolTotal), perSec: r1(poolPerSec), avgMs: r1(poolTotal / n), lagMaxMs: r1(lagMax) }, cores: os.cpus().length,
      estimates: [50, 100, 250, 500, 1000].map((st) => ({ students: st, seconds: r1(st / poolPerSec), blockingSeconds: r1((st * avg) / 1000) })),
      advice: poolPerSec < 8 ? 'Signing in is slow on this server. Ask students to join over several minutes (a live window with an opening time) instead of all at once.' : poolPerSec < 25 ? 'Signing in is fine for ordinary days. For a big live mock, ask students to log in 15 minutes before it starts.' : 'Signing in is fast. Sign-in is unlikely to be your bottleneck.' });
  });
  r.get('/loadtest', (req, res) => {
    const run = cur && { id: cur.id, phase: cur.phase, note: cur.note, config: cur.cfg, elapsed: cur.elapsed || 0, active: cur.active || 0, samples: cur.samples || [], events: cur.events || [], marks: cur.marks || [], kinds: cur.kindsLive || {}, stopping: !!cur.stopping, error: cur.error || '', report: cur.report || null, startedAt: cur.startedAt };
    res.json({ info: info(), run, history: history(), baselineId: baselineId(), presets: presets(), defaults: DEFAULTS, patterns: PATTERNS, pages: PAGES });
  });
  r.post('/loadtest/start', async (req, res) => {
    if (cur && !['done', 'failed'].includes(cur.phase)) return bad(res, 'A test is already running.', 409);
    if (req.body?.confirm !== 'start') return bad(res, 'Type start to confirm.');
    const cfg = parseCfg(req.body || {}); const note = String(req.body?.note || '').trim().slice(0, 300);
    const pre = preflight(cfg); if (!pre.ok) return bad(res, pre.blockers[0]);
    const port = req.socket.localPort; const base = `http://127.0.0.1:${port}`;
    const run = { id: crypto.randomBytes(4).toString('hex'), cfg, phase: 'setup', note: 'Starting…', startedAt: now(), samples: [], active: 0, elapsed: 0, events: [], marks: [] }; cur = run;
    mocksCache.at = 0; audit(req, 'loadtest_start', `${ppl(cfg)} ${cfg.focus || 'exam'}`, `${cfg.durationSec}s, ${cfg.pattern}, save every ${cfg.saveEverySec}s`);
    (async () => {
      try { run.report = await execute(run, base); run.report.note = note; saveReports([run.report, ...reports()]); }
      catch (e) { run.error = e?.message || String(e); }
      finally { if (ltKey) ltKey.token = ''; try { cleanup(); } catch (e) { run.error = `${run.error || ''} Cleanup failed: ${e.message}`.trim(); } run.phase = run.error && !run.report ? 'failed' : 'done'; run.note = ''; }
    })();
    res.status(202).json({ ok: true, id: run.id });
  });
  r.post('/loadtest/stop', (req, res) => {
    if (!cur || ['done', 'failed'].includes(cur.phase)) return bad(res, 'No test is running.', 409);
    cur.userStop = true; cur.stopping = true; cur.abort?.('You stopped the test.'); audit(req, 'loadtest_stop', cur.id); res.json({ ok: true });
  });
  // the admin's own maximums, saved with the site settings
  const savedLimits = () => settings.get('loadtest_limits', {});
  applyLimits(savedLimits());
  r.get('/loadtest/limits', (req, res) => res.json({ limits: limitsNow(), ceil: CEIL, defaults: LIMIT_DEFAULTS }));
  r.put('/loadtest/limits', (req, res) => {
    if (isRunning()) return bad(res, 'Wait for the running test to finish before changing limits.', 409);
    const body = req.body || {}; const raw = body.reset ? {} : { ...savedLimits(), ...body }; const out = applyLimits(raw); settings.set('loadtest_limits', body.reset ? {} : out);
    audit(req, 'loadtest_limits', body.reset ? 'reset' : `up to ${out.users} students, ${out.durationSec}s`); res.json({ ok: true, limits: out, ceil: CEIL });
  });
  // a baseline is the result later tests are judged against
  const baselineId = () => { const id = settings.get('loadtest_baseline', ''); return id && find(id) ? id : ''; };
  r.put('/loadtest/baseline', (req, res) => { const id = String(req.body?.id || ''); if (id && !find(id)) return bad(res, 'That report is no longer saved.', 404); settings.set('loadtest_baseline', id); audit(req, 'loadtest_baseline', id || 'cleared'); res.json({ ok: true, baselineId: id }); });
  r.get('/loadtest/report/:id/csv', (req, res) => {
    const x = find(req.params.id); if (!x) return bad(res, 'That report is no longer saved.', 404); const cols = ['t', 'users', 'rps', 'p95', 'p99', 'errors', 'inflight', 'cpuProc', 'cpuSys', 'memUsedPct', 'rss', 'writeMs', 'lagMs', 'diskUsedPct'];
    const lines = [cols.join(','), ...(x.samples || []).map((q) => cols.map((c) => q[c] ?? '').join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="loadtest-${x.id}.csv"`); res.send(lines.join('\n'));
  });
  r.get('/loadtest/report/:id', (req, res) => { const x = find(req.params.id); if (!x) return bad(res, 'That report is no longer saved.', 404); const bid = baselineId(); const bl = bid && bid !== x.id ? find(bid) : null; res.json({ report: x, baselineId: bid, vsBaseline: bl ? { id: bl.id, label: bl.label || '', at: bl.at, ...compareOf(bl, x) } : null }); });
  r.put('/loadtest/report/:id', (req, res) => {
    const list = reports(); const x = list.find((y) => y.id === req.params.id); if (!x) return bad(res, 'That report is no longer saved.', 404); const b = req.body || {};
    if (b.label !== undefined) { x.label = String(b.label).trim().slice(0, 60); x.config.label = x.label; } if (b.note !== undefined) x.note = String(b.note).trim().slice(0, 300); if (b.pinned !== undefined) x.pinned = !!b.pinned;
    saveReports(list); res.json({ ok: true, item: summary(x) });
  });
  r.delete('/loadtest/report/:id', (req, res) => { const list = reports(); const n = list.filter((y) => y.id !== req.params.id); settings.set('loadtest_reports', n); settings.set('loadtests', settings.get('loadtests', []).filter((y) => y.id !== req.params.id)); res.json({ ok: true, removed: list.length - n.length }); });
  r.get('/loadtest/compare', (req, res) => {
    const a = find(String(req.query.a || '')), b = find(String(req.query.b || '')); if (!a || !b) return bad(res, 'Pick two saved tests to compare.', 404); if (a.id === b.id) return bad(res, 'Pick two different tests.');
    res.json({ a, b, ...compareOf(a, b) });
  });
  r.get('/loadtest/presets', (req, res) => res.json({ presets: presets() }));
  r.post('/loadtest/presets', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 40); if (!name) return bad(res, 'Give the preset a name.'); const cfg = parseCfg(req.body?.config || {}); delete cfg.label; delete cfg.mockId;
    const list = presets().filter((x) => x.name.toLowerCase() !== name.toLowerCase()); const item = { id: crypto.randomBytes(3).toString('hex'), name, config: cfg }; settings.set('loadtest_presets', [item, ...list].slice(0, 12)); res.json({ ok: true, presets: presets() });
  });
  r.delete('/loadtest/presets/:id', (req, res) => { settings.set('loadtest_presets', presets().filter((x) => x.id !== req.params.id)); res.json({ ok: true, presets: presets() }); });
  r.delete('/loadtest/history', (req, res) => { saveReports(reports().filter((x) => x.pinned)); settings.set('loadtests', []); res.json({ ok: true }); });
  // ---- (remote tests) ----
  // ---- tests driven from the admin's own computer ----
  // The admin downloads a small script. It runs on their laptop, so the requests cross the real internet, proxy and TLS.
  // A one-time key (valid for an hour) lets it create temporary virtual accounts, then it posts the measurements back.
  const remote = { hash: null, exp: 0, cfg: null, state: 'idle', runId: '', joinedAt: 0, reportId: '', sampler: null, timer: null, peaks: null, from: '' };
  const sha = (k) => crypto.createHash('sha256').update(String(k)).digest();
  const keyOk = (k) => !!remote.hash && now() < remote.exp && typeof k === 'string' && k.length < 100 && crypto.timingSafeEqual(sha(k), remote.hash);
  const remoteStop = () => { clearInterval(remote.sampler); clearTimeout(remote.timer); remote.sampler = null; remote.timer = null; ltKey.remote = ''; ltKey.remoteExp = 0; remote.hash = null; try { cleanup(); } catch { /* removed on the next start */ } };
  const remoteView = () => { if (remote.state === 'waiting' && now() > remote.exp) { remote.state = 'idle'; remoteStop(); } return { state: remote.state, cfg: remote.cfg, expiresAt: remote.exp, joinedAt: remote.joinedAt, reportId: remote.reportId, from: remote.from }; };
  const num = (v, lo, hi, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  r.get('/loadtest/remote', (req, res) => res.json(remoteView()));
  r.delete('/loadtest/remote', (req, res) => { remoteStop(); remote.state = 'idle'; res.json({ ok: true }); });
  r.post('/loadtest/remote', (req, res) => {
    if (isRunning()) return bad(res, 'A test is already running.');
    if (remote.state === 'running') return bad(res, 'A laptop test is running right now.');
    const b = req.body || {}; const test = ['signin', 'browse', 'both'].includes(b.test) ? b.test : 'browse';
    const base = String(b.base || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, ''); if (!/^https?:\/\/[A-Za-z0-9.\-:\[\]]+$/.test(base)) return bad(res, 'Give the public address of this site, such as https://mocks.example.com');
    const cfg = { test, people: Math.round(num(b.people, 1, 500, 100)), seconds: Math.round(num(b.seconds, 20, 300, 60)), base };
    const key = crypto.randomBytes(18).toString('base64url'); remote.hash = sha(key); remote.exp = now() + 3600000; remote.cfg = cfg; remote.state = 'waiting'; remote.reportId = ''; remote.joinedAt = 0; remote.from = ''; remote.admin = req.user;
    ltKey.remote = key; ltKey.remoteExp = remote.exp;
    audit(req, 'loadtest_remote', `${cfg.people} people from a laptop (${test})`);
    res.json({ ok: true, filename: 'mockdesk-loadtest.mjs', expiresAt: remote.exp, cfg, script: CLIENT.replace('__CFG__', JSON.stringify({ ...cfg, key })) });
  });
  const joinUsers = (cfg, rid) => {
    const t = now(); const PW = `lt-${crypto.randomBytes(5).toString('hex')}`; const salt = crypto.randomBytes(8).toString('hex'); const hash = cfg.test !== 'browse' && hashPw ? hashPw(PW, salt) : 'x';
    const insU = db.prepare('INSERT INTO users(name,email,salt,hash,role,created_at,last_seen) VALUES (?,?,?,?,?,?,?)'); const insS = db.prepare('INSERT INTO sessions(id,user_id,expires_at,ip,ua,created_at) VALUES (?,?,?,?,?,?)'); const out = [];
    db.exec('BEGIN');
    try { for (let i = 0; i < cfg.people; i++) { const email = `lt-r${rid}-${i}@loadtest.invalid`; const uid = Number(insU.run(`Laptop test ${i + 1}`, email, salt, hash, null, new Date(t).toISOString(), t).lastInsertRowid); const sid = crypto.randomBytes(32).toString('hex'); insS.run(sid, uid, t + 3600000, '127.0.0.1', 'loadtest', t); out.push({ email, sid }); } db.exec('COMMIT'); }
    catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
    return { users: out, password: PW };
  };
  ltRouter?.post('/join', (req, res) => {
    const b = req.body || {}; if (!keyOk(b.key)) return res.status(401).json({ error: 'This test key is wrong or has expired. Create a new script in the admin page.' });
    if (remote.state !== 'waiting') return res.status(409).json({ error: remote.state === 'running' ? 'This script was already used. Create a new one.' : 'No laptop test is waiting. Create a script in the admin page.' });
    if (isRunning()) return res.status(409).json({ error: 'Another load test is running on the server. Try again when it ends.' });
    try {
      const rid = crypto.randomBytes(3).toString('hex'); const j = joinUsers(remote.cfg, rid);
      remote.state = 'running'; remote.runId = rid; remote.joinedAt = now(); remote.from = String(req.ip || '').replace(/^::ffff:/, ''); remote.client = { os: String(b.os || '').slice(0, 40), node: String(b.node || '').slice(0, 20), rtt: num(b.rtt, 0, 60000) };
      const pk = remote.peaks = { cpuProc: 0, memUsedPct: 0, lagMs: 0, rss: 0, heap: 0 }; let lastCpu = process.cpuUsage(); let lastAt = performance.now();
      remote.sampler = setInterval(() => { const t = performance.now(); const c = process.cpuUsage(lastCpu); const wall = Math.max(1, t - lastAt); pk.cpuProc = Math.max(pk.cpuProc, r1(((c.user + c.system) / 1000 / wall) * 100)); pk.lagMs = Math.max(pk.lagMs, Math.max(0, wall - 1000)); lastCpu = process.cpuUsage(); lastAt = t; const m = memInfo(); pk.memUsedPct = Math.max(pk.memUsedPct, r1((1 - m.avail / m.total) * 100)); const mu = process.memoryUsage(); pk.rss = Math.max(pk.rss, mu.rss); pk.heap = Math.max(pk.heap, mu.heapUsed); }, 1000);
      remote.timer = setTimeout(() => { if (remote.state === 'running') { remote.state = 'expired'; remoteStop(); } }, (remote.cfg.seconds + 240) * 1000);
      res.json({ runId: rid, ...j, pages: PAGES.filter((x) => ['me', 'mocks', 'announcements', 'inbox', 'assignments', 'stats', 'practice', 'config'].includes(x[0])).map((x) => x[2]), config: remote.cfg });
    } catch (e) { remoteStop(); remote.state = 'idle'; res.status(500).json({ error: `Could not create the test accounts: ${e.message}` }); }
  });
  ltRouter?.post('/finish', (req, res) => {
    const b = req.body || {}; if (!keyOk(b.key) && !(remote.state === 'running' && ltKey.remote === b.key)) return res.status(401).json({ error: 'This test key is wrong or has expired.' });
    if (remote.state !== 'running') return res.status(409).json({ error: 'No laptop test is running.' });
    try {
      const x = b.result || {}; const cfgIn = remote.cfg; const kinds = {}; let n = 0, e = 0;
      for (const [k, v] of Object.entries(x.kinds || {}).slice(0, 40)) { if (!/^(login|page:\/[A-Za-z0-9_\/\-]*)$/.test(k)) continue; const c = { n: num(v?.n, 0, 1e7), errors: num(v?.err, 0, 1e7), p50: r1(num(v?.p50, 0, 1e6)), p95: r1(num(v?.p95, 0, 1e6)), p99: r1(num(v?.p99, 0, 1e6)), max: r1(num(v?.max, 0, 1e6)) }; c.avg = c.p50; kinds[k] = c; n += c.n; e += c.errors; }
      if (!n) { remote.state = 'idle'; remoteStop(); return res.status(400).json({ error: 'The script sent no measurements.' }); }
      const pg = x.pages && num(x.pages.n, 0, 1e7) ? { n: num(x.pages.n, 0, 1e7), p50: r1(num(x.pages.p50, 0, 1e6)), p95: r1(num(x.pages.p95, 0, 1e6)), max: r1(num(x.pages.max, 0, 1e6)) } : null;
      const all = x.all || {}; const secs = Math.round(num(x.seconds, 1, 3600, cfgIn.seconds)); const login = kinds.login;
      const cfg = parseCfg({ focus: cfgIn.test === 'signin' ? 'signin' : 'browse', users: cfgIn.people, durationSec: Math.max(10, secs), pattern: 'steady', signinPerMin: cfgIn.test === 'browse' ? 0 : cfgIn.test === 'both' ? 1 : 4 }); cfg.label = 'From my laptop';
      const core = Object.entries(kinds).reduce((a, [, v]) => a + v.errors, 0);
      const samples = (Array.isArray(x.samples) ? x.samples : []).slice(0, 400).map((q) => ({ t: num(q.t, 0, 1e5), users: num(q.users, 0, 1e4), rps: num(q.rps, 0, 1e6), p95: r1(num(q.p95, 0, 1e6)), errors: num(q.err, 0, 1e7), phase: 'running', cpu: 0, mem: 0 }));
      const pk = remote.peaks || {}; const m = memInfo(); const dk = diskOf(dbFile(db));
      const rep = {
        id: remote.runId, at: remote.joinedAt, config: cfg, stopped: x.stopped ? 'user' : '', stopReason: x.stopped ? 'You stopped the script early.' : '', durationSec: secs,
        totals: { customErrors: 0, coreErrorPct: n ? r1((core / n) * 100) : 0, requests: n, errors: e, errorPct: n ? r1((e / n) * 100) : 0, p50: r1(num(all.p50, 0, 1e6)), p95: r1(num(all.p95, 0, 1e6)), p99: r1(num(all.p99, 0, 1e6)), max: r1(num(all.max, 0, 1e6)), peakRps: samples.reduce((a, q) => Math.max(a, q.rps), 0), avgRps: r1(n / Math.max(1, secs)), busy: 0 },
        kinds, pages: pg, admin: null, errors: {}, peaks: { cpuProc: pk.cpuProc || 0, cpuSys: 0, rss: pk.rss || 0, heap: pk.heap || 0, memUsedPct: pk.memUsedPct || 0, diskUsedPct: dk.usedPct || 0, writeMs: 0, lagMs: pk.lagMs || 0, rps: 0, rssMB: Math.round((pk.rss || 0) / MB), heapMB: Math.round((pk.heap || 0) / MB) }, dbGrowthMB: 0, snapshotKB: 0,
        server: { cpus: os.cpus().length, totalMem: m.total, node: process.version, mock: '' }, remote: { from: remote.from, os: String(x.os || remote.client?.os || ''), node: String(x.node || remote.client?.node || ''), rttMs: r1(num(x.rtt, 0, 60000)) },
      };
      rep.label = cfg.label; rep.verdict = verdictOf(rep); rep.advice = adviceOf(rep); rep.marks = []; rep.events = [{ t: 0, text: `Test started from ${remote.from || 'your laptop'}.`, level: 'info' }, { t: secs, text: x.stopped ? 'You stopped the script early.' : 'Test finished.', level: 'info' }];
      rep.moments = { firstSlowAt: null, firstSlowUsers: null, slowestAt: null, slowestP95: null, slowestUsers: null }; rep.baseline = { rssMB: 0 }; rep.curve = []; rep.measuredLimit = null; rep.steps = []; rep.targets = targetsOf(rep); rep.samples = samples;
      const base_ = Math.max(1, rep.peaks.cpuProc); rep.estimate = rep.stopped ? null : base_ < 8 ? null : Math.floor(cfg.browsers * Math.min(2.5, 70 / base_));
      finishReport(rep); rep.note = `Measured from a laptop. Times include the internet between it and the server (round trip about ${rep.remote.rttMs} ms).`;
      saveReports([rep, ...reports()]); remote.reportId = rep.id; remote.state = 'done'; remoteStop(); audit({ user: remote.admin }, 'loadtest_remote_done', `${cfgIn.people} people, score ${rep.score}`);
      res.json({ id: rep.id, score: rep.score, band: rep.scoreWhy.band, title: rep.simple.title, text: rep.simple.text, room: rep.simple.room, fixes: rep.simple.fixes, areas: rep.areas.map(({ label, value, status, say }) => ({ label, value, status, say })) });
    } catch (err) { remote.state = 'idle'; remoteStop(); res.status(500).json({ error: `Could not build the result: ${err.message}` }); }
  });
  return { cleanup, running: () => !!cur && !['done', 'failed'].includes(cur.phase) };
}
