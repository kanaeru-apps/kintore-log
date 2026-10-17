const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../js/app.js', 'utf8');
const nodes = new Map();
function $(id) {
  if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, offsetHeight: 180, hidden: true,
    classList: { add() {}, remove() {} }, blur() {}, focus() {}, addEventListener() {},
    setSelectionRange() {} });
  return nodes.get(id);
}
const added = [];
let sets = [{ t: '', ts: '' }];
const ctx = { $, window: { innerHeight: 850, visualViewport: { offsetTop: 0, height: 850 } },
  localStorage: { setItem() {} }, ui: { date: '2026-10-17', lapOpen: {} },
  CARDIO_KEYS_ALL: ['t', 'ts', 'd'], fmtSeconds: String, rememberPageScroll() {}, restorePageScroll() {},
  caretSelectAll() {}, toast() {}, renderLog() {},
  DB: { getWorkout: () => ({ entries: [{ id: 'test', sets }] }),
    addCardioSets: (...args) => added.push(args) } };
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf("  var GEN_CFG_KEY"), source.indexOf('  /* ================== 記録タブ')), ctx);
ctx.openGen('test');
ctx.openGenInput('genWorkS');
$('#genInputValue').value = '90';
ctx.closeGenInput(true);
assert.equal(ctx.genCfg.work, 90);
assert.equal($('#genWorkM').value, '1');
assert.equal($('#genWorkS').value, '30');
ctx.openGenInput('genWorkM');
$('#genInputValue').value = '20';
ctx.closeGenInput(false);
assert.equal(ctx.genCfg.work, 90);
for (const raw of ['', '-1', 'abc']) {
  ctx.openGenInput('genWorkS'); $('#genInputValue').value = raw; ctx.closeGenInput(true);
  assert.equal(ctx.genCfg.work, 90);
}
ctx.openGenInput('genWorkM'); $('#genInputValue').value = '9999'; ctx.closeGenInput(true);
assert.equal(ctx.genCfg.work, 1800);
ctx.setGen('work', 0); assert.equal(ctx.genCfg.work, 5);
ctx.openGenInput('genReps'); $('#genInputValue').value = '99'; ctx.closeGenInput(true);
assert.equal(ctx.genCfg.reps, 60);
ctx.openGenInput('genReps'); $('#genInputValue').value = '0'; ctx.closeGenInput(true);
assert.equal(ctx.genCfg.reps, 1);
ctx.setGen('rest', 0); ctx.doGen();
assert.equal(added[0][2].length, 1); assert.equal(added[0][3], true);
sets = [{ t: 3, ts: 20 }]; ctx.openGen('test'); ctx.setGen('rest', 90); ctx.setGen('reps', 2); ctx.doGen();
assert.equal(added[1][2].length, 4); assert.equal(added[1][3], false);
ctx.openGen('test'); ctx.openGenInput('genRestM');
ctx.genInputKeyboardHeight = 320; ctx.updateGenInputViewport();
assert.equal($('#genInputSheet').style.top, '350px');
ctx.window.visualViewport = { offsetTop: 20, height: 450 }; ctx.updateGenInputViewport();
assert.equal($('#genInputSheet').style.top, '290px');
ctx.genInputKeyboardHeight = 0; ctx.window.visualViewport = { offsetTop: 0, height: 850 };
ctx.updateGenInputViewport(); assert.equal($('#genInputSheet').style.top, '670px');
ctx.closeGen(); assert.equal(ctx.genInputTarget, null); assert.equal($('#genInputSheet').hidden, true);
assert.equal($('#genSheet').inert, false);
console.log('PASS: confirm/cancel, seconds normalization, empty/invalid input, limits, REST zero, existing-record preservation, native/viewport keyboard placement, cleanup');

// URL入力のiOS resize:noneと通常のvisualViewportの両方を検証する。
const properties = {};
const modal = $('#exModal');
modal.classList.contains = () => true;
modal.contains = () => true;
modal.style.setProperty = (key, value) => { properties[key] = value; };
modal.style.removeProperty = key => { delete properties[key]; };
modal.getBoundingClientRect = () => ({ top: 16, bottom: 514 });
modal.scrollTop = 0;
ctx.document = { activeElement: { matches: () => true, getBoundingClientRect: () => ({ top: 650, bottom: 690, height: 40 }) } };
vm.runInContext(source.slice(source.indexOf('  var exInfoKeyboardHeight'), source.indexOf('  function scheduleExInfoViewport')), ctx);
ctx.exInfoKeyboardHeight = 320;
ctx.updateExInfoViewport();
assert.equal(properties['--ex-info-height'], '498px');
assert.equal(properties['--ex-info-top'], '265px');
assert(modal.scrollTop > 0, 'URL input scrolls into visible area');
ctx.exInfoKeyboardHeight = 0;
ctx.window.visualViewport = { offsetTop: 20, height: 450 };
ctx.updateExInfoViewport();
assert.equal(properties['--ex-info-height'], '418px');
assert.equal(properties['--ex-info-top'], '245px');
ctx.document.activeElement = null;
ctx.updateExInfoViewport();
assert.equal(properties['--ex-info-height'], undefined);
console.log('PASS: YouTube URL native keyboard height, viewport positioning, scroll and focus cleanup');
