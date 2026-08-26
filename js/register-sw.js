/* PWA版だけService Workerを登録する。Capacitor版ではhttp(s)ではないため実行されない。 */
'use strict';

if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}
