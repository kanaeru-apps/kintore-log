/**
 * 廃止済みの匿名スプレッドシート同期GAS。
 *
 * 旧デプロイURLを知る第三者が記録の取得・上書き・削除を行える設計だったため、
 * PWA側の同期機能とともに廃止した。既存のApps Scriptプロジェクトへこの版を反映し、
 * 「新バージョン」で再デプロイする。新規の読取・書込は一切行わない。
 */

function disabledResponse_() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: false,
    error: 'cloud_sync_endpoint_disabled'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost() {
  return disabledResponse_();
}

function doGet() {
  return disabledResponse_();
}
