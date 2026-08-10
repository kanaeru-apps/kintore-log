/**
 * iOS（App Store）版の www/ を生成する。
 *
 * PWA版（リポジトリ直下の index.html / css / js / icons）のソースには一切手を入れず、
 * www/ へコピーしながら次の変換を行う：
 *
 *   1. js/app.js の `@sync:start` 〜 `@sync:end` を「何もしないスタブ」に差し替える
 *      → App Store 版にはクラウド同期（GAS Web App）が一切含まれない（ガイドライン2.3.1対策）
 *   2. Service Worker の登録ブロックを削除する
 *      → Capacitor は capacitor:// スキームで動くため元の条件式でも発火しないが、
 *        iosScheme を変えたときに 404 を踏まないよう、そもそも消しておく
 *   3. Capacitor 本体（js/capacitor.js）の読み込みを追加する
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

/* ブロック外から呼ばれる10個の関数を、同名の空実装で用意する。
   呼び出し側（renderLog の空状態・renderSettings・bindSettings・起動時/visibilitychange）を
   書き換えずに済ませるための差し替え先。app.js 側のマーカー内に関数を足して
   ブロックの外から呼ぶ場合は、ここにも同名を追加すること。 */
/* app.js に置く @sync:start 〜 @sync:end の数。増減したらここも必ず直す。
   1つ目（同期関数の本体）が STUB に置き換わり、2つ目以降は削除される。
   数が合わないときは中止する（マーカーの書き損じに気づかずに出力しないため）。 */
const EXPECTED_BLOCKS = 3;

/* スタブの範囲を示す目印。混入チェックのとき、この範囲は検査から除く。
   スタブ自身が runSync などの名前を含むため、除かないと自分の生成物を誤検出する。 */
const STUB_START = '/* @sync:stub-start */';
const STUB_END = '/* @sync:stub-end */';

const STUB = `  ${STUB_START}
  /* ===== クラウド同期なし（App Store 版） =====
     PWA版にあるスプレッドシート同期（GAS Web App連携）は、このビルドには含まれていない。
     呼び出し側のコードを変更せずに済むよう、同名の関数を何もしない実装で置いている。
     このスタブは build-ios.js が生成している。直接編集しないこと。 */
  function syncUnlocked() { return false; }
  function getGasUrl() { return ''; }
  function setGasUrl() { /* noop */ }
  function checkGasUrl() { return { ok: false, error: '' }; }
  function onVersionTap() { /* noop */ }
  function renderSyncSection() { /* noop */ }
  function runSync() { /* noop */ }
  function autoSync() { /* noop */ }
  function restoreFromCloud() { /* noop */ }
  function promptCloudRestore() { /* noop */ }
  ${STUB_END}
`;

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

/* ---- 1. www/ を作り直してソースをコピー ---- */
resetWww();
['css', 'js', 'icons', 'manifest.json'].forEach(copyInto);
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

/* ---- 2. app.js の同期ブロックをスタブへ差し替え ---- */
const appPath = path.join(WWW, 'js', 'app.js');
let app = fs.readFileSync(appPath, 'utf8');

const BLOCK = /[ \t]*\/\* @sync:start[\s\S]*?@sync:end \*\/\r?\n?/g;
const blocks = app.match(BLOCK);
if (!blocks || blocks.length !== EXPECTED_BLOCKS) {
  console.error(
    `\n[中止] js/app.js の @sync:start 〜 @sync:end が想定（${EXPECTED_BLOCKS}ブロック）と違います：` +
    `検出 ${blocks ? blocks.length : 0} ブロック。\n` +
    `　　　 マーカーが壊れたまま出力すると同期コードが App Store 版に混入するため中止しました。\n` +
    `　　　 意図してマーカーを増減したのなら build-ios.js の EXPECTED_BLOCKS も直してください。\n`
  );
  process.exit(1);
}
let replaced = 0;
app = app.replace(BLOCK, () => (replaced++ === 0 ? STUB : ''));
fs.writeFileSync(appPath, app, 'utf8');

/* ---- 3. index.html の変換 ---- */
const htmlPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const SW_BLOCK = /<script>\s*if \('serviceWorker' in navigator[\s\S]*?<\/script>\s*/;
if (!SW_BLOCK.test(html)) {
  console.error('\n[中止] index.html の Service Worker 登録ブロックが見つかりませんでした。\n');
  process.exit(1);
}
html = html.replace(SW_BLOCK, '');

if (!html.includes('js/db.js')) {
  console.error('\n[中止] index.html に js/db.js の読み込みが見つかりませんでした。\n');
  process.exit(1);
}
// Capacitor本体は他のスクリプトより先に読み込む（postinstall が www/js/capacitor.js を用意する）
html = html.replace(/<script src="js\/db\.js/, '<script src="js/capacitor.js"></script>\n<script src="js/db.js');

fs.writeFileSync(htmlPath, html, 'utf8');

/* ---- 4. 混入チェック（提出前チェックリストの自動化） ----
   「同期を実際に動かす部品」が残っていないかを見る。
   日本語の説明文（「クラウド同期はありません」等の案内）まで禁止すると、
   スタブ自身のコメントで落ちてしまうため、識別子・保存キー・リクエスト内容だけを対象にする。 */
const FORBIDDEN = [
  'kintore_gas_url',        // バックアップ先URLの保存キー
  'kintore_last_sync',      // 最終同期日時の保存キー
  'kintore_sync_unlocked',  // 同期機能の隠し解除フラグ
  'gasUrlInput',            // URL入力欄
  'syncNowBtn',             // 「今すぐバックアップ」ボタン
  'restoreCloudBtn',        // 「クラウドから復元」ボタン
  'action: \'restore\''     // 復元リクエストの本体
];

/* スタブ範囲を取り除いてから検査する（スタブは runSync などの名前を含むため） */
const built = fs.readFileSync(appPath, 'utf8');
const si = built.indexOf(STUB_START);
const ei = built.indexOf(STUB_END);
if (si === -1 || ei === -1 || ei < si) {
  console.error('\n[中止] スタブの目印（@sync:stub-start / @sync:stub-end）が出力に見つかりません。\n');
  process.exit(1);
}
const inspected = built.slice(0, si) + built.slice(ei + STUB_END.length) + fs.readFileSync(htmlPath, 'utf8');
const found = FORBIDDEN.filter((s) => inspected.includes(s));
if (found.length) {
  console.error(
    `\n[中止] App Store 版にクラウド同期の部品が残っています： ${found.join(' / ')}\n` +
    `　　　 該当箇所を @sync:start 〜 @sync:end で囲むか、スタブ側へ移してください。\n`
  );
  process.exit(1);
}
// ご意見フォーム（FEEDBACK_GAS_URL）は App Store 版にも残す正規の機能なので、
// script.google.com の存在自体は禁止していない。同期側の識別子だけを見ている。
if (!built.includes('FEEDBACK_GAS_URL')) {
  console.error('\n[警告] ご意見・ご要望フォームのURLが見当たりません。意図した変更か確認してください。\n');
}

const version = (html.match(/筋トレ記録 v([\d.]+)/) || [])[1] || '不明';
console.log(`\n✓ www/ を生成しました（v${version}）`);
console.log(`  - クラウド同期をスタブに差し替え（${blocks.length}ブロック除去）`);
console.log('  - Service Worker 登録を除去');
console.log('  - js/capacitor.js の読み込みを追加');
console.log('  次は: npx cap sync ios\n');
