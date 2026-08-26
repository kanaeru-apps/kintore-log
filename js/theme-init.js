/* 画面描画より前にテーマを確定し、ライト/ダークのちらつきを防ぐ。 */
'use strict';

(function () {
  var pref = 'system';
  try {
    var v = localStorage.getItem('kintore_theme');
    if (v === 'system' || v === 'light' || v === 'dark') pref = v;
  } catch (e) { /* 読めない環境では端末設定を使う */ }
  var actual = pref;
  if (pref === 'system') {
    actual = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', actual);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', actual === 'light' ? '#f2f3f5' : '#0b0c0f');
})();
