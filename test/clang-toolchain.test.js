'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Map produced by ch32-riscv-ug:ch32rv 0.15.0 (clang + lld + LTO) for CH32X035, truncated after .debug_line.
const LLD_MAP = fs.readFileSync(path.join(__dirname, 'fixtures', 'lld-clang.map'), 'utf8');

const GNU_MAP = [
  'Linker script and memory map',
  '',
  ' .text.setup    0x00000000000000d4       0x10 /sketch/build/sketch/sketch.ino.cpp.o',
  '                0x00000000000000d4                setup',
  ' .text._Z4loopv',
  '                0x00000000000000e4       0x24 /sketch/build/sketch/sketch.ino.cpp.o',
  ''
].join('\n');

function load() {
  class Pos { constructor(line, character) { this.line = line; this.character = character; } }
  const vscode = {
    env: { language: 'en' },
    EventEmitter: class { fire() {} dispose() {} },
    TreeItem: class {},
    Uri: { file: p => ({ fsPath: p }) },
    Position: Pos,
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    window: { createTreeView: () => ({}), createOutputChannel: () => ({ appendLine() {}, append() {} }) },
    workspace: { workspaceFolders: [], getWorkspaceFolder: () => undefined },
    commands: { executeCommand: async () => {} }
  };
  const requireLocal = createRequire(path.resolve('extension.js'));
  const context = vm.createContext({ require: name => name === 'vscode' ? vscode : requireLocal(name), module: { exports: {} }, exports: {}, process, Buffer, TextDecoder, TextEncoder, console, setTimeout, clearTimeout, setInterval, clearInterval });
  new vm.Script(fs.readFileSync('extension.js', 'utf8'), { filename: 'extension.js' }).runInContext(context);
  return context;
}

test('lld map files are detected and parsed into input-section entries', () => {
  const context = load();
  assert.equal(context.isLldMapText(LLD_MAP), true);
  assert.equal(context.isLldMapText(GNU_MAP), false);
  const entries = context.parseMapEntries(LLD_MAP);
  const find = symbol => entries.find(e => e.symbol === symbol);
  const main = find('main');
  assert.equal(main.root, 'text');
  assert.equal(main.section, '.text.main');
  assert.equal(main.size, 0x26);
  assert.equal(main.address, 0x2ac);
  assert.equal(main.objectFile, '/sketch/build/testV003.ino.elf.lto.o');
  assert.equal(find('_start').root, 'vector');
  assert.equal(find('_start').size, 0xdc);
  assert.equal(find('handle_reset').objectFile, '/sketch/build/core/core.a(crt0_ch32.S.o)');
  // Program flash usage matches arduino-cli's "Sketch uses 724 bytes" (0x1f8 .text includes 2 bytes of alignment).
  const flash = entries.filter(e => e.root === 'vector' || e.root === 'text').reduce((sum, e) => sum + e.size, 0);
  assert.equal(flash, 722);
});

test('lld merged globals are split into their sized symbols', () => {
  const context = load();
  const bss = context.parseMapEntries(LLD_MAP).filter(e => e.root === 'bss');
  assert.deepEqual([...bss.map(e => `${e.symbol}:${e.size}`)], ['ch32rv_systick_base:4', 'ch32rv_systick_base_hi:4', 'ch32rv_millis_counter:4']);
});

test('lld linker assignments and linker-only sections are ignored', () => {
  const context = load();
  const entries = context.parseMapEntries(LLD_MAP);
  assert.equal(entries.some(e => e.section.startsWith('. =') || e.objectFile.startsWith('PROVIDE')), false);
  assert.equal(entries.some(e => e.section === '.symtab' || e.section === '.strtab'), false);
  assert.equal(entries.some(e => e.symbol.startsWith('.L') || e.symbol.startsWith('$')), false);
});

test('GNU ld map parsing is unchanged', () => {
  const context = load();
  const entries = context.parseMapEntries(GNU_MAP);
  assert.deepEqual([...entries.map(e => `${e.root}/${e.symbol}/${e.size}`)], ['text/setup/16', 'text/_Z4loopv/36']);
});

test('clang diagnostics are parsed like gcc diagnostics', () => {
  const context = load();
  const stderr = [
    '/sketch/testV003.ino:8:27: warning: unused variable \'b\' [-Wunused-variable]',
    '    8 | int unusedFn(int a) { int b; return a; }',
    '      |                           ^',
    '/sketch/testV003.ino:12:3: error: use of undeclared identifier \'foo\'',
    '1 warning and 1 error generated.'
  ].join('\n');
  const diags = context.parseCompilerDiagnostics(stderr, { allowOutsideDiagnostics: true });
  const list = [...diags.values()].flat();
  assert.deepEqual(list.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1}:${d.severity}`), ['8:27:1', '12:3:0']);
  assert.equal(list[1].message, 'use of undeclared identifier \'foo\'');
});

test('debug objdump falls back to llvm-objdump for LLVM toolchains', async () => {
  const context = load();
  const bin = path.join('/tools', 'bin');
  context.pathExistsSafe = async p => p === path.join(bin, 'llvm-objdump');
  assert.equal(await context.resolveDebugObjdumpPath(bin, 'riscv32-unknown-elf', ''), path.join(bin, 'llvm-objdump'));
  context.pathExistsSafe = async p => p === path.join(bin, 'riscv-none-elf-objdump');
  assert.equal(await context.resolveDebugObjdumpPath(bin, 'riscv-none-elf', ''), path.join(bin, 'riscv-none-elf-objdump'));
  context.pathExistsSafe = async () => false;
  assert.equal(await context.resolveDebugObjdumpPath(bin, 'riscv-none-elf', ''), path.join(bin, 'riscv-none-elf-objdump'));
  assert.equal(await context.resolveDebugObjdumpPath('', 'riscv-none-elf', ''), '');
});
