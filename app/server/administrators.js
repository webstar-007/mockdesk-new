// v22 Administrators: who can run the platform, what each person may do, invitations for people who have not signed up yet,
// and the rules that keep the admin team safe (a cap, notices, inactive-account checks).
import { DEFAULT_ADMINS, readAdmins, adminsFile } from './lib/admins.js';
import { PERMS, PRESETS, cleanPerms, permsOf } from './lib/perms.js';
import { normEmail, normPhone } from './lib/otp.js';

const DAY = 86400000;
export const SEC_DEFAULTS = { maxAdmins: 10, notifyAdmins: true, inactiveDays: 0, defaultPreset: 'content' };
const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const cleanSec = (b = {}) => ({ maxAdmins: clampN(b.maxAdmins, 1, 50, SEC_DEFAULTS.maxAdmins), notifyAdmins: b.notifyAdmins !== false, inactiveDays: b.inactiveDays ? clampN(b.inactiveDays, 7, 365, 0) : 0, defaultPreset: PRESETS.some((p) => p.key === b.defaultPreset) ? b.defaultPreset : SEC_DEFAULTS.defaultPreset });
const presetOf = (perms) => { const k = [...perms].sort().join(','); return PRESETS.find((p) => [...p.perms].sort().join(',') === k)?.key || (perms.length > 1 ? 'custom' : 'content'); };

export function mountAdministrators({ r, db, now, audit, bad, settings, notifier, jobs }) {
  const one = (sql, ...a) => db.prepare(sql).get(...a); const all = (sql, ...a) => db.prepare(sql).all(...a);
  const cfg = () => ({ ...SEC_DEFAULTS, ...(settings.get('adminsec', {}) || {}) });
  const label = (u) => u.email || u.phone || String(u.id);
  const builtIn = (u) => !!u.email && DEFAULT_ADMINS.includes(String(u.email).toLowerCase());
  const activeAdmins = (except) => one("SELECT COUNT(*) c FROM users WHERE role='admin' AND COALESCE(status,'active')='active' AND id!=?", except ?? -1).c;
  const tell = (req, title, body) => {
    if (!cfg().notifyAdmins || !notifier) return;
    for (const a of all("SELECT id FROM users WHERE role='admin' AND COALESCE(status,'active')='active' AND id!=?", req.user.id)) { try { notifier.notify(a.id, { kind: 'security', title, body, link: '/admin/administrators', channels: ['inbox'] }); } catch { /* notices are best effort */ } }
  };
  const personOf = (u, t) => {
    const perms = u.role === 'editor' ? permsOf(u) : u.role === 'admin' ? Object.keys(PERMS) : [];
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status || 'active', createdAt: u.created_at || null, lastSeen: u.last_seen || null, lastIp: u.last_ip || null,
      online: !!u.last_seen && t - u.last_seen < 5 * 60000, builtIn: builtIn(u), perms, preset: u.role === 'editor' ? presetOf(perms) : null,
      sessions: one('SELECT COUNT(*) c FROM sessions WHERE user_id=? AND expires_at>? AND view_by IS NULL', u.id, t).c,
      lastLogin: one('SELECT MAX(at) a FROM login_log WHERE user_id=? AND ok=1', u.id).a || null,
      failed24: one('SELECT COUNT(*) c FROM login_log WHERE user_id=? AND ok=0 AND at>?', u.id, t - DAY).c,
      actions7: u.role === 'teacher' ? one('SELECT COUNT(*) c FROM assignments WHERE teacher_id=? AND created_at>?', u.id, t - 7 * DAY).c : one('SELECT COUNT(*) c FROM audit WHERE admin_id=? AND at>?', u.id, t - 7 * DAY).c,
    };
  };

  r.get('/administrators', (req, res) => {
    const t = now(); const rows = all("SELECT * FROM users WHERE role IN ('admin','editor','teacher') ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name");
    const people = rows.map((u) => ({ ...personOf(u, t), self: u.id === req.user.id }));
    const file = readAdmins(); const listed = [...file.emails, ...file.phones].filter((x) => !DEFAULT_ADMINS.includes(x)).map((x) => ({ contact: x, role: 'admin' })).concat([...file.editorEmails, ...file.editorPhones].map((x) => ({ contact: x, role: 'editor' })));
    const c = cfg(); const inactive = c.inactiveDays ? people.filter((p) => !p.self && !p.builtIn && p.status === 'active' && (p.lastSeen || p.createdAt || 0) < t - c.inactiveDays * DAY).map((p) => p.id) : [];
    res.json({
      people, inactive, config: c, perms: PERMS, presets: PRESETS, me: req.user.id,
      invites: all('SELECT id, contact, kind, role, perms, by_name byName, at FROM admin_invites ORDER BY at DESC').map((i) => ({ ...i, perms: JSON.parse(i.perms || '[]') })),
      counts: { admins: people.filter((p) => p.role === 'admin').length, staff: people.filter((p) => p.role === 'editor').length, teachers: people.filter((p) => p.role === 'teacher').length, online: people.filter((p) => p.online).length, locked: people.filter((p) => p.status === 'suspended').length },
      file: { path: adminsFile(), listed, ignored: file.ignored },
    });
  });

  r.post('/administrators/invite', (req, res) => {
    const b = req.body || {}; const role = b.role === 'editor' ? 'editor' : b.role === 'admin' ? 'admin' : null; if (!role) return bad(res, 'Choose Admin or Staff.');
    const raw = String(b.contact || '').trim(); const email = raw.includes('@') ? normEmail(raw) : null; const phone = raw.includes('@') ? null : normPhone(raw);
    if (!email && !phone) return bad(res, 'Enter a valid email address or mobile number.');
    const preset = PRESETS.find((p) => p.key === b.preset); const perms = role === 'editor' ? cleanPerms(b.perms ?? (preset || PRESETS.find((p) => p.key === cfg().defaultPreset) || PRESETS[0]).perms) : [];
    const c = cfg(); const pendingAdmins = one("SELECT COUNT(*) c FROM admin_invites WHERE role='admin'").c;
    if (role === 'admin' && one("SELECT COUNT(*) c FROM users WHERE role='admin'").c + pendingAdmins >= c.maxAdmins) return bad(res, `You already have ${c.maxAdmins} admins (the limit you set). Raise the limit below, or remove someone first.`);
    const u = email ? one('SELECT * FROM users WHERE email=?', email) : one('SELECT * FROM users WHERE phone=?', phone);
    if (u) {
      if (u.id === req.user.id) return bad(res, 'That is your own account.');
      if (u.role === 'admin' || (u.role === 'editor' && role === 'editor')) return bad(res, `${u.name} is already ${u.role === 'admin' ? 'an admin' : 'staff'}. Change their access in the list instead.`);
      db.prepare('UPDATE users SET role=?, perms=? WHERE id=?').run(role, role === 'editor' ? JSON.stringify(perms) : null, u.id);
      db.prepare('DELETE FROM admin_invites WHERE contact=?').run(email || phone);
      audit(req, 'admin_promote', label(u), role === 'editor' ? `staff: ${perms.join(',')}` : 'admin'); tell(req, `${u.name} is now ${role === 'admin' ? 'an admin' : 'staff'}`, `${req.user.name} changed ${u.name}'s role.`);
      return res.status(201).json({ ok: true, status: 'promoted', name: u.name });
    }
    db.prepare('INSERT INTO admin_invites(contact,kind,role,perms,by_name,at) VALUES (?,?,?,?,?,?) ON CONFLICT(contact) DO UPDATE SET role=excluded.role, perms=excluded.perms, by_name=excluded.by_name, at=excluded.at').run(email || phone, email ? 'email' : 'phone', role, JSON.stringify(perms), req.user.name, now());
    audit(req, 'admin_invite', email || phone, role); tell(req, `${role === 'admin' ? 'Admin' : 'Staff'} invitation added`, `${req.user.name} invited ${email || phone}.`);
    res.status(201).json({ ok: true, status: 'invited' });
  });
  r.delete('/administrators/invites/:id', (req, res) => { const i = one('SELECT * FROM admin_invites WHERE id=?', req.params.id); if (!i) return bad(res, 'Invitation not found', 404); db.prepare('DELETE FROM admin_invites WHERE id=?').run(i.id); audit(req, 'admin_invite_cancel', i.contact); res.json({ ok: true }); });

  const person = (req, res) => {
    const u = one('SELECT * FROM users WHERE id=?', req.params.id);
    if (!u || !['admin', 'editor'].includes(u.role)) { bad(res, 'Administrator not found', 404); return null; }
    return u;
  };
  r.put('/administrators/:id', (req, res) => {
    const u = person(req, res); if (!u) return; const b = req.body || {}; const self = u.id === req.user.id; const changes = [];
    if (b.role !== undefined && b.role !== u.role) {
      if (!['admin', 'editor'].includes(b.role)) return bad(res, 'Choose Admin or Staff.'); if (self) return bad(res, 'You cannot change your own role.'); if (builtIn(u)) return bad(res, 'The built-in admin account always stays an admin.');
      if (b.role === 'editor' && activeAdmins(u.id) < 1) return bad(res, 'That would leave no active admin.');
      if (b.role === 'admin' && one("SELECT COUNT(*) c FROM users WHERE role='admin'").c >= cfg().maxAdmins) return bad(res, `You already have ${cfg().maxAdmins} admins (the limit you set).`);
      db.prepare('UPDATE users SET role=?, perms=? WHERE id=?').run(b.role, b.role === 'editor' ? JSON.stringify(cleanPerms(b.perms ?? PRESETS.find((p) => p.key === cfg().defaultPreset)?.perms)) : null, u.id); changes.push(`role ${u.role} to ${b.role}`); audit(req, 'user_role', label(u), b.role);
    } else if ((b.perms !== undefined || b.preset !== undefined) && u.role === 'editor') {
      if (self) return bad(res, 'You cannot change your own access.');
      const next = cleanPerms(b.perms ?? PRESETS.find((p) => p.key === b.preset)?.perms); db.prepare('UPDATE users SET perms=? WHERE id=?').run(JSON.stringify(next), u.id); changes.push(`access: ${next.join(', ')}`); audit(req, 'user_perms', label(u), next.join(','));
    }
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 80); if (!n) return bad(res, 'Name cannot be empty.'); if (n !== u.name) { db.prepare('UPDATE users SET name=? WHERE id=?').run(n, u.id); audit(req, 'user_rename', label(u), `${u.name} to ${n}`); } }
    if (changes.length) tell(req, `Access changed for ${u.name}`, `${req.user.name}: ${changes.join('; ')}.`);
    res.json({ ok: true, person: personOf(one('SELECT * FROM users WHERE id=?', u.id), now()) });
  });
  r.delete('/administrators/:id', (req, res) => {
    const u = person(req, res); if (!u) return;
    if (u.id === req.user.id) return bad(res, 'You cannot remove your own access.'); if (builtIn(u)) return bad(res, 'The built-in admin account cannot be removed.');
    if (u.role === 'admin' && activeAdmins(u.id) < 1) return bad(res, 'That would leave no active admin.');
    db.prepare("UPDATE users SET role='student', perms=NULL WHERE id=?").run(u.id); const n = db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id).changes;
    audit(req, 'admin_remove', label(u), `was ${u.role}; ${n} session(s) ended`); tell(req, `${u.name} was removed from the admin team`, `${req.user.name} removed ${u.name}'s ${u.role === 'admin' ? 'admin' : 'staff'} access.`);
    res.json({ ok: true });
  });
  r.put('/administrators-config', (req, res) => { const next = cleanSec(req.body); const adm = one("SELECT COUNT(*) c FROM users WHERE role='admin'").c; if (next.maxAdmins < adm) return bad(res, `You already have ${adm} admins. Remove some first, or choose a higher limit.`); settings.set('adminsec', next); audit(req, 'admin_rules', '', JSON.stringify(next)); res.json({ ok: true, config: next }); });
  r.post('/administrators-lock-inactive', (req, res) => {
    const c = cfg(); if (!c.inactiveDays) return bad(res, 'Turn on the inactive-account rule first.'); const t = now(); let n = 0;
    for (const u of all("SELECT * FROM users WHERE role IN ('admin','editor','teacher') AND COALESCE(status,'active')='active' AND id!=?", req.user.id)) {
      if (builtIn(u) || (u.last_seen || u.created_at || 0) >= t - c.inactiveDays * DAY) continue;
      if (u.role === 'admin' && activeAdmins(u.id) < 1) continue;
      db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); audit(req, 'staff_lockout', label(u), `Inactive for ${c.inactiveDays}+ days`); n += 1;
    }
    res.json({ ok: true, locked: n });
  });

  jobs?.alerts?.addCheck('staff-inactive', ({ raise, resolve }) => {
    const c = cfg(); if (!c.inactiveDays) return resolve('staff-inactive'); const t = now();
    const idle = all("SELECT name FROM users WHERE role IN ('admin','editor','teacher') AND COALESCE(status,'active')='active' AND COALESCE(last_seen, created_at, 0) < ?", t - c.inactiveDays * DAY).filter((u) => !DEFAULT_ADMINS.includes(String(u.email || '')));
    if (!idle.length) return resolve('staff-inactive');
    raise('staff-inactive', { kind: 'security', level: 'info', title: `${idle.length} staff account${idle.length > 1 ? 's' : ''} unused for ${c.inactiveDays}+ days`, body: `${idle.slice(0, 3).map((u) => u.name).join(', ')}${idle.length > 3 ? ' and more' : ''}. Lock accounts nobody uses.`, link: 'administrators' });
  });
}
