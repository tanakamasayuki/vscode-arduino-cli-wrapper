'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const adapter = require('../sketch-tool-adapter');
const source = `# project
profiles:
  dev:
    fqbn: esp32:esp32:esp32:CPUFreq=240,Unknown=keep
    platforms:
      - platform: esp32:esp32 (3.0.0) # core comment
    libraries:
      - dependency: Example (1.0.0) # dependency comment
      - dir: ../../ # local source
    note: |
      first

      last
    port: /dev/ttyUSB0
  other:
    fqbn: arduino:avr:uno
    platforms:
      - platform: arduino:avr (1.8.6)
default_profile: dev
`;
async function catalog() {
  const tool = await adapter.getTool();
  return tool.createVersionCatalog({ 'esp32:esp32:esp32': { version: '3.3.7', package_url: 'https://example.com/esp32.json', config_options: [] } }, [{ name: 'Example', version: '2.0.0' }, { name: 'Added', version: '1.1.0' }]);
}
const options = { profile: 'dev', fqbn: 'esp32:esp32:esp32:CPUFreq=160,Unknown=keep', version: '3.0.0', libraries: [{ name: 'Example', version: '2.0.0' }], updateLibraries: true };

test('GUI updates versions and URL while preserving local sources, mapping dependencies, comments and untouched profiles', async () => {
  const data = await catalog();
  const rows = await adapter.report(source, data);
  const core = await adapter.updateSelected(source, rows.entries.filter(e => e.kind === 'platform'), 'platform', data);
  const result = await adapter.updateSelected(core.content, rows.entries.filter(e => e.kind === 'library'), 'library', data);
  assert.match(result.content, /dependency: Example \(2.0.0\) # dependency comment/);
  assert.match(result.content, /platform: esp32:esp32 \(3.3.7\) # core comment/);
  assert.equal(YAML.parse(result.content).profiles.dev.platforms[0].platform_index_url, 'https://example.com/esp32.json');
  assert.match(result.content, /dir: ..\/..\/ # local source/);
  assert.ok(result.content.endsWith(source.slice(source.indexOf('  other:'))));
  assert.equal(YAML.parse(result.content).profiles.dev.note, 'first\n\nlast\n');
  assert.equal(core.applied, 1);
  assert.equal(result.applied, 1);
});
test('unversioned cores are disabled and protected even when their URL is missing', async () => {
  const text = source.replace('esp32:esp32 (3.0.0)', 'esp32:esp32');
  const data = await catalog();
  const rows = await adapter.report(text, data);
  const row = rows.entries.find(e => e.kind === 'platform');
  assert.equal(row.updateEligible, false);
  const update = await adapter.updateSelected(text, [row], 'platform', data);
  assert.equal(update.content, text);
  const preview = await adapter.preview(text, { ...options, version: '', updateLibraries: false }, data);
  assert.equal(YAML.parse(preview).profiles.dev.platforms[0].platform, 'esp32:esp32');
  await assert.rejects(adapter.preview(text, options, data), { code: 'PROTECTED_CORE' });
  const pinned = await adapter.preview(text, { ...options, pinUnversioned: true }, data);
  assert.equal(YAML.parse(pinned).profiles.dev.platforms[0].platform, 'esp32:esp32 (3.0.0)');
});
test('new profiles pin catalog versions and include project index URLs', async () => {
  const content = await adapter.preview('', { ...options, version: '', updateLibraries: false }, await catalog());
  const doc = YAML.parse(content);
  assert.equal(doc.profiles.dev.platforms[0].platform, 'esp32:esp32 (3.3.7)');
  assert.equal(doc.profiles.dev.platforms[0].platform_index_url, 'https://example.com/esp32.json');
});
test('helper editing preserves dir/dependency/comments and adds/removes only selected published libraries', async () => {
  const content = await adapter.preview(source, { ...options, libraries: [...options.libraries, { name: 'Added', version: '1.1.0' }] }, await catalog());
  const doc = YAML.parse(content);
  assert.equal(doc.profiles.dev.libraries[0].dependency, 'Example (2.0.0)');
  assert.deepEqual(doc.profiles.dev.libraries[1], { dir: '../../' });
  assert.equal(doc.profiles.dev.libraries[2], 'Added (1.1.0)');
  assert.match(content, /# dependency comment/);
  assert.equal(doc.profiles.dev.fqbn, options.fqbn);
  assert.equal(doc.profiles.dev.port, '/dev/ttyUSB0');
  const removed = await adapter.preview(content, { ...options, libraries: [] }, await catalog());
  assert.deepEqual(YAML.parse(removed).profiles.dev.libraries, [{ dir: '../../' }]);
});
test('helper merge retains other profiles and protects manual pinning of development cores', async () => {
  const template = adapter.profileTemplate(source, 'dev');
  assert.match(template, /# dependency comment/);
  const content = await adapter.preview(template, options, await catalog());
  const merged = await adapter.merge(source, content);
  assert.ok(merged.content.endsWith(source.slice(source.indexOf('  other:'))));
  await assert.rejects(adapter.merge(source.replace('esp32:esp32 (3.0.0)', 'esp32:esp32'), content), { code: 'PROTECTED_CORE' });
  await assert.rejects(adapter.merge(source, source), /exactly one profile/);
});
test('stale report edits fail and newer project pins are never downgraded', async () => {
  const data = await catalog();
  const rows = await adapter.report(source, data);
  await assert.rejects(adapter.updateSelected(source.replace('(3.0.0)', '(3.1.0)'), rows.entries.filter(e => e.kind === 'platform'), 'platform', data), { code: 'CONFLICT' });
  const ahead = source.replace('(3.0.0)', '(99.0.0)');
  const aheadRows = await adapter.report(ahead, data);
  const result = await adapter.updateSelected(ahead, aheadRows.entries.filter(e => e.kind === 'platform'), 'platform', data);
  assert.match(result.content, /esp32:esp32 \(99.0.0\)/);
});
test('missing library pins are repaired, invalid YAML is rejected', async () => {
  const text = source.replace('Example (1.0.0)', 'Example');
  const data = await catalog();
  const rows = await adapter.report(text, data);
  const updated = await adapter.updateSelected(text, rows.entries.filter(e => e.kind === 'library'), 'library', data);
  assert.match(updated.content, /dependency: Example \(2.0.0\)/);
  await assert.rejects(adapter.report('profiles: [', data));
});

test('the full helper payload can intentionally remove custom fields and libraries without touching another profile', async () => {
  const template = YAML.parse(adapter.profileTemplate(source, 'dev'));
  delete template.profiles.dev.note;
  delete template.profiles.dev.port;
  delete template.profiles.dev.libraries;
  const result = await adapter.merge(source, YAML.stringify(template));
  const body = YAML.parse(result.content).profiles.dev;
  assert.equal(body.note, undefined);
  assert.equal(body.port, undefined);
  assert.equal(body.libraries, undefined);
  assert.ok(result.content.endsWith(source.slice(source.indexOf('  other:'))));
});
test('default profile selection repairs stale defaults and ignores incomplete sibling dependencies', async () => {
  const stale = source.replace('default_profile: dev', 'default_profile: missing # default comment');
  const repaired = await adapter.setDefaultProfile(stale, 'dev');
  assert.equal(YAML.parse(repaired).default_profile, 'dev');
  assert.match(repaired, /# default comment/);
  const incomplete = source.replace('    fqbn: arduino:avr:uno\n', '');
  const changed = await adapter.setDefaultProfile(incomplete, 'dev');
  assert.equal(YAML.parse(changed).default_profile, 'dev');
  await assert.rejects(adapter.setDefaultProfile(source, 'missing'));
});

test('official library index aggregation retains all versions and latest dependency metadata', async () => {
  const data = { libraries: [
    { name: 'Example', version: '1.0.0', dependencies: [{ name: 'Old' }], architectures: ['esp32'] },
    { name: 'Example', version: '2.0.0', dependencies: [{ name: 'Dependency', version: '>=1.0.0' }], architectures: ['esp32', 'avr'], repository: 'https://example.com/repo' },
    { name: 'Legacy', version: 'invalid historical version' },
  ] };
  const catalog = await adapter.libraryCatalog(data, '/custom/library_index.json', true);
  assert.deepEqual(catalog.libraries.get('example').versions, ['2.0.0', '1.0.0']);
  assert.equal(catalog.libraries.get('example').architectures, 'esp32, avr');
  assert.equal(catalog.libraryDetails.get('example').dependencies[0].name, 'Dependency');
  assert.equal(catalog.libraryDetails.get('example').repository, 'https://example.com/repo');
  assert.equal(catalog.warnings[0].name, '1');
});


test('library URL loading follows redirects, handles BOM and retains official metadata', async t => {
  const { createServer } = require('node:http');
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/index' }); res.end(); }
    else if (req.url === '/index') res.end('\uFEFF' + JSON.stringify({ libraries: [
      { name: 'Example', version: '1.0.0' },
      { name: 'Example', version: '2.0.0', dependencies: [{ name: 'Dependency', version: '>=1.0.0' }] },
    ] }));
    else if (req.url === '/bad') res.end('invalid json');
    else { res.writeHead(503); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const source = `http://127.0.0.1:${server.address().port}`;
  const catalog = await adapter.libraryCatalogFromSource(source + '/redirect');
  assert.equal(catalog.librarySource, source + '/redirect');
  assert.deepEqual(catalog.libraries.get('example').versions, ['2.0.0', '1.0.0']);
  assert.equal(catalog.libraryDetails.get('example').dependencies[0].version, '>=1.0.0');
  await assert.rejects(adapter.libraryCatalogFromSource(source + '/bad'));
  await assert.rejects(adapter.libraryCatalogFromSource(source + '/error'));
});
