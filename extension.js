// JavaScript-only VS Code extension that wraps Arduino CLI
// No external dependencies; uses Node's child_process and VS Code API.

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');
const path = require('path');
const https = require('https');

const DEFAULT_WOKWI_DIAGRAM = '{\n  "version": 1,\n  "author": "wokwi",\n  "editor": "wokwi",\n  "parts": [ { "type": "wokwi-arduino-uno", "id": "uno", "top": 0, "left": 0, "attrs": {} } ],\n  "connections": [],\n  "dependencies": {}\n}\n';
const DEFAULT_WOKWI_TOML = '[wokwi]\nversion = 1\nfirmware = "wokwi.elf"\n';
const WOKWI_EXTENSION_IDS = ['wokwi.wokwi-vscode', 'wokwi.wokwi-vscode-preview'];
const WOKWI_VIEW_TYPES = ['wokwi.diagram', 'wokwi.wokwi', 'wokwi.diagramEditor'];

const OUTPUT_NAME = 'Arduino CLI';
const STATE_FQBN = 'arduino-cli.selectedFqbn';
const STATE_PORT = 'arduino-cli.selectedPort';
const STATE_BAUD = 'arduino-cli.selectedBaud';
const STATE_LAST_PROFILE = 'arduino-cli.lastProfileApplied';
const VALID_WARNING_LEVELS = new Set(['workspace', 'none', 'default', 'more', 'all']);
let output;
let extContext;
let statusBuild, statusUpload, statusMonitor, statusFqbn, statusPort, statusBaud, statusWarnings;
let compileDiagnostics;
let monitorTerminal;
// Log terminal (ANSI capable, no command execution)
let logTerminal;
let logTermWriteEmitter;

// Simple i18n without external deps.
// Note: We intentionally avoid bundling any library to keep
// this extension lightweight and compatible with VS Code's
// extension host sandbox.
const _locale = (vscode.env.language || 'en').toLowerCase();
const _isJa = _locale.startsWith('ja');
const MSG = {
  en: {
    missingCli: 'Arduino CLI not found: {exe}',
    chooseExe: 'Select Executable…',
    openSettings: 'Open Settings',
    installHelp: 'Installation Guide',
    workspaceNotOpen: 'No workspace folder is open. Please open a folder and try again.',
    selectWorkspace: 'Select a workspace folder',
    noInoFound: 'No .ino files found in {name}.',
    pickIno: 'Select a .ino file',
    pickBoardOrFqbn: 'Select a connected board or enter FQBN',
    enterFqbn: 'Enter FQBN (e.g., arduino:avr:uno)',
    enterPort: 'Enter serial port (e.g., COM3, /dev/ttyACM0)',
    intellisenseStart: 'IntelliSense update start ({reason})',
    intellisenseDone: 'IntelliSense update done',
    intellisenseFail: 'IntelliSense update failed: {msg}',
    compileCommandsUpdated: 'Updated compile_commands.json ({count} entries)',
    compileCommandsNoInoEntries: 'No .ino entries found in compile_commands.json.',
    compileCommandsBuildPathMissing: 'Unable to resolve build.path; skipped compile_commands.json update.',
    compileCommandsSourceMissing: 'compile_commands.json not found: {path}',
    compileCommandsParseError: 'Failed to parse compile_commands.json: {msg}',
    compileCommandsInvalidFormat: 'compile_commands.json has unexpected format.',
    sketchYamlCreateStart: '[sketch.yaml] Create start: {dir}',
    sketchYamlExistsOpen: 'sketch.yaml already exists. Open it?',
    open: 'Open',
    cancel: 'Cancel',
    sketchYamlExists: '[sketch.yaml] Already exists: {path}',
    sketchYamlNoFqbn: '[sketch.yaml] FQBN is not set. Skip dump-profile.',
    sketchYamlFetching: '[sketch.yaml] Getting dump-profile…',
    sketchYamlEmpty: '[sketch.yaml] dump-profile output is empty (no profiles appended)',
    sketchYamlCreated: 'Created sketch.yaml.',
    sketchYamlCreateDone: '[sketch.yaml] Create done: {path}',
    defaultProfileSet: '[sketch.yaml] Set default_profile: {name}',
    setFqbnPickTitle: 'Select FQBN',
    setFqbnManual: 'Enter FQBN manually…',
    setFqbnUnsetWarn: 'FQBN is not selected',
    statusSetFqbn: 'FQBN set: {fqbn}',
    monitorPickPortTitle: 'Select port from board list',
    setPortManual: 'Enter port manually…',
    portUnsetWarn: 'Port is not selected',
    statusSetPort: 'Port set: {port}{withFqbn}',
    setBaudTitle: 'Select baudrate (current: {current})',
    setBaudCustom: 'Custom…',
    setBaudPrompt: 'Enter baudrate (e.g., 115200)',
    statusSetBaud: 'Baudrate set: {baud}',
    warningsStatusTooltip: 'Warnings: {level} / Verbose: {verbose}',
    warningsLevelWorkspace: 'workspace-only',
    warningsLevelNone: 'none',
    warningsLevelDefault: 'default',
    warningsLevelMore: 'more',
    warningsLevelAll: 'all',
    warningsVerboseOn: 'on',
    warningsVerboseOff: 'off',
    warningsQuickPickTitle: 'Select warnings and verbose mode',
    warningsQuickPickPlaceHolder: 'Choose compile warnings level and verbose output',
    warningsQuickPickWithVerbose: '{level} (with verbose)',
    warningsQuickPickWithoutVerbose: '{level} (no verbose)',
    warningsUpdateApplied: 'Warnings set to {level}, verbose {verbose}',
    warningsUpdateFailed: 'Failed to update warnings settings: {msg}',
    assistNoYaml: 'No sketch.yaml found. Create one?',
    assistUpdatePick: 'Select which setting to update',
    assistUpdateFqbn: 'Update default_fqbn to current selection',
    assistUpdatePort: 'Update default_port to current selection',
    assistUpdateBaud: 'Update monitor.baudrate to current selection',
    assistUpdateAll: 'Update all (FQBN/Port/Baud)',
    updatedYaml: 'Updated sketch.yaml.',
    noChanges: 'No changes.',
    cliCheckStart: '[cli] Checking arduino-cli…',
    cliCheckOk: '[cli] OK: arduino-cli {version}',
    cliCheckFail: '[cli] Failed to run arduino-cli. Please configure arduino-cli-wrapper.path or install arduino-cli.',
    buildCheckStart: '[build-check] Scanning sketch.yaml files…',
    buildCheckNoWorkspace: '[build-check] No workspace folder is open. Open a folder in VS Code and re-run Build Check from the Arduino CLI view.',
    buildCheckNoSketchYaml: '[build-check] No sketch.yaml files found. Use the Sketch.yaml Helper to create profiles, then run Build Check again.',
    buildCheckSkipNoProfiles: '[build-check] {sketch} skipped (no profiles defined in sketch.yaml).',
    buildCheckCompileStart: '[build-check] {sketch} ({profile}) compiling…',
    buildCheckStatusSuccess: 'SUCCESS',
    buildCheckStatusFailed: 'FAILED',
    buildCheckCompileResult: '[build-check] {sketch} ({profile}) {status} warnings:{warnings} errors:{errors}',
    buildCheckParseError: '[build-check] Failed to parse JSON output for {sketch} ({profile}): {msg}',
    buildCheckCliError: '[build-check] Compile failed to run for {sketch} ({profile}): exit {code}',
    buildCheckSummary: '[build-check] Completed {total} compile(s): success {success}, failed {failed}, warnings {warnings}, errors {errors}.',
    treeBuildCheck: 'Build Check',
    treeCompile: 'Compile',
    treeCleanCompile: 'Clean Compile',
    treeUpload: 'Upload',
    treeUploadData: 'Upload Data',
    treeMonitor: 'Monitor',
    treeHelper: 'Sketch.yaml Helper',
    treeExamples: 'Open Examples',
    treeInspect: 'Inspect',
    treeWokwiRun: 'Run in Wokwi',
    wokwiElfCopied: '[Wokwi] Copied ELF to {dest} for profile {profile}.',
    wokwiElfMissing: '[Wokwi] No ELF found for profile {profile} (build path: {buildPath}).',
    wokwiCommandDisabled: '[Wokwi] Profile {profile} is not enabled in sketch.yaml.',
    wokwiDiagramCreated: '[Wokwi] Created default diagram.json for profile {profile}.',
    wokwiTomlCreated: '[Wokwi] Created default wokwi.toml for profile {profile}.',
    treeInspectorOpen: 'Open Inspector',
    treeCliVersion: 'Check CLI Version',
    treeListBoards: 'List Boards',
    treeListAllBoards: 'List All Boards',
    treeVersionCheck: 'Check Sketch.yaml Versions',
    treeRefresh: 'Refresh View',
    treeNewSketch: 'New Sketch',
    treeRunCommand: 'Run Command',
    treeProfile: 'Profile: {profile}',
    versionCheckStart: '[version-check] Scanning sketch.yaml files…',
    versionCheckNoWorkspace: '[version-check] No workspace folder is open.',
    versionCheckNoSketchYaml: '[version-check] No sketch.yaml files found.',
    versionCheckFetchBoardsFail: '[version-check] Failed to fetch board metadata: {msg}',
    versionCheckFetchLibrariesFail: '[version-check] Failed to fetch library metadata: {msg}',
    versionCheckOpenReport: '[version-check] Opening dependency report.',
    versionCheckUpdateApplied: '[version-check] Updated {count} entry(ies) in sketch.yaml.',
    versionCheckUpdateNoChanges: '[version-check] No version changes were needed.',
    versionCheckUpdateFailed: '[version-check] Failed to update sketch.yaml: {msg}',
    versionCheckTitle: 'Dependency Versions',
    versionCheckSummaryHeading: 'Summary',
    versionCheckSummarySketches: 'Sketches',
    versionCheckSummaryProfiles: 'Profiles',
    versionCheckSummaryPlatforms: 'Platforms',
    versionCheckSummaryLibraries: 'Libraries',
    versionCheckSummaryOutdated: 'Outdated',
    versionCheckSummaryMissing: 'Missing',
    versionCheckSummaryUnknown: 'Unknown',
    versionCheckPlatformsHeading: 'Platforms',
    versionCheckLibrariesHeading: 'Libraries',
    versionCheckColSketch: 'Sketch',
    versionCheckColProfile: 'Profile',
    versionCheckColPlatform: 'Platform',
    versionCheckColLibrary: 'Library',
    versionCheckColCurrent: 'Current',
    versionCheckColLatest: 'Latest',
    versionCheckColStatus: 'Status',
    versionCheckColAction: 'Action',
    versionCheckStatusOk: 'Up to date',
    versionCheckStatusOutdated: 'Update available',
    versionCheckStatusMissing: 'Not specified',
    versionCheckStatusUnknown: 'Unknown',
    versionCheckStatusAhead: 'Newer than index',
    versionCheckBtnUpdate: 'Update',
    versionCheckBtnUpdateAllPlatforms: 'Update all platforms',
    versionCheckBtnUpdateAllLibraries: 'Update all libraries',
    versionCheckBtnRefresh: 'Refresh',
    versionCheckNoData: 'No data available.',
    versionCheckGeneratedAt: 'Generated at',
    versionCheckErrorsHeading: 'Errors',
    versionCheckWarningsHeading: 'Warnings',
    versionCheckPending: 'Gathering data…',
    versionCheckReportReady: 'Dependency report generated.',
    yamlApplied: 'Applied profile to sketch.yaml: {name}',
    yamlApplyError: 'Failed to apply to sketch.yaml: {msg}',
    yamlNoSketchDir: 'Could not determine a sketch folder in this workspace.',
    enterSketchName: 'Enter new sketch name',
    sketchCreateStart: '[sketch] Creating at: {path}',
    sketchCreateDone: '[sketch] Created: {path}',
    lintFsIncludeAfterM5: 'FS header {fsHeader} must appear before the M5GFX header {m5Header}.',
    inspectorPanelTitle: 'Sketch Inspector',
    inspectorSelectSketch: 'Sketch',
    inspectorSelectProfile: 'Profile',
    inspectorProfileNone: 'Use current FQBN',
    inspectorRunButton: 'Analyze',
    inspectorStatusIdle: 'Ready',
    inspectorStatusNoSketch: 'No sketches detected in the workspace.',
    inspectorStatusPreparing: 'Preparing analysis...',
    inspectorStatusRunning: 'Analyzing...',
    inspectorAnalysisSuccess: 'Analysis complete.',
    inspectorAnalysisFailed: 'Analysis failed: {msg}',
    inspectorTabSummary: 'Summary',
    inspectorTabDiagnostics: 'Diagnostics',
    inspectorTabSections: 'Sections',
    inspectorTabSymbols: 'Top Symbols',
    inspectorTabLibraries: 'Libraries',
    inspectorTabBuildProps: 'Build Properties',
    inspectorTabPartitions: 'partitions.csv',
    inspectorTabSdkconfig: 'sdkconfig',
    inspectorTabRawJson: 'Raw JSON',
    inspectorSummaryBuildPath: 'Build path',
    inspectorSummarySketch: 'Sketch',
    inspectorSummaryProfile: 'Profile',
    inspectorSummaryWarnings: 'Warnings',
    inspectorSummaryErrors: 'Errors',
    inspectorSummaryFlash: 'Flash (text)',
    inspectorSummaryData: 'RAM (data)',
    inspectorSummaryUnknown: 'Unknown',
    inspectorTableNoData: 'No data',
    inspectorDiagnosticsHeaderSeverity: 'Severity',
    inspectorDiagnosticsHeaderMessage: 'Message',
    inspectorDiagnosticsHeaderLocation: 'Location',
    inspectorMapHeaderSymbol: 'Symbol',
    inspectorMapHeaderSize: 'Size (bytes)',
    inspectorMapHeaderObject: 'Object file',
    inspectorMapHeaderSection: 'Section',
    inspectorSectionsHeaderName: 'Section',
    inspectorSectionsHeaderUsed: 'Used',
    inspectorSectionsHeaderMax: 'Max',
    inspectorLibrariesHeaderName: 'Library',
    inspectorLibrariesHeaderVersion: 'Version',
    inspectorLibrariesHeaderLocation: 'Source',
    inspectorBuildPropsHeaderKey: 'Key',
    inspectorBuildPropsHeaderValue: 'Value',
    inspectorFileLoadError: 'Failed to load file: {name}',
    inspectorRequestInProgress: 'Analysis already running. Please wait.',
    inspectorNoSelectionWarn: 'Select a sketch before running analysis.',
    inspectorMapMissing: 'Map file not found under the build path.',
    inspectorMapParseFailed: 'Failed to analyze map file: {msg}',
    inspectorMapNoSymbols: 'No symbols parsed from the map file.',
    inspectorOpenInEditor: 'Open in Editor',
    buildReportTitle: 'Build Check Report',
    buildReportSummaryHeading: 'Summary',
    buildReportTotalsHeading: 'Totals',
    buildReportGeneratedAt: 'Generated at',
    buildReportResultsHeading: 'Per Profile',
    buildReportTableSketch: 'Sketch',
    buildReportTableProfile: 'Profile',
    buildReportTableResult: 'Result',
    buildReportTableWarnings: 'Warnings',
    buildReportTableErrors: 'Errors',
    buildReportTablePlatform: 'Platform',
    buildReportTableLibraries: 'Libraries',
    buildReportNoData: 'No build results.',
    buildReportResultSuccess: 'Success',
    buildReportResultFailure: 'Failed',
    buildReportPlatformsHeading: 'Platforms',
    buildReportLibrariesHeading: 'Libraries',
    buildReportLibraryColumnName: 'Library',
    buildReportLibraryColumnVersion: 'Version',
    buildReportLibraryColumnSource: 'Source',
    buildReportSummaryWarnings: 'Warnings',
    buildReportSummaryErrors: 'Errors',
  },
  ja: {
    missingCli: 'Arduino CLI が見つかりませんでした: {exe}',
    chooseExe: '実行ファイルを選択…',
    openSettings: '設定を開く',
    installHelp: 'インストール方法',
    workspaceNotOpen: 'ワークスペースフォルダが開かれていません。フォルダを開いてから再実行してください。',
    selectWorkspace: '対象のワークスペースフォルダを選択してください',
    noInoFound: '{name} に .ino ファイルが見つかりませんでした。',
    pickIno: '.ino ファイルを選択してください',
    pickBoardOrFqbn: '接続中のボードを選択するか FQBN を入力',
    enterFqbn: 'FQBN を入力（例: arduino:avr:uno）',
    enterPort: 'ポートを入力（例: COM3, /dev/ttyACM0）',
    intellisenseStart: '[IntelliSense] 更新開始 ({reason})',
    intellisenseDone: '[IntelliSense] 更新完了',
    intellisenseFail: '[IntelliSense] 更新失敗: {msg}',
    compileCommandsUpdated: '[IntelliSense] compile_commands.json を更新しました (エントリ数: {count})',
    compileCommandsNoInoEntries: '[IntelliSense] compile_commands.json に .ino エントリが見つかりませんでした。',
    compileCommandsBuildPathMissing: '[IntelliSense] build.path を取得できませんでした。更新をスキップします。',
    compileCommandsSourceMissing: '[IntelliSense] build.path に compile_commands.json が見つかりませんでした: {path}',
    compileCommandsParseError: '[IntelliSense] compile_commands.json の解析に失敗しました: {msg}',
    compileCommandsInvalidFormat: '[IntelliSense] compile_commands.json の形式が不正です。',
    sketchYamlCreateStart: '[sketch.yaml] 作成開始: {dir}',
    sketchYamlExistsOpen: 'sketch.yaml は既に存在します。開きますか？',
    open: '開く',
    cancel: 'キャンセル',
    sketchYamlExists: '[sketch.yaml] 既に存在: {path}',
    sketchYamlNoFqbn: '[sketch.yaml] FQBN が未設定のため dump-profile の取得はスキップします',
    sketchYamlFetching: '[sketch.yaml] 作成中: dump-profile を取得しています…',
    sketchYamlEmpty: '[sketch.yaml] dump-profile の取得結果が空でした（プロファイル追記はありません）',
    sketchYamlCreated: 'sketch.yaml を作成しました。',
    sketchYamlCreateDone: '[sketch.yaml] 作成完了: {path}',
    lintFsIncludeAfterM5: 'FS系ヘッダー {fsHeader} は M5GFX系ヘッダー {m5Header} より前に記述してください。',
    inspectorPanelTitle: 'スケッチインスペクター',
    inspectorSelectSketch: 'スケッチ',
    inspectorSelectProfile: 'プロファイル',
    inspectorProfileNone: '現在のFQBNを使用',
    inspectorRunButton: '分析',
    inspectorStatusIdle: '待機中',
    inspectorStatusNoSketch: 'ワークスペースにスケッチが見つかりません。',
    inspectorStatusPreparing: '準備中...',
    inspectorStatusRunning: '分析中...',
    inspectorAnalysisSuccess: '分析が完了しました。',
    inspectorAnalysisFailed: '分析に失敗しました: {msg}',
    inspectorTabSummary: 'サマリー',
    inspectorTabDiagnostics: '診断',
    inspectorTabSections: 'セクション',
    inspectorTabSymbols: '大きいシンボル',
    inspectorTabLibraries: 'ライブラリ',
    inspectorTabBuildProps: 'ビルドプロパティ',
    inspectorTabPartitions: 'partitions.csv',
    inspectorTabSdkconfig: 'sdkconfig',
    inspectorTabRawJson: 'JSON 出力',
    inspectorSummaryBuildPath: 'ビルドパス',
    inspectorSummarySketch: 'スケッチ',
    inspectorSummaryProfile: 'プロファイル',
    inspectorSummaryWarnings: '警告',
    inspectorSummaryErrors: 'エラー',
    inspectorSummaryFlash: 'フラッシュ (text)',
    inspectorSummaryData: 'RAM (data)',
    inspectorSummaryUnknown: '不明',
    inspectorTableNoData: 'データがありません',
    inspectorDiagnosticsHeaderSeverity: '重大度',
    inspectorDiagnosticsHeaderMessage: 'メッセージ',
    inspectorDiagnosticsHeaderLocation: '位置',
    inspectorMapHeaderSymbol: 'シンボル',
    inspectorMapHeaderSize: 'サイズ (バイト)',
    inspectorMapHeaderObject: 'オブジェクトファイル',
    inspectorMapHeaderSection: 'セクション',
    inspectorSectionsHeaderName: 'セクション',
    inspectorSectionsHeaderUsed: '使用量',
    inspectorSectionsHeaderMax: '上限',
    inspectorLibrariesHeaderName: 'ライブラリ',
    inspectorLibrariesHeaderVersion: 'バージョン',
    inspectorLibrariesHeaderLocation: '取得元',
    inspectorBuildPropsHeaderKey: 'キー',
    inspectorBuildPropsHeaderValue: '値',
    inspectorFileLoadError: 'ファイルを読み込めませんでした: {name}',
    inspectorRequestInProgress: '別の分析が進行中です。完了までお待ちください。',
    inspectorNoSelectionWarn: '分析するスケッチを選択してください。',
    inspectorMapMissing: 'ビルドパスにマップファイルが見つかりません。',
    inspectorMapParseFailed: 'マップファイルの分析に失敗しました: {msg}',
    inspectorMapNoSymbols: 'マップファイルからシンボルを解析できませんでした。',
    inspectorOpenInEditor: 'エディターで開く',
    buildReportTitle: 'ビルドチェックレポート',
    buildReportSummaryHeading: 'サマリー',
    buildReportTotalsHeading: '集計',
    buildReportGeneratedAt: '作成時刻',
    buildReportResultsHeading: 'スケッチ/プロファイル別',
    buildReportTableSketch: 'スケッチ',
    buildReportTableProfile: 'プロファイル',
    buildReportTableResult: '結果',
    buildReportTableWarnings: '警告',
    buildReportTableErrors: 'エラー',
    buildReportTablePlatform: 'プラットフォーム',
    buildReportTableLibraries: 'ライブラリ',
    buildReportNoData: '結果がありません。',
    buildReportResultSuccess: '成功',
    buildReportResultFailure: '失敗',
    buildReportPlatformsHeading: 'プラットフォーム',
    buildReportLibrariesHeading: 'ライブラリ',
    buildReportLibraryColumnName: 'ライブラリ',
    buildReportLibraryColumnVersion: 'バージョン',
    buildReportLibraryColumnSource: '取得元',
    buildReportSummaryWarnings: '警告',
    buildReportSummaryErrors: 'エラー',
    defaultProfileSet: '[sketch.yaml] default_profile を設定: {name}',
    setFqbnPickTitle: 'FQBN を選択してください',
    setFqbnManual: 'FQBN を手入力…',
    setFqbnUnsetWarn: 'FQBN が未選択です',
    statusSetFqbn: 'FQBN を設定: {fqbn}',
    monitorPickPortTitle: 'arduino-cli board list の結果からポートを選択してください',
    setPortManual: 'ポートを手入力…',
    portUnsetWarn: 'ポートが未選択です',
    statusSetPort: 'ポートを設定: {port}{withFqbn}',
    setBaudTitle: 'ボーレートを選択（現在: {current})',
    setBaudCustom: 'カスタム入力…',
    setBaudPrompt: 'ボーレートを入力（例: 115200）',
    statusSetBaud: 'ボーレートを設定: {baud}',
    warningsStatusTooltip: '警告: {level} / 詳細ログ: {verbose}',
    warningsLevelWorkspace: 'ワークスペースのみ(workspace)',
    warningsLevelNone: 'なし(none)',
    warningsLevelDefault: 'デフォルト(default)',
    warningsLevelMore: '詳細(more)',
    warningsLevelAll: '全て(all)',
    warningsVerboseOn: '有効',
    warningsVerboseOff: '無効',
    warningsQuickPickTitle: '警告レベルと詳細ログを選択',
    warningsQuickPickPlaceHolder: 'コンパイル警告と verbose の組み合わせを選択してください',
    warningsQuickPickWithVerbose: '{level} (詳細ログあり)',
    warningsQuickPickWithoutVerbose: '{level} (詳細ログなし)',
    warningsUpdateApplied: '警告を {level}、詳細ログを {verbose} に更新しました。',
    warningsUpdateFailed: '警告設定の更新に失敗しました: {msg}',
    assistNoYaml: 'sketch.yaml がありません。作成しますか？',
    assistUpdatePick: '更新する設定を選択してください',
    assistUpdateFqbn: 'default_fqbn を現在の選択に更新',
    assistUpdatePort: 'default_port を現在の選択に更新',
    assistUpdateBaud: 'monitor.baudrate を現在の選択に更新',
    assistUpdateAll: 'すべて更新（FQBN/Port/Baud）',
    updatedYaml: 'sketch.yaml を更新しました。',
    noChanges: '変更はありませんでした。',
    cliCheckStart: '[cli] arduino-cli を確認中…',
    cliCheckOk: '[cli] OK: arduino-cli {version}',
    cliCheckFail: '[cli] arduino-cli の実行に失敗しました。arduino-cli のインストールまたは設定 (arduino-cli-wrapper.path) を行ってください。',
    buildCheckStart: '[build-check] sketch.yaml を走査しています…',
    buildCheckNoWorkspace: '[build-check] ワークスペースフォルダーが開かれていません。VS Code でフォルダーを開き、Arduino CLI ビューからビルドチェックを再実行してください。',
    buildCheckNoSketchYaml: '[build-check] sketch.yaml が見つかりませんでした。Sketch.yaml ヘルパーでプロファイルを作成してからビルドチェックを再実行してください。',
    buildCheckSkipNoProfiles: '[build-check] {sketch} をスキップしました (sketch.yaml にプロファイルがありません)。',
    buildCheckCompileStart: '[build-check] {sketch} ({profile}) をコンパイル中…',
    buildCheckStatusSuccess: '成功',
    buildCheckStatusFailed: '失敗',
    buildCheckCompileResult: '[build-check] {sketch} ({profile}) {status} 警告:{warnings}件 エラー:{errors}件',
    buildCheckParseError: '[build-check] {sketch} ({profile}) の JSON 出力解析に失敗しました: {msg}',
    buildCheckCliError: '[build-check] {sketch} ({profile}) のコンパイル実行に失敗しました (終了コード {code})。',
    buildCheckSummary: '[build-check] 合計 {total} 件 (成功 {success} / 失敗 {failed}) 警告 {warnings} 件 / エラー {errors} 件。',
    treeBuildCheck: 'ビルドチェック',
    treeCompile: 'コンパイル',
    treeCleanCompile: 'クリーンコンパイル',
    treeUpload: '書き込み',
    treeUploadData: 'データ書き込み',
    treeMonitor: 'シリアルモニター',
    treeHelper: 'Sketch.yaml ヘルパー',
    treeExamples: 'サンプルを開く',
    treeInspect: 'インスペクト',
    treeWokwiRun: 'wokwiで実行',
    wokwiElfCopied: '[Wokwi] プロファイル {profile} の ELF を {dest} に配置しました。',
    wokwiElfMissing: '[Wokwi] プロファイル {profile} の .elf がビルドパス {buildPath} で見つかりませんでした。',
    wokwiCommandDisabled: '[Wokwi] プロファイル {profile} は sketch.yaml で有効化されていません。',
    wokwiDiagramCreated: '[Wokwi] プロファイル {profile} 用の diagram.json を初期化しました。',
    wokwiTomlCreated: '[Wokwi] プロファイル {profile} 用の wokwi.toml を初期化しました。',
    treeInspectorOpen: 'インスペクターを開く',
    treeCliVersion: 'CLI バージョン確認',
    treeListBoards: 'ボード一覧',
    treeListAllBoards: '全ボード一覧',
    treeVersionCheck: 'Sketch.yaml バージョン確認',
    treeRefresh: 'ビュー更新',
    treeNewSketch: '新しいスケッチ',
    treeRunCommand: 'コマンドを実行',
    treeProfile: 'プロファイル: {profile}',
    versionCheckStart: '[version-check] sketch.yaml を走査してバージョン情報を収集しています…',
    versionCheckNoWorkspace: '[version-check] ワークスペースフォルダーが開かれていません。',
    versionCheckNoSketchYaml: '[version-check] sketch.yaml が見つかりませんでした。',
    versionCheckFetchBoardsFail: '[version-check] ボードの最新情報取得に失敗しました: {msg}',
    versionCheckFetchLibrariesFail: '[version-check] ライブラリーの最新情報取得に失敗しました: {msg}',
    versionCheckOpenReport: '[version-check] バージョン比較レポートを表示します。',
    versionCheckUpdateApplied: '[version-check] sketch.yaml の {count} 箇所を更新しました。',
    versionCheckUpdateNoChanges: '[version-check] 更新すべきバージョンはありませんでした。',
    versionCheckUpdateFailed: '[version-check] sketch.yaml の更新に失敗しました: {msg}',
    versionCheckTitle: '依存関係バージョン',
    versionCheckSummaryHeading: '概要',
    versionCheckSummarySketches: 'スケッチ',
    versionCheckSummaryProfiles: 'プロファイル',
    versionCheckSummaryPlatforms: 'プラットフォーム',
    versionCheckSummaryLibraries: 'ライブラリー',
    versionCheckSummaryOutdated: '更新対象',
    versionCheckSummaryMissing: '未指定',
    versionCheckSummaryUnknown: '不明',
    versionCheckPlatformsHeading: 'プラットフォーム',
    versionCheckLibrariesHeading: 'ライブラリー',
    versionCheckColSketch: 'スケッチ',
    versionCheckColProfile: 'プロファイル',
    versionCheckColPlatform: 'プラットフォーム',
    versionCheckColLibrary: 'ライブラリー',
    versionCheckColCurrent: '現在',
    versionCheckColLatest: '最新',
    versionCheckColStatus: '状態',
    versionCheckColAction: '操作',
    versionCheckStatusOk: '最新です',
    versionCheckStatusOutdated: '更新できます',
    versionCheckStatusMissing: '未指定',
    versionCheckStatusUnknown: '不明',
    versionCheckStatusAhead: 'インデックスより新しい',
    versionCheckBtnUpdate: '更新',
    versionCheckBtnUpdateAllPlatforms: 'すべてのプラットフォームを更新',
    versionCheckBtnUpdateAllLibraries: 'すべてのライブラリーを更新',
    versionCheckBtnRefresh: '再取得',
    versionCheckNoData: '表示するデータがありません。',
    versionCheckGeneratedAt: '生成日時',
    versionCheckErrorsHeading: 'エラー',
    versionCheckWarningsHeading: '警告',
    versionCheckPending: 'データを収集中…',
    versionCheckReportReady: 'バージョン比較レポートを生成しました。',
    yamlApplied: 'sketch.yaml にプロファイルを反映しました: {name}',
    yamlApplyError: 'sketch.yaml への反映に失敗しました: {msg}',
    yamlNoSketchDir: 'ワークスペース内のスケッチフォルダを特定できませんでした。',
  }
};

function t(key, vars) {
  const str = (_isJa ? MSG.ja[key] : MSG.en[key]) || MSG.en[key] || key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

const DEFAULT_M5GFX_HEADERS = [
  'M5Atom.h',
  'M5AtomDisplay.h',
  'M5AtomS3.h',
  'M5Capsule.h',
  'M5Core2.h',
  'M5CoreInk.h',
  'M5CoreS3.h',
  'M5Dial.h',
  'M5DinMeter.h',
  'M5EPD.h',
  'M5GFX.h',
  'M5ModuleDisplay.h',
  'M5ModuleRCA.h',
  'M5NanoC6.h',
  'M5PoECAM.h',
  'M5Stack.h',
  'M5Station.h',
  'M5StickC.h',
  'M5StickCPlus.h',
  'M5StickCPlus2.h',
  'M5TimerCAM.h',
  'M5Unified.h',
  'M5Unified.hpp',
  'M5UnitGLASS.h',
  'M5UnitGLASS2.h',
  'M5UnitLCD.h',
  'M5UnitMiniOLED.h',
  'M5UnitOLED.h',
  'M5UnitRCA.h'
];

const DEFAULT_FS_HEADERS = [
  'FFat.h',
  'FS.h',
  'HTTPClient.h',
  'HTTPUpdate.h',
  'HTTPUpdateServer.h',
  'LittleFS.h',
  'Middlewares.h',
  'SD.h',
  'SD_MMC.h',
  'SPIFFS.h',
  'WebServer.h'
];

let includeOrderDiagnostics;
let includeOrderConfig = { m5: new Set(), fs: new Set() };

function setupIncludeOrderLint(context) {
  includeOrderConfig = loadIncludeOrderConfig();
  includeOrderDiagnostics = vscode.languages.createDiagnosticCollection('arduinoCliIncludeOrder');
  context.subscriptions.push(includeOrderDiagnostics);

  const revalidate = (doc) => lintIncludeOrderDocument(doc);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(revalidate),
    vscode.workspace.onDidChangeTextDocument((event) => revalidate(event.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      try { if (includeOrderDiagnostics) includeOrderDiagnostics.delete(doc.uri); } catch { }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      try {
        if (event.affectsConfiguration('arduino-cli-wrapper.lint.m5gfxIncludes') ||
          event.affectsConfiguration('arduino-cli-wrapper.lint.fsIncludes')) {
          includeOrderConfig = loadIncludeOrderConfig();
          lintAllOpenIncludeOrderTargets();
        }
      } catch { }
    })
  );

  lintAllOpenIncludeOrderTargets();
}

function lintAllOpenIncludeOrderTargets() {
  try {
    for (const doc of vscode.workspace.textDocuments) {
      lintIncludeOrderDocument(doc);
    }
  } catch { }
}

function lintIncludeOrderDocument(document) {
  if (!includeOrderDiagnostics || !document) return;
  const uri = document.uri;
  if (!uri) return;
  const fileName = document.fileName || uri.fsPath || '';
  if (typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.ino')) {
    includeOrderDiagnostics.delete(uri);
    return;
  }

  let text;
  try { text = document.getText(); } catch { text = ''; }
  if (!text) {
    includeOrderDiagnostics.delete(uri);
    return;
  }

  const lines = text.split(/\r?\n/);
  const diagnostics = [];
  let sawM5 = false;
  let lastM5Name = '';

  for (let i = 0; i < lines.length; i++) {
    const info = extractIncludeInfo(lines[i]);
    if (!info) continue;
    const normalized = normalizeHeaderName(info.baseName);
    if (includeOrderConfig.m5.has(normalized)) {
      sawM5 = true;
      lastM5Name = info.baseName;
      continue;
    }
    if (sawM5 && includeOrderConfig.fs.has(normalized)) {
      const message = t('lintFsIncludeAfterM5', { fsHeader: info.baseName, m5Header: lastM5Name });
      const range = new vscode.Range(
        new vscode.Position(i, info.startColumn),
        new vscode.Position(i, lines[i].length)
      );
      const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
      diagnostic.code = 'M5GfxFsIncludeOrder';
      diagnostics.push(diagnostic);
    }
  }

  if (diagnostics.length > 0) includeOrderDiagnostics.set(uri, diagnostics);
  else includeOrderDiagnostics.delete(uri);
}

function loadIncludeOrderConfig() {
  const cfg = vscode.workspace.getConfiguration('arduino-cli-wrapper');
  const m5List = parseHeaderList(cfg.get('lint.m5gfxIncludes'), DEFAULT_M5GFX_HEADERS);
  const fsList = parseHeaderList(cfg.get('lint.fsIncludes'), DEFAULT_FS_HEADERS);
  return {
    m5: new Set(m5List.map((name) => normalizeHeaderName(name))),
    fs: new Set(fsList.map((name) => normalizeHeaderName(name)))
  };
}

function parseHeaderList(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  const filtered = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) filtered.push(trimmed);
    }
  }
  return filtered.length ? filtered : fallback.slice();
}

function extractIncludeInfo(line) {
  if (typeof line !== 'string') return undefined;
  const match = line.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
  if (!match) return undefined;
  const target = match[1].trim();
  if (!target) return undefined;
  const baseName = headerBasename(target);
  const hashIndex = line.indexOf('#');
  const whitespaceIndex = line.search(/\S/);
  const startColumn = hashIndex >= 0 ? hashIndex : (whitespaceIndex >= 0 ? whitespaceIndex : 0);
  return { target, baseName, startColumn };
}

function normalizeHeaderName(header) {
  return headerBasename(header).toLowerCase();
}

function headerBasename(header) {
  return String(header || '').split(/[\/]/).pop();
}


/**
 * Read extension configuration from VS Code settings.
 * Returns normalized values to be used across command helpers.
 */
function getConfig() {
  const cfg = vscode.workspace.getConfiguration();
  const inspectedWarnings = cfg.inspect('arduino-cli-wrapper.compileWarnings');
  const inspectedVerbose = cfg.inspect('arduino-cli-wrapper.verbose');
  const warnings = typeof inspectedWarnings?.workspaceValue !== 'undefined'
    ? inspectedWarnings.workspaceValue
    : typeof inspectedWarnings?.globalValue !== 'undefined'
      ? inspectedWarnings.globalValue
      : inspectedWarnings?.defaultValue ?? 'workspace';
  const verbose = typeof inspectedVerbose?.workspaceValue !== 'undefined'
    ? inspectedVerbose.workspaceValue
    : typeof inspectedVerbose?.globalValue !== 'undefined'
      ? inspectedVerbose.globalValue
      : inspectedVerbose?.defaultValue ?? false;
  const normalizedWarnings = typeof warnings === 'string' ? warnings : 'workspace';
  return {
    exe: cfg.get('arduino-cli-wrapper.path', 'arduino-cli'),
    useTerminal: cfg.get('arduino-cli-wrapper.useTerminal', false),
    extra: cfg.get('arduino-cli-wrapper.additionalArgs', []),
    verbose: !!verbose,
    warnings: normalizedWarnings,
  };
}

function containsWarningsFlag(list) {
  if (!Array.isArray(list)) return false;
  for (let i = 0; i < list.length; i += 1) {
    const value = String(list[i] ?? '');
    if (value === '--warnings' || value.startsWith('--warnings=')) return true;
  }
  return false;
}

/**
 * Lazily create and return the shared output channel.
 * All CLI logs and helper diagnostics are routed here.
 */

function getOutput() {
  if (!output) {
    output = {
      append: (s) => {
        try {
          getAnsiLogTerminal().write(String(s));
        } catch (_) { /* ignore */ }
      },
      appendLine: (s) => {
        try {
          getAnsiLogTerminal().write(String(s) + '\r\n');
        } catch (_) { /* ignore */ }
      },
      show: (preserveFocus = false) => {
        try {
          getAnsiLogTerminal().terminal.show(!!preserveFocus);
        } catch (_) { /* ignore */ }
      },
      dispose: () => {
        try {
          if (logTerminal && !logTerminal.exitStatus) {
            logTerminal.dispose();
          }
          logTerminal = undefined;
        } catch (_) { /* ignore */ }
        output = null;
      }
    };
  }
  return output;
}

/**
 * Report an error to both the output channel and VS Code UI toast.
 * The error is converted to a string for safety.
 */
function showError(err) {
  const channel = getOutput();
  const msg = (err && err.message) ? err.message : String(err);
  channel.appendLine(`[error] ${msg}`);
  channel.show();
  vscode.window.showErrorMessage(msg);
}

/**
 * Quote a CLI argument when necessary so it is safe to pass
 * to child_process without going through a shell.
 */
function quoteArg(a) {
  if (a === undefined || a === null) return '';
  const s = String(a);
  if (/^[A-Za-z0-9._:\\/-]+$/.test(s)) return s; // simple case
  // quote and escape double quotes
  return '"' + s.replace(/"/g, '\\"') + '"';
}

// Detect if the integrated terminal is PowerShell on Windows.
// If so, invoking a quoted full path requires the call operator '&'.
function needsPwshCallOperator() {
  if (process.platform !== 'win32') return false;
  try {
    const termCfg = vscode.workspace.getConfiguration('terminal');
    const rawDef = termCfg.get('integrated.defaultProfile.windows');
    const defProfile = (rawDef ? String(rawDef) : '').toLowerCase();
    const shellPath = String(termCfg.get('integrated.shell.windows') || '').toLowerCase(); // legacy setting
    if (defProfile.includes('powershell')) return true;
    if (shellPath.includes('powershell')) return true;
    if (defProfile.includes('cmd') || defProfile.includes('command prompt')) return false;
    if (defProfile.includes('git bash') || defProfile.includes('bash') || defProfile.includes('wsl')) return false;
    // If no explicit defaultProfile/shell configured, VS Code defaults to PowerShell on Windows.
    if (!defProfile && !shellPath) return true;
  } catch (_) { /* ignore */ }
  return false;
}

/**
 * Remove ANSI escape sequences from a string.
 * Keeps logs readable when tools emit colored output.
 */
// stripAnsi removed per request: keep original colors

// Ensure a pseudo terminal for colored logs (no command execution)
function getAnsiLogTerminal() {
  if (!logTerminal || logTerminal.exitStatus) {
    logTermWriteEmitter = new vscode.EventEmitter();
    const onDidWrite = logTermWriteEmitter.event;
    const pty = {
      onDidWrite,
      open: () => { /* no-op */ },
      close: () => { /* no-op */ }
    };
    logTerminal = vscode.window.createTerminal({ name: 'Arduino Logs', pty });
  }
  return {
    terminal: logTerminal,
    write(data) {
      try {
        const s = String(data).replace(/\r?\n/g, '\r\n');
        logTermWriteEmitter.fire(s);
      } catch { /* ignore */ }
    }
  };
}
const ANSI = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m', gray: '\x1b[90m', white: '\x1b[37m'
};

// Run a quick check to ensure arduino-cli is available and runnable.
// Shows guidance and returns false if not ready.
async function ensureCliReady() {
  const channel = getOutput();
  channel.appendLine(t('cliCheckStart'));
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'version', '--format', 'json'];
  let stdout = '';
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(exe, args, { shell: false });
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => channel.append(d.toString()));
      child.on('error', e => reject(e));
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`version exit ${code}`)));
    });
    let version = '';
    try {
      const json = JSON.parse(stdout || '{}');
      version = String(json.VersionString || json.version || json.Version || '').trim();
    } catch { /* ignore */ }
    if (!version) version = (stdout || '').trim().replace(/\s+/g, ' ');
    channel.appendLine(t('cliCheckOk', { version }));
    return true;
  } catch (e) {
    // If executable not found, provide guided actions
    const msg = t('cliCheckFail');
    channel.appendLine(`[error] ${msg}`);
    // Offer actions (include Windows MSI direct link)
    const buttons = [t('chooseExe'), t('openSettings'), t('installHelp')];
    const isWin = (process.platform === 'win32');
    if (isWin) buttons.push('Download MSI');
    const action = await vscode.window.showErrorMessage(msg, ...buttons);
    if (action === t('installHelp')) {
      vscode.env.openExternal(vscode.Uri.parse('https://arduino.github.io/arduino-cli/latest/installation/'));
    } else if (action === 'Download MSI') {
      vscode.env.openExternal(vscode.Uri.parse('https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi'));
    } else if (action === t('openSettings')) {
      vscode.commands.executeCommand('workbench.action.openSettings', 'arduino-cli-wrapper.path');
    } else if (action === t('chooseExe')) {
      await promptConfigureCli(exe, ['version'], {});
    }
    return false;
  }
}

/**
 * Normalize a path for includePath/cpp_properties usage:
 * - remove quotes
 * - convert backslashes to forward slashes
 * - collapse duplicate slashes (except UNC prefix)
 * - keep Windows drive letters intact
 */
function normalizeIncludePath(p) {
  if (!p) return p;
  let s = String(p).trim().replace(/"/g, '');
  s = s.replace(/\\/g, '/');
  // Fix Windows drive letter like C:// -> C:/
  s = s.replace(/^([A-Za-z]:)\/+/, '$1/');
  // Preserve UNC prefix //server/share but collapse other duplicate slashes
  if (s.startsWith('//')) {
    s = '//' + s.slice(2).replace(/\/{2,}/g, '/');
  } else {
    s = s.replace(/\/{2,}/g, '/');
  }
  return s;
}

// Resolve include path to absolute when given a relative path.
function resolveIncludePath(baseDir, p) {
  if (!p) return p;
  const raw = String(p).trim().replace(/"/g, '');
  // Normalize slashes early to simplify checks
  let s = raw.replace(/\\/g, '/');
  const isWinAbs = /^[A-Za-z]:\//.test(s);
  const isPosixAbs = s.startsWith('/');
  const isUnc = s.startsWith('//');
  if (isWinAbs || isPosixAbs || isUnc) return normalizeIncludePath(s);
  try {
    return normalizeIncludePath(path.resolve(baseDir || '', raw));
  } catch (_) {
    return normalizeIncludePath(raw);
  }
}

// Get the base path used to test existence when the path contains globs.
function getGlobBase(p) {
  if (!p) return '';
  const s = normalizeIncludePath(p);
  const idx = s.search(/[\*\?\[]/);
  const base = idx >= 0 ? s.slice(0, idx) : s;
  return base || '';
}

// Ask user to locate CLI or open settings when arduino-cli is missing.
async function promptConfigureCli(exe, args, opts) {
  const choice = await vscode.window.showErrorMessage(
    t('missingCli', { exe }),
    t('chooseExe'),
    t('openSettings'),
    t('installHelp')
  );
  if (!choice) return false;
  if (choice === t('installHelp')) {
    vscode.env.openExternal(vscode.Uri.parse('https://arduino.github.io/arduino-cli/latest/installation/'));
    return false;
  }
  if (choice === t('openSettings')) {
    vscode.commands.executeCommand('workbench.action.openSettings', 'arduino-cli-wrapper.path');
    return false;
  }
  if (choice === t('chooseExe')) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: t('chooseExe')
    });
    if (!picked || picked.length === 0) return false;
    const newExe = picked[0].fsPath;
    const target = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration().update('arduino-cli-wrapper.path', newExe, target);
    // Offer to rerun
    const retry = await vscode.window.showInformationMessage('arduino-cli-wrapper.path updated. Retry the command?', 'Yes', 'No');
    if (retry === 'Yes') {
      try {
        await runCli(args, { ...opts, _retried: true });
      } catch (_) { }
    }
    return true;
  }
  return false;
}

/**
 * Spawn arduino-cli with provided args.
 * - Writes the composed command to the output channel.
 * - Returns a promise that resolves/rejects with the process result.
 * - If configuration enables terminal usage, runs in the integrated terminal.
 */
function runCli(args, opts = {}) {
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const finalArgs = [...baseArgs, ...args];
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  channel.show();
  channel.appendLine(`${ANSI.cyan}$ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}`);
  if (opts.cwd) channel.appendLine(`${ANSI.dim}(cwd: ${opts.cwd})${ANSI.reset}`);

  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, {
      cwd: opts.cwd || undefined,
      shell: false,
    });
    child.stdout.on('data', (d) => channel.append(d.toString()))
    child.stderr.on('data', (d) => channel.append(d.toString()))
    child.on('error', async (e) => {
      if (e && (e.code === 'ENOENT' || /not recognized/i.test(e.message))) {
        // arduino-cli is missing — guide the user to configure it
        if (!opts._retried) {
          await promptConfigureCli(exe, args, opts);
        }
      } else {
        showError(e);
      }
      reject(e);
    });
    child.on('close', (code) => {
      channel.appendLine(`${ANSI.bold}${ANSI.green}[exit ${code}]${ANSI.reset}`);
      if (code === 0) resolve({ code });
      else reject(new Error(`arduino-cli exited with code ${code}`));
    });
  });
}

/**
 * Determine the relevant workspace folder based on the active editor
 * or a user pick when multiple workspace folders are present.
 */
async function getRelevantWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage(t('workspaceNotOpen'));
    return undefined;
  }
  const active = vscode.window.activeTextEditor;
  if (active?.document?.uri) {
    const wf = vscode.workspace.getWorkspaceFolder(active.document.uri);
    if (wf) return wf;
  }
  if (folders.length === 1) return folders[0];
  const picked = await vscode.window.showQuickPick(
    folders.map(f => ({ label: f.name, description: f.uri.fsPath, id: f.index })),
    { placeHolder: t('selectWorkspace') }
  );
  if (!picked) return undefined;
  return folders.find(f => f.index === picked.id);
}

/**
 * Find .ino files under the chosen workspace folder.
 * Prioritize the active editor if it is an .ino.
 * If there are multiple .ino files, ask the user to pick one.
 */
async function pickInoFromWorkspace() {
  const wf = await getRelevantWorkspaceFolder();
  if (!wf) return undefined;
  const ignore = '{node_modules,.git,build,out,dist,.vscode}';
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(wf, '**/*.ino'), new vscode.RelativePattern(wf, `**/${ignore}/**`), 200);

  if (!files || files.length === 0) {
    vscode.window.showWarningMessage(t('noInoFound', { name: wf.name }));
    return undefined;
  }

  // Prefer the active .ino file if present
  const active = vscode.window.activeTextEditor?.document?.uri;
  const activeInList = active && files.find(f => f.fsPath === active.fsPath);
  if (activeInList) return active.fsPath;

  if (files.length === 1) return files[0].fsPath;

  const items = files.map(u => {
    const rel = path.relative(wf.uri.fsPath, u.fsPath) || path.basename(u.fsPath);
    return { label: rel, description: u.fsPath, value: u.fsPath };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('pickIno') });
  return pick?.value;
}

/**
 * List connected boards using `arduino-cli board list --format json`.
 * Supports multiple JSON formats emitted by different CLI versions.
 */
async function listConnectedBoards() {
  // Use JSON output for structured parsing (supports modern and legacy formats)
  const channel = getOutput();
  let jsonText = '';
  try {
    await new Promise((resolve, reject) => {
      const cfg = getConfig();
      const exe = cfg.exe || 'arduino-cli';
      const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
      const args = [...baseArgs, 'board', 'list', '--format', 'json'];
      const child = cp.spawn(exe, args, { shell: false });
      child.stdout.on('data', (d) => { jsonText += d.toString(); });
      child.stderr.on('data', (d) => channel.append(d.toString()));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`board list exit ${code}`)));
    });
  } catch (e) {
    showError(e);
    return [];
  }
  try {
    const parsed = JSON.parse(jsonText);
    const boards = [];
    const addBoard = (obj) => {
      const item = {
        port: obj.port || 'unknown',
        boardName: obj.boardName || obj.name || '',
        fqbn: obj.fqbn || '',
        protocol: obj.protocol || '',
      };
      boards.push(item);
    };

    // Modern format: detected_ports[] with port + matching_boards[]
    if (Array.isArray(parsed.detected_ports)) {
      for (const dp of parsed.detected_ports) {
        const portAddr = dp?.port?.address || dp?.port?.label || dp?.port || 'unknown';
        const protocol = dp?.port?.protocol_label || dp?.port?.protocol || '';
        const matches = Array.isArray(dp?.matching_boards) ? dp.matching_boards : [];
        if (matches.length > 0) {
          for (const m of matches) {
            addBoard({ port: portAddr, boardName: m.name, fqbn: m.fqbn, protocol });
          }
        } else {
          // No matching board, still list the port
          addBoard({ port: portAddr, boardName: '', fqbn: '', protocol });
        }
      }
    }

    // Legacy fallback: serialBoards[] (older CLI versions)
    if (boards.length === 0 && Array.isArray(parsed.serialBoards)) {
      for (const b of parsed.serialBoards) {
        addBoard({
          port: b.port?.address || b.port || 'unknown',
          boardName: b.boardName || b.name || '',
          fqbn: b.fqbn || '',
          protocol: b.protocol || '',
        });
      }
    }

    return boards;
  } catch (e) {
    showError(new Error('Failed to parse board list JSON'));
    return [];
  }
}

/**
 * Allow the user to choose a connected board (and optionally port),
 * or enter a manual FQBN when detection is not possible.
 */
async function pickBoardOrFqbn(requirePort) {
  const boards = await listConnectedBoards();
  const items = boards.map(b => ({
    label: b.boardName || '(Unknown Board)',
    description: `${b.port}${b.fqbn ? '  •  ' + b.fqbn : ''}`,
    detail: b.protocol ? `Protocol: ${b.protocol}` : undefined,
    fqbn: b.fqbn,
    port: b.port,
    picked: false,
  }));
  items.push({ label: t('setFqbnManual'), description: 'If your board is not auto-detected', manual: true });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('pickBoardOrFqbn') });
  if (!pick) return undefined;
  if (pick.manual) {
    const fqbn = await vscode.window.showInputBox({ prompt: t('enterFqbn') });
    if (!fqbn) return undefined;
    if (requirePort) {
      const port = await vscode.window.showInputBox({ prompt: t('enterPort') });
      if (!port) return undefined;
      return { fqbn, port };
    }
    return { fqbn };
  }
  if (requirePort && !pick.port) {
    const port = await vscode.window.showInputBox({ prompt: t('enterPort') });
    if (!port) return undefined;
    return { fqbn: pick.fqbn, port };
  }
  return { fqbn: pick.fqbn, port: pick.port };
}

async function commandVersion() {
  const channel = getOutput();
  let current = '';
  let ensured = false;
  try { ensured = await ensureCliReady(); } catch { ensured = false; }
  if (ensured) {
    try { await runCli(['version']); } catch (_) { /* ignore */ }
    try { current = await getArduinoCliVersionString(); } catch { current = ''; }
  } else {
    channel.appendLine('[info] arduino-cli not detected. Showing latest release info…');
  }
  try {
    const latest = await fetchLatestArduinoCliTag();
    const latestNorm = normalizeVersion(latest);
    const currentNorm = normalizeVersion(current);
    const isWin = (process.platform === 'win32');
    const msiUrl = 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi';
    if (latest) channel.appendLine(`Latest release on GitHub: ${latest}`);
    if (currentNorm && latestNorm) {
      if (currentNorm === latestNorm) {
        vscode.window.showInformationMessage(`arduino-cli is up to date (current: ${current})`);
      } else {
        const btns = isWin ? ['Open MSI', 'Open Release Page'] : ['Open Release Page'];
        const sel = await vscode.window.showInformationMessage(`A newer arduino-cli is available: ${latest} (current: ${current})`, ...btns);
        if (sel === 'Open MSI') vscode.env.openExternal(vscode.Uri.parse(msiUrl));
        if (sel === 'Open Release Page') vscode.env.openExternal(vscode.Uri.parse('https://github.com/arduino/arduino-cli/releases/latest'));
      }
    } else {
      const msg = `Latest arduino-cli: ${latest || '(unknown)'}`;
      channel.appendLine(msg);
      if (isWin) {
        const sel = await vscode.window.showInformationMessage(`${msg}`, 'Open MSI', 'Open Release Page');
        if (sel === 'Open MSI') vscode.env.openExternal(vscode.Uri.parse(msiUrl));
        if (sel === 'Open Release Page') vscode.env.openExternal(vscode.Uri.parse('https://github.com/arduino/arduino-cli/releases/latest'));
      } else {
        const sel = await vscode.window.showInformationMessage(`${msg}`, 'Open Release Page');
        if (sel === 'Open Release Page') vscode.env.openExternal(vscode.Uri.parse('https://github.com/arduino/arduino-cli/releases/latest'));
      }
    }
  } catch (e) {
    channel.appendLine(`[warn] ${e.message || e}`);
  }
}

async function commandListBoards() {
  if (!(await ensureCliReady())) return;
  try {
    await runCli(['board', 'list']);
  } catch (e) {
    showError(e);
  }
}

// Return current arduino-cli version string via `version --format json` (e.g., "1.3.0")
async function getArduinoCliVersionString() {
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'version', '--format', 'json'];
  let stdout = '';
  await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { shell: false });
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', () => { });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`version exit ${code}`)));
  });
  try {
    const json = JSON.parse(stdout || '{}');
    const v = String(json.VersionString || json.version || json.Version || '').trim();
    return v || '';
  } catch { return (stdout || '').trim(); }
}

// Fetch latest tag name from GitHub Releases API for arduino/arduino-cli
async function fetchLatestArduinoCliTag() {
  const https = require('https');
  const url = 'https://api.github.com/repos/arduino/arduino-cli/releases/latest';
  const body = await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'vscode-arduino-cli-wrapper' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle simple redirect once
        https.get(res.headers.location, { headers: { 'User-Agent': 'vscode-arduino-cli-wrapper' } }, (res2) => {
          const chunks = [];
          res2.on('data', c => chunks.push(Buffer.from(c)));
          res2.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          res2.on('error', reject);
        }).on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.from(c)));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { try { req.destroy(new Error('timeout')); } catch (_) { } });
  });
  try {
    const json = JSON.parse(body || '{}');
    const tag = String(json.tag_name || json.tag || '').trim();
    return tag || '';
  } catch { return ''; }
}

function normalizeVersion(v) {
  if (!v) return '';
  return String(v).trim().replace(/^v/i, '');
}

async function commandRunArbitrary() {
  if (!(await ensureCliReady())) return;
  const input = await vscode.window.showInputBox({
    prompt: 'Enter Arduino CLI arguments (without the executable)',
    placeHolder: 'e.g., board list, core list, sketch new MySketch',
  });
  if (!input) return;
  const args = input.trim().length ? input.match(/(?:"[^"]*"|[^\s"]+)/g) || [] : [];
  try {
    await runCli(args);
  } catch (e) {
    showError(e);
  }
}

/**
 * Create a new Arduino sketch in the workspace root.
 * Prompts for sketch name and runs `arduino-cli sketch new <path>`.
 */
async function commandSketchNew() {
  if (!(await ensureCliReady())) return;
  const wf = await getRelevantWorkspaceFolder();
  if (!wf) return;
  const name = await vscode.window.showInputBox({ prompt: t('enterSketchName') });
  if (!name) return;
  const sketchPath = path.join(wf.uri.fsPath, name.trim());
  const channel = getOutput();
  channel.appendLine(t('sketchCreateStart', { path: sketchPath }));
  try {
    await runCli(['sketch', 'new', sketchPath], { cwd: wf.uri.fsPath, forceSpawn: true });
    vscode.window.showInformationMessage(t('sketchCreateDone', { path: sketchPath }));
    const inoPath = path.join(sketchPath, `${path.basename(sketchPath)}.ino`);
    try {
      const doc = await vscode.workspace.openTextDocument(inoPath);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (_) { /* ignore inability to open ino */ }
    try {
      await commandOpenSketchYamlHelper({ sketchDir: sketchPath });
    } catch (_) { /* ignore helper launch failure */ }
  } catch (e) {
    showError(e);
  }
}

/**
 * Compile the current sketch directory.
 * Prefers sketch.yaml profiles when available; otherwise uses FQBN.
 * While compiling, parse include paths and update IntelliSense.
 */
async function commandCompile() {
  if (!(await ensureCliReady())) return;
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  const sketchDir = path.dirname(ino);
  const cfg = getConfig();
  const channel = getOutput();

  // Prefer sketch.yaml profile if present
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  let args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  let selectedProfile = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    selectedProfile = await resolveProfileName(yamlInfo);
    if (!selectedProfile) return; // user cancelled
    channel.appendLine(`[compile] Using profile from sketch.yaml: ${selectedProfile}`);
    args.push('--profile', selectedProfile);
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      fqbn = extContext.workspaceState.get(STATE_FQBN, '');
    }
    args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  try {
    const wokwiEnabled = selectedProfile ? isProfileWokwiEnabled(yamlInfo, selectedProfile) : false;
    const opts = selectedProfile ? { profileName: selectedProfile, wokwiEnabled } : undefined;
    // Always use the output channel and update IntelliSense during the build
    await compileWithIntelliSense(sketchDir, args, opts);
  } catch (e) {
    showError(e);
  }
}

/**
 * Manually refresh IntelliSense by invoking a compile that exports
 * compile_commands.json without uploading.
 */
async function commandConfigureIntelliSense() {
  if (!(await ensureCliReady())) return;
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  const sketchDir = path.dirname(ino);
  const cfg = getConfig();

  const yamlInfo = await readSketchYamlInfo(sketchDir);
  const args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  let selectedProfile = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    selectedProfile = await resolveProfileName(yamlInfo);
    if (!selectedProfile) return;
    args.push('--profile', selectedProfile);
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      fqbn = extContext.workspaceState.get(STATE_FQBN, '');
    }
    args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  try {
    const wokwiEnabled = selectedProfile ? isProfileWokwiEnabled(yamlInfo, selectedProfile) : false;
    const opts = selectedProfile ? { profileName: selectedProfile, wokwiEnabled } : undefined;
    await compileWithIntelliSense(sketchDir, args, opts);
  } catch (e) {
    showError(e);
  }
}

/**
 * Upload the current sketch: builds first (with streaming IntelliSense
 * updates), then runs `arduino-cli upload` with profile/FQBN and port.
 */
async function commandUpload() {
  if (!(await ensureCliReady())) return;
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  const sketchDir = path.dirname(ino);
  const cfg = getConfig();
  const channel = getOutput();

  // Require port selection before proceeding (fail fast)
  const currentPort = extContext?.workspaceState.get(STATE_PORT, '') || '';
  if (!currentPort) {
    vscode.window.showErrorMessage(t('portUnsetWarn'));
    return;
  }

  // Prefer sketch.yaml profile if present
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  // Build first before upload
  const compileArgs = ['compile'];
  if (cfg.verbose) compileArgs.push('--verbose');
  let selectedProfile = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    selectedProfile = await resolveProfileName(yamlInfo);
    if (!selectedProfile) return;
    channel.appendLine(`[upload] Using profile from sketch.yaml: ${selectedProfile}`);
    compileArgs.push('--profile', selectedProfile);
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      fqbn = extContext.workspaceState.get(STATE_FQBN, '');
    }
    compileArgs.push('--fqbn', fqbn);
  }
  compileArgs.push(sketchDir);

  // Prepare arguments for upload
  const uploadArgs = ['upload'];
  if (cfg.verbose) uploadArgs.push('--verbose');
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = selectedProfile || yamlInfo.lastResolved || await resolveProfileName(yamlInfo);
    if (!profile) return;
    uploadArgs.push('--profile', profile);
    // If a port is already selected, pass it explicitly even when using profile
    const selectedPort = extContext?.workspaceState.get(STATE_PORT, '') || '';
    if (selectedPort) uploadArgs.push('-p', selectedPort);
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    let port = extContext?.workspaceState.get(STATE_PORT, '');
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      fqbn = extContext.workspaceState.get(STATE_FQBN, '');
    }
    if (fqbn) uploadArgs.push('--fqbn', fqbn);
    if (port) uploadArgs.push('-p', port);
  }
  uploadArgs.push(sketchDir);
  try {
    // Update IntelliSense during compile
    const wokwiEnabled = selectedProfile ? isProfileWokwiEnabled(yamlInfo, selectedProfile) : false;
    const compileOpts = selectedProfile ? { profileName: selectedProfile, wokwiEnabled } : undefined;
    await compileWithIntelliSense(sketchDir, compileArgs, compileOpts);

    // If a serial monitor is open, close it before upload to avoid port conflicts
    let reopenMonitorAfter = false;
    if (monitorTerminal) {
      try { monitorTerminal.dispose(); } catch (_) { }
      monitorTerminal = undefined;
      reopenMonitorAfter = true;
    }

    await runCli(uploadArgs, { cwd: sketchDir, forceSpawn: true });

    if (reopenMonitorAfter) {
      // After upload, wait a bit for the port to settle before reopening monitor
      await new Promise((res) => setTimeout(res, 1500));
      await commandMonitor();
    }
  } catch (e) {
    showError(e);
  }
}

/**
 * Build and upload the contents of `data/` as a filesystem image to ESP32.
 * - Uses `arduino-cli compile --show-properties` to locate tool paths, build.path, upload.speed
 * - Parses partitions.csv in build.path to get FS offset/size (spiffs line)
 * - Detects FS type from the selected .ino (SPIFFS.h or LittleFS.h)
 * - Runs mkspiffs/mklittlefs to build an image, then flashes via esptool.
 */
async function commandUploadData() {
  if (!(await ensureCliReady())) return;
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  const sketchDir = path.dirname(ino);
  const channel = getOutput();

  // Ensure data folder exists
  const dataDirUri = vscode.Uri.file(path.join(sketchDir, 'data'));
  const dataExists = await pathExists(dataDirUri);
  if (!dataExists) {
    vscode.window.showErrorMessage('data folder not found in sketch directory.');
    return;
  }

  // Determine FS type from the main .ino
  let fsType = '';
  try {
    const inoText = await readTextFile(vscode.Uri.file(ino));
    if (/\bLittleFS\s*\.h\b|#include\s*[<\"]LittleFS\.h[>\"]/i.test(inoText)) fsType = 'LittleFS';
    else if (/\bSPIFFS\s*\.h\b|#include\s*[<\"]SPIFFS\.h[>\"]/i.test(inoText)) fsType = 'SPIFFS';
  } catch { }
  if (!fsType) {
    // Fallback: scan for any .ino under sketchDir
    try {
      const moreIno = await vscode.workspace.findFiles(new vscode.RelativePattern(sketchDir, '*.ino'), undefined, 10);
      for (const u of moreIno) {
        const txt = await readTextFile(u);
        if (/\bLittleFS\s*\.h\b|#include\s*[<\"]LittleFS\.h[>\"]/i.test(txt)) { fsType = 'LittleFS'; break; }
        if (/\bSPIFFS\s*\.h\b|#include\s*[<\"]SPIFFS\.h[>\"]/i.test(txt)) { fsType = 'SPIFFS'; break; }
      }
    } catch { }
  }
  if (!fsType) {
    vscode.window.showErrorMessage('Could not detect filesystem: include SPIFFS.h or LittleFS.h in the sketch.');
    return;
  }

  // Build arduino-cli compile --show-properties
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const propsArgs = [...baseArgs, 'compile'];
  if (cfg.verbose) propsArgs.push('--verbose');

  let usingProfile = false;
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = await resolveProfileName(yamlInfo);
    if (!profile) return;
    usingProfile = true;
    propsArgs.push('--profile', profile);
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      fqbn = extContext.workspaceState.get(STATE_FQBN, '');
    }
    propsArgs.push('--fqbn', fqbn);
  }
  propsArgs.push('--show-properties');
  propsArgs.push(sketchDir);

  channel.show();
  channel.appendLine(`${ANSI.cyan}[upload-data] Detecting tool paths via --show-properties${ANSI.reset}`);

  // Run and capture stdout only
  let propsText = '';
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(exe, propsArgs, { shell: false, cwd: sketchDir });
      child.stdout.on('data', d => { propsText += d.toString(); });
      child.stderr.on('data', d => channel.append(d.toString()));
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`show-properties exit ${code}`)));
    });
  } catch (e) {
    showError(e);
    return;
  }

  // Parse key=value lines
  const props = {};
  for (const line of String(propsText).split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) props[k] = v;
    }
  }

  const buildPath = props['build.path'] || '';
  if (!buildPath) {
    vscode.window.showErrorMessage('build.path not found in show-properties output.');
    return;
  }
  const partPath = path.join(buildPath, 'partitions.csv');
  let offset = '';
  let size = '';
  try {
    const csv = await readTextFile(vscode.Uri.file(partPath));
    for (const raw of csv.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      // Expect a line like: spiffs,   data, spiffs,  0x310000,0xE0000,
      const cols = line.split(',').map(s => s.trim());
      if (cols.length >= 5 && /^spiffs$/i.test(cols[0])) {
        // cols[3] offset, cols[4] size
        offset = cols[3];
        size = cols[4];
        break;
      }
    }
  } catch (e) {
    showError(new Error(`Failed to read partitions.csv: ${e.message}`));
    return;
  }
  if (!offset || !size) {
    vscode.window.showErrorMessage('SPIFFS partition not found in partitions.csv');
    return;
  }

  // Locate FS builder tool
  let toolBase = '';
  let toolName = '';
  if (fsType === 'SPIFFS') {
    toolBase = props['runtime.tools.mkspiffs.path'] || '';
    toolName = 'mkspiffs';
  } else {
    toolBase = props['runtime.tools.mklittlefs.path'] || '';
    toolName = 'mklittlefs';
  }
  if (!toolBase) {
    vscode.window.showErrorMessage(`Tool path not found for ${fsType} (runtime.tools.*.path)`);
    return;
  }
  const fsExe = await resolveExecutable(toolBase, toolName);
  if (!fsExe) {
    vscode.window.showErrorMessage(`Executable not found: ${toolName} under ${toolBase}`);
    return;
  }

  // Build image
  const outBin = path.join(buildPath, fsType.toLowerCase() + '.bin');
  channel.appendLine(`${ANSI.cyan}[upload-data] Building ${fsType} image (${size}) -> ${outBin}${ANSI.reset}`);
  try {
    await runExternal(fsExe, ['-s', size, '-c', 'data', outBin], { cwd: sketchDir });
  } catch (e) {
    showError(new Error(`Failed to build ${fsType} image: ${e.message}`));
    return;
  }

  // Locate esptool and port/speed
  const esptoolBase = props['runtime.tools.esptool_py.path'] || '';
  if (!esptoolBase) {
    vscode.window.showErrorMessage('esptool path not found (runtime.tools.esptool_py.path)');
    return;
  }
  const esptoolExe = await resolveExecutable(esptoolBase, 'esptool');
  if (!esptoolExe) {
    vscode.window.showErrorMessage(`Executable not found: esptool under ${esptoolBase}`);
    return;
  }
  let port = extContext?.workspaceState.get(STATE_PORT, '') || '';
  if (!port) {
    const set = await commandSetPort(true);
    if (!set) return;
    port = extContext.workspaceState.get(STATE_PORT, '') || '';
  }
  const speed = props['upload.speed'] || '115200';

  // If a serial monitor is open, close it before flashing to avoid port conflicts
  let reopenMonitorAfter = false;
  if (monitorTerminal) {
    try { monitorTerminal.dispose(); } catch (_) { }
    monitorTerminal = undefined;
    reopenMonitorAfter = true;
  }
  // Wait a bit to ensure the serial port is fully released (Windows needs time)
  await new Promise((res) => setTimeout(res, 1200));

  channel.appendLine(`${ANSI.cyan}[upload-data] Flashing at ${offset} over ${port} (${speed} baud)${ANSI.reset}`);
  try {
    await runExternal(esptoolExe, ['-p', port, '-b', String(speed), 'write_flash', offset, outBin], { cwd: sketchDir });
    vscode.window.showInformationMessage(`Uploaded ${fsType} image to ${port} at ${offset}`);
    if (reopenMonitorAfter) {
      await new Promise((res) => setTimeout(res, 1500));
      await commandMonitor();
    }
  } catch (e) {
    showError(new Error(`esptool failed: ${e.message}`));
  }
}

/** Resolve an executable by trying plain name and platform-specific extensions under a base directory. */
async function resolveExecutable(baseDir, name) {
  const candidates = [];
  const base = String(baseDir || '').replace(/[\\/]+$/, '');
  const join = (n) => path.join(base, n);
  if (process.platform === 'win32') {
    candidates.push(join(name + '.exe'));
  }
  candidates.push(join(name));
  // Also try in a bin/ subdir
  if (process.platform === 'win32') candidates.push(join(path.join('bin', name + '.exe')));
  candidates.push(join(path.join('bin', name)));
  for (const p of candidates) {
    try { if (await pathExists(vscode.Uri.file(p))) return p; } catch { }
  }
  return '';
}

/** Spawn an external tool, streaming output to the log terminal. */
async function runExternal(exe, args, opts = {}) {
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  channel.appendLine(`${ANSI.cyan}$ ${displayExe} ${args.map(quoteArg).join(' ')}${ANSI.reset}`);
  if (opts.cwd) channel.appendLine(`${ANSI.dim}(cwd: ${opts.cwd})${ANSI.reset}`);
  await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { shell: false, cwd: opts.cwd || undefined });
    child.stdout.on('data', d => channel.append(d.toString()));
    child.stderr.on('data', d => channel.append(d.toString()));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
}

// Run compile and update IntelliSense by exporting compile_commands.json.
async function compileWithIntelliSense(sketchDir, args, opts = {}) {
  const { profileName = '', wokwiEnabled = false } = opts || {};
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const originalArgs = Array.isArray(args) ? args.slice() : [];
  if (originalArgs.length === 0 || originalArgs[0] !== 'compile') {
    originalArgs.unshift('compile');
  }
  if (!originalArgs.includes(sketchDir)) {
    originalArgs.push(sketchDir);
  }
  const normalizedWarnings = typeof cfg.warnings === 'string' ? cfg.warnings.toLowerCase() : '';
  const warningsLevel = VALID_WARNING_LEVELS.has(normalizedWarnings) ? normalizedWarnings : '';
  const workspaceWarningsOnly = warningsLevel === 'workspace';
  const warningsArg = workspaceWarningsOnly ? 'all' : warningsLevel;
  if (warningsArg && !containsWarningsFlag(baseArgs) && !containsWarningsFlag(originalArgs)) {
    const sketchIdx = originalArgs.lastIndexOf(sketchDir);
    const insertIdx = sketchIdx >= 0 ? sketchIdx : originalArgs.length;
    originalArgs.splice(insertIdx, 0, '--warnings', warningsArg);
  }

  const compileArgs = originalArgs.slice();
  const sketchIdx = compileArgs.lastIndexOf(sketchDir);

  const finalArgs = [...baseArgs, ...compileArgs];
  if (compileDiagnostics) {
    try { compileDiagnostics.clear(); } catch (_) { }
  }
  const term = getAnsiLogTerminal();
  term.terminal.show(true);
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  term.write(`${ANSI.cyan}$ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}\r\n`);
  term.write(`${ANSI.dim}(cwd: ${sketchDir})${ANSI.reset}\r\n`);

  const channel = getOutput();
  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, { cwd: sketchDir, shell: false });
    let stderrBuffer = '';
    const forward = (chunk) => {
      const raw = chunk.toString();
      term.write(raw.replace(/\r?\n/g, '\r\n'));
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', (chunk) => {
      const raw = chunk.toString();
      stderrBuffer += raw;
      forward(chunk);
    });
    child.on('error', (err) => {
      channel.appendLine(`[error] ${err.message}`);
      reject(err);
    });
    child.on('close', async (code) => {
      term.write(`\r\n${ANSI.bold}${(code === 0 ? ANSI.green : ANSI.red)}[exit ${code}]${ANSI.reset}\r\n`);
      let diagSummary = { files: 0, diagnostics: 0 };
      try {
        const result = updateCompileDiagnosticsFromStderr(stderrBuffer, {
          cwd: sketchDir,
          skipWarningsOutsideWorkspace: workspaceWarningsOnly,
          allowOutsideDiagnostics: !workspaceWarningsOnly
        });
        if (result && typeof result === 'object') {
          diagSummary = result;
        }
      } catch (err) {
        channel.appendLine(`[warn] Failed to parse diagnostics: ${err.message}`);
      }
      if (diagSummary.diagnostics > 0) {
        try {
          await vscode.commands.executeCommand('workbench.actions.view.problems');
        } catch (_) { }
      }
      if (code !== 0) {
        reject(new Error(`arduino-cli exited with code ${code}`));
        return;
      }
      try {
        await ensureCompileCommandsSetting(sketchDir);
        const buildPath = await detectBuildPathForCompile(exe, baseArgs, originalArgs, sketchDir);
        if (!buildPath) {
          channel.appendLine(t('compileCommandsBuildPathMissing'));
        } else {
          const count = await updateCompileCommandsFromBuild(sketchDir, buildPath);
          if (count > 0) {
            channel.appendLine(t('compileCommandsUpdated', { count }));
          } else if (count === 0) {
            channel.appendLine(t('compileCommandsNoInoEntries'));
          }
          if (wokwiEnabled && profileName) {
            try {
              await handleWokwiArtifacts(sketchDir, profileName, buildPath);
            } catch (err) {
              channel.appendLine(`[warn] ${err.message}`);
            }
          }
        }
      } catch (err) {
        channel.appendLine(`[warn] ${err.message}`);
      }
      resolve({ code });
    });
  });
}

async function detectBuildPathForCompile(exe, baseArgs, args, sketchDir) {
  const derivedArgs = Array.isArray(args) ? args.slice() : [];
  if (derivedArgs.length === 0 || derivedArgs[0] !== 'compile') {
    derivedArgs.unshift('compile');
  }
  if (!derivedArgs.includes(sketchDir)) {
    derivedArgs.push(sketchDir);
  }
  if (!derivedArgs.includes('--show-properties')) {
    const idx = derivedArgs.lastIndexOf(sketchDir);
    const insertIdx = idx >= 0 ? idx : derivedArgs.length;
    derivedArgs.splice(insertIdx, 0, '--show-properties');
  }
  const skipFlags = new Set(['--export-compile-commands', '--clean']);
  const cleanedArgs = derivedArgs.filter((arg) => !skipFlags.has(arg));
  const finalArgs = [...baseArgs, ...cleanedArgs];
  let stdout = '';
  let stderr = '';
  await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, { cwd: sketchDir, shell: false });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`show-properties exit ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      if (key === 'build.path') {
        return line.slice(idx + 1).trim();
      }
    }
  }
  return '';
}

async function ensureCompileCommandsSetting(sketchDir) {
  try {
    const sketchUri = vscode.Uri.file(sketchDir);
    const folder = vscode.workspace.getWorkspaceFolder(sketchUri);
    const target = folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
    const config = vscode.workspace.getConfiguration(undefined, folder ? folder.uri : sketchUri);
    const current = config.get('C_Cpp.default.compileCommands');
    if (current === '.vscode/compile_commands.json') return false;
    await config.update('C_Cpp.default.compileCommands', '.vscode/compile_commands.json', target);
    return true;
  } catch (err) {
    const channel = getOutput();
    channel.appendLine(`[warn] Failed to update settings: ${err.message}`);
    return false;
  }
}

function updateCompileDiagnosticsFromStderr(stderrText, options = {}) {
  if (!compileDiagnostics) {
    return { files: 0, diagnostics: 0 };
  }
  const diagnosticsByFile = parseCompilerDiagnostics(stderrText, options);
  compileDiagnostics.clear();
  let fileCount = 0;
  let totalDiagnostics = 0;
  for (const [fsPath, entries] of diagnosticsByFile.entries()) {
    if (!entries || entries.length === 0) continue;
    try {
      const uri = vscode.Uri.file(fsPath);
      compileDiagnostics.set(uri, entries);
      fileCount += 1;
      totalDiagnostics += entries.length;
    } catch (_) { }
  }
  return { files: fileCount, diagnostics: totalDiagnostics };
}

function parseCompilerDiagnostics(stderrText, options = {}) {
  const {
    cwd = '',
    skipWarningsOutsideWorkspace = false,
    allowOutsideDiagnostics = false,
  } = options;
  const normalized = String(stderrText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const diagPattern = /:(\d+)(?::(\d+))?:\s+(fatal error|error|warning|note):\s+/i;
  /** @type {Map<string, vscode.Diagnostic[]>} */
  const result = new Map();
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const match = diagPattern.exec(line);
    if (!match) continue;
    const filePart = line.slice(0, match.index).trim();
    if (!filePart) continue;
    if (/^In file included from\s/i.test(filePart) || /^from\s/i.test(filePart)) continue;
    let lineNum = Number.parseInt(match[1], 10);
    if (!Number.isFinite(lineNum) || lineNum < 1) lineNum = 1;
    let colNum = Number.parseInt(match[2], 10);
    if (!Number.isFinite(colNum) || colNum < 1) colNum = 1;
    const severityLabel = match[3].toLowerCase();
    if (severityLabel === 'note') continue;
    const message = line.slice(match.index + match[0].length).trim();
    if (!message) continue;
    const resolvedPath = normalizeCompilerDiagnosticPath(filePart, cwd);
    if (!resolvedPath) continue;
    let severity = vscode.DiagnosticSeverity.Warning;
    if (severityLabel.includes('error')) {
      severity = vscode.DiagnosticSeverity.Error;
    }
    const isWarning = severity === vscode.DiagnosticSeverity.Warning;
    const isWorkspace = isWorkspaceFile(resolvedPath);
    if (!isWorkspace) {
      if (isWarning && skipWarningsOutsideWorkspace) {
        continue;
      }
      if (!allowOutsideDiagnostics) {
        continue;
      }
    }
    const position = new vscode.Position(Math.max(0, lineNum - 1), Math.max(0, colNum - 1));
    const range = new vscode.Range(position, position);
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'arduino-cli';
    const warnCode = extractWarningCodeFromMessage(message);
    if (warnCode) diagnostic.code = warnCode;
    if (result.has(resolvedPath)) {
      result.get(resolvedPath).push(diagnostic);
    } else {
      result.set(resolvedPath, [diagnostic]);
    }
  }
  return result;
}

function normalizeCompilerDiagnosticPath(rawPath, cwd) {
  if (!rawPath) return '';
  let value = String(rawPath).trim();
  value = value.replace(/^['"]+|['"]+$/g, '');
  if (!value) return '';
  try {
    if (/^[A-Za-z]:$/.test(value)) return '';
    const resolved = path.isAbsolute(value)
      ? value
      : (cwd ? path.resolve(cwd, value) : path.resolve(value));
    return path.normalize(resolved);
  } catch (_) {
    return '';
  }
}

function extractWarningCodeFromMessage(message) {
  if (!message) return undefined;
  const match = message.match(/\[-W([^\]]+)\]/i);
  if (!match) return undefined;
  return match[1];
}

// Expand GCC -iprefix/-iwithprefixbefore arguments into -I entries for IntelliSense.
const ARGUMENT_TOKEN_PATTERN = /(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'\r\n]+)/g;

function stripArgumentQuotes(token) {
  if (typeof token !== 'string') return '';
  const len = token.length;
  if (len >= 2) {
    const first = token[0];
    const last = token[len - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      let inner = token.slice(1, -1);
      if (first === '"') inner = inner.replace(/\\"/g, '"');
      if (first === '\'') inner = inner.replace(/\\'/g, '\'');
      return inner;
    }
  }
  return token;
}

function joinIprefixPath(prefix, suffix) {
  if (!prefix) return suffix || '';
  if (!suffix) return prefix;
  if (suffix.startsWith('/') || suffix.startsWith('\\')) return prefix + suffix;
  const last = prefix[prefix.length - 1];
  if (last === '/' || last === '\\') return prefix + suffix;
  const sep = prefix.includes('\\') && !prefix.includes('/') ? '\\' : '/';
  return `${prefix}${sep}${suffix}`;
}

function needsCommandQuoting(token) {
  return token === '' || /[\s"]/.test(token);
}

function quoteCommandToken(token) {
  if (token === '') return '""';
  if (!needsCommandQuoting(token)) return token;
  return '"' + token.replace(/(["\\])/g, '\\$1') + '"';
}

function stringifyCommandTokens(tokens) {
  return tokens.map(quoteCommandToken).join(' ');
}

function ensureArduinoIncludeDirective(tokens) {
  if (!Array.isArray(tokens)) return tokens;
  let found = false;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-include') {
      const next = tokens[i + 1] || '';
      if (next === 'Arduino.h' || stripArgumentQuotes(next) === 'Arduino.h') {
        found = true;
        break;
      }
    }
  }
  if (!found) {
    const insertAt = tokens.length > 0 ? 1 : 0;
    tokens.splice(insertAt, 0, '-include', 'Arduino.h');
  }
  return tokens;
}

function resolveCompileCommandsOutput(sketchDir) {
  const sketchUri = vscode.Uri.file(sketchDir);
  const folder = vscode.workspace.getWorkspaceFolder(sketchUri);
  const root = folder ? folder.uri.fsPath : sketchDir;
  const vscodeDir = path.join(root, '.vscode');
  return {
    root,
    vscodeDir,
    destPath: path.join(vscodeDir, 'compile_commands.json'),
    destUri: vscode.Uri.file(path.join(vscodeDir, 'compile_commands.json')),
  };
}

async function readResponseFileArgs(ref, baseDir) {
  let target = typeof ref === 'string' ? ref : '';
  if (!target) return [];
  if (target.startsWith('@')) target = target.slice(1);
  target = stripArgumentQuotes(target);
  if (!target) return [];
  let resolved = target;
  try {
    if (baseDir && !path.isAbsolute(resolved)) {
      resolved = path.resolve(baseDir, resolved);
    }
  } catch { }
  try {
    const uri = vscode.Uri.file(resolved);
    const content = await readTextFile(uri);
    const matches = content.match(ARGUMENT_TOKEN_PATTERN);
    if (!matches) return [];
    return matches.map(stripArgumentQuotes);
  } catch {
    return [];
  }
}

async function expandIprefixInTokens(tokens, baseDir) {
  if (!Array.isArray(tokens) || tokens.length === 0) return tokens || [];
  const out = tokens.map((tok) => {
    if (typeof tok === 'string') return tok;
    if (tok === undefined || tok === null) return '';
    return String(tok);
  });
  const iprefixKey = '-iprefix';
  const iwithKey = '-iwithprefixbefore';
  for (let i = 0; i < out.length;) {
    const current = out[i];
    if (typeof current !== 'string') { out[i] = String(current || ''); continue; }
    let prefix = '';
    let consume = 0;
    if (current === iprefixKey) {
      prefix = stripArgumentQuotes(out[i + 1] || '');
      consume = 2;
    } else if (current.startsWith(iprefixKey)) {
      prefix = stripArgumentQuotes(current.slice(iprefixKey.length));
      if (prefix.startsWith('=')) prefix = prefix.slice(1);
      consume = 1;
    }
    if (consume === 0) { i++; continue; }
    out.splice(i, consume);
    if (!prefix) continue;
    let scan = i;
    while (scan < out.length) {
      let tok = out[scan];
      if (typeof tok !== 'string') {
        tok = String(tok || '');
        out[scan] = tok;
      }
      if (tok.startsWith('@')) {
        const resp = await readResponseFileArgs(tok, baseDir);
        if (resp.length > 0) {
          out.splice(scan, 1, ...resp);
          continue;
        }
        out.splice(scan, 1);
        continue;
      }
      if (tok === iwithKey) {
        const next = out[scan + 1];
        const suffix = stripArgumentQuotes(next || '');
        const removeCount = next === undefined ? 1 : 2;
        out.splice(scan, removeCount);
        if (suffix) {
          out.splice(scan, 0, `-I${joinIprefixPath(prefix, suffix)}`);
          scan++;
        }
        continue;
      }
      if (tok.startsWith(iwithKey)) {
        let suffix = stripArgumentQuotes(tok.slice(iwithKey.length));
        if (suffix.startsWith('=')) suffix = suffix.slice(1);
        out.splice(scan, 1);
        if (suffix) {
          out.splice(scan, 0, `-I${joinIprefixPath(prefix, suffix)}`);
          scan++;
        }
        continue;
      }
      break;
    }
  }
  return out;
}

async function normalizeCompileCommandEntry(entry) {
  if (!entry || typeof entry !== 'object') return;
  const baseDir = typeof entry.directory === 'string' ? entry.directory : '';
  const hasArguments = Array.isArray(entry.arguments);
  const hasCommand = typeof entry.command === 'string' && entry.command.trim().length > 0;
  let tokens = [];
  if (hasArguments) {
    tokens = entry.arguments.map((tok) => (typeof tok === 'string' ? tok : (tok === undefined || tok === null) ? '' : String(tok)));
  } else if (hasCommand) {
    const matches = entry.command.match(ARGUMENT_TOKEN_PATTERN);
    if (matches) tokens = matches.map(stripArgumentQuotes);
  }
  if (tokens.length === 0) return;
  const expanded = await expandIprefixInTokens(tokens, baseDir);
  ensureArduinoIncludeDirective(expanded);
  if (hasArguments) entry.arguments = expanded;
  if (hasCommand) {
    entry.command = stringifyCommandTokens(expanded);
  } else if (!hasArguments) {
    entry.command = stringifyCommandTokens(expanded);
  }
}

async function updateCompileCommandsFromBuild(sketchDir, buildPath) {
  try {
    const sourcePath = path.join(buildPath, 'compile_commands.json');
    const sourceUri = vscode.Uri.file(sourcePath);
    const sourceExists = await pathExists(sourceUri);
    if (!sourceExists) {
      getOutput().appendLine(t('compileCommandsSourceMissing', { path: sourcePath }));
      return -1;
    }
    let parsed;
    try {
      const raw = await readTextFile(sourceUri);
      parsed = JSON.parse(raw);
    } catch (err) {
      getOutput().appendLine(t('compileCommandsParseError', { msg: err.message }));
      return -1;
    }
    if (!Array.isArray(parsed)) {
      getOutput().appendLine(t('compileCommandsInvalidFormat'));
      return -1;
    }
    const filtered = [];
    let workspaceInoMapPromise;
    const getWorkspaceInoMap = async () => {
      if (!workspaceInoMapPromise) {
        workspaceInoMapPromise = (async () => {
          const map = new Map();
          try {
            const files = await vscode.workspace.findFiles('**/*.ino');
            for (const uri of files) {
              try {
                const fsPath = path.normalize(uri.fsPath);
                const base = path.basename(fsPath).toLowerCase();
                if (!map.has(base)) {
                  map.set(base, fsPath);
                }
              } catch (_) { }
            }
          } catch (_) { }
          return map;
        })();
      }
      return workspaceInoMapPromise;
    };
    const resolveWorkspaceIno = async (inoName) => {
      if (!inoName) return '';
      try {
        const map = await getWorkspaceInoMap();
        return map.get(inoName.toLowerCase()) || '';
      } catch (_) {
        return '';
      }
    };
    const normalizeForCompare = (p) => path.normalize(p || '').replace(/\\+/g, '/').toLowerCase();
    const buildRootNorm = buildPath ? normalizeForCompare(buildPath) : '';
    const buildRootWithSep = buildRootNorm && !buildRootNorm.endsWith('/') ? `${buildRootNorm}/` : buildRootNorm;

    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const fileValue = typeof entry.file === 'string' ? entry.file : '';
      if (!fileValue) continue;
      const dirValue = typeof entry.directory === 'string' ? entry.directory : '';
      let absFile = '';
      try {
        if (path.isAbsolute(fileValue)) absFile = path.normalize(fileValue);
        else if (dirValue) absFile = path.normalize(path.resolve(dirValue, fileValue));
        else absFile = path.normalize(path.resolve(fileValue));
      } catch {
        absFile = '';
      }

      const normalizedFile = absFile || (path.isAbsolute(fileValue) ? path.normalize(fileValue) : '');
      const compareFile = normalizedFile ? normalizeForCompare(normalizedFile) : '';
      const workspaceFile = normalizedFile ? isWorkspaceFile(normalizedFile) : false;
      const inBuildPath = buildRootNorm && compareFile
        ? (compareFile === buildRootNorm || (buildRootWithSep && compareFile.startsWith(buildRootWithSep)))
        : false;

      if (!workspaceFile && !inBuildPath) continue;

      let targetFile = normalizedFile || path.normalize(fileValue);
      if (!targetFile) continue;
      if (/\.ino\.cpp$/i.test(targetFile)) {
        const resolved = await resolveWorkspaceIno(path.basename(targetFile).replace(/\.cpp$/i, ''));
        if (!resolved) continue;
        targetFile = path.normalize(resolved);
      }
      const clone = JSON.parse(JSON.stringify(entry));
      await normalizeCompileCommandEntry(clone);
      const outputFile = path.basename(targetFile) || path.basename(fileValue);
      if (!outputFile) continue;
      clone.file = outputFile;
      filtered.push(clone);
    }
    if (filtered.length === 0) {
      return 0;
    }

    const outputInfo = resolveCompileCommandsOutput(sketchDir);
    const vscodeDirUri = vscode.Uri.file(outputInfo.vscodeDir);
    try { await vscode.workspace.fs.createDirectory(vscodeDirUri); } catch { }
    const destUri = outputInfo.destUri;

    let existing = [];
    if (await pathExists(destUri)) {
      try {
        const raw = await readTextFile(destUri);
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) existing = arr;
      } catch {
        existing = [];
      }
    }

    const result = [];
    const indexByKey = new Map();
    const makeKey = (entry) => {
      const dir = typeof entry.directory === 'string' ? entry.directory : '';
      const file = typeof entry.file === 'string' ? entry.file : '';
      const normDir = dir ? path.normalize(dir) : '';
      const normFile = file ? path.normalize(file) : '';
      return `${normDir}||${normFile}`;
    };
    const pushEntry = (entry, overwrite = true) => {
      const key = makeKey(entry);
      if (!key) return;
      if (indexByKey.has(key)) {
        if (overwrite) {
          result[indexByKey.get(key)] = entry;
        }
      } else {
        indexByKey.set(key, result.length);
        result.push(entry);
      }
    };

    for (const entry of filtered) {
      pushEntry(entry, true);
    }

    for (const entry of existing) {
      if (!entry || typeof entry !== 'object') continue;
      const fileValue = typeof entry.file === 'string' ? entry.file : '';
      if (!fileValue) continue;
      const dirValue = typeof entry.directory === 'string' ? entry.directory : '';
      let absFile = '';
      try {
        if (path.isAbsolute(fileValue)) absFile = path.normalize(fileValue);
        else if (dirValue) absFile = path.normalize(path.resolve(dirValue, fileValue));
        else absFile = path.normalize(path.resolve(fileValue));
      } catch {
        absFile = '';
      }
      const normalizedFile = absFile || (path.isAbsolute(fileValue) ? path.normalize(fileValue) : path.normalize(fileValue));
      let workspaceFile = absFile ? isWorkspaceFile(absFile) : false;
      const isBareIno = /\.ino$/i.test(normalizedFile);
      const isInoCpp = /\.ino\.cpp$/i.test(normalizedFile);

      if (!workspaceFile && isBareIno) {
        const resolved = await resolveWorkspaceIno(path.basename(normalizedFile));
        if (!resolved) continue;
        absFile = resolved;
        workspaceFile = true;
      }

      if (!workspaceFile && isInoCpp) {
        const resolved = await resolveWorkspaceIno(path.basename(normalizedFile).replace(/\.cpp$/i, ''));
        if (!resolved) continue;
        absFile = resolved;
        workspaceFile = true;
      }

      if (!workspaceFile) continue;

      const clone = JSON.parse(JSON.stringify(entry));
      if (absFile) clone.file = absFile;
      await normalizeCompileCommandEntry(clone);
      const outputFile = path.basename(absFile || normalizedFile) || path.basename(fileValue);
      if (!outputFile) continue;
      clone.file = outputFile;
      pushEntry(clone, false);
    }

    await writeTextFile(destUri, JSON.stringify(result, null, 2) + '\n');
    return filtered.length;
  } catch (err) {
    getOutput().appendLine(`[warn] ${err.message}`);
    return -1;
  }
}

async function findElfArtifact(buildPath) {
  if (!buildPath) return '';
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(buildPath));
    const elfNames = [];
    for (const [name, kind] of entries) {
      if (kind === vscode.FileType.File && name.toLowerCase().endsWith('.elf')) {
        elfNames.push(name);
      }
    }
    if (elfNames.length === 0) return '';
    const preferred = elfNames.find((name) => /\.ino\.elf$/i.test(name))
      || elfNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))[0];
    return path.join(buildPath, preferred);
  } catch {
    return '';
  }
}

async function ensureWokwiDefaults(baseDirPath, profileName) {
  const baseUri = vscode.Uri.file(baseDirPath);
  try { await vscode.workspace.fs.createDirectory(baseUri); } catch { }
  const channel = getOutput();
  const diagramUri = vscode.Uri.file(path.join(baseDirPath, 'diagram.json'));
  if (!(await pathExists(diagramUri))) {
    await writeTextFile(diagramUri, DEFAULT_WOKWI_DIAGRAM);
    channel.appendLine(t('wokwiDiagramCreated', { profile: profileName }));
  }
  const tomlUri = vscode.Uri.file(path.join(baseDirPath, 'wokwi.toml'));
  if (!(await pathExists(tomlUri))) {
    await writeTextFile(tomlUri, DEFAULT_WOKWI_TOML);
    channel.appendLine(t('wokwiTomlCreated', { profile: profileName }));
  }
  return { diagramUri, tomlUri };
}

function collectWokwiViewTypesFromExtension(extension, pushCandidate) {
  if (!extension || typeof pushCandidate !== 'function') return;
  const contributes = extension.packageJSON && extension.packageJSON.contributes;
  const editors = contributes && contributes.customEditors;
  if (!Array.isArray(editors)) return;
  for (const editor of editors) {
    if (!editor || typeof editor !== 'object') continue;
    const viewType = typeof editor.viewType === 'string' ? editor.viewType : '';
    if (!viewType) continue;
    if (viewType.toLowerCase().includes('wokwi')) pushCandidate(viewType);
  }
}

async function openDiagramInWokwi(diagramUri, openOptions) {
  const channel = getOutput();
  const candidates = [];
  const pushCandidate = (viewType) => {
    if (!viewType || typeof viewType !== 'string') return;
    if (!candidates.includes(viewType)) candidates.push(viewType);
  };

  try {
    for (const extId of WOKWI_EXTENSION_IDS) {
      const extension = vscode.extensions.getExtension(extId);
      if (!extension) continue;
      try {
        if (!extension.isActive) {
          await extension.activate();
        }
      } catch (activateErr) {
        const message = activateErr && activateErr.message ? activateErr.message : String(activateErr || 'unknown error');
        channel.appendLine(`[warn] Failed to activate extension ${extId}: ${message}`);
      }
      collectWokwiViewTypesFromExtension(extension, pushCandidate);
    }

    for (const extension of vscode.extensions.all) {
      collectWokwiViewTypesFromExtension(extension, pushCandidate);
    }

    for (const viewType of WOKWI_VIEW_TYPES) pushCandidate(viewType);

    const failures = [];
    for (const viewType of candidates) {
      try {
        await vscode.commands.executeCommand('vscode.openWith', diagramUri, viewType, openOptions);
        return true;
      } catch (err) {
        const message = err && err.message ? err.message : String(err || 'unknown error');
        failures.push(`${viewType}: ${message}`);
      }
    }

    if (failures.length > 0) {
      channel.appendLine(`[warn] Failed to open diagram with Wokwi editor candidates (${failures.join('; ')}).`);
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err || 'unknown error');
    channel.appendLine(`[warn] Unexpected error when opening diagram with Wokwi editor: ${message}`);
  }

  return false;
}

async function handleWokwiArtifacts(sketchDir, profileName, buildPath) {
  if (!sketchDir || !profileName || !buildPath) return;
  const channel = getOutput();
  const elfPath = await findElfArtifact(buildPath);
  if (!elfPath) {
    channel.appendLine(t('wokwiElfMissing', { profile: profileName, buildPath }));
    return;
  }
  const folderName = sanitizeProfileFolderName(profileName);
  const wokwiDirPath = path.join(sketchDir, '.wokwi', folderName);
  await ensureWokwiDefaults(wokwiDirPath, profileName);
  const elfUri = vscode.Uri.file(elfPath);
  const destPath = path.join(wokwiDirPath, 'wokwi.elf');
  const destUri = vscode.Uri.file(destPath);
  try {
    const raw = await vscode.workspace.fs.readFile(elfUri);
    await vscode.workspace.fs.writeFile(destUri, raw);
    channel.appendLine(t('wokwiElfCopied', { profile: profileName, dest: destPath }));
  } catch (err) {
    channel.appendLine(`[warn] ${err.message}`);
  }
}

// ESP-IDF include glob augmentation removed per request

/**
 * VS Code entry point: register commands, status bar items,
 * and event listeners. Called once when the extension loads.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  extContext = context;
  setupIncludeOrderLint(context);
  compileDiagnostics = vscode.languages.createDiagnosticCollection('arduinoCliCompile');
  context.subscriptions.push(compileDiagnostics);
  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('arduino-cli.refreshView', () => {
      try { if (arduinoTreeProvider) arduinoTreeProvider.refresh(); } catch (_) { }
    }),
    vscode.commands.registerCommand('arduino-cli.runTreeAction', async (payload) => {
      try {
        if (!payload || typeof payload !== 'object') return;
        const { action, sketchDir, profile } = payload;
        if (action === 'compile') return runCompileFor(sketchDir, profile);
        if (action === 'cleanCompile') {
          if (sketchDir) return runCleanCompileFor(sketchDir, profile);
          return vscode.commands.executeCommand('arduino-cli.cleanCompile');
        }
        if (action === 'upload') return runUploadFor(sketchDir, profile);
        if (action === 'version') return vscode.commands.executeCommand('arduino-cli.version');
        if (action === 'listBoards') return vscode.commands.executeCommand('arduino-cli.listBoards');
        if (action === 'listAllBoards') return vscode.commands.executeCommand('arduino-cli.listAllBoards');
        if (action === 'sketchNew') return vscode.commands.executeCommand('arduino-cli.sketchNew');
        if (action === 'runArbitrary') return vscode.commands.executeCommand('arduino-cli.runArbitrary');
        if (action === 'uploadData') return commandUploadDataFor(sketchDir, profile);
        if (action === 'monitor') return commandMonitor();
        if (action === 'helper') return commandOpenSketchYamlHelper({ sketchDir, profile });
        if (action === 'examples') return commandOpenExamplesBrowser({ sketchDir, profile });
        if (action === 'inspect') return commandOpenInspector({ sketchDir, profile });
        if (action === 'wokwiRun') return commandRunWokwi(sketchDir, profile);
        if (action === 'versionCheck') return vscode.commands.executeCommand('arduino-cli.versionCheck');
        if (action === 'buildCheck') return vscode.commands.executeCommand('arduino-cli.buildCheck');
        if (action === 'refreshView') return vscode.commands.executeCommand('arduino-cli.refreshView');
        if (action === 'setPort') return vscode.commands.executeCommand('arduino-cli.setPort');
        if (action === 'setBaud') return vscode.commands.executeCommand('arduino-cli.setBaud');
        if (action === 'setFqbn') return vscode.commands.executeCommand('arduino-cli.setFqbn');
      } catch (e) { showError(e); }
    }),
    vscode.commands.registerCommand('arduino-cli.sketchNew', commandSketchNew),
    vscode.commands.registerCommand('arduino-cli.expandAll', commandExpandAllTree),
    vscode.commands.registerCommand('arduino-cli.examples', () => commandOpenExamplesBrowser({})),
    vscode.commands.registerCommand('arduino-cli.inspector', () => commandOpenInspector({})),
    vscode.commands.registerCommand('arduino-cli.sketchYamlHelper', commandOpenSketchYamlHelper),
    vscode.commands.registerCommand('arduino-cli.version', commandVersion),
    vscode.commands.registerCommand('arduino-cli.listBoards', commandListBoards),
    vscode.commands.registerCommand('arduino-cli.listAllBoards', commandListAllBoards),
    vscode.commands.registerCommand('arduino-cli.boardDetails', commandBoardDetails),
    vscode.commands.registerCommand('arduino-cli.runArbitrary', commandRunArbitrary),
    vscode.commands.registerCommand('arduino-cli.compile', commandCompile),
    vscode.commands.registerCommand('arduino-cli.configureWarnings', commandConfigureWarnings),
    vscode.commands.registerCommand('arduino-cli.versionCheck', commandVersionCheck),
    vscode.commands.registerCommand('arduino-cli.buildCheck', commandBuildCheck),
    vscode.commands.registerCommand('arduino-cli.cleanCompile', commandCleanCompile),
    vscode.commands.registerCommand('arduino-cli.upload', commandUpload),
    vscode.commands.registerCommand('arduino-cli.monitor', commandMonitor),
    vscode.commands.registerCommand('arduino-cli.setProfile', () => commandSetProfile(false)),
    vscode.commands.registerCommand('arduino-cli.configureIntelliSense', commandConfigureIntelliSense),
    vscode.commands.registerCommand('arduino-cli.setFqbn', () => commandSetFqbn(false)),
    vscode.commands.registerCommand('arduino-cli.setPort', () => commandSetPort(false)),
    vscode.commands.registerCommand('arduino-cli.setBaud', () => commandSetBaud(false)),
    vscode.commands.registerCommand('arduino-cli.uploadData', commandUploadData),
    vscode.commands.registerCommand('arduino-cli.runWokwi', () => commandRunWokwi()),
  );

  // Status bar items
  statusBuild = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBuild.text = '$(tools) Compile';
  statusBuild.tooltip = 'Arduino: Compile Sketch';
  statusBuild.command = 'arduino-cli.compile';

  statusUpload = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusUpload.text = '$(cloud-upload) Upload';
  statusUpload.tooltip = 'Arduino: Upload Sketch';
  statusUpload.command = 'arduino-cli.upload';

  statusMonitor = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  statusMonitor.text = '$(pulse) Monitor';
  statusMonitor.tooltip = 'Arduino: Monitor Serial';
  statusMonitor.command = 'arduino-cli.monitor';

  statusFqbn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  statusFqbn.command = 'arduino-cli.setFqbn';

  statusPort = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  statusPort.command = 'arduino-cli.setPort';

  statusBaud = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
  statusBaud.command = 'arduino-cli.setBaud';

  statusWarnings = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
  statusWarnings.command = 'arduino-cli.configureWarnings';

  context.subscriptions.push(statusBuild, statusUpload, statusMonitor, statusFqbn, statusPort, statusBaud, statusWarnings);
  updateStatusBar();

  vscode.window.onDidChangeActiveTextEditor(updateStatusBar, null, context.subscriptions);
  vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBar, null, context.subscriptions);
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('arduino-cli-wrapper.compileWarnings') || event.affectsConfiguration('arduino-cli-wrapper.verbose')) {
      updateStatusBar();
    }
  }, null, context.subscriptions);
  vscode.window.onDidCloseTerminal((term) => {
    if (monitorTerminal && term === monitorTerminal) {
      monitorTerminal = undefined;
    }
  }, null, context.subscriptions);
}

// Tree View: Arduino CLI Commands per project/profile
let arduinoTreeProvider;
let arduinoTreeView;
class ArduinoCliTreeProvider {
  constructor() {
    /** @type {vscode.EventEmitter<void>} */
    this._em = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._em.event;
    this._stale = true;
    this._roots = [];
  }
  refresh() { this._stale = true; this._em.fire(); }
  /** @param {any} element */
  async getChildren(element) {
    if (!element) {
      // Root: global commands + projects (sketch folders)
      if (this._stale) {
        const sketches = await findSketches();
        this._roots = [
          ...globalCommandItems(),
          ...sketches.map(s => new ProjectItem(s.dir, s.name))
        ];
        this._stale = false;
      }
      return this._roots;
    }
    if (element instanceof ProjectItem) {
      const info = await readSketchYamlInfo(element.dir);
      if (info && info.profiles && info.profiles.length) {
        return info.profiles.map(p => new ProfileItem(element.dir, p, element, isProfileWokwiEnabled(info, p)));
      }
      // No profiles: return commands directly under project
      return defaultCommandItems(element.dir, null, element);
    }
    if (element instanceof ProfileItem) {
      return defaultCommandItems(element.dir, element.profile, element, { wokwiEnabled: !!element.wokwiEnabled });
    }
    return [];
  }
  /** @param {any} element */
  getTreeItem(element) { return element; }
  /** @param {any} element */
  getParent(element) { return element && element.parent ? element.parent : undefined; }
}

class ProjectItem extends vscode.TreeItem {
  constructor(dir, name) {
    super(name || dir, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'project';
    this.tooltip = dir;
    this.dir = dir;
    this.id = `project:${dir}`;
    this.parent = undefined;
  }
}
class ProfileItem extends vscode.TreeItem {
  constructor(dir, profile, parent, wokwiEnabled = false) {
    super(`Profile: ${profile}`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'profile';
    this.tooltip = `${dir} | ${t('treeProfile', { profile })}`;
    this.dir = dir;
    this.profile = profile;
    this.id = `profile:${dir}|${profile}`;
    this.parent = parent;
    this.wokwiEnabled = !!wokwiEnabled;
  }
}
class CommandItem extends vscode.TreeItem {
  constructor(label, action, sketchDir, profile, parent, tooltip) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'command';
    this.tooltip = tooltip || label;
    this.command = {
      command: 'arduino-cli.runTreeAction',
      title: label,
      arguments: [{ action, sketchDir, profile }]
    };
    this.id = `cmd:${action}|${sketchDir}|${profile || ''}|${label}`;
    this.parent = parent;
  }
}

function defaultCommandItems(dir, profile, parent, features = {}) {
  const items = [
    new CommandItem('Compile', 'compile', dir, profile, parent, t('treeCompile')),
    new CommandItem('Clean Compile', 'cleanCompile', dir, profile, parent, t('treeCleanCompile')),
    new CommandItem('Upload', 'upload', dir, profile, parent, t('treeUpload')),
    new CommandItem('Upload Data', 'uploadData', dir, profile, parent, t('treeUploadData')),
    new CommandItem('Monitor', 'monitor', dir, profile, parent, t('treeMonitor')),
    new CommandItem('Sketch.yaml Helper', 'helper', dir, profile, parent, t('treeHelper')),
    new CommandItem('Open Examples', 'examples', dir, profile, parent, t('treeExamples')),
    new CommandItem('Inspect', 'inspect', dir, profile, parent, t('treeInspect')),
  ];
  if (features && features.wokwiEnabled) {
    items.splice(2, 0, new CommandItem('Run in Wokwi', 'wokwiRun', dir, profile, parent, t('treeWokwiRun')));
  }
  return items;
}

// Commands at the root level (not tied to a specific sketch/profile)
function globalCommandItems() {
  return [
    new CommandItem('CLI Version', 'version', '', '', undefined, t('treeCliVersion')),
    new CommandItem('List Boards', 'listBoards', '', '', undefined, t('treeListBoards')),
    new CommandItem('List All Boards', 'listAllBoards', '', '', undefined, t('treeListAllBoards')),
    new CommandItem('Sketch.yaml Helper', 'helper', '', '', undefined, t('treeHelper')),
    new CommandItem('Open Inspector', 'inspect', '', '', undefined, t('treeInspectorOpen')),
    new CommandItem('Sketch.yaml Versions', 'versionCheck', '', '', undefined, t('treeVersionCheck')),
    new CommandItem('Build Check', 'buildCheck', '', '', undefined, t('treeBuildCheck')),
    new CommandItem('Refresh View', 'refreshView', '', '', undefined, t('treeRefresh')),
    new CommandItem('New Sketch', 'sketchNew', '', '', undefined, t('treeNewSketch')),
    new CommandItem('Run Command', 'runArbitrary', '', '', undefined, t('treeRunCommand')),
  ];
}

async function findSketches() {
  /** @type {{dir:string,name:string}[]} */
  const results = [];
  try {
    const uris = await vscode.workspace.findFiles('**/*.ino', '**/{node_modules,.git}/**', 50);
    const seen = new Set();
    for (const u of uris) {
      const dir = path.dirname(u.fsPath);
      if (seen.has(dir)) continue;
      seen.add(dir);
      const base = path.basename(dir);
      let rel = '';
      try {
        const wf = vscode.workspace.getWorkspaceFolder(u);
        if (wf && wf.uri && wf.uri.fsPath) {
          rel = path.relative(wf.uri.fsPath, dir);
        }
      } catch (_) { }
      let display = base;
      if (rel && rel !== '.') {
        display = rel;
      }
      const depth = (rel && rel !== '.') ? rel.split(/[\\\/]+/).length : 0;
      results.push({ dir, name: display, depth });
    }
    // Sort: shallower hierarchy first, then by name (case-insensitive)
    results.sort((a, b) => {
      const d = (a.depth || 0) - (b.depth || 0);
      if (d !== 0) return d;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
  } catch (_) { }
  return results;
}

async function findSketchYamlEntries() {
  const outputs = [];
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return outputs;
  const seen = new Set();
  for (const folder of folders) {
    if (!folder || !folder.uri) continue;
    const pattern = new vscode.RelativePattern(folder, '**/sketch.yaml');
    let matches = [];
    try {
      matches = await vscode.workspace.findFiles(pattern);
    } catch (_) {
      matches = [];
    }
    for (const uri of matches) {
      const sketchDir = path.dirname(uri.fsPath);
      if (!sketchDir || seen.has(sketchDir)) continue;
      seen.add(sketchDir);
      outputs.push({ sketchDir, uri, folder });
    }
  }
  return outputs;
}

// Run helpers for explicit profile
async function runCompileFor(sketchDir, profile) {
  if (!(await ensureCliReady())) return;
  const cfg = getConfig();
  const args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  let wokwiEnabled = false;
  if (profile) {
    args.push('--profile', profile);
    try {
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      wokwiEnabled = isProfileWokwiEnabled(yamlInfo, profile);
    } catch { }
  } else {
    // fallback to FQBN/state
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) { const set = await commandSetFqbn(true); if (!set) return; fqbn = extContext.workspaceState.get(STATE_FQBN, ''); }
    args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  const opts = profile ? { profileName: profile, wokwiEnabled } : undefined;
  await compileWithIntelliSense(sketchDir, args, opts);
}
async function runCleanCompileFor(sketchDir, profile) {
  if (!(await ensureCliReady())) return;
  const cfg = getConfig();
  const args = ['compile', '--clean'];
  if (cfg.verbose) args.push('--verbose');
  let wokwiEnabled = false;
  if (profile) {
    args.push('--profile', profile);
    try {
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      wokwiEnabled = isProfileWokwiEnabled(yamlInfo, profile);
    } catch { }
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) { const set = await commandSetFqbn(true); if (!set) return; fqbn = extContext.workspaceState.get(STATE_FQBN, ''); }
    args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  const opts = profile ? { emptyIncludePath: true, profileName: profile, wokwiEnabled } : { emptyIncludePath: true };
  await compileWithIntelliSense(sketchDir, args, opts);
}
async function runUploadFor(sketchDir, profile) {
  if (!(await ensureCliReady())) return;
  const cfg = getConfig();
  const channel = getOutput();
  // Require port
  const currentPort = extContext?.workspaceState.get(STATE_PORT, '') || '';
  if (!currentPort) { vscode.window.showErrorMessage(t('portUnsetWarn')); return; }
  // Build args
  const cArgs = ['compile']; if (cfg.verbose) cArgs.push('--verbose');
  const uArgs = ['upload']; if (cfg.verbose) uArgs.push('--verbose');
  let wokwiEnabled = false;
  if (profile) {
    cArgs.push('--profile', profile); uArgs.push('--profile', profile);
    try {
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      wokwiEnabled = isProfileWokwiEnabled(yamlInfo, profile);
    } catch { }
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) { const set = await commandSetFqbn(true); if (!set) return; fqbn = extContext.workspaceState.get(STATE_FQBN, ''); }
    cArgs.push('--fqbn', fqbn); uArgs.push('--fqbn', fqbn);
  }
  const port = extContext?.workspaceState.get(STATE_PORT, '') || '';
  if (port) uArgs.push('-p', port);
  cArgs.push(sketchDir); uArgs.push(sketchDir);
  const opts = profile ? { profileName: profile, wokwiEnabled } : undefined;
  await compileWithIntelliSense(sketchDir, cArgs, opts);
  let reopenMonitorAfter = false;
  if (monitorTerminal) { try { monitorTerminal.dispose(); } catch (_) { } monitorTerminal = undefined; reopenMonitorAfter = true; }
  await runCli(uArgs, { cwd: sketchDir, forceSpawn: true });
  if (reopenMonitorAfter) { await new Promise(r => setTimeout(r, 1500)); await commandMonitor(); }
}

// Tree helper: upload data for an explicit sketch/profile
async function commandUploadDataFor(sketchDir, profile) {
  // Temporarily set default profile resolution context by writing lastResolved
  let info = await readSketchYamlInfo(sketchDir);
  if (info && profile) info.lastResolved = profile;
  // Reuse the main implementation which re-reads sketch.yaml
  // and resolves profile/FQBN as needed from state.
  // Make the picked .ino implicit by creating a fake payload; the command
  // itself resolves the sketchDir by picking an .ino, so we instead run the
  // core steps inline here when a sketchDir is given.
  // For simplicity, change CWD and invoke commandUploadData logic with the
  // first .ino under sketchDir when available.
  try {
    // Temporarily open any .ino in sketchDir to bias pickInoFromWorkspace
    const inos = await vscode.workspace.findFiles(new vscode.RelativePattern(sketchDir, '*.ino'), undefined, 1);
    if (inos && inos.length > 0) {
      try { await vscode.window.showTextDocument(inos[0], { preview: true }); } catch { }
    }
  } catch { }
  await commandUploadData();
}

async function commandRunWokwi(sketchDir, profile) {
  try {
    let targetDir = sketchDir;
    if (!targetDir) {
      const ino = await pickInoFromWorkspace();
      if (!ino) return;
      targetDir = path.dirname(ino);
    }
    const yamlInfo = await readSketchYamlInfo(targetDir);
    if (!yamlInfo || !Array.isArray(yamlInfo.profiles) || yamlInfo.profiles.length === 0) {
      vscode.window.showWarningMessage(t('assistNoYaml'));
      return;
    }
    let selectedProfile = profile;
    if (!selectedProfile) {
      selectedProfile = await resolveProfileName(yamlInfo);
      if (!selectedProfile) return;
    }
    if (!isProfileWokwiEnabled(yamlInfo, selectedProfile)) {
      const msg = t('wokwiCommandDisabled', { profile: selectedProfile });
      getOutput().appendLine(msg);
      vscode.window.showWarningMessage(msg);
      return;
    }
    const folderName = sanitizeProfileFolderName(selectedProfile);
    const wokwiDirPath = path.join(targetDir, '.wokwi', folderName);
    const { diagramUri } = await ensureWokwiDefaults(wokwiDirPath, selectedProfile);
    const openOptions = { preview: false };
    const openedWithWokwi = await openDiagramInWokwi(diagramUri, openOptions);
    if (!openedWithWokwi) {
      const doc = await vscode.workspace.openTextDocument(diagramUri);
      await vscode.window.showTextDocument(doc, openOptions);
    }
  } catch (err) {
    showError(err);
  }
}

// Register the tree view
arduinoTreeProvider = new ArduinoCliTreeProvider();
arduinoTreeView = vscode.window.createTreeView('arduinoCliView', { treeDataProvider: arduinoTreeProvider, showCollapseAll: true });

// Expand all nodes in the Arduino CLI tree view
async function commandExpandAllTree() {
  try {
    const view = arduinoTreeView;
    if (!view) return;
    const roots = await arduinoTreeProvider.getChildren();
    const expandNode = async (node) => {
      try { await view.reveal(node, { expand: true }); } catch { /* ignore */ }
      const children = await arduinoTreeProvider.getChildren(node);
      if (children && children.length) {
        for (const c of children) await expandNode(c);
      }
    };
    for (const r of roots) await expandNode(r);
  } catch (e) { showError(e); }
}

/**
 * Perform a clean build by invoking `arduino-cli compile --clean`.
 * Uses profile when available; otherwise requires FQBN.
 */
/**
 * Compile every profile defined in each sketch.yaml under the workspace.
 * Ignores user compile settings and forces --warnings=all with JSON diagnostics.
 */
async function commandBuildCheck() {
  if (!(await ensureCliReady())) return;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage(t('buildCheckNoWorkspace'));
    return;
  }
  const channel = getOutput();
  channel.show();
  channel.appendLine(t('buildCheckStart'));

  const sketches = [];
  const seenDirs = new Set();
  for (const folder of folders) {
    const pattern = new vscode.RelativePattern(folder, '**/sketch.yaml');
    let matches = [];
    try { matches = await vscode.workspace.findFiles(pattern); } catch { matches = []; }
    for (const uri of matches) {
      const sketchDir = path.dirname(uri.fsPath);
      if (seenDirs.has(sketchDir)) continue;
      seenDirs.add(sketchDir);
      sketches.push({ sketchDir, uri, folder });
    }
  }

  if (sketches.length === 0) {
    channel.appendLine(t('buildCheckNoSketchYaml'));
    return;
  }

  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const totals = { total: 0, success: 0, failed: 0, warnings: 0, errors: 0 };
  const report = { totals, results: [], generatedAt: '' };

  for (const entry of sketches) {
    const { sketchDir, uri, folder } = entry;
    const wsFolder = vscode.workspace.getWorkspaceFolder(uri) || folder;
    let sketchLabel = sketchDir;
    if (wsFolder) {
      let relPath = path.relative(wsFolder.uri.fsPath, sketchDir);
      if (!relPath) relPath = '.';
      relPath = relPath.split(path.sep).join('/');
      sketchLabel = wsFolder.name + '/' + relPath;
    }

    const yamlInfo = await readSketchYamlInfo(sketchDir);
    const uniqueProfiles = yamlInfo && Array.isArray(yamlInfo.profiles)
      ? Array.from(new Set(yamlInfo.profiles.filter(p => typeof p === 'string' && p.trim().length > 0)))
      : [];
    let profiles = uniqueProfiles;
    if (yamlInfo && yamlInfo.defaultProfile && uniqueProfiles.includes(yamlInfo.defaultProfile)) {
      profiles = uniqueProfiles.filter(p => p !== yamlInfo.defaultProfile);
      profiles.push(yamlInfo.defaultProfile);
    }

    if (!profiles || profiles.length === 0) {
      channel.appendLine(t('buildCheckSkipNoProfiles', { sketch: sketchLabel }));
      continue;
    }

    for (const profile of profiles) {
      totals.total += 1;
      channel.appendLine(t('buildCheckCompileStart', { sketch: sketchLabel, profile }));

      const detail = {
        sketchLabel,
        sketchDir,
        profile,
        success: false,
        warnings: 0,
        errors: 0,
        buildPath: '',
        platform: formatBuildReportPlatform(null),
        platformLabel: '',
        libraries: [],
        message: '',
        diagnostics: [],
        exitCode: null,
        compilerOut: '',
        compilerErr: ''
      };
      let detailPushed = false;
      let runResult;
      try {
        runResult = await runBuildCheckCompile(exe, sketchDir, profile);
      } catch (err) {
        totals.failed += 1;
        const codeText = err && typeof err.code !== 'undefined' ? String(err.code) : err && err.message ? err.message : 'spawn error';
        const errorMsg = t('buildCheckCliError', { sketch: sketchLabel, profile, code: codeText });
        channel.appendLine(errorMsg);
        detail.message = errorMsg;
        detail.exitCode = typeof err?.code === 'number' ? err.code : null;
        report.results.push(detail);
        detailPushed = true;
        continue;
      }

      const { code, stdout, stderr } = runResult;
      detail.exitCode = typeof code === 'number' ? code : null;
      const stderrNormalized = typeof stderr === 'string' ? stderr.replace(/\r\n/g, '\n').trim() : '';
      const parsed = parseBuildCheckJson(stdout);
      if (!parsed.data) {
        totals.failed += 1;
        const parseMsg = t('buildCheckParseError', { sketch: sketchLabel, profile, msg: parsed.error || 'unknown' });
        channel.appendLine(parseMsg);
        detail.message = parseMsg;
        if (typeof code === 'number' && code !== 0) {
          const cliErrMsg = t('buildCheckCliError', { sketch: sketchLabel, profile, code: String(code) });
          channel.appendLine(cliErrMsg);
          detail.message = detail.message ? `${detail.message}\n${cliErrMsg}` : cliErrMsg;
        }
        if (stderrNormalized) {
          channel.append(stderrNormalized.endsWith('\n') ? stderrNormalized : `${stderrNormalized}\n`);
          detail.message = detail.message ? `${detail.message}\n${stderrNormalized}` : stderrNormalized;
        }
        report.results.push(detail);
        detailPushed = true;
        continue;
      }

      const data = parsed.data;
      const success = !!data.success;
      detail.success = success;
      if (success) totals.success += 1;
      else totals.failed += 1;

      const diagnostics = Array.isArray(data?.builder_result?.diagnostics)
        ? data.builder_result.diagnostics
        : [];
      const diagRecords = diagnostics.map(formatInspectorDiagnostic);
      const visibleDiagnostics = diagRecords.filter((d) => d.severity !== 'WARNING' || isWorkspaceFile(d.file));
      const warnCount = visibleDiagnostics.filter((d) => d.severity === 'WARNING').length;
      const errCount = visibleDiagnostics.filter((d) => d.severity === 'ERROR').length;
      detail.warnings = warnCount;
      detail.errors = errCount;
      detail.diagnostics = visibleDiagnostics;
      totals.warnings += warnCount;
      totals.errors += errCount;

      const statusLabel = t(success ? 'buildCheckStatusSuccess' : 'buildCheckStatusFailed');
      channel.appendLine(t('buildCheckCompileResult', {
        sketch: sketchLabel,
        profile,
        status: statusLabel,
        warnings: warnCount,
        errors: errCount,
      }));

      const builder = data?.builder_result || {};
      detail.buildPath = typeof builder.build_path === 'string' ? builder.build_path.trim() : '';
      detail.platform = formatBuildReportPlatform(builder);
      detail.platformLabel = formatBuildReportPlatformLabel(detail.platform);
      detail.libraries = formatBuildReportLibraries(builder);
      detail.compilerOut = typeof data.compiler_out === 'string' ? data.compiler_out : '';
      detail.compilerErr = typeof data.compiler_err === 'string' ? data.compiler_err : '';

      if (success) {
        try {
          await ensureCompileCommandsSetting(sketchDir);
          let buildPath = detail.buildPath;
          if (!buildPath) {
            const detectArgs = ['compile', '--profile', profile, '--warnings=all', '--clean', sketchDir];
            buildPath = await detectBuildPathForCompile(exe, [], detectArgs, sketchDir);
          }
          if (!buildPath) {
            channel.appendLine(t('compileCommandsBuildPathMissing'));
          } else {
            detail.buildPath = buildPath;
            const count = await updateCompileCommandsFromBuild(sketchDir, buildPath);
            if (count > 0) {
              channel.appendLine(t('compileCommandsUpdated', { count }));
            } else if (count === 0) {
              channel.appendLine(t('compileCommandsNoInoEntries'));
            }
          }
        } catch (err) {
          channel.appendLine(`[warn] ${err.message}`);
        }
      } else if (typeof code === 'number' && code !== 0) {
        channel.appendLine(t('buildCheckCliError', { sketch: sketchLabel, profile, code: String(code) }));
      }

      const compilerErr = detail.compilerErr ? detail.compilerErr.trim() : '';
      if ((warnCount > 0 || errCount > 0 || !success) && compilerErr) {
        const normalized = compilerErr.replace(/\r\n/g, '\n');
        channel.append(normalized.endsWith('\n') ? normalized : `${normalized}\n`);
        if (!success) {
          detail.message = detail.message ? `${detail.message}\n${normalized}` : normalized;
        }
      } else if (!success && stderrNormalized) {
        channel.append(stderrNormalized.endsWith('\n') ? stderrNormalized : `${stderrNormalized}\n`);
        detail.message = detail.message ? `${detail.message}\n${stderrNormalized}` : stderrNormalized;
      }
      if (!success && !detail.message) {
        detail.message = statusLabel;
      }

      if (!detailPushed) {
        report.results.push(detail);
        detailPushed = true;
      }
    }
  }

  channel.appendLine(t('buildCheckSummary', {
    total: totals.total,
    success: totals.success,
    failed: totals.failed,
    warnings: totals.warnings,
    errors: totals.errors,
  }));

  report.generatedAt = new Date().toISOString();
  if (report.results.length > 0) {
    openBuildCheckReport(report);
  }
}

/**
 * Collect platform/library versions from sketch.yaml files and compare against
 * online metadata without invoking the compiler.
 */
async function commandVersionCheck() {
  const channel = getOutput();
  channel.show();

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    const msg = t('versionCheckNoWorkspace');
    channel.appendLine(msg);
    vscode.window.showWarningMessage(msg);
    return;
  }

  channel.appendLine(t('versionCheckStart'));

  let sketches = await findSketchYamlEntries();
  if (!Array.isArray(sketches) || sketches.length === 0) {
    channel.appendLine(t('versionCheckNoSketchYaml'));
    return;
  }

  let metadata;
  try {
    metadata = await fetchVersionCheckMetadata(channel);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    channel.appendLine(`[warn] ${msg}`);
    metadata = { platforms: new Map(), libraries: new Map(), warnings: [`metadata: ${msg}`], boardsUrl: '', librariesUrl: '' };
  }

  let report;
  try {
    report = await buildVersionCheckReport(sketches, metadata);
  } catch (err) {
    showError(err);
    return;
  }

  channel.appendLine(t('versionCheckOpenReport'));
  openVersionCheckReport({
    initialReport: report,
    initialMetadata: metadata,
    channel,
    initialSketches: sketches,
  });
}

function parseBuildCheckJson(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { data: null, error: 'empty output' };
  try {
    return { data: JSON.parse(text), error: '' };
  } catch (err) {
    const start = text.lastIndexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end >= start) {
      const candidate = text.slice(start, end + 1);
      try { return { data: JSON.parse(candidate), error: '' }; } catch (err2) {
        return { data: null, error: err2.message };
      }
    }
    return { data: null, error: err.message };
  }
}

async function runBuildCheckCompile(exe, sketchDir, profile) {
  const args = ['compile', '--profile', profile, '--warnings=all', '--clean', '--json', sketchDir];
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? '& ' + quoteArg(exe) : quoteArg(exe);
  channel.appendLine(ANSI.cyan + '$ ' + displayExe + ' ' + args.map(quoteArg).join(' ') + ANSI.reset);
  channel.appendLine(ANSI.dim + '(cwd: ' + sketchDir + ')' + ANSI.reset);
  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { cwd: sketchDir, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}


async function commandCleanCompile() {
  if (!(await ensureCliReady())) return;
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  const sketchDir = path.dirname(ino);
  const cfg = getConfig();
  const channel = getOutput();

  // Prefer sketch.yaml profile if present
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  let args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  args.push('--clean');
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = await resolveProfileName(yamlInfo);
    if (!profile) return; // user cancelled
    channel.appendLine(`[clean-compile] Using profile from sketch.yaml: ${profile}`);
    args.push('--profile', profile);
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      fqbn = extContext.workspaceState.get(STATE_FQBN, '');
    }
    args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  try {
    await compileWithIntelliSense(sketchDir, args, { emptyIncludePath: true });
  } catch (e) {
    showError(e);
  }
}

/**
 * VS Code shutdown hook. Dispose resources created by the extension.
 */
function deactivate() {
  if (output) output.dispose();
}

module.exports = { activate, deactivate };

/**
 * Show the complete board list (optionally filtered) using `board listall`.
 */
async function commandListAllBoards() {
  if (!(await ensureCliReady())) return;
  const channel = getOutput();
  const filter = await vscode.window.showInputBox({
    prompt: 'listall の結果をフィルター（空で全件表示）',
    placeHolder: '例: uno, esp32, rp2040 など',
    value: ''
  });
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'board', 'listall'];
  if (filter && filter.trim()) {
    const parts = filter.match(/(?:"[^"]*"|[^\s"]+)/g) || [];
    for (const p of parts) {
      args.push(p.replace(/^"|"$/g, ''));
    }
  }

  channel.show();
  channel.appendLine(`$ ${quoteArg(exe)} ${args.map(quoteArg).join(' ')}`);
  if (filter && filter.trim()) channel.appendLine(`[filter passed to CLI]`);

  try {
    await runCli(args, { cwd: undefined, forceSpawn: true });
  } catch (e) {
    showError(e);
  }
}

/**
 * Show detailed board info using `board details`.
 * If a sketch.yaml profile is selected, pass its FQBN via `-b`.
 */
async function commandBoardDetails() {
  if (!(await ensureCliReady())) return;
  let sketchDir = '';
  try {
    const ino = await pickInoFromWorkspace();
    if (ino) sketchDir = path.dirname(ino);
  } catch { }
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'board', 'details'];
  let fqbn = '';
  try {
    if (sketchDir) {
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      if (yamlInfo && yamlInfo.profiles.length > 0) {
        const profile = await resolveProfileName(yamlInfo);
        if (profile) fqbn = await getFqbnFromSketchYaml(sketchDir, profile);
      }
    }
  } catch { }
  if (!fqbn) fqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
  if (fqbn) args.push('-b', fqbn);

  try {
    await runCli(args, { cwd: sketchDir || undefined, forceSpawn: true });
  } catch (e) {
    showError(e);
  }
}

/**
 * Heuristic to find a sketch directory for status bar when no editor is active.
 * Returns the directory of the first .ino in the first workspace folder.
 */
async function detectSketchDirForStatus() {
  const active = vscode.window.activeTextEditor?.document?.uri;
  if (active && active.fsPath.toLowerCase().endsWith('.ino')) {
    return path.dirname(active.fsPath);
  }
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return undefined;
  const wf = folders[0];
  try {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(wf, '**/*.ino'), new vscode.RelativePattern(wf, '**/{node_modules,.git,build,out,dist,.vscode}/**'), 1);
    if (files && files.length > 0) return path.dirname(files[0].fsPath);
  } catch { }
  return undefined;
}

function getWarningsShortCode(level) {
  switch ((level || '').toLowerCase()) {
    case 'workspace':
      return 'all';
    case 'none': return 'none';
    case 'default': return 'default';
    case 'more': return 'more';
    case 'all': return 'all';
    default: return 'none';
  }
}

function getWarningsLevelLabel(level) {
  const key = (level || '').toLowerCase();
  if (key === 'workspace') return t('warningsLevelWorkspace');
  if (key === 'none') return t('warningsLevelNone');
  if (key === 'more') return t('warningsLevelMore');
  if (key === 'all') return t('warningsLevelAll');
  return t('warningsLevelDefault');
}

function getVerboseLabel(verbose) {
  return verbose ? t('warningsVerboseOn') : t('warningsVerboseOff');
}

function formatWarningsBadge(level, verbose) {
  const key = (level || '').toLowerCase();
  const base = key === 'workspace' ? 'all*' : getWarningsShortCode(level);
  return verbose ? `${base}+V` : base;
}

/**
 * Refresh status bar items (FQBN/profile, port, baud, action buttons)
 * based on current workspace and state.
 */
async function updateStatusBar() {
  const wf = vscode.workspace.workspaceFolders;
  const hasWs = wf && wf.length > 0;
  if (!hasWs) {
    statusBuild.hide();
    statusUpload.hide();
    statusMonitor.hide();
    statusFqbn.hide();
    statusPort.hide();
    statusBaud.hide();
    statusWarnings.hide();
    return;
  }
  const sketchDir = await detectSketchDirForStatus();
  if (!sketchDir) {
    statusBuild.hide();
    statusUpload.hide();
    statusMonitor.hide();
    statusFqbn.hide();
    statusPort.hide();
    statusBaud.hide();
    statusWarnings.hide();
    return;
  }
  const cfg = getConfig();
  const warningsLevel = cfg && typeof cfg.warnings === 'string' ? cfg.warnings : 'none';
  const verboseEnabled = !!(cfg && cfg.verbose);
  let yamlInfo = await readSketchYamlInfo(sketchDir);
  const fqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
  const port = extContext?.workspaceState.get(STATE_PORT, '') || '';
  const baud = extContext?.workspaceState.get(STATE_BAUD, '115200') || '115200';

  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const label = yamlInfo.defaultProfile || yamlInfo.profiles[0];
    statusFqbn.text = `$(circuit-board) ${label}`;
    statusFqbn.tooltip = _isJa ? '現在のプロファイル（クリックで変更）' : 'Current profile (click to change)';
    statusFqbn.command = 'arduino-cli.setProfile';
    // Apply port/baud from current profile when values differ (robust against FS timing)
    try {
      if (label) {
        await extContext.workspaceState.update(STATE_LAST_PROFILE, label);
        const curPort = extContext?.workspaceState.get(STATE_PORT, '') || '';
        const curBaud = extContext?.workspaceState.get(STATE_BAUD, '115200') || '115200';
        const p = await getPortFromSketchYaml(sketchDir, label);
        if (p && p !== curPort) await extContext.workspaceState.update(STATE_PORT, p);
        const b = await getPortConfigBaudFromSketchYaml(sketchDir, label);
        if (b && String(b) !== String(curBaud)) await extContext.workspaceState.update(STATE_BAUD, String(b));
      }
    } catch (_) { }
  } else {
    statusFqbn.text = fqbn ? `$(circuit-board) ${fqbn}` : (_isJa ? '$(circuit-board) FQBN: 未選択' : '$(circuit-board) FQBN: Not set');
    statusFqbn.tooltip = _isJa ? '現在の FQBN（クリックで変更）' : 'Current FQBN (click to change)';
    statusFqbn.command = 'arduino-cli.setFqbn';
  }

  statusPort.text = port ? `$(plug) ${port}` : (_isJa ? '$(plug) Port: 未選択' : '$(plug) Port: Not set');
  statusPort.tooltip = _isJa ? '現在のポート（クリックで変更）' : 'Current serial port (click to change)';
  statusBaud.text = `$(watch) ${baud}`;
  statusBaud.tooltip = _isJa ? '現在のボーレート（クリックで変更）' : 'Current baudrate (click to change)';
  statusWarnings.text = `$(megaphone) ${formatWarningsBadge(warningsLevel, verboseEnabled)}`;
  statusWarnings.tooltip = t('warningsStatusTooltip', { level: getWarningsLevelLabel(warningsLevel), verbose: getVerboseLabel(verboseEnabled) });
  statusWarnings.command = 'arduino-cli.configureWarnings';
  statusBuild.show();
  statusUpload.show();
  statusMonitor.show();
  statusFqbn.show();
  statusPort.show();
  statusBaud.show();
  statusWarnings.show();
}

/**
 * Set default_profile in sketch.yaml by picking from available profiles.
 * @param {boolean} required If true, shows warning when cancelled.
 */
async function commandSetProfile(required) {
  const ino = await pickInoFromWorkspace();
  if (!ino) return false;
  const sketchDir = path.dirname(ino);
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  if (!yamlInfo || yamlInfo.profiles.length === 0) {
    vscode.window.showWarningMessage('sketch.yaml に profiles が見つかりません。先に Create sketch.yaml を実行してください。');
    return false;
  }
  const pick = await vscode.window.showQuickPick(
    yamlInfo.profiles.map(p => ({ label: p, description: p === yamlInfo.defaultProfile ? 'default' : undefined, value: p })),
    { placeHolder: _isJa ? 'sketch.yaml のプロファイルを選択してください' : 'Select a profile from sketch.yaml' }
  );
  if (!pick) return false;
  const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
  let text = await readTextFile(yamlUri);
  text = replaceYamlKey(text, 'default_profile', pick.value);
  // Immediately reflect port/baud from the selected profile in memory to avoid stale reads
  try {
    const profName = pick.value;
    const portFromText = getPortFromSketchYamlText(text, profName);
    if (portFromText) await extContext.workspaceState.update(STATE_PORT, portFromText);
    const baudFromText = getPortConfigBaudFromSketchYamlText(text, profName);
    if (baudFromText) await extContext.workspaceState.update(STATE_BAUD, String(baudFromText));
    await extContext.workspaceState.update(STATE_LAST_PROFILE, profName);
  } catch (_) { }
  text = formatSketchYamlLayout(text);
  await writeTextFile(yamlUri, text);
  vscode.window.setStatusBarMessage(_isJa ? `Profile を設定: ${pick.value}` : `Set profile: ${pick.value}`, 2000);
  updateStatusBar();
  return true;
}

/**
 * Set current FQBN in workspace state (from connected boards or manual input).
 * @param {boolean} required If true, shows warning when cancelled.
 */
async function commandSetFqbn(required) {
  const boards = await listConnectedBoards();
  const items = boards
    .filter(b => b.fqbn)
    .map(b => ({ label: b.fqbn, description: b.boardName || '', detail: b.port ? `Port: ${b.port}` : undefined, value: b.fqbn }));
  items.push({ label: t('setFqbnManual'), value: '__manual__' });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('setFqbnPickTitle') });
  if (!pick) {
    if (required) vscode.window.showWarningMessage(t('setFqbnUnsetWarn'));
    return false;
  }
  let fqbn = pick.value;
  if (fqbn === '__manual__') {
    const input = await vscode.window.showInputBox({ prompt: t('enterFqbn') });
    if (!input) {
      if (required) vscode.window.showWarningMessage(t('setFqbnUnsetWarn'));
      return false;
    }
    fqbn = input.trim();
  }
  await extContext.workspaceState.update(STATE_FQBN, fqbn);
  updateStatusBar();
  vscode.window.setStatusBarMessage(t('statusSetFqbn', { fqbn }), 2000);
  return true;
}

/**
 * Ask user to select or enter a baudrate.
 * @returns {Promise<string|undefined>} Selected baudrate or undefined if cancelled.
 */
async function pickBaudrate() {
  const current = extContext?.workspaceState.get(STATE_BAUD, '115200') || '115200';
  const options = [
    '300', '1200', '2400', '4800', '9600', '14400', '19200', '28800', '38400', '57600', '74880', '115200', '230400', '460800', '921600'
  ];
  const items = options.map(v => ({ label: v, description: v === current ? 'current' : undefined }));
  items.push({ label: t('setBaudCustom'), value: '__manual__' });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('setBaudTitle', { current }) });
  if (!pick) return undefined;
  let baud = pick.value || pick.label;
  if (baud === '__manual__') {
    const input = await vscode.window.showInputBox({ prompt: t('setBaudPrompt'), value: current, validateInput: (v) => /^\d+$/.test(v) ? undefined : (_isJa ? '数値を入力してください' : 'Enter a number') });
    if (!input) return undefined;
    baud = input.trim();
  }
  await extContext.workspaceState.update(STATE_BAUD, baud);
  return baud;
}

/**
 * Update the saved baudrate and refresh status bar.
 * @param {boolean} required If true, shows warning when cancelled.
 */
async function commandSetBaud(required) {
  const baud = await pickBaudrate();
  if (!baud) {
    if (required) vscode.window.showWarningMessage(_isJa ? 'ボーレートが未選択です' : 'Baudrate is not selected');
    return false;
  }
  updateStatusBar();
  vscode.window.setStatusBarMessage(t('statusSetBaud', { baud }), 2000);
  return true;
}

async function commandConfigureWarnings() {
  const cfg = getConfig();
  const currentWarnings = typeof cfg.warnings === 'string' ? cfg.warnings : 'none';
  const currentVerbose = !!cfg.verbose;
  const levels = ['workspace', 'none', 'default', 'more', 'all'];
  /** @type {vscode.QuickPickItem[]} */
  const items = [];
  for (const level of levels) {
    for (const verbose of [false, true]) {
      const levelLabel = getWarningsLevelLabel(level);
      const verboseLabel = getVerboseLabel(verbose);
      const label = verbose
        ? t('warningsQuickPickWithVerbose', { level: levelLabel })
        : t('warningsQuickPickWithoutVerbose', { level: levelLabel });
      items.push({
        label,
        description: formatWarningsBadge(level, verbose),
        detail: t('warningsStatusTooltip', { level: levelLabel, verbose: verboseLabel }),
        picked: level === currentWarnings && verbose === currentVerbose,
        value: { warnings: level, verbose }
      });
    }
  }

  const quickPickItems = items.map(item => ({
    label: item.label,
    description: item.description,
    detail: item.detail,
    picked: item.picked,
    value: item.value
  }));

  const selection = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: t('warningsQuickPickPlaceHolder'),
    title: t('warningsQuickPickTitle')
  });
  if (!selection || !selection.value) return;

  const { warnings, verbose } = selection.value;
  const config = vscode.workspace.getConfiguration();
  const hasWorkspace = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
  try {
    if (hasWorkspace) {
      await config.update('arduino-cli-wrapper.compileWarnings', warnings, vscode.ConfigurationTarget.Workspace);
      await config.update('arduino-cli-wrapper.verbose', verbose, vscode.ConfigurationTarget.Workspace);
      await config.update('arduino-cli-wrapper.compileWarnings', undefined, vscode.ConfigurationTarget.Global);
      await config.update('arduino-cli-wrapper.verbose', undefined, vscode.ConfigurationTarget.Global);
    } else {
      await config.update('arduino-cli-wrapper.compileWarnings', warnings, vscode.ConfigurationTarget.Global);
      await config.update('arduino-cli-wrapper.verbose', verbose, vscode.ConfigurationTarget.Global);
      await config.update('arduino-cli-wrapper.compileWarnings', undefined, vscode.ConfigurationTarget.Workspace);
      await config.update('arduino-cli-wrapper.verbose', undefined, vscode.ConfigurationTarget.Workspace);
    }
    vscode.window.setStatusBarMessage(
      t('warningsUpdateApplied', { level: getWarningsLevelLabel(warnings), verbose: getVerboseLabel(verbose) }),
      2000
    );
  } catch (err) {
    vscode.window.showErrorMessage(t('warningsUpdateFailed', { msg: err && err.message ? err.message : String(err) }));
  }
  updateStatusBar();
}

/**
 * Launch the serial monitor in the integrated terminal with saved port/baud.
 */
async function commandMonitor() {
  if (!(await ensureCliReady())) return;
  // Close existing monitor if running
  if (monitorTerminal) {
    try { monitorTerminal.dispose(); } catch (_) { }
    monitorTerminal = undefined;
  }
  // Ensure a serial port is selected
  let port = extContext?.workspaceState.get(STATE_PORT, '');
  if (!port) {
    const set = await commandSetPort(true);
    if (!set) return;
    port = extContext.workspaceState.get(STATE_PORT, '');
  }
  // Use saved baudrate (default 115200) without prompting
  let baud = extContext?.workspaceState.get(STATE_BAUD, '115200') || '115200';

  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'monitor', '-p', port, '--config', `baudrate=${baud}`];

  // Run in integrated terminal for interactive monitoring
  monitorTerminal = vscode.window.createTerminal({ name: `${OUTPUT_NAME} Monitor` });
  monitorTerminal.show(true);
  const exeForTerminal = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  const cmd = `${exeForTerminal} ${args.map(quoteArg).join(' ')}`;
  monitorTerminal.sendText(cmd);
}

/**
 * Set current serial port (and optionally FQBN) from connected boards list
 * or manual entry.
 * @param {boolean} required If true, shows warning when cancelled.
 */
async function commandSetPort(required) {
  const boards = await listConnectedBoards();
  const items = boards.map(b => ({
    label: b.port || '(unknown)',
    description: b.boardName || 'Unknown board',
    detail: b.fqbn ? `FQBN: ${b.fqbn}` : undefined,
    value: b.port || '',
    fqbn: b.fqbn || ''
  }));
  items.push({ label: t('setPortManual'), value: '__manual__' });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('monitorPickPortTitle') });
  if (!pick) {
    if (required) vscode.window.showWarningMessage(t('portUnsetWarn'));
    return false;
  }
  let port = pick.value;
  if (port === '__manual__') {
    const input = await vscode.window.showInputBox({ prompt: t('enterPort') });
    if (!input) {
      if (required) vscode.window.showWarningMessage(t('portUnsetWarn'));
      return false;
    }
    port = input.trim();
  }
  await extContext.workspaceState.update(STATE_PORT, port);
  if (pick.fqbn) {
    await extContext.workspaceState.update(STATE_FQBN, pick.fqbn);
  }
  updateStatusBar();
  const withFqbn = pick.fqbn ? (_isJa ? `（FQBN: ${pick.fqbn} も設定）` : ` (FQBN: ${pick.fqbn})`) : '';
  vscode.window.setStatusBarMessage(t('statusSetPort', { port, withFqbn }), 2000);
  return true;
}

/**
 * Quote a YAML scalar if needed (keeps simple unquoted when safe).
 */
function encodeYamlString(value) {
  if (value == null) return "";
  const s = String(value);
  if (/^[A-Za-z0-9_:\\/.+-]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

/**
 * Create a minimal sketch.yaml header. Profiles are appended elsewhere.
 */
function buildSketchYamlContent() {
  const lines = [];
  return lines;
}

/**
 * Test if a VS Code Uri exists.
 */
async function pathExists(uri) {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/**
 * Write UTF-8 text to a VS Code Uri.
 */
async function writeTextFile(uri, text) {
  const enc = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, enc.encode(text));
}

/**
 * Read UTF-8 text from a VS Code Uri.
 */
async function readTextFile(uri) {
  const dec = new TextDecoder();
  const data = await vscode.workspace.fs.readFile(uri);
  return dec.decode(data);
}

/**
 * Parse sketch.yaml if present and return `{ defaultProfile, profiles[] }`.
 * @returns {Promise<{defaultProfile:string,profiles:string[]}|null>}
 */
async function readSketchYamlInfo(sketchDir) {
  try {
    const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
    await vscode.workspace.fs.stat(yamlUri);
    const text = await readTextFile(yamlUri);
    // Extract default_profile
    let defaultProfile = '';
    const mDef = text.match(/^\s*default_profile\s*:\s*([^\n#]+)\s*$/m);
    if (mDef) {
      defaultProfile = mDef[1].trim().replace(/^"|"$/g, '');
    }
    // Extract profile names under profiles:
    const profiles = [];
    const wokwiProfiles = new Set();
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    let currentProfile = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) {
        if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true;
        continue;
      }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) {
        currentProfile = mKey[1].trim();
        profiles.push(currentProfile);
        continue;
      }
      if (/^\S/.test(line)) break; // end of profiles block
      if (!currentProfile) continue;
      const wokwiMatch = line.match(/^\s{4}wokwi\s*:\s*([^#]+)(?:#.*)?$/);
      if (wokwiMatch) {
        let value = wokwiMatch[1].trim();
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
          value = value.slice(1, -1);
        } else if (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2) {
          value = value.slice(1, -1);
        }
        if (/^(true|yes|on|1)$/i.test(value)) {
          wokwiProfiles.add(currentProfile);
        }
        continue;
      }
    }
    return { defaultProfile, profiles, wokwiProfiles };
  } catch {
    return null;
  }
}

function isProfileWokwiEnabled(yamlInfo, profileName) {
  if (!yamlInfo || !profileName) return false;
  const set = yamlInfo.wokwiProfiles;
  if (set && typeof set.has === 'function') {
    return set.has(profileName);
  }
  return false;
}

function sanitizeProfileFolderName(profileName) {
  if (!profileName) return 'default';
  const sanitized = profileName.replace(/[\\/:*?"<>|]/g, '_').trim();
  return sanitized || 'default';
}

/**
 * Resolve which profile name to use from `yamlInfo`.
 * If default exists, use it; if single profile, use it; otherwise prompt.
 */
async function resolveProfileName(yamlInfo) {
  if (!yamlInfo || yamlInfo.profiles.length === 0) return '';
  if (yamlInfo.defaultProfile && yamlInfo.profiles.includes(yamlInfo.defaultProfile)) {
    yamlInfo.lastResolved = yamlInfo.defaultProfile;
    return yamlInfo.defaultProfile;
  }
  if (yamlInfo.profiles.length === 1) {
    yamlInfo.lastResolved = yamlInfo.profiles[0];
    return yamlInfo.profiles[0];
  }
  const pick = await vscode.window.showQuickPick(
    yamlInfo.profiles.map(p => ({ label: p, value: p })),
    { placeHolder: 'sketch.yaml のプロファイルを選択してください' }
  );
  if (!pick) return '';
  yamlInfo.lastResolved = pick.value;
  return pick.value;
}

/**
 * Run `arduino-cli compile --fqbn <fqbn> --dump-profile` and return its YAML.
 * @returns {Promise<string>} YAML text or empty string on failure.
 */
async function getDumpProfileYaml(fqbn, sketchDir) {
  if (!fqbn) return '';
  const channel = getOutput();
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'compile', '--fqbn', fqbn, '--dump-profile'];
  if (sketchDir) args.push(sketchDir);
  let stdout = '';
  let stderr = '';
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(exe, args, { shell: false, cwd: sketchDir || undefined });
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', e => reject(e));
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`dump-profile exit ${code}: ${stderr}`)));
    });
    const cleaned = (stdout || '').trim();
    // Output already contains a YAML 'profiles:' root; return as is.
    return cleaned ? cleaned + '\n' : '';
  } catch (e) {
    channel.appendLine(`[warn] Failed to get dump profile: ${e.message}`);
    return '';
  }
}

/**
 * Get Arduino CLI configuration directories via `config dump --format json`.
 * Returns `{ dataDir, userDir }` or empty strings on failure.
 */
async function getCliConfigDirs() {
  const channel = getOutput();
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'config', 'dump', '--format', 'json'];
  let stdout = '';
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(exe, args, { shell: false });
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => channel.append(d.toString()));
      child.on('error', e => reject(e));
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`config dump exit ${code}`)));
    });
    const json = JSON.parse(stdout);
    const dirs = json.directories || {};
    return {
      dataDir: dirs.data || '',
      userDir: dirs.user || '',
    };
  } catch (e) {
    // Demote to warning to avoid noisy errors during compile
    channel.appendLine(`[warn] ${e.message}`);
    return { dataDir: '', userDir: '' };
  }
}

/**
 * Extract `vendor:arch` and `version` from a dump-profile YAML text.
 * Optionally prefer a given profile name.
 */
function parsePlatformFromProfileYaml(profileYaml, preferProfileName) {
  // Try to find the profile block and extract vendor:arch and version
  // platform: esp32:esp32 (3.3.0)
  const lines = (profileYaml || '').split(/\r?\n/);
  let inProfiles = false;
  let currentKey = '';
  let targetKey = preferProfileName || '';
  for (const line of lines) {
    if (!inProfiles) {
      if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true;
      continue;
    }
    const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
    if (mKey) {
      currentKey = mKey[1].trim();
      continue;
    }
    // Match either "      platform: ... (x.y.z)" or list item "      - platform: ... (x.y.z)"
    const mPlat = line.match(/^\s{6}(?:-\s*)?platform\s*:\s*([A-Za-z0-9_.:-]+)(?:\s*\(([^)]+)\)\s*)?$/);
    if (mPlat && (!targetKey || targetKey === currentKey)) {
      return { vendorArch: mPlat[1], version: mPlat[2] ? mPlat[2] : '' };
    }
  }
  return null;
}

/**
 * Create `sketch.yaml` in the current sketch directory.
 * If FQBN is selected, append dump-profile profiles and set default_profile.
 */
// createSketchYaml command removed by request

/**
 * From dump-profile YAML, find a profile key whose `fqbn` matches.
 * Falls back to the first profile key when no exact match is found.
 */
function extractProfileNameFromDump(profileYaml, fqbn) {
  if (!profileYaml) return '';
  const lines = profileYaml.split(/\r?\n/);
  let inProfiles = false;
  let currentKey = '';
  let firstKey = '';
  const stripQuotes = (s) => s.replace(/^"|"$/g, '').trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inProfiles) {
      if (/^\s*profiles\s*:\s*$/.test(line)) {
        inProfiles = true;
      }
      continue;
    }
    const mKey = line.match(/^\s{2}([^\s:][^:]*)\s*:\s*$/);
    if (mKey) {
      currentKey = mKey[1].trim();
      if (!firstKey) firstKey = currentKey;
      continue;
    }
    const mFqbn = line.match(/^\s{4}fqbn\s*:\s*(.+)\s*$/);
    if (mFqbn && currentKey) {
      const val = stripQuotes(mFqbn[1]);
      if (!fqbn) continue;
      if (val === fqbn) {
        return currentKey;
      }
    }
  }
  return firstKey;
}

/**
 * From sketch.yaml, get `fqbn` under profiles.<profileName> if present.
 */
async function getFqbnFromSketchYaml(sketchDir, profileName) {
  try {
    const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
    const text = await readTextFile(yamlUri);
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    let currentKey = '';
    for (const line of lines) {
      if (!inProfiles) {
        if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true;
        continue;
      }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) { currentKey = mKey[1].trim(); continue; }
      const mFqbn = line.match(/^\s{4}fqbn\s*:\s*(.+)\s*$/);
      if (mFqbn && (!profileName || profileName === currentKey)) {
        return mFqbn[1].trim().replace(/^"|"$/g, '');
      }
      if (/^\S/.test(line)) break;
    }
  } catch { }
  return '';
}

/**
 * Replace or append a top-level YAML key with a scalar value.
 */
function replaceYamlKey(text, key, value) {
  const re = new RegExp(`^(\n?|[\s\S]*?)$`);
  try {
    const pattern = new RegExp(`(^|\n)\s*${key}\s*:\s*.*(?=\n|$)`, 'm');
    if (pattern.test(text)) {
      return text.replace(pattern, (m) => m.replace(/:\s*.*/, `: ${encodeYamlString(value)}`));
    }
  } catch { }
  return text + `\n${key}: ${encodeYamlString(value)}`;
}

/**
 * Replace or append `monitor.baudrate` in a sketch.yaml string.
 */
function replaceMonitorBaud(text, baud) {
  // If monitor block exists, replace baudrate; otherwise append monitor block
  const monitorRegex = /(\n|^)\s*monitor\s*:\s*([\s\S]*?)(\n\S|$)/m;
  if (monitorRegex.test(text)) {
    return text.replace(monitorRegex, (full, start, body, tailStart) => {
      let newBody;
      if (/baudrate\s*:/m.test(body)) {
        newBody = body.replace(/(baudrate\s*:\s*).*(?=\n|$)/m, `$1${encodeYamlString(baud)}`);
      } else {
        newBody = body.replace(/$/, `\n  baudrate: ${encodeYamlString(baud)}`);
      }
      return `${start}monitor:${newBody}${tailStart || ''}`;
    });
  }
  return text + `\nmonitor:\n  baudrate: ${encodeYamlString(baud)}`;
}
/**
 * Open a webview for the sketch.yaml helper and wire apply action.
 */
async function commandOpenSketchYamlHelper(ctx) {
  const panel = vscode.window.createWebviewPanel(
    'sketchYamlHelper',
    'sketch.yaml Helper',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  let helperSketchDir = (ctx && ctx.sketchDir) ? String(ctx.sketchDir) : '';

  const guessSketchDirFromActiveEditor = () => {
    const uri = vscode.window.activeTextEditor?.document?.uri;
    if (!uri) return '';
    const fsPath = uri.fsPath || '';
    if (!fsPath) return '';
    const lower = fsPath.toLowerCase();
    if (lower.endsWith('.ino')) return path.dirname(fsPath);
    if (path.basename(fsPath).toLowerCase() === 'sketch.yaml') return path.dirname(fsPath);
    return '';
  };

  try {
    const htmlUri = vscode.Uri.joinPath(extContext.extensionUri, 'html', 'sketch.yaml.html');
    let html = await readTextFile(htmlUri);
    panel.webview.html = html;
  } catch (e) {
    showError(e);
  }

  // Try to initialize with selected profile's FQBN and libraries (if provided)
  (async () => {
    try {
      let sketchDir = helperSketchDir;
      if (!sketchDir) {
        sketchDir = guessSketchDirFromActiveEditor();
      }
      if (!sketchDir) {
        const ino = await pickInoFromWorkspace();
        if (!ino) return;
        sketchDir = path.dirname(ino);
      }
      helperSketchDir = sketchDir;
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      if (!yamlInfo || !yamlInfo.profiles || yamlInfo.profiles.length === 0) return;
      let prof = (ctx && ctx.profile && yamlInfo.profiles.includes(ctx.profile)) ? ctx.profile : '';
      if (!prof) prof = yamlInfo.defaultProfile || yamlInfo.profiles[0];
      const extFqbn = await getFqbnFromSketchYaml(sketchDir, prof);
      const libs = await getLibrariesFromSketchYaml(sketchDir, prof);
      // Extract raw profile block text to preserve user-defined parameters
      const profileBlock = await getProfileBlockFromSketchYaml(sketchDir, prof);
      // Parse platform id/version from sketch.yaml text
      let platformId = '';
      let platformVersion = '';
      try {
        const text = await readTextFile(vscode.Uri.file(path.join(sketchDir, 'sketch.yaml')));
        const parsed = parsePlatformFromProfileYaml(text, prof);
        if (parsed) { platformId = parsed.vendorArch || ''; platformVersion = parsed.version || ''; }
      } catch { }
      if (extFqbn) panel.webview.postMessage({ type: 'init', extFqbn, libraries: libs, platformId, platformVersion, profileBlock, profileName: prof });
    } catch (_) { /* ignore init errors */ }
  })();

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.type !== 'applyYaml') return;
    try {
      let sketchDir = helperSketchDir;
      if (!sketchDir) {
        sketchDir = guessSketchDirFromActiveEditor();
      }
      if (!sketchDir) {
        sketchDir = await detectSketchDirForStatus();
      }
      if (!sketchDir) {
        // Try to pick a sketch by .ino
        try {
          const ino = await pickInoFromWorkspace();
          if (ino) {
            sketchDir = path.dirname(ino);
          }
        } catch (_) { }
      }
      if (!sketchDir) {
        // As a last resort, let user choose a folder
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: _isJa ? 'スケッチフォルダを選択' : 'Select Sketch Folder' });
        if (!picked || picked.length === 0) {
          vscode.window.showWarningMessage(t('yamlNoSketchDir'));
          return;
        }
        sketchDir = picked[0].fsPath;
      }
      helperSketchDir = sketchDir;
      const { profileName, blockText } = extractProfileFromTemplateYaml(String(msg.yaml || ''));
      if (!profileName || !blockText) throw new Error('invalid YAML payload');
      const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
      let existing = '';
      try { existing = await readTextFile(yamlUri); } catch { existing = ''; }
      let merged = mergeProfileIntoSketchYaml(existing, profileName, blockText);
      merged = formatSketchYamlLayout(merged);
      await writeTextFile(yamlUri, merged);
      vscode.window.setStatusBarMessage(t('yamlApplied', { name: profileName }), 2000);
      // Optionally reveal the file
      try { await vscode.window.showTextDocument(yamlUri); } catch { }
      updateStatusBar();
      try { await vscode.commands.executeCommand('arduino-cli.refreshView'); } catch { }
      panel.dispose();
    } catch (e) {
      vscode.window.showErrorMessage(t('yamlApplyError', { msg: e.message }));
    }
  });
}

/**
 * From a generated template YAML, extract the first profile name and its block text.
 */
function extractProfileFromTemplateYaml(text) {
  const lines = String(text || '').split(/\r?\n/);
  let inProfiles = false;
  let start = -1;
  let name = '';
  // First, try to find under an explicit `profiles:` section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inProfiles) { if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true; continue; }
    const m = line.match(/^\s{2,}([^\s:#][^:]*)\s*:\s*$/);
    if (m) { name = m[1].trim(); start = i; break; }
  }
  // Fallback: accept a raw profile block starting at an indented key
  if (start < 0) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s{2,}([^\s:#][^:]*)\s*:\s*$/);
      if (m) { name = m[1].trim(); start = i; break; }
    }
  }
  if (start < 0 || !name) return { profileName: '', blockText: '' };
  // Determine the indentation of the profile key to detect the end reliably
  const indentMatch = lines[start].match(/^(\s+)/);
  const baseIndent = indentMatch ? indentMatch[1] : '  ';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const s = lines[i];
    if (/^\s*default_profile\s*:\s*/.test(s)) { end = i; break; }
    if (/^\S/.test(s)) { end = i; break; }
    const m = s.match(/^\s{2,}([^\s:#][^:]*)\s*:\s*$/);
    if (m) {
      const ind = (s.match(/^(\s+)/) || [, ''])[1];
      if (ind && ind.length === baseIndent.length) { end = i; break; }
    }
  }
  const block = lines.slice(start, end).join('\n');
  return { profileName: name, blockText: block.replace(/\s+$/, '') + '\n' };
}

/**
 * Normalize spacing inside sketch.yaml profiles to keep helper output consistent.
 */
function formatSketchYamlLayout(text) {
  try {
    const ensureFinalNewline = (str) => str.endsWith('\n') ? str : `${str}\n`;
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const profIdx = lines.findIndex(line => /^\s*profiles\s*:\s*$/.test(line));
    if (profIdx < 0) {
      const collapsed = normalized.replace(/\n{3,}/g, '\n\n');
      const collapsedLines = collapsed.split('\n');
      while (collapsedLines.length > 0 && collapsedLines[collapsedLines.length - 1].trim() === '') {
        collapsedLines.pop();
      }
      return ensureFinalNewline(collapsedLines.join('\n'));
    }
    let profEnd = lines.length;
    for (let i = profIdx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { profEnd = i; break; }
    }
    const before = lines.slice(0, profIdx + 1);
    const section = lines.slice(profIdx + 1, profEnd);
    const after = lines.slice(profEnd);

    const blocks = [];
    let idx = 0;
    while (idx < section.length) {
      while (idx < section.length && section[idx].trim() === '') idx++;
      if (idx >= section.length) break;
      const start = idx;
      idx++;
      while (idx < section.length) {
        const line = section[idx];
        if (/^\s{2}[^ \t:#][^:]*\s*:\s*$/.test(line)) break;
        if (/^\S/.test(line)) break;
        idx++;
      }
      const block = section.slice(start, idx);
      const cleaned = block.filter((line, lineIdx) => lineIdx === 0 || line.trim().length > 0);
      blocks.push(cleaned);
    }

    const formattedSection = [];
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      for (const line of block) formattedSection.push(line);
      if (b < blocks.length - 1) formattedSection.push('');
    }
    while (formattedSection.length > 0 && formattedSection[formattedSection.length - 1].trim() === '') {
      formattedSection.pop();
    }

    const afterTrimmed = after.slice();
    while (afterTrimmed.length > 0 && afterTrimmed[0].trim() === '') {
      afterTrimmed.shift();
    }

    const resultLines = before.concat(formattedSection);
    if (afterTrimmed.length > 0) {
      if (resultLines.length === 0 || resultLines[resultLines.length - 1].trim() !== '') {
        resultLines.push('');
      } else {
        resultLines[resultLines.length - 1] = '';
      }
      resultLines.push(...afterTrimmed);
    }

    while (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() === '') {
      resultLines.pop();
    }

    const result = resultLines.join('\n').replace(/\n{3,}/g, '\n\n');
    return ensureFinalNewline(result);
  } catch (_) {
    const fallback = String(text || '').replace(/\r\n/g, '\n');
    return fallback.endsWith('\n') ? fallback : `${fallback}\n`;
  }
}
/**
 * Merge a single profile block into existing sketch.yaml text.
 * - Overwrite when the profile exists; otherwise append under profiles.
 */
function mergeProfileIntoSketchYaml(existingText, profileName, profileBlockText) {
  const text = String(existingText || '');
  const lines = text.split(/\r?\n/);
  // Find profiles section
  let profStart = -1; let profEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*profiles\s*:\s*$/.test(lines[i])) { profStart = i; for (let j = i + 1; j < lines.length; j++) { if (/^\S/.test(lines[j])) { profEnd = j; break; } } break; }
  }
  const ensureEol = (s) => s.endsWith('\n') ? s : (s + '\n');
  if (profStart < 0) {
    // No profiles section: append one at the end
    const base = ensureEol(text.trimEnd());
    return base + 'profiles:\n' + profileBlockText + '\n';
  }
  // Section exists: check if profile exists
  let curStart = -1; let curEnd = profEnd;
  for (let i = profStart + 1; i < profEnd; i++) {
    const m = lines[i].match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
    if (m) {
      if (curStart >= 0) { curEnd = i; break; }
      if (m[1].trim() === profileName) { curStart = i; }
    }
  }
  if (curStart >= 0) {
    // Replace existing block
    const before = lines.slice(0, curStart).join('\n');
    const after = lines.slice(curEnd).join('\n');
    return [before, profileBlockText.replace(/\s+$/, ''), after].join('\n').replace(/\n{3,}/g, '\n\n') + (text.endsWith('\n') ? '' : '\n');
  }
  // Append to end of profiles section
  const before = lines.slice(0, profEnd).join('\n');
  const after = lines.slice(profEnd).join('\n');
  const glue = (before.endsWith('\n') ? '' : '\n');
  return [before, glue + profileBlockText.replace(/\s+$/, ''), after].join('\n').replace(/\n{3,}/g, '\n\n') + (text.endsWith('\n') ? '' : '\n');
}

/**
 * Parse libraries entries from sketch.yaml under a specific profile.
 * Returns an array like [{ name, version }] (version may be '').
 */
async function getLibrariesFromSketchYaml(sketchDir, profileName) {
  try {
    const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
    const text = await readTextFile(yamlUri);
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    let inTarget = false;
    let inLibs = false;
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) { if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true; continue; }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) { inTarget = (mKey[1].trim() === profileName); inLibs = false; continue; }
      if (!inTarget) { if (/^\S/.test(line)) break; else continue; }
      const mLibs = line.match(/^\s{4}libraries\s*:\s*$/);
      if (mLibs) { inLibs = true; continue; }
      if (inLibs) {
        const mItem = line.match(/^\s{6}-\s*(.+)\s*$/);
        if (mItem) {
          const raw = mItem[1].trim().replace(/^"|"$/g, '');
          // Extract name and optional (version)
          const mv = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
          if (mv) result.push({ name: mv[1].trim(), version: mv[2].trim() });
          else if (raw) result.push({ name: raw, version: '' });
          continue;
        }
        // End of list when indentation decreases or next top-level section starts
        if (!/^\s{6}-/.test(line)) { inLibs = false; }
      }
    }
    return result;
  } catch { return []; }
}

/**
 * Open the sketch inspector webview and provide memory/build analysis.
 * @param {{sketchDir?:string, profile?:string}|undefined} ctx
 */
async function commandOpenInspector(ctx) {
  const panel = vscode.window.createWebviewPanel(
    'arduinoCliInspector',
    t('inspectorPanelTitle'),
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  const requestedSketchDir = ctx && typeof ctx.sketchDir === 'string' ? ctx.sketchDir : '';
  const requestedProfile = ctx && typeof ctx.profile === 'string' ? ctx.profile : '';
  const initialContext = {
    sketchDir: requestedSketchDir,
    profile: requestedProfile,
    autoRun: !!(requestedSketchDir && requestedProfile)
  };
  const state = {
    running: false,
    lastFiles: {}
  };
  let disposed = false;
  panel.onDidDispose(() => {
    disposed = true;
    state.running = false;
    state.lastFiles = {};
  });

  try {
    const htmlUri = vscode.Uri.joinPath(extContext.extensionUri, 'html', 'inspector.html');
    const html = await readTextFile(htmlUri);
    panel.webview.html = html;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    panel.webview.html = `<html><body><h3>${t('inspectorPanelTitle')}</h3><pre>${escapeHtml(msg)}</pre></body></html>`;
    showError(err);
  }

  const sendInit = async () => {
    if (disposed) return;
    try {
      const sketches = await collectInspectorSketches(initialContext.sketchDir);
      panel.webview.postMessage({
        type: 'init',
        locale: _isJa ? 'ja' : 'en',
        strings: buildInspectorStrings(),
        sketches,
        context: initialContext
      });
      if (initialContext.autoRun) initialContext.autoRun = false;
    } catch (err) {
      showError(err);
      panel.webview.postMessage({ type: 'initError', message: err && err.message ? err.message : String(err) });
    }
  };

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (disposed || !msg || typeof msg !== 'object') return;
    try {
      switch (msg.type) {
        case 'ready':
        case 'requestRefresh':
          await sendInit();
          break;
        case 'requestAnalysis': {
          if (state.running) {
            panel.webview.postMessage({ type: 'analysisDenied', reason: 'busy', message: t('inspectorRequestInProgress') });
            return;
          }
          const sketchDir = typeof msg.sketchDir === 'string' ? msg.sketchDir : '';
          if (!sketchDir) {
            panel.webview.postMessage({ type: 'analysisDenied', reason: 'noSketch', message: t('inspectorNoSelectionWarn') });
            return;
          }
          const profile = typeof msg.profile === 'string' ? msg.profile : '';
          const inoPath = typeof msg.inoPath === 'string' ? msg.inoPath : '';
          const requestId = typeof msg.requestId === 'number' ? msg.requestId : Date.now();
          state.running = true;
          panel.webview.postMessage({ type: 'analysisStatus', status: 'start', requestId });
          try {
            const result = await runInspectorAnalysis({ sketchDir, profile, inoPath });
            state.lastFiles = result.filesMeta || {};
            panel.webview.postMessage({ type: 'analysisResult', requestId, ...result.payload });
          } catch (err) {
            panel.webview.postMessage({
              type: 'analysisResult',
              requestId,
              success: false,
              message: err && err.message ? err.message : String(err)
            });
          } finally {
            state.running = false;
          }
          break;
        }
        case 'requestFile': {
          const key = typeof msg.key === 'string' ? msg.key : '';
          if (!key) return;
          const info = state.lastFiles[key];
          if (!info || !info.path) {
            panel.webview.postMessage({ type: 'fileContent', key, error: t('inspectorFileLoadError', { name: key }) });
            return;
          }
          try {
            const content = await readTextFile(vscode.Uri.file(info.path));
            panel.webview.postMessage({
              type: 'fileContent',
              key,
              content,
              path: info.path,
              size: info.size || content.length
            });
          } catch (err) {
            const detail = err && err.message ? err.message : String(err);
            panel.webview.postMessage({ type: 'fileContent', key, error: `${t('inspectorFileLoadError', { name: key })} ${detail}`.trim() });
          }
          break;
        }
        case 'openFile': {
          const key = typeof msg.key === 'string' ? msg.key : '';
          let target = '';
          if (key && state.lastFiles[key] && state.lastFiles[key].path) {
            target = state.lastFiles[key].path;
          } else if (typeof msg.path === 'string') {
            target = msg.path;
          }
          const lineValue = typeof msg.line === 'number' ? msg.line : (typeof msg.line === 'string' ? Number(msg.line) : NaN);
          const columnValue = typeof msg.column === 'number' ? msg.column : (typeof msg.column === 'string' ? Number(msg.column) : NaN);
          if (!target) return;
          try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
            const hasLine = Number.isFinite(lineValue) && lineValue > 0;
            const hasColumn = Number.isFinite(columnValue) && columnValue > 0;
            let selection;
            if (hasLine) {
              const lineIndex = Math.max(0, Math.floor(lineValue - 1));
              const columnIndex = hasColumn ? Math.max(0, Math.floor(columnValue - 1)) : 0;
              const position = new vscode.Position(lineIndex, columnIndex);
              selection = new vscode.Range(position, position);
            }
            const editor = await vscode.window.showTextDocument(doc, selection ? { preview: false, selection } : { preview: false });
            if (selection) {
              editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
            }
          } catch (err) {
            showError(err);
          }
          break;
        }
      }
    } catch (err) {
      showError(err);
    }
  });
}

/** Build localized UI strings for the inspector webview. */
function buildInspectorStrings() {
  const keys = ['open',
    'inspectorPanelTitle',
    'inspectorSelectSketch',
    'inspectorSelectProfile',
    'inspectorProfileNone',
    'inspectorRunButton',
    'inspectorStatusIdle',
    'inspectorStatusNoSketch',
    'inspectorStatusPreparing',
    'inspectorStatusRunning',
    'inspectorAnalysisSuccess',
    'inspectorAnalysisFailed',
    'inspectorTabSummary',
    'inspectorTabDiagnostics',
    'inspectorTabSections',
    'inspectorTabSymbols',
    'inspectorTabLibraries',
    'inspectorTabBuildProps',
    'inspectorTabPartitions',
    'inspectorTabSdkconfig',
    'inspectorTabRawJson',
    'inspectorSummaryBuildPath',
    'inspectorSummarySketch',
    'inspectorSummaryProfile',
    'inspectorSummaryWarnings',
    'inspectorSummaryErrors',
    'inspectorSummaryFlash',
    'inspectorSummaryData',
    'inspectorSummaryUnknown',
    'inspectorTableNoData',
    'inspectorDiagnosticsHeaderSeverity',
    'inspectorDiagnosticsHeaderMessage',
    'inspectorDiagnosticsHeaderLocation',
    'inspectorMapHeaderSymbol',
    'inspectorMapHeaderSize',
    'inspectorMapHeaderObject',
    'inspectorMapHeaderSection',
    'inspectorSectionsHeaderName',
    'inspectorSectionsHeaderUsed',
    'inspectorSectionsHeaderMax',
    'inspectorLibrariesHeaderName',
    'inspectorLibrariesHeaderVersion',
    'inspectorLibrariesHeaderLocation',
    'inspectorBuildPropsHeaderKey',
    'inspectorBuildPropsHeaderValue',
    'inspectorFileLoadError',
    'inspectorRequestInProgress',
    'inspectorNoSelectionWarn',
    'inspectorMapMissing',
    'inspectorMapParseFailed',
    'inspectorMapNoSymbols',
    'inspectorOpenInEditor'
  ];
  const result = {};
  for (const key of keys) {
    result[key] = t(key);
  }
  return result;
}

function buildBuildReportStrings() {
  const keys = [
    'buildReportTitle',
    'buildReportSummaryHeading',
    'buildReportTotalsHeading',
    'buildReportGeneratedAt',
    'buildReportResultsHeading',
    'buildReportTableSketch',
    'buildReportTableProfile',
    'buildReportTableResult',
    'buildReportTableWarnings',
    'buildReportTableErrors',
    'buildReportTablePlatform',
    'buildReportTableLibraries',
    'buildReportNoData',
    'buildReportResultSuccess',
    'buildReportResultFailure',
    'buildReportPlatformsHeading',
    'buildReportLibrariesHeading',
    'buildReportLibraryColumnName',
    'buildReportLibraryColumnVersion',
    'buildReportLibraryColumnSource',
    'buildReportSummaryWarnings',
    'buildReportSummaryErrors',
    'buildCheckStatusSuccess',
    'buildCheckStatusFailed',
  ];
  const result = {};
  for (const key of keys) {
    result[key] = t(key);
  }
  return result;
}

function buildVersionCheckStrings() {
  const keys = [
    'versionCheckTitle',
    'versionCheckSummaryHeading',
    'versionCheckSummarySketches',
    'versionCheckSummaryProfiles',
    'versionCheckSummaryPlatforms',
    'versionCheckSummaryLibraries',
    'versionCheckSummaryOutdated',
    'versionCheckSummaryMissing',
    'versionCheckSummaryUnknown',
    'versionCheckPlatformsHeading',
    'versionCheckLibrariesHeading',
    'versionCheckColSketch',
    'versionCheckColProfile',
    'versionCheckColPlatform',
    'versionCheckColLibrary',
    'versionCheckColCurrent',
    'versionCheckColLatest',
    'versionCheckColStatus',
    'versionCheckColAction',
    'versionCheckStatusOk',
    'versionCheckStatusOutdated',
    'versionCheckStatusMissing',
    'versionCheckStatusUnknown',
    'versionCheckStatusAhead',
    'versionCheckBtnUpdate',
    'versionCheckBtnUpdateAllPlatforms',
    'versionCheckBtnUpdateAllLibraries',
    'versionCheckBtnRefresh',
    'versionCheckNoData',
    'versionCheckGeneratedAt',
    'versionCheckErrorsHeading',
    'versionCheckWarningsHeading',
    'versionCheckPending',
    'versionCheckReportReady',
    'versionCheckUpdateNoChanges'
  ];
  const result = {};
  for (const key of keys) {
    result[key] = t(key);
  }
  return result;
}

async function openBuildCheckReport(report) {
  try {
    const panel = vscode.window.createWebviewPanel(
      'arduinoBuildReport',
      t('buildReportTitle'),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const htmlUri = vscode.Uri.joinPath(extContext.extensionUri, 'html', 'build-check.html');
    const html = await readTextFile(htmlUri);
    panel.webview.html = html;

    const payload = {
      locale: _isJa ? 'ja' : 'en',
      strings: buildBuildReportStrings(),
      report,
    };

    panel.webview.onDidReceiveMessage((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        panel.webview.postMessage({ type: 'report', payload });
      }
    });
  } catch (err) {
    showError(err);
  }
}

async function openVersionCheckReport({ initialReport, initialMetadata, initialSketches, channel }) {
  try {
    const panel = vscode.window.createWebviewPanel(
      'arduinoVersionCheck',
      t('versionCheckTitle'),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const htmlUri = vscode.Uri.joinPath(extContext.extensionUri, 'html', 'version-check.html');
    const html = await readTextFile(htmlUri);
    panel.webview.html = html;

    const strings = buildVersionCheckStrings();
    const locale = _isJa ? 'ja' : 'en';
    let disposed = false;
    let currentReport = initialReport;
    let currentMetadata = initialMetadata || { platforms: new Map(), libraries: new Map(), warnings: [] };
    let currentSketches = Array.isArray(initialSketches) ? initialSketches : [];

    const postReport = (report) => {
      if (disposed) return;
      panel.webview.postMessage({
        type: 'report',
        payload: { locale, strings, report }
      });
    };

    panel.onDidDispose(() => {
      disposed = true;
    });

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (disposed || !msg || typeof msg !== 'object') return;
      const type = msg.type;
      try {
        if (type === 'ready') {
          postReport(currentReport);
          return;
        }

        if (type === 'refresh') {
          try {
            currentMetadata = await fetchVersionCheckMetadata(channel);
          } catch (err) {
            const text = err && err.message ? err.message : String(err);
            channel.appendLine(`[warn] ${text}`);
            currentMetadata = { platforms: new Map(), libraries: new Map(), warnings: [`metadata: ${text}`], boardsUrl: '', librariesUrl: '' };
          }
          currentSketches = await findSketchYamlEntries();
          currentReport = await buildVersionCheckReport(currentSketches, currentMetadata);
          postReport(currentReport);
          return;
        }

        if (type === 'updatePlatforms') {
          const entries = Array.isArray(msg.entries) ? msg.entries : [];
          if (entries.length === 0) {
            vscode.window.setStatusBarMessage(t('versionCheckUpdateNoChanges'), 2000);
            return;
          }
          const result = await applyPlatformVersionUpdates(entries);
          if (result.errors && result.errors.length) {
            for (const errText of result.errors) {
              channel.appendLine(`[warn] ${errText}`);
            }
          }
          const count = result.applied || 0;
          if (count > 0) {
            vscode.window.setStatusBarMessage(t('versionCheckUpdateApplied', { count }), 2000);
          } else {
            vscode.window.setStatusBarMessage(t('versionCheckUpdateNoChanges'), 2000);
          }
          currentSketches = await findSketchYamlEntries();
          currentReport = await buildVersionCheckReport(currentSketches, currentMetadata);
          postReport(currentReport);
          return;
        }

        if (type === 'updateLibraries') {
          const entries = Array.isArray(msg.entries) ? msg.entries : [];
          if (entries.length === 0) {
            vscode.window.setStatusBarMessage(t('versionCheckUpdateNoChanges'), 2000);
            return;
          }
          const result = await applyLibraryVersionUpdates(entries);
          if (result.errors && result.errors.length) {
            for (const errText of result.errors) {
              channel.appendLine(`[warn] ${errText}`);
            }
          }
          const count = result.applied || 0;
          if (count > 0) {
            vscode.window.setStatusBarMessage(t('versionCheckUpdateApplied', { count }), 2000);
          } else {
            vscode.window.setStatusBarMessage(t('versionCheckUpdateNoChanges'), 2000);
          }
          currentSketches = await findSketchYamlEntries();
          currentReport = await buildVersionCheckReport(currentSketches, currentMetadata);
          postReport(currentReport);
        }
      } catch (err) {
        const text = err && err.message ? err.message : String(err);
        channel.appendLine(`[warn] ${text}`);
        if (!disposed) {
          panel.webview.postMessage({ type: 'notice', level: 'error', message: text });
        }
      }
    });
  } catch (err) {
    showError(err);
  }
}

async function fetchVersionCheckMetadata(channel) {
  const boardsUrl = 'https://tanakamasayuki.github.io/arduino-cli-helper/board_details.json';
  const librariesUrl = 'https://tanakamasayuki.github.io/arduino-cli-helper/libraries.json';
  const metadata = {
    boardsUrl,
    librariesUrl,
    platforms: new Map(),
    libraries: new Map(),
    warnings: []
  };

  try {
    const boardJson = await fetchJsonWithRedirect(boardsUrl);
    metadata.platforms = buildPlatformLatestMap(boardJson);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    metadata.warnings.push(`boards: ${msg}`);
    channel.appendLine(t('versionCheckFetchBoardsFail', { msg }));
  }

  try {
    const libraryJson = await fetchJsonWithRedirect(librariesUrl);
    metadata.libraries = buildLibraryLatestMap(libraryJson);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    metadata.warnings.push(`libraries: ${msg}`);
    channel.appendLine(t('versionCheckFetchLibrariesFail', { msg }));
  }

  return metadata;
}

async function buildVersionCheckReport(sketches, metadata) {
  const platformRows = [];
  const libraryRows = [];
  const warnings = Array.isArray(metadata?.warnings) ? [...metadata.warnings] : [];

  const platformMap = metadata?.platforms instanceof Map ? metadata.platforms : new Map();
  const libraryMap = metadata?.libraries instanceof Map ? metadata.libraries : new Map();

  let sketchCount = 0;
  let profileCount = 0;

  for (const entry of Array.isArray(sketches) ? sketches : []) {
    if (!entry || typeof entry.sketchDir !== 'string') continue;
    const sketchDir = entry.sketchDir;
    const uri = entry.uri;
    const folder = entry.folder;
    let sketchLabel = sketchDir;
    try {
      const wsFolder = uri ? (vscode.workspace.getWorkspaceFolder(uri) || folder) : folder;
      if (wsFolder && wsFolder.uri && wsFolder.uri.fsPath) {
        let relPath = path.relative(wsFolder.uri.fsPath, sketchDir);
        if (!relPath) relPath = '.';
        relPath = relPath.split(path.sep).join('/');
        sketchLabel = `${wsFolder.name}/${relPath}`;
      }
    } catch (_) { }

    let yamlText = '';
    try {
      yamlText = await readTextFile(vscode.Uri.file(path.join(sketchDir, 'sketch.yaml')));
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      warnings.push(`${sketchLabel}: ${msg}`);
      continue;
    }

    sketchCount += 1;

    let yamlInfo = null;
    try {
      yamlInfo = await readSketchYamlInfo(sketchDir);
    } catch (_) { yamlInfo = null; }

    let profileNames = yamlInfo && Array.isArray(yamlInfo.profiles)
      ? Array.from(new Set(yamlInfo.profiles.filter(p => typeof p === 'string' && p.trim().length > 0)))
      : [];

    if (yamlInfo && yamlInfo.defaultProfile && profileNames.includes(yamlInfo.defaultProfile)) {
      profileNames = profileNames.filter(p => p !== yamlInfo.defaultProfile);
      profileNames.push(yamlInfo.defaultProfile);
    }

    if (!profileNames.length) {
      warnings.push(t('buildCheckSkipNoProfiles', { sketch: sketchLabel }));
      continue;
    }

    profileCount += profileNames.length;

    for (const profile of profileNames) {
      const fqbn = extractProfileFqbnFromYaml(yamlText, profile);
      const platformEntries = extractProfilePlatformsFromYaml(yamlText, profile);
      if (!platformEntries.length) {
        warnings.push(`${sketchLabel} (${profile}): no platform entry found`);
      }
      for (const plat of platformEntries) {
        const currentRaw = typeof plat.version === 'string' ? plat.version.trim() : '';
        const latestEntry = platformMap.get(plat.id) || null;
        const latestRaw = latestEntry && typeof latestEntry.version === 'string' ? latestEntry.version : '';
        const status = evaluateVersionStatus(currentRaw, latestRaw);
        platformRows.push({
          sketchDir,
          sketchLabel,
          profile,
          fqbn,
          platformId: plat.id,
          currentVersion: currentRaw,
          latestVersion: latestRaw,
          status,
          packageUrl: latestEntry && typeof latestEntry.packageUrl === 'string' ? latestEntry.packageUrl : '',
          platformName: latestEntry && typeof latestEntry.name === 'string' ? latestEntry.name : ''
        });
      }

      const libs = extractProfileLibrariesFromYaml(yamlText, profile);
      for (const lib of libs) {
        const name = lib && typeof lib.name === 'string' ? lib.name : '';
        if (!name) continue;
        const currentRaw = lib && typeof lib.version === 'string' ? lib.version : '';
        const lookup = libraryMap.get(name.toLowerCase()) || null;
        const latestRaw = lookup && typeof lookup.version === 'string' ? lookup.version : '';
        const status = evaluateVersionStatus(currentRaw, latestRaw);
        libraryRows.push({
          sketchDir,
          sketchLabel,
          profile,
          fqbn,
          libraryName: name,
          currentVersion: currentRaw,
          latestVersion: latestRaw,
          status
        });
      }
    }
  }

  const cmp = (a, b) => {
    const sa = (a || '').toString();
    const sb = (b || '').toString();
    return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
  };

  platformRows.sort((a, b) => {
    let d = cmp(a.sketchLabel || a.sketchDir || '', b.sketchLabel || b.sketchDir || '');
    if (d !== 0) return d;
    d = cmp(a.profile || '', b.profile || '');
    if (d !== 0) return d;
    d = cmp(a.platformId || '', b.platformId || '');
    if (d !== 0) return d;
    return cmp(a.currentVersion || '', b.currentVersion || '');
  });

  libraryRows.sort((a, b) => {
    let d = cmp(a.sketchLabel || a.sketchDir || '', b.sketchLabel || b.sketchDir || '');
    if (d !== 0) return d;
    d = cmp(a.profile || '', b.profile || '');
    if (d !== 0) return d;
    d = cmp(a.libraryName || '', b.libraryName || '');
    if (d !== 0) return d;
    return cmp(a.currentVersion || '', b.currentVersion || '');
  });

  const totalPlatforms = platformRows.length;
  const totalLibraries = libraryRows.length;
  const totals = {
    sketches: sketchCount,
    profiles: profileCount,
    platformTotal: totalPlatforms,
    platformOutdated: platformRows.filter(r => r.status === 'outdated').length,
    platformMissing: platformRows.filter(r => r.status === 'missing').length,
    platformUnknown: platformRows.filter(r => r.status === 'unknown').length,
    platformAhead: platformRows.filter(r => r.status === 'ahead').length,
    libraryTotal: totalLibraries,
    libraryOutdated: libraryRows.filter(r => r.status === 'outdated').length,
    libraryMissing: libraryRows.filter(r => r.status === 'missing').length,
    libraryUnknown: libraryRows.filter(r => r.status === 'unknown').length,
    libraryAhead: libraryRows.filter(r => r.status === 'ahead').length
  };

  return {
    generatedAt: new Date().toISOString(),
    totals,
    platforms: platformRows,
    libraries: libraryRows,
    warnings,
    metadataSources: {
      boards: metadata?.boardsUrl || '',
      libraries: metadata?.librariesUrl || ''
    }
  };
}

function evaluateVersionStatus(currentRaw, latestRaw) {
  const current = normalizeVersion(currentRaw || '');
  const latest = normalizeVersion(latestRaw || '');
  if (!current && !latest) return 'unknown';
  if (!current) return latest ? 'missing' : 'unknown';
  if (!latest) return 'unknown';
  const cmp = compareVersions(current, latest);
  if (cmp < 0) return 'outdated';
  if (cmp > 0) return 'ahead';
  return 'ok';
}

async function applyPlatformVersionUpdates(entries) {
  const result = { applied: 0, errors: [] };
  if (!Array.isArray(entries) || entries.length === 0) return result;

  const dedup = new Map();
  for (const entry of entries) {
    if (!entry) continue;
    const sketchDir = typeof entry.sketchDir === 'string' ? entry.sketchDir : '';
    const profile = typeof entry.profile === 'string' ? entry.profile : '';
    const platformId = typeof entry.platformId === 'string' ? entry.platformId : '';
    const newVersion = typeof entry.latestVersion === 'string' ? entry.latestVersion : '';
    if (!sketchDir || !profile || !platformId || !newVersion) continue;
    const key = `${path.normalize(sketchDir)}|${profile}|${platformId}`;
    dedup.set(key, { sketchDir, profile, platformId, newVersion });
  }

  const grouped = new Map();
  for (const entry of dedup.values()) {
    const bucketKey = path.normalize(entry.sketchDir);
    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, { sketchDir: entry.sketchDir, updates: [] });
    }
    grouped.get(bucketKey).updates.push(entry);
  }

  for (const info of grouped.values()) {
    const yamlUri = vscode.Uri.file(path.join(info.sketchDir, 'sketch.yaml'));
    let text;
    try {
      text = await readTextFile(yamlUri);
    } catch (err) {
      result.errors.push(`${info.sketchDir}: ${err && err.message ? err.message : String(err)}`);
      continue;
    }
    let mutated = text;
    let changed = 0;
    for (const upd of info.updates) {
      const next = patchPlatformVersionInYamlText(mutated, upd.profile, upd.platformId, upd.newVersion);
      if (next !== mutated) {
        mutated = next;
        changed += 1;
      }
    }
    if (changed > 0) {
      try {
        mutated = formatSketchYamlLayout(mutated);
        await writeTextFile(yamlUri, mutated);
        result.applied += changed;
      } catch (err) {
        result.errors.push(`${info.sketchDir}: ${err && err.message ? err.message : String(err)}`);
      }
    }
  }

  return result;
}

async function applyLibraryVersionUpdates(entries) {
  const result = { applied: 0, errors: [] };
  if (!Array.isArray(entries) || entries.length === 0) return result;

  const dedup = new Map();
  for (const entry of entries) {
    if (!entry) continue;
    const sketchDir = typeof entry.sketchDir === 'string' ? entry.sketchDir : '';
    const profile = typeof entry.profile === 'string' ? entry.profile : '';
    const libraryName = typeof entry.libraryName === 'string' ? entry.libraryName : '';
    const newVersion = typeof entry.latestVersion === 'string' ? entry.latestVersion : '';
    if (!sketchDir || !profile || !libraryName || !newVersion) continue;
    const key = `${path.normalize(sketchDir)}|${profile}|${libraryName}`;
    dedup.set(key, { sketchDir, profile, libraryName, newVersion });
  }

  const grouped = new Map();
  for (const entry of dedup.values()) {
    const bucketKey = path.normalize(entry.sketchDir);
    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, { sketchDir: entry.sketchDir, updates: [] });
    }
    grouped.get(bucketKey).updates.push(entry);
  }

  for (const info of grouped.values()) {
    const yamlUri = vscode.Uri.file(path.join(info.sketchDir, 'sketch.yaml'));
    let text;
    try {
      text = await readTextFile(yamlUri);
    } catch (err) {
      result.errors.push(`${info.sketchDir}: ${err && err.message ? err.message : String(err)}`);
      continue;
    }
    let mutated = text;
    let changed = 0;
    for (const upd of info.updates) {
      const libs = extractProfileLibrariesFromYaml(mutated, upd.profile);
      const idx = libs.findIndex(l => l.name === upd.libraryName);
      if (idx === -1) continue;
      if (libs[idx].version === upd.newVersion) continue;
      libs[idx] = { name: libs[idx].name, version: upd.newVersion };
      const next = patchLibrariesInYamlText(mutated, upd.profile, libs);
      if (next !== mutated) {
        mutated = next;
        changed += 1;
      }
    }
    if (changed > 0) {
      try {
        mutated = formatSketchYamlLayout(mutated);
        await writeTextFile(yamlUri, mutated);
        result.applied += changed;
      } catch (err) {
        result.errors.push(`${info.sketchDir}: ${err && err.message ? err.message : String(err)}`);
      }
    }
  }

  return result;
}

function patchPlatformVersionInYamlText(yamlText, profileName, platformId, newVersion) {
  try {
    const id = String(platformId || '').trim();
    const ver = String(newVersion || '').trim();
    if (!id) return yamlText;
    const lines = String(yamlText || '').split(/\r?\n/);
    const bounds = findProfileBounds(lines, profileName);
    if (!bounds) return yamlText;
    const { targetStart, targetEnd } = bounds;
    const desired = `      - platform: ${id}${ver ? ` (${ver})` : ''}`;
    let platformsHeader = -1;
    for (let i = targetStart + 1; i < targetEnd; i++) {
      if (/^\s{4}platforms\s*:\s*$/.test(lines[i])) {
        platformsHeader = i;
        break;
      }
    }
    if (platformsHeader >= 0) {
      for (let i = platformsHeader + 1; i < targetEnd; i++) {
        const line = lines[i];
        if (/^\s{6}-\s*platform\s*:\s*/.test(line)) {
          const m = line.match(/^\s{6}-\s*platform\s*:\s*([^\s]+)\s*(?:\([^)]*\))?\s*$/);
          if (m && m[1] === id) {
            lines[i] = desired;
            return lines.join('\n');
          }
          continue;
        }
        if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\s{2}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\S/.test(line) || /^\s*default_profile\s*:\s*/.test(line)) {
          break;
        }
      }
      const before = lines.slice(0, platformsHeader + 1).join('\n');
      const after = lines.slice(platformsHeader + 1).join('\n');
      return before + '\n' + desired + (after.startsWith('\n') ? '' : '\n') + after;
    }
    const before = lines.slice(0, targetStart + 1).join('\n');
    const after = lines.slice(targetStart + 1).join('\n');
    const block = ['    platforms:', desired].join('\n');
    return [before, block, after].join('\n');
  } catch (_) {
    return yamlText;
  }
}

function patchLibrariesInYamlText(yamlText, profileName, libs) {
  try {
    const lines = String(yamlText || '').split(/\r?\n/);
    const bounds = findProfileBounds(lines, profileName);
    if (!bounds) return yamlText;
    const { targetStart, targetEnd } = bounds;
    let header = -1;
    let headerEnd = -1;
    for (let i = targetStart + 1; i < targetEnd; i++) {
      if (/^\s{4}libraries\s*:\s*$/.test(lines[i])) {
        header = i;
        headerEnd = i + 1;
        for (let j = i + 1; j < targetEnd; j++) {
          if (/^\s{6}-\s*/.test(lines[j])) {
            headerEnd = j + 1;
            continue;
          }
          if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(lines[j]) || /^\s{2}[^\s:#][^:]*\s*:\s*$/.test(lines[j]) || /^\S/.test(lines[j]) || /^\s*default_profile\s*:\s*/.test(lines[j])) {
            break;
          }
        }
        break;
      }
    }
    const formatted = [];
    if (Array.isArray(libs)) {
      for (const entry of libs) {
        const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!name) continue;
        const ver = entry && typeof entry.version === 'string' ? entry.version.trim() : '';
        formatted.push(`      - ${ver ? `${name} (${ver})` : name}`);
      }
    }
    const hasLibs = formatted.length > 0;
    if (header >= 0) {
      const before = lines.slice(0, header);
      const after = lines.slice(headerEnd >= 0 ? headerEnd : header + 1);
      if (!hasLibs) {
        return before.concat(after).join('\n').replace(/\n{3,}/g, '\n\n');
      }
      return before.concat(['    libraries:', ...formatted], after).join('\n');
    }
    if (!hasLibs) return yamlText;
    const before = lines.slice(0, targetEnd);
    const after = lines.slice(targetEnd);
    const block = ['    libraries:', ...formatted];
    return before.concat(block, after).join('\n').replace(/\n{3,}/g, '\n\n');
  } catch (_) {
    return yamlText;
  }
}

function findProfileBounds(lines, profileName) {
  if (!Array.isArray(lines)) return null;
  let profilesStart = -1;
  let profilesEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*profiles\s*:\s*$/.test(lines[i])) {
      profilesStart = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\S/.test(lines[j])) {
          profilesEnd = j;
          break;
        }
      }
      break;
    }
  }
  if (profilesStart < 0) return null;
  let targetStart = -1;
  let targetEnd = profilesEnd;
  const wanted = typeof profileName === 'string' ? profileName.trim() : '';
  for (let i = profilesStart + 1; i < profilesEnd; i++) {
    const m = lines[i].match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
    if (m) {
      const name = m[1].trim();
      if (!wanted || name === wanted) {
        if (targetStart < 0) {
          targetStart = i;
          continue;
        }
      }
      if (targetStart >= 0) {
        targetEnd = i;
        break;
      }
    }
  }
  if (targetStart < 0) return null;
  if (targetEnd <= targetStart) targetEnd = profilesEnd;
  return { profilesStart, profilesEnd, targetStart, targetEnd };
}

function extractProfileFqbnFromYaml(yamlText, profileName) {
  try {
    const lines = String(yamlText || '').split(/\r?\n/);
    const bounds = findProfileBounds(lines, profileName);
    if (!bounds) return '';
    const { targetStart, targetEnd } = bounds;
    for (let i = targetStart + 1; i < targetEnd; i++) {
      const line = lines[i];
      const m = line.match(/^\s{4}fqbn\s*:\s*(.+)\s*$/);
      if (m) {
        return m[1].trim().replace(/^"|"$/g, '');
      }
      if (/^\s{2}[^\s:#][^:]*\s*:\s*$/.test(line)) break;
    }
    return '';
  } catch (_) {
    return '';
  }
}

function extractProfilePlatformsFromYaml(yamlText, profileName) {
  const result = [];
  try {
    const lines = String(yamlText || '').split(/\r?\n/);
    const bounds = findProfileBounds(lines, profileName);
    if (!bounds) return result;
    const { targetStart, targetEnd } = bounds;
    for (let i = targetStart + 1; i < targetEnd; i++) {
      if (/^\s{4}platforms\s*:\s*$/.test(lines[i])) {
        for (let j = i + 1; j < targetEnd; j++) {
          const line = lines[j];
          const m = line.match(/^\s{6}-\s*platform\s*:\s*([A-Za-z0-9_.:-]+)(?:\s*\(([^)]+)\)\s*)?$/);
          if (m) {
            result.push({ id: m[1], version: m[2] ? m[2].trim() : '' });
            continue;
          }
          if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\s{2}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\S/.test(line) || /^\s*default_profile\s*:\s*/.test(line)) {
            break;
          }
        }
        if (result.length > 0) return result;
      }
    }
    for (let i = targetStart + 1; i < targetEnd; i++) {
      const m = lines[i].match(/^\s{4}platform\s*:\s*([A-Za-z0-9_.:-]+)(?:\s*\(([^)]+)\)\s*)?$/);
      if (m) {
        result.push({ id: m[1], version: m[2] ? m[2].trim() : '' });
      }
    }
    return result;
  } catch (_) {
    return result;
  }
}

function extractProfileLibrariesFromYaml(yamlText, profileName) {
  const result = [];
  try {
    const lines = String(yamlText || '').split(/\r?\n/);
    const bounds = findProfileBounds(lines, profileName);
    if (!bounds) return result;
    const { targetStart, targetEnd } = bounds;
    let header = -1;
    for (let i = targetStart + 1; i < targetEnd; i++) {
      if (/^\s{4}libraries\s*:\s*$/.test(lines[i])) {
        header = i;
        for (let j = i + 1; j < targetEnd; j++) {
          const line = lines[j];
          const m = line.match(/^\s{6}-\s*(.+?)\s*$/);
          if (m) {
            const raw = m[1].trim().replace(/^"|"$/g, '');
            const mv = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
            if (mv) result.push({ name: mv[1].trim(), version: mv[2].trim() });
            else if (raw) result.push({ name: raw, version: '' });
            continue;
          }
          if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\s{2}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\S/.test(line) || /^\s*default_profile\s*:\s*/.test(line)) {
            break;
          }
        }
        break;
      }
    }
    return result;
  } catch (_) {
    return result;
  }
}

function buildPlatformLatestMap(boardDetails) {
  const map = new Map();
  if (!boardDetails || typeof boardDetails !== 'object' || Array.isArray(boardDetails)) return map;
  for (const [fqbn, detail] of Object.entries(boardDetails)) {
    if (!detail || typeof detail !== 'object') continue;
    const parts = String(fqbn).split(':');
    if (parts.length < 2) continue;
    const id = `${parts[0]}:${parts[1]}`;
    const versionRaw = detail.version || detail.Version || '';
    const version = normalizeVersion(versionRaw);
    const existing = map.get(id);
    if (!existing || compareVersions(version, existing.version) > 0) {
      map.set(id, {
        version,
        packageUrl: typeof detail.package_url === 'string' ? detail.package_url : '',
        name: typeof detail.name === 'string' ? detail.name : ''
      });
    }
  }
  return map;
}

function buildLibraryLatestMap(libraryEntries) {
  const map = new Map();
  if (!Array.isArray(libraryEntries)) return map;
  for (const entry of libraryEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    const version = normalizeVersion(entry.version || '');
    const existing = map.get(key);
    if (!existing || compareVersions(version, existing.version) > 0) {
      map.set(key, { name, version });
    }
  }
  return map;
}

function fetchJsonWithRedirect(url, timeoutMs = 10000) {
  const visited = new Set();
  const headers = { 'User-Agent': 'vscode-arduino-cli-wrapper' };
  const attempt = (target) => new Promise((resolve, reject) => {
    if (visited.size > 5) {
      reject(new Error('too many redirects'));
      return;
    }
    visited.add(target);
    const req = https.get(target, { headers }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        const next = (() => {
          try { return new URL(res.headers.location, target).toString(); }
          catch (_) { return res.headers.location; }
        })();
        res.resume();
        resolve(attempt(next));
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${target}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(body || 'null'));
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(new Error('timeout')); } catch (_) { }
    });
  });
  return attempt(url);
}

function compareVersions(a, b) {
  const va = normalizeVersion(a || '');
  const vb = normalizeVersion(b || '');
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  const [mainA, preA = ''] = va.split('-', 2);
  const [mainB, preB = ''] = vb.split('-', 2);
  const partsA = mainA.split('.');
  const partsB = mainB.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(partsA[i] || '0', 10);
    const nb = parseInt(partsB[i] || '0', 10);
    if (Number.isNaN(na) && Number.isNaN(nb)) continue;
    if (Number.isNaN(na)) return -1;
    if (Number.isNaN(nb)) return 1;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  if (preA && preB) {
    if (preA === preB) return 0;
    return preA < preB ? -1 : 1;
  }
  return 0;
}

function formatBuildReportPlatform(builder) {
  const normalize = (plat) => ({
    id: plat && typeof plat.id === 'string' ? plat.id : '',
    version: plat && typeof plat.version === 'string' ? plat.version : '',
    packageUrl: plat && typeof plat.package_url === 'string' ? plat.package_url : '',
  });
  if (!builder || typeof builder !== 'object') {
    return { build: normalize(null), board: normalize(null) };
  }
  return {
    build: normalize(builder.build_platform),
    board: normalize(builder.board_platform),
  };
}

function formatBuildReportPlatformLabel(info) {
  if (!info || typeof info !== 'object') return '';
  const build = info.build || {};
  if (build.id) {
    return build.version ? `${build.id} @ ${build.version}` : build.id;
  }
  const board = info.board || {};
  if (board.id) {
    return board.version ? `${board.id} @ ${board.version}` : board.id;
  }
  return '';
}

function formatBuildReportLibraries(builder) {
  if (!builder || typeof builder !== 'object' || !Array.isArray(builder.used_libraries)) return [];
  return builder.used_libraries.map((lib) => {
    const name = lib && typeof lib.name === 'string' ? lib.name : '';
    const version = lib && typeof lib.version === 'string' ? lib.version : '';
    const location = lib && typeof lib.location === 'string' && lib.location
      ? lib.location
      : (lib && typeof lib.install_dir === 'string' ? lib.install_dir : '');
    const label = name ? (version ? `${name} @ ${version}` : name) : '';
    return { name, version, location, label };
  });
}


async function collectInspectorSketches(preferSketchDir = '') {
  const sketches = await findSketches();
  const preferNormalized = preferSketchDir ? path.normalize(preferSketchDir) : '';
  const items = [];
  for (const sketch of sketches) {
    const dir = sketch.dir;
    if (!dir) continue;
    const dirUri = vscode.Uri.file(dir);
    const inos = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      for (const [name, kind] of entries) {
        if (kind === vscode.FileType.File && name.toLowerCase().endsWith('.ino')) {
          inos.push({ path: path.join(dir, name), name });
        }
      }
    } catch (_) { }
    if (inos.length === 0) continue;
    const yamlInfo = await readSketchYamlInfo(dir);
    const profiles = yamlInfo && Array.isArray(yamlInfo.profiles)
      ? yamlInfo.profiles.filter(Boolean).map(String)
      : [];
    const defaultProfile = yamlInfo && typeof yamlInfo.defaultProfile === 'string' ? yamlInfo.defaultProfile : '';
    items.push({
      sketchDir: dir,
      label: sketch.name || path.basename(dir),
      relative: workspaceRelativePath(dir),
      inos,
      defaultIno: inos[0]?.path || '',
      profiles,
      defaultProfile,
      preferred: preferNormalized && path.normalize(dir) === preferNormalized
    });
  }
  items.sort((a, b) => {
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  return items;
}

function workspaceRelativePath(fsPath) {
  try {
    const folders = vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      if (!folder || !folder.uri) continue;
      const rel = path.relative(folder.uri.fsPath, fsPath);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return `${folder.name}/${rel.split(path.sep).join('/')}`;
      }
    }
  } catch (_) { }
  return fsPath;
}

function isWorkspaceFile(fsPath) {
  if (!fsPath) return true;
  try {
    const normalized = path.normalize(fsPath);
    if (!path.isAbsolute(normalized)) {
      return true;
    }
    const folders = vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      if (!folder || !folder.uri) continue;
      const rel = path.relative(folder.uri.fsPath, normalized);
      if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        return true;
      }
    }
  } catch (_) { }
  return false;
}


async function runInspectorAnalysis({ sketchDir, profile, inoPath }) {
  if (!(await ensureCliReady())) {
    throw new Error(t('cliCheckFail', {}));
  }
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = ['compile', '--warnings=all', '--json', '--clean'];
  let usedProfile = '';
  let usedFqbn = '';
  if (profile) {
    args.push('--profile', profile);
    usedProfile = profile;
  } else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!fqbn) {
      const set = await commandSetFqbn(true);
      if (!set) throw new Error(t('setFqbnUnsetWarn'));
      fqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
      if (!fqbn) throw new Error(t('setFqbnUnsetWarn'));
    }
    args.push('--fqbn', fqbn);
    usedFqbn = fqbn;
  }
  args.push(sketchDir);
  const finalArgs = [...baseArgs, ...args];
  const channel = getOutput();
  channel.show();
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : quoteArg(exe);
  channel.appendLine(`${ANSI.cyan}[inspector] $ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}`);
  channel.appendLine(`${ANSI.dim}[inspector] (cwd: ${sketchDir})${ANSI.reset}`);
  let stdout = '';
  let stderr = '';
  const code = await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, { cwd: sketchDir, shell: false });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', resolve);
  });
  const parsed = parseBuildCheckJson(stdout);
  if (!parsed.data) {
    const detail = parsed.error || (stderr && stderr.trim()) || `exit ${code}`;
    throw new Error(t('inspectorAnalysisFailed', { msg: detail }));
  }
  const data = parsed.data;
  const builder = data && typeof data === 'object' ? data.builder_result || {} : {};
  const buildPath = typeof builder.build_path === 'string' ? builder.build_path : '';
  const diagnostics = Array.isArray(builder.diagnostics) ? builder.diagnostics : [];
  const diagRecords = diagnostics.map(formatInspectorDiagnostic);
  const visibleDiagnostics = diagRecords.filter((d) => d.severity !== 'WARNING' || isWorkspaceFile(d.file));
  const warnings = visibleDiagnostics.filter((d) => d.severity === 'WARNING').length;
  const errors = visibleDiagnostics.filter(d => d.severity === 'ERROR').length;
  const sections = Array.isArray(builder.executable_sections_size)
    ? builder.executable_sections_size.map(cleanSectionSize)
    : [];
  const mapInfo = await analyzeInspectorMap(buildPath, sketchDir);
  const libraries = Array.isArray(builder.used_libraries)
    ? builder.used_libraries.map(formatInspectorLibrary)
    : [];
  const buildProps = Array.isArray(builder.build_properties)
    ? builder.build_properties.map(formatBuildProp).filter(Boolean)
    : [];
  const filesMeta = await gatherInspectorFiles(buildPath, mapInfo.mapPath);
  const payload = {
    success: !!data.success,
    message: data.success ? t('inspectorAnalysisSuccess') : t('inspectorAnalysisFailed', { msg: stderr.trim() || `exit ${code}` }),
    summary: {
      sketchDir,
      inoPath,
      profile,
      usedProfile,
      usedFqbn,
      buildPath,
      warnings,
      errors,
      exitCode: code,
      relativeSketch: workspaceRelativePath(sketchDir)
    },
    diagnostics: visibleDiagnostics,
    sections,
    map: mapInfo.payload,
    libraries,
    buildProps,
    compilerOut: typeof data.compiler_out === 'string' ? data.compiler_out : '',
    compilerErr: typeof data.compiler_err === 'string' ? data.compiler_err : '',
    rawJson: JSON.stringify(data, null, 2),
    files: filesMeta.public
  };
  return { payload, filesMeta: filesMeta.private };
}

function formatInspectorDiagnostic(diag) {
  const severity = String(diag?.severity || '').toUpperCase();
  const message = String(diag?.message || '').trim();
  const location = diag?.location || {};
  const file = typeof location.file === 'string'
    ? location.file
    : (typeof diag?.file === 'string' ? diag.file : '');
  const line = typeof location.line === 'number'
    ? location.line
    : (typeof diag?.line === 'number' ? diag.line : undefined);
  const column = typeof location.column === 'number'
    ? location.column
    : (typeof diag?.column === 'number' ? diag.column : undefined);
  return {
    severity,
    message,
    file,
    relative: file ? workspaceRelativePath(file) : '',
    line,
    column
  };
}

function formatInspectorLibrary(lib) {
  return {
    name: String(lib?.name || ''),
    version: String(lib?.version || ''),
    location: String(lib?.location || ''),
    sourceDir: String(lib?.source_dir || ''),
    installDir: String(lib?.install_dir || '')
  };
}

function formatBuildProp(entry) {
  const text = String(entry || '');
  const idx = text.indexOf('=');
  if (idx <= 0) return null;
  const key = text.slice(0, idx).trim();
  const value = text.slice(idx + 1).trim();
  if (!key) return null;
  return { key, value };
}

function cleanSectionSize(entry) {
  return {
    name: String(entry?.name || ''),
    size: Number(entry?.size || 0),
    max: Number(entry?.max_size || 0)
  };
}

async function gatherInspectorFiles(buildPath, mapPath) {
  const privateMap = {};
  const publicMap = {};
  if (buildPath) {
    const targets = [
      { key: 'partitions', name: 'partitions.csv' },
      { key: 'sdkconfig', name: 'sdkconfig' }
    ];
    for (const target of targets) {
      const full = path.join(buildPath, target.name);
      try {
        const uri = vscode.Uri.file(full);
        const stat = await vscode.workspace.fs.stat(uri);
        privateMap[target.key] = { path: full, size: stat.size || 0 };
        publicMap[target.key] = { path: full, size: stat.size || 0 };
      } catch (_) { }
    }
  }
  if (mapPath) {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(mapPath));
      privateMap.map = { path: mapPath, size: stat.size || 0 };
      publicMap.map = { path: mapPath, size: stat.size || 0 };
    } catch (_) { }
  }
  return { private: privateMap, public: publicMap };
}

async function analyzeInspectorMap(buildPath, sketchDir) {
  const warnings = [];
  if (!buildPath) {
    warnings.push(t('inspectorMapMissing'));
    return { mapPath: '', payload: { sections: [], topSymbols: [], topObjects: [], warnings } };
  }
  let mapPath = '';
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(buildPath));
    for (const [name, kind] of entries) {
      if (kind === vscode.FileType.File && name.toLowerCase().endsWith('.map')) {
        mapPath = path.join(buildPath, name);
        break;
      }
    }
  } catch (_) { }
  if (!mapPath) {
    warnings.push(t('inspectorMapMissing'));
    return { mapPath: '', payload: { sections: [], topSymbols: [], topObjects: [], warnings } };
  }
  let text = '';
  try {
    text = await readTextFile(vscode.Uri.file(mapPath));
  } catch (err) {
    warnings.push(t('inspectorMapParseFailed', { msg: err && err.message ? err.message : String(err) }));
    return { mapPath, payload: { sections: [], topSymbols: [], topObjects: [], warnings } };
  }
  const entries = parseMapEntries(text);
  if (!entries.length) {
    warnings.push(t('inspectorMapNoSymbols'));
    return { mapPath, payload: { sections: [], topSymbols: [], topObjects: [], warnings } };
  }
  const bySection = new Map();
  const byObject = new Map();
  for (const entry of entries) {
    const sec = bySection.get(entry.root) || { name: entry.root, size: 0, count: 0 };
    sec.size += entry.size;
    sec.count += 1;
    bySection.set(entry.root, sec);
    const objKey = entry.objectFile;
    const obj = byObject.get(objKey) || { objectFile: objKey, size: 0, count: 0 };
    obj.size += entry.size;
    obj.count += 1;
    byObject.set(objKey, obj);
  }
  const sections = Array.from(bySection.values()).sort((a, b) => b.size - a.size);
  const topSymbols = entries
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, 50)
    .map((entry) => ({
      symbol: entry.symbol,
      section: entry.root,
      size: entry.size,
      object: workspaceRelativePath(entry.objectFile)
    }));
  const topObjects = Array.from(byObject.values())
    .sort((a, b) => b.size - a.size)
    .slice(0, 30)
    .map((entry) => ({
      object: workspaceRelativePath(entry.objectFile),
      size: entry.size,
      count: entry.count
    }));
  return {
    mapPath,
    payload: {
      sections,
      topSymbols,
      topObjects,
      warnings
    }
  };
}

function parseMapEntries(text) {
  const lines = String(text || '').split(/\r?\n/);
  const entries = [];
  let pendingSection = '';
  for (const raw of lines) {
    const line = raw || '';
    const full = line.match(/^\s+\.(\S+)\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)\s+(.+)$/);
    if (full) {
      const entry = buildMapEntry(full[1], full[2], full[3], full[4]);
      if (entry) entries.push(entry);
      pendingSection = '';
      continue;
    }
    const header = line.match(/^\s+\.(\S+)\s*$/);
    if (header) {
      pendingSection = header[1];
      continue;
    }
    const cont = line.match(/^\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)\s+(.+)$/);
    if (pendingSection && cont) {
      const entry = buildMapEntry(pendingSection, cont[1], cont[2], cont[3]);
      if (entry) entries.push(entry);
      pendingSection = '';
    }
  }
  return entries;
}

function buildMapEntry(sectionName, addrHex, sizeHex, tail) {
  const size = parseInt(sizeHex, 16);
  if (!Number.isFinite(size) || size <= 0) return null;
  const address = parseInt(addrHex, 16);
  const objectMatch = (tail || '').match(/^(.*?)(?:\s+\(([^()]+)\))?\s*$/);
  const objectFile = objectMatch ? String(objectMatch[1] || '').trim() : String(tail || '').trim();
  const symSuffix = objectMatch && objectMatch[2] ? objectMatch[2].trim() : '';
  const raw = sectionName.startsWith('.') ? sectionName.slice(1) : sectionName;
  const dotIdx = raw.indexOf('.');
  const root = dotIdx >= 0 ? raw.slice(0, dotIdx) : raw;
  const symbol = dotIdx >= 0 ? raw.slice(dotIdx + 1) : raw;
  return {
    root,
    section: sectionName,
    symbol: symSuffix || symbol,
    address,
    size,
    objectFile
  };
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}
/**
 * Open a webview that lists Arduino examples from:
 * - Platform path detected via `compile --show-properties` (runtime.platform.path/build.board.platform.path)
 * - Libraries listed in sketch.yaml, mapped via compile_commands.json include paths
 * Provides filtering, grep, preview, and copy-to-project features.
 */
async function commandOpenExamplesBrowser(ctx) {
  const panel = vscode.window.createWebviewPanel(
    'arduinoExamplesBrowser',
    'Arduino Examples',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  try {
    const htmlUri = vscode.Uri.joinPath(extContext.extensionUri, 'html', 'examples.html');
    let html = await readTextFile(htmlUri);
    panel.webview.html = html;
  } catch (e) {
    showError(e);
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'requestExamples': {
          const examples = await collectExamplesForCurrentSketch(ctx && ctx.sketchDir ? String(ctx.sketchDir) : '');
          panel.webview.postMessage({ type: 'examples', items: examples });
          break;
        }
        case 'readFile': {
          const p = String(msg.path || '');
          if (!p) return;
          const text = await readTextFile(vscode.Uri.file(p));
          panel.webview.postMessage({ type: 'fileContent', path: p, content: text });
          break;
        }
        case 'grep': {
          const pattern = String(msg.pattern || '').trim();
          const files = Array.isArray(msg.files) ? msg.files.map(String) : [];
          if (!pattern || files.length === 0) { panel.webview.postMessage({ type: 'grepResult', matches: [] }); return; }
          const re = makeGrepRegex(pattern);
          const matches = [];
          for (const f of files) {
            try {
              const text = await readTextFile(vscode.Uri.file(f));
              if (re.test(text)) matches.push(f);
            } catch { }
          }
          panel.webview.postMessage({ type: 'grepResult', matches });
          break;
        }
        case 'copyToClipboard': {
          const text = typeof msg.content === 'string' ? msg.content : '';
          const clipPath = String(msg.path || '');
          try {
            await vscode.env.clipboard.writeText(text);
            panel.webview.postMessage({ type: 'clipboardCopied', path: clipPath });
            const baseLabel = clipPath ? clipPath.split(/[\\/]/).pop() || '' : '';
            const statusMsg = baseLabel ? 'Copied to clipboard: ' + baseLabel : 'Copied sketch to clipboard';
            vscode.window.setStatusBarMessage(statusMsg, 2000);
          } catch (err) {
            showError(err);
          }
          break;
        }
        case 'copyToProject': {
          const inoPath = String(msg.path || '');
          if (!inoPath) return;
          const dest = await copyExampleToProject(inoPath);
          if (dest) {
            vscode.window.setStatusBarMessage(`Copied to: ${dest}`, 2000);
            panel.webview.postMessage({ type: 'copied', dest });
          }
          break;
        }
      }
    } catch (e) { showError(e); }
  });
}

function makeGrepRegex(pattern) {
  // Simple: if pattern looks like /foo/i use as regex; else escape
  try {
    const m = String(pattern).match(/^\s*\/(.*)\/([a-z]*)\s*$/i);
    if (m) return new RegExp(m[1], m[2]);
  } catch { }
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(esc, 'i');
}

async function collectExamplesForCurrentSketch(preferSketchDir = '') {
  let sketchDir = '';
  if (preferSketchDir) {
    sketchDir = preferSketchDir;
  } else {
    const picked = await pickInoFromWorkspace();
    if (!picked) return [];
    sketchDir = path.dirname(picked);
  }
  const list = [];
  // Platform examples via show-properties
  try {
    const props = await getShowProperties(sketchDir);
    const platformRoots = [];
    if (props['runtime.platform.path']) platformRoots.push(props['runtime.platform.path']);
    if (props['build.board.platform.path'] && props['build.board.platform.path'] !== props['runtime.platform.path']) {
      platformRoots.push(props['build.board.platform.path']);
    }
    for (const root of platformRoots) {
      const items = await scanExamplesUnderRoot(root, 'platform');
      for (const it of items) list.push(it);
    }
  } catch { }
  // Library examples via sketch.yaml libraries + compile_commands.json include paths
  try {
    const libRoots = await detectLibraryRootsFromCompileCommands(sketchDir);
    for (const r of libRoots) {
      const items = await scanExamplesUnderRoot(r, 'library');
      for (const it of items) list.push(it);
    }
  } catch { }
  // Dedup by absolute path
  const seen = new Set();
  return list.filter(it => { const k = it.path; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function getShowProperties(sketchDir) {
  if (!(await ensureCliReady())) return {};
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'compile'];
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = yamlInfo.defaultProfile || yamlInfo.profiles[0];
    args.push('--profile', profile);
  } else {
    const fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (fqbn) args.push('--fqbn', fqbn);
  }
  args.push('--show-properties');
  args.push(sketchDir);
  let out = '';
  await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { shell: false, cwd: sketchDir });
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', () => { /* ignore */ });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : resolve()); // tolerate non-zero
  });
  const props = {};
  for (const line of String(out).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) props[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return props;
}

async function scanExamplesUnderRoot(rootPath, kind) {
  const results = [];
  const root = String(rootPath || '').trim();
  if (!root) return results;
  const rootUri = vscode.Uri.file(root);
  const exists = await pathExists(rootUri);
  if (!exists) return results;
  // Find directories named 'examples'
  const exampleDirs = await findDirectoriesNamed(rootUri, 'examples', 4); // limit depth a bit
  for (const exUri of exampleDirs) {
    const parent = path.basename(path.dirname(exUri.fsPath));
    const inoFiles = await findFilesWithExtension(exUri, '.ino', 4);
    for (const f of inoFiles) {
      const rel = path.relative(exUri.fsPath, f.fsPath).replace(/\\/g, '/');
      results.push({
        kind,
        parent,
        relUnderExamples: rel,
        label: `${parent} : ${rel}`,
        path: f.fsPath
      });
    }
  }
  return results;
}

async function findDirectoriesNamed(baseUri, name, maxDepth = 5, depth = 0) {
  const out = [];
  try {
    if (depth > maxDepth) return out;
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    for (const [fname, ftype] of entries) {
      if (ftype === vscode.FileType.Directory) {
        const child = vscode.Uri.joinPath(baseUri, fname);
        if (fname.toLowerCase() === name.toLowerCase()) out.push(child);
        else {
          // Skip heavy dirs
          if (/^(tools|docs|test|tests|examples|build|out|dist|\.git)$/i.test(fname)) continue;
          const nested = await findDirectoriesNamed(child, name, maxDepth, depth + 1);
          for (const u of nested) out.push(u);
        }
      }
    }
  } catch { }
  return out;
}

async function findFilesWithExtension(baseUri, ext, maxDepth = 5, depth = 0) {
  const out = [];
  try {
    if (depth > maxDepth) return out;
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    for (const [fname, ftype] of entries) {
      const child = vscode.Uri.joinPath(baseUri, fname);
      if (ftype === vscode.FileType.File) {
        if (fname.toLowerCase().endsWith(ext.toLowerCase())) out.push(child);
      } else if (ftype === vscode.FileType.Directory) {
        const nested = await findFilesWithExtension(child, ext, maxDepth, depth + 1);
        for (const u of nested) out.push(u);
      }
    }
  } catch { }
  return out;
}

async function detectLibraryRootsFromCompileCommands(sketchDir) {
  const roots = new Set();
  // Read libraries from sketch.yaml
  let libs = [];
  try {
    const info = await readSketchYamlInfo(sketchDir);
    const profile = info?.defaultProfile || (info?.profiles && info.profiles[0]) || '';
    if (profile) libs = await getLibrariesFromSketchYaml(sketchDir, profile);
  } catch { }
  const libNames = libs.map(x => String(x.name || '').trim()).filter(Boolean);
  if (libNames.length === 0) return Array.from(roots);
  const libNamesLower = libNames.map(name => name.toLowerCase());
  const outputInfo = resolveCompileCommandsOutput(sketchDir);
  const commandsUri = outputInfo.destUri;
  let entries = [];
  try {
    const raw = await readTextFile(commandsUri);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed;
  } catch { entries = []; }

  const cleanToken = (token) => String(token || '').replace(/^"|"$/g, '');
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const baseDir = typeof entry.directory === 'string' && entry.directory ? entry.directory : sketchDir;
    let tokens = [];
    if (Array.isArray(entry.arguments)) {
      tokens = entry.arguments.map(cleanToken);
    } else if (typeof entry.command === 'string') {
      tokens = (entry.command.match(/(?:"[^"\r\n]*"|[^\s"\r\n]+)/g) || []).map(cleanToken);
    }
    if (tokens.length === 0) continue;
    for (let i = 0; i < tokens.length; i++) {
      let tok = tokens[i];
      if (!tok) continue;
      let includePath = '';
      if (tok === '-I' || tok === '-isystem') {
        includePath = tokens[i + 1] || '';
        i++;
      } else if (tok.startsWith('-I')) {
        includePath = tok.slice(2);
      } else if (tok.startsWith('-isystem')) {
        includePath = tok.slice(8);
      }
      if (!includePath) continue;
      includePath = cleanToken(includePath);
      if (!includePath) continue;
      let absolute = includePath;
      if (!path.isAbsolute(absolute)) {
        try { absolute = path.resolve(baseDir, absolute); } catch { absolute = includePath; }
      }
      absolute = path.normalize(absolute).replace(/[\\/]+$/, '');
      if (!absolute) continue;
      const segments = absolute.split(/[\\/]+/);
      const segmentsLower = segments.map(s => s.toLowerCase());
      for (const nameLower of libNamesLower) {
        if (segmentsLower.includes(nameLower)) {
          let rootCandidate = absolute;
          const idxSrc = segmentsLower.lastIndexOf('src');
          if (idxSrc >= 0) {
            rootCandidate = segments.slice(0, idxSrc).join(path.sep);
          }
          roots.add(path.normalize(rootCandidate));
        }
      }
    }
  }

  const verified = [];
  for (const r of roots) {
    try {
      const uri = vscode.Uri.file(r);
      if (await pathExists(uri)) verified.push(r);
    } catch { }
  }
  return verified;
}

async function copyExampleToProject(inoPath) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) { vscode.window.showWarningMessage('No workspace folder open.'); return ''; }
  const projectRoot = folders[0].uri.fsPath;
  const examplesDest = path.join(projectRoot, 'examples');
  const srcDir = path.dirname(inoPath);
  const baseName = path.basename(srcDir);
  await ensureDir(vscode.Uri.file(examplesDest));
  // Resolve unique folder name
  let destDir = path.join(examplesDest, baseName);
  let suffix = 1;
  while (await pathExists(vscode.Uri.file(destDir))) {
    suffix++;
    destDir = path.join(examplesDest, `${baseName}_${suffix}`);
  }
  await copyDirectoryRecursive(vscode.Uri.file(srcDir), vscode.Uri.file(destDir));
  // Rename primary .ino to match dest folder
  try {
    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(destDir));
    const ino = files.find(([n, t]) => t === vscode.FileType.File && /\.ino$/i.test(n));
    if (ino) {
      const oldPath = vscode.Uri.file(path.join(destDir, ino[0]));
      const newPath = vscode.Uri.file(path.join(destDir, path.basename(destDir) + '.ino'));
      try { await vscode.workspace.fs.rename(oldPath, newPath, { overwrite: false }); } catch { }
    }
  } catch { }
  // Also copy the sketch.yaml used by the current project into the copied example
  try {
    let sketchDir = await detectSketchDirForStatus();
    if (!sketchDir) {
      const inoPick = await pickInoFromWorkspace();
      if (inoPick) sketchDir = path.dirname(inoPick);
    }
    if (sketchDir) {
      const yamlSrc = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
      if (await pathExists(yamlSrc)) {
        const yamlDstDefault = vscode.Uri.file(path.join(destDir, 'sketch.yaml'));
        if (!(await pathExists(yamlDstDefault))) {
          const data = await vscode.workspace.fs.readFile(yamlSrc);
          await vscode.workspace.fs.writeFile(yamlDstDefault, data);
        } else {
          const yamlDstAlt = vscode.Uri.file(path.join(destDir, 'sketch.project.yaml'));
          const data = await vscode.workspace.fs.readFile(yamlSrc);
          await vscode.workspace.fs.writeFile(yamlDstAlt, data);
        }
      }
    }
  } catch { }
  return destDir;
}

async function ensureDir(uri) {
  try { await vscode.workspace.fs.createDirectory(uri); } catch { }
}

async function copyDirectoryRecursive(src, dst) {
  await ensureDir(dst);
  const entries = await vscode.workspace.fs.readDirectory(src);
  for (const [name, type] of entries) {
    const s = vscode.Uri.joinPath(src, name);
    const d = vscode.Uri.joinPath(dst, name);
    if (type === vscode.FileType.Directory) {
      await copyDirectoryRecursive(s, d);
    } else if (type === vscode.FileType.File) {
      const data = await vscode.workspace.fs.readFile(s);
      await vscode.workspace.fs.writeFile(d, data);
    }
  }
}

/** Get `port` value from sketch.yaml under a specific profile (string or empty). */
async function getPortFromSketchYaml(sketchDir, profileName) {
  try {
    const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
    const text = await readTextFile(yamlUri);
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    let inTarget = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) { if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true; continue; }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) { inTarget = (mKey[1].trim() === profileName); continue; }
      if (!inTarget) { if (/^\S/.test(line)) break; else continue; }
      const mPort = line.match(/^\s{4}port\s*:\s*(.+)\s*$/);
      if (mPort) return mPort[1].trim().replace(/^"|"$/g, '');
    }
  } catch { }
  return '';
}

/** Get `port_config.baudrate` from sketch.yaml under a specific profile (string or empty). */
async function getPortConfigBaudFromSketchYaml(sketchDir, profileName) {
  try {
    const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
    const text = await readTextFile(yamlUri);
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    let inTarget = false;
    let inPortCfg = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) { if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true; continue; }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) { inTarget = (mKey[1].trim() === profileName); inPortCfg = false; continue; }
      if (!inTarget) { if (/^\S/.test(line)) break; else continue; }
      if (/^\s{4}port_config\s*:\s*$/.test(line)) { inPortCfg = true; continue; }
      if (inPortCfg) {
        const mBaud = line.match(/^\s{6}baudrate\s*:\s*(.+)\s*$/);
        if (mBaud) return mBaud[1].trim().replace(/^"|"$/g, '');
        // leave when next sibling key or out of profile
        if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\s{2}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\S/.test(line)) {
          inPortCfg = false; continue;
        }
      }
    }
  } catch { }
  return '';
}

/**
 * Extract the raw YAML block for the given profile from sketch.yaml.
 * Returns an empty string when not found.
 */
async function getProfileBlockFromSketchYaml(sketchDir, profileName) {
  try {
    const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
    const text = await readTextFile(yamlUri);
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) {
        if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true;
        continue;
      }
      const m = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (m) {
        const name = m[1].trim();
        if (start >= 0) { end = i; break; }
        if (!profileName || name === profileName) { start = i; }
        continue;
      }
      // Stop at top-level or default_profile
      if (start >= 0 && (/^\s*default_profile\s*:\s*/.test(line) || /^\S/.test(line))) {
        end = i; break;
      }
    }
    if (start >= 0 && end < 0) end = lines.length;
    if (start >= 0 && end > start) {
      return lines.slice(start, end).join('\n') + (text.endsWith('\n') ? '' : '\n');
    }
  } catch { }
  return '';
}

/** Parse `port` from provided sketch.yaml text under a specific profile. */
function getPortFromSketchYamlText(text, profileName) {
  try {
    const lines = String(text || '').split(/\r?\n/);
    let inProfiles = false;
    let inTarget = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) { if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true; continue; }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) { inTarget = (mKey[1].trim() === profileName); continue; }
      if (!inTarget) { if (/^\S/.test(line)) break; else continue; }
      const mPort = line.match(/^\s{4}port\s*:\s*(.+)\s*$/);
      if (mPort) return mPort[1].trim().replace(/^"|"$/g, '');
    }
  } catch { }
  return '';
}

/** Parse `port_config.baudrate` from provided sketch.yaml text under a specific profile. */
function getPortConfigBaudFromSketchYamlText(text, profileName) {
  try {
    const lines = String(text || '').split(/\r?\n/);
    let inProfiles = false;
    let inTarget = false;
    let inPortCfg = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) { if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true; continue; }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) { inTarget = (mKey[1].trim() === profileName); inPortCfg = false; continue; }
      if (!inTarget) { if (/^\S/.test(line)) break; else continue; }
      if (/^\s{4}port_config\s*:\s*$/.test(line)) { inPortCfg = true; continue; }
      if (inPortCfg) {
        const mBaud = line.match(/^\s{6}baudrate\s*:\s*(.+)\s*$/);
        if (mBaud) return mBaud[1].trim().replace(/^"|"$/g, '');
        if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\s{2}[^\s:#][^:]*\s*:\s*$/.test(line) || /^\S/.test(line)) {
          inPortCfg = false; continue;
        }
      }
    }
  } catch { }
  return '';
}
