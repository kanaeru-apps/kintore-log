/**
 * 筋トレ記録PWA ご意見・ご要望 受付用 GAS Web App
 *
 * バックアップ用（code.gs）とは別の、問い合わせ受付専用のスクリプトです。
 * ユーザーの記録データとは完全に分離されます。
 *
 * 【セットアップ手順】
 * 1. 受付用のGoogleスプレッドシートを新規作成（例：「筋トレ記録_ご意見受付」）
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. デフォルトの Code.gs の中身を全部削除し、このファイルの内容を貼り付けて保存
 * 4. 右上「デプロイ」→「新しいデプロイ」→ 種類の選択で「ウェブアプリ」を選ぶ
 *    - 実行するユーザー：自分
 *    - アクセスできるユーザー：全員
 * 5. 「デプロイ」を押して権限を許可する
 * 6. 発行された「ウェブアプリのURL」（.../exec）を開発者（Claude）に伝えて
 *    アプリに組み込む
 *
 * 通知メール：新しいご意見が届くたび、下の NOTIFY_EMAIL 宛に自動送信されます。
 * 空文字のままならスプレッドシートのオーナー（自分）宛に送られます。
 */

var FEEDBACK_SHEET = 'ご意見';
var FEEDBACK_HEADER = ['受信日時', '内容', 'メールアドレス', 'アプリバージョン'];
var NOTIFY_EMAIL = ''; // 空ならオーナー宛。別のアドレスに送りたい場合はここに記入

var TEXT_MAX = 1000;
var EMAIL_MAX = 200;

function getFeedbackSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FEEDBACK_SHEET);
  if (!sheet) sheet = ss.insertSheet(FEEDBACK_SHEET);
  if (sheet.getLastRow() === 0) sheet.appendRow(FEEDBACK_HEADER);
  return sheet;
}

function notifyEmail_() {
  return NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var text = String(body.text || '').trim().slice(0, TEXT_MAX);
    var email = String(body.email || '').trim().slice(0, EMAIL_MAX);
    var version = String(body.version || '').slice(0, 50);
    if (!text) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'empty' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    getFeedbackSheet_().appendRow([now, text, email, version]);

    try {
      MailApp.sendEmail({
        to: notifyEmail_(),
        subject: '【筋トレLog】新しいご意見が届きました',
        body: '受信日時: ' + now + '\n' +
              'アプリバージョン: ' + version + '\n' +
              '連絡先: ' + (email || '（記入なし）') + '\n\n' +
              '--- 内容 ---\n' + text + '\n\n' +
              '受付シート:\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
      });
    } catch (mailErr) {
      // メール通知に失敗してもシートには記録済みなので受付自体は成功とする
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* デプロイ後にブラウザでURLを直接開いて動作確認するためのヘルスチェック */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '筋トレ記録 ご意見受付用GAS Web Appは動作しています' }))
    .setMimeType(ContentService.MimeType.JSON);
}
