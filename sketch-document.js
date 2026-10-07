'use strict';
// Keep editor buffers authoritative and avoid saving unrelated unsaved edits.
module.exports = function createSketchDocumentAccess(vscode) {
  const open = uri => vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  const conflict = () => Object.assign(new Error('sketch.yaml changed; reload the helper or version report'), { code: 'CONFLICT' });
  return {
    async read(uri, allowMissing = false) {
      const document = open(uri);
      if (document) return document.getText();
      try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); }
      catch (error) {
        if (allowMissing && ['FileNotFound', 'ENOENT'].includes(error.code)) return '';
        throw error;
      }
    },
    async write(uri, original, content) {
      let document;
      try { document = open(uri) || await vscode.workspace.openTextDocument(uri); }
      catch (error) {
        if (original !== '' || !['FileNotFound', 'ENOENT'].includes(error.code)) throw error;
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(uri, { overwrite: false });
        edit.insert(uri, new vscode.Position(0, 0), content);
        if (!await vscode.workspace.applyEdit(edit)) throw conflict();
        document = open(uri) || await vscode.workspace.openTextDocument(uri);
        if (!await document.save()) throw new Error('Unable to save sketch.yaml');
        return;
      }
      if (document.getText() !== original) throw conflict();
      if (content === original) return;
      const wasDirty = document.isDirty;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(original.length)), content);
      if (!await vscode.workspace.applyEdit(edit)) throw conflict();
      if (!wasDirty && !await document.save()) throw new Error('Unable to save sketch.yaml');
    }
  };
};
