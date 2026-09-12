'use strict';

/**
 * Phase 3A — Mockups state isolation (compatibility layer)
 *
 * Persistence (no schema change):
 *   Migration target: tptListing.mockups = { paths, briefs, progress, conversationUrl, error, mode }
 *   Legacy mirror:    tptListing.thumbnailPaths / thumbnailBriefs / thumbnailProgress /
 *                     thumbnailConversationUrl / thumbnailError / thumbnailMode
 *
 * Dual-write: every intentional Mockups write updates BOTH representations.
 * Dual-read: getMockups() reconciles; does not declare the new shape sole authority yet.
 *
 * Reconciliation rule (documented + tested):
 *   1. Prefer a path list with more filesystem-backed existing files.
 *   2. Prefer new state (listing.mockups) when FS validity is equal.
 *   3. Prefer legacy thumbnail* when new state is absent.
 *   4. Never invent completion: callers still must filter with existsSync for “complete”.
 *   5. Never silently destroy the other side on write — dual-write always.
 */

const { existsSync: defaultExistsSync } = require('node:fs');

const MOCKUP_SLOT_TOTAL = 4;
const THUMBNAIL_MODES = new Set(['auto', 'manual', 'later']);

function emptyMockups() {
  return {
    paths: [],
    briefs: [],
    progress: { completed: 0, total: MOCKUP_SLOT_TOTAL },
    conversationUrl: null,
    error: null,
    mode: 'manual'
  };
}

function normalizeMode(mode) {
  return THUMBNAIL_MODES.has(mode) ? mode : 'manual';
}

function normalizeProgress(progress, paths) {
  const total = Number(progress?.total) > 0 ? Number(progress.total) : MOCKUP_SLOT_TOTAL;
  const completedFromProgress = Number(progress?.completed);
  const completed = Number.isFinite(completedFromProgress)
    ? Math.max(0, Math.min(total, completedFromProgress))
    : (Array.isArray(paths) ? paths.filter(Boolean).length : 0);
  return { completed, total };
}

function normalizeMockups(input = {}) {
  const paths = Array.isArray(input.paths) ? [...input.paths] : [];
  const briefs = Array.isArray(input.briefs) ? [...input.briefs] : [];
  return {
    paths,
    briefs,
    progress: normalizeProgress(input.progress, paths),
    conversationUrl: input.conversationUrl ? String(input.conversationUrl) : null,
    error: input.error ? String(input.error) : null,
    mode: normalizeMode(input.mode)
  };
}

function legacyMockupsFromListing(listing = {}) {
  return normalizeMockups({
    paths: listing.thumbnailPaths,
    briefs: listing.thumbnailBriefs,
    progress: listing.thumbnailProgress,
    conversationUrl: listing.thumbnailConversationUrl,
    error: listing.thumbnailError,
    mode: listing.thumbnailMode
  });
}

function hasNewMockupsState(listing) {
  return Boolean(listing && typeof listing === 'object' && listing.mockups && typeof listing.mockups === 'object');
}

function countExistingPaths(paths, existsSync) {
  return (Array.isArray(paths) ? paths : []).filter((filePath) => filePath && existsSync(filePath)).length;
}

function pathsEqual(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] || null) !== (b[i] || null)) return false;
  }
  return true;
}

/**
 * Read Mockups state with legacy fallback + FS-aware reconciliation.
 * Does not mutate the project.
 */
function getMockups(project, { existsSync = defaultExistsSync } = {}) {
  const listing = project?.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {};
  const legacy = legacyMockupsFromListing(listing);
  if (!hasNewMockupsState(listing)) {
    return legacy;
  }

  const neu = normalizeMockups(listing.mockups);
  const neuValid = countExistingPaths(neu.paths, existsSync);
  const legValid = countExistingPaths(legacy.paths, existsSync);

  let paths = neu.paths;
  let progress = neu.progress;

  if (neuValid === 0 && legValid > 0) {
    // CASE D: new points at missing files; legacy still has real files.
    paths = legacy.paths;
    progress = legacy.progress;
  } else if (legValid > neuValid) {
    paths = legacy.paths;
    progress = legacy.progress;
  } else {
    // Prefer new when equal or better (CASE A / C).
    paths = neu.paths;
    progress = neu.progress;
  }

  return normalizeMockups({
    paths,
    briefs: neu.briefs.length ? neu.briefs : legacy.briefs,
    progress,
    conversationUrl: neu.conversationUrl || legacy.conversationUrl,
    error: neu.error != null ? neu.error : legacy.error,
    mode: neu.mode || legacy.mode
  });
}

/**
 * Dual-write Mockups into a listing object (nested + legacy flat fields).
 * listingExtras may include non-mockup listing fields (e.g. status).
 */
function applyMockupsToListing(listing, mockupsPatch = {}, listingExtras = {}) {
  const base = listing && typeof listing === 'object' ? { ...listing } : {};
  const current = getMockups({ tptListing: base });
  const next = normalizeMockups({
    ...current,
    ...mockupsPatch,
    paths: Object.prototype.hasOwnProperty.call(mockupsPatch, 'paths') ? mockupsPatch.paths : current.paths,
    briefs: Object.prototype.hasOwnProperty.call(mockupsPatch, 'briefs') ? mockupsPatch.briefs : current.briefs,
    progress: Object.prototype.hasOwnProperty.call(mockupsPatch, 'progress') ? mockupsPatch.progress : current.progress,
    conversationUrl: Object.prototype.hasOwnProperty.call(mockupsPatch, 'conversationUrl')
      ? mockupsPatch.conversationUrl
      : current.conversationUrl,
    error: Object.prototype.hasOwnProperty.call(mockupsPatch, 'error') ? mockupsPatch.error : current.error,
    mode: Object.prototype.hasOwnProperty.call(mockupsPatch, 'mode') ? mockupsPatch.mode : current.mode
  });

  return {
    ...base,
    ...listingExtras,
    mockups: next,
    thumbnailPaths: next.paths,
    thumbnailBriefs: next.briefs,
    thumbnailProgress: next.progress,
    thumbnailConversationUrl: next.conversationUrl,
    thumbnailError: next.error,
    thumbnailMode: next.mode
  };
}

/**
 * Ensure both representations exist and agree after an external listing mutation
 * that may have touched only legacy thumbnail* fields (or only mockups).
 */
function mirrorMockupsOnListing(listing, { existsSync = defaultExistsSync } = {}) {
  if (!listing || typeof listing !== 'object') return listing;
  const reconciled = getMockups({ tptListing: listing }, { existsSync });
  return applyMockupsToListing(listing, reconciled);
}

function setMockups(store, projectId, mockups, {
  listingExtras = {},
  projectExtras = {},
  existsSync = defaultExistsSync
} = {}) {
  const project = store.getProject(projectId);
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  const listing = applyMockupsToListing(project.tptListing, mockups, listingExtras);
  // Re-run getMockups semantics is already applied; keep dual-write explicit.
  void existsSync;
  return store.updateProject(projectId, {
    tptListing: listing,
    ...projectExtras
  });
}

function updateMockups(store, projectId, patch, options = {}) {
  const project = store.getProject(projectId);
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  const current = getMockups(project, { existsSync: options.existsSync || defaultExistsSync });
  return setMockups(store, projectId, {
    ...current,
    ...patch,
    paths: Object.prototype.hasOwnProperty.call(patch, 'paths') ? patch.paths : current.paths,
    briefs: Object.prototype.hasOwnProperty.call(patch, 'briefs') ? patch.briefs : current.briefs
  }, options);
}

function countValidMockupPaths(project, { existsSync = defaultExistsSync } = {}) {
  return countExistingPaths(getMockups(project, { existsSync }).paths, existsSync);
}

function enrichProjectWithMockups(project, options = {}) {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    mockups: getMockups(project, options)
  };
}

module.exports = {
  MOCKUP_SLOT_TOTAL,
  emptyMockups,
  normalizeMockups,
  getMockups,
  applyMockupsToListing,
  mirrorMockupsOnListing,
  setMockups,
  updateMockups,
  countValidMockupPaths,
  countExistingPaths,
  pathsEqual,
  enrichProjectWithMockups,
  legacyMockupsFromListing,
  hasNewMockupsState
};
