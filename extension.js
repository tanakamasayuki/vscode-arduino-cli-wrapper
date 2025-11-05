// JavaScript-only VS Code extension that wraps Arduino CLI
// No external dependencies; uses Node's child_process and VS Code API.

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');
const path = require('path');
const https = require('https');

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const AUTO_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let cachedLatestArduinoCliTag = '';
let cachedLatestArduinoCliTagFetchedAt = 0;
let cachedBoardDetailsJson = null;
let cachedBoardDetailsFetchedAt = 0;
let cachedLibraryDetailsJson = null;
let cachedLibraryDetailsFetchedAt = 0;

const DEFAULT_WOKWI_TOML = '[wokwi]\nversion = 1\nfirmware = "wokwi.elf"\n';
const EXTRA_FLAGS_FILENAME = '.arduino-cli-flags';
const BUILD_OPT_FILE_NAME = 'build_opt.h';
const BUILD_OPT_LANGUAGE_ID = 'arduino-build-options';
const DEFAULT_WOKWI_DIAGRAM_BASE = Object.freeze({
  version: 1,
  author: 'wokwi',
  editor: 'wokwi',
  dependencies: {}
});
const WOKWI_DIAGRAM_TEMPLATES = Object.freeze({
  'arduino:avr:uno': {
    parts: [{ type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0, attrs: {} }],
    connections: []
  },
  'arduino:avr:mega': {
    parts: [{ type: 'wokwi-arduino-mega', id: 'mega', top: 0, left: 0, attrs: {} }],
    connections: []
  },
  'arduino:avr:nano': {
    parts: [{ type: 'wokwi-arduino-nano', id: 'nano', top: 0, left: 0, attrs: {} }],
    connections: []
  },
  'esp32:esp32:esp32s3box': {
    parts: [
      {
        type: 'board-esp32-s3-box-3',
        id: 'esp32',
        top: -24.91,
        left: -388.54,
        attrs: { psramSize: '16', flashSize: '16' }
      }
    ],
    connections: [
      ['$serialMonitor:RX', 'esp32:G14', '', []],
      ['$serialMonitor:TX', 'esp32:G11', '', []]
    ]
  },
  'esp32:esp32:m5stack_cores3': {
    parts: [
      {
        type: 'board-m5stack-core-s3',
        id: 'board',
        top: -179.23,
        left: -62.59,
        attrs: { serialInterface: 'USB_SERIAL_JTAG' }
      }
    ],
    connections: []
  },
  'm5stack:esp32:m5stack_cores3': {
    parts: [
      {
        type: 'board-m5stack-core-s3',
        id: 'board',
        top: -179.23,
        left: -62.59,
        attrs: { serialInterface: 'USB_SERIAL_JTAG' }
      }
    ],
    connections: []
  },
  'esp32:esp32:xiao_esp32c3': {
    parts: [
      { type: 'board-xiao-esp32-c3', id: 'esp', top: 38.97, left: 13.78, attrs: {} },
      { type: 'wokwi-led', id: 'led1', top: 6, left: -73, attrs: { color: 'red' } },
      { type: 'wokwi-resistor', id: 'r1', top: 147.95, left: -57.6, attrs: { value: '1000' } },
      { type: 'wokwi-led', id: 'led2', top: 15.6, left: -101.8, attrs: { color: 'green' } },
      { type: 'wokwi-resistor', id: 'r2', top: 167.15, left: -57.6, attrs: { value: '1000' } },
      { type: 'wokwi-junction', id: 'j1', top: 148.8, left: 24, attrs: {} },
      { type: 'wokwi-led', id: 'led3', top: 25.2, left: -130.6, attrs: { color: 'blue' } },
      { type: 'wokwi-resistor', id: 'r3', top: 186.35, left: -57.6, attrs: { value: '1000' } }
    ],
    connections: [
      ['esp:D2', 'led1:A', 'green', ['h0']],
      ['led1:C', 'r1:1', 'black', ['v0']],
      ['esp:D3', 'led2:A', 'green', ['h0']],
      ['led2:C', 'r2:1', 'black', ['v0']],
      ['r2:2', 'j1:J', 'black', ['v0', 'h27.6']],
      ['j1:J', 'r1:2', 'black', ['v0']],
      ['esp:GND', 'j1:J', 'black', ['h19.82', 'v86.4']],
      ['led3:A', 'esp:D4', 'green', ['v0']],
      ['led3:C', 'r3:1', 'black', ['v0']],
      ['j1:J', 'r3:2', 'black', ['v0']]
    ]
  },
  'esp32:esp32:xiao_esp32c6': {
    parts: [
      { type: 'board-xiao-esp32-c6', id: 'esp', top: 38.97, left: 13.78, attrs: {} },
      { type: 'wokwi-led', id: 'led1', top: 6, left: -73, attrs: { color: 'red' } },
      { type: 'wokwi-resistor', id: 'r1', top: 147.95, left: -57.6, attrs: { value: '1000' } },
      { type: 'wokwi-led', id: 'led2', top: 15.6, left: -101.8, attrs: { color: 'green' } },
      { type: 'wokwi-resistor', id: 'r2', top: 167.15, left: -57.6, attrs: { value: '1000' } },
      { type: 'wokwi-junction', id: 'j1', top: 148.8, left: 24, attrs: {} },
      { type: 'wokwi-led', id: 'led3', top: 25.2, left: -130.6, attrs: { color: 'blue' } },
      { type: 'wokwi-resistor', id: 'r3', top: 186.35, left: -57.6, attrs: { value: '1000' } }
    ],
    connections: [
      ['esp:D2', 'led1:A', 'green', ['h0']],
      ['led1:C', 'r1:1', 'black', ['v0']],
      ['esp:D3', 'led2:A', 'green', ['h0']],
      ['led2:C', 'r2:1', 'black', ['v0']],
      ['r2:2', 'j1:J', 'black', ['v0', 'h27.6']],
      ['j1:J', 'r1:2', 'black', ['v0']],
      ['esp:GND', 'j1:J', 'black', ['h19.82', 'v86.4']],
      ['led3:A', 'esp:D4', 'green', ['v0']],
      ['led3:C', 'r3:1', 'black', ['v0']],
      ['j1:J', 'r3:2', 'black', ['v0']]
    ]
  },
  'esp32:esp32:xiao_esp32s3': {
    parts: [
      { type: 'board-xiao-esp32-s3', id: 'esp', top: 38.97, left: 13.78, attrs: {} },
      { type: 'wokwi-led', id: 'led1', top: 6, left: -73, attrs: { color: 'red' } },
      { type: 'wokwi-resistor', id: 'r1', top: 147.95, left: -57.6, attrs: { value: '1000' } },
      { type: 'wokwi-led', id: 'led2', top: 15.6, left: -101.8, attrs: { color: 'green' } },
      { type: 'wokwi-resistor', id: 'r2', top: 167.15, left: -57.6, attrs: { value: '1000' } },
      { type: 'wokwi-junction', id: 'j1', top: 148.8, left: 24, attrs: {} },
      { type: 'wokwi-led', id: 'led3', top: 25.2, left: -130.6, attrs: { color: 'blue' } },
      { type: 'wokwi-resistor', id: 'r3', top: 186.35, left: -57.6, attrs: { value: '1000' } }
    ],
    connections: [
      ['esp:D2', 'led1:A', 'green', ['h0']],
      ['led1:C', 'r1:1', 'black', ['v0']],
      ['esp:D3', 'led2:A', 'green', ['h0']],
      ['led2:C', 'r2:1', 'black', ['v0']],
      ['r2:2', 'j1:J', 'black', ['v0', 'h27.6']],
      ['j1:J', 'r1:2', 'black', ['v0']],
      ['esp:GND', 'j1:J', 'black', ['h19.82', 'v86.4']],
      ['led3:A', 'esp:D4', 'green', ['v0']],
      ['led3:C', 'r3:1', 'black', ['v0']],
      ['j1:J', 'r3:2', 'black', ['v0']]
    ]
  }
});
const WOKWI_GENERIC_ESP32_TEMPLATE = Object.freeze({
  parts: [{ type: 'board-esp32-devkit-c-v4', id: 'esp', top: 0, left: 0, attrs: {} }],
  connections: [
    ['esp:TX', '$serialMonitor:RX', '', []],
    ['esp:RX', '$serialMonitor:TX', '', []]
  ]
});
const WOKWI_EXTENSION_IDS = ['wokwi.wokwi-vscode', 'wokwi.wokwi-vscode-preview'];
const WOKWI_VIEW_TYPES = ['wokwi.diagram', 'wokwi.wokwi', 'wokwi.diagramEditor'];

const OUTPUT_NAME = 'Arduino CLI';
const STATE_FQBN = 'arduino-cli.selectedFqbn';
const STATE_PORT = 'arduino-cli.selectedPort';
const STATE_BAUD = 'arduino-cli.selectedBaud';
const STATE_LAST_PROFILE = 'arduino-cli.lastProfileApplied';
const STATE_LAST_AUTO_UPDATE = 'arduino-cli.lastAutoUpdateAt';
const STATE_SELECTED_SKETCH = 'arduino-cli.selectedSketchDir';
const STATE_SELECTED_PROFILE = 'arduino-cli.selectedProfile';
const PORT_NONE_SENTINEL = '__arduino-cli-port-none__';
const PICK_NO_PORT = '__arduino-cli-pick-no-port__';
const VALID_WARNING_LEVELS = new Set(['workspace', 'none', 'default', 'more', 'all']);
const BUILD_DIR_NAME = '.build';
let output;
let extContext;
let statusBuild, statusUpload, statusMonitor, statusFqbn, statusPort, statusBaud, statusWarnings;
let compileDiagnostics;
const PROGRESS_BUSY = Symbol('progressBusyNotification');
let notificationProgressActive = false;
let monitorTerminal;
// Log terminal (ANSI capable, no command execution)
let logTerminal;
let logTermWriteEmitter;
let timezoneDefineCache;
let autoUpdateInFlight = false;
let lastAutoUpdateAt = 0;

// Simple i18n without external deps.
// Note: We intentionally avoid bundling any library to keep
// this extension lightweight and compatible with VS Code's
// extension host sandbox.
const _locale = (vscode.env.language || 'en').toLowerCase();
const _isJa = _locale.startsWith('ja');
const _remoteName = (vscode.env.remoteName || '').toLowerCase();
const _isWslEnv = (() => {
  if (_remoteName === 'wsl') return true;
  if (_remoteName.startsWith('wsl+')) return true;
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  const rel = typeof os.release === 'function' ? os.release() : '';
  if (!rel) return false;
  const lower = String(rel).toLowerCase();
  return lower.includes('microsoft') || lower.includes('wsl');
})();
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
    compileCommandsRebuiltFromCache: 'Reconstructed compile_commands.json from includes.cache ({count} entries).',
    sketchYamlCreateStart: '[sketch.yaml] Create start: {dir}',
    sketchYamlExistsOpen: 'sketch.yaml already exists. Open it?',
    open: 'Open',
    cancel: 'Cancel',
    sketchYamlExists: '[sketch.yaml] Already exists: {path}',
    sketchYamlNoFqbn: '[sketch.yaml] FQBN is not set. Skip dump-profile.',
    sketchYamlFetching: '[sketch.yaml] Getting dump-profile…',
    sketchYamlEmpty: '[sketch.yaml] dump-profile output is empty (no profiles appended)',
    sketchYamlCreated: 'Created sketch.yaml.',
    secretsLensOpen: '🔐 Open arduino_secrets.h',
    secretsLensCreate: '📝 Create arduino_secrets.h',
    secretsSelectIno: 'Focus an .ino file to manage arduino_secrets.h.',
    secretsHeaderMissing: 'arduino_secrets.h was not found at {path}. Use the Create action to generate it.',
    secretsCreated: 'Created arduino_secrets.h at {path}.',
    secretsCreatedNoDefaults: 'Created arduino_secrets.h at {path}. No fallback #define entries were found; update the file manually.',
    sketchYamlCreateDone: '[sketch.yaml] Create done: {path}',
    defaultProfileSet: '[sketch.yaml] Set default_profile: {name}',
    setFqbnPickTitle: 'Select FQBN',
    setFqbnManual: 'Enter FQBN manually…',
    setFqbnUnsetWarn: 'FQBN is not selected',
    statusSetFqbn: 'FQBN set: {fqbn}',
    monitorPickPortTitle: 'Select port from board list',
    portScanProgressTitle: 'Detecting serial ports…',
    portScanProgressMessage: 'Querying connected boards via arduino-cli',
    compileProgressTitle: 'Compiling sketch…',
    compileProgressMessage: 'Running arduino-cli compile…',
    compileProgressMessageProfile: 'Running arduino-cli compile for profile {profile}',
    compileProgressMessageFqbn: 'Running arduino-cli compile for {fqbn}',
    compileExtraFlagsApplied: 'Added build.extra_flags from {file}',
    compileExtraFlagsReadError: 'Failed to read extra flags file {file}: {msg}',
    compileExtraFlagsEmpty: 'Extra flags file {file} is empty; skipping.',
    compileExtraFlagsSkipExisting: 'Skipped {file} because build.extra_flags is already provided.',
    uploadProgressTitle: 'Uploading sketch…',
    uploadProgressMessage: 'Running arduino-cli upload…',
    uploadProgressMessageProfile: 'Running arduino-cli upload for profile {profile}',
    uploadProgressMessageFqbn: 'Running arduino-cli upload for {fqbn}',
    uploadDataProgressTitle: 'Uploading data image…',
    uploadDataProgressMessageResolve: 'Collecting filesystem metadata…',
    uploadDataProgressMessageBuild: 'Building {fsType} image…',
    uploadDataProgressMessageFlash: 'Flashing filesystem image via esptool…',
    progressBusyWarn: 'Another command is already running. Please wait for it to finish.',
    setPortManual: 'Enter port manually…',
    setPortNoSerial: 'External programmer (JTAG/SWD/ISP)',
    setPortNoSerialDescription: 'Choose this when uploading with a dedicated programmer instead of a serial port',
    setPortNoSerialDetail: 'Skips passing -p so external programmers like JTAG, SWD, or ISP can handle the upload.',
    portUnsetWarn: 'Port is not selected',
    statusSetPort: 'Port set: {port}{withFqbn}',
    portNoSerialStatus: 'Programmer mode (no serial port)',
    portNoSerialTooltip: 'Serial port intentionally unset for programmer-based uploads (JTAG/SWD/ISP). Click to change.',
    portNoSerialMonitorWarn: 'Serial monitor needs a serial port. Select one before starting or exit programmer mode.',
    uploadNoSerialInfo: '[upload] Serial port omitted: continuing without -p for programmer-based workflow (JTAG/SWD/ISP).',
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
    compileDurationGeneric: '[{label}] Completed in {seconds}s.',
    cliCheckStart: '[cli] Checking arduino-cli…',
    cliCheckOk: '[cli] OK: arduino-cli {version}',
    cliCheckFail: '[cli] Failed to run arduino-cli. Please configure arduino-cli-wrapper.path or install arduino-cli.',
    cliCheckWindowsStart: '[cli][win] Checking arduino-cli.exe…',
    cliCheckWindowsOk: '[cli][win] OK: arduino-cli.exe {version}',
    cliCheckWindowsNoVersion: '[cli][win] arduino-cli.exe returned no version information.',
    cliCheckWindowsFail: '[cli][win] Failed to run arduino-cli.exe: {msg}',
    cliWindowsBoardListFail: '[cli][win] Failed to list serial ports via arduino-cli.exe: {msg}',
    windowsSerialPortLabel: 'Windows host: {port}',
    windowsSerialPortDetail: 'Detected via Windows arduino-cli.exe',
    cliWindowsPathConvertFail: '[cli][win] Failed to convert path for Windows upload: {msg}',
    cliWindowsUploadFallback: '[cli][win] Upload via arduino-cli.exe failed ({msg}). Falling back to WSL arduino-cli.',
    cacheCleanStart: '[cli] Cleaning arduino-cli cache…',
    cacheCleanDone: '[cli] Cache cleaned.',
    cliWindowsOnlyOperation: '[cli][win] This command does not support Windows-hosted serial ports from WSL. Use a port recognized inside WSL or run this command from Windows.',
    buildCheckStart: '[build-check] Scanning sketch.yaml files…',
    buildCheckProgressTitle: 'Build Check: Compiling…',
    buildCheckNoWorkspace: '[build-check] No workspace folder is open. Open a folder in VS Code and re-run Build Check from the Arduino CLI view.',
    buildCheckNoSketchYaml: '[build-check] No sketch.yaml files found. Use the Sketch.yaml Helper to create profiles, then run Build Check again.',
    buildCheckSkipNoProfiles: '[build-check] {sketch} skipped (no profiles defined in sketch.yaml).',
    buildCheckCompileStart: '[build-check] {sketch} ({profile}) compiling…',
    buildCheckStatusSuccess: 'SUCCESS',
    buildCheckStatusFailed: 'FAILED',
    buildCheckCompileResult: '[build-check] {sketch} ({profile}) {status} warnings:{warnings} errors:{errors}',
    buildCheckProfileDuration: '[build-check] {sketch} ({profile}) completed in {seconds}s.',
    buildCheckParseError: '[build-check] Failed to parse JSON output for {sketch} ({profile}): {msg}',
    buildCheckCliError: '[build-check] Compile failed to run for {sketch} ({profile}): exit {code}',
    buildCheckSummary: '[build-check] Completed {total} compile(s): success {success}, failed {failed}, warnings {warnings}, errors {errors}.',
    treeCommandCenter: 'Command Center',
    treeBuildCheck: 'Build Check',
    treeCompile: 'Compile',
    treeCleanCompile: 'Clean Compile',
    treeUpload: 'Upload',
    treeUploadData: 'Upload Data',
    treeMonitor: 'Monitor',
    treeDebug: 'Debug',
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
    debugStart: 'Preparing debug session for {sketch} ({profile})…',
    debugStartNoProfile: 'Preparing debug session for {sketch}…',
    debugCompileFailed: 'Debug build failed: {msg}',
    debugMissingGdb: 'Failed to locate GDB executable (prefix: {prefix}).',
    debugMissingOpenOcd: 'Failed to locate OpenOCD executable.',
    debugTasksUpdated: 'Updated debug tasks in {path}.',
    debugLaunchUpdated: 'Updated debug configurations in {path}.',
    debugLaunchStart: 'Starting debug configuration: {name}',
    debugLaunchFailed: 'Failed to start debug session: {msg}',
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
    inspectorProgressTitle: 'Running Sketch Inspector…',
    inspectorProgressMessage: 'Sketch: {sketch}',
    inspectorProgressMessageProfile: 'Sketch: {sketch} (Profile: {profile})',
    inspectorTabSummary: 'Summary',
    inspectorTabDiagnostics: 'Diagnostics',
    inspectorCleanOptionLabel: 'Clean build (--clean)',
    inspectorTabSections: 'Sections',
    inspectorTabSymbols: 'Top Symbols',
    inspectorTabLibraries: 'Libraries',
    inspectorTabBuildProps: 'Build Properties',
    inspectorTabMap: 'Map',
    inspectorTabPartitions: 'partitions.csv',
    inspectorTabSdkconfig: 'sdkconfig',
    inspectorTabRawJson: 'Raw JSON',
    inspectorTabDefines: 'Defines',
    inspectorDefinesNoData: 'No defines generated.',
    inspectorDefinesCopy: 'Copy defines',
    inspectorDefinesCommand: 'Command',
    inspectorDefinesSource: 'Source',
    inspectorDefinesError: 'Failed to collect defines: {msg}',
    inspectorDefinesCount: '{count} defines',
    inspectorCopySuccess: 'Copied to clipboard.',
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
    buildReportTableDuration: 'Duration (s)',
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
    commandCenterPanelTitle: 'Arduino CLI Command Center',
    commandCenterCliExit: 'arduino-cli exited with code {code}',
    commandCenterConfigDumpFail: 'Failed to load Arduino CLI config: {msg}',
    commandCenterConfigAddFail: 'Failed to add URL: {msg}',
    commandCenterConfigRemoveFail: 'Failed to remove URL: {msg}',
    commandCenterInvalidCommand: 'Unsupported command: {id}',
    commandCenterSetProfileTitle: 'Set Profile',
    commandCenterSetProfileDesc: 'Pick a sketch.yaml profile so compile and upload commands use it automatically.',
    commandCenterSetFqbnTitle: 'Set FQBN',
    commandCenterSetFqbnDesc: 'Choose a board FQBN for sketches that do not use profiles.',
    commandCenterSetPortTitle: 'Set Serial Port',
    commandCenterSetPortDesc: 'Select or enter the serial port used for upload and monitor commands.',
    commandCenterSetBaudTitle: 'Set Baudrate',
    commandCenterSetBaudDesc: 'Choose the serial monitor baudrate.',
    commandCenterCompileTitle: 'Compile Sketch',
    commandCenterCompileDesc: 'Build the active sketch using the selected profile or FQBN.',
    commandCenterCleanCompileTitle: 'Clean Compile',
    commandCenterCleanCompileDesc: 'Delete the build cache and run a fresh compile.',
    commandCenterUploadTitle: 'Upload Sketch',
    commandCenterUploadDesc: 'Build and upload the sketch to the connected board.',
    commandCenterUploadDataTitle: 'Upload Data (FS)',
    commandCenterUploadDataDesc: 'Build and flash the filesystem image for the selected profile.',
    commandCenterMonitorTitle: 'Open Serial Monitor',
    commandCenterMonitorDesc: 'Open the Arduino CLI serial monitor using the selected port.',
    commandCenterDebugTitle: 'Start Debug Session',
    commandCenterDebugDesc: 'Prepare and run the VS Code debug configuration for the selected profile.',
    commandCenterConfigureWarningsTitle: 'Configure Warnings & Verbose',
    commandCenterConfigureWarningsDesc: 'Adjust compiler warnings and verbose flags in settings.',
    commandCenterConfigureIntelliSenseTitle: 'Configure C/C++ IntelliSense',
    commandCenterConfigureIntelliSenseDesc: 'Regenerate compile_commands.json for IntelliSense.',
    commandCenterBuildCheckTitle: 'Build Check',
    commandCenterBuildCheckDesc: 'Run compile for all sketch.yaml profiles and summarize results.',
    commandCenterVersionCheckTitle: 'Check sketch.yaml Versions',
    commandCenterVersionCheckDesc: 'Scan sketch.yaml for outdated core and library versions.',
    commandCenterInspectorTitle: 'Open Sketch Inspector',
    commandCenterInspectorDesc: 'Inspect build artifacts, memory usage, and warnings.',
    commandCenterExamplesTitle: 'Open Examples Browser',
    commandCenterExamplesDesc: 'Browse platform and library example sketches.',
    commandCenterSketchYamlHelperTitle: 'Sketch.yaml Profile Helper',
    commandCenterSketchYamlHelperDesc: 'Generate profile entries from compile --dump-profile and apply settings.',
    commandCenterEmbedAssetsTitle: 'Embed Assets',
    commandCenterEmbedAssetsDesc: 'Convert files under assets/ into a generated assets_embed.h header.',
    commandCenterRunWokwiTitle: 'Run in Wokwi',
    commandCenterRunWokwiDesc: 'Copy firmware artifacts and open the Wokwi simulator for the profile.',
    commandCenterRunArbitraryTitle: 'Run Arduino CLI Command',
    commandCenterRunArbitraryDesc: 'Execute a custom Arduino CLI command line.',
    commandCenterVersionTitle: 'Check CLI Version',
    commandCenterVersionDesc: 'Display the installed Arduino CLI version.',
    commandCenterUpdateTitle: 'Update Index',
    commandCenterUpdateDesc: 'Run arduino-cli core update-index.',
    commandCenterUpgradeTitle: 'Upgrade Cores/Libraries',
    commandCenterUpgradeDesc: 'Upgrade installed cores and libraries to their latest versions.',
    commandCenterCacheCleanTitle: 'Clean Cache',
    commandCenterCacheCleanDesc: 'Remove Arduino CLI cache data.',
    commandCenterListBoardsTitle: 'List Connected Boards',
    commandCenterListBoardsDesc: 'List boards currently connected to the host.',
    commandCenterListAllBoardsTitle: 'List All Boards',
    commandCenterListAllBoardsDesc: 'Show every board available in installed platforms.',
    commandCenterBoardDetailsTitle: 'Board Details',
    commandCenterBoardDetailsDesc: 'Fetch board-specific information such as supported FQBNs.',
    commandCenterSketchNewTitle: 'Create New Sketch',
    commandCenterSketchNewDesc: 'Create a new sketch folder and starter files.',
    commandCenterRefreshViewTitle: 'Refresh Tree View',
    commandCenterRefreshViewDesc: 'Rebuild the Arduino CLI view contents.',
    commandCenterExpandAllTitle: 'Expand All Tree Nodes',
    commandCenterExpandAllDesc: 'Expand every group in the Arduino CLI view.',
    commandCenterOpenSecretsTitle: 'Open arduino_secrets.h',
    commandCenterOpenSecretsDesc: 'Open the arduino_secrets.h helper file if it exists.',
    commandCenterCreateSecretsTitle: 'Create arduino_secrets.h',
    commandCenterCreateSecretsDesc: 'Generate arduino_secrets.h with placeholder entries.',
    commandCenterCoreFetchFail: 'Failed to refresh core index: {msg}',
    commandCenterCoreInstallDone: 'Installed {name}@{version}.',
    commandCenterCoreUninstallDone: 'Uninstalled {name}.',
    commandCenterCoreInstallFail: 'Failed to install {name}@{version}: {msg}',
    commandCenterCoreUninstallFail: 'Failed to uninstall {name}: {msg}',
    commandCenterCoreUpdateWarn: 'Core index update failed ({msg}); displaying cached results.',
    commandCenterLibraryFetchFail: 'Failed to refresh library index: {msg}',
    commandCenterLibraryInstallDone: 'Installed {name}@{version}.',
    commandCenterLibraryUninstallDone: 'Uninstalled {name}.',
    commandCenterLibraryInstallFail: 'Failed to install {name}@{version}: {msg}',
    commandCenterLibraryUninstallFail: 'Failed to uninstall {name}: {msg}',
    commandCenterLibraryUpdateWarn: 'Library index update failed ({msg}); displaying cached results.',
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
    compileCommandsRebuiltFromCache: '[IntelliSense] compile_commands.json を includes.cache から再構築しました (エントリ数: {count})。',
    sketchYamlCreateStart: '[sketch.yaml] 作成開始: {dir}',
    sketchYamlExistsOpen: 'sketch.yaml は既に存在します。開きますか？',
    open: '開く',
    cancel: 'キャンセル',
    sketchYamlExists: '[sketch.yaml] 既に存在: {path}',
    sketchYamlNoFqbn: '[sketch.yaml] FQBN が未設定のため dump-profile の取得はスキップします',
    sketchYamlFetching: '[sketch.yaml] 作成中: dump-profile を取得しています…',
    sketchYamlEmpty: '[sketch.yaml] dump-profile の取得結果が空でした（プロファイル追記はありません）',
    sketchYamlCreated: 'sketch.yaml を作成しました。',
    secretsLensOpen: '🔐 arduino_secrets.h を開く',
    secretsLensCreate: '📝 arduino_secrets.h を作成',
    secretsSelectIno: '.ino ファイルをアクティブにしてから arduino_secrets.h を管理してください。',
    secretsHeaderMissing: '指定パス ({path}) に arduino_secrets.h が見つかりません。作成アクションで生成してください。',
    secretsCreated: '{path} に arduino_secrets.h を作成しました。',
    secretsCreatedNoDefaults: '{path} に arduino_secrets.h を作成しました。フォールバックの #define が見つからなかったため、手動で値を追加してください。',
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
    inspectorProgressTitle: 'スケッチインスペクターを実行中…',
    inspectorProgressMessage: 'スケッチ: {sketch}',
    inspectorProgressMessageProfile: 'スケッチ: {sketch} (プロファイル: {profile})',
    inspectorCleanOptionLabel: 'クリーンビルド (--clean)',
    inspectorTabSummary: 'サマリー',
    inspectorTabDiagnostics: '診断',
    inspectorTabSections: 'セクション',
    inspectorTabSymbols: '大きいシンボル',
    inspectorTabLibraries: 'ライブラリ',
    inspectorTabBuildProps: 'ビルドプロパティ',
    inspectorTabMap: 'マップ',
    inspectorTabPartitions: 'partitions.csv',
    inspectorTabSdkconfig: 'sdkconfig',
    inspectorTabRawJson: 'JSON 出力',
    inspectorTabDefines: '定義一覧',
    inspectorDefinesNoData: '定義を取得できませんでした。',
    inspectorDefinesCopy: '定義をコピー',
    inspectorDefinesCommand: 'コマンド',
    inspectorDefinesSource: 'ソース',
    inspectorDefinesError: '定義の取得に失敗しました: {msg}',
    inspectorDefinesCount: '定義 {count} 件',
    inspectorCopySuccess: 'クリップボードにコピーしました。',
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
    buildReportTableDuration: '経過秒数',
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
    commandCenterPanelTitle: 'Arduino CLI コマンドセンター',
    commandCenterCliExit: 'arduino-cli がコード {code} で終了しました',
    commandCenterConfigDumpFail: 'arduino-cli config dump の取得に失敗しました: {msg}',
    commandCenterConfigAddFail: 'URL の追加に失敗しました: {msg}',
    commandCenterConfigRemoveFail: 'URL の削除に失敗しました: {msg}',
    commandCenterInvalidCommand: '未対応のコマンドです: {id}',
    commandCenterSetProfileTitle: 'プロファイルを設定',
    commandCenterSetProfileDesc: 'sketch.yaml のプロファイルを選択し、コンパイルやアップロードで自動利用できるようにします。',
    commandCenterSetFqbnTitle: 'FQBN を設定',
    commandCenterSetFqbnDesc: 'プロファイルを使わないスケッチ向けに使用するボード FQBN を選択します。',
    commandCenterSetPortTitle: 'シリアルポートを設定',
    commandCenterSetPortDesc: 'アップロードやシリアルモニターで使うシリアルポートを選択または入力します。',
    commandCenterSetBaudTitle: 'ボーレートを設定',
    commandCenterSetBaudDesc: 'シリアルモニター用のボーレートを選択します。',
    commandCenterCompileTitle: 'スケッチをコンパイル',
    commandCenterCompileDesc: '選択したプロファイルまたは FQBN を使ってスケッチをビルドします。',
    commandCenterCleanCompileTitle: 'クリーンビルド',
    commandCenterCleanCompileDesc: 'ビルドキャッシュを削除してからスケッチを再コンパイルします。',
    commandCenterUploadTitle: 'スケッチを書き込み',
    commandCenterUploadDesc: 'スケッチをビルドして接続中のボードへ書き込みます。',
    commandCenterUploadDataTitle: 'data を書き込み (FS)',
    commandCenterUploadDataDesc: '選択したプロファイル用にファイルシステムイメージを生成して書き込みます。',
    commandCenterMonitorTitle: 'シリアルモニターを開く',
    commandCenterMonitorDesc: '選択したポートで Arduino CLI のシリアルモニターを開始します。',
    commandCenterDebugTitle: 'デバッグを開始',
    commandCenterDebugDesc: '選択したプロファイル向けの VS Code デバッグ構成を準備して起動します。',
    commandCenterConfigureWarningsTitle: '警告/詳細ログを設定',
    commandCenterConfigureWarningsDesc: 'コンパイラの警告レベルと verbose オプションを設定します。',
    commandCenterConfigureIntelliSenseTitle: 'C/C++ IntelliSense を再設定',
    commandCenterConfigureIntelliSenseDesc: 'IntelliSense 用の compile_commands.json を再生成します。',
    commandCenterBuildCheckTitle: 'ビルドチェック',
    commandCenterBuildCheckDesc: 'sketch.yaml の全プロファイルでコンパイルを実行し結果をまとめます。',
    commandCenterVersionCheckTitle: 'sketch.yaml のバージョン確認',
    commandCenterVersionCheckDesc: 'sketch.yaml を走査してコア/ライブラリの更新状況を確認します。',
    commandCenterInspectorTitle: 'スケッチインスペクター',
    commandCenterInspectorDesc: 'ビルド成果物やメモリ使用量、警告を確認します。',
    commandCenterExamplesTitle: 'サンプルブラウザー',
    commandCenterExamplesDesc: 'プラットフォームおよびライブラリのサンプルスケッチを参照します。',
    commandCenterSketchYamlHelperTitle: 'sketch.yaml ヘルパー',
    commandCenterSketchYamlHelperDesc: 'compile --dump-profile の結果からプロファイル設定を生成します。',
    commandCenterEmbedAssetsTitle: 'アセットを埋め込む',
    commandCenterEmbedAssetsDesc: 'assets/ 以下のファイルを assets_embed.h に変換します。',
    commandCenterRunWokwiTitle: 'Wokwi で実行',
    commandCenterRunWokwiDesc: 'プロファイルの成果物をコピーして Wokwi シミュレーターを起動します。',
    commandCenterRunArbitraryTitle: 'Arduino CLI コマンドを実行',
    commandCenterRunArbitraryDesc: '任意の Arduino CLI コマンドラインを実行します。',
    commandCenterVersionTitle: 'CLI バージョンを確認',
    commandCenterVersionDesc: 'インストール済みの Arduino CLI バージョンを表示します。',
    commandCenterUpdateTitle: 'インデックスを更新',
    commandCenterUpdateDesc: 'arduino-cli core update-index を実行します。',
    commandCenterUpgradeTitle: 'コア/ライブラリをアップグレード',
    commandCenterUpgradeDesc: 'インストール済みのコアとライブラリを最新版へ更新します。',
    commandCenterCacheCleanTitle: 'キャッシュをクリア',
    commandCenterCacheCleanDesc: 'Arduino CLI のキャッシュデータを削除します。',
    commandCenterListBoardsTitle: '接続中のボードを一覧表示',
    commandCenterListBoardsDesc: 'ホストに接続されているボードを一覧します。',
    commandCenterListAllBoardsTitle: '全ボードを一覧表示',
    commandCenterListAllBoardsDesc: 'インストール済みプラットフォームの全ボードを表示します。',
    commandCenterBoardDetailsTitle: 'ボード詳細を取得',
    commandCenterBoardDetailsDesc: '選択したボードの詳細情報や対応 FQBN を表示します。',
    commandCenterSketchNewTitle: '新しいスケッチを作成',
    commandCenterSketchNewDesc: '新規のスケッチフォルダーと初期ファイルを作成します。',
    commandCenterRefreshViewTitle: 'ビューを更新',
    commandCenterRefreshViewDesc: 'Arduino CLI ビューの内容を再読み込みします。',
    commandCenterExpandAllTitle: 'すべて展開',
    commandCenterExpandAllDesc: 'Arduino CLI ビュー内のすべてのグループを展開します。',
    commandCenterOpenSecretsTitle: 'arduino_secrets.h を開く',
    commandCenterOpenSecretsDesc: '既存の arduino_secrets.h を開きます。',
    commandCenterCreateSecretsTitle: 'arduino_secrets.h を作成',
    commandCenterCreateSecretsDesc: 'arduino_secrets.h をテンプレート付きで生成します。',
    commandCenterCoreFetchFail: 'コア一覧の取得に失敗しました: {msg}',
    commandCenterCoreInstallDone: '{name}@{version} をインストールしました。',
    commandCenterCoreUninstallDone: '{name} をアンインストールしました。',
    commandCenterCoreInstallFail: '{name}@{version} のインストールに失敗しました: {msg}',
    commandCenterCoreUninstallFail: '{name} のアンインストールに失敗しました: {msg}',
    commandCenterCoreUpdateWarn: 'コアインデックスの更新に失敗しました ({msg})。キャッシュ済みの情報を表示します。',
    commandCenterLibraryFetchFail: 'ライブラリ一覧の取得に失敗しました: {msg}',
    commandCenterLibraryInstallDone: '{name}@{version} をインストールしました。',
    commandCenterLibraryUninstallDone: '{name} をアンインストールしました。',
    commandCenterLibraryInstallFail: '{name}@{version} のインストールに失敗しました: {msg}',
    commandCenterLibraryUninstallFail: '{name} のアンインストールに失敗しました: {msg}',
    commandCenterLibraryUpdateWarn: 'ライブラリインデックスの更新に失敗しました ({msg})。キャッシュ済みの情報を表示します。',
    defaultProfileSet: '[sketch.yaml] default_profile を設定: {name}',
    setFqbnPickTitle: 'FQBN を選択してください',
    setFqbnManual: 'FQBN を手入力…',
    setFqbnUnsetWarn: 'FQBN が未選択です',
    statusSetFqbn: 'FQBN を設定: {fqbn}',
    monitorPickPortTitle: 'arduino-cli board list の結果からポートを選択してください',
    portScanProgressTitle: 'シリアルポートを検出しています…',
    portScanProgressMessage: 'arduino-cli で接続中のボードを取得しています',
    compileProgressTitle: 'スケッチをコンパイルしています…',
    compileProgressMessage: 'arduino-cli compile を実行中です…',
    compileProgressMessageProfile: 'プロファイル {profile} 向けに arduino-cli compile を実行中です',
    compileProgressMessageFqbn: '{fqbn} 向けに arduino-cli compile を実行中です',
    compileExtraFlagsApplied: '{file} から build.extra_flags を追加しました',
    compileExtraFlagsReadError: '{file} の読み込みに失敗したため、追加できませんでした: {msg}',
    compileExtraFlagsEmpty: '{file} が空または有効な行がないためスキップしました',
    compileExtraFlagsSkipExisting: '既に build.extra_flags が指定されているため {file} をスキップしました',
    uploadProgressTitle: 'スケッチを書き込み中です…',
    uploadProgressMessage: 'arduino-cli upload を実行中です…',
    uploadProgressMessageProfile: 'プロファイル {profile} 向けに arduino-cli upload を実行中です',
    uploadProgressMessageFqbn: '{fqbn} 向けに arduino-cli upload を実行中です',
    uploadDataProgressTitle: 'データイメージを書き込み中です…',
    uploadDataProgressMessageResolve: 'ファイルシステムのメタデータを収集中です…',
    uploadDataProgressMessageBuild: '{fsType} イメージを生成しています…',
    uploadDataProgressMessageFlash: 'esptool でファイルシステムイメージを書き込み中です…',
    progressBusyWarn: '別のコマンドが実行中です。完了するまでお待ちください。',
    setPortManual: 'ポートを手入力…',
    setPortNoSerial: '外部書き込み装置を使用 (JTAG/SWD/ISP など)',
    setPortNoSerialDescription: 'シリアルポートではなく書き込み装置（プログラマ）で書き込む場合に選択',
    setPortNoSerialDetail: 'arduino-cli のアップロードから -p を外し、JTAG/SWD/ISP などの書き込み装置を想定します。',
    portUnsetWarn: 'ポートが未選択です',
    statusSetPort: 'ポートを設定: {port}{withFqbn}',
    portNoSerialStatus: '書き込み装置モード (ポート未使用)',
    portNoSerialTooltip: 'シリアルポートを使わずプログラマでアップロードする設定です (JTAG/SWD/ISP など)。クリックで変更できます。',
    portNoSerialMonitorWarn: 'シリアルモニターを開くにはポートが必要です。ポートを選択するか書き込み装置モードを解除してください。',
    uploadNoSerialInfo: '[upload] シリアルポートを指定せずに書き込み装置モードで続行します (-p なし、JTAG/SWD/ISP 等)。',
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
    compileDurationGeneric: '[{label}] {seconds}秒で完了しました。',
    cliCheckStart: '[cli] arduino-cli を確認中…',
    cliCheckOk: '[cli] OK: arduino-cli {version}',
    cliCheckFail: '[cli] arduino-cli の実行に失敗しました。arduino-cli のインストールまたは設定 (arduino-cli-wrapper.path) を行ってください。',
    cliCheckWindowsStart: '[cli][win] arduino-cli.exe を確認しています…',
    cliCheckWindowsOk: '[cli][win] OK: arduino-cli.exe {version}',
    cliCheckWindowsNoVersion: '[cli][win] arduino-cli.exe からバージョン情報が得られませんでした。',
    cliCheckWindowsFail: '[cli][win] arduino-cli.exe の実行に失敗しました: {msg}',
    cliWindowsBoardListFail: '[cli][win] Windows 側の arduino-cli.exe でシリアルポート一覧取得に失敗しました: {msg}',
    windowsSerialPortLabel: 'Windows ホスト: {port}',
    windowsSerialPortDetail: 'Windows 側の arduino-cli.exe で検出',
    cliWindowsPathConvertFail: '[cli][win] Windows 側アップロード用のパス変換に失敗しました: {msg}',
    cliWindowsUploadFallback: '[cli][win] arduino-cli.exe でのアップロードに失敗したため WSL 側の arduino-cli へフォールバックします ({msg})。',
    cacheCleanStart: '[cli] arduino-cli のキャッシュをクリアしています…',
    cacheCleanDone: '[cli] キャッシュを削除しました。',
    cliWindowsOnlyOperation: '[cli][win] このコマンドは WSL から Windows ホストのシリアルポートへは接続できません。WSL で認識されるポートを利用するか、Windows 側でコマンドを実行してください。',
    buildCheckStart: '[build-check] sketch.yaml を走査しています…',
    buildCheckProgressTitle: 'ビルドチェック: コンパイル中…',
    buildCheckNoWorkspace: '[build-check] ワークスペースフォルダーが開かれていません。VS Code でフォルダーを開き、Arduino CLI ビューからビルドチェックを再実行してください。',
    buildCheckNoSketchYaml: '[build-check] sketch.yaml が見つかりませんでした。Sketch.yaml ヘルパーでプロファイルを作成してからビルドチェックを再実行してください。',
    buildCheckSkipNoProfiles: '[build-check] {sketch} をスキップしました (sketch.yaml にプロファイルがありません)。',
    buildCheckCompileStart: '[build-check] {sketch} ({profile}) をコンパイル中…',
    buildCheckStatusSuccess: '成功',
    buildCheckStatusFailed: '失敗',
    buildCheckCompileResult: '[build-check] {sketch} ({profile}) {status} 警告:{warnings}件 エラー:{errors}件',
    buildCheckProfileDuration: '[build-check] {sketch} ({profile}) のコンパイル完了: {seconds}秒',
    buildCheckParseError: '[build-check] {sketch} ({profile}) の JSON 出力解析に失敗しました: {msg}',
    buildCheckCliError: '[build-check] {sketch} ({profile}) のコンパイル実行に失敗しました (終了コード {code})。',
    buildCheckSummary: '[build-check] 合計 {total} 件 (成功 {success} / 失敗 {failed}) 警告 {warnings} 件 / エラー {errors} 件。',
    treeCommandCenter: 'コマンドセンター',
    treeBuildCheck: 'ビルドチェック',
    treeCompile: 'コンパイル',
    treeCleanCompile: 'クリーンコンパイル',
    treeUpload: '書き込み',
    treeUploadData: 'データ書き込み',
    treeMonitor: 'シリアルモニター',
    treeDebug: 'デバッグ',
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
    debugStart: 'デバッグを準備中: {sketch}（{profile}）…',
    debugStartNoProfile: 'デバッグを準備中: {sketch}…',
    debugCompileFailed: 'デバッグ用ビルドに失敗しました: {msg}',
    debugMissingGdb: 'デバッグ用 GDB を特定できませんでした（プレフィックス: {prefix}）。',
    debugMissingOpenOcd: 'OpenOCD のパスを特定できませんでした。',
    debugTasksUpdated: 'tasks.json を更新しました: {path}',
    debugLaunchUpdated: 'launch.json を更新しました: {path}',
    debugLaunchStart: 'デバッグ構成を起動します: {name}',
    debugLaunchFailed: 'デバッグ構成の起動に失敗しました: {msg}',
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

const COMMAND_CENTER_ITEMS = Object.freeze([
  { command: 'arduino-cli.version', titleKey: 'commandCenterVersionTitle', descKey: 'commandCenterVersionDesc', requiresProfile: false },
  { command: 'arduino-cli.update', titleKey: 'commandCenterUpdateTitle', descKey: 'commandCenterUpdateDesc', requiresProfile: false },
  { command: 'arduino-cli.upgrade', titleKey: 'commandCenterUpgradeTitle', descKey: 'commandCenterUpgradeDesc', requiresProfile: false },
  { command: 'arduino-cli.cacheClean', titleKey: 'commandCenterCacheCleanTitle', descKey: 'commandCenterCacheCleanDesc', requiresProfile: false },
  { command: 'arduino-cli.listBoards', titleKey: 'commandCenterListBoardsTitle', descKey: 'commandCenterListBoardsDesc', requiresProfile: false },
  { command: 'arduino-cli.listAllBoards', titleKey: 'commandCenterListAllBoardsTitle', descKey: 'commandCenterListAllBoardsDesc', requiresProfile: false },
  { command: 'arduino-cli.boardDetails', titleKey: 'commandCenterBoardDetailsTitle', descKey: 'commandCenterBoardDetailsDesc', requiresProfile: false },
  { command: 'arduino-cli.sketchNew', titleKey: 'commandCenterSketchNewTitle', descKey: 'commandCenterSketchNewDesc', requiresProfile: false },
  { command: 'arduino-cli.refreshView', titleKey: 'commandCenterRefreshViewTitle', descKey: 'commandCenterRefreshViewDesc', requiresProfile: false },
  { command: 'arduino-cli.buildCheck', titleKey: 'commandCenterBuildCheckTitle', descKey: 'commandCenterBuildCheckDesc', requiresProfile: false },
  { command: 'arduino-cli.versionCheck', titleKey: 'commandCenterVersionCheckTitle', descKey: 'commandCenterVersionCheckDesc', requiresProfile: false },
  { command: 'arduino-cli.sketchYamlHelper', titleKey: 'commandCenterSketchYamlHelperTitle', descKey: 'commandCenterSketchYamlHelperDesc', requiresProfile: false },
  { command: 'arduino-cli.examples', titleKey: 'commandCenterExamplesTitle', descKey: 'commandCenterExamplesDesc', requiresProfile: false },
  { command: 'arduino-cli.setProfile', titleKey: 'commandCenterSetProfileTitle', descKey: 'commandCenterSetProfileDesc', requiresProfile: false },
  { command: 'arduino-cli.setFqbn', titleKey: 'commandCenterSetFqbnTitle', descKey: 'commandCenterSetFqbnDesc', requiresProfile: false },
  { command: 'arduino-cli.setPort', titleKey: 'commandCenterSetPortTitle', descKey: 'commandCenterSetPortDesc', requiresProfile: false },
  { command: 'arduino-cli.setBaud', titleKey: 'commandCenterSetBaudTitle', descKey: 'commandCenterSetBaudDesc', requiresProfile: false },
  { command: 'arduino-cli.compile', titleKey: 'commandCenterCompileTitle', descKey: 'commandCenterCompileDesc', requiresProfile: true },
  { command: 'arduino-cli.cleanCompile', titleKey: 'commandCenterCleanCompileTitle', descKey: 'commandCenterCleanCompileDesc', requiresProfile: true },
  { command: 'arduino-cli.upload', titleKey: 'commandCenterUploadTitle', descKey: 'commandCenterUploadDesc', requiresProfile: true },
  { command: 'arduino-cli.uploadData', titleKey: 'commandCenterUploadDataTitle', descKey: 'commandCenterUploadDataDesc', requiresProfile: true },
  { command: 'arduino-cli.monitor', titleKey: 'commandCenterMonitorTitle', descKey: 'commandCenterMonitorDesc', requiresProfile: false },
  { command: 'arduino-cli.debug', titleKey: 'commandCenterDebugTitle', descKey: 'commandCenterDebugDesc', requiresProfile: true },
  { command: 'arduino-cli.configureWarnings', titleKey: 'commandCenterConfigureWarningsTitle', descKey: 'commandCenterConfigureWarningsDesc', requiresProfile: false },
  { command: 'arduino-cli.configureIntelliSense', titleKey: 'commandCenterConfigureIntelliSenseTitle', descKey: 'commandCenterConfigureIntelliSenseDesc', requiresProfile: true },
  { command: 'arduino-cli.inspector', titleKey: 'commandCenterInspectorTitle', descKey: 'commandCenterInspectorDesc', requiresProfile: true },
  { command: 'arduino-cli.embedAssets', titleKey: 'commandCenterEmbedAssetsTitle', descKey: 'commandCenterEmbedAssetsDesc', requiresProfile: false },
  { command: 'arduino-cli.runWokwi', titleKey: 'commandCenterRunWokwiTitle', descKey: 'commandCenterRunWokwiDesc', requiresProfile: true },
  { command: 'arduino-cli.runArbitrary', titleKey: 'commandCenterRunArbitraryTitle', descKey: 'commandCenterRunArbitraryDesc', requiresProfile: false },
  { command: 'arduino-cli.expandAll', titleKey: 'commandCenterExpandAllTitle', descKey: 'commandCenterExpandAllDesc', requiresProfile: false },
  { command: 'arduino-cli.openSecretsHeader', titleKey: 'commandCenterOpenSecretsTitle', descKey: 'commandCenterOpenSecretsDesc', requiresProfile: false },
  { command: 'arduino-cli.createSecretsHeader', titleKey: 'commandCenterCreateSecretsTitle', descKey: 'commandCenterCreateSecretsDesc', requiresProfile: false },
]);

const COMMAND_CENTER_COMMAND_SET = new Set(COMMAND_CENTER_ITEMS.map((item) => item.command));

function compareVersionStrings(a, b) {
  if (a === b) return 0;
  const parse = (value) => {
    if (value === undefined || value === null) return [];
    return String(value)
      .trim()
      .split(/[\.-]/)
      .map((part) => (/^-?\d+$/.test(part) ? Number(part) : part.toLowerCase()));
  };
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const ai = av[i];
    const bi = bv[i];
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai - bi;
    } else if (typeof ai === 'number') {
      return -1;
    } else if (typeof bi === 'number') {
      return 1;
    } else {
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }
  return 0;
}

function sortVersionsDesc(list) {
  const unique = Array.from(new Set((list || []).map((v) => String(v))));
  unique.sort((a, b) => compareVersionStrings(b, a));
  return unique;
}

function formatStoredPortValue(port, host) {
  const trimmed = typeof port === 'string' ? port.trim() : '';
  if (!trimmed) return '';
  if (host === 'windows') return t('windowsSerialPortLabel', { port: trimmed });
  return trimmed;
}

function parseStoredPortValue(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === PORT_NONE_SENTINEL) {
    return { raw, display: t('portNoSerialStatus'), host: 'none', cliPort: '' };
  }
  if (!raw) return { raw: '', display: '', host: '', cliPort: '' };
  const lower = raw.toLowerCase();
  if (lower.includes('windows')) {
    const idx = raw.lastIndexOf(':');
    const cliPort = idx >= 0 ? raw.slice(idx + 1).trim() : raw;
    return { raw, display: raw, host: 'windows', cliPort };
  }
  return { raw, display: raw, host: 'local', cliPort: raw };
}

function getStoredPortInfo() {
  if (!extContext) return { raw: '', display: '', host: '', cliPort: '' };
  const raw = extContext.workspaceState.get(STATE_PORT, '') || '';
  return parseStoredPortValue(raw);
}

function isNoPortSelected(portInfo) {
  return !!(portInfo && portInfo.raw === PORT_NONE_SENTINEL);
}

async function convertPathForWindowsCli(p) {
  if (!_isWslEnv) return p;
  if (!p) return '';
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = cp.spawn('wslpath', ['-w', p], { shell: false });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      const msg = err && err.message ? err.message : String(err || 'unknown');
      getOutput().appendLine(t('cliWindowsPathConvertFail', { msg }));
      resolve('');
    });
    child.on('close', (code) => {
      if (code === 0) {
        const rawOut = stdout.trim();
        const normalized = rawOut ? rawOut.replace(/\\/g, '/') : '';
        resolve(normalized);
      } else {
        const msg = stderr.trim() || `exit ${code}`;
        getOutput().appendLine(t('cliWindowsPathConvertFail', { msg }));
        resolve('');
      }
    });
  });
}

function shouldUseWindowsSerial(portInfo) {
  if (!_isWslEnv) return false;
  if (!portInfo) return false;
  if (portInfo.host === 'windows') return true;
  return /^com\d+/i.test(portInfo.cliPort || '');
}

function portContainsIpAddress(port) {
  if (!port) return false;
  const value = String(port).trim();
  if (!value) return false;
  const ipPattern = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
  return ipPattern.test(value);
}

function hasUploadPasswordField(args) {
  if (!Array.isArray(args) || args.length === 0) return false;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--upload-field') {
      const next = args[i + 1];
      if (typeof next === 'string' && next.startsWith('password=')) return true;
    } else if (typeof token === 'string' && token.startsWith('--upload-field=')) {
      if (token.includes('password=')) return true;
    }
  }
  return false;
}

function formatDurationSeconds(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '0.0';
  const seconds = ms / 1000;
  if (seconds >= 100) return seconds.toFixed(0);
  if (seconds >= 10) return seconds.toFixed(1);
  return seconds.toFixed(2);
}

async function convertArgsForWindowsCli(args) {
  if (!_isWslEnv) return args;
  const result = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--config-file' || arg === '--log-file') {
      const next = args[i + 1];
      if (typeof next === 'string') {
        const converted = await convertPathForWindowsCli(next);
        result.push(arg);
        result.push(converted || next);
        i += 1;
        continue;
      }
    } else if (typeof arg === 'string' && (/^--config-file=/.test(arg) || /^--log-file=/.test(arg))) {
      const idx = arg.indexOf('=');
      const key = arg.slice(0, idx + 1);
      const value = arg.slice(idx + 1);
      const converted = await convertPathForWindowsCli(value);
      result.push(`${key}${converted || value}`);
      continue;
    }
    result.push(arg);
  }
  return result;
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

const SECRET_HEADER_NAME = 'arduino_secrets.h';

let includeOrderDiagnostics;
let includeOrderConfig = { m5: new Set(), fs: new Set() };
let secretsLensProvider;
let assetsDiagnostics;
const assetsDiagTargets = new Map();

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

function getPathSegments(fsPath) {
  if (!fsPath) return [];
  return path.normalize(String(fsPath)).split(/[\\/]+/).filter(Boolean);
}

function isHiddenDirectorySegment(segment) {
  return typeof segment === 'string' && segment.length > 1 && segment.startsWith('.');
}

function containsHiddenDirectory(fsPath) {
  const segments = getPathSegments(fsPath);
  if (segments.length === 0) return false;
  // Ignore the last segment assuming it is the filename
  segments.pop();
  return segments.some(isHiddenDirectorySegment);
}

function isPathInsideBuildDir(fsPath) {
  return getPathSegments(fsPath).includes(BUILD_DIR_NAME);
}

function filterUrisOutsideBuild(uris) {
  if (!Array.isArray(uris)) return [];
  return uris.filter((uri) => {
    if (!uri) return false;
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
    if (!fsPath) return false;
    return !isPathInsideBuildDir(fsPath) && !containsHiddenDirectory(fsPath);
  });
}

class ArduinoSecretsCodeLensProvider {
  constructor() {
    this._em = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._em.event;
  }
  refresh() {
    try { this._em.fire(); } catch { }
  }
  async provideCodeLenses(document) {
    try {
      if (!document || document.isClosed) return [];
      const fileName = document.fileName || (document.uri && document.uri.fsPath) || '';
      if (typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.ino')) return [];
      const lines = getDocumentLines(document);
      if (!lines.length) return [];
      const includeLine = findSecretsIncludeLineFromLines(lines);
      if (includeLine < 0) return [];
      const secretsUri = getSecretsHeaderUriFromIno(document.uri);
      if (!secretsUri) return [];
      const exists = await pathExists(secretsUri);
      const range = new vscode.Range(includeLine, 0, includeLine, 0);
      const title = exists ? t('secretsLensOpen') : t('secretsLensCreate');
      const command = exists ? 'arduino-cli.openSecretsHeader' : 'arduino-cli.createSecretsHeader';
      return [new vscode.CodeLens(range, { title, command, arguments: [document.uri] })];
    } catch {
      return [];
    }
  }
}

function setupArduinoSecretsSupport(context) {
  secretsLensProvider = new ArduinoSecretsCodeLensProvider();
  const selector = { scheme: 'file', pattern: '**/*.ino' };
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, secretsLensProvider),
    vscode.commands.registerCommand('arduino-cli.openSecretsHeader', commandOpenArduinoSecretsHeader),
    vscode.commands.registerCommand('arduino-cli.createSecretsHeader', commandCreateArduinoSecretsHeader)
  );
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${SECRET_HEADER_NAME}`);
  watcher.onDidCreate(() => secretsLensProvider?.refresh());
  watcher.onDidDelete(() => secretsLensProvider?.refresh());
  watcher.onDidChange(() => secretsLensProvider?.refresh());
  context.subscriptions.push(watcher);
  secretsLensProvider.refresh();
}

function setupBuildOptSupport(context) {
  const applyLanguage = (doc) => {
    try {
      if (!isBuildOptDocument(doc)) return;
      if (doc.isClosed) return;
      if (doc.languageId === BUILD_OPT_LANGUAGE_ID) return;
      vscode.languages.setTextDocumentLanguage(doc, BUILD_OPT_LANGUAGE_ID).then(
        () => { },
        () => { }
      );
    } catch (_) { }
  };

  const handleWillSave = (event) => {
    try {
      const doc = event && event.document;
      if (!isBuildOptDocument(doc)) return;
      applyLanguage(doc);
      let text = '';
      try { text = doc.getText(); } catch { text = ''; }
      if (!text || text.indexOf('"') === -1) return;
      const normalized = normalizeBuildOptContent(text);
      if (normalized === text) return;
      const start = new vscode.Position(0, 0);
      const end = doc.lineCount > 0 ? doc.lineAt(doc.lineCount - 1).range.end : start;
      const fullRange = new vscode.Range(start, end);
      event.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, normalized)]));
    } catch (_) { }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(applyLanguage),
    vscode.workspace.onWillSaveTextDocument(handleWillSave)
  );

  try {
    for (const doc of vscode.workspace.textDocuments) {
      applyLanguage(doc);
    }
  } catch (_) { }
}

function isBuildOptDocument(document) {
  if (!document) return false;
  const uri = document.uri;
  if (!uri) return false;
  let fsPath = '';
  try {
    if (typeof document.fileName === 'string' && document.fileName) fsPath = document.fileName;
    else if (typeof uri.fsPath === 'string' && uri.fsPath) fsPath = uri.fsPath;
    else if (typeof uri.path === 'string' && uri.path) fsPath = uri.path;
  } catch (_) { fsPath = ''; }
  if (!fsPath) return false;
  return path.basename(fsPath).toLowerCase() === BUILD_OPT_FILE_NAME;
}

function normalizeBuildOptContent(text) {
  if (typeof text !== 'string' || text.indexOf('"') === -1) return text;
  const lines = text.split(/\r?\n/);
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const normalized = normalizeBuildOptLine(lines[i]);
    if (normalized !== lines[i]) {
      changed = true;
      lines[i] = normalized;
    }
  }
  const rebuilt = lines.join('\n');
  return changed ? rebuilt : text;
}

function normalizeBuildOptLine(line) {
  if (typeof line !== 'string' || line.indexOf('"') === -1) return line;
  const eqIndex = line.indexOf('=');
  if (eqIndex < 0) return line;
  const prefix = line.slice(0, eqIndex + 1);
  const value = line.slice(eqIndex + 1);
  if (value.indexOf('"') === -1) return line;
  const leadingMatch = value.match(/^\s*/);
  const trailingMatch = value.match(/\s*$/);
  const leadingWs = leadingMatch ? leadingMatch[0] : '';
  const trailingWs = trailingMatch ? trailingMatch[0] : '';
  const core = value.slice(leadingWs.length, value.length - trailingWs.length);
  if (!core) return line;
  if (core.startsWith("'") && core.endsWith("'")) return line;
  const normalizedCore = normalizeBuildOptValue(core);
  if (normalizedCore === core) return line;
  return prefix + leadingWs + normalizedCore + trailingWs;
}

function normalizeBuildOptValue(core) {
  const original = core;
  const stripped = stripEdgeDecor(core);
  const unescaped = unescapeSimpleQuoted(stripped.text);
  const trimmed = trimMatchingQuotes(unescaped.text);
  const escapedInner = escapeInnerDoubleQuotes(trimmed.text);
  const finalCore = '"\\"' + escapedInner + '\\""';
  if (!stripped.changed && !unescaped.changed && !trimmed.changed && finalCore === original) {
    return original;
  }
  return finalCore;
}

function stripEdgeDecor(str) {
  let start = 0;
  let end = str.length;
  let changed = false;
  while (start < end) {
    const remaining = str.slice(start, end);
    if (remaining.startsWith('\\"')) {
      start += 2;
      changed = true;
      continue;
    }
    if (remaining.startsWith('"')) {
      start += 1;
      changed = true;
      continue;
    }
    if (remaining.startsWith("'")) {
      start += 1;
      changed = true;
      continue;
    }
    break;
  }
  while (end > start) {
    const remaining = str.slice(start, end);
    if (remaining.endsWith('\\"')) {
      end -= 2;
      changed = true;
      continue;
    }
    if (remaining.endsWith('"')) {
      end -= 1;
      changed = true;
      continue;
    }
    if (remaining.endsWith("'")) {
      end -= 1;
      changed = true;
      continue;
    }
    break;
  }
  return { text: str.slice(start, end), changed };
}

function unescapeSimpleQuoted(str) {
  let result = '';
  let changed = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === '"' || next === "'" || next === '\\') {
        result += next;
        changed = true;
        i++;
        continue;
      }
    }
    result += ch;
  }
  return { text: result, changed };
}

function trimMatchingQuotes(str) {
  let result = str;
  let changed = false;
  while (result.length >= 2) {
    const startChar = result[0];
    const endChar = result[result.length - 1];
    if ((startChar === '"' && endChar === '"') || (startChar === "'" && endChar === "'")) {
      result = result.slice(1, -1);
      changed = true;
      continue;
    }
    break;
  }
  return { text: result, changed };
}

function escapeInnerDoubleQuotes(str) {
  if (!str) return '';
  return str.replace(/"/g, '\\"');
}

async function commandOpenArduinoSecretsHeader(arg) {
  try {
    const ctx = await resolveSecretsContext(arg);
    if (!ctx) {
      vscode.window.showWarningMessage(t('secretsSelectIno'));
      return;
    }
    const exists = await pathExists(ctx.secretsUri);
    if (!exists) {
      vscode.window.showWarningMessage(t('secretsHeaderMissing', { path: ctx.secretsUri.fsPath }));
      return;
    }
    const doc = await vscode.workspace.openTextDocument(ctx.secretsUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (error) {
    showError(error);
  }
}

async function commandCreateArduinoSecretsHeader(arg) {
  try {
    const ctx = await resolveSecretsContext(arg);
    if (!ctx) {
      vscode.window.showWarningMessage(t('secretsSelectIno'));
      return;
    }
    if (await pathExists(ctx.secretsUri)) {
      const doc = await vscode.workspace.openTextDocument(ctx.secretsUri);
      await vscode.window.showTextDocument(doc, { preview: false });
      secretsLensProvider?.refresh();
      return;
    }
    const defines = extractSecretsFallbackDefinesFromLines(ctx.lines, ctx.includeLine);
    const content = buildSecretsHeaderContent(defines, ctx.document?.fileName);
    await writeTextFile(ctx.secretsUri, content);
    secretsLensProvider?.refresh();
    const created = await vscode.workspace.openTextDocument(ctx.secretsUri);
    await vscode.window.showTextDocument(created, { preview: false });
    const msgKey = defines.length ? 'secretsCreated' : 'secretsCreatedNoDefaults';
    vscode.window.showInformationMessage(t(msgKey, { path: ctx.secretsUri.fsPath }));
  } catch (error) {
    showError(error);
  }
}

async function resolveSecretsContext(arg) {
  let targetUri;
  try {
    if (arg) {
      if (vscode.Uri.isUri(arg)) targetUri = arg;
      else if (typeof arg === 'object') {
        if (vscode.Uri.isUri(arg.uri)) targetUri = arg.uri;
        else if (arg.document && vscode.Uri.isUri(arg.document.uri)) targetUri = arg.document.uri;
        else if (vscode.Uri.isUri(arg.resourceUri)) targetUri = arg.resourceUri;
      }
    }
  } catch { targetUri = undefined; }
  if (!targetUri) {
    const active = vscode.window.activeTextEditor;
    if (active && active.document) targetUri = active.document.uri;
  }
  if (!targetUri) return null;
  const fsPath = targetUri.fsPath || targetUri.path || '';
  if (typeof fsPath !== 'string' || !fsPath.toLowerCase().endsWith('.ino')) return null;
  const document = await vscode.workspace.openTextDocument(targetUri);
  const lines = getDocumentLines(document);
  const includeLine = findSecretsIncludeLineFromLines(lines);
  const secretsUri = getSecretsHeaderUriFromIno(targetUri);
  if (!secretsUri) return null;
  return { document, lines, includeLine, secretsUri };
}

function getSecretsHeaderUriFromIno(inoUri) {
  if (!inoUri) return undefined;
  const fsPath = inoUri.fsPath || inoUri.path;
  if (!fsPath) return undefined;
  const dir = path.dirname(fsPath);
  return vscode.Uri.file(path.join(dir, SECRET_HEADER_NAME));
}

function getDocumentLines(document) {
  if (!document) return [];
  let text = '';
  try { text = document.getText(); } catch { text = ''; }
  if (!text) return [];
  return text.split(/\r?\n/);
}

function findSecretsIncludeLineFromLines(lines) {
  if (!Array.isArray(lines)) return -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line !== 'string') continue;
    if (/#\s*include\s*[<"]arduino_secrets\.h[>"]/i.test(line)) return i;
  }
  return -1;
}

function extractSecretsFallbackDefinesFromLines(lines, includeLine) {
  if (!Array.isArray(lines) || !lines.length) return [];
  let startIndex = typeof includeLine === 'number' ? includeLine : -1;
  if (startIndex < 0) startIndex = findSecretsIncludeLineFromLines(lines);
  if (startIndex < 0) return [];
  let elseIndex = -1;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#else\b/.test(line)) {
      elseIndex = i + 1;
      break;
    }
    if (/^\s*#endif\b/.test(line)) return [];
  }
  if (elseIndex < 0) return [];
  const defines = [];
  for (let i = elseIndex; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#endif\b/.test(line)) break;
    const match = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/.exec(line);
    if (!match) continue;
    let valuePart = match[2] || '';
    valuePart = valuePart.replace(/\s+$/, '');
    if (valuePart && !/^\s/.test(valuePart)) valuePart = ' ' + valuePart;
    defines.push(`#define ${match[1]}${valuePart}`);
  }
  return defines;
}

function buildSecretsHeaderContent(defines, sourcePath) {
  const lines = [];
  const sourceName = sourcePath ? path.basename(sourcePath) : undefined;
  lines.push('// Sensitive constants separated from the sketch.');
  if (sourceName) lines.push(`// Source sketch: ${sourceName}`);
  lines.push('// Do not commit this file to version control.');
  lines.push('#pragma once');
  lines.push('');
  if (Array.isArray(defines) && defines.length) {
    for (const entry of defines) {
      if (typeof entry === 'string' && entry.trim()) {
        lines.push(entry.trimEnd());
      }
    }
  } else {
    lines.push('// Define your secrets here, for example:');
    lines.push('// #define WIFI_SSID "YourSSID"');
    lines.push('// #define WIFI_PASS "YourPassword"');
  }
  lines.push('');
  return lines.join('\n');
}

async function ensureLocalBuildPath(sketchDir, profileName, fqbn) {
  if (!sketchDir) return '';
  const labelSource = profileName || fqbn || path.basename(sketchDir) || 'default';
  const folderName = sanitizeProfileFolderName(labelSource);
  const target = path.join(sketchDir, BUILD_DIR_NAME, folderName);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(target));
  } catch (_) { /* ignore directory creation errors */ }
  return target;
}

async function ensureDebugBuildPath(sketchDir, profileName, fqbn) {
  if (!sketchDir) return '';
  const sketchBase = sanitizeProfileFolderName(path.basename(sketchDir) || 'sketch');
  const profileLabel = sanitizeProfileFolderName(profileName || fqbn || 'default');
  const folderName = `${sketchBase}-${profileLabel}-debug`;
  const target = path.join(sketchDir, BUILD_DIR_NAME, folderName);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(target));
  } catch (_) { /* ignore directory creation errors */ }
  return target;
}

function parseCliProperties(text) {
  const output = Object.create(null);
  if (!text) return output;
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) continue;
    const idx = raw.indexOf('=');
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    if (!key) continue;
    const value = raw.slice(idx + 1).trim();
    output[key] = value;
  }
  return output;
}

function extractIndexedValues(props, prefix) {
  if (!props || typeof props !== 'object') return [];
  const values = [];
  const prefixWithDot = `${prefix}.`;
  for (const key of Object.keys(props)) {
    if (key === prefix) {
      values.push(props[key]);
      continue;
    }
    if (!key.startsWith(prefixWithDot)) continue;
    const suffix = key.slice(prefixWithDot.length);
    const index = Number.parseInt(suffix, 10);
    if (Number.isFinite(index)) {
      values[index] = props[key];
    } else {
      values.push(props[key]);
    }
  }
  return values.filter((v) => typeof v === 'string' && v.trim());
}

function resolveOpenOcdExecutable(props) {
  if (!props || typeof props !== 'object') return '';
  const explicit = String(props['debug.server.openocd.path'] || '').trim();
  if (explicit) return explicit;
  const bases = [];
  for (const key of Object.keys(props)) {
    if (!key.startsWith('runtime.tools.')) continue;
    if (!key.endsWith('.path')) continue;
    if (!key.toLowerCase().includes('openocd')) continue;
    const value = String(props[key] || '').trim();
    if (value) bases.push(value);
  }
  for (const base of bases) {
    const normalized = base.replace(/[\\/]+$/, '');
    const candidate = path.join(normalized, 'bin', process.platform === 'win32' ? 'openocd.exe' : 'openocd');
    if (candidate) return candidate;
  }
  return '';
}

function resolveGdbExecutable(props) {
  if (!props || typeof props !== 'object') return '';
  const direct = String(props['debug.toolchain.gdb'] || '').trim();
  if (direct) return direct;
  const base = String(props['debug.toolchain.path'] || '').trim();
  if (!base) return '';
  let exeName = String(props['debug.toolchain.gdbExecutable'] || '').trim();
  if (!exeName) {
    const prefix = String(props['debug.toolchain.prefix'] || '').trim();
    exeName = prefix ? `${prefix}-gdb` : 'gdb';
  }
  const normalizedBase = base.replace(/[\\/]+$/, '');
  let full = path.join(normalizedBase, exeName);
  if (process.platform === 'win32' && !full.toLowerCase().endsWith('.exe')) {
    full += '.exe';
  }
  return full;
}

const CORTEX_DEBUG_ARRAY_FIELDS = new Set([
  'overrideAttachCommands',
  'overrideLaunchCommands',
  'overrideRestartCommands',
  'overrideResetCommands',
  'overrideResumeCommands',
  'overrideRunCommands',
  'overrideDetachCommands',
  'postAttachCommands',
  'postLaunchCommands',
  'postRestartCommands',
  'postResetCommands',
  'postResumeCommands',
  'serverArgs',
  'connectCommands',
  'launchCommands'
]);

function normalizeCortexDebugValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeCortexDebugValue(entry))
      .filter((entry) => entry !== undefined && entry !== '');
  }
  return value;
}

function setNestedCortexValue(target, parts, value) {
  if (!target || typeof target !== 'object' || !Array.isArray(parts) || parts.length === 0) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!key) continue;
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey) cursor[lastKey] = value;
}

function extractCortexDebugEntries(props, prefix) {
  const result = {};
  if (!props || typeof props !== 'object') return result;
  for (const propKey of Object.keys(props)) {
    if (!propKey.startsWith(prefix)) continue;
    const remainder = propKey.slice(prefix.length);
    if (!remainder) continue;
    const parts = remainder.split('.').filter((part) => part !== '');
    if (parts.length === 0) continue;
    const field = parts.shift();
    if (!field) continue;
    const rawValue = props[propKey];
    const normalized = normalizeCortexDebugValue(rawValue);
    if (normalized === undefined || normalized === '') continue;
    if (CORTEX_DEBUG_ARRAY_FIELDS.has(field)) {
      const arr = Array.isArray(result[field]) ? result[field] : [];
      if (parts.length && /^\d+$/.test(parts[0])) {
        const index = Number.parseInt(parts.shift(), 10);
        if (Number.isFinite(index)) arr[index] = normalized;
      } else if (Array.isArray(normalized)) {
        arr.push(...normalized);
      } else {
        arr.push(normalized);
      }
      result[field] = arr.filter((entry) => entry !== undefined && entry !== '');
      continue;
    }
    if (parts.length > 0) {
      if (!result[field] || typeof result[field] !== 'object' || Array.isArray(result[field])) {
        result[field] = {};
      }
      setNestedCortexValue(result[field], parts, normalized);
      continue;
    }
    result[field] = normalized;
  }
  return result;
}

function extractCortexDebugGlobal(props) {
  return extractCortexDebugEntries(props, 'debug.cortex-debug.custom.');
}

function extractCortexDebugCustom(props, candidates) {
  if (!props || typeof props !== 'object') return null;
  for (const rawKey of candidates) {
    if (!rawKey) continue;
    const key = rawKey.trim();
    if (!key) continue;
    const prefix = `debug_config.${key}.cortex-debug.custom.`;
    const result = extractCortexDebugEntries(props, prefix);
    if (Object.keys(result).length > 0) return result;
  }
  return null;
}

function toPosixPath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/');
}

function toLaunchPath(workspaceFolder, absolutePath) {
  if (!absolutePath) return '';
  const normalized = path.normalize(absolutePath);
  if (workspaceFolder && workspaceFolder.uri && workspaceFolder.uri.fsPath) {
    try {
      const rel = path.relative(workspaceFolder.uri.fsPath, normalized);
      if (!rel) {
        return '${workspaceFolder}';
      }
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        const posixRel = rel.split(path.sep).join('/');
        return `${'${workspaceFolder}'}/${posixRel}`;
      }
    } catch (_) { }
  }
  return toPosixPath(normalized);
}

function quoteForTaskCommand(exe) {
  if (!exe) return exe;
  const s = String(exe);
  if (s.startsWith('"') && s.endsWith('"')) return s;
  if (/\s/.test(s)) return `"${s}"`;
  return s;
}

async function updateTasksJson(workspaceFolder, tasksToAdd) {
  if (!Array.isArray(tasksToAdd) || tasksToAdd.length === 0) return '';
  let basePath = '';
  if (workspaceFolder && workspaceFolder.uri && workspaceFolder.uri.fsPath) {
    basePath = workspaceFolder.uri.fsPath;
  } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    basePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  if (!basePath) throw new Error('Workspace folder not available for tasks.json');
  const vscodeDir = path.join(basePath, '.vscode');
  try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscodeDir)); } catch (_) { }
  const tasksUri = vscode.Uri.file(path.join(vscodeDir, 'tasks.json'));
  let data = { version: '2.0.0', tasks: [] };
  if (await pathExists(tasksUri)) {
    try {
      const text = await readTextFile(tasksUri);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch (err) {
      getOutput().appendLine(`[warn] Failed to parse tasks.json: ${err.message}`);
    }
  }
  if (!data || typeof data !== 'object') data = { version: '2.0.0', tasks: [] };
  if (!Array.isArray(data.tasks)) data.tasks = [];
  const existingLabels = new Set(tasksToAdd.map((task) => task && task.label));
  data.tasks = data.tasks.filter((task) => !existingLabels.has(task && task.label));
  data.tasks.push(...tasksToAdd.map((task) => JSON.parse(JSON.stringify(task))));
  if (!data.version) data.version = '2.0.0';
  await writeTextFile(tasksUri, JSON.stringify(data, null, 2) + '\n');
  return tasksUri.fsPath;
}

async function updateLaunchJson(workspaceFolder, configsToAdd, options = {}) {
  if (!Array.isArray(configsToAdd) || configsToAdd.length === 0) return '';
  const removeTypes = new Set(
    Array.isArray(options.removeTypes)
      ? options.removeTypes.map((value) => String(value || '').toLowerCase()).filter((value) => value)
      : []
  );
  const removeNames = new Set(
    Array.isArray(options.removeNames)
      ? options.removeNames.map((value) => String(value || '')).filter((value) => value)
      : []
  );
  let basePath = '';
  if (workspaceFolder && workspaceFolder.uri && workspaceFolder.uri.fsPath) {
    basePath = workspaceFolder.uri.fsPath;
  } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    basePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  if (!basePath) throw new Error('Workspace folder not available for launch.json');
  const vscodeDir = path.join(basePath, '.vscode');
  try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscodeDir)); } catch (_) { }
  const launchUri = vscode.Uri.file(path.join(vscodeDir, 'launch.json'));
  let data = { version: '0.2.0', configurations: [] };
  if (await pathExists(launchUri)) {
    try {
      const text = await readTextFile(launchUri);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch (err) {
      getOutput().appendLine(`[warn] Failed to parse launch.json: ${err.message}`);
    }
  }
  if (!data || typeof data !== 'object') data = { version: '0.2.0', configurations: [] };
  if (!Array.isArray(data.configurations)) data.configurations = [];
  if (removeTypes.size || removeNames.size) {
    data.configurations = data.configurations.filter((cfg) => {
      if (!cfg || typeof cfg !== 'object') return true;
      if (removeNames.size && removeNames.has(cfg.name)) return false;
      if (removeTypes.size) {
        const cfgType = typeof cfg.type === 'string' ? cfg.type.toLowerCase() : '';
        if (cfgType && removeTypes.has(cfgType)) return false;
      }
      return true;
    });
  }
  const names = new Set(configsToAdd.map((cfg) => cfg && cfg.name));
  data.configurations = data.configurations.filter((cfg) => !names.has(cfg && cfg.name));
  data.configurations.push(...configsToAdd.map((cfg) => JSON.parse(JSON.stringify(cfg))));
  if (!data.version) data.version = '0.2.0';
  await writeTextFile(launchUri, JSON.stringify(data, null, 2) + '\n');
  return launchUri.fsPath;
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
    localBuildPath: cfg.get('arduino-cli-wrapper.localBuildPath', false),
    injectTimezoneMacros: cfg.get('arduino-cli-wrapper.injectTimezoneMacros', true),
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

// Track per-executable readiness so we only verify once per session unless forced.
const cliReadyCache = new Map();

// Run a quick check to ensure arduino-cli is available and runnable.
// Shows guidance and returns false if not ready.
async function ensureCliReady(options = {}) {
  const force = options && options.force;
  const skipAutoUpdate = options && options.skipAutoUpdate;
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const cacheKey = `${process.platform}|${exe}`;
  const cacheEntry = cliReadyCache.get(cacheKey);
  if (!force && cacheEntry && cacheEntry.ok) {
    if (!skipAutoUpdate) {
      try { await maybeRunAutoUpdate(); } catch (_) { }
    }
    return true;
  }

  const channel = getOutput();
  channel.appendLine(t('cliCheckStart'));
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
    cliReadyCache.set(cacheKey, { ok: true, version });
    if (!skipAutoUpdate) {
      try { await maybeRunAutoUpdate(); } catch (_) { }
    }
    return true;
  } catch (e) {
    cliReadyCache.delete(cacheKey);
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
  const displayArgs = Array.isArray(opts.logArgs)
    ? [...baseArgs, ...opts.logArgs]
    : finalArgs;
  channel.appendLine(`${ANSI.cyan}$ ${displayExe} ${displayArgs.map(quoteArg).join(' ')}${ANSI.reset}`);
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

function runWindowsCli(args, opts = {}) {
  const cfg = getConfig();
  const exe = 'arduino-cli.exe';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const finalArgs = [...baseArgs, ...args];
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  channel.show();
  const displayArgs = Array.isArray(opts.logArgs)
    ? [...baseArgs, ...opts.logArgs]
    : finalArgs;
  channel.appendLine(`${ANSI.cyan}$ ${displayExe} ${displayArgs.map(quoteArg).join(' ')}${ANSI.reset}`);
  if (opts.cwd) channel.appendLine(`${ANSI.dim}(cwd: ${opts.cwd})${ANSI.reset}`);

  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, {
      cwd: opts.cwd || undefined,
      shell: false,
    });
    child.stdout.on('data', (d) => channel.append(d.toString()));
    child.stderr.on('data', (d) => channel.append(d.toString()));
    child.on('error', (err) => {
      const msg = err && err.message ? err.message : String(err || 'unknown');
      channel.appendLine(`[error] ${msg}`);
      reject(err);
    });
    child.on('close', (code) => {
      channel.appendLine(`${ANSI.bold}${ANSI.green}[exit ${code}]${ANSI.reset}`);
      if (code === 0) resolve({ code });
      else reject(new Error(`arduino-cli.exe exited with code ${code}`));
    });
  });
}

async function runCliCaptureOutput(args, opts = {}) {
  const logStdout = opts.logStdout !== false;
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const finalArgs = [...baseArgs, ...args];
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  channel.show();
  channel.appendLine(`${ANSI.cyan}$ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}`);
  if (opts.cwd) channel.appendLine(`${ANSI.dim}(cwd: ${opts.cwd})${ANSI.reset}`);
  const result = await runCommandCapture(exe, finalArgs, opts.cwd);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (stdout && logStdout) channel.append(stdout);
  if (stderr) channel.append(stderr);
  if (typeof result.code === 'number') {
    channel.appendLine(`${ANSI.bold}${ANSI.green}[exit ${result.code}]${ANSI.reset}`);
  }
  if (result.error) {
    throw result.error;
  }
  if (typeof result.code === 'number' && result.code !== 0) {
    const errMsg = stderr.trim() ? stderr.trim() : t('commandCenterCliExit', { code: result.code });
    throw new Error(errMsg);
  }
  return result;
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
  const ignore = '{node_modules,.git,build,out,dist,.vscode,.build}';
  let files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(wf, '**/*.ino'),
    new vscode.RelativePattern(wf, `**/${ignore}/**`),
    200
  );

  if (!files || files.length === 0) {
    vscode.window.showWarningMessage(t('noInoFound', { name: wf.name }));
    return undefined;
  }

  files = files.filter((u) => !containsHiddenDirectory(u.fsPath) && !isPathInsideBuildDir(u.fsPath));

  if (files.length === 0) {
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
  const channel = getOutput();
  let jsonText;
  try {
    const cfg = getConfig();
    const exe = cfg.exe || 'arduino-cli';
    const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
    const args = [...baseArgs, 'board', 'list', '--format', 'json'];
    jsonText = await runCliForJson(exe, args, channel);
  } catch (e) {
    showError(e);
    return [];
  }

  let boards;
  try {
    const parsed = JSON.parse(jsonText);
    boards = extractBoardsFromParsedList(parsed);
  } catch (err) {
    showError(new Error('Failed to parse board list JSON'));
    return [];
  }

  if (_isWslEnv) {
    try {
      const winJson = await runCliForJson('arduino-cli.exe', ['board', 'list', '--format', 'json'], channel);
      const winParsed = JSON.parse(winJson);
      const winBoards = extractBoardsFromParsedList(winParsed, (item) => {
        const rawPort = item.port || 'unknown';
        return {
          ...item,
          displayPort: t('windowsSerialPortLabel', { port: rawPort }),
          sourceLabel: t('windowsSerialPortDetail'),
          host: 'windows'
        };
      });
      boards.push(...winBoards);
    } catch (err) {
      const msg = ((err && err.message) ? err.message : String(err || 'unknown')).trim();
      channel.appendLine(t('cliWindowsBoardListFail', { msg }));
    }
  }

  return boards;
}

async function runCliForJson(exe, args, channel) {
  let stdout = '';
  await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { shell: false, windowsHide: true });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (channel && typeof channel.append === 'function') {
      child.stderr.on('data', (d) => channel.append(d.toString()));
    } else {
      child.stderr.on('data', () => { });
    }
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`board list exit ${code}`)));
  });
  return stdout;
}

function extractBoardsFromParsedList(parsed, transform) {
  const boards = [];
  const applyTransform = typeof transform === 'function' ? transform : undefined;
  const defaultHost = _isWslEnv ? 'wsl' : 'local';
  const addBoard = (obj) => {
    let item = {
      port: obj.port || 'unknown',
      boardName: obj.boardName || obj.name || '',
      fqbn: obj.fqbn || '',
      protocol: obj.protocol || '',
      host: obj.host || defaultHost,
      displayPort: obj.displayPort || '',
      storageValue: obj.storageValue,
    };
    if (applyTransform) {
      const transformed = applyTransform(item, obj);
      if (transformed) item = transformed;
    }
    if (!item.displayPort) {
      item.displayPort = item.host === 'windows'
        ? formatStoredPortValue(item.port, 'windows')
        : (item.port || 'unknown');
    }
    if (!item.storageValue) {
      item.storageValue = item.host === 'windows'
        ? formatStoredPortValue(item.port, 'windows')
        : (item.port || '');
    }
    boards.push(item);
  };

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
        addBoard({ port: portAddr, boardName: '', fqbn: '', protocol });
      }
    }
  }

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
}

function buildBoardDetail(board) {
  const parts = [];
  if (board.fqbn) parts.push(`FQBN: ${board.fqbn}`);
  if (board.protocol) parts.push(`Protocol: ${board.protocol}`);
  if (board.sourceLabel) parts.push(board.sourceLabel);
  return parts.length ? parts.join(' | ') : undefined;
}

function hasBuildPathFlag(args) {
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--build-path') return true;
    if (typeof value === 'string' && value.startsWith('--build-path=')) return true;
  }
  return false;
}

/**
 * Allow the user to choose a connected board (and optionally port),
 * or enter a manual FQBN when detection is not possible.
 */
async function pickBoardOrFqbn(requirePort) {
  const boards = await listConnectedBoards();
  const boardItems = Array.isArray(boards) ? boards : [];
  const items = boardItems.map(b => ({
    label: b.boardName || '(Unknown Board)',
    description: `${(b.displayPort || b.port || '(unknown)')}${b.fqbn ? '  •  ' + b.fqbn : ''}`,
    detail: buildBoardDetail(b),
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

async function runArduinoCliUpdate(options = {}) {
  const auto = !!options.auto;
  const skipEnsure = !!options.skipEnsure;
  if (!skipEnsure && !(await ensureCliReady({ skipAutoUpdate: true }))) return false;
  try {
    await runCli(['update']);
    await storeAutoUpdateTimestamp(Date.now());
    return true;
  } catch (err) {
    if (auto) {
      const channel = getOutput();
      const msg = (err && err.message) ? err.message : String(err || 'unknown');
      channel.appendLine(`[warn] arduino-cli update failed: ${msg}`);
      return false;
    }
    throw err;
  }
}

async function commandUpdate() {
  try {
    await runArduinoCliUpdate({ auto: false });
  } catch (err) {
    showError(err);
  }
}

async function commandCacheClean() {
  if (!(await ensureCliReady())) return;
  const channel = getOutput();
  channel.appendLine(t('cacheCleanStart'));
  try {
    const cfg = getConfig();
    const exe = cfg.exe || 'arduino-cli';
    const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
    const finalArgs = [...baseArgs, 'cache', 'clean'];
    const term = getAnsiLogTerminal();
    const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
    term.terminal.show(true);
    term.write(`${ANSI.cyan}$ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}
`);
    const result = await runCli(['cache', 'clean']);
    term.write(`${ANSI.bold}${ANSI.green}[exit ${result.code}]${ANSI.reset}
`);
    channel.appendLine(t('cacheCleanDone'));
    vscode.window.showInformationMessage(t('cacheCleanDone'));
  } catch (err) {
    showError(err);
  }
}

async function storeAutoUpdateTimestamp(timestamp) {
  lastAutoUpdateAt = timestamp;
  if (!extContext) return;
  try {
    await extContext.globalState.update(STATE_LAST_AUTO_UPDATE, timestamp);
  } catch (_) { /* ignore persistence failures */ }
}

async function maybeRunAutoUpdate() {
  if (!extContext) return;
  const now = Date.now();
  if (lastAutoUpdateAt && (now - lastAutoUpdateAt) < AUTO_UPDATE_INTERVAL_MS) {
    return;
  }
  if (autoUpdateInFlight) return;
  autoUpdateInFlight = true;
  try {
    const ok = await runArduinoCliUpdate({ auto: true, skipEnsure: true });
    if (!ok) {
      await storeAutoUpdateTimestamp(Date.now());
    }
  } catch (err) {
    const channel = getOutput();
    const msg = (err && err.message) ? err.message : String(err || 'unknown');
    channel.appendLine(`[warn] arduino-cli update failed: ${msg}`);
    try { await storeAutoUpdateTimestamp(Date.now()); } catch (_) { }
  } finally {
    autoUpdateInFlight = false;
  }
}

async function commandUpgrade() {
  if (!(await ensureCliReady())) return;
  try {
    await runCli(['upgrade']);
  } catch (err) {
    showError(err);
  }
}

async function commandVersion() {
  const channel = getOutput();
  let current = '';
  let ensured = false;
  try { ensured = await ensureCliReady({ force: true }); } catch { ensured = false; }
  if (ensured) {
    try { await runCli(['version']); } catch (_) { /* ignore */ }
    try { current = await getArduinoCliVersionString(); } catch { current = ''; }
    await maybeRunAutoUpdate();
  } else {
    channel.appendLine('[info] arduino-cli not detected. Showing latest release info…');
  }
  if (_isWslEnv) {
    channel.appendLine(t('cliCheckWindowsStart'));
    try {
      const winVersion = await getWindowsArduinoCliVersionString();
      if (winVersion) {
        channel.appendLine(t('cliCheckWindowsOk', { version: winVersion }));
      } else {
        channel.appendLine(t('cliCheckWindowsNoVersion'));
      }
    } catch (err) {
      const msg = ((err && err.message) ? err.message : String(err || 'unknown')).trim();
      channel.appendLine(t('cliCheckWindowsFail', { msg }));
    }
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
  return getCliVersionStringForExecutable(exe, { baseArgs });
}

async function getWindowsArduinoCliVersionString() {
  return getCliVersionStringForExecutable('arduino-cli.exe', { useJsonFlag: true });
}

async function getCliVersionStringForExecutable(exe, options = {}) {
  const baseArgs = Array.isArray(options.baseArgs) ? [...options.baseArgs] : [];
  const versionArgs = options.useJsonFlag ? ['version', '--json'] : ['version', '--format', 'json'];
  const args = [...baseArgs, ...versionArgs];
  let stdout = '';
  let stderr = '';
  await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { shell: false, windowsHide: true });
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        const msg = stderr.trim() || `version exit ${code}`;
        const err = new Error(msg);
        err.code = code;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
  try {
    const json = JSON.parse(stdout || '{}');
    const v = String(json.VersionString || json.version || json.Version || '').trim();
    return v || '';
  } catch { return (stdout || '').trim(); }
}

// Fetch latest tag name from GitHub Releases API for arduino/arduino-cli
async function fetchLatestArduinoCliTag() {
  const now = Date.now();
  if (cachedLatestArduinoCliTag && (now - cachedLatestArduinoCliTagFetchedAt) < THREE_HOURS_MS) {
    return cachedLatestArduinoCliTag;
  }
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
    if (tag) {
      cachedLatestArduinoCliTag = tag;
      cachedLatestArduinoCliTagFetchedAt = now;
    }
    return tag || '';
  } catch {
    return cachedLatestArduinoCliTag || '';
  }
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
  // If a sketch/profile is selected via status bar, use it directly to avoid
  // prompting the user each time. Otherwise fall back to picking an .ino.
  let sketchDir;
  try {
    const sel = getSelectedProfileState();
    if (sel && sel.sketchDir) {
      sketchDir = sel.sketchDir;
    }
  } catch (_) { /* ignore */ }
  if (!sketchDir) {
    const ino = await pickInoFromWorkspace();
    if (!ino) return;
    sketchDir = path.dirname(ino);
  }
  const cfg = getConfig();
  const channel = getOutput();

  // Prefer sketch.yaml profile if present
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  let args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  let selectedProfile = '';
  let resolvedFqbn = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    // If user previously selected a profile via status bar and it matches
    // this sketch, prefer that without prompting.
    const sel = getSelectedProfileState();
    if (sel && sel.sketchDir === sketchDir && sel.profile && yamlInfo.profiles.indexOf(sel.profile) >= 0) {
      selectedProfile = sel.profile;
    } else {
      selectedProfile = await resolveProfileName(yamlInfo);
      if (!selectedProfile) return; // user cancelled
    }
    channel.appendLine(`[compile] Using profile from sketch.yaml: ${selectedProfile}`);
    args.push('--profile', selectedProfile);
    await rememberSelectedProfile(sketchDir, selectedProfile);
  } else {
    resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!resolvedFqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
    }
    args.push('--fqbn', resolvedFqbn);
  }
  args.push(sketchDir);
  try {
    const wokwiEnabled = selectedProfile ? isProfileWokwiEnabled(yamlInfo, selectedProfile) : false;
    const opts = selectedProfile
      ? { profileName: selectedProfile, wokwiEnabled }
      : { fqbn: resolvedFqbn };
    const result = await compileWithIntelliSense(sketchDir, args, opts);
    if (result && typeof result.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'compile',
        seconds: formatDurationSeconds(result.durationMs)
      }));
    }
  } catch (e) {
    if (e && typeof e.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'compile',
        seconds: formatDurationSeconds(e.durationMs)
      }));
    }
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
  let resolvedFqbn = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    selectedProfile = await resolveProfileName(yamlInfo);
    if (!selectedProfile) return;
    args.push('--profile', selectedProfile);
    await rememberSelectedProfile(sketchDir, selectedProfile);
  } else {
    resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!resolvedFqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
    }
    args.push('--fqbn', resolvedFqbn);
  }
  args.push(sketchDir);
  try {
    const wokwiEnabled = selectedProfile ? isProfileWokwiEnabled(yamlInfo, selectedProfile) : false;
    const opts = selectedProfile ? { profileName: selectedProfile, wokwiEnabled } : { fqbn: resolvedFqbn };
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
  // Prefer selected profile/sketch from status bar when available so
  // status-bar Upload uses the displayed profile without asking again.
  let sketchDir;
  try {
    const sel = getSelectedProfileState();
    if (sel && sel.sketchDir) sketchDir = sel.sketchDir;
  } catch (_) { /* ignore */ }
  if (!sketchDir) {
    const ino = await pickInoFromWorkspace();
    if (!ino) return;
    sketchDir = path.dirname(ino);
  }
  const cfg = getConfig();
  const channel = getOutput();

  // Require port selection before proceeding (fail fast)
  const storedPortInfo = getStoredPortInfo();
  const noPortSelected = isNoPortSelected(storedPortInfo);
  const currentPort = storedPortInfo.cliPort;
  if (!currentPort && !noPortSelected) {
    vscode.window.showErrorMessage(t('portUnsetWarn'));
    return;
  }

  // Prefer sketch.yaml profile if present
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  // Build first before upload
  const compileArgs = ['compile'];
  if (cfg.verbose) compileArgs.push('--verbose');
  let selectedProfile = '';
  let resolvedFqbn = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    // Prefer status-bar selected profile if it matches this sketch.
    const sel = getSelectedProfileState();
    if (sel && sel.sketchDir === sketchDir && sel.profile && yamlInfo.profiles.indexOf(sel.profile) >= 0) {
      selectedProfile = sel.profile;
    } else {
      selectedProfile = await resolveProfileName(yamlInfo);
      if (!selectedProfile) return;
    }
    channel.appendLine(`[upload] Using profile from sketch.yaml: ${selectedProfile}`);
    compileArgs.push('--profile', selectedProfile);
    await rememberSelectedProfile(sketchDir, selectedProfile);
  } else {
    resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!resolvedFqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
    }
    compileArgs.push('--fqbn', resolvedFqbn);
  }
  compileArgs.push(sketchDir);

  // Prepare arguments for upload
  const uploadArgs = ['upload'];
  if (cfg.verbose) uploadArgs.push('--verbose');
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    // Use profile already chosen above, or fallback to lastResolved or a prompt.
    const profile = selectedProfile || yamlInfo.lastResolved || await resolveProfileName(yamlInfo);
    if (!profile) return;
    uploadArgs.push('--profile', profile);
    // If a port is already selected, pass it explicitly even when using profile
    const selectedPortInfo = getStoredPortInfo();
    const selectedPort = selectedPortInfo.cliPort;
    if (selectedPort) uploadArgs.push('-p', selectedPort);
  } else {
    let portInfo = getStoredPortInfo();
    let port = portInfo.cliPort;
    if (!resolvedFqbn) {
      const set = await commandSetFqbn(true);
      if (!set) return;
      resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
    }
    if (resolvedFqbn) uploadArgs.push('--fqbn', resolvedFqbn);
    if (port) uploadArgs.push('-p', port);
  }
  try {
    if (noPortSelected) {
      channel.appendLine(t('uploadNoSerialInfo'));
    }
    // Update IntelliSense during compile
    const wokwiEnabled = selectedProfile ? isProfileWokwiEnabled(yamlInfo, selectedProfile) : false;
    const compileOpts = selectedProfile ? { profileName: selectedProfile, wokwiEnabled } : { fqbn: resolvedFqbn };
    const compileResult = await compileWithIntelliSense(sketchDir, compileArgs, compileOpts);
    if (compileResult === PROGRESS_BUSY) return;
    if (compileResult && typeof compileResult.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'upload',
        seconds: formatDurationSeconds(compileResult.durationMs)
      }));
    }

    // If a serial monitor is open, close it before upload to avoid port conflicts
    let reopenMonitorAfter = false;
    if (monitorTerminal) {
      try { monitorTerminal.dispose(); } catch (_) { }
      monitorTerminal = undefined;
      reopenMonitorAfter = true;
    }

    const uploadProgressTitle = t('uploadProgressTitle');
    const uploadProgressMessage = selectedProfile
      ? t('uploadProgressMessageProfile', { profile: selectedProfile })
      : (resolvedFqbn
        ? t('uploadProgressMessageFqbn', { fqbn: resolvedFqbn })
        : t('uploadProgressMessage'));
    const uploadParams = {
      sketchDir,
      baseArgs: uploadArgs,
      compileArgs,
      buildProfile: selectedProfile,
      buildFqbn: resolvedFqbn,
      yamlInfo,
      cfg
    };
    const uploadOutcome = await runWithNotificationProgress({
      location: vscode.ProgressLocation.Notification,
      title: uploadProgressTitle
    }, async (progress) => {
      if (uploadProgressMessage) progress.report({ message: uploadProgressMessage });
      await performUploadWithPortStrategy(uploadParams);
    });
    if (uploadOutcome === PROGRESS_BUSY) {
      if (reopenMonitorAfter) {
        try { await commandMonitor(); } catch (_) { }
      }
      return;
    }

    if (reopenMonitorAfter) {
      // After upload, wait a bit for the port to settle before reopening monitor
      await new Promise((res) => setTimeout(res, 1500));
      await commandMonitor();
    }
  } catch (e) {
    if (e && typeof e.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'upload',
        seconds: formatDurationSeconds(e.durationMs)
      }));
    }
    showError(e);
  }
}

async function commandDebug(sketchDir, profileFromTree) {
  try {
    if (!(await ensureCliReady())) return;
    let targetDir = sketchDir;
    if (!targetDir) {
      const ino = await pickInoFromWorkspace();
      if (!ino) return;
      targetDir = path.dirname(ino);
    }
    const channel = getOutput();
    const portInfoInitial = getStoredPortInfo();
    if (shouldUseWindowsSerial(portInfoInitial)) {
      const message = t('cliWindowsOnlyOperation');
      vscode.window.showErrorMessage(message);
      channel.appendLine(message);
      return;
    }
    const targetUri = vscode.Uri.file(targetDir);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri)
      || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0]
        : undefined);

    const yamlInfo = await readSketchYamlInfo(targetDir);
    let selectedProfile = '';
    if (yamlInfo && Array.isArray(yamlInfo.profiles) && yamlInfo.profiles.length > 0) {
      if (profileFromTree && yamlInfo.profiles.includes(profileFromTree)) {
        selectedProfile = profileFromTree;
      } else {
        const resolved = await resolveProfileName(yamlInfo);
        if (!resolved) return;
        selectedProfile = resolved;
      }
    }

    if (selectedProfile) {
      await rememberSelectedProfile(targetDir, selectedProfile);
    }

    let usedFqbn = '';
    if (selectedProfile) {
      usedFqbn = await getFqbnFromSketchYaml(targetDir, selectedProfile);
    }
    if (!usedFqbn) {
      usedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
      if (!usedFqbn) {
        const set = await commandSetFqbn(true);
        if (!set) return;
        usedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
      }
    }

    let portInfo = getStoredPortInfo();
    let port = portInfo.cliPort;
    let debugNoPortSelected = isNoPortSelected(portInfo);
    if (!port && !debugNoPortSelected) {
      const set = await commandSetPort(true);
      if (!set) return;
      portInfo = getStoredPortInfo();
      port = portInfo.cliPort;
      debugNoPortSelected = isNoPortSelected(portInfo);
    }
    if (!port && debugNoPortSelected) {
      // Allow the debug workflow to continue without a serial port (programmer mode).
      port = '';
    } else if (!port) {
      vscode.window.showErrorMessage(t('portUnsetWarn'));
      return;
    }

    const sketchName = path.basename(targetDir) || 'sketch';
    const displayProfile = selectedProfile || usedFqbn || 'default';
    channel.show();
    if (selectedProfile) {
      channel.appendLine(t('debugStart', { sketch: sketchName, profile: displayProfile }));
    } else {
      channel.appendLine(t('debugStartNoProfile', { sketch: sketchName }));
    }

    const cfg = getConfig();
    const useLocalBuildPath = !!cfg.localBuildPath;
    let debugBuildPath = '';
    if (useLocalBuildPath) {
      debugBuildPath = await ensureDebugBuildPath(targetDir, selectedProfile, usedFqbn);
    }
    const compileArgs = ['compile'];
    if (cfg.verbose) compileArgs.push('--verbose');
    if (selectedProfile) compileArgs.push('--profile', selectedProfile);
    else compileArgs.push('--fqbn', usedFqbn);
    if (useLocalBuildPath && debugBuildPath) {
      const relativeBuild = path.relative(targetDir, debugBuildPath);
      const buildPathArg = relativeBuild && !relativeBuild.startsWith('..') ? relativeBuild : debugBuildPath;
      compileArgs.push('--build-path', buildPathArg);
    }
    compileArgs.push('--build-property', 'compiler.cpp.extra_flags=-Og -g3');
    compileArgs.push('--build-property', 'compiler.c.extra_flags=-Og -g3');
    compileArgs.push('--build-property', 'compiler.S.extra_flags=-g3');
    compileArgs.push('--build-property', 'compiler.optimization_flags=-Og -g3');
    compileArgs.push('--show-properties');
    compileArgs.push(targetDir);

    let compileResult;
    try {
      compileResult = await compileWithIntelliSense(targetDir, compileArgs, {
        profileName: selectedProfile,
        fqbn: usedFqbn,
        skipLocalBuildPath: true,
      });
      if (compileResult && typeof compileResult.durationMs === 'number') {
        channel.appendLine(t('compileDurationGeneric', {
          label: 'debug',
          seconds: formatDurationSeconds(compileResult.durationMs)
        }));
      }
    } catch (err) {
      if (err && typeof err.durationMs === 'number') {
        channel.appendLine(t('compileDurationGeneric', {
          label: 'debug',
          seconds: formatDurationSeconds(err.durationMs)
        }));
      }
      channel.appendLine(t('debugCompileFailed', { msg: err.message }));
      showError(err);
      return;
    }

    const props = parseCliProperties(compileResult.stdout || '');
    const resolvedBuildPathRaw = props['build.path'] || debugBuildPath || '';
    const resolvedBuildPath = resolvedBuildPathRaw ? path.normalize(resolvedBuildPathRaw) : '';
    const projectName = props['build.project_name'] || path.basename(targetDir);
    const defaultElf = projectName.endsWith('.elf') ? projectName : `${projectName}.elf`;
    const elfPath = path.normalize(props['debug.executable'] || path.join(resolvedBuildPath, defaultElf));
    const gdbPath = resolveGdbExecutable(props);
    if (!gdbPath) {
      vscode.window.showErrorMessage(t('debugMissingGdb', { prefix: props['debug.toolchain.prefix'] || '?' }));
      return;
    }
    const openOcdPath = resolveOpenOcdExecutable(props);
    if (!openOcdPath) {
      vscode.window.showErrorMessage(t('debugMissingOpenOcd'));
      return;
    }

    const openOcdScripts = extractIndexedValues(props, 'debug.server.openocd.scripts');
    if (openOcdScripts.length === 0) {
      const fallbackScript = String(props['build.openocdscript'] || '').trim();
      if (fallbackScript) openOcdScripts.push(fallbackScript);
    }
    if (openOcdScripts.length === 0) {
      vscode.window.showErrorMessage(t('debugMissingOpenOcd'));
      return;
    }
    const scriptsDir = String(props['debug.server.openocd.scripts_dir'] || '').trim() || path.dirname(openOcdPath);
    const svdFileRaw = String(props['debug.svd_file'] || props['debug.svdFile'] || '').trim();
    const cortexGlobal = extractCortexDebugGlobal(props);
    const candidateKeys = [];
    const seenKeys = new Set();
    const pushKey = (value) => {
      if (!value) return;
      const trimmed = String(value).trim();
      if (!trimmed) return;
      if (!seenKeys.has(trimmed)) {
        candidateKeys.push(trimmed);
        seenKeys.add(trimmed);
      }
      const lower = trimmed.toLowerCase();
      if (!seenKeys.has(lower)) {
        candidateKeys.push(lower);
        seenKeys.add(lower);
      }
    };
    pushKey(props['build.target']);
    pushKey(props['build.arch']);
    pushKey(props['build.mcu']);
    if (usedFqbn) {
      const segments = String(usedFqbn).split(':');
      for (const segment of segments) pushKey(segment);
    }
    pushKey('default');
    const additionalConfigs = extractIndexedValues(props, 'debug.additional_config');
    for (const cfgName of additionalConfigs) {
      pushKey(cfgName);
      const parts = String(cfgName || '').split('.');
      if (parts.length > 0) pushKey(parts[parts.length - 1]);
    }
    const cortexCustom = extractCortexDebugCustom(props, candidateKeys) || {};
    const cortexMerged = { ...cortexGlobal };
    for (const [key, value] of Object.entries(cortexCustom)) {
      cortexMerged[key] = value;
    }
    const toStringArray = (value) => {
      if (Array.isArray(value)) {
        return value
          .map((entry) => (entry === null || entry === undefined) ? '' : String(entry).trim())
          .filter((entry) => entry);
      }
      if (value === null || value === undefined) return [];
      const str = String(value).trim();
      return str ? [str] : [];
    };
    const toTrimmedString = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value.trim();
      return String(value).trim();
    };
    const normalizeCommandText = (cmd) => String(cmd || '').replace(/\s+/g, ' ').trim();
    const isBreakpointCommand = (cmd) => {
      const normalized = normalizeCommandText(cmd).toLowerCase();
      if (!normalized) return false;
      return /^(?:thb|tb|tbreak|hbreak|break|b)\b/.test(normalized);
    };
    const stripTrailingContinue = (commands) => {
      if (!commands.length) return commands;
      const result = [...commands];
      while (result.length) {
        const raw = result[result.length - 1];
        const normalized = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized === 'c' || normalized === 'cont' || normalized === 'continue') {
          result.pop();
          continue;
        }
        break;
      }
      return result;
    };
    const fixDeprecatedMonitorCommand = (cmd) => {
      const normalized = normalizeCommandText(cmd);
      if (!normalized) return '';
      if (normalized.toLowerCase() === 'monitor gdb_sync') return 'monitor gdb sync';
      return normalized;
    };
    const mapCortexCommands = (value) =>
      stripTrailingContinue(toStringArray(value))
        .map((cmd) => fixDeprecatedMonitorCommand(cmd))
        .filter((cmd) => !!cmd);
    const ensureContinueAfterBreakpointStrings = (commands) => {
      if (!Array.isArray(commands) || commands.length === 0) return commands;
      const result = [];
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        result.push(cmd);
        if (isBreakpointCommand(cmd)) {
          const next = normalizeCommandText(commands[i + 1]).toLowerCase();
          if (next !== 'continue' && next !== 'cont' && next !== 'c') {
            result.push('continue');
          }
        }
      }
      return result;
    };
    const detectGdbServerPort = (args) => {
      for (const entry of args) {
        const cleaned = normalizeCommandText(entry).replace(/["']/g, '');
        const match = /\bgdb[_ ]port\s+(\d{2,5})\b/i.exec(cleaned);
        if (match) return match[1];
      }
      return '';
    };
    const buildServerStartedMessage = (port) => {
      const resolved = port || '3333';
      return `Info : Listening on port ${resolved} for gdb connections`;
    };
    const toolchainPath = String(props['debug.toolchain.path'] || '').trim();
    const toolchainPrefix = String(props['debug.toolchain.prefix'] || '').trim();
    const normalizedToolchainPath = toolchainPath ? path.normalize(toolchainPath) : '';
    const exeExt = process.platform === 'win32' ? '.exe' : '';
    const derivedObjdumpPath = (normalizedToolchainPath && toolchainPrefix)
      ? path.join(normalizedToolchainPath, `${toolchainPrefix}-objdump${exeExt}`)
      : '';
    const objdumpPathConfigured = toTrimmedString(cortexMerged.objdumpPath);
    delete cortexMerged.objdumpPath;
    delete cortexMerged.name;
    const requestValue = toTrimmedString(cortexMerged.request);
    delete cortexMerged.request;
    delete cortexMerged.runToMain;
    delete cortexMerged.nmPath;
    const serverArgs = toStringArray(cortexMerged.serverArgs);
    delete cortexMerged.serverArgs;
    const gdbPort = detectGdbServerPort(serverArgs);
    const gdbServerAddress = gdbPort ? `localhost:${gdbPort}` : 'localhost:3333';
    const gdbServerStartedMessage = buildServerStartedMessage(gdbPort);
    const overrideAttachRaw = mapCortexCommands(cortexMerged.overrideAttachCommands);
    delete cortexMerged.overrideAttachCommands;
    const overrideAttach = ensureContinueAfterBreakpointStrings(overrideAttachRaw);
    const overrideLaunchRaw = mapCortexCommands(cortexMerged.overrideLaunchCommands);
    delete cortexMerged.overrideLaunchCommands;
    const overrideLaunch = ensureContinueAfterBreakpointStrings(overrideLaunchRaw);
    const overrideRestart = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.overrideRestartCommands));
    delete cortexMerged.overrideRestartCommands;
    const overrideReset = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.overrideResetCommands));
    delete cortexMerged.overrideResetCommands;
    const overrideResume = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.overrideResumeCommands));
    delete cortexMerged.overrideResumeCommands;
    const overrideRun = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.overrideRunCommands));
    delete cortexMerged.overrideRunCommands;
    const overrideDetach = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.overrideDetachCommands));
    delete cortexMerged.overrideDetachCommands;
    const postAttachRaw = mapCortexCommands(cortexMerged.postAttachCommands);
    delete cortexMerged.postAttachCommands;
    const postAttach = ensureContinueAfterBreakpointStrings(postAttachRaw);
    const postLaunchRaw = mapCortexCommands(cortexMerged.postLaunchCommands);
    delete cortexMerged.postLaunchCommands;
    const postLaunch = ensureContinueAfterBreakpointStrings(postLaunchRaw);
    const postRestart = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.postRestartCommands));
    delete cortexMerged.postRestartCommands;
    const postReset = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.postResetCommands));
    delete cortexMerged.postResetCommands;
    const postResume = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.postResumeCommands));
    delete cortexMerged.postResumeCommands;
    const connectCommands = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.connectCommands));
    delete cortexMerged.connectCommands;
    const launchCommands = ensureContinueAfterBreakpointStrings(mapCortexCommands(cortexMerged.launchCommands));
    delete cortexMerged.launchCommands;

    const buildPathRelative = resolvedBuildPath ? path.relative(targetDir, resolvedBuildPath) : '';
    const buildPathForTasks = resolvedBuildPath
      ? (buildPathRelative && !buildPathRelative.startsWith('..') ? buildPathRelative : resolvedBuildPath)
      : '';

    const objdumpPathRaw = (objdumpPathConfigured || derivedObjdumpPath || '').trim();
    const requestKind = requestValue.toLowerCase();
    const cortexRequest = requestKind === 'attach' ? 'attach' : (requestKind === 'launch' ? 'launch' : 'launch');

    const displayName = `${sketchName} (${displayProfile})`;
    const baseDebugName = `Arduino Debug ${displayName}`;
    const baseArgs = Array.isArray(cfg.extra) ? cfg.extra.slice() : [];
    const exeCommand = quoteForTaskCommand(cfg.exe || 'arduino-cli');
    const taskCwd = toLaunchPath(workspaceFolder, targetDir) || path.normalize(targetDir);
    let preLaunchTaskLabel = '';
    const taskDefinitions = [];
    if (useLocalBuildPath && buildPathForTasks) {
      const compileTaskLabel = `Arduino: Debug Build ${displayName}`;
      const uploadTaskLabel = `Arduino: Debug Upload ${displayName}`;
      const compileTaskArgs = [...baseArgs, 'compile'];
      if (cfg.verbose) compileTaskArgs.push('--verbose');
      if (selectedProfile) compileTaskArgs.push('--profile', selectedProfile);
      else compileTaskArgs.push('--fqbn', usedFqbn);
      compileTaskArgs.push('--build-path', buildPathForTasks);
      compileTaskArgs.push('--build-property', 'compiler.cpp.extra_flags=-Og -g3');
      compileTaskArgs.push('--build-property', 'compiler.c.extra_flags=-Og -g3');
      compileTaskArgs.push('--build-property', 'compiler.S.extra_flags=-g3');
      compileTaskArgs.push('--build-property', 'compiler.optimization_flags=-Og -g3');
      compileTaskArgs.push('.');

      const uploadTaskArgs = [...baseArgs, 'upload'];
      if (cfg.verbose) uploadTaskArgs.push('--verbose');
      if (selectedProfile) uploadTaskArgs.push('--profile', selectedProfile);
      else uploadTaskArgs.push('--fqbn', usedFqbn);
      if (port) uploadTaskArgs.push('-p', port);
      uploadTaskArgs.push('--input-dir', buildPathForTasks);
      uploadTaskArgs.push('.');

      taskDefinitions.push({
        label: compileTaskLabel,
        type: 'shell',
        command: exeCommand,
        args: compileTaskArgs,
        options: { cwd: taskCwd },
        problemMatcher: ['$gcc']
      });
      taskDefinitions.push({
        label: uploadTaskLabel,
        type: 'shell',
        command: exeCommand,
        args: uploadTaskArgs,
        options: { cwd: taskCwd },
        dependsOn: compileTaskLabel,
        problemMatcher: ['$gcc']
      });
      preLaunchTaskLabel = uploadTaskLabel;
    } else {
      const combinedTaskLabel = `Arduino: Debug Build & Upload ${displayName}`;
      const compileUploadArgs = [...baseArgs, 'compile'];
      if (cfg.verbose) compileUploadArgs.push('--verbose');
      if (selectedProfile) compileUploadArgs.push('--profile', selectedProfile);
      else compileUploadArgs.push('--fqbn', usedFqbn);
      if (port) compileUploadArgs.push('--port', port);
      compileUploadArgs.push('--upload');
      compileUploadArgs.push('--build-property', 'compiler.cpp.extra_flags=-Og -g3');
      compileUploadArgs.push('--build-property', 'compiler.c.extra_flags=-Og -g3');
      compileUploadArgs.push('--build-property', 'compiler.S.extra_flags=-g3');
      compileUploadArgs.push('--build-property', 'compiler.optimization_flags=-Og -g3');
      compileUploadArgs.push('.');

      taskDefinitions.push({
        label: combinedTaskLabel,
        type: 'shell',
        command: exeCommand,
        args: compileUploadArgs,
        options: { cwd: taskCwd },
        problemMatcher: ['$gcc']
      });
      preLaunchTaskLabel = combinedTaskLabel;
    }

    const tasksPath = await updateTasksJson(workspaceFolder, taskDefinitions);
    if (tasksPath) {
      channel.appendLine(t('debugTasksUpdated', { path: tasksPath }));
    }

    const gdbLaunchPath = toPosixPath(path.normalize(gdbPath));
    const openOcdLaunchPath = toPosixPath(path.normalize(openOcdPath));
    const executableLaunchPath = toLaunchPath(workspaceFolder, elfPath) || toPosixPath(elfPath);
    const cwdLaunchPath = toLaunchPath(workspaceFolder, targetDir) || toPosixPath(path.normalize(targetDir));
    const svdLaunchPath = svdFileRaw
      ? (toLaunchPath(workspaceFolder, path.normalize(svdFileRaw)) || toPosixPath(path.normalize(svdFileRaw)))
      : '';
    const searchDirList = scriptsDir ? [toPosixPath(path.normalize(scriptsDir))] : [];
    const configFilesNormalized = openOcdScripts.map((script) => toPosixPath(script));

    const cortexConfig = {
      name: `${baseDebugName} (cortex-debug)`,
      type: 'cortex-debug',
      request: cortexRequest,
      servertype: 'openocd',
      serverpath: openOcdLaunchPath,
      gdbPath: gdbLaunchPath,
      executable: executableLaunchPath,
      cwd: cwdLaunchPath
    };
    if (preLaunchTaskLabel) cortexConfig.preLaunchTask = preLaunchTaskLabel;
    if (gdbServerAddress) cortexConfig.gdbTarget = gdbServerAddress;
    if (configFilesNormalized.length) cortexConfig.configFiles = configFilesNormalized;
    if (searchDirList.length) cortexConfig.searchDir = searchDirList;
    if (svdLaunchPath) cortexConfig.svdFile = svdLaunchPath;
    if (serverArgs.length) cortexConfig.serverArgs = serverArgs;
    if (overrideAttach.length) cortexConfig.overrideAttachCommands = overrideAttach;
    if (overrideLaunch.length) cortexConfig.overrideLaunchCommands = overrideLaunch;
    if (overrideRestart.length) cortexConfig.overrideRestartCommands = overrideRestart;
    if (overrideReset.length) cortexConfig.overrideResetCommands = overrideReset;
    if (overrideResume.length) cortexConfig.overrideResumeCommands = overrideResume;
    if (overrideRun.length) cortexConfig.overrideRunCommands = overrideRun;
    if (overrideDetach.length) cortexConfig.overrideDetachCommands = overrideDetach;
    if (postAttach.length) cortexConfig.postAttachCommands = postAttach;
    if (postLaunch.length) cortexConfig.postLaunchCommands = postLaunch;
    if (postRestart.length) cortexConfig.postRestartCommands = postRestart;
    if (postReset.length) cortexConfig.postResetCommands = postReset;
    if (postResume.length) cortexConfig.postResumeCommands = postResume;
    if (connectCommands.length) cortexConfig.connectCommands = connectCommands;
    if (launchCommands.length) cortexConfig.launchCommands = launchCommands;
    if (objdumpPathRaw) cortexConfig.objdumpPath = toPosixPath(path.normalize(objdumpPathRaw));

    const cortexBlockedKeys = new Set([
      'type', 'servertype', 'serverpath', 'gdbPath', 'executable', 'cwd',
      'preLaunchTask', 'configFiles', 'searchDir', 'svdFile', 'runToMain',
      'serverArgs', 'overrideAttachCommands', 'overrideLaunchCommands', 'overrideRestartCommands',
      'overrideResetCommands', 'overrideResumeCommands', 'overrideRunCommands', 'overrideDetachCommands',
      'postAttachCommands', 'postLaunchCommands', 'postRestartCommands', 'postResetCommands',
      'postResumeCommands', 'connectCommands', 'launchCommands', 'objdumpPath', 'nmPath', 'name', 'request'
    ]);
    for (const [key, value] of Object.entries(cortexMerged)) {
      if (value === undefined || value === null) continue;
      if (cortexBlockedKeys.has(key)) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      cortexConfig[key] = value;
    }

    const debugServerArgsParts = [];
    if (scriptsDir) debugServerArgsParts.push('-s', scriptsDir);
    for (const script of openOcdScripts) debugServerArgsParts.push('--file', script);
    if (serverArgs.length) debugServerArgsParts.push(...serverArgs);
    const debugServerArgs = debugServerArgsParts.length
      ? debugServerArgsParts.map((part) => quoteArg(part)).join(' ')
      : '';

    const cppdbgConfig = {
      name: `${baseDebugName} (cppdbg)`,
      type: 'cppdbg',
      // cpptools requires request="launch" when driving a remote gdb-server via miDebuggerServerAddress.
      request: 'launch',
      program: executableLaunchPath,
      cwd: cwdLaunchPath,
      MIMode: 'gdb',
      miDebuggerPath: gdbLaunchPath,
      miDebuggerServerAddress: gdbServerAddress,
      debugServerPath: openOcdLaunchPath,
      debugServerArgs,
      serverStarted: gdbServerStartedMessage,
      serverLaunchTimeout: 40000,
      filterStdout: true,
      filterStderr: true,
      stopAtEntry: false,
      externalConsole: false,
      launchCompleteCommand: 'exec-continue',
      setupCommands: []
    };
    if (preLaunchTaskLabel) cppdbgConfig.preLaunchTask = preLaunchTaskLabel;
    let cppdbgCommands = [];
    const combinedPrimary = [...overrideAttachRaw, ...overrideLaunchRaw];
    const combinedSecondary = [...postAttachRaw, ...postLaunchRaw];
    const isBlockedMonitorCommand = (cmd) => {
      const normalized = normalizeCommandText(cmd).toLowerCase();
      return normalized === 'monitor reset halt' || normalized === 'monitor gdb_sync' || normalized === 'monitor gdb sync';
    };
    const isRemoteConnect = (cmd) => {
      const normalized = String(cmd || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalized.startsWith('target ')) return false;
      return /\b(?:extended-)?remote\b/.test(normalized);
    };
    const appendSanitizedCommands = (source) => {
      for (const cmd of source) {
        const trimmed = String(cmd || '').trim();
        if (!trimmed) continue;
        if (isRemoteConnect(trimmed)) continue;
        if (isBlockedMonitorCommand(trimmed)) continue;
        cppdbgCommands.push({ text: trimmed });
      }
    };
    appendSanitizedCommands(combinedPrimary);
    appendSanitizedCommands(combinedSecondary);
    if (!cppdbgCommands.length) {
      cppdbgCommands.push({ text: 'thb setup' });
    }
    const hasBreakpointCommand = cppdbgCommands.some((entry) => isBreakpointCommand(entry && entry.text));
    cppdbgConfig.setupCommands = cppdbgCommands;
    cppdbgConfig.launchCompleteCommand = hasBreakpointCommand ? 'exec-continue' : 'None';

    const hasCortex = !!vscode.extensions.getExtension('marus25.cortex-debug');
    const configsForFile = hasCortex ? [cortexConfig, cppdbgConfig] : [cppdbgConfig];
    const launchOptions = hasCortex ? undefined : { removeTypes: ['cortex-debug'] };
    const launchPath = await updateLaunchJson(workspaceFolder, configsForFile, launchOptions);
    if (launchPath) {
      channel.appendLine(t('debugLaunchUpdated', { path: launchPath }));
    }

    const configToStart = hasCortex ? cortexConfig : cppdbgConfig;
    channel.appendLine(t('debugLaunchStart', { name: configToStart.name }));
    const started = await vscode.debug.startDebugging(workspaceFolder, configToStart);
    if (!started) {
      vscode.window.showErrorMessage(t('debugLaunchFailed', { msg: 'startDebugging returned false' }));
    }
  } catch (err) {
    showError(err);
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

  const portInfoInitial = getStoredPortInfo();
  if (shouldUseWindowsSerial(portInfoInitial)) {
    const message = t('cliWindowsOnlyOperation');
    vscode.window.showErrorMessage(message);
    channel.appendLine(message);
    return;
  }

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

  let uploadDataCompleted = false;
  const uploadDataProgressTitle = t('uploadDataProgressTitle');
  const progressOutcome = await runWithNotificationProgress({
    location: vscode.ProgressLocation.Notification,
    title: uploadDataProgressTitle
  }, async (progress) => {
    progress.report({ message: t('uploadDataProgressMessageResolve') });
    const cfg = getConfig();
    const exe = cfg.exe || 'arduino-cli';
    const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
    const propsArgs = [...baseArgs, 'compile'];
    if (cfg.verbose) propsArgs.push('--verbose');

    let usingProfile = false;
    let selectedProfile = '';
    let resolvedFqbn = '';
    const yamlInfo = await readSketchYamlInfo(sketchDir);
    if (yamlInfo && yamlInfo.profiles.length > 0) {
      selectedProfile = await resolveProfileName(yamlInfo);
      if (!selectedProfile) return;
      usingProfile = true;
      propsArgs.push('--profile', selectedProfile);
      await rememberSelectedProfile(sketchDir, selectedProfile);
    } else {
      resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
      if (!resolvedFqbn) {
        const set = await commandSetFqbn(true);
        if (!set) return;
        resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
      }
      propsArgs.push('--fqbn', resolvedFqbn);
    }
    propsArgs.push('--show-properties');
    if (cfg.localBuildPath) {
      const buildDir = await ensureLocalBuildPath(sketchDir, usingProfile ? selectedProfile : '', usingProfile ? '' : resolvedFqbn);
      if (buildDir) {
        propsArgs.push('--build-path', buildDir);
      }
    }
    propsArgs.push(sketchDir);

    channel.show();
    channel.appendLine(`${ANSI.cyan}[upload-data] Detecting tool paths via --show-properties${ANSI.reset}`);

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
        const cols = line.split(',').map(s => s.trim());
        if (cols.length >= 5 && /^spiffs$/i.test(cols[0])) {
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

    const outBin = path.join(buildPath, fsType.toLowerCase() + '.bin');
    channel.appendLine(`${ANSI.cyan}[upload-data] Building ${fsType} image (${size}) -> ${outBin}${ANSI.reset}`);
    progress.report({ message: t('uploadDataProgressMessageBuild', { fsType }) });
    try {
      await runExternal(fsExe, ['-s', size, '-c', 'data', outBin], { cwd: sketchDir });
    } catch (e) {
      showError(new Error(`Failed to build ${fsType} image: ${e.message}`));
      return;
    }

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
    let portInfo = getStoredPortInfo();
    let port = portInfo.cliPort;
    if (!port) {
      const set = await commandSetPort(true);
      if (!set) return;
      portInfo = getStoredPortInfo();
      port = portInfo.cliPort;
      if (!port) {
        vscode.window.showWarningMessage(t('portNoSerialMonitorWarn'));
        return;
      }
    }
    const speed = props['upload.speed'] || '115200';

    let reopenMonitorAfter = false;
    if (monitorTerminal) {
      try { monitorTerminal.dispose(); } catch (_) { }
      monitorTerminal = undefined;
      reopenMonitorAfter = true;
    }
    await new Promise((res) => setTimeout(res, 1200));

    const portDisplay = portInfo.display || port;
    channel.appendLine(`${ANSI.cyan}[upload-data] Flashing at ${offset} over ${portDisplay} (${speed} baud)${ANSI.reset}`);
    progress.report({ message: t('uploadDataProgressMessageFlash') });
    try {
      await runExternal(esptoolExe, ['-p', port, '-b', String(speed), 'write_flash', offset, outBin], { cwd: sketchDir });
      vscode.window.showInformationMessage(`Uploaded ${fsType} image to ${portDisplay} at ${offset}`);
      if (reopenMonitorAfter) {
        await new Promise((res) => setTimeout(res, 1500));
        await commandMonitor();
      }
      uploadDataCompleted = true;
    } catch (e) {
      showError(new Error(`esptool failed: ${e.message}`));
    }
  });
  if (progressOutcome === PROGRESS_BUSY) return;
  if (!uploadDataCompleted) return;
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

async function runWithNotificationProgress(options, task) {
  if (notificationProgressActive) {
    vscode.window.showWarningMessage(t('progressBusyWarn'));
    return PROGRESS_BUSY;
  }
  notificationProgressActive = true;
  try {
    return await vscode.window.withProgress(options, async (progress, token) => {
      return await task(progress, token);
    });
  } finally {
    notificationProgressActive = false;
  }
}

function hasBuildExtraFlagsArg(args) {
  if (!Array.isArray(args)) return false;
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed === '--build-property') {
      const next = args[i + 1];
      if (typeof next === 'string' && /^build\.extra_flags=/.test(next.trim())) {
        return true;
      }
      continue;
    }
    if (trimmed.startsWith('--build-property=')) {
      if (trimmed.includes('build.extra_flags=')) {
        return true;
      }
      continue;
    }
    if (/^build\.extra_flags=/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

async function appendExtraFlagsFromFile(originalArgs, baseArgs, sketchDir, channel) {
  if (!sketchDir) return;
  const extraPath = path.join(sketchDir, EXTRA_FLAGS_FILENAME);
  const extraUri = vscode.Uri.file(extraPath);
  let exists = false;
  try {
    exists = await pathExists(extraUri);
  } catch {
    exists = false;
  }
  if (!exists) return;

  let raw = '';
  try {
    raw = await readTextFile(extraUri);
  } catch (err) {
    if (channel) {
      channel.appendLine(t('compileExtraFlagsReadError', {
        file: EXTRA_FLAGS_FILENAME,
        msg: err && err.message ? err.message : String(err || 'unknown')
      }));
    }
    return;
  }
  const flags = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
    .join(' ')
    .trim();
  if (!flags) {
    if (channel) {
      channel.appendLine(t('compileExtraFlagsEmpty', { file: EXTRA_FLAGS_FILENAME }));
    }
    return;
  }
  if (hasBuildExtraFlagsArg(baseArgs) || hasBuildExtraFlagsArg(originalArgs)) {
    if (channel) {
      channel.appendLine(t('compileExtraFlagsSkipExisting', { file: EXTRA_FLAGS_FILENAME }));
    }
    return;
  }
  const sketchIdx = originalArgs.lastIndexOf(sketchDir);
  const insertIdx = sketchIdx >= 0 ? sketchIdx : originalArgs.length;
  originalArgs.splice(insertIdx, 0, '--build-property', `build.extra_flags=${flags}`);
  if (channel) {
    channel.appendLine(t('compileExtraFlagsApplied', { file: EXTRA_FLAGS_FILENAME }));
  }
}

function shouldInjectTimezoneMacros(cfg) {
  if (cfg && typeof cfg.injectTimezoneMacros === 'boolean') {
    return cfg.injectTimezoneMacros;
  }
  try {
    const direct = vscode.workspace.getConfiguration().get('arduino-cli-wrapper.injectTimezoneMacros');
    if (typeof direct === 'boolean') {
      return direct;
    }
  } catch (_) { }
  return true;
}

function ensureTimezoneDefines(originalArgs, baseArgs, sketchDir, cfg) {
  if (!shouldInjectTimezoneMacros(cfg)) return;
  const payload = getTimezoneBuildDefines();
  const addition = payload && payload.flags ? payload.flags : '';
  if (!addition) return;
  if (appendTimezoneFlagsToArgs(originalArgs, addition)) return;
  if (appendTimezoneFlagsToArgs(baseArgs, addition)) return;
  if (!Array.isArray(originalArgs)) return;
  const sketchIdx = typeof sketchDir === 'string' && sketchDir
    ? originalArgs.lastIndexOf(sketchDir)
    : -1;
  const insertIdx = sketchIdx >= 0 ? sketchIdx : originalArgs.length;
  originalArgs.splice(insertIdx, 0, '--build-property', `build.extra_flags=${addition}`);
}

function appendTimezoneFlagsToArgs(arr, addition) {
  if (!Array.isArray(arr) || !addition) return false;
  for (let i = 0; i < arr.length; i += 1) {
    const entry = arr[i];
    if (typeof entry !== 'string') continue;
    if (entry === '--build-property') {
      const next = arr[i + 1];
      if (typeof next === 'string' && next.startsWith('build.extra_flags=')) {
        arr[i + 1] = mergeBuildExtraFlags(next, addition);
        return true;
      }
      continue;
    }
    if (entry.startsWith('--build-property=')) {
      const idx = entry.indexOf('=');
      const prop = entry.slice(idx + 1);
      if (prop.startsWith('build.extra_flags=')) {
        const mergedProp = mergeBuildExtraFlags(prop, addition);
        arr[i] = `${entry.slice(0, idx + 1)}${mergedProp}`;
        return true;
      }
      continue;
    }
    if (entry.startsWith('build.extra_flags=')) {
      arr[i] = mergeBuildExtraFlags(entry, addition);
      return true;
    }
  }
  return false;
}

function mergeBuildExtraFlags(current, addition) {
  if (!addition) return current;
  const prefix = 'build.extra_flags=';
  if (!current.startsWith(prefix)) return current;
  if (current.includes('CLI_BUILD_TZ_IANA')) return current;
  const existing = current.slice(prefix.length).trim();
  if (!existing) return `${prefix}${addition}`;
  if (existing.includes('CLI_BUILD_TZ_IANA')) return current;
  return `${prefix}${existing} ${addition}`;
}

function getTimezoneBuildDefines() {
  if (!timezoneDefineCache) {
    timezoneDefineCache = buildTimezoneDefinePayload();
  }
  return timezoneDefineCache;
}

function buildTimezoneDefinePayload() {
  try {
    const meta = computeTimezoneMetadata();
    const macros = [
      { key: 'CLI_BUILD_TZ_IANA', value: meta.iana, quoted: true },
      { key: 'CLI_BUILD_TZ_POSIX', value: meta.posix, quoted: true },
      { key: 'CLI_BUILD_TZ_OFFSET_SEC', value: String(meta.offsetSeconds), quoted: false },
      { key: 'CLI_BUILD_TZ_OFFSET_ISO', value: meta.offsetIso, quoted: true },
      { key: 'CLI_BUILD_TZ_ABBR', value: meta.abbreviation, quoted: true }
    ].filter((item) => item.value !== undefined && item.value !== null && item.value !== '');
    const flags = macros
      .map((item) => {
        const escaped = item.quoted ? `"${escapeDefineString(item.value)}"` : item.value;
        return `-D${item.key}=${escaped}`;
      })
      .join(' ')
      .trim();
    return { flags, meta };
  } catch (err) {
    return { flags: '', meta: null, error: err };
  }
}

function computeTimezoneMetadata() {
  const iana = detectSystemTimeZone();
  const now = new Date();
  const year = now.getUTCFullYear();
  const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'longOffset' });
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });
  const shortLocales = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'es-ES', 'it-IT', 'ja-JP', 'de-DE', 'fr-FR'];
  const shortFormatters = shortLocales.map((locale) => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: iana, timeZoneName: 'short' });
    } catch (_) {
      return null;
    }
  });
  const longFormatter = new Intl.DateTimeFormat('en', { timeZone: iana, timeZoneName: 'long' });

  const getOffsetMinutes = (date) => {
    try {
      const part = offsetFormatter.formatToParts(date).find((p) => p.type === 'timeZoneName');
      return parseGmtOffsetMinutes(part ? part.value : 'GMT');
    } catch (_) {
      return -date.getTimezoneOffset();
    }
  };

  const currentOffsetMinutes = getOffsetMinutes(now);
  const offsets = new Set();
  for (let month = 0; month < 12; month += 1) {
    const sample = new Date(Date.UTC(year, month, 1, 12, 0, 0));
    offsets.add(getOffsetMinutes(sample));
  }
  const uniqueOffsets = Array.from(offsets).sort((a, b) => a - b);
  const standardOffset = uniqueOffsets.length ? uniqueOffsets[0] : currentOffsetMinutes;
  const dstOffset = uniqueOffsets.length > 1 ? uniqueOffsets[uniqueOffsets.length - 1] : null;

  const stdSample = findSampleDateForOffset(getOffsetMinutes, year, standardOffset) || now;
  const dstSample = dstOffset != null ? findSampleDateForOffset(getOffsetMinutes, year, dstOffset) : null;
  const standardAbbr = resolveAbbreviation(shortFormatters, longFormatter, stdSample) || formatOffsetAsUtcLabel(standardOffset);
  const dstAbbrRaw = dstSample ? resolveAbbreviation(shortFormatters, longFormatter, dstSample) : '';
  const dstAbbr = dstAbbrRaw || (dstOffset != null && standardAbbr ? `${standardAbbr}D` : '');

  const transitions = dstOffset != null
    ? findDstTransitions({
      year,
      getOffsetMinutes,
      dateFormatter,
      standardOffset,
      dstOffset
    })
    : { startRule: '', endRule: '', startOffset: null, endOffset: null };

  const posix = buildPosixString({
    standardAbbr,
    standardOffset,
    dstAbbr,
    dstOffset,
    startRule: transitions.startRule,
    endRule: transitions.endRule
  });

  const abbreviation = dstOffset != null && dstAbbr && dstAbbr !== standardAbbr
    ? `${standardAbbr}/${dstAbbr}`
    : standardAbbr;

  return {
    iana,
    posix,
    offsetSeconds: currentOffsetMinutes * 60,
    offsetIso: formatIsoOffset(currentOffsetMinutes),
    abbreviation
  };
}

function detectSystemTimeZone() {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolved && typeof resolved === 'string') return resolved;
  if (typeof process.env.TZ === 'string' && process.env.TZ) return process.env.TZ;
  return 'UTC';
}

function parseGmtOffsetMinutes(label) {
  if (!label) return 0;
  if (label === 'GMT' || label === 'UTC') return 0;
  const match = String(label).match(/^(?:GMT|UTC)([+-])(\d{2})(?::?(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10) || 0;
  const minutes = parseInt(match[3] || '0', 10) || 0;
  return sign * (hours * 60 + minutes);
}

function findSampleDateForOffset(getOffsetMinutes, year, targetOffset) {
  for (let month = 0; month < 12; month += 1) {
    for (let day = 1; day <= 28; day += 7) {
      const sample = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (getOffsetMinutes(sample) === targetOffset) return sample;
    }
  }
  return null;
}

function resolveAbbreviation(shortFormatters, longFormatter, date) {
  for (const fmt of shortFormatters) {
    if (!fmt) continue;
    try {
      const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName');
      if (!part) continue;
      const normalized = normalizeAbbreviation(part.value);
      if (normalized && !/^UTC[+-]?\d/.test(normalized)) {
        return normalized;
      }
      if (normalized && !normalized.startsWith('UTC')) {
        return normalized;
      }
    } catch (_) {
      continue;
    }
  }
  try {
    const part = longFormatter.formatToParts(date).find((p) => p.type === 'timeZoneName');
    const derived = deriveAbbreviationFromLong(part ? part.value : '');
    if (derived) return derived;
  } catch (_) {
    // ignore
  }
  return '';
}

function normalizeAbbreviation(label) {
  if (!label) return '';
  const trimmed = label.trim();
  const upper = TIMEZONE_ABBREVIATION_MAP[trimmed] || TIMEZONE_ABBREVIATION_MAP[trimmed.toUpperCase()] || trimmed.toUpperCase();
  if (/^GMT[+-]/.test(upper)) {
    return upper.replace(/^GMT/, 'UTC');
  }
  if (/^[A-Z]{2,5}(?:\/[A-Z]{2,5})?$/.test(upper)) {
    return upper;
  }
  if (/^UTC[+-]?\d/.test(upper)) {
    return upper;
  }
  return upper;
}

const TIMEZONE_ABBREVIATION_MAP = {
  MESZ: 'CEST',
  MEZ: 'CET',
  OESZ: 'EEST',
  OEZ: 'EET',
  HNE: 'EST',
  HAE: 'EDT',
  HNC: 'CST',
  HAC: 'CDT',
  HNR: 'MST',
  HAR: 'MDT',
  HNP: 'PST',
  HAP: 'PDT',
  '日本標準時': 'JST'
};

function deriveAbbreviationFromLong(longName) {
  if (!longName) return '';
  const cleaned = longName.replace(/\b(Time|Zone)\b/gi, '').trim();
  const primaryWords = cleaned.split(/[\s-]+/).filter(Boolean);
  let letters = primaryWords
    .filter((word) => !/^(Standard|Daylight|Summer|Winter)$/i.test(word))
    .map((word) => word[0] ? word[0].toUpperCase() : '')
    .join('');
  if (letters.length >= 3) return letters.substring(0, 4);
  letters = primaryWords.map((word) => word[0] ? word[0].toUpperCase() : '').join('');
  if (letters.length >= 2) {
    if (letters.length === 2) return `${letters}T`;
    return letters.substring(0, 4);
  }
  return '';
}

function findDstTransitions({ year, getOffsetMinutes, dateFormatter, standardOffset, dstOffset }) {
  const startOfYear = Date.UTC(year, 0, 1);
  const endOfYear = Date.UTC(year + 1, 0, 1);
  const step = 3600000;
  let prevOffset = getOffsetMinutes(new Date(startOfYear));
  const result = { startRule: '', endRule: '', startOffset: null, endOffset: null };
  for (let ts = startOfYear + step; ts < endOfYear; ts += step) {
    const offset = getOffsetMinutes(new Date(ts));
    if (offset === prevOffset) continue;
    const refined = refineTransitionTimestamp(ts - step, ts, prevOffset, offset, getOffsetMinutes);
    const rule = buildPosixRule(refined, prevOffset, dateFormatter);
    if (offset > prevOffset && !result.startRule) {
      result.startRule = rule;
      result.startOffset = offset;
    } else if (offset < prevOffset && !result.endRule) {
      result.endRule = rule;
      result.endOffset = offset;
    }
    prevOffset = offset;
    if (result.startRule && result.endRule) break;
  }
  return result;
}

function refineTransitionTimestamp(startTs, endTs, prevOffset, newOffset, getOffsetMinutes) {
  let low = startTs;
  let high = endTs;
  while (high - low > 60000) {
    const mid = Math.floor((low + high) / 2);
    const offset = getOffsetMinutes(new Date(mid));
    if (offset === newOffset) {
      high = mid;
    } else {
      low = mid;
    }
  }
  for (let ts = low; ts <= high; ts += 60000) {
    const offset = getOffsetMinutes(new Date(ts));
    if (offset === newOffset) {
      return ts;
    }
  }
  return high;
}

function buildPosixRule(timestamp, prevOffset, dateFormatter) {
  const beforeTs = Math.max(timestamp - 60000, timestamp - 60000);
  const components = extractLocalComponents(new Date(beforeTs), dateFormatter);
  const adjusted = incrementMinute(components);
  const week = computeWeekOfMonth(adjusted.year, adjusted.month, adjusted.day);
  const timePart = formatRuleTime(adjusted.hour, adjusted.minute, adjusted.second);
  return `M${adjusted.month}.${week}.${adjusted.weekday}/${timePart}`;
}

function extractLocalComponents(date, formatter) {
  const parts = formatter.formatToParts(date);
  const data = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay()
  };
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const part of parts) {
    switch (part.type) {
      case 'year': data.year = Number(part.value); break;
      case 'month': data.month = Number(part.value); break;
      case 'day': data.day = Number(part.value); break;
      case 'hour': data.hour = Number(part.value); break;
      case 'minute': data.minute = Number(part.value); break;
      case 'second': data.second = Number(part.value); break;
      case 'weekday': data.weekday = weekdayMap[part.value] ?? data.weekday; break;
      default: break;
    }
  }
  return data;
}

function incrementMinute(components) {
  const result = { ...components };
  result.minute += 1;
  if (result.minute >= 60) {
    result.minute -= 60;
    result.hour += 1;
  }
  if (result.hour >= 24) {
    result.hour -= 24;
    result.day += 1;
    result.weekday = (result.weekday + 1) % 7;
    const dim = daysInMonth(result.year, result.month);
    if (result.day > dim) {
      result.day = 1;
      result.month += 1;
      if (result.month > 12) {
        result.month = 1;
        result.year += 1;
      }
    }
  }
  result.second = 0;
  return result;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function computeWeekOfMonth(year, month, day) {
  const dim = daysInMonth(year, month);
  const week = Math.floor((day - 1) / 7) + 1;
  if (day + 7 > dim) return 5;
  return week;
}

function formatRuleTime(hour, minute, second) {
  let result = String(hour);
  if (minute || second) {
    result += `:${minute.toString().padStart(2, '0')}`;
  }
  if (second) {
    result += `:${second.toString().padStart(2, '0')}`;
  }
  return result;
}

function buildPosixString({ standardAbbr, standardOffset, dstAbbr, dstOffset, startRule, endRule }) {
  const stdAbbr = standardAbbr || 'UTC';
  const base = `${stdAbbr}${formatPosixOffset(standardOffset)}`;
  if (!dstOffset || !startRule || !endRule) {
    return base;
  }
  const dstPart = dstAbbr && dstAbbr !== stdAbbr ? dstAbbr : `${stdAbbr}D`;
  const offsetDelta = dstOffset - standardOffset;
  const dstOffsetPart = offsetDelta === 60 ? '' : formatPosixOffset(dstOffset);
  return `${base}${dstPart}${dstOffsetPart ? dstOffsetPart : ''},${startRule},${endRule}`;
}

function formatPosixOffset(offsetMinutes) {
  const total = -offsetMinutes;
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (minutes === 0) return `${sign}${hours}`;
  return `${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
}

function formatIsoOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function formatOffsetAsUtcLabel(offsetMinutes) {
  const iso = formatIsoOffset(offsetMinutes);
  return `UTC${iso}`;
}

function escapeDefineString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

// Run compile and update IntelliSense by exporting compile_commands.json.
async function compileWithIntelliSense(sketchDir, args, opts = {}) {
  const { profileName = '', wokwiEnabled = false, fqbn = '', skipLocalBuildPath = false } = opts || {};
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra.slice() : [];
  const originalArgs = Array.isArray(args) ? args.slice() : [];
  const startTime = Date.now();
  if (originalArgs.length === 0 || originalArgs[0] !== 'compile') {
    originalArgs.unshift('compile');
  }
  if (!originalArgs.includes(sketchDir)) {
    originalArgs.push(sketchDir);
  }
  try {
    await embedAssetsForSketch(sketchDir, { silent: true });
  } catch (err) {
    throw err;
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

  const channel = getOutput();
  let localBuildPath = '';
  if (cfg.localBuildPath && !skipLocalBuildPath) {
    try {
      localBuildPath = await ensureLocalBuildPath(sketchDir, profileName, fqbn);
    } catch (_) {
      localBuildPath = '';
    }
    if (localBuildPath) {
      let replaced = false;
      for (let i = 0; i < originalArgs.length; i += 1) {
        const value = originalArgs[i];
        if (value === '--build-path') {
          if (i + 1 < originalArgs.length) {
            originalArgs[i + 1] = localBuildPath;
            replaced = true;
          }
          break;
        }
        if (typeof value === 'string' && value.startsWith('--build-path=')) {
          originalArgs[i] = `--build-path=${localBuildPath}`;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        const sketchIdx = originalArgs.lastIndexOf(sketchDir);
        const insertIdx = sketchIdx >= 0 ? sketchIdx : originalArgs.length;
        originalArgs.splice(insertIdx, 0, '--build-path', localBuildPath);
      }
    }
  }

  await appendExtraFlagsFromFile(originalArgs, baseArgs, sketchDir, channel);
  ensureTimezoneDefines(originalArgs, baseArgs, sketchDir, cfg);

  const compileArgs = originalArgs.slice();

  const finalArgs = [...baseArgs, ...compileArgs];
  if (compileDiagnostics) {
    try { compileDiagnostics.clear(); } catch (_) { }
  }
  const term = getAnsiLogTerminal();
  term.terminal.show(true);
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  term.write(`${ANSI.cyan}$ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}\r\n`);
  term.write(`${ANSI.dim}(cwd: ${sketchDir})${ANSI.reset}\r\n`);

  const runCompile = () => new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, { cwd: sketchDir, shell: false });
    let stderrBuffer = '';
    let stdoutBuffer = '';
    const writeToTerminal = (raw) => {
      term.write(raw.replace(/\r?\n/g, '\r\n'));
    };
    child.stdout.on('data', (chunk) => {
      const raw = chunk.toString();
      stdoutBuffer += raw;
      writeToTerminal(raw);
    });
    child.stderr.on('data', (chunk) => {
      const raw = chunk.toString();
      stderrBuffer += raw;
      writeToTerminal(raw);
    });
    child.on('error', (err) => {
      if (err && typeof err === 'object') {
        err.durationMs = Date.now() - startTime;
      }
      channel.appendLine(`[error] ${err.message}`);
      reject(err);
    });
    child.on('close', async (code) => {
      const durationMs = Date.now() - startTime;
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

      let buildPath = localBuildPath;
      let compileCommandCount = -1;
      try {
        await ensureCompileCommandsSetting(sketchDir);
        if (!buildPath) {
          buildPath = await detectBuildPathForCompile(exe, baseArgs, originalArgs, sketchDir);
        }
        if (!buildPath) {
          channel.appendLine(t('compileCommandsBuildPathMissing'));
        } else {
          compileCommandCount = await updateCompileCommandsFromBuild(sketchDir, buildPath);
          if (compileCommandCount > 0) {
            channel.appendLine(t('compileCommandsUpdated', { count: compileCommandCount }));
          } else if (compileCommandCount === 0) {
            channel.appendLine(t('compileCommandsNoInoEntries'));
          }
        }
      } catch (err) {
        channel.appendLine(`[warn] ${err.message}`);
      }
      if (code === 0) {
        if (wokwiEnabled && profileName && buildPath) {
          try {
            await handleWokwiArtifacts(sketchDir, profileName, buildPath);
          } catch (err) {
            channel.appendLine(`[warn] ${err.message}`);
          }
        }
        resolve({ code, stdout: stdoutBuffer, stderr: stderrBuffer, durationMs });
        return;
      }
      const err = new Error(`arduino-cli exited with code ${code}`);
      err.code = code;
      err.stdout = stdoutBuffer;
      err.stderr = stderrBuffer;
      err.durationMs = durationMs;
      reject(err);
      return;
    });
  });

  if (opts && opts.skipProgress === true) {
    return runCompile();
  }
  const progressTitle = t('compileProgressTitle');
  const progressMessage = profileName
    ? t('compileProgressMessageProfile', { profile: profileName })
    : (fqbn
      ? t('compileProgressMessageFqbn', { fqbn })
      : t('compileProgressMessage'));
  const progressResult = await runWithNotificationProgress({
    location: vscode.ProgressLocation.Notification,
    title: progressTitle
  }, async (progress) => {
    if (progressMessage) progress.report({ message: progressMessage });
    return runCompile();
  });
  return progressResult;
}

async function detectBuildPathForCompile(exe, baseArgs, args, sketchDir) {
  const derivedArgs = Array.isArray(args) ? args.slice() : [];
  if (derivedArgs.length === 0 || derivedArgs[0] !== 'compile') {
    derivedArgs.unshift('compile');
  }
  if (!derivedArgs.includes(sketchDir)) {
    derivedArgs.push(sketchDir);
  }
  for (let i = 0; i < derivedArgs.length; i += 1) {
    const value = derivedArgs[i];
    if (value === '--build-path') {
      const next = derivedArgs[i + 1];
      if (typeof next === 'string' && next.trim()) {
        const resolved = path.isAbsolute(next) ? next : path.resolve(sketchDir, next);
        return path.normalize(resolved);
      }
      break;
    }
    if (typeof value === 'string' && value.startsWith('--build-path=')) {
      const raw = value.slice('--build-path='.length).trim();
      if (raw) {
        const resolved = path.isAbsolute(raw) ? raw : path.resolve(sketchDir, raw);
        return path.normalize(resolved);
      }
      break;
    }
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

async function performUploadWithPortStrategy(params) {
  const { sketchDir } = params;
  if (!sketchDir) throw new Error('Sketch directory is required for upload');
  const cfg = params.cfg || getConfig();
  const baseArgs = Array.isArray(params.baseArgs) ? params.baseArgs.slice() : ['upload'];
  if (baseArgs.length === 0 || baseArgs[0] !== 'upload') baseArgs.unshift('upload');
  const displayBaseArgs = baseArgs.slice();
  const compileArgs = Array.isArray(params.compileArgs) ? params.compileArgs.slice() : ['compile', sketchDir];

  let buildPath = '';
  try {
    buildPath = await detectBuildPathForCompile(cfg.exe || 'arduino-cli', Array.isArray(cfg.extra) ? cfg.extra : [], compileArgs, sketchDir);
  } catch (_) {
    buildPath = '';
  }

  const portInfo = getStoredPortInfo();
  const otaPortCandidate = portInfo?.cliPort || '';
  let otaPasswordDisplayToken = '';
  let otaPasswordDisplayTokenLinux = '';
  let otaPasswordDisplayTokenWindows = '';
  const otaDisplayFieldInjected = portContainsIpAddress(otaPortCandidate) && !hasUploadPasswordField(baseArgs);
  if (otaDisplayFieldInjected) {
    const otaPasswordValue = Object.prototype.hasOwnProperty.call(process.env, 'ARDUINO_CLI_OTA_PASSWORD')
      ? String(process.env.ARDUINO_CLI_OTA_PASSWORD || '')
      : '';
    baseArgs.push('--upload-field');
    baseArgs.push(`password=${otaPasswordValue}`);
    displayBaseArgs.push('--upload-field');
    otaPasswordDisplayTokenLinux = 'password=$ARDUINO_CLI_OTA_PASSWORD';
    otaPasswordDisplayTokenWindows = 'password=%ARDUINO_CLI_OTA_PASSWORD%';
    otaPasswordDisplayToken = process.platform === 'win32' ? otaPasswordDisplayTokenWindows : otaPasswordDisplayTokenLinux;
    displayBaseArgs.push(otaPasswordDisplayToken);
  }
  const windowsCandidate = shouldUseWindowsSerial(portInfo);

  if (windowsCandidate) {
    const sketchWinPath = await convertPathForWindowsCli(sketchDir);
    const buildWinPath = buildPath ? await convertPathForWindowsCli(buildPath) : '';
    if (sketchWinPath && buildWinPath) {
      const options = baseArgs.slice(1);
      const displayOptions = displayBaseArgs.slice(1).map((arg) => {
        if (!otaDisplayFieldInjected) return arg;
        if (arg === otaPasswordDisplayToken || arg === otaPasswordDisplayTokenLinux) {
          return otaPasswordDisplayTokenWindows || 'password=%ARDUINO_CLI_OTA_PASSWORD%';
        }
        return arg;
      });
      const windowsArgs = ['upload', sketchWinPath, ...options];
      const windowsDisplayArgs = ['upload', sketchWinPath, ...displayOptions];
      if (!hasBuildPathFlag(windowsArgs) && buildWinPath) {
        windowsArgs.push('--build-path', buildWinPath);
        windowsDisplayArgs.push('--build-path', buildWinPath);
      }
      try {
        await runWindowsCli(windowsArgs, { logArgs: windowsDisplayArgs });
        return;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'unknown');
        getOutput().appendLine(t('cliWindowsUploadFallback', { msg }));
      }
    }
  }

  const linuxArgs = baseArgs.slice();
  linuxArgs.push(sketchDir);
  const displayLinuxArgs = displayBaseArgs.slice().map((arg) => {
    if (!otaDisplayFieldInjected) return arg;
    if (arg === otaPasswordDisplayTokenWindows && process.platform !== 'win32') {
      return otaPasswordDisplayTokenLinux || 'password=$ARDUINO_CLI_OTA_PASSWORD';
    }
    return arg;
  });
  displayLinuxArgs.push(sketchDir);
  await runCli(linuxArgs, { cwd: sketchDir, forceSpawn: true, logArgs: displayLinuxArgs });
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
      if (isWarning) {
        if (skipWarningsOutsideWorkspace) {
          continue;
        }
        if (!allowOutsideDiagnostics) {
          continue;
        }
      } else if (!allowOutsideDiagnostics && severity !== vscode.DiagnosticSeverity.Error) {
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

const SOURCE_PATH_PATTERN = /\.(?:ino(?:\.cpp)?|c|cc|cpp|cxx|m|mm|s|sx|S)$/i;

function findSourcePathFromArgs(args) {
  if (!Array.isArray(args)) return '';
  for (let i = args.length - 1; i >= 0; i -= 1) {
    let value = args[i];
    if (typeof value !== 'string') {
      value = value == null ? '' : String(value);
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (SOURCE_PATH_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  return '';
}

function normalizeCompileTaskArgs(args, compileInfo) {
  if (!Array.isArray(args)) return [];
  const normalized = [];
  const skipTokens = new Set(['-E', '-CC', '-w']);
  const objectPathRaw = compileInfo && typeof compileInfo.object_path === 'string'
    ? compileInfo.object_path.trim()
    : '';
  for (let i = 0; i < args.length; i += 1) {
    let token = args[i];
    if (typeof token !== 'string') {
      token = token == null ? '' : String(token);
    }
    if (!token) {
      continue;
    }
    if (skipTokens.has(token)) {
      continue;
    }
    if (token === '-o') {
      let target = objectPathRaw;
      if (!target) {
        const next = i + 1 < args.length ? args[i + 1] : '';
        target = typeof next === 'string' ? next : String(next || '');
      }
      if (target && target !== '/dev/null') {
        normalized.push('-o');
        normalized.push(target);
      }
      if (i + 1 < args.length) {
        i += 1;
      }
      continue;
    }
    if (objectPathRaw && token === '/dev/null') {
      continue;
    }
    normalized.push(token);
  }
  return normalized;
}

async function rebuildCompileCommandsFromCache(sketchDir, buildPath) {
  if (!buildPath) return [];
  const includesUri = vscode.Uri.file(path.join(buildPath, 'includes.cache'));
  if (!(await pathExists(includesUri))) return [];
  let payloadText = '';
  try {
    payloadText = await readTextFile(includesUri);
  } catch (_) {
    return [];
  }
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  let baseDirectory = typeof sketchDir === 'string' && sketchDir ? sketchDir : '';
  try {
    const optionsUri = vscode.Uri.file(path.join(buildPath, 'build.options.json'));
    if (await pathExists(optionsUri)) {
      const raw = await readTextFile(optionsUri);
      const json = JSON.parse(raw);
      if (json && typeof json.sketchLocation === 'string' && json.sketchLocation.trim()) {
        baseDirectory = json.sketchLocation.trim();
      }
    }
  } catch (_) {
    // Ignore build.options.json failures and fall back to sketchDir.
  }
  const results = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const task = entry.compile_task;
    const compileInfo = entry.compile || {};
    if (!task || typeof task !== 'object') continue;
    const args = Array.isArray(task.args) ? task.args : [];
    if (args.length === 0) continue;
    const sourcePath = typeof compileInfo.source_path === 'string' && compileInfo.source_path.trim()
      ? compileInfo.source_path.trim()
      : findSourcePathFromArgs(args);
    if (!sourcePath) continue;
    const normalizedArgs = normalizeCompileTaskArgs(args, compileInfo);
    if (normalizedArgs.length === 0) continue;
    let resolvedSource = sourcePath;
    try {
      resolvedSource = path.normalize(sourcePath);
    } catch (_) {
      resolvedSource = sourcePath;
    }
    let resolvedDir = baseDirectory;
    if (!resolvedDir) {
      try {
        resolvedDir = path.dirname(resolvedSource);
      } catch (_) {
        resolvedDir = sketchDir || '';
      }
    }
    results.push({
      directory: resolvedDir,
      arguments: normalizedArgs.map((value) => {
        if (typeof value === 'string') return value;
        if (value == null) return '';
        return String(value);
      }),
      file: resolvedSource
    });
  }
  return results;
}

async function updateCompileCommandsFromBuild(sketchDir, buildPath) {
  try {
    const sourcePath = path.join(buildPath, 'compile_commands.json');
    const sourceUri = vscode.Uri.file(sourcePath);
    const sourceExists = await pathExists(sourceUri);
    let parsed;
    let invalidFormat = false;
    let usedFallback = false;
    try {
      if (sourceExists) {
        const raw = await readTextFile(sourceUri);
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          invalidFormat = true;
        }
      }
    } catch (err) {
      getOutput().appendLine(t('compileCommandsParseError', { msg: err.message }));
    }

    if (!Array.isArray(parsed)) {
      const fallback = await rebuildCompileCommandsFromCache(sketchDir, buildPath);
      if (Array.isArray(fallback) && fallback.length > 0) {
        parsed = fallback;
        usedFallback = true;
      } else {
        if (!sourceExists) {
          getOutput().appendLine(t('compileCommandsSourceMissing', { path: sourcePath }));
        } else if (invalidFormat) {
          getOutput().appendLine(t('compileCommandsInvalidFormat'));
        }
        return -1;
      }
    }
    const filtered = [];
    let workspaceInoMapPromise;
    const getWorkspaceInoMap = async () => {
      if (!workspaceInoMapPromise) {
        workspaceInoMapPromise = (async () => {
          const map = new Map();
          try {
            const files = filterUrisOutsideBuild(await vscode.workspace.findFiles('**/*.ino'));
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

    if (usedFallback) {
      getOutput().appendLine(t('compileCommandsRebuiltFromCache', { count: filtered.length }));
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

function getWokwiDiagramTemplate(fqbn) {
  if (fqbn) {
    const normalized = String(fqbn).trim().toLowerCase();
    if (normalized) {
      const exact = WOKWI_DIAGRAM_TEMPLATES[normalized];
      if (exact) return exact;
      const parts = normalized.split(':');
      if (parts.length >= 2 && parts[1] === 'esp32') {
        return WOKWI_GENERIC_ESP32_TEMPLATE;
      }
    }
  }
  return WOKWI_DIAGRAM_TEMPLATES['arduino:avr:uno'];
}

function buildWokwiDiagramJson(fqbn) {
  const template = getWokwiDiagramTemplate(fqbn) || WOKWI_DIAGRAM_TEMPLATES['arduino:avr:uno'];
  const clone = (value) => JSON.parse(JSON.stringify(value || []));
  const diagram = {
    version: DEFAULT_WOKWI_DIAGRAM_BASE.version,
    author: DEFAULT_WOKWI_DIAGRAM_BASE.author,
    editor: DEFAULT_WOKWI_DIAGRAM_BASE.editor,
    parts: clone(template.parts),
    connections: clone(template.connections),
    dependencies: {}
  };
  return JSON.stringify(diagram, null, 2) + '\n';
}

async function ensureWokwiDefaults(baseDirPath, profileName, options = {}) {
  const baseUri = vscode.Uri.file(baseDirPath);
  try { await vscode.workspace.fs.createDirectory(baseUri); } catch { }
  const channel = getOutput();
  const diagramUri = vscode.Uri.file(path.join(baseDirPath, 'diagram.json'));
  if (!(await pathExists(diagramUri))) {
    let resolvedFqbn = '';
    const opt = options || {};
    if (typeof opt.fqbn === 'string' && opt.fqbn.trim()) {
      resolvedFqbn = opt.fqbn.trim();
    }
    if (!resolvedFqbn && opt.sketchDir) {
      try {
        resolvedFqbn = await getFqbnFromSketchYaml(opt.sketchDir, opt.profileName || profileName);
      } catch { resolvedFqbn = ''; }
    }
    if (!resolvedFqbn) {
      const stored = extContext?.workspaceState?.get(STATE_FQBN, '');
      if (stored) resolvedFqbn = stored;
    }
    await writeTextFile(diagramUri, buildWokwiDiagramJson(resolvedFqbn));
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
  await ensureWokwiDefaults(wokwiDirPath, profileName, { sketchDir, profileName });
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
  try {
    const storedTs = Number(context.globalState.get(STATE_LAST_AUTO_UPDATE, 0));
    if (!Number.isNaN(storedTs) && storedTs > 0) {
      lastAutoUpdateAt = storedTs;
    }
  } catch (_) { lastAutoUpdateAt = 0; }
  setupIncludeOrderLint(context);
  setupArduinoSecretsSupport(context);
  setupBuildOptSupport(context);
  compileDiagnostics = vscode.languages.createDiagnosticCollection('arduinoCliCompile');
  context.subscriptions.push(compileDiagnostics);
  assetsDiagnostics = vscode.languages.createDiagnosticCollection('arduinoCliAssets');
  context.subscriptions.push(assetsDiagnostics);
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
        if (action === 'debug') return commandDebug(sketchDir, profile);
        if (action === 'version') return vscode.commands.executeCommand('arduino-cli.version');
        if (action === 'listBoards') return vscode.commands.executeCommand('arduino-cli.listBoards');
        if (action === 'listAllBoards') return vscode.commands.executeCommand('arduino-cli.listAllBoards');
        if (action === 'embedAssets') {
          if (sketchDir) return embedAssetsForSketch(sketchDir, { createDirIfMissing: true });
          return vscode.commands.executeCommand('arduino-cli.embedAssets');
        }
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
        if (action === 'commandCenter') return vscode.commands.executeCommand('arduino-cli.commandCenter');
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
    vscode.commands.registerCommand('arduino-cli.commandCenter', commandOpenCommandCenter),
    vscode.commands.registerCommand('arduino-cli.version', commandVersion),
    vscode.commands.registerCommand('arduino-cli.update', commandUpdate),
    vscode.commands.registerCommand('arduino-cli.upgrade', commandUpgrade),
    vscode.commands.registerCommand('arduino-cli.cacheClean', commandCacheClean),
    vscode.commands.registerCommand('arduino-cli.listBoards', commandListBoards),
    vscode.commands.registerCommand('arduino-cli.listAllBoards', commandListAllBoards),
    vscode.commands.registerCommand('arduino-cli.boardDetails', commandBoardDetails),
    vscode.commands.registerCommand('arduino-cli.runArbitrary', commandRunArbitrary),
    vscode.commands.registerCommand('arduino-cli.compile', commandCompile),
    vscode.commands.registerCommand('arduino-cli.configureWarnings', commandConfigureWarnings),
    vscode.commands.registerCommand('arduino-cli.versionCheck', commandVersionCheck),
    vscode.commands.registerCommand('arduino-cli.buildCheck', commandBuildCheck),
    vscode.commands.registerCommand('arduino-cli.cleanCompile', commandCleanCompile),
    vscode.commands.registerCommand('arduino-cli.embedAssets', commandEmbedAssets),
    vscode.commands.registerCommand('arduino-cli.upload', commandUpload),
    vscode.commands.registerCommand('arduino-cli.debug', () => commandDebug()),
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
  vscode.workspace.onDidSaveTextDocument(async (doc) => {
    try {
      const basename = path.basename(doc.fileName || '').toLowerCase();
      if (basename !== 'sketch.yaml') return;
      await vscode.commands.executeCommand('arduino-cli.refreshView');
      await updateStatusBar();
    } catch { /* ignore refresh failures */ }
  }, null, context.subscriptions);
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
    new CommandItem('Monitor', 'monitor', dir, profile, parent, t('treeMonitor')),
  ];
  if (features && features.wokwiEnabled) {
    items.splice(2, 0, new CommandItem('Run in Wokwi', 'wokwiRun', dir, profile, parent, t('treeWokwiRun')));
  }
  if (profile !== null && profile !== undefined && profile !== '') {
    items.push(new CommandItem('Debug', 'debug', dir, profile, parent, t('treeDebug')));
  }
  items.push(
    new CommandItem('Embed Assets', 'embedAssets', dir, profile, parent, t('treeEmbedAssets')),
    new CommandItem('Upload Data', 'uploadData', dir, profile, parent, t('treeUploadData'))
  );
  items.push(
    new CommandItem('Sketch.yaml Helper', 'helper', dir, profile, parent, t('treeHelper')),
    new CommandItem('Open Examples', 'examples', dir, profile, parent, t('treeExamples')),
    new CommandItem('Inspect', 'inspect', dir, profile, parent, t('treeInspect')),
  );
  return items;
}

// Commands at the root level (not tied to a specific sketch/profile)
function globalCommandItems() {
  return [
    new CommandItem('Command Center', 'commandCenter', '', '', undefined, t('treeCommandCenter')),
    new CommandItem('CLI Version', 'version', '', '', undefined, t('treeCliVersion')),
    new CommandItem('Sketch.yaml Helper', 'helper', '', '', undefined, t('treeHelper')),
    new CommandItem('Open Inspector', 'inspect', '', '', undefined, t('treeInspectorOpen')),
    new CommandItem('Sketch.yaml Versions', 'versionCheck', '', '', undefined, t('treeVersionCheck')),
    new CommandItem('Build Check', 'buildCheck', '', '', undefined, t('treeBuildCheck')),
    new CommandItem('New Sketch', 'sketchNew', '', '', undefined, t('treeNewSketch')),
    new CommandItem('Refresh View', 'refreshView', '', '', undefined, t('treeRefresh')),
  ];
}

async function findSketches() {
  /** @type {{dir:string,name:string}[]} */
  const results = [];
  try {
    const uris = filterUrisOutsideBuild(await vscode.workspace.findFiles('**/*.ino', '**/{node_modules,.git}/**', 50));
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
      matches = filterUrisOutsideBuild(await vscode.workspace.findFiles(pattern));
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
  if (sketchDir && profile) {
    await rememberSelectedProfile(sketchDir, profile);
  }
  const cfg = getConfig();
  const channel = getOutput();
  const args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  let wokwiEnabled = false;
  let resolvedFqbn = '';
  if (profile) {
    args.push('--profile', profile);
    try {
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      wokwiEnabled = isProfileWokwiEnabled(yamlInfo, profile);
    } catch { }
  } else {
    // fallback to FQBN/state
    resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!resolvedFqbn) { const set = await commandSetFqbn(true); if (!set) return; resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || ''; }
    args.push('--fqbn', resolvedFqbn);
  }
  args.push(sketchDir);
  const opts = profile ? { profileName: profile, wokwiEnabled } : { fqbn: resolvedFqbn };
  try {
    const result = await compileWithIntelliSense(sketchDir, args, opts);
    if (result && typeof result.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'compile',
        seconds: formatDurationSeconds(result.durationMs)
      }));
    }
  } catch (e) {
    if (e && typeof e.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'compile',
        seconds: formatDurationSeconds(e.durationMs)
      }));
    }
    throw e;
  }
}
async function runCleanCompileFor(sketchDir, profile) {
  if (!(await ensureCliReady())) return;
  if (sketchDir && profile) {
    await rememberSelectedProfile(sketchDir, profile);
  }
  const cfg = getConfig();
  const channel = getOutput();
  const args = ['compile', '--clean'];
  if (cfg.verbose) args.push('--verbose');
  let wokwiEnabled = false;
  let resolvedFqbn = '';
  if (profile) {
    args.push('--profile', profile);
    try {
      const yamlInfo = await readSketchYamlInfo(sketchDir);
      wokwiEnabled = isProfileWokwiEnabled(yamlInfo, profile);
    } catch { }
  } else {
    resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!resolvedFqbn) { const set = await commandSetFqbn(true); if (!set) return; resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || ''; }
    args.push('--fqbn', resolvedFqbn);
  }
  args.push(sketchDir);
  const opts = profile
    ? { emptyIncludePath: true, profileName: profile, wokwiEnabled }
    : { emptyIncludePath: true, fqbn: resolvedFqbn };
  try {
    const result = await compileWithIntelliSense(sketchDir, args, opts);
    if (result && typeof result.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'clean-compile',
        seconds: formatDurationSeconds(result.durationMs)
      }));
    }
  } catch (e) {
    if (e && typeof e.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'clean-compile',
        seconds: formatDurationSeconds(e.durationMs)
      }));
    }
    throw e;
  }
}
async function runUploadFor(sketchDir, profile) {
  if (!(await ensureCliReady())) return;
  if (sketchDir && profile) {
    await rememberSelectedProfile(sketchDir, profile);
  }
  const cfg = getConfig();
  const channel = getOutput();
  // Require port
  const portInfoInitial = getStoredPortInfo();
  const noPortSelected = isNoPortSelected(portInfoInitial);
  const currentPort = portInfoInitial.cliPort;
  if (!currentPort && !noPortSelected) { vscode.window.showErrorMessage(t('portUnsetWarn')); return; }
  // Build args
  const cArgs = ['compile']; if (cfg.verbose) cArgs.push('--verbose');
  const uArgs = ['upload']; if (cfg.verbose) uArgs.push('--verbose');
  let yamlInfo;
  try { yamlInfo = await readSketchYamlInfo(sketchDir); } catch { yamlInfo = null; }
  let wokwiEnabled = false;
  let resolvedFqbn = '';
  if (profile) {
    cArgs.push('--profile', profile); uArgs.push('--profile', profile);
    try { if (yamlInfo) wokwiEnabled = isProfileWokwiEnabled(yamlInfo, profile); } catch { }
  } else {
    resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    if (!resolvedFqbn) { const set = await commandSetFqbn(true); if (!set) return; resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || ''; }
    cArgs.push('--fqbn', resolvedFqbn); uArgs.push('--fqbn', resolvedFqbn);
  }
  const portInfo = getStoredPortInfo();
  const port = portInfo.cliPort;
  if (port) uArgs.push('-p', port);
  cArgs.push(sketchDir);
  const opts = profile ? { profileName: profile, wokwiEnabled } : { fqbn: resolvedFqbn };
  try {
    if (noPortSelected) {
      channel.appendLine(t('uploadNoSerialInfo'));
    }
    const result = await compileWithIntelliSense(sketchDir, cArgs, opts);
    if (result === PROGRESS_BUSY) return;
    if (result && typeof result.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'upload',
        seconds: formatDurationSeconds(result.durationMs)
      }));
    }
  } catch (e) {
    if (e && typeof e.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'upload',
        seconds: formatDurationSeconds(e.durationMs)
      }));
    }
    throw e;
  }
  let reopenMonitorAfter = false;
  if (monitorTerminal) { try { monitorTerminal.dispose(); } catch (_) { } monitorTerminal = undefined; reopenMonitorAfter = true; }
  const uploadProgressTitle = t('uploadProgressTitle');
  const uploadProgressMessage = profile
    ? t('uploadProgressMessageProfile', { profile })
    : (resolvedFqbn
      ? t('uploadProgressMessageFqbn', { fqbn: resolvedFqbn })
      : t('uploadProgressMessage'));
  const uploadParams = {
    sketchDir,
    baseArgs: uArgs,
    compileArgs: cArgs,
    buildProfile: profile,
    buildFqbn: resolvedFqbn,
    cfg,
    yamlInfo
  };
  const uploadOutcome = await runWithNotificationProgress({
    location: vscode.ProgressLocation.Notification,
    title: uploadProgressTitle
  }, async (progress) => {
    if (uploadProgressMessage) progress.report({ message: uploadProgressMessage });
    await performUploadWithPortStrategy(uploadParams);
  });
  if (uploadOutcome === PROGRESS_BUSY) {
    if (reopenMonitorAfter) {
      try { await commandMonitor(); } catch (_) { }
    }
    return;
  }
  if (reopenMonitorAfter) { await new Promise(r => setTimeout(r, 1500)); await commandMonitor(); }
}

// Tree helper: upload data for an explicit sketch/profile
async function commandUploadDataFor(sketchDir, profile) {
  if (sketchDir && profile) {
    await rememberSelectedProfile(sketchDir, profile);
  }
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
    await rememberSelectedProfile(targetDir, selectedProfile);
    const folderName = sanitizeProfileFolderName(selectedProfile);
    const wokwiDirPath = path.join(targetDir, '.wokwi', folderName);
    const { diagramUri } = await ensureWokwiDefaults(wokwiDirPath, selectedProfile, { sketchDir: targetDir, profileName: selectedProfile });
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
  try {
    await runArduinoCliUpdate({ auto: false, skipEnsure: true });
  } catch (err) {
    showError(err);
  }
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
    try { matches = filterUrisOutsideBuild(await vscode.workspace.findFiles(pattern)); } catch { matches = []; }
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
        compilerErr: '',
        compileDurationMs: 0
      };
      let detailPushed = false;
      let runResult;
      try {
        // Show a notification progress in the bottom-right while the
        // per-profile compile runs so long-running builds surface activity.
        runResult = await runWithNotificationProgress({
          location: vscode.ProgressLocation.Notification,
          title: t('buildCheckProgressTitle')
        }, async (progress) => {
          // Report a descriptive message in the notification.
          progress.report({ message: t('buildCheckCompileStart', { sketch: sketchLabel, profile }) });
          return await runBuildCheckCompile(exe, sketchDir, profile);
        });
        if (runResult === PROGRESS_BUSY) {
          // Another progress is active; abort the build check run.
          return;
        }
      } catch (err) {
        totals.failed += 1;
        if (err && typeof err.durationMs === 'number') {
          const seconds = formatDurationSeconds(err.durationMs);
          channel.appendLine(t('buildCheckProfileDuration', { sketch: sketchLabel, profile, seconds }));
          detail.compileDurationMs = err.durationMs;
        }
        const codeText = err && typeof err.code !== 'undefined' ? String(err.code) : err && err.message ? err.message : 'spawn error';
        const errorMsg = t('buildCheckCliError', { sketch: sketchLabel, profile, code: codeText });
        channel.appendLine(errorMsg);
        detail.message = errorMsg;
        detail.exitCode = typeof err?.code === 'number' ? err.code : null;
        try {
          const diagMap = parseCompilerDiagnostics(stderrNormalized, {
            cwd: sketchDir,
            skipWarningsOutsideWorkspace: true,
            allowOutsideDiagnostics: true,
          });
          const fallbackDiagnostics = [];
          let fallbackWarnings = 0;
          let fallbackErrors = 0;
          for (const [fsPath, entries] of diagMap.entries()) {
            if (!entries || entries.length === 0) continue;
            for (const diagEntry of entries) {
              const isError = diagEntry.severity === vscode.DiagnosticSeverity.Error;
              if (isError) fallbackErrors += 1;
              else fallbackWarnings += 1;
              const range = diagEntry.range;
              const startPos = range && range.start ? range.start : null;
              const lineNumber = startPos ? startPos.line + 1 : undefined;
              const columnNumber = startPos ? startPos.character + 1 : undefined;
              fallbackDiagnostics.push({
                severity: isError ? 'ERROR' : 'WARNING',
                message: diagEntry.message,
                file: fsPath,
                relative: workspaceRelativePath(fsPath),
                line: lineNumber,
                column: columnNumber,
              });
            }
          }
          if (fallbackDiagnostics.length > 0) {
            detail.diagnostics = fallbackDiagnostics;
            detail.warnings = fallbackWarnings;
            detail.errors = fallbackErrors;
            totals.warnings += fallbackWarnings;
            totals.errors += fallbackErrors;
          }
        } catch (_) { /* ignore fallback parse errors */ }
        report.results.push(detail);
        detailPushed = true;
        continue;
      }

      if (runResult && typeof runResult.durationMs === 'number') {
        const seconds = formatDurationSeconds(runResult.durationMs);
        channel.appendLine(t('buildCheckProfileDuration', { sketch: sketchLabel, profile, seconds }));
        detail.compileDurationMs = runResult.durationMs;
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
      let warnCount = visibleDiagnostics.filter((d) => d.severity === 'WARNING').length;
      let errCount = visibleDiagnostics.filter((d) => d.severity === 'ERROR').length;
      const aggregatedDiagnostics = visibleDiagnostics.slice();

      if (!success && errCount === 0 && stderrNormalized) {
        try {
          const diagMap = parseCompilerDiagnostics(stderrNormalized, {
            cwd: sketchDir,
            skipWarningsOutsideWorkspace: true,
            allowOutsideDiagnostics: true,
          });
          let extraWarnings = 0;
          let extraErrors = 0;
          for (const [fsPath, entries] of diagMap.entries()) {
            if (!entries || entries.length === 0) continue;
            for (const diagEntry of entries) {
              const isError = diagEntry.severity === vscode.DiagnosticSeverity.Error;
              if (isError) extraErrors += 1;
              else extraWarnings += 1;
              const range = diagEntry.range;
              const startPos = range && range.start ? range.start : null;
              const lineNumber = startPos ? startPos.line + 1 : undefined;
              const columnNumber = startPos ? startPos.character + 1 : undefined;
              aggregatedDiagnostics.push({
                severity: isError ? 'ERROR' : 'WARNING',
                message: diagEntry.message,
                file: fsPath,
                relative: workspaceRelativePath(fsPath),
                line: lineNumber,
                column: columnNumber,
              });
            }
          }
          warnCount += extraWarnings;
          errCount += extraErrors;
        } catch (_) { /* ignore fallback parse errors */ }
      }

      detail.warnings = warnCount;
      detail.errors = errCount;
      detail.diagnostics = aggregatedDiagnostics;
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
            const detectArgs = ['compile', '--profile', profile, '--warnings=all', '--clean'];
            if (cfg.localBuildPath) {
              const overridePath = await ensureLocalBuildPath(sketchDir, profile, '');
              if (overridePath) {
                detectArgs.push('--build-path', overridePath);
              }
            }
            detectArgs.push(sketchDir);
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
  if (!(await ensureCliReady())) return;
  try {
    await runArduinoCliUpdate({ auto: false, skipEnsure: true });
  } catch (err) {
    showError(err);
  }
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
    metadata = await fetchVersionCheckMetadata(channel, { forceRefresh: true });
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
  const cfg = getConfig();
  const args = ['compile', '--profile', profile, '--warnings=all', '--clean', '--json'];
  if (cfg.localBuildPath) {
    const buildPath = await ensureLocalBuildPath(sketchDir, profile, '');
    if (buildPath) {
      args.push('--build-path', buildPath);
    }
  }
  args.push(sketchDir);
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? '& ' + quoteArg(exe) : quoteArg(exe);
  channel.appendLine(ANSI.cyan + '$ ' + displayExe + ' ' + args.map(quoteArg).join(' ') + ANSI.reset);
  channel.appendLine(ANSI.dim + '(cwd: ' + sketchDir + ')' + ANSI.reset);
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { cwd: sketchDir, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (err && typeof err === 'object') {
        err.durationMs = Date.now() - startTime;
      }
      reject(err);
    });
    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      resolve({ code, stdout, stderr, durationMs });
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
  let resolvedFqbn = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = await resolveProfileName(yamlInfo);
    if (!profile) return; // user cancelled
    channel.appendLine(`[clean-compile] Using profile from sketch.yaml: ${profile}`);
    args.push('--profile', profile);
    await rememberSelectedProfile(sketchDir, profile);
    const opts = { emptyIncludePath: true, profileName: profile };
    args.push(sketchDir);
    try {
      const result = await compileWithIntelliSense(sketchDir, args, opts);
      if (result && typeof result.durationMs === 'number') {
        channel.appendLine(t('compileDurationGeneric', {
          label: 'clean-compile',
          seconds: formatDurationSeconds(result.durationMs)
        }));
      }
    } catch (e) {
      if (e && typeof e.durationMs === 'number') {
        channel.appendLine(t('compileDurationGeneric', {
          label: 'clean-compile',
          seconds: formatDurationSeconds(e.durationMs)
        }));
      }
      showError(e);
    }
    return;
  }

  resolvedFqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
  if (!resolvedFqbn) {
    const set = await commandSetFqbn(true);
    if (!set) return;
    resolvedFqbn = extContext.workspaceState.get(STATE_FQBN, '') || '';
  }
  args.push('--fqbn', resolvedFqbn);
  args.push(sketchDir);
  try {
    const result = await compileWithIntelliSense(sketchDir, args, { emptyIncludePath: true, fqbn: resolvedFqbn });
    if (result && typeof result.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'clean-compile',
        seconds: formatDurationSeconds(result.durationMs)
      }));
    }
  } catch (e) {
    if (e && typeof e.durationMs === 'number') {
      channel.appendLine(t('compileDurationGeneric', {
        label: 'clean-compile',
        seconds: formatDurationSeconds(e.durationMs)
      }));
    }
    showError(e);
  }
}

async function commandEmbedAssets() {
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  await embedAssetsForSketch(path.dirname(ino), { silent: false, createDirIfMissing: true });
}

async function embedAssetsForSketch(sketchDir, options = {}) {
  const { silent = false, createDirIfMissing = false } = options || {};
  try {
    const result = await writeAssetsEmbedHeader(sketchDir, { createDirIfMissing });
    if (!silent) {
      if (result.status === 'noAssets') {
        vscode.window.showWarningMessage(t('embedAssetsNoAssets', { assets: result.assetsPath }));
      } else {
        vscode.window.showInformationMessage(t('embedAssetsDone', {
          count: result.count,
          header: result.headerPath
        }));
      }
    }
    await reportAssetsEmbedDiagnostics(sketchDir);
  } catch (error) {
    if (!silent) showError(error);
    else throw error;
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
    const files = filterUrisOutsideBuild(
      await vscode.workspace.findFiles(
        new vscode.RelativePattern(wf, '**/*.ino'),
        new vscode.RelativePattern(wf, '**/{node_modules,.git,build,out,dist,.vscode,.build}/**')
      )
    );
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

function getSelectedProfileState() {
  const sketchDir = extContext?.workspaceState.get(STATE_SELECTED_SKETCH, '') || '';
  const profile = extContext?.workspaceState.get(STATE_SELECTED_PROFILE, '') || '';
  return { sketchDir, profile };
}

async function applyProfileSerialSettings(sketchDir, profile) {
  if (!extContext || !sketchDir || !profile) return;
  try {
    await extContext.workspaceState.update(STATE_LAST_PROFILE, profile);
    const portRaw = await getPortFromSketchYaml(sketchDir, profile);
    if (typeof portRaw === 'string') {
      const trimmed = portRaw.trim();
      if (trimmed) {
        if (/^(none|no[-_ ]?serial)$/i.test(trimmed)) {
          await extContext.workspaceState.update(STATE_PORT, PORT_NONE_SENTINEL);
        } else {
          const hostHint = (_isWslEnv && /^com\d+/i.test(trimmed)) ? 'windows' : (_isWslEnv ? 'wsl' : 'local');
          await extContext.workspaceState.update(STATE_PORT, formatStoredPortValue(trimmed, hostHint));
        }
      }
    }
    const baudRaw = await getPortConfigBaudFromSketchYaml(sketchDir, profile);
    if (baudRaw) {
      await extContext.workspaceState.update(STATE_BAUD, String(baudRaw));
    }
  } catch { }
}

async function rememberSelectedProfile(sketchDir, profile) {
  if (!extContext) return;
  const normalizedSketch = sketchDir ? String(sketchDir) : '';
  const normalizedProfile = profile ? String(profile) : '';
  if (!normalizedSketch || !normalizedProfile) {
    await clearSelectedProfile();
    return;
  }
  await extContext.workspaceState.update(STATE_SELECTED_SKETCH, normalizedSketch);
  await extContext.workspaceState.update(STATE_SELECTED_PROFILE, normalizedProfile);
  await applyProfileSerialSettings(normalizedSketch, normalizedProfile);
  await updateStatusBar();
}

async function clearSelectedProfile() {
  if (!extContext) return;
  await extContext.workspaceState.update(STATE_SELECTED_SKETCH, '');
  await extContext.workspaceState.update(STATE_SELECTED_PROFILE, '');
  await updateStatusBar();
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
  const cfg = getConfig();
  const warningsLevel = cfg && typeof cfg.warnings === 'string' ? cfg.warnings : 'none';
  const verboseEnabled = !!(cfg && cfg.verbose);
  let { sketchDir: selectedSketchDir, profile: selectedProfile } = getSelectedProfileState();
  if (selectedSketchDir) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(selectedSketchDir));
    } catch {
      if (extContext) {
        await extContext.workspaceState.update(STATE_SELECTED_SKETCH, '');
        await extContext.workspaceState.update(STATE_SELECTED_PROFILE, '');
      }
      selectedSketchDir = '';
      selectedProfile = '';
    }
  }
  let hasSketchYamlProfiles = false;
  if (!selectedSketchDir) {
    try {
      const entries = await findSketchYamlEntries();
      hasSketchYamlProfiles = Array.isArray(entries) && entries.length > 0;
    } catch {
      hasSketchYamlProfiles = false;
    }
  }
  const fqbn = extContext?.workspaceState.get(STATE_FQBN, '') || '';
  const portInfo = getStoredPortInfo();
  const portDisplay = portInfo.display;
  const baud = extContext?.workspaceState.get(STATE_BAUD, '115200') || '115200';

  if (selectedSketchDir) {
    const sketchName = path.basename(selectedSketchDir) || 'sketch';
    const profileLabel = selectedProfile
      ? `${sketchName}/${selectedProfile}`
      : `${sketchName}/${_isJa ? '未選択' : 'Not set'}`;
    statusFqbn.text = `$(circuit-board) ${profileLabel}`;
    statusFqbn.tooltip = selectedProfile
      ? (_isJa ? '現在のスケッチ/プロファイル（クリックで変更）' : 'Current sketch/profile (click to change)')
      : (_isJa ? '現在のスケッチ（プロファイル未選択）' : 'Current sketch (profile not set)');
    statusFqbn.command = 'arduino-cli.setProfile';
  } else if (hasSketchYamlProfiles) {
    statusFqbn.text = _isJa ? '$(circuit-board) プロファイル: 未選択' : '$(circuit-board) Profile: Not set';
    statusFqbn.tooltip = _isJa ? 'sketch.yaml のプロファイルを選択' : 'Pick a sketch.yaml profile';
    statusFqbn.command = 'arduino-cli.setProfile';
  } else {
    statusFqbn.text = fqbn ? `$(circuit-board) ${fqbn}` : (_isJa ? '$(circuit-board) FQBN: 未選択' : '$(circuit-board) FQBN: Not set');
    statusFqbn.tooltip = _isJa ? '現在の FQBN（クリックで変更）' : 'Current FQBN (click to change)';
    statusFqbn.command = 'arduino-cli.setFqbn';
  }

  const portSkipped = isNoPortSelected(portInfo);
  statusPort.text = portDisplay ? `$(plug) ${portDisplay}` : (_isJa ? '$(plug) Port: 未選択' : '$(plug) Port: Not set');
  statusPort.tooltip = portSkipped
    ? t('portNoSerialTooltip')
    : (_isJa ? '現在のポート（クリックで変更）' : 'Current serial port (click to change)');
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
    const message = _isJa
      ? 'sketch.yaml に profiles が見つかりません。先に Create sketch.yaml を実行してください。'
      : 'No profiles found in sketch.yaml. Run Create sketch.yaml first.';
    const helperLabel = _isJa ? 'Sketch.yaml Helper を開く' : 'Open Sketch.yaml Helper';
    const picked = await vscode.window.showWarningMessage(message, helperLabel);
    if (picked === helperLabel) {
      try { await vscode.commands.executeCommand('arduino-cli.sketchYamlHelper', { sketchDir }); } catch { }
    }
    await clearSelectedProfile();
    return await commandSetFqbn(required);
  }
  const pick = await vscode.window.showQuickPick(
    yamlInfo.profiles.map(p => ({ label: p, description: p === yamlInfo.defaultProfile ? 'default' : undefined, value: p })),
    { placeHolder: _isJa ? 'sketch.yaml のプロファイルを選択してください' : 'Select a profile from sketch.yaml' }
  );
  if (!pick) return false;
  const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
  let text = await readTextFile(yamlUri);
  text = replaceYamlKey(text, 'default_profile', pick.value);
  text = formatSketchYamlLayout(text);
  await writeTextFile(yamlUri, text);
  await rememberSelectedProfile(sketchDir, pick.value);
  vscode.window.setStatusBarMessage(_isJa ? `Profile を設定: ${pick.value}` : `Set profile: ${pick.value}`, 2000);
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
  await clearSelectedProfile();
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
  let portInfo = getStoredPortInfo();
  let port = portInfo.cliPort;
  if (!port) {
    if (isNoPortSelected(portInfo)) {
      vscode.window.showWarningMessage(t('portNoSerialMonitorWarn'));
      return;
    }
    const set = await commandSetPort(true);
    if (!set) return;
    portInfo = getStoredPortInfo();
    port = portInfo.cliPort;
  }
  // Use saved baudrate (default 115200) without prompting
  let baud = extContext?.workspaceState.get(STATE_BAUD, '115200') || '115200';

  const cfg = getConfig();
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  let args = [...baseArgs, 'monitor', '-p', port, '--config', `baudrate=${baud}`];

  const useWindowsCli = shouldUseWindowsSerial(portInfo);
  const exe = useWindowsCli ? 'arduino-cli.exe' : (cfg.exe || 'arduino-cli');
  if (useWindowsCli) {
    args = await convertArgsForWindowsCli(args);
  }

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
  let boards;
  try {
    boards = await runWithNotificationProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('portScanProgressTitle')
    }, async (progress) => {
      progress.report({ message: t('portScanProgressMessage') });
      return await listConnectedBoards();
    });
    if (boards === PROGRESS_BUSY) return false;
  } catch (err) {
    showError(err);
    if (required) vscode.window.showWarningMessage(t('portUnsetWarn'));
    return false;
  }
  const items = boards.map(b => ({
    label: b.displayPort || b.port || '(unknown)',
    description: b.boardName || 'Unknown board',
    detail: buildBoardDetail(b),
    value: b.port || '',
    storedValue: b.storageValue || formatStoredPortValue(b.port || '', b.host),
    fqbn: b.fqbn || ''
  }));
  items.push({
    label: t('setPortNoSerial'),
    description: t('setPortNoSerialDescription'),
    detail: t('setPortNoSerialDetail'),
    value: PICK_NO_PORT,
    storedValue: PORT_NONE_SENTINEL
  });
  items.push({ label: t('setPortManual'), value: '__manual__' });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('monitorPickPortTitle') });
  if (!pick) {
    if (required) vscode.window.showWarningMessage(t('portUnsetWarn'));
    return false;
  }
  let port = pick.value;
  let storedValue = pick.storedValue ?? (typeof port === 'string' ? port : '');
  if (port === PICK_NO_PORT) {
    storedValue = PORT_NONE_SENTINEL;
    port = '';
  } else if (port === '__manual__') {
    const input = await vscode.window.showInputBox({ prompt: t('enterPort') });
    if (!input) {
      if (required) vscode.window.showWarningMessage(t('portUnsetWarn'));
      return false;
    }
    port = input.trim();
    const hostHint = (_isWslEnv && /^com\d+/i.test(port)) ? 'windows' : (_isWslEnv ? 'wsl' : 'local');
    storedValue = formatStoredPortValue(port, hostHint);
  }
  await extContext.workspaceState.update(STATE_PORT, storedValue);
  if (pick.fqbn) {
    await extContext.workspaceState.update(STATE_FQBN, pick.fqbn);
  }
  updateStatusBar();
  const withFqbn = pick.fqbn ? (_isJa ? `（FQBN: ${pick.fqbn} も設定）` : ` (FQBN: ${pick.fqbn})`) : '';
  const info = getStoredPortInfo();
  const displayPort = info.display || info.cliPort || port;
  vscode.window.setStatusBarMessage(t('statusSetPort', { port: displayPort, withFqbn }), 2000);
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
  // Try to find the profile block and extract vendor:arch, version, and optional platform_index_url
  const lines = (profileYaml || '').split(/\r?\n/);
  let inProfiles = false;
  let currentKey = '';
  const targetKey = preferProfileName ? String(preferProfileName).trim() : '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inProfiles) {
      if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true;
      continue;
    }
    const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
    if (mKey) {
      currentKey = mKey[1].trim();
      continue;
    }
    const mPlat = line.match(/^\s{6}(?:-\s*)?platform\s*:\s*([A-Za-z0-9_.:-]+)(?:\s*\(([^)]+)\)\s*)?$/);
    if (mPlat && (!targetKey || targetKey === currentKey)) {
      const info = { vendorArch: mPlat[1], version: mPlat[2] ? mPlat[2] : '' };
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (/^\s{6}-\s*platform\s*:/.test(next)) break;
        if (/^\s{4}[^\s:#][^:]*\s*:\s*$/.test(next)) break;
        if (/^\s{2}[^\s:#][^:]*\s*:\s*$/.test(next)) break;
        if (/^\s*default_profile\s*:\s*/.test(next)) break;
        if (/^\S/.test(next)) break;
        const trimmed = next.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('platform_index_url')) {
          const idx = trimmed.indexOf(':');
          if (idx >= 0) {
            let url = trimmed.slice(idx + 1).trim();
            if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
              url = url.slice(1, -1);
            }
            info.indexUrl = url;
          }
        }
      }
      return info;
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
function buildCommandCenterCommandList() {
  return COMMAND_CENTER_ITEMS.map((item) => ({
    command: item.command,
    title: t(item.titleKey),
    description: t(item.descKey),
    requiresProfile: !!item.requiresProfile,
  }));
}

async function buildCommandCenterProfileState() {
  let sketchDir = '';
  let profile = '';
  try {
    const stored = getSelectedProfileState();
    sketchDir = stored?.sketchDir || '';
    profile = stored?.profile || '';
    if (sketchDir) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(sketchDir));
      } catch (_) {
        sketchDir = '';
        profile = '';
      }
    }
  } catch (_) {
    sketchDir = '';
    profile = '';
  }
  let profileLabel = '';
  if (sketchDir && profile) {
    const sketchName = path.basename(sketchDir) || sketchDir;
    profileLabel = `${sketchName}/${profile}`;
  } else if (profile) {
    profileLabel = profile;
  }
  return { hasProfile: !!(sketchDir && profile), profileLabel };
}

function extractAdditionalUrlsFromConfigDump(text) {
  const urls = [];
  const lines = String(text || '').replace(/\t/g, '  ').split(/\r?\n/);
  let inBoardManager = false;
  let boardIndent = 0;
  let inUrls = false;
  let urlsIndent = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const indent = raw.length - trimmed.length;
    if (!inBoardManager) {
      if (trimmed.startsWith('board_manager:')) {
        inBoardManager = true;
        boardIndent = indent;
        inUrls = false;
      }
      continue;
    }
    if (indent <= boardIndent && !trimmed.startsWith('-')) {
      inBoardManager = false;
      inUrls = false;
    }
    if (!inBoardManager) continue;
    if (!inUrls) {
      if (trimmed.startsWith('additional_urls:')) {
        inUrls = true;
        urlsIndent = indent;
      }
      continue;
    }
    if (indent <= urlsIndent && !trimmed.startsWith('-')) {
      inUrls = false;
      continue;
    }
    if (trimmed.startsWith('-')) {
      let value = trimmed.slice(1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) urls.push(value);
    }
  }
  return urls;
}

async function fetchCommandCenterConfigDump() {
  const result = await runCliCaptureOutput(['config', 'dump']);
  const stdout = result.stdout || '';
  return {
    text: stdout.trim(),
    additionalUrls: extractAdditionalUrlsFromConfigDump(stdout),
  };
}

function commandCenterErrorMessage(err) {
  return (err && err.message) ? err.message : String(err || 'unknown');
}

async function sendCommandCenterInit(panel) {
  const commands = buildCommandCenterCommandList();
  const profileState = await buildCommandCenterProfileState();
  let configText = '';
  let additionalUrls = [];
  panel.webview.postMessage({ type: 'configBusy', value: true });
  try {
    const data = await fetchCommandCenterConfigDump();
    configText = data.text;
    additionalUrls = data.additionalUrls;
  } catch (err) {
    const msg = t('commandCenterConfigDumpFail', { msg: commandCenterErrorMessage(err) });
    panel.webview.postMessage({ type: 'status', error: msg });
  }
  panel.webview.postMessage({
    type: 'init',
    locale: _isJa ? 'ja' : 'en',
    commands,
    hasProfile: profileState.hasProfile,
    profileLabel: profileState.profileLabel,
    configDump: configText,
    additionalUrls,
    cores: [],
    libraries: [],
  });
  panel.webview.postMessage({ type: 'configBusy', value: false });
}

async function handleCommandCenterRun(panel, commandId) {
  if (typeof commandId !== 'string' || !commandId) return;
  if (!COMMAND_CENTER_COMMAND_SET.has(commandId)) {
    panel.webview.postMessage({ type: 'status', error: t('commandCenterInvalidCommand', { id: commandId }) });
    return;
  }
  panel.webview.postMessage({ type: 'commandState', command: commandId, running: true });
  try {
    await vscode.commands.executeCommand(commandId);
    panel.webview.postMessage({ type: 'commandState', command: commandId, running: false, success: true });
  } catch (err) {
    panel.webview.postMessage({
      type: 'commandState',
      command: commandId,
      running: false,
      success: false,
      error: commandCenterErrorMessage(err),
    });
  }
  const profileState = await buildCommandCenterProfileState();
  panel.webview.postMessage({ type: 'profileState', ...profileState });
}

async function refreshCommandCenterConfig(panel, options = {}) {
  const silent = !!options.silent;
  panel.webview.postMessage({ type: 'configBusy', value: true });
  try {
    const data = await fetchCommandCenterConfigDump();
    panel.webview.postMessage({ type: 'configDump', text: data.text, additionalUrls: data.additionalUrls });
    if (!silent) panel.webview.postMessage({ type: 'status', key: 'refresh' });
  } catch (err) {
    const msg = t('commandCenterConfigDumpFail', { msg: commandCenterErrorMessage(err) });
    panel.webview.postMessage({ type: 'status', error: msg });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'configBusy', value: false });
  }
}

async function addCommandCenterUrl(panel, urlValue) {
  const value = typeof urlValue === 'string' ? urlValue.trim() : '';
  if (!value) return;
  panel.webview.postMessage({ type: 'configBusy', value: true });
  try {
    await runCliCaptureOutput(['config', 'add', 'board_manager.additional_urls', value]);
    const data = await fetchCommandCenterConfigDump();
    panel.webview.postMessage({ type: 'configDump', text: data.text, additionalUrls: data.additionalUrls });
    panel.webview.postMessage({ type: 'status', key: 'add' });
  } catch (err) {
    const msg = t('commandCenterConfigAddFail', { msg: commandCenterErrorMessage(err) });
    panel.webview.postMessage({ type: 'status', error: msg });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'configBusy', value: false });
  }
}

async function removeCommandCenterUrl(panel, urlValue, indexValue) {
  const value = typeof urlValue === 'string' ? urlValue.trim() : '';
  const index = typeof indexValue === 'number' && Number.isFinite(indexValue) ? indexValue : -1;
  if (!value && index < 0) return;
  panel.webview.postMessage({ type: 'configBusy', value: true });
  try {
    let removedByIndex = false;
    let removedByValue = false;
    let lastError = null;
    if (index >= 0) {
      try {
        await runCliCaptureOutput(['config', 'remove', 'board_manager.additional_urls', String(index)]);
        removedByIndex = true;
      } catch (err) {
        lastError = err;
      }
    }
    let data = await fetchCommandCenterConfigDump();
    const stillPresent = value ? data.additionalUrls.includes(value) : false;
    const shouldTryValue = value && (!removedByIndex || stillPresent);
    if (shouldTryValue) {
      try {
        await runCliCaptureOutput(['config', 'remove', 'board_manager.additional_urls', value]);
        removedByValue = true;
        data = await fetchCommandCenterConfigDump();
      } catch (err) {
        if (!lastError) lastError = err;
        data = await fetchCommandCenterConfigDump();
      }
    }
    const valueStillPresent = value ? data.additionalUrls.includes(value) : false;
    if (!removedByIndex && !removedByValue && lastError) {
      throw lastError;
    }
    panel.webview.postMessage({ type: 'configDump', text: data.text, additionalUrls: data.additionalUrls });
    if (value && valueStillPresent) {
      const msg = t('commandCenterConfigRemoveFail', { msg: 'URL still present after removal attempt.' });
      panel.webview.postMessage({ type: 'status', error: msg });
    } else {
      panel.webview.postMessage({ type: 'status', key: 'remove' });
    }
  } catch (err) {
    const msg = t('commandCenterConfigRemoveFail', { msg: commandCenterErrorMessage(err) });
    panel.webview.postMessage({ type: 'status', error: msg });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'configBusy', value: false });
  }
}

function buildCommandCenterCoreList(searchText, installedText) {
  const coreMap = new Map();
  const installedMap = new Map();
  const normalizeName = (entry) => {
    if (!entry) return '';
    if (typeof entry.name === 'string' && entry.name.includes(':')) return entry.name;
    if (typeof entry.id === 'string' && entry.id.includes(':')) return entry.id;
    if (typeof entry.fqbn === 'string' && entry.fqbn.includes(':')) return entry.fqbn;
    if (typeof entry.ID === 'string' && entry.ID.includes(':')) return entry.ID;
    const pkg = entry.package || entry.packager || entry.packages || entry.pkg;
    const arch = entry.architecture || entry.arch || entry.platform;
    if (pkg && arch) return `${pkg}:${arch}`;
    return '';
  };
  try {
    const parsedInstalled = JSON.parse(installedText || '[]');
    const installedArray = Array.isArray(parsedInstalled)
      ? parsedInstalled
      : Array.isArray(parsedInstalled.cores)
        ? parsedInstalled.cores
        : Array.isArray(parsedInstalled.platforms)
          ? parsedInstalled.platforms
          : [];
    for (const item of installedArray) {
      const name = normalizeName(item);
      if (!name) continue;
      installedMap.set(name, {
        version: item.version || item.installed_version || item.installedVersion || '',
        latest: item.latest_version || item.latestVersion || '',
      });
    }
  } catch (_) { /* ignore */ }
  const addVersion = (info, version) => {
    if (!version) return;
    info.versionSet.add(String(version));
  };
  try {
    const parsed = JSON.parse(searchText || '[]');
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.cores)
        ? parsed.cores
        : Array.isArray(parsed.platforms)
          ? parsed.platforms
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];
    for (const entry of entries) {
      const name = normalizeName(entry);
      if (!name) continue;
      let info = coreMap.get(name);
      if (!info) {
        info = {
          name,
          title: entry.name || entry.title || '',
          maintainer: '',
          description: '',
          category: '',
          versionSet: new Set(),
          latestCandidates: new Set(),
          installedFromSearch: typeof entry.installed === 'string' ? entry.installed : (entry.installed_version || ''),
        };
        coreMap.set(name, info);
      }
      if (!info.title) {
        const platform = Array.isArray(entry.platforms) ? entry.platforms.find((p) => p && p.name) : undefined;
        info.title = (platform && platform.name) || entry.name || entry.title || entry.label || entry.displayName || '';
      }
      if (!info.maintainer && entry.maintainer) info.maintainer = entry.maintainer;
      if (!info.description) {
        const platform = Array.isArray(entry.platforms) ? entry.platforms.find((p) => p && p.description) : undefined;
        if (platform && platform.description) info.description = platform.description;
        else if (entry.description) info.description = entry.description;
      }
      if (!info.category && entry.category) info.category = entry.category;
      const latestCandidate = (entry.latest && (entry.latest.version || entry.latest)) || entry.latestVersion || entry.version;
      if (latestCandidate) info.latestCandidates.add(String(latestCandidate));
      if (Array.isArray(entry.versions)) {
        for (const ver of entry.versions) addVersion(info, ver);
      }
      if (entry.releases && typeof entry.releases === 'object') {
        for (const key of Object.keys(entry.releases)) {
          const rel = entry.releases[key];
          addVersion(info, rel && rel.version ? rel.version : key);
          if (rel && rel.latest) info.latestCandidates.add(String(rel.latest));
          if (!info.title && rel && rel.name) info.title = rel.name;
        }
      }
      if (Array.isArray(entry.platforms)) {
        for (const platform of entry.platforms) {
          addVersion(info, platform && (platform.version || platform.release_version));
          if (!info.description && platform && platform.category) info.description = platform.category;
        }
      }
    }
  } catch (_) { /* ignore */ }
  const output = [];
  coreMap.forEach((info, name) => {
    const versionsArray = sortVersionsDesc(Array.from(info.versionSet));
    let latestVersion = '';
    if (info.latestCandidates.size > 0) {
      latestVersion = sortVersionsDesc(Array.from(info.latestCandidates))[0] || '';
    } else if (versionsArray.length > 0) {
      latestVersion = versionsArray[0];
    }
    const installedEntry = installedMap.get(name);
    const installedVersion = installedEntry?.version || info.installedFromSearch || '';
    const versions = versionsArray.slice();
    if (installedVersion && !versions.includes(installedVersion)) versions.push(installedVersion);
    if (installedEntry?.latest && !versions.includes(installedEntry.latest)) versions.push(installedEntry.latest);
    if (latestVersion && !versions.includes(latestVersion)) versions.push(latestVersion);
    const normalizedVersions = sortVersionsDesc(versions);
    const normalizedLatest = latestVersion || installedEntry?.latest || normalizedVersions[0] || '';
    const installed = !!installedVersion;
    const updateAvailable = installed && normalizedLatest && compareVersionStrings(installedVersion, normalizedLatest) < 0;
    output.push({
      name,
      title: info.title || name,
      maintainer: info.maintainer || '',
      description: info.description || info.category || '',
      versions: normalizedVersions,
      latestVersion: normalizedLatest,
      installedVersion,
      installed,
      updateAvailable,
    });
  });
  installedMap.forEach((inst, name) => {
    if (output.some((core) => core.name === name)) return;
    const versions = sortVersionsDesc([inst.version, inst.latest].filter(Boolean));
    const latestVersion = inst.latest || versions[0] || inst.version || '';
    const installedVersion = inst.version || '';
    const updateAvailable = installedVersion && latestVersion && compareVersionStrings(installedVersion, latestVersion) < 0;
    output.push({
      name,
      title: name,
      maintainer: '',
      description: '',
      versions: versions.length > 0 ? versions : (installedVersion ? [installedVersion] : []),
      latestVersion,
      installedVersion,
      installed: !!installedVersion,
      updateAvailable,
    });
  });
  output.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  return output;
}

async function loadCommandCenterCores(panel) {
  panel.webview.postMessage({ type: 'coresBusy', value: true });
  try {
    const ready = await ensureCliReady();
    if (!ready) throw new Error(t('cliCheckFail'));
    let updateError = null;
    try {
      await runCliCaptureOutput(['update']);
    } catch (err) {
      updateError = err;
    }
    const logPreview = () => { /* debug removed */ };
    let searchStdout = '[]';
    try {
      const searchResult = await runCliCaptureOutput(['core', 'search', '--format', 'json'], { logStdout: false });
      searchStdout = searchResult.stdout || '[]';
    } catch (err) {
      const msg = commandCenterErrorMessage(err).toLowerCase();
      try {
        if (msg.includes('unknown flag') || msg.includes('unknown shorthand') || msg.includes('flag provided') || msg.includes('unrecognized option')) {
          const fallback = await runCliCaptureOutput(['core', 'search', '--json'], { logStdout: false });
          searchStdout = fallback.stdout || '[]';
        } else {
          const fallback = await runCliCaptureOutput(['core', 'list', '--all', '--format', 'json'], { logStdout: false });
          searchStdout = fallback.stdout || '[]';
          panel.webview.postMessage({ type: 'status', message: t('commandCenterCoreUpdateWarn', { msg: commandCenterErrorMessage(err) }) });
        }
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    logPreview('core search json', searchStdout);
    let listStdout = '[]';
    try {
      let listResult;
      try {
        listResult = await runCliCaptureOutput(['core', 'list', '--format', 'json'], { logStdout: false });
      } catch (err) {
        const msg = commandCenterErrorMessage(err).toLowerCase();
        if (msg.includes('unknown flag') || msg.includes('unknown shorthand') || msg.includes('flag provided') || msg.includes('unrecognized option')) {
          listResult = await runCliCaptureOutput(['core', 'list', '--json'], { logStdout: false });
        } else {
          throw err;
        }
      }
      listStdout = listResult.stdout || '[]';
    } catch (_) {
      listStdout = '[]';
    }
    logPreview('core list json', listStdout);
    const cores = buildCommandCenterCoreList(searchStdout, listStdout);
    panel.webview.postMessage({
      type: 'coresData',
      cores,
      raw: {
        search: searchStdout,
        list: listStdout
      }
    });
    if (updateError) {
      const msg = t('commandCenterCoreUpdateWarn', { msg: commandCenterErrorMessage(updateError) });
      panel.webview.postMessage({ type: 'status', message: msg });
    }
  } catch (err) {
    const msg = t('commandCenterCoreFetchFail', { msg: commandCenterErrorMessage(err) });
    panel.webview.postMessage({ type: 'status', error: msg });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'coresBusy', value: false });
  }
}

async function installCommandCenterCore(panel, coreName, version) {
  if (!coreName) return;
  const selectedVersion = version || '';
  const ready = await ensureCliReady();
  if (!ready) {
    panel.webview.postMessage({ type: 'status', error: t('cliCheckFail') });
    return;
  }
  panel.webview.postMessage({ type: 'coreCommandState', name: coreName, action: 'install', running: true });
  let succeeded = false;
  try {
    const target = selectedVersion ? `${coreName}@${selectedVersion}` : coreName;
    await runCliCaptureOutput(['core', 'install', target]);
    const versionLabel = selectedVersion || (_isJa ? '最新' : 'latest');
    panel.webview.postMessage({ type: 'status', message: t('commandCenterCoreInstallDone', { name: coreName, version: versionLabel }) });
    succeeded = true;
  } catch (err) {
    const versionLabel = selectedVersion || (_isJa ? '最新' : 'latest');
    panel.webview.postMessage({ type: 'status', error: t('commandCenterCoreInstallFail', { name: coreName, version: versionLabel, msg: commandCenterErrorMessage(err) }) });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'coreCommandState', name: coreName, action: 'install', running: false });
    if (succeeded) {
      await loadCommandCenterCores(panel);
    }
  }
}

async function uninstallCommandCenterCore(panel, coreName) {
  if (!coreName) return;
  const ready = await ensureCliReady();
  if (!ready) {
    panel.webview.postMessage({ type: 'status', error: t('cliCheckFail') });
    return;
  }
  panel.webview.postMessage({ type: 'coreCommandState', name: coreName, action: 'uninstall', running: true });
  let succeeded = false;
  try {
    await runCliCaptureOutput(['core', 'uninstall', coreName]);
    panel.webview.postMessage({ type: 'status', message: t('commandCenterCoreUninstallDone', { name: coreName }) });
    succeeded = true;
  } catch (err) {
    panel.webview.postMessage({ type: 'status', error: t('commandCenterCoreUninstallFail', { name: coreName, msg: commandCenterErrorMessage(err) }) });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'coreCommandState', name: coreName, action: 'uninstall', running: false });
    if (succeeded) {
      await loadCommandCenterCores(panel);
    }
  }
}

function buildCommandCenterLibraryList(searchText, installedText) {
  const libraryMap = new Map();
  const installedMap = new Map();
  const normalizeName = (entry) => {
    if (!entry) return '';
    if (typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim();
    if (typeof entry.library === 'string' && entry.library.trim()) return entry.library.trim();
    const libObj = entry.library && typeof entry.library === 'object' ? entry.library : undefined;
    if (libObj && typeof libObj.name === 'string' && libObj.name.trim()) return libObj.name.trim();
    return '';
  };
  const addVersion = (info, version) => {
    if (!version) return;
    info.versionSet.add(String(version));
  };
  try {
    const parsedInstalled = JSON.parse(installedText || '[]');
    const installedArray = Array.isArray(parsedInstalled)
      ? parsedInstalled
      : Array.isArray(parsedInstalled.installed_libraries)
        ? parsedInstalled.installed_libraries
        : [];
    for (const item of installedArray) {
      const libObj = item.library && typeof item.library === 'object' ? item.library : item;
      const name = normalizeName(libObj);
      if (!name) continue;
      installedMap.set(name, {
        version: libObj.version || item.version || '',
        latest: libObj.latest_version || item.latest_version || '',
      });
    }
  } catch (_) { /* ignore */ }
  try {
    const parsed = JSON.parse(searchText || '[]');
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.libraries)
        ? parsed.libraries
        : [];
    for (const entry of entries) {
      const name = normalizeName(entry);
      if (!name) continue;
      let info = libraryMap.get(name);
      if (!info) {
        info = {
          name,
          title: entry.name || name,
          author: entry.author || '',
          maintainer: entry.maintainer || '',
          sentence: entry.sentence || '',
          paragraph: entry.paragraph || '',
          url: entry.website || entry.url || '',
          versionSet: new Set(),
          latestCandidates: new Set(),
          installedFromSearch: entry.installed_version || entry.installed || '',
        };
        libraryMap.set(name, info);
      }
      const releases = entry.releases && typeof entry.releases === 'object' ? entry.releases : {};
      for (const key of Object.keys(releases)) {
        const rel = releases[key];
        const version = rel && rel.version ? rel.version : key;
        addVersion(info, version);
        if (rel && rel.version) info.latestCandidates.add(String(rel.version));
        if (rel && rel.name && !info.title) info.title = rel.name;
        if (rel && rel.author && !info.author) info.author = rel.author;
        if (rel && rel.maintainer && !info.maintainer) info.maintainer = rel.maintainer;
        if (rel && rel.sentence && !info.sentence) info.sentence = rel.sentence;
        if (rel && rel.paragraph && !info.paragraph) info.paragraph = rel.paragraph;
        if (rel && rel.homepage && !info.url) info.url = rel.homepage;
      }
      const latestObj = entry.latest && typeof entry.latest === 'object' ? entry.latest : undefined;
      const latestValue = latestObj && latestObj.version
        ? latestObj.version
        : (typeof entry.latest === 'string' ? entry.latest : '') || entry.latest_version || '';
      if (latestValue) info.latestCandidates.add(String(latestValue));
      if (Array.isArray(entry.available_versions)) {
        for (const ver of entry.available_versions) addVersion(info, ver);
      }
      if (Array.isArray(entry.versions)) {
        for (const ver of entry.versions) addVersion(info, ver);
      }
    }
  } catch (_) { /* ignore */ }
  const output = [];
  libraryMap.forEach((info, name) => {
    const versionsArray = sortVersionsDesc(Array.from(info.versionSet));
    let latestVersion = '';
    if (info.latestCandidates.size > 0) {
      latestVersion = sortVersionsDesc(Array.from(info.latestCandidates))[0] || '';
    } else if (versionsArray.length > 0) {
      latestVersion = versionsArray[0];
    }
    const installedEntry = installedMap.get(name);
    const installedVersion = installedEntry?.version || info.installedFromSearch || '';
    const versions = versionsArray.slice();
    if (installedVersion && !versions.includes(installedVersion)) versions.push(installedVersion);
    if (installedEntry?.latest && !versions.includes(installedEntry.latest)) versions.push(installedEntry.latest);
    if (latestVersion && !versions.includes(latestVersion)) versions.push(latestVersion);
    const normalizedVersions = sortVersionsDesc(versions);
    const normalizedLatest = latestVersion || installedEntry?.latest || normalizedVersions[0] || '';
    const installed = !!installedVersion;
    const updateAvailable = installed && normalizedLatest && compareVersionStrings(installedVersion, normalizedLatest) < 0;
    output.push({
      name,
      title: info.title || name,
      author: info.author || '',
      maintainer: info.maintainer || '',
      sentence: info.sentence || '',
      paragraph: info.paragraph || '',
      url: info.url || '',
      versions: normalizedVersions,
      latestVersion: normalizedLatest,
      installedVersion,
      installed,
      updateAvailable,
    });
  });
  output.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  return output;
}

async function loadCommandCenterLibraries(panel) {
  panel.webview.postMessage({ type: 'librariesBusy', value: true });
  try {
    const ready = await ensureCliReady();
    if (!ready) throw new Error(t('cliCheckFail'));
    let updateError = null;
    try {
      await runCliCaptureOutput(['update']);
    } catch (err) {
      updateError = err;
    }
    const logPreview = () => { /* debug removed */ };
    let searchStdout = '[]';
    try {
      const searchResult = await runCliCaptureOutput(['lib', 'search', '--format', 'json'], { logStdout: false });
      searchStdout = searchResult.stdout || '[]';
    } catch (err) {
      const msg = commandCenterErrorMessage(err).toLowerCase();
      try {
        if (msg.includes('unknown flag') || msg.includes('unknown shorthand') || msg.includes('flag provided') || msg.includes('unrecognized option')) {
          const fallback = await runCliCaptureOutput(['lib', 'search', '--json'], { logStdout: false });
          searchStdout = fallback.stdout || '[]';
        } else {
          throw err;
        }
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    logPreview('library search json', searchStdout);
    let listStdout = '[]';
    try {
      let listResult;
      try {
        listResult = await runCliCaptureOutput(['lib', 'list', '--format', 'json'], { logStdout: false });
      } catch (err) {
        const msg = commandCenterErrorMessage(err).toLowerCase();
        if (msg.includes('unknown flag') || msg.includes('unknown shorthand') || msg.includes('flag provided') || msg.includes('unrecognized option')) {
          listResult = await runCliCaptureOutput(['lib', 'list', '--json'], { logStdout: false });
        } else {
          throw err;
        }
      }
      listStdout = listResult.stdout || '[]';
    } catch (_) {
      listStdout = '[]';
    }
    logPreview('library list json', listStdout);
    const libraries = buildCommandCenterLibraryList(searchStdout, listStdout);
    panel.webview.postMessage({
      type: 'librariesData',
      libraries,
      raw: {
        search: searchStdout,
        list: listStdout
      }
    });
    if (updateError) {
      const msg = t('commandCenterLibraryUpdateWarn', { msg: commandCenterErrorMessage(updateError) });
      panel.webview.postMessage({ type: 'status', message: msg });
    }
  } catch (err) {
    const msg = t('commandCenterLibraryFetchFail', { msg: commandCenterErrorMessage(err) });
    panel.webview.postMessage({ type: 'status', error: msg });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'librariesBusy', value: false });
  }
}

async function installCommandCenterLibrary(panel, name, version) {
  if (!name) return;
  const selectedVersion = version || '';
  const ready = await ensureCliReady();
  if (!ready) {
    panel.webview.postMessage({ type: 'status', error: t('cliCheckFail') });
    return;
  }
  panel.webview.postMessage({ type: 'libraryCommandState', name, action: 'install', running: true });
  let succeeded = false;
  try {
    const target = selectedVersion ? `${name}@${selectedVersion}` : name;
    await runCliCaptureOutput(['lib', 'install', target]);
    const versionLabel = selectedVersion || (_isJa ? '最新' : 'latest');
    panel.webview.postMessage({ type: 'status', message: t('commandCenterLibraryInstallDone', { name, version: versionLabel }) });
    succeeded = true;
  } catch (err) {
    const versionLabel = selectedVersion || (_isJa ? '最新' : 'latest');
    panel.webview.postMessage({ type: 'status', error: t('commandCenterLibraryInstallFail', { name, version: versionLabel, msg: commandCenterErrorMessage(err) }) });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'libraryCommandState', name, action: 'install', running: false });
    if (succeeded) {
      await loadCommandCenterLibraries(panel);
    }
  }
}

async function uninstallCommandCenterLibrary(panel, name) {
  if (!name) return;
  const ready = await ensureCliReady();
  if (!ready) {
    panel.webview.postMessage({ type: 'status', error: t('cliCheckFail') });
    return;
  }
  panel.webview.postMessage({ type: 'libraryCommandState', name, action: 'uninstall', running: true });
  let succeeded = false;
  try {
    await runCliCaptureOutput(['lib', 'uninstall', name]);
    panel.webview.postMessage({ type: 'status', message: t('commandCenterLibraryUninstallDone', { name }) });
    succeeded = true;
  } catch (err) {
    panel.webview.postMessage({ type: 'status', error: t('commandCenterLibraryUninstallFail', { name, msg: commandCenterErrorMessage(err) }) });
    showError(err);
  } finally {
    panel.webview.postMessage({ type: 'libraryCommandState', name, action: 'uninstall', running: false });
    if (succeeded) {
      await loadCommandCenterLibraries(panel);
    }
  }
}

async function commandOpenCommandCenter() {
  const panel = vscode.window.createWebviewPanel(
    'arduinoCommandCenter',
    t('commandCenterPanelTitle'),
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  try {
    const htmlUri = vscode.Uri.joinPath(extContext.extensionUri, 'html', 'command-center.html');
    const html = await readTextFile(htmlUri);
    panel.webview.html = html;
  } catch (err) {
    showError(err);
  }
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'ready':
          await sendCommandCenterInit(panel);
          return;
        case 'runCommand':
          await handleCommandCenterRun(panel, msg.command);
          return;
        case 'refreshConfig':
          await refreshCommandCenterConfig(panel);
          return;
        case 'addUrl':
          await addCommandCenterUrl(panel, msg.url);
          return;
        case 'removeUrl':
          await removeCommandCenterUrl(panel, msg.url, msg.index);
          return;
        case 'loadCores':
          await loadCommandCenterCores(panel);
          return;
        case 'installCore':
          await installCommandCenterCore(panel, msg.name, msg.version);
          return;
        case 'uninstallCore':
          await uninstallCommandCenterCore(panel, msg.name);
          return;
        case 'loadLibraries':
          await loadCommandCenterLibraries(panel);
          return;
        case 'installLibrary':
          await installCommandCenterLibrary(panel, msg.name, msg.version);
          return;
        case 'uninstallLibrary':
          await uninstallCommandCenterLibrary(panel, msg.name);
          return;
        default:
          break;
      }
    } catch (err) {
      const errorText = commandCenterErrorMessage(err);
      panel.webview.postMessage({ type: 'status', error: errorText });
      showError(err);
    }
  });
}

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
      let platformIndexUrl = '';
      try {
        const text = await readTextFile(vscode.Uri.file(path.join(sketchDir, 'sketch.yaml')));
        const parsed = parsePlatformFromProfileYaml(text, prof);
        if (parsed) {
          platformId = parsed.vendorArch || '';
          platformVersion = parsed.version || '';
          platformIndexUrl = parsed.indexUrl || '';
        }
      } catch { }
      if (extFqbn) {
        panel.webview.postMessage({
          type: 'init',
          extFqbn,
          libraries: libs,
          platformId,
          platformVersion,
          platformIndexUrl,
          profileBlock,
          profileName: prof
        });
      }
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
      await rememberSelectedProfile(sketchDir, profileName);
      vscode.window.setStatusBarMessage(t('yamlApplied', { name: profileName }), 2000);
      // Optionally reveal the file
      try { await vscode.window.showTextDocument(yamlUri); } catch { }
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
  if (requestedSketchDir && requestedProfile) {
    await rememberSelectedProfile(requestedSketchDir, requestedProfile);
  }
  const initialContext = {
    sketchDir: requestedSketchDir,
    profile: requestedProfile,
    autoRun: !!(requestedSketchDir && requestedProfile),
    clean: false
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
          const clean = typeof msg.clean === 'boolean' ? msg.clean : false;
          const requestId = typeof msg.requestId === 'number' ? msg.requestId : Date.now();
          state.running = true;
          panel.webview.postMessage({ type: 'analysisStatus', status: 'start', requestId });
          try {
            const progressTitle = t('inspectorProgressTitle');
            const sketchLabel = workspaceRelativePath(sketchDir) || sketchDir;
            const progressMessage = profile
              ? t('inspectorProgressMessageProfile', { sketch: sketchLabel, profile })
              : t('inspectorProgressMessage', { sketch: sketchLabel });
            const outcome = await runWithNotificationProgress({
              location: vscode.ProgressLocation.Notification,
              title: progressTitle
            }, async (progress) => {
              if (progressMessage) {
                progress.report({ message: progressMessage });
              }
              return await runInspectorAnalysis({ sketchDir, profile, inoPath, clean });
            });
            if (outcome === PROGRESS_BUSY) {
              panel.webview.postMessage({
                type: 'analysisResult',
                requestId,
                success: false,
                message: t('progressBusyWarn')
              });
              return;
            }
            const result = outcome || {};
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
            const payload = {
              type: 'fileContent',
              key,
              content,
              path: info.path,
              size: info.size || content.length
            };
            if (key === 'partitions') {
              payload.partitions = parsePartitionsCsvText(content);
            }
            panel.webview.postMessage(payload);
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
        case 'copyText': {
          const text = typeof msg.text === 'string' ? msg.text : '';
          const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
          if (!text) {
            if (requestId) {
              panel.webview.postMessage({ type: 'copyResult', requestId, success: false, message: 'No text to copy.' });
            }
            return;
          }
          try {
            await vscode.env.clipboard.writeText(text);
            if (requestId) {
              panel.webview.postMessage({ type: 'copyResult', requestId, success: true });
            }
          } catch (err) {
            const detail = err && err.message ? err.message : String(err);
            if (requestId) {
              panel.webview.postMessage({ type: 'copyResult', requestId, success: false, message: detail });
            }
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
    'inspectorCleanOptionLabel',
    'inspectorStatusIdle',
    'inspectorStatusNoSketch',
    'inspectorStatusPreparing',
    'inspectorStatusRunning',
    'inspectorAnalysisSuccess',
    'inspectorAnalysisFailed',
    'inspectorTabSummary',
    'inspectorTabDiagnostics',
    'inspectorTabMap',
    'inspectorTabSections',
    'inspectorTabSymbols',
    'inspectorTabLibraries',
    'inspectorTabBuildProps',
    'inspectorTabPartitions',
    'inspectorTabSdkconfig',
    'inspectorTabRawJson',
    'inspectorTabDefines',
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
    'inspectorOpenInEditor',
    'inspectorDefinesNoData',
    'inspectorDefinesCopy',
    'inspectorDefinesCommand',
    'inspectorDefinesSource',
    'inspectorDefinesError',
    'inspectorDefinesCount',
    'inspectorCopySuccess'
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
    'buildReportTableDuration',
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

async function fetchVersionCheckMetadata(channel, options = {}) {
  const boardsUrl = 'https://tanakamasayuki.github.io/arduino-cli-helper/board_details.json';
  const librariesUrl = 'https://tanakamasayuki.github.io/arduino-cli-helper/libraries.json';
  const metadata = {
    boardsUrl,
    librariesUrl,
    platforms: new Map(),
    libraries: new Map(),
    warnings: []
  };
  const now = Date.now();
  const forceRefresh = !!(options && options.forceRefresh);

  const useCachedBoards = !forceRefresh && cachedBoardDetailsJson && (now - cachedBoardDetailsFetchedAt) < THREE_HOURS_MS;
  if (useCachedBoards) {
    metadata.platforms = buildPlatformLatestMap(cachedBoardDetailsJson);
  } else {
    try {
      const boardJson = await fetchJsonWithRedirect(boardsUrl);
      cachedBoardDetailsJson = boardJson;
      cachedBoardDetailsFetchedAt = Date.now();
      metadata.platforms = buildPlatformLatestMap(boardJson);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      metadata.warnings.push(`boards: ${msg}`);
      channel.appendLine(t('versionCheckFetchBoardsFail', { msg }));
      if (cachedBoardDetailsJson) {
        metadata.platforms = buildPlatformLatestMap(cachedBoardDetailsJson);
      }
    }
  }

  const useCachedLibraries = !forceRefresh && cachedLibraryDetailsJson && (now - cachedLibraryDetailsFetchedAt) < THREE_HOURS_MS;
  if (useCachedLibraries) {
    metadata.libraries = buildLibraryLatestMap(cachedLibraryDetailsJson);
  } else {
    try {
      const libraryJson = await fetchJsonWithRedirect(librariesUrl);
      cachedLibraryDetailsJson = libraryJson;
      cachedLibraryDetailsFetchedAt = Date.now();
      metadata.libraries = buildLibraryLatestMap(libraryJson);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      metadata.warnings.push(`libraries: ${msg}`);
      channel.appendLine(t('versionCheckFetchLibrariesFail', { msg }));
      if (cachedLibraryDetailsJson) {
        metadata.libraries = buildLibraryLatestMap(cachedLibraryDetailsJson);
      }
    }
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


function flushInspectorCliOutput(channel, stdout, stderr) {
  if (!channel) return;
  const trimmedStdout = typeof stdout === 'string' ? stdout.trim() : '';
  const trimmedStderr = typeof stderr === 'string' ? stderr.trim() : '';
  if (!trimmedStdout && !trimmedStderr) return;
  channel.appendLine(`${ANSI.dim}[inspector] --- arduino-cli output ---${ANSI.reset}`);
  if (trimmedStdout) {
    channel.appendLine(`${ANSI.dim}[inspector] [stdout]${ANSI.reset}`);
    channel.append(stdout);
    if (!stdout.endsWith('\n')) {
      channel.appendLine('');
    }
  }
  if (trimmedStderr) {
    channel.appendLine(`${ANSI.dim}[inspector] [stderr]${ANSI.reset}`);
    channel.append(stderr);
    if (!stderr.endsWith('\n')) {
      channel.appendLine('');
    }
  }
}

async function runInspectorAnalysis({ sketchDir, profile, inoPath, clean }) {
  if (!(await ensureCliReady())) {
    throw new Error(t('cliCheckFail', {}));
  }
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra.slice() : [];
  const cleanCompile = !!clean;
  const args = ['compile', '--warnings=all', '--json'];
  if (cleanCompile) {
    args.push('--clean');
  }
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
  let localBuildPath = '';
  if (cfg.localBuildPath) {
    try {
      localBuildPath = await ensureLocalBuildPath(sketchDir, usedProfile, usedFqbn);
    } catch (_) {
      localBuildPath = '';
    }
  }
  if (localBuildPath) {
    const applyBuildPathOverride = (list) => {
      if (!Array.isArray(list)) return false;
      for (let i = 0; i < list.length; i += 1) {
        const value = list[i];
        if (value === '--build-path') {
          if (i + 1 < list.length) {
            list[i + 1] = localBuildPath;
          } else {
            list.push(localBuildPath);
          }
          return true;
        }
        if (typeof value === 'string' && value.startsWith('--build-path=')) {
          list[i] = `--build-path=${localBuildPath}`;
          return true;
        }
      }
      return false;
    };
    let applied = applyBuildPathOverride(baseArgs);
    if (!applied) {
      applied = applyBuildPathOverride(args);
    }
    if (!applied) {
      args.push('--build-path', localBuildPath);
    }
  }
  args.push(sketchDir);
  const channel = getOutput();
  channel.show();
  await appendExtraFlagsFromFile(args, baseArgs, sketchDir, channel);
  ensureTimezoneDefines(args, baseArgs, sketchDir, cfg);
  const finalArgs = [...baseArgs, ...args];
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : quoteArg(exe);
  channel.appendLine(`${ANSI.cyan}[inspector] $ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}`);
  channel.appendLine(`${ANSI.dim}[inspector] (cwd: ${sketchDir})${ANSI.reset}`);
  let stdout = '';
  let stderr = '';
  let outputFlushed = false;
  const code = await new Promise((resolve, reject) => {
    const child = cp.spawn(exe, finalArgs, { cwd: sketchDir, shell: false });
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) {
    flushInspectorCliOutput(channel, stdout, stderr);
    outputFlushed = true;
  }
  const parsed = parseBuildCheckJson(stdout);
  if (!parsed.data) {
    if (!outputFlushed) {
      flushInspectorCliOutput(channel, stdout, stderr);
      outputFlushed = true;
    }
    const fallback = stderr && stderr.trim() ? stderr.trim() : (stdout && stdout.trim() ? stdout.trim() : '');
    const detail = parsed.error || fallback || `exit ${code}`;
    throw new Error(t('inspectorAnalysisFailed', { msg: detail }));
  }
  const data = parsed.data;
  if (!data.success && !outputFlushed) {
    flushInspectorCliOutput(channel, stdout, stderr);
    outputFlushed = true;
  }
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
      clean: cleanCompile,
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
  if (buildPath) {
    try {
      payload.defines = await collectInspectorDefines({ buildPath });
    } catch (err) {
      payload.defines = {
        success: false,
        error: err && err.message ? err.message : String(err || 'unknown')
      };
    }
  } else {
    payload.defines = {
      success: false,
      error: 'build path unavailable'
    };
  }
  return { payload, filesMeta: filesMeta.private };
}

async function collectInspectorDefines({ buildPath }) {
  const result = { success: false, macros: '', command: '', source: '', error: '', language: '', stderr: '' };
  if (!buildPath) {
    result.error = 'build path unavailable';
    return result;
  }
  const commandsUri = vscode.Uri.file(path.join(buildPath, 'compile_commands.json'));
  if (!(await pathExists(commandsUri))) {
    result.error = 'compile_commands.json not found';
    return result;
  }
  let entries;
  try {
    const raw = await readTextFile(commandsUri);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      result.error = 'compile_commands.json has unexpected format';
      return result;
    }
    entries = parsed;
  } catch (err) {
    result.error = err && err.message ? err.message : String(err || 'unknown');
    return result;
  }
  const commandInfo = pickInoCompileCommand(entries);
  if (!commandInfo) {
    result.error = 'ino compile command not found';
    return result;
  }
  const prepared = await prepareDefineCommand(commandInfo, buildPath);
  if (!prepared.success) {
    result.error = prepared.error || 'Unable to prepare define command';
    return result;
  }
  result.command = prepared.display;
  result.source = prepared.sourceDisplay || commandInfo.sourcePath;
  result.language = prepared.language;
  const execResult = await runCommandCapture(prepared.executable, prepared.args, prepared.cwd);
  if (execResult.error) {
    result.stderr = execResult.stderr || '';
    result.error = execResult.error && execResult.error.message ? execResult.error.message : String(execResult.error || 'unknown');
    return result;
  }
  if (typeof execResult.code === 'number' && execResult.code !== 0) {
    const stderrText = execResult.stderr ? execResult.stderr.trim() : '';
    result.stderr = execResult.stderr || '';
    result.error = stderrText || `exit ${execResult.code}`;
    return result;
  }
  result.success = true;
  result.macros = execResult.stdout || '';
  result.stderr = execResult.stderr || '';
  return result;
}

function pickInoCompileCommand(entries) {
  if (!Array.isArray(entries)) return null;
  let fallback = null;
  for (const entry of entries) {
    const tokens = extractCompileCommandTokens(entry);
    if (tokens.length < 2) continue;
    const sourceInfo = findSourceIndexInTokens(tokens);
    if (!sourceInfo) continue;
    const record = {
      tokens,
      sourceIndex: sourceInfo.index,
      sourcePath: sourceInfo.path,
      directory: typeof entry?.directory === 'string' ? entry.directory : '',
      executable: tokens[0]
    };
    const lower = sourceInfo.path.toLowerCase();
    if (lower.endsWith('.ino') || lower.endsWith('.ino.cpp')) return record;
    if (!fallback && (lower.endsWith('.cpp') || lower.endsWith('.cxx') || lower.endsWith('.cc'))) {
      fallback = record;
    }
  }
  return fallback;
}

function extractCompileCommandTokens(entry) {
  if (!entry || typeof entry !== 'object') return [];
  if (Array.isArray(entry.arguments) && entry.arguments.length > 0) {
    return entry.arguments.map((tok) => (typeof tok === 'string' ? stripArgumentQuotes(tok) : String(tok ?? '')));
  }
  if (typeof entry.command === 'string' && entry.command.trim()) {
    const matches = entry.command.match(ARGUMENT_TOKEN_PATTERN);
    if (matches) return matches.map(stripArgumentQuotes);
  }
  return [];
}

function findSourceIndexInTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 2) return null;
  for (let i = tokens.length - 1; i >= 1; i -= 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.startsWith('-') || token.startsWith('@')) continue;
    const lower = token.toLowerCase();
    if (lower.endsWith('.ino') || lower.endsWith('.ino.cpp') || lower.endsWith('.cpp') || lower.endsWith('.cxx') || lower.endsWith('.cc') || (lower.endsWith('.c') && !lower.endsWith('.cpp'))) {
      return { index: i, path: token };
    }
  }
  return null;
}

async function prepareDefineCommand(commandInfo, buildPath) {
  const tokens = Array.isArray(commandInfo?.tokens) ? commandInfo.tokens.slice() : [];
  if (tokens.length < 2 || typeof commandInfo.sourceIndex !== 'number' || commandInfo.sourceIndex <= 0 || commandInfo.sourceIndex >= tokens.length) {
    return { success: false, error: 'Invalid compile command tokens' };
  }
  const sourcePath = commandInfo.sourcePath;
  const executableOriginal = tokens[0];
  const language = detectCommandLanguage(sourcePath, executableOriginal);
  const sanitized = [];
  const dropFlags = new Set(['-c', '-mmd', '-md', '-mg', '-mp']);
  const dropAndConsumeNext = new Set(['-mf', '-mt', '-mq', '-o', '-x']);
  const dropInlinePrefixes = ['-mf', '-mt', '-mq'];
  const dropStandalone = new Set(['-dm', '-e']);
  let skipNext = false;
  for (let i = 1; i < tokens.length; i += 1) {
    if (i === commandInfo.sourceIndex) continue;
    if (skipNext) {
      skipNext = false;
      continue;
    }
    let token = tokens[i];
    if (typeof token !== 'string') token = String(token ?? '');
    if (!token) continue;
    const lower = token.toLowerCase();
    if (dropFlags.has(lower) || dropStandalone.has(lower)) continue;
    if (dropAndConsumeNext.has(lower)) {
      skipNext = true;
      continue;
    }
    let shouldSkip = false;
    for (const prefix of dropInlinePrefixes) {
      if (lower.startsWith(prefix) && lower.length > prefix.length) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    const normalized = normalizeTokenForEnvironment(token, sanitized.length ? sanitized[sanitized.length - 1] : null);
    sanitized.push(normalized);
  }
  const sourceArg = normalizeTokenForEnvironment(sourcePath, sanitized.length ? sanitized[sanitized.length - 1] : null);
  sanitized.push(sourceArg);
  const finalArgs = ['-dM', '-E', '-x', language, ...sanitized];
  const executable = await resolveExecutableForDefine(executableOriginal);
  if (!executable) {
    return { success: false, error: 'Compiler executable not found' };
  }
  const cwd = await resolveWorkingDirectoryForDefine(commandInfo.directory, buildPath);
  const displayCommand = `${quoteArg(executable)} ${finalArgs.map(quoteArg).join(' ')}`.trim();
  return {
    success: true,
    executable,
    args: finalArgs,
    cwd,
    display: displayCommand,
    language,
    sourceDisplay: sourcePath
  };
}

function detectCommandLanguage(sourcePath, executablePath) {
  const lowerSource = typeof sourcePath === 'string' ? sourcePath.toLowerCase() : '';
  if (lowerSource.endsWith('.ino') || lowerSource.endsWith('.ino.cpp') || lowerSource.endsWith('.cpp') || lowerSource.endsWith('.cxx') || lowerSource.endsWith('.cc')) {
    return 'c++';
  }
  if (lowerSource.endsWith('.c')) {
    return 'c';
  }
  const execLower = typeof executablePath === 'string' ? executablePath.toLowerCase() : '';
  if (execLower.includes('g++') || execLower.includes('clang++')) return 'c++';
  return 'c';
}

async function resolveExecutableForDefine(originalPath) {
  if (typeof originalPath !== 'string' || !originalPath) return '';
  let candidate = originalPath;
  if (_isWslEnv && /^[A-Za-z]:[\\/]/.test(candidate)) {
    let converted = windowsDrivePathToWsl(candidate);
    if (converted && await pathExistsSafe(converted)) {
      candidate = converted;
    } else if (converted && !converted.toLowerCase().endsWith('.exe') && await pathExistsSafe(`${converted}.exe`)) {
      candidate = `${converted}.exe`;
    } else if (converted) {
      candidate = converted;
    }
  }
  return candidate;
}

async function resolveWorkingDirectoryForDefine(directory, buildPath) {
  const primary = typeof directory === 'string' && directory ? directory : (buildPath || '');
  if (!primary) return undefined;
  const converted = _isWslEnv ? windowsDrivePathToWsl(primary) : primary;
  if (!converted) return undefined;
  if (await pathExistsSafe(converted)) return converted;
  return undefined;
}

function windowsDrivePathToWsl(p) {
  if (!_isWslEnv) return p;
  if (typeof p !== 'string' || !/^[A-Za-z]:[\\/]/.test(p)) return p;
  const drive = p[0].toLowerCase();
  const rest = p.slice(2).replace(/\\/g, '/').replace(/^\/+/, '');
  return `/mnt/${drive}/${rest}`;
}

async function pathExistsSafe(fsPath) {
  if (!fsPath) return false;
  try {
    return await pathExists(vscode.Uri.file(fsPath));
  } catch {
    return false;
  }
}

function normalizeTokenForEnvironment(token, previousToken) {
  if (!_isWslEnv || typeof token !== 'string') return token;
  const winPathPattern = /^[A-Za-z]:[\\/]/;
  const lower = token.toLowerCase();
  if (winPathPattern.test(token)) {
    return windowsDrivePathToWsl(token);
  }
  if (token.startsWith('@')) {
    const target = token.slice(1);
    if (winPathPattern.test(target)) {
      return `@${windowsDrivePathToWsl(target)}`;
    }
  }
  for (const prefix of INLINE_PATH_FLAG_PREFIXES) {
    if (lower.startsWith(prefix) && token.length > prefix.length) {
      const suffix = token.slice(prefix.length);
      if (winPathPattern.test(suffix)) {
        const converted = windowsDrivePathToWsl(suffix);
        return token.slice(0, prefix.length) + converted;
      }
    }
  }
  if (previousToken) {
    const prevLower = String(previousToken).toLowerCase();
    if (SEPARATE_PATH_FLAGS.has(prevLower) && winPathPattern.test(token)) {
      return windowsDrivePathToWsl(token);
    }
  }
  const eqIndex = token.indexOf('=');
  if (eqIndex > 0) {
    const value = token.slice(eqIndex + 1);
    if (winPathPattern.test(value)) {
      const convertedValue = windowsDrivePathToWsl(value);
      return `${token.slice(0, eqIndex + 1)}${convertedValue}`;
    }
  }
  return token;
}

const INLINE_PATH_FLAG_PREFIXES = ['-iwithprefixbefore', '-iwithprefix', '-iquote', '-isystem', '-idirafter', '-include', '-imacros', '-iprefix', '-i', '-b', '-l'];
const SEPARATE_PATH_FLAGS = new Set(['-iwithprefixbefore', '-iwithprefix', '-iquote', '-isystem', '-idirafter', '-include', '-imacros', '-iprefix', '-i', '-b', '-l']);

async function runCommandCapture(executable, args, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    try {
      const child = cp.spawn(executable, Array.isArray(args) ? args : [], { shell: false, cwd: cwd || undefined });
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        resolve({ code: null, stdout, stderr, error });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        resolve({ code, stdout, stderr, error: null });
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      resolve({ code: null, stdout, stderr, error });
    }
  });
}

function formatInspectorDiagnostic(diag) {
  let severity = String(diag?.severity || '').trim().toUpperCase();
  if (severity.includes('ERROR') || severity.includes('FATAL')) severity = 'ERROR';
  else if (severity.includes('WARN')) severity = 'WARNING';
  else if (severity.includes('NOTE')) severity = 'NOTE';
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

function parsePartitionsCsvText(text) {
  const result = {
    headers: ['Name', 'Type', 'SubType', 'Offset', 'Size', 'Flags'],
    rows: []
  };
  if (!text) return result;
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine) continue;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const headerLine = trimmed.replace(/^#+\s*/, '').trim();
      if (headerLine) {
        const headerParts = headerLine.split(',').map((part) => part.trim()).filter(Boolean);
        if (headerParts.length >= 3) {
          result.headers = headerParts;
        }
      }
      continue;
    }
    const parts = rawLine.split(',').map((part) => part.trim());
    if (!parts.length) continue;
    while (parts.length < 6) parts.push('');
    const [name = '', type = '', subType = '', offsetRaw = '', sizeRaw = ''] = parts;
    const remaining = parts.slice(5).filter((value) => value && value.length > 0);
    const flags = remaining.join(', ');
    const offsetInfo = parsePartitionNumeric(offsetRaw);
    const sizeInfo = parsePartitionNumeric(sizeRaw);
    result.rows.push({
      name,
      type,
      subType,
      offsetRaw,
      offsetHex: offsetInfo.hex,
      offsetDec: offsetInfo.dec,
      sizeRaw,
      sizeHex: sizeInfo.hex,
      sizeDec: sizeInfo.dec,
      flags
    });
  }
  return result;
}

function parsePartitionNumeric(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { raw: '', hex: '', dec: null };
  }
  let dec = Number.NaN;
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    dec = Number.parseInt(raw, 16);
  } else if (/^[+-]?\d+$/.test(raw)) {
    dec = Number.parseInt(raw, 10);
  } else {
    const hexMatch = raw.match(/0x[0-9a-f]+/i);
    if (hexMatch) {
      dec = Number.parseInt(hexMatch[0], 16);
    } else {
      const decMatch = raw.match(/[+-]?\d+/);
      if (decMatch) {
        dec = Number.parseInt(decMatch[0], 10);
      }
    }
  }
  if (!Number.isFinite(dec)) {
    return { raw, hex: raw, dec: null };
  }
  const hex = `0x${dec.toString(16).toUpperCase()}`;
  return { raw, hex, dec };
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
          let text = '';
          try {
            text = await readTextFile(vscode.Uri.file(p));
          } catch {
            text = '';
          }
          const siblings = await gatherExampleSiblingFiles(p);
          panel.webview.postMessage({ type: 'fileContent', path: p, content: text, siblings });
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
  if (cfg.localBuildPath) {
    const profileName = yamlInfo && yamlInfo.profiles.length > 0 ? (yamlInfo.defaultProfile || yamlInfo.profiles[0]) : '';
    const fqbn = yamlInfo && yamlInfo.profiles.length > 0 ? '' : (extContext?.workspaceState.get(STATE_FQBN, '') || '');
    const buildDir = await ensureLocalBuildPath(sketchDir, profileName, fqbn);
    if (buildDir) {
      args.push('--build-path', buildDir);
    }
  }
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
          if (/^(tools|docs|test|tests|examples|build|out|dist|\.git|\.build)$/i.test(fname)) continue;
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
        if (fname === BUILD_DIR_NAME) continue;
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
      const preferForwardSlash = absolute.includes('/') && !absolute.includes('\\');
      absolute = path.normalize(absolute).replace(/[\\/]+$/, '');
      if (!absolute) continue;
      const segments = absolute.split(/[\\/]+/);
      const segmentsLower = segments.map(s => s.toLowerCase());
      for (const nameLower of libNamesLower) {
        if (segmentsLower.includes(nameLower)) {
          let rootCandidate = absolute;
          const withoutSrcSuffix = absolute.replace(/([\\/]+src)+$/i, '');
          if (withoutSrcSuffix && withoutSrcSuffix !== absolute) {
            rootCandidate = withoutSrcSuffix;
          } else {
            const idxSrc = segmentsLower.lastIndexOf('src');
            if (idxSrc >= 0) {
              const joiner = preferForwardSlash ? '/' : path.sep;
              const trimmedSegments = segments.slice(0, idxSrc);
              const rebuilt = trimmedSegments.join(joiner);
              if (rebuilt) rootCandidate = rebuilt;
            }
          }
          const normalizedRoot = path.normalize(rootCandidate);
          if (normalizedRoot) roots.add(normalizedRoot);
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

async function gatherExampleSiblingFiles(primaryPath) {
  const fullPath = String(primaryPath || '').trim();
  if (!fullPath) return [];
  const dir = path.dirname(fullPath);
  const primaryName = path.basename(fullPath);
  const items = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      const full = path.join(dir, name);
      items.push({
        path: full,
        name,
        isIno: /\.ino$/i.test(name)
      });
    }
  } catch {
    // If we cannot read the directory, fall back to the primary file only.
  }
  if (!items.length || !items.some((it) => it.path === fullPath)) {
    items.unshift({
      path: fullPath,
      name: primaryName,
      isIno: /\.ino$/i.test(primaryName)
    });
  }
  items.sort((a, b) => {
    if (a.isIno && !b.isIno) return -1;
    if (!a.isIno && b.isIno) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return items;
}

async function writeAssetsEmbedHeader(sketchDir, options = {}) {
  const { createDirIfMissing = false } = options || {};
  const assetsDir = path.join(sketchDir, 'assets');
  const headerPath = path.join(sketchDir, 'assets_embed.h');
  const assetsUri = vscode.Uri.file(assetsDir);
  const headerUri = vscode.Uri.file(headerPath);
  const hasAssetsDir = await pathExists(assetsUri);
  if (!hasAssetsDir && !createDirIfMissing) {
    return {
      status: 'missingDir',
      count: 0,
      headerPath,
      assetsPath: assetsDir
    };
  }
  if (!hasAssetsDir) {
    await ensureDir(assetsUri);
  }
  const entries = await collectAssetFileEntries(assetsUri);
  entries.sort((a, b) => a.relative.localeCompare(b.relative, undefined, { sensitivity: 'base' }));
  const content = await buildAssetsHeaderContent(sketchDir, assetsDir, entries);
  await writeTextFile(headerUri, content);
  return {
    status: entries.length ? 'written' : 'noAssets',
    count: entries.length,
    headerPath,
    assetsPath: assetsDir
  };
}

async function collectAssetFileEntries(baseUri, prefix = '') {
  const results = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    for (const [name, type] of entries) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const child = vscode.Uri.joinPath(baseUri, name);
      if (type === vscode.FileType.Directory) {
        const nested = await collectAssetFileEntries(child, rel);
        for (const item of nested) results.push(item);
      } else if (type === vscode.FileType.File) {
        let stat;
        try { stat = await vscode.workspace.fs.stat(child); } catch { stat = undefined; }
        results.push({
          uri: child,
          relative: rel.replace(/\\/g, '/'),
          mtime: stat && typeof stat.mtime === 'number' ? stat.mtime : 0
        });
      }
    }
  } catch { }
  return results;
}

async function buildAssetsHeaderContent(sketchDir, assetsDir, entries) {
  const lines = [];
  lines.push('// Auto-generated by Arduino CLI Wrapper: Embed Assets');
  const sketchName = path.basename(sketchDir || '') || sketchDir;
  lines.push(`// Sketch: ${sketchName}`);
  if (!entries.length) {
    lines.push('#pragma once');
    lines.push('#include <cstddef>');
    lines.push('#include <cstdint>');
    lines.push('');
    lines.push('#if defined(PROGMEM)');
    lines.push('#include <pgmspace.h>');
    lines.push('#endif');
    lines.push('');
    lines.push('// No assets were found when this file was generated.');
    lines.push('');
    return lines.join('\n');
  }
  const sortedEntries = Array.isArray(entries)
    ? entries.slice().sort((a, b) => String(a.relative || '').localeCompare(String(b.relative || ''), undefined, { sensitivity: 'base' }))
    : [];
  const fileNames = [];
  const dataSymbols = [];
  const sizeSymbols = [];
  lines.push('// Index:');
  for (const entry of sortedEntries) {
    const symbol = makeAssetSymbolName(entry.relative);
    lines.push(`// - assets/${entry.relative} -> ${symbol} / ${symbol}_len`);
  }
  lines.push('');
  lines.push('#pragma once');
  lines.push('#include <cstddef>');
  lines.push('#include <cstdint>');
  lines.push('');
  lines.push('#if defined(PROGMEM)');
  lines.push('#include <pgmspace.h>');
  lines.push('#endif');
  lines.push('');
  for (const entry of sortedEntries) {
    const data = await vscode.workspace.fs.readFile(entry.uri);
    const symbol = makeAssetSymbolName(entry.relative);
    const prettyPath = '/' + String(entry.relative || '').replace(/^[\/]+/, '').replace(/\\/g, '/');
    fileNames.push(`"${prettyPath}"`);
    dataSymbols.push(symbol);
    sizeSymbols.push(`${symbol}_len`);
    lines.push(`// assets/${entry.relative}`);
    lines.push(`alignas(4) const uint8_t ${symbol}[] PROGMEM = {`);
    const body = formatAssetBytes(data);
    if (body) lines.push(body);
    lines.push('};');
    lines.push(`const size_t ${symbol}_len = ${data.length};`);
    lines.push('');
  }
  lines.push(`constexpr size_t assets_file_count = ${sortedEntries.length};`);
  lines.push(`const char* const assets_file_names[assets_file_count] = {`);
  for (let i = 0; i < fileNames.length; i++) {
    const suffix = (i + 1) < fileNames.length ? ',' : '';
    lines.push(`  ${fileNames[i]}${suffix}`);
  }
  lines.push('};');
  lines.push(`const uint8_t* const assets_file_data[assets_file_count] = {`);
  for (let i = 0; i < dataSymbols.length; i++) {
    const suffix = (i + 1) < dataSymbols.length ? ',' : '';
    lines.push(`  ${dataSymbols[i]}${suffix}`);
  }
  lines.push('};');
  lines.push(`const size_t assets_file_sizes[assets_file_count] = {`);
  for (let i = 0; i < sizeSymbols.length; i++) {
    const suffix = (i + 1) < sizeSymbols.length ? ',' : '';
    lines.push(`  ${sizeSymbols[i]}${suffix}`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function makeAssetSymbolName(relativePath) {
  const lower = String(relativePath || '').toLowerCase();
  let symbol = `assets_${lower.replace(/[^a-z0-9]+/g, '_')}`;
  symbol = symbol.replace(/_+/g, '_').replace(/^_+/, '');
  if (!symbol) symbol = 'assets_data';
  if (!/^[a-z_]/.test(symbol)) symbol = `_${symbol}`;
  return symbol;
}

function formatAssetBytes(data) {
  if (!data || data.length === 0) return '';
  const values = Array.from(data, (byte) => `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`);
  const chunks = [];
  for (let i = 0; i < values.length; i += 12) {
    const slice = values.slice(i, i + 12);
    const suffix = (i + 12 < values.length) ? ',' : '';
    chunks.push(`  ${slice.join(', ')}${suffix}`);
  }
  return chunks.join('\n');
}

async function reportAssetsEmbedDiagnostics(sketchDir) {
  if (!assetsDiagnostics) return;
  const key = normalizeSketchKey(sketchDir);
  const assetsPath = path.join(sketchDir, 'assets');
  const assetsUri = vscode.Uri.file(assetsPath);
  const headerUri = vscode.Uri.file(path.join(sketchDir, 'assets_embed.h'));
  const hasAssetsDir = await pathExists(assetsUri);
  if (!hasAssetsDir) {
    clearAssetsDiagnostic(key);
    return;
  }
  const entries = await collectAssetFileEntries(assetsUri);
  if (!entries.length) {
    clearAssetsDiagnostic(key);
    return;
  }
  let newest = 0;
  let newestFile = entries[0]?.relative || '';
  for (const entry of entries) {
    const mtime = entry.mtime || 0;
    if (mtime > newest) {
      newest = mtime;
      newestFile = entry.relative;
    }
  }
  let headerExists = await pathExists(headerUri);
  let headerMtime = 0;
  if (headerExists) {
    try {
      const stat = await vscode.workspace.fs.stat(headerUri);
      headerMtime = stat && typeof stat.mtime === 'number' ? stat.mtime : 0;
    } catch {
      headerExists = false;
      headerMtime = 0;
    }
  }
  if (!headerExists || headerMtime < newest) {
    let targetUri = headerExists ? headerUri : await getPrimaryInoUri(sketchDir);
    if (!targetUri) targetUri = headerUri;
    const message = headerExists
      ? t('embedAssetsOutdated', { file: newestFile })
      : t('embedAssetsMissing', { file: newestFile });
    setAssetsDiagnostic(key, targetUri, message);
  } else {
    clearAssetsDiagnostic(key);
  }
}

function normalizeSketchKey(sketchDir) {
  return path.normalize(String(sketchDir || '')).toLowerCase();
}

function setAssetsDiagnostic(key, targetUri, message) {
  try {
    const prevPath = assetsDiagTargets.get(key);
    const targetPath = targetUri.fsPath;
    if (prevPath && prevPath !== targetPath) {
      assetsDiagnostics.delete(vscode.Uri.file(prevPath));
    }
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
      message,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'arduino-cli-wrapper';
    assetsDiagnostics.set(targetUri, [diagnostic]);
    assetsDiagTargets.set(key, targetPath);
  } catch { }
}

function clearAssetsDiagnostic(key) {
  try {
    const prevPath = assetsDiagTargets.get(key);
    if (prevPath) {
      assetsDiagnostics.delete(vscode.Uri.file(prevPath));
      assetsDiagTargets.delete(key);
    }
  } catch { }
}

async function getPrimaryInoUri(sketchDir) {
  const preferred = vscode.Uri.file(path.join(sketchDir, `${path.basename(sketchDir)}.ino`));
  if (await pathExists(preferred)) return preferred;
  try {
    const dirEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(sketchDir));
    for (const [name, type] of dirEntries) {
      if (type === vscode.FileType.File && name.toLowerCase().endsWith('.ino')) {
        return vscode.Uri.file(path.join(sketchDir, name));
      }
    }
  } catch { }
  return null;
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
