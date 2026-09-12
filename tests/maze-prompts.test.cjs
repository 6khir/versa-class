'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { ProjectStore } = require('../src/store.cjs');
const {
  AGE_BANDS,
  ASSET_IDS,
  DIFFICULTY_PRESETS,
  resolveMazeGenerationSpec
} = require('../src/maze-contract.cjs');
const { generateMazeTopology } = require('../src/maze-generator.cjs');
const { generateMaze } = require('../src/maze-service.cjs');
const {
  DEFAULT_END_ASSET_ID,
  DEFAULT_START_ASSET_ID,
  FORBIDDEN_THEME_KEYS,
  applyMazePagePlan,
  buildMazeFrameImagePrompt,
  buildMazeThemePrompt,
  fallbackMazeTheme,
  mapMazeThemeResponse,
  mazeConfigPatchFromTheme,
  parseMazeThemeJson,
  sanitizeFramePrompt,
  stripFramePromptText
} = require('../src/maze-prompts.cjs');

function baseConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    engineType: 'maze',
    project: { id: 'maze-theme-1', revision: 1 },
    keyword: 'school',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: 'rectangular',
    seed: 'theme-seed-1',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: '',
    frameVariantId: '',
    framePrompt: '',
    title: '',
    instruction: '',
    ...overrides
  };
}

test('malformed JSON falls back without throwing', () => {
  assert.throws(() => parseMazeThemeJson('not-json'), { code: 'MAZE_THEME_JSON_INVALID' });
  assert.throws(() => parseMazeThemeJson('```json\n{broken'), { code: 'MAZE_THEME_JSON_INVALID' });
  const mapped = mapMazeThemeResponse('Gemini said sure', { keyword: 'bees', ageBand: 'pre_k' });
  assert.equal(mapped.fallback, true);
  assert.equal(mapped.reason, 'malformed_json');
  assert.equal(mapped.ageBand, 'pre_k');
  assert.equal(mapped.themeId, 'bees');
  const maze = generateMazeTopology(baseConfig(mazeConfigPatchFromTheme(mapped)), { pageId: 'M01' });
  assert.equal(maze.result.validationResult.valid, true);
});

test('unknown asset IDs map to allowlisted defaults', () => {
  const mapped = mapMazeThemeResponse({
    themeId: 'garden',
    ageIntent: 'pre_k',
    difficultyIntent: 'very_easy',
    startAssetId: 'unicorn',
    endAssetId: 'https://evil.example/flower.svg',
    pages: [{ sequenceIndex: 1, startAssetId: 'dragon', endAssetId: 'portal' }]
  });
  assert.equal(mapped.startAssetId, DEFAULT_START_ASSET_ID);
  assert.equal(mapped.endAssetId, DEFAULT_END_ASSET_ID);
  assert.equal(mapped.pages[0].startAssetId, DEFAULT_START_ASSET_ID);
  assert.equal(mapped.pages[0].endAssetId, DEFAULT_END_ASSET_ID);
  assert.ok(ASSET_IDS.includes(mapped.startAssetId));
  assert.ok(ASSET_IDS.includes(mapped.endAssetId));
});

test('unsafe numeric maze values and extra fields are ignored', () => {
  const mapped = mapMazeThemeResponse({
    themeId: 'space',
    ageIntent: 'kindergarten',
    difficultyIntent: 'easy',
    startAssetId: 'rocket',
    endAssetId: 'planet',
    rows: 99,
    cols: 2,
    seed: 'ai-owned-seed',
    difficultyTier: 5,
    cellSize: 9,
    wallThickness: 99,
    mazePanel: { x: 0, y: 0, width: 10, height: 10 },
    topology: { rows: 20, horizontalWalls: [[true]] },
    extra: 'nope',
    secret: 1
  }, baseConfig());
  assert.equal(mapped.fallback, false);
  assert.equal(mapped.difficultyTier, DIFFICULTY_PRESETS.easy.tier);
  assert.equal(mapped.startAssetId, 'rocket');
  for (const key of FORBIDDEN_THEME_KEYS) {
    if (key === 'difficultyTier') continue;
    assert.equal(Object.hasOwn(mapped, key), false, key);
  }
  assert.equal(Object.hasOwn(mapped, 'rows'), false);
  assert.equal(Object.hasOwn(mapped, 'seed'), false);
  assert.equal(Object.hasOwn(mapped, 'extra'), false);
  assert.equal(Object.hasOwn(mapped, 'topology'), false);

  const spec = resolveMazeGenerationSpec(baseConfig({
    ...mazeConfigPatchFromTheme(mapped),
    seed: 'theme-seed-1'
  }), mapped);
  assert.equal(spec.rows, DIFFICULTY_PRESETS.easy.rows);
  assert.equal(spec.cols, DIFFICULTY_PRESETS.easy.cols);
  assert.notEqual(spec.rows, 99);
  const maze = generateMazeTopology(baseConfig({
    ...mazeConfigPatchFromTheme(mapped),
    seed: 'theme-seed-1'
  }), { pageId: 'M01' });
  assert.equal(maze.result.topology.rows, DIFFICULTY_PRESETS.easy.rows);
  assert.equal(maze.result.validationResult.valid, true);
});

test('numeric age or difficulty intents do not select maze parameters', () => {
  const mapped = mapMazeThemeResponse({
    themeId: 'school',
    ageIntent: '5',
    difficultyIntent: '5',
    startAssetId: 'pencil'
  });
  assert.equal(mapped.ageBand, AGE_BANDS.kindergarten.id);
  assert.equal(mapped.difficultyId, AGE_BANDS.kindergarten.defaultDifficulty);
  assert.equal(mapped.difficultyTier, DIFFICULTY_PRESETS.easy.tier);
});

test('text in frame prompts is stripped or rejected', () => {
  const stripped = stripFramePromptText(
    'Soft floral corners. Add letters, numbers, and the word "Hello".'
  );
  assert.doesNotMatch(stripped, /letters|numbers|Hello/i);
  assert.match(stripped, /floral/i);

  const rejected = sanitizeFramePrompt('Put the school logo, page numbers, and a watermark on the border.');
  assert.equal(rejected.rejected, true);
  assert.doesNotMatch(rejected.prompt, /Put the school logo|page numbers|watermark/i);
  assert.match(rejected.prompt, /outer edges/i);

  const prompt = buildMazeFrameImagePrompt({
    themeId: 'space',
    frameVariantId: 'edge-a',
    framePrompt: 'Draw ABC 123 labels and a signature in the maze.'
  });
  assert.match(prompt, /Do not draw letters, numbers, labels, logos/);
  assert.doesNotMatch(prompt, /ABC|Draw ABC 123|a signature in the maze/i);
  assert.match(prompt, /Do not draw maze lines/);
});

test('theme prompt never sends maze mathematics', () => {
  const prompt = buildMazeThemePrompt({
    keyword: 'rockets',
    ageBand: 'grades_1_2',
    difficultyTier: 3,
    seed: 'secret-seed',
    topology: { rows: 12, horizontalWalls: [[true, false]], verticalWalls: [] },
    rows: 12,
    cols: 12
  });
  assert.match(prompt, /Age intent/);
  assert.match(prompt, /Difficulty intent/);
  assert.match(prompt, /Allowlisted start\/end asset IDs/);
  assert.doesNotMatch(prompt, /horizontalWalls|verticalWalls|secret-seed/);
  assert.doesNotMatch(prompt, /"rows"|"cols"|cellSize|12 × 12/);
  assert.doesNotMatch(prompt, /EDITABLE|01A|01T/);
});

test('Gemini page plans are ordered by sequenceIndex', () => {
  const mapped = mapMazeThemeResponse({
    themeId: 'ocean',
    ageIntent: 'grades_3_5',
    difficultyIntent: 'medium',
    startAssetId: 'bee',
    endAssetId: 'flower',
    pages: [
      { sequenceIndex: 3, pageRole: 'back_cover', title: 'Thanks' },
      { sequenceIndex: 1, pageRole: 'cover', title: 'Cover' },
      { sequenceIndex: 2, pageRole: 'maze_interior', title: 'Maze' }
    ]
  });
  assert.deepEqual(mapped.pages.map((page) => page.sequenceIndex), [1, 2, 3]);
  assert.deepEqual(mapped.pages.map((page) => page.title), ['Cover', 'Maze', 'Thanks']);
  const applied = applyMazePagePlan([
    { sequenceIndex: 2, pageId: 'M02', title: 'old-2', startAssetId: 'pencil', endAssetId: 'apple' },
    { sequenceIndex: 1, pageId: 'M01', title: 'old-1', startAssetId: 'pencil', endAssetId: 'apple' }
  ], mapped.pages, mapped.themeId);
  assert.deepEqual(applied.map((page) => page.pageId), ['M01', 'M02']);
  assert.equal(applied[0].title, 'Cover');
});

test('provider failures fall back and the local maze stays valid', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-theme-'));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  try {
    store.createProject({
      id: 'maze-theme-1',
      name: 'Maze Book',
      theme: 'School',
      niche: 'Mazes',
      format: 'A4',
      orientation: 'portrait',
      style: 'flat',
      activityCount: 2,
      outputDir: root,
      productFormat: 'maze'
    });
    const fallback = fallbackMazeTheme({ keyword: 'school' }, 'provider_failed');
    const generated = await generateMaze(store, 'maze-theme-1', {
      config: { seed: 'fallback-seed-1', ...mazeConfigPatchFromTheme(fallback) },
      themeDirection: 'not-json',
      provider: {
        generateText: async () => {
          throw Object.assign(new Error('Gemini quota'), { code: 'PROVIDER_ERROR', retryable: true });
        },
        generateImage: async () => {
          throw Object.assign(new Error('Gemini image failed'), { code: 'PROVIDER_ERROR', retryable: true });
        }
      },
      directTheme: true,
      retryDelayMs: 1,
      remoteAttempts: 2
    });
    assert.equal(generated.result.validationResult.valid, true);
    assert.ok(generated.result.topology.rows >= 2);
    assert.ok(generated.result.solution.path.length >= 2);
    assert.equal(generated.mazeProject.pages[0].generationStatus, 'ready');
    assert.equal(generated.mazeProject.pages[0].render.frameImagePath, null);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
