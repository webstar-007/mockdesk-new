// Parent or mentor view: a student shares a private link that shows a read-only weekly summary. No login, no email or phone shown.
import crypto from 'node:crypto';
import { dayKey, streakOf } from './lib/reminders.js';
const DAY = 86400000;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const MAX_ACTIVE = 5;

export function progressFor(db, uid, t) {
  const u = db.prepare('SELECT name, created_at FROM users WHERE id=?').get(uid); if (!u) return null;
  const rows = db.prepare("SELECT id, mock_id, started_at, submitted_at, result FROM attempts WHERE user_id=? AND status='submitted' AND result IS NOT NULL AND submitted_at>? ORDER BY submitted_at DESC").all(uid, t - 60 * DAY).map((a) => ({ ...a, r: parse(a.result) })).filter((a) => a.r?.summary);
  const tests = rows.filter((a) => a.mock_id !== 'practice');
  const weeks = []; for (let w = 7; w >= 0; w--) {
    const lo = t - (w + 1) * 7 * DAY; const hi = t - w * 7 * DAY; const inW = tests.filter((a) => a.submitted_at > lo && a.submitted_at <= hi); const ps = inW.map((a) => Number(a.r.summary.percentage)).filter(Number.isFinite);
    weeks.push({ endsOn: new Date(hi).toISOString().slice(0, 10), tests: inW.length, avg: ps.length ? Math.round(ps.reduce((x, y) => x + y, 0) / ps.length) : null });
  }
  const topics = new Map(); for (const a of rows.filter((x) => x.submitted_at > t - 30 * DAY)) for (const x of a.r.topics || []) { if (x.qualifying) continue; const k = `${x.section}:${x.topic}`; const o = topics.get(k) || { topic: x.topic, total: 0, correct: 0 }; o.total += x.total || 0; o.correct += x.correct || 0; topics.set(k, o); }
  const ranked = [...topics.values()].filter((x) => x.total >= 4).map((x) => ({ topic: x.topic, pct: Math.round((x.correct / x.total) * 100), questions: x.total })).sort((a, b) => b.pct - a.pct);
  const days = new Set(db.prepare('SELECT started_at s FROM attempts WHERE user_id=? AND started_at>?').all(uid, t - 45 * DAY).map((x) => dayKey(x.s)));
  let practiceDays = 0; for (let i = 0; i < 7; i++) if (days.has(dayKey(t - i * DAY))) practiceDays++;
  const last = db.prepare('SELECT MAX(started_at) s FROM attempts WHERE user_id=?').get(uid).s;
  return { name: String(u.name || 'Student').trim().split(/\s+/)[0], memberSince: u.created_at, generatedAt: t, weeks, practiceDaysThisWeek: practiceDays, streak: streakOf(days, t), lastActive: last || null,
    testsLast30: tests.filter((a) => a.submitted_at > t - 30 * DAY).length, recent: tests.slice(0, 6).map((a) => ({ mock: a.r.attempt?.mockName || 'Mock', at: a.submitted_at, percentage: Number(a.r.summary.percentage), accuracy: Number(a.r.summary.accuracy) })),
    strongest: ranked.slice(0, 3), weakest: ranked.length > 3 ? ranked.slice(-3).reverse() : [] };
}

export function mountSharePublic(api, { db, now }) {
  api.get('/public/progress/:token', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    const l = db.prepare('SELECT * FROM share_links WHERE token_hash=?').get(hash(String(req.params.token))); const t = now();
    if (!l || l.revoked_at) return res.status(404).json({ error: 'This link is not active. Ask the student for a new one.' });
    if (l.expires_at && l.expires_at < t) return res.status(410).json({ error: 'This link has expired. Ask the student for a new one.' });
    db.prepare('UPDATE share_links SET views=views+1, last_viewed_at=? WHERE id=?').run(t, l.id);
    const p = progressFor(db, l.user_id, t); if (!p) return res.status(404).json({ error: 'This link is not active.' });
    res.json({ progress: p, expiresAt: l.expires_at, label: l.label });
  });
}

export function mountShare(api, { db, now }) {
  const out = (l) => ({ id: l.id, label: l.label, createdAt: l.created_at, expiresAt: l.expires_at, views: l.views, lastViewedAt: l.last_viewed_at, active: !l.revoked_at && (!l.expires_at || l.expires_at > now()) });
  api.get('/share-links', (req, res) => res.json({ links: db.prepare('SELECT * FROM share_links WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC').all(req.user.id).map(out), max: MAX_ACTIVE }));
  api.post('/share-links', (req, res) => {
    const t = now(); const active = db.prepare('SELECT COUNT(*) c FROM share_links WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').get(req.user.id, t).c;
    if (active >= MAX_ACTIVE) return res.status(400).json({ error: `You can have ${MAX_ACTIVE} active links. Stop sharing one first.` });
    const token = crypto.randomBytes(24).toString('base64url'); const days = [30, 90, 180].includes(Number(req.body?.days)) ? Number(req.body.days) : 90;
    const id = db.prepare('INSERT INTO share_links(user_id, token_hash, label, created_at, expires_at) VALUES (?,?,?,?,?)').run(req.user.id, hash(token), String(req.body?.label || '').trim().slice(0, 40) || 'Shared link', t, t + days * DAY).lastInsertRowid;
    res.status(201).json({ link: out(db.prepare('SELECT * FROM share_links WHERE id=?').get(id)), path: `/p/${token}` });
  });
  api.delete('/share-links/:id', (req, res) => { const x = db.prepare('UPDATE share_links SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL').run(now(), Number(req.params.id), req.user.id); if (!x.changes) return res.status(404).json({ error: 'Link not found' }); res.json({ ok: true }); });
}
