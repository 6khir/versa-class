'use strict';

const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');
const { runOperation, waitForRetry } = require('./generation-control.cjs');
const { PAGE_ROLES } = require('./maze-contract.cjs');
const {
  DEFAULT_THEME_ID,
  MAZE_FRAME_JOB_KIND,
  MAZE_THEME_PROMPT_KIND,
  buildMazeFrameImagePrompt,
  buildMazeThemePrompt,
  fallbackMazeTheme,
  mapMazeThemeResponse,
  resolveFrameVariantId,
  sanitizeThemeId
} = require('./maze-prompts.cjs');

const MAX_MAZE_REMOTE_IN_FLIGHT = 2;
const MAZE_REMOTE_ATTEMPTS = 3;
const MAZE_RETRY_DELAY_MS = 4000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function mazeArtworkKey(projectId) {
  return `mazeArtwork:${projectId}`;
}

function isInsideDir(root, filePath) {
  const relativePath = relative(resolve(root), resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function artworkCacheKey({ themeId, pageRole, frameVariantId, sequenceIndex } = {}) {
  const theme = sanitizeThemeId(themeId);
  const role = pageRole || PAGE_ROLES.MAZE_INTERIOR;
  const variant = resolveFrameVariantId(frameVariantId, role, sequenceIndex);
  return `${theme}:${role}:${variant}`;
}

function frameFileName(key) {
  return `frame-${String(key).replace(/[^a-z0-9.-]+/gi, '-')}.png`;
}

function emptyArtworkIndex() {
  return { schemaVersion: 1, entries: {} };
}

function loadArtworkIndex(store, projectId) {
  const stored = store?.getSetting?.(mazeArtworkKey(projectId), null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return emptyArtworkIndex();
  const entries = stored.entries && typeof stored.entries === 'object' && !Array.isArray(stored.entries)
    ? stored.entries
    : {};
  return { schemaVersion: 1, entries: { ...entries } };
}

function persistArtworkIndex(store, projectId, index) {
  if (!store?.setSetting) return index;
  store.setSetting(mazeArtworkKey(projectId), index);
  return index;
}

function resolveMazeArtifactDir(store, projectId) {
  try {
    const { projectWorkspaceDir } = require('./project-workspace.cjs');
    const workspace = projectWorkspaceDir(projectId);
    if (workspace) return join(workspace, 'maze');
  } catch {
    // Workspace helper is optional WIP; fall back to the project output folder.
  }
  const project = typeof store?.getProject === 'function' ? store.getProject(projectId) : null;
  if (project?.outputDir) return join(project.outputDir, 'maze');
  return null;
}

function resolveApprovedFramePath(store, projectId, filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (filePath.includes('://')) return null;
  const dir = resolveMazeArtifactDir(store, projectId);
  if (!dir) return null;
  const resolved = resolve(filePath);
  if (!isInsideDir(dir, resolved) && resolve(dir) !== resolved) return null;
  return existsSync(resolved) ? resolved : null;
}

function isPngBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

async function normalizeFrameBuffer(raw) {
  if (typeof raw === 'string') {
    if (raw.includes('://') || /<svg\b/i.test(raw)) {
      throw Object.assign(new Error('Decorative frames must be local raster images.'), {
        code: 'MAZE_ARTWORK_INVALID'
      });
    }
  }
  if (!Buffer.isBuffer(raw)) {
    throw Object.assign(new Error('Decorative frame was not an image buffer.'), {
      code: 'MAZE_ARTWORK_INVALID'
    });
  }
  if (raw.includes(Buffer.from('<svg')) || raw.includes(Buffer.from('http://')) || raw.includes(Buffer.from('https://'))) {
    throw Object.assign(new Error('Decorative frames cannot fetch remote SVG.'), {
      code: 'MAZE_ARTWORK_INVALID'
    });
  }
  const sharp = require('sharp');
  const png = await sharp(raw, { failOn: 'warning' }).rotate().png().toBuffer();
  if (!isPngBuffer(png)) {
    throw Object.assign(new Error('Decorative frame was not a PNG.'), { code: 'MAZE_ARTWORK_INVALID' });
  }
  return png;
}

function shouldRetryProvider(error) {
  if (!error) return false;
  if (error.retryable === false) return false;
  if (['QUEUE_PAUSED', 'AUTH_REQUIRED', 'PROMPT_NOT_READY'].includes(error.code)) return false;
  return true;
}

async function runMazeRemote(work, options = {}) {
  const attempts = Math.max(1, options.remoteAttempts ?? MAZE_REMOTE_ATTEMPTS);
  const delayMs = options.retryDelayMs ?? MAZE_RETRY_DELAY_MS;
  const signal = options.signal;
  const phase = options.phase || 'maze artwork';
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runOperation(work, {
        signal,
        timeoutMs: options.timeoutMs ?? 120000,
        phase
      });
    } catch (error) {
      lastError = error;
      if (!shouldRetryProvider(error) || attempt === attempts) break;
      await waitForRetry(delayMs * attempt, signal);
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let live = 0;
  let peak = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      live += 1;
      peak = Math.max(peak, live);
      try {
        results[index] = await fn(items[index], index);
      } finally {
        live -= 1;
      }
    }
  }));
  return { results, peak };
}

async function directMazeTheme(provider, input = {}, options = {}) {
  if (typeof provider?.generateText !== 'function') {
    return fallbackMazeTheme(input, 'provider_missing');
  }
  try {
    const prompt = buildMazeThemePrompt(input);
    const raw = await runMazeRemote(() => provider.generateText(prompt, {
      promptKind: MAZE_THEME_PROMPT_KIND
    }), { ...options, phase: 'maze theme' });
    return mapMazeThemeResponse(raw, input);
  } catch {
    return fallbackMazeTheme(input, 'provider_failed');
  }
}

function readCachedFrame(store, projectId, spec) {
  const key = artworkCacheKey(spec);
  const index = loadArtworkIndex(store, projectId);
  const entry = index.entries[key];
  const path = resolveApprovedFramePath(store, projectId, entry?.path);
  if (!path) return null;
  return { key, path, cached: true, fallback: false, reason: null };
}

function rememberFrame(store, projectId, spec, filePath) {
  const key = artworkCacheKey(spec);
  const index = loadArtworkIndex(store, projectId);
  index.entries[key] = {
    themeId: sanitizeThemeId(spec.themeId),
    pageRole: spec.pageRole || PAGE_ROLES.MAZE_INTERIOR,
    frameVariantId: resolveFrameVariantId(spec.frameVariantId, spec.pageRole, spec.sequenceIndex),
    path: filePath
  };
  persistArtworkIndex(store, projectId, index);
  return { key, path: filePath, cached: false, fallback: false, reason: null };
}

function fallbackFrame(reason) {
  return { key: null, path: null, cached: false, fallback: true, reason };
}

async function generateFrameImage(provider, spec, options = {}) {
  if (typeof provider?.generateImage !== 'function') {
    throw Object.assign(new Error('A frame image provider is required.'), {
      code: 'MAZE_ARTWORK_PROVIDER_MISSING',
      retryable: false
    });
  }
  const prompt = buildMazeFrameImagePrompt(spec);
  const raw = await runMazeRemote(() => provider.generateImage(prompt, {
    promptKind: MAZE_FRAME_JOB_KIND
  }), { ...options, phase: 'maze frame' });
  return normalizeFrameBuffer(raw);
}

async function ensureMazeFrame(store, projectId, spec = {}, options = {}) {
  const cached = readCachedFrame(store, projectId, spec);
  if (cached) return cached;
  const dir = resolveMazeArtifactDir(store, projectId);
  if (!dir) return fallbackFrame('no_artifact_dir');
  if (typeof options.provider?.generateImage !== 'function') return fallbackFrame('provider_missing');

  try {
    const png = await generateFrameImage(options.provider, spec, options);
    const framesDir = join(dir, 'frames');
    mkdirSync(framesDir, { recursive: true });
    const filePath = join(framesDir, frameFileName(artworkCacheKey(spec)));
    if (!isInsideDir(dir, filePath)) {
      return fallbackFrame('path_invalid');
    }
    writeFileSync(filePath, png);
    return rememberFrame(store, projectId, spec, filePath);
  } catch {
    return fallbackFrame('provider_failed');
  }
}

async function ensureMazeFrames(store, projectId, pages = [], options = {}) {
  const limit = Math.max(1, Math.min(MAX_MAZE_REMOTE_IN_FLIGHT, options.remoteLimit ?? MAX_MAZE_REMOTE_IN_FLIGHT));
  const items = (Array.isArray(pages) ? pages : []).map((page, index) => ({
    sequenceIndex: page.sequenceIndex || index + 1,
    pageId: page.pageId || null,
    themeId: page.themeId || DEFAULT_THEME_ID,
    pageRole: page.pageRole || PAGE_ROLES.MAZE_INTERIOR,
    frameVariantId: resolveFrameVariantId(page.frameVariantId, page.pageRole, page.sequenceIndex || index + 1),
    framePrompt: page.framePrompt || ''
  }));
  const { results, peak } = await mapLimit(items, limit, async (item) => {
    const artwork = await ensureMazeFrame(store, projectId, item, options);
    return { ...item, ...artwork };
  });
  const ordered = results
    .filter(Boolean)
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  return { pages: ordered, peak, remoteLimit: limit };
}

module.exports = {
  MAX_MAZE_REMOTE_IN_FLIGHT,
  MAZE_REMOTE_ATTEMPTS,
  MAZE_RETRY_DELAY_MS,
  MAZE_FRAME_JOB_KIND,
  mazeArtworkKey,
  artworkCacheKey,
  resolveApprovedFramePath,
  directMazeTheme,
  ensureMazeFrame,
  ensureMazeFrames,
  loadArtworkIndex
};
