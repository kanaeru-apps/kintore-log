# 筋トレLog 1.0.2

## このバージョンの最新情報

種目の参考動画URLやフォームメモを入力するとき、キーボードで入力欄が隠れる問題を修正しました。
入力欄が見える位置へ自動でスクロールし、入力しやすくしました。

## 検証

- npm run verify: 構文・セキュリティ・CSV新旧形式・アップデート時のデータ保持・iOS向けWeb資産生成が成功。
- npm audit: 開発用 @xmldom/xmldom のみ 0.9.10 から 0.9.12 へ更新し、指摘0件。
- Chromeで生成済みiOS Web資産を確認。幅390px、可視高さ390pxでURL欄が範囲内に入り、高さ280pxでもメモ欄が表示される。
- 実際のキー入力によるURL・メモの保存、再読み込み後の保持、閉じた後の位置指定解除を確認。
- iOS固有のキーボード・入力補助バーの表示はTestFlight実機検証が必要。

## 実機チェック

1. アプリを削除せずTestFlightから更新し、既存の記録・種目・設定が残ることを確認。
2. 種目名をタップし、参考動画URL欄をタップ。キーボードの上に入力欄と入力文字が見えることを確認。
3. URLの入力・貼り付け、フォームメモへの移動、日本語入力、キーボードを閉じて再表示する操作を確認。
4. 種目画面を閉じて開き直し、保存したURL・メモと通常の画面位置を確認。

## App Review notes

This update fixes the exercise reference-video URL and form-note fields being
covered by the iOS keyboard. The exercise information dialog follows the visible
viewport and scrolls the focused field into view. To test, tap an exercise name
on the Record tab or in Settings, then tap the reference-video URL or form-note
field and enter text. No account or login is required.
Existing workout records, exercise metadata, settings, and CSV compatibility
are retained. The bundle identifier and data storage keys are unchanged.
