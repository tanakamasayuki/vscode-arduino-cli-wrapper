'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Real output of `arduino-cli monitor -p COM1 -l serial -b esp32:esp32:esp32 --describe --json` (trimmed).
const DESCRIBE_JSON = JSON.stringify({
  settings: [
    { setting_id: 'baudrate', label: 'Baudrate', type: 'enum', enum_values: ['9600', '115200', '2000000'], value: '9600' },
    { setting_id: 'bits', label: 'Data bits', type: 'enum', enum_values: ['5', '6', '7', '8', '9'], value: '8' },
    { setting_id: 'dtr', label: 'DTR', type: 'enum', enum_values: ['on', 'off'], value: 'off' },
    { setting_id: 'parity', label: 'Parity', type: 'enum', enum_values: ['none', 'even', 'odd', 'mark', 'space'], value: 'none' },
    { setting_id: 'rts', label: 'RTS', type: 'enum', enum_values: ['on', 'off'], value: 'off' },
    { setting_id: 'stop_bits', label: 'Stop bits', type: 'enum', enum_values: ['1', '1.5', '2'], value: '1' }
  ]
});

function load(state = {}) {
  const store = { ...state };
  const vscode = {
    env: { language: 'en' },
    EventEmitter: class { fire() {} dispose() {} },
    TreeItem: class {},
    Uri: { file: p => ({ fsPath: p }) },
    window: { createTreeView: () => ({}), createOutputChannel: () => ({ appendLine() {}, append() {} }) },
    workspace: { workspaceFolders: [] },
    commands: { executeCommand: async () => {} }
  };
  const requireLocal = createRequire(path.resolve('extension.js'));
  const context = vm.createContext({ require: name => name === 'vscode' ? vscode : requireLocal(name), module: { exports: {} }, exports: {}, process, Buffer, TextDecoder, TextEncoder, console, setTimeout, clearTimeout, setInterval, clearInterval });
  new vm.Script(fs.readFileSync('extension.js', 'utf8'), { filename: 'extension.js' }).runInContext(context);
  context.testState = { get: (k, d) => (k in store ? store[k] : d), update: async (k, v) => { store[k] = v; } };
  vm.runInContext('extContext = { workspaceState: testState };', context);
  return { context, store };
}

test('parseMonitorDescribeJson extracts ids, enum values and board defaults', () => {
  const { context } = load();
  const settings = context.parseMonitorDescribeJson(DESCRIBE_JSON);
  assert.deepEqual([...settings.map(s => s.id)], ['baudrate', 'bits', 'dtr', 'parity', 'rts', 'stop_bits']);
  const dtr = settings.find(s => s.id === 'dtr');
  assert.equal(dtr.label, 'DTR');
  assert.deepEqual([...dtr.values], ['on', 'off']);
  assert.equal(dtr.defaultValue, 'off');
  assert.equal(context.parseMonitorDescribeJson('{"error":"No monitor available"}').length, 0);
  assert.equal(context.parseMonitorDescribeJson('not json').length, 0);
});

test('buildMonitorConfigArg joins baudrate with sorted, sanitized overrides', () => {
  const { context } = load();
  assert.equal(context.buildMonitorConfigArg('115200', {}), 'baudrate=115200');
  assert.equal(
    context.buildMonitorConfigArg('115200', { parity: 'even', dtr: 'off', baudrate: '9600', bad: 'a,b', 'sp ace': 'x' }),
    'baudrate=115200,dtr=off,parity=even'
  );
});

test('formatMonitorConfigSummary renders frame format and control lines compactly', () => {
  const { context } = load();
  assert.equal(context.formatMonitorConfigSummary({}), '');
  assert.equal(context.formatMonitorConfigSummary({ parity: 'even' }), '8E1');
  assert.equal(context.formatMonitorConfigSummary({ bits: '7', stop_bits: '2', dtr: 'off', rts: 'on' }), '7N2 DTR:off RTS:on');
  assert.equal(context.formatMonitorConfigSummary({ custom: 'x' }), 'custom=x');
});

test('getPortConfigFromSketchYamlText reads every port_config entry of the profile', () => {
  const { context } = load();
  const yaml = 'profiles:\n  dev:\n    fqbn: esp32:esp32:esp32\n    port_config:\n      baudrate: 115200\n      dtr: "off"\n      parity: even\n  other:\n    fqbn: arduino:avr:uno\n';
  assert.deepEqual({ ...context.getPortConfigFromSketchYamlText(yaml, 'dev') }, { baudrate: '115200', dtr: 'off', parity: 'even' });
  assert.equal(context.getPortConfigFromSketchYamlText(yaml, 'other'), null);
  assert.deepEqual({ ...context.normalizeMonitorConfig(context.getPortConfigFromSketchYamlText(yaml, 'dev')) }, { dtr: 'off', parity: 'even' });
});

test('describeMonitorSettings queries the serial monitor with the FQBN and caches the result', async () => {
  const { context } = load({ 'arduino-cli.selectedPort': '/dev/ttyUSB0', 'arduino-cli.selectedFqbn': 'esp32:esp32:esp32' });
  const calls = [];
  context.getConfig = () => ({ exe: 'arduino-cli', extra: [] });
  context.runCliForJson = async (exe, args) => { calls.push([exe, ...args]); return DESCRIBE_JSON; };
  const first = await context.describeMonitorSettings();
  const second = await context.describeMonitorSettings();
  assert.equal(first.length, 6);
  assert.equal(second, first);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['arduino-cli', 'monitor', '-p', '/dev/ttyUSB0', '-l', 'serial', '-b', 'esp32:esp32:esp32', '--describe', '--json']);
  assert.equal(context.peekMonitorDescribeCache(), first);
});

test('describeMonitorSettings does not cache failures', async () => {
  const { context } = load({ 'arduino-cli.selectedPort': '/dev/ttyUSB0' });
  let n = 0;
  context.getConfig = () => ({ exe: 'arduino-cli', extra: [] });
  context.runCliForJson = async () => { n += 1; throw new Error('exit 1'); };
  assert.equal(await context.describeMonitorSettings(), undefined);
  assert.equal(await context.describeMonitorSettings(), undefined);
  assert.equal(n, 2);
});

test('stored monitor settings are normalized and exclude baudrate', async () => {
  const { context, store } = load();
  await context.setStoredMonitorConfig({ baudrate: '9600', rts: 'off', dtr: 'off' });
  assert.deepEqual({ ...store['arduino-cli.monitorConfig'] }, { dtr: 'off', rts: 'off' });
  assert.deepEqual({ ...context.getStoredMonitorConfig() }, { dtr: 'off', rts: 'off' });
});

test('parseStoredPortValue keeps protocol prefixes of Windows host ports', () => {
  const { context } = load();
  assert.equal(context.parseStoredPortValue('Windows host: wchlink://0123456789AB').cliPort, 'wchlink://0123456789AB');
  assert.equal(context.parseStoredPortValue('Windows ホスト: wchlink://0123456789AB').cliPort, 'wchlink://0123456789AB');
  assert.equal(context.parseStoredPortValue('Windows host: COM5').cliPort, 'COM5');
  assert.equal(context.parseStoredPortValue('Windows host: COM5').host, 'windows');
  assert.equal(context.parseStoredPortValue('/dev/ttyUSB0').cliPort, '/dev/ttyUSB0');
});

test('describeMonitorSettings leaves protocol-prefixed ports to discovery', async () => {
  const { context } = load({ 'arduino-cli.selectedPort': 'wchlink://0123456789AB' });
  const calls = [];
  context.getConfig = () => ({ exe: 'arduino-cli', extra: [] });
  context.runCliForJson = async (exe, args) => { calls.push([...args]); return DESCRIBE_JSON; };
  await context.describeMonitorSettings();
  assert.deepEqual(calls[0], ['monitor', '-p', 'wchlink://0123456789AB', '--describe', '--json']);
});
