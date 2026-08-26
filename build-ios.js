/**
 * iOS（App Store）版の www/ を生成する。
 *
 * PWA版（リポジトリ直下の index.html / css / js / icons）を www/ へコピーし、
 * Capacitor向けに次の変換を行う：
 *
 *   1. Service Worker の登録ブロックを削除する
 *      → Capacitor は capacitor:// スキームで動くため元の条件式でも発火しないが、
 *        iosScheme を変えたときに 404 を踏まないよう、そもそも消しておく
 *   2. Capacitor 本体（js/capacitor.js）の読み込みを追加する
 *
 * PWA・App Storeの両版で匿名GAS同期は廃止済み。生成後に識別子が残っていないか検査する。
 *
 * 使い方： node build-ios.js
 * ビルド後は npx cap sync ios で iOS プロジェクトへ反映する。
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const WWW = path.join(ROOT, 'www');
/* www/ は生成物であることの目印。これが無いディレクトリは中身を消さない
   （別のフォルダを誤って空にする事故を防ぐため） */
const MARKER = '.generated-by-build-ios';

/* www/ をきれいにする（マーカーがあるときだけ中身を消す） */
function resetWww() {
  if (fs.existsSync(WWW)) {
    if (!fs.existsSync(path.join(WWW, MARKER))) {
      console.error(
        `\n[中止] ${WWW} は build-ios.js が作ったディレクトリではないようです。\n` +
        `　　　 中身を消さずに終了しました。手動で確認してください。\n` +
        `　　　 （生成物なら ${MARKER} という空ファイルを置くと次から自動でクリアされます）\n`
      );
      process.exit(1);
    }
    fs.rmSync(WWW, { recursive: true, force: true });
  }
  fs.mkdirSync(WWW, { recursive: true });
  fs.writeFileSync(path.join(WWW, MARKER), 'このディレクトリは build-ios.js の生成物です。直接編集しないでください。\n');
}

/* ディレクトリを再帰コピーする。
   fs.cpSync(..., {recursive:true}) はこの環境（Node v24.14.1 / Windows）で
   プロセスごと異常終了する（終了コード 0xC0000409）ため使わない。
   copyFileSync / mkdirSync / readdirSync は正常に動くので、それだけで組み立てている。 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyInto(name) {
  const src = path.join(ROOT, name);
  const dest = path.join(WWW, name);
  if (fs.statSync(src).isDirectory()) copyDir(src, dest);
  else fs.copyFileSync(src, dest);
}

/* @capacitor/local-notifications 8.2.1 のiOS実装は、設定の
   presentationOptions に "badge" を受け付ける一方で、通知データの badge 値を
   UNMutableNotificationContent.badge へコピーしていない。
   そのままではアプリが背面にいるとJSの navigator.setAppBadge() が動かず、
   通知が届いてもアイコンにバッジが付かない。

   node_modules は npm install のたびに作り直されるため、Codemagicでも必ず通る
   build-ios.js で最小パッチを冪等に適用する。8.3.1以降は上流で同等処理が入ったため、
   その実装を検出した場合は書き換えない。対象実装が変わって既知の処理も差し込み位置も
   見つけられない場合は、黙ってバッジ無しのIPAを作らずビルドを停止する。 */
function patchLocalNotificationsBadge() {
  const swiftPath = path.join(
    ROOT, 'node_modules', '@capacitor', 'local-notifications', 'ios', 'Sources',
    'LocalNotificationsPlugin', 'LocalNotificationsPlugin.swift'
  );
  if (!fs.existsSync(swiftPath)) {
    throw new Error(`@capacitor/local-notifications のiOS実装が見つかりません: ${swiftPath}`);
  }

  const badgeBlock = `        // kintore-log: apply the icon badge when the notification is delivered\n` +
    `        if let badge = notification["badge"] as? Int {\n` +
    `            content.badge = NSNumber(value: badge)\n` +
    `        }\n\n`;
  let swift = fs.readFileSync(swiftPath, 'utf8');
  if (swift.includes(badgeBlock)) return;

  const upstreamBadgeBlock = `        if let badge = notification["badge"] as? Int {\n` +
    `            content.badge = NSNumber(value: badge)\n` +
    `        }\n`;
  if (swift.includes(upstreamBadgeBlock)) return;

  const soundBlock = `        if let sound = notification["sound"] as? String {\n` +
    `            content.sound = UNNotificationSound(named: UNNotificationSoundName(sound))\n` +
    `        }\n`;
  if (!swift.includes(soundBlock)) {
    throw new Error('LocalNotificationsPlugin.swift の既知の差し込み位置が見つかりません。依存更新を確認してください。');
  }
  swift = swift.replace(soundBlock, badgeBlock + soundBlock);
  fs.writeFileSync(swiftPath, swift, 'utf8');
}

/* ---- 1. www/ を作り直してソースをコピー ---- */
patchLocalNotificationsBadge();
resetWww();
// sounds/ はタイマーのアラーム音。アプリ内再生と、Library/Sounds/ へコピーして使う
// 通知音の両方がこのファイルを参照するため、ネイティブ版にも必ず同梱する
['css', 'js', 'icons', 'sounds', 'manifest.json'].forEach(copyInto);
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(WWW, 'index.html'));
// sw.js は意図的にコピーしない（Capacitorではオフライン化がネイティブ側の役目のため）

/* Capacitor 本体（window.Capacitor）を www/js/ へ。
   www/ は毎回作り直すため、npm の postinstall ではなくここでコピーする */
const capSrc = path.join(ROOT, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
if (!fs.existsSync(capSrc)) {
  console.error('\n[中止] node_modules/@capacitor/core が見つかりません。先に npm install を実行してください。\n');
  process.exit(1);
}
fs.copyFileSync(capSrc, path.join(WWW, 'js', 'capacitor.js'));

/* ---- 2. app.js のパス ---- */
const appPath = path.join(WWW, 'js', 'app.js');

/* ---- 3. index.html の変換 ---- */
const htmlPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const SW_SCRIPT = /<script src="js\/register-sw\.js\?v=[^"]+"><\/script>\s*/;
if (!SW_SCRIPT.test(html)) {
  console.error('\n[中止] index.html の Service Worker 登録スクリプトが見つかりませんでした。\n');
  process.exit(1);
}
html = html.replace(SW_SCRIPT, '');

if (!html.includes('js/db.js')) {
  console.error('\n[中止] index.html に js/db.js の読み込みが見つかりませんでした。\n');
  process.exit(1);
}
// Capacitor本体は他のスクリプトより先に読み込む（postinstall が www/js/capacitor.js を用意する）
html = html.replace(/<script src="js\/db\.js/, '<script src="js/capacitor.js"></script>\n<script src="js/db.js');

fs.writeFileSync(htmlPath, html, 'utf8');

/* ---- 4. 混入チェック（提出前チェックリストの自動化） ----
   廃止した匿名同期を実際に動かす部品が残っていないかを見る。 */
const FORBIDDEN = [
  'kintore_gas_url',        // バックアップ先URLの保存キー
  'kintore_last_sync',      // 最終同期日時の保存キー
  'kintore_sync_unlocked',  // 同期機能の隠し解除フラグ
  'gasUrlInput',            // URL入力欄
  'syncNowBtn',             // 「今すぐバックアップ」ボタン
  'restoreCloudBtn',        // 「クラウドから復元」ボタン
  'action: \'restore\''     // 復元リクエストの本体
];

const built = fs.readFileSync(appPath, 'utf8');
const builtHtml = fs.readFileSync(htmlPath, 'utf8');
const inspected = built + builtHtml;
const found = FORBIDDEN.filter((s) => inspected.includes(s));
if (found.length) {
  console.error(
    `\n[中止] 廃止済みのクラウド同期の部品が残っています： ${found.join(' / ')}\n`
  );
  process.exit(1);
}
if (!builtHtml.includes("script-src 'self'") || builtHtml.includes("'unsafe-eval'")) {
  console.error('\n[中止] Content Security Policy が安全なscript-src設定になっていません。\n');
  process.exit(1);
}
// 起動時に外部フォントを取得すると「主要機能はオフライン」という説明と食い違うため、
// App Store版では端末内のシステムフォントだけを使う。
const REMOTE_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const remoteFontHosts = REMOTE_FONT_HOSTS.filter((host) => builtHtml.includes(host));
if (remoteFontHosts.length) {
  console.error(`\n[中止] App Store 版に外部Google Fonts参照が残っています： ${remoteFontHosts.join(' / ')}\n`);
  process.exit(1);
}
// 匿名フィードバックGASは廃止済み。古い送信コードが再混入したら公開しない。
const retiredFeedbackParts = ['FEEDBACK_GAS_URL', 'fbSendBtn', 'kintore_fb_'];
const foundRetiredFeedbackParts = retiredFeedbackParts.filter((s) => built.includes(s) || builtHtml.includes(s));
if (foundRetiredFeedbackParts.length) {
  console.error(`\n[中止] 廃止済みの匿名フィードバック送信が残っています： ${foundRetiredFeedbackParts.join(' / ')}\n`);
  process.exit(1);
}

/* バージョンは class="version" の行から抜く。以前はアプリ名をそのまま正規表現に書いていたが、
   App名を変えた瞬間に「不明」になったので、名前ではなく構造を目印にしている */
const version = (html.match(/class="version">[^<]*?v([\d.]+)/) || [])[1] || '不明';
console.log(`\n✓ www/ を生成しました（v${version}）`);
console.log('  - 廃止済みクラウド同期の識別子なし');
console.log('  - 外部Google Fonts参照なし');
console.log('  - 匿名フィードバックGAS送信なし');
console.log('  - Service Worker 登録を除去');
console.log('  - js/capacitor.js の読み込みを追加');
console.log('  次は: npx cap sync ios\n');
