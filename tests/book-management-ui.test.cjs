'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');
const css = readFileSync(join(root, 'renderer/book-management.css'), 'utf8');
const renderer = readFileSync(join(root, 'renderer/renderer.js'), 'utf8');
const ui = readFileSync(join(root, 'renderer/ui.js'), 'utf8');
const preload = readFileSync(join(root, 'src/preload.cjs'), 'utf8');
const main = readFileSync(join(root, 'src/main.cjs'), 'utf8');

test('Versa Management is a first-class chrome channel', () => {
  assert.match(html, /id="studio-management-btn"/);
  assert.match(html, /aria-label="Versa Management"/);
  assert.doesNotMatch(html, />Access management</);
  assert.match(html, /id="versa-management-setup"/);
  assert.match(html, />Choose folders</);
  assert.match(html, /id="versa-management-channel"/);
  assert.match(html, /id="book-management-export-dialog"/);
  assert.match(html, /id="book-mgmt-search"/);
  assert.match(html, /id="book-mgmt-list"/);
  assert.match(html, /book-management\.css/);
  assert.match(html, /book-management\.js/);
  assert.match(html, /frame-src 'self' http:\/\/127\.0\.0\.1:5000/);
  assert.match(css, /\[data-mode="management"\]/);
  assert.match(ui, /mode === 'management'/);
  assert.ok(existsSync(join(root, 'services/versa-book-management/app.py')));
  assert.ok(existsSync(join(root, 'services/versa-book-management/templates/index.html')));
});

test('export opens the in-app book picker instead of a Finder dialog', () => {
  const start = main.indexOf("ipcMain.handle('project:export-all-files'");
  assert.ok(start > 0);
  const body = main.slice(start, start + 2200);
  assert.doesNotMatch(body, /showOpenDialog/);
  assert.match(body, /requireManagementDestination/);
  assert.match(body, /exportToManagementFolder/);
  assert.match(renderer, /versaBookManagement\.pickAndExport/);
  assert.match(renderer, /export-to-management/);
  assert.match(preload, /listBookManagement/);
  assert.match(preload, /availableBookManagementFolder/);
  assert.match(preload, /registerBookManagementExport/);
  assert.match(preload, /book-management:list/);
});

test('preload keeps management traffic on IPC, not ad-hoc renderer fetch', () => {
  const bookUi = readFileSync(join(root, 'renderer/book-management.js'), 'utf8');
  assert.doesNotMatch(bookUi, /fetch\(['"]http:\/\/127\.0\.0\.1:5000/);
  assert.match(bookUi, /listBookManagement/);
  assert.match(preload, /ensureBookManagement/);
  assert.match(preload, /chooseBookManagementRoot/);
  assert.match(bookUi, /chooseFolders/);
  assert.match(bookUi, /versa-theme/);
  assert.doesNotMatch(bookUi, /frame\.src = next\.toString/);
});

test('first-run Choose folders stays hidden until no root is stored', () => {
  const bookUi = readFileSync(join(root, 'renderer/book-management.js'), 'utf8');
  const ipc = readFileSync(join(root, 'src/book-management-ipc.cjs'), 'utf8');
  assert.match(html, /id="versa-management-setup"[^>]*hidden/);
  assert.match(bookUi, /function needsFirstRun/);
  assert.match(bookUi, /if \(needsFirstRun\(current\)\)/);
  assert.match(ipc, /discoverRoot/);
  assert.match(ipc, /needsFirstRun/);
  assert.doesNotMatch(ipc, /bootstrapSlots/);
});

test('Settings has a Management tab with Pick folders', () => {
  assert.match(html, /data-settings-target="management"/);
  assert.match(html, /data-settings-panel="management"/);
  assert.match(html, /id="settings-management-pick-folders"/);
  assert.match(html, />Pick folders</);
  assert.match(renderer, /'management'/);
  assert.match(renderer, /pick-management-folders/);
});

test('every lab exposes Delete all and the IPC is wired', () => {
  assert.match(html, /data-action="delete-all-maze-pages"/);
  assert.match(html, /data-action="delete-all-job-images"/);
  assert.match(html, /data-action="delete-all-text-lab"/);
  assert.match(html, /data-action="delete-all-editable"/);
  assert.match(renderer, /clear-tpt-thumbnails/);
  assert.match(renderer, /clear-tpt-preview/);
  assert.match(renderer, />Delete all</);
  assert.match(preload, /maze:clear-all/);
  assert.match(preload, /job:clear-all/);
  assert.match(preload, /text-lab:clear-all/);
  assert.match(preload, /editable:clear-all/);
  assert.match(preload, /project:clear-preview/);
  assert.match(main, /ipcMain.handle\('job:clear-all'/);
  assert.match(main, /ipcMain.handle\('text-lab:clear-all'/);
  assert.match(main, /ipcMain.handle\('editable:clear-all'/);
  assert.match(main, /ipcMain.handle\('project:clear-preview'/);
});

test('theme switch crossfades with a CSS color transition', () => {
  const refined = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
  const styles = readFileSync(join(root, 'renderer/styles.css'), 'utf8');
  assert.match(styles, /transition:\s*background-color 280ms ease,\s*color 280ms ease/);
  assert.match(refined, /background-color 280ms ease/);
  assert.match(css, /background-color 280ms ease/);
});
