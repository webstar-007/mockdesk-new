// Support inbox: students write to the team from the app; staff answer from Admin > Support. Everything stays in one thread per question.
export const CATEGORIES = { account: 'Account or sign-in', test: 'A test or a question in it', results: 'Results or analysis', bug: 'Something is not working', other: 'Something else' };
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const DAY = 86400000;

export function mountSupportStudent({ api, db, now, notifier }) {
  const mine = (req, res) => { const t = db.prepare('SELECT * FROM tickets WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id); if (!t) { res.status(404).json({ error: 'Not found' }); return null; } return t; };
  const view = (t) => ({ id: t.id, subject: t.subject, category: t.category, categoryLabel: CATEGORIES[t.category] || 'Something else', status: t.status, createdAt: t.created_at, updatedAt: t.updated_at, waiting: t.status === 'answered', rating: t.rating });
  api.get('/support', (req, res) => {
    const rows = db.prepare('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(req.user.id);
    res.json({ tickets: rows.map(view), categories: CATEGORIES });
  });
  api.post('/support', (req, res) => {
    const subject = clip(req.body?.subject, 120), body = clip(req.body?.body, 4000); const category = req.body?.category in CATEGORIES ? req.body.category : 'other';
    if (!subject) return res.status(400).json({ error: 'Add a short title so we know what this is about.' });
    if (body.length < 10) return res.status(400).json({ error: 'Tell us a little more (at least 10 characters).' });
    const t = now();
    if (db.prepare("SELECT COUNT(*) c FROM tickets WHERE user_id=? AND status!='closed'").get(req.user.id).c >= 5) return res.status(429).json({ error: 'You already have 5 open questions. Wait for a reply or close one first.' });
    if (db.prepare('SELECT COUNT(*) c FROM tickets WHERE user_id=? AND created_at>?').get(req.user.id, t - DAY).c >= 10) return res.status(429).json({ error: 'You have sent a lot of questions today. Please try again tomorrow.' });
    const id = Number(db.prepare("INSERT INTO tickets(user_id,subject,category,status,last_from,created_at,updated_at) VALUES (?,?,?,'open','student',?,?)").run(req.user.id, subject, category, t, t).lastInsertRowid);
    db.prepare("INSERT INTO ticket_msgs(ticket_id,from_role,author_id,author,body,note,at) VALUES (?,'student',?,?,?,0,?)").run(id, req.user.id, req.user.name, body, t);
    res.status(201).json({ ticket: view(db.prepare('SELECT * FROM tickets WHERE id=?').get(id)) });
  });
  api.get('/support/:id', (req, res) => {
    const t = mine(req, res); if (!t) return;
    const msgs = db.prepare('SELECT id, from_role, author, body, at FROM ticket_msgs WHERE ticket_id=? AND note=0 ORDER BY at, id').all(t.id);
    res.json({ ticket: view(t), messages: msgs.map((m) => ({ id: m.id, from: m.from_role, author: m.from_role === 'student' ? 'You' : m.author || 'Support team', body: m.body, at: m.at })) });
  });
  api.post('/support/:id/reply', (req, res) => {
    const t = mine(req, res); if (!t) return; const body = clip(req.body?.body, 4000); if (!body) return res.status(400).json({ error: 'Write your reply first.' });
    const n = now(); db.prepare("INSERT INTO ticket_msgs(ticket_id,from_role,author_id,author,body,note,at) VALUES (?,'student',?,?,?,0,?)").run(t.id, req.user.id, req.user.name, body, n);
    db.prepare("UPDATE tickets SET status='open', last_from='student', updated_at=?, closed_at=NULL WHERE id=?").run(n, t.id); res.json({ ok: true });
  });
  api.post('/support/:id/close', (req, res) => { const t = mine(req, res); if (!t) return; db.prepare("UPDATE tickets SET status='closed', closed_at=?, updated_at=? WHERE id=?").run(now(), now(), t.id); res.json({ ok: true }); });
  api.post('/support/:id/rate', (req, res) => { const t = mine(req, res); if (!t) return; const r = Number(req.body?.rating); if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: 'Pick 1 to 5 stars.' }); db.prepare('UPDATE tickets SET rating=? WHERE id=?').run(r, t.id); res.json({ ok: true }); });
  void notifier;
}

export function mountSupportAdmin({ r, db, now, audit, bad, notifier }) {
  const row = (t) => {
    const last = db.prepare('SELECT body, from_role FROM ticket_msgs WHERE ticket_id=? AND note=0 ORDER BY at DESC, id DESC LIMIT 1').get(t.id);
    return { id: t.id, userId: t.user_id, student: t.uname || '(deleted)', email: t.uemail || '', subject: t.subject, category: t.category, categoryLabel: CATEGORIES[t.category] || 'Something else', status: t.status, priority: t.priority, assignedTo: t.assigned_to, assignee: t.aname || null, createdAt: t.created_at, updatedAt: t.updated_at, rating: t.rating, preview: (last?.body || '').slice(0, 140), lastFrom: last?.from_role || t.last_from };
  };
  const base = 'SELECT t.*, u.name uname, u.email uemail, a.name aname FROM tickets t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.assigned_to';
  r.get('/tickets', (req, res) => {
    const st = ['open', 'answered', 'closed'].includes(req.query.status) ? req.query.status : null; const q = String(req.query.q || '').trim().toLowerCase(); const mineOnly = req.query.mine === '1';
    let rows = db.prepare(`${base} ${st ? 'WHERE t.status=?' : ''} ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, CASE t.priority WHEN 'high' THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 300`).all(...(st ? [st] : []));
    if (mineOnly) rows = rows.filter((t) => t.assigned_to === req.user.id);
    if (q) rows = rows.filter((t) => `${t.subject} ${t.uname} ${t.uemail}`.toLowerCase().includes(q));
    const c = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM tickets GROUP BY status').all().map((x) => [x.status, x.n]));
    const rated = db.prepare('SELECT AVG(rating) a, COUNT(rating) n FROM tickets WHERE rating IS NOT NULL').get();
    res.json({ tickets: rows.map(row), counts: { open: c.open || 0, answered: c.answered || 0, closed: c.closed || 0 }, rating: rated.n ? { avg: Math.round(rated.a * 10) / 10, n: rated.n } : null });
  });
  r.get('/tickets/:id', (req, res) => {
    const t = db.prepare(`${base} WHERE t.id=?`).get(Number(req.params.id)); if (!t) return bad(res, 'Not found', 404);
    const messages = db.prepare('SELECT id, from_role, author, body, note, at FROM ticket_msgs WHERE ticket_id=? ORDER BY at, id').all(t.id).map((m) => ({ id: m.id, from: m.from_role, author: m.author, body: m.body, note: !!m.note, at: m.at }));
    const others = db.prepare('SELECT id, subject, status FROM tickets WHERE user_id=? AND id!=? ORDER BY updated_at DESC LIMIT 5').all(t.user_id, t.id);
    res.json({ ticket: row(t), messages, others });
  });
  r.post('/tickets/:id/reply', async (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id)); if (!t) return bad(res, 'Not found', 404);
    const body = clip(req.body?.body, 4000); if (!body) return bad(res, 'Write a reply first.'); const note = !!req.body?.note; const n = now();
    const mid = Number(db.prepare('INSERT INTO ticket_msgs(ticket_id,from_role,author_id,author,body,note,at) VALUES (?,?,?,?,?,?,?)').run(t.id, 'staff', req.user.id, req.user.name, body, note ? 1 : 0, n).lastInsertRowid);
    if (!note) {
      db.prepare('UPDATE tickets SET status=?, last_from=?, updated_at=?, closed_at=?, assigned_to=COALESCE(assigned_to,?) WHERE id=?').run(req.body?.close ? 'closed' : 'answered', 'staff', n, req.body?.close ? n : null, req.user.id, t.id);
      try { await notifier.notify(t.user_id, { kind: 'support', title: `Reply to: ${t.subject}`.slice(0, 90), body: body.slice(0, 200), link: `/support/${t.id}`, ref: `ticket-${t.id}-${mid}`, capped: false }); } catch { /* the reply is saved even if the alert fails */ }
    } else db.prepare('UPDATE tickets SET updated_at=? WHERE id=?').run(n, t.id);
    audit(req, note ? 'ticket_note' : 'ticket_reply', `#${t.id}`, t.subject.slice(0, 60)); res.json({ ok: true });
  });
  r.patch('/tickets/:id', (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id)); if (!t) return bad(res, 'Not found', 404); const b = req.body || {}; const n = now();
    if (b.status !== undefined) { if (!['open', 'answered', 'closed'].includes(b.status)) return bad(res, 'Unknown status'); db.prepare('UPDATE tickets SET status=?, closed_at=?, updated_at=? WHERE id=?').run(b.status, b.status === 'closed' ? n : null, n, t.id); audit(req, 'ticket_' + b.status, `#${t.id}`); }
    if (b.priority !== undefined) { if (!['normal', 'high'].includes(b.priority)) return bad(res, 'Unknown priority'); db.prepare('UPDATE tickets SET priority=? WHERE id=?').run(b.priority, t.id); }
    if (b.assignedTo !== undefined) db.prepare('UPDATE tickets SET assigned_to=? WHERE id=?').run(b.assignedTo === 'me' ? req.user.id : null, t.id);
    res.json({ ok: true });
  });
}
