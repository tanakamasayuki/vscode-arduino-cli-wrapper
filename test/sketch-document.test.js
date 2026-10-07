'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createAccess = require('../sketch-document');
function fixture({ text = 'original', dirty = false, disk = 'disk', missing = false, fail = false } = {}) {
  const uri = { toString: () => 'file:///sketch.yaml' };
  let saves = 0;
  const document = { uri, getText: () => text, isDirty: dirty, positionAt: n => n, save: async () => { saves++; return true; } };
  class Edit {
    replace(uri, range, value) { this.text = value; }
    createFile() { this.create = true; }
    insert(uri, position, value) { this.text = value; }
  }
  const workspace = { textDocuments: missing ? [] : [document], fs: { readFile: async () => Buffer.from(disk) }, openTextDocument: async () => {
    if (!workspace.textDocuments.length) throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
    return document;
  }, applyEdit: async edit => { if (fail) return false; text = edit.text; workspace.textDocuments = [document]; return true; } };
  return { uri, workspace, document, saves: () => saves, access: createAccess({ workspace, WorkspaceEdit: Edit, Position: class {}, Range: class {} }) };
}
test('reads dirty editor contents rather than disk', async () => { const f = fixture({ dirty: true }); assert.equal(await f.access.read(f.uri), 'original'); });
test('updates dirty documents without saving unrelated edits', async () => { const f = fixture({ dirty: true }); await f.access.write(f.uri, 'original', 'updated'); assert.equal(f.document.getText(), 'updated'); assert.equal(f.saves(), 0); });
test('clean documents are saved after applying edits', async () => { const f = fixture(); await f.access.write(f.uri, 'original', 'updated'); assert.equal(f.saves(), 1); });
test('conflicts and rejected workspace edits leave document intact', async () => {
  const f = fixture(); await assert.rejects(f.access.write(f.uri, 'stale', 'updated'), { code: 'CONFLICT' }); assert.equal(f.document.getText(), 'original');
  const rejected = fixture({ fail: true }); await assert.rejects(rejected.access.write(rejected.uri, 'original', 'updated'), { code: 'CONFLICT' }); assert.equal(rejected.saves(), 0);
});
test('missing files are created without overwrite and saved', async () => { const f = fixture({ missing: true }); await f.access.write(f.uri, '', 'new'); assert.equal(f.document.getText(), 'new'); assert.equal(f.saves(), 1); });
test('only missing-file errors can become an empty new document', async () => {
  const f = fixture({ missing: true }); f.workspace.fs.readFile = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  await assert.rejects(f.access.read(f.uri, true), { code: 'EACCES' });
  f.workspace.fs.readFile = async () => { throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); };
  assert.equal(await f.access.read(f.uri, true), '');
});
