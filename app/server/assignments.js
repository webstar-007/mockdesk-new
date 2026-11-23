// v19 teacher assignments: a teacher sets a mock (or practice sets) for a batch with a due date, sees who has not done it, and reminders go out by themselves.
const DAY = 86400000;
const when = (t) => new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export function makeAssignments({ db, now, notifier, readResult }) {
  db.exec(`CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY, batch_id INTEGER, teacher_id INTEGER, kind TEXT, mock_id TEXT, practice_sets INTEGER DEFAULT 1,
    title TEXT, note TEXT, due_at INTEGER, created_at INTEGER, archived INTEGER DEFAULT 0, remind TEXT DEFAULT '{}', manual_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_assign_batch ON assignments(batch_id, archived, due_at);`);
  const mockName = (id) => db.prepare('SELECT name FROM mocks WHERE id=?').get(id)?.name || id;
  const members = (batchId) => db.prepare("SELECT u.id, u.name, u.email, u.phone, u.last_seen FROM batch_members bm JOIN users u ON u.id=bm.user_id WHERE bm.batch_id=? AND COALESCE(u.role,'student')='student' AND COALESCE(u.status,'active')!='suspended' ORDER BY u.name").all(batchId);
  const linkOf = (a) => (a.kind === 'practice' ? '/practice' : `/mock/${a.mock_id}`);
  const titleOf = (a) => a.title || (a.kind === 'practice' ? `Practice: ${a.practice_sets} set${a.practice_sets > 1 ? 's' : ''}` : mockName(a.mock_id));

  /** Who has done it. A mock counts once the student has submitted it; practice counts submitted practice sets since the assignment was made. */
  function progress(a) {
    const ms = members(a.batch_id); const t = now(); const students = [];
    for (const m of ms) {
      let doneAt = null, pct = null, started = false, sets = 0;
      if (a.kind === 'practice') {
        const rows = db.prepare("SELECT submitted_at FROM attempts WHERE user_id=? AND mock_id='practice' AND status='submitted' AND submitted_at>=? ORDER BY submitted_at").all(m.id, a.created_at);
        sets = rows.length; if (sets >= a.practice_sets) doneAt = rows[a.practice_sets - 1].submitted_at;
        started = sets > 0 || !!db.prepare("SELECT 1 FROM attempts WHERE user_id=? AND mock_id='practice' AND status='in_progress'").get(m.id);
      } else {
        const row = db.prepare("SELECT id, result, submitted_at FROM attempts WHERE user_id=? AND mock_id=? AND status='submitted' ORDER BY submitted_at LIMIT 1").get(m.id, a.mock_id);
        if (row) { doneAt = row.submitted_at; try { pct = readResult(row).summary.percentage; } catch { /* old result */ } }
        else started = !!db.prepare("SELECT 1 FROM attempts WHERE user_id=? AND mock_id=? AND status='in_progress'").get(m.id, a.mock_id);
      }
      students.push({ id: m.id, name: m.name, contact: m.email || m.phone || '', done: doneAt != null, doneAt, late: doneAt != null && doneAt > a.due_at, pct, started: started && doneAt == null, sets, lastSeen: m.last_seen });
    }
    const done = students.filter((s) => s.done).length;
    return { students, total: students.length, done, late: students.filter((s) => s.late).length, pending: students.length - done, overdue: t > a.due_at && done < students.length };
  }
  const shape = (a, withStudents = false) => {
    const p = progress(a); const b = db.prepare('SELECT name FROM batches WHERE id=?').get(a.batch_id);
    return { id: a.id, title: titleOf(a), kind: a.kind, mockId: a.mock_id || null, mockName: a.kind === 'mock' ? mockName(a.mock_id) : null, practiceSets: a.practice_sets, batchId: a.batch_id, batch: b?.name || '', dueAt: a.due_at, createdAt: a.created_at, note: a.note || '',
      total: p.total, done: p.done, late: p.late, pending: p.pending, overdue: p.overdue, ...(withStudents ? { students: p.students } : {}) };
  };
  const active = () => db.prepare('SELECT * FROM assignments WHERE archived=0').all();

  async function nudge(a, ids, title, body) {
    let n = 0; await notifier.pool(ids, 8, async (id) => { const r = await notifier.notify(id, { kind: 'assignment', title, body, link: linkOf(a), ref: `assign:${a.id}:${title.slice(0, 12)}:${Math.floor(now() / 3600000)}`, capped: false }); if (!r?.duplicate && !r?.skipped) n++; }); return n;
  }

  /** Background job: reminders a day before and when the deadline passes, and a summary to the teacher. */
  async function run() {
    const t = now(); let sent = 0;
    for (const a of active()) {
      const rm = JSON.parse(a.remind || '{}'); const p = progress(a); const pend = p.students.filter((s) => !s.done).map((s) => s.id);
      if (!rm.day && t >= a.due_at - DAY && t < a.due_at) {
        rm.day = t; if (pend.length) sent += await nudge(a, pend, `Due tomorrow: ${titleOf(a)}`, `Your teacher set this for ${when(a.due_at)}. ${a.kind === 'practice' ? 'A practice set takes about 20 minutes.' : 'Open it when you have a quiet stretch of time.'}`);
      }
      if (!rm.due && t >= a.due_at) {
        rm.due = t;
        if (pend.length) sent += await nudge(a, pend, `Past due: ${titleOf(a)}`, 'The deadline has passed. You can still finish it, and your teacher will see it.');
        await notifier.notify(a.teacher_id, { kind: 'assignment_teacher', title: `${titleOf(a)}: ${p.done} of ${p.total} done`, body: pend.length ? `${pend.length} student${pend.length > 1 ? 's have' : ' has'} not finished yet. Open Assignments to see who.` : 'Everyone finished on time.', link: '/teacher/assignments', ref: `assign-sum:${a.id}`, capped: false });
      }
      db.prepare('UPDATE assignments SET remind=? WHERE id=?').run(JSON.stringify(rm), a.id);
    }
    return sent;
  }
  /** For the admin alert: assignments that are past due with students still pending (past 7 days). */
  function overdue() {
    const t = now(); let assignments = 0, students = 0;
    for (const a of active()) { if (a.due_at > t || t - a.due_at > 7 * DAY) continue; const p = progress(a); if (p.pending) { assignments++; students += p.pending; } }
    return { assignments, students };
  }

  function mountTeacher(api) {
    const guard = (req, res, next) => (req.user?.role === 'teacher' ? next() : res.status(403).json({ error: 'Teacher access only' }));
    const batchOf = (req, id) => db.prepare('SELECT b.* FROM batches b JOIN batch_teachers bt ON bt.batch_id=b.id WHERE bt.user_id=? AND b.id=? AND b.archived=0').get(req.user.id, Number(id));
    const mine = (req) => db.prepare('SELECT a.* FROM assignments a JOIN batch_teachers bt ON bt.batch_id=a.batch_id WHERE bt.user_id=? AND a.archived=0 ORDER BY a.due_at DESC').all(req.user.id);
    const own = (req) => { const a = db.prepare('SELECT * FROM assignments WHERE id=? AND archived=0').get(Number(req.params.id)); return a && batchOf(req, a.batch_id) ? a : null; };
    api.get('/teacher/assignments', guard, (req, res) => {
      const items = mine(req).map((a) => shape(a)); const t = now();
      res.json({ items, summary: { open: items.filter((x) => x.dueAt > t).length, overdue: items.filter((x) => x.overdue).length, pendingStudents: items.filter((x) => x.dueAt > t || x.overdue).reduce((s, x) => s + x.pending, 0) },
        mocks: db.prepare("SELECT id, name FROM mocks WHERE status='published' AND id NOT IN ('practice','pool') ORDER BY number DESC").all() });
    });
    api.post('/teacher/assignments', guard, async (req, res) => {
      const b = req.body || {}; const batch = batchOf(req, b.batchId); if (!batch) return res.status(404).json({ error: 'Choose one of your batches' });
      const kind = b.kind === 'practice' ? 'practice' : 'mock'; const t = now();
      let mockId = null; if (kind === 'mock') { const m = db.prepare("SELECT id FROM mocks WHERE id=? AND status='published' AND id NOT IN ('practice','pool')").get(String(b.mockId || '')); if (!m) return res.status(400).json({ error: 'Choose a published mock' }); mockId = m.id; }
      const sets = kind === 'practice' ? Math.max(1, Math.min(10, Math.floor(Number(b.practiceSets) || 1))) : 1;
      const due = Number(b.dueAt) || Date.parse(b.dueAt); if (!due) return res.status(400).json({ error: 'Pick a due date and time' });
      if (due <= t) return res.status(400).json({ error: 'The due date must be in the future' }); if (due > t + 400 * DAY) return res.status(400).json({ error: 'Pick a due date within the next year' });
      const info = db.prepare('INSERT INTO assignments(batch_id,teacher_id,kind,mock_id,practice_sets,title,note,due_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(batch.id, req.user.id, kind, mockId, sets, String(b.title || '').trim().slice(0, 100), String(b.note || '').trim().slice(0, 400), due, t);
      const a = db.prepare('SELECT * FROM assignments WHERE id=?').get(Number(info.lastInsertRowid));
      const ids = members(batch.id).map((s) => s.id);
      const sent = await nudge(a, ids, `New assignment: ${titleOf(a)}`, `${req.user.name} set this for ${batch.name}. Due ${when(due)}.${a.note ? ' ' + a.note : ''}`);
      res.status(201).json({ assignment: shape(a), notified: sent });
    });
    api.get('/teacher/assignments/:id', guard, (req, res) => { const a = own(req); if (!a) return res.status(404).json({ error: 'Assignment not found' }); res.json({ assignment: shape(a, true) }); });
    api.patch('/teacher/assignments/:id', guard, (req, res) => {
      const a = own(req); if (!a) return res.status(404).json({ error: 'Assignment not found' }); const b = req.body || {}; const t = now();
      let due = a.due_at; if (b.dueAt !== undefined) { due = Number(b.dueAt) || Date.parse(b.dueAt); if (!due || due <= t) return res.status(400).json({ error: 'The new due date must be in the future' }); }
      db.prepare('UPDATE assignments SET due_at=?, note=?, remind=? WHERE id=?').run(due, b.note !== undefined ? String(b.note).slice(0, 400) : a.note, due !== a.due_at ? '{}' : a.remind, a.id);
      res.json({ assignment: shape(db.prepare('SELECT * FROM assignments WHERE id=?').get(a.id), true) });
    });
    api.post('/teacher/assignments/:id/remind', guard, async (req, res) => {
      const a = own(req); if (!a) return res.status(404).json({ error: 'Assignment not found' }); const t = now();
      if (a.manual_at && t - a.manual_at < 6 * 3600000) return res.status(429).json({ error: 'You sent a reminder a short while ago. Try again later today.' });
      const pend = progress(a).students.filter((s) => !s.done).map((s) => s.id); if (!pend.length) return res.json({ ok: true, sent: 0, message: 'Everyone has finished.' });
      db.prepare('UPDATE assignments SET manual_at=? WHERE id=?').run(t, a.id);
      const sent = await nudge(a, pend, `Reminder: ${titleOf(a)}`, `${req.user.name} asked you to finish this${a.due_at > t ? `. Due ${when(a.due_at)}` : ' (it is past due)'}.`);
      res.json({ ok: true, sent, message: `Reminder sent to ${sent} student${sent === 1 ? '' : 's'}.` });
    });
    api.delete('/teacher/assignments/:id', guard, (req, res) => { const a = own(req); if (!a) return res.status(404).json({ error: 'Assignment not found' }); db.prepare('UPDATE assignments SET archived=1 WHERE id=?').run(a.id); res.json({ ok: true }); });
  }

  function mountStudent(api) {
    api.get('/my/assignments', (req, res) => {
      if (req.user.role && req.user.role !== 'student') return res.json({ items: [] });
      const t = now(); const as = db.prepare('SELECT a.* FROM assignments a JOIN batch_members bm ON bm.batch_id=a.batch_id WHERE bm.user_id=? AND a.archived=0 AND a.due_at>? ORDER BY a.due_at').all(req.user.id, t - 7 * DAY);
      const items = as.map((a) => { const me = progress(a).students.find((s) => s.id === req.user.id); const b = db.prepare('SELECT name FROM batches WHERE id=?').get(a.batch_id); const tn = db.prepare('SELECT name FROM users WHERE id=?').get(a.teacher_id);
        return { id: a.id, title: titleOf(a), kind: a.kind, link: linkOf(a), dueAt: a.due_at, note: a.note || '', batch: b?.name || '', teacher: tn?.name || '', done: !!me?.done, doneAt: me?.doneAt || null, late: !!me?.late, started: !!me?.started, sets: me?.sets || 0, setsNeeded: a.kind === 'practice' ? a.practice_sets : 1, overdue: !me?.done && a.due_at < t }; })
        .filter((x) => !x.done || t - (x.doneAt || 0) < 3 * DAY);
      items.sort((a, b) => Number(a.done) - Number(b.done) || a.dueAt - b.dueAt);
      res.json({ items, pending: items.filter((x) => !x.done).length });
    });
  }

  const adminList = () => active().map((a) => { const o = shape(a); const tn = db.prepare('SELECT name FROM users WHERE id=?').get(a.teacher_id); return { ...o, teacher: tn?.name || '' }; }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt - b.dueAt);
  return { mountTeacher, mountStudent, run, overdue, adminList, progress, shape };
}
