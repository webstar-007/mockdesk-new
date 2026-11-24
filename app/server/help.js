// Admin Help: ask a question in plain words, get the answer, the steps and a button that opens the right page.
// Works offline from the knowledge base in helpkb.js, and adds live facts (students, disk, backups, alerts) for "how many / is it ok" questions.
import fs from 'node:fs';
import { KB, AREAS, SYNONYMS, STOP, SUGGESTED } from './helpkb.js';
import { dbFile } from './lib/restore.js';
import { listBackups } from './ops.js';
import { startedAt } from './lib/health.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w);
const toks = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);
const swapped = (a, b) => { if (a.length !== b.length) return false; const d = []; for (let i = 0; i < a.length && d.length < 3; i++) if (a[i] !== b[i]) d.push(i); return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]; };
const lev = (a, b, max) => { if (swapped(a, b)) return 1; if (Math.abs(a.length - b.length) > max) return max + 1; let prev = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const cur = [i]; let low = i; for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); low = Math.min(low, cur[j]); } if (low > max) return max + 1; prev = cur; } return prev[b.length]; };

// Index once: every entry gets weighted token sets.
const INDEX = KB.map((e) => ({ e, title: new Set(toks(e.title)), kw: new Set(e.kw.flatMap((k) => toks(k))), body: new Set(toks(`${e.a} ${(e.steps || []).join(' ')}`)), area: new Set(toks(e.area)), phrases: e.kw.map(norm).filter((k) => k.includes(' ')), titleN: norm(e.title) }));
const VOCAB = new Set(INDEX.flatMap((x) => [...x.title, ...x.kw, ...x.body]));
const byId = new Map(KB.map((e) => [e.id, e]));

export function search(question, { limit = 4 } = {}) {
  const raw = norm(question); let q = toks(question); let fixed = null;
  // fix small typos against words we know
  q = q.map((w) => { if (VOCAB.has(w) || w.length < 5) return w; let best = null, bd = 3; for (const v of VOCAB) { const d = lev(w, v, 2); if (d < bd) { bd = d; best = v; } } if (best && bd <= (w.length >= 7 ? 2 : 1)) { fixed = true; return best; } return w; });
  const exp = new Set(q); for (const w of q) for (const s of SYNONYMS[w] || []) toks(s).forEach((t) => exp.add(t));
  const scored = INDEX.map((x) => {
    let s = 0; const hits = new Set();
    for (const w of exp) { const direct = q.includes(w) ? 1 : 0.6; let m = 0; if (x.title.has(w)) m = Math.max(m, 4); if (x.kw.has(w)) m = Math.max(m, 3); if (x.area.has(w)) m = Math.max(m, 1.2); if (x.body.has(w)) m = Math.max(m, 1); if (m) { s += m * direct; hits.add(w); } }
    for (const p of x.phrases) if (raw.includes(p)) s += 6;
    if (raw && x.titleN.includes(raw)) s += 8;
    const cover = q.length ? [...q].filter((w) => hits.has(w)).length / q.length : 0; s *= 0.55 + 0.45 * cover;
    return { e: x.e, score: s, cover };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const top = scored[0]; const strong = !!top && top.score >= 4 && top.cover >= 0.34;
  return { fixed: !!fixed, strong, results: scored.slice(0, limit).map((x) => ({ id: x.e.id, title: x.e.title, area: x.e.area, score: Math.round(x.score * 10) / 10 })), words: q };
}

const card = (e) => ({ id: e.id, area: e.area, title: e.title, answer: e.a, steps: e.steps || [], go: (e.go || []).map(([label, to]) => ({ label, to })), related: (e.rel || []).filter((r) => byId.has(r)).map((r) => ({ id: r, title: byId.get(r).title })) });

export function mountHelp({ r, db, now, audit, bad, jobs }) {
  db.exec(`CREATE TABLE IF NOT EXISTS help_log(id INTEGER PRIMARY KEY, user_id INTEGER, q TEXT, matched TEXT, score REAL, at INTEGER, helpful INTEGER, note TEXT);
    CREATE INDEX IF NOT EXISTS idx_help_log_at ON help_log(at);`);
  const one = (sql, ...a) => db.prepare(sql).get(...a); const all = (sql, ...a) => db.prepare(sql).all(...a);
  const SIM = '%@loadtest.invalid';

  function live(q) {
    const t = now(); const s = norm(q); const L = []; let title = '', go = [];
    if (/\b(handle|capacity|support|cope|afford|scale|simulate|stress)\b/.test(s)) return null;
    if (/\b(how many|number of|count|total)\b.*\b(student|user|people|member)/.test(s) || /\bstudent(s)? (count|total)\b/.test(s)) {
      title = 'Students right now'; go = [{ label: 'Open all students', to: '/admin/users' }];
      L.push(['Students', one(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND email NOT LIKE '${SIM}'`).c], ['Joined in the last 7 days', one(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND email NOT LIKE '${SIM}' AND created_at>?`, new Date(t - 7 * 86400000).toISOString()).c], ['Active in the last 5 minutes', one(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND last_seen>? AND email NOT LIKE '${SIM}'`, t - 300000).c], ['Taking a test now', one("SELECT COUNT(*) c FROM attempts WHERE status='in_progress' AND mock_id!='__loadtest__'").c]);
    } else if (/\b(who|how many)\b.*\b(online|active|taking|using|logged in|on the site)\b|\bwho is (online|taking)/.test(s)) {
      title = 'Who is on the platform'; go = [{ label: 'Open Live now', to: '/admin/live' }];
      L.push(['Students active in the last 5 minutes', one(`SELECT COUNT(*) c FROM users WHERE COALESCE(role,'student')='student' AND last_seen>? AND email NOT LIKE '${SIM}'`, t - 300000).c], ['Tests in progress', one("SELECT COUNT(*) c FROM attempts WHERE status='in_progress' AND mock_id!='__loadtest__'").c], ['Staff and teachers active', one("SELECT COUNT(*) c FROM users WHERE role IN ('admin','editor','teacher') AND last_seen>?", t - 300000).c]);
    } else if (/\b(disk|storage|space)\b/.test(s) && /\b(left|free|used|much|full|available|enough|low)\b/.test(s)) {
      title = 'Disk space'; go = [{ label: 'Open System checks', to: '/admin/system' }];
      try { const f = dbFile(db); const st = fs.statfsSync(f ? f.replace(/[^/]*$/, '') || '.' : '.'); const total = st.blocks * st.bsize, free = st.bavail * st.bsize; L.push(['Free', `${(free / 1073741824).toFixed(1)} GB`], ['Total', `${(total / 1073741824).toFixed(1)} GB`], ['Used', `${Math.round(((total - free) / total) * 100)}%`], ['Database size', `${Math.round((fs.statSync(f).size) / 1048576)} MB`]); } catch { L.push(['Disk', 'could not be read here']); }
    } else if (/\b(last|latest|recent|when)\b.*\bbackup\b|\bbackup\b.*\b(when|last|latest|taken|ok|working)\b/.test(s)) {
      title = 'Backups'; go = [{ label: 'Open Data and backup', to: '/admin/data' }];
      try { const b = listBackups(); L.push(['Backups kept', b.length]); if (b[0]) L.push(['Latest', new Date(b[0].at || b[0].mtime || t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]); else L.push(['Latest', 'none yet. Take one now.']); } catch { L.push(['Backups', 'could not be listed']); }
    } else if (/\b(open|pending|unanswered|waiting)\b.*\b(ticket|support|message|help request)/.test(s) || /\bsupport inbox\b.*\b(how many|count)/.test(s)) {
      title = 'Support inbox'; go = [{ label: 'Open Support inbox', to: '/admin/support' }];
      L.push(['Open tickets', one("SELECT COUNT(*) c FROM tickets WHERE status='open'").c], ['Waiting for your reply', one("SELECT COUNT(*) c FROM tickets WHERE status='open' AND last_from='student'").c]);
    } else if (/\b(pending|open|new|unresolved)\b.*\b(report|reported)/.test(s)) {
      title = 'Reported questions'; go = [{ label: 'Open Student reports', to: '/admin/reports' }];
      L.push(['Open reports', one("SELECT COUNT(*) c FROM reports WHERE status='open'").c]);
    } else if (/\b(any|is there|are there)\b.*\b(problem|issue|alert|wrong|error)|\b(is|are)\b.*\b(server|site|platform|everything|system|app)\b.*\b(ok|okay|fine|healthy|working|up|running)|\b(status|health check|how is the (server|platform|site))\b/.test(s)) {
      title = 'Platform status'; go = [{ label: 'Open Alerts', to: '/admin/alerts' }, { label: 'Open Monitoring', to: '/admin/monitor' }];
      let n = { bad: 0, warn: 0, info: 0 }; try { for (const x of all('SELECT level, COUNT(*) c FROM admin_alerts WHERE resolved_at IS NULL AND (snooze_until IS NULL OR snooze_until<?) GROUP BY level', t)) n[x.level] = x.c; } catch { /* no alerts table yet */ }
      const total = n.bad + n.warn + n.info; L.push(['Open alerts', total ? `${total} (${n.bad} urgent, ${n.warn} warnings, ${n.info} notices)` : 'none. All clear.'], ['Running for', `${Math.max(1, Math.round((t - startedAt) / 3600000))} hours`], ['Memory used by the app', `${Math.round(process.memoryUsage().rss / 1048576)} MB`]);
    }
    return L.length ? { title, lines: L.map(([label, value]) => ({ label, value })), go } : null;
  }

  r.get('/help', (req, res) => {
    const counts = {}; for (const e of KB) counts[e.area] = (counts[e.area] || 0) + 1;
    const popular = all('SELECT matched id, COUNT(*) n FROM help_log WHERE matched IS NOT NULL AND at>? GROUP BY matched ORDER BY n DESC LIMIT 6', now() - 60 * 86400000).filter((x) => byId.has(x.id)).map((x) => ({ id: x.id, title: byId.get(x.id).title }));
    const recent = all('SELECT DISTINCT q FROM help_log WHERE user_id=? ORDER BY id DESC LIMIT 12', req.user.id).map((x) => x.q).slice(0, 6);
    res.json({ areas: AREAS.map((a) => ({ name: a, count: counts[a] || 0 })), suggested: SUGGESTED, popular, recent, total: KB.length, canGaps: req.user.role === 'admin' });
  });

  r.post('/help/ask', (req, res) => {
    const q = String(req.body?.q || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (q.length < 2) return bad(res, 'Type a question first.');
    const s = norm(q); let kind = 'answer';
    const out = { q, kind, card: null, alternatives: [], live: null, say: '', logId: null };
    if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(s) && s.split(' ').length <= 4) { out.kind = 'chat'; out.say = 'Hello! Ask me anything about running the platform, for example how to add a teacher, back up the data or test how many students the server can handle.'; }
    else if (/^(thanks|thank you|thx|ok thanks|great|cool)\b/.test(s) && s.split(' ').length <= 4) { out.kind = 'chat'; out.say = 'You are welcome. Ask another time if you need anything.'; }
    else if (/\b(what can you (do|help)|what do you do|help me|what can i ask)\b/.test(s)) { out.kind = 'chat'; out.say = 'I can explain any feature, give you step-by-step instructions, open the right page for you, and answer quick questions like "how many students do I have?" or "is the server okay?". Try one of the suggestions below.'; out.alternatives = SUGGESTED.slice(0, 5).map((t) => ({ id: null, title: t, ask: true })); }
    if (out.kind === 'answer') {
      out.live = live(q); const m = search(q); const best = m.results[0];
      if (m.strong && best) { out.card = card(byId.get(best.id)); out.alternatives = m.results.slice(1, 4).map((x) => ({ id: x.id, title: x.title })); out.fixed = m.fixed; }
      else if (m.results.length && best.score >= 2.5) { out.kind = 'maybe'; out.say = out.live ? '' : 'I am not sure I understood. Is it one of these?'; out.alternatives = m.results.slice(0, 4).map((x) => ({ id: x.id, title: x.title })); }
      else if (!out.live) { out.kind = 'none'; out.say = 'I do not have an answer for that yet. I have saved your question so it can be added. You can browse by topic below.'; }
      out.matched = out.card?.id || null; out.score = best?.score ?? 0;
    }
    const ins = db.prepare('INSERT INTO help_log(user_id,q,matched,score,at) VALUES (?,?,?,?,?)').run(req.user.id, q, out.card?.id || (out.kind === 'none' ? null : out.alternatives[0]?.id || null), out.score ?? 0, now()); out.logId = Number(ins.lastInsertRowid);
    res.json(out);
  });

  r.get('/help/topic/:id', (req, res) => { const e = byId.get(req.params.id); if (!e) return bad(res, 'Topic not found', 404); db.prepare('INSERT INTO help_log(user_id,q,matched,score,at) VALUES (?,?,?,?,?)').run(req.user.id, `[opened] ${e.title}`, e.id, 99, now()); res.json({ card: card(e) }); });
  r.get('/help/area/:name', (req, res) => { const list = KB.filter((e) => e.area === req.params.name); if (!list.length) return bad(res, 'Not found', 404); res.json({ area: req.params.name, topics: list.map((e) => ({ id: e.id, title: e.title })) }); });
  // help for the page the admin is on: topics whose "open this page" link points here
  r.get('/help/page', (req, res) => {
    const p = String(req.query.path || '').replace(/\?.*$/, '').replace(/\/+$/, '') || '/admin'; const seg = p.split('/').slice(0, 3).join('/');
    const list = KB.filter((e) => (e.go || []).some(([, to]) => to === seg)).slice(0, 5); res.json({ path: seg, topics: list.map((e) => ({ id: e.id, title: e.title })) });
  });
  r.post('/help/feedback', (req, res) => {
    const id = Number(req.body?.logId); const row = one('SELECT * FROM help_log WHERE id=? AND user_id=?', id, req.user.id); if (!row) return bad(res, 'Not found', 404);
    db.prepare('UPDATE help_log SET helpful=?, note=? WHERE id=?').run(req.body?.helpful ? 1 : 0, String(req.body?.note || '').slice(0, 300) || null, id); res.json({ ok: true });
  });
  // what people asked that we could not answer or that did not help: the to-do list for improving Help
  r.get('/help/gaps', (req, res) => {
    const rows = all(`SELECT q, COUNT(*) n, MAX(at) last, SUM(CASE WHEN helpful=0 THEN 1 ELSE 0 END) unhelpful FROM help_log WHERE q NOT LIKE '[opened]%' AND (matched IS NULL OR helpful=0) AND at>? GROUP BY q ORDER BY n DESC, last DESC LIMIT 50`, now() - 90 * 86400000);
    res.json({ gaps: rows, asked: one("SELECT COUNT(*) c FROM help_log WHERE q NOT LIKE '[opened]%'").c, answered: one("SELECT COUNT(*) c FROM help_log WHERE q NOT LIKE '[opened]%' AND matched IS NOT NULL").c });
  });
  r.delete('/help/history', (req, res) => { db.prepare('DELETE FROM help_log WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });
}
