'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');
const { ENGINE_TYPES, detectProductEngine, normalizeProductFormat } = require('./product-engine-boundary.cjs');
const {
  PAGE_ROLES,
  DEFAULT_MAZE_PANEL,
  createMazePageId,
  defaultMazeProject,
  defaultMazeRender,
  migrateMazeProject,
  parseMazeProject,
  serializeMazeProject,
  validateMazeConfig,
  validateMazeProject
} = require('./maze-contract.cjs');
const { generateMazeTopology } = require('./maze-generator.cjs');
const { normalizePageFormat, renderMazePageDocuments } = require('./maze-svg.cjs');
const {
  applyMazePagePlan,
  mapMazeThemeResponse,
  mazeConfigPatchFromTheme
} = require('./maze-prompts.cjs');
const {
  MAX_MAZE_REMOTE_IN_FLIGHT,
  directMazeTheme,
  ensureMazeFrame,
  ensureMazeFrames,
  resolveApprovedFramePath
} = require('./maze-artwork.cjs');

function mazeProjectKey(projectId) {
  return `mazeProject:${projectId}`;
}

function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(projectId)) {
    throw Object.assign(new Error('Invalid project identity.'), { code: 'MAZE_PROJECT_INVALID' });
  }
  return projectId;
}

function assertMazeEngine(project) {
  if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  const format = normalizeProductFormat(project.productFormat || 'static');
  if (format !== 'maze' && detectProductEngine(project) !== ENGINE_TYPES.MAZE) {
    throw Object.assign(new Error('Maze engine is required for this project.'), { code: 'MAZE_ENGINE_REQUIRED' });
  }
  return project;
}

function loadMazeProject(store, projectId) {
  assertProjectId(projectId);
  try {
    const stored = store.getSetting(mazeProjectKey(projectId), null);
    if (stored == null) return defaultMazeProject(projectId);
    return parseMazeProject(stored, projectId);
  } catch {
    return defaultMazeProject(projectId);
  }
}

function persistMazeProject(store, project) {
  const snapshot = validateMazeProject(project);
  store.setSetting(mazeProjectKey(snapshot.project.id), snapshot);
  return snapshot;
}

function rebasePageProject(page, projectRef) {
  if (!page || typeof page !== 'object') return page;
  return {
    ...page,
    project: projectRef,
    solution: page.solution && typeof page.solution === 'object'
      ? { ...page.solution, project: projectRef }
      : page.solution
  };
}

function nextRevision(project) {
  const projectRef = { id: project.project.id, revision: project.project.revision + 1 };
  return {
    ...project,
    project: projectRef,
    config: {
      ...project.config,
      project: projectRef
    },
    pages: project.pages.map((page) => rebasePageProject(page, projectRef))
  };
}

function getMazeProject(store, projectId) {
  return loadMazeProject(store, projectId);
}

const CONFIG_INPUT_KEYS = Object.freeze([
  'keyword', 'ageBand', 'difficultyTier', 'shape', 'seed', 'startAssetId',
  'endAssetId', 'themeId', 'frameVariantId', 'framePrompt', 'title', 'instruction'
]);

function pickConfigInput(input) {
  if (!input || typeof input !== 'object') return {};
  const picked = {};
  for (const key of CONFIG_INPUT_KEYS) {
    if (Object.hasOwn(input, key)) picked[key] = input[key];
  }
  return picked;
}

function setMazeConfig(store, projectId, configInput) {
  assertProjectId(projectId);
  const existing = loadMazeProject(store, projectId);
  const incoming = validateMazeConfig({
    ...existing.config,
    ...pickConfigInput(configInput),
    schemaVersion: existing.config.schemaVersion,
    engineType: existing.config.engineType,
    project: existing.project
  });
  const next = migrateMazeProject({
    ...nextRevision(existing),
    config: {
      ...incoming,
      project: { id: projectId, revision: existing.project.revision + 1 }
    }
  }, projectId);
  return persistMazeProject(store, next);
}

function isInsideDir(root, filePath) {
  const relativePath = relative(resolve(root), resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function resolveMazeArtifactDir(store, projectId) {
  try {
    const { projectWorkspaceDir } = require('./project-workspace.cjs');
    const workspace = projectWorkspaceDir(projectId);
    if (workspace) return join(workspace, 'maze');
  } catch {
    // Workspace helper is optional WIP; fall back to the project output folder.
  }
  const project = typeof store.getProject === 'function' ? store.getProject(projectId) : null;
  if (project?.outputDir) return join(project.outputDir, 'maze');
  return null;
}

async function persistMazeRender(store, projectId, page, result, options = {}) {
  const empty = { ...defaultMazeRender(), svgMs: 0, rasterMs: 0 };
  if (options.persistRender === false) return empty;
  const dir = resolveMazeArtifactDir(store, projectId);
  if (!dir) return empty;

  mkdirSync(dir, { recursive: true });
  const project = typeof store.getProject === 'function' ? store.getProject(projectId) : null;
  const format = normalizePageFormat(options.format || project?.format || 'A4');
  const orientation = options.orientation || project?.orientation || 'portrait';
  const started = performance.now();
  const frameImagePath = resolveApprovedFramePath(store, projectId, options.frameImagePath ?? page.render?.frameImagePath ?? null);
  const documents = renderMazePageDocuments({
    result,
    page,
    format,
    orientation,
    mazePanel: page.mazePanel,
    title: page.title,
    instruction: page.instruction,
    startAssetId: page.startAssetId,
    endAssetId: page.endAssetId,
    frameImagePath
  });
  const svgMs = performance.now() - started;
  const studentSvgPath = join(dir, `${page.pageId}-student.svg`);
  const solutionSvgPath = join(dir, `${page.pageId}-solution.svg`);
  const pngPreviewPath = join(dir, `${page.pageId}-preview.png`);
  for (const filePath of [studentSvgPath, solutionSvgPath, pngPreviewPath]) {
    if (!isInsideDir(dir, filePath)) {
      throw Object.assign(new Error('Maze render path left the approved project folder.'), {
        code: 'MAZE_RENDER_PATH_INVALID'
      });
    }
  }
  writeFileSync(studentSvgPath, documents.studentSvg);
  writeFileSync(solutionSvgPath, documents.solutionSvg);

  const { atomicWrite, ensureCardPreview, pageImageAsPngBuffer } = require('./file-manager.cjs');
  const rasterStarted = performance.now();
  const png = await pageImageAsPngBuffer(studentSvgPath);
  await atomicWrite(pngPreviewPath, png);
  await ensureCardPreview(pngPreviewPath);
  return {
    studentSvgPath,
    solutionSvgPath,
    pngPreviewPath,
    frameImagePath,
    svgMs,
    rasterMs: performance.now() - rasterStarted
  };
}

function nextInteriorIdentity(project, requestedId) {
  if (requestedId) {
    const existing = project.pages.find((page) => page.pageId === requestedId);
    const sequenceIndex = existing?.sequenceIndex || (project.pages.reduce((max, page) => Math.max(max, page.sequenceIndex), 0) + 1);
    return {
      pageId: requestedId,
      sequenceIndex,
      sequenceTotal: Math.max(existing?.sequenceTotal || 0, sequenceIndex, project.pages.length + (existing ? 0 : 1))
    };
  }
  const interior = project.pages.find((page) => page.pageRole === PAGE_ROLES.MAZE_INTERIOR);
  if (interior) {
    return {
      pageId: interior.pageId,
      sequenceIndex: interior.sequenceIndex,
      sequenceTotal: Math.max(interior.sequenceTotal, project.pages.length)
    };
  }
  const sequenceIndex = project.pages.reduce((max, page) => Math.max(max, page.sequenceIndex), 0) + 1;
  return {
    pageId: createMazePageId(sequenceIndex),
    sequenceIndex,
    sequenceTotal: Math.max(sequenceIndex, project.pages.length + 1)
  };
}

function buildGeneratedPage(project, result, identity, panel, pageSeed) {
  const existing = project.pages.find((page) => page.pageId === identity.pageId);
  return {
    schemaVersion: project.schemaVersion,
    engineType: project.engineType,
    project: { id: project.project.id, revision: project.project.revision },
    pageId: identity.pageId,
    sequenceIndex: identity.sequenceIndex,
    sequenceTotal: identity.sequenceTotal,
    pageRole: PAGE_ROLES.MAZE_INTERIOR,
    keyword: project.config.keyword,
    ageBand: project.config.ageBand,
    difficultyTier: existing?.difficultyTier || project.config.difficultyTier,
    shape: result.topology?.shape || existing?.shape || project.config.shape,
    seed: pageSeed || project.config.seed,
    startAssetId: existing?.startAssetId || project.config.startAssetId,
    endAssetId: existing?.endAssetId || project.config.endAssetId,
    themeId: project.config.themeId,
    frameVariantId: existing?.frameVariantId || project.config.frameVariantId,
    framePrompt: existing?.framePrompt || project.config.framePrompt,
    title: existing?.title || project.config.title,
    instruction: existing?.instruction || project.config.instruction,
    mazePanel: panel || existing?.mazePanel || DEFAULT_MAZE_PANEL,
    topology: result.topology,
    solution: result.solution,
    generationStatus: 'ready',
    validationResult: result.validationResult,
    render: existing?.render || defaultMazeRender()
  };
}

async function applyDirectedTheme(store, projectId, project, options = {}) {
  let mapped = null;
  if (options.themeDirection != null) {
    mapped = mapMazeThemeResponse(options.themeDirection, project.config);
  } else if (options.directTheme && options.provider) {
    mapped = await directMazeTheme(options.provider, project.config, options);
  }
  if (!mapped) return project;
  const next = setMazeConfig(store, projectId, mazeConfigPatchFromTheme(mapped));
  if (!mapped.pages.length) return next;
  return persistMazeProject(store, {
    ...next,
    pages: applyMazePagePlan(next.pages, mapped.pages, mapped.themeId).map((page) => ({
      ...page,
      project: next.project
    }))
  });
}

function upsertGeneratedPage(project, page) {
  const pages = project.pages.filter((item) => item.pageId !== page.pageId);
  pages.push(page);
  pages.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const sequenceTotal = Math.max(page.sequenceTotal, pages.length, ...pages.map((item) => item.sequenceIndex));
  const projectRef = { id: project.project.id, revision: project.project.revision };
  return pages.map((item) => ({
    ...rebasePageProject(item, projectRef),
    sequenceTotal
  }));
}

async function generateMazePage(store, projectId, options = {}) {
  assertProjectId(projectId);
  let project = loadMazeProject(store, projectId);
  if (options.config) {
    project = setMazeConfig(store, projectId, options.config);
  }
  project = await applyDirectedTheme(store, projectId, project, options);
  const identity = nextInteriorIdentity(project, options.pageId);
  const existing = project.pages.find((page) => page.pageId === identity.pageId);
  const panel = options.mazePanel || existing?.mazePanel || DEFAULT_MAZE_PANEL;
  const bumped = nextRevision(project);
  const pageSeed = typeof options.pageSeed === 'string' && options.pageSeed
    ? options.pageSeed
    : bumped.config.seed;
  const generated = generateMazeTopology({
    ...bumped.config,
    difficultyTier: existing?.difficultyTier || bumped.config.difficultyTier,
    startAssetId: existing?.startAssetId || bumped.config.startAssetId,
    endAssetId: existing?.endAssetId || bumped.config.endAssetId,
    shape: existing?.shape || options.shape || bumped.config.shape,
    seed: pageSeed,
    title: existing?.title || bumped.config.title,
    keyword: existing?.keyword || bumped.config.keyword,
    project: bumped.project
  }, {
    pageId: identity.pageId,
    mazePanel: panel,
    sequenceIndex: existing?.sequenceIndex || identity.sequenceIndex,
    sequenceTotal: existing?.sequenceTotal || identity.sequenceTotal,
    title: existing?.title || options.title || bumped.config.title,
    keyword: existing?.keyword || options.keyword || bumped.config.keyword,
    shape: existing?.shape || options.shape || bumped.config.shape,
    algorithm: options.algorithm,
    lattice: options.lattice,
    braidFactor: options.braidFactor,
    variety: options.variety === true
      || (Number(existing?.sequenceTotal || identity.sequenceTotal) > 1)
  });
  const draft = buildGeneratedPage(bumped, generated.result, identity, panel, pageSeed);
  let frameImagePath = resolveApprovedFramePath(
    store,
    projectId,
    options.frameImagePath || existing?.render?.frameImagePath || null
  );
  if (!frameImagePath && options.provider && options.skipArtwork !== true) {
    const artwork = await ensureMazeFrame(store, projectId, {
      themeId: draft.themeId,
      pageRole: draft.pageRole,
      frameVariantId: draft.frameVariantId,
      framePrompt: draft.framePrompt,
      sequenceIndex: draft.sequenceIndex
    }, options);
    frameImagePath = artwork.path;
  }
  const render = await persistMazeRender(store, projectId, draft, generated.result, {
    ...options,
    frameImagePath
  });
  const page = {
    ...draft,
    render: {
      studentSvgPath: render.studentSvgPath,
      solutionSvgPath: render.solutionSvgPath,
      pngPreviewPath: render.pngPreviewPath,
      frameImagePath: render.frameImagePath ?? frameImagePath ?? null
    }
  };
  const mazeProject = persistMazeProject(store, {
    ...bumped,
    pages: upsertGeneratedPage(bumped, page)
  });
  return {
    mazeProject,
    result: generated.result,
    metrics: {
      ...generated.metrics,
      svgMs: render.svgMs,
      rasterMs: render.rasterMs
    }
  };
}

function generateMaze(store, projectId, options = {}) {
  return generateMazePage(store, projectId, options);
}

function deleteMazeProject(store, projectId) {
  if (!projectId || typeof store.setSetting !== 'function') return;
  store.setSetting(mazeProjectKey(projectId), null);
  store.setSetting(`mazeLab:${projectId}`, null);
}

function ensureMazeProject(store, projectId) {
  assertProjectId(projectId);
  const existing = store.getSetting(mazeProjectKey(projectId), null);
  if (existing) return parseMazeProject(existing, projectId);
  return persistMazeProject(store, defaultMazeProject(projectId));
}

function replaceMazePages(store, projectId, pages) {
  assertProjectId(projectId);
  const existing = loadMazeProject(store, projectId);
  const list = Array.isArray(pages) ? pages : [];
  const bumped = nextRevision(existing);
  const sequenceTotal = Math.max(
    1,
    list.length,
    ...list.map((page) => Number(page.sequenceIndex) || 0)
  );
  return persistMazeProject(store, {
    ...bumped,
    pages: list.map((page) => ({
      ...rebasePageProject(page, bumped.project),
      sequenceTotal
    }))
  });
}

module.exports = {
  mazeProjectKey,
  assertMazeEngine,
  getMazeProject,
  setMazeConfig,
  generateMazeTopology,
  generateMazePage,
  generateMaze,
  persistMazeRender,
  resolveMazeArtifactDir,
  replaceMazePages,
  deleteMazeProject,
  ensureMazeProject,
  serializeMazeProject,
  directMazeTheme,
  ensureMazeFrame,
  ensureMazeFrames,
  MAX_MAZE_REMOTE_IN_FLIGHT
};
