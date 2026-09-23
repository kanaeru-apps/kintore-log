'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const start = source.indexOf('  var csvExportBusy =');
const end = source.indexOf('  /* ================== CSVインポート', start);
assert(start >= 0 && end > start);
function setup(native = true) {
  const calls = [], messages = [], button = { disabled: false };
  let downloaded;
  const context = {
    DB: { datesWithData: () => ['2026-09-23'], todayStr: () => '2026-09-23' },
    rowsForExerciseMaster: () => [['種目マスター', '胸', 'メモ\n2行目']],
    rowsForDate: () => [['記録', 'プレス,ダンベル', 12, '=1+1']],
    ROW_HEAD: ['種別', '名前', '値', 'メモ'],
    isNativeApp: () => native, $: () => button, toast: message => messages.push(message),
    nativePlugin: () => ({ save: args => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) }),
    noteAppError() {}, Blob,
    URL: { createObjectURL: () => 'blob:csv', revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { downloaded = this.download; }, remove() {} }) },
    setTimeout: fn => fn()
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return { context, calls, messages, button, downloaded: () => downloaded };
}
async function main() {
  {
    const t = setup(); const pending = t.context.exportCSV();
    assert.equal(t.messages.length, 0, 'Do not report success before save callback');
    assert.equal(t.button.disabled, true);
    await t.context.exportCSV(); assert.equal(t.calls.length, 1, 'Prevent duplicate dialogs');
    const payload = t.calls[0].args;
    assert.equal(payload.fileName, '筋トレLog_2026-09-23.csv');
    assert.ok(payload.text.startsWith('\uFEFF'));
    assert.ok(payload.text.includes('"プレス,ダンベル",12,\'=1+1'));
    assert.ok(payload.text.includes('"メモ\n2行目"'));
    t.calls[0].resolve({ saved: true, fileName: '変更した名前.csv' }); await pending;
    assert.ok(t.messages[0].includes('変更した名前.csv'));
    assert.ok(t.messages[0].includes('保存しました'));
    assert.equal(t.button.disabled, false);
  }
  for (const mode of ['cancel', 'error', 'unknown']) {
    const t = setup(); const pending = t.context.exportCSV();
    if (mode === 'cancel') t.calls[0].resolve({ saved: false, cancelled: true });
    else if (mode === 'error') t.calls[0].reject(new Error('disk full'));
    else t.calls[0].resolve({});
    await pending;
    assert.equal(t.messages.some(m => m.includes('保存しました')), false);
    assert.equal(t.button.disabled, false);
    const retry = t.context.exportCSV(); assert.equal(t.calls.length, 2);
    t.calls[1].resolve({ cancelled: true }); await retry;
  }
  {
    const t = setup(false); await t.context.exportCSV();
    assert.equal(t.calls.length, 0);
    assert.equal(t.downloaded(), '筋トレLog_2026-09-23.csv');
    assert.ok(t.messages[0].includes('ダウンロードを開始'));
  }
  console.log('CSV export check passed: completion / cancellation / failure / retry / duplicate prevention / BOM and escaping / browser download');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
