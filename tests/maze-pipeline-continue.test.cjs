'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main.cjs'), 'utf8');
const mazeIpc = readFileSync(join(root, 'src/maze-ipc.cjs'), 'utf8');
const renderer = readFileSync(join(root, 'renderer/renderer.js'), 'utf8');
const preload = readFileSync(join(root, 'src/preload.cjs'), 'utf8');

test('print-PDF and maze assemble do not hold the Gemini lane', () => {
  assert.match(main, /if \(liveOperation\?\.kind === 'print-pdf'\) return '';/);
  assert.match(main, /if \(liveOperation\?\.kind === 'maze-assemble'\) return '';/);
  assert.doesNotMatch(main, /return 'print PDF conversion'/);
  assert.match(main, /format !== 'maze'/);
  assert.match(main, /async function assembleMazeProductExports/);
  assert.match(main, /async function continueMazeProductPipeline/);
  assert.match(main, /onMazeBookReady: \(projectId\) => continueMazeProductPipeline\(projectId\)/);
});

test('maze generate continues into local assemble then mockups', () => {
  assert.match(mazeIpc, /maze:continue-pipeline/);
  assert.match(mazeIpc, /onMazeBookReady/);
  assert.match(preload, /continueMazePipeline/);
  assert.match(renderer, /'scan', 'analyze', 'extract', 'prompts', 'capture', 'lab', 'assemble', 'mockups', 'preview', 'export'/);
  assert.match(renderer, /async function continueMazePipelineFromLab/);
  assert.doesNotMatch(renderer, /finishMarketSession\('lab', `Opened Maze Lab/);
  assert.match(main, /await automation\.start\(\{ projectId \}\)/);
  assert.match(main, /reason: 'maze-local-compose'|assembleMazeDeliverables/);
});
