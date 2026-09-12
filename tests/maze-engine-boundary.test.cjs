'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const {
  ENGINE_TYPES,
  PRODUCT_FORMATS,
  getEngineBoundary,
  detectProductEngine,
  normalizeProductFormat
} = require('../src/product-engine-boundary.cjs');
const { getPipelineSteps, MAZE_PIPELINE, EDITABLE_PIPELINE, PIPELINE_STEPS } = require('../src/automation-manager.cjs');
const { detectProductFormat } = require('../src/product-format-detector.cjs');
const { ProjectStore } = require('../src/store.cjs');
const { assertMazeEngine } = require('../src/maze-service.cjs');

const root = join(__dirname, '..');

test('maze is a third frozen product engine and format', () => {
  assert.deepEqual(PRODUCT_FORMATS, ['static', 'editable', 'maze']);
  assert.equal(ENGINE_TYPES.MAZE, 'maze');
  assert.equal(detectProductEngine({ productFormat: 'maze' }), 'maze');
  assert.equal(normalizeProductFormat('MAZE'), 'maze');
  const boundary = getEngineBoundary(ENGINE_TYPES.MAZE);
  assert.deepEqual(boundary, { type: 'maze' });
  assert.ok(Object.isFrozen(boundary));
  assert.throws(() => detectProductEngine({ productFormat: 'unknown' }), { code: 'PRODUCT_ENGINE_INVALID' });
});

test('maze locks like the other engines and stays isolated from them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'versa-maze-lock-'));
  const store = new ProjectStore(join(dir, 'versa.sqlite'));
  try {
    store.createProject({
      id: 'maze-1',
      name: 'Mazes',
      theme: 'School',
      niche: 'Mazes',
      format: 'letter',
      orientation: 'portrait',
      style: 'flat',
      activityCount: 4,
      outputDir: dir,
      productFormat: 'maze'
    });
    const locked = store.lockProductEngine('maze-1');
    assert.equal(locked.productEngine, 'maze');
    assert.throws(
      () => detectProductEngine({ productFormat: 'static', productEngine: 'maze' }),
      { code: 'PRODUCT_ENGINE_LOCKED' }
    );
    assert.throws(() => store.updateProject('maze-1', { productFormat: 'editable' }), /locked/i);
    assert.equal(getPipelineSteps(locked), MAZE_PIPELINE);
    assert.notDeepEqual(MAZE_PIPELINE, EDITABLE_PIPELINE);
    assert.notDeepEqual(MAZE_PIPELINE, PIPELINE_STEPS);
    assert.deepEqual(MAZE_PIPELINE, ['overview', 'maze', 'thumbnails', 'preview', 'export']);
    assert.throws(() => assertMazeEngine({ productFormat: 'editable' }), { code: 'MAZE_ENGINE_REQUIRED' });
    assert.doesNotThrow(() => assertMazeEngine(locked));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analysis and IPC keep maze on its own route', () => {
  assert.equal(detectProductFormat({ title: 'Maze book with answer key' }).productFormat, 'maze');
  assert.equal(detectProductFormat({ description: 'Fully editable Google Slides resource.' }).productFormat, 'editable');
  const main = readFileSync(join(root, 'src/main.cjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('maze:get'/);
  assert.match(main, /ipcMain\.handle\('maze:set-config'/);
  assert.match(main, /ipcMain\.handle\('maze:generate'/);
  assert.match(main, /registerMazeLabIpc/);
  const ipc = readFileSync(join(root, 'src/maze-ipc.cjs'), 'utf8');
  assert.match(ipc, /ipcMain\.handle\('maze:generate-page'/);
  assert.match(ipc, /ipcMain\.handle\('maze:generate-book'/);
  assert.match(ipc, /ipcMain\.handle\('maze:cancel'/);
  assert.match(ipc, /ipcMain\.handle\('maze:reroll-seed'/);
  assert.match(ipc, /ipcMain\.handle\('maze:set-lab'/);
  assert.match(main, /normalizeProductFormat\(productFormat\)/);
  const preload = readFileSync(join(root, 'src/preload.cjs'), 'utf8');
  assert.match(preload, /getMazeProject:/);
  const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');
  assert.match(html, /name="analysisPipelineChoice" value="maze"/);
  assert.match(html, /data-workspace-pane="maze"/);
  assert.match(html, /data-view-target="maze"/);
});
