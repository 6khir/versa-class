'use strict';

const { randomBytes } = require('node:crypto');
const { existsSync, rmSync } = require('node:fs');
const { relative, resolve, sep } = require('node:path');
const { assemblePagesBySequence } = require('./pipeline-watchdog.cjs');
const {
  PAGE_ROLES,
  DEFAULT_MAZE_PANEL,
  createMazePageId,
  defaultMazeRender,
  difficultyPresetByTier
} = require('./maze-contract.cjs');
const { resolveMazeSeed } = require('./maze-generator.cjs');
const {
  fallbackMazeTheme,
  mazeConfigPatchFromTheme,
  sanitizeThemeId
} = require('./maze-prompts.cjs');
const { briefFromProject, looksLikeListingDump, planMazeBookFromBrief } = require('./maze-brief.cjs');
const { pageNeedsDesignRefresh } = require('./maze-design.cjs');
const {
  assertMazeEngine,
  getMazeProject,
  setMazeConfig,
  generateMazePage,
  replaceMazePages,
  resolveMazeArtifactDir
} = require('./maze-service.cjs');

const MIN_MAZE_PAGE_COUNT = 1;
const MAX_MAZE_PAGE_COUNT = 50;
const DEFAULT_MAZE_PAGE_COUNT = 8;
const mazeRuns = new Map();

function mazeLabKey(projectId) {
  return `mazeLab:${projectId}`;
}

function defaultMazeLabState() {
  return {
    pageCount: DEFAULT_MAZE_PAGE_COUNT,
    seedLocked: false,
    selectedPageId: null,
    previewVariant: 'student',
    includeAnswerKey: true
  };
}

function pickLabPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const picked = {};
  if (Object.hasOwn(input, 'pageCount')) picked.pageCount = clampMazePageCount(input.pageCount);
  if (Object.hasOwn(input, 'seedLocked')) picked.seedLocked = Boolean(input.seedLocked);
  if (Object.hasOwn(input, 'selectedPageId')) {
    picked.selectedPageId = input.selectedPageId == null ? null : String(input.selectedPageId);
  }
  if (Object.hasOwn(input, 'previewVariant')) {
    picked.previewVariant = input.previewVariant === 'solution' ? 'solution' : 'student';
  }
  if (Object.hasOwn(input, 'includeAnswerKey')) picked.includeAnswerKey = Boolean(input.includeAnswerKey);
  return picked;
}

function clampMazePageCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_MAZE_PAGE_COUNT;
  return Math.max(MIN_MAZE_PAGE_COUNT, Math.min(MAX_MAZE_PAGE_COUNT, parsed));
}

function getMazeLabState(store, projectId) {
  let stored = null;
  try {
    stored = typeof store.getSetting === 'function' ? store.getSetting(mazeLabKey(projectId), null) : null;
  } catch {
    stored = null;
  }
  const incoming = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return {
    ...defaultMazeLabState(),
    ...pickLabPatch(incoming)
  };
}

function setMazeLabState(store, projectId, patch) {
  const next = {
    ...getMazeLabState(store, projectId),
    ...pickLabPatch(patch)
  };
  if (typeof store.setSetting === 'function') store.setSetting(mazeLabKey(projectId), next);
  return next;
}

function createMazeSeed(projectId) {
  return `maze:${projectId}:${randomBytes(6).toString('hex')}`;
}

function pageGenerationSeed(bookSeed, pageId, salt = '') {
  return [bookSeed, pageId, salt].filter(Boolean).join(':');
}

function shortMazeKeyword(value) {
  return require('./maze-brief.cjs').mazeThemeKeyword(value);
}

function titleFromKeyword(keyword) {
  const text = String(keyword || '').trim();
  if (!text) return 'Maze';
  const head = shortMazeKeyword(text);
  const labeled = /\bmazes?\b/i.test(head) ? head : `${head} maze`;
  return `${labeled.charAt(0).toUpperCase()}${labeled.slice(1)}`;
}

function defaultInstruction(config) {
  const end = String(config?.endAssetId || 'apple').replace(/_/g, ' ');
  return `Find the ${end}.`;
}

function applyLocalKeywordTheme(store, projectId) {
  const project = getMazeProject(store, projectId);
  const mapped = fallbackMazeTheme({
    keyword: project.config.keyword,
    themeId: project.config.themeId || project.config.keyword,
    ageBand: project.config.ageBand,
    startAssetId: project.config.startAssetId,
    endAssetId: project.config.endAssetId,
    title: project.config.title,
    instruction: project.config.instruction,
    framePrompt: project.config.framePrompt
  });
  const patch = mazeConfigPatchFromTheme(mapped);
  return setMazeConfig(store, projectId, {
    themeId: sanitizeThemeId(project.config.keyword || patch.themeId),
    framePrompt: project.config.framePrompt || patch.framePrompt,
    title: project.config.title || patch.title || titleFromKeyword(project.config.keyword),
    instruction: project.config.instruction || patch.instruction || defaultInstruction(project.config)
  });
}

function idleMazePage(project, identity) {
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
    difficultyTier: project.config.difficultyTier,
    shape: project.config.shape,
    seed: project.config.seed,
    startAssetId: project.config.startAssetId,
    endAssetId: project.config.endAssetId,
    themeId: project.config.themeId,
    frameVariantId: project.config.frameVariantId,
    framePrompt: project.config.framePrompt,
    title: project.config.title,
    instruction: project.config.instruction,
    mazePanel: DEFAULT_MAZE_PANEL,
    topology: null,
    solution: null,
    generationStatus: 'idle',
    validationResult: null,
    render: defaultMazeRender()
  };
}

function applyPagePlan(page, plan) {
  if (!plan || typeof plan !== 'object') return page;
  return {
    ...page,
    title: plan.title || page.title,
    instruction: plan.instruction || page.instruction,
    startAssetId: plan.startAssetId || page.startAssetId,
    endAssetId: plan.endAssetId || page.endAssetId,
    difficultyTier: Number.isSafeInteger(plan.difficultyTier) ? plan.difficultyTier : page.difficultyTier,
    shape: plan.shape || page.shape
  };
}

function planMazePages(store, projectId, pageCount, pagePlan = []) {
  const count = clampMazePageCount(pageCount);
  const project = getMazeProject(store, projectId);
  const existing = new Map(project.pages.map((page) => [page.pageId, page]));
  const extras = project.pages.filter((page) => page.pageRole !== PAGE_ROLES.MAZE_INTERIOR);
  const planned = Array.isArray(pagePlan) ? pagePlan : [];
  const interiors = [];
  for (let index = 1; index <= count; index += 1) {
    const pageId = createMazePageId(index);
    const current = existing.get(pageId);
    const plan = planned.find((item) => item?.sequenceIndex === index) || planned[index - 1] || null;
    if (current?.generationStatus === 'ready') {
      interiors.push({ ...current, sequenceIndex: index, sequenceTotal: count });
      continue;
    }
    const draft = current
      ? { ...current, sequenceIndex: index, sequenceTotal: count }
      : idleMazePage(project, { pageId, sequenceIndex: index, sequenceTotal: count });
    interiors.push(applyPagePlan(draft, plan));
  }
  return replaceMazePages(store, projectId, [...extras, ...interiors]);
}

function failedMazePage(project, identity, error) {
  const existing = project.pages.find((page) => page.pageId === identity.pageId);
  return {
    ...idleMazePage(project, identity),
    title: existing?.title || project.config.title,
    instruction: existing?.instruction || project.config.instruction,
    shape: existing?.shape || project.config.shape,
    startAssetId: existing?.startAssetId || project.config.startAssetId,
    endAssetId: existing?.endAssetId || project.config.endAssetId,
    difficultyTier: existing?.difficultyTier || project.config.difficultyTier,
    generationStatus: 'failed',
    validationResult: error?.validationResult || {
      schemaVersion: 1,
      valid: false,
      code: error?.code || 'MAZE_GENERATION_FAILED',
      messages: [error?.message || 'Maze generation failed.']
    }
  };
}

function beginMazeRun(projectId) {
  abortMazeGeneration(projectId);
  const controller = new AbortController();
  mazeRuns.set(projectId, controller);
  return controller;
}

function finishMazeRun(projectId, controller) {
  if (mazeRuns.get(projectId) === controller) mazeRuns.delete(projectId);
}

function abortMazeGeneration(projectId) {
  if (projectId) {
    const controller = mazeRuns.get(projectId);
    if (!controller) return false;
    controller.abort();
    mazeRuns.delete(projectId);
    return true;
  }
  for (const controller of mazeRuns.values()) controller.abort();
  mazeRuns.clear();
  return true;
}

function isMazeGenerationRunning(projectId) {
  return projectId ? mazeRuns.has(projectId) : mazeRuns.size > 0;
}

function mazePageProgress(mazeProject, lab) {
  const pages = Array.isArray(mazeProject?.pages) ? mazeProject.pages : [];
  const interiors = pages.filter((page) => page.pageRole === PAGE_ROLES.MAZE_INTERIOR);
  const planned = Number(lab?.pageCount) || interiors.length;
  const ready = interiors.filter((page) => page.generationStatus === 'ready').length;
  const failed = interiors.filter((page) => page.generationStatus === 'failed').length;
  return {
    ready,
    failed,
    planned,
    remaining: Math.max(0, planned - ready),
    percent: planned ? Math.round((ready / planned) * 100) : 0
  };
}

async function generateMazeBook(store, projectId, options = {}) {
  const lab = setMazeLabState(store, projectId, {
    pageCount: options.pageCount ?? getMazeLabState(store, projectId).pageCount
  });
  if (options.config) setMazeConfig(store, projectId, options.config);
  const projectRow = typeof store.getProject === 'function' ? store.getProject(projectId) : null;
  const existing = getMazeProject(store, projectId);
  const marketplaceBrief = options.brief || null;
  const brief = marketplaceBrief || briefFromProject(projectRow, options);
  const planned = planMazeBookFromBrief(
    { ...brief, forceAgeFromListing: Boolean(marketplaceBrief) },
    lab.pageCount,
    marketplaceBrief ? {} : existing.config
  );
  if (!marketplaceBrief && existing.config.keyword && !looksLikeListingDump(existing.config.keyword)) {
    planned.config.keyword = existing.config.keyword;
    planned.config.themeId = existing.config.themeId || existing.config.keyword;
    if (existing.config.ageBand) planned.config.ageBand = existing.config.ageBand;
    if (Number.isSafeInteger(existing.config.difficultyTier)) {
      planned.config.difficultyTier = existing.config.difficultyTier;
    }
  }
  const plannedByIndex = new Map(planned.pages.map((item) => [item.sequenceIndex, item]));
  setMazeConfig(store, projectId, planned.config);
  applyLocalKeywordTheme(store, projectId);
  setMazeConfig(store, projectId, {
    keyword: planned.config.keyword,
    themeId: planned.config.themeId,
    ageBand: planned.config.ageBand,
    difficultyTier: planned.config.difficultyTier,
    startAssetId: planned.config.startAssetId,
    endAssetId: planned.config.endAssetId,
    title: planned.config.title,
    instruction: planned.config.instruction
  });
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H170',location:'src/maze-lab.cjs:generateMazeBook',message:'maze book planned from listing brief',data:{projectId,keyword:planned.config.keyword,ageBand:planned.config.ageBand,titles:planned.pages.map((page)=>page.title),tiers:planned.pages.map((page)=>page.difficultyTier),hasMarketplaceBrief:Boolean(marketplaceBrief)},timestamp:Date.now()})}).catch(()=>{});
  try { require('node:fs').appendFileSync('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-d45d8d.log', `${JSON.stringify({ sessionId: 'd45d8d', runId: 'post-fix', hypothesisId: 'H170', location: 'src/maze-lab.cjs:generateMazeBook', message: 'maze book planned from listing brief', data: { projectId, keyword: planned.config.keyword, ageBand: planned.config.ageBand, titles: planned.pages.map((page) => page.title), tiers: planned.pages.map((page) => page.difficultyTier) }, timestamp: Date.now() })}\n`); } catch {}
  // #endregion
  let project = getMazeProject(store, projectId);
  if (!project.config.seed) {
    project = setMazeConfig(store, projectId, { seed: resolveMazeSeed(project.config) });
  }
  project = planMazePages(store, projectId, lab.pageCount, planned.pages);
  const signal = options.signal;
  const force = Boolean(options.force);
  const interiors = project.pages
    .filter((page) => page.pageRole === PAGE_ROLES.MAZE_INTERIOR)
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  const targets = force
    ? interiors
    : interiors.filter((page) => {
      if (page.generationStatus !== 'ready') return true;
      if (options.resume) return false;
      return pageNeedsDesignRefresh(page);
    });
  let completed = interiors.filter((page) => page.generationStatus === 'ready').length;
  let failed = 0;
  let cancelled = false;

  for (const page of targets) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    try {
      const generated = await generateMazePage(store, projectId, {
        pageId: page.pageId,
        pageSeed: pageGenerationSeed(project.config.seed, page.pageId),
        skipArtwork: options.skipArtwork !== false,
        persistRender: options.persistRender,
        mazePanel: page.mazePanel,
        themeDirection: options.themeDirection,
        directTheme: options.directTheme,
        provider: options.provider,
        sequenceIndex: page.sequenceIndex,
        sequenceTotal: interiors.length,
        title: page.title,
        keyword: page.keyword || project.config.keyword,
        shape: page.shape,
        algorithm: plannedByIndex.get(page.sequenceIndex)?.algorithm,
        lattice: plannedByIndex.get(page.sequenceIndex)?.lattice,
        variety: interiors.length > 1
      });
      project = generated.mazeProject;
      completed += 1;
    } catch (error) {
      failed += 1;
      const latest = getMazeProject(store, projectId);
      const identity = {
        pageId: page.pageId,
        sequenceIndex: page.sequenceIndex,
        sequenceTotal: page.sequenceTotal
      };
      const pages = latest.pages.map((item) => (
        item.pageId === page.pageId ? failedMazePage(latest, identity, error) : item
      ));
      project = replaceMazePages(store, projectId, pages);
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        pageId: page.pageId,
        completed,
        failed,
        total: interiors.length
      });
    }
  }

  if (signal?.aborted) cancelled = true;
  const latest = getMazeProject(store, projectId);
  const progress = mazePageProgress(latest, lab);
  const assembly = assemblePagesBySequence(latest.pages, {
    sequenceKey: 'sequenceIndex',
    statusKey: 'generationStatus',
    readyValue: 'ready',
    expectedTotal: interiors.length
  });
  if (options.persistRender !== false) {
    await require('./maze-export.cjs').syncMazeExportJobs(store, projectId);
  }
  if (typeof store.updateProject === 'function') {
    store.updateProject(projectId, { activityCount: interiors.length || progress.ready });
  }
  return {
    mazeProject: latest,
    mazeLab: lab,
    cancelled,
    failed: progress.failed,
    completed: progress.ready,
    remaining: progress.remaining,
    progress,
    complete: !cancelled && assembly.complete,
    missing: assembly.missing,
    invalid: assembly.invalid
  };
}

function tryRemoveMazeFile(filePath, dir) {
  if (!filePath || !existsSync(filePath)) return;
  if (dir && !isInsideDir(dir, filePath)) return;
  try { rmSync(filePath, { force: true }); } catch { /* keep going */ }
}

function clearMazePage(store, projectId, pageId) {
  const project = getMazeProject(store, projectId);
  const page = project.pages.find((item) => item.pageId === pageId);
  if (!page) {
    throw Object.assign(new Error('Select a maze.'), { code: 'MAZE_PAGE_MISSING' });
  }
  const dir = resolveMazeArtifactDir(store, projectId);
  tryRemoveMazeFile(page.render?.pngPreviewPath, dir);
  tryRemoveMazeFile(page.render?.studentSvgPath, dir);
  tryRemoveMazeFile(page.render?.solutionSvgPath, dir);
  const next = project.pages.map((item) => {
    if (item.pageId !== pageId) return item;
    return {
      ...idleMazePage(project, {
        pageId: item.pageId,
        sequenceIndex: item.sequenceIndex,
        sequenceTotal: item.sequenceTotal
      }),
      title: item.title,
      instruction: item.instruction,
      shape: item.shape,
      startAssetId: item.startAssetId,
      endAssetId: item.endAssetId,
      difficultyTier: item.difficultyTier
    };
  });
  return replaceMazePages(store, projectId, next);
}

function clearMazePages(store, projectId) {
  abortMazeGeneration(projectId);
  const project = getMazeProject(store, projectId);
  let next = project;
  for (const page of project.pages || []) {
    next = clearMazePage(store, projectId, page.pageId);
  }
  return next;
}

function rerollMazeSeed(store, projectId) {
  const lab = getMazeLabState(store, projectId);
  if (lab.seedLocked) {
    throw Object.assign(new Error('Seed is locked.'), { code: 'MAZE_SEED_LOCKED' });
  }
  return setMazeConfig(store, projectId, { seed: createMazeSeed(projectId) });
}

function copyMazeSeed(store, projectId) {
  const project = getMazeProject(store, projectId);
  return project.config.seed || resolveMazeSeed(project.config);
}

function isInsideDir(root, filePath) {
  if (!root || !filePath) return false;
  const relativePath = relative(resolve(root), resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function resolveMazePreviewPath(store, projectId, pageId, variant = 'student') {
  const project = getMazeProject(store, projectId);
  const page = project.pages.find((item) => item.pageId === pageId);
  if (!page) return null;
  const preferred = variant === 'solution'
    ? page.render?.solutionSvgPath || page.render?.pngPreviewPath
    : page.render?.pngPreviewPath || page.render?.studentSvgPath;
  if (!preferred || !existsSync(preferred)) return null;
  const dir = resolveMazeArtifactDir(store, projectId);
  if (dir && !isInsideDir(dir, preferred)) {
    throw Object.assign(new Error('Maze preview path left the approved project folder.'), {
      code: 'MAZE_RENDER_PATH_INVALID'
    });
  }
  return preferred;
}

function summarizeMazeProject(store, project) {
  if (!project || project.productFormat !== 'maze') return null;
  const mazeProject = project.mazeProject || getMazeProject(store, project.id);
  const mazeLab = project.mazeLab || getMazeLabState(store, project.id);
  const preset = difficultyPresetByTier(mazeProject.config.difficultyTier);
  return {
    mazeProject,
    mazeLab,
    progress: mazePageProgress(mazeProject, mazeLab),
    theme: mazeProject.config.keyword || mazeProject.config.themeId || project.theme || '',
    ageBand: mazeProject.config.ageBand,
    difficultyLabel: preset?.label || 'Easy',
    difficultyTier: mazeProject.config.difficultyTier
  };
}

function assertMazeProject(store, projectId) {
  const project = typeof store.getProject === 'function' ? store.getProject(projectId) : null;
  assertMazeEngine(project);
  return project;
}

module.exports = {
  MIN_MAZE_PAGE_COUNT,
  MAX_MAZE_PAGE_COUNT,
  DEFAULT_MAZE_PAGE_COUNT,
  mazeLabKey,
  defaultMazeLabState,
  clampMazePageCount,
  getMazeLabState,
  setMazeLabState,
  createMazeSeed,
  pageGenerationSeed,
  shortMazeKeyword,
  titleFromKeyword,
  applyLocalKeywordTheme,
  planMazePages,
  idleMazePage,
  applyPagePlan,
  beginMazeRun,
  finishMazeRun,
  abortMazeGeneration,
  abortAllMazeGeneration: () => abortMazeGeneration(),
  isMazeGenerationRunning,
  mazePageProgress,
  generateMazeBook,
  clearMazePage,
  clearMazePages,
  rerollMazeSeed,
  copyMazeSeed,
  resolveMazePreviewPath,
  summarizeMazeProject,
  assertMazeProject
};
