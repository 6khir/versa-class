'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');

const {
  MAX_MAZE_REMOTE_IN_FLIGHT,
  artworkCacheKey,
  directMazeTheme,
  ensureMazeFrame,
  ensureMazeFrames,
  loadArtworkIndex
} = require('../src/maze-artwork.cjs');
const { buildMazeFrameImagePrompt, mapMazeThemeResponse } = require('../src/maze-prompts.cjs');
const { generateMazeTopology } = require('../src/maze-generator.cjs');
const { AGE_BANDS, DIFFICULTY_PRESETS } = require('../src/maze-contract.cjs');

function memoryStore(outputDir, projectId = 'maze-art-1') {
  const settings = new Map();
  return {
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value),
    getProject: () => ({ id: projectId, outputDir, productFormat: 'maze' })
  };
}

async function solidPng(r = 40, g = 80, b = 160) {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r, g, b } }
  }).png().toBuffer();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('theme direction maps Gemini JSON through local age and difficulty presets', async () => {
  const directed = await directMazeTheme({
    generateText: async () => JSON.stringify({
      themeId: 'rockets',
      ageIntent: 'grades_6_8',
      difficultyIntent: 'hard',
      startAssetId: 'rocket',
      endAssetId: 'planet',
      framePrompt: 'Starry edge decoration only.',
      extra: 'ignore me',
      rows: 40
    })
  }, { keyword: 'space' });
  assert.equal(directed.fallback, false);
  assert.equal(directed.ageBand, AGE_BANDS.grades_6_8.id);
  assert.equal(directed.difficultyTier, DIFFICULTY_PRESETS.hard.tier);
  assert.equal(directed.difficultyId, 'hard');
  const maze = generateMazeTopology({
    schemaVersion: 1,
    engineType: 'maze',
    project: { id: 'maze-art-1', revision: 1 },
    keyword: 'space',
    ageBand: directed.ageBand,
    difficultyTier: directed.difficultyTier,
    shape: 'rectangular',
    seed: 'art-seed-1',
    startAssetId: directed.startAssetId,
    endAssetId: directed.endAssetId,
    themeId: directed.themeId,
    frameVariantId: directed.frameVariantId,
    framePrompt: directed.framePrompt,
    title: '',
    instruction: ''
  }, { pageId: 'M01' });
  assert.equal(maze.result.topology.rows, DIFFICULTY_PRESETS.hard.rows);
  assert.equal(maze.result.validationResult.valid, true);
});

test('frame cache is keyed by theme, page role, and variant', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-art-cache-'));
  const store = memoryStore(root);
  let imageCalls = 0;
  const provider = {
    generateImage: async () => {
      imageCalls += 1;
      return solidPng();
    }
  };
  const spec = {
    themeId: 'classroom',
    pageRole: 'maze_interior',
    frameVariantId: 'edge-a',
    framePrompt: 'Pencil doodles near the outer edges.'
  };
  const first = await ensureMazeFrame(store, 'maze-art-1', spec, {
    provider,
    retryDelayMs: 1,
    remoteAttempts: 1
  });
  const second = await ensureMazeFrame(store, 'maze-art-1', spec, {
    provider,
    retryDelayMs: 1,
    remoteAttempts: 1
  });
  assert.equal(imageCalls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.path, second.path);
  assert.ok(existsSync(first.path));
  assert.equal(artworkCacheKey(spec), 'classroom:maze_interior:edge-a');
  const index = loadArtworkIndex(store, 'maze-art-1');
  assert.equal(index.entries['classroom:maze_interior:edge-a'].path, first.path);

  const other = await ensureMazeFrame(store, 'maze-art-1', {
    ...spec,
    pageRole: 'cover',
    frameVariantId: 'edge-b'
  }, { provider, retryDelayMs: 1, remoteAttempts: 1 });
  assert.equal(imageCalls, 2);
  assert.notEqual(other.path, first.path);
  rmSync(root, { recursive: true, force: true });
});

test('out-of-order frame completion is stored by sequenceIndex', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-art-order-'));
  const store = memoryStore(root);
  const finished = [];
  const provider = {
    generateImage: async (prompt) => {
      const slow = /edge-c/.test(prompt) ? 5 : 25;
      await delay(slow);
      finished.push(prompt);
      return solidPng();
    }
  };
  const { pages } = await ensureMazeFrames(store, 'maze-art-1', [
    { sequenceIndex: 3, pageId: 'M03', themeId: 'ocean', pageRole: 'back_cover', frameVariantId: 'edge-c' },
    { sequenceIndex: 1, pageId: 'M01', themeId: 'ocean', pageRole: 'cover', frameVariantId: 'edge-a' },
    { sequenceIndex: 2, pageId: 'M02', themeId: 'ocean', pageRole: 'maze_interior', frameVariantId: 'edge-b' }
  ], { provider, retryDelayMs: 1, remoteAttempts: 1 });
  assert.deepEqual(pages.map((page) => page.sequenceIndex), [1, 2, 3]);
  assert.deepEqual(pages.map((page) => page.pageId), ['M01', 'M02', 'M03']);
  assert.ok(finished.length >= 1);
  rmSync(root, { recursive: true, force: true });
});

test('at most two maze remote frame requests are in flight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-art-cap-'));
  const store = memoryStore(root);
  let live = 0;
  let peak = 0;
  const provider = {
    generateImage: async () => {
      live += 1;
      peak = Math.max(peak, live);
      await delay(40);
      live -= 1;
      return solidPng();
    }
  };
  const pages = [
    { sequenceIndex: 1, themeId: 'bees', pageRole: 'cover', frameVariantId: 'edge-a' },
    { sequenceIndex: 2, themeId: 'bees', pageRole: 'maze_interior', frameVariantId: 'edge-a' },
    { sequenceIndex: 3, themeId: 'bees', pageRole: 'maze_interior', frameVariantId: 'edge-b' },
    { sequenceIndex: 4, themeId: 'bees', pageRole: 'answer_key', frameVariantId: 'edge-b' },
    { sequenceIndex: 5, themeId: 'space', pageRole: 'cover', frameVariantId: 'edge-a' }
  ];
  const result = await ensureMazeFrames(store, 'maze-art-1', pages, {
    provider,
    retryDelayMs: 1,
    remoteAttempts: 1
  });
  assert.equal(MAX_MAZE_REMOTE_IN_FLIGHT, 2);
  assert.ok(peak <= 2, `peak remote in flight was ${peak}`);
  assert.ok(result.peak <= 2, `reported peak was ${result.peak}`);
  assert.equal(result.pages.length, 5);
  rmSync(root, { recursive: true, force: true });
});

test('invalid Gemini configuration falls back without touching maze math', async () => {
  const missing = await directMazeTheme(null, { keyword: 'school' });
  assert.equal(missing.fallback, true);
  assert.equal(missing.reason, 'provider_missing');
  const invalid = await directMazeTheme({ generateText: 'not-a-function' }, { keyword: 'bees' });
  assert.equal(invalid.fallback, true);
  assert.equal(invalid.reason, 'provider_missing');
  const maze = generateMazeTopology({
    schemaVersion: 1,
    engineType: 'maze',
    project: { id: 'maze-art-1', revision: 1 },
    keyword: 'school',
    ageBand: 'kindergarten',
    difficultyTier: 2,
    shape: 'rectangular',
    seed: 'invalid-gemini-still-local',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'classroom',
    frameVariantId: 'edge-a',
    framePrompt: '',
    title: '',
    instruction: ''
  }, { pageId: 'M01' });
  assert.equal(maze.result.validationResult.valid, true);
});

test('unsafe frame payloads and provider errors fall back without crashing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-art-fail-'));
  const store = memoryStore(root);
  const failed = await ensureMazeFrame(store, 'maze-art-1', {
    themeId: 'classroom',
    pageRole: 'maze_interior',
    frameVariantId: 'edge-a'
  }, {
    provider: {
      generateImage: async () => {
        throw Object.assign(new Error('Gemini unavailable'), { code: 'PROVIDER_ERROR', retryable: true });
      }
    },
    retryDelayMs: 1,
    remoteAttempts: 2
  });
  assert.equal(failed.fallback, true);
  assert.equal(failed.path, null);

  const svg = await ensureMazeFrame(store, 'maze-art-1', {
    themeId: 'classroom',
    pageRole: 'cover',
    frameVariantId: 'edge-a'
  }, {
    provider: {
      generateImage: async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>Hi</text></svg>'
    },
    retryDelayMs: 1,
    remoteAttempts: 1
  });
  assert.equal(svg.fallback, true);

  const mapped = mapMazeThemeResponse('```json\n{"themeId":');
  assert.equal(mapped.fallback, true);
  const maze = generateMazeTopology({
    schemaVersion: 1,
    engineType: 'maze',
    project: { id: 'maze-art-1', revision: 1 },
    keyword: 'school',
    ageBand: 'kindergarten',
    difficultyTier: 2,
    shape: 'rectangular',
    seed: 'still-local',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'classroom',
    frameVariantId: 'edge-a',
    framePrompt: buildMazeFrameImagePrompt({ themeId: 'classroom' }),
    title: '',
    instruction: ''
  }, { pageId: 'M01' });
  assert.equal(maze.result.validationResult.valid, true);
  rmSync(root, { recursive: true, force: true });
});
