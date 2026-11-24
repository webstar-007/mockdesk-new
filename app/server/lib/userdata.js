// A person's data across every table that refers to them. Used for "download everything we hold" and "erase this person".
const KEYS = ['user_id', 'student_id', 'referrer_id', 'friend_id'];
const SKIP_EXPORT = new Set(['sessions', 'otps', 'push_subs']);
const colsOf = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
export function owned(db) {
  const out = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    if (name === 'users' || name === 'audit') continue;
    const k = colsOf(db, name).filter((c) => KEYS.includes(c)); if (k.length) out.push({ table: name, keys: k });
  }
  return out;
}
export function exportUser(db, id) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!u) return null;
  const { salt, hash, ...profile } = u; void salt; void hash; const data = {};
  for (const { table, keys } of owned(db)) {
    if (SKIP_EXPORT.has(table)) continue;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${keys.map((k) => `${k}=?`).join(' OR ')} LIMIT 5000`).all(...keys.map(() => id));
    if (rows.length) data[table] = rows.map((r) => { const o = { ...r }; for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && /^[\[{]/.test(v) && v.length < 2e6) { try { o[k] = JSON.parse(v); } catch { /* keep text */ } } } delete o.token_hash; return o; });
  }
  const msgs = db.prepare('SELECT m.* FROM ticket_msgs m JOIN tickets t ON t.id=m.ticket_id WHERE t.user_id=? AND m.note=0').all(id); if (msgs.length) data.ticket_messages = msgs;
  return { app: 'mockdesk', kind: 'personal-data', exportedAt: new Date().toISOString(), profile, data };
}
/** Remove the account and everything linked to it. Returns the number of rows removed per table. */
export function eraseUser(db, id) {
  const removed = {}; db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM ticket_msgs WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id=?)').run(id);
    for (const { table, keys } of owned(db)) { const n = Number(db.prepare(`DELETE FROM ${table} WHERE ${keys.map((k) => `${k}=?`).join(' OR ')}`).run(...keys.map(() => id)).changes); if (n) removed[table] = n; }
    db.prepare('UPDATE users SET referred_by=NULL WHERE referred_by=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id); removed.users = 1; db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return removed;
}
