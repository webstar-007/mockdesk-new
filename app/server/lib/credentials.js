// Keys and connection details an admin types into Admin > Integrations.
// Values are encrypted in the database (AES-256-GCM). The encryption key lives in a separate file next to the database,
// or in MOCKDESK_SECRET_KEY, so a copy of the database alone does not reveal them.
// A value set here wins over the same name in the server settings (environment variables).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const opt = (arr) => arr.map(([value, label]) => ({ value, label }));
export const GROUPS = [
  { id: 'email', name: 'Email (SMTP)', help: 'Sign-in codes, reminders, digests and broadcasts. Works with Amazon SES, Brevo, Zoho, Gmail app passwords and any SMTP service.', fields: [
    { key: 'SMTP_HOST', label: 'SMTP server', ph: 'email-smtp.ap-south-1.amazonaws.com' }, { key: 'SMTP_PORT', label: 'Port', ph: '587', num: true },
    { key: 'SMTP_SECURE', label: 'Connection', type: 'select', options: opt([['', 'Automatic (port 465 is secure)'], ['1', 'Always secure (SSL)'], ['0', 'STARTTLS']]) },
    { key: 'SMTP_USER', label: 'Username' }, { key: 'SMTP_PASS', label: 'Password', secret: true }, { key: 'MAIL_FROM', label: 'Send from', ph: 'MockDesk <no-reply@yourdomain.com>' } ] },
  { id: 'sms', name: 'SMS sign-in codes', help: 'Needed only if students sign in with a mobile number.', fields: [
    { key: 'SMS_PROVIDER', label: 'Provider', type: 'select', options: opt([['', 'Off'], ['twilio', 'Twilio'], ['msg91', 'MSG91']]) },
    { key: 'TWILIO_ACCOUNT_SID', label: 'Twilio account SID', when: 'twilio' }, { key: 'TWILIO_AUTH_TOKEN', label: 'Twilio auth token', secret: true, when: 'twilio' },
    { key: 'TWILIO_FROM', label: 'Twilio sender number', ph: '+1xxxxxxxxxx', when: 'twilio' }, { key: 'TWILIO_MESSAGING_SERVICE_SID', label: 'Twilio messaging service SID (optional)', when: 'twilio' },
    { key: 'MSG91_AUTH_KEY', label: 'MSG91 auth key', secret: true, when: 'msg91' }, { key: 'MSG91_TEMPLATE_ID', label: 'MSG91 template ID', when: 'msg91' } ] },
  { id: 'whatsapp', name: 'WhatsApp', help: 'Reminders and broadcasts on WhatsApp. Turn the rules on in Messages > Reminder rules.', fields: [
    { key: 'WHATSAPP_PROVIDER', label: 'Provider', type: 'select', options: opt([['', 'Off'], ['meta', 'Meta WhatsApp Cloud API'], ['twilio', 'Twilio']]) },
    { key: 'WHATSAPP_TOKEN', label: 'Meta access token', secret: true, when: 'meta' }, { key: 'WHATSAPP_PHONE_ID', label: 'Meta phone number ID', when: 'meta' },
    { key: 'WHATSAPP_TEMPLATE', label: 'Approved template name', when: 'meta' }, { key: 'WHATSAPP_LANG', label: 'Template language', ph: 'en', when: 'meta' },
    { key: 'TWILIO_ACCOUNT_SID', label: 'Twilio account SID', when: 'twilio', shared: 'sms' }, { key: 'TWILIO_AUTH_TOKEN', label: 'Twilio auth token', secret: true, when: 'twilio', shared: 'sms' },
    { key: 'WHATSAPP_FROM', label: 'Twilio WhatsApp number', ph: '+14155238886', when: 'twilio' }, { key: 'WHATSAPP_CONTENT_SID', label: 'Twilio content SID (optional)', when: 'twilio' } ] },
  { id: 'ai', name: 'AI model', help: 'Writes draft solutions for questions in Questions > Import and AI. Nothing is published until an editor approves it.', fields: [
    { key: 'AI_PROVIDER', label: 'Provider', type: 'select', options: opt([['', 'Anthropic (Claude)'], ['openai', 'OpenAI']]) },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', secret: true, when: '' }, { key: 'OPENAI_API_KEY', label: 'OpenAI API key', secret: true, when: 'openai' },
    { key: 'MOCKDESK_AI_MODEL', label: 'Model name', ph: 'claude-sonnet-5-5' } ] },
  { id: 'push', name: 'Browser notifications', help: 'The keys are created for you. Only the contact address is needed.', fields: [{ key: 'MOCKDESK_VAPID_SUBJECT', label: 'Contact address', ph: 'mailto:admin@yourdomain.com' }] },
];
const FIELD = new Map(); for (const g of GROUPS) for (const f of g.fields) if (!FIELD.has(f.key)) FIELD.set(f.key, f);
export const credentialKeys = () => [...FIELD.keys()];

/** Environment overlay: reads see admin-entered values first, then the real environment. */
export function makeLiveEnv(base = process.env) {
  const over = new Map();
  const env = new Proxy({}, {
    get: (_, k) => (typeof k === 'string' ? (over.has(k) ? over.get(k) : base[k]) : undefined),
    has: (_, k) => over.has(k) || k in base,
    ownKeys: () => [...new Set([...Object.keys(base), ...over.keys()])],
    getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: over.has(k) ? over.get(k) : base[k] }),
  });
  return { env, over };
}

export function makeCredentials({ settings, live, keyFile = null, secretKey = process.env.MOCKDESK_SECRET_KEY }) {
  const key = (() => {
    if (secretKey) return crypto.createHash('sha256').update(String(secretKey)).digest();
    if (keyFile) {
      try { return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex'); } catch { /* create below */ }
      const k = crypto.randomBytes(32); try { fs.mkdirSync(path.dirname(keyFile), { recursive: true }); fs.writeFileSync(keyFile, k.toString('hex'), { mode: 0o600 }); return k; } catch { return k; }
    }
    return crypto.randomBytes(32); // in-memory database: nothing outlives the process
  })();
  const enc = (v) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(v, 'utf8'), c.final()]); return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':'); };
  const dec = (s) => { try { const [v, iv, tag, ct] = String(s).split(':'); if (v !== 'v1') return null; const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8'); } catch { return null; } };
  const stored = () => settings.get('credentials', {}) || {};
  const apply = () => { live.over.clear(); let bad = 0; for (const [k, v] of Object.entries(stored())) { if (!FIELD.has(k)) continue; const p = dec(v); if (p === null) bad++; else live.over.set(k, p); } return { unreadable: bad }; };
  const hint = (v) => (v.length > 8 ? `••••${v.slice(-4)}` : '••••');
  const view = () => {
    const st = stored();
    return GROUPS.map((g) => ({ id: g.id, name: g.name, help: g.help, fields: g.fields.map((f) => {
      const mine = live.over.has(f.key); const fromEnv = !mine && !!process.env[f.key]; const val = live.env[f.key] || '';
      return { key: f.key, label: f.label, type: f.type || 'text', secret: !!f.secret, ph: f.ph || '', options: f.options, when: f.when, shared: f.shared,
        source: mine ? 'admin' : fromEnv ? 'server' : 'none', set: !!val, hint: f.secret && val ? hint(val) : '', value: f.secret ? '' : (mine ? val : (fromEnv ? val : '')), stored: key in st };
    }) }));
  };
  /** values: { KEY: 'text' } sets; clear: ['KEY'] removes the admin value (falls back to the server setting). Blank secrets are left alone. */
  function update(values = {}, clear = []) {
    const st = { ...stored() }; const changed = [];
    for (const [k, raw] of Object.entries(values || {})) {
      const f = FIELD.get(k); if (!f) throw new Error(`Unknown setting ${k}`);
      const v = String(raw ?? '').trim(); if (/[\r\n]/.test(v)) throw new Error(`${f.label} must be on one line`); if (v.length > 2000) throw new Error(`${f.label} is too long`);
      if (f.secret && !v) continue;
      if (f.options && v && !f.options.some((o) => o.value === v)) throw new Error(`${f.label}: choose one of the listed options`);
      if (f.num && v && !(Number(v) > 0 && Number(v) < 65536)) throw new Error(`${f.label} must be a number`);
      if (!v) { if (k in st) { delete st[k]; changed.push(k); } continue; }
      st[k] = enc(v); changed.push(k);
    }
    for (const k of clear || []) if (FIELD.has(k) && k in st) { delete st[k]; changed.push(k); }
    settings.set('credentials', st); apply(); return [...new Set(changed)];
  }
  apply();
  return { view, update, apply, enc, dec };
}

/** Wrap a factory so it is rebuilt whenever one of its settings changes. Behaves like the sender, plus enabled(). */
export function lazy(make, env, keys, extra = []) {
  let sig = null, cur = null;
  const get = () => { const s = keys.map((k) => env[k] || '').join('\u0001'); if (s !== sig) { sig = s; cur = make(env); } return cur; };
  const facade = { enabled: () => !!get(), get provider() { return get()?.provider; }, get model() { return get()?.model; } };
  for (const m of ['send', 'draft', ...extra]) facade[m] = (...a) => { const c = get(); if (!c) throw Object.assign(new Error('This service is not set up'), { status: 503 }); return c[m](...a); };
  return facade;
}
export const on = (x) => !!x && (typeof x.enabled === 'function' ? x.enabled() : true);
