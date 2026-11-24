// v20 admin team page: who is staff, who is signed in, what each person changed, and one-click lockout.
const DAY = 86400000;
const STAFF = ['admin', 'editor', 'teacher'];

export function mountTeam({ r, db, now, audit, bad, jobs }) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const person = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status || 'active', lastSeen: u.last_seen || null, lastIp: u.last_ip || null });

  r.get('/team', (req, res) => {
    const t = now();
    const rows = all(`SELECT * FROM users WHERE role IN ('admin','editor','teacher') ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name`);
    const people = rows.map((u) => ({
      ...person(u),
      self: u.id === req.user.id,
      online: !!u.last_seen && t - u.last_seen < 5 * 60000,
      sessions: one('SELECT COUNT(*) c FROM sessions WHERE user_id=? AND expires_at>? AND view_by IS NULL', u.id, t).c,
      lastLogin: one('SELECT MAX(at) a FROM login_log WHERE user_id=? AND ok=1', u.id).a || null,
      failed24: one('SELECT COUNT(*) c FROM login_log WHERE user_id=? AND ok=0 AND at>?', u.id, t - DAY).c,
      actions7: u.role === 'teacher' ? one('SELECT COUNT(*) c FROM assignments WHERE teacher_id=? AND created_at>?', u.id, t - 7 * DAY).c : one('SELECT COUNT(*) c FROM audit WHERE admin_id=? AND at>?', u.id, t - 7 * DAY).c,
    }));
    res.json({ people, online: people.filter((p) => p.online).length, locked: people.filter((p) => p.status === 'suspended').length });
  });

  r.get('/team/:id', (req, res) => {
    const u = one('SELECT * FROM users WHERE id=?', req.params.id);
    if (!u || !STAFF.includes(u.role)) return bad(res, 'Staff member not found', 404);
    const t = now();
    res.json({
      person: person(u),
      actions: all('SELECT at, action, target, detail FROM audit WHERE admin_id=? ORDER BY id DESC LIMIT 100', u.id),
      assignments: u.role === 'teacher' ? all('SELECT a.id, a.title, a.due_at dueAt, a.created_at at, b.name batch FROM assignments a LEFT JOIN batches b ON b.id=a.batch_id WHERE a.teacher_id=? ORDER BY a.id DESC LIMIT 20', u.id) : [],
      logins: all('SELECT at, ok, method, ip, ua, note FROM login_log WHERE user_id=? ORDER BY id DESC LIMIT 20', u.id).map((x) => ({ ...x, ok: !!x.ok })),
      sessions: all('SELECT id, ip, ua, created_at createdAt, expires_at expiresAt FROM sessions WHERE user_id=? AND expires_at>? AND view_by IS NULL ORDER BY created_at DESC', u.id, t).map((s) => ({ ...s, id: String(s.id).slice(0, 8) })),
    });
  });

  const target = (req, res) => {
    const u = one('SELECT * FROM users WHERE id=?', req.params.id);
    if (!u || !STAFF.includes(u.role)) { bad(res, 'Staff member not found', 404); return null; }
    if (u.id === req.user.id) { bad(res, 'You cannot do this to your own account'); return null; }
    return u;
  };
  const lock = (u, req, why) => {
    db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(u.id);
    const n = db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id).changes;
    audit(req, 'staff_lockout', u.email || u.phone || String(u.id), why ? `${n} session(s) ended. ${why}` : `${n} session(s) ended`);
    return n;
  };
  r.post('/team/:id/lock', (req, res) => {
    const u = target(req, res); if (!u) return;
    if (u.role === 'admin' && one("SELECT COUNT(*) c FROM users WHERE role='admin' AND COALESCE(status,'active')='active' AND id!=?", u.id).c < 1) return bad(res, 'That would leave no active admin');
    res.json({ ok: true, signedOut: lock(u, req, String(req.body?.reason || '').slice(0, 200)) });
  });
  r.post('/team/:id/unlock', (req, res) => {
    const u = target(req, res); if (!u) return;
    db.prepare("UPDATE users SET status='active' WHERE id=?").run(u.id); audit(req, 'staff_unlock', u.email || u.phone || String(u.id)); res.json({ ok: true });
  });
  r.post('/team/:id/signout', (req, res) => {
    const u = target(req, res); if (!u) return;
    const n = db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id).changes; audit(req, 'staff_signout', u.email || u.phone || String(u.id), `${n} session(s)`); res.json({ ok: true, signedOut: n });
  });
  // Panic button: lock every teacher and staff account (never admins, never you).
  r.post('/team/lock-all', (req, res) => {
    const list = all("SELECT * FROM users WHERE role IN ('editor','teacher') AND COALESCE(status,'active')='active'");
    let n = 0; for (const u of list) { lock(u, req, 'Locked all staff'); n += 1; }
    res.json({ ok: true, locked: n });
  });

  // Alert when someone keeps getting a staff password wrong.
  jobs?.alerts?.addCheck('staff-logins', ({ raise, resolve }) => {
    const bads = all(`SELECT u.name, COUNT(*) n FROM login_log l JOIN users u ON u.id=l.user_id WHERE l.ok=0 AND l.at>? AND u.role IN ('admin','editor','teacher') GROUP BY l.user_id HAVING n>=5 ORDER BY n DESC`, now() - DAY);
    if (!bads.length) return resolve('staff-logins');
    raise('staff-logins', { kind: 'security', level: 'warn', title: `Repeated failed sign-ins on ${bads.length} staff account${bads.length > 1 ? 's' : ''}`, body: `${bads.slice(0, 3).map((b) => `${b.name} (${b.n})`).join(', ')} in the last 24 hours. If it is not them, lock the account.`, link: 'team' });
  });
}
