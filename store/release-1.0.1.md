# 筋トレLog 1.0.1

## このバージョンの最新情報

PWA版から書き出した新形式のCSVを読み込めない問題を修正しました。
トレーニング記録に加え、種目の参考動画URL・フォームメモも復元できます。
従来形式のCSVにも引き続き対応しています。

## 更新時のデータ保持

同じアプリのアップデートとして配信し、アプリ識別子、WebViewの保存先、
データキー `kintore_v1` と既存の設定キーを維持する。データの初期化は行わない。
アップデート後にCSVを取り込み直す必要はない。
PWAからの初回移行でCSVを取り込む場合は、確認画面のとおり対象日の記録が置き換わる。

## リリース前の確認

- `npm run verify`: CSVの新旧形式、487行目の再現条件、DB取り込みと取り消し、更新後の既存データ保持。
- CodemagicでもCSV・更新互換テストを実行してからIPAを作成する。
- TestFlightでApp Store版に上書き更新し、記録・種目・設定を確認する。アプリは削除しない。
- App Store Connectで新しいビルドを選択し、手動リリースを設定する。
- 実機検証と最終確認後に審査へ提出する。

## App Review notes (CSV fix)

This update fixes importing CSV backups exported by the PWA version. The CSV
contains workout rows and exercise-master rows; exercise-master rows intentionally
have no date. The importer now recognizes both row types and restores exercise
video URLs and form notes. Legacy CSV backups remain supported.
Existing on-device records are retained when updating the app.
To test, open Settings > CSV Import and choose a CSV exported by the current PWA.
