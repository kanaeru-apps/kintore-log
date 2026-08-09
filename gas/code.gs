/**
 * 筋トレ記録PWA → Googleスプレッドシート 同期用 GAS Web App（Phase 4〜5 / v3）
 *
 * v2（Phase 5）で追加された機能：
 * - 復元（action: 'restore'）：スプレッドシートの全記録＋種目リストをアプリへ返す
 * - 種目リストのバックアップ：「種目」シートに全種目を保存
 *
 * v3（v0.9.3）での変更：
 * - 種目リストの保存を「全置換」から「マージ＋削除同期」に変更。
 *   シートにしかない種目は残し、アプリで削除した種目（deletedExercises）だけを消す。
 *   種目が少ない端末のバックアップでシート側の種目が消える事故を防ぐため。
 *   ※アプリ v0.9.3 以降と組み合わせて使うこと（古いアプリからでも動作はする）
 *
 * v4（v0.10.0）での変更：
 * - 記録シートに「強度」列（WORK / REST）を追加＝17列から18列へ。
 * - 列数を固定で扱うのをやめ、送られてきた行の列数に合わせて書くようにした。
 *   これで「アプリだけ新しい／GASだけ新しい」どちらの組み合わせでも書き込みが落ちない。
 * - 既存シート（17列で作られたもの）は、次回の書き込み時に18列目の見出しを自動で補う。
 * ※このv4を先に再デプロイしてから、アプリ v0.10.0 を配布すること。
 *   逆順にすると18列の行を17列の範囲に書こうとして同期がエラーになる。
 *
 * 【セットアップ手順】
 * 1. 同期先にしたいGoogleスプレッドシートを新規作成（または既存のものを開く）
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. デフォルトの Code.gs の中身を全部削除し、このファイルの内容を貼り付けて保存
 * 4. 右上「デプロイ」→「新しいデプロイ」→ 種類の選択で「ウェブアプリ」を選ぶ
 *    - 実行するユーザー：自分
 *    - アクセスできるユーザー：全員
 * 5. 「デプロイ」を押すと権限の確認を求められるので許可する
 * 6. 発行された「ウェブアプリのURL」（.../exec で終わるもの）をコピーし、
 *    アプリの設定画面（クラウド同期セクション）に貼り付ける
 *
 * コードを更新した場合は「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →
 * バージョン「新バージョン」を選んで再デプロイすれば、URLは変わらず更新される。
 */

var SHEET_NAME = '記録';
var HEADER = ['日付', '曜日', '部位', '種目', '器具', 'セット',
  '重量kg', '回数', 'ボリュームkg',
  '時間min', '時間秒', '距離km', '速度kmh', '傾斜%', 'カロリーkcal', '心拍bpm', 'メモ', '強度'];
var EX_SHEET_NAME = '種目';
var EX_HEADER = ['部位', '種目', '器具', '動画URL', 'メモ'];

/* シートが実際に使っている列数。HEADER.length を決め打ちにすると、
   17列で作られた既存シートと18列のHEADERが食い違ったときに読み書きが壊れるため、
   「見出し行の実際の長さ」と「HEADERの長さ」の大きいほうを使う */
function colCount_(sheet) {
  var used = sheet.getLastColumn();
  return Math.max(used || 0, HEADER.length);
}

/* シートの列が足りなければ広げる（getRangeは存在しない列を指定すると例外になる） */
function ensureColumns_(sheet, need) {
  var max = sheet.getMaxColumns();
  if (max < need) sheet.insertColumnsAfter(max, need - max);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    ensureColumns_(sheet, HEADER.length);
    sheet.appendRow(HEADER);
    // 日付列がスプレッドシートに日付型として自動変換されるのを防ぐ（文字列のまま保持）
    sheet.getRange('A:A').setNumberFormat('@');
  } else {
    // 17列時代に作られたシートに「強度」見出しを後から補う
    ensureColumns_(sheet, HEADER.length);
    var head = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
    for (var i = 0; i < HEADER.length; i++) {
      if (String(head[i] == null ? '' : head[i]).trim() === '') {
        sheet.getRange(1, i + 1).setValue(HEADER[i]);
      }
    }
  }
  return sheet;
}

/* 指定した日付群に該当する既存行をすべて削除する（同じ日を送り直したときの上書き用） */
function deleteRowsForDates_(sheet, dates) {
  var dateSet = {};
  dates.forEach(function (d) { dateSet[d] = true; });
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  // 上から消すと行番号がずれるため、下から逆順に処理する
  for (var i = values.length - 1; i >= 0; i--) {
    var raw = values[i][0];
    var dateStr = (raw instanceof Date)
      ? Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(raw);
    if (dateSet[dateStr]) sheet.deleteRow(i + 2);
  }
}

function sortByDate_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  sheet.getRange(2, 1, lastRow - 1, colCount_(sheet)).sort({ column: 1, ascending: true });
}

function getExSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EX_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(EX_SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(EX_HEADER);
  return sheet;
}

/* 種目の突合キー。種目シートにID列が無く、IDは端末ごとに採番されるため
   「部位+種目名+器具」の3点で同一性を判定する（アプリ側のexKeyOfと同じ基準） */
function exKey_(part, name, equip) {
  return JSON.stringify([
    String(part == null ? '' : part).trim(),
    String(name == null ? '' : name).trim(),
    String(equip == null ? '' : equip).trim()
  ]);
}

/* アプリ側が空欄ならシート側の既存値を残す（スプレッドシートに直接書いた動画URL・メモを守る） */
function pickValue_(appVal, sheetVal) {
  var v = (appVal == null) ? '' : String(appVal);
  if (v !== '') return v;
  return (sheetVal == null) ? '' : String(sheetVal);
}

/* 種目リストをマージ方式で反映する（v3）。
   - アプリにある種目：シートに無ければ追加、あれば動画URL・メモを更新（アプリ側が空ならシート側を維持）
   - シートにしかない種目：他端末やスプレッドシートへの直接入力とみなして残す
   - deleted に含まれる種目：アプリで削除されたものとしてシートからも消す
   全置換をやめた理由：種目が少ない端末が一度バックアップしただけで、
   シート側の種目が丸ごとその端末の内容に潰される事故を防ぐため */
function writeExercises_(exercises, deleted) {
  var sheet = getExSheet_();
  var lastRow = sheet.getLastRow();
  var existing = (lastRow >= 2)
    ? sheet.getRange(2, 1, lastRow - 1, EX_HEADER.length).getValues()
    : [];

  var appRows = exercises || [];

  // アプリ側に存在する種目は削除対象から外す（削除→同名で再登録した場合の取り違え防止）
  var appKeys = {};
  appRows.forEach(function (r) { appKeys[exKey_(r[0], r[1], r[2])] = true; });
  var delSet = {};
  (deleted || []).forEach(function (d) {
    var k = exKey_(d[0], d[1], d[2]);
    if (!appKeys[k]) delSet[k] = true;
  });

  // シートの既存行をキーで引けるようにする（削除対象・重複行・空行はここで落とす）
  var sheetMap = {};
  var sheetOrder = [];
  existing.forEach(function (r) {
    if (!String(r[1] == null ? '' : r[1]).trim()) return; // 種目名が空の行は無視
    var k = exKey_(r[0], r[1], r[2]);
    if (delSet[k] || sheetMap[k]) return;
    sheetMap[k] = r;
    sheetOrder.push(k);
  });

  // 並び順はアプリ側を優先し、シートにしかない種目はその後ろに置く
  var out = [];
  var used = {};
  appRows.forEach(function (r) {
    var k = exKey_(r[0], r[1], r[2]);
    if (used[k]) return;
    used[k] = true;
    var prev = sheetMap[k];
    out.push([
      r[0], r[1], r[2],
      pickValue_(r[3], prev ? prev[3] : ''),
      pickValue_(r[4], prev ? prev[4] : '')
    ]);
  });
  sheetOrder.forEach(function (k) {
    if (used[k]) return;
    used[k] = true;
    out.push(sheetMap[k]);
  });

  // 削除で行数が減る場合があるため、一度消してからマージ結果を書き直す
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, EX_HEADER.length).clearContent();
  if (out.length) sheet.getRange(2, 1, out.length, EX_HEADER.length).setValues(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* 復元：記録シートの全行＋種目リストを返す（日付はyyyy-MM-dd文字列に正規化） */
function doRestore_() {
  var sheet = getSheet_();
  var rows = [];
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    rows = sheet.getRange(2, 1, lastRow - 1, colCount_(sheet)).getValues();
    rows.forEach(function (r) {
      if (r[0] instanceof Date) {
        r[0] = Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        r[0] = String(r[0]);
      }
    });
  }
  var exercises = [];
  var exSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EX_SHEET_NAME);
  if (exSheet && exSheet.getLastRow() >= 2) {
    exercises = exSheet.getRange(2, 1, exSheet.getLastRow() - 1, EX_HEADER.length).getValues();
  }
  return json_({ ok: true, rows: rows, exercises: exercises });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'restore') return doRestore_();

    // action未指定（または'backup'）：従来どおり記録の書き込み（旧バージョンのアプリとも互換）
    var dates = body.dates || [];
    var rows = body.rows || [];
    var sheet = getSheet_();

    if (dates.length) deleteRowsForDates_(sheet, dates);
    if (rows.length) {
      // 列数は送られてきた行に合わせる（古いアプリは17列、v0.10.0以降は18列）。
      // 行ごとに長さが違うと setValues が落ちるため、最長に合わせて空文字で埋める
      var width = 0;
      rows.forEach(function (r) { if (r.length > width) width = r.length; });
      rows.forEach(function (r) { while (r.length < width) r.push(''); });
      ensureColumns_(sheet, width);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
    }
    sortByDate_(sheet);

    // 種目リストまたは削除指定が同梱されていれば「種目」シートをマージ更新する。
    // どちらも無い場合（種目送信より前のバージョンのアプリ）は種目シートに触れない
    var exList = body.exercises;
    var delList = body.deletedExercises;
    if (exList || delList) writeExercises_(exList || [], delList || []);

    return json_({
      ok: true,
      dates: dates.length,
      rows: rows.length,
      exercises: (exList || []).length,
      deleted: (delList || []).length
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* デプロイ後にブラウザでURLを直接開いて動作確認するための簡易ヘルスチェック */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '筋トレ記録 同期用GAS Web Appは動作しています' }))
    .setMimeType(ContentService.MimeType.JSON);
}
