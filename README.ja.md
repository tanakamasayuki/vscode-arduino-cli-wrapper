# Arduino CLI Wrapper (VS Code 拡張機能)

Arduino CLI を VS Code から「コマンドパレット」「ステータスバー」「エクスプローラー」から操作できます。カラー付きの疑似ターミナルにログを集約し、sketch.yaml のプロファイルに対応、ビルド中に IntelliSense の includePath を自動更新します。

[English README](README.md)

## 機能

- Show Version: `arduino-cli version` を実行
- List Connected Boards: 接続中のボード一覧を表示
- List All Boards (listall): すべてのボード一覧。実行時にフィルター入力可（`arduino-cli board listall <filter>` に渡します）
- Compile Sketch: スケッチをコンパイル（プロファイルまたは FQBN を使用）
- Clean Compile: `--clean` でクリーンビルド。最初に includePath を空にし、ビルドで検出したパスのみを追加
- Upload Sketch: ビルドしてから書き込み。選択したポートとプロファイル/FQBNを使用。必要に応じてモニタを一時停止・再開
- Monitor Serial: シリアルモニタを起動（ポートとボーレートを選択）
 - Open Helper: sketch.yaml ヘルパーの Web ビューを開き、プロファイル/ライブラリを確認・反映
- Board Details: プロファイル使用時は `-b` でその FQBN を渡して詳細表示
- Run Command: 任意の Arduino CLI 引数を実行
- Configure IntelliSense: ビルドせずに includePath を計算して `.vscode/c_cpp_properties.json` を作成
- Upload Data (ESP32): `data/` から LittleFS/SPIFFS イメージを作成し、esptool で書き込み
- New Sketch: 新しいスケッチフォルダーを作成


すべてのコマンドのログは疑似ターミナルに ANSI カラーで表示されます。

## エクスプローラー ビュー

- エクスプローラーに「Arduino CLI」ビューを追加。
- スケッチフォルダーを一覧表示し、`sketch.yaml` があればプロファイルも表示。
- プロジェクト/プロファイルごとのアクション: Compile / Upload / Upload Data / Monitor / Open Helper。
- 先頭にグローバルアクション: Version / List Boards / List All Boards / Open Helper / New Sketch / Run Command。

## ステータスバー

- `$(tools) Build`: 現在のフォルダー内の `.ino` をコンパイル
- `$(cloud-upload) Upload`: 現在のフォルダー内の `.ino` を書き込み
- `$(pulse) Monitor`: シリアルモニタを開く
- `$(list-unordered) Boards`: 接続中のボード一覧（`arduino-cli board list`）
- `$(search) ListAll`: すべてのボード一覧（`arduino-cli board listall`、実行時にフィルター入力）
- `$(circuit-board) <FQBN/Profile>`:
  - `sketch.yaml` がある場合は既定または先頭のプロファイル名を表示し、「Arduino CLI: Set Profile」で切替可能。
  - ない場合は FQBN を表示し、「Arduino CLI: Set FQBN」で変更可能。
- `$(plug) <Port>`: 現在のシリアルポート（クリックで変更）
- `$(watch) <Baud>`: 現在のボーレート（クリックで変更）

`.ino` がないワークスペースではステータスバー項目は非表示です。FQBN/Port/Baud はワークスペースごとに保存され、再起動後も保持されます。

## クイックスタート

1) Arduino CLI の準備
- `PATH` に通すか、設定 `arduino-cli-wrapper.path` に実行ファイルのフルパスを指定。
- 「Arduino CLI: Show Version」で認識確認（未設定ならガイドを表示）。
  - Windows: インストーラー https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi または `winget install ArduinoSA.CLI`
  - Linux / macOS: https://arduino.github.io/arduino-cli/latest/installation/

2) スケッチフォルダーを開く
- `.ino` を含むフォルダーを開くと、Build/Upload/Monitor と FQBN/Port/Baud がステータスバーに表示されます。

3) ビルド / 書き込み / モニタ
- ビルド: 「Arduino CLI: Compile Sketch」または Build をクリック。
- 書き込み: 「Arduino CLI: Upload Sketch」または Upload をクリック。先にポートを選択してください（プロファイル使用時でも `-p` で明示指定）。
- モニタ: 「Arduino CLI: Monitor Serial」または Monitor をクリック。ボーレートは既定 115200、ステータスバーから変更できます。

ヒント:
- `.ino` が複数あるときは選択ダイアログが出ます。アクティブな `.ino` エディターがあれば優先されます。
- FQBN を自動取得できない場合は手入力できます。

## Upload Data (ESP32)

- スケッチ直下に `data/` フォルダーが必要です。スケッチに `#include <LittleFS.h>` または `#include <SPIFFS.h>` を含めてください。
- `mklittlefs` または `mkspiffs` でイメージを生成し、`esptool` で SPIFFS パーティションに書き込みます。
- `arduino-cli compile --show-properties` の結果からツールや速度を取得し、ビルド出力中の `partitions.csv` を解析してオフセット/サイズを特定します。
- フラッシュ前にシリアルモニタを閉じ、完了後に自動で再オープンします。

## sketch.yaml とプロファイル

- `sketch.yaml` があるときはプロファイルを優先。ない場合は FQBN を使用します。
 - ひな形を作るには「Open Helper」を使ってボードやライブラリを選択し、生成されたテンプレートを `sketch.yaml` として保存してください。
- ステータスバーの FQBN 表示は、プロファイルがあればプロファイル名に切り替わります。「Arduino CLI: Set Profile」で変更できます。
- 「Open Helper」では、選択したプロファイルの FQBN やライブラリ、プラットフォーム情報の確認と反映ができます。

## IntelliSense

- ビルド中にコンパイラ出力（`-I` / `-isystem` / `-iprefix`）を解析し、`.vscode/c_cpp_properties.json`（`Arduino` 構成）を重複なく更新します。
- クリーンビルドでは先に includePath を空にし、その後に検出パスのみを追加します。
- ESP32 系（esp32/xtensa-esp32/riscv32-esp-elf）では `c17` / `c++23` を優先します。
- 「Configure IntelliSense」でビルドせずに includePath を計算し、`c_cpp_properties.json` を作成できます。

## 設定

- `arduino-cli-wrapper.path`: `arduino-cli` 実行ファイルのパス
- `arduino-cli-wrapper.additionalArgs`: すべての呼び出しに付与する追加引数（配列）
- `arduino-cli-wrapper.verbose`: コンパイル/書き込み時に `--verbose` を付与

## 要件

- VS Code 1.84.0 以降
- Arduino CLI がローカルにインストール済み

## トラブルシューティング

- 実行ファイルが見つからない: `arduino-cli-wrapper.path` にフルパスを設定してください。
- ボードが検出されない: ケーブル/ドライバー/ポートを確認し、「Arduino CLI: List Connected Boards」で確認してください。
- Upload Data: `data/` が存在するか、スケッチに `SPIFFS.h` または `LittleFS.h` を含めているか確認してください。

## ライセンス

CC0 1.0 Universal (Public Domain Dedication)。詳細は `LICENSE` を参照してください。
