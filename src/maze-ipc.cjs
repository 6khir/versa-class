'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { extname } = require('node:path');
const { generateMazePage } = require('./maze-service.cjs');
const {
  assertMazeProject,
  beginMazeRun,
  finishMazeRun,
  abortMazeGeneration,
  generateMazeBook,
  clearMazePage,
  clearMazePages,
  rerollMazeSeed,
  setMazeLabState,
  getMazeLabState,
  planMazePages,
  resolveMazePreviewPath,
  clampMazePageCount
} = require('./maze-lab.cjs');

function fail(message, code = 'MAZE_CONTRACT_INVALID') {
  throw Object.assign(new Error(message), { code });
}

function assertOptions(value, label) {
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
    fail(`${label} must be an object.`);
  }
  return value || {};
}

function assertPageId(pageId) {
  if (typeof pageId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(pageId)) {
    fail('Invalid maze page identity.');
  }
  return pageId;
}

function mimeForPath(filePath) {
  switch (extname(String(filePath || '')).toLowerCase()) {
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function serveMazeImage(store, request) {
  try {
    const url = new URL(request?.url || '');
    const [projectId, pageId] = url.pathname.slice(1).split('/').map(decodeURIComponent);
    assertMazeProject(store, projectId);
    assertPageId(pageId);
    const variant = url.searchParams.get('variant') === 'solution' ? 'solution' : 'student';
    const filePath = resolveMazePreviewPath(store, projectId, pageId, variant);
    if (!filePath || !existsSync(filePath)) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(filePath), {
      status: 200,
      headers: {
        'Content-Type': mimeForPath(filePath),
        'Cache-Control': 'private, max-age=86400'
      }
    });
  } catch (error) {
    const status = error?.code === 'MAZE_RENDER_PATH_INVALID' ? 400 : 404;
    return new Response(error?.message || 'Not found', { status });
  }
}

async function runMazeBook(store, projectId, options, { broadcastState, setLiveOperation }) {
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H66',location:'src/maze-ipc.cjs:runMazeBook',message:'maze generate-book ipc entered',data:{projectId,pageCount:options?.pageCount||null,resume:Boolean(options?.resume)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  assertMazeProject(store, projectId);
  const controller = beginMazeRun(projectId);
  if (typeof store.updateProjectStepStatus === 'function') {
    store.updateProjectStepStatus(projectId, 'maze', 'processing');
  }
  setLiveOperation?.({
    kind: 'maze',
    projectId,
    percent: 0,
    message: options.resume ? 'Resuming maze generation…' : 'Generating mazes…'
  });
  try {
    const result = await generateMazeBook(store, projectId, {
      ...options,
      signal: controller.signal,
      skipArtwork: options.skipArtwork !== false,
      onProgress: ({ completed, total, pageId }) => {
        setLiveOperation?.({
          kind: 'maze',
          projectId,
          jobId: pageId,
          percent: total ? Math.round((completed / total) * 100) : 0,
          message: `Maze ${completed} of ${total}…`
        });
        options.onProgress?.({ completed, total, pageId });
        broadcastState?.().catch(() => {});
      }
    });
    if (typeof store.updateProjectStepStatus === 'function') {
      store.updateProjectStepStatus(
        projectId,
        'maze',
        result.cancelled ? 'pending' : result.failed ? 'failed' : 'completed'
      );
    }
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H65',location:'src/maze-ipc.cjs:runMazeBook',message:'maze generate-book ipc finished',data:{projectId,cancelled:Boolean(result.cancelled),failed:Number(result.failed)||0,completed:Number(result.completed)||0,remaining:Number(result.remaining)||0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return result;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H66',location:'src/maze-ipc.cjs:runMazeBook',message:'maze generate-book ipc failed',data:{projectId,error:error?.message||String(error),code:error?.code||null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (typeof store.updateProjectStepStatus === 'function') {
      store.updateProjectStepStatus(projectId, 'maze', controller.signal.aborted ? 'pending' : 'failed');
    }
    throw error;
  } finally {
    finishMazeRun(projectId, controller);
    setLiveOperation?.(null);
    await broadcastState?.();
  }
}

function registerMazeLabIpc({ ipcMain, store, broadcastState, setLiveOperation, onMazeBookReady = null }) {
  ipcMain.handle('maze:generate-page', async (_event, projectId, options) => {
    assertMazeProject(store, projectId);
    const input = assertOptions(options, 'Maze page options');
    if (input.pageId) assertPageId(input.pageId);
    try {
      setLiveOperation?.({
        kind: 'maze',
        projectId,
        jobId: input.pageId || null,
        percent: 0,
        message: 'Regenerating maze…'
      });
      if (typeof store.updateProjectStepStatus === 'function') {
        store.updateProjectStepStatus(projectId, 'maze', 'processing');
      }
      const salt = input.keepSeed ? '' : `r${Date.now().toString(36)}`;
      const project = require('./maze-service.cjs').getMazeProject(store, projectId);
      const pageSeed = input.pageSeed || [project.config.seed, input.pageId, salt].filter(Boolean).join(':');
      const result = await generateMazePage(store, projectId, {
        ...input,
        pageSeed,
        skipArtwork: input.skipArtwork !== false
      });
      const pages = result.mazeProject.pages || [];
      const ready = pages.filter((page) => page.generationStatus === 'ready').length;
      if (typeof store.updateProjectStepStatus === 'function') {
        store.updateProjectStepStatus(projectId, 'maze', ready && ready === pages.length ? 'completed' : 'pending');
      }
      if (input.persistRender !== false) {
        await require('./maze-export.cjs').syncMazeExportJobs(store, projectId);
      }
      return result;
    } finally {
      setLiveOperation?.(null);
      await broadcastState?.();
    }
  });

  ipcMain.handle('maze:generate-book', async (_event, projectId, options) => {
    const input = assertOptions(options, 'Maze generate options');
    const result = await runMazeBook(store, projectId, input, { broadcastState, setLiveOperation });
    if (!result.cancelled && !result.failed && !result.remaining && typeof onMazeBookReady === 'function') {
      await onMazeBookReady(projectId, result);
    }
    return result;
  });

  ipcMain.handle('maze:continue-pipeline', async (_event, projectId) => {
    assertMazeProject(store, projectId);
    if (typeof onMazeBookReady === 'function') return onMazeBookReady(projectId, { complete: true });
    return { assembled: false };
  });

  ipcMain.handle('maze:cancel', async (_event, projectId) => {
    assertMazeProject(store, projectId);
    const cancelled = abortMazeGeneration(projectId);
    if (cancelled && typeof store.updateProjectStepStatus === 'function') {
      store.updateProjectStepStatus(projectId, 'maze', 'pending');
    }
    await broadcastState?.();
    return { cancelled };
  });

  ipcMain.handle('maze:clear-page', async (_event, projectId, pageId) => {
    assertMazeProject(store, projectId);
    assertPageId(pageId);
    const mazeProject = clearMazePage(store, projectId, pageId);
    if (typeof store.updateProjectStepStatus === 'function') {
      store.updateProjectStepStatus(projectId, 'maze', 'pending');
    }
    await broadcastState?.();
    return mazeProject;
  });

  ipcMain.handle('maze:clear-all', async (_event, projectId) => {
    assertMazeProject(store, projectId);
    const mazeProject = clearMazePages(store, projectId);
    if (typeof store.updateProjectStepStatus === 'function') {
      store.updateProjectStepStatus(projectId, 'maze', 'pending');
    }
    await broadcastState?.();
    return mazeProject;
  });

  ipcMain.handle('maze:reroll-seed', async (_event, projectId) => {
    assertMazeProject(store, projectId);
    const mazeProject = rerollMazeSeed(store, projectId);
    await broadcastState?.();
    return mazeProject;
  });

  ipcMain.handle('maze:set-lab', async (_event, projectId, lab) => {
    assertMazeProject(store, projectId);
    const input = assertOptions(lab, 'Maze lab state');
    const mazeLab = setMazeLabState(store, projectId, input);
    if (Object.hasOwn(input, 'pageCount') || Object.hasOwn(input, 'includeAnswerKey')) {
      if (Object.hasOwn(input, 'pageCount')) {
        planMazePages(store, projectId, clampMazePageCount(input.pageCount));
      }
      await require('./maze-export.cjs').syncMazeExportJobs(store, projectId);
    }
    await broadcastState?.();
    return { mazeLab, mazeProject: require('./maze-service.cjs').getMazeProject(store, projectId) };
  });
}

module.exports = {
  registerMazeLabIpc,
  serveMazeImage,
  getMazeLabState,
  runMazeBook
};
