'use strict';

/**
 * Phase 3B — Video state isolation (compatibility layer)
 *
 * Persistence (no schema change):
 *   Migration target: tptListing.video = { path, status, error, conversationUrl }
 *   Legacy mirror:    videoPreviewPath / videoPreviewStatus /
 *                     videoPreviewError / videoPreviewConversationUrl
 *
 * Dual-write: every intentional Video write updates BOTH representations.
 * Dual-read: getVideo() reconciles; new state is NOT yet sole authority.
 *
 * Filesystem authority:
 *   A completed video requires an actually existing MP4 on disk.
 *   status === "ready" alone is never sufficient.
 *
 * Reconciliation rule (documented + tested):
 *   1. Prefer an actually existing filesystem path over a nonexistent path.
 *   2. If both paths exist, prefer new state (listing.video).
 *   3. If new state is absent, use legacy videoPreview* fields.
 *   4. Preserve status/error/conversation metadata without fabricating readiness.
 *   5. Never invent an MP4 path.
 *   6. Never mark a nonexistent MP4 as ready in the returned shape.
 *   7. Writes always dual-write; never silently destroy the other side.
 */

const { existsSync: defaultExistsSync } = require('node:fs');

const VIDEO_STATUSES = new Set(['pending', 'generating', 'ready', 'failed']);

function emptyVideo() {
  return {
    path: null,
    status: 'pending',
    error: null,
    conversationUrl: null
  };
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return VIDEO_STATUSES.has(value) ? value : 'pending';
}

function normalizeVideo(input = {}) {
  const path = input.path ? String(input.path) : null;
  return {
    path,
    status: normalizeStatus(input.status),
    error: input.error ? String(input.error) : null,
    conversationUrl: input.conversationUrl ? String(input.conversationUrl) : null
  };
}

function legacyVideoFromListing(listing = {}) {
  const path = listing.videoPreviewPath ? String(listing.videoPreviewPath) : null;
  let status = listing.videoPreviewStatus;
  if (!status && path) status = 'ready';
  return normalizeVideo({
    path,
    status: status || 'pending',
    error: listing.videoPreviewError,
    conversationUrl: listing.videoPreviewConversationUrl
  });
}

function hasNewVideoState(listing) {
  return Boolean(listing && typeof listing === 'object' && listing.video && typeof listing.video === 'object');
}

function pathExists(filePath, existsSync) {
  return Boolean(filePath && existsSync(filePath));
}

/**
 * Demote fabricated readiness: status "ready" without an existing file is not ready.
 */
function withoutFabricatedReady(video, existsSync) {
  const next = normalizeVideo(video);
  if (next.status === 'ready' && !pathExists(next.path, existsSync)) {
    next.status = next.path ? 'failed' : 'pending';
    if (next.path && !next.error) {
      next.error = 'Preview video file is missing on disk.';
    }
  }
  return next;
}

/**
 * Read Video state with legacy fallback + FS-aware reconciliation.
 * Does not mutate the project.
 */
function getVideo(project, { existsSync = defaultExistsSync } = {}) {
  const listing = project?.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {};
  const legacy = legacyVideoFromListing(listing);
  if (!hasNewVideoState(listing)) {
    return withoutFabricatedReady(legacy, existsSync);
  }

  const neu = normalizeVideo(listing.video);
  const neuOk = pathExists(neu.path, existsSync);
  const legOk = pathExists(legacy.path, existsSync);

  let chosen;
  if (neuOk && legOk) {
    // CASE: both valid → prefer new
    chosen = neu;
  } else if (!neuOk && legOk) {
    // CASE: new nonexistent, legacy filesystem-valid → prefer legacy reality
    chosen = {
      ...neu,
      path: legacy.path,
      status: legacy.status,
      error: legacy.error,
      conversationUrl: neu.conversationUrl || legacy.conversationUrl
    };
  } else if (neuOk && !legOk) {
    chosen = neu;
  } else if (!neu.path && legacy.path) {
    chosen = {
      ...neu,
      path: legacy.path,
      status: neu.status !== 'pending' ? neu.status : legacy.status,
      error: neu.error != null ? neu.error : legacy.error,
      conversationUrl: neu.conversationUrl || legacy.conversationUrl
    };
  } else {
    // Prefer new when neither file exists (equal FS validity)
    chosen = {
      path: neu.path || legacy.path,
      status: neu.status !== 'pending' ? neu.status : legacy.status,
      error: neu.error != null ? neu.error : legacy.error,
      conversationUrl: neu.conversationUrl || legacy.conversationUrl
    };
  }

  return withoutFabricatedReady(chosen, existsSync);
}

/**
 * Dual-write Video into a listing object (nested + legacy flat fields).
 */
function applyVideoToListing(listing, videoPatch = {}, listingExtras = {}) {
  const base = listing && typeof listing === 'object' ? { ...listing } : {};
  const current = getVideo({ tptListing: base });
  const next = normalizeVideo({
    ...current,
    ...videoPatch,
    path: Object.prototype.hasOwnProperty.call(videoPatch, 'path') ? videoPatch.path : current.path,
    status: Object.prototype.hasOwnProperty.call(videoPatch, 'status') ? videoPatch.status : current.status,
    error: Object.prototype.hasOwnProperty.call(videoPatch, 'error') ? videoPatch.error : current.error,
    conversationUrl: Object.prototype.hasOwnProperty.call(videoPatch, 'conversationUrl')
      ? videoPatch.conversationUrl
      : current.conversationUrl
  });

  return {
    ...base,
    ...listingExtras,
    video: next,
    videoPreviewPath: next.path,
    videoPreviewStatus: next.status,
    videoPreviewError: next.error,
    videoPreviewConversationUrl: next.conversationUrl
  };
}

/**
 * Ensure both representations exist after an external listing mutation
 * that may have touched only legacy videoPreview* fields (or only video).
 */
function mirrorVideoOnListing(listing, { existsSync = defaultExistsSync } = {}) {
  if (!listing || typeof listing !== 'object') return listing;
  const reconciled = getVideo({ tptListing: listing }, { existsSync });
  return applyVideoToListing(listing, reconciled);
}

function setVideo(store, projectId, video, {
  listingExtras = {},
  projectExtras = {}
} = {}) {
  const project = store.getProject(projectId);
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  const listing = applyVideoToListing(project.tptListing, video, listingExtras);
  return store.updateProject(projectId, {
    tptListing: listing,
    ...projectExtras
  });
}

function updateVideo(store, projectId, patch, options = {}) {
  const project = store.getProject(projectId);
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  const current = getVideo(project, { existsSync: options.existsSync || defaultExistsSync });
  return setVideo(store, projectId, {
    ...current,
    ...patch
  }, options);
}

/** True only when a real file exists on disk (filesystem authority). */
function hasValidVideoFile(project, { existsSync = defaultExistsSync } = {}) {
  const video = getVideo(project, { existsSync });
  return pathExists(video.path, existsSync);
}

function enrichProjectWithVideo(project, options = {}) {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    video: getVideo(project, options)
  };
}

module.exports = {
  emptyVideo,
  normalizeVideo,
  getVideo,
  applyVideoToListing,
  mirrorVideoOnListing,
  setVideo,
  updateVideo,
  hasValidVideoFile,
  enrichProjectWithVideo,
  legacyVideoFromListing,
  hasNewVideoState,
  pathExists
};
