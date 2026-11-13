'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const storage = new Map();
const body = { innerHTML: '' };
const scrolls = [{ scrollWidth: 552, clientWidth: 276, scrollLeft: 0 }, { scrollWidth: 552, clientWidth: 276, scrollLeft: 0 }];
body.querySelectorAll = () => scrolls;
const ctx = vm.createContext({
  requestAnimationFrame: callback => callback(),
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
  .replace('return { init: init };', 'return { line: lineChartSvg, bar: barChartSvg, collect: collectExerciseSessions, bestRm: bestRmRecordCard, render: function(id) { state.exId = id; renderExercisePane(); } };');
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
assert.ok(scrolls.every(s => s.scrollLeft === 276), 'Both charts initially show the latest records');
const titles = [...body.innerHTML.matchAll(/class="chart-card-title">([^<]+)/g)].map(m => m[1]);
assert.deepEqual(titles, ['ベスト記録 TOP3（合計ボリューム）', 'ベスト記録 TOP3（1RM）', 'セッション合計ボリューム（kg）', '推定1RM推移（kg）']);
assert.match(body.innerHTML, /109\.8 kg/, 'All-time best must remain even outside the last 12 sessions');
ctx.Charts.render('missing');
assert.match(body.innerHTML, /この種目の記録がまだありません/);
// Reproduce crowded dates, including the last two labels that used to overlap.
const dates = ['10/6', '10/10', '10/11', '10/14', '10/20', '10/23', '10/25', '10/26', '10/27', '11/2', '11/6', '11/10'];
for (const count of [1, 2, 6, 11, 12]) {
  const points = dates.slice(0, count).map((label, i) => ({ label, value: 100 + i }));
  for (const type of ['line', 'bar']) {
    const svg = ctx.Charts[type](points);
    const labels = [...svg.matchAll(/class="chart-axis-label chart-date-label" text-anchor="middle" x="([\d.]+)" y="[\d.]+">([^<]+)</g)]
      .map(m => ({ x: Number(m[1]), label: m[2], width: m[2].length * 6 }));
    assert.equal(labels[0].label, points[0].label);
    assert.equal(labels.at(-1).label, points.at(-1).label);
    assert.equal(labels.length, count, 'Every date is shown without thinning');
    const plotWidth = 276 * Math.max(1, count) / Math.min(6, count);
    assert.ok(svg.includes('style="width:' + (count / Math.min(6, count) * 100) + '%"'), 'Viewport fits six records, or all records when fewer');
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      assert.ok(label.x - label.width / 2 >= 0 && label.x + label.width / 2 <= plotWidth, 'Dates stay inside chart bounds');
      if (i) assert.ok(label.x - label.width / 2 - (labels[i - 1].x + labels[i - 1].width / 2) >= 11.9, 'Adjacent dates, including the last date, have breathing room');
    }
    assert.equal((svg.match(type === 'line' ? /class="chart-line-dot"/g : /class="chart-bar-seg"/g) || []).length, count, 'All recorded points remain visible');
  }
}
console.log('Chart ranking, order and date spacing checks passed');
