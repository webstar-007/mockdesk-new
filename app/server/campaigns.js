// Admin messages: write once, pick who and when, send by in-app, push, email and WhatsApp, then see who opened and clicked.
import { AUDIENCES, audienceCount, audienceIds } from './lib/audience.js';
import { prefsOf } from './lib/notify.js';
const DAY = 86400000;
const CHANNELS = ['inapp', 'push', 'email', 'whatsapp'];
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function campaignStats(db, c) {
  const n = db.prepare('SELECT COUNT(*) total, SUM(CASE WHEN COALESCE(hidden,0)=0 THEN 1 ELSE 0 END) inapp, SUM(CASE WHEN opened_at IS NOT NULL OR read_at IS NOT NULL THEN 1 ELSE 0 END) opened, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) clicked FROM notifications WHERE campaign_id=?').get(c.id);
  const by = {}; for (const r of db.prepare('SELECT channel, status, COUNT(*) k FROM deliveries WHERE ref=? GROUP BY channel, status').all(`camp:${c.id}`)) (by[r.channel] ||= {})[r.status] = r.k;
  return { targeted: n.total || 0, inapp: n.inapp || 0, opened: n.opened || 0, clicked: n.clicked || 0, channels: by };
}
const shape = (db, c) => ({ id: c.id, title: c.title, body: c.body, link: c.link, channels: parse(c.channels, {}), audience: c.audience, batchId: c.batch_id, ignoreLimits: !!c.ignore_limits, sendAt: c.send_at, status: c.status, createdBy: c.created_by, createdAt: c.created_at, sentAt: c.sent_at, audienceSize: c.audience_size, stats: c.status === 'scheduled' ? null : campaignStats(db, c) });

/** Send every scheduled message whose time has come. Safe to call often. */
export async function runCampaigns({ db, notifier, now }) {
  const t = now(); let sent = 0;
  for (const c of db.prepare("SELECT * FROM campaigns WHERE status='scheduled' AND send_at<=?").all(t)) {
    const claim = db.prepare("UPDATE campaigns SET status='sending' WHERE id=? AND status='scheduled'").run(c.id); if (!claim.changes) continue;
    const ids = audienceIds(db, c.audience || 'all', c.batch_id, t); const channels = parse(c.channels, {});
    db.prepare('UPDATE campaigns SET audience_size=? WHERE id=?').run(ids.length, c.id);
    await notifier.pool(ids, 8, async (id) => { await notifier.notify(id, { kind: 'campaign', title: c.title, body: c.body, link: c.link || '/', ref: `camp:${c.id}`, campaignId: c.id, capped: !c.ignore_limits, channels: { inapp: !!channels.inapp, push: !!channels.push, email: !!channels.email, whatsapp: !!channels.whatsapp } }); sent++; });
    db.prepare("UPDATE campaigns SET status='sent', sent_at=? WHERE id=?").run(now(), c.id);
  }
  return sent;
}

export function mountCampaigns({ r, db, now, audit, bad, notifier }) {
  const reach = (audience, batchId) => {
    const t = now(); const ids = audienceIds(db, audience, batchId, t); const wa = notifier.waCfg(); const out = { audience: ids.length, inapp: 0, push: 0, email: 0, whatsapp: 0 };
    const pushers = new Set(db.prepare('SELECT DISTINCT user_id FROM push_subs').all().map((x) => x.user_id));
    for (const id of ids) {
      const u = db.prepare('SELECT email, phone, notify_prefs FROM users WHERE id=?').get(id); const p = prefsOf(u);
      if (p.inapp) out.inapp++; if (p.push && pushers.has(id) && notifier.hasPush) out.push++; if (p.email && u.email && notifier.hasMailer) out.email++; if (p.whatsapp && u.phone && notifier.hasWhatsApp && wa.enabled) out.whatsapp++;
    }
    out.whatsappCostInr = Math.round(out.whatsapp * (Number(wa.costInr) || 0) * 100) / 100; return out;
  };
  const meta = () => ({ audiences: AUDIENCES.map(([key, label]) => ({ key, label })), batches: db.prepare('SELECT id, name FROM batches WHERE archived=0 ORDER BY name').all(), available: { inapp: true, push: notifier.hasPush, email: notifier.hasMailer, whatsapp: notifier.hasWhatsApp && !!notifier.waCfg().enabled } });

  r.get('/messages', (req, res) => res.json({ ...meta(), campaigns: db.prepare('SELECT * FROM campaigns ORDER BY COALESCE(sent_at, send_at) DESC, id DESC LIMIT 60').all().map((c) => shape(db, c)) }));
  r.get('/messages/preview', (req, res) => res.json(reach(String(req.query.audience || 'all'), req.query.batchId)));
  r.get('/messages/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(Number(req.params.id)); if (!c) return bad(res, 'Message not found', 404);
    res.json({ campaign: shape(db, c), failures: db.prepare("SELECT d.channel, d.error, d.at, u.name FROM deliveries d LEFT JOIN users u ON u.id=d.user_id WHERE d.ref=? AND d.status IN ('failed','skipped') ORDER BY d.at DESC LIMIT 20").all(`camp:${c.id}`) });
  });
  const read = (b) => {
    const title = String(b.title || '').trim().slice(0, 80); const body = String(b.body || '').trim().slice(0, 300); const link = String(b.link || '/').trim().slice(0, 300) || '/';
    if (!title) return { error: 'Add a title' }; if (!body) return { error: 'Add a message' };
    if (!/^(\/(?!\/)|https?:\/\/)/.test(link)) return { error: 'The link must start with / or https://' };
    const channels = Object.fromEntries(CHANNELS.map((k) => [k, !!b.channels?.[k]])); if (!Object.values(channels).some(Boolean)) return { error: 'Choose at least one way to send it' };
    const av = meta().available; for (const k of CHANNELS) if (channels[k] && !av[k]) return { error: `${k === 'whatsapp' ? 'WhatsApp' : k === 'push' ? 'Push' : 'Email'} is not set up yet` };
    const audience = AUDIENCES.some(([k]) => k === b.audience) ? b.audience : 'all'; const batchId = audience === 'batch' ? Number(b.batchId) || 0 : null; if (audience === 'batch' && !db.prepare('SELECT 1 FROM batches WHERE id=?').get(batchId)) return { error: 'Choose a batch' };
    return { v: { title, body, link, channels, audience, batchId, ignoreLimits: !!b.ignoreLimits } };
  };
  r.post('/messages', async (req, res) => {
    const { v, error } = read(req.body || {}); if (error) return bad(res, error);
    const t = now(); const sendAt = req.body?.sendAt ? Number(req.body.sendAt) : t; if (!Number.isFinite(sendAt) || sendAt > t + 60 * DAY) return bad(res, 'Pick a time within the next 60 days');
    const id = db.prepare("INSERT INTO campaigns(title,body,link,channels,audience,batch_id,ignore_limits,send_at,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?, 'scheduled', ?,?)").run(v.title, v.body, v.link, JSON.stringify(v.channels), v.audience, v.batchId, v.ignoreLimits ? 1 : 0, Math.max(sendAt, 0), req.user.name, t).lastInsertRowid;
    audit(req, 'message_create', v.title, `${v.audience}${sendAt > t ? ' scheduled' : ' now'}`);
    if (sendAt <= t) await runCampaigns({ db, notifier, now });
    res.status(201).json({ campaign: shape(db, db.prepare('SELECT * FROM campaigns WHERE id=?').get(id)) });
  });
  r.post('/messages/:id/cancel', (req, res) => {
    const x = db.prepare("UPDATE campaigns SET status='cancelled' WHERE id=? AND status='scheduled'").run(Number(req.params.id)); if (!x.changes) return bad(res, 'Only a scheduled message can be cancelled');
    audit(req, 'message_cancel', String(req.params.id)); res.json({ ok: true });
  });
  r.post('/messages/test', async (req, res) => {
    const { v, error } = read(req.body || {}); if (error) return bad(res, error);
    const out = await notifier.notify(req.user.id, { kind: 'campaign', title: v.title, body: v.body, link: v.link, ref: `camptest:${req.user.id}:${now()}`, capped: false, channels: v.channels });
    res.json({ result: out });
  });
  r.get('/messages-audience', (req, res) => res.json({ count: audienceCount(db, String(req.query.audience || 'all'), req.query.batchId, now()) }));
}
