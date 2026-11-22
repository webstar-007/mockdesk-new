// Restoring a backup: the chosen file is checked and staged next to the database; the swap happens at the next start-up,
// before the database is opened. The database that was replaced is kept beside it as mockdesk.db.before-restore-<time>.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
export const dbFile = (db) => db.prepare('PRAGMA database_list').all().find((x) => x.name === 'main')?.file || '';
export const stagedPath = (db) => { const f = dbFile(db); return f ? `${f}.restore` : ''; };
export function stageRestore(db, src) {
  const f = dbFile(db); if (!f) throw new Error('This database lives in memory, so there is nothing to restore into.');
  const t = new DatabaseSync(src, { readOnly: true });
  try {
    const n = t.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('users','attempts','mocks','questions')").get().c;
    if (n < 4) throw new Error('This file is not a MockDesk backup.');
    const qc = t.prepare('PRAGMA quick_check').get(); if (Object.values(qc)[0] !== 'ok') throw new Error('This backup is damaged and cannot be restored.');
  } finally { t.close(); }
  fs.copyFileSync(src, `${f}.restore`); return `${f}.restore`;
}
export const cancelRestore = (db) => { const s = stagedPath(db); if (s && fs.existsSync(s)) { fs.rmSync(s); return true; } return false; };
export function applyStagedRestore(file) {
  const s = `${file}.restore`; if (!file || !fs.existsSync(s)) return null;
  const keep = `${file}.before-restore-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;
  if (fs.existsSync(file)) fs.renameSync(file, keep);
  for (const x of ['-wal', '-shm']) fs.rmSync(file + x, { force: true });
  fs.renameSync(s, file); return keep;
}
