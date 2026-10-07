'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const YAML = require('yaml');
const adapter = require('../sketch-tool-adapter');
const board = { name: 'ESP32', version: '3.3.7', boardVersion: '3.3.7', package_url: 'https://example.com/esp32.json', config_options: [{ option: 'CPUFreq', values: [{ value: '240', is_default: true }, { value: '160' }] }] };
const source = `profiles:
  dev:
    fqbn: esp32:esp32:esp32:CPUFreq=240,Unknown=keep
    platforms:
      - platform: esp32:esp32
    libraries:
      - dir: ../../
      - dependency: Example (1.0.0)
    note: keep
default_profile: dev
`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(20); }
  throw new Error('Webview did not reach expected state');
}
async function openHelper(text = source, locale = 'ja') {
  const tool = await adapter.getTool();
  const rawLibraries = [{ name: 'Example', version: '2.0.0', versions: ['2.0.0', '1.0.0'] },
    { name: 'Added', version: '1.1.0', dependencies: [{ name: 'Dependency' }], repository: 'https://example.com/added' },
    { name: 'Dependency', version: '1.0.0' }];
  const boards = { 'esp32:esp32:esp32': board, 'arduino:avr:uno': { name: 'Uno', version: '1.8.6', boardVersion: '1.8.6', package_url: 'https://downloads.arduino.cc/packages/package_index.json', config_options: [] } };
  const catalog = tool.createVersionCatalog(boards, rawLibraries);
  const profile = text ? tool.listSketchProfiles(text).profiles[0] : null;
  const template = profile ? adapter.profileTemplate(text, profile.name) : '';
  const errors = [], messages = [], requests = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync('html/sketch.yaml.html', 'utf8'), { runScripts: 'dangerously', virtualConsole: console,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'language', { value: locale });
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        messages.push(message);
        if (message.type !== 'sketchToolRequest') return;
        requests.push(message.action);
        Promise.resolve().then(async () => {
          let result;
          if (message.action === 'initialize') result = { type: 'init', extFqbn: profile?.fqbn || '', platformId: profile?.platforms[0]?.name || '', platformVersion: profile?.platforms[0]?.version || '',
            profileName: profile?.name || '', profileBlock: template ? template.slice('profiles:\n'.length, template.lastIndexOf('default_profile:')) : '',
            libraries: profile?.libraries.filter(l => l.kind === 'library') || [], metadataWarning: 'catalog {catalog}; configured {configured}', localCoreLabel: 'local core' };
          else if (message.action === 'catalogs') result = { boards, libraries: [...catalog.libraries.values()].map(l => ({ ...rawLibraries.find(r => r.name === l.name), ...l })), warnings: [] };
          else if (message.action === 'preview') result = await adapter.preview(message.payload.text, message.payload, catalog);
          else if (message.action === 'checkPreview') result = await adapter.report(message.payload.text, catalog);
          else if (message.action === 'updatePreview') {
            const text = message.payload.text;
            const checked = await adapter.report(text, catalog);
            const updated = await adapter.updateSelected(text, checked.entries.filter(e => e.kind === 'library'), 'library', catalog);
            const p = tool.listSketchProfiles(updated.content).profiles[0];
            result = { content: updated.content, platformVersion: p.platforms[0].version, libraries: p.libraries.filter(l => l.kind === 'library') };
          }
          else if (message.action === 'platformVersions') result = { versions: ['3.3.7', '3.0.0'] };
          else throw new Error(`Unexpected request ${message.action}`);
          window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'sketchToolResponse', id: message.id, result } }));
        }).catch(error => {
          window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'sketchToolResponse', id: message.id, error: error.message } }));
        });
      } });
    } });
  return { dom, errors, messages, requests };
}
test('helper initializes existing local profile and preserves configured defaults, unknown options and local libraries', async () => {
  const f = await openHelper();
  try {
    await waitFor(() => f.dom.window.document.querySelector('#yamlBox')?.value);
    await delay(650);
    const doc = f.dom.window.document;
    const parsed = YAML.parse(doc.querySelector('#yamlBox').value);
    assert.equal(parsed.profiles.dev.platforms[0].platform, 'esp32:esp32');
    assert.equal(parsed.profiles.dev.fqbn, 'esp32:esp32:esp32:CPUFreq=240,Unknown=keep');
    assert.equal(parsed.profiles.dev.libraries[0].dir, '../../');
    assert.equal(parsed.profiles.dev.note, 'keep');
    assert.deepEqual(f.errors, []);
    assert.ok(f.requests.includes('preview'));
    const bulk = [...doc.querySelectorAll('button')].find(b => b.textContent === '最新版へ更新');
    assert.ok(bulk && !bulk.disabled); bulk.click();
    await waitFor(() => YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.libraries[1].dependency === 'Example (2.0.0)');
    assert.equal(YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.platforms[0].platform, 'esp32:esp32');
    const select = doc.querySelector('.platform-version-select');
    assert.equal(select.value, '');
    select.dispatchEvent(new f.dom.window.Event('focus'));
    await waitFor(() => [...select.options].some(o => o.value === '3.3.7'));
    select.value = '3.3.7'; select.dispatchEvent(new f.dom.window.Event('change'));
    await waitFor(() => YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.platforms[0].platform === 'esp32:esp32 (3.3.7)');
    const apply = [...doc.querySelectorAll('button')].find(b => b.textContent === 'sketch.yaml に反映');
    apply.click();
    assert.equal(f.messages.at(-1).type, 'applyYaml');
    assert.equal(f.messages.at(-1).pinUnversioned, true);
  } finally { f.dom.window.close(); }
});
test('helper creates pinned profiles through the module and uses English UI', async () => {
  const f = await openHelper('', 'en');
  try {
    await waitFor(() => f.requests.includes('catalogs'));
    await delay(100);
    const doc = f.dom.window.document, filter = doc.querySelector('#q');
    filter.value = 'esp32:esp32:esp32'; filter.dispatchEvent(new f.dom.window.Event('input'));
    await waitFor(() => doc.querySelector('#yamlBox')?.value);
    const parsed = YAML.parse(doc.querySelector('#yamlBox').value);
    assert.equal(parsed.profiles.esp32.platforms[0].platform, 'esp32:esp32 (3.3.7)');
    assert.equal(parsed.profiles.esp32.platforms[0].platform_index_url, board.package_url);
    assert.ok([...doc.querySelectorAll('button')].some(b => b.textContent === 'Apply to sketch.yaml'));
    assert.deepEqual(f.errors, []);
  } finally { f.dom.window.close(); }
});
test('version report disables local core updates and includes source versions in update requests', async () => {
  const messages = [];
  const dom = new JSDOM(fs.readFileSync('html/version-check.html', 'utf8'), { runScripts: 'dangerously', beforeParse(window) { window.acquireVsCodeApi = () => ({ postMessage: m => messages.push(m) }); } });
  try {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'report', payload: { locale: 'en', strings: {}, report: {
      totals: {}, warnings: [], platforms: [{ sketchDir: '/example', profile: 'dev', platformId: 'esp32:esp32', currentVersion: '', latestVersion: '3.3.7', status: 'missing', indexUrlStatus: 'missing', updateEligible: false }], libraries: [], metadataSources: {}
    } } } }));
    const buttons = [...dom.window.document.querySelectorAll('button')].filter(b => /update/i.test(b.textContent));
    assert.ok(buttons.length > 0);
    assert.ok(buttons.every(b => b.disabled));
  } finally { dom.window.close(); }
});

test('helper lists libraries and retains version selection, automatic dependencies, repository links and filtering', async () => {
  const f = await openHelper();
  try {
    const doc = f.dom.window.document;
    await waitFor(() => doc.querySelectorAll('#libsList .lib-row').length === 3);
    await delay(650);
    const row = name => [...doc.querySelectorAll('#libsList .lib-row')].find(r => r.querySelector('.lib-name').textContent === name);
    assert.equal(row('Added').querySelector('a').href, 'https://example.com/added');
    row('Added').querySelector('input').click();
    await waitFor(() => YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.libraries.includes('Added (1.1.0)'));
    let libs = YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.libraries;
    assert.ok(libs.includes('Dependency (1.0.0)'));
    assert.equal(libs[0].dir, '../../');
    const select = row('Example').querySelector('select');
    select.value = '2.0.0'; select.dispatchEvent(new f.dom.window.Event('change'));
    await waitFor(() => YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.libraries.some(l => l.dependency === 'Example (2.0.0)'));
    row('Added').querySelector('input').click();
    await waitFor(() => !YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.libraries.includes('Added (1.1.0)'));
    const filter = doc.querySelector('input[placeholder="Filter libraries (partial match)"]');
    filter.value = 'Dependency'; filter.dispatchEvent(new f.dom.window.Event('input'));
    assert.equal(doc.querySelectorAll('#libsList .lib-row').length, 1);
    assert.equal(row('Dependency').querySelector('input').checked, true);
    assert.deepEqual(f.errors, []);
  } finally { f.dom.window.close(); }
});

test('option edits, manual YAML changes and library selections survive a board-filter rerender', async () => {
  const f = await openHelper(source.replace('CPUFreq=240', 'CPUFreq=160'));
  try {
    const doc = f.dom.window.document;
    await waitFor(() => doc.querySelectorAll('#libsList .lib-row').length === 3);
    await delay(300);
    assert.equal(doc.querySelector('input[data-option="CPUFreq"]:checked').value, '160');
    const option = doc.querySelector('input[data-option="CPUFreq"][value="240"]');
    option.click();
    await waitFor(() => YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.fqbn.includes('CPUFreq=240'));
    assert.ok(YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.fqbn.includes('Unknown=keep'));
    const library = [...doc.querySelectorAll('#libsList .lib-row')].find(r => r.querySelector('.lib-name').textContent === 'Added');
    library.querySelector('input').click();
    await waitFor(() => YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev.libraries.includes('Added (1.1.0)'));
    const box = doc.querySelector('#yamlBox');
    box.value = box.value.replace('note: keep', 'note: manual');
    box.dispatchEvent(new f.dom.window.Event('input'));
    const filter = doc.querySelector('#q');
    filter.dispatchEvent(new f.dom.window.Event('input'));
    await waitFor(() => doc.querySelector('#yamlBox') && ![...doc.querySelectorAll('button')].find(b => b.textContent === 'sketch.yaml に反映').disabled);
    const updated = YAML.parse(doc.querySelector('#yamlBox').value).profiles.dev;
    assert.equal(updated.note, 'manual');
    assert.ok(updated.libraries.includes('Added (1.1.0)'));
    assert.equal(doc.querySelector('input[data-option="CPUFreq"]:checked').value, '240');
    assert.deepEqual(f.errors, []);
  } finally { f.dom.window.close(); }
});

test('choosing another board prepares a new board-named profile and preserves the original on apply', async () => {
  const f = await openHelper(source.replace('platform: esp32:esp32\n', 'platform: esp32:esp32 (3.0.0)\n'));
  try {
    const doc = f.dom.window.document;
    await waitFor(() => doc.querySelectorAll('#libsList .lib-row').length === 3);
    const filter = doc.querySelector('#q');
    filter.value = 'arduino:avr:uno'; filter.dispatchEvent(new f.dom.window.Event('input'));
    await waitFor(() => doc.querySelector('#yamlBox')?.value && YAML.parse(doc.querySelector('#yamlBox').value).profiles.uno);
    const payload = doc.querySelector('#yamlBox').value;
    assert.equal(YAML.parse(payload).profiles.uno.platforms[0].platform, 'arduino:avr (1.8.6)');
    assert.ok(YAML.parse(payload).profiles.uno.libraries.includes('Example (1.0.0)'));
    const merged = await adapter.merge(source, payload);
    assert.equal(YAML.parse(merged.content).default_profile, 'dev');
    assert.deepEqual(YAML.parse(merged.content).profiles.dev, YAML.parse(source).profiles.dev);
    assert.ok(YAML.parse(merged.content).profiles.uno);
    assert.deepEqual(f.errors, []);
  } finally { f.dom.window.close(); }
});
