'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { ProjectStore } = require('../src/store.cjs');
const {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  SHAPE_RECTANGULAR,
  DIFFICULTY_PRESETS,
  AGE_BANDS,
  DEFAULT_MAZE_PANEL,
  serializeMazeTopology,
  serializeMazeResult,
  mazeExtent
} = require('../src/maze-contract.cjs');
const {
  createSeededRng,
  hashSeed,
  resolveMazeSeed,
  generateMazeTopology,
  validateGeneratedMaze
} = require('../src/maze-generator.cjs');
const { generateMaze, generateMazePage, generateMazeTopology: serviceGenerate } = require('../src/maze-service.cjs');

function config(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'maze-core-1', revision: 1 },
    keyword: 'school',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: SHAPE_RECTANGULAR,
    seed: 'seed-core-1',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'classroom',
    frameVariantId: 'frame-a',
    framePrompt: 'A simple school frame',
    title: 'Find the apple',
    instruction: 'Trace the path',
    ...overrides
  };
}

function neighborsOf(topology, row, col) {
  const { rows, cols, horizontalWalls, verticalWalls } = topology;
  const next = [];
  if (row > 0 && !horizontalWalls[row][col]) next.push([row - 1, col]);
  if (row < rows - 1 && !horizontalWalls[row + 1][col]) next.push([row + 1, col]);
  if (col > 0 && !verticalWalls[row][col]) next.push([row, col - 1]);
  if (col < cols - 1 && !verticalWalls[row][col + 1]) next.push([row, col + 1]);
  return next;
}

function walkReachable(topology, start) {
  const seen = new Set();
  const queue = [[start.row, start.col]];
  seen.add(`${start.row},${start.col}`);
  let head = 0;
  while (head < queue.length) {
    const [row, col] = queue[head];
    head += 1;
    for (const [nr, nc] of neighborsOf(topology, row, col)) {
      const key = `${nr},${nc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

function countInternalPassages(topology) {
  let count = 0;
  for (let row = 1; row < topology.rows; row += 1) {
    for (let col = 0; col < topology.cols; col += 1) {
      if (!topology.horizontalWalls[row][col]) count += 1;
    }
  }
  for (let row = 0; row < topology.rows; row += 1) {
    for (let col = 1; col < topology.cols; col += 1) {
      if (!topology.verticalWalls[row][col]) count += 1;
    }
  }
  return count;
}

function countSimplePaths(topology, start, end) {
  let count = 0;
  const stack = [{ row: start.row, col: start.col, seen: new Set([`${start.row},${start.col}`]) }];
  while (stack.length && count < 2) {
    const current = stack.pop();
    if (current.row === end.row && current.col === end.col) {
      count += 1;
      continue;
    }
    for (const [row, col] of neighborsOf(topology, current.row, current.col)) {
      const key = `${row},${col}`;
      if (current.seen.has(key)) continue;
      const seen = new Set(current.seen);
      seen.add(key);
      stack.push({ row, col, seen });
    }
  }
  return count;
}

function assertPerfectMaze(generated) {
  const { result, spec } = generated;
  const topology = result.topology;
  const path = result.solution.path;
  const cells = topology.rows * topology.cols;
  assert.equal(result.validationResult.valid, true);
  assert.equal(topology.shape, SHAPE_RECTANGULAR);
  assert.ok(path.length >= 2);
  assert.notEqual(`${topology.entrance.row},${topology.entrance.col}`, `${topology.exit.row},${topology.exit.col}`);
  assert.equal(path[0].row, topology.entrance.row);
  assert.equal(path[0].col, topology.entrance.col);
  assert.equal(path[path.length - 1].row, topology.exit.row);
  assert.equal(path[path.length - 1].col, topology.exit.col);
  assert.equal(walkReachable(topology, topology.entrance).size, cells);
  assert.equal(countInternalPassages(topology), cells - 1);
  assert.equal(countSimplePaths(topology, topology.entrance, topology.exit), 1);
  assert.ok(path.length >= spec.minSolutionLength);
  assert.ok(topology.stats.turnCount >= spec.minTurnCount);
  assert.ok(topology.stats.deadEndCount >= spec.minDeadEndCount);
  assert.ok(topology.stats.entranceExitDistance >= spec.minEntranceExitDistance);
  const extent = mazeExtent(topology.rows, topology.cols, topology.cellSize, topology.wallThickness);
  const panel = spec.mazePanel || DEFAULT_MAZE_PANEL;
  assert.ok(extent.width <= panel.width);
  assert.ok(extent.height <= panel.height);
  assert.ok(topology.wallThickness > 0);
  assert.ok(topology.cellSize > 0);
  const checked = validateGeneratedMaze(topology, path, spec, config({
    startAssetId: 'pencil',
    endAssetId: 'apple'
  }));
  assert.equal(checked.validation.valid, true, checked.validation.messages.join('; '));
}

function createStore(name) {
  const root = mkdtempSync(join(tmpdir(), name));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  store.createProject({
    id: 'maze-core-1',
    name: 'Maze Book',
    theme: 'School',
    niche: 'Mazes',
    format: 'letter',
    orientation: 'portrait',
    style: 'flat',
    activityCount: 4,
    outputDir: root,
    productFormat: 'maze'
  });
  return { root, store };
}

test('seeded PRNG is deterministic and maze math never uses Math.random', () => {
  const first = createSeededRng('alpha');
  const second = createSeededRng('alpha');
  const third = createSeededRng('beta');
  const left = Array.from({ length: 32 }, () => first());
  const right = Array.from({ length: 32 }, () => second());
  const other = Array.from({ length: 32 }, () => third());
  assert.deepEqual(left, right);
  assert.notDeepEqual(left, other);
  assert.ok(left.every((value) => value >= 0 && value < 1));
  assert.notEqual(hashSeed('alpha'), hashSeed('beta'));
  const source = readFileSync(join(__dirname, '../src/maze-generator.cjs'), 'utf8');
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.match(source, /while \(stack\.length\)/);
  assert.match(source, /stack\[stack\.length - 1\]/);
});

test('same config and seed produce identical topology and solution', () => {
  const input = config({ seed: 'repeat-me' });
  const first = generateMazeTopology(input);
  const second = generateMazeTopology(input);
  assert.equal(serializeMazeTopology(first.result.topology), serializeMazeTopology(second.result.topology));
  assert.equal(serializeMazeResult(first.result), serializeMazeResult(second.result));
  assert.deepEqual(first.result.solution.path, second.result.solution.path);
  assert.equal(resolveMazeSeed(config({ seed: '' })).startsWith('maze:'), true);
  const derived = generateMazeTopology(config({ seed: '' }));
  const derivedAgain = generateMazeTopology(config({ seed: '' }));
  assert.equal(serializeMazeTopology(derived.result.topology), serializeMazeTopology(derivedAgain.result.topology));
});

test('different seeds typically produce different topology', () => {
  const walls = new Set();
  for (let index = 0; index < 12; index += 1) {
    const generated = generateMazeTopology(config({ seed: `vary-${index}` }));
    walls.add(serializeMazeTopology(generated.result.topology));
    assertPerfectMaze(generated);
  }
  assert.ok(walls.size >= 10, `expected most seeds to differ, got ${walls.size} unique mazes`);
});

test('tiny and large supported grids stay perfect mazes', () => {
  const tiny = generateMazeTopology(config({ seed: 'tiny-2x2', startAssetId: null, endAssetId: null }), {
    rows: 2,
    cols: 2,
    cellSize: 40,
    wallThickness: 4,
    minSolutionLength: 2,
    minTurnCount: 0,
    minDeadEndCount: 0,
    minEntranceExitDistance: 1,
    iconSize: 12,
    mazePanel: DEFAULT_MAZE_PANEL
  });
  assert.equal(tiny.result.topology.rows, 2);
  assert.equal(tiny.result.topology.cols, 2);
  assertPerfectMaze(tiny);

  const wide = generateMazeTopology(config({ seed: 'tiny-2x8' }), {
    rows: 2,
    cols: 8,
    cellSize: 28,
    wallThickness: 3,
    minSolutionLength: 4,
    minTurnCount: 0,
    minDeadEndCount: 0,
    minEntranceExitDistance: 2,
    iconSize: 16,
    mazePanel: DEFAULT_MAZE_PANEL
  });
  assertPerfectMaze(wide);

  const large = generateMazeTopology(config({ seed: 'large-30x24', ageBand: 'grades_6_8' }), {
    rows: 30,
    cols: 24,
    cellSize: 12,
    wallThickness: 2,
    minSolutionLength: 40,
    minTurnCount: 8,
    minDeadEndCount: 10,
    minEntranceExitDistance: 12,
    iconSize: 10,
    mazePanel: { x: 0, y: 0, width: 900, height: 900 }
  });
  assert.equal(large.result.topology.rows, 30);
  assertPerfectMaze(large);
});

test('every difficulty preset generates a valid perfect maze', () => {
  const ageByTier = {
    1: 'pre_k',
    2: 'kindergarten',
    3: 'grades_3_5',
    4: 'grades_6_8',
    5: 'grades_6_8'
  };
  for (const preset of Object.values(DIFFICULTY_PRESETS)) {
    const generated = generateMazeTopology(config({
      seed: `preset-${preset.id}`,
      difficultyTier: preset.tier,
      ageBand: ageByTier[preset.tier]
    }), { mazePanel: DEFAULT_MAZE_PANEL });
    assert.equal(generated.result.topology.rows, preset.rows);
    assert.equal(generated.result.topology.cols, preset.cols);
    assert.equal(generated.spec.minSolutionLength, preset.minSolutionLength);
    assertPerfectMaze(generated);
  }
});

test('property: many seeds stay connected, unique, and tree-shaped', () => {
  const presets = Object.values(DIFFICULTY_PRESETS);
  for (let index = 0; index < 20; index += 1) {
    const preset = presets[index % presets.length];
    const generated = generateMazeTopology(config({
      seed: `prop-${index}`,
      difficultyTier: preset.tier,
      ageBand: preset.tier <= 2 ? 'kindergarten' : 'grades_6_8'
    }));
    const topology = generated.result.topology;
    assert.equal(walkReachable(topology, topology.entrance).size, topology.rows * topology.cols);
    assert.equal(countInternalPassages(topology), topology.rows * topology.cols - 1);
    assert.equal(countSimplePaths(topology, topology.entrance, topology.exit), 1);
    assert.ok(generated.result.solution.path.length >= topology.stats.solutionLength);
    assert.equal(generated.result.solution.path.length, topology.stats.solutionLength);
  }
});

test('entrance and exit are open perimeter cells and the solution is the unique path', () => {
  const generated = generateMazeTopology(config({ seed: 'openings' }));
  const { topology } = generated.result;
  const { entrance, exit, rows, cols, horizontalWalls, verticalWalls } = topology;
  const open = (opening) => {
    if (opening.side === 'north') return opening.row === 0 && !horizontalWalls[0][opening.col];
    if (opening.side === 'south') return opening.row === rows - 1 && !horizontalWalls[rows][opening.col];
    if (opening.side === 'west') return opening.col === 0 && !verticalWalls[opening.row][0];
    return opening.col === cols - 1 && !verticalWalls[opening.row][cols];
  };
  assert.equal(open(entrance), true);
  assert.equal(open(exit), true);
  for (let index = 1; index < generated.result.solution.path.length; index += 1) {
    const prev = generated.result.solution.path[index - 1];
    const next = generated.result.solution.path[index];
    assert.equal(Math.abs(prev.row - next.row) + Math.abs(prev.col - next.col), 1);
    assert.ok(neighborsOf(topology, prev.row, prev.col).some(([row, col]) => row === next.row && col === next.col));
  }
});

test('minimum solution length is enforced and failed mazes are not accepted', () => {
  assert.throws(
    () => generateMazeTopology(config({ seed: 'too-short' }), {
      rows: 3,
      cols: 3,
      minSolutionLength: 500,
      minTurnCount: 0,
      minDeadEndCount: 0,
      minEntranceExitDistance: 0,
      maxRetries: 2
    }),
    { code: 'MAZE_GENERATION_FAILED' }
  );
});

test('service API persists only accepted maze results', async () => {
  const { root, store } = createStore('versa-maze-gen-');
  try {
    const generated = await generateMaze(store, 'maze-core-1', {
      config: { seed: 'service-seed', difficultyTier: 2, ageBand: 'kindergarten' }
    });
    assert.equal(generated.result.validationResult.valid, true);
    assert.equal(generated.mazeProject.pages[0].generationStatus, 'ready');
    assert.ok(generated.metrics.attempts >= 1);
    const viaPage = await generateMazePage(store, 'maze-core-1', { pageId: 'M01' });
    assert.deepEqual(viaPage.result.topology.horizontalWalls, generated.result.topology.horizontalWalls);
    const fromService = serviceGenerate(config({ seed: 'service-seed' }));
    assert.equal(fromService.result.validationResult.valid, true);
    await assert.rejects(
      () => generateMaze(store, 'maze-core-1', { mazePanel: { x: 0, y: 0, width: 2, height: 2 } }),
      { code: 'MAZE_GENERATION_FAILED' }
    );
    assert.equal(store.getSetting('mazeProject:maze-core-1').pages[0].generationStatus, 'ready');
    assert.ok(store.getSetting('mazeProject:maze-core-1').pages[0].topology);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Slice 2 maze benchmarks stay on the CPU budget', () => {
  const easy = config({ seed: 'bench-easy', difficultyTier: 2 });
  const started = performance.now();
  const single = generateMazeTopology(easy, { mazePanel: DEFAULT_MAZE_PANEL });
  const singleMs = performance.now() - started;
  assertPerfectMaze(single);
  assert.ok(singleMs < 100, `single maze took ${singleMs.toFixed(2)}ms`);
  assert.ok(single.metrics.generationMs + single.metrics.validationMs < 100);

  const batchStarted = performance.now();
  let retries = 0;
  let generationMs = 0;
  let validationMs = 0;
  for (let index = 0; index < 50; index += 1) {
    const generated = generateMazeTopology(config({ seed: `batch-${index}` }), { mazePanel: DEFAULT_MAZE_PANEL });
    assert.equal(generated.result.validationResult.valid, true);
    retries += generated.metrics.retryCount;
    generationMs += generated.metrics.generationMs;
    validationMs += generated.metrics.validationMs;
  }
  const batchMs = performance.now() - batchStarted;
  assert.ok(batchMs < 5000, `50-maze batch took ${batchMs.toFixed(2)}ms`);

  const expertStarted = performance.now();
  const expert = generateMazeTopology(config({
    seed: 'bench-expert',
    difficultyTier: 5,
    ageBand: 'grades_6_8'
  }));
  const expertMs = performance.now() - expertStarted;
  assertPerfectMaze(expert);
  assert.ok(expertMs < 250, `expert maze took ${expertMs.toFixed(2)}ms`);
});
