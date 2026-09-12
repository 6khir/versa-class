'use strict';

const { jsonSnapshot, deepFreeze } = require('./editable-contract-data.cjs');
const { ENGINE_TYPES } = require('./product-engine-boundary.cjs');

const {
  DESIGN_REVISION,
  SHAPE_RECTANGULAR,
  SHAPES,
  LATTICES,
  LATTICE_SQUARE,
  ALGORITHMS,
  defaultMazeDesign,
  coerceDesign,
  sanitizeShape,
  sanitizeAlgorithm,
  sanitizeLattice
} = require('./maze-design.cjs');

const SCHEMA_VERSION = 1;
const ENGINE_TYPE = ENGINE_TYPES.MAZE;

const PAGE_ROLES = Object.freeze({
  COVER: 'cover',
  MAZE_INTERIOR: 'maze_interior',
  ANSWER_KEY: 'answer_key',
  BACK_COVER: 'back_cover'
});
const PAGE_ROLE_VALUES = Object.freeze(Object.values(PAGE_ROLES));
const PAGE_ROLE_LABELS = Object.freeze({
  cover: 'cover',
  maze_interior: 'maze interior',
  answer_key: 'answer key',
  back_cover: 'back cover'
});

const ASSET_IDS = Object.freeze([
  'pencil', 'apple', 'school_bus', 'school', 'bee', 'flower', 'rocket', 'planet'
]);

const GENERATION_STATUSES = Object.freeze([
  'idle', 'pending', 'ready', 'failed', 'not_implemented'
]);

const DIFFICULTY_PRESETS = deepFreeze({
  very_easy: {
    id: 'very_easy', label: 'Very Easy', tier: 1,
    rows: 6, cols: 6, cellSize: 56, wallThickness: 6,
    minSolutionLength: 8, minTurnCount: 2, minDeadEndCount: 2, minEntranceExitDistance: 4
  },
  easy: {
    id: 'easy', label: 'Easy', tier: 2,
    rows: 8, cols: 8, cellSize: 44, wallThickness: 5,
    minSolutionLength: 14, minTurnCount: 4, minDeadEndCount: 4, minEntranceExitDistance: 6
  },
  medium: {
    id: 'medium', label: 'Medium', tier: 3,
    rows: 12, cols: 12, cellSize: 32, wallThickness: 4,
    minSolutionLength: 28, minTurnCount: 8, minDeadEndCount: 8, minEntranceExitDistance: 10
  },
  hard: {
    id: 'hard', label: 'Hard', tier: 4,
    rows: 16, cols: 16, cellSize: 24, wallThickness: 3,
    minSolutionLength: 48, minTurnCount: 14, minDeadEndCount: 14, minEntranceExitDistance: 14
  },
  expert: {
    id: 'expert', label: 'Expert', tier: 5,
    rows: 20, cols: 18, cellSize: 22, wallThickness: 3,
    minSolutionLength: 70, minTurnCount: 20, minDeadEndCount: 22, minEntranceExitDistance: 16
  }
});
const DIFFICULTY_TIERS = Object.freeze(
  Object.values(DIFFICULTY_PRESETS).map((preset) => preset.tier)
);

const AGE_BANDS = deepFreeze({
  pre_k: { id: 'pre_k', label: 'Pre-K (3–4)', minAge: 3, maxAge: 4, defaultDifficulty: 'very_easy', iconSize: 40 },
  kindergarten: { id: 'kindergarten', label: 'Kindergarten (5–6)', minAge: 5, maxAge: 6, defaultDifficulty: 'easy', iconSize: 32 },
  grades_1_2: { id: 'grades_1_2', label: 'Grades 1–2 (6–8)', minAge: 6, maxAge: 8, defaultDifficulty: 'easy', iconSize: 26 },
  grades_3_5: { id: 'grades_3_5', label: 'Grades 3–5 (8–11)', minAge: 8, maxAge: 11, defaultDifficulty: 'medium', iconSize: 20 },
  grades_6_8: { id: 'grades_6_8', label: 'Grades 6–8 (11–14)', minAge: 11, maxAge: 14, defaultDifficulty: 'hard', iconSize: 16 }
});

const SIDES = Object.freeze(['north', 'east', 'south', 'west']);
const MIN_MAZE_SIZE = 2;
const MAX_MAZE_SIZE = 48;
const MAX_GENERATION_RETRIES = 8;
const DEFAULT_MAZE_PANEL = Object.freeze({ x: 40, y: 80, width: 520, height: 620 });
const GENERATION_SPEC_KEYS = Object.freeze([
  'rows', 'cols', 'cellSize', 'wallThickness', 'minSolutionLength', 'minTurnCount',
  'minDeadEndCount', 'minEntranceExitDistance', 'iconSize', 'mazePanel', 'maxRetries'
]);
const TOPOLOGY_CORE_KEYS = Object.freeze([
  'schemaVersion', 'shape', 'rows', 'cols', 'cellSize', 'wallThickness', 'iconSize',
  'seed', 'generationSeed', 'retryCount', 'entrance', 'exit',
  'horizontalWalls', 'verticalWalls', 'stats'
]);
const TOPOLOGY_DESIGN_KEYS = Object.freeze([
  'algorithm', 'braidFactor', 'lattice', 'cellMask', 'design', 'hexWalls', 'radialWalls'
]);
const TOPOLOGY_KEYS = Object.freeze([...TOPOLOGY_CORE_KEYS, ...TOPOLOGY_DESIGN_KEYS]);

function fail(path, message) {
  throw Object.assign(new Error(`${path}: ${message}`), { code: 'MAZE_CONTRACT_INVALID', path });
}

function snapshot(value) {
  try {
    return jsonSnapshot(value);
  } catch (error) {
    throw Object.assign(new Error(error.message), { code: 'MAZE_CONTRACT_INVALID', path: error.path });
  }
}

function fields(value, names, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== names.length
    || names.some((name) => !Object.hasOwn(value, name))) fail(path, `Expected exactly: ${names.join(', ')}.`);
}

function text(value, path) {
  if (typeof value !== 'string') fail(path, 'Expected text.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value)) {
    fail(path, 'Invalid Unicode text.');
  }
}

function nonempty(value, path) {
  text(value, path);
  if (!value.trim()) fail(path, 'Expected nonempty text.');
}

function identity(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    fail(path, 'Invalid stable identity.');
  }
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail(path, 'Expected a positive safe integer.');
}

function optionalIdentity(value, path, allowed) {
  if (value == null) return;
  identity(value, path);
  if (allowed && !allowed.includes(value)) fail(path, 'Unsupported identity.');
}

function projectRef(value, path) {
  fields(value, ['id', 'revision'], path);
  identity(value.id, `${path}.id`);
  positiveInteger(value.revision, `${path}.revision`);
}

function engineHeader(value, path) {
  if (value.schemaVersion !== SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'Unsupported schema version.');
  if (value.engineType !== ENGINE_TYPE) fail(`${path}.engineType`, 'Expected maze engine.');
  projectRef(value.project, `${path}.project`);
}

function difficultyTier(value, path) {
  if (!Number.isSafeInteger(value) || !DIFFICULTY_TIERS.includes(value)) {
    fail(path, 'Expected a difficulty tier from 1 (Very Easy) to 5 (Expert).');
  }
}

function ageBand(value, path) {
  nonempty(value, path);
  if (!Object.hasOwn(AGE_BANDS, value)) fail(path, 'Unsupported age band.');
}

function shape(value, path) {
  if (!SHAPES.includes(value)) fail(path, `Unsupported maze shape. Expected one of: ${SHAPES.join(', ')}.`);
}

function mazePanel(value, path) {
  if (value == null) return;
  fields(value, ['x', 'y', 'width', 'height'], path);
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(value[key])) fail(`${path}.${key}`, 'Expected a finite number.');
  }
  if (value.width <= 0 || value.height <= 0) fail(path, 'Expected a positive rectangular panel.');
}

function optionalStoredPath(value, path) {
  if (value == null) return;
  nonempty(value, path);
  if (value.includes('://')) fail(path, 'Expected a local file path.');
}

function defaultMazeRender() {
  return {
    studentSvgPath: null,
    solutionSvgPath: null,
    pngPreviewPath: null,
    frameImagePath: null
  };
}

function mazeRender(value, path) {
  fields(value, ['studentSvgPath', 'solutionSvgPath', 'pngPreviewPath', 'frameImagePath'], path);
  optionalStoredPath(value.studentSvgPath, `${path}.studentSvgPath`);
  optionalStoredPath(value.solutionSvgPath, `${path}.solutionSvgPath`);
  optionalStoredPath(value.pngPreviewPath, `${path}.pngPreviewPath`);
  optionalStoredPath(value.frameImagePath, `${path}.frameImagePath`);
}

function coerceMazeRender(value) {
  return {
    studentSvgPath: value?.studentSvgPath ?? null,
    solutionSvgPath: value?.solutionSvgPath ?? null,
    pngPreviewPath: value?.pngPreviewPath ?? null,
    frameImagePath: value?.frameImagePath ?? null
  };
}

function nonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) fail(path, 'Expected a non-negative safe integer.');
}

function positiveFinite(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(path, 'Expected a positive finite number.');
  }
}

function mazeSide(value, path) {
  if (!SIDES.includes(value)) fail(path, 'Expected north, east, south, or west.');
}

function mazeCellCoord(value, path) {
  fields(value, ['row', 'col'], path);
  nonNegativeInteger(value.row, `${path}.row`);
  nonNegativeInteger(value.col, `${path}.col`);
}

function mazeOpening(value, path) {
  fields(value, ['row', 'col', 'side'], path);
  nonNegativeInteger(value.row, `${path}.row`);
  nonNegativeInteger(value.col, `${path}.col`);
  mazeSide(value.side, `${path}.side`);
}

function booleanGrid(value, rows, cols, path) {
  if (!Array.isArray(value) || value.length !== rows) fail(path, `Expected ${rows} rows.`);
  value.forEach((line, index) => {
    if (!Array.isArray(line) || line.length !== cols) fail(`${path}[${index}]`, `Expected ${cols} columns.`);
    if (line.some((item) => typeof item !== 'boolean')) fail(`${path}[${index}]`, 'Expected boolean wall flags.');
  });
}

function mazeExtent(rows, cols, cellSize, wallThickness, lattice = LATTICE_SQUARE) {
  if (lattice === 'hex') {
    const size = cellSize;
    const hexWidth = Math.sqrt(3) * size;
    return {
      width: (cols * hexWidth) + (hexWidth / 2) + (wallThickness * 2),
      height: (size * 1.5 * rows) + (size * 0.5) + (wallThickness * 2)
    };
  }
  if (lattice === 'radial') {
    const ringStep = cellSize + (wallThickness * 0.35);
    const diameter = (rows * ringStep * 2) + (wallThickness * 4);
    return { width: diameter, height: diameter };
  }
  return {
    width: cols * cellSize + (cols + 1) * wallThickness,
    height: rows * cellSize + (rows + 1) * wallThickness
  };
}

function topologyStats(value, path) {
  fields(value, [
    'passageCount', 'solutionLength', 'turnCount', 'deadEndCount', 'entranceExitDistance'
  ], path);
  for (const key of ['passageCount', 'solutionLength', 'turnCount', 'deadEndCount', 'entranceExitDistance']) {
    nonNegativeInteger(value[key], `${path}.${key}`);
  }
}

function optionalBooleanGrid(value, rows, cols, path) {
  if (value == null) return;
  booleanGrid(value, rows, cols, path);
}

function hexWalls(value, rows, cols, path) {
  if (value == null) return;
  fields(value, ['east', 'northEast', 'northWest'], path);
  booleanGrid(value.east, rows, cols, `${path}.east`);
  booleanGrid(value.northEast, rows, cols, `${path}.northEast`);
  booleanGrid(value.northWest, rows, cols, `${path}.northWest`);
}

function radialWalls(value, rows, cols, path) {
  if (value == null) return;
  fields(value, ['ring', 'spoke'], path);
  booleanGrid(value.ring, rows + 1, cols, `${path}.ring`);
  booleanGrid(value.spoke, rows, cols, `${path}.spoke`);
}

function topologyDesign(value, path) {
  fields(value, ['revision', 'wallStyle', 'frameStyle', 'paletteId', 'cellStyle'], path);
  nonNegativeInteger(value.revision, `${path}.revision`);
  text(value.wallStyle, `${path}.wallStyle`);
  text(value.frameStyle, `${path}.frameStyle`);
  text(value.paletteId, `${path}.paletteId`);
  text(value.cellStyle, `${path}.cellStyle`);
}

function coerceTopology(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return {
    ...value,
    algorithm: sanitizeAlgorithm(value.algorithm),
    braidFactor: Number.isFinite(value.braidFactor) ? value.braidFactor : 0,
    lattice: sanitizeLattice(value.lattice),
    cellMask: value.cellMask ?? null,
    design: coerceDesign(value.design),
    hexWalls: value.hexWalls ?? null,
    radialWalls: value.radialWalls ?? null
  };
}

function topologyFields(value, path) {
  fields(value, TOPOLOGY_KEYS, path);
  if (value.schemaVersion !== SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'Unsupported schema version.');
  shape(value.shape, `${path}.shape`);
  if (!ALGORITHMS.includes(value.algorithm)) fail(`${path}.algorithm`, 'Unsupported maze algorithm.');
  if (!Number.isFinite(value.braidFactor) || value.braidFactor < 0 || value.braidFactor > 1) {
    fail(`${path}.braidFactor`, 'Expected a braid factor between 0 and 1.');
  }
  if (!LATTICES.includes(value.lattice)) fail(`${path}.lattice`, 'Unsupported maze lattice.');
  positiveInteger(value.rows, `${path}.rows`);
  positiveInteger(value.cols, `${path}.cols`);
  if (value.rows < MIN_MAZE_SIZE || value.cols < MIN_MAZE_SIZE) {
    fail(path, `Expected at least a ${MIN_MAZE_SIZE}×${MIN_MAZE_SIZE} grid.`);
  }
  if (value.rows > MAX_MAZE_SIZE || value.cols > MAX_MAZE_SIZE) {
    fail(path, `Expected at most a ${MAX_MAZE_SIZE}×${MAX_MAZE_SIZE} grid.`);
  }
  positiveFinite(value.cellSize, `${path}.cellSize`);
  positiveFinite(value.wallThickness, `${path}.wallThickness`);
  positiveFinite(value.iconSize, `${path}.iconSize`);
  text(value.seed, `${path}.seed`);
  text(value.generationSeed, `${path}.generationSeed`);
  nonNegativeInteger(value.retryCount, `${path}.retryCount`);
  mazeOpening(value.entrance, `${path}.entrance`);
  mazeOpening(value.exit, `${path}.exit`);
  booleanGrid(value.horizontalWalls, value.rows + 1, value.cols, `${path}.horizontalWalls`);
  booleanGrid(value.verticalWalls, value.rows, value.cols + 1, `${path}.verticalWalls`);
  topologyStats(value.stats, `${path}.stats`);
  optionalBooleanGrid(value.cellMask, value.rows, value.cols, `${path}.cellMask`);
  topologyDesign(value.design, `${path}.design`);
  hexWalls(value.hexWalls, value.rows, value.cols, `${path}.hexWalls`);
  radialWalls(value.radialWalls, value.rows, value.cols, `${path}.radialWalls`);
}

function validationResult(value, path) {
  if (value == null) return;
  fields(value, ['schemaVersion', 'valid', 'code', 'messages'], path);
  if (value.schemaVersion !== SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'Unsupported schema version.');
  if (typeof value.valid !== 'boolean') fail(`${path}.valid`, 'Expected a boolean.');
  if (value.code != null) nonempty(value.code, `${path}.code`);
  if (!Array.isArray(value.messages) || value.messages.some((item) => typeof item !== 'string')) {
    fail(`${path}.messages`, 'Expected an array of text messages.');
  }
}

function configFields(value, path) {
  fields(value, [
    'schemaVersion', 'engineType', 'project', 'keyword', 'ageBand', 'difficultyTier',
    'shape', 'seed', 'startAssetId', 'endAssetId', 'themeId', 'frameVariantId',
    'framePrompt', 'title', 'instruction'
  ], path);
  engineHeader(value, path);
  text(value.keyword, `${path}.keyword`);
  ageBand(value.ageBand, `${path}.ageBand`);
  difficultyTier(value.difficultyTier, `${path}.difficultyTier`);
  shape(value.shape, `${path}.shape`);
  text(value.seed, `${path}.seed`);
  optionalIdentity(value.startAssetId, `${path}.startAssetId`, ASSET_IDS);
  optionalIdentity(value.endAssetId, `${path}.endAssetId`, ASSET_IDS);
  text(value.themeId, `${path}.themeId`);
  text(value.frameVariantId, `${path}.frameVariantId`);
  text(value.framePrompt, `${path}.framePrompt`);
  text(value.title, `${path}.title`);
  text(value.instruction, `${path}.instruction`);
}

function validateMazeConfig(input) {
  const value = snapshot(input);
  configFields(value, '$');
  return value;
}

function validateMazeValidationResult(input) {
  const value = snapshot(input);
  validationResult(value, '$');
  if (value == null) fail('$', 'Expected a validation result.');
  return value;
}

function validateMazeSolution(input) {
  const value = snapshot(input);
  fields(value, ['schemaVersion', 'engineType', 'project', 'pageId', 'path'], '$');
  engineHeader(value, '$');
  identity(value.pageId, '$.pageId');
  if (!Array.isArray(value.path)) fail('$.path', 'Expected a path array.');
  value.path.forEach((cell, index) => mazeCellCoord(cell, `$.path[${index}]`));
  return value;
}

function validateMazeTopology(input) {
  const value = snapshot(coerceTopology(input));
  topologyFields(value, '$');
  return value;
}

function attachSolution(value, solution, path) {
  if (solution == null) return;
  const checked = validateMazeSolution(solution);
  if (checked.pageId !== value.pageId) fail(`${path}.pageId`, 'Solution belongs to another page.');
  if (checked.project.id !== value.project.id || checked.project.revision !== value.project.revision) {
    fail(`${path}.project`, 'Solution project revision does not match.');
  }
}

function validateMazeResult(input) {
  const value = snapshot(input);
  fields(value, [
    'schemaVersion', 'engineType', 'project', 'pageId', 'topology', 'solution', 'validationResult'
  ], '$');
  engineHeader(value, '$');
  identity(value.pageId, '$.pageId');
  if (value.topology != null) value.topology = validateMazeTopology(value.topology);
  attachSolution(value, value.solution, '$.solution');
  validationResult(value.validationResult, '$.validationResult');
  return value;
}

function validateMazePage(input) {
  const value = snapshot(input);
  fields(value, [
    'schemaVersion', 'engineType', 'project', 'pageId', 'sequenceIndex', 'sequenceTotal',
    'pageRole', 'keyword', 'ageBand', 'difficultyTier', 'shape', 'seed', 'startAssetId',
    'endAssetId', 'themeId', 'frameVariantId', 'framePrompt', 'title', 'instruction',
    'mazePanel', 'topology', 'solution', 'generationStatus', 'validationResult', 'render'
  ], '$');
  engineHeader(value, '$');
  identity(value.pageId, '$.pageId');
  positiveInteger(value.sequenceIndex, '$.sequenceIndex');
  positiveInteger(value.sequenceTotal, '$.sequenceTotal');
  if (value.sequenceIndex > value.sequenceTotal) fail('$.sequenceIndex', 'Sequence index exceeds sequence total.');
  if (!PAGE_ROLE_VALUES.includes(value.pageRole)) fail('$.pageRole', 'Unsupported page role.');
  text(value.keyword, '$.keyword');
  ageBand(value.ageBand, '$.ageBand');
  difficultyTier(value.difficultyTier, '$.difficultyTier');
  shape(value.shape, '$.shape');
  text(value.seed, '$.seed');
  optionalIdentity(value.startAssetId, '$.startAssetId', ASSET_IDS);
  optionalIdentity(value.endAssetId, '$.endAssetId', ASSET_IDS);
  text(value.themeId, '$.themeId');
  text(value.frameVariantId, '$.frameVariantId');
  text(value.framePrompt, '$.framePrompt');
  text(value.title, '$.title');
  text(value.instruction, '$.instruction');
  mazePanel(value.mazePanel, '$.mazePanel');
  if (value.topology != null) value.topology = validateMazeTopology(value.topology);
  attachSolution(value, value.solution, '$.solution');
  if (!GENERATION_STATUSES.includes(value.generationStatus)) fail('$.generationStatus', 'Unsupported generation status.');
  validationResult(value.validationResult, '$.validationResult');
  mazeRender(value.render, '$.render');
  return value;
}

function validateMazeProject(input) {
  const value = snapshot(input);
  fields(value, ['schemaVersion', 'engineType', 'project', 'config', 'pages'], '$');
  engineHeader(value, '$');
  const config = validateMazeConfig(value.config);
  if (config.project.id !== value.project.id || config.project.revision !== value.project.revision) {
    fail('$.config.project', 'Config project revision does not match.');
  }
  if (!Array.isArray(value.pages)) fail('$.pages', 'Expected an array.');
  const ids = new Set();
  const indexes = new Set();
  value.pages.forEach((page, index) => {
    const checked = validateMazePage(page);
    if (checked.project.id !== value.project.id || checked.project.revision !== value.project.revision) {
      fail(`$.pages[${index}].project`, 'Page project revision does not match.');
    }
    if (ids.has(checked.pageId)) fail(`$.pages[${index}].pageId`, 'Duplicate page identity.');
    if (indexes.has(checked.sequenceIndex)) fail(`$.pages[${index}].sequenceIndex`, 'Duplicate sequence index.');
    ids.add(checked.pageId);
    indexes.add(checked.sequenceIndex);
  });
  return value;
}

function createMazePageId(sequence) {
  positiveInteger(sequence, '$.pageIdSequence');
  return `M${String(sequence).padStart(2, '0')}`;
}

function defaultMazeConfig(projectId, revision = 1) {
  identity(projectId, '$.project.id');
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: projectId, revision },
    keyword: '',
    ageBand: AGE_BANDS.kindergarten.id,
    difficultyTier: DIFFICULTY_PRESETS.easy.tier,
    shape: SHAPE_RECTANGULAR,
    seed: '',
    startAssetId: 'pencil',
    endAssetId: 'apple',
    themeId: '',
    frameVariantId: '',
    framePrompt: '',
    title: '',
    instruction: ''
  };
}

function defaultMazeProject(projectId, revision = 1) {
  identity(projectId, '$.project.id');
  return {
    schemaVersion: SCHEMA_VERSION,
    engineType: ENGINE_TYPE,
    project: { id: projectId, revision },
    config: defaultMazeConfig(projectId, revision),
    pages: []
  };
}

function coerceMazePage(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
  return {
    ...page,
    topology: page.topology ?? null,
    solution: page.solution ?? null,
    render: coerceMazeRender(page.render)
  };
}

function migrateMazeProject(input, projectId) {
  if (input == null) return defaultMazeProject(projectId);
  if (typeof input !== 'object' || Array.isArray(input)) fail('$', 'Expected a maze project object.');
  if (input.schemaVersion == null) {
    return validateMazeProject({
      ...defaultMazeProject(projectId),
      ...(input.project ? { project: input.project } : {}),
      ...(input.config ? { config: { ...defaultMazeConfig(projectId), ...input.config } } : {}),
      ...(Array.isArray(input.pages) ? { pages: input.pages.map(coerceMazePage) } : {})
    });
  }
  if (input.schemaVersion !== SCHEMA_VERSION) fail('$.schemaVersion', 'Unsupported schema version.');
  return validateMazeProject({
    ...input,
    pages: Array.isArray(input.pages) ? input.pages.map(coerceMazePage) : input.pages
  });
}

function serializeMazeProject(input) {
  return JSON.stringify(validateMazeProject(input));
}

function salvageMazeConfig(input, projectId, revision) {
  const base = defaultMazeConfig(projectId, revision);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const merged = { ...base };
  for (const key of [
    'keyword', 'ageBand', 'difficultyTier', 'shape', 'seed', 'startAssetId',
    'endAssetId', 'themeId', 'frameVariantId', 'framePrompt', 'title', 'instruction'
  ]) {
    if (Object.hasOwn(input, key)) merged[key] = input[key];
  }
  try {
    return validateMazeConfig({
      ...merged,
      schemaVersion: SCHEMA_VERSION,
      engineType: ENGINE_TYPE,
      project: { id: projectId, revision }
    });
  } catch {
    return base;
  }
}

function salvageMazePage(page, projectRef) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  const sequenceIndex = Number.isSafeInteger(page.sequenceIndex) && page.sequenceIndex > 0
    ? page.sequenceIndex
    : null;
  if (!sequenceIndex) return null;
  const pageId = typeof page.pageId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(page.pageId)
    ? page.pageId
    : createMazePageId(sequenceIndex);
  try {
    return validateMazePage(coerceMazePage({
      schemaVersion: SCHEMA_VERSION,
      engineType: ENGINE_TYPE,
      project: projectRef,
      pageId,
      sequenceIndex,
      sequenceTotal: Number.isSafeInteger(page.sequenceTotal) && page.sequenceTotal >= sequenceIndex
        ? page.sequenceTotal
        : sequenceIndex,
      pageRole: PAGE_ROLE_VALUES.includes(page.pageRole) ? page.pageRole : PAGE_ROLES.MAZE_INTERIOR,
      keyword: typeof page.keyword === 'string' ? page.keyword : '',
      ageBand: Object.hasOwn(AGE_BANDS, page.ageBand) ? page.ageBand : AGE_BANDS.kindergarten.id,
      difficultyTier: DIFFICULTY_TIERS.includes(page.difficultyTier) ? page.difficultyTier : 2,
      shape: sanitizeShape(page.shape),
      seed: typeof page.seed === 'string' ? page.seed : '',
      startAssetId: ASSET_IDS.includes(page.startAssetId) ? page.startAssetId : 'pencil',
      endAssetId: ASSET_IDS.includes(page.endAssetId) ? page.endAssetId : 'apple',
      themeId: typeof page.themeId === 'string' ? page.themeId : '',
      frameVariantId: typeof page.frameVariantId === 'string' ? page.frameVariantId : '',
      framePrompt: typeof page.framePrompt === 'string' ? page.framePrompt : '',
      title: typeof page.title === 'string' ? page.title : '',
      instruction: typeof page.instruction === 'string' ? page.instruction : '',
      mazePanel: page.mazePanel && typeof page.mazePanel === 'object' ? page.mazePanel : DEFAULT_MAZE_PANEL,
      topology: page.topology ?? null,
      solution: page.solution ?? null,
      generationStatus: GENERATION_STATUSES.includes(page.generationStatus) ? page.generationStatus : 'idle',
      validationResult: page.validationResult ?? null,
      render: coerceMazeRender(page.render)
    }));
  } catch {
    return null;
  }
}

function recoverMazeProject(input, projectId) {
  const fallback = defaultMazeProject(projectId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const revision = Number.isSafeInteger(input.project?.revision) && input.project.revision > 0
    ? input.project.revision
    : 1;
  const project = { id: projectId, revision };
  const config = salvageMazeConfig(input.config, projectId, revision);
  const pages = [];
  const seen = new Set();
  if (Array.isArray(input.pages)) {
    for (const page of input.pages) {
      const recovered = salvageMazePage(page, project);
      if (!recovered || seen.has(recovered.pageId)) continue;
      seen.add(recovered.pageId);
      pages.push(recovered);
    }
  }
  try {
    return validateMazeProject({
      schemaVersion: SCHEMA_VERSION,
      engineType: ENGINE_TYPE,
      project,
      config: { ...config, project },
      pages
    });
  } catch {
    return { ...fallback, project, config: { ...config, project } };
  }
}

function parseMazeProject(raw, projectId) {
  if (raw == null || raw === '') return defaultMazeProject(projectId);
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultMazeProject(projectId);
    }
  }
  try {
    return migrateMazeProject(parsed, projectId);
  } catch {
    return recoverMazeProject(parsed, projectId);
  }
}

function difficultyPresetByTier(tier) {
  return Object.values(DIFFICULTY_PRESETS).find((preset) => preset.tier === tier) || null;
}

function pickGenerationOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const picked = {};
  for (const key of GENERATION_SPEC_KEYS) {
    if (Object.hasOwn(input, key)) picked[key] = input[key];
  }
  return picked;
}

function resolveMazeGenerationSpec(config, overrides = {}) {
  const checked = validateMazeConfig(config);
  const preset = difficultyPresetByTier(checked.difficultyTier);
  if (!preset) fail('$.difficultyTier', 'Expected a difficulty tier from 1 (Very Easy) to 5 (Expert).');
  const age = AGE_BANDS[checked.ageBand];
  const picked = pickGenerationOverrides(overrides);
  const spec = {
    rows: picked.rows ?? preset.rows,
    cols: picked.cols ?? preset.cols,
    cellSize: picked.cellSize ?? preset.cellSize,
    wallThickness: picked.wallThickness ?? preset.wallThickness,
    minSolutionLength: picked.minSolutionLength ?? preset.minSolutionLength,
    minTurnCount: picked.minTurnCount ?? preset.minTurnCount,
    minDeadEndCount: picked.minDeadEndCount ?? preset.minDeadEndCount,
    minEntranceExitDistance: picked.minEntranceExitDistance ?? preset.minEntranceExitDistance,
    iconSize: picked.iconSize ?? age.iconSize,
    mazePanel: picked.mazePanel === undefined ? null : picked.mazePanel,
    maxRetries: picked.maxRetries ?? MAX_GENERATION_RETRIES
  };
  positiveInteger(spec.rows, '$.rows');
  positiveInteger(spec.cols, '$.cols');
  if (spec.rows < MIN_MAZE_SIZE || spec.cols < MIN_MAZE_SIZE) {
    fail('$', `Expected at least a ${MIN_MAZE_SIZE}×${MIN_MAZE_SIZE} grid.`);
  }
  if (spec.rows > MAX_MAZE_SIZE || spec.cols > MAX_MAZE_SIZE) {
    fail('$', `Expected at most a ${MAX_MAZE_SIZE}×${MAX_MAZE_SIZE} grid.`);
  }
  positiveFinite(spec.cellSize, '$.cellSize');
  positiveFinite(spec.wallThickness, '$.wallThickness');
  positiveFinite(spec.iconSize, '$.iconSize');
  nonNegativeInteger(spec.minSolutionLength, '$.minSolutionLength');
  nonNegativeInteger(spec.minTurnCount, '$.minTurnCount');
  nonNegativeInteger(spec.minDeadEndCount, '$.minDeadEndCount');
  nonNegativeInteger(spec.minEntranceExitDistance, '$.minEntranceExitDistance');
  nonNegativeInteger(spec.maxRetries, '$.maxRetries');
  mazePanel(spec.mazePanel, '$.mazePanel');
  return spec;
}

function serializeMazeTopology(input) {
  return JSON.stringify(validateMazeTopology(input));
}

function serializeMazeResult(input) {
  return JSON.stringify(validateMazeResult(input));
}

module.exports = {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  DESIGN_REVISION,
  SHAPE_RECTANGULAR,
  SHAPES,
  LATTICES,
  LATTICE_SQUARE,
  ALGORITHMS,
  PAGE_ROLES,
  PAGE_ROLE_VALUES,
  PAGE_ROLE_LABELS,
  ASSET_IDS,
  GENERATION_STATUSES,
  DIFFICULTY_PRESETS,
  DIFFICULTY_TIERS,
  AGE_BANDS,
  SIDES,
  MIN_MAZE_SIZE,
  MAX_MAZE_SIZE,
  MAX_GENERATION_RETRIES,
  DEFAULT_MAZE_PANEL,
  GENERATION_SPEC_KEYS,
  createMazePageId,
  defaultMazeConfig,
  defaultMazeRender,
  defaultMazeProject,
  migrateMazeProject,
  validateMazeConfig,
  validateMazePage,
  validateMazeProject,
  validateMazeResult,
  validateMazeSolution,
  validateMazeTopology,
  validateMazeValidationResult,
  serializeMazeProject,
  serializeMazeTopology,
  serializeMazeResult,
  parseMazeProject,
  recoverMazeProject,
  difficultyPresetByTier,
  resolveMazeGenerationSpec,
  mazeExtent,
  coerceTopology,
  defaultMazeDesign
};
