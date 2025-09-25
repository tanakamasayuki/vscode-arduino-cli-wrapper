# Changelog / 変更履歴

## Unreleased
- (EN) Inspector analysis now runs `arduino-cli compile --clean` so each report uses a pristine build.
- (JA) インスペクター分析で `arduino-cli compile --clean` を実行し、毎回クリーンな状態からビルドするようにしました。
- (EN) Inspector warnings now omit files outside the workspace from both counts and the Diagnostics tab.
- (JA) インスペクターの警告について、ワークスペース外のファイルは集計にも診断タブにも表示しないようにしました。
- (EN) Inspector diagnostics now let you open the reported location directly from the table.
- (JA) インスペクター診断の位置をクリックすると対象ファイルの該当行を開くようにしました。
- (EN) Build Check warning totals now ignore files outside the workspace.
- (JA) ビルドチェックの警告数でもワークスペース外のファイルを集計対象から除外しました。
- (EN) Auto-ran the Inspector analysis when the view opens with both sketch and profile preselected.
- (JA) スケッチとプロファイルを指定してインスペクターを開いた場合に、自動で分析を開始するようにしました。
- (EN) Made Inspector tab buttons adopt white text in dark mode to improve legibility.
- (JA) インスペクターのタブボタンをダークモードでは白字にし、視認性を向上させました。

## 1.3.7
- (EN) Updated Sketch.yaml Helper so changing boards refreshes the platform version from the newly selected board.
- (JA) Sketch.yaml Helper でボード変更時に新しいボードのプラットフォーム版数へ自動更新されるようにしました。
- (EN) Ensured Build Check runs `arduino-cli compile --clean` so every profile is built from a clean state.
- (JA) ビルドチェックで `arduino-cli compile --clean` を実行し、各プロファイルを常にクリーンな状態からビルドするようにしました。
- (EN) Closing the Sketch.yaml Helper window automatically after applying changes to align with expected workflow.
- (JA) Sketch.yaml Helper で変更を反映したあと、自動的にウインドウを閉じるようにし、想定フローに合わせました。
- (EN) Normalized sketch.yaml profiles after helper updates so profile internals stay compact while profiles and top-level keys remain separated.
- (JA) Sketch.yaml ヘルパーでの反映後に整形を行い、プロファイル内の空行を除去しつつプロファイル間とトップレベルとの区切りを統一しました。

## 1.3.6

- (EN) Added Build Check to the root of the Arduino CLI view for quick access.
- (JA) Arduino CLI ビューのルートにビルドチェックを追加し、すばやく実行できるようにしました。
- (EN) Localized Arduino CLI tree tooltips so hover text follows the locale while the visible labels stay in English.
- (JA) Arduino CLI ビューのツリー項目は英語表示のままにしつつ、マウスオーバー時のツールチップのみローカライズされるようにしました。
- (EN) Expanded Build Check pop-up guidance to explain how to resolve missing workspace or sketch.yaml situations.
- (JA) ビルドチェックのポップアップメッセージを詳細化し、ワークスペース未選択や sketch.yaml 未作成時の対処方法を案内するようにしました。

## 1.3.5
- (EN) Renamed commands for clarity: Check CLI Version, Check Sketch.yaml Versions, Sketch.yaml Profile Helper.
- (JA) コマンド名称を整理：Check CLI Version、Check Sketch.yaml Versions、Sketch.yaml Profile Helper。
- (EN) Running New Sketch now opens the generated .ino and launches the Sketch.yaml helper.
- (JA) New Sketch 実行後に生成された .ino を開き、Sketch.yaml Helper を起動するよう変更しました。

## 1.3.4
- (EN) Added a Check Sketch.yaml Versions command and webview that aggregates platform/library versions from each sketch.yaml, compares them with the published indexes, and lets you apply updates in place.
- (JA) Check Sketch.yaml Versions コマンドと集計ビューを追加。各 sketch.yaml のプラットフォーム/ライブラリー版数を公開インデックスと比較し、その場で更新できるようにしました。
- (EN) Added a status bar toggle to pick compile warning levels together with verbose mode (shows badges such as `all+V`).
- (JA) ステータスバーから警告レベルと verbose の組み合わせを切り替えられるトグルを追加しました（`all+V` などの短い表示）。
- (EN) Status bar tweaks: renamed Build to Compile, removed Boards/ListAll badges, and placed the warnings badge next to baud.
- (JA) ステータスバーを調整し、Build を Compile に改名・Boards/ListAll バッジを削除・警告バッジをボーレートの右隣に配置しました。

