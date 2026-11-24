// v21 load and capacity simulator. Virtual students (temporary accounts) sit a hidden copy of a mock on this very server, going through the
// real HTTP routes: open the test, autosave answers, submit, open the result. Meanwhile we sample CPU, memory, disk and database write time.
// Everything the test creates is removed afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { dbFile } from './lib/restore.js';
import { owned } from './lib/userdata.js';

const SIM = '%@loadtest.invalid';
const HIDDEN = '__loadtest__';
export const LIMITS = { users: [1, 500], durationSec: [5, 120], saveEverySec: [3, 60], progress: [0, 90] };
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

export function verdictOf(rep) {
  const save = rep.kinds.save || rep.kinds.open || { p95: 0 }; const errPct = rep.totals.errorPct; const p95 = save.p95;
  let level = 'good', title = 'Comfortable', text = `Autosaves answered in ${Math.round(p95)} ms at the 95th percentile with ${errPct}% errors. The server handled ${rep.config.users} students at once with room to spare.`;
  if (errPct > 5 || p95 > 2000 || rep.stopped === 'safety') { level = 'bad'; title = 'Overloaded'; text = `At ${rep.config.users} students the server slowed down badly (autosave p95 ${Math.round(p95)} ms, ${errPct}% errors). Students would notice lag or lose saves.`; }
  else if (errPct > 1 || p95 > 800) { level = 'warn'; title = 'Tight'; text = `It coped, but autosave p95 reached ${Math.round(p95)} ms (${errPct}% errors). Expect lag on a busier day.`; }
  else if (p95 > 300) { level = 'ok'; title = 'Fine, with little headroom'; text = `Autosave p95 was ${Math.round(p95)} ms. Fine for ${rep.config.users} students, but do not expect much more on this server.`; }
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
  if (!a.length) a.push('Nothing needs fixing at this size. To find the limit, run again with more students.');
  return a;
}

export function mountLoadTest({ r, db, now, audit, bad, settings, getMock, controls, jobs }) {
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
  const mockOptions = () => db.prepare("SELECT id, name, status FROM mocks WHERE id NOT IN ('practice','pool') AND id!=? ORDER BY (status='published') DESC, number, created_at").all(HIDDEN).map((m) => { const g = getMock(m.id); return g && g.questions.length >= 10 ? { id: m.id, name: m.name, questions: g.questions.length } : null; }).filter(Boolean);

  function info() {
    const f = file(); const d = f ? diskOf(f) : null; const m = memInfo();
    const active = db.prepare(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND last_seen>? AND email NOT LIKE '${SIM}'`).get(now() - 5 * 60000).c;
    const inTest = db.prepare("SELECT COUNT(*) c FROM attempts WHERE status='in_progress' AND mock_id!=?").get(HIDDEN).c;
    return { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || '', totalMem: m.total, availMem: m.avail, disk: d, dbBytes: sizeOf(f), activeStudents: active, inTest, maintenance: controls().maintenance.mode, mocks: mockOptions(), limits: LIMITS, node: process.version, platform: `${os.type()} ${os.release()}` };
  }

  // ---- the run ----
  async function execute(run, base) {
    const { cfg } = run; const T0 = performance.now(); const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
    const kinds = {}; const win = { n: 0, err: 0, lat: [] }; let recent = []; const samples = []; const errors = {}; let busy = 0; const peaks = { cpuProc: 0, cpuSys: 0, rss: 0, heap: 0, memUsedPct: 0, diskUsedPct: 0, writeMs: 0, lagMs: 0, rps: 0 };
    const record = (kind, ms, status, text) => {
      const k = (kinds[kind] ||= { lat: [], n: 0, err: 0 }); k.n++; k.lat.push(ms); win.n++; win.lat.push(ms);
      const bad_ = status < 200 || status >= 400; if (bad_) { k.err++; win.err++; const key = status === -1 ? 'timeout' : status === -2 ? 'connection failed' : String(status); errors[key] = (errors[key] || 0) + 1; if (/locked|busy/i.test(text || '')) busy++; }
      recent.push(bad_ ? 1 : 0); if (recent.length > 60) recent.shift();
    };
    const hit = async (kind, method, url, sid, body) => {
      const t0 = performance.now(); let status = 0, text = '';
      try { const rs = await fetch(`${base}/api${url}`, { method, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); status = rs.status; if (status >= 400) text = (await rs.text()).slice(0, 200); else await rs.arrayBuffer(); }
      catch (e) { status = e?.name === 'TimeoutError' ? -1 : -2; }
      record(kind, performance.now() - t0, status, text); return status;
    };
    let stop = ''; const abort = (why) => { if (!stop) stop = why; };
    run.abort = abort;

    // 1. set up the hidden mock, accounts and attempts
    run.phase = 'setup'; run.note = 'Creating virtual students…';
    const src = pickSource(cfg.mockId); if (!src) throw new Error('Create a mock with at least 10 questions first, then run the test.');
    const m = src.mock; const t = now();
    const segIdx = 0; const seg = m.segments[segIdx]; const segQs = m.questions.filter((q) => seg.sections.includes(q.section)); if (!segQs.length) throw new Error('That mock has no questions in its first section.');
    const snapshot = JSON.stringify({ meta: { ...m.meta, id: HIDDEN, name: 'Load test (temporary)', status: 'draft' }, questions: m.questions, segments: m.segments, sectionsCfg: m.sectionsCfg, complete: m.complete });
    run.snapshotKB = Math.round(snapshot.length / 1024); const needBytes = snapshot.length * cfg.users * 3 + 200 * MB; const dsk = file() ? diskOf(file()) : null;
    if (dsk && dsk.free < needBytes) throw new Error(`Not enough free disk space for this test. It needs about ${Math.round(needBytes / MB)} MB free and ${Math.round(dsk.free / MB)} MB is available. Try fewer students.`);
    const segMs = seg.minutes * 60000; const need = (cfg.durationSec + 90) * 1000; if (segMs < need) throw new Error('The first section of that mock is too short to test with. Pick another mock or a shorter test.');
    const elapsed = Math.min(Math.round((cfg.progress / 100) * segMs * 0.8), segMs - need);
    db.prepare("INSERT OR REPLACE INTO mocks(id,number,name,difficulty,description,status,tags,source,created_at,updated_at) VALUES (?,?,?,?,?,'draft','[]','admin',?,?)").run(HIDDEN, 9999, 'Load test (temporary)', m.meta.difficulty || 'moderate', 'Created by the load simulator. Removed automatically.', t, t);
    db.exec('CREATE TABLE IF NOT EXISTS loadtest_probe(id INTEGER PRIMARY KEY, at INTEGER)');
    const students = []; const runId = crypto.randomBytes(3).toString('hex');
    db.exec('BEGIN');
    try {
      const insU = db.prepare('INSERT INTO users(name,email,salt,hash,created_at,last_seen) VALUES (?,?,?,?,?,?)'); const insS = db.prepare('INSERT INTO sessions(id,user_id,expires_at,ip,ua,created_at) VALUES (?,?,?,?,?,?)');
      const insA = db.prepare("INSERT INTO attempts(id,user_id,mock_id,status,segment_index,segment_started_at,started_at,snapshot,responses) VALUES (?,?,?,'in_progress',?,?,?,?,?)");
      for (let i = 0; i < cfg.users; i++) {
        const uid = Number(insU.run(`Virtual student ${i + 1}`, `lt-${runId}-${i}@loadtest.invalid`, 'x', 'x', new Date(t).toISOString(), t).lastInsertRowid);
        const sid = crypto.randomBytes(32).toString('hex'); insS.run(sid, uid, t + 3600000, '127.0.0.1', 'loadtest', t);
        const resp = {}; for (const q of segQs) if (Math.random() * 100 < cfg.progress) resp[q.id] = { selected: Math.floor(Math.random() * 4), marked: false, visited: true, timeMs: 15000 + Math.floor(Math.random() * 60000) };
        const aid = crypto.randomUUID(); insA.run(aid, uid, HIDDEN, segIdx, t - elapsed, t - elapsed, snapshot, JSON.stringify(resp));
        students.push({ uid, sid, aid, done: Object.keys(resp).length });
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const dbBefore = sizeOf(file()) + sizeOf(`${file()}-wal`);

    // 2. samplers: once a second, resources and the rolling latency
    const probeDel = () => { try { db.prepare('DELETE FROM loadtest_probe').run(); } catch { /* */ } };
    let lastCpu = process.cpuUsage(), lastAt = performance.now(), lastSys = cpuTimes(); const cores = os.cpus().length; let lagStrikes = 0;
    const tick = () => {
      const tt = (performance.now() - T0) / 1000; const c = process.cpuUsage(), at = performance.now(); const wall = Math.max(1, at - lastAt);
      const cpuProc = ((c.user - lastCpu.user + (c.system - lastCpu.system)) / 1000 / wall) * 100; lastCpu = c; lastAt = at; // percent of ONE core
      const sy = cpuTimes(); const cpuSys = sy.tot - lastSys.tot ? (1 - (sy.idle - lastSys.idle) / (sy.tot - lastSys.tot)) * 100 : 0; lastSys = sy;
      const mem = memInfo(); const mu = process.memoryUsage(); const dsk2 = file() ? diskOf(file()) : null;
      let writeMs = 0; try { const w0 = performance.now(); db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO loadtest_probe(at) VALUES (?)').run(Date.now()); db.exec('COMMIT'); writeMs = performance.now() - w0; if (Math.random() < 0.2) probeDel(); } catch { try { db.exec('ROLLBACK'); } catch { /* */ } }
      const sorted = win.lat.slice().sort((a, b) => a - b); const lagMs = lag.percentile(99) / 1e6; lag.reset();
      const s = { t: r1(tt), rps: win.n, p50: r1(pct(sorted, 50)), p95: r1(pct(sorted, 95)), errors: win.err, users: run.active, cpuProc: r1(cpuProc), cpuSys: r1(cpuSys), rss: mu.rss, heap: mu.heapUsed, memUsedPct: r1(((mem.total - mem.avail) / mem.total) * 100), memAvail: mem.avail, diskUsedPct: dsk2?.usedPct ?? null, dbBytes: sizeOf(file()) + sizeOf(`${file()}-wal`), writeMs: r1(writeMs), lagMs: r1(lagMs), phase: run.phase };
      win.n = 0; win.err = 0; win.lat = []; samples.push(s);
      peaks.cpuProc = Math.max(peaks.cpuProc, s.cpuProc); peaks.cpuSys = Math.max(peaks.cpuSys, s.cpuSys); peaks.rss = Math.max(peaks.rss, s.rss); peaks.heap = Math.max(peaks.heap, s.heap); peaks.memUsedPct = Math.max(peaks.memUsedPct, s.memUsedPct); peaks.diskUsedPct = Math.max(peaks.diskUsedPct, s.diskUsedPct || 0); peaks.writeMs = Math.max(peaks.writeMs, s.writeMs); peaks.lagMs = Math.max(peaks.lagMs, s.lagMs); peaks.rps = Math.max(peaks.rps, s.rps);
      run.samples = samples; run.elapsed = r1(tt);
      // safety stops
      const errRate = recent.length >= 30 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
      if (errRate > 0.4) abort('More than 40% of requests were failing, so the test was stopped to protect the server.');
      if (s.memAvail < Math.max(120 * MB, mem.total * 0.08)) abort('The server was running out of memory, so the test was stopped.');
      if (s.diskUsedPct != null && s.diskUsedPct > 96) abort('The disk was almost full, so the test was stopped.');
      lagStrikes = s.lagMs > 4000 ? lagStrikes + 1 : 0; if (lagStrikes >= 3) abort('The server stopped responding for several seconds, so the test was stopped.');
    };
    const sampler = setInterval(tick, 1000); tick();

    // 3. the virtual students
    run.phase = 'running'; run.note = ''; const tEnd = performance.now() + cfg.durationSec * 1000; const ramp = Math.min(cfg.durationSec * 0.15, 10) * 1000; const submitFrom = tEnd - cfg.durationSec * 1000 * 0.18;
    run.active = 0; let finished = 0;
    const student = async (s, i) => {
      await sleep(Math.random() * ramp); if (stop) return; run.active++;
      try {
        await hit('open', 'GET', `/attempts/${s.aid}`, s.sid);
        let cum = 0;
        while (!stop && performance.now() < (cfg.submitAtEnd ? submitFrom : tEnd) - 200) {
          await sleep(Math.min(cfg.saveEverySec * 1000 * (0.8 + Math.random() * 0.4), Math.max(0, (cfg.submitAtEnd ? submitFrom : tEnd) - performance.now())));
          if (stop) break;
          const body = { responses: {}, lastQid: null }; const n = 1 + Math.floor(Math.random() * 3);
          for (let k = 0; k < n; k++) { const q = segQs[Math.floor(Math.random() * segQs.length)]; cum += 8000 + Math.floor(Math.random() * 30000); body.responses[q.id] = { selected: Math.floor(Math.random() * 4), marked: Math.random() < 0.1, visited: true, timeMs: cum }; body.lastQid = q.id; }
          await hit('save', 'PUT', `/attempts/${s.aid}/responses`, s.sid, body);
          if (Math.random() < 0.2) await hit('poll', 'GET', `/attempts/${s.aid}`, s.sid);
        }
        if (cfg.submitAtEnd && !stop) {
          await sleep(Math.max(0, submitFrom + Math.random() * (tEnd - submitFrom) * 0.9 - performance.now())); if (stop) return;
          await hit('submit', 'POST', `/attempts/${s.aid}/submit`, s.sid, { responses: {} });
          if (Math.random() < 0.7) await hit('result', 'GET', `/attempts/${s.aid}/result`, s.sid);
        }
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
    lats.sort((a, b) => a - b); const dbAfter = Math.max(...samples.map((x) => x.dbBytes), dbBefore);
    const rep = {
      id: run.id, at: run.startedAt, config: cfg, stopped: stop ? (run.userStop ? 'user' : 'safety') : '', stopReason: stop, durationSec: r1((performance.now() - T0) / 1000),
      totals: { requests: nAll, errors: eAll, errorPct: nAll ? r1((eAll / nAll) * 100) : 0, p50: r1(pct(lats, 50)), p95: r1(pct(lats, 95)), p99: r1(pct(lats, 99)), max: r1(lats[lats.length - 1] || 0), peakRps: peaks.rps, avgRps: r1(nAll / Math.max(1, cfg.durationSec)), busy },
      kinds: kOut, errors, peaks: { ...peaks, rssMB: Math.round(peaks.rss / MB), heapMB: Math.round(peaks.heap / MB) }, dbGrowthMB: r1((dbAfter - dbBefore) / MB), snapshotKB: run.snapshotKB,
      server: { cpus: cores, totalMem: memInfo().total, node: process.version, mock: src.row.name },
    };
    rep.verdict = verdictOf(rep); rep.advice = adviceOf(rep);
    // a rough ceiling from how much of one core the app used
    const base_ = Math.max(1, rep.peaks.cpuProc); rep.estimate = rep.stopped === 'safety' ? Math.max(1, Math.floor(cfg.users * 0.6)) : base_ < 8 ? null : Math.floor(cfg.users * Math.min(2.5, 70 / base_));
    return rep;
  }

  const summary = (rep) => ({ id: rep.id, at: rep.at, users: rep.config.users, durationSec: rep.config.durationSec, p95: rep.kinds.save?.p95 ?? rep.totals.p95, errorPct: rep.totals.errorPct, peakCpu: rep.peaks.cpuProc, peakMem: rep.peaks.memUsedPct, level: rep.verdict.level, title: rep.verdict.title, stopped: rep.stopped, estimate: rep.estimate });
  const history = () => settings.get('loadtests', []);

  r.get('/loadtest', (req, res) => {
    const run = cur && { id: cur.id, phase: cur.phase, note: cur.note, config: cur.cfg, elapsed: cur.elapsed || 0, active: cur.active || 0, samples: cur.samples || [], stopping: !!cur.stopping, error: cur.error || '', report: cur.report || null, startedAt: cur.startedAt };
    res.json({ info: info(), run, history: history() });
  });
  r.post('/loadtest/start', async (req, res) => {
    if (cur && !['done', 'failed'].includes(cur.phase)) return bad(res, 'A test is already running.', 409);
    if (req.body?.confirm !== 'start') return bad(res, 'Type start to confirm.');
    if (controls().maintenance.mode !== 'off') return bad(res, 'Turn off maintenance mode first. It would block the virtual students.');
    const b = req.body || {}; const cfg = { users: clamp(b.users, LIMITS.users, 100), durationSec: clamp(b.durationSec, LIMITS.durationSec, 60), saveEverySec: clamp(b.saveEverySec, LIMITS.saveEverySec, 10), progress: clamp(b.progress, LIMITS.progress, 40), submitAtEnd: b.submitAtEnd !== false, mockId: String(b.mockId || '') };
    if (!pickSource(cfg.mockId)) return bad(res, 'Create a mock with at least 10 questions first, then run the test.');
    const port = req.socket.localPort; const base = `http://127.0.0.1:${port}`;
    const run = { id: crypto.randomBytes(4).toString('hex'), cfg, phase: 'setup', note: 'Starting…', startedAt: now(), samples: [], active: 0, elapsed: 0 }; cur = run;
    audit(req, 'loadtest_start', `${cfg.users} students`, `${cfg.durationSec}s, save every ${cfg.saveEverySec}s`);
    (async () => {
      try { run.report = await execute(run, base); const sum = summary(run.report); settings.set('loadtests', [sum, ...history()].slice(0, 12)); }
      catch (e) { run.error = e?.message || String(e); }
      finally { try { cleanup(); } catch (e) { run.error = `${run.error || ''} Cleanup failed: ${e.message}`.trim(); } run.phase = run.error && !run.report ? 'failed' : 'done'; run.note = ''; }
    })();
    res.status(202).json({ ok: true, id: run.id });
  });
  r.post('/loadtest/stop', (req, res) => {
    if (!cur || ['done', 'failed'].includes(cur.phase)) return bad(res, 'No test is running.', 409);
    cur.userStop = true; cur.stopping = true; cur.abort?.('You stopped the test.'); audit(req, 'loadtest_stop', cur.id); res.json({ ok: true });
  });
  r.delete('/loadtest/history', (req, res) => { settings.set('loadtests', []); res.json({ ok: true }); });
  return { cleanup, running: () => !!cur && !['done', 'failed'].includes(cur.phase) };
}
