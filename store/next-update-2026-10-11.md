# 次回更新：RM重量の直接入力・Guideline 2.3.7

更新元：`feature/core-training` の `8ca2411`。作業ブランチ：`codex/rm-weight-input`。

## RM計算機

上部の重量をタップすると小数対応の数字キーボードを要求し、既存の共通「完了」ボタンを表示する。確定時にダイヤルとRM表が更新される。入力範囲は既存ダイヤルと同じ0〜300 kg、0.1 kg刻み。空欄や不正な値は直前の重量を保持する。Enterで確定、Escapeで編集前の値に戻す。

## Appleからの指摘への対応

過去の審査対応チャットで、Guideline 2.3.7に基づくスクリーンショット内の価格表現の削除を次回更新で行うと回答していたことを確認。
公式資料：https://developer.apple.com/app-store/review/guidelines/#accurate-metadata

`03-free.png` の「課金なし。」「全機能が無料。」が対象。6.5inch・6.9inchの両方について、この画像を提出対象から除外し、原本を `store/archive/not-for-submission/` に保管した。他の画像の画素は変更していない。

次回提出に使う画像（各サイズ共通、5枚）：

1. `screenshots/<size>/01-input.png`
2. `screenshots/<size>/02-timer.png`
3. `screenshots/<size>/04-calendar.png`
4. `screenshots/<size>/05-analytics.png`
5. `screenshots/<size>/06-rm.png`

番号の欠番は元画像のラベルを保持するため。両サイズの計12枚を目視確認し、価格表現がある3枚目を除外した。全ローカライズ・ストア上の掲載画像は別途確認が必要。

## リリース時に必要な操作（未実施）

- iPhone実機で、重量のタップ→小数の入力→「完了」→キーボードが閉じる→ダイヤル・計算結果の更新を確認。
- 有酸素・体幹・筋トレドラムの既存入力が動作することを確認。
- 新しいiOSバージョンとビルド番号を設定し、Codemagicでビルド・TestFlight確認。
- App Store Connectの次回バージョンで、各掲載サイズ・言語の価格表現を含む画像を削除し、上記5枚の構成にする。ローカルの移動だけでは掲載中の画像は変わらない。
- アプリ名・サブタイトル・プレビューに同様の価格表現が残っていないか確認。
- 画像の保存後にプレビューを読み直してから、必要な承認を経て審査へ提出。

## ローカル検証

`npm run verify` 成功。構文・セキュリティ・バックアップ・旧データ移行・AlarmKit・CSV・体幹・数値入力・RM計算のチェックとiOS用Webファイルの生成を確認。RMチェックはDOMの代替オブジェクトを用いたロジック検証で、実際のiOSキーボード表示や実機レイアウトの検証ではない。IPA作成・GitHubへのpush・ストア画像更新・審査提出は未実施。

## 新機能の説明（貼り付け用）

日本語：RM計算機の重量をタップして、数字キーボードから直接入力できるようになりました。

English: You can now tap the weight in the RM calculator to enter a value directly using the numeric keyboard.

## 審査メモ追記案（ストア画像の更新後に使用）

The RM calculator now supports direct weight entry. Open the Calculator tab, tap the weight at the top, enter a value, and tap Done. The dial and estimated RM values update together. We have also removed the screenshot containing pricing references from all submitted screenshot sets to address Guideline 2.3.7.

意味：RM計算機の重量を直接入力できるようにし、前回指摘された価格表現の画像を提出画像から削除したことを伝える文面。画像更新前には送信しない。
