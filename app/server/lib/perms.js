// Fine-grained staff access. Admins can do everything. A staff member (role "editor") always has the content tools and can be given more.
export const PERMS = {
  content: 'Mocks, questions, imports and reported questions',
  students: 'See students, attempts, integrity, cohorts, analytics and leaderboards',
  messages: 'Send messages, announcements and notification settings',
  accounts: 'Add students in bulk and manage batches',
  data: 'Download CSV exports',
  contacts: 'See full email addresses and mobile numbers',
};
export const PRESETS = [
  { key: 'content', label: 'Content editor', perms: ['content'] },
  { key: 'analyst', label: 'Analyst', perms: ['content', 'students', 'data'] },
  { key: 'support', label: 'Support', perms: ['content', 'students', 'contacts', 'accounts', 'messages'] },
];
export const cleanPerms = (list) => ['content', ...new Set((Array.isArray(list) ? list : []).filter((p) => p in PERMS && p !== 'content'))];
export function permsOf(user) {
  if (!user) return [];
  if (user.role === 'admin') return Object.keys(PERMS);
  if (user.role !== 'editor') return [];
  let p = []; try { p = JSON.parse(user.perms || '[]'); } catch { /* default */ }
  return cleanPerms(p);
}
const CONTENT = /^\/(meta|upload|search|coverage|quality|import\/parse)$|^\/(mocks|questions|reports|alerts|drafts|duplicates)(\/|$)/;
/** Which permission a request needs: one of PERMS, or 'admin' (admins only). */
export function needFor(method, path) {
  const get = method === 'GET' || method === 'HEAD';
  if (/^\/mocks\/[^/]+\/leaderboard$/.test(path)) return 'students';
  if (CONTENT.test(path)) return 'content';
  if (/^\/(users\.csv|attempts\.csv|export)(\/|$)/.test(path)) return 'data';
  if (/^\/(announcements|messages|notifications)(\/|$)/.test(path) || (method === 'POST' && path === '/cohorts/nudge')) return 'messages';
  if (/^\/students\/import(\/|$)/.test(path)) return 'accounts';
  if (/^\/batches(\/|$)/.test(path)) return get ? 'students' : 'accounts';
  if (/^\/integrity\/[^/]+$/.test(path) && method === 'PATCH') return 'students';
  if (get && /^\/(overview|users|attempts|live|integrity|cohorts|analytics|anomalies|referrals)(\/[^/]+)?$/.test(path)) return 'students';
  return 'admin';
}
export const maskEmail = (v) => { const s = String(v ?? ''); const i = s.indexOf('@'); return i < 1 ? s : `${s[0]}***${s.slice(i)}`; };
export const maskPhone = (v) => { const s = String(v ?? ''); return s.length > 4 ? `${'*'.repeat(s.length - 4)}${s.slice(-4)}` : s; };
export const maskContact = (v) => (String(v ?? '').includes('@') ? maskEmail(v) : maskPhone(v));
/** Replace email, phone and contact values anywhere in a JSON payload. */
export function maskDeep(x) {
  if (Array.isArray(x)) return x.map(maskDeep);
  if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = typeof v === 'string' && v ? (k === 'email' ? maskEmail(v) : k === 'phone' ? maskPhone(v) : k === 'contact' ? maskContact(v) : v) : maskDeep(v); return o; }
  return x;
}
