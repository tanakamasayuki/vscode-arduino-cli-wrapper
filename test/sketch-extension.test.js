'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const adapter = require('../sketch-tool-adapter');
const YAML = require('yaml');
const text = 'profiles:\n  dev:\n    fqbn: esp32:esp32:esp32\n    platforms:\n      - platform: esp32:esp32 (3.0.0)\ndefault_profile: dev\n';
async function extension(locale = 'ja', diskText = text) {
  let current = text, saves = 0, handler;
  const errors = [], posted = [];
  const uri = file => ({ fsPath: file, toString: () => `file://${file}` });
  const document = { uri: uri('/sketch/sketch.yaml'), isDirty: true, getText: () => current, positionAt: n => n, save: async () => { saves++; return true; } };
  class Edit { replace(uri, range, value) { this.content = value; } }
  const panel = { disposed: false, dispose() { this.disposed = true; }, onDidDispose() {}, webview: { postMessage: async msg => { posted.push(msg); return true; }, onDidReceiveMessage(callback) { handler = callback; } } };
  const vscode = { env: { language: locale }, EventEmitter: class { fire() {} dispose() {} }, TreeItem: class {}, ViewColumn: { Active: 1 }, WorkspaceEdit: Edit, Position: class {}, Range: class {},
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    window: { createTreeView: () => ({}), createWebviewPanel: () => panel, showErrorMessage: m => errors.push(m), showTextDocument: async () => {}, setStatusBarMessage() {}, createOutputChannel: () => ({ appendLine() {} }) },
    commands: { executeCommand: async () => {} }, workspace: { workspaceFolders: [{ name: 'workspace', uri: uri('/sketch') }], textDocuments: [document], fs: { readFile: async file => file.fsPath === '/sketch/sketch.yaml' ? Buffer.from(diskText) : fs.promises.readFile(file.fsPath) }, applyEdit: async edit => { current = edit.content; return true; } } };
  const requireLocal = createRequire(path.resolve('extension.js'));
  const context = vm.createContext({ require: name => name === 'vscode' ? vscode : requireLocal(name), module: { exports: {} }, exports: {}, process, Buffer, TextDecoder, TextEncoder, console, setTimeout, clearTimeout, setInterval, clearInterval });
  new vm.Script(fs.readFileSync('extension.js', 'utf8'), { filename: 'extension.js' }).runInContext(context);
  context.testExtensionUri = uri(process.cwd());
  vm.runInContext('extContext = { extensionUri: testExtensionUri };', context);
  // Keep transport deterministic while exercising actual production message handlers.
  context.rememberSelectedProfile = async () => {};
  const resolveConfigDirs = context.getCliConfigDirs;
  context.getCliConfigDirs = async () => ({ dataDir: '', userDir: '' });
  const tool = await adapter.getTool();
  const catalog = tool.createVersionCatalog({ 'esp32:esp32:esp32': { version: '3.3.7', package_url: 'https://example.com/esp32.json', config_options: [] } }, []);
  context.fetchVersionCheckMetadata = async () => ({ catalog, warnings: [], platforms: catalog.platforms, libraries: catalog.libraries });
  await context.commandOpenSketchYamlHelper({ sketchDir: '/sketch', profile: 'dev' });
  assert.equal(errors.length, 0);
  return { context, panel, errors, posted, resolveConfigDirs, send: msg => handler(msg), content: () => current, setContent: value => { current = value; }, saves: () => saves };
}
test('extension routes helper requests to published APIs and applies to an unsaved document', async () => {
  const f = await extension();
  await f.send({ type: 'sketchToolRequest', id: 1, action: 'initialize' });
  assert.equal(f.posted.at(-1).result.profileName, 'dev');
  await f.send({ type: 'sketchToolRequest', id: 2, action: 'catalogs' });
  assert.equal(f.posted.at(-1).result.boards['esp32:esp32:esp32'].version, '3.3.7');
  await f.send({ type: 'sketchToolRequest', id: 3, action: 'preview', payload: { text, profile: 'dev', fqbn: 'esp32:esp32:esp32', version: '3.3.7', libraries: [] } });
  const payload = f.posted.at(-1).result;
  assert.equal(typeof payload, 'string');
  await f.send({ type: 'applyYaml', yaml: payload });
  assert.equal(YAML.parse(f.content()).profiles.dev.platforms[0].platform, 'esp32:esp32 (3.3.7)');
  assert.equal(f.saves(), 0);
  assert.equal(f.panel.disposed, true);
  assert.deepEqual(f.errors, []);
});
test('extension rejects changes made after opening the helper with localized messages', async () => {
  for (const locale of ['ja', 'en']) {
    const f = await extension(locale);
    f.setContent(text + '# unsaved edit\n');
    await f.send({ type: 'applyYaml', yaml: text });
    assert.match(f.errors[0], locale === 'ja' ? /変更されています/ : /changed/);
    assert.equal(f.content(), text + '# unsaved edit\n');
    assert.equal(f.panel.disposed, false);
  }
});
test('version report updates use the panel metadata and preserve dirty buffers', async () => {
  const f = await extension('en');
  const metadata = await f.context.fetchVersionCheckMetadata();
  const rows = await adapter.report(text, metadata.catalog);
  const report = await f.context.buildVersionCheckReport([{ sketchDir: '/sketch' }], metadata);
  assert.equal(report.platforms[0].currentVersion, '3.0.0');
  f.context.findSketchYamlEntries = async () => [{ sketchDir: '/sketch' }];
  await f.context.openVersionCheckReport({ initialReport: report, initialMetadata: metadata, initialSketches: [], channel: { appendLine() {} } });
  await f.send({ type: 'updatePlatforms', entries: [{ ...rows.entries[0], sketchDir: '/sketch' }] });
  assert.equal(YAML.parse(f.content()).profiles.dev.platforms[0].platform, 'esp32:esp32 (3.3.7)');
  assert.equal(f.posted.at(-1).payload.report.platforms[0].status, 'ok');
});

test('library transport retains GUI metadata while shared catalog resolves latest versions', async () => {
  const f = await extension('en');
  const tool = await adapter.getTool();
  const original = adapter.libraryCatalogFromSource;
  adapter.libraryCatalogFromSource = source => adapter.libraryCatalog({ libraries: [
    { name: 'Example', version: '1.0.0', dependencies: [{ name: 'Old' }] },
    { name: 'Example', version: '2.0.0', dependencies: [{ name: 'Dependency', version: '>=1.0.0' }], repository: 'https://example.com/repo' }
  ] }, source);
  try {
    const catalog = await f.context.loadSketchLibraryCatalog(tool);
    assert.equal(catalog.libraries.get('example').version, '2.0.0');
    assert.deepEqual(catalog.libraryDetails.get('example').dependencies, [{ name: 'Dependency', version: '>=1.0.0' }]);
    assert.equal(catalog.libraryDetails.get('example').repository, 'https://example.com/repo');
  } finally { adapter.libraryCatalogFromSource = original; }
});

test('version-check command refreshes CLI indexes before fetching catalog metadata', async () => {
  const f = await extension('en');
  const events = [];
  const metadata = await f.context.fetchVersionCheckMetadata();
  f.context.ensureCliReady = async () => { events.push('ensure'); return true; };
  f.context.runArduinoCliUpdate = async options => { events.push('update'); assert.equal(options.auto, false); assert.equal(options.skipEnsure, true); };
  f.context.getOutput = () => ({ show() {}, appendLine() {} });
  f.context.findSketchYamlEntries = async () => [{ sketchDir: '/sketch' }];
  f.context.fetchVersionCheckMetadata = async () => { events.push('catalog'); return metadata; };
  f.context.openVersionCheckReport = async () => { events.push('report'); };
  await f.context.commandVersionCheck();
  assert.deepEqual(events, ['ensure', 'update', 'catalog', 'report']);
});
test('version-check command reports index refresh failures and continues the catalog check', async () => {
  const f = await extension('en');
  const events = [];
  const metadata = await f.context.fetchVersionCheckMetadata();
  f.context.ensureCliReady = async () => true;
  f.context.runArduinoCliUpdate = async () => { throw new Error('index unavailable'); };
  f.context.showError = error => { events.push(error.message); };
  f.context.getOutput = () => ({ show() {}, appendLine() {} });
  f.context.findSketchYamlEntries = async () => [{ sketchDir: '/sketch' }];
  f.context.fetchVersionCheckMetadata = async () => metadata;
  f.context.openVersionCheckReport = async () => { events.push('report'); };
  await f.context.commandVersionCheck();
  assert.deepEqual(events, ['index unavailable', 'report']);
});

test('build profile metadata reads disk and ignores unrelated dependency validation errors', async () => {
  const disk = text + 'description: project\n';
  const f = await extension('en', disk);
  f.setContent(disk.replace('esp32:esp32:esp32', 'arduino:avr:uno'));
  assert.equal(await f.context.getFqbnFromSketchYaml('/sketch', 'dev'), 'esp32:esp32:esp32');
  const info = await f.context.readSketchYamlInfo('/sketch');
  assert.deepEqual(Array.from(info.profiles), ['dev']);
  assert.equal(info.defaultProfile, 'dev');
  const unrelated = disk.replace('default_profile: dev', '  incomplete:\n    libraries: [unversioned]\ndefault_profile: dev');
  const another = await extension('en', unrelated);
  const visible = await another.context.readSketchYamlInfo('/sketch');
  assert.deepEqual(Array.from(visible.profiles), ['dev', 'incomplete']);
  assert.equal(await another.context.getFqbnFromSketchYaml('/sketch', 'dev'), 'esp32:esp32:esp32');
});

test('CLI library indexes take precedence and changed file timestamps invalidate the catalog cache', async () => {
  const os = require('node:os');
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sketch-index-test.'));
  try {
    const file = path.join(directory, 'library_index.json');
    await fs.promises.writeFile(file, JSON.stringify({ libraries: [{ name: 'Example', version: '2.0.0' }] }));
    const f = await extension('en');
    const tool = await adapter.getTool();
    let mtime = 1;
    f.context.getCliConfigDirs = async () => ({ dataDir: directory });
    f.context.fetchJsonWithRedirect = async () => { throw new Error('Remote catalog must not be requested'); };
    f.context.testStat = () => ({ mtime, size: 10 });
    vm.runInContext('vscode.workspace.fs.stat = async () => testStat();', f.context);
    let catalog = await f.context.loadSketchLibraryCatalog(tool);
    assert.equal(catalog.librarySource, file);
    assert.equal(catalog.libraries.get('example').version, '2.0.0');
    f.context.testCatalog = catalog;
    vm.runInContext('cachedLibraryDetailsJson = testCatalog;', f.context);
    assert.equal(await f.context.loadSketchLibraryCatalog(tool), catalog);
    mtime = 2;
    await fs.promises.writeFile(file, JSON.stringify({ libraries: [{ name: 'Example', version: '3.0.0' }] }));
    catalog = await f.context.loadSketchLibraryCatalog(tool);
    assert.equal(catalog.libraries.get('example').version, '3.0.0');
  } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});
test('unreadable CLI indexes fall back to the official index with a localized warning', async () => {
  const original = adapter.libraryCatalogFromSource;
  const requested = [];
  adapter.libraryCatalogFromSource = async source => {
    requested.push(source);
    return adapter.libraryCatalog({ libraries: [{ name: 'Example', version: '2.0.0' }] }, source);
  };
  try {
    for (const locale of ['ja', 'en']) {
      const f = await extension(locale);
      const tool = await adapter.getTool();
      f.context.getCliConfigDirs = async () => ({ dataDir: '/missing' });
      f.context.fetchJsonWithRedirect = async () => { throw new Error('Legacy transport must not be used'); };
      const catalog = await f.context.loadSketchLibraryCatalog(tool);
      assert.equal(catalog.librarySource, 'https://downloads.arduino.cc/libraries/library_index.json');
      assert.equal(catalog.libraries.get('example').version, '2.0.0');
      assert.match(catalog.localIndexWarning, locale === 'ja' ? /公式インデックス/ : /official index/);
    }
    assert.deepEqual(requested, [adapter.DEFAULT_LIBRARIES_SOURCE, adapter.DEFAULT_LIBRARIES_SOURCE]);
  } finally { adapter.libraryCatalogFromSource = original; }
});

test('CLI configuration resolves default directories and honors configured invocation', async () => {
  const f = await extension();
  const cp = require('node:child_process');
  const { EventEmitter } = require('node:events');
  const calls = [];
  const spawn = cp.spawn;
  f.context.getConfig = () => ({ exe: '/custom/arduino-cli', extra: ['--config-file', '/custom/cli.yaml'] });
  f.context.trackChildCancellation = () => () => false;
  cp.spawn = (exe, args) => {
    calls.push({ exe, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      child.stdout.emit('data', JSON.stringify(args.includes('directories.data') ? '/default/data' : '/default/user'));
      child.emit('close', 0);
    });
    return child;
  };
  try {
    const dirs = await f.resolveConfigDirs();
    assert.equal(dirs.dataDir, '/default/data');
    assert.equal(dirs.userDir, '/default/user');
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.exe, '/custom/arduino-cli');
      assert.deepEqual(Array.from(call.args.slice(0, 4)), ['--config-file', '/custom/cli.yaml', 'config', 'get']);
      assert.equal(call.args.at(-1), '--json');
    }
  } finally { cp.spawn = spawn; }
});

test('CLI directory lookup keeps the data directory when user directory lookup fails', async () => {
  const f = await extension();
  const cp = require('node:child_process');
  const { EventEmitter } = require('node:events');
  const spawn = cp.spawn;
  f.context.getConfig = () => ({});
  f.context.trackChildCancellation = () => () => false;
  cp.spawn = (exe, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      if (args.includes('directories.data')) child.stdout.emit('data', JSON.stringify('/data'));
      child.emit('close', args.includes('directories.data') ? 0 : 1);
    });
    return child;
  };
  try {
    const dirs = await f.resolveConfigDirs();
    assert.equal(dirs.dataDir, '/data');
    assert.equal(dirs.userDir, '');
    assert.deepEqual(f.errors, []);
  } finally { cp.spawn = spawn; }
});
