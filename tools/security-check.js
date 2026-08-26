/* リポジトリ内だけで完結する、誤混入防止用の軽量セキュリティ検査。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const fail = (message) => failures.push(message);
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const html = read('index.html');
const app = read('js/app.js');
const pkg = JSON.parse(read('package.json'));

if (!html.includes("script-src 'self'")) fail('index.htmlにscript-srcのCSPがありません');
if (html.includes("'unsafe-eval'")) fail('CSPでunsafe-evalが許可されています');
if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) fail('index.htmlにインラインscriptがあります');

const retiredRuntimeParts = [
  'kintore_gas_url', 'kintore_last_sync', 'kintore_sync_unlocked',
  'gasUrlInput', 'syncNowBtn', 'restoreCloudBtn', 'FEEDBACK_GAS_URL',
  'fbSendBtn', 'kintore_fb_'
];
retiredRuntimeParts.forEach((part) => {
  if (html.includes(part) || app.includes(part)) fail(`廃止済みランタイム識別子が残っています: ${part}`);
});

if (pkg.dependencies && pkg.dependencies['@capacitor/assets']) fail('@capacitor/assetsを本番依存へ入れないでください');
if (pkg.devDependencies && pkg.devDependencies['@capacitor/assets']) fail('@capacitor/assetsは廃止済みです');
if (!pkg.devDependencies || !pkg.devDependencies['@capacitor/cli']) fail('@capacitor/cliはdevDependenciesに置いてください');
if (pkg.dependencies && pkg.dependencies['@capacitor/cli']) fail('@capacitor/cliが本番依存に入っています');

[
  'build-ios.js', 'sw.js', 'js/theme-init.js', 'js/register-sw.js',
  'js/db.js', 'js/app.js', 'js/charts.js', 'gas/code.gs', 'gas/feedback.gs'
].forEach((name) => {
  try { new vm.Script(read(name), { filename: name }); } catch (e) { fail(`${name}の構文エラー: ${e.message}`); }
});

const listed = childProcess.spawnSync(
  'git', ['ls-files', '-co', '--exclude-standard', '-z'],
  { cwd: ROOT, encoding: 'utf8' }
);
if (listed.status !== 0) {
  fail('検査対象ファイルの列挙に失敗しました');
} else {
  const secretPatterns = [
    ['秘密鍵', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['AWSアクセスキー', /AKIA[0-9A-Z]{16}/],
    ['Google APIキー', /AIza[0-9A-Za-z_-]{30,}/],
    ['OpenAI APIキー', /sk-(?:proj-)?[0-9A-Za-z_-]{20,}/],
    ['GitHubトークン', /gh[pousr]_[0-9A-Za-z]{20,}/],
    ['Slack Webhook', /https:\/\/hooks\.slack\.com\/services\/[0-9A-Za-z/_-]{20,}/],
    ['公開GASデプロイURL', /https:\/\/script\.google\.com\/macros\/s\/[0-9A-Za-z_-]+/]
  ];
  listed.stdout.split('\0').filter(Boolean).forEach((name) => {
    const full = path.join(ROOT, name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile() || fs.statSync(full).size > 5 * 1024 * 1024) return;
    const content = fs.readFileSync(full);
    if (content.includes(0)) return;
    const text = content.toString('utf8');
    secretPatterns.forEach(([label, pattern]) => {
      if (pattern.test(text)) fail(`${label}らしい値が見つかりました: ${name}`);
    });
  });
}

if (failures.length) {
  console.error('Security check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Security check passed: CSP / retired endpoints / dependency placement / syntax / secret patterns');
