// Things an admin can change in Admin > Settings instead of editing code or server files.
// Each value falls back to the old environment variable, so servers that already set them keep working.
export const SITE_DEFAULTS = {
  name: 'MockDesk',
  tagline: 'Online mock tests for government exams',
  heroTitle: '',        // empty = built-in headline
  heroText: '',
  supportEmail: '',
  supportPhone: '',
  disclaimer: '',       // small print in the footer of the public page
  publicUrl: '',        // https://mock.example.com, used in emails and invite links
  faq: [],              // [{ q, a }]; empty = built-in questions
};
const str = (v, n) => String(v ?? '').trim().slice(0, n);

export function siteOf(settings, env = process.env) {
  const s = { ...SITE_DEFAULTS, ...(settings.get('site', {}) || {}) };
  return { ...s, name: s.name || SITE_DEFAULTS.name, publicUrl: (s.publicUrl || env.MOCKDESK_PUBLIC_URL || '').replace(/\/$/, ''), faq: Array.isArray(s.faq) ? s.faq : [] };
}
export function cleanSite(b = {}) {
  const faq = (Array.isArray(b.faq) ? b.faq : []).map((x) => ({ q: str(x?.q, 200), a: str(x?.a, 1000) })).filter((x) => x.q && x.a).slice(0, 20);
  const url = str(b.publicUrl, 200).replace(/\/$/, '');
  if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('The site address must start with http:// or https://');
  const email = str(b.supportEmail, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('The support email looks wrong');
  return { name: str(b.name, 40) || SITE_DEFAULTS.name, tagline: str(b.tagline, 120), heroTitle: str(b.heroTitle, 160), heroText: str(b.heroText, 300), supportEmail: email, supportPhone: str(b.supportPhone, 30), disclaimer: str(b.disclaimer, 300), publicUrl: url, faq };
}

export function limitsOf(settings, env = process.env) {
  const s = settings.get('limits', {}) || {};
  const n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x) : d; };
  return {
    practicePerDay: n(s.practicePerDay, Number(env.MOCKDESK_PRACTICE_PER_DAY) || 5, 1, 100),
    doubtPerHour: n(s.doubtPerHour, Number(env.MOCKDESK_DOUBT_PER_HOUR) || 20, 1, 500),
    doubtPerDay: n(s.doubtPerDay, Number(env.MOCKDESK_DOUBT_PER_DAY) || 80, 1, 2000),
    doubtChat: s.doubtChat === undefined ? env.MOCKDESK_DOUBT_CHAT !== 'off' : !!s.doubtChat,
    emailDailyCap: n(s.emailDailyCap, Number(env.MOCKDESK_EMAIL_DAILY_CAP) || 2000, 0, 1000000),
    sessionDays: n(s.sessionDays, 60, 1, 365), sessionHours: n(s.sessionHours, 12, 1, 72),
    otpMinutes: n(s.otpMinutes, 10, 3, 60), otpPerHour: n(s.otpPerHour, 5, 1, 30), otpMaxWrong: n(s.otpMaxWrong, 5, 3, 10), minPassword: n(s.minPassword, 8, 6, 32),
    timezone: validZone(s.timezone) ? s.timezone : (validZone(env.MOCKDESK_TZ) ? env.MOCKDESK_TZ : 'Asia/Kolkata'),
  };
}
export const validZone = (z) => { if (!z || typeof z !== 'string') return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };
export function cleanLimits(b = {}) {
  const lim = { practicePerDay: Number(b.practicePerDay), doubtPerHour: Number(b.doubtPerHour), doubtPerDay: Number(b.doubtPerDay), emailDailyCap: Number(b.emailDailyCap) };
  const dflt = { sessionDays: 60, sessionHours: 12, otpMinutes: 10, otpPerHour: 5, otpMaxWrong: 5, minPassword: 8 };
  for (const [k, [lo, hi]] of Object.entries({ sessionDays: [1, 365], sessionHours: [1, 72], otpMinutes: [3, 60], otpPerHour: [1, 30], otpMaxWrong: [3, 10], minPassword: [6, 32] })) { lim[k] = b[k] === undefined ? dflt[k] : Number(b[k]); if (!(lim[k] >= lo && lim[k] <= hi)) throw new Error(`${k} must be between ${lo} and ${hi}`); }
  for (const [k, [lo, hi]] of Object.entries({ practicePerDay: [1, 100], doubtPerHour: [1, 500], doubtPerDay: [1, 2000], emailDailyCap: [0, 1000000] })) if (!(lim[k] >= lo && lim[k] <= hi)) throw new Error(`${k} must be between ${lo} and ${hi}`);
  if (!validZone(b.timezone)) throw new Error('Unknown time zone. Use a name like Asia/Kolkata');
  return { ...lim, doubtChat: !!b.doubtChat, timezone: b.timezone };
}
