'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');

const { ProjectStore } = require('../src/store.cjs');
const {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  SHAPE_RECTANGULAR,
  DIFFICULTY_PRESETS,
  AGE_BANDS,
  ASSET_IDS,
  DEFAULT_MAZE_PANEL,
  defaultMazeRender,
  validateMazePage
} = require('../src/maze-contract.cjs');
const { generateMazeTopology } = require('../src/maze-generator.cjs');
const { generateMaze } = require('../src/maze-service.cjs');
const {
  ALLOWED_ASSET_IDS,
  ASSET_DIR,
  DEFAULT_ASSET_ID,
  loadMazeAsset,
  mazeAssetPath,
  resolveMazeAssetId
} = require('../src/maze-assets.cjs');
const {
  MAZE_RENDER_COLORS,
  buildMazeRenderLayout,
  contrastRatio,
  fitMazeHeading,
  iconsObstructPassages,
  normalizePageFormat,
  relativeLuminance,
  renderMazePageDocuments,
  resolveMazePageSetup
} = require('../src/maze-svg.cjs');
const { cardPreviewPathFor, pageImageAsPngBuffer } = require('../src/file-manager.cjs');

const FIXTURE_DIR = join(__dirname, 'fixtures', 'maze');

function config(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: 'maze-svg-1', revision: 1 },
    keyword: 'school',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: SHAPE_RECTANGULAR,
    seed: 'svg-easy-1',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: 'classroom',
    frameVariantId: 'frame-a',
    framePrompt: '',
    title: 'Find the apple',
    instruction: 'Trace the path from the pencil to the apple.',
    ...overrides
  };
}

function generate(overrides = {}, options = {}) {
  return generateMazeTopology(config(overrides), { mazePanel: DEFAULT_MAZE_PANEL, ...options });
}

function documentsFor(generated, extra = {}) {
  return renderMazePageDocuments({
    result: generated.result,
    format: 'A4',
    orientation: 'portrait',
    mazePanel: DEFAULT_MAZE_PANEL,
    title: extra.title ?? 'Find the apple',
    instruction: extra.instruction ?? 'Trace the path from the pencil to the apple.',
    startAssetId: extra.startAssetId ?? 'pencil',
    endAssetId: extra.endAssetId ?? 'apple',
    ...extra
  });
}

function writeFixture(name, contents) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const filePath = join(FIXTURE_DIR, name);
  writeFileSync(filePath, contents);
  return filePath;
}

function parseNumbers(svg, pattern) {
  return [...String(svg).matchAll(pattern)].flatMap((match) => (
    match.slice(1).map((value) => Number(value))
  ));
}

function allFinite(values) {
  return values.every((value) => Number.isFinite(value));
}

function collectSvgPoints(svg) {
  const points = [];
  for (const match of String(svg).matchAll(/\b(?:x|y|cx|cy|width|height|x1|y1|x2|y2)="(-?\d+(?:\.\d+)?)"/g)) {
    points.push(Number(match[1]));
  }
  for (const match of String(svg).matchAll(/[ML]\s(-?\d+(?:\.\d+)?)\s(-?\d+(?:\.\d+)?)/g)) {
    points.push(Number(match[1]), Number(match[2]));
  }
  return points;
}

function panelFromSvg(svg) {
  const match = String(svg).match(
    /id="maze-panel"[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"/
  );
  assert.ok(match, 'maze-panel rect is missing');
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4])
  };
}

async function samplePixel(png, x, y) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Math.max(0, Math.min(info.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(info.height - 1, Math.round(y)));
  const index = (py * info.width + px) * info.channels;
  return { r: data[index], g: data[index + 1], b: data[index + 2], width: info.width, height: info.height };
}

function luminanceRgb(r, g, b) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

test('allowlisted maze icons stay local and unknown IDs use the marker', () => {
  assert.deepEqual([...ASSET_IDS], [
    'pencil', 'apple', 'school_bus', 'school', 'bee', 'flower', 'rocket', 'planet'
  ]);
  for (const id of ASSET_IDS) {
    assert.equal(resolveMazeAssetId(id), id);
    assert.ok(existsSync(mazeAssetPath(id)), id);
    const asset = loadMazeAsset(id);
    assert.equal(asset.id, id);
    assert.ok(asset.inner.includes('<'), id);
    assert.doesNotMatch(asset.inner, /https?:\/\//);
    assert.ok(asset.path.startsWith(ASSET_DIR));
  }
  assert.equal(resolveMazeAssetId('unicorn'), DEFAULT_ASSET_ID);
  assert.equal(loadMazeAsset('https://evil.example/maze.svg').id, DEFAULT_ASSET_ID);
  assert.ok(ALLOWED_ASSET_IDS.includes(DEFAULT_ASSET_ID));
});

test('easy and expert student/solution SVGs stay deterministic and separated', async () => {
  const easy = generate({ seed: 'svg-easy-1', difficultyTier: 2 });
  const expert = generate({
    seed: 'svg-expert-1',
    difficultyTier: 5,
    ageBand: 'grades_6_8',
    startAssetId: 'rocket',
    endAssetId: 'planet',
    title: 'Space maze',
    instruction: 'Find the planet.'
  });

  const easyDocs = documentsFor(easy);
  const expertDocs = documentsFor(expert, {
    startAssetId: 'rocket',
    endAssetId: 'planet',
    title: 'Space maze',
    instruction: 'Find the planet.'
  });
  const easyAgain = documentsFor(easy);

  assert.equal(easyDocs.studentSvg, easyAgain.studentSvg);
  assert.equal(easyDocs.solutionSvg, easyAgain.solutionSvg);
  assert.notEqual(easyDocs.studentSvg, easyDocs.solutionSvg);
  assert.notEqual(expertDocs.studentSvg, expertDocs.solutionSvg);

  writeFixture('easy-student.svg', easyDocs.studentSvg);
  writeFixture('easy-solution.svg', easyDocs.solutionSvg);
  writeFixture('expert-student.svg', expertDocs.studentSvg);
  writeFixture('expert-solution.svg', expertDocs.solutionSvg);
  writeFixture('easy-solution.png', await pageImageAsPngBuffer(join(FIXTURE_DIR, 'easy-solution.svg')));
  writeFixture('easy-preview.png', await pageImageAsPngBuffer(join(FIXTURE_DIR, 'easy-student.svg')));
  writeFixture('expert-preview.png', await pageImageAsPngBuffer(join(FIXTURE_DIR, 'expert-student.svg')));

  const easyStudent = readFileSync(join(FIXTURE_DIR, 'easy-student.svg'), 'utf8');
  const easySolution = readFileSync(join(FIXTURE_DIR, 'easy-solution.svg'), 'utf8');
  const expertStudent = readFileSync(join(FIXTURE_DIR, 'expert-student.svg'), 'utf8');
  const expertSolution = readFileSync(join(FIXTURE_DIR, 'expert-solution.svg'), 'utf8');

  assert.equal(easyStudent, easyDocs.studentSvg);
  assert.match(easyStudent, /data-maze-variant="student"/);
  assert.match(easySolution, /data-maze-variant="solution"/);
  assert.match(easyStudent, /id="maze-walls"/);
  assert.doesNotMatch(easyStudent, /id="maze-solution"/);
  assert.doesNotMatch(easyStudent, new RegExp(MAZE_RENDER_COLORS.solution, 'i'));
  assert.doesNotMatch(expertStudent, /id="maze-solution"/);
  assert.doesNotMatch(expertStudent, new RegExp(MAZE_RENDER_COLORS.solution, 'i'));
  assert.match(easySolution, /id="maze-solution"/);
  assert.match(easySolution, new RegExp(MAZE_RENDER_COLORS.solution, 'i'));
  assert.match(easySolution, /stroke-linecap="round"/);
  assert.match(easyStudent, /stroke-linecap="square"/);
  assert.match(easyStudent, /id="maze-title"/);
  assert.match(easyStudent, /Find<\/text>[\s\S]*the<\/text>[\s\S]*apple/);
  assert.equal(fitMazeHeading('Find the apple'), 'Find the apple');
  assert.equal(
    fitMazeHeading('Year-Long Word Search and Maze Puzzle Adventure BUNDLE maze'),
    'Year-Long Word Search and Maze Puzz…'
  );
  assert.match(easyStudent, /id="maze-instruction"/);
  assert.doesNotMatch(easyStudent.split('id="maze-walls"')[1], /Find the apple/);
  assert.match(expertStudent, /data-asset="rocket"/);
  assert.match(expertStudent, /data-asset="planet"/);
  assert.ok(expertStudent.length > 1000);
  assert.ok(expertSolution.includes('id="maze-solution"'));
});

test('coordinates stay finite and inside the page and panel', () => {
  const generated = generate({ seed: 'svg-bounds-1' });
  const docs = documentsFor(generated);
  const page = docs.layout.pageBox;
  const panel = docs.layout.panel;
  const svgPanel = panelFromSvg(docs.studentSvg);
  assert.deepEqual(svgPanel, {
    x: Number(panel.x.toFixed(3)),
    y: Number(panel.y.toFixed(3)),
    width: Number(panel.width.toFixed(3)),
    height: Number(panel.height.toFixed(3))
  });

  const values = collectSvgPoints(docs.studentSvg);
  assert.ok(values.length > 20);
  assert.ok(allFinite(values));
  for (const icon of docs.layout.icons) {
    assert.equal(iconsObstructPassages(docs.layout), false);
    assert.ok(icon.x >= panel.x - 0.05);
    assert.ok(icon.y >= panel.y - 0.05);
    assert.ok(icon.x + icon.width <= panel.x + panel.width + 0.05);
    assert.ok(icon.y + icon.height <= panel.y + panel.height + 0.05);
  }
  for (const cell of docs.layout.cells) {
    assert.ok(cell.x >= panel.x - 0.05);
    assert.ok(cell.y >= panel.y - 0.05);
    assert.ok(cell.x + cell.width <= panel.x + panel.width + 0.05);
    assert.ok(cell.y + cell.height <= panel.y + panel.height + 0.05);
  }
  assert.ok(docs.layout.mazeBox.x >= panel.x - 0.05);
  assert.ok(docs.layout.mazeBox.y >= panel.y - 0.05);
  assert.ok(page.width > panel.width);
  assert.ok(page.height > panel.height);
  assert.equal(docs.layout.icons.length, 2);
});

test('invalid coordinates and icon obstruction are rejected', () => {
  const generated = generate({ seed: 'svg-invalid-1' });
  assert.throws(
    () => buildMazeRenderLayout({
      topology: generated.result.topology,
      solution: generated.result.solution,
      mazePanel: { x: Number.NaN, y: 80, width: 520, height: 620 }
    }),
    { code: 'MAZE_RENDER_INVALID' }
  );
  assert.throws(
    () => buildMazeRenderLayout({
      topology: generated.result.topology,
      solution: generated.result.solution,
      mazePanel: { x: -40, y: 80, width: 520, height: 620 }
    }),
    { code: 'MAZE_RENDER_INVALID' }
  );
  assert.throws(
    () => buildMazeRenderLayout({
      topology: { ...generated.result.topology, cellSize: Infinity },
      solution: generated.result.solution,
      mazePanel: DEFAULT_MAZE_PANEL
    }),
    { code: 'MAZE_RENDER_INVALID' }
  );
  assert.throws(
    () => buildMazeRenderLayout({
      topology: generated.result.topology,
      solution: { ...generated.result.solution, path: [{ row: Number.NaN, col: 0 }] },
      mazePanel: DEFAULT_MAZE_PANEL
    }),
    { code: 'MAZE_RENDER_INVALID' }
  );

  const docs = documentsFor(generated);
  const home = docs.layout.topology.entrance;
  const blockedCell = docs.layout.cells.find((cell) => (
    !(cell.row === home.row && cell.col === home.col)
  ));
  const overlapping = {
    ...docs.layout,
    icons: [{ ...docs.layout.icons[0], x: blockedCell.x, y: blockedCell.y }]
  };
  assert.equal(iconsObstructPassages(docs.layout), false);
  assert.equal(iconsObstructPassages(overlapping), true);
});

test('the pale panel covers the decorative frame exactly on mazePanel', () => {
  for (const format of ['A4', 'LETTER', 'SQUARE']) {
    const generated = generate({ seed: 'svg-panel-1' });
    const docs = documentsFor(generated, { format });
    const svg = docs.studentSvg;
    const panel = panelFromSvg(svg);
    assert.deepEqual(panel, {
      x: Number(docs.layout.panel.x.toFixed(3)),
      y: Number(docs.layout.panel.y.toFixed(3)),
      width: Number(docs.layout.panel.width.toFixed(3)),
      height: Number(docs.layout.panel.height.toFixed(3))
    });
    assert.deepEqual(panel, DEFAULT_MAZE_PANEL);
    assert.equal(normalizePageFormat(format.toLowerCase()), format);
    assert.match(svg, /id="maze-frame"/);
    assert.match(svg, /data-slot="decorative-background"/);
    const frameIndex = svg.indexOf('id="maze-frame"');
    const panelIndex = svg.indexOf('id="maze-panel"');
    assert.ok(frameIndex < panelIndex, 'panel must paint over the placeholder frame');
    assert.match(svg, new RegExp(`data-page-format="${format}"`));
    writeFixture(`${format.toLowerCase()}-student.svg`, svg);
  }
});

test('walls stay dark on a pale panel in SVG and PNG', async () => {
  const generated = generate({ seed: 'svg-contrast-1' });
  const docs = documentsFor(generated);
  const wallLum = relativeLuminance(MAZE_RENDER_COLORS.wall);
  const panelLum = relativeLuminance(MAZE_RENDER_COLORS.panelFill);
  assert.ok(panelLum > 0.85, `panel luminance ${panelLum}`);
  assert.ok(wallLum < 0.15, `wall luminance ${wallLum}`);
  assert.ok(contrastRatio(MAZE_RENDER_COLORS.wall, MAZE_RENDER_COLORS.panelFill) >= 7);

  const studentPath = writeFixture('contrast-student.svg', docs.studentSvg);
  const png = await pageImageAsPngBuffer(studentPath);
  const previewPath = writeFixture('contrast-preview.png', png);
  const preview = readFileSync(previewPath);
  assert.ok(preview.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

  const meta = await sharp(preview).metadata();
  const scaleX = meta.width / docs.layout.page.width;
  const scaleY = meta.height / docs.layout.page.height;
  const pad = await samplePixel(preview, (docs.layout.panel.x + 6) * scaleX, (docs.layout.panel.y + 6) * scaleY);
  const wall = docs.layout.walls[0];
  const wallPixel = await samplePixel(preview, ((wall.x1 + wall.x2) / 2) * scaleX, ((wall.y1 + wall.y2) / 2) * scaleY);
  assert.ok(luminanceRgb(pad.r, pad.g, pad.b) > 0.8, `panel pixel ${JSON.stringify(pad)}`);
  assert.ok(luminanceRgb(wallPixel.r, wallPixel.g, wallPixel.b) < 0.35, `wall pixel ${JSON.stringify(wallPixel)}`);
});

test('generateMaze stores student, solution, and preview paths in the project folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-svg-'));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  try {
    store.createProject({
      id: 'maze-svg-1',
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
    const generated = await generateMaze(store, 'maze-svg-1', {
      config: { seed: 'svg-persist-1', title: 'Find the apple', instruction: 'Stay on the path.' }
    });
    const page = generated.mazeProject.pages[0];
    assert.ok(page.render.studentSvgPath.startsWith(join(root, 'maze')));
    assert.ok(page.render.solutionSvgPath.startsWith(join(root, 'maze')));
    assert.ok(page.render.pngPreviewPath.startsWith(join(root, 'maze')));
    assert.ok(existsSync(page.render.studentSvgPath));
    assert.ok(existsSync(page.render.solutionSvgPath));
    assert.ok(existsSync(page.render.pngPreviewPath));
    assert.ok(existsSync(cardPreviewPathFor(page.render.pngPreviewPath)));
    const student = readFileSync(page.render.studentSvgPath, 'utf8');
    const solution = readFileSync(page.render.solutionSvgPath, 'utf8');
    assert.doesNotMatch(student, /id="maze-solution"/);
    assert.match(solution, /id="maze-solution"/);
    assert.ok(generated.metrics.svgMs < 100, `svgMs ${generated.metrics.svgMs}`);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('page render paths reject remote URLs and SVG creation stays under budget', () => {
  const generated = generate({ seed: 'svg-speed-1' });
  const started = performance.now();
  const docs = documentsFor(generated);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `SVG render took ${elapsed.toFixed(2)}ms`);
  assert.match(docs.studentSvg, /<svg /);
  assert.equal(docs.studentSvg.includes('<svg '), true);
  assert.equal(docs.studentSvg.includes('</svg>'), true);
  assert.equal((docs.studentSvg.match(/<svg /g) || []).length, 1);
  assert.throws(
    () => validateMazePage({
      schemaVersion: SCHEMA_VERSION,
      engineType: ENGINE_TYPE,
      project: { id: 'maze-svg-1', revision: 1 },
      pageId: 'M01',
      sequenceIndex: 1,
      sequenceTotal: 1,
      pageRole: 'maze_interior',
      keyword: 'school',
      ageBand: 'kindergarten',
      difficultyTier: 2,
      shape: SHAPE_RECTANGULAR,
      seed: 'x',
      startAssetId: 'pencil',
      endAssetId: 'apple',
      themeId: '',
      frameVariantId: '',
      framePrompt: '',
      title: '',
      instruction: '',
      mazePanel: DEFAULT_MAZE_PANEL,
      topology: null,
      solution: null,
      generationStatus: 'idle',
      validationResult: null,
      render: {
        studentSvgPath: 'https://example.com/maze.svg',
        solutionSvgPath: null,
        pngPreviewPath: null,
        frameImagePath: null
      }
    }),
    { code: 'MAZE_CONTRACT_INVALID' }
  );
  assert.deepEqual(defaultMazeRender(), {
    studentSvgPath: null,
    solutionSvgPath: null,
    pngPreviewPath: null,
    frameImagePath: null
  });
  assert.equal(resolveMazePageSetup('letter').format, 'LETTER');
  assert.ok(parseNumbers(docs.studentSvg, /width="([^"]+)"/g).every(Number.isFinite));
});

test('a decorative frame sits behind the pale panel and remote frames are ignored', async () => {
  const generated = generate({ seed: 'svg-frame-1' });
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-frame-'));
  try {
    const framePath = join(root, 'frame.png');
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 20, b: 20 } }
    }).png().toFile(framePath);
    const withFrame = documentsFor(generated, { frameImagePath: framePath });
    const svg = withFrame.studentSvg;
    const frameIndex = svg.indexOf('id="maze-frame"');
    const imageIndex = svg.indexOf('data-role="decorative-frame"');
    const panelIndex = svg.indexOf('id="maze-panel"');
    assert.ok(frameIndex < imageIndex && imageIndex < panelIndex);
    assert.match(svg, /data:image\/png;base64,/);
    assert.doesNotMatch(svg, /href="https?:\/\//);

    const remote = documentsFor(generated, { frameImagePath: 'https://evil.example/frame.svg' });
    assert.doesNotMatch(remote.studentSvg, /evil\.example/);
    assert.doesNotMatch(remote.studentSvg, /data-role="decorative-frame"/);
    assert.match(remote.studentSvg, /id="maze-panel"/);

    const studentPath = join(root, 'frame-panel-student.svg');
    writeFileSync(studentPath, svg);
    const preview = await pageImageAsPngBuffer(studentPath);
    const meta = await sharp(preview).metadata();
    const scaleX = meta.width / withFrame.layout.page.width;
    const scaleY = meta.height / withFrame.layout.page.height;
    const covered = await samplePixel(
      preview,
      (withFrame.layout.panel.x + 6) * scaleX,
      (withFrame.layout.panel.y + 6) * scaleY
    );
    assert.ok(luminanceRgb(covered.r, covered.g, covered.b) > 0.8, `panel must cover frame ${JSON.stringify(covered)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
