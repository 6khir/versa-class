'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { ProjectStore } = require('../src/store.cjs');
const {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  SHAPE_RECTANGULAR,
  PAGE_ROLES,
  PAGE_ROLE_VALUES,
  ASSET_IDS,
  DIFFICULTY_PRESETS,
  DIFFICULTY_TIERS,
  AGE_BANDS,
  createMazePageId,
  defaultMazeConfig,
  defaultMazeRender,
  defaultMazeProject,
  validateMazeConfig,
  validateMazePage,
  validateMazeProject,
  validateMazeResult,
  validateMazeSolution,
  validateMazeValidationResult,
  serializeMazeProject,
  parseMazeProject,
  recoverMazeProject,
  migrateMazeProject,
  difficultyPresetByTier
} = require('../src/maze-contract.cjs');
const { setMazeConfig, generateMaze, getMazeProject, ensureMazeProject } = require('../src/maze-service.cjs');

function config(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'project-1', revision: 1 },
    keyword: 'school',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: SHAPE_RECTANGULAR,
    seed: 'seed-1',
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

function page(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'project-1', revision: 1 },
    pageId: 'M01',
    sequenceIndex: 1,
    sequenceTotal: 4,
    pageRole: PAGE_ROLES.MAZE_INTERIOR,
    keyword: 'school',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: SHAPE_RECTANGULAR,
    seed: 'seed-1',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'classroom',
    frameVariantId: 'frame-a',
    framePrompt: 'A simple school frame',
    title: 'Find the apple',
    instruction: 'Trace the path',
    mazePanel: { x: 40, y: 80, width: 520, height: 620 },
    topology: null,
    solution: null,
    generationStatus: 'idle',
    validationResult: null,
    render: defaultMazeRender(),
    ...overrides
  };
}

function project(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'project-1', revision: 1 },
    config: config(),
    pages: [page()],
    ...overrides
  };
}

const rejects = (fn) => assert.throws(fn, { code: 'MAZE_CONTRACT_INVALID' });

test('age and difficulty presets are app-owned with stable numeric tiers', () => {
  assert.deepEqual(Object.values(DIFFICULTY_PRESETS).map((item) => [item.label, item.tier]), [
    ['Very Easy', 1],
    ['Easy', 2],
    ['Medium', 3],
    ['Hard', 4],
    ['Expert', 5]
  ]);
  assert.deepEqual(DIFFICULTY_TIERS, [1, 2, 3, 4, 5]);
  assert.equal(difficultyPresetByTier(4).id, 'hard');
  assert.ok(AGE_BANDS.kindergarten.defaultDifficulty === 'easy');
  assert.deepEqual(PAGE_ROLE_VALUES, ['cover', 'maze_interior', 'answer_key', 'back_cover']);
  assert.deepEqual([...ASSET_IDS], [
    'pencil', 'apple', 'school_bus', 'school', 'bee', 'flower', 'rocket', 'planet'
  ]);
});

test('valid maze types return independent snapshots', () => {
  const input = project();
  const before = structuredClone(input);
  const result = validateMazeProject(input);
  assert.deepEqual(result, before);
  result.pages[0].title = 'Changed';
  assert.deepEqual(input, before);
  assert.equal(validateMazeConfig(config()).shape, SHAPE_RECTANGULAR);
  assert.equal(validateMazePage(page({ pageRole: PAGE_ROLES.COVER })).pageRole, 'cover');
  assert.equal(validateMazeSolution({
    schemaVersion: 1, engineType: 'maze', project: { id: 'project-1', revision: 1 },
    pageId: 'M01', path: []
  }).path.length, 0);
  assert.equal(validateMazeResult({
    schemaVersion: 1, engineType: 'maze', project: { id: 'project-1', revision: 1 },
    pageId: 'M01', topology: null, solution: null, validationResult: null
  }).pageId, 'M01');
  assert.equal(validateMazeValidationResult({
    schemaVersion: 1, valid: true, code: null, messages: []
  }).valid, true);
});

test('v1 contract accepts allowlisted maze shapes and assets', () => {
  rejects(() => validateMazeConfig(config({ shape: 'circle' })));
  rejects(() => validateMazePage(page({ shape: 'blob' })));
  assert.equal(validateMazePage(page({ shape: 'hexagon' })).shape, 'hexagon');
  assert.equal(validateMazeConfig(config({ shape: 'circular' })).shape, 'circular');
  rejects(() => validateMazePage(page({ startAssetId: 'unicorn' })));
  rejects(() => validateMazePage(page({ pageRole: 'interior' })));
  rejects(() => validateMazePage(page({ difficultyTier: 6 })));
  rejects(() => validateMazePage(page({ ageBand: 'toddlers' })));
  rejects(() => validateMazePage(page({ engineType: 'native-text-editable' })));
  rejects(() => validateMazeProject({ ...project(), extra: true }));
  assert.equal(createMazePageId(3), 'M03');
});

test('serialization and parse migrate a missing schema into v1', () => {
  const raw = serializeMazeProject(project());
  const parsed = parseMazeProject(raw, 'project-1');
  assert.deepEqual(parsed, project());
  const migrated = migrateMazeProject({
    project: { id: 'legacy-1', revision: 1 },
    config: { keyword: 'bees', ageBand: 'pre_k', difficultyTier: 1, shape: 'rectangular' }
  }, 'legacy-1');
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.engineType, 'maze');
  assert.equal(migrated.config.keyword, 'bees');
  assert.equal(migrated.config.shape, 'rectangular');
  assert.deepEqual(migrated.pages, []);
  const legacyPage = page({ project: { id: 'legacy-2', revision: 1 } });
  delete legacyPage.topology;
  delete legacyPage.solution;
  delete legacyPage.render;
  const migratedPage = migrateMazeProject({
    schemaVersion: 1,
    engineType: 'maze',
    project: { id: 'legacy-2', revision: 1 },
    config: defaultMazeConfig('legacy-2'),
    pages: [legacyPage]
  }, 'legacy-2');
  assert.equal(migratedPage.pages[0].topology, null);
  assert.equal(migratedPage.pages[0].solution, null);
  assert.deepEqual(migratedPage.pages[0].render, defaultMazeRender());
});

test('corrupted persisted maze projects recover instead of crashing', () => {
  const fromBrokenJson = parseMazeProject('{not-json', 'project-1');
  assert.equal(fromBrokenJson.project.id, 'project-1');
  assert.deepEqual(fromBrokenJson.pages, []);
  assert.equal(fromBrokenJson.config.ageBand, 'kindergarten');

  const recovered = recoverMazeProject({
    schemaVersion: 99,
    engineType: 'maze',
    project: { id: 'legacy-bad', revision: 4 },
    config: { keyword: 'bees', ageBand: 'pre_k', difficultyTier: 1, extra: true },
    pages: [
      page({ project: { id: 'legacy-bad', revision: 4 }, keyword: 'bees' }),
      { pageId: 'broken page', sequenceIndex: 2 },
      { pageId: 'M03' },
      null
    ]
  }, 'legacy-bad');
  assert.equal(recovered.schemaVersion, 1);
  assert.equal(recovered.project.revision, 4);
  assert.equal(recovered.config.keyword, 'bees');
  assert.equal(recovered.config.ageBand, 'pre_k');
  assert.equal(recovered.pages.length, 2);
  assert.equal(recovered.pages[0].pageId, 'M01');
  assert.equal(recovered.pages[1].pageId, 'M02');
  assert.equal(recovered.pages[1].generationStatus, 'idle');

  const fromArray = parseMazeProject([1, 2, 3], 'project-1');
  assert.deepEqual(fromArray.pages, []);
});

test('difficulty presets carry app-owned generation constraints', () => {
  const { resolveMazeGenerationSpec, DEFAULT_MAZE_PANEL, mazeExtent } = require('../src/maze-contract.cjs');
  for (const preset of Object.values(DIFFICULTY_PRESETS)) {
    assert.ok(preset.rows >= 2 && preset.cols >= 2);
    assert.ok(preset.cellSize > preset.wallThickness);
    assert.ok(preset.minSolutionLength >= 2);
    const extent = mazeExtent(preset.rows, preset.cols, preset.cellSize, preset.wallThickness);
    assert.ok(extent.width <= DEFAULT_MAZE_PANEL.width, preset.id);
    assert.ok(extent.height <= DEFAULT_MAZE_PANEL.height, preset.id);
  }
  const spec = resolveMazeGenerationSpec(config({ difficultyTier: 5, ageBand: 'grades_6_8' }));
  assert.equal(spec.rows, DIFFICULTY_PRESETS.expert.rows);
  assert.equal(spec.iconSize, AGE_BANDS.grades_6_8.iconSize);
  assert.equal(AGE_BANDS.pre_k.iconSize, 40);
});

test('maze settings persistence round-trips config and generate persists a validated maze', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-'));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  try {
    store.createProject({
      id: 'project-1',
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
    const seeded = ensureMazeProject(store, 'project-1');
    assert.equal(seeded.project.revision, 1);
    const saved = setMazeConfig(store, 'project-1', {
      keyword: 'rockets',
      ageBand: 'grades_1_2',
      difficultyTier: 3,
      startAssetId: 'rocket',
      endAssetId: 'planet',
      title: 'Space maze'
    });
    assert.equal(saved.project.revision, 2);
    assert.equal(saved.config.keyword, 'rockets');
    assert.equal(saved.config.startAssetId, 'rocket');
    const loaded = getMazeProject(store, 'project-1');
    assert.deepEqual(loaded, saved);
    const generated = await generateMaze(store, 'project-1');
    assert.equal(generated.result.validationResult.valid, true);
    assert.equal(generated.mazeProject.pages[0].generationStatus, 'ready');
    assert.equal(generated.mazeProject.pages[0].pageRole, 'maze_interior');
    assert.ok(generated.result.topology.rows >= 2);
    assert.ok(generated.result.solution.path.length >= 2);
    const persisted = getMazeProject(store, 'project-1');
    assert.deepEqual(persisted.pages[0].topology, generated.result.topology);
    assert.deepEqual(persisted.pages[0].solution, generated.result.solution);
    const again = await generateMaze(store, 'project-1');
    assert.deepEqual(again.result.topology.horizontalWalls, generated.result.topology.horizontalWalls);
    assert.deepEqual(again.result.topology.verticalWalls, generated.result.topology.verticalWalls);
    assert.deepEqual(again.result.topology.entrance, generated.result.topology.entrance);
    assert.deepEqual(again.result.topology.exit, generated.result.topology.exit);
    await assert.rejects(
      () => generateMaze(store, 'project-1', { mazePanel: { x: 0, y: 0, width: 1, height: 1 } }),
      { code: 'MAZE_GENERATION_FAILED' }
    );
    assert.equal(getMazeProject(store, 'project-1').pages[0].generationStatus, 'ready');
    assert.equal(getMazeProject(store, 'project-1').config.keyword, 'rockets');
    assert.deepEqual(defaultMazeProject('fresh-1').pages, []);
    assert.equal(defaultMazeConfig('fresh-1').shape, 'rectangular');
    store.setSetting('mazeProject:project-1', '{not-json');
    const afterCorrupt = getMazeProject(store, 'project-1');
    assert.equal(afterCorrupt.engineType, 'maze');
    assert.equal(afterCorrupt.project.id, 'project-1');
    store.setSetting('mazeProject:project-1', { schemaVersion: 99, pages: 'nope' });
    const afterBadObject = getMazeProject(store, 'project-1');
    assert.equal(afterBadObject.engineType, 'maze');
    assert.deepEqual(afterBadObject.pages, []);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
