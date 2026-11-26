// Help data engine: answers questions about real data (students, teachers, editors, admins, mocks, batches, tickets, activity)
// from plain-words questions. Read-only. Test accounts (@loadtest.invalid) and the hidden load-test mock are always left out.
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9@.+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const IST = 'Asia/Kolkata';
const dt = (t) => (t ? new Date(t).toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
const day = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ago = (t, n) => { if (!t) return 'never'; const m = Math.round((n - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 36) return `${h} h ago`; return `${Math.round(h / 24)} days ago`; };
const r1 = (x) => (x == null ? '—' : Math.round(x * 10) / 10);
const pct = (x) => (x == null ? '—' : `${Math.round(x <= 1 ? x * 100 : x)}%`);
const ROLE_NAME = { student: 'Students', teacher: 'Teachers', editor: 'Staff (editors)', admin: 'Admins' };
const NOISE = new Set('the a an of for in on at to and or is are was were be been do does did me my our us we you your i it its this that these those with from about by as how what who which where when show list give tell find get see check view all any some please can could would should will has have had not no than then them they their there here also just only more most much many very'.split(' '));

export function makeDataEngine({ db, now }) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const REAL = "email NOT LIKE '%@loadtest.invalid'";
  const M = (p = '') => `${p}mock_id!='__loadtest__' AND COALESCE(${p}kind,'mock')='mock'`; const MOCKS = M();
  const link = (label, to) => ({ label, to });
  const mockName = (id) => one('SELECT name FROM mocks WHERE id=?', id)?.name || id;

  function windowOf(s) {
    const t = now(); const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    let m;
    if (/\btoday\b/.test(s)) return { since: startOfDay(t), label: 'today' };
    if (/\byesterday\b/.test(s)) return { since: startOfDay(t - 86400000), until: startOfDay(t), label: 'yesterday' };
    if ((m = s.match(/\b(?:last|past|in the last|in last|within|for)\s+(\d{1,3})\s*(day|days|d|week|weeks|month|months|hour|hours)\b/))) { const n = Number(m[1]); const u = m[2][0]; const ms = u === 'h' ? 3600000 : u === 'w' ? 7 * 86400000 : u === 'm' ? 30 * 86400000 : 86400000; return { since: t - n * ms, label: `the last ${n} ${m[2].replace(/s$/, '')}${n === 1 ? '' : 's'}` }; }
    if (/\b(this|last|past) week\b/.test(s)) return { since: t - 7 * 86400000, label: 'the last 7 days' };
    if (/\b(this|last|past) month\b/.test(s)) return { since: t - 30 * 86400000, label: 'the last 30 days' };
    return null;
  }
  const limitOf = (s, d = 10) => { const m = s.match(/\b(?:top|first|best|worst|bottom|lowest|highest|latest|recent|last)\s+(\d{1,2})\b/) || s.match(/\b(\d{1,2})\s+(?:students?|teachers?|users?|mocks?|tests?|people|toppers?)\b/); return m ? Math.min(50, Math.max(1, Number(m[1]))) : d; };

  // ---------- people ----------
  function people(role) { return all(`SELECT id, name, email, phone, role, status, last_seen, created_at FROM users WHERE ${REAL}${role ? ` AND COALESCE(role,'student')='${role}'` : ''}`); }

  function findPeople(s, raw) {
    const words = s.split(' ').filter((w) => w.length >= 3 && !NOISE.has(w));
    const everyone = all(`SELECT id, name, email, role FROM users WHERE ${REAL}`);
    const exact = [], partial = [];
    for (const u of everyone) {
      const nm = norm(u.name); const em = String(u.email || '').toLowerCase();
      if (em && s.includes(em)) { exact.push(u); continue; }
      const nt = nm.split(' ').filter((w) => w.length >= 2);
      if (nm.length >= 3 && nt.length >= 2 && nt.every((w) => s.split(' ').includes(w))) { exact.push(u); continue; }
      if (nm.length >= 4 && (` ${s} `).includes(` ${nm} `)) { exact.push(u); continue; }
      const hit = nt.filter((w) => w.length >= 4 && words.includes(w));
      if (hit.length) partial.push(u);
    }
    return { exact, partial };
  }

  function studentStats(uid) {
    const st = one(`SELECT COUNT(*) n, AVG(score) avg, MAX(score) best, MIN(score) low, AVG(accuracy) acc FROM attempts WHERE user_id=? AND status='submitted' AND ${MOCKS}`, uid);
    const recent = all(`SELECT a.id, a.score, a.accuracy, a.submitted_at, m.name FROM attempts a LEFT JOIN mocks m ON m.id=a.mock_id WHERE a.user_id=? AND a.status='submitted' AND ${M('a.')} ORDER BY a.submitted_at DESC LIMIT 6`, uid);
    // trend: average of the last 3 against the 3 before them
    const sc = all(`SELECT score FROM attempts WHERE user_id=? AND status='submitted' AND score IS NOT NULL AND ${MOCKS} ORDER BY submitted_at DESC LIMIT 6`, uid).map((x) => x.score);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const trend = sc.length >= 4 ? avg(sc.slice(0, Math.ceil(sc.length / 2))) - avg(sc.slice(Math.ceil(sc.length / 2))) : null;
    return { st, recent, trend };
  }

  function profile(u0) {
    const t = now(); const u = one('SELECT * FROM users WHERE id=?', u0.id); const role = u.role || 'student'; const stats = []; let table = null; const go = [link('Open full profile', `/admin/users/${u.id}`)]; const follow = [];
    stats.push({ label: 'Role', value: ROLE_NAME[role]?.replace(/s$/, '').replace(' (editors)', '') || role }, { label: 'Status', value: u.status || 'active', tone: u.status === 'suspended' ? 'bad' : 'good' }, { label: 'Last seen', value: ago(u.last_seen, t) }, { label: 'Joined', value: u.created_at ? day(new Date(u.created_at).getTime()) : '—' });
    let summary = `${u.name} (${u.email || u.phone || 'no contact saved'})`;
    if (role === 'student') {
      const { st, recent, trend } = studentStats(u.id);
      const batches = all('SELECT b.id, b.name FROM batch_members bm JOIN batches b ON b.id=bm.batch_id WHERE bm.user_id=?', u.id);
      stats.push({ label: 'Tests finished', value: st.n }, { label: 'Average score', value: r1(st.avg) }, { label: 'Best score', value: r1(st.best) }, { label: 'Average accuracy', value: pct(st.acc) });
      if (u.target_score) stats.push({ label: 'Target score', value: u.target_score });
      if (u.exam_date) stats.push({ label: 'Exam date', value: u.exam_date });
      stats.push({ label: 'Batches', value: batches.length ? batches.map((b) => b.name).join(', ') : 'none' });
      const o = (sql, ...a) => { try { return one(sql, ...a).c; } catch { return 0; } };
      stats.push({ label: 'Open support tickets', value: o("SELECT COUNT(*) c FROM tickets WHERE user_id=? AND status='open'", u.id) }, { label: 'Doubts asked', value: o('SELECT COUNT(*) c FROM desk_doubts WHERE user_id=?', u.id) }, { label: 'Certificates', value: o('SELECT COUNT(*) c FROM certificates WHERE user_id=? AND revoked_at IS NULL', u.id) });
      if (recent.length) table = { cols: ['Test', 'Score', 'Accuracy', 'Submitted'], rows: recent.map((x) => ({ cells: [x.name || 'Test', r1(x.score), pct(x.accuracy), dt(x.submitted_at)], to: `/admin/attempts/${x.id}` })) };
      summary = st.n ? `${u.name} has finished ${st.n} test${st.n === 1 ? '' : 's'} with an average of ${r1(st.avg)}${trend != null ? (trend > 1 ? ', and is improving' : trend < -1 ? ', but recent scores are dropping' : ', steady lately') : ''}. Last seen ${ago(u.last_seen, t)}.` : `${u.name} has not finished any test yet. Last seen ${ago(u.last_seen, t)}.`;
      follow.push(`Is ${u.name} in any batch`, 'Show students who have not logged in for 14 days');
    } else if (role === 'teacher') {
      const bs = all('SELECT b.id, b.name, (SELECT COUNT(*) FROM batch_members WHERE batch_id=b.id) n FROM batch_teachers bt JOIN batches b ON b.id=bt.batch_id WHERE bt.user_id=?', u.id);
      const o = (sql, ...a) => { try { return one(sql, ...a).c; } catch { return 0; } };
      stats.push({ label: 'Batches taught', value: bs.length }, { label: 'Students', value: bs.reduce((a, b) => a + b.n, 0) }, { label: 'Assignments set', value: o('SELECT COUNT(*) c FROM assignments WHERE teacher_id=?', u.id) }, { label: 'Doubts answered', value: o('SELECT COUNT(*) c FROM desk_doubts WHERE answered_by=?', u.id) });
      if (bs.length) table = { cols: ['Batch', 'Students'], rows: bs.map((b) => ({ cells: [b.name, b.n], to: `/admin/batches/${b.id}` })) };
      summary = `${u.name} teaches ${bs.length} batch${bs.length === 1 ? '' : 'es'}. Last seen ${ago(u.last_seen, t)}.`;
      follow.push('Show all teachers', 'Which batches have no teacher');
    } else {
      let perms = ''; try { const p = JSON.parse(u.perms || 'null'); if (Array.isArray(p)) perms = p.length ? `${p.length} areas` : 'none'; else if (p && typeof p === 'object') perms = 'custom'; } catch { /* none */ }
      if (role === 'editor') stats.push({ label: 'Access', value: perms || 'default staff access' });
      const acts = all('SELECT at, action, target FROM audit WHERE admin_id=? ORDER BY at DESC LIMIT 6', u.id);
      stats.push({ label: 'Actions in the last 30 days', value: one('SELECT COUNT(*) c FROM audit WHERE admin_id=? AND at>?', u.id, t - 30 * 86400000).c });
      if (acts.length) table = { cols: ['When', 'Action', 'On'], rows: acts.map((x) => ({ cells: [dt(x.at), x.action, x.target || '—'] })) };
      go.push(link('Open Administrators', '/admin/administrators'));
      summary = `${u.name} is ${role === 'admin' ? 'an admin' : 'a staff member'}. Last seen ${ago(u.last_seen, t)}.`;
      follow.push('What did admins do recently', 'Who is online now');
    }
    return { kind: 'profile', title: u.name, summary, stats, table, go, follow };
  }

  function peopleTable(rows, extra = []) {
    return { cols: ['Name', 'Role', 'Last seen', ...extra.map((e) => e.col)], rows: rows.map((u) => ({ cells: [u.name || u.email, (u.role || 'student'), ago(u.last_seen, now()), ...extra.map((e) => e.fn(u))], to: `/admin/users/${u.id}` })) };
  }

  function roleList(s, role) {
    const t = now(); const win = windowOf(s); const n = limitOf(s); const label = ROLE_NAME[role] || 'People';
    const base = `${REAL} AND COALESCE(role,'student')='${role}'`; const ub = `u.email NOT LIKE '%@loadtest.invalid' AND COALESCE(u.role,'student')='${role}'`; const go = [link(role === 'student' ? 'Open all students' : 'Open Administrators', role === 'student' ? '/admin/users' : '/admin/administrators')];
    const total = one(`SELECT COUNT(*) c FROM users WHERE ${base}`).c;
    const done = (title, summary, rows, extra, follow = []) => ({ kind: 'list', title, summary, table: rows.length ? peopleTable(rows, extra) : null, go, follow, empty: rows.length ? '' : 'Nobody matches this.' });
    const isCount = /\b(how many|number of|count|total)\b/.test(s);
    const ranked = (dir) => { const rows = all(`SELECT u.id, u.name, u.email, u.role, u.last_seen, AVG(a.score) avg, COUNT(a.id) n FROM users u JOIN attempts a ON a.user_id=u.id AND a.status='submitted' AND a.score IS NOT NULL AND ${M('a.')} WHERE ${ub} GROUP BY u.id HAVING n>=1 ORDER BY avg ${dir} LIMIT ${n}`); return rows; };
    if (/\b(top|best|topper|toppers|highest|leader|leaders|leaderboard|rank|ranking)\b/.test(s) && role === 'student') { const rows = ranked('DESC'); return done(`Top ${rows.length} students by average score`, `Based on finished mocks. Practice sets are not counted.`, rows, [{ col: 'Average', fn: (u) => r1(u.avg) }, { col: 'Tests', fn: (u) => u.n }], ['Show the lowest scoring students', 'Which students have not logged in for 14 days']); }
    if (/\b(lowest|weak|weakest|worst|struggling|poor|bottom|low scor\w*|failing)\b/.test(s) && role === 'student') { const rows = ranked('ASC'); return done(`${rows.length} lowest scoring students`, 'Lowest average across finished mocks. Consider nudging them from Batch health.', rows, [{ col: 'Average', fn: (u) => r1(u.avg) }, { col: 'Tests', fn: (u) => u.n }], ['Show top students']); }
    if (/\b(most (active|attempts|tests)|hardworking|hard working|most regular|most attempted|most tests)\b/.test(s) && role === 'student') { const rows = all(`SELECT u.id, u.name, u.email, u.role, u.last_seen, COUNT(a.id) n FROM users u JOIN attempts a ON a.user_id=u.id AND a.status='submitted' AND ${M('a.')} WHERE ${REAL.replace('email', 'u.email')} AND COALESCE(u.role,'student')='student' GROUP BY u.id ORDER BY n DESC LIMIT ${n}`); return done(`${rows.length} students who took the most tests`, '', rows, [{ col: 'Tests', fn: (u) => u.n }]); }
    if (/\b(never|not started|no attempts?|zero attempts|without any|havent (taken|attempted|started|given)|yet to (take|attempt|start))\b/.test(s) && role === 'student') { const q = `SELECT id, name, email, role, last_seen FROM users WHERE ${base} AND id NOT IN (SELECT user_id FROM attempts WHERE ${MOCKS}) ORDER BY created_at DESC`; const c = all(q).length; const rows = all(`${q} LIMIT ${Math.max(n, 15)}`); return done(`${c} student${c === 1 ? '' : 's'} have never started a test`, c ? 'Newest sign-ups first.' : '', rows, [], ['Show students who joined in the last 7 days']); }
    if (/\b(inactive|dormant|absent|gone quiet|disappeared|not (been )?(seen|active|logged in|login|visited|online)|havent (logged|visited|been|opened|seen)|not log\w*|no login)\b/.test(s)) { const days = (s.match(/\b(\d{1,3})\s*days?\b/) || [])[1] ? Number(s.match(/\b(\d{1,3})\s*days?\b/)[1]) : 14; const cut = t - days * 86400000; const q = `SELECT id, name, email, role, last_seen FROM users WHERE ${base} AND COALESCE(status,'active')!='suspended' AND (last_seen IS NULL OR last_seen<?) ORDER BY last_seen IS NULL, last_seen DESC`; const c = all(q, cut).length; const rows = all(`${q} LIMIT 25`, cut); return done(`${c} ${label.toLowerCase()} not seen in ${days} days`, c > 25 ? 'Showing the 25 seen most recently. Use Batch health to nudge them.' : '', rows, [], ['Show top students']); }
    if (/\b(online|active now|right now|currently|logged in|using the (site|platform))\b/.test(s)) { const rows = all(`SELECT id, name, email, role, last_seen FROM users WHERE ${base} AND last_seen>? ORDER BY last_seen DESC LIMIT 30`, t - 300000); return done(`${rows.length} ${label.toLowerCase()} active in the last 5 minutes`, '', rows, [], ['Which tests are in progress now']); }
    if (/\b(suspend\w*|blocked|banned|disabled|deactivated|locked)\b/.test(s)) { const rows = all(`SELECT id, name, email, role, last_seen FROM users WHERE ${base} AND status='suspended' ORDER BY name LIMIT 50`); return done(`${rows.length} suspended ${label.toLowerCase()}`, '', rows); }
    if (/\b(new|recent|recently|latest|joined|signed up|sign ups?|signups?|registered|newest)\b/.test(s)) { const w = win || { since: t - 7 * 86400000, label: 'the last 7 days' }; const q = `SELECT id, name, email, role, last_seen, created_at FROM users WHERE ${base} AND created_at>=? ORDER BY created_at DESC`; const iso = new Date(w.since).toISOString(); const c = all(q, iso).length; const rows = c ? all(`${q} LIMIT 25`, iso) : all(`SELECT id, name, email, role, last_seen, created_at FROM users WHERE ${base} ORDER BY created_at DESC LIMIT ${n}`); return done(c ? `${c} ${label.toLowerCase()} joined in ${w.label}` : `No new ${label.toLowerCase()} in ${w.label}. Showing the latest ${rows.length}.`, '', rows, [{ col: 'Joined', fn: (u) => (u.created_at ? day(new Date(u.created_at).getTime()) : '—') }]); }
    if (isCount) {
      const act = one(`SELECT COUNT(*) c FROM users WHERE ${base} AND last_seen>?`, t - 300000).c; const wk = one(`SELECT COUNT(*) c FROM users WHERE ${base} AND last_seen>?`, t - 7 * 86400000).c; const nw = one(`SELECT COUNT(*) c FROM users WHERE ${base} AND created_at>?`, new Date(t - 7 * 86400000).toISOString()).c; const sus = one(`SELECT COUNT(*) c FROM users WHERE ${base} AND status='suspended'`).c;
      const stats = [{ label: label, value: total }, { label: 'Active in the last 5 minutes', value: act }, { label: 'Seen in the last 7 days', value: wk }, { label: 'Joined in the last 7 days', value: nw }, { label: 'Suspended', value: sus, tone: sus ? 'warn' : '' }];
      if (role === 'student') stats.push({ label: 'Never started a test', value: one(`SELECT COUNT(*) c FROM users WHERE ${base} AND id NOT IN (SELECT user_id FROM attempts WHERE ${MOCKS})`).c }, { label: 'Not in any batch', value: one(`SELECT COUNT(*) c FROM users WHERE ${base} AND id NOT IN (SELECT user_id FROM batch_members)`).c });
      return { kind: 'stats', title: `${label} right now`, summary: `${total} ${label.toLowerCase()} in total.`, stats, go, follow: role === 'student' ? ['Show top students', 'Show students who have never started a test', 'Show new students'] : [`Show all ${label.toLowerCase()}`] };
    }
    const rows = all(`SELECT id, name, email, role, last_seen FROM users WHERE ${base} ORDER BY ${role === 'student' ? 'created_at DESC' : 'name'} LIMIT ${Math.max(n, 20)}`);
    return done(`${role === 'student' ? 'Newest' : 'All'} ${label.toLowerCase()}${total > rows.length ? ` (${rows.length} of ${total})` : ` (${total})`}`, '', rows, [{ col: 'Email', fn: (u) => u.email || '—' }]);
  }

  // ---------- mocks, batches, platform ----------
  function mockProfile(m) {
    const t = now(); const st = one("SELECT COUNT(*) n, AVG(score) avg, MAX(score) best, MIN(score) low, AVG(accuracy) acc FROM attempts WHERE mock_id=? AND status='submitted'", m.id);
    const prog = one("SELECT COUNT(*) c FROM attempts WHERE mock_id=? AND status='in_progress'", m.id).c; const q = one('SELECT COUNT(*) c FROM questions WHERE mock_id=?', m.id).c;
    const rep = (() => { try { return one("SELECT COUNT(*) c FROM reports WHERE mock_id=? AND status='open'", m.id).c; } catch { return 0; } })();
    const top = all("SELECT a.id, a.score, a.accuracy, u.name, u.id uid FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.mock_id=? AND a.status='submitted' AND a.score IS NOT NULL ORDER BY a.score DESC LIMIT 5", m.id);
    const stats = [{ label: 'Status', value: m.status }, { label: 'Difficulty', value: m.difficulty || '—' }, { label: 'Questions', value: q }, { label: 'Finished attempts', value: st.n }, { label: 'In progress now', value: prog }, { label: 'Average score', value: r1(st.avg) }, { label: 'Highest', value: r1(st.best) }, { label: 'Lowest', value: r1(st.low) }, { label: 'Average accuracy', value: pct(st.acc) }, { label: 'Open question reports', value: rep, tone: rep ? 'warn' : '' }];
    if (m.available_from) stats.push({ label: m.available_from > t ? 'Opens' : 'Opened', value: dt(m.available_from) });
    return { kind: 'profile', title: m.name, summary: st.n ? `${st.n} students finished it with an average of ${r1(st.avg)}.` : 'Nobody has finished this one yet.', stats, table: top.length ? { cols: ['Top scorers', 'Score', 'Accuracy'], rows: top.map((x) => ({ cells: [x.name, r1(x.score), pct(x.accuracy)], to: `/admin/attempts/${x.id}` })) } : null, go: [link('Open this mock', `/admin/mocks/${m.id}`), link('All mocks', '/admin/mocks')], follow: ['Which mock is the hardest', 'Which mock is attempted the most'] };
  }

  function mocksList(s) {
    const n = limitOf(s, 10); const base = `SELECT m.id, m.name, m.status, m.difficulty, COUNT(a.id) n, AVG(a.score) avg FROM mocks m LEFT JOIN attempts a ON a.mock_id=m.id AND a.status='submitted' WHERE m.id!='__loadtest__' AND COALESCE(m.kind,'mock')='mock'`;
    const tbl = (rows, extra) => ({ cols: ['Mock', 'Status', 'Attempts', 'Average', ...extra], rows: rows.map((m) => ({ cells: [m.name, m.status, m.n, r1(m.avg), ...(extra.length ? [m.difficulty || '—'] : [])], to: `/admin/mocks/${m.id}` })) });
    const go = [link('Open Mocks', '/admin/mocks')];
    if (/\b(hardest|toughest|lowest average|difficult|worst)\b/.test(s)) { const rows = all(`${base} GROUP BY m.id HAVING n>0 ORDER BY avg ASC LIMIT ${n}`); return { kind: 'list', title: 'Hardest mocks (lowest average score)', table: rows.length ? tbl(rows, ['Difficulty']) : null, empty: 'No finished attempts yet.', go, follow: ['Which mock is the easiest'] }; }
    if (/\b(easiest|highest average|simplest|best scor\w*)\b/.test(s)) { const rows = all(`${base} GROUP BY m.id HAVING n>0 ORDER BY avg DESC LIMIT ${n}`); return { kind: 'list', title: 'Easiest mocks (highest average score)', table: rows.length ? tbl(rows, ['Difficulty']) : null, empty: 'No finished attempts yet.', go }; }
    if (/\b(most|popular|attempted|taken)\b/.test(s)) { const rows = all(`${base} GROUP BY m.id ORDER BY n DESC LIMIT ${n}`); return { kind: 'list', title: 'Most attempted mocks', table: rows.length ? tbl(rows, ['Difficulty']) : null, go }; }
    if (/\b(draft|unpublished|not published)\b/.test(s)) { const rows = all(`${base} AND m.status!='published' GROUP BY m.id ORDER BY m.updated_at DESC LIMIT 30`); return { kind: 'list', title: `${rows.length} mocks not published`, table: rows.length ? tbl(rows, ['Difficulty']) : null, empty: 'Every mock is published.', go }; }
    const c = all("SELECT status, COUNT(*) c FROM mocks WHERE id!='__loadtest__' AND COALESCE(kind,'mock')='mock' GROUP BY status");
    const total = c.reduce((a, b) => a + b.c, 0);
    if (/\b(how many|number of|count|total)\b/.test(s)) return { kind: 'stats', title: 'Mocks', summary: `${total} mocks in total.`, stats: [...c.map((x) => ({ label: x.status[0].toUpperCase() + x.status.slice(1), value: x.c })), { label: 'Questions in all mocks', value: one("SELECT COUNT(*) c FROM questions WHERE mock_id!='__loadtest__'").c }], go, follow: ['Which mock is the hardest', 'Which mock is attempted the most'] };
    const rows = all(`${base} GROUP BY m.id ORDER BY m.number, m.created_at LIMIT 30`); return { kind: 'list', title: `Mocks (${total})`, table: tbl(rows, ['Difficulty']), go, follow: ['Which mock is the hardest'] };
  }

  function batchProfile(b) {
    const t = now(); const members = one('SELECT COUNT(*) c FROM batch_members WHERE batch_id=?', b.id).c; const teachers = all('SELECT u.id, u.name FROM batch_teachers bt JOIN users u ON u.id=bt.user_id WHERE bt.batch_id=?', b.id);
    const avg = one("SELECT AVG(a.score) avg, COUNT(*) n FROM attempts a JOIN batch_members bm ON bm.user_id=a.user_id WHERE bm.batch_id=? AND a.status='submitted' AND a.mock_id!='__loadtest__' AND COALESCE(a.kind,'mock')='mock'", b.id);
    const quiet = one('SELECT COUNT(*) c FROM batch_members bm JOIN users u ON u.id=bm.user_id WHERE bm.batch_id=? AND (u.last_seen IS NULL OR u.last_seen<?)', b.id, t - 14 * 86400000).c;
    let asg = 0; try { asg = one('SELECT COUNT(*) c FROM assignments WHERE batch_id=? AND archived=0', b.id).c; } catch { /* none */ }
    const top = all("SELECT u.id, u.name, AVG(a.score) avg, COUNT(*) n FROM attempts a JOIN batch_members bm ON bm.user_id=a.user_id JOIN users u ON u.id=a.user_id WHERE bm.batch_id=? AND a.status='submitted' AND a.score IS NOT NULL AND a.mock_id!='__loadtest__' GROUP BY u.id ORDER BY avg DESC LIMIT 5", b.id);
    return { kind: 'profile', title: b.name, summary: `${members} student${members === 1 ? '' : 's'}${teachers.length ? `, taught by ${teachers.map((x) => x.name).join(', ')}` : ', no teacher assigned'}.`, stats: [{ label: 'Code', value: b.code || '—' }, { label: 'Students', value: members }, { label: 'Teachers', value: teachers.length ? teachers.map((x) => x.name).join(', ') : 'none', tone: teachers.length ? '' : 'warn' }, { label: 'Average score', value: r1(avg.avg) }, { label: 'Tests finished', value: avg.n }, { label: 'Not seen in 14 days', value: quiet, tone: quiet ? 'warn' : '' }, { label: 'Active assignments', value: asg }, { label: 'Created', value: day(b.created_at) }], table: top.length ? { cols: ['Top students', 'Average', 'Tests'], rows: top.map((x) => ({ cells: [x.name, r1(x.avg), x.n], to: `/admin/users/${x.id}` })) } : null, go: [link('Open this batch', `/admin/batches/${b.id}`), link('Batch health', '/admin/batch-health')], follow: ['Which batches have no teacher'] };
  }

  function batchesList(s) {
    const rows = all("SELECT b.id, b.name, b.code, b.archived, (SELECT COUNT(*) FROM batch_members WHERE batch_id=b.id) n, (SELECT GROUP_CONCAT(u.name, ', ') FROM batch_teachers bt JOIN users u ON u.id=bt.user_id WHERE bt.batch_id=b.id) teachers FROM batches b WHERE COALESCE(b.archived,0)=0 ORDER BY b.created_at DESC LIMIT 40");
    const none = /\b(no|without|missing)\b.*\bteacher/.test(s); const list = none ? rows.filter((b) => !b.teachers) : rows;
    return { kind: 'list', title: none ? `${list.length} batches without a teacher` : `Batches (${rows.length})`, table: list.length ? { cols: ['Batch', 'Code', 'Students', 'Teachers'], rows: list.map((b) => ({ cells: [b.name, b.code || '—', b.n, b.teachers || 'none'], to: `/admin/batches/${b.id}` })) } : null, empty: none ? 'Every batch has a teacher.' : 'No batches yet.', go: [link('Open Batches', '/admin/batches')], follow: ['Which students are not in any batch'] };
  }

  function activity(s) {
    const t = now(); const win = windowOf(s) || { since: t - 86400000, label: 'the last 24 hours' };
    const until = win.until || t + 1;
    if (/\b(failed|wrong|bad|unsuccessful)\b.*\b(login|log in|sign in|password)|\b(login|sign in)s?\b.*\bfail/.test(s)) { const rows = all('SELECT who, ip, at FROM login_log WHERE ok=0 AND at>=? AND at<? ORDER BY at DESC LIMIT 30', win.since, until); const c = one('SELECT COUNT(*) c FROM login_log WHERE ok=0 AND at>=? AND at<?', win.since, until).c; return { kind: 'list', title: `${c} failed sign-ins in ${win.label}`, summary: c > 10 ? 'Many failures can mean someone is guessing passwords. Check Security.' : '', table: rows.length ? { cols: ['Who', 'IP', 'When'], rows: rows.map((x) => ({ cells: [x.who || '—', x.ip || '—', dt(x.at)] })) } : null, empty: 'No failed sign-ins.', go: [link('Open Sign-in log', '/admin/logins')] }; }
    if (/\b(login|log in|sign in|signed in|logged in)\b/.test(s)) { const c = one('SELECT COUNT(*) c FROM login_log WHERE ok=1 AND at>=? AND at<?', win.since, until).c; const u = one('SELECT COUNT(DISTINCT user_id) c FROM login_log WHERE ok=1 AND at>=? AND at<?', win.since, until).c; const f = one('SELECT COUNT(*) c FROM login_log WHERE ok=0 AND at>=? AND at<?', win.since, until).c; return { kind: 'stats', title: `Sign-ins in ${win.label}`, stats: [{ label: 'Successful sign-ins', value: c }, { label: 'Different people', value: u }, { label: 'Failed attempts', value: f, tone: f > 20 ? 'warn' : '' }], go: [link('Open Sign-in log', '/admin/logins')] }; }
    const rows = all('SELECT at, admin_name, action, target FROM audit WHERE at>=? AND at<? ORDER BY at DESC LIMIT 25', win.since, until); const c = one('SELECT COUNT(*) c FROM audit WHERE at>=? AND at<?', win.since, until).c;
    return { kind: 'list', title: `${c} admin actions in ${win.label}`, table: rows.length ? { cols: ['When', 'Who', 'Action', 'On'], rows: rows.map((x) => ({ cells: [dt(x.at), x.admin_name || '—', x.action, x.target || '—'] })) } : null, empty: 'No admin actions in this period.', go: [link('Open Activity log', '/admin/audit')], follow: ['Show failed sign-ins today'] };
  }

  function platform(s) {
    const t = now(); const win = windowOf(s); const w = win || { since: t - 86400000, label: 'the last 24 hours' }; const until = w.until || t + 1;
    if (/\b(tests?|attempts?|submissions?|mocks?)\b.*\b(in progress|running|live|ongoing|now|currently|taking)\b|\bwho is taking\b/.test(s)) { const rows = all("SELECT a.id, u.name, u.id uid, m.name mock, a.started_at FROM attempts a JOIN users u ON u.id=a.user_id LEFT JOIN mocks m ON m.id=a.mock_id WHERE a.status='in_progress' AND a.mock_id!='__loadtest__' ORDER BY a.started_at DESC LIMIT 30"); return { kind: 'list', title: `${rows.length} test${rows.length === 1 ? '' : 's'} in progress`, table: rows.length ? { cols: ['Student', 'Mock', 'Started'], rows: rows.map((x) => ({ cells: [x.name, x.mock || '—', ago(x.started_at, t)], to: `/admin/attempts/${x.id}` })) } : null, empty: 'Nobody is taking a test right now.', go: [link('Open Live now', '/admin/live')] }; }
    if (/\b(attempts?|submissions?|submitted|tests? (taken|given|attempted|finished|completed))\b/.test(s)) { const c = one("SELECT COUNT(*) n, AVG(score) avg, AVG(accuracy) acc, COUNT(DISTINCT user_id) u FROM attempts WHERE status='submitted' AND submitted_at>=? AND submitted_at<? AND mock_id!='__loadtest__'", w.since, until); const a = one("SELECT COUNT(*) c FROM attempts WHERE status='submitted' AND mock_id!='__loadtest__'").c; return { kind: 'stats', title: `Tests finished in ${w.label}`, summary: `${c.n} test${c.n === 1 ? '' : 's'} finished by ${c.u} student${c.u === 1 ? '' : 's'}.`, stats: [{ label: 'Tests finished', value: c.n }, { label: 'Different students', value: c.u }, { label: 'Average score', value: r1(c.avg) }, { label: 'Average accuracy', value: pct(c.acc) }, { label: 'All time', value: a }], go: [link('Open Analytics', '/admin/analytics')], follow: ['Which mock is attempted the most', 'Show top students'] }; }
    if (/\b(tickets?|support|complaints?)\b/.test(s)) { const rows = all("SELECT t.id, t.subject, t.priority, t.updated_at, u.name FROM tickets t LEFT JOIN users u ON u.id=t.user_id WHERE t.status='open' ORDER BY t.updated_at DESC LIMIT 20"); const c = one("SELECT COUNT(*) c FROM tickets WHERE status='open'").c; return { kind: 'list', title: `${c} open support ticket${c === 1 ? '' : 's'}`, table: rows.length ? { cols: ['From', 'Subject', 'Priority', 'Updated'], rows: rows.map((x) => ({ cells: [x.name || '—', x.subject, x.priority, ago(x.updated_at, t)], to: '/admin/support' })) } : null, empty: 'Inbox is clear.', go: [link('Open Support inbox', '/admin/support')] }; }
    if (/\b(reports?|reported|flagged)\b/.test(s)) { const c = one("SELECT COUNT(*) c FROM reports WHERE status='open'").c; const rows = all("SELECT r.reason, r.note, r.created_at, m.name mock FROM reports r LEFT JOIN mocks m ON m.id=r.mock_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 15"); return { kind: 'list', title: `${c} open question report${c === 1 ? '' : 's'}`, table: rows.length ? { cols: ['Mock', 'Reason', 'Note', 'When'], rows: rows.map((x) => ({ cells: [x.mock || '—', x.reason || '—', (x.note || '').slice(0, 60) || '—', ago(x.created_at, t)], to: '/admin/reports' })) } : null, empty: 'No open reports.', go: [link('Open Student reports', '/admin/reports')] }; }
    if (/\b(doubts?|questions asked)\b/.test(s)) { const o = one("SELECT COUNT(*) c FROM desk_doubts WHERE status='open'").c; const a = one("SELECT COUNT(*) c FROM desk_doubts WHERE status!='open'").c; return { kind: 'stats', title: 'Doubt desk', stats: [{ label: 'Waiting for a teacher', value: o, tone: o > 10 ? 'warn' : '' }, { label: 'Answered', value: a }], go: [link('Open Doubt desk', '/admin/desk')] }; }
    if (/\b(certificates?)\b/.test(s)) { const c = all('SELECT kind, COUNT(*) c FROM certificates WHERE revoked_at IS NULL GROUP BY kind'); return { kind: 'stats', title: 'Certificates issued', stats: c.length ? c.map((x) => ({ label: x.kind, value: x.c })) : [{ label: 'Issued so far', value: 0 }], go: [link('Open Certificates', '/admin/certificates')] }; }
    if (/\b(announcements?|banners?|notices?)\b/.test(s)) { const rows = all('SELECT text, level, active, created_at FROM announcements ORDER BY created_at DESC LIMIT 10'); return { kind: 'list', title: `${rows.filter((x) => x.active).length} active announcement(s)`, table: rows.length ? { cols: ['Text', 'Level', 'Active', 'Created'], rows: rows.map((x) => ({ cells: [x.text.slice(0, 80), x.level, x.active ? 'yes' : 'no', ago(x.created_at, t)] })) } : null, go: [link('Open Announcements', '/admin/announcements')] }; }
    if (/\b(questions?)\b/.test(s)) { const rows = all("SELECT m.name, COUNT(q.id) c FROM mocks m LEFT JOIN questions q ON q.mock_id=m.id WHERE m.id!='__loadtest__' AND COALESCE(m.kind,'mock')='mock' GROUP BY m.id ORDER BY m.number LIMIT 30"); return { kind: 'stats', title: 'Questions', summary: `${rows.reduce((a, b) => a + b.c, 0)} questions across ${rows.length} mocks.`, stats: rows.map((x) => ({ label: x.name, value: x.c })), go: [link('Open Question bank', '/admin/questions')] }; }
    return null;
  }

  function overview() {
    const t = now(); const c = (sql, ...a) => { try { return one(sql, ...a).c; } catch { return 0; } };
    return { kind: 'stats', title: 'Platform at a glance', stats: [{ label: 'Students', value: c(`SELECT COUNT(*) c FROM users WHERE ${REAL} AND COALESCE(role,'student')='student'`) }, { label: 'Teachers', value: c(`SELECT COUNT(*) c FROM users WHERE ${REAL} AND role='teacher'`) }, { label: 'Staff and admins', value: c(`SELECT COUNT(*) c FROM users WHERE ${REAL} AND role IN ('editor','admin')`) }, { label: 'Batches', value: c('SELECT COUNT(*) c FROM batches WHERE COALESCE(archived,0)=0') }, { label: 'Published mocks', value: c("SELECT COUNT(*) c FROM mocks WHERE status='published' AND id!='__loadtest__' AND COALESCE(kind,'mock')='mock'") }, { label: 'Tests finished today', value: c("SELECT COUNT(*) c FROM attempts WHERE status='submitted' AND submitted_at>=? AND mock_id!='__loadtest__'", new Date().setHours(0, 0, 0, 0)) }, { label: 'Active in the last 5 minutes', value: c(`SELECT COUNT(*) c FROM users WHERE ${REAL} AND last_seen>?`, t - 300000) }, { label: 'Open tickets', value: c("SELECT COUNT(*) c FROM tickets WHERE status='open'") }, { label: 'Open question reports', value: c("SELECT COUNT(*) c FROM reports WHERE status='open'") }, { label: 'Doubts waiting', value: c("SELECT COUNT(*) c FROM desk_doubts WHERE status='open'") }], go: [link('Open Dashboard', '/admin')], follow: ['Show top students', 'Which students have not logged in for 14 days', 'What did admins do recently'] };
  }

  // ---------- entry ----------
  function answer(q) {
    const s = norm(q); if (!s) return null;
    if (/\b(handle|capacity|cope|afford|scale|simulate|stress|load test)\b/.test(s)) return null;
    const role = /\b(student|students|learner|learners|candidate|candidates|aspirant|aspirants)\b/.test(s) ? 'student' : /\b(teacher|teachers|tutor|tutors|faculty|mentor|mentors|instructor|instructors)\b/.test(s) ? 'teacher' : /\b(editor|editors|staff|content team|content writers?)\b/.test(s) ? 'editor' : /\b(admin|admins|administrator|administrators)\b/.test(s) ? 'admin' : null;
    const { exact, partial } = findPeople(s, q);
    if (exact.length === 1) return profile(exact[0]);
    if (exact.length > 1) return { kind: 'list', title: `${exact.length} people match`, summary: 'Pick one to see their details.', table: { cols: ['Name', 'Role', 'Email'], rows: exact.slice(0, 10).map((u) => ({ cells: [u.name, u.role || 'student', u.email || '—'], to: `/admin/users/${u.id}` })) }, go: [] };
    if (/\b(overview|summary|snapshot|at a glance|platform stats|everything|dashboard numbers|how is (the )?platform doing|how are we doing)\b/.test(s)) return overview();
    const mockM = (() => { const num = s.match(/\b(?:mock|test|paper)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/); const ms = all("SELECT * FROM mocks WHERE id!='__loadtest__' AND COALESCE(kind,'mock')='mock'"); const byName = ms.filter((m) => { const n = norm(m.name); return n.length >= 4 && s.includes(n); }).sort((a, b) => b.name.length - a.name.length)[0]; if (byName) return byName; if (num && !/\b(top|hardest|easiest|most|how many)\b/.test(s)) return ms.find((m) => m.number === Number(num[1])) || null; return null; })();
    if (mockM) return mockProfile(mockM);
    const bs = all('SELECT * FROM batches WHERE COALESCE(archived,0)=0');
    const bm = bs.filter((b) => { const n = norm(b.name); return (n.length >= 3 && s.includes(n)) || (b.code && s.split(' ').includes(String(b.code).toLowerCase())); }).sort((a, b) => b.name.length - a.name.length)[0];
    if (bm && !/\bbatches\b/.test(s)) return batchProfile(bm);
    if (/\bbatch(es)?\b/.test(s) && (!role || /\b(no|without|missing)\b.*\bteacher/.test(s))) return batchesList(s);
    if (/\b(students?|users?)\b.*\b(not in|without|outside|no)\b.*\bbatch|\bnot in any batch\b/.test(s)) { const rows = all(`SELECT id, name, email, role, last_seen FROM users WHERE ${REAL} AND COALESCE(role,'student')='student' AND id NOT IN (SELECT user_id FROM batch_members) ORDER BY created_at DESC LIMIT 30`); return { kind: 'list', title: `${rows.length}${rows.length === 30 ? '+' : ''} students are not in any batch`, table: rows.length ? peopleTable(rows) : null, empty: 'Every student is in a batch.', go: [link('Open Batches', '/admin/batches')] }; }
    if (/\b(audit|activity|admins? (did|done)|what (did|has|have)|recent changes|who (changed|deleted|edited))\b/.test(s) && /\b(admin|admins|staff|editor|editors|changed|activity|audit|did|done|changes)\b/.test(s) && !/\b(login|sign in)\b/.test(s)) return activity(s);
    if (!(role && /\b(not|never|havent|inactive)\b/.test(s)) && /\b(login|log in|sign in|signed in|logged in|sign-in)s?\b/.test(s) && /\b(today|yesterday|week|month|failed|fail|how many|count|last|past|\d+)\b/.test(s)) return activity(s);
    if (!role && /\b(online|active now|right now|currently active|using the (site|platform)|on the (site|platform))\b/.test(s) && /\b(who|how many|list|show|people|users)\b/.test(s)) { const rows = all(`SELECT id, name, email, role, last_seen FROM users WHERE ${REAL} AND last_seen>? ORDER BY last_seen DESC LIMIT 40`, now() - 300000); return { kind: 'list', title: `${rows.length} ${rows.length === 1 ? 'person' : 'people'} active in the last 5 minutes`, table: rows.length ? peopleTable(rows) : null, empty: 'Nobody is active right now.', go: [link('Open Live now', '/admin/live')], follow: ['Which tests are in progress now'] }; }
    if (role) return roleList(s, role);
    if (/\b(users|people|members|accounts)\b/.test(s)) { const st = all(`SELECT COALESCE(role,'student') r, COUNT(*) c FROM users WHERE ${REAL} GROUP BY r`); return { kind: 'stats', title: 'People on the platform', stats: st.map((x) => ({ label: ROLE_NAME[x.r] || x.r, value: x.c })), go: [link('Open Students', '/admin/users'), link('Open Administrators', '/admin/administrators')], follow: ['Show top students', 'Show all teachers'] }; }
    if (/\bmocks?\b|\btests? series\b|\bpapers?\b/.test(s) && !/\b(in progress|taking|running now)\b/.test(s)) return mocksList(s);
    const p = platform(s); if (p) return p;
    if (partial.length) { const rows = partial.slice(0, 8); return { kind: 'list', title: rows.length === 1 ? 'Is this who you mean?' : `${partial.length} people match that name`, summary: 'Type the full name or email to see their details.', table: { cols: ['Name', 'Role', 'Email'], rows: rows.map((u) => ({ cells: [u.name, u.role || 'student', u.email || '—'], to: `/admin/users/${u.id}` })) }, go: [] }; }
    return null;
  }
  return { answer, overview, norm };
}

export const DATA_EXAMPLES_ALL = [
  'Show top 10 students', 'Show the lowest scoring students', 'Which students have not logged in for 14 days', 'Students who never started a test', 'How many students joined this week', 'How many students do I have',
  'Who is online now', 'Show all teachers', 'Show all editors', 'How many admins do I have', 'Which students are not in any batch', 'Which batches have no teacher', 'Show all batches',
  'Which mock is the hardest', 'Which mock is attempted the most', 'Which mocks are not published', 'How many mocks are there', 'Which tests are in progress now',
  'How many tests were finished today', 'How many tests were finished this week', 'Show open support tickets', 'Show open question reports', 'How many doubts are waiting', 'How many certificates were issued',
  'What did admins do recently', 'Failed sign-ins today', 'How many sign-ins today', 'Platform overview', 'Show suspended students', 'Show new students this week'];
