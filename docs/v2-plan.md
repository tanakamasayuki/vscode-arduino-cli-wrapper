# v2 リファクタリング計画 / v2 Refactoring Plan

作成日: 2026-11-26 / 対象: v1.10.0 + 未リリース分 (745c27d)

## 0. 目的

1. 最新版 arduino-cli を拡張機能が自動ダウンロード・管理する
2. CLI を毎回コマンドラインで起動する方式から、常駐 daemon への gRPC 呼び出しへ移行する
3. 標準から外れていて利用頻度が低い機能を整理し、構成を分割して保守しやすくする

---

## 1. 現状把握

### 1.1 規模

| 項目 | 値 |
| --- | --- |
| `extension.js` | 14,100 行・トップレベル関数 404 個(1 ファイル) |
| うちローカライズ文字列 `MSG` | 約 1,000 行(en / ja を同じファイルに保持) |
| Webview HTML (`html/`) | 7 ファイル・約 8,500 行(examples 3,286 / command-center 1,621 / sketch.yaml 1,164 ほか) |
| コマンド | 40 |
| 設定項目 | 9 |
| 依存 | `arduino-sketch-tool` 1.1.0, `embed-asset-tool` 1.0.0, `yaml` 2.9.1 |
| テスト | `node --test` で 45 件(vm に extension.js を読み込み、vscode をモック) |

### 1.2 arduino-cli の呼び出し方

- `cp.spawn` が 18 か所あります。出力はテキストまたは `--format json` を個別に解析しています。
- 主な呼び出し: `compile`(26 参照)、`upload`(12)、`lib` / `core` / `board` 各種、`monitor`、`debug`、`config`、`update` / `upgrade` / `outdated`、`cache clean`、`sketch new`。
- `compile --show-properties` を、ビルドフラグ注入、Upload Data、Inspector の前処理で別途呼んでいます。
- Monitor は統合ターミナルに文字列でコマンドを送る方式です(引数のクォート処理が必要)。
- **WSL ハイブリッド**(`_isWslEnv` などへの参照 32 か所): ビルドは WSL 側の `arduino-cli`、COM ポートを使う Upload / Monitor / Upload Data だけ Windows 側の `arduino-cli.exe` を使います。パス変換は `wslpath` で行っています。
- CLI の場所は、設定 `arduino-cli-wrapper.path`、PATH、Arduino IDE 同梱の exe の自動検出の順で決まります。ダウンロード機能はありません。

### 1.3 機能一覧(分類つき)

| 区分 | 機能 |
| --- | --- |
| ビルド・書き込み | Compile / Clean Compile / Upload / Export Binaries(2 種)/ Build Check(全プロファイル)/ OTA(`$ARDUINO_CLI_OTA_PASSWORD`) |
| シリアル | Monitor / ポート・ボーレート・モニター設定の選択 / Local Port Rules |
| sketch.yaml | Profile 選択 / sketch.yaml Helper / Version Check(一括更新)/ New Sketch / autoCopySketchYaml |
| 開発支援 | IntelliSense(`c_cpp_properties.json` / `compile_commands.json`)/ Debug(cortex-debug 連携)/ 警告 `workspace` モード / Include Order Lint(M5GFX・FS) |
| 解析 | Inspector(map / セクションサイズ) |
| ブラウズ | Examples Browser / Command Center(コマンド一覧・config・コア/ライブラリ管理) |
| CLI 素通し | Version / Update / Upgrade / Cache Clean / List Boards / List All / Board Details / Run Command |
| 独自拡張 | `.arduino-cli-flags` / タイムゾーンマクロ注入 / Upload Data(ESP32 LittleFS/SPIFFS)/ Embed Assets / Source Backup / Wokwi 連携 / `arduino_secrets.h` |

---

## 2. 技術検証の結果 (2026-11-26 実施)

検証用のコードはスクラッチ領域で動かしただけで、リポジトリには入れていません。

### 2.1 daemon と gRPC

| 確認項目 | 結果 |
| --- | --- |
| 起動 | `arduino-cli daemon --port 0 --json` で `{"IP":"127.0.0.1","Port":"39865"}` が出力される(約 170 ms) |
| 終了条件 | **stdin が閉じると daemon は即終了する。** stdin をパイプで開いたままにする必要がある。拡張が落ちれば自動で終わるので、むしろ都合がよい |
| クライアント | `@grpc/grpc-js` 1.14 + `@grpc/proto-loader` 0.8(ネイティブモジュールなし)で、`.proto` を実行時に読み込んで動作。JS のみという方針と両立する |
| 確認した RPC | Version / Create / Init / BoardListAll / BoardList / EnumerateMonitorPortSettings / Compile(ストリーム) |
| Init | 約 2.7 秒(インスタンスは使い回すので 1 回だけ) |
| Compile | 2 回目で CLI 1.7 秒、gRPC 2.2 秒。**ビルド速度の改善はない。** 利点はインスタンスの常駐(インデックスを毎回読み直さない)、構造化された結果(セクションサイズなど)、進捗、キャンセル |
| 参考 | このマシンで Arduino IDE 2 も同じく `arduino-cli.exe daemon --port 0 --config-file …` で動いていた |

### 2.2 今の CLI 利用は gRPC で置き換えられる

| 今の CLI 利用 | gRPC での対応 |
| --- | --- |
| `compile --profile` | `Init(profile, sketch_path)` で、プロファイル用のインスタンスを作る |
| `--build-property`, `--warnings`, `--export-binaries`, `--build-path`, `--clean`, `--show-properties` | `CompileRequest` の `build_properties` / `warnings` / `export_binaries` / `build_path` / `clean` / `show_properties` |
| IntelliSense 用のビルド | `create_compilation_database_only`(フルビルドせずに `compile_commands.json` だけ作れる) |
| `upload --upload-field password=…` | `UploadRequest.user_fields` |
| `monitor` | `Monitor` 双方向ストリーム + VS Code Pseudoterminal。`updated_configuration` で**接続したまま設定を変更できる** |
| `monitor --describe` | `EnumerateMonitorPortSettings` |
| `board list` | `BoardList`、または `BoardListWatch`(接続・切断をリアルタイムに検知し、ステータスバーを自動更新できる) |
| `debug --info` | `GetDebugConfig` / `IsDebugSupported` |
| `config get/add/remove/dump` | `SettingsGetValue` / `SettingsSetValue` / `ConfigurationGet` |
| `lib` / `core` の各操作 | `Library*` / `Platform*` |
| `outdated` | `LibraryList(updatable)` + `PlatformSearch` |
| `sketch new`, `cache clean`, `update` | `NewSketch`, `CleanDownloadCacheDirectory`, `UpdateIndex` / `UpdateLibrariesIndex` |
| sketch.yaml の編集(一部) | 1.5.1 から `ProfileCreate` / `ProfileLibAdd` / `ProfileLibRemove` / `ProfileSetDefault` がある(`arduino-sketch-tool` と役割が重なる) |

### 2.3 WSL → Windows(最大のリスク)

- Windows の `arduino-cli.exe daemon` を起動し、WSL から `127.0.0.1:<port>` へ接続すると **ECONNREFUSED** になった。
- 原因は WSL2 の既定(NAT)ネットワークです。daemon には待ち受けアドレスを指定するオプションがなく、127.0.0.1 でしか待ち受けません。
- WSL の mirrored ネットワークモードなら接続できる可能性がありますが、未検証です。利用者に設定を強いることになります。
- **結論(確定):** WSL ハイブリッドは v2 でも残し、Windows 側は今と同じ「exe を都度起動する」方式で連携します。

### 2.4 proto 定義の入手方法

| 方法 | 結果 |
| --- | --- |
| サーバーリフレクション(daemon に問い合わせる) | **1.5.1 / 1.6.0 とも未対応。** `grpc.reflection.v1` / `v1alpha` のどちらも `unknown service` が返る。1.6.0 のソースにもリフレクションの登録はなく、Issue / PR にもない |
| バイナリに埋め込まれた定義を抽出 | 1.6.0 の実行ファイルから 11 ファイル中 10 ファイルを復元でき、`ArduinoCoreService`(55 RPC)も含んでいた。ただし Go の内部配置に依存する非公式な方法なので、採用しない |
| リリースタグのソースから `.proto` を取得 | **★ 採用。** CLI と同じバージョンのタグ(`archive/refs/tags/vX.Y.Z.tar.gz` の `rpc/`)から取得する。CLI のダウンロードと同時に取れるので、バージョンが必ず一致する |

- 方針: 検証済みバージョンの `.proto` を拡張に同梱し、既定とします。管理する CLI を更新したときは同じタグの `.proto` も取得して、そちらを優先して読み込みます。
- `google/rpc/status.proto` も必要なので、これは同梱します。

### 2.5 自動ダウンロード

- 最新版は **v1.6.0**(2026-11-10 公開)で、手元は 1.5.1 です。
- 最新版の取得先: `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_<OS>_<ARCH>.<ext>`。302 でバージョン付きの URL へ転送されます。
- 検証用: GitHub Releases の `<ver>-checksums.txt`(SHA-256)。最新バージョンは `api.github.com/repos/arduino/arduino-cli/releases/latest` か `CheckForArduinoCLIUpdates` RPC で調べられます。
- 対象: Linux_64bit / Linux_ARM64 / macOS_64bit / macOS_ARM64 / Windows_64bit(zip)。
- 保存先: `context.globalStorageUri/arduino-cli/<version>/`。WSL ハイブリッドを残す場合は、Windows 用の exe も別に取得します(Windows 側から実行できる場所、例: `%LOCALAPPDATA%` 配下)。

---

## 3. v2 の設計方針

### 3.1 構成

```
extension.js            // activate だけ(薄く)
src/
  i18n/                 // t() と _isJa、MSG を en.js / ja.js に分割
  cli/
    installer.js        // ダウンロード・検証・展開・更新チェック
    daemon.js           // 起動・停止・再起動・ポート取得・ログ
    client.js           // gRPC クライアント(proto を読み込む)、ストリームの補助
    backend.js          // ArduinoBackend インターフェース
    grpc-backend.js     // 既定の実装
    exe-backend.js      // WSL→Windows シリアル用(今の spawn 方式を移植)
  state/                // 選択中のスケッチ・プロファイル・ポート・ボーレート・モニター設定
  features/             // compile, upload, monitor, debug, intellisense, inspector, build-check, ...
  ui/                   // ステータスバー、ツリー、Webview の橋渡し
proto/                  // arduino-cli の .proto(バージョンを固定して同梱)
html/                   // Webview(必要に応じて分割)
```

- 言語は JS のみのままにします。gRPC 関連も実行時の読み込みで足り、コード生成は不要です。
- 各機能は `ArduinoBackend` を通して CLI とやり取りします。gRPC 版と exe 版を差し替えられるようにし、段階的に移行・テストできる形にします。
- `.proto` は検証したバージョンのものを同梱します。gRPC API v1 は 1.x の間は互換が保たれる前提です。新しい CLI を使う場合でも、未知のフィールドは無視されます。

### 3.2 決めてほしいこと

| # | 論点 | 選択肢(★ 推奨) |
| --- | --- | --- |
| D1 | CLI の管理方法 | ★ 既定は拡張が管理する CLI。設定でパスを指定すれば任意の CLI も使える / 管理する CLI のみ |
| D2 | データディレクトリ(コア・ライブラリ) | ★ 既存の `~/.arduino15` などを共有(インストール済みのコアを再利用できる)/ 拡張専用の場所に分離(IDE と干渉しないが、ダウンロードし直しになる) |
| D3 | WSL ハイブリッド | **確定: 残す。Windows 側はコマンド実行(exe 方式)で連携する** |
| D4 | ローカライズ | ★ `t()` / `_isJa` を継続し、ファイルだけ分割 / `vscode.l10n` へ移行(AGENTS.md の変更が必要) |
| D5 | 対象の VS Code | `^1.84` のまま / 引き上げる |

---

## 4. 機能の整理案

### 4.1 判断材料(2026-11-26 調査)

- **手元での利用の痕跡:** `/home/mt/dev`(.ino 1,610 個、sketch.yaml 1,553 個)と Arduino の既定フォルダーで、各機能の設定ファイルや生成物を探しました。Marketplace の利用者の状況は分かりません。
- **既定で動くか:** 既定で動く機能は、使っていない人にも影響します(勝手にファイルを作る、警告を出すなど)。
- **規模:** 関連する関数の行数の目安です。テンプレートなどの定数は含みません。

### 4.2 削除候補の評価と結論

**決定(2026-11-26):** 削除するのは Wokwi 連携だけで、ほかの候補はすべて残します。

| 機能 | 入口 | 既定で動くか | 手元での利用 | 規模 | 追加時期 | 消した場合の影響と代わり | 結論 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.arduino-cli-flags` | ファイルを置くとビルド時に注入 | ファイルがあるときだけ | **なし**(0 件) | 約 80 行 | 2025-10 | 秘密情報は `arduino_secrets.h`(手元で利用多数)で代わりになる | 残す |
| タイムゾーンマクロ | 設定 `injectTimezoneMacros` | 既定 OFF | **なし**(`CLI_BUILD_TZ` の参照 0 件) | 約 140 行 + 設定 1 つ | 2025-10 | 上と合わせて消すと、`--show-properties` で注入先を判定する処理ごと不要になり、ビルド処理が単純になる | 残す |
| Local Port Rules | コマンド + 編集用 Webview | `.vscode/arduino-cli-wrapper.json` があるときだけ | **なし**(0 件) | 約 350 行 + Webview | 2025-12 | 記憶しているポートはワークスペースに 1 つだけで、プロファイルを切り替えても前のポートが残る。複数のボードを使い分けると別のボードに書き込む危険があり、sketch.yaml(git 管理)には COM 番号を書けない。この用途を担う機能なので、代わりはない | 残す |
| Wokwi 連携 | `wokwi: true` のプロファイル | 指定したときだけ | **なし**(`wokwi: true` も `wokwi.toml` も 0 件) | 約 340 行(テンプレート込み) | 2025-09 | Wokwi 拡張を手動で使う | **削除済み(v1、2026-11-26)** |
| Source Backup | `.sourcebackupconfig` | ファイルがあるときだけ | **なし**(0 件) | 約 600 行 | 2026-03(最新、5 コミット) | 最近作った機能なので、需要があるなら `embed-asset-tool` と同じく別パッケージに出す | 残す |
| Run Command | コマンド | 手動 | 判定できない | 約 20 行 | 2025-09 | ターミナルで CLI を直接使う | 残す。v2 では、管理する CLI を直接起動して実行する(gRPC は使わない) |
| autoCopySketchYaml | Refresh View 時 | **既定 ON** | 判定できない(手元の sketch.yaml はすべて git 管理済み) | 約 20 行 + 設定 1 つ | 2025-11 | 何も知らない利用者のフォルダーに sketch.yaml を作る、既定 ON の暗黙動作 | 残す |
| Include Order Lint | `.ino` を開いたとき | **既定 ON** | 判定できない(M5 系のリポジトリは多い) | 約 90 行 + 設定 2 つ | 2025-09 | M5GFX と FS 系ヘッダーの順序による実行時の不具合を事前に防げる。M5 を使う人には有用 | 残す |

### 4.3 残すもの(根拠つき)

| 機能 | 根拠 |
| --- | --- |
| Embed Assets | 利用あり(`*_embed.h` 6 件、assets/ を持つスケッチ複数)。本体は外部パッケージで、拡張側は約 130 行 |
| Upload Data(ESP32) | `data/` + `LittleFS.h` のスケッチあり(EspHttpServer の StaticFS など)。ESP32 系のリポジトリが多い |
| `arduino_secrets.h` | 利用多数。Arduino 標準の慣習 |
| localBuildPath | 約 10 行。gRPC でも `build_path` で簡単に残せる |
| Compile / Upload / Monitor / Profile / sketch.yaml Helper / Version Check / IntelliSense / Debug / Build Check / Inspector / Examples / 警告 `workspace` モード | 中核の機能 |

### 4.4 統合(未決定)

機能は減らさず、入口だけを整理する案です。まだ決めていません。

| 対象 | 案 |
| --- | --- |
| Version / Update Index / Upgrade / Cache Clean / List Boards / List All Boards / Board Details | コマンドパレットからは外し、Command Center に集約する(機能自体は残す) |
| Export Binaries(2 コマンド)/ Clean Compile | オプションとしてまとめる |

### 4.5 進め方

- Wokwi 連携は v1 で削除済み(`7b47972`)。既存の `.wokwi/` フォルダーには触れない。
- 残す機能は、v2 の構成分割(P3)と gRPC 化(P4〜P6)でそのまま移植する。

## 5. フェーズ計画

各フェーズの終わりで `npm run check` が通り、拡張機能として動く状態を保ちます。

| フェーズ | 内容 | 完了条件 |
| --- | --- | --- |
| P0 準備 | v1 の保守ライン(タグ `v1.10.x`)を決める。機能整理案と D1〜D5 を確定。v2 で残す機能の受け入れテスト項目を作る | 整理一覧が確定 |
| P1 CLI 管理 | installer(ダウンロード・SHA-256 検証・展開・更新通知)。設定 `path` が空なら管理する CLI を使う。v1 の spawn 方式のままでも使える形で先に入れる | Linux / Windows / macOS / WSL で取得から実行まで確認 |
| P2 daemon 基盤 | daemon の起動・監視・再起動、Create / Init(プロファイル別インスタンスのキャッシュ)、インデックス更新と進捗表示、エラー表示、Output へのログ | 統合テスト: 実 daemon で Version / Init |
| P3 構成分割 | `extension.js` を `src/` へ分割(動作は変えない)。i18n の分離。`ArduinoBackend` の導入(最初は exe 版だけ) | 既存のテストがすべて通る |
| P4 読み取り系の移行 | ボード一覧(`BoardListWatch`)、listall / details、モニター設定、コア・ライブラリの検索と一覧、config | Command Center と Examples が gRPC で動く |
| P5 ビルド系の移行 | Compile / Upload / Export / Build Check / IntelliSense / Inspector を gRPC へ。診断情報の解析を移植 | 主要ボード(AVR / ESP32 / CH32)でビルドと書き込み |
| P6 Monitor・Debug | Monitor を gRPC + Pseudoterminal に(接続中の設定変更に対応)。WSL→Windows は exe 版を使う。Debug を `GetDebugConfig` に | 実機で確認 |
| P7 仕上げと公開 | 入口の統合(4.4、決まれば)、README / CHANGELOG(日英)、v2.0.0 リリース | リリース |

**進め方の提案:**
- P1(自動ダウンロード)は単独で価値があり、リスクも低いので、v1.11 として先に出すこともできます。
- P3(分割)は gRPC 化より前に行います。差分レビューの負担を減らすためです。

### 5.1 テスト方針

- 単体テスト: `ArduinoBackend` をモックし、各機能を検証する(今の vm 方式は分割後に `require` 方式へ移す)。
- 統合テスト: CI で管理する CLI をダウンロードし、実 daemon に対して実行する。AVR コアなど軽いもので Init / Compile / BoardListAll / EnumerateMonitorPortSettings を確認する。
- ローカライズ: 日英の文字列キーが揃っているかを自動でチェックする。

### 5.2 リスク

| リスク | 対策 |
| --- | --- |
| WSL→Windows で daemon に届かない | exe 版で連携する(D3 で確定) |
| proto の入手 | リフレクションは未対応なので、同じタグのソースから取得する(2.4) |
| daemon の異常終了・ハング | 監視と自動再起動。各 RPC にタイムアウトを設ける |
| CLI 更新による API 変更 | `.proto` を固定する。対応範囲(例: `>=1.5 <2`)を確認して警告を出す |
| 同梱サイズの増加(grpc-js 約 2 MB) | 許容範囲。必要になれば esbuild でバンドルする |
| IDE とのデータディレクトリ共有で衝突 | 同時のインストール操作は避けるよう案内する(D2) |

---

## 6. clang 対応

対象: `ch32-riscv-ug:ch32rv` 0.14 以降(`temp/testV003` の `x035` プロファイル)。clang + lld + LTO で、ツールチェーンには llvm-* と `riscv32-unknown-elf-gdb` が入っています。
2026-11-26 に `ch32-riscv-ug:ch32rv:CH32X035`(0.15.0)で実際にビルドし、拡張の関数を出力に当てて確認しました。

| 領域 | 今の実装 | 実測の結果 | 対応 |
| --- | --- | --- | --- |
| ビルド診断(`parseCompilerDiagnostics`) | `file:line:col: error:` / `warning:` を解析 | **問題なし。** `testV003.ino:8:27 unused variable 'b'` を正しく取得 | clang の出力をテストに追加 |
| tasks.json の problemMatcher | `$gcc` | 出力形式が同じなので一致する | 確認のみ |
| Inspector の define 取得 | `<compiler> -dM -E -x c++` | **問題なし。** clang++ で 467 個の define を取得 | 確認のみ |
| compile_commands / IntelliSense | ビルド結果をコピーし、`-iprefix` を展開 | 106 エントリ。`clang++ --target=riscv32-unknown-elf -march=rv32imac_zicsr_xwchc -flto …` が入っている。cpptools 側の判定は VS Code 上で確認が必要 | 実機の VS Code で確認 |
| **Inspector の map 解析**(`parseMapEntries`) | GNU ld の map 形式だけ解析 | **0 件。** lld の map は `VMA LMA Size Align Out In Symbol` の表形式で、まったく別物 | lld 形式の解析を追加(形式は自動判定)。LTO ではスケッチ側のコードが `lto.tmp` にまとまるため、オブジェクト別の集計は粗くなる |
| **Debug の objdump** | `<prefix>-objdump` を存在確認なしで設定 | **`riscv32-unknown-elf-objdump` は存在しない**(あるのは `llvm-objdump`) | 存在を確認し、無ければ同じフォルダーの `llvm-objdump` を使う |
| Debug の gdb | `debug.toolchain.prefix` + `-gdb` | `riscv32-unknown-elf-gdb` があるので動く見込み | 実機で確認 |
| デバッグビルドのフラグ | `-Og -g3` を注入 | clang でも使える | 確認のみ |

- **対応済み(v1、2026-11-26):** lld の map 解析(`parseLldMapEntries`、形式は自動判定)と、objdump が無いときに `llvm-objdump` を使う処理(`resolveDebugObjdumpPath`)。テストは `test/clang-toolchain.test.js`。
- 残り: compile_commands を cpptools が正しく扱えるかと、gdb でのデバッグを実機の VS Code で確認すること。
- ld64(macOS)と lldb は、今回の対象外です。

## 7. 将来の候補(優先度低)

ほかのフェーズを優先し、余裕ができたら着手するものです。

| 候補 | 内容 | 前提 |
| --- | --- | --- |
| コアが提供するライブラリの検出 | CLI 1.6.0 の PR #3295 で `PlatformRelease.library_dependencies` が gRPC から読めるようになった。sketch.yaml Helper でコアが提供するライブラリを `libraries:` に追加しようとしたときに警告し、Version Check ではバージョン固定から外すよう提案する。固定するとコアを更新してもライブラリが追従しなくなるため | gRPC 化(P4 以降)、CLI 1.6.0 以上 |

## English Summary

- **Current state:** single 14,100-line `extension.js` (404 functions, ~1,000 lines of inline i18n), 7 webviews (~8,500 lines), 40 commands, 18 `cp.spawn` sites. A WSL hybrid mode runs Windows `arduino-cli.exe` for serial operations.
- **gRPC findings (verified):**
  - `arduino-cli daemon --port 0 --json` prints `{IP, Port}`; the daemon exits when stdin closes.
  - `@grpc/grpc-js` with runtime proto loading works (JS only).
  - Compile is not faster than the CLI; the gains are a persistent instance, structured results and progress, `BoardListWatch`, live monitor reconfiguration, and `create_compilation_database_only`.
  - Every current CLI use has a gRPC equivalent.
  - **A Windows daemon is unreachable from WSL2 in NAT mode** (it binds 127.0.0.1 only). Decided: keep the WSL hybrid and drive Windows via the exe (command) backend.
  - **No gRPC server reflection** in 1.5.1 or 1.6.0 (not in the source either). Descriptors can be carved out of the binary, but that is unofficial. Plan: ship verified `.proto` files and fetch `rpc/` from the same release tag whenever the managed CLI is updated.
- **Auto-download:**
  - Latest release is v1.6.0.
  - Fetch from `downloads.arduino.cc/arduino-cli/arduino-cli_latest_<OS>_<ARCH>` and verify against the release `checksums.txt`.
  - Store under `globalStorageUri`.
- **clang (verified with ch32-riscv-ug:ch32rv 0.15, clang + lld + LTO):**
  - Diagnostics and `-dM -E` work as is.
  - The Inspector map parser returns 0 entries for lld maps.
  - Debug points objdump at a non-existent `<prefix>-objdump`; it should fall back to `llvm-objdump`.
  - Both fixes are independent of gRPC and can ship in v1.
- **Plan:** P0 decisions → P1 CLI installer (can ship as v1.11) → P2 daemon foundation → P3 split into `src/` with an `ArduinoBackend` abstraction → P4 read-only ops → P5 build/upload → P6 monitor/debug → P7 pruning and v2.0.0.
- **Pruning (decided 2026-11-26 after a local usage survey of ~1,600 sketches):**
  - Only the Wokwi integration is removed (done in v1, `7b47972`).
  - Everything else stays, including local port rules: the workspace remembers a single port, so per-machine rules are still needed for multi-board work.
  - Run Command stays; in v2 it spawns the managed CLI directly.
  - Consolidating the CLI passthrough commands into the Command Center is still undecided.
