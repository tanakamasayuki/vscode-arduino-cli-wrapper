# Changelog / 変更履歴

## Unreleased

- (EN) On WSL, the CLI version check now probes `arduino-cli.exe` on Windows and reports its version when available.
- (JA) WSL 環境では CLI バージョン確認時に Windows 側の `arduino-cli.exe` も検出し、利用可能な場合はバージョンを表示します。
- (EN) Serial port pickers on WSL now merge Windows-side ports discovered via `arduino-cli.exe board list` and label them as Windows hosts.
- (JA) WSL 環境のシリアルポート選択で Windows 側 `arduino-cli.exe board list` の結果も統合し、Windows ホストであることが判別できる表示にしました。

## 1.4.3
- (EN) Debug command now mirrors Arduino IDE `debug_config` data (request type, OpenOCD server args, GDB command overrides, objdump/nm paths) so Cortex-Debug attaches cleanly without endless resets or missing tool errors.
- (JA) デバッグコマンドで Arduino IDE の `debug_config` (request 種別・OpenOCD サーバー引数・GDB コマンド上書き・objdump/nm のパスなど) を取り込み、Cortex-Debug がリセットループやツール未検出を起こさずにアタッチできるようにしました。
- (EN) Respect the Local Build Path setting during debug builds: when disabled, builds use Arduino CLI’s default location and the generated task now runs `arduino-cli compile --upload`; when enabled, tasks continue to target `.build/<sketch>-<profile>-debug`.
- (JA) デバッグビルドでもローカルビルドパス設定を尊重し、OFF の場合は Arduino CLI 既定のビルド先を使いつつ `arduino-cli compile --upload` タスクを生成、ON の場合は従来どおり `.build/<sketch>-<profile>-debug` を利用するようにしました。
- (EN) When falling back to the Microsoft C/C++ debugger, launch configurations now force `request: "launch"` and reuse the GDB connection details from `debug_config` so the attach prompt no longer appears.
- (JA) Microsoft C/C++ デバッガーへフォールバックする際に `request: "launch"` を強制し、`debug_config` の GDB 接続情報を引き継ぐことで「プロセスを選択してください」というダイアログが表示されなくなりました。
- (EN) If Cortex-Debug isn't installed, the generator now removes stale `cortex-debug` entries from launch.json so schema warnings disappear and only cppdbg remains.
- (JA) Cortex-Debug が未インストールの場合、launch.json から既存の `cortex-debug` エントリを自動削除し、スキーマ警告を解消したうえで cppdbg 設定だけを残すようにしました。
- (EN) Updated the cppdbg fallback to rely on VS Code's automatic `target remote` handling and dropped the default `monitor reset halt` / `monitor gdb_sync` pair so GDB no longer disconnects immediately when launching without Cortex-Debug.
- (JA) cppdbg フォールバックでは VS Code 側の `target remote` 処理に任せつつ既定の `monitor reset halt` / `monitor gdb_sync` を削除し、Cortex-Debug なしでも起動直後に GDB が切断されないようにしました。

## 1.4.2
- (EN) Added a Local Build Path setting that pins Arduino CLI build artifacts to `.build/<profile>` under each sketch and automatically appends `--build-path` to compile-related commands.
- (JA) スケッチ直下の `.build/<プロファイル>` にビルド成果物を保存するローカルビルドパス設定を追加し、コンパイル系コマンドへ自動的に `--build-path` を付与するようにしました。
- (EN) Workspace scanners now skip `.build` directories so generated artifacts stay out of pickers, reports, and example listings.
- (JA) `.build` ディレクトリをスキャン対象から除外し、生成物が選択肢やレポート、サンプル一覧に混ざらないようにしました。
- (EN) Inspector analysis now respects the Local Build Path setting so its temporary outputs live under `.build/<profile>` alongside other commands.
- (JA) インスペクター分析でもローカルビルドパス設定を反映し、他のコマンドと同様に `.build/<プロファイル>` 配下で一時ファイルを扱うようにしました。
- (EN) Inspector now renders `partitions.csv` as a structured table (with decimal sizes), shows the raw text for both `partitions.csv` and `sdkconfig`, and loads them automatically without extra clicks.
- (JA) インスペクターで `partitions.csv` をテーブル＋原文で表示し（サイズ欄に 10 進数を併記）、`sdkconfig` も含めて自動で開かれるようにしました。
- (EN) Inspector streams Arduino CLI output to the Arduino Logs channel and includes the captured text when analysis fails, making debugging `exit 1` errors easier.
- (JA) インスペクター実行中の Arduino CLI 出力を Arduino Logs チャンネルへ転送し、失敗時メッセージにも内容を含めることで `exit 1` などの原因を特定しやすくしました。

## 1.4.1
- (EN) Updated sketch picker to ignore `.ino` files located inside hidden directories so workspace scans stay focused on visible sketches.
- (JA) 隠しディレクトリ配下の `.ino` ファイルをスケッチ選択から除外し、ワークスペース検索が見えるスケッチに限定されるようにしました。

## 1.4.0
- (EN) Fixed compile_commands.json exports to overwrite matching directory/file entries so IntelliSense stays in sync after rebuilding with another profile.
- (JA) compile_commands.json の出力で directory / file が一致する既存エントリを上書きするようにし、別プロファイルで再ビルドした際も IntelliSense が最新状態を維持するようにしました。
- (EN) Added Wokwi integration for sketch.yaml profiles; compiling a Wokwi-enabled profile now produces `.wokwi/<profile>/wokwi.elf`, scaffolds default diagram/wokwi.toml files, and surfaces a "Run in Wokwi" command in the Arduino CLI tree.
- (JA) sketch.yaml のプロファイルで Wokwi を true にすると、ビルド後に `.wokwi/<profile>/wokwi.elf` を生成し、diagram.json / wokwi.toml を自動補完したうえで、Arduino CLI ツリーに「wokwiで実行」コマンドを追加します。
- (EN) Wokwi diagram scaffolding now seeds board-specific parts and connections based on the profile FQBN (UNO, MEGA, Nano, ESP32 S3 Box, M5Stack CoreS3, Seeed XIAO ESP32, generic ESP32).
- (JA) Wokwi 用の diagram.json ひな形が FQBN に応じて UNO / MEGA / Nano / ESP32 S3 Box / M5Stack CoreS3 / Seeed XIAO ESP32 / 汎用 ESP32 のレイアウトを自動配置するようになりました。

## 1.3.8
- (EN) Added a workspace-only warnings level that runs `--warnings all`, ignores library warnings outside the workspace, and publishes compile diagnostics to the Problems panel.
- (JA) `--warnings all` を内部で使いつつ、ワークスペース外のライブラリ警告を除外して問題タブへ診断を登録する「ワークスペースのみ」警告レベルを追加しました。
- (EN) Compile command exports now keep every source from the workspace and the Arduino CLI build path (not just generated .ino.cpp files) so IntelliSense picks up local headers and generated artifacts.
- (JA) compile_commands.json の生成で .ino.cpp だけでなくワークスペース内およびビルドパス内のソース/ヘッダーも含めるようにし、ローカルファイルや生成物を IntelliSense が認識できるようにしました。
- (EN) compile_commands.json entries generated from .ino.cpp now point back to the original .ino file so IntelliSense follows your sketch sources instead of temporary build outputs.
- (JA) compile_commands.json の .ino.cpp 由来エントリでは file を元の .ino へ書き換え、IntelliSense がビルド一時ファイルではなくスケッチ本体を参照するようにしました。
- (EN) compile_commands.json now stores only the filename in each file field to avoid leaking absolute paths and keep diffs stable across machines.
- (JA) compile_commands.json の file フィールドから絶対パスを排し、ファイル名だけを保存することで環境間の差異を抑えるようにしました。
- (EN) Inspector analysis now runs `arduino-cli compile --clean` so each report uses a pristine build.
- (JA) インスペクター分析で `arduino-cli compile --clean` を実行し、毎回クリーンな状態からビルドするようにしました。
- (EN) Inspector warnings now omit files outside the workspace from both counts and the Diagnostics tab.
- (JA) インスペクターの警告について、ワークスペース外のファイルは集計にも診断タブにも表示しないようにしました。
- (EN) Inspector diagnostics now let you open the reported location directly from the table.
- (JA) インスペクター診断の位置をクリックすると対象ファイルの該当行を開くようにしました。
- (EN) Build Check warning totals now ignore files outside the workspace.
- (JA) ビルドチェックの警告数でもワークスペース外のファイルを集計対象から除外しました。
- (EN) Inspector now brings the Arduino Logs terminal to the front when analysis runs.
- (EN) Added Clean Compile to the Arduino CLI tree so sketches can trigger clean builds from the sidebar.
- (JA) サイドバーの Arduino CLI ツリーにクリーンコンパイル項目を追加し、スケッチごとにクリーンビルドを実行できるようにしました。
- (JA) インスペクター実行時に Arduino Logs ターミナルが自動で前面に表示されるようにしました。
- (EN) Arduino Logs terminal now reopens and takes focus automatically when CLI commands run after being closed.
- (JA) CLI コマンド実行時に Arduino Logs 端末が閉じられていても自動で再表示し、フォーカスも合わせるようにしました。
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
