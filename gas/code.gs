/**
 * 筋トレ記録PWA → Googleスプレッドシート 同期用 GAS Web App（Phase 4）
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
  '時間min', '時間秒', '距離km', '速度kmh', '傾斜%', 'カロリーkcal', '心拍bpm', 'メモ'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    // 日付列がスプレッドシートに日付型として自動変換されるのを防ぐ（文字列のまま保持）
    sheet.getRange('A:A').setNumberFormat('@');
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
  sheet.getRange(2, 1, lastRow - 1, HEADER.length).sort({ column: 1, ascending: true });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var dates = body.dates || [];
    var rows = body.rows || [];
    var sheet = getSheet_();

    if (dates.length) deleteRowsForDates_(sheet, dates);
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
    }
    sortByDate_(sheet);

    return ContentService.createTextOutput(JSON.stringify({ ok: true, dates: dates.length, rows: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* デプロイ後にブラウザでURLを直接開いて動作確認するための簡易ヘルスチェック */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '筋トレ記録 同期用GAS Web Appは動作しています' }))
    .setMimeType(ContentService.MimeType.JSON);
}
