'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const storage = new Map();
const body = { innerHTML: '' };
const ctx = vm.createContext({
  localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  document: { documentElement: {}, querySelector: () => body },
  getComputedStyle: () => ({ getPropertyValue: () => '' })
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/db.js'), 'utf8'), ctx);
const db = ctx.DB;
const exercise = db.getExercises().find(e => e.part === '胸' && e.equip === 'バーベル');
assert.ok(exercise);
function record(date, weight, reps) {
  const entry = db.addEntry(date, exercise.id);
  db.updateSet(date, entry.id, 0, 'w', weight);
  db.updateSet(date, entry.id, 0, 'r', reps);
}
record('2026-01-01', 100, 5);
record('2026-01-01', 90, 5); // Same day must not take two medals.
for (let day = 2; day <= 15; day++) record('2026-01-' + String(day).padStart(2, '0'), 40 + day, 1);
const source = fs.readFileSync(path.join(root, 'js/charts.js'), 'utf8')
  .replace('return { init: init };', 'return { collect: collectExerciseSessions, bestRm: bestRmRecordCard, render: function(id) { state.exId = id; renderExercisePane(); } };');
vm.runInContext(source, ctx);
const sessions = ctx.Charts.collect(exercise.id);
const before = JSON.stringify(sessions);
const medals = ctx.Charts.bestRm(sessions);
assert.equal(JSON.stringify(sessions), before, 'Ranking must not reorder the graph sessions');
assert.match(medals, /1\/1<\/span><span class="br-vol">109\.8 kg/);
assert.match(medals, /1\/15<\/span><span class="br-vol">55 kg/);
assert.equal((medals.match(/1\/1<\/span>/g) || []).length, 1);
const sparse = ctx.Charts.bestRm([{ date: '2026-01-01', rm: 80 }, { date: '2026-01-02', rm: 0 }]);
assert.equal((sparse.match(/class="br-row"/g) || []).length, 3);
assert.equal((sparse.match(/記録なし/g) || []).length, 2);
ctx.Charts.render(exercise.id);
const titles = [...body.innerHTML.matchAll(/class="chart-card-title">([^<]+)/g)].map(m => m[1]);
assert.deepEqual(titles, ['ベスト記録 TOP3（合計ボリューム）', 'ベスト記録 TOP3（1RM）', 'セッション合計ボリューム（kg）', '推定1RM推移（kg）']);
assert.match(body.innerHTML, /109\.8 kg/, 'All-time best must remain even outside the last 12 sessions');
ctx.Charts.render('missing');
assert.match(body.innerHTML, /この種目の記録がまだありません/);
console.log('Chart ranking and order checks passed');
