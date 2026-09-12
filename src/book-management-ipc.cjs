'use strict';

const { mkdirSync } = require('node:fs');
const service = require('./book-management-service.cjs');
const bridge = require('./book-management-bridge.cjs');
const root = require('./book-management-root.cjs');

function ipcError(error) {
  const next = error instanceof Error ? error : new Error(String(error || 'Versa Management failed.'));
  if (!next.code) next.code = 'MANAGEMENT_UNAVAILABLE';
  return next;
}

function readRootPath(store, deps = {}) {
  return root.discoverRoot({
    store,
    home: deps.home || service.serviceDir(),
    env: deps.env || process.env
  });
}

async function syncPluginRoot(rootPath, deps = {}) {
  const setRoot = deps.setPluginRoot || bridge.setPluginRoot;
  try {
    return await setRoot(rootPath, {
      baseUrl: deps.url || service.BASE_URL,
      fetchImpl: deps.fetchImpl
    });
  } catch {
    return { ok: false };
  }
}

async function ensureService(deps = {}) {
  const store = deps.store;
  const tptPath = deps.tptPath || readRootPath(store);
  const ensure = deps.ensureRunning || service.ensureRunning;
  const state = await ensure({ tptPath });
  if (!state?.ok) {
    throw Object.assign(new Error(state?.error || 'Versa Management is not running. Open Versa Management to start it.'), {
      code: state?.code || 'MANAGEMENT_UNAVAILABLE'
    });
  }
  return { ...state, url: state.url || service.BASE_URL, rootPath: tptPath };
}

async function listPicker(query, deps = {}) {
  const state = await ensureService(deps);
  const load = deps.loadExportPicker || bridge.loadExportPicker;
  const picker = await load(query, { baseUrl: state.url, fetchImpl: deps.fetchImpl });
  return { ...picker, url: state.url, running: true };
}

async function exportToManagementFolder({
  project,
  destination,
  exportMode,
  fileManager,
  store,
  bookName
} = {}, deps = {}) {
  const dest = (deps.requireDestination || bridge.requireManagementDestination)(destination);
  mkdirSync(dest.bookPath, { recursive: true });
  if (dest.smmPath) mkdirSync(dest.smmPath, { recursive: true });
  const result = await fileManager.exportFinalPackageDirectory(project, dest.bookPath, {
    exportMode,
    store
  });
  let registered = { ok: false, notion: false, payload: bridge.buildRegisterPayload(dest, bookName || project?.name) };
  try {
    const register = deps.registerExport || bridge.registerExport;
    registered = await register(dest, bookName || project?.name, { fetchImpl: deps.fetchImpl });
  } catch (error) {
    registered = {
      ok: false,
      notion: false,
      error: error.message,
      payload: bridge.buildRegisterPayload(dest, bookName || project?.name)
    };
  }
  return {
    exportDirectory: dest.bookPath,
    destination: dest,
    result,
    registered
  };
}

function registerBookManagementIpc({
  ipcMain,
  fileManager,
  store,
  broadcastState,
  deps = {}
} = {}) {
  if (!ipcMain?.handle) return;

  ipcMain.handle('book-management:status', async () => {
    const current = (deps.status || service.status)();
    current.running = await (deps.ping || service.ping)();
    current.rootPath = readRootPath(store, deps);
    current.needsFirstRun = root.needsFirstRun(current.rootPath);
    return current;
  });

  ipcMain.handle('book-management:ensure', async () => ensureService({ ...deps, store }));

  ipcMain.handle('book-management:choose-root', async () => {
    const dialogImpl = deps.dialog || require('electron').dialog;
    const browserWindow = deps.browserWindow || require('electron').BrowserWindow?.getFocusedWindow?.();
    const choice = await dialogImpl.showOpenDialog(browserWindow || undefined, {
      title: 'Choose folders',
      properties: ['openDirectory', 'createDirectory']
    });
    if (choice?.canceled || !choice?.filePaths?.[0]) {
      return { ok: false, cancelled: true, rootPath: readRootPath(store, deps), needsFirstRun: root.needsFirstRun(readRootPath(store, deps)) };
    }
    const rootPath = String(choice.filePaths[0]).trim();
    const home = deps.home || service.serviceDir();
    const slots = (deps.applyRoot || root.applyRoot)(store, rootPath, {
      home,
      count: 1000,
      bootstrap: true
    });
    let url = service.BASE_URL;
    try {
      const state = await ensureService({ ...deps, store, tptPath: rootPath });
      url = state.url || url;
      await syncPluginRoot(rootPath, { ...deps, url });
    } catch {
      /* Folder picker and local slots already succeeded. Flask is optional. */
    }
    return {
      ok: true,
      rootPath,
      url,
      needsFirstRun: false,
      created: Number(slots.created) || 0,
      count: Number(slots.count) || 1000,
      first: slots.first || 'P0001',
      last: slots.last || 'P1000'
    };
  });

  ipcMain.handle('book-management:list', async (_event, query = '') => {
    try {
      return await listPicker(query, { ...deps, store });
    } catch (error) {
      throw ipcError(error);
    }
  });

  ipcMain.handle('book-management:available-folder', async () => {
    try {
      const state = await ensureService({ ...deps, store });
      const available = deps.availableFolder || bridge.availableFolder;
      return {
        ...await available({ baseUrl: state.url, fetchImpl: deps.fetchImpl }),
        url: state.url
      };
    } catch (error) {
      throw ipcError(error);
    }
  });

  ipcMain.handle('book-management:register', async (_event, payload = {}) => {
    try {
      const register = deps.registerExport || bridge.registerExport;
      return await register(payload, payload.book_name || payload.bookName, { fetchImpl: deps.fetchImpl });
    } catch (error) {
      throw ipcError(error);
    }
  });

  ipcMain.handle('book-management:export', async (_event, input = {}) => {
    try {
      const project = store.getProject(input.projectId);
      if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
      const exported = await exportToManagementFolder({
        project,
        destination: input.managementDestination || input.destination,
        exportMode: input.exportMode,
        fileManager,
        store,
        bookName: input.bookName || project.name
      }, deps);
      store.appendEvent({
        projectId: project.id,
        level: 'success',
        message: exported.registered?.ok
          ? `Exported to Versa Management ${exported.destination.productId}: ${exported.exportDirectory}`
          : `Exported to ${exported.exportDirectory}. Open Versa Management to finish linking.`
      });
      await broadcastState?.();
      return exported;
    } catch (error) {
      throw ipcError(error);
    }
  });
}

module.exports = {
  registerBookManagementIpc,
  exportToManagementFolder,
  listPicker,
  ensureService,
  readRootPath,
  syncPluginRoot
};
