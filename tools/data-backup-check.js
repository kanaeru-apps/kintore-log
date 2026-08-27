/* CSVとネイティブJSONバックアップの後方互換・復元内容を確認する軽量テスト。 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

function storageMock() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

/* App Store版のDocumentsバックアップはDB全体のJSONなので、種目のURL・メモも戻ることを確認する。 */
const dbContext = {
  console,
  localStorage: storageMock(),
  getComputedStyle() { return { getPropertyValue() { return ''; } }; },
  document: { documentElement: {} }
};
vm.createContext(dbContext);
vm.runInContext(read('js/db.js'), dbContext, { filename: 'js/db.js' });

const firstExercise = dbContext.DB.getExercises()[0];
const backupVideo = 'https://www.youtube.com/watch?v=backup-test';
const backupNote = '肩甲骨を寄せる\n胸を張る';
dbContext.DB.updateExercise(firstExercise.id, { video: backupVideo, note: backupNote });
const nativeBackup = dbContext.DB.exportStateJSON();
dbContext.DB.updateExercise(firstExercise.id, { video: '', note: '' });
assert.equal(dbContext.DB.restoreStateJSON(nativeBackup), true);
assert.equal(dbContext.DB.getExercise(firstExercise.id).video, backupVideo);
assert.equal(dbContext.DB.getExercise(firstExercise.id).note, backupNote);

dbContext.DB.importExercises([{
  part: firstExercise.part,
  name: firstExercise.name,
  equip: firstExercise.equip,
  video: 'https://example.com/form',
  note: '復元メモ'
}], true);
assert.equal(dbContext.DB.getExercise(firstExercise.id).video, 'https://example.com/form');
assert.equal(dbContext.DB.getExercise(firstExercise.id).note, '復元メモ');

/* app.jsのCSV処理だけを取り出し、ブラウザに依存しない入出力部分を確認する。 */
const appSource = read('js/app.js');
const csvStart = appSource.indexOf('  /* ================== CSVエクスポート用の行データ');
const csvEnd = appSource.indexOf('  /* ================== RM計算機', csvStart);
assert(csvStart >= 0 && csvEnd > csvStart, 'app.jsのCSV処理ブロックが見つかりません');

const INPUT_LIMITS = {
  exerciseName: 100,
  equipment: 100,
  exerciseNote: 2000,
  dayMemo: 5000,
  videoUrl: 2048
};
const limitedText = (value, max) => String(value == null ? '' : value).slice(0, max);
const safeHttpsUrl = (value) => {
  const raw = limitedText(value, INPUT_LIMITS.videoUrl).trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch (_) { return ''; }
};
const exercises = [{
  id: 'ex1', part: '胸', name: 'テストプレス', equip: 'ダンベル',
  video: 'https://example.com/video', note: '肘を開きすぎない'
}];
const workout = {
  memo: '当日のメモ',
  entries: [{
    exId: 'ex1', part: '胸', name: 'テストプレス', equip: 'ダンベル',
    sets: [{ w: 20, r: 10 }]
  }]
};
const csvContext = {
  console,
  URL,
  INPUT_LIMITS,
  limitedText,
  safeHttpsUrl,
  DB: {
    PARTS: ['胸', '背中', '脚', '肩', '腕', '腹', '有酸素', 'その他'],
    getExercises() { return exercises; },
    getWorkout(date) { return date === '2026-08-27' ? workout : null; },
    datesWithData() { return ['2026-08-27']; },
    todayStr() { return '2026-08-27'; }
  },
  parseDate(value) { return new Date(value + 'T00:00:00'); },
  WD: ['日', '月', '火', '水', '木', '金', '土'],
  isCardio(entry) { return entry.part === '有酸素'; },
  zoneCsv(value) { return value || ''; },
  zoneOf() { return ''; },
  zoneFromCsv(value) { return value || ''; },
  CARDIO_PART: '有酸素',
  toast() {},
  confirm() { return false; },
  localStorage: storageMock(),
  Blob,
  document: {},
  setTimeout() {}
};
vm.createContext(csvContext);
vm.runInContext(appSource.slice(csvStart, csvEnd), csvContext, { filename: 'js/app.js#csv' });

assert.equal(csvContext.ROW_HEAD.length, 21);
assert.deepEqual(
  Array.from(csvContext.ROW_HEAD.slice(-3)),
  ['データ種別', '参考動画URL', 'フォームメモ']
);
const workoutRows = csvContext.rowsForDate('2026-08-27');
const masterRows = csvContext.rowsForExerciseMaster();
assert.equal(workoutRows[0].length, 21);
assert.equal(workoutRows[0][18], '記録');
assert.equal(masterRows[0].length, 21);
assert.equal(masterRows[0][18], '種目マスター');
assert.equal(masterRows[0][19], 'https://example.com/video');
assert.equal(masterRows[0][20], '肘を開きすぎない');

const imported = csvContext.buildImportData([
  Array.from(csvContext.ROW_HEAD),
  Array.from(workoutRows[0]),
  Array.from(masterRows[0])
]);
assert.equal(imported.error, undefined);
assert.equal(imported.dateOrder.length, 1);
assert.equal(imported.rowCount, 1);
assert.equal(imported.exercises.length, 1);
assert.equal(imported.exercises[0].video, 'https://example.com/video');
assert.equal(imported.exercises[0].note, '肘を開きすぎない');

/* v0.13.17以前の18列CSVも従来どおり読み込める。 */
const oldHeader = Array.from(csvContext.ROW_HEAD.slice(0, 18));
const oldRow = Array.from(workoutRows[0].slice(0, 18));
const oldImported = csvContext.buildImportData([oldHeader, oldRow]);
assert.equal(oldImported.error, undefined);
assert.equal(oldImported.dateOrder.length, 1);
assert.equal(oldImported.exercises.length, 0);

/* 記録が無い、種目マスターだけのバックアップも復元対象になる。 */
const masterOnly = csvContext.buildImportData([Array.from(csvContext.ROW_HEAD), Array.from(masterRows[0])]);
assert.equal(masterOnly.dateOrder.length, 0);
assert.equal(masterOnly.exercises.length, 1);

const unsafeMaster = Array.from(masterRows[0]);
unsafeMaster[19] = 'http://example.com/video';
assert.throws(
  () => csvContext.buildImportData([Array.from(csvContext.ROW_HEAD), unsafeMaster]),
  /https:\/\//
);

console.log('Data backup check passed: native JSON / 21-column CSV / legacy 18-column CSV / URL validation');
