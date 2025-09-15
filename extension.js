// JavaScript-only VS Code extension that wraps Arduino CLI
// No external dependencies; uses Node's child_process and VS Code API.

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');
const path = require('path');

const OUTPUT_NAME = 'Arduino CLI';
const STATE_FQBN = 'arduino-cli.selectedFqbn';
const STATE_PORT = 'arduino-cli.selectedPort';
const STATE_BAUD = 'arduino-cli.selectedBaud';
const STATE_LAST_PROFILE = 'arduino-cli.lastProfileApplied';
let output;
let extContext;
let statusBuild, statusUpload, statusMonitor, statusFqbn, statusPort, statusBaud, statusList, statusListAll;
let monitorTerminal;
let lastCompilerPath = '';
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
    includeCollecting: 'Collecting includePath…',
    cppPropsUpdated: 'Updated c_cpp_properties.json',
    includeHeader: 'includePath:',
    intellisenseStart: 'IntelliSense update start ({reason})',
    intellisenseDone: 'IntelliSense update done',
    intellisenseFail: 'IntelliSense update failed: {msg}',
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
    yamlApplied: 'Applied profile to sketch.yaml: {name}',
    yamlApplyError: 'Failed to apply to sketch.yaml: {msg}',
    yamlNoSketchDir: 'Could not determine a sketch folder in this workspace.',
    enterSketchName: 'Enter new sketch name',
    sketchCreateStart: '[sketch] Creating at: {path}',
    sketchCreateDone: '[sketch] Created: {path}',
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
    includeCollecting: '[IntelliSense] includePath を収集中…',
    cppPropsUpdated: '[IntelliSense] c_cpp_properties.json を更新しました',
    includeHeader: '[IntelliSense] includePath:',
    intellisenseStart: '[IntelliSense] 更新開始 ({reason})',
    intellisenseDone: '[IntelliSense] 更新完了',
    intellisenseFail: '[IntelliSense] 更新失敗: {msg}',
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

/**
 * Read extension configuration from VS Code settings.
 * Returns normalized values to be used across command helpers.
 */
function getConfig() {
  const cfg = vscode.workspace.getConfiguration();
  return {
    exe: cfg.get('arduino-cli-wrapper.path', 'arduino-cli'),
    useTerminal: cfg.get('arduino-cli-wrapper.useTerminal', false),
    extra: cfg.get('arduino-cli-wrapper.additionalArgs', []),
    verbose: cfg.get('arduino-cli-wrapper.verbose', false),
  };
}

/**
 * Lazily create and return the shared output channel.
 * All CLI logs and helper diagnostics are routed here.
 */
function getOutput() {
  if (!output) {
    // Provide a terminal-backed logging channel with OutputChannel-like API
    const termRef = getAnsiLogTerminal();
    const proxy = {
      append: (s) => { try { termRef.write(String(s)); } catch { /* ignore */ } },
      appendLine: (s) => { try { termRef.write(String(s) + "\r\n"); } catch { /* ignore */ } },
      show: () => { try { termRef.terminal.show(true); } catch { /* ignore */ } },
      dispose: () => { try { termRef.terminal.dispose(); } catch { /* ignore */ } },
    };
    output = proxy;
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
  channel.show(true);
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
  channel.show(true);
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
    child.stderr.on('data', () => {});
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
    req.setTimeout(8000, () => { try { req.destroy(new Error('timeout')); } catch(_){} });
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
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = await resolveProfileName(yamlInfo);
    if (!profile) return; // user cancelled
    channel.appendLine(`[compile] Using profile from sketch.yaml: ${profile}`);
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
    // Always use the output channel and update IntelliSense during the build
    await compileWithIntelliSense(sketchDir, args);
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
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = await resolveProfileName(yamlInfo);
    if (!profile) return;
    channel.appendLine(`[upload] Using profile from sketch.yaml: ${profile}`);
    compileArgs.push('--profile', profile);
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
    const profile = yamlInfo.lastResolved || await resolveProfileName(yamlInfo);
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
    await compileWithIntelliSense(sketchDir, compileArgs);

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

  channel.show(true);
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

/**
 * Convenience wrapper: compute include paths and write c_cpp_properties.json
 * for a given sketch directory.
 */
async function updateIntelliSenseForSketch(sketchDir, reason) {
  try {
    const include = await computeIncludePaths(sketchDir);
    await writeCppProps(sketchDir, include, reason);
  } catch (e) {
    const channel = getOutput();
    channel.appendLine(t('intellisenseFail', { msg: e.message }));
  }
}

// Compute include paths without running an extra verbose compile.
async function computeStaticIncludePaths(sketchDir) {
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  let profileName = yamlInfo?.defaultProfile || (yamlInfo?.profiles && yamlInfo.profiles[0]) || '';
  let vendorArch = '';
  let version = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    // Try to reuse dump-profile embedded in sketch.yaml
    let profileYaml = '';
    try {
      const text = await readTextFile(vscode.Uri.file(path.join(sketchDir, 'sketch.yaml')));
      const mHasProfiles = /\nprofiles\s*:/m.test(text);
      if (mHasProfiles) profileYaml = text;
    } catch { }
    const parsed = parsePlatformFromProfileYaml(profileYaml, profileName);
    if (parsed) { vendorArch = parsed.vendorArch; version = parsed.version; }
  }
  if (!vendorArch) {
    const fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    const parts = fqbn.split(':');
    if (parts.length >= 2) vendorArch = parts[0] + ':' + parts[1];
  }

  const { dataDir, userDir } = await getCliConfigDirs();
  const include = [];

  if (vendorArch && version && dataDir) {
    const [vendor, arch] = vendorArch.split(':');
    const platformPath = path.join(dataDir, 'packages', vendor, 'hardware', arch, version);
    include.push(normalizeIncludePath(platformPath + '/cores/**'));
    include.push(normalizeIncludePath(platformPath + '/variants/**'));
    include.push(normalizeIncludePath(platformPath + '/libraries/**'));
  }
  if (dataDir) {
    include.push(normalizeIncludePath(path.join(dataDir, 'packages', '**/hardware/**/**/libraries/**')));
  }
  if (userDir) {
    include.push(normalizeIncludePath(path.join(userDir, 'libraries', '**')));
  }

  // ESP-IDF include globs removed per request

  // Dedup and filter existing bases
  const seen = new Set();
  const deduped = include.filter(p => (p && !seen.has(p) && seen.add(p)));
  const checks = await Promise.all(deduped.map(async (p) => {
    try {
      const base = getGlobBase(p);
      if (!base) return false;
      return await pathExists(vscode.Uri.file(base));
    } catch { return false; }
  }));
  return deduped.filter((_, i) => checks[i]);
}

/**
 * Merge and write `.vscode/c_cpp_properties.json` for the sketch.
 * - Preserves existing configurations and only adds/overwrites when needed.
 * - Targets the configuration named `Arduino` (creates it if missing).
 * - Appends new includePath entries without removing user-defined paths.
 */
async function writeCppProps(sketchDir, include, reason) {
  try {
    const channel = getOutput();
    const vscodeDir = vscode.Uri.file(path.join(sketchDir, '.vscode'));
    try { await vscode.workspace.fs.createDirectory(vscodeDir); } catch { }
    const cppPropsUri = vscode.Uri.file(path.join(sketchDir, '.vscode', 'c_cpp_properties.json'));

    // Load existing file if present
    let current = null;
    let rawText = '';
    try {
      rawText = await readTextFile(cppPropsUri);
      try { current = JSON.parse(rawText); } catch { current = null; }
    } catch { current = null; }

    const ensureConfigShape = (obj) => {
      if (!obj || typeof obj !== 'object') obj = {};
      if (!('version' in obj)) obj.version = 4;
      if (!Array.isArray(obj.configurations)) obj.configurations = [];
      return obj;
    };
    // Work on a deep copy to avoid mutating `current` which is used
    // to detect changes later.
    const cfgObj = ensureConfigShape(current ? JSON.parse(JSON.stringify(current)) : {});
    // Find or create our target configuration
    let idx = cfgObj.configurations.findIndex(c => c && c.name === 'Arduino');
    if (idx < 0 && cfgObj.configurations.length === 1 && !cfgObj.configurations[0].name) {
      // unnamed single config: treat as our target
      idx = 0;
      cfgObj.configurations[0].name = 'Arduino';
    }
    if (idx < 0) {
      cfgObj.configurations.push({ name: 'Arduino' });
      idx = cfgObj.configurations.length - 1;
    }
    const target = cfgObj.configurations[idx] || {};

    // Strategy flags
    const forceEmptyInclude = typeof reason === 'string' && /clean/i.test(reason);
    const isStreaming = typeof reason === 'string' && /streaming/i.test(reason);
    const isFinalize = typeof reason === 'string' && /(finalize|prune)/i.test(reason);

    // Start from current includePath
    let existingIncludes = Array.isArray(target.includePath) ? target.includePath.slice() : [];
    if (forceEmptyInclude) existingIncludes = [];

    // Optionally prune non-existent paths when not streaming (to minimize churn during build)
    if (!isStreaming && existingIncludes.length) {
      try {
        const checks = await Promise.all(existingIncludes.map(async (p) => {
          try {
            const base = getGlobBase(String(p));
            if (!base) return false;
            return await pathExists(vscode.Uri.file(base));
          } catch { return false; }
        }));
        existingIncludes = existingIncludes.filter((_, i) => checks[i]);
      } catch { /* ignore */ }
    }
    let finalIncludes;
    if (isFinalize) {
      // After build completes: replace with the final filtered set (prune unused)
      const seen = new Set();
      finalIncludes = [];
      for (const p of include || []) {
        const s = String(p || '');
        if (!seen.has(s)) { finalIncludes.push(s); seen.add(s); }
      }
    } else {
      // During streaming or manual updates: only add new entries, keep existing
      finalIncludes = existingIncludes.slice();
      const seen = new Set(finalIncludes);
      for (const p of include || []) {
        const s = String(p || '');
        if (!seen.has(s)) { finalIncludes.push(s); seen.add(s); }
      }
    }
    // Update compilerPath if we discovered one; otherwise keep existing
    if (lastCompilerPath) {
      target.compilerPath = lastCompilerPath;
    }
    // Ensure required defaults but do not clobber user changes
    if (!('defines' in target)) target.defines = Array.isArray(target.defines) ? target.defines : [];
    // Prefer newer language standards for ESP32 family (esp32, esp32-c3, etc.).
    const fqbnForStd = extContext?.workspaceState.get(STATE_FQBN, '') || '';
    const compilerPathStr = String(lastCompilerPath || target.compilerPath || '');
    const looksEsp32FromFqbn = /^esp32:/i.test(fqbnForStd);
    const looksEsp32FromInclude = existingIncludes.some(s => /(^|\/)esp32[^/]*(\/|$)/i.test(String(s)));
    const looksEsp32FromCompiler = /esp32|xtensa-esp32|riscv32-esp-elf/i.test(compilerPathStr);
    const isEsp32Family = looksEsp32FromFqbn || looksEsp32FromInclude || looksEsp32FromCompiler;
    if (isEsp32Family) {
      target.cStandard = 'c17';
      target.cppStandard = 'c++23';
    } else {
      if (!('cStandard' in target)) target.cStandard = 'c11';
      if (!('cppStandard' in target)) target.cppStandard = 'c++17';
    }
    if (!('intelliSenseMode' in target)) target.intelliSenseMode = 'gcc-x64';
    target.includePath = finalIncludes;
    cfgObj.configurations[idx] = target;

    // If nothing changed, skip write. Compare against the original JSON text
    // when available; otherwise against a minified snapshot of `current`.
    const prevText = rawText ? rawText.trim() : (current ? JSON.stringify(current) : '');
    const nextText = JSON.stringify(cfgObj);
    if (prevText !== nextText) {
      await writeTextFile(cppPropsUri, JSON.stringify(cfgObj, null, 2));
    }
  } catch (e) {
    const channel = getOutput();
    channel.appendLine(t('intellisenseFail', { msg: e.message }));
  }
}

// Run compile and update IntelliSense during the build by parsing verbose lines.
async function compileWithIntelliSense(sketchDir, args, opts = {}) {
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const finalArgs = [...baseArgs, ...args];
  const channel = getOutput();
  const displayExe = needsPwshCallOperator() ? `& ${quoteArg(exe)}` : `${quoteArg(exe)}`;
  const term = getAnsiLogTerminal();
  term.terminal.show(true);
  term.write(`${ANSI.cyan}$ ${displayExe} ${finalArgs.map(quoteArg).join(' ')}${ANSI.reset}\r\n`);
  term.write(`${ANSI.dim}(cwd: ${sketchDir})${ANSI.reset}\r\n`);
  const cleanReset = Boolean(opts.emptyIncludePath) || finalArgs.includes('--clean');

  // Base includes derived from sketch.yaml and Arduino CLI directories.
  const staticIncludes = await computeStaticIncludePaths(sketchDir);
  let dynamicSet = new Set();
  let iprefix = '';
  let buffer = '';
  let wroteInitial = false;
  let pendingWrite = null;
  let lastFilteredCount = 0;
  let lastFinalFiltered = [];
  if (cleanReset) {
    try { await writeCppProps(sketchDir, [], 'compile: clean reset includePath'); } catch { }
  }
  // Throttle writes to avoid excessive file I/O while the compiler is verbose.
  let writeRequested = false;
  const scheduleWrite = async () => {
    if (pendingWrite) { writeRequested = true; return; }
    pendingWrite = (async () => {
      try {
        do {
          writeRequested = false;
          let combined = [];
          const seen = new Set();
          for (const p of [...staticIncludes, ...Array.from(dynamicSet).map(normalizeIncludePath)]) {
            if (p && !seen.has(p)) { seen.add(p); combined.push(p); }
          }
          // ESP-IDF include globs removed per request
          // filter existing bases
          const checks = await Promise.all(combined.map(async (p) => {
            try {
              const base = getGlobBase(p);
              if (!base) return false;
              return await pathExists(vscode.Uri.file(base));
            } catch { return false; }
          }));
          const filtered = combined.filter((_, i) => checks[i]);
          lastFilteredCount = filtered.length;
          lastFinalFiltered = filtered.slice();
          await writeCppProps(sketchDir, filtered, 'compile: streaming');
        } while (writeRequested);
      } finally {
        pendingWrite = null;
      }
    })();
  };

  // Start the compile process without a shell to avoid quoting pitfalls.
  const child = cp.spawn(exe, finalArgs, { cwd: sketchDir, shell: false });
  // Stream raw output directly to pseudo terminal to preserve ANSI/CR behavior
  child.stdout.on('data', (d) => {
    const raw = d.toString();
    const norm = raw.replace(/\r?\n/g, '\r\n');
    term.write(norm);
    buffer += raw;
    processBuffer();
  });
  child.stderr.on('data', (d) => {
    const raw = d.toString();
    const norm = raw.replace(/\r?\n/g, '\r\n');
    term.write(norm);
    buffer += raw;
    processBuffer();
  });
  const inoObjRe = /\.(?:ino|pde)\.cpp\.o"?\s*$/i;
  const iRe = /(?:^|\s)"?-I(?:"([^"]+)"|(\S+))/g;
  const isystemRe = /(?:^|\s)"?-isystem(?:"([^"]+)"|(\S+))/g;
  const iprefixRe = /(?:^|\s)"?-iprefix\s+(?:"([^"]+)"|(\S+))/g;
  const atFileRe = /(?:^|\s)"?@(?:"([^"]+)"|(\S+))/g;
  // Parse one compile line to extract include-related tokens.
  function processLine(line) {
    // Accept lines that contain include-related tokens, not only .ino.cpp.o
    const hasTokens = line.includes('-I') || line.includes('-isystem') || line.includes('-iprefix') || /(^|\s)@/.test(line);
    if (!hasTokens) return;
    if (!wroteInitial) {
      // Mark we have started seeing compile lines
      wroteInitial = true;
    }
    if (!lastCompilerPath) {
      try {
        const m = line.match(/^\s*(?:"([^"]+)"|([^\s]+))/);
        const exePath = m ? (m[1] || m[2] || '') : '';
        if (exePath) lastCompilerPath = normalizeIncludePath(exePath);
      } catch { }
    }
    let m;
    while ((m = iRe.exec(line)) !== null) {
      const p = resolveIncludePath(sketchDir, m[1] || m[2] || '');
      if (p) { dynamicSet.add(p); }
    }
    while ((m = iprefixRe.exec(line)) !== null) {
      const p = resolveIncludePath(sketchDir, m[1] || m[2] || '');
      if (p) { iprefix = p; dynamicSet.add(p); }
    }
    while ((m = isystemRe.exec(line)) !== null) {
      const p = resolveIncludePath(sketchDir, m[1] || m[2] || '');
      if (p) { dynamicSet.add(p); }
    }
    // Parse @response files to include additional -I/-isystem values
    let am;
    while ((am = atFileRe.exec(line)) !== null) {
      const f = (am[1] || am[2] || '').trim();
      if (!f) continue;
      (async () => {
        try {
          const uri = vscode.Uri.file(f.replace(/"/g, ''));
          const content = await readTextFile(uri);
          const tokens = content.match(/(?:"[^"\r\n]*"|[^\s"\r\n]+)/g) || [];
          for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (tok === '-I' || tok === '-isystem') {
              const val = tokens[i + 1] || '';
              i++;
              const pathArg = resolveIncludePath(sketchDir, val);
              if (pathArg) { dynamicSet.add(pathArg); }
            } else if (tok.startsWith('-I')) {
              const pathArg = resolveIncludePath(sketchDir, tok.slice(2));
              if (pathArg) { dynamicSet.add(pathArg); }
            } else if (tok.startsWith('"-I')) {
              const pathArg = resolveIncludePath(sketchDir, tok.slice(3));
              if (pathArg) { dynamicSet.add(pathArg); }
            } else if (tok.startsWith('"-isystem')) {
              const pathArg = resolveIncludePath(sketchDir, tok.slice(9));
              if (pathArg) { dynamicSet.add(pathArg); }
            } else if (tok === '-iwithprefixbefore') {
              const rel = normalizeIncludePath(tokens[i + 1] || '');
              i++;
              if (iprefix && rel) {
                const full = resolveIncludePath(sketchDir, path.join(iprefix, rel));
                dynamicSet.add(full);
              }
            }
          }
          scheduleWrite();
        } catch (_) { /* ignore */ }
      })();
    }
    scheduleWrite();
  }
  // Accumulate chunked output and process it by line.
  function processBuffer() {
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      processLine(line);
    }
  }
  return new Promise((resolve, reject) => {
    child.on('error', (e) => { channel.appendLine(`\n[error] ${e.message}`); reject(e); });
    child.on('close', async (code) => {
      // Flush remaining buffer
      if (buffer) processLine(buffer);
      // Final write after process ends
      await scheduleWrite();
      // Prune unused and non-existent paths to minimize includePath size
      try { await writeCppProps(sketchDir, lastFinalFiltered, 'compile: finalize prune'); } catch { }
      if (cfg.verbose) {
        channel.appendLine(`[include-stream] final includePath count=${lastFilteredCount}`);
      }
      term.write(`\r\n${ANSI.bold}${ANSI.green}[exit ${code}]${ANSI.reset}\r\n`);
      if (code === 0) resolve({ code });
      else reject(new Error(`arduino-cli exited with code ${code}`));
    });
  });
}

// ESP-IDF include glob augmentation removed per request

/**
 * VS Code entry point: register commands, status bar items,
 * and event listeners. Called once when the extension loads.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  extContext = context;
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
        if (action === 'refreshView') return vscode.commands.executeCommand('arduino-cli.refreshView');
        if (action === 'setPort') return vscode.commands.executeCommand('arduino-cli.setPort');
        if (action === 'setBaud') return vscode.commands.executeCommand('arduino-cli.setBaud');
        if (action === 'setFqbn') return vscode.commands.executeCommand('arduino-cli.setFqbn');
      } catch (e) { showError(e); }
    }),
    vscode.commands.registerCommand('arduino-cli.sketchNew', commandSketchNew),
    vscode.commands.registerCommand('arduino-cli.expandAll', commandExpandAllTree),
    vscode.commands.registerCommand('arduino-cli.examples', () => commandOpenExamplesBrowser({})),
    vscode.commands.registerCommand('arduino-cli.sketchYamlHelper', commandOpenSketchYamlHelper),
    vscode.commands.registerCommand('arduino-cli.version', commandVersion),
    vscode.commands.registerCommand('arduino-cli.listBoards', commandListBoards),
    vscode.commands.registerCommand('arduino-cli.listAllBoards', commandListAllBoards),
    vscode.commands.registerCommand('arduino-cli.boardDetails', commandBoardDetails),
    vscode.commands.registerCommand('arduino-cli.runArbitrary', commandRunArbitrary),
    vscode.commands.registerCommand('arduino-cli.compile', commandCompile),
    vscode.commands.registerCommand('arduino-cli.cleanCompile', commandCleanCompile),
    vscode.commands.registerCommand('arduino-cli.upload', commandUpload),
    vscode.commands.registerCommand('arduino-cli.monitor', commandMonitor),
    vscode.commands.registerCommand('arduino-cli.setProfile', () => commandSetProfile(false)),
    vscode.commands.registerCommand('arduino-cli.configureIntelliSense', commandConfigureIntelliSense),
    vscode.commands.registerCommand('arduino-cli.setFqbn', () => commandSetFqbn(false)),
    vscode.commands.registerCommand('arduino-cli.setPort', () => commandSetPort(false)),
    vscode.commands.registerCommand('arduino-cli.setBaud', () => commandSetBaud(false)),
    vscode.commands.registerCommand('arduino-cli.uploadData', commandUploadData),
  );

  // Status bar items
  statusBuild = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBuild.text = '$(tools) Build';
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

  statusList = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
  statusList.text = '$(list-unordered) Boards';
  statusList.tooltip = 'Arduino: List Connected Boards';
  statusList.command = 'arduino-cli.listBoards';

  statusListAll = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 93);
  statusListAll.text = '$(search) ListAll';
  statusListAll.tooltip = 'Arduino: List All Boards (listall)';
  statusListAll.command = 'arduino-cli.listAllBoards';

  context.subscriptions.push(statusList, statusListAll, statusBuild, statusUpload, statusMonitor, statusFqbn, statusPort, statusBaud);
  updateStatusBar();

  vscode.window.onDidChangeActiveTextEditor(updateStatusBar, null, context.subscriptions);
  vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBar, null, context.subscriptions);
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
        return info.profiles.map(p => new ProfileItem(element.dir, p, element));
      }
      // No profiles: return commands directly under project
      return defaultCommandItems(element.dir, null, element);
    }
    if (element instanceof ProfileItem) {
      return defaultCommandItems(element.dir, element.profile, element);
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
  constructor(dir, profile, parent) {
    super(`Profile: ${profile}`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'profile';
    this.tooltip = `${dir} • ${profile}`;
    this.dir = dir;
    this.profile = profile;
    this.id = `profile:${dir}|${profile}`;
    this.parent = parent;
  }
}
class CommandItem extends vscode.TreeItem {
  constructor(label, action, sketchDir, profile, parent) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'command';
    this.command = {
      command: 'arduino-cli.runTreeAction',
      title: label,
      arguments: [{ action, sketchDir, profile }]
    };
    this.id = `cmd:${action}|${sketchDir}|${profile||''}|${label}`;
    this.parent = parent;
  }
}

function defaultCommandItems(dir, profile, parent) {
  return [
    new CommandItem('Compile', 'compile', dir, profile, parent),
    new CommandItem('Upload', 'upload', dir, profile, parent),
    new CommandItem('Upload Data', 'uploadData', dir, profile, parent),
    new CommandItem('Monitor', 'monitor', dir, profile, parent),
    new CommandItem('Open Helper', 'helper', dir, profile, parent),
    new CommandItem('Open Examples', 'examples', dir, profile, parent),
  ];
}

// Commands at the root level (not tied to a specific sketch/profile)
function globalCommandItems() {
  return [
    new CommandItem('Version', 'version', '', ''),
    new CommandItem('List Boards', 'listBoards', '', ''),
    new CommandItem('List All Boards', 'listAllBoards', '', ''),
    new CommandItem('Open Helper', 'helper', '', ''),
    new CommandItem('Refresh View', 'refreshView', '', ''),
    new CommandItem('New Sketch', 'sketchNew', '', ''),
    new CommandItem('Run Command', 'runArbitrary', '', ''),
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

// Run helpers for explicit profile
async function runCompileFor(sketchDir, profile) {
  if (!(await ensureCliReady())) return;
  const cfg = getConfig();
  const args = ['compile'];
  if (cfg.verbose) args.push('--verbose');
  if (profile) args.push('--profile', profile); else {
    // fallback to FQBN/state
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) { const set = await commandSetFqbn(true); if (!set) return; fqbn = extContext.workspaceState.get(STATE_FQBN, ''); }
    args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  await compileWithIntelliSense(sketchDir, args);
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
  if (profile) { cArgs.push('--profile', profile); uArgs.push('--profile', profile); }
  else {
    let fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (!fqbn) { const set = await commandSetFqbn(true); if (!set) return; fqbn = extContext.workspaceState.get(STATE_FQBN, ''); }
    cArgs.push('--fqbn', fqbn); uArgs.push('--fqbn', fqbn);
  }
  const port = extContext?.workspaceState.get(STATE_PORT, '') || '';
  if (port) uArgs.push('-p', port);
  cArgs.push(sketchDir); uArgs.push(sketchDir);
  await compileWithIntelliSense(sketchDir, cArgs);
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

  channel.show(true);
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

/**
 * Refresh status bar items (FQBN/profile, port, baud, action buttons)
 * based on current workspace and state.
 */
async function updateStatusBar() {
  const wf = vscode.workspace.workspaceFolders;
  const hasWs = wf && wf.length > 0;
  if (!hasWs) {
    statusList.hide();
    statusListAll.hide();
    statusBuild.hide();
    statusUpload.hide();
    statusMonitor.hide();
    statusFqbn.hide();
    statusPort.hide();
    statusBaud.hide();
    return;
  }
  const sketchDir = await detectSketchDirForStatus();
  if (!sketchDir) {
    statusList.hide();
    statusListAll.hide();
    statusBuild.hide();
    statusUpload.hide();
    statusMonitor.hide();
    statusFqbn.hide();
    statusPort.hide();
    statusBaud.hide();
    return;
  }
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
  statusList.show();
  statusListAll.show();
  statusBuild.show();
  statusUpload.show();
  statusMonitor.show();
  statusFqbn.show();
  statusPort.show();
  statusBaud.show();
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
    const lines = text.split(/\r?\n/);
    let inProfiles = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inProfiles) {
        if (/^\s*profiles\s*:\s*$/.test(line)) inProfiles = true;
        continue;
      }
      const mKey = line.match(/^\s{2}([^\s:#][^:]*)\s*:\s*$/);
      if (mKey) {
        profiles.push(mKey[1].trim());
        continue;
      }
      if (/^\S/.test(line)) break; // end of profiles block
    }
    return { defaultProfile, profiles };
  } catch {
    return null;
  }
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
    const mPlat = line.match(/^\s{6}(?:-\s*)?platform\s*:\s*([A-Za-z0-9_:-]+)\s*\(([^)]+)\)\s*$/);
    if (mPlat && (!targetKey || targetKey === currentKey)) {
      return { vendorArch: mPlat[1], version: mPlat[2] };
    }
  }
  return null;
}

/**
 * Build includePath globs for IntelliSense using:
 * - sketch.yaml profiles (and dump-profile when available)
 * - Arduino CLI config directories (platform, variants, libraries)
 * - dynamic `-I` / `-isystem` from verbose compile output
 */
async function computeIncludePaths(sketchDir) {
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  let profileName = yamlInfo?.defaultProfile || (yamlInfo?.profiles && yamlInfo.profiles[0]) || '';
  let vendorArch = '';
  let version = '';
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    // Reuse dump-profile if present (from createSketchYaml), else fetch quickly
    let profileYaml = '';
    try {
      const text = await readTextFile(vscode.Uri.file(path.join(sketchDir, 'sketch.yaml')));
      const mHasProfiles = /\nprofiles\s*:/m.test(text);
      if (mHasProfiles) profileYaml = text;
    } catch { }
    if (!profileYaml) {
      // fallback to on-demand dump-profile using default FQBN if available
      const fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
      profileYaml = await getDumpProfileYaml(fqbn, sketchDir);
    }
    const parsed = parsePlatformFromProfileYaml(profileYaml, profileName);
    if (parsed) { vendorArch = parsed.vendorArch; version = parsed.version; }
  }
  if (!vendorArch) {
    // Fallback to current FQBN
    const fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    const parts = fqbn.split(':');
    if (parts.length >= 2) vendorArch = parts[0] + ':' + parts[1];
  }

  const { dataDir, userDir } = await getCliConfigDirs();
  const include = [];

  if (vendorArch && version && dataDir) {
    const [vendor, arch] = vendorArch.split(':');
    const platformPath = path.join(dataDir, 'packages', vendor, 'hardware', arch, version);
    include.push(normalizeIncludePath(platformPath + '/cores/**'));
    include.push(normalizeIncludePath(platformPath + '/variants/**'));
    include.push(normalizeIncludePath(platformPath + '/libraries/**'));
  }
  if (dataDir) {
    include.push(normalizeIncludePath(path.join(dataDir, 'packages', '**/hardware/**/**/libraries/**')));
  }
  if (userDir) {
    include.push(normalizeIncludePath(path.join(userDir, 'libraries', '**')));
  }
  // Note: we no longer use --show-properties for include paths.
  // Also collect -I flags from verbose compile command lines (*.ino.cpp.o)
  const verboseIPaths = await getIncludePathsFromVerboseCompile(sketchDir);
  for (const p of verboseIPaths) include.push(normalizeIncludePath(p));
  // ESP-IDF include globs removed per request
  // Dedup
  const seen = new Set();
  const deduped = include.filter(p => (p && !seen.has(p) && seen.add(p)));

  // Keep only paths whose base exists (for globs, check the base directory)
  const checks = await Promise.all(deduped.map(async (p) => {
    try {
      const base = getGlobBase(p);
      if (!base) return false;
      return await pathExists(vscode.Uri.file(base));
    } catch { return false; }
  }));
  return deduped.filter((_, i) => checks[i]);
}

/**
 * Manually update c_cpp_properties.json for the chosen sketch directory.
 * Computes include paths and writes the merged configuration.
 */
async function commandConfigureIntelliSense() {
  if (!(await ensureCliReady())) return;
  const ino = await pickInoFromWorkspace();
  if (!ino) return;
  const sketchDir = path.dirname(ino);
  const channel = getOutput();
  channel.show(true);
  channel.appendLine(t('includeCollecting'));
  const include = await computeIncludePaths(sketchDir);
  const compilerPath = lastCompilerPath || undefined;
  const vscodeDir = vscode.Uri.file(path.join(sketchDir, '.vscode'));
  try { await vscode.workspace.fs.createDirectory(vscodeDir); } catch { }
  const cppPropsUri = vscode.Uri.file(path.join(sketchDir, '.vscode', 'c_cpp_properties.json'));
  const config = {
    version: 4,
    configurations: [
      {
        name: 'Arduino',
        includePath: include,
        defines: [],
        compilerPath,
        cStandard: 'c11',
        cppStandard: 'c++17',
        intelliSenseMode: 'gcc-x64'
      }
    ]
  };
  await writeTextFile(cppPropsUri, JSON.stringify(config, null, 2));
  channel.appendLine(t('cppPropsUpdated'));
  channel.appendLine(t('includeHeader'));
  for (const p of include) channel.appendLine('  - ' + p);
  await vscode.window.showTextDocument(cppPropsUri);
}


/**
 * Run a verbose compile (no upload) and parse emitted compiler lines
 * to collect include paths (-I, -isystem, -iprefix and @response files).
 */
async function getIncludePathsFromVerboseCompile(sketchDir) {
  if (!(await ensureCliReady())) return [];
  const cfg = getConfig();
  const exe = cfg.exe || 'arduino-cli';
  const baseArgs = Array.isArray(cfg.extra) ? cfg.extra : [];
  const args = [...baseArgs, 'compile', '--verbose'];
  // Clear previous value to always reflect the latest
  lastCompilerPath = '';
  const yamlInfo = await readSketchYamlInfo(sketchDir);
  if (yamlInfo && yamlInfo.profiles.length > 0) {
    const profile = yamlInfo.defaultProfile || yamlInfo.profiles[0];
    args.push('--profile', profile);
  } else {
    const fqbn = extContext?.workspaceState.get(STATE_FQBN, '');
    if (fqbn) args.push('--fqbn', fqbn);
  }
  args.push(sketchDir);
  let out = '';
  let err = '';
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(exe, args, { shell: process.platform === 'win32' });
      child.stdout.on('data', d => { out += d.toString(); });
      child.stderr.on('data', d => { err += d.toString(); });
      child.on('error', e => reject(e));
      child.on('close', code => code === 0 ? resolve() : resolve()); // continue parsing even if non-zero exit
    });
  } catch (_) { }
  const text = (out + '\n' + err);
  const lines = text.split(/\r?\n/);
  const results = new Set();
  const inoObjRe = /\.(?:ino|pde)\.cpp\.o"?\s*$/i; // legacy: may not match preprocess lines
  const iRe = /(?:^|\s)"?-I(?:"([^"]+)"|(\S+))/g;
  const isystemRe = /(?:^|\s)"?-isystem(?:"([^"]+)"|(\S+))/g;
  const iprefixRe = /(?:^|\s)"?-iprefix\s+(?:"([^"]+)"|(\S+))/g;
  const atFileRe = /(?:^|\s)"?@(?:"([^"]+)"|(\S+))/g;
  const clean = (p) => resolveIncludePath(sketchDir, p || '');
  let iprefix = '';
  for (const line of lines) {
    const hasTokens = line.includes('-I') || line.includes('-isystem') || line.includes('-iprefix') || /(^|\s)@/.test(line);
    if (!hasTokens) continue;
    // Pick and store the first token (compiler executable)
    if (!lastCompilerPath) {
      try {
        const m = line.match(/^\s*(?:"([^"]+)"|([^\s]+))/);
        const exePath = m ? (m[1] || m[2] || '') : '';
        if (exePath) lastCompilerPath = normalizeIncludePath(exePath);
      } catch { /* noop */ }
    }
    // collect -I
    let m;
    while ((m = iRe.exec(line)) !== null) {
      const p = clean(m[1] || m[2]);
      if (p) results.add(p);
    }
    // collect -iprefix
    while ((m = iprefixRe.exec(line)) !== null) {
      const p = clean(m[1] || m[2]);
      if (p) {
        iprefix = p; // remember last iprefix
        results.add(p);
      }
    }
    // collect -isystem
    while ((m = isystemRe.exec(line)) !== null) {
      const p = clean(m[1] || m[2]);
      if (p) results.add(p);
    }
    // process @response files for includes
    let am;
    while ((am = atFileRe.exec(line)) !== null) {
      const f = (am[1] || am[2] || '').trim();
      if (!f) continue;
      try {
        const uri = vscode.Uri.file(f.replace(/"/g, ''));
        const content = await readTextFile(uri);
        // extract -I and -isystem and -iwithprefixbefore
        const tokens = content.match(/(?:"[^"\r\n]*"|[^\s"\r\n]+)/g) || [];
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i];
          if (tok === '-I' || tok === '-isystem') {
            const val = tokens[i + 1] || '';
            i++;
            const pathArg = clean(val);
            if (pathArg) results.add(pathArg);
          } else if (tok.startsWith('-I')) {
            const pathArg = clean(tok.slice(2));
            if (pathArg) results.add(pathArg);
          } else if (tok.startsWith('"-I')) {
            const pathArg = clean(tok.slice(3));
            if (pathArg) results.add(pathArg);
          } else if (tok.startsWith('"-isystem')) {
            const pathArg = clean(tok.slice(9));
            if (pathArg) results.add(pathArg);
          } else if (tok === '-iwithprefixbefore') {
            const rel = normalizeIncludePath(tokens[i + 1] || '');
            i++;
            if (iprefix && rel) results.add(resolveIncludePath(sketchDir, path.join(iprefix, rel)));
          }
        }
      } catch (_) { }
    }
  }
  return Array.from(results);
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
      let sketchDir = (ctx && ctx.sketchDir) ? String(ctx.sketchDir) : '';
      if (!sketchDir) {
        const ino = await pickInoFromWorkspace();
        if (!ino) return;
        sketchDir = path.dirname(ino);
      }
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
      let sketchDir = await detectSketchDirForStatus();
      if (!sketchDir) {
        // Try to pick a sketch by .ino
        try {
          const ino = await pickInoFromWorkspace();
          if (ino) sketchDir = path.dirname(ino);
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
      const { profileName, blockText } = extractProfileFromTemplateYaml(String(msg.yaml || ''));
      if (!profileName || !blockText) throw new Error('invalid YAML payload');
      const yamlUri = vscode.Uri.file(path.join(sketchDir, 'sketch.yaml'));
      let existing = '';
      try { existing = await readTextFile(yamlUri); } catch { existing = ''; }
      let merged = mergeProfileIntoSketchYaml(existing, profileName, blockText);
      await writeTextFile(yamlUri, merged);
      vscode.window.setStatusBarMessage(t('yamlApplied', { name: profileName }), 2000);
      // Optionally reveal the file
      try { await vscode.window.showTextDocument(yamlUri); } catch { }
      updateStatusBar();
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
      const ind = (s.match(/^(\s+)/) || [,''])[1];
      if (ind && ind.length === baseIndent.length) { end = i; break; }
    }
  }
  const block = lines.slice(start, end).join('\n');
  return { profileName: name, blockText: block.replace(/\s+$/, '') + '\n' };
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
 * Open a webview that lists Arduino examples from:
 * - Platform path detected via `compile --show-properties` (runtime.platform.path/build.board.platform.path)
 * - Libraries listed in sketch.yaml, mapped to includePath entries in c_cpp_properties.json
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
  // Library examples via sketch.yaml libraries + c_cpp_properties.json includePath
  try {
    const libRoots = await detectLibraryRootsFromCppProps(sketchDir);
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

async function detectLibraryRootsFromCppProps(sketchDir) {
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
  // Read c_cpp_properties.json
  try {
    const cppUri = vscode.Uri.file(path.join(sketchDir, '.vscode', 'c_cpp_properties.json'));
    const txt = await readTextFile(cppUri);
    const json = JSON.parse(txt);
    const conf = Array.isArray(json.configurations) && json.configurations.length > 0 ? json.configurations[0] : json;
    const include = Array.isArray(conf.includePath) ? conf.includePath : [];
    for (let p of include) {
      if (!p) continue;
      p = String(p);
      // Normalize glob tail and trailing separator
      p = p.replace(/[\\/]+\*\*.*$/, '');
      p = p.replace(/[\\/]+$/, '');
      // If path points into a library's src, search from the parent of src
      // Handle cases like: .../libraries/<lib>/src or deeper under src
      const parts = p.split(/[\\/]+/);
      const idxSrc = parts.map(s => s.toLowerCase()).lastIndexOf('src');
      if (idxSrc >= 0) {
        p = parts.slice(0, idxSrc).join(path.sep);
      }
      for (const name of libNames) {
        const segMatch = p.split(/[\\/]+/).some(seg => seg.toLowerCase() === name.toLowerCase());
        if (segMatch) roots.add(p);
      }
    }
  } catch { }
  return Array.from(roots);
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
    const ino = files.find(([n,t]) => t === vscode.FileType.File && /\.ino$/i.test(n));
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
  } catch {}
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
  } catch {}
  return '';
}
