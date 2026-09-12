'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DESIGN_REVISION,
  SHAPES,
  ALGORITHMS,
  planMazePageDesign,
  buildShapeMask,
  activeMaskCount,
  mazePagesLookDiverse,
  pageNeedsDesignRefresh,
  designFingerprint,
  resolvePalette,
  PALETTES
} = require('../src/maze-design.cjs');
const { generateMazeTopology } = require('../src/maze-generator.cjs');
const { renderMazePageDocuments, contrastRatio } = require('../src/maze-svg.cjs');
const {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  SHAPE_RECTANGULAR,
  DIFFICULTY_PRESETS,
  AGE_BANDS,
  DEFAULT_MAZE_PANEL
} = require('../src/maze-contract.cjs');

function config(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'maze-design-1', revision: 1 },
    keyword: 'seasonal',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: SHAPE_RECTANGULAR,
    seed: 'design-seed',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'seasonal',
    frameVariantId: '',
    framePrompt: '',
    title: 'August Maze',
    instruction: 'Find the apple.',
    ...overrides
  };
}

test('seasonal titles rotate shape, algorithm, and palette', () => {
  const august = planMazePageDesign({ title: 'August Maze', keyword: 'seasonal', sequenceIndex: 1 });
  const february = planMazePageDesign({ title: 'February Maze', keyword: 'seasonal', sequenceIndex: 7 });
  const hex = planMazePageDesign({ title: 'September Maze', keyword: 'seasonal', sequenceIndex: 2 });
  assert.equal(august.shape, 'rectangular');
  assert.equal(february.shape, 'heart');
  assert.equal(hex.shape, 'hexagon');
  assert.equal(hex.lattice, 'hex');
  assert.notEqual(august.algorithm, february.algorithm);
  assert.notEqual(august.design.paletteId, february.design.paletteId);
  assert.equal(august.design.revision, DESIGN_REVISION);
  assert.ok(SHAPES.includes(august.shape));
  assert.ok(ALGORITHMS.includes(hex.algorithm));
});

test('shape masks stay connected enough to carve', () => {
  for (const shape of ['circular', 'triangular', 'diamond', 'heart', 'star', 'cross', 'hexagon']) {
    const mask = buildShapeMask(shape, 10, 10);
    assert.ok(activeMaskCount(mask) >= 8, `${shape} mask too small`);
  }
});

test('star mask keeps five points instead of a plus', () => {
  const mask = buildShapeMask('star', 14, 14);
  const has = (r0, r1, c0, c1) => {
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (mask[row][col]) return true;
      }
    }
    return false;
  };
  assert.ok(has(0, 2, 5, 8), 'north point');
  assert.ok(has(3, 7, 0, 2), 'west point');
  assert.ok(has(3, 7, 11, 13), 'east point');
  assert.ok(has(11, 13, 1, 4), 'southwest point');
  assert.ok(has(11, 13, 9, 12), 'southeast point');
});

test('print palettes keep high wall contrast', () => {
  for (const [id, palette] of Object.entries(PALETTES)) {
    assert.ok(contrastRatio(palette.wall, palette.panelFill) >= 7, id);
  }
  assert.equal(resolvePalette('missing').wall, PALETTES.classroom.wall);
});

test('diverse algorithms and lattices produce solvable mazes', () => {
  const recipes = [
    { shape: 'rectangular', algorithm: 'kruskal', seed: 'algo-kruskal' },
    { shape: 'circular', algorithm: 'prim', seed: 'algo-prim' },
    { shape: 'hexagon', algorithm: 'backtracker', seed: 'algo-hex' },
    { shape: 'radial', algorithm: 'kruskal', seed: 'algo-radial' },
    { shape: 'heart', algorithm: 'growing_tree', seed: 'algo-heart' },
    { shape: 'star', algorithm: 'hunt_and_kill', seed: 'algo-star', braidFactor: 0.12 }
  ];
  const pages = [];
  for (const recipe of recipes) {
    const generated = generateMazeTopology(config({
      seed: recipe.seed,
      shape: recipe.shape,
      title: recipe.shape
    }), {
      mazePanel: DEFAULT_MAZE_PANEL,
      plan: {
        shape: recipe.shape,
        lattice: recipe.shape === 'hexagon' ? 'hex' : recipe.shape === 'radial' ? 'radial' : 'square',
        algorithm: recipe.algorithm,
        braidFactor: recipe.braidFactor || 0,
        density: 'standard',
        startBias: 'random',
        wallScale: 1,
        design: {
          revision: DESIGN_REVISION,
          wallStyle: 'square',
          frameStyle: 'plain',
          paletteId: 'classroom',
          cellStyle: recipe.shape === 'hexagon' ? 'hex' : 'square'
        }
      },
      variety: true
    });
    assert.equal(generated.result.validationResult.valid, true, recipe.seed);
    assert.ok(generated.result.solution.path.length >= 2, recipe.seed);
    assert.equal(generated.result.topology.algorithm, recipe.algorithm);
    const docs = renderMazePageDocuments({
      result: generated.result,
      mazePanel: DEFAULT_MAZE_PANEL,
      title: recipe.shape,
      instruction: 'Find the apple.',
      startAssetId: 'pencil',
      endAssetId: 'apple'
    });
    assert.match(docs.studentSvg, new RegExp(`data-maze-shape="${recipe.shape}"`));
    assert.match(docs.studentSvg, /id="maze-walls"/);
    assert.doesNotMatch(docs.studentSvg, /id="maze-solution"/);
    pages.push({ topology: generated.result.topology, generationStatus: 'ready' });
  }
  assert.equal(mazePagesLookDiverse(pages), true);
  assert.ok(new Set(pages.map((page) => designFingerprint(page.topology))).size === pages.length);
});

test('old ready pages without a design revision need a refresh', () => {
  assert.equal(pageNeedsDesignRefresh({ generationStatus: 'ready', topology: { design: { revision: DESIGN_REVISION } } }), false);
  assert.equal(pageNeedsDesignRefresh({ generationStatus: 'ready', topology: { design: { revision: 1 } } }), true);
  assert.equal(pageNeedsDesignRefresh({ generationStatus: 'ready', topology: {} }), true);
});
