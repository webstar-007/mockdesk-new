export const PERMS = [
  ['content', 'Content', 'Mocks, questions, imports and reported questions (always on)'],
  ['students', 'Students', 'See students, attempts, integrity, cohorts, analytics and leaderboards'],
  ['messages', 'Messages', 'Send messages and announcements, change notification settings'],
  ['accounts', 'Accounts', 'Add students in bulk and manage batches'],
  ['data', 'Data export', 'Download CSV exports'],
  ['contacts', 'Contact details', 'See full email addresses and mobile numbers. Without this they are masked.'],
];
export const PRESETS = [['Content editor', ['content']], ['Analyst', ['content', 'students', 'data']], ['Support', ['content', 'students', 'contacts', 'accounts', 'messages']]];
// Which permission opens each admin page. Pages not listed here are for admins only.
export const NAV_PERM = { '': 'students', users: 'students', attempts: 'students', integrity: 'students', anomalies: 'students', cohorts: 'students', live: 'students', analytics: 'students', referrals: 'students', batches: 'students', announcements: 'messages', messages: 'messages', notifications: 'messages', mocks: 'content', bank: 'content', content: 'content', quality: 'content', coverage: 'content', reports: 'content', 'import-students': 'accounts', data: 'data' };
export function PermPicker({ value, onChange }) {
  const has = (k) => k === 'content' || value.includes(k);
  const toggle = (k) => onChange(has(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <fieldset className="perm-pick"><legend>Access</legend>
      <div className="perm-presets">{PRESETS.map(([n, p]) => <button type="button" key={n} className="btn btn-ghost btn-sm" onClick={() => onChange(p)}>{n}</button>)}</div>
      {PERMS.map(([k, n, h]) => <label key={k} className="perm-row"><input type="checkbox" checked={has(k)} disabled={k === 'content'} onChange={() => toggle(k)} /><span><b>{n}</b><small>{h}</small></span></label>)}
    </fieldset>
  );
}
