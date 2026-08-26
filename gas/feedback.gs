/**
 * 廃止済みの匿名フィードバックGAS（既存デプロイ停止用）
 *
 * 旧デプロイURLへの直接POSTによるメール・スプレッドシート濫用を止めるため、
 * 既存のApps Scriptプロジェクトへこの版を反映し「新バージョン」で再デプロイする。
 * 新規の受付、シート書き込み、メール送信は一切行わない。
 */

function disabledResponse_() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: false,
    error: 'feedback_endpoint_disabled'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost() {
  return disabledResponse_();
}

function doGet() {
  return disabledResponse_();
}
