# Arduino CLI Wrapper (VS Code Extension)

Arduino CLI のコマンドを VS Code から実行できる拡張機能です。コマンドパレットからビルド・アップロード・接続ボード一覧などを呼び出せます。

## 主な機能

- Arduino CLI: Show Version — `arduino-cli version` を実行
- Arduino CLI: List Connected Boards — 接続ボード一覧表示
- Arduino CLI: List All Boards (listall) — すべてのボード一覧。実行時にフィルター文字列を入力可能
  - 入力したフィルターは `arduino-cli board listall <filter>` にそのまま渡します（例: `atom`）
- Arduino CLI: Compile Sketch — スケッチを選択してコンパイル（FQBN指定可）
- Arduino CLI: Clean Compile — クリーンビルド（`--clean` を付けてコンパイル）。開始時に includePath を空にリセットし、その後ビルドから検出したパスのみを追記
- Arduino CLI: Upload Sketch — スケッチを選択し、ポートと FQBN を指定して書き込み
- Arduino CLI: Monitor Serial — シリアルモニタを起動（ポートとボーレートを指定）
- Arduino CLI: Create sketch.yaml — スケッチフォルダに `sketch.yaml` を作成（dump-profile の profiles を含め、default_profile を現在の FQBN に対応するプロファイル名へ設定）
  - 仕様は Arduino CLI のドキュメント「Sketch Project File」を参照: https://arduino.github.io/arduino-cli/latest/sketch-project-file/
  - 作成時、FQBN が設定されていれば `arduino-cli compile --dump-profile` の結果（profiles セクション）も追記します。
- Arduino CLI: Board Details — プロファイル使用時は選択中プロファイルの FQBN を `-b` で渡して詳細表示
- Arduino CLI: Run Command — 任意の引数で Arduino CLI を実行

実行ログは疑似ターミナルにカラー表示（ANSI）で統一しています。

## ステータスバー

- `$(tools) Build`: 現在開いているフォルダ内の .ino を対象にコンパイル
- `$(cloud-upload) Upload`: 現在開いているフォルダ内の .ino を対象に書き込み
- `$(pulse) Monitor`: シリアルモニタを開く
- `$(list-unordered) Boards`: 接続中のボード一覧（`arduino-cli board list`）
- `$(search) ListAll`: すべてのボード一覧（`arduino-cli board listall`、実行時にフィルター入力可）
- `$(circuit-board) <FQBN/Profile>`:
  - スケッチフォルダに `sketch.yaml` がある場合は default_profile（または最初のプロファイル名）を表示し、クリックで選択（`Arduino CLI: Set Profile`）
  - 無い場合は FQBN を表示し、クリックで変更（`Arduino CLI: Set FQBN`）
- `$(plug) <Port>`: 現在選択されているシリアルポートを表示（クリックで変更）
- `$(watch) <Baud>`: 現在選択されているボーレートを表示（クリックで変更）

注: ワークスペース内に .ino が存在しない場合はステータスバー項目は非表示です。

FQBN/Port はワークスペースごとに保存され、再起動後も保持されます。

## クイックスタート / 使い方

1) arduino-cli を用意
- `PATH` に通すか、拡張設定 `arduino-cli-wrapper.path` にフルパスを設定。
- 「Arduino CLI: Show Version」で認識確認（未設定ならガイドが表示されます）。

2) スケッチを開く
- .ino を含むフォルダを開くと、ステータスバーに Build/Upload/Monitor と FQBN/Port/Baud が表示されます。

3) ビルド
- 「Arduino CLI: Compile Sketch」またはステータスバーの Build。
- 必要に応じて FQBN を設定。ビルド中に IntelliSense 設定が自動更新されます。

4) アップロード
- 「Arduino CLI: Upload Sketch」またはステータスバーの Upload。
- 事前にポートを選択（プロファイル使用時でも選択済みポートを `-p` で明示指定します）。

5) モニタ
- 「Arduino CLI: Monitor Serial」またはステータスバーの Monitor。
- ボーレートはステータスバーから変更（既定 115200）。

### 速度設定（ボーレート）

- コマンド: Arduino CLI: Set Baudrate
- ステータスバーの `$(watch) <Baud>` をクリックでも変更可能
- ポート選択は `arduino-cli board list` の結果から選択できます（選択した行に FQBN があれば同時に設定します）

または、ステータスバーの Build/Upload ボタンを利用してください。

補足:
- コンパイル/書き込みの対象は「現在開いているワークスペースフォルダ内の .ino」です。アクティブな .ino があればそれを優先します。
- 複数の .ino がある場合は Quick Pick で選択します。
- FQBN は接続ボードから自動取得できない場合、手入力が可能です。

## コマンドまとめ

- Show Version / List Connected Boards / List All Boards (listall)
- Compile Sketch / Clean Compile（`--clean` でクリーンビルド）
- Upload Sketch（プロファイル使用時も選択済みポートを `-p` で明示）
- Monitor Serial（`--config baudrate=<baud>`）
- Create sketch.yaml（dump-profile を追記し `default_profile` を設定）
- Board Details（プロファイルの FQBN を `-b` で渡す）
- Run Command（任意の引数で CLI 実行）

## sketch.yaml とプロファイル

- `sketch.yaml` がある場合、コンパイル/アップロードはプロファイルを優先します。
- `default_profile` が未設定なら最初のプロファイル名を候補に表示。
- 「Create sketch.yaml」で `arduino-cli compile --dump-profile` の結果（profiles）を追記し、`default_profile` を自動設定します。
- ステータスバーの FQBN 表示は、`sketch.yaml` があるとプロファイル名表示に切り替わります（クリックで Set Profile）。

## IntelliSense の更新仕様

- ビルド出力から `-I` / `-isystem` / `-iprefix` を解析し、`.vscode/c_cpp_properties.json` の `Arduino` 構成に重複なく `includePath` を追加します。
- クリーンビルドでは最初に includePath を空にし、その後検出分のみ追加します。
- C/C++ 標準（ESP32 系は `c17` / `c++23` を優先）

## 設定

- `arduino-cli-wrapper.path`: arduino-cli の実行ファイルパス
- `arduino-cli-wrapper.additionalArgs`: すべての呼び出しに追加する引数（配列）
- `arduino-cli-wrapper.verbose`: コンパイル/書き込み時に `--verbose` を付与

## 要件

- VS Code 1.84.0 以降
- Arduino CLI がローカルにインストール済み

## トラブルシュート

- 実行ファイルが見つからない: `arduino-cli-wrapper.path` にフルパスを設定してください。
- ボードが検出されない: ケーブル/ドライバ/ポートを確認し、`Arduino CLI: List Connected Boards` を実行して状況を確認してください。

## ライセンス

このプロジェクトは CC0 1.0 Universal（Public Domain Dedication）で提供します。詳細は `LICENSE` を参照してください。
