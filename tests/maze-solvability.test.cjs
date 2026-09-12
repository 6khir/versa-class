'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  DIFFICULTY_PRESETS,
  AGE_BANDS,
  DEFAULT_MAZE_PANEL
} = require('../src/maze-contract.cjs');
const { SHAPES, ALGORITHMS, planMazePageDesign, PALETTES } = require('../src/maze-design.cjs');
const { generateMazeTopology, openingPassageOpen } = require('../src/maze-generator.cjs');
const { renderMazePageDocuments, contrastRatio } = require('../src/maze-svg.cjs');

function config(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'maze-solve-1', revision: 1 },
    keyword: 'seasonal',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: 'rectangular',
    seed: 'solve-seed',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'seasonal',
    frameVariantId: '',
    framePrompt: '',
    title: 'Solve Maze',
    instruction: 'Find the apple.',
    ...overrides
  };
}

function generate(shape, algorithm, seed) {
  return generateMazeTopology(config({
    seed,
    shape,
    title: shape
  }), {
    mazePanel: DEFAULT_MAZE_PANEL,
    variety: true,
    sequenceIndex: 1,
    sequenceTotal: 8,
    plan: {
      shape,
      lattice: shape === 'hexagon' ? 'hex' : shape === 'radial' ? 'radial' : 'square',
      algorithm,
      braidFactor: 0,
      density: 'standard',
      startBias: 'random',
      wallScale: 1,
      design: {
        revision: 4,
        wallStyle: 'square',
        frameStyle: 'double',
        paletteId: 'classroom',
        cellStyle: 'square'
      }
    }
  });
}

test('every shape and algorithm combo opens start to finish with a traced solution', () => {
  const fingerprints = new Set();
  for (const shape of SHAPES) {
    for (const algorithm of ALGORITHMS) {
      const generated = generate(shape, algorithm, `combo-${shape}-${algorithm}`);
      const topology = generated.result.topology;
      const path = generated.result.solution.path;
      assert.equal(generated.result.validationResult.valid, true, `${shape} ${algorithm}`);
      assert.ok(path.length >= 2, `${shape} ${algorithm} path`);
      assert.equal(path[0].row, topology.entrance.row);
      assert.equal(path[0].col, topology.entrance.col);
      assert.equal(path[path.length - 1].row, topology.exit.row);
      assert.equal(path[path.length - 1].col, topology.exit.col);
      assert.equal(openingPassageOpen(topology, topology.entrance), true, `${shape} ${algorithm} start sealed`);
      assert.equal(openingPassageOpen(topology, topology.exit), true, `${shape} ${algorithm} end sealed`);
      const docs = renderMazePageDocuments({
        result: generated.result,
        mazePanel: DEFAULT_MAZE_PANEL,
        title: shape,
        instruction: 'Find the apple.',
        startAssetId: 'pencil',
        endAssetId: 'apple'
      });
      assert.doesNotMatch(docs.studentSvg, /id="maze-solution"/, `${shape} ${algorithm} student ink`);
      assert.match(docs.solutionSvg, /id="maze-solution"/, `${shape} ${algorithm} solution ink`);
      assert.match(docs.studentSvg, /id="maze-walls"/);
      assert.match(docs.studentSvg, /Find<\/text>[\s\S]*the<\/text>[\s\S]*apple/);
      if (topology.lattice === 'hex') {
        const ink = docs.solutionSvg.match(/id="maze-solution"[^>]* d="([^"]+)"/)?.[1] || '';
        const points = [...ink.matchAll(/[ML]\s*[-\d.]+\s+[-\d.]+/g)];
        assert.ok(points.length > path.length + 2, `${shape} ${algorithm} should pass through hex openings`);
      }
      fingerprints.add(path.map((cell) => `${cell.row},${cell.col}`).join('>'));
    }
  }
  assert.ok(fingerprints.size >= SHAPES.length, 'solution paths should not collapse to one line');
});

test('rotating page designs keep unique palettes and print contrast', () => {
  const palettes = [];
  for (let index = 1; index <= 8; index += 1) {
    const plan = planMazePageDesign({
      keyword: 'bees',
      title: `Bees Maze ${index}`,
      sequenceIndex: index
    });
    palettes.push(plan.design.paletteId);
    const palette = PALETTES[plan.design.paletteId];
    assert.ok(contrastRatio(palette.wall, palette.panelFill) >= 7, plan.design.paletteId);
  }
  assert.ok(new Set(palettes).size >= 4, `expected rotating paper colors, got ${palettes.join(',')}`);
});
