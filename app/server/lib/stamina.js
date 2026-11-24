// Stamina curve and panic-streak detection.
// We do not record when each answer was given, only how long each question was open. So the timeline is rebuilt by
// taking the questions in paper order and adding up the time spent on each. That matches how most students sit a mock.
const MIN = 60;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const round1 = (x) => Math.round(x * 10) / 10;

function block(list) {
  const total = list.length; const correct = list.filter((q) => q.status === 'correct').length; const wrong = list.filter((q) => q.status === 'incorrect').length;
  const attempted = correct + wrong; const sec = list.reduce((s, q) => s + (q.timeSec || 0), 0);
  return { total, attempted, correct, wrong, skipped: total - attempted, accuracy: pct(correct, attempted), attemptRate: pct(attempted, total), avgSec: total ? round1(sec / total) : 0 };
}

export function staminaOf(result, { windowMin = 20, minQuestions = 20 } = {}) {
  const qs = (result?.questions || []).filter((q) => !q.qualifying);
  const totalSec = qs.reduce((s, q) => s + (q.timeSec || 0), 0);
  if (qs.length < minQuestions || totalSec < 5 * MIN) return { available: false, reason: 'Stamina analysis needs a full-length mock. Practice sets are too short.' };

  // rebuild the timeline
  let t = 0; const line = qs.map((q, i) => { const from = t; t += q.timeSec || 0; return { q, i, from, to: t }; });
  const T = t; const win = Math.min(windowMin * MIN, T * 0.25);
  const firstHalf = line.filter((x) => x.to <= T / 2).map((x) => x.q);
  const finalWin = line.filter((x) => x.from >= T - win).map((x) => x.q);
  const fh = block(firstHalf); const fw = block(finalWin);

  // equal-sized chunks of the paper for the curve
  const N = 8; const per = Math.ceil(qs.length / N); const buckets = [];
  for (let k = 0; k < N; k++) { const part = line.slice(k * per, (k + 1) * per); if (!part.length) break; const b = block(part.map((x) => x.q)); buckets.push({ ...b, fromMin: Math.round(part[0].from / MIN), toMin: Math.round(part[part.length - 1].to / MIN), fromQ: part[0].i + 1, toQ: part[part.length - 1].i + 1, inFinal: part[0].from >= T - win }); }

  // panic streaks: 3 or more questions in a row that were skipped or wrong
  const avg = T / qs.length; const streaks = []; let run = [];
  const bad = (q) => q.status !== 'correct';
  const flush = () => {
    if (run.length >= 3) {
      const items = run.map((x) => x.q); const skips = items.filter((q) => q.status !== 'incorrect').length; const wrongs = items.length - skips;
      const sec = items.reduce((s, q) => s + (q.timeSec || 0), 0); const avgSec = sec / items.length;
      const kind = skips >= items.length * 0.67 ? 'skips' : wrongs >= items.length * 0.67 ? 'misses' : 'mixed';
      const lost = items.reduce((s, q) => s + (q.status === 'incorrect' ? -(q.marksAwarded || 0) : 0) + (q.status === 'incorrect' ? q.marks || 0 : q.marks || 0), 0);
      streaks.push({ kind, length: items.length, fromQ: run[0].i + 1, toQ: run[run.length - 1].i + 1, atMin: Math.round(run[0].from / MIN), inFinal: run[0].from >= T - win, avgSec: round1(avgSec), rushed: avgSec < avg * 0.6, skips, wrongs, qids: items.map((q) => q.id), marksLost: round1(lost) });
    }
    run = [];
  };
  for (const x of line) { if (bad(x.q)) run.push(x); else flush(); }
  flush();

  // end-of-section rush: last 5 of each section against the rest
  const sections = [];
  for (const key of [...new Set(qs.map((q) => q.section))]) {
    const sq = qs.filter((q) => q.section === key); if (sq.length < 10) continue;
    const tail = sq.slice(-5); const head = sq.slice(0, -5); const a = block(head); const b = block(tail);
    sections.push({ key, tail: b, head: a, accuracyDrop: a.accuracy != null && b.accuracy != null ? a.accuracy - b.accuracy : null, tailFaster: a.avgSec ? round1((1 - b.avgSec / a.avgSec) * 100) : 0 });
  }

  // verdict
  const drop = fh.accuracy != null && fw.accuracy != null ? fh.accuracy - fw.accuracy : 0;
  const faster = fh.avgSec ? (1 - fw.avgSec / fh.avgSec) * 100 : 0; const skipUp = (fw.total ? fw.skipped / fw.total : 0) - (fh.total ? fh.skipped / fh.total : 0);
  const finalStreaks = streaks.filter((s) => s.inFinal); const rushedEnd = sections.filter((s) => s.accuracyDrop >= 20 && s.tailFaster >= 25).length;
  let kind = 'steady'; let title = 'Steady all the way'; let text = `Your accuracy held up from the first half (${fh.accuracy ?? 0}%) to the last ${Math.round(win / MIN)} minutes (${fw.accuracy ?? 0}%). Your pace did not collapse near the end.`; const tips = [];
  if (finalStreaks.some((s) => s.length >= 3) && (drop >= 8 || skipUp >= 0.15)) {
    kind = 'panic'; title = 'Panic streak near the end';
    text = `In the last ${Math.round(win / MIN)} minutes you had ${finalStreaks.length} run${finalStreaks.length > 1 ? 's' : ''} of 3 or more skipped or missed questions in a row. Accuracy fell from ${fh.accuracy ?? 0}% to ${fw.accuracy ?? 0}%.`;
    tips.push('When two questions in a row go wrong, stop for 10 seconds and breathe. Then pick the next question you are sure of.', 'Keep a rule: skip anything that needs more than a minute. Come back if time allows.');
  } else if (drop >= 12 && faster >= 25) {
    kind = 'rush'; title = 'You rushed the end'; text = `You sped up by ${Math.round(faster)}% in the last ${Math.round(win / MIN)} minutes, and accuracy fell from ${fh.accuracy ?? 0}% to ${fw.accuracy ?? 0}%. The fast answers were costing marks.`;
    tips.push('Hold the same pace you used in the first half. Marks lost to guessing quickly usually cost more than the time saved.', 'Plan a time check every 30 minutes so the last section does not become a sprint.');
  } else if (drop >= 12) {
    kind = 'fade'; title = 'Accuracy faded late'; text = `Accuracy dropped from ${fh.accuracy ?? 0}% to ${fw.accuracy ?? 0}% in the last ${Math.round(win / MIN)} minutes even though your pace stayed similar. That looks like tiredness, not hurry.`;
    tips.push('Practise full-length mocks at the same time of day as your exam to build stamina.', 'Take two slow breaths between sections. Do not skip water and food before the exam.');
  } else if (fw.accuracy != null && fh.accuracy != null && fw.accuracy - fh.accuracy >= 8) {
    kind = 'strong'; title = 'You finished strong'; text = `Accuracy rose from ${fh.accuracy}% in the first half to ${fw.accuracy}% at the end. You settle in as the paper goes on. Try starting your best section first to bank marks early.`;
  } else if (streaks.length) {
    kind = 'streaks'; title = 'A few bad runs'; text = `Stamina was fine overall, but you had ${streaks.length} run${streaks.length > 1 ? 's' : ''} of 3 or more skipped or missed questions in a row.`;
    tips.push('A bad run often means a hard cluster of questions. Skip ahead and return to it at the end.');
  }
  if (rushedEnd) tips.push(`${rushedEnd} section${rushedEnd > 1 ? 's' : ''} ended with a rush: the last 5 questions were much faster and less accurate. Reserve the final 3 minutes of each section for those.`);

  return {
    available: true, totalMin: Math.round(T / MIN), windowMin: Math.round(win / MIN), firstHalf: fh, final: fw, buckets, streaks,
    streakMarksLost: round1(streaks.reduce((s, x) => s + x.marksLost, 0)), sections, verdict: { kind, title, text, tips },
    note: 'Built from the time spent on each question, in paper order.',
  };
}
