// Notifications: in-app inbox, web push (free) and email. One place decides who may be contacted, how often and how it is logged.
import { siteOf, limitsOf } from './site.js';
import crypto from 'node:crypto';
import { on } from './credentials.js';

export const defaultPrefs = { inapp: true, push: true, email: true, whatsapp: false, digest: true, events: true };
export const prefsOf = (u) => { try { return { ...defaultPrefs, ...JSON.parse(u?.notify_prefs || '{}') }; } catch { return { ...defaultPrefs }; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Email sender built from the same SMTP settings as sign-in codes. Returns null when no SMTP is set up. */
export function makeMailer(env = process.env) {
  if (!env.SMTP_HOST) return null;
  let t;
  return {
    async send({ to, subject, text, html, headers }) {
      if (!t) { const { default: nodemailer } = await import('nodemailer'); t = nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === '1' || Number(env.SMTP_PORT) === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined }); }
      await t.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to, subject, text, html, headers });
    },
  };
}

/** Web push sender. Needs HTTPS in the browser; keys are created once and kept in settings. */
export function makePusher(settings, env = process.env) {
  let wp; let ready = false;
  async function init() {
    if (ready) return wp;
    wp = (await import('web-push')).default;
    let keys = env.MOCKDESK_VAPID_PUBLIC && env.MOCKDESK_VAPID_PRIVATE ? { publicKey: env.MOCKDESK_VAPID_PUBLIC, privateKey: env.MOCKDESK_VAPID_PRIVATE } : settings.get('vapid');
    if (!keys) keys = settings.set('vapid', wp.generateVAPIDKeys());
    wp.setVapidDetails(env.MOCKDESK_VAPID_SUBJECT || `mailto:${env.MAIL_FROM || 'admin@example.com'}`.replace(/^mailto:.*<(.+)>$/, 'mailto:$1'), keys.publicKey, keys.privateKey);
    ready = keys.publicKey; return wp;
  }
  return {
    async publicKey() { await init(); return ready; },
    async send(sub, payload) { const w = await init(); return w.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 86400 }); },
  };
}

/**
 * WhatsApp sender. Two providers: Meta WhatsApp Cloud API (WHATSAPP_PROVIDER=meta) or Twilio (WHATSAPP_PROVIDER=twilio).
 * Messages that start a conversation must use a template approved by WhatsApp, with two variables: {{1}} = title, {{2}} = message.
 * Returns null when nothing is configured.
 */
export function makeWhatsApp(env = process.env) {
  const p = String(env.WHATSAPP_PROVIDER || '').toLowerCase();
  const clean = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 900);
  if (p === 'meta' && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE) {
    return { provider: 'meta', async send(to, { title, text }) {
      const r = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: String(to).replace(/^\+/, ''), type: 'template', template: { name: env.WHATSAPP_TEMPLATE, language: { code: env.WHATSAPP_LANG || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: clean(title) }, { type: 'text', text: clean(text) }] }] } }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`WhatsApp responded ${r.status} ${j?.error?.message || ''}`.trim()); }
    } };
  }
  if (p === 'twilio' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.WHATSAPP_FROM) {
    return { provider: 'twilio', async send(to, { title, text }) {
      const body = new URLSearchParams({ From: `whatsapp:${env.WHATSAPP_FROM}`, To: `whatsapp:${to}` });
      if (env.WHATSAPP_CONTENT_SID) { body.set('ContentSid', env.WHATSAPP_CONTENT_SID); body.set('ContentVariables', JSON.stringify({ 1: clean(title), 2: clean(text) })); } else body.set('Body', `${clean(title)}\n${clean(text)}`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64') }, body });
      if (!r.ok) throw new Error(`Twilio responded ${r.status}`);
    } };
  }
  return null;
}

export const WA_DEFAULTS = { enabled: false, kinds: ['reminder', 'digest', 'live_results'], weeklyCap: 2, costInr: 0.9 };

export function createNotifier({ db, now, settings, mailer = null, pusher = null, whatsapp = null, publicUrl = process.env.MOCKDESK_PUBLIC_URL || '' }) {
  const DAY = 86400000;
  const baseUrl = () => (siteOf(settings, { MOCKDESK_PUBLIC_URL: publicUrl }).publicUrl || '');
  const emailDailyCap = () => limitsOf(settings).emailDailyCap;
  const mac = (s) => crypto.createHmac('sha256', settings.secret()).update(s).digest('hex');
  const token = (uid) => mac(`unsub:${uid}`).slice(0, 24);
  const unsubUrl = (uid) => `${baseUrl()}/api/unsubscribe?u=${uid}&t=${token(uid)}`;
  const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const tokenOk = (uid, t) => same(token(uid), t);
  const sig = (id) => mac(`n:${id}`).slice(0, 16);
  const sigOk = (id, s) => same(sig(id), s);
  const trackedPath = (id) => `/api/r/${id}/${sig(id)}`;
  const waCfg = () => ({ ...WA_DEFAULTS, ...settings.get('whatsapp', {}) });
  const log = (userId, channel, kind, ref, status, error = null) => { try { db.prepare('INSERT OR IGNORE INTO deliveries(user_id,channel,kind,ref,status,error,at) VALUES (?,?,?,?,?,?,?)').run(userId, channel, kind, ref || null, status, error && String(error).slice(0, 200), now()); } catch { /* logging must never break sending */ } };
  const count = (uid, sinceMs, channels) => db.prepare(`SELECT COUNT(*) c FROM deliveries WHERE user_id=? AND status='sent' AND channel IN (${channels.map(() => '?').join(',')}) AND kind!='announcement' AND at>?`).get(uid, ...channels, now() - sinceMs).c;
  const weeklyUsed = (uid) => count(uid, 7 * DAY, ['push', 'email', 'whatsapp']);
  const dailyUsed = (uid) => count(uid, DAY, ['push', 'email', 'whatsapp']);
  const waWeekly = (uid) => count(uid, 7 * DAY, ['whatsapp']);
  const emailsToday = () => db.prepare("SELECT COUNT(*) c FROM deliveries WHERE channel='email' AND status='sent' AND at>?").get(now() - DAY).c;
  const limits = () => { const r = settings.get('reminders', {}); return { weekly: r.weeklyCap ?? 4, daily: r.dailyCap ?? 2 }; };

  /**
   * Send one notification to one person. `channels` says which routes are allowed; their own preferences and limits still apply.
   * Every call keeps one row (hidden when the student does not want in-app messages) so opens and clicks can be counted.
   * A repeat with the same `ref` does nothing.
   */
  async function notify(userId, { kind, title, body = '', link = '/', ref = null, channels = {}, capped = true, campaignId = null }) {
    const ch = { inapp: true, push: true, email: true, whatsapp: false, ...channels };
    const u = db.prepare('SELECT id, name, email, phone, status, notify_prefs FROM users WHERE id=?').get(userId);
    if (!u || u.status === 'suspended') return { skipped: 'no such active user' };
    const prefs = prefsOf(u); const out = {}; const lim = limits();
    const show = ch.inapp && prefs.inapp;
    const r = db.prepare('INSERT OR IGNORE INTO notifications(user_id,kind,title,body,link,created_at,ref,campaign_id,hidden) VALUES (?,?,?,?,?,?,?,?,?)').run(userId, kind, title, body, link, now(), ref, campaignId, show ? 0 : 1);
    if (!r.changes) return { duplicate: true };
    const nid = Number(r.lastInsertRowid); const tp = trackedPath(nid);
    if (show) out.inapp = 'sent';
    const why = () => (weeklyUsed(userId) >= lim.weekly ? 'weekly limit' : dailyUsed(userId) >= lim.daily ? 'daily limit' : '');
    const overCap = capped ? why() : '';
    if (ch.push && prefs.push) {
      const subs = pusher ? db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(userId) : [];
      if (!subs.length) out.push = 'none';
      else if (overCap) { out.push = 'skipped'; log(userId, 'push', kind, ref, 'skipped', overCap); }
      else {
        let ok = 0; let last = '';
        for (const s of subs) {
          try { await pusher.send(s, { title, body, url: tp, tag: ref || kind }); ok++; } catch (e) { last = e?.message || String(e); if (e?.statusCode === 404 || e?.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint); }
        }
        out.push = ok ? 'sent' : 'failed'; log(userId, 'push', kind, ref, ok ? 'sent' : 'failed', ok ? null : last);
      }
    }
    if (ch.email && prefs.email && u.email) {
      if (!on(mailer)) { out.email = 'not configured'; log(userId, 'email', kind, ref, 'skipped', 'email not set up'); }
      else if (overCap) { out.email = 'skipped'; log(userId, 'email', kind, ref, 'skipped', overCap); }
      else if (emailsToday() >= emailDailyCap()) { out.email = 'skipped'; log(userId, 'email', kind, ref, 'skipped', 'daily email cap'); }
      else {
        const base = baseUrl(); const url = `${base}${tp}`; const un = unsubUrl(userId);
        try {
          await mailer.send({ to: u.email, subject: title, text: `${body}\n\n${base ? url : ''}\n\nStop these emails: ${un}`, headers: { 'List-Unsubscribe': `<${un}>` },
            html: `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2 style="margin:0 0 8px">${esc(title)}</h2><p style="font-size:16px;line-height:1.5;white-space:pre-line">${esc(body)}</p>${base ? `<p><a href="${esc(url)}" style="background:#1e3a8a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open MockDesk</a></p>` : ''}<p style="color:#64748b;font-size:12px">You get this because you have a ${esc(siteOf(settings).name)} account. <a href="${esc(un)}">Stop these emails</a>.</p>${base ? `<img src="${esc(`${base}/api/o/${nid}/${sig(nid)}.gif`)}" width="1" height="1" alt="" style="display:block">` : ''}</div>` });
          out.email = 'sent'; log(userId, 'email', kind, ref, 'sent');
        } catch (e) { out.email = 'failed'; log(userId, 'email', kind, ref, 'failed', e?.message); }
      }
    }
    if (ch.whatsapp) {
      const wc = waCfg();
      if (!on(whatsapp) || !wc.enabled) out.whatsapp = 'not configured';
      else if (!prefs.whatsapp || !u.phone) out.whatsapp = 'none';
      else if (kind !== 'campaign' && !wc.kinds.includes(kind)) out.whatsapp = 'none';
      else if (capped && waWeekly(userId) >= wc.weeklyCap) { out.whatsapp = 'skipped'; log(userId, 'whatsapp', kind, ref, 'skipped', 'weekly WhatsApp limit'); }
      else if (overCap === 'daily limit') { out.whatsapp = 'skipped'; log(userId, 'whatsapp', kind, ref, 'skipped', overCap); }
      else {
        try { await whatsapp.send(u.phone, { title, text: `${body}${baseUrl() ? ` ${baseUrl()}${tp}` : ''}` }); out.whatsapp = 'sent'; log(userId, 'whatsapp', kind, ref, 'sent'); } catch (e) { out.whatsapp = 'failed'; log(userId, 'whatsapp', kind, ref, 'failed', e?.message); }
      }
    }
    return { ...out, id: nid };
  }
  /** Run `fn` over items a few at a time so one slow mail server does not stall everything. */
  async function pool(items, size, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = items[i++]; await fn(k); } }; await Promise.all(Array.from({ length: Math.min(size, items.length) }, run)); }
  return { siteName: () => siteOf(settings).name, notify, pool, token, tokenOk, unsubUrl, sig, sigOk, trackedPath, waCfg, get hasMailer() { return on(mailer); }, hasPush: !!pusher, get hasWhatsApp() { return on(whatsapp); }, get whatsappProvider() { return on(whatsapp) ? whatsapp.provider || null : null; }, emailDailyCap, publicKey: pusher ? () => pusher.publicKey() : undefined };
}
