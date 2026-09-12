'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');

/** Source with comments stripped. A comment describing what was removed must not read
 *  as the removed call still being there. */
const codeOnly = (text) => text
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

// A book is hours of generation and the only copy of artwork that cost real credits to
// produce. Nothing in the app may delete one irreversibly.

test('deleting a book moves it to the Trash and never calls rmSync', () => {
  const start = main.indexOf("ipcMain.handle('project:delete'");
  assert.ok(start > -1, 'the delete handler should exist');
  const body = main.slice(start, main.indexOf('\n  });', start));
  assert.match(body, /await shell\.trashItem\(target\)/);
  // The previous implementation removed the directory outright: permanent, instant and
  // unrecoverable.
  assert.doesNotMatch(codeOnly(body), /rmSync/);
});

test('a delete outside the book library is refused, not attempted', () => {
  const start = main.indexOf("ipcMain.handle('project:delete'");
  const body = main.slice(start, main.indexOf('\n  });', start));
  // A blank, "/" or home-directory outputDir would otherwise hand a recursive delete an
  // enormous target.
  assert.match(body, /const insideLibrary = target !== library && target\.startsWith\(`\$\{library\}\$\{sep\}`\)/);
  assert.match(body, /is outside the book library, so it was not deleted/);
  assert.match(main, /function getLibraryRoot\(\)/);
});

test('no code path recursively deletes a user directory', () => {
  // The one call that did is gone. This fails if another is ever introduced.
  const sources = ['src/main.cjs', 'src/file-manager.cjs', 'src/browser-controller.cjs']
    .map((file) => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
  for (const { file, text } of sources) {
    for (const [index, line] of codeOnly(text).split('\n').entries()) {
      if (!/recursive:\s*true/.test(line) || !/rmSync|rm\(/.test(line)) continue;
      // Scratch space is fine to remove outright - it is rebuilt on demand.
      const scratch = /staging|tmp|temp|cache|\.venv|test-output|profileDir|lockPath|snapshot/i.test(line);
      assert.ok(scratch, `${file}:${index + 1} recursively deletes something that is not scratch: ${line.trim()}`);
    }
  }
});

test('the failure mode is to keep the files, not to guess', () => {
  const start = main.indexOf("ipcMain.handle('project:delete'");
  const body = main.slice(start, main.indexOf('\n  });', start));
  // Failing to delete is safe; deleting the wrong thing is not.
  assert.match(body, /could not be moved to the Trash/);
});
