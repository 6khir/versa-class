const api = window.tptDesktop;

async function openLoginSession(options = {}) {
  if (typeof api?.openLoginBrowser === 'function') return api.openLoginBrowser(options);
  if (typeof api?.launchBrowser === 'function') return api.launchBrowser();
  throw new Error('Restart the app.');
}

async function verifyLoginSession(options = {}) {
  if (typeof api?.verifyChatGptLogin === 'function') return api.verifyChatGptLogin(options);
  throw new Error('Restart the app.');
}

// Stages that exist only in the editable pipeline, in run order.
const EDITABLE_ONLY_STAGES = ['interior_artwork', 'interior_text', 'editable_ppt'];

// Readable names for pipeline steps, used by the hero control and the automation bar so
// both name the same step the same way.
const STEP_LABELS = {
  overview: 'Overview',
  characters: 'Characters',
  interior: 'Pages Lab',
  interior_artwork: 'Pages Lab',
  interior_text: 'Text Lab',
  editable_ppt: 'Editable Lab',
  editable_generation: 'Editable Lab',
  maze: 'Maze Lab',
  thumbnails: 'Mockups Lab',
  mockups: 'Mockups Lab',
  preview: 'Preview Lab',
  export: 'Export'
};

const STATUS_LABELS = {
  pending: 'Pending',
  preparing: 'Preparing',
  submitted: 'Submitted',
  generating: 'Generating',
  downloading: 'Downloading',
  validating: 'Validating',
  complete: 'Complete',
  edit_pending: 'Queued',
  retry_wait: 'Retry',
  rate_limit_paused: 'Usage limit',
  needs_user_action: 'Attention'
};

const PROJECT_STATUS_LABELS = {
  draft: 'Ready',
  running: 'Running',
  paused: 'Paused',
  rate_limit_paused: 'Usage limit',
  complete: 'Complete'
};

let state = null;
let selectedJobId = null;
let lastPagesScrollId = null;
let currentFilter = 'all';
let lastHeartbeatAt = null;
let editingJobId = null;
let authManagerOpenedManually = false;
let authTarget = 'gemini';
let activeWorkspaceView = 'overview';
let lastRenderedWorkspaceView = null;
let selectedMazePageId = null;
let mazePreviewVariant = 'student';
const WORKSPACE_PANES = ['overview', 'characters', 'interior', 'interior_artwork', 'interior_text', 'editable_ppt', 'maze', 'editable', 'thumbnails', 'preview', 'export'];
let activeSettingsTab = 'profile';
let imagePreviewItems = [];
let imagePreviewIndex = 0;
let bundleViewActive = false;
let mazeWorkspaceOpen = false;
let mazeAutoGenerateId = null;

const elements = Object.fromEntries([
  'update-button', 'update-label', 'browser-pill', 'browser-label', 'focus-browser-button', 'launch-browser-button',
  'settings-profile-button', 'settings-profile-avatar', 'settings-profile-label', 'settings-dialog', 'settings-form',
  'settings-close-button', 'settings-profile-large-avatar',
  'settings-current-version', 'settings-update-status-badge', 'settings-update-message',
  'settings-update-progress-container', 'settings-update-progress-fill', 'settings-update-progress-text',
  'settings-update-last-checked', 'settings-check-update-btn', 'settings-install-update-btn',
  'settings-management-root', 'settings-management-pick-folders',
  'settings-default-format',
  'settings-default-orientation', 'settings-when-complete', 'settings-save-button', 'settings-save-note',
  'settings-chatgpt-card', 'settings-chatgpt-status', 'settings-chatgpt-profile', 'settings-chatgpt-verified',
  'settings-chatgpt-logout', 'settings-chatgpt-profile-select', 'settings-selected-profile-sessions',
  'settings-enable-profile-swapping', 'settings-profile-rotation-list',
  'settings-mockups-card', 'settings-mockups-status', 'settings-mockups-profile', 'settings-mockups-verified',
  'settings-openai-logout',
  'engine-chatgpt-toggle', 'engine-chatgpt-state', 'engine-gemini-toggle', 'engine-gemini-state', 'engine-meta-toggle', 'engine-meta-state',
  'settings-meta-card', 'settings-meta-status', 'settings-meta-profile', 'settings-meta-verified', 'settings-meta-logout',
  'settings-gpt-card', 'settings-gpt-status', 'settings-gpt-profile', 'settings-studio-list',
  'settings-gpts-card', 'settings-gpts-status', 'settings-gpts-profile', 'settings-gpts-list',
  'new-project-button', 'project-count', 'project-list', 'empty-state', 'project-workspace',
  'bundle-upload-sidebar-btn', 'bundle-upload-view', 'bundle-projects-list', 'bundle-empty-state',
  'bundle-ready-badge', 'start-bundle-btn', 'stop-bundle-btn',
  'project-meta', 'project-title', 'project-format-toggle', 'project-generation-mode-toggle', 'project-theme', 'output-folder-button', 'export-to-management-button', 'retry-all-button',
  'pause-button', 'live-pause-button', 'studio-stage-pause', 'studio-banner-pause', 'run-button', 'stat-total', 'stat-complete', 'stat-remaining', 'stat-percent',
  'queue-caption', 'current-job-label', 'current-job-status', 'progress-fill', 'progress-percent-label', 'heartbeat-text', 'live-dock',
  'jobs-table', 'pages-stage', 'pages-canvas', 'pages-rail-count', 'detail-title', 'detail-status-wrap', 'detail-error', 'detail-prompt',
  'detail-story-text-wrap', 'detail-story-text',
  'copy-prompt-button', 'import-image-button', 'open-conversation-button', 'retry-job-button',
  'export-caption', 'export-mode-select', 'export-all-files-button', 'export-pdf-button', 'export-zip-button', 'export-pptx-button', 'event-log', 'project-dialog',
  'generate-tpt-thumbnails-button', 'generate-tpt-preview-video-button', 'open-tpt-upload-button',
  'mark-tpt-ready-button', 'start-tpt-uploading-button', 'when-complete-control', 'open-project-folder-button',
  'tpt-thumbnails-review', 'tpt-preview-review',
  'overview-character-count', 'overview-character-names', 'overview-interior-detail', 'overview-editable-status', 'overview-editable-detail', 
  'overview-thumbnail-count', 'overview-thumbnail-detail', 'overview-mockups-status', 'overview-mockups-detail', 'overview-preview-status', 'overview-preview-detail', 'overview-export-status', 'overview-export-detail',
  'overview-open-stages', 'overview-overall-state', 'overview-product-ring', 'overview-overall-card',
  'project-form', 'toast-host', 'filter-tabs', 'bulk-prompt-panel', 'bulk-prompts-text',
  'prompt-split-mode', 'bulk-prompt-count', 'upload-prompts-button', 'clear-prompts-button',
  'prompt-file-input', 'project-dialog-note', 'project-dialog-title', 'project-method-step',
  'project-prompt-step', 'auth-dialog', 'auth-open-button', 'auth-verify-button',
  'auth-close-button', 'auth-status-text', 'auth-eyebrow', 'auth-title', 'auth-copy', 'auth-brand-logo', 'image-preview-dialog', 'large-preview-image', 'large-preview-title', 'image-preview-previous', 'image-preview-next',
  'edit-page-dialog', 'edit-page-form', 'edit-page-title', 'edit-instruction-text',
  'page-format', 'project-orientation', 'page-output-spec',
  'analysis-tabs', 'analysis-url-panel', 'analysis-builder-panel', 'analysis-story-panel', 'story-idea',
  'story-body', 'story-page-count', 'story-age-range', 'story-language', 'story-moral-lesson',
  'story-character-photo', 'story-upload-btn', 'story-upload-filename', 'story-clear-upload-btn',
  'analysis-product-url', 'analysis-builder-idea', 'builder-chips-area', 'builder-chips-list',
  'builder-info-picker', 'builder-picker-categories', 'builder-picker-sub-col', 'builder-picker-sub-label',
  'builder-picker-subcategories', 'builder-picker-leaf-col', 'builder-picker-leaf-label', 'builder-picker-leaves',
  'builder-save-info-button', 'builder-cancel-picker-button',
  'builder-text-picker', 'builder-text-info-input', 'builder-save-text-button', 'builder-cancel-text-button',
  'builder-add-info-button', 'builder-add-text-button',
  'analysis-page-format', 'analysis-project-orientation', 'analysis-url-page-format', 'analysis-url-page-orientation',
  'windows-url-page-setup', 'analysis-url-page-spec', 'start-analysis-button',
  'project-analysis-input-step', 'project-analysis-loading-step', 'project-analysis-result-step',
  'project-prompts-loading-step', 'result-target-age', 'result-title', 'result-description',
  'result-highlights-list', 'result-competitor-count', 'result-custom-count-input',
  'result-mockups-box', 'result-mockups-status', 'result-mockups-strip', 'result-include-mockups', 'result-include-mockups-label',
  'generate-prompts-button', 'prompts-loading-title', 'prompts-loading-detail', 'analysis-error-box',
  'analysis-loading-detail',
  'project-concept-view', 'project-standard-view', 'concept-project-meta', 'concept-project-title',
  'concept-display-age', 'concept-display-description', 'concept-display-highlights',
  'concept-mockups-block', 'concept-mockups-status', 'concept-mockups-strip',
  'concept-generate-page-count', 'concept-page-format', 'concept-project-orientation',
  'concept-generate-prompts-btn',
  'builder-picker-search', 'builder-picker-search-results-wrap', 'builder-picker-search-results', 'builder-picker-cascading-row',
  'concept-rename-btn', 'concept-delete-btn', 'project-rename-btn', 'project-delete-btn', 'concept-delete-button',
  'rename-project-dialog', 'rename-project-input', 'rename-project-form', 'close-rename-dialog-btn', 'cancel-rename-btn',
  'when-complete-action', 'countdown-overlay', 'countdown-action-title', 'countdown-number', 'cancel-countdown-btn',
  'background-generation-bar', 'background-generation-text',
  'project-characters-section', 'project-characters-grid',
  'storybook-review-step', 'storybook-review-title', 'storybook-phase-badge',
  'storybook-blueprint-preview', 'storybook-front-cover-preview', 'storybook-character-cards',
  'storybook-phase2-progress', 'storybook-progress-title', 'storybook-progress-detail',
  'storybook-review-error', 'storybook-official-pages-wrap',
  'storybook-official-pages-title', 'storybook-official-pages', 'storybook-open-dashboard-button',
  'storybook-retry-phase2-button', 'storybook-resume-phase2-button',
  'adjust-crop-button', 'crop-dialog', 'crop-form', 'crop-dialog-title', 'crop-preview-container',
  'crop-preview-image', 'crop-zoom-slider', 'crop-zoom-value', 'crop-pan-x-slider', 'crop-pan-x-value',
  'crop-pan-y-slider', 'crop-pan-y-value', 'crop-save-btn',
  'automation-bar', 'automation-bar-label', 'automation-bar-detail', 'automation-overall-fill',
  'automation-pause-btn', 'automation-resume-btn', 'automation-start-btn',
  'auto-step-overview', 'auto-step-characters', 'auto-step-interior', 'auto-step-editable', 'auto-step-thumbnails', 'auto-step-preview', 'auto-step-export',
  'editable-engine-status', 'run-editable-engine-button', 'generate-editable-text-button',
  'editable-artwork-status', 'editable-artwork-button', 'editable-text-status',
  'overview-interior-artwork-state', 'overview-interior-artwork-status', 'overview-interior-artwork-detail', 'overview-interior-artwork-meter',
  'overview-interior-text-state', 'overview-interior-text-status', 'overview-interior-text-detail', 'overview-interior-text-meter',
  'text-page-deck', 'text-lab-eta', 'vision-status', 'vision-dot', 'vision-engine-state', 'vision-engine-detail', 'vision-hint',
  'vision-phases', 'export-editable-pptx-button', 'export-editable-pdf-button',
  'pipeline-step-label', 'vision-metrics', 'vision-metric-pages', 'vision-metric-built', 'editable-build-chip', 'editable-build-dot',
  'ppt-stat-pages', 'deliverable-pptx-note', 'deliverable-pdf-note', 'deliverable-docx-note',
  'export-editable-docx-button', 'rebuild-editable-text-button',
  'vision-metric-layers', 'vision-metric-text', 'vision-metric-bound', 'vision-metric-orphan',
  'ppt-slide-deck', 'ppt-stat-slides', 'ppt-stat-boxes', 'ppt-stat-state', 'ppt-open-folder-button',
  'automation-ask-overlay', 'automation-ask-title', 'automation-ask-body', 'automation-ask-skip', 'automation-ask-proceed',
  'settings-sound-enabled', 'settings-sound-volume', 'settings-sound-volume-val', 'settings-toasts-enabled', 'settings-desktop-notifications-enabled',
].map((id) => [id.replace(/-([a-z])/g, (_, character) => character.toUpperCase()), document.getElementById(id)]));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function localFileName(value) {
  return String(value ?? '').split(/[\\/]/).filter(Boolean).at(-1) || 'Not selected';
}

function showImagePreview(items, index = 0) {
  imagePreviewItems = items.filter((item) => item?.src);
  imagePreviewIndex = Math.max(0, Math.min(index, imagePreviewItems.length - 1));
  const item = imagePreviewItems[imagePreviewIndex];
  if (!item) return;
  elements.largePreviewImage.src = item.src;
  elements.largePreviewImage.alt = item.alt;
  elements.largePreviewTitle.textContent = item.title;
  const hasNavigation = imagePreviewItems.length > 1;
  elements.imagePreviewPrevious.hidden = !hasNavigation;
  elements.imagePreviewNext.hidden = !hasNavigation;
  if (!elements.imagePreviewDialog.open) elements.imagePreviewDialog.showModal();
}

function moveImagePreview(direction) {
  if (imagePreviewItems.length < 2) return;
  imagePreviewIndex = (imagePreviewIndex + direction + imagePreviewItems.length) % imagePreviewItems.length;
  showImagePreview(imagePreviewItems, imagePreviewIndex);
}

function jobPreviewItems(project) {
  return project.jobs.filter((job) => job.outputPath).map((job) => ({
    src: `tpt-image://job/${encodeURIComponent(job.id)}?v=${encodeURIComponent(job.updatedAt ?? '')}`,
    alt: `Page ${job.pageNumber} at full size`,
    title: `Page ${job.pageNumber} ${job.fileName}`
  }));
}

function thumbnailPreviewItems(project) {
  return (project.tptListing?.thumbnailPaths ?? []).map((path, index) => path ? ({
    src: `tpt-image://thumbnail/${encodeURIComponent(project.id)}/${index}?v=${encodeURIComponent(project.updatedAt ?? '')}`,
    alt: `TPT thumbnail ${index + 1}`,
    title: `TPT Mockup ${index + 1}`
  }) : null).filter(Boolean);
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status ?? '—';
}

function statusChip(status) {
  return `<span class="status-chip status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function pagesStatusCopy(job, isLive = false) {
  if (!job) return '';
  const activity = generationActivity.get(job.id);
  if (activity?.phase === 'failed' && activity.generating === false) return 'Needs attention';
  if (activity?.phase === 'image_ready') return 'Almost there';
  if (isLive || observerGenerating(activity) || ['preparing', 'submitted', 'generating', 'downloading', 'validating'].includes(job.status)) {
    return 'Processing';
  }
  if (job.status === 'complete') return 'Ready';
  if (job.status === 'needs_user_action') return 'Needs attention';
  if (job.status === 'rate_limit_paused') return 'Paused';
  if (job.status === 'pending') return 'Pending';
  return statusLabel(job.status);
}

function pageLiveCopy(job) {
  if (job?.status === 'preparing') return 'Starting';
  if (job?.status === 'downloading' || job?.status === 'validating') return 'Almost there';
  return 'Processing';
}

function pageSheetInnerHtml(job, { isLive = false, hasImage = false } = {}) {
  const number = String(job.pageNumber).padStart(2, '0');
  if (hasImage) {
    return `
      <div class="page-fill-layer" aria-hidden="true"></div>
      <div class="page-fill-sheen" aria-hidden="true"></div>
      <img class="page-generated-image" src="${pageImageSrc(job)}" alt="Page ${job.pageNumber}" decoding="async" loading="lazy">
      <div class="page-placeholder image-missing-placeholder" hidden>
        <strong>${number}</strong>
        <span>Missing</span>
      </div>
    `;
  }
  return `
    <div class="page-fill-layer" aria-hidden="true"></div>
    <div class="page-fill-sheen" aria-hidden="true"></div>
    <div class="page-placeholder">
      <strong>${number}</strong>
      <span>${escapeHtml(isLive ? pageLiveCopy(job) : pagesStatusCopy(job, false))}</span>
    </div>
  `;
}

function bindPageImages(root) {
  if (!root) return;
  root.querySelectorAll('.page-generated-image').forEach((image) => {
    image.addEventListener('error', () => {
      image.hidden = true;
      const placeholder = image.nextElementSibling;
      if (placeholder) placeholder.hidden = false;
    }, { once: true });
  });
  bindFlexibleImageAspect(root, '.page-generated-image', '.page-visual');
}

function humanPageLabel(job) {
  const n = Number(job?.pageNumber) || 0;
  const title = String(job?.title || '').trim()
    .replace(/^page\s*\d+\s*:\s*/i, '')
    .replace(/^prompt\s*\d+\s*:\s*/i, '')
    .replace(/^@image\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const looksTechnical = !title
    || /_\w+\.(png|jpe?g|webp)$/i.test(title)
    || /\d{3,}\s*[x×]\s*\d{3,}/i.test(title)
    // A title that is just the page number renders as "Page 1 · Page 1".
    || new RegExp(`^page\\s*${n}$`, 'i').test(title)
    || title.length > 56;
  if (looksTechnical) return `Page ${n}`;
  return `Page ${n} · ${title}`;
}

const JOB_FILL_PERCENT = {
  pending: 8,
  retry_wait: 10,
  edit_pending: 14,
  preparing: 24,
  submitted: 42,
  generating: 68,
  downloading: 86,
  validating: 94,
  complete: 100,
  rate_limit_paused: 36,
  needs_user_action: 36
};

const generationActivity = new Map();
const textLabActivity = new Map();
let lastTextLabBeat = null;
let lastTextDeckKey = '';
let textDeckPatchLogTick = 0;
let textLabBeatLogTick = 0;

/** Observer-backed generating flag from queue:heartbeat. false wins over a stale phase. */
function observerGenerating(activity) {
  if (!activity) return false;
  if (activity.generating === false) return false;
  if (activity.generating === true) return true;
  return activity.phase === 'generating';
}

function jobFillPercent(job, isLive = false) {
  if (job?.status === 'complete' && !isLive) return 100;
  const activity = generationActivity.get(job?.id);
  if (activity?.phase === 'image_ready') return 96;
  if (isLive && activity) return Math.min(92, 20 + 65 * (1 - Math.exp(-(activity.elapsedMs || 0) / 90000)));
  const base = JOB_FILL_PERCENT[job?.status] ?? 8;
  return isLive ? Math.min(92, base + 10) : base;
}

function pageCardActionsHtml(job, { isLive = false, hasImage = false, queueLocksThisProject = false } = {}) {
  const busyBrowser = browserBusy();
  return `
        <div class="page-card-actions">
          <div class="page-card-tools">
            <button class="row-button" data-action="zoom-job" data-job-id="${escapeHtml(job.id)}" title="Preview" type="button" ${hasImage ? '' : 'disabled'}>⛶</button>
            <button class="row-button" data-action="open-job" data-job-id="${escapeHtml(job.id)}" title="Conversation" type="button" ${busyBrowser || !job.conversationUrl ? 'disabled' : ''}>↗</button>
            <button class="row-button" data-action="edit-job" data-job-id="${escapeHtml(job.id)}" title="Edit" type="button" ${queueLocksThisProject || !hasImage || job.editInstruction ? 'disabled' : ''}>✎</button>
            <button class="row-button is-danger" data-action="delete-job-image" data-job-id="${escapeHtml(job.id)}" title="Delete" type="button" ${queueLocksThisProject || !hasImage ? 'disabled' : ''}>✕</button>
          </div>
          <button class="row-button is-regen" data-action="generate-job" data-job-id="${escapeHtml(job.id)}" title="${hasImage ? 'Regenerate' : 'Generate'}" type="button" ${isLive ? 'disabled' : ''}>${hasImage ? 'Regenerate' : 'Generate'}</button>
        </div>`;
}

function activeLiveOperation(project = null) {
  const op = state?.liveOperation;
  if (!op) return null;
  if (op.projectId && project?.id && op.projectId !== project.id) return null;
  return op;
}

function setMeterWidth(id, percent) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
}

const STAGE_STATE_LABELS = {
  done: 'Done',
  live: 'Running',
  progress: 'Working',
  waiting: 'Ready',
  blocked: 'Waiting',
  skipped: 'Skipped',
  error: 'Error'
};

// One vocabulary. The card used to carry `is-done` from here and a bare `done`
// from a ported stylesheet at the same time, which is how the live DOM ended up
// reading `node is-error pending`. data-state is the contract: it is what the
// stylesheet keys off, what a test can assert, and what an agent can read.
function setStagePresentation(stageId, state, extraClass = {}) {
  const card = document.querySelector(`.overview-stage-card[data-stage="${stageId}"]`);
  if (!card) return;
  card.dataset.state = state;
  card.dataset.filling = extraClass.filling ? 'true' : 'false';
  card.dataset.testid = `stage-${stageId}`;
  const chip = card.querySelector('.stage-state');
  if (chip) chip.textContent = state === 'live' ? 'Working' : (STAGE_STATE_LABELS[state] || 'Ready');
  const fill = extraClass.percent;
  const pct = Number.isFinite(fill) ? Math.max(0, Math.min(100, fill)) : 0;
  card.dataset.percent = String(Math.round(pct));
  card.style.setProperty('--stage-fill', `${pct}%`);
  const bar = card.querySelector('.n-bar i, .stage-meter i');
  if (bar) bar.style.width = `${pct}%`;
}

// Ordinals are content, not decoration: an Editable book runs six stages and a
// Static one runs four, so the numbers have to be counted off the stages that
// are actually on screen rather than off the markup order.
//
// Wrap is a path, not a centered leftover: the next visible stage must sit on
// the connector. 4+2 parks 05 under 04 (06 to its right). 3+3 either parks 04
// under 03 or uses a short elbow so 03 still terminates on 04 — never a drop
// into empty canvas.
const pipelineBoardObservers = typeof WeakMap === 'function' ? new WeakMap() : null;

function boxesOverlapX(a, b) {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1;
}

function ensurePipelineLinks(track) {
  let svg = track.querySelector(':scope > svg.pipeline-rail-links');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pipeline-rail-links');
    svg.setAttribute('aria-hidden', 'true');
    track.insertBefore(svg, track.firstChild);
  }
  return svg;
}

function drawPipelineConnectors(track, nodes) {
  const svg = ensurePipelineLinks(track);
  const tr = track.getBoundingClientRect();
  const w = Math.max(1, track.clientWidth || tr.width || 0);
  const h = Math.max(1, track.clientHeight || tr.height || 0);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  if (!nodes.length || w < 8 || h < 8) {
    svg.replaceChildren();
    return;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const frag = document.createDocumentFragment();
  const addPath = (d, kind) => {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', kind);
    frag.appendChild(path);
  };
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i].getBoundingClientRect();
    const b = nodes[i + 1].getBoundingClientRect();
    if (a.width < 2 || b.width < 2) continue;
    const sameRow = Math.abs(a.top - b.top) < 24;
    let d;
    if (sameRow) {
      const y = ((a.top + a.bottom) / 2) - tr.top;
      d = `M ${(a.right - tr.left).toFixed(1)} ${y.toFixed(1)} L ${(b.left - tr.left).toFixed(1)} ${y.toFixed(1)}`;
    } else if (boxesOverlapX(a, b)) {
      const x = ((a.left + a.right) / 2) - tr.left;
      d = `M ${x.toFixed(1)} ${(a.bottom - tr.top).toFixed(1)} L ${x.toFixed(1)} ${(b.top - tr.top).toFixed(1)}`;
    } else {
      const x1 = ((a.left + a.right) / 2) - tr.left;
      const x2 = ((b.left + b.right) / 2) - tr.left;
      const y1 = a.bottom - tr.top;
      const y2 = b.top - tr.top;
      const midY = (y1 + y2) / 2;
      d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x1.toFixed(1)} ${midY.toFixed(1)} L ${x2.toFixed(1)} ${midY.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    addPath(d, 'rail-base');
    addPath(d, 'rail-flow');
  }
  svg.replaceChildren(frag);
}

function watchPipelineBoard(board) {
  if (!board || !pipelineBoardObservers || typeof ResizeObserver !== 'function') return;
  if (pipelineBoardObservers.has(board)) return;
  const observer = new ResizeObserver(() => layoutPipelineRail());
  observer.observe(board);
  pipelineBoardObservers.set(board, observer);
}

let railLayoutTimer = 0;

function layoutPipelineRail() {
  if (railLayoutTimer) return;
  const run = () => {
    railLayoutTimer = 0;
    layoutPipelineRailNow();
  };
  if (typeof requestAnimationFrame === 'function') railLayoutTimer = requestAnimationFrame(run);
  else run();
}

function layoutPipelineRailNow() {
  const track = document.querySelector('.pipeline-rail-track');
  if (!track) return;
  const nodes = [...track.querySelectorAll('.overview-stage-card.node')]
    .filter((node) => !node.hidden);
  track.dataset.visibleCount = String(nodes.length);
  const n = nodes.length;
  const board = track.closest('.overview-board');
  const pane = board?.closest('.workspace-pane') || board;
  watchPipelineBoard(board);

  nodes.forEach((node) => {
    node.style.gridColumn = '';
    node.style.gridRow = '';
  });

  let gap = 36;
  const availW = Math.max(0, track.clientWidth || track.parentElement?.clientWidth || 0);
  const boardH = board ? board.clientHeight : 0;
  const progress = board?.querySelector('.overview-stage-overall');
  const progressH = progress ? progress.offsetHeight : 0;
  const boardStyle = board ? getComputedStyle(board) : null;
  const padY = boardStyle
    ? (parseFloat(boardStyle.paddingTop) || 0) + (parseFloat(boardStyle.paddingBottom) || 0)
    : 0;
  const availH = Math.max(0, boardH - progressH - padY - 8);
  const sizeFor = (cols, rowCount, g) => {
    if (cols < 1) return 0;
    const sizeW = (availW - (cols - 1) * g) / cols;
    const sizeH = rowCount > 1 ? (availH - (rowCount - 1) * g) / rowCount : availH;
    return Math.min(sizeW, sizeH);
  };

  let wrapCols = n;
  let rows = 1;
  let gridCols = Math.max(1, n);
  let stack = false;

  if (n > 4 && availW > 0) {
    const branchedCols = n - 1;
    const fourSize = sizeFor(branchedCols, 2, gap);
    const threeSize = sizeFor(3, 2, gap);
    const usable = 128;
    if (fourSize >= usable || fourSize >= threeSize * 0.72) {
      wrapCols = 4;
      rows = 2;
      gridCols = branchedCols;
    } else {
      wrapCols = 3;
      rows = 2;
      gridCols = 3;
      stack = true;
    }
  }

  if (availW > 0 && availH > 0 && n > 4) {
    if (sizeFor(gridCols, rows, gap) < 140) gap = 28;
    if (sizeFor(gridCols, rows, gap) < 118) gap = 22;
  }

  let nodeSize = 160;
  if (availW > 40 && availH > 40) {
    nodeSize = Math.floor(Math.max(96, Math.min(280, sizeFor(gridCols, rows, gap))));
  }

  track.style.setProperty('--rail-gap', `${gap}px`);
  track.style.setProperty('--node-size', `${nodeSize}px`);
  track.style.setProperty('--rail-cols', String(gridCols));
  track.dataset.wrapCols = String(wrapCols);
  track.dataset.railRows = String(rows);
  track.dataset.wrapMode = n <= 4 ? 'row' : stack ? '3-3' : '4-2';

  const row2StartCol = stack ? 1 : wrapCols;
  nodes.forEach((node, index) => {
    let row = 1;
    let col = index + 1;
    if (rows > 1 && index >= wrapCols) {
      row = 2;
      col = row2StartCol + (index - wrapCols);
    }
    node.style.gridColumn = String(col);
    node.style.gridRow = String(row);
    const next = nodes[index + 1];
    const nextRow = next && rows > 1 && (index + 1) >= wrapCols ? 2 : 1;
    const rowEnd = Boolean(next) && nextRow !== row;
    node.classList.toggle('is-row-end', rowEnd);
    node.dataset.rail = !next ? 'last' : rowEnd ? 'wrap' : 'next';
  });

  const paint = () => {
    drawPipelineConnectors(track, nodes);
    const scroller = board || pane;
    if (scroller) {
      let fits = scroller.scrollHeight <= scroller.clientHeight + 1;
      if (!fits && nodeSize > 96 && availH > 40) {
        const overflow = scroller.scrollHeight - scroller.clientHeight;
        nodeSize = Math.max(96, nodeSize - Math.ceil(overflow / Math.max(1, rows)) - 6);
        track.style.setProperty('--node-size', `${nodeSize}px`);
        drawPipelineConnectors(track, nodes);
        fits = scroller.scrollHeight <= scroller.clientHeight + 1;
      }
      scroller.dataset.fits = fits ? 'true' : 'false';
      if (pane && pane !== scroller) pane.dataset.fits = scroller.dataset.fits;
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(paint);
  else paint();
}

function renumberPipeline() {
  const nodes = [...document.querySelectorAll('.pipeline-rail-track .overview-stage-card.node')]
    .filter((node) => !node.hidden);
  nodes.forEach((node, index) => {
    const idx = node.querySelector('.n-idx');
    if (idx) idx.textContent = String(index + 1).padStart(2, '0');
    node.dataset.position = index === 0 ? 'first' : index === nodes.length - 1 ? 'last' : 'middle';
  });
  requestAnimationFrame(layoutPipelineRail);
}

function setTabMark(view, state) {
  const mark = document.querySelector(`[data-tab-mark="${view}"]`);
  if (!mark) return;
  const tab = document.querySelector(`.workspace-tab[data-view-target="${view}"]`);
  if (tab) {
    tab.dataset.state = state;
    tab.dataset.testid = `tab-${view}`;
  }
  mark.dataset.state = state;
  mark.classList.toggle('is-done', state === 'done');
  mark.classList.toggle('is-live', state === 'live');
  mark.classList.toggle('is-open', state === 'waiting' || state === 'blocked' || state === 'progress');
  mark.classList.toggle('is-skipped', state === 'skipped');
}

function displayProjectName(name) {
  return String(name ?? '').replace(/^مشروع كتاب\s*(\d+)$/u, 'Book Project $1');
}

function projectSetupLabel(project) {
  const orientation = project?.orientation === 'landscape' ? 'Landscape' : 'Portrait';
  return `${project?.format ?? 'A4'} ${orientation}`;
}

function projectTypeLabel(project) {
  if (project?.projectType === 'storybook') return 'Storybook';
  const text = [project?.name, project?.theme, project?.niche, project?.style].join(' ').toLowerCase();
  return /colou?r(?:ing)?\b/.test(text) ? 'Coloring book' : 'Activities';
}

function projectStatusTone(status) {
  if (status === 'complete') return 'complete';
  if (['paused', 'rate_limit_paused', 'needs_user_action', 'workflow_failed', 'phase2_failed'].includes(status)) return 'attention';
  if (['generating', 'running', 'submitted', 'preparing'].includes(status)) return 'active';
  return 'ready';
}

function previewAspectRatio(project) {
  const landscape = project?.orientation === 'landscape';
  if (project?.format === 'LETTER') return landscape ? '11 / 8.5' : '8.5 / 11';
  if (project?.format === 'SQUARE') return '1 / 1';
  return landscape ? '1.414 / 1' : '1 / 1.414';
}

/** Size a page frame to the real image, not a forced crop. */
function bindFlexibleImageAspect(root, imageSelector, frameSelector) {
  if (!root) return;
  root.querySelectorAll(imageSelector).forEach((image) => {
    const apply = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const frame = (frameSelector && image.closest(frameSelector)) || image.parentElement || image;
      frame.style.setProperty('--page-aspect', `${image.naturalWidth} / ${image.naturalHeight}`);
    };
    if (image.complete && image.naturalWidth) apply();
    else image.addEventListener('load', apply, { once: true });
  });
}

function resolvedStoryText(project, job) {
  if (job?.storyText) return job.storyText;
  const storyPageNumber = Number(job?.title?.match(/\d+/)?.[0] ?? job?.pageNumber - 1);
  return (project?.storyExactText ?? []).find((record) => Number(record.pageNumber) === storyPageNumber)?.storyText ?? '';
}

function renderPageOutputSpec() {
  const landscape = elements.projectOrientation.value === 'landscape';
  const format = elements.pageFormat?.value || 'A4';
  const dimensions = format === 'LETTER'
    ? (landscape ? '3300 × 2550 px' : '2550 × 3300 px')
    : format === 'SQUARE'
      ? '3000 × 3000 px'
      : (landscape ? '3508 × 2480 px' : '2480 × 3508 px');
  elements.pageOutputSpec.textContent = `${dimensions} • 300 DPI`;
}

const ANALYSIS_OUTPUT_SPECS = Object.freeze({
  A4: { portrait: '2480 × 3508 px · 300 DPI', landscape: '3508 × 2480 px · 300 DPI' },
  LETTER: { portrait: '2550 × 3300 px · 300 DPI', landscape: '3300 × 2550 px · 300 DPI' },
  SQUARE: { portrait: '3000 × 3000 px · 300 DPI', landscape: '3000 × 3000 px · 300 DPI' }
});

function runningOnWindows() {
  return state?.app?.platform === 'win32';
}

function storedAppearance() {
  try {
    const stored = localStorage.getItem('versa-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {}
  return '';
}

function appearancePreference() {
  return storedAppearance() || state?.app?.appearance?.preference || state?.settings?.appearance || 'dark';
}

function appearanceResolved() {
  return storedAppearance() || state?.app?.appearance?.resolved || document.documentElement.dataset.theme || 'dark';
}

function applyAppearanceUi() {
  const preference = appearancePreference();
  const resolved = appearanceResolved() === 'dark' ? 'dark' : 'light';
  // Theme is a re-lighting of the same surfaces. CSS transitions on color,
  // background, border, and shadow do the crossfade — no timeout class.
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  try { localStorage.setItem('versa-theme', resolved); } catch {}
  document.querySelectorAll('.appearance-switch [data-appearance]').forEach((button) => {
    const selected = button.dataset.appearance === resolved;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  document.querySelectorAll('.appearance-choice[data-appearance]').forEach((button) => {
    const selected = button.dataset.appearance === preference;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  globalThis.versaBookManagement?.syncTheme?.();
}

function applyEditableEngineUi() {
  if (elements.autoStepEditable) {
    elements.autoStepEditable.disabled = false;
    elements.autoStepEditable.title = 'Editable generation';
  }
  const autoCopy = document.getElementById('automation-step-editable-copy');
  if (autoCopy) autoCopy.textContent = 'After analysis.';
}

function syncAnalysisPageSetup(format, orientation) {
  const resolvedFormat = ANALYSIS_OUTPUT_SPECS[format] ? format : 'LETTER';
  const resolvedOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  if (elements.analysisUrlPageFormat) elements.analysisUrlPageFormat.value = resolvedFormat;
  if (elements.analysisUrlPageOrientation) elements.analysisUrlPageOrientation.value = resolvedOrientation;
  if (elements.analysisPageFormat?.querySelector(`option[value="${resolvedFormat}"]`)) {
    elements.analysisPageFormat.value = resolvedFormat;
  }
  if (elements.analysisProjectOrientation) elements.analysisProjectOrientation.value = resolvedOrientation;
  const radio = elements.projectDialog?.querySelector(`input[name="analysisPageFormat"][value="${resolvedFormat}"]`);
  if (radio) {
    radio.checked = true;
    elements.projectDialog.querySelectorAll('.page-size-card').forEach((card) => {
      card.classList.toggle('is-selected', card.contains(radio));
    });
  }
  if (elements.analysisUrlPageSpec) {
    elements.analysisUrlPageSpec.textContent = ANALYSIS_OUTPUT_SPECS[resolvedFormat][resolvedOrientation];
  }
}

function renderWindowsUrlPageSetup() {
  const isWindows = runningOnWindows();
  const supportedFormats = new Set(Object.keys(ANALYSIS_OUTPUT_SPECS));
  elements.projectDialog?.querySelectorAll('input[name="analysisPageFormat"]').forEach((input) => {
    const card = input.closest('.page-size-card');
    if (card) card.hidden = isWindows && !supportedFormats.has(input.value);
  });

  if (!elements.windowsUrlPageSetup) return;
  elements.windowsUrlPageSetup.hidden = !isWindows;
  if (!isWindows) return;
  syncAnalysisPageSetup(
    elements.analysisUrlPageFormat?.value || 'LETTER',
    elements.analysisUrlPageOrientation?.value || 'portrait'
  );
}

function translateLegacyText(value) {
  const text = String(value ?? '');
  const exact = new Map([
    ['تم التحقق من تسجيل الدخول إلى Gemini.', 'Gemini login verified.'],
    ['بدأ تشغيل طابور الكتاب.', 'Book generation queue started.'],
    ['طلب المستخدم إيقاف الطابور مؤقتًا.', 'User requested a safe queue pause.'],
    ['تم تجهيز كل الصفحات غير المكتملة لإعادة المحاولة.', 'All incomplete pages were reset for retry.'],
    ['لم يتم العثور على مربع كتابة Gemini.', 'The Gemini composer was not found.'],
    ['جلسة Gemini غير صالحة داخل محرك الخلفية. أعد استيراد تسجيل الدخول.', 'The Gemini session is not valid in the background browser. Import the session again.']
  ]);
  if (exact.has(text)) return exact.get(text);
  const patterns = [
    [/^تم استيراد (\d+) برومبت إلى الطابور بالترتيب\.$/u, 'Imported $1 prompts into the ordered queue.'],
    [/^تم إنشاء الكتاب بـ (\d+) صفحة مرتبة\.$/u, 'Created an ordered $1-page book.'],
    [/^تم تغيير مجلد الحفظ إلى: (.+)$/u, 'Output folder changed to: $1'],
    [/^تم اختيار مجلد الحفظ: (.+)$/u, 'Output folder selected: $1'],
    [/^بدأت دفعة من (\d+) صفحات: (.+)\.$/u, 'Started a batch of $1 pages: $2.'],
    [/^تجهيز الصفحة (\d+)\/(\d+) — المحاولة (\d+)\/(\d+)\.$/u, 'Preparing page $1/$2 attempt $3/$4.'],
    [/^تم إرسال الصفحة (\d+) بنجاح\.$/u, 'Page $1 submitted successfully.'],
    [/^تم تجهيز الصفحة (\d+) لإعادة المحاولة\.$/u, 'Page $1 reset for retry.'],
    [/^اكتملت الصفحة (\d+): (.+)$/u, 'Page $1 complete: $2'],
    [/^تم إنشاء (PDF|ZIP): (.+)$/u, '$1 created: $2'],
    [/^تم استيراد صورة الصفحة (\d+) يدويًا\.$/u, 'Page $1 image imported manually.'],
    [/^أُضيف تعديل الصفحة (\d+) إلى الطابور\.$/u, 'Page $1 edit added to the queue.']
  ];
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(text)) return text.replace(pattern, replacement).replaceAll('،', ',');
  }
  const failure = text.match(/^فشلت محاولة الصفحة (\d+): (.+) — ستُعاد نفس الصفحة\.$/u);
  if (failure) return `Page ${failure[1]} attempt failed: ${translateLegacyText(failure[2])} The same page will retry.`;
  if (/\p{Script=Arabic}/u.test(text)) {
    return 'Legacy activity entry recorded before the English interface update.';
  }
  return text;
}

function getAudioPreferences() {
  const notifications = state?.settings?.notifications ?? {};
  return {
    soundEnabled: notifications.soundEnabled !== false,
    soundVolume: Number.isFinite(Number(notifications.soundVolume)) ? Number(notifications.soundVolume) : 80,
    toastsEnabled: notifications.toastsEnabled !== false,
    desktopEnabled: notifications.desktopEnabled !== false
  };
}

function playChime(type = 'success') {
  const prefs = getAudioPreferences();
  if (!prefs.soundEnabled) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const masterGain = audioCtx.createGain();
    const volumeFraction = Math.max(0, Math.min(100, prefs.soundVolume)) / 100;
    const peakGain = 0.22 * volumeFraction;
    
    masterGain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'success') {
      const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0, now + idx * 0.12);
        gain.gain.linearRampToValueAtTime(peakGain, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.45);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.5);
      });
    } else if (type === 'warning') {
      const pulses = [
        { freq: 880.00, start: 0, dur: 0.16 }, // A5
        { freq: 739.99, start: 0.18, dur: 0.28 } // F#5
      ];
      pulses.forEach((p) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(p.freq, now + p.start);
        gain.gain.setValueAtTime(0, now + p.start);
        gain.gain.linearRampToValueAtTime(peakGain * 1.2, now + p.start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + p.start + p.dur);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + p.start);
        osc.stop(now + p.start + p.dur);
      });
    } else if (type === 'error') {
      const notes = [
        { freq: 311.13, start: 0, dur: 0.16 }, // Eb4
        { freq: 233.08, start: 0.14, dur: 0.18 }, // Bb3
        { freq: 196.00, start: 0.30, dur: 0.35 }  // G3
      ];
      notes.forEach((n) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(n.freq, now + n.start);
        gain.gain.setValueAtTime(0, now + n.start);
        gain.gain.linearRampToValueAtTime(peakGain * 0.7, now + n.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur);
      });
    } else if (type === 'complete') {
      const fanfare = [
        { freq: 523.25, start: 0 },      // C5
        { freq: 783.99, start: 0.12 },   // G5
        { freq: 1046.50, start: 0.24 },  // C6
        { freq: 1318.51, start: 0.38 }   // E6
      ];
      fanfare.forEach((f, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f.freq, now + f.start);
        gain.gain.setValueAtTime(0, now + f.start);
        gain.gain.linearRampToValueAtTime(peakGain, now + f.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + f.start + (idx === 3 ? 0.7 : 0.4));
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + f.start);
        osc.stop(now + f.start + (idx === 3 ? 0.75 : 0.45));
      });
    }
  } catch (err) {
    console.error('Audio synthesizer error:', err);
  }
}

function playSuccessSound() {
  playChime('success');
}

function showRichToast({
  type = 'info',
  title = '',
  message = '',
  actionText = null,
  onAction = null,
  duration = 5000
} = {}) {
  const prefs = getAudioPreferences();
  if (!prefs.toastsEnabled) return;
  if (!elements.toastHost) return;

  const toast = document.createElement('div');
  const typeClass = type === 'error' ? 'is-error'
    : type === 'warning' ? 'is-warning'
    : type === 'complete' ? 'is-complete'
    : type === 'success' ? 'is-success'
    : '';

  toast.className = `toast ${typeClass}`.trim();

  const iconMap = {
    success: '✨',
    warning: '⚡',
    error: '🛑',
    complete: '🎉',
    info: 'ℹ️'
  };
  const icon = iconMap[type] || '🔔';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      ${title ? `<h5 class="toast-title">${escapeHtml(title)}</h5>` : ''}
      <p class="toast-message">${escapeHtml(message)}</p>
      ${actionText ? `<button type="button" class="toast-action-btn">${escapeHtml(actionText)}</button>` : ''}
    </div>
    <button type="button" class="toast-close-btn" aria-label="Close">×</button>
  `;

  const dismissToast = () => {
    if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 400);
  };

  const closeBtn = toast.querySelector('.toast-close-btn');
  closeBtn?.addEventListener('click', dismissToast);

  if (actionText && typeof onAction === 'function') {
    const actionBtn = toast.querySelector('.toast-action-btn');
    actionBtn?.addEventListener('click', () => {
      onAction();
      dismissToast();
    });
  }

  elements.toastHost.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.isConnected) dismissToast();
    }, duration);
  }
}

function showToast(message, type = 'info') {
  const title = type === 'error' ? 'Failed'
    : type === 'success' ? 'Ready'
    : type === 'warning' ? 'Heads up'
    : 'Notice';
  showRichToast({
    type,
    title,
    message,
    duration: 4500
  });
}

function sendDesktopNotification({ title = 'VERSA CLASS', body = '' } = {}) {
  const prefs = getAudioPreferences();
  if (!prefs.desktopEnabled) return;
  if (typeof Notification === 'undefined') return;

  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {}
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        try {
          new Notification(title, { body });
        } catch {}
      }
    });
  }
}

function errorMessage(error) {
  return (error?.message || String(error || 'An unknown error occurred.'))
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
}

async function invoke(action, { successMessage = null, refresh = true } = {}) {
  try {
    const result = await action();
    if (successMessage) showToast(successMessage, 'success');
    if (refresh) await refreshState();
    return result;
  } catch (error) {
    const message = errorMessage(error);
    const code = error?.code || '';
    const info = ['QUEUE_BUSY', 'QUEUE_RUNNING', 'AUTOMATION_BUSY', 'QUEUE_PAUSED', 'BROWSER_BUSY'].includes(code)
      || /still generating|paused on another book|keep browsing|keep opening other books|you paused this work/i.test(message);
    if (code === 'FATAL_ENGINE_ERROR' || /FATAL_ENGINE_ERROR/i.test(message)) {
      showRichToast({
        type: 'error',
        title: 'Engine failed',
        message
      });
    }
    showToast(code === 'QUEUE_PAUSED' ? 'Stopped.' : message, info ? 'info' : 'error');
    throw error;
  }
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
  } catch {
    return '—';
  }
}

function activeProject() {
  return state?.activeProject ?? null;
}

function generatingProjectRecord() {
  const queueId = state?.queue?.running ? state.queue.activeProjectId : null;
  const autoId = state?.automation?.active && !state.automation.paused ? state.automation.currentProjectId : null;
  const id = queueId || autoId;
  if (!id) return null;
  if (state.activeProject?.id === id) return state.activeProject;
  return (state.projects || []).find((project) => project.id === id) || null;
}

function isPipelineBusy() {
  const work = state?.workBusy;
  if (work) {
    return Boolean(work.queue || work.automation || work.liveOperation || work.tptListing || work.bundle || work.stopping);
  }
  return Boolean(
    state?.queue?.running
    || (state?.automation?.active && !state.automation?.paused)
    || state?.liveOperation
    || state?.bundleUpload?.active
  );
}

function browserBusyReason() {
  if (state?.queue?.running) {
    return `Generating “${displayProjectName(generatingProjectRecord()?.name || 'this book')}”.`;
  }
  const live = state?.liveOperation;
  if (live?.kind === 'print-pdf' || live?.kind === 'maze-assemble') return '';
  if (live?.kind === 'editable-generation') return 'Generating.';
  if (live?.kind === 'thumbnails') return 'Mockups running.';
  if (live?.recovering || state?.workBusy?.comfyRecovering) {
    return live?.message || 'Restarting.';
  }
  if (live?.kind === 'preview') return 'Preview running.';
  if (state?.workBusy?.characters) return 'Characters running.';
  if (state?.workBusy?.tptListing) return 'SEO running.';
  if (state?.automation?.active && !state?.automation?.paused) {
    return 'Automation running.';
  }
  return '';
}

function stageStartBlockReason(step, project) {
  const stats = project?.stats || {};
  const listing = project?.tptListing || {};
  const thumbnailCount = (listing.thumbnailPaths || []).filter(Boolean).length;
  const hasPages = Number(stats.complete) > 0 || Number(stats.total) > 0;
  const hasPdf = Boolean(projectPdf(project).productPath);
  const hasListingContent = Boolean(listing.title || listing.rawResponse || listing.description);
  if (step === 'characters') {
    return 'Not in this studio.';
  }
  if (step === 'interior') {
    if (!stats.total) return 'Create pages first.';
    if (state?.queue?.pauseRequested || state?.liveOperation?.message?.startsWith('Stopping')) return ''; 
    return browserBusyReason();
  }
  if (step === 'interior_artwork') {
    if (project?.productFormat !== 'editable') return 'Editable books only.';
    if (!stats.total) return 'Create pages first.';
    if (state?.queue?.pauseRequested || state?.liveOperation?.message?.startsWith('Stopping')) return '';
    return browserBusyReason();
  }
  if (step === 'interior_text') {
    if (project?.productFormat !== 'editable') return 'Editable books only.';
    if (!stats.total || stats.complete !== stats.total) return 'Finish artwork first.';
    // Local pipeline: MobileSAM, PaddleOCR and LaMa never touch Chrome. Only the gem
    // fallback does, so the browser gate applies only when vision is unavailable.
    if (visionReady()) return '';
    return browserBusyReason();
  }
  if (step === 'editable_ppt') {
    if (project?.productFormat !== 'editable') return 'Editable books only.';
    if (!stats.total || stats.complete !== stats.total) return 'Finish artwork first.';
    // Assembly is local, so it never waits on the browser.
    return '';
  }
  if (step === 'editable_generation' || step === 'editable') {
    if (project?.productFormat !== 'editable') return 'Editable books only.';
    if (!hasPages && !hasPdf) return 'Add pages first.';
    return browserBusyReason();
  }
  if (step === 'thumbnails') {
    if (!hasPages && !hasPdf && !hasListingContent) {
      return 'Add pages first.';
    }
    return browserBusyReason();
  }
  if (step === 'preview') {
    if (thumbnailCount === 0) return 'Generate mockups.';
    return browserBusyReason();
  }
  if (step === 'export') {
    if (!hasPages && !hasPdf) return 'Add pages first.';
    return '';
  }
  if (step === 'maze') {
    if (project?.productFormat !== 'maze') return 'Maze books only.';
    return '';
  }
  return '';
}

function isOverviewNodeAction(btn) {
  return Boolean(btn?.classList?.contains('stage-run-btn')
    && btn.closest('.pipeline-rail-track .overview-stage-card.node'));
}

function syncOverviewNodeAction(btn, { hide = false, disable = false } = {}) {
  btn.removeAttribute('title');
  btn.hidden = Boolean(hide);
  btn.disabled = Boolean(disable);
}

function overviewNodeActionLabel(step, { running = false, hasVideo = false } = {}) {
  if (step === 'interior' || step === 'interior_artwork') return running ? 'Generating…' : 'Generate';
  if (step === 'interior_text') return running ? 'Writing…' : 'Write text';
  if (step === 'editable_ppt') return running ? 'Building…' : 'Build';
  if (step === 'thumbnails') return running ? 'Generating…' : 'Start';
  if (step === 'preview') return running ? 'Generating…' : hasVideo ? 'Open' : 'Start';
  if (step === 'export') return running ? 'Exporting…' : 'Start';
  if (step === 'maze') return running ? 'Generating…' : 'Generate';
  return running ? 'Working…' : 'Start';
}

function isGeneratingThisProject(project) {
  if (!project?.id) return false;
  if (state?.liveOperation?.projectId === project.id && state.liveOperation.kind === 'editable-generation') return true;
  if (state?.liveOperation?.projectId === project.id && state.liveOperation.kind === 'maze') return true;
  if (state?.queue?.running && state.queue.activeProjectId === project.id) return true;
  return Boolean(state?.automation?.active && !state.automation.paused && state.automation.currentProjectId === project.id);
}

function isGeneratingElsewhere(project) {
  const generating = generatingProjectRecord();
  return Boolean(generating && project?.id && generating.id !== project.id);
}

function browserBusy() {
  return isPipelineBusy();
}

function characterActionContext(projectId, characterIndex) {
  const candidates = [storybookReviewState?.project, activeProject()].filter(Boolean);
  const project = candidates.find((candidate) => String(candidate.id) === String(projectId));
  if (!project || !Number.isInteger(characterIndex)) return null;
  const character = project.highlights?.characters?.[characterIndex];
  if (!character) return null;
  return {
    project,
    character,
    sheet: project.characterSheets?.[characterIndex] ?? {}
  };
}

function splitBulkPrompts(text, mode = 'line') {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  if (mode === 'blank') {
    return normalized.split(/\n[\t ]*\n+/g).map((prompt) => prompt.trim()).filter(Boolean);
  }
  return normalized.split(/\n+/g).map((prompt) => prompt.trim()).filter(Boolean);
}

function bulkPromptCount() {
  return splitBulkPrompts(elements.bulkPromptsText.value, elements.promptSplitMode.value).length;
}

function renderBulkPromptCount() {
  const count = bulkPromptCount();
  elements.bulkPromptCount.textContent = `${count} ${count === 1 ? 'prompt' : 'prompts'}`;
  elements.bulkPromptCount.dataset.active = count > 0 ? 'true' : 'false';
  return count;
}

let currentAnalysisMode = 'url';
let currentProjectMethodChoice = 'agent';
let analysisResult = null;
let storySelectedPhotoPath = null;
let storybookReviewState = null;
let storybookGenerationPending = false;

function hideAllProjectSteps() {
  elements.projectMethodStep.hidden = true;
  elements.projectPromptStep.hidden = true;
  if (elements.projectAnalysisInputStep) elements.projectAnalysisInputStep.hidden = true;
  if (elements.projectAnalysisLoadingStep) elements.projectAnalysisLoadingStep.hidden = true;
  if (elements.projectAnalysisResultStep) elements.projectAnalysisResultStep.hidden = true;
  if (elements.projectPromptsLoadingStep) elements.projectPromptsLoadingStep.hidden = true;
  if (elements.storybookReviewStep) elements.storybookReviewStep.hidden = true;
  const agentStep = document.getElementById('project-agent-step');
  if (agentStep) agentStep.hidden = true;
  elements.projectDialog.classList.remove('storybook-review-open');
  elements.bulkPromptsText.required = false;
}

function characterCardsHtml(project, phaseComplete, variant = 'dashboard') {
  const characters = Array.isArray(project?.highlights?.characters) ? project.highlights.characters : [];
  const sheets = Array.isArray(project?.characterSheets) ? project.characterSheets : [];
  return characters.map((character, index) => {
    const sheet = sheets[index] ?? {};
    const busy = sheet.status === 'generating';
    const complete = sheet.status === 'complete' && sheet.outputPath;
    const disabled = !phaseComplete || busy || !character.prompt;
    const projectId = escapeHtml(project.id);
    const characterName = escapeHtml(character.name || `Character ${index + 1}`);
    const promptId = `character-prompt-${project.id}-${index}`;
    const cardClass = variant === 'review' ? 'character-card storybook-character-card' : 'character-card';
    return `
      <article class="${cardClass}" data-character-card>
        <header class="character-card-header">
          <strong>${characterName}</strong>
          <span>${complete ? 'Ready' : busy ? 'Generating…' : 'Idle'}</span>
        </header>
        <div class="character-thumbnail-shell">
          ${complete ? `
            <button class="character-thumbnail-button" data-action="preview-character" data-project-id="${projectId}" data-character-index="${index}" type="button" title="${characterName}" aria-label="${characterName}">
              <img class="character-thumbnail" src="tpt-image://character/${encodeURIComponent(project.id)}/${index}?v=${encodeURIComponent(project.updatedAt ?? '')}" alt="${characterName}">
              <span class="character-thumbnail-hint">View</span>
            </button>
          ` : `
            <div class="character-thumbnail-placeholder" aria-label="No reference">
              <span aria-hidden="true">◇</span>
              <small>No preview</small>
            </div>
          `}
        </div>
        <div id="${escapeHtml(promptId)}" class="character-prompt-box">${escapeHtml(character.prompt || 'No prompt.')}</div>
        <div class="character-prompt-actions">
          <button class="character-text-button" data-action="toggle-character-prompt" data-project-id="${projectId}" data-character-index="${index}" aria-controls="${escapeHtml(promptId)}" aria-expanded="false" type="button">Show prompt</button>
          <button class="character-text-button" data-action="copy-character-prompt" data-project-id="${projectId}" data-character-index="${index}" type="button" ${character.prompt ? '' : 'disabled'}>Copy</button>
        </div>
        ${sheet.error ? `<small class="error-box character-card-error">${escapeHtml(sheet.error)}</small>` : ''}
        <button class="button ${complete ? 'button-ghost' : 'button-primary'} button-full character-generate-button" data-action="generate-character-sheet" data-project-id="${projectId}" data-character-index="${index}" type="button" ${disabled ? 'disabled' : ''}>
          ${busy ? 'Generating…' : complete ? 'Regenerate' : 'Generate'}
        </button>
      </article>
    `;
  }).join('') || '<p class="muted">No cards.</p>';
}

function storybookCharacterCardsHtml(project, phaseComplete) {
  return characterCardsHtml(project, phaseComplete, 'review');
}

function renderStorybookReviewModal(payload, phase = 'blueprint_complete', error = null) {
  if (!payload?.project || !elements.storybookReviewStep) return;
  const resolvedError = error || payload.error || null;
  storybookReviewState = { ...payload, phase, error: resolvedError };
  const { project, parsed = {} } = payload;
  const phaseComplete = phase === 'complete';
  const phaseFailed = phase === 'workflow_failed' || phase === 'phase2_failed';
  const stageCopy = {
    blueprint_complete: ['Idea saved', 'Saved.'],
    characters_generating: ['Characters', 'Requesting characters.'],
    characters_complete: ['Characters saved', 'References next.'],
    references_generating: ['References', payload.progress?.currentName
      ? `${payload.progress.currentName} ${Math.min((payload.progress.completed ?? 0) + 1, payload.progress.total ?? 1)} of ${payload.progress.total ?? 1}`
      : 'Generating.'],
    references_complete: ['References ready', 'Saved.'],
    pages_generating: ['Pages', 'Requesting pages.'],
    workflow_failed: ['Needs attention', 'Resume when ready.'],
    phase2_failed: ['Needs attention', 'Resume when ready.'],
    complete: ['Storybook saved', 'Ready.']
  };
  const [stageTitle, stageDetail] = stageCopy[phase] ?? ['Building', 'Continuing.'];
  hideAllProjectSteps();
  elements.projectDialog.classList.add('storybook-review-open');
  elements.storybookReviewStep.hidden = false;
  elements.projectDialogTitle.textContent = 'Storybook';
  elements.storybookReviewTitle.textContent = displayProjectName(project.name || parsed.title || 'Review');
  elements.storybookPhaseBadge.className = `status-chip status-${phaseComplete ? 'complete' : phaseFailed ? 'needs_user_action' : 'generating'}`;
  elements.storybookPhaseBadge.textContent = stageTitle;
  const approvedStoryIdea = parsed.storyIdea || project.storyInput?.approvedStoryIdea || project.description || '';
  const approvedBlueprint = parsed.blueprint || project.storyBlueprint || 'Saved.';
  elements.storybookBlueprintPreview.textContent = approvedStoryIdea
    ? `STORY IDEA\n${approvedStoryIdea}\n\nBLUEPRINT\n${approvedBlueprint}`
    : approvedBlueprint;
  elements.storybookFrontCoverPreview.textContent = parsed.frontCover || project.frontCoverPrompt || 'After references.';
  elements.storybookCharacterCards.innerHTML = storybookCharacterCardsHtml(project, phaseComplete);
  elements.storybookPhase2Progress.hidden = phaseComplete || phaseFailed;
  if (elements.storybookProgressTitle) elements.storybookProgressTitle.textContent = stageTitle;
  if (elements.storybookProgressDetail) elements.storybookProgressDetail.textContent = stageDetail;
  elements.storybookReviewError.hidden = !resolvedError;
  elements.storybookReviewError.textContent = resolvedError ? String(resolvedError) : '';
  elements.storybookOpenDashboardButton.disabled = !phaseComplete;
  if (elements.storybookRetryPhase2Button) {
    elements.storybookRetryPhase2Button.hidden = !phaseFailed;
    elements.storybookRetryPhase2Button.disabled = !phaseFailed;
  }

  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  elements.storybookOfficialPagesWrap.hidden = !phaseComplete;
  if (phaseComplete) {
    elements.storybookOfficialPagesTitle.textContent = `${pages.length + 2} official pages (front cover + ${pages.length} story pages + back cover)`;
    elements.storybookOfficialPages.innerHTML = [
      { label: 'Front Cover', storyText: '', imagePrompt: parsed.frontCover || project.frontCoverPrompt },
      ...pages.map((page) => ({ label: `Story Page ${page.pageNumber}`, storyText: page.storyText, imagePrompt: page.imagePrompt })),
      { label: 'Back Cover', storyText: '', imagePrompt: parsed.backCover || project.backCoverPrompt }
    ].map((record) => `
      <article class="storybook-page-record">
        <strong>${escapeHtml(record.label)}</strong>
        ${record.storyText ? `
          <section class="story-page-text-section storybook-record-text">
            <span class="page-content-label">Story Text</span>
            <p>${escapeHtml(record.storyText)}</p>
          </section>
        ` : ''}
        <details class="story-image-prompt-details storybook-record-prompt">
          <summary data-action="toggle-page-prompt">
            <span>Image Prompt</span>
            <span class="prompt-accordion-icon" aria-hidden="true">⌄</span>
          </summary>
          <div class="story-image-prompt-body">${escapeHtml(record.imagePrompt || '')}</div>
        </details>
      </article>
    `).join('');
  }
}

function setProjectMethodChoice(choice = 'agent') {
  const normalized = ['agent', 'analysis', 'prompts'].includes(choice) ? choice : 'agent';
  currentProjectMethodChoice = normalized;
  const methodCards = document.querySelectorAll('#project-method-step [data-method-choice]');
  methodCards.forEach((card) => {
    const isActive = card.dataset.methodChoice === normalized;
    card.classList.toggle('method-card-active', isActive);
    card.dataset.state = isActive ? 'active' : 'idle';
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function showProjectMethodStep(choice = currentProjectMethodChoice || 'agent') {
  hideAllProjectSteps();
  elements.projectMethodStep.hidden = false;
  setProjectMethodChoice(choice);
  elements.projectDialogTitle.textContent = 'New book';
}

function showProjectPromptStep() {
  setProjectMethodChoice('prompts');
  hideAllProjectSteps();
  elements.projectPromptStep.hidden = false;
  elements.bulkPromptsText.required = true;
  elements.projectDialogTitle.textContent = 'Paste prompts';
  renderBulkPromptCount();
  setTimeout(() => elements.bulkPromptsText.focus(), 50);
}

function showProjectAnalysisInputStep() {
  setProjectMethodChoice('analysis');
  hideAllProjectSteps();
  elements.projectAnalysisInputStep.hidden = false;
  renderWindowsUrlPageSetup();
  setAnalysisMode(currentAnalysisMode);
}

/** VERSA AGENT's step in the New Book flow. */
function showProjectAgentStep() {
  setProjectMethodChoice('agent');
  hideAllProjectSteps();
  const step = document.getElementById('project-agent-step');
  if (step) step.hidden = false;
  if (elements.projectDialogTitle) elements.projectDialogTitle.textContent = 'Scan marketplace';
  const status = document.getElementById('agent-status');
  if (status) status.textContent = '';
  if (!marketSession.active) resetMarketRail();
}

/** Which marketplace the agent was told to validate against. */
function selectedAgentMarketplace() {
  const selected = document.querySelector('#agent-sources input[name="agentMarketplace"]:checked')?.value;
  return ['tpt', 'kdp', 'etsy'].includes(selected) ? selected : '';
}

const MARKET_STAGES = ['scan', 'analyze', 'extract', 'prompts', 'capture', 'lab', 'assemble', 'mockups', 'preview', 'export'];

const marketSession = {
  active: false,
  localStage: null,
  marketplace: 'tpt',
  query: '',
  error: '',
  stageIndex: -1,
  holdDone: false
};

let incomingMarketBook = null;
let adoptedAnalysisTaskId = null;
let incomingStartedAt = 0;

function conceptLede() {
  return document.querySelector('#project-concept-view .concept-brief__lede');
}

function openIncomingMarketplace(query) {
  incomingStartedAt = Date.now();
  incomingMarketBook = {
    query: String(query || '').trim(),
    title: query ? `Finding “${query}”…` : 'Finding…',
    targetAge: 'Waiting…',
    description: 'Scanning.',
    highlights: [],
    lede: query
      ? `Finding “${query}”.`
      : 'Finding.',
    pageCount: 0
  };
  mazeWorkspaceOpen = false;
  analysisResult = null;
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H100',location:'renderer/renderer.js:openIncomingMarketplace',message:'opened a blank marketplace for the new search',data:{query:incomingMarketBook.query},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  paintIncomingMarketplace();
}

function applyIncomingListing(listing = {}) {
  if (!incomingMarketBook) return;
  const title = String(listing.title || listing.concept || listing.keyword || '').trim();
  const productUrl = String(listing.productUrl || listing.url || '').trim();
  incomingMarketBook = {
    ...incomingMarketBook,
    title: title || incomingMarketBook.title,
    productUrl: productUrl || incomingMarketBook.productUrl || '',
    targetAge: 'Reading…',
    description: title ? `Analyzing “${title}”.` : incomingMarketBook.description,
    lede: productUrl
      ? `Listing found ${productUrl}`
      : 'Listing found.',
    highlights: productUrl
      ? [productUrl, ...(Array.isArray(incomingMarketBook.highlights) ? incomingMarketBook.highlights : [])]
      : incomingMarketBook.highlights
  };
  paintIncomingMarketplace();
}

function clearIncomingMarketplace() {
  incomingMarketBook = null;
}

function paintIncomingMarketplace() {
  const draft = incomingMarketBook;
  if (!draft) return;
  elements.emptyState.hidden = true;
  if (elements.bundleUploadView) elements.bundleUploadView.hidden = true;
  elements.projectWorkspace.hidden = false;
  if (elements.projectConceptView) elements.projectConceptView.hidden = false;
  if (elements.projectStandardView) elements.projectStandardView.hidden = true;
  document.body.classList.add('has-project');
  document.body.classList.toggle('has-books', (state?.projects?.length || 0) > 0);
  document.body.dataset.studioPin = '';
  document.body.dataset.mode = 'studio';
  if (elements.conceptProjectTitle) elements.conceptProjectTitle.textContent = draft.title;
  if (elements.conceptProjectMeta) elements.conceptProjectMeta.textContent = 'New book · 0 pages';
  if (elements.conceptDisplayAge) elements.conceptDisplayAge.textContent = draft.targetAge;
  if (elements.conceptDisplayDescription) elements.conceptDisplayDescription.textContent = draft.description;
  if (elements.conceptDisplayHighlights) {
    elements.conceptDisplayHighlights.innerHTML = (Array.isArray(draft.highlights) ? draft.highlights : [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('') || '<li>Waiting…</li>';
  }
  const lede = conceptLede();
  if (lede) lede.textContent = draft.lede;
  if (elements.conceptGeneratePromptsBtn) {
    elements.conceptGeneratePromptsBtn.disabled = true;
    elements.conceptGeneratePromptsBtn.textContent = 'Waiting…';
  }
  const composeTitle = document.querySelector('.concept-brief__compose h3');
  const composeHint = document.querySelector('.concept-brief__compose .concept-brief__hint');
  if (composeTitle) composeTitle.textContent = 'New book';
  if (composeHint) composeHint.textContent = 'Brief filling in.';
  if (typeof window.__versaSetStudioMode === 'function') window.__versaSetStudioMode('studio', true);
  paintBrowserSupervisor(state?.browserSupervisor);
}

function marketStageFromCheckpoint(kind, checkpoint) {
  if (kind === 'trend_scan') {
    switch (checkpoint?.phase) {
      case 'handed-off': return 'analyze';
      case 'discovering':
      case 'validating':
      default: return 'scan';
    }
  }
  if (kind === 'analysis') {
    switch (checkpoint?.phase) {
      case 'analysed':
      case 'project-created': return 'extract';
      case 'scraping':
      default: return 'analyze';
    }
  }
  return null;
}

function marketBrowserNote(stage, marketplace = marketSession.marketplace) {
  if (stage === 'scan') {
    if (marketplace === 'kdp') return 'Reading KDP.';
    if (marketplace === 'etsy') return 'Reading Etsy.';
    return 'Reading TPT.';
  }
  if (stage === 'analyze' || stage === 'extract') {
    return 'Analyzing.';
  }
  if (stage === 'prompts') {
    return 'Writing.';
  }
  if (stage === 'capture') {
    return 'Receiving.';
  }
  if (stage === 'lab') {
    return 'Maze Lab.';
  }
  if (stage === 'assemble') {
    return 'Assembling.';
  }
  if (stage === 'mockups') {
    return 'Mockups.';
  }
  if (stage === 'preview') {
    return 'Preview.';
  }
  if (stage === 'export') {
    return 'Exporting.';
  }
  return '';
}

function beginMarketSession({ marketplace = 'tpt', query = '', stage = 'scan', detail = '' } = {}) {
  marketSession.active = true;
  marketSession.localStage = stage;
  marketSession.marketplace = marketplace || 'tpt';
  marketSession.query = String(query || '').trim();
  marketSession.error = '';
  marketSession.stageIndex = MARKET_STAGES.indexOf(stage);
  marketSession.holdDone = false;
  setMarketStage(stage, { detail, session: 'running' });
}

function setMarketLocalStage(stage, detail = '') {
  if (!stage) return;
  marketSession.active = true;
  marketSession.holdDone = false;
  marketSession.localStage = stage;
  setMarketStage(stage, { detail, session: 'running' });
}

function failMarketSession(message) {
  marketSession.error = String(message || 'Scan failed.');
  marketSession.active = false;
  setMarketStage(marketSession.localStage || 'scan', {
    detail: marketSession.error,
    session: 'failed'
  });
}

function finishMarketSession(stage = 'lab', detail = '') {
  marketSession.localStage = stage;
  marketSession.active = false;
  marketSession.error = '';
  marketSession.holdDone = true;
  marketSession.stageIndex = Math.max(marketSession.stageIndex, MARKET_STAGES.indexOf(stage));
  setMarketStage(stage, { detail, session: 'done' });
}

function resetMarketRail() {
  marketSession.active = false;
  marketSession.localStage = null;
  marketSession.error = '';
  marketSession.stageIndex = -1;
  marketSession.holdDone = false;
  setMarketStage(null, { detail: '', session: 'idle' });
}

function setMarketStage(stage, { detail = '', session = 'running' } = {}) {
  let resolvedStage = stage;
  let stageIndex = MARKET_STAGES.indexOf(resolvedStage);
  if (session !== 'idle' && session !== 'failed' && marketSession.holdDone && stageIndex >= 0 && stageIndex < marketSession.stageIndex) {
    resolvedStage = MARKET_STAGES[marketSession.stageIndex] || resolvedStage;
    stageIndex = MARKET_STAGES.indexOf(resolvedStage);
    session = 'done';
  } else if (stageIndex > marketSession.stageIndex) {
    marketSession.stageIndex = stageIndex;
  }
  document.querySelectorAll('[data-market-live]').forEach((root) => {
    root.hidden = false;
    root.dataset.state = session === 'idle' ? 'idle' : session;
    root.querySelectorAll('[data-market-stage]').forEach((node) => {
      const name = node.dataset.marketStage;
      const index = MARKET_STAGES.indexOf(name);
      let state = 'waiting';
      if (session === 'failed' && name === resolvedStage) state = 'error';
      else if (stageIndex < 0) state = 'waiting';
      else if (index < stageIndex) state = 'done';
      else if (index === stageIndex) state = session === 'done' ? 'done' : 'live';
      node.dataset.state = state;
    });
    const detailEl = root.querySelector('[data-market-detail]');
    if (detailEl) detailEl.textContent = detail || '';
    const noteEl = root.querySelector('[data-market-browser]');
    if (noteEl) {
      const note = session === 'idle' ? '' : marketBrowserNote(resolvedStage);
      noteEl.hidden = !note;
      noteEl.textContent = note;
    }
  });
}

function applyMarketStageFromPipeline(pipeline = []) {
  if (['prompts', 'capture', 'lab', 'assemble', 'mockups', 'preview', 'export'].includes(marketSession.localStage)) {
    return;
  }
  if (marketSession.localStage === 'extract' && !marketSession.active) {
    return;
  }
  const tasks = Array.isArray(pipeline) ? pipeline : [];
  const live = tasks.find((task) => task && (task.state === 'pending' || task.state === 'leased'));
  if (!live) return;
  const stage = marketStageFromCheckpoint(live.kind, live.checkpoint)
    || (live.kind === 'analysis' ? 'analyze' : 'scan');
  const detail = live.kind === 'trend_scan'
    ? agentPhaseMessage(live.checkpoint)
    : analysisPhaseMessage(live.checkpoint);
  marketSession.active = true;
  setMarketStage(stage, { detail, session: 'running' });
}

function analysisPhaseMessage(checkpoint) {
  switch (checkpoint?.phase) {
    case 'scraping': return 'Reading listing.';
    case 'analysed': return 'Extracting.';
    case 'project-created': return 'Saving concept.';
    default: return 'Analyzing…';
  }
}

function mazeAssembledForRail(project) {
  return Boolean(projectPdf(project).productPath);
}

async function continueMazePipelineFromLab(project, readyCount) {
  const ready = Number(readyCount) || 0;
  setMarketLocalStage('assemble', `${ready} maze${ready === 1 ? '' : 's'} ready.`);
  mazeWorkspaceOpen = true;
  activeWorkspaceView = 'thumbnails';
  document.body.dataset.studioPin = '';
  applyWorkspacePanes('thumbnails');
  if (typeof api.continueMazePipeline === 'function' && project?.id) {
    try {
      await api.continueMazePipeline(project.id);
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }
}

function mockupMadeCount(project) {
  const listing = project?.tptListing || {};
  const paths = listing.thumbnailPaths || listing.mockups?.paths || [];
  return (Array.isArray(paths) ? paths : []).filter(Boolean).length;
}

function applyLiveMazeToRail(project, liveOp) {
  if (!project || project.productFormat !== 'maze') return;
  if (liveOp?.kind === 'maze' && liveOp.projectId === project.id) {
    const percent = Number(liveOp.percent) || 0;
    const detail = liveOp.message || (percent ? `Capturing ${percent}%` : 'Generating…');
    setMarketLocalStage(percent > 0 ? 'capture' : 'prompts', detail);
    return;
  }
  if ((liveOp?.kind === 'maze-assemble' || liveOp?.kind === 'print-pdf') && liveOp.projectId === project.id) {
    setMarketLocalStage('assemble', liveOp.message || 'Assembling…');
    return;
  }
  if (liveOp?.kind === 'thumbnails' && liveOp.projectId === project.id) {
    const made = mockupMadeCount(project);
    const next = Math.min(4, Math.max(1, made + 1));
    setMarketLocalStage('mockups', liveOp.message || `Mockup ${next} of 4`);
    return;
  }
  if (liveOp?.kind === 'preview' && liveOp.projectId === project.id) {
    setMarketLocalStage('preview', liveOp.message || 'Generating…');
    return;
  }
  if (liveOp?.kind === 'export' && liveOp.projectId === project.id) {
    setMarketLocalStage('export', liveOp.message || 'Exporting…');
    return;
  }
  const ready = (project.mazeProject?.pages || []).filter((page) => page.generationStatus === 'ready').length;
  const mazeDone = ready > 0 && (project.stepMazeStatus === 'completed' || marketSession.localStage === 'capture' || marketSession.localStage === 'lab');
  if (!mazeDone) return;
  const made = mockupMadeCount(project);
  const previewReady = Boolean(project.tptListing?.videoPreviewPath || project.tptListing?.video?.path);
  const exportDone = project.stepExportStatus === 'completed';
  const assembled = mazeAssembledForRail(project);
  if (exportDone) {
    finishMarketSession('export', 'Export ready.');
    return;
  }
  if (previewReady && made >= 4) {
    setMarketLocalStage('export', 'Preview ready.');
    return;
  }
  if (made >= 4) {
    setMarketLocalStage('preview', 'Mockups ready.');
    return;
  }
  if (assembled) {
    setMarketLocalStage('mockups', made ? `${made} of 4 mockups.` : 'Mockups next');
    return;
  }
  setMarketLocalStage('assemble', `${ready} maze${ready === 1 ? '' : 's'} ready.`);
}

function formatSupervisorClock(value) {
  const at = Number(value) || 0;
  if (!at) return '—';
  const delta = Math.max(0, Date.now() - at);
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

function paintBrowserSupervisor(snapshot = state?.browserSupervisor) {
  document.querySelectorAll('[data-browser-supervisor]').forEach((node) => {
    if (!snapshot?.state) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    const pages = snapshot.pagesCompleted != null
      ? `${snapshot.pagesCompleted}/${snapshot.pagesTotal || '?'} pages`
      : '';
    const retry = snapshot.nextRetryAt && snapshot.nextRetryAt > Date.now()
      ? `Retry ${Math.max(1, Math.round((snapshot.nextRetryAt - Date.now()) / 1000))}s.`
      : '';
    const user = snapshot.userActionRequired ? 'Needs you.' : '';
    node.hidden = false;
    node.textContent = [
      String(snapshot.state || '').replace(/_/g, ' '),
      snapshot.action && snapshot.action !== 'WAIT' ? String(snapshot.action).replace(/_/g, ' ') : '',
      snapshot.reason || '',
      `Last ${formatSupervisorClock(snapshot.lastProgressAt)}`,
      pages,
      retry,
      user
    ].filter(Boolean).join(' · ');
  });
}

function findIncomingAnalysisProject(nextState = state, pipeline = []) {
  const tasks = Array.isArray(pipeline) ? pipeline : [];
  const done = tasks.find((task) => (
    task?.kind === 'analysis'
    && (task.checkpoint?.projectId || task.projectId)
    && (task.state === 'done' || task.checkpoint?.phase === 'project-created')
  ));
  const projectId = done?.checkpoint?.projectId || done?.projectId || null;
  const fromTask = projectId
    ? ((nextState?.projects || []).find((item) => item.id === projectId) || { id: projectId })
    : null;
  if (fromTask?.id && adoptedAnalysisTaskId !== (done?.id || fromTask.id)) {
    if (!(incomingStartedAt && done?.updatedAt && done.updatedAt < incomingStartedAt - 2000)) {
      return { project: fromTask, task: done };
    }
  }
  const created = (nextState?.projects || [])
    .filter((project) => {
      const at = Date.parse(project.createdAt || project.updatedAt || '') || 0;
      return incomingStartedAt ? at >= incomingStartedAt - 2000 : false;
    })
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0];
  if (created && adoptedAnalysisTaskId !== created.id) return { project: created, task: done || null };
  return null;
}

function adoptFinishedMarketplaceAnalysis(pipeline = [], nextState = state) {
  if (mazeAutoGenerateId) return;
  if (['prompts', 'capture', 'lab'].includes(marketSession.localStage)) return;
  if (!incomingMarketBook && !marketSession.active) return;
  const found = findIncomingAnalysisProject(nextState, pipeline);
  if (!found?.project?.id) return;
  adoptedAnalysisTaskId = found.task?.id || found.project.id;
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H121',location:'renderer/renderer.js:adoptFinishedMarketplaceAnalysis',message:'adopting a finished analysis that the IPC wait missed',data:{projectId:found.project.id,taskId:found.task?.id||null,incoming:Boolean(incomingMarketBook),productFormat:found.project.productFormat||null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  void finishGateAnalysis({
    project: found.project,
    conversationUrl: found.task?.checkpoint?.conversationUrl || found.project.conversationUrl || 'resumed',
    analysis: {
      title: found.project.name || '',
      description: found.project.description || '',
      pageCount: found.project.activityCount || 20
    },
    detectedFormat: { productFormat: found.project.productFormat || 'maze' }
  });
}

function syncMarketRailFromState(nextState = state) {
  applyLiveMazeToRail(nextState?.activeProject, nextState?.liveOperation);
  paintBrowserSupervisor(nextState?.browserSupervisor);
  adoptFinishedMarketplaceAnalysis(nextState?.agentPipeline || [], nextState);
  if (!nextState?.agentPipeline) return;
  applyMarketStageFromPipeline(nextState.agentPipeline);
}

function markConceptReadyFromAnalysis(detail = 'Analysis saved.') {
  marketSession.active = false;
  marketSession.localStage = 'extract';
  marketSession.error = '';
  setMarketStage('extract', { detail, session: 'done' });
}

function seedConceptMarketRail() {
  if (incomingMarketBook) return;
  if (MARKET_STAGES.includes(marketSession.localStage) || marketSession.active) return;
  markConceptReadyFromAnalysis();
}

function applyPromptProgressToRail(payload = {}) {
  if (marketSession.localStage !== 'prompts' && marketSession.localStage !== 'capture') return;
  const have = Number(payload.have) || 0;
  const total = Number(payload.total) || 0;
  const parsed = Number(payload.parsedCount) || 0;
  if (have <= 0 && parsed <= 0) return;
  const received = have || parsed;
  const detail = total
    ? `Receiving ${received} of ${total}`
    : 'Receiving…';
  setMarketLocalStage('capture', detail);
}

/**
 * Start a scan and follow it to its handoff.
 *
 * The scan is durable. When it returns a winner, the renderer starts the normal
 * URL analysis task so the user lands on the existing page-count screen.
 *
 * Every state change is also written to `data-state` and `#agent-result`, because
 * this app is meant to be drivable by an agent as well as a person, and an agent
 * that can click but cannot read the outcome is not automating anything. Reading
 * a `data-state` attribute is reliable in a way that parsing a status sentence
 * never is.
 */
async function runVersaAgent(button) {
  const step = document.getElementById('project-agent-step');
  const status = document.getElementById('agent-status');
  const resultBox = document.getElementById('agent-result');
  const query = String(document.getElementById('agent-query-input')?.value || '').trim();
  const marketplace = selectedAgentMarketplace();

  const setState = (value, message, payload = null) => {
    if (step) step.dataset.state = value;
    if (button) button.dataset.state = value;
    if (status) status.textContent = message ?? '';
    if (resultBox) {
      resultBox.hidden = !payload;
      // The full result as data, so an agent reads a value instead of a sentence.
      if (payload) resultBox.dataset.result = JSON.stringify(payload);
      else delete resultBox.dataset.result;
      resultBox.innerHTML = payload ? agentResultHtml(payload) : '';
    }
  };

  if (!marketplace) {
    setState('invalid', 'Choose a marketplace.');
    showToast('Choose a marketplace.', 'warning');
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Scanning…'; }
  beginMarketSession({ marketplace, query, stage: 'scan', detail: 'Reading the trending feed…' });
  setState('running', 'Reading the trending feed…');

  try {
    const started = await api.scanTrends({ query, marketplace });
    if (!started?.taskId) throw new Error('Scan failed.');
    if (step) step.dataset.taskId = started.taskId;

    const deadline = Date.now() + 11 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const scan = await api.agentScanResult(started.taskId);
      if (!scan) break;
      if (scan.state === 'done') {
        const opportunity = scan.result?.opportunity;
        setMarketLocalStage('analyze', opportunity
          ? `Chose "${opportunity.keyword}".`
          : 'Analyzing…');
        setState('done', opportunity
          ? `Chose "${opportunity.keyword}".`
          : 'Analyzing…', scan.result ?? null);
        await startAgentAnalysisHandoff(scan.result);
        showToast(`Chose "${opportunity?.keyword ?? 'a product'}".`, 'success');
        return;
      }
      if (scan.state === 'failed' || scan.state === 'cancelled') {
        throw new Error(scan.lastError || 'Scan failed.');
      }
      setMarketStage('scan', { detail: agentPhaseMessage(scan.checkpoint), session: 'running' });
      setState('running', agentPhaseMessage(scan.checkpoint));
    }
    // The wait ended; the scan did not. It is a queued task either way.
    setState('running', 'Still scanning.');
  } catch (error) {
    failMarketSession(String(error.message || error));
    setState('failed', String(error.message || error));
    showToast(String(error.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Scan'; }
  }
}

/** Say which phase the scan is in, from the checkpoint it committed. */
function agentPhaseMessage(checkpoint) {
  switch (checkpoint?.phase) {
    case 'discovering': return 'Scanning…';
    case 'validating': {
      const done = checkpoint.done?.length ?? 0;
      const remaining = checkpoint.remaining ?? 0;
      return `Checking ${done} keyword${done === 1 ? '' : 's'}.`;
    }
    case 'handed-off': return 'Listing found.';
    default: return 'Scanning…';
  }
}

/**
 * What the agent found and why it chose it.
 *
 * The evidence is shown, not just the answer — a decision a person can argue
 * with is worth more than one they have to trust.
 */
function agentResultHtml(result) {
  const opportunity = result?.opportunity;
  if (!opportunity) return '';
  const evidence = opportunity.evidence || {};
  const facts = [
    `${evidence.listings ?? 0} listing${evidence.listings === 1 ? '' : 's'}`,
    (evidence.marketplaces || []).join(' · ') || null,
    evidence.medianPrice ? `median $${evidence.medianPrice}` : null,
    evidence.topReviews ? `leader ${evidence.topReviews} reviews` : null
  ].filter(Boolean);
  const runners = (opportunity.runnersUp || []).map((item) => escapeHtml(item.keyword)).join(', ');
  return `
    <p class="eyebrow">Chosen</p>
    <strong data-testid="agent-keyword-chosen">${escapeHtml(opportunity.keyword)}</strong>
    <p class="muted" data-testid="agent-evidence">${escapeHtml(facts.join(' · '))}</p>
    ${runners ? `<p class="muted">Also: ${runners}</p>` : ''}
    ${result.degradedDiscovery ? '<p class="muted">Used your keyword.</p>' : ''}
  `;
}


function competitorMockupStripHtml(projectId, mockups, cacheKey) {
  const images = Array.isArray(mockups?.images) ? mockups.images : [];
  if (!projectId || !images.length) return '';
  return images.map((image, index) => `
    <figure class="competitor-mockup-thumb">
      <img src="tpt-image://competitor-mockup/${encodeURIComponent(projectId)}/${index}?v=${encodeURIComponent(cacheKey || '')}" alt="Competitor listing mockup ${index + 1}">
      <figcaption>Mockup ${index + 1}</figcaption>
    </figure>
  `).join('');
}

function renderAnalysisMockups(result) {
  const box = elements.resultMockupsBox;
  if (!box) return;
  const isUrl = currentAnalysisMode === 'url';
  const mockups = result?.competitorMockups || result?.project?.competitorMockups;
  if (!isUrl) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const count = Array.isArray(mockups?.images) ? mockups.images.length : 0;
  const status = mockups?.status || 'empty';
  if (elements.resultMockupsStatus) {
    if (count) {
      elements.resultMockupsStatus.textContent = `${count} mockup${count === 1 ? '' : 's'} captured.`;
    } else if (status === 'skipped') {
      elements.resultMockupsStatus.textContent = mockups?.warning || 'No mockups.';
    } else if (status === 'blocked') {
      elements.resultMockupsStatus.textContent = mockups?.warning || 'Listing unavailable.';
    } else {
      elements.resultMockupsStatus.textContent = mockups?.warning || 'No mockups.';
    }
  }
  if (elements.resultMockupsStrip) {
    elements.resultMockupsStrip.innerHTML = competitorMockupStripHtml(result?.project?.id, mockups, result?.project?.updatedAt);
  }
  if (elements.resultIncludeMockupsLabel) {
    elements.resultIncludeMockupsLabel.hidden = count === 0;
  }
  if (elements.resultIncludeMockups) {
    elements.resultIncludeMockups.checked = count > 0;
  }
}

function renderConceptMockups(project) {
  const block = elements.conceptMockupsBlock;
  if (!block) return;
  const mockups = project?.competitorMockups;
  const count = Array.isArray(mockups?.images) ? mockups.images.length : 0;
  if (!count) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  if (elements.conceptMockupsStatus) {
    elements.conceptMockupsStatus.textContent = `${count} mockup${count === 1 ? '' : 's'} attached.`;
  }
  if (elements.conceptMockupsStrip) {
    elements.conceptMockupsStrip.innerHTML = `${competitorMockupStripHtml(project.id, mockups, project.updatedAt)}
      <button class="button button-ghost button-danger" data-action="clear-competitor-mockups" type="button">Delete mockups</button>`;
  }
}

function renderAnalysisResult(result, isUrl = currentAnalysisMode === 'url') {
  analysisResult = result;
  const { analysis } = result;
  applyDetectedPipeline(result.detectedFormat);

  elements.resultTitle.textContent = displayProjectName(analysis.title);
  elements.resultTargetAge.textContent = analysis.targetAge || 'Pre-K / Grade 1';
  elements.resultDescription.textContent = analysis.description || 'Printable workbook based on analyzed product.';
  elements.resultHighlightsList.innerHTML = (analysis.keyHighlights || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const resolvedCount = (Number.isFinite(analysis.pageCount) && analysis.pageCount > 0) ? analysis.pageCount : 1;
  elements.resultCompetitorCount.textContent = String(resolvedCount);
  elements.resultCustomCountInput.value = String(resolvedCount);

  if (isUrl && runningOnWindows()) {
    syncAnalysisPageSetup(result.project?.format, result.project?.orientation);
  }

  showProjectAnalysisResultStep();
}

function normalizeAgentAnalysisInput(scanResult = {}) {
  const handoff = scanResult.analysisInput || scanResult.chosen || null;
  const productUrl = String(handoff?.productUrl || handoff?.url || '').trim();
  if (!productUrl) return null;
  return {
    ...handoff,
    sourceMode: 'url',
    productUrl,
    keyword: handoff.keyword || scanResult.opportunity?.keyword || handoff.trendMetadata?.query || '',
    title: handoff.title || handoff.concept || handoff.trendMetadata?.title || '',
    tptNiche: handoff.tptNiche || '',
    activityType: handoff.activityType || '',
    metadataText: handoff.metadataText || '',
    niche: handoff.niche || '',
    ...(runningOnWindows() ? {
      format: elements.analysisUrlPageFormat?.value || 'LETTER',
      orientation: elements.analysisUrlPageOrientation?.value || 'portrait'
    } : {})
  };
}

async function startAgentAnalysisHandoff(scanResult = {}) {
  const chosen = normalizeAgentAnalysisInput(scanResult);
  if (!chosen) throw new Error('No product URL.');

  setAnalysisMode('url');
  if (elements.analysisProductUrl) elements.analysisProductUrl.value = chosen.productUrl;
  if (elements.analysisErrorBox) {
    elements.analysisErrorBox.hidden = true;
    elements.analysisErrorBox.textContent = '';
  }
  if (!incomingMarketBook) openIncomingMarketplace(chosen.keyword || chosen.title || chosen.concept || '');
  applyIncomingListing(chosen);
  showProjectAnalysisLoadingStep(true);
  setMarketLocalStage('analyze', 'Analyzing.');

  try {
    const result = await invoke(() => api.analyzeProduct(chosen), { refresh: false });
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H92',location:'renderer/renderer.js:startAgentAnalysisHandoff',message:'analyzeProduct returned; finishing the same way Gate does',data:{hasProject:Boolean(result?.project?.id),productFormat:result?.project?.productFormat||result?.detectedFormat?.productFormat||null,title:result?.analysis?.title||''},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    await finishGateAnalysis(result);
    return result;
  } catch (error) {
    if (elements.analysisErrorBox) {
      elements.analysisErrorBox.hidden = false;
      elements.analysisErrorBox.textContent = errorMessage(error);
    }
    showProjectAnalysisInputStep();
    throw error;
  }
}

function showProjectAnalysisLoadingStep(isUrl = false) {
  hideAllProjectSteps();
  elements.projectAnalysisLoadingStep.hidden = false;
  elements.projectDialogTitle.textContent = 'Analyzing…';
  if (elements.analysisLoadingDetail) {
    elements.analysisLoadingDetail.textContent = isUrl
      ? 'Collecting listing.'
      : 'Analyzing.';
  }
  setMarketLocalStage('analyze', elements.analysisLoadingDetail?.textContent || 'Analyzing…');
}

function showProjectAnalysisResultStep() {
  hideAllProjectSteps();
  elements.projectAnalysisResultStep.hidden = false;
  if (runningOnWindows() && analysisResult?.project) {
    syncAnalysisPageSetup(analysisResult.project.format, analysisResult.project.orientation);
  }
  renderAnalysisMockups(analysisResult);
  elements.projectDialogTitle.textContent = 'Analysis';
}

function showProjectPromptsLoadingStep(pageCount, mockupCount = 0) {
  hideAllProjectSteps();
  elements.projectPromptsLoadingStep.hidden = false;
  elements.promptsLoadingTitle.textContent = `Generating ${pageCount}…`;
  elements.projectDialogTitle.textContent = 'Generating…';
  if (elements.promptsLoadingDetail) {
    elements.promptsLoadingDetail.textContent = mockupCount
      ? `Attaching ${mockupCount} mockup${mockupCount === 1 ? '' : 's'}.`
      : 'Writing prompts.';
  }
  setMarketLocalStage('prompts', elements.promptsLoadingDetail?.textContent || `Generating ${pageCount}…`);
}

function setAnalysisMode(mode) {
  currentAnalysisMode = ['url', 'builder', 'story'].includes(mode) ? mode : 'url';
  elements.analysisTabs.querySelectorAll('[data-analysis-mode]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.analysisMode === currentAnalysisMode);
  });
  if (elements.analysisUrlPanel) elements.analysisUrlPanel.hidden = currentAnalysisMode !== 'url';
  if (elements.analysisBuilderPanel) elements.analysisBuilderPanel.hidden = currentAnalysisMode !== 'builder';
  if (elements.analysisStoryPanel) elements.analysisStoryPanel.hidden = currentAnalysisMode !== 'story';
  
  if (elements.startAnalysisButton) {
    if (currentAnalysisMode === 'url') {
      elements.startAnalysisButton.textContent = 'Analyze';
    } else if (currentAnalysisMode === 'builder') {
      elements.startAnalysisButton.textContent = 'Analyze';
    } else {
      elements.startAnalysisButton.textContent = 'Generate';
    }
  }
  if (elements.projectDialogTitle) {
    if (currentAnalysisMode === 'url') {
      elements.projectDialogTitle.textContent = 'Product URL';
    } else if (currentAnalysisMode === 'builder') {
      elements.projectDialogTitle.textContent = 'Prompt builder';
    } else {
      elements.projectDialogTitle.textContent = 'Storybook';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   BOOK PROMPT BUILDER — cascading picker + chips
═══════════════════════════════════════════════════════════════ */

const TPT_TAXONOMY = [
  {
    label: 'Subject',
    children: [
      { label: 'English Language Arts', children: ['Creative Writing', 'Grammar', 'Handwriting', 'Informational Text', 'Literature', 'Phonics', 'Reading', 'Sight Words', 'Speaking & Listening', 'Spelling', 'Vocabulary', 'Writing'] },
      { label: 'Math', children: ['Algebra', 'Applied Math', 'Arithmetic', 'Basic Operations', 'Decimals', 'Fractions', 'Geometry', 'Graphing', 'Measurement', 'Mental Math', 'Money', 'Numbers', 'Order of Operations', 'Place Value', 'Statistics', 'Time', 'Word Problems'] },
      { label: 'Science', children: ['Anatomy', 'Astronomy', 'Biology', 'Chemistry', 'Computer Science/Technology', 'Earth Sciences', 'Engineering', 'Environment', 'General Science', 'Marine Science', 'Physical Science', 'Physics', 'Robotics'] },
      { label: 'Social Studies', children: ['African History', 'American History', 'Ancient History', 'Asian Studies', 'Civics', 'Economics', 'European History', 'Geography', 'Government', 'Media Literacy', 'Native Americans', 'World History'] },
      { label: 'Arts & Languages', children: ['Art', 'Drama', 'Foreign Language', 'French', 'Instrumental Music', 'Music', 'Sign Language', 'Spanish', 'Vocal Music'] },
      { label: 'Additional Areas', children: ['Back to School', 'Character Education', 'Classroom Community', 'Critical Thinking', 'Early Intervention', 'EFL / ESL / ELD', 'Gifted and Talented', 'Health', 'Library Skills', 'Life Skills', 'Mental Health', 'Physical Education', 'Problem Solving', 'School Counseling', 'Special Education', 'STEM', 'Vocational Education'] }
    ]
  },
  {
    label: 'Grade Level',
    children: [
      { label: 'Early Childhood', children: ['PreK', 'Kindergarten', '1st Grade', '2nd Grade'] },
      { label: 'Elementary', children: ['3rd Grade', '4th Grade', '5th Grade', '6th Grade'] },
      { label: 'Middle School', children: ['7th Grade', '8th Grade', '9th Grade'] },
      { label: 'High School', children: ['10th Grade', '11th Grade', '12th Grade'] },
      { label: 'Other', children: ['Homeschool', 'Adult Education', 'Staff', 'Not Grade Specific'] }
    ]
  },
  {
    label: 'Resource Type',
    children: [
      { label: 'Printables', children: ['Worksheets', 'Activity Pages', 'Coloring Pages', 'Graphic Organizers', 'Task Cards', 'Flashcards', 'Posters', 'Anchor Charts'] },
      { label: 'Workbooks', children: ['Practice Books', 'Tracing Books', 'Skill Books', 'Review Packets', 'Morning Work Packets'] },
      { label: 'Centers & Games', children: ['Math Centers', 'Literacy Centers', 'Science Centers', 'Board Games', 'Card Games', 'Puzzles', 'Sorting Activities'] },
      { label: 'Classroom Decor', children: ['Bulletin Board Kits', 'Classroom Labels', 'Name Tags', 'Word Walls', 'Calendar Pieces', 'Banners & Bunting'] },
      { label: 'Crafts & Art', children: ['Cut and Paste', 'Paper Crafts', 'Seasonal Crafts', 'Science Experiments', 'Art Projects'] }
    ]
  },
  {
    label: 'Season / Holiday',
    children: [
      { label: 'Fall', children: ['Back to School', 'Halloween', 'Thanksgiving', 'Autumn'] },
      { label: 'Winter', children: ['Christmas', 'Hanukkah', 'Kwanzaa', 'New Year', 'Winter Season', 'Valentines Day'] },
      { label: 'Spring', children: ['St. Patrick\'s Day', 'Easter', 'Earth Day', 'Mother\'s Day', 'Spring Season'] },
      { label: 'Summer', children: ['End of Year', 'Summer Review', 'Father\'s Day', 'Summer Season'] },
      { label: 'Year-Round', children: ['All Seasons', 'No Holiday Theme'] }
    ]
  },
  {
    label: 'Format',
    children: [
      { label: 'Page Layout', children: ['Portrait', 'Landscape', 'Half Page', 'Full Page', 'Two-per-Page'] },
      { label: 'Color Scheme', children: ['Full Color', 'Black & White', 'Low Ink Friendly'] },
      { label: 'Style', children: ['Cute / Kawaii', 'Minimalist', 'Retro / Vintage', 'Bold Graphics', 'Real Photos', 'Line Art'] }
    ]
  },
  {
    label: 'Skill Level',
    children: [
      { label: 'Beginner', children: ['No Prerequisites', 'Tracing Lines', 'Matching', 'Color by Code'] },
      { label: 'Intermediate', children: ['Fill in the Blank', 'Short Answer', 'Multiple Choice', 'Sequencing'] },
      { label: 'Advanced', children: ['Open-Ended Response', 'Critical Thinking', 'Research Based', 'Multi-Step Problems'] }
    ]
  }
];

// Builder chip state
let builderChips = []; // { id, label, isText }
let builderChipIdSeq = 0;
let pickerSelectedCategory = null;
let pickerSelectedSub = null;
let pickerSelectedLeaf = null;

function renderBuilderChips() {
  const hasChips = builderChips.length > 0;
  if (elements.builderChipsArea) elements.builderChipsArea.classList.toggle('hidden', !hasChips);
  if (!elements.builderChipsList) return;
  elements.builderChipsList.innerHTML = builderChips.map((chip) => `
    <span class="info-chip${chip.isText ? ' text-chip' : ''}" data-chip-id="${chip.id}">
      <span class="chip-label" title="${escapeHtml(chip.label)}">${escapeHtml(chip.label)}</span>
      <button class="chip-remove" data-remove-chip="${chip.id}" title="Remove" type="button">×</button>
    </span>
  `).join('');
}

function addChip(label, isText = false) {
  builderChips.push({ id: ++builderChipIdSeq, label, isText });
  renderBuilderChips();
}

function removeChip(id) {
  builderChips = builderChips.filter((c) => c.id !== id);
  renderBuilderChips();
}

function resetPicker() {
  pickerSelectedCategory = null;
  pickerSelectedSub = null;
  pickerSelectedLeaf = null;
  if (elements.builderPickerSearch) elements.builderPickerSearch.value = '';
  if (elements.builderPickerSearchResultsWrap) elements.builderPickerSearchResultsWrap.classList.add('hidden');
  if (elements.builderPickerCascadingRow) elements.builderPickerCascadingRow.classList.remove('hidden');
  if (elements.builderPickerCategories) {
    elements.builderPickerCategories.innerHTML = TPT_TAXONOMY.map((cat, i) =>
      `<li data-cat-index="${i}">${escapeHtml(cat.label)}</li>`
    ).join('');
  }
  if (elements.builderPickerSubCol) elements.builderPickerSubCol.hidden = true;
  if (elements.builderPickerLeafCol) elements.builderPickerLeafCol.hidden = true;
  if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = true;
}

// Flattened taxonomy list for quick search
function getFlattenedTaxonomy() {
  const paths = [];
  for (const cat of TPT_TAXONOMY) {
    for (const sub of cat.children) {
      if (typeof sub === 'string') {
        paths.push({
          path: [cat.label, sub],
          label: `${cat.label} → ${sub}`
        });
      } else {
        const subLabel = sub.label;
        for (const leaf of sub.children) {
          paths.push({
            path: [cat.label, subLabel, leaf],
            label: `${cat.label} → ${subLabel} → ${leaf}`
          });
        }
      }
    }
  }
  return paths;
}

const flatTaxonomy = getFlattenedTaxonomy();

if (elements.builderPickerSearch) {
  elements.builderPickerSearch.addEventListener('input', () => {
    const query = elements.builderPickerSearch.value.trim().toLowerCase();
    if (!query) {
      if (elements.builderPickerSearchResultsWrap) elements.builderPickerSearchResultsWrap.classList.add('hidden');
      if (elements.builderPickerCascadingRow) elements.builderPickerCascadingRow.classList.remove('hidden');
      return;
    }

    const matches = flatTaxonomy.filter((item) => item.label.toLowerCase().includes(query));

    if (elements.builderPickerSearchResults) {
      elements.builderPickerSearchResults.innerHTML = matches.map((match, idx) => `
        <li data-search-result-index="${idx}" data-path-json="${escapeHtml(JSON.stringify(match.path))}">
          ${escapeHtml(match.label)}
        </li>
      `).join('') || '<li class="muted" style="padding: 12px; cursor: default;">No matching categories or options found</li>';
    }

    if (elements.builderPickerSearchResultsWrap) elements.builderPickerSearchResultsWrap.classList.remove('hidden');
    if (elements.builderPickerCascadingRow) elements.builderPickerCascadingRow.classList.add('hidden');

    if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = true;
  });
}

if (elements.builderPickerSearchResults) {
  elements.builderPickerSearchResults.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-search-result-index]');
    if (!li || !li.dataset.pathJson) return;
    const path = JSON.parse(li.dataset.pathJson);
    
    pickerSelectedCategory = { label: path[0] };
    pickerSelectedSub = path[1];
    pickerSelectedLeaf = path[2] || null;

    elements.builderPickerSearchResults.querySelectorAll('li').forEach((item) => {
      item.classList.toggle('is-selected', item === li);
    });

    if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = false;
  });
}

function openInfoPicker() {
  if (elements.builderTextPicker) elements.builderTextPicker.classList.add('hidden');
  if (elements.builderInfoPicker) elements.builderInfoPicker.classList.remove('hidden');
  resetPicker();
}

function closeInfoPicker() {
  if (elements.builderInfoPicker) elements.builderInfoPicker.classList.add('hidden');
}

function openTextPicker() {
  if (elements.builderInfoPicker) elements.builderInfoPicker.classList.add('hidden');
  if (elements.builderTextPicker) elements.builderTextPicker.classList.remove('hidden');
  if (elements.builderTextInfoInput) { elements.builderTextInfoInput.value = ''; elements.builderTextInfoInput.focus(); }
}

function closeTextPicker() {
  if (elements.builderTextPicker) elements.builderTextPicker.classList.add('hidden');
}

// Picker category click
if (elements.builderPickerCategories) {
  elements.builderPickerCategories.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-cat-index]');
    if (!li) return;
    const idx = Number(li.dataset.catIndex);
    pickerSelectedCategory = TPT_TAXONOMY[idx];
    pickerSelectedSub = null;
    pickerSelectedLeaf = null;
    // highlight
    elements.builderPickerCategories.querySelectorAll('li').forEach((item) =>
      item.classList.toggle('is-selected', item === li)
    );
    // populate subcategories
    const subs = pickerSelectedCategory.children || [];
    if (elements.builderPickerSubLabel) elements.builderPickerSubLabel.textContent = pickerSelectedCategory.label;
    if (elements.builderPickerSubcategories) {
      elements.builderPickerSubcategories.innerHTML = subs.map((sub, i) =>
        `<li data-sub-index="${i}">${escapeHtml(typeof sub === 'string' ? sub : sub.label)}</li>`
      ).join('');
    }
    if (elements.builderPickerSubCol) elements.builderPickerSubCol.hidden = false;
    if (elements.builderPickerLeafCol) elements.builderPickerLeafCol.hidden = true;
    if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = true;
  });
}

// Picker sub click
if (elements.builderPickerSubcategories) {
  elements.builderPickerSubcategories.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-sub-index]');
    if (!li || !pickerSelectedCategory) return;
    const idx = Number(li.dataset.subIndex);
    const subEntry = pickerSelectedCategory.children[idx];
    pickerSelectedSub = typeof subEntry === 'string' ? subEntry : subEntry.label;
    pickerSelectedLeaf = null;
    elements.builderPickerSubcategories.querySelectorAll('li').forEach((item) =>
      item.classList.toggle('is-selected', item === li)
    );
    if (typeof subEntry === 'string') {
      // leaf level reached at sub
      if (elements.builderPickerLeafCol) elements.builderPickerLeafCol.hidden = true;
      if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = false;
    } else {
      const leaves = subEntry.children || [];
      if (elements.builderPickerLeafLabel) elements.builderPickerLeafLabel.textContent = subEntry.label;
      if (elements.builderPickerLeaves) {
        elements.builderPickerLeaves.innerHTML = leaves.map((leaf, i) =>
          `<li data-leaf-index="${i}">${escapeHtml(leaf)}</li>`
        ).join('');
      }
      if (elements.builderPickerLeafCol) elements.builderPickerLeafCol.hidden = false;
      if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = true;
    }
  });
}

// Picker leaf click
if (elements.builderPickerLeaves) {
  elements.builderPickerLeaves.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-leaf-index]');
    if (!li || !pickerSelectedCategory || !pickerSelectedSub) return;
    const idx = Number(li.dataset.leafIndex);
    const sub = pickerSelectedCategory.children.find((s) => (typeof s === 'object' && s.label === pickerSelectedSub));
    pickerSelectedLeaf = sub ? sub.children[idx] : null;
    elements.builderPickerLeaves.querySelectorAll('li').forEach((item) =>
      item.classList.toggle('is-selected', item === li)
    );
    if (elements.builderSaveInfoButton) elements.builderSaveInfoButton.disabled = false;
  });
}

// Save information button
if (elements.builderSaveInfoButton) {
  elements.builderSaveInfoButton.addEventListener('click', () => {
    if (!pickerSelectedCategory) return;
    const parts = [pickerSelectedCategory.label];
    if (pickerSelectedSub) parts.push(pickerSelectedSub);
    if (pickerSelectedLeaf) parts.push(pickerSelectedLeaf);
    addChip(parts.join(' → '));
    closeInfoPicker();
  });
}

// Cancel picker
if (elements.builderCancelPickerButton) {
  elements.builderCancelPickerButton.addEventListener('click', closeInfoPicker);
}

// Add Information button
if (elements.builderAddInfoButton) {
  elements.builderAddInfoButton.addEventListener('click', () => {
    if (elements.builderInfoPicker && !elements.builderInfoPicker.classList.contains('hidden')) {
      closeInfoPicker();
    } else {
      openInfoPicker();
    }
  });
}

// Add Text button
if (elements.builderAddTextButton) {
  elements.builderAddTextButton.addEventListener('click', () => {
    if (elements.builderTextPicker && !elements.builderTextPicker.classList.contains('hidden')) {
      closeTextPicker();
    } else {
      openTextPicker();
    }
  });
}

// Save text info
if (elements.builderSaveTextButton) {
  elements.builderSaveTextButton.addEventListener('click', () => {
    const text = (elements.builderTextInfoInput?.value ?? '').trim();
    if (!text) { elements.builderTextInfoInput?.focus(); return; }
    addChip(text, true);
    closeTextPicker();
  });
}

// Cancel text
if (elements.builderCancelTextButton) {
  elements.builderCancelTextButton.addEventListener('click', closeTextPicker);
}

// Chip removal (delegated)
if (elements.builderChipsList) {
  elements.builderChipsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-chip]');
    if (!btn) return;
    removeChip(Number(btn.dataset.removeChip));
  });
}

// Enter key in text info input
if (elements.builderTextInfoInput) {
  elements.builderTextInfoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); elements.builderSaveTextButton?.click(); }
  });
}

function getBuilderPayload() {
  const ideaText = (elements.analysisBuilderIdea?.value ?? '').trim();
  const chipsText = builderChips.map((c) => c.label).join('; ');
  const metadataText = [chipsText].filter(Boolean).join('\n');
  return {
    sourceMode: 'builder',
    keyword: ideaText,
    tptNiche: '',
    activityType: '',
    metadataText,
    title: ideaText.slice(0, 80),
    niche: chipsText.slice(0, 120)
  };
}

function selectedJob() {
  return activeProject()?.jobs?.find((job) => job.id === selectedJobId) ?? null;
}

function activeEngine() {
  const value = String(state?.integrations?.aiEngine || '').toLowerCase();
  if (value === 'gemini') return 'gemini';
  if (value === 'meta') return 'meta';
  return 'chatgpt';
}

function engineLabel(engine = activeEngine()) {
  if (engine === 'gemini') return 'Gemini';
  if (engine === 'meta') return 'Meta';
  return 'ChatGPT';
}

function unusedEngineSummary(engine = activeEngine()) {
  if (engine === 'meta') return 'Gemini writes prompts.';
  if (engine === 'gemini') return 'ChatGPT unused.';
  return 'Gemini writes prompts.';
}

function renderBrowser() {
  const connected = Boolean(state?.browser?.connected);
  const queueRunning = Boolean(state?.queue?.running);
  const loginRequired = Boolean(state?.app?.loginRequired);
  const meta = activeEngine() === 'meta';
  elements.browserPill.classList.toggle('is-online', connected);
  elements.browserPill.classList.toggle('is-offline', !connected);
  if (elements.focusBrowserButton) {
    elements.focusBrowserButton.hidden = true;
    elements.focusBrowserButton.disabled = true;
  }
  if (elements.launchBrowserButton) {
    elements.launchBrowserButton.hidden = true;
  }
  if (meta) {
    elements.browserLabel.textContent = loginRequired
      ? 'Meta sign in'
      : (connected ? 'Meta running' : 'Meta ready');
    return;
  }
  elements.browserLabel.textContent = connected
    ? (queueRunning || state.browser.headless || !state.browser.loginMode
      ? 'Engine running'
      : (loginRequired ? 'Sign in' : 'Engine connected'))
    : (loginRequired ? 'Sign in' : 'Engine ready');
}

function renderUpdate() {
  const update = state?.app?.update;
  const status = update?.status ?? 'disabled';
  const currentVersion = update?.currentVersion ?? state?.app?.version ?? '0.3.6';
  const availableVersion = update?.availableVersion ?? '';
  const percent = update?.percent ?? 0;
  const checkedAt = update?.checkedAt;

  // Topbar update button & label
  const visible = ['checking', 'available', 'downloading', 'ready', 'installing'].includes(status);
  if (elements.updateButton) {
    elements.updateButton.hidden = !visible;
    if (visible) {
      elements.updateButton.disabled = status !== 'ready';
      elements.updateButton.classList.toggle('is-active', ['checking', 'available', 'downloading', 'installing'].includes(status));
      elements.updateButton.classList.toggle('is-ready', status === 'ready');
      if (status === 'checking') elements.updateLabel.textContent = 'Checking…';
      else if (status === 'available') elements.updateLabel.textContent = `Downloading v${availableVersion}…`;
      else if (status === 'downloading') elements.updateLabel.textContent = `Downloading ${percent}%`;
      else if (status === 'ready') elements.updateLabel.textContent = `Restart v${availableVersion}`;
      else if (status === 'installing') elements.updateLabel.textContent = 'Installing…';
    }
  }

  // Settings update panel elements
  if (elements.settingsCurrentVersion) {
    elements.settingsCurrentVersion.textContent = `v${currentVersion}`;
  }

  if (elements.settingsUpdateStatusBadge) {
    elements.settingsUpdateStatusBadge.className = 'status-chip';
    if (status === 'checking') {
      elements.settingsUpdateStatusBadge.classList.add('chip-warning');
      elements.settingsUpdateStatusBadge.textContent = 'Checking…';
    } else if (status === 'available' || status === 'downloading') {
      elements.settingsUpdateStatusBadge.classList.add('chip-running');
      elements.settingsUpdateStatusBadge.textContent = `Downloading v${availableVersion}`;
    } else if (status === 'ready') {
      elements.settingsUpdateStatusBadge.classList.add('chip-done');
      elements.settingsUpdateStatusBadge.textContent = `Ready v${availableVersion}`;
    } else if (status === 'up-to-date') {
      elements.settingsUpdateStatusBadge.classList.add('chip-done');
      elements.settingsUpdateStatusBadge.textContent = 'Up to date';
    } else if (status === 'error') {
      elements.settingsUpdateStatusBadge.classList.add('chip-failed');
      elements.settingsUpdateStatusBadge.textContent = 'Error';
    } else if (status === 'disabled') {
      elements.settingsUpdateStatusBadge.classList.add('chip-neutral');
      elements.settingsUpdateStatusBadge.textContent = 'Dev Mode';
    } else {
      elements.settingsUpdateStatusBadge.classList.add('chip-neutral');
      elements.settingsUpdateStatusBadge.textContent = 'Ready';
    }
  }

  if (elements.settingsUpdateMessage) {
    if (status === 'checking') {
      elements.settingsUpdateMessage.textContent = 'Checking…';
    } else if (status === 'available') {
      elements.settingsUpdateMessage.textContent = `Downloading v${availableVersion}.`;
    } else if (status === 'downloading') {
      elements.settingsUpdateMessage.textContent = `Downloading v${availableVersion} ${percent}%.`;
    } else if (status === 'ready') {
      elements.settingsUpdateMessage.textContent = `v${availableVersion} ready. Restart.`;
    } else if (status === 'up-to-date') {
      elements.settingsUpdateMessage.textContent = `v${currentVersion} current.`;
    } else if (status === 'error') {
      elements.settingsUpdateMessage.textContent = update?.message || 'Check failed.';
    } else if (status === 'disabled') {
      elements.settingsUpdateMessage.textContent = `Dev build v${currentVersion}.`;
    } else {
      elements.settingsUpdateMessage.textContent = `v${currentVersion}.`;
    }
  }

  if (elements.settingsUpdateProgressContainer) {
    const showProgress = status === 'downloading';
    elements.settingsUpdateProgressContainer.hidden = !showProgress;
    if (showProgress) {
      if (elements.settingsUpdateProgressFill) elements.settingsUpdateProgressFill.style.width = `${percent}%`;
      if (elements.settingsUpdateProgressText) elements.settingsUpdateProgressText.textContent = `${percent}%`;
    }
  }

  if (elements.settingsUpdateLastChecked) {
    if (checkedAt) {
      try {
        const date = new Date(checkedAt);
        elements.settingsUpdateLastChecked.textContent = `Checked ${date.toLocaleTimeString()}`;
      } catch (e) {
        elements.settingsUpdateLastChecked.textContent = `Checked ${checkedAt}`;
      }
    } else {
      elements.settingsUpdateLastChecked.textContent = 'Not checked';
    }
  }

  if (elements.settingsCheckUpdateBtn) {
    const isCheckingOrDownloading = ['checking', 'downloading', 'installing'].includes(status);
    elements.settingsCheckUpdateBtn.disabled = isCheckingOrDownloading;
    elements.settingsCheckUpdateBtn.innerHTML = isCheckingOrDownloading
      ? '<span class="update-spinner">↻</span> Checking…'
      : '<span class="btn-icon">↻</span> Check';
  }

  if (elements.settingsInstallUpdateBtn) {
    elements.settingsInstallUpdateBtn.style.display = status === 'ready' ? 'inline-flex' : 'none';
  }
}

function renderAuth() {
  const required = Boolean(state?.app?.loginRequired);
  const engine = activeEngine();
  if (required && !authManagerOpenedManually) configureAuthDialog(engine);
  const blockDismiss = required && authTarget === 'gemini';
  elements.authCloseButton.hidden = blockDismiss;
  if ((required || authManagerOpenedManually) && !elements.authDialog.open) elements.authDialog.showModal();
  if (!required && !authManagerOpenedManually && elements.authDialog.open) elements.authDialog.close();
}

const BRAND_MARKS = {
  chatgpt: { className: 'auth-brand-logo brand-chatgpt', html: '<img src="../assets/brand/chatgpt.png" alt="" class="ai-profile-logo">' },
  gemini: { className: 'auth-brand-logo brand-gemini', html: '<img src="../assets/brand/gemini.png" alt="" class="ai-profile-logo">' },
  meta: { className: 'auth-brand-logo brand-meta', html: '<img src="../assets/brand/meta-ai.png" alt="" class="ai-profile-logo">' }
};

function configureAuthDialog(target = 'gemini') {
  authTarget = target === 'chatgpt' || target === 'meta' ? target : 'gemini';
  const chatgpt = authTarget === 'chatgpt';
  const meta = authTarget === 'meta';
  const mark = BRAND_MARKS[authTarget] || BRAND_MARKS.gemini;
  if (elements.authBrandLogo) {
    elements.authBrandLogo.className = mark.className;
    elements.authBrandLogo.innerHTML = mark.html;
  }
  if (elements.authEyebrow) {
    elements.authEyebrow.textContent = chatgpt ? 'ChatGPT' : (meta ? 'Meta AI' : 'Gemini');
  }
  if (elements.authTitle) {
    elements.authTitle.textContent = chatgpt
      ? 'Connect ChatGPT'
      : (meta ? 'Connect Meta AI' : 'Connect Gemini');
  }
  const geminiConnected = Boolean(state?.integrations?.gemini?.connected);
  const geminiEmail = String(state?.integrations?.gemini?.profile?.email || '').trim();
  if (elements.authCopy) {
    elements.authCopy.textContent = chatgpt
      ? 'Sign in once.'
      : (meta
        ? 'Sign in once.'
        : (geminiConnected
          ? `Signed in${geminiEmail ? ` ${geminiEmail}` : ''}.`
          : 'Sign in once.'));
  }
  if (elements.authOpenButton) {
    elements.authOpenButton.textContent = chatgpt
      ? 'Sign in'
      : (meta ? 'Sign in' : (geminiConnected ? 'Sign in' : 'Sign in'));
  }
  if (elements.authVerifyButton) {
    elements.authVerifyButton.textContent = 'Verify';
  }
}

function openAuthManager(target = 'gemini') {
  const required = Boolean(state?.app?.loginRequired) && target !== 'chatgpt' && target !== 'meta';
  authManagerOpenedManually = true;
  configureAuthDialog(target);
  elements.authCloseButton.hidden = required;
  elements.authStatusText.textContent = required
    ? 'Not verified.'
    : (target === 'chatgpt'
      ? 'Sign in once.'
      : (target === 'meta'
        ? 'Sign in once.'
        : 'Session saved.'));
  if (!elements.authDialog.open) elements.authDialog.showModal();
}

function profileInitial(value) {
  const character = String(value ?? '').trim().charAt(0);
  return character ? character.toUpperCase() : 'P';
}

let lastSystemProfiles = [];

function profileSessionLabel(profile = {}) {
  const bits = [];
  bits.push(profile.hasChatGptSession ? 'ChatGPT' : 'ChatGPT off');
  bits.push(profile.hasGoogleSession ? 'Gemini' : 'Gemini off');
  return bits.join(' + ');
}

function sessionChipsHtml(profile = {}) {
  const chatgptOn = Boolean(profile.hasChatGptSession);
  const geminiOn = Boolean(profile.hasGoogleSession);
  return `<span class="session-chip ${chatgptOn ? 'is-on' : 'is-off'}">ChatGPT</span><span class="session-chip ${geminiOn ? 'is-on' : 'is-off'}">Gemini</span>`;
}

function resolveDisplayedProfile(profiles = [], selected = null) {
  if (selected?.browser && selected?.profileKey) {
    const match = profiles.find((item) => item.browser === selected.browser && item.profileKey === selected.profileKey);
    if (match) return match;
  }
  return profiles.find((item) => item.isLastUsed) || profiles[0] || null;
}

function renderSelectedProfileSessions(profiles = []) {
  lastSystemProfiles = Array.isArray(profiles) ? profiles : [];
  const selected = resolveDisplayedProfile(lastSystemProfiles, state?.integrations?.chatgpt?.selectedProfile);
  if (elements.settingsSelectedProfileSessions) {
    elements.settingsSelectedProfileSessions.innerHTML = selected
      ? sessionChipsHtml(selected)
      : '<span class="session-chip is-off">ChatGPT</span><span class="session-chip is-off">Gemini</span>';
  }
  const chatgptCount = lastSystemProfiles.filter((item) => item.hasChatGptSession).length;
  const mockups = state?.integrations?.chatgptMockups ?? {};
  const chatgptVerified = Boolean(mockups.connected);
  const chatgptReady = chatgptVerified || Boolean(selected?.hasChatGptSession);
  if (elements.settingsMockupsCard) {
    elements.settingsMockupsCard.classList.toggle('is-connected', chatgptVerified);
  }
  if (elements.settingsMockupsStatus) {
    elements.settingsMockupsStatus.textContent = chatgptVerified
      ? 'Verified'
      : (selected?.hasChatGptSession || chatgptCount ? 'Signed in' : 'Sign in required');
  }
  if (elements.settingsMockupsProfile) {
    elements.settingsMockupsProfile.textContent = chatgptVerified ? 'Ready' : 'Sign in, then verify.';
  }
  if (elements.settingsMockupsVerified) {
    elements.settingsMockupsVerified.textContent = '';
  }
  if (elements.settingsOpenaiLogout) {
    elements.settingsOpenaiLogout.hidden = !chatgptVerified;
    elements.settingsOpenaiLogout.style.display = chatgptVerified ? 'inline-flex' : 'none';
  }
}

function renderStudioGroup(target, studios, emptyCopy) {
  if (!target) return;
  if (!studios.length) {
    target.innerHTML = `<p class="muted">${emptyCopy}</p>`;
    return;
  }
  target.innerHTML = studios.map((studio) => `
    <div class="studio-row ${studio.connected ? 'is-ready' : 'is-waiting'}">
      <div>
        <strong>${escapeHtml(studio.name)}</strong>
      </div>
      <button class="button button-ghost" data-action="settings-open-studio" data-studio="${escapeHtml(studio.id)}" type="button">Open</button>
    </div>
  `).join('');
}

function renderStudioList() {
  const gems = state?.integrations?.studios?.gems ?? [];
  const gpts = state?.integrations?.studios?.gpts ?? [];
  renderStudioGroup(elements.settingsStudioList, gems, 'Gems load at start.');
  renderStudioGroup(elements.settingsGptsList, gpts, 'Custom GPTs load at start.');
}

function renderSettingsConnections() {
  const preferences = state?.settings ?? {};
  const profile = preferences.profile ?? {};
  const chatgpt = state?.integrations?.chatgpt ?? {};
  const gemini = state?.integrations?.gemini ?? {};
  const customGpt = state?.integrations?.customGpt ?? {};
  const detected = gemini.profile ?? {};
  const connected = Boolean(gemini.connected);
  const customGptConnected = Boolean(customGpt.connected);
  const displayName = profile.displayName || profile.sellerName || detected.name || detected.email || 'Profile';
  const initial = profileInitial(displayName);

  if (elements.settingsProfileLabel) elements.settingsProfileLabel.textContent = displayName;
  if (elements.settingsProfileAvatar) elements.settingsProfileAvatar.textContent = initial;
  if (elements.settingsProfileLargeAvatar) elements.settingsProfileLargeAvatar.textContent = initial;
  document.querySelectorAll('.ui-journey-profile .profile-pill-avatar').forEach((el) => { el.textContent = initial; });
  document.querySelectorAll('.ui-journey-profile .profile-pill-copy strong').forEach((el) => { el.textContent = displayName; });
  elements.settingsChatgptCard.classList.toggle('is-connected', connected);
  elements.settingsGptCard.classList.toggle('is-connected', customGptConnected);
  elements.settingsChatgptStatus.textContent = connected ? 'Verified' : 'Sign in required';
  elements.settingsGptStatus.textContent = customGptConnected ? 'Ready' : 'Sign in required';
  const chatgptEngineConnected = Boolean(state?.integrations?.chatgpt?.connected || state?.integrations?.chatgptMockups?.connected);
  if (elements.settingsGptsCard) {
    elements.settingsGptsCard.classList.toggle('is-connected', chatgptEngineConnected);
  }
  if (elements.settingsGptsStatus) {
    elements.settingsGptsStatus.textContent = chatgptEngineConnected ? 'Ready' : 'Sign in required';
  }
  if (elements.settingsGptsProfile) {
    elements.settingsGptsProfile.textContent = chatgptEngineConnected ? 'Ready' : 'Sign in, then verify.';
  }
  if (elements.settingsChatgptLogout) {
    elements.settingsChatgptLogout.hidden = !connected;
    elements.settingsChatgptLogout.style.display = connected ? 'inline-flex' : 'none';
  }

  const detectedIdentity = [detected.name, detected.email].filter(Boolean).join(' · ');
  elements.settingsChatgptProfile.textContent = connected
    ? (detectedIdentity || 'Ready')
    : 'Sign in, then verify.';
  if (elements.settingsChatgptVerified) elements.settingsChatgptVerified.textContent = '';
  elements.settingsGptProfile.textContent = customGptConnected ? 'Ready' : 'Verify Gemini to open.';
  renderStudioList();

  const engine = activeEngine();
  if (elements.engineChatgptToggle) {
    elements.engineChatgptToggle.classList.toggle('is-on', engine === 'chatgpt');
    elements.engineChatgptToggle.classList.toggle('is-off', engine !== 'chatgpt');
    if (elements.engineChatgptState) elements.engineChatgptState.textContent = engine === 'chatgpt' ? 'On' : 'Off';
  }
  if (elements.engineGeminiToggle) {
    elements.engineGeminiToggle.classList.toggle('is-on', engine === 'gemini');
    elements.engineGeminiToggle.classList.toggle('is-off', engine !== 'gemini');
    if (elements.engineGeminiState) elements.engineGeminiState.textContent = engine === 'gemini' ? 'On' : 'Off';
  }
  if (elements.engineMetaToggle) {
    elements.engineMetaToggle.classList.toggle('is-on', engine === 'meta');
    elements.engineMetaToggle.classList.toggle('is-off', engine !== 'meta');
    if (elements.engineMetaState) elements.engineMetaState.textContent = engine === 'meta' ? 'On' : 'Off';
  }
  const meta = state?.integrations?.meta ?? {};
  const metaConnected = Boolean(meta.connected);
  const metaDetected = meta.profile ?? {};
  if (elements.settingsMetaCard) {
    elements.settingsMetaCard.classList.toggle('is-connected', metaConnected);
    elements.settingsMetaCard.classList.toggle('is-active-engine', engine === 'meta');
    elements.settingsMetaCard.classList.toggle('is-unused', engine !== 'meta');
    if (elements.settingsMetaStatus) {
      elements.settingsMetaStatus.textContent = metaConnected
        ? (engine === 'meta' ? 'Verified' : 'Signed in')
        : 'Sign in required';
    }
    if (elements.settingsMetaLogout) {
      elements.settingsMetaLogout.hidden = !metaConnected;
      elements.settingsMetaLogout.style.display = metaConnected ? 'inline-flex' : 'none';
    }
    if (elements.settingsMetaProfile) {
      const metaIdentity = [metaDetected.name, metaDetected.email].filter(Boolean).join(' · ');
      elements.settingsMetaProfile.textContent = metaConnected
        ? (metaIdentity || 'Ready')
        : 'Sign in, then verify.';
    }
    if (elements.settingsMetaVerified) elements.settingsMetaVerified.textContent = '';
  }

  applyEditableEngineUi();

  renderSelectedProfileSessions(lastSystemProfiles);
}

function selectSettingsTab(tab) {
  activeSettingsTab = ['profile', 'workflow', 'management', 'customization', 'automation', 'notifications', 'updates'].includes(tab) ? tab : 'profile';
  document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== activeSettingsTab;
  });
  document.querySelectorAll('[data-settings-target]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.settingsTarget === activeSettingsTab);
  });
  const content = elements.settingsDialog?.querySelector('.settings-content');
  if (content) content.scrollTop = 0;
}

async function populateSettingsForm() {
  const preferences = state?.settings ?? {};
  const profile = preferences.profile ?? {};
  const identity = preferences.projectIdentity ?? {};
  const workflow = preferences.workflow ?? {};
  const setValue = (element, value = '') => { if (element) element.value = value ?? ''; };

  setValue(elements.settingsDefaultFormat, workflow.defaultFormat || 'LETTER');
  setValue(elements.settingsDefaultOrientation, workflow.defaultOrientation || 'portrait');
  setValue(elements.settingsWhenComplete, workflow.whenCompleteAction || state?.app?.whenCompleteAction || 'nothing');
  if (elements.settingsSaveNote) elements.settingsSaveNote.textContent = '';
  const managementRoot = document.getElementById('settings-management-root');
  if (managementRoot && typeof api.bookManagementStatus === 'function') {
    api.bookManagementStatus().then((status) => {
      managementRoot.textContent = status?.rootPath || 'No folders yet.';
    }).catch(() => {
      managementRoot.textContent = 'No folders yet.';
    });
  }

  const autoSettings = state?.automationSettings || {};
  setValue(elements.autoStepOverview, autoSettings.overview || 'always');
  setValue(elements.autoStepCharacters, autoSettings.characters || 'always');
  setValue(elements.autoStepInterior, autoSettings.interior || 'always');
  setValue(elements.autoStepEditable, autoSettings.editable_generation || 'ask');
  setValue(elements.autoStepThumbnails, autoSettings.thumbnails || 'always');
  setValue(elements.autoStepPreview, autoSettings.preview || 'always');
  setValue(elements.autoStepExport, autoSettings.export || 'always');

  const notifications = preferences.notifications ?? { soundEnabled: true, soundVolume: 80, toastsEnabled: true, desktopEnabled: true };
  if (elements.settingsSoundEnabled) elements.settingsSoundEnabled.checked = notifications.soundEnabled !== false;
  if (elements.settingsSoundVolume) {
    elements.settingsSoundVolume.value = notifications.soundVolume ?? 80;
    if (elements.settingsSoundVolumeVal) elements.settingsSoundVolumeVal.textContent = `${notifications.soundVolume ?? 80}%`;
  }
  if (elements.settingsToastsEnabled) elements.settingsToastsEnabled.checked = notifications.toastsEnabled !== false;
  if (elements.settingsDesktopNotificationsEnabled) elements.settingsDesktopNotificationsEnabled.checked = notifications.desktopEnabled !== false;

  if (elements.settingsChatgptProfileSelect) {
    try {
      const profiles = await api.getSystemProfiles();
      const currentSelected = state?.integrations?.chatgpt?.selectedProfile;
      const currentVal = currentSelected ? `${currentSelected.browser}/${currentSelected.profileKey}` : '';
      elements.settingsChatgptProfileSelect.innerHTML = '<option value="">Last active profile (automatic)</option>';
      for (const p of profiles) {
        const option = document.createElement('option');
        option.value = `${p.browser}/${p.profileKey}`;
        option.textContent = `${profileSessionLabel(p)} ${p.browser} ${p.profileName} (${p.email || 'No email'}) ${p.isLastUsed ? '[Last Active]' : ''}`.trim();
        elements.settingsChatgptProfileSelect.appendChild(option);
      }
      elements.settingsChatgptProfileSelect.value = currentVal;
      renderSelectedProfileSessions(profiles);
    } catch (e) {
      console.error('Failed to populate Chrome system profiles:', e);
    }
  }

  if (elements.settingsProfileRotationList) {
    try {
      const rotationData = await api.getProfileRotation();
      const allProfiles = rotationData?.systemProfiles || await api.getSystemProfiles();
      const activeRotationList = rotationData?.profiles || [];
      const isSwappingEnabled = rotationData?.enabled !== false;
      if (elements.settingsEnableProfileSwapping) {
        elements.settingsEnableProfileSwapping.checked = isSwappingEnabled;
        elements.settingsEnableProfileSwapping.onchange = async () => {
          await saveCurrentProfileRotation();
        };
      }

      elements.settingsProfileRotationList.innerHTML = '';
      if (!allProfiles || !allProfiles.length) {
        elements.settingsProfileRotationList.innerHTML = '<small style="opacity: 0.6;">No local Chrome profiles detected.</small>';
      } else {
        for (const p of allProfiles) {
          const profileId = `${p.browser}/${p.profileKey}`;
          const isChecked = activeRotationList.some((item) => {
            const key = typeof item === 'string' ? item : `${item.browser}/${item.profileKey}`;
            return key === profileId || item.profileKey === p.profileKey;
          });

          const itemLabel = document.createElement('label');
          itemLabel.className = 'checkbox-option';
          itemLabel.style.display = 'flex';
          itemLabel.style.alignItems = 'center';
          itemLabel.style.gap = '8px';
          itemLabel.style.padding = '6px 10px';
          itemLabel.style.borderRadius = '6px';
          itemLabel.style.background = 'rgba(255,255,255,0.03)';
          itemLabel.style.cursor = 'pointer';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = profileId;
          checkbox.checked = isChecked;
          checkbox.dataset.browser = p.browser;
          checkbox.dataset.profileKey = p.profileKey;
          checkbox.dataset.profileName = p.profileName;

          checkbox.onchange = async () => {
            await saveCurrentProfileRotation();
          };

          const span = document.createElement('span');
          span.style.display = 'flex';
          span.style.alignItems = 'center';
          span.style.justifyContent = 'space-between';
          span.style.gap = '10px';
          span.style.flex = '1';
          span.innerHTML = `<span><strong>${escapeHtml(p.profileName)}</strong> <small style="opacity: 0.7;">(${escapeHtml(p.email || p.profileKey)})</small></span>${sessionChipsHtml(p)}`;

          itemLabel.appendChild(checkbox);
          itemLabel.appendChild(span);
          elements.settingsProfileRotationList.appendChild(itemLabel);
        }
      }
    } catch (e) {
      console.error('Failed to populate profile rotation checklist:', e);
    }
  }

  renderSettingsConnections();
  populateCustomizationForm();
}

async function saveCurrentProfileRotation() {
  if (!elements.settingsProfileRotationList) return;
  const checkboxes = elements.settingsProfileRotationList.querySelectorAll('input[type="checkbox"]');
  const selectedProfiles = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) {
      selectedProfiles.push({
        browser: cb.dataset.browser,
        profileKey: cb.dataset.profileKey,
        profileName: cb.dataset.profileName
      });
    }
  });
  const enabled = elements.settingsEnableProfileSwapping ? elements.settingsEnableProfileSwapping.checked : true;
  await api.setProfileRotation({ profiles: selectedProfiles, enabled });
}

function customizationDefaultsFromState() {
  return state?.settings?.customizationDefaults || { links: {}, prompts: {} };
}

function isCustomizationHttpUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function populateCustomizationForm() {
  const custom = state?.settings?.customization || {};
  const defaults = customizationDefaultsFromState();
  document.querySelectorAll('[data-customization-link]').forEach((input) => {
    const key = input.dataset.customizationLink;
    const stored = String(custom.links?.[key] || '').trim();
    input.value = stored || defaults.links?.[key] || '';
    input.classList.remove('is-invalid');
    if (defaults.links?.[key]) input.placeholder = defaults.links[key];
  });
  document.querySelectorAll('[data-customization-prompt]').forEach((textarea) => {
    const key = textarea.dataset.customizationPrompt;
    const stored = String(custom.prompts?.[key] || '');
    textarea.value = stored || defaults.prompts?.[key] || '';
  });
}

function collectCustomizationForm() {
  const defaults = customizationDefaultsFromState();
  const links = {};
  const invalid = [];
  document.querySelectorAll('[data-customization-link]').forEach((input) => {
    const key = input.dataset.customizationLink;
    const value = String(input.value || '').trim();
    if (!isCustomizationHttpUrl(value)) {
      input.classList.add('is-invalid');
      invalid.push(key);
      return;
    }
    input.classList.remove('is-invalid');
    links[key] = value && value !== defaults.links?.[key] ? value : '';
  });
  if (invalid.length) {
    throw new Error('Use an http URL.');
  }
  const prompts = {};
  document.querySelectorAll('[data-customization-prompt]').forEach((textarea) => {
    const key = textarea.dataset.customizationPrompt;
    const value = String(textarea.value || '').replace(/\r\n/g, '\n').trim();
    const fallback = String(defaults.prompts?.[key] || '').replace(/\r\n/g, '\n').trim();
    prompts[key] = value && value !== fallback ? value : '';
  });
  return { links, prompts };
}

function restoreCustomizationLinks() {
  const defaults = customizationDefaultsFromState();
  document.querySelectorAll('[data-customization-link]').forEach((input) => {
    input.value = defaults.links?.[input.dataset.customizationLink] || '';
    input.classList.remove('is-invalid');
  });
}

function restoreCustomizationPrompts() {
  const defaults = customizationDefaultsFromState();
  document.querySelectorAll('[data-customization-prompt]').forEach((textarea) => {
    textarea.value = defaults.prompts?.[textarea.dataset.customizationPrompt] || '';
  });
}

function restoreCustomizationField(target) {
  const kind = target?.dataset?.customizationKind;
  const key = target?.dataset?.customizationKey;
  const defaults = customizationDefaultsFromState();
  if (kind === 'link') {
    const input = document.querySelector(`[data-customization-link="${key}"]`);
    if (input) {
      input.value = defaults.links?.[key] || '';
      input.classList.remove('is-invalid');
    }
    return;
  }
  if (kind === 'prompt') {
    const textarea = document.querySelector(`[data-customization-prompt="${key}"]`);
    if (textarea) textarea.value = defaults.prompts?.[key] || '';
  }
}

function collectSettingsForm() {
  return {
    profile: {
      displayName: elements.settingsDisplayName?.value ?? '',
      email: elements.settingsEmail?.value ?? '',
      sellerName: elements.settingsSellerName?.value ?? ''
    },
    projectIdentity: {
      authorName: elements.settingsAuthorName?.value ?? '',
      publisherName: elements.settingsPublisherName?.value ?? '',
      copyrightHolder: elements.settingsCopyrightHolder?.value ?? '',
      copyrightYear: elements.settingsCopyrightYear?.value ?? '',
      projectNotes: elements.settingsProjectNotes?.value ?? ''
    },
    workflow: {
      defaultFormat: elements.settingsDefaultFormat.value,
      defaultOrientation: elements.settingsDefaultOrientation.value,
      whenCompleteAction: elements.settingsWhenComplete.value
    },
    appearance: appearancePreference(),
    notifications: {
      soundEnabled: elements.settingsSoundEnabled ? elements.settingsSoundEnabled.checked : true,
      soundVolume: elements.settingsSoundVolume ? Number(elements.settingsSoundVolume.value) : 80,
      toastsEnabled: elements.settingsToastsEnabled ? elements.settingsToastsEnabled.checked : true,
      desktopEnabled: elements.settingsDesktopNotificationsEnabled ? elements.settingsDesktopNotificationsEnabled.checked : true
    },
    customization: collectCustomizationForm()
  };
}

async function openSettings() {
  selectSettingsTab(activeSettingsTab);
  elements.settingsDialog.scrollTop = 0;
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
  document.querySelector('.settings-nav-button.is-active')?.focus();
  void populateSettingsForm();
}

function applyNewProjectDefaults() {
  const workflow = state?.settings?.workflow ?? {};
  const format = workflow.defaultFormat || 'LETTER';
  const orientation = workflow.defaultOrientation || 'portrait';
  if (elements.pageFormat?.querySelector(`option[value="${format}"]`)) elements.pageFormat.value = format;
  if (elements.projectOrientation) elements.projectOrientation.value = orientation;
  if (elements.analysisPageFormat?.querySelector(`option[value="${format}"]`)) elements.analysisPageFormat.value = format;
  if (elements.analysisProjectOrientation) elements.analysisProjectOrientation.value = orientation;
  const radio = elements.projectDialog?.querySelector(`input[name="analysisPageFormat"][value="${format}"]`);
  if (radio) radio.checked = true;
  if (runningOnWindows()) syncAnalysisPageSetup(format, orientation);
  renderPageOutputSpec();
}

let lastProjectListKey = '';

function renderProjectList() {
  const projects = state?.projects ?? [];
  elements.projectCount.textContent = String(projects.length);
  const key = projects.map((project) => project.id).join('\0');
  const existingItems = [...elements.projectList.querySelectorAll('.project-item[data-project-id]')];
  const sameList = existingItems.length === projects.length
    && existingItems.every((item, index) => item.dataset.projectId === projects[index]?.id);
  if (sameList && projects.length) {
    projects.forEach((project, index) => {
      const item = existingItems[index];
      const full = state.activeProject?.id === project.id ? state.activeProject : null;
      const percent = full?.stats?.percent ?? project.stats?.percent ?? 0;
      const generating = isGeneratingThisProject(project);
      item.classList.toggle('is-active', project.id === state.selectedProjectId);
      item.classList.toggle('is-generating', generating);
      const readiness = item.querySelector('.project-readiness');
      if (readiness) readiness.textContent = `${project.stats?.complete ?? 0}/${project.stats?.total ?? 0}`;
      const mini = item.querySelector('.project-progress-mini');
      if (mini) mini.textContent = `${percent}%`;
      const meta = item.querySelector('.project-item-main small');
      if (meta && project.productFormat === 'maze' && window.versaMazeLab) {
        meta.textContent = window.versaMazeLab.mazeProjectListMeta(full || project);
      }
      const liveBadge = item.querySelector('.project-live-badge');
      if (generating && !liveBadge) {
        item.querySelector('.project-badges')?.insertAdjacentHTML('beforeend', '<span class="project-live-badge">Live</span>');
      } else if (!generating && liveBadge) {
        liveBadge.remove();
      }
    });
    return;
  }
  elements.projectList.classList.toggle('is-entering', key !== lastProjectListKey);
  lastProjectListKey = key;
  elements.projectList.innerHTML = projects.map((project, index) => {
    const active = project.id === state.selectedProjectId;
    const full = state.activeProject?.id === project.id ? state.activeProject : null;
    const percent = full?.stats?.percent ?? project.stats?.percent ?? 0;
    const pageSummary = `${project.stats?.complete ?? 0}/${project.stats?.total ?? 0}`;
    const generating = isGeneratingThisProject(project);
    return `
      <button class="project-item status-${projectStatusTone(project.status)} ${active ? 'is-active' : ''} ${generating ? 'is-generating' : ''}" data-action="select-project" data-project-id="${escapeHtml(project.id)}" type="button" style="--i:${index}">
        <span class="project-cover${project.productFormat === 'maze' && window.versaMazeLab?.mazeFirstThumb(project) ? ' has-thumb' : ''}" aria-hidden="true" data-letter="${escapeHtml((displayProjectName(project.name) || 'B').trim().charAt(0).toUpperCase())}">${project.productFormat === 'maze' && window.versaMazeLab?.mazeFirstThumb(project) ? `<img src="${window.versaMazeLab.mazeFirstThumb(project)}" alt="">` : ''}</span>
        <span class="project-item-main">
          <strong>${escapeHtml(displayProjectName(project.name))}</strong>
          <span class="project-badges"><span class="project-type-badge">${escapeHtml(projectTypeLabel(project))}</span>${project.productFormat === 'editable' ? '<span class="project-format-badge">Editable</span>' : project.productFormat === 'maze' ? '<span class="project-format-badge">Maze</span>' : ''}${generating ? '<span class="project-live-badge">Live</span>' : ''}</span>
          <small>${escapeHtml(project.productFormat === 'maze' && window.versaMazeLab
            ? window.versaMazeLab.mazeProjectListMeta(project)
            : projectSetupLabel(project))}</small>
          <span class="project-readiness">${escapeHtml(pageSummary)}</span>
        </span>
        <span class="project-progress-mini">${percent}%</span>
        <span class="project-item-delete" data-action="delete-project" data-project-id="${escapeHtml(project.id)}" role="button" tabindex="0" title="Delete" aria-label="Delete ${escapeHtml(displayProjectName(project.name))}">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 8.4a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.4"/></svg>
        </span>
      </button>
    `;
  }).join('');
  const liveSearch = document.getElementById('ui-global-search')?.value;
  if (window.versaUi?.filterProjects) {
    window.versaUi.filterProjects(liveSearch || '', { revealLibrary: false });
  }
}

function filterJobs(jobs) {
  if (currentFilter === 'incomplete') return jobs.filter((job) => job.status !== 'complete');
  if (currentFilter === 'attention') return jobs.filter((job) => ['needs_user_action', 'rate_limit_paused'].includes(job.status));
  return jobs;
}

function chooseDefaultJob(project) {
  if (selectedJobId && project.jobs.some((job) => job.id === selectedJobId)) return;
  selectedJobId = state.queue.activeJobId
    ?? project.jobs.find((job) => ['needs_user_action', 'rate_limit_paused'].includes(job.status))?.id
    ?? project.jobs.find((job) => job.status !== 'complete')?.id
    ?? project.jobs[0]?.id
    ?? null;
}

/**
 * What the lab says when it has nothing to show on the canvas.
 *
 * There are two different nothings here and they want different answers: a
 * book with no pages yet is waiting to be started, and a filter with no
 * matches is a filter the user can clear.
 */
function emptyPagesHtml(project) {
  if ((project?.jobs?.length || 0) === 0) {
    return `<div class="pages-empty">
      <div class="pages-empty__sheet" aria-hidden="true"></div>
      <strong>No pages yet</strong>
      <p>Start pages to generate the artwork for this book.</p>
    </div>`;
  }
  const named = currentFilter === 'attention' ? 'needs attention' : 'incomplete';
  return `<div class="pages-empty">
    <div class="pages-empty__sheet" aria-hidden="true"></div>
    <strong>Nothing ${escapeHtml(named)}</strong>
    <p>Every page in this book is done. Switch to All to see them.</p>
  </div>`;
}

let lastJobsRenderKey = '';
let jobsPatchLogTick = 0;

function jobsRenderKey(project, { liveIds, queueLocksThisProject } = {}) {
  const jobs = filterJobs(project?.jobs || []);
  return [
    project?.id || '',
    currentFilter,
    selectedJobId || '',
    queueLocksThisProject ? 1 : 0,
    [...(liveIds || [])].join(','),
    jobs.map((job) => `${job.id}:${job.status}:${job.updatedAt || ''}:${job.outputPath ? 1 : 0}`).join('|')
  ].join('/');
}

function pageImageSrc(job) {
  return `tpt-image://job/${encodeURIComponent(job.id)}?card=1&v=${encodeURIComponent(job.updatedAt ?? '')}`;
}

function patchPageCard(card, job, project, { liveIds, queueLocksThisProject } = {}) {
  if (!card) return;
  const isBusy = queueLocksThisProject && liveIds.has(job.id);
  const isLive = observerGenerating(generationActivity.get(job.id));
  const hasImage = Boolean(job.outputPath);
  const selected = job.id === selectedJobId;
  const status = pagesStatusCopy(job, isLive || isBusy);
  card.classList.toggle('is-selected', selected);
  card.classList.toggle('is-live', isLive);
  card.classList.toggle('has-image', hasImage);
  [...card.classList].filter((name) => name.startsWith('status-')).forEach((name) => card.classList.remove(name));
  card.classList.add(`status-${job.status}`);
  card.setAttribute('aria-current', selected ? 'page' : 'false');
  card.setAttribute('aria-busy', isLive ? 'true' : 'false');
  const visual = card.querySelector('.page-visual');
  if (visual) visual.style.setProperty('--page-fill', `${jobFillPercent(job, isLive)}%`);
  if (hasImage && visual) {
    const nextSrc = pageImageSrc(job);
    let image = visual.querySelector('.page-generated-image');
    if (!image) {
      image = document.createElement('img');
      image.className = 'page-generated-image';
      image.alt = `Page ${job.pageNumber}`;
      image.decoding = 'async';
      image.loading = 'lazy';
      image.dataset.src = nextSrc;
      image.src = nextSrc;
      const placeholder = visual.querySelector('.page-placeholder');
      if (placeholder) {
        placeholder.hidden = true;
        visual.insertBefore(image, placeholder);
      } else {
        visual.appendChild(image);
      }
      bindPageImages(visual);
    } else if (image.dataset.src !== nextSrc) {
      image.dataset.src = nextSrc;
      image.src = nextSrc;
    }
  }
  const statusWrap = card.querySelector('.page-card-status');
  if (statusWrap) {
    const statusHtml = job.status === 'complete' && !isLive
      ? ''
      : `<i class="page-state-dot" data-state="${isLive ? 'live' : escapeHtml(job.status)}" title="${escapeHtml(status)}"></i>`;
    if (statusWrap.dataset.html !== statusHtml) {
      statusWrap.dataset.html = statusHtml;
      statusWrap.innerHTML = statusHtml;
    }
  }
}

function applyLiveStats(project) {
  if (!project) return;
  const { stats } = project;
  if (elements.statComplete) elements.statComplete.textContent = String(stats.complete);
  if (elements.statTotal) elements.statTotal.textContent = String(stats.total);
  if (elements.statRemaining) elements.statRemaining.textContent = String(stats.remaining);
  const liveOp = activeLiveOperation(project);
  const pipeline = (typeof computeProductPipeline === 'function' ? computeProductPipeline : window.computeProductPipeline)?.(project, liveOp);
  if (!pipeline) return;
  if (elements.statPercent) elements.statPercent.textContent = `${pipeline.percent}%`;
  setMeterWidth('overview-overall-meter', pipeline.percent);
  setMeterWidth('overview-interior-meter', pipeline.pagePercent);
  setMeterWidth('overview-interior-artwork-meter', pipeline.pagePercent);
  if (elements.heartbeatText) {
    if (liveOp) elements.heartbeatText.textContent = liveOp.message || liveOp.label || '';
    else if (state?.queue?.running) elements.heartbeatText.textContent = `${pipeline.pagePercent}%`;
  }
}

function renderJobs(project) {
  const jobs = filterJobs(project.jobs);
  const queueLocksThisProject = isGeneratingThisProject(project);
  const liveIds = new Set([
    ...(Array.isArray(state?.queue?.activeJobIds) ? state.queue.activeJobIds : []),
    state?.queue?.activeJobId,
    state?.liveOperation?.kind === 'editable-generation' ? state.liveOperation.jobId : null
  ].filter(Boolean));
  const total = project.jobs?.length || 0;
  if (elements.pagesRailCount) {
    elements.pagesRailCount.textContent = total === 1 ? '1 page' : `${total} pages`;
  }
  elements.jobsTable.classList.toggle('is-storybook-grid', project.projectType === 'storybook');
  elements.jobsTable.classList.toggle('is-empty', jobs.length === 0);
  const renderKey = jobsRenderKey(project, { liveIds, queueLocksThisProject });
  const existingCards = [...elements.jobsTable.querySelectorAll('.page-preview-card[data-job-id]')];
  const sameCardSet = existingCards.length === jobs.length
    && existingCards.every((card, index) => card.dataset.jobId === jobs[index]?.id);
  if (sameCardSet && jobs.length) {
    if (renderKey === lastJobsRenderKey) return;
    let patched = 0;
    jobs.forEach((job, index) => {
      const card = existingCards[index];
      const cardKey = `${job.status}:${job.updatedAt || ''}:${job.outputPath ? 1 : 0}:${liveIds.has(job.id) ? 1 : 0}:${job.id === selectedJobId ? 1 : 0}`;
      if (card.dataset.patchKey === cardKey) return;
      card.dataset.patchKey = cardKey;
      patchPageCard(card, job, project, { liveIds, queueLocksThisProject });
      patched += 1;
    });
    lastJobsRenderKey = renderKey;
    return;
  }
  if (renderKey === lastJobsRenderKey && elements.jobsTable.querySelector('.page-preview-card, .pages-empty')) {
    return;
  }
  lastJobsRenderKey = renderKey;
  if (!jobs.length) {
    elements.jobsTable.innerHTML = emptyPagesHtml(project);
    if (elements.pagesCanvas) elements.pagesCanvas.hidden = true;
    renderPagesStage(project, { liveIds, queueLocksThisProject });
    return;
  }
  if (elements.pagesCanvas) elements.pagesCanvas.hidden = true;
  elements.jobsTable.innerHTML = jobs.map((job) => {
    const isBusy = queueLocksThisProject && liveIds.has(job.id);
    const isLive = observerGenerating(generationActivity.get(job.id));
    const hasImage = Boolean(job.outputPath);
    const fill = jobFillPercent(job, isLive);
    const selected = job.id === selectedJobId;
    const status = pagesStatusCopy(job, isLive || isBusy);
    return `
      <article class="page-preview-card status-${escapeHtml(job.status)} ${selected ? 'is-selected' : ''} ${isLive ? 'is-live' : ''} ${hasImage ? 'has-image' : ''}" data-action="select-job" data-job-id="${escapeHtml(job.id)}" role="listitem" tabindex="0" aria-current="${selected ? 'page' : 'false'}" aria-busy="${isLive ? 'true' : 'false'}" aria-label="${escapeHtml(humanPageLabel(job))}">
        <div class="page-visual" style="--preview-aspect-ratio: ${previewAspectRatio(project)}; --page-fill: ${fill}%;">
          ${pageSheetInnerHtml(job, { isLive, hasImage })}
          ${pageCardActionsHtml(job, { isLive: isLive || isBusy, hasImage, queueLocksThisProject })}
        </div>
        <div class="page-card-body">
          <div class="page-card-heading">
            <strong class="page-card-title">${job.pageNumber}</strong>
            <span class="page-card-status">${job.status === 'complete' && !isLive ? '' : `<i class="page-state-dot" data-state="${isLive ? 'live' : escapeHtml(job.status)}" title="${escapeHtml(status)}"></i>`}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');
  bindPageImages(elements.jobsTable);
  const selectedCard = elements.jobsTable.querySelector('.page-preview-card.is-selected');
  if (selectedCard && selectedJobId !== lastPagesScrollId) {
    selectedCard.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    lastPagesScrollId = selectedJobId;
  }
  renderPagesStage(project, { liveIds, queueLocksThisProject });
}

function renderPagesStage(project, { liveIds, queueLocksThisProject } = {}) {
  const stage = elements.pagesStage;
  if (!stage) return;
  void liveIds;
  void queueLocksThisProject;
  const jobs = filterJobs(project?.jobs || []);
  if (!jobs.length) {
    stage.innerHTML = emptyPagesHtml(project);
    return;
  }
  stage.innerHTML = '';
}

function renderDetail(project) {
  const job = selectedJob();
  const disabled = !job;
  const queueLocksThisProject = isGeneratingThisProject(project);
  const isQueued = Boolean(job && queueLocksThisProject && (
    state?.queue?.activeJobId === job.id
    || state?.liveOperation?.jobId === job.id
    || (Array.isArray(state?.queue?.activeJobIds) && state.queue.activeJobIds.includes(job.id))
  ));
  const isLive = Boolean(job && observerGenerating(generationActivity.get(job.id)));
  elements.detailTitle.textContent = job ? `Page ${job.pageNumber}` : 'Select a page';
  elements.detailStatusWrap.innerHTML = job
    ? `<span class="pages-status" data-state="${isLive ? 'live' : escapeHtml(job.status)}">${escapeHtml(pagesStatusCopy(job, isLive || isQueued))}</span>`
    : '';
  const promptText = job?.imagePrompt || job?.prompt || '';
  elements.detailPrompt.textContent = promptText || '—';
  elements.detailError.hidden = !job?.lastError;
  elements.detailError.textContent = job?.lastError
    ? `${job.lastErrorCode ? `[${job.lastErrorCode}] ` : ''}${translateLegacyText(job.lastError)}`
    : '';
  if (elements.detailStoryTextWrap && elements.detailStoryText) {
    const storyText = job ? resolvedStoryText(project, job) : '';
    elements.detailStoryTextWrap.hidden = !storyText;
    elements.detailStoryText.textContent = storyText || '—';
  }
  elements.copyPromptButton.disabled = disabled || !promptText;
  const busyBrowser = browserBusy();
  elements.importImageButton.disabled = disabled || queueLocksThisProject;
  const regeneration = job?.status === 'complete';
  if (elements.adjustCropButton) {
    elements.adjustCropButton.hidden = !regeneration || queueLocksThisProject;
  }
  elements.openConversationButton.hidden = disabled || !job?.conversationUrl;
  elements.openConversationButton.disabled = disabled || busyBrowser || !job?.conversationUrl;
  elements.openConversationButton.textContent = 'Conversation';
  elements.retryJobButton.disabled = disabled || isLive || isQueued;
  elements.retryJobButton.textContent = job?.outputPath ? 'Regenerate' : 'Generate';
  const promptDisclosure = document.getElementById('detail-prompt-disclosure');
  if (promptDisclosure) {
    promptDisclosure.open = false;
    promptDisclosure.hidden = !job;
  }
}

/** Per-book activity only, with identical spam collapsed to the newest notice. */
function scopedActivityEvents(project) {
  const projectId = project?.id ? String(project.id) : null;
  const raw = Array.isArray(state?.events) ? state.events : [];
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const scoped = raw.filter((event) => {
    if (projectId && String(event?.projectId || '') !== projectId) return false;
    const stamp = Date.parse(event?.createdAt || '');
    if (Number.isFinite(stamp) && stamp < dayAgo) return false;
    return true;
  });
  const seen = new Set();
  const deduped = [];
  for (const event of scoped) {
    const message = String(event?.message || '').trim();
    if (!message) continue;
    const key = `${event?.level || 'info'}::${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function renderEvents(project) {
  const events = scopedActivityEvents(project);
  const titleFor = (level) => {
    if (level === 'error') return 'Alert';
    if (level === 'warn') return 'Notice';
    if (level === 'success') return 'Done';
    return 'Update';
  };
  elements.eventLog.innerHTML = events.map((event) => {
    const level = event.level || 'info';
    return `
    <article class="note-card log-row level-${escapeHtml(level)}">
      <span class="note-card__dot" aria-hidden="true"></span>
      <div class="note-card__copy">
        <strong class="note-card__kicker">${titleFor(level)}</strong>
        <p class="note-card__text">${escapeHtml(translateLegacyText(event.message))}</p>
      </div>
      <time class="note-card__time">${escapeHtml(formatTime(event.createdAt))}</time>
    </article>`;
  }).join('') || '<div class="note-empty">Quiet</div>';
}

function getMissingPublicationFields(listing) {
  const missing = [];
  if (!listing?.title) missing.push('Title');
  if (!listing?.description) missing.push('Description');
  const mVal = projectMarketplace(project).settings;
  if (!mVal.isFreeResource && (!mVal.suggestedPrice || !Number.isFinite(Number.parseFloat(mVal.suggestedPrice)))) missing.push('Price');
  if (!mVal.multipleLicensePrice || !Number.isFinite(Number.parseFloat(mVal.multipleLicensePrice))) missing.push('Multiple Licenses Price');
  if (!mVal.taxCode) missing.push('Tax Code');
  if (!['original', 'licensed'].includes(mVal.copyrightDeclaration)) missing.push('Copyright Declaration');
  if (!listing?.tags?.length) missing.push('Tags');
  if (!listing?.grades?.length) missing.push('Grades');
  if (!listing?.subjects?.length) missing.push('Subjects');
  return missing;
}

function tptListingReviewApproved(listing) {
  const m = projectMarketplace({ tptListing: listing });
  return Boolean(m.review.approved || m.review.sellerApproved || m.review.approvedAt || m.upload.startedAt);
}

function tptListingThumbnailsReady(listing) {
  const thumbnailMode = ['auto', 'manual', 'later'].includes(listing?.thumbnailMode) ? listing.thumbnailMode : 'manual';
  return thumbnailMode !== 'manual' || Boolean(listing?.thumbnailPaths?.[0]);
}

function tptListingPublicationReady(listing) {
  const m = projectMarketplace({ tptListing: listing }).settings;
  return Boolean(
    listing?.title
    && listing.description
    && m.taxCode
    && listing.tags?.length
    && listing.grades?.length
    && listing.subjects?.length
    && (m.isFreeResource === true || Number.isFinite(Number.parseFloat(m.suggestedPrice)))
    && Number.isFinite(Number.parseFloat(m.multipleLicensePrice))
    && ['original', 'licensed'].includes(m.copyrightDeclaration)
  );
}

function formatElapsedClock(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function renderEditableEngineProgress(project) {
  const op = (state?.liveOperation?.projectId === project?.id ? state.liveOperation : null);

  if (elements.editableArtworkStatus) {
    const done = Number(project?.stats?.complete) || 0;
    const total = Number(project?.stats?.total) || 0;
    elements.editableArtworkStatus.textContent = op?.kind === 'queue' || state?.queue?.running
      ? `Artwork ${done} of ${total}.`
      : total && done === total
        ? `${total} ready.`
        : total ? `${done} of ${total} ready.` : 'After analysis.';
  }

  if (elements.editableTextStatus) {
    const ready = Number(project?.editableText?.ready) || 0;
    const total = Number(project?.editableText?.total) || 0;
    const beat = lastTextLabBeat;
    elements.editableTextStatus.textContent = op?.kind === 'editable-text'
      ? (beat?.message || op.message || `Rebuilding ${Math.round(op.percent || 0)}%`)
      : total && ready === total
        ? 'Text ready.'
        : total ? `Text ${ready} of ${total}.` : 'After artwork.';
  }

  if (elements.editableEngineStatus) {
    elements.editableEngineStatus.textContent = op?.kind === 'editable-generation'
      ? `Generating ${Math.round(op.percent || 0)}%`
      : project?.stepEditableGenerationStatus === 'completed' ? 'PowerPoint ready.' : 'After analysis.';
  }
  renderEditableDeck(project, op);
  renderInteriorTextDeck(project, op);
}

// True when the local vision environment is installed and ready. When it is, Interior
// Text runs entirely on this machine, so none of its controls may be gated on the
// browser being free - that gate is what left the Run button dead while a queue was
// still holding Chrome.
function visionReady() {
  return Boolean(state?.vision?.ok && state?.vision?.ready);
}

// Interior Text: one card per page showing the artwork it reads and the copy it wrote.
function renderVisionStatus(project) {
  const box = elements.visionStatus;
  if (!box) return;
  const editable = project?.productFormat === "editable";
  box.hidden = !editable;
  if (elements.visionPhases) elements.visionPhases.hidden = !editable;
  if (elements.visionMetrics) elements.visionMetrics.hidden = !editable;

  const v = state?.vision || null;
  const ready = Boolean(v?.ok && v?.ready);
  const op = state?.liveOperation;
  const running = op?.kind === "editable-text" && op?.projectId === project?.id;

  if (elements.visionEngineState) {
    elements.visionEngineState.textContent = running ? "Running" : v ? (ready ? "Ready" : "Not installed") : "Checking…";
  }
  if (elements.visionDot) {
    elements.visionDot.dataset.state = running ? "busy" : v ? (ready ? "ok" : "off") : "wait";
  }
  const textFree = project?.generationMode === 'editable';
  if (elements.visionEngineDetail) {
    elements.visionEngineDetail.textContent = textFree
      ? "Stamps live text."
      : ready
        ? "Reads pages."
        : (v?.error || "Not installed.");
  }
  if (elements.visionHint) elements.visionHint.hidden = ready || textFree;

  // Phase states. The watchdog names the phase; percent is the fallback split.
  const percent = running ? Number(op.percent) || 0 : null;
  const livePhase = running ? (lastTextLabBeat?.phase || op?.phase || null) : null;
  const built = Number(project?.editableText?.pagesBuilt || 0);
  const read = Number(project?.editableText?.read || 0);
  const phaseState = (phase) => {
    if (running) {
      if (livePhase === 'starting') return phase === 'read' ? 'active' : 'idle';
      if (livePhase === 'reading') {
        if (phase === 'read') return 'active';
        return 'idle';
      }
      if (livePhase === 'rebuilding') {
        if (phase === 'read') return 'done';
        if (phase === 'erase') return 'active';
        return 'idle';
      }
      if (phase === "read") return percent < 50 ? "active" : "done";
      if (phase === "erase") return percent < 50 ? "idle" : "active";
      return percent >= 100 ? "active" : "idle";
    }
    if (built) return "done";
    if (phase === "read" && read) return "done";
    return "idle";
  };
  if (elements.visionPhases) {
    const copy = textFree
      ? { read: ['Confirm', 'Masters have no letters.'], erase: ['Manifest', 'Copy sits in the template zones.'], build: ['Stamp', 'Live text boxes. No erase.'] }
      : { read: ['Read', 'Find the words.'], erase: ['Erase', 'Clear them from the art.'], build: ['Rebuild', 'Put live text back.'] };
    for (const node of elements.visionPhases.querySelectorAll("[data-phase]")) {
      node.dataset.state = phaseState(node.dataset.phase);
      const strong = node.querySelector('strong');
      const small = node.querySelector('small');
      const next = copy[node.dataset.phase];
      if (strong && next) strong.textContent = next[0];
      if (small && next) small.textContent = next[1];
    }
  }

  const pages = project?.editableText?.pages || [];
  const sum = (key) => pages.reduce((total, page) => total + (Number(page[key]) || 0), 0);
  const set = (element, value) => { if (element) element.textContent = String(value); };
  set(elements.visionMetricPages, read);
  set(elements.visionMetricLayers, sum("layers"));
  set(elements.visionMetricText, sum("textRuns"));
  set(elements.visionMetricBound, Math.max(0, sum("textRuns") - sum("orphans")));
  set(elements.visionMetricOrphan, sum("orphans"));
  set(elements.visionMetricBuilt, built);

  const artworkReady = (project?.jobs || []).some((job) => job.status === 'complete' || job.outputPath);
  if (elements.generateEditableTextButton) {
    const label = running
      ? (livePhase === 'rebuilding' || percent >= 50 ? "Rebuilding pages…" : livePhase === 'starting' ? "Starting engine…" : "Reading pages…")
      : (textFree ? "Confirm masters" : "Write live text");
    elements.generateEditableTextButton.textContent = label;
    elements.generateEditableTextButton.disabled = running || !artworkReady;
  }
  if (elements.rebuildEditableTextButton) {
    elements.rebuildEditableTextButton.disabled = running || !read;
    elements.rebuildEditableTextButton.hidden = textFree || !ready;
  }
  if (elements.textLabEta) {
    const eta = running ? (lastTextLabBeat?.etaLabel || (op?.remainingMs != null ? `${Math.max(0, Math.ceil(Number(op.remainingMs) / 1000))}s left` : '')) : '';
    elements.textLabEta.hidden = !eta;
    elements.textLabEta.textContent = eta ? `Rebuild ${eta}` : '';
  }
}

function textLabDeckPages(project) {
  const jobs = [...(project?.jobs || [])].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  const byId = new Map((project?.editableText?.pages || []).map((page) => [page.jobId, page]));
  return jobs.map((job) => {
    const page = byId.get(job.id) || {};
    return {
      ...page,
      jobId: job.id,
      pageNumber: job.pageNumber,
      artworkReady: job.status === 'complete' || Boolean(job.outputPath) || Boolean(page.artworkReady),
      outputPath: job.outputPath,
      updatedAt: job.updatedAt,
      status: job.status
    };
  });
}

function textLabPageIsFlat(pages, page) {
  if (page?.flat) return true;
  const numbers = (pages || []).map((item) => Number(item.pageNumber) || 0).filter((n) => n > 0);
  if (numbers.length < 2) return false;
  const n = Number(page?.pageNumber) || 0;
  return n === Math.min(...numbers) || n === Math.max(...numbers);
}

function textLabCardActionsHtml(page, { running } = {}) {
  const hasImage = Boolean(page.artworkReady);
  return `<div class="page-card-actions">
    <div class="page-card-tools">
      <button class="row-button is-danger" data-action="delete-job-image" data-job-id="${escapeHtml(page.jobId)}" title="Delete" type="button"${hasImage && !running ? '' : ' disabled'}>✕</button>
    </div>
    <button class="row-button is-regen" data-action="generate-job" data-job-id="${escapeHtml(page.jobId)}" title="${hasImage ? 'Regenerate' : 'Generate'}" type="button"${running ? ' disabled' : ''}>${hasImage ? 'Regenerate' : 'Generate'}</button>
    <button class="row-button is-regen" data-action="write-page-text" data-job-id="${escapeHtml(page.jobId)}" type="button"${hasImage && !running ? '' : ' disabled'}>${page.read ? 'Re-read' : 'Read'}</button>
  </div>`;
}

function logTextLabCornerChips(deck, pages, runId) {
  if (!deck) return;
}

function textLabLiveActivity(jobId) {
  const beat = lastTextLabBeat;
  if (beat && beat.jobId === jobId && beat.generating) return beat;
  const stored = textLabActivity.get(jobId);
  if (stored && stored.generating) return stored;
  return null;
}

function textLabFillPercent(page, activity) {
  if (activity && activity.jobId === page.jobId && activity.generating) {
    return Math.max(6, Math.min(92, Number(activity.pageFill) || Number(activity.percent) || 18));
  }
  if (page.flat || page.built) return 100;
  if (page.read) return 50;
  return 0;
}

function textLabStatusCopy(page, isLive, activity) {
  if (isLive) {
    if (activity?.phase === 'starting') return activity.etaLabel || 'Starting';
    if (activity?.phase === 'reading') return activity.etaLabel || 'Reading';
    if (activity?.phase === 'rebuilding') return activity.etaLabel || 'Rebuilding';
    return activity?.etaLabel || 'Working';
  }
  if (page.flat) return 'Ships as drawn';
  if (page.built) return 'Rebuilt';
  if (page.read) return 'Read';
  if (page.artworkReady) return 'Ready to read';
  return 'Needs artwork';
}

function textLabImageSrc(page) {
  return `tpt-image://job/${encodeURIComponent(page.jobId)}?card=1&v=${encodeURIComponent(page.updatedAt ?? '')}`;
}

function patchTextLabCard(card, page, { running, pages = [] } = {}) {
  if (!card) return;
  const activity = textLabLiveActivity(page.jobId);
  const isLive = Boolean(activity);
  const hasImage = Boolean(page.artworkReady);
  const flat = textLabPageIsFlat(pages, page);
  const state = flat ? 'flat' : page.read ? 'read' : page.artworkReady ? 'ready' : 'blocked';
  const fill = textLabFillPercent({ ...page, flat }, activity);
  const status = textLabStatusCopy({ ...page, flat }, isLive, activity);
  card.classList.toggle('is-live', isLive);
  card.classList.toggle('has-image', hasImage);
  card.classList.remove('is-flat', 'is-read', 'is-ready', 'is-blocked');
  card.classList.add(`is-${state}`);
  card.setAttribute('aria-busy', isLive ? 'true' : 'false');
  const visual = card.querySelector('.page-visual');
  if (visual) visual.style.setProperty('--page-fill', `${fill}%`);
  if (hasImage && visual) {
    const nextSrc = textLabImageSrc(page);
    let image = visual.querySelector('.page-generated-image');
    if (!image) {
      image = document.createElement('img');
      image.className = 'page-generated-image';
      image.alt = `Page ${page.pageNumber}`;
      image.decoding = 'async';
      image.loading = 'lazy';
      image.dataset.src = nextSrc;
      image.src = nextSrc;
      const placeholder = visual.querySelector('.page-placeholder');
      if (placeholder) {
        placeholder.hidden = true;
        visual.insertBefore(image, placeholder);
      } else {
        visual.appendChild(image);
      }
      bindPageImages(visual);
    } else if (image.dataset.src !== nextSrc) {
      image.dataset.src = nextSrc;
      image.src = nextSrc;
    }
  }
  const label = card.querySelector('.page-placeholder span');
  if (label) label.textContent = status;
  const eta = card.querySelector('.page-card-eta');
  if (eta) eta.textContent = isLive ? (activity?.etaLabel || '') : '';
  const hint = card.querySelector('.page-hint');
  if (hint) {
    hint.textContent = flat
      ? 'Ships as drawn'
      : page.read
        ? `${Number(page.layers) || 0} layers · ${Number(page.textRuns) || 0} text runs`
        : page.artworkReady ? 'Not read yet' : 'Needs artwork';
    if (state?.activeProject?.generationMode === 'editable') {
      hint.textContent = page.read
        ? `${Number(page.zoneCount) || 0} zones ready`
        : page.artworkReady ? 'Master waiting' : 'Needs artwork';
    }
  }
  let actions = card.querySelector('.page-card-actions');
  if (flat) {
    actions?.remove();
  } else {
    if (!actions) {
      const visual = card.querySelector('.page-visual');
      if (visual) visual.insertAdjacentHTML('beforeend', textLabCardActionsHtml(page, { running }));
      actions = card.querySelector('.page-card-actions');
    }
    const action = card.querySelector('[data-action="write-page-text"]');
    if (action) {
      action.disabled = !page.artworkReady || Boolean(running);
      action.textContent = page.read ? 'Re-read' : 'Read';
    }
  }
}

// Interior Text: one card per page showing the artwork it reads and the copy it wrote.
function renderInteriorTextDeck(project, op) {
  renderVisionStatus(project);
  const deck = elements.textPageDeck;
  if (!deck) return;
  const pages = textLabDeckPages(project);
  const running = op?.kind === 'editable-text';
  if (!pages.length) {
    lastTextDeckKey = 'empty';
    deck.innerHTML = '<p class="ppt-deck-empty">Finish the page art first.</p>';
    return;
  }

  const renderKey = pages.map((page) => `${page.jobId}:${page.artworkReady ? 1 : 0}:${page.read ? 1 : 0}:${page.flat ? 1 : 0}:${page.built ? 1 : 0}:${page.updatedAt || ''}`).join('|');
  const existingCards = [...deck.querySelectorAll('.page-preview-card[data-job-id]')];
  const sameCardSet = existingCards.length === pages.length
    && existingCards.every((card, index) => card.dataset.jobId === pages[index]?.jobId);
  if (sameCardSet && pages.length) {
    pages.forEach((page, index) => patchTextLabCard(existingCards[index], page, { running, pages }));
    lastTextDeckKey = renderKey;
    logTextLabCornerChips(deck, pages, 'textlab-patch');
    return;
  }

  lastTextDeckKey = renderKey;

  // One card per page. Flat pages ship as drawn and offer no edit action.
  deck.innerHTML = pages.map((page) => {
    const activity = textLabLiveActivity(page.jobId);
    const isLive = Boolean(activity);
    const hasImage = Boolean(page.artworkReady);
    const flat = textLabPageIsFlat(pages, page);
    const state = flat ? 'flat' : page.read ? 'read' : page.artworkReady ? 'ready' : 'blocked';
    const fill = textLabFillPercent({ ...page, flat }, activity);
    const status = textLabStatusCopy({ ...page, flat }, isLive, activity);
    const hint = flat
      ? 'Ships as drawn'
      : project?.generationMode === 'editable'
        ? (page.read ? `${Number(page.zoneCount) || 0} zones ready` : page.artworkReady ? 'Master waiting' : 'Needs artwork')
        : page.read
          ? `${Number(page.layers) || 0} layers · ${Number(page.textRuns) || 0} text runs`
          : page.artworkReady ? 'Not read yet' : 'Needs artwork';
    return `
    <article class="page-preview-card text-page-card is-${state} ${isLive ? 'is-live' : ''} ${hasImage ? 'has-image' : ''}" data-job-id="${escapeHtml(page.jobId)}" role="listitem" aria-busy="${isLive ? 'true' : 'false'}" aria-label="Page ${escapeHtml(String(page.pageNumber))}">
      <div class="page-visual" style="--preview-aspect-ratio: ${previewAspectRatio(project)}; --page-fill: ${fill}%;">
        ${pageSheetInnerHtml({ id: page.jobId, pageNumber: page.pageNumber, outputPath: hasImage ? page.outputPath || true : null, updatedAt: page.updatedAt, status: page.status, title: page.title }, { isLive, hasImage })}
        ${flat ? '' : textLabCardActionsHtml(page, { running })}
      </div>
      <div class="page-card-body">
        <div class="page-card-heading">
          <strong class="page-card-title">${escapeHtml(String(page.pageNumber))}</strong>
          <span class="page-card-eta">${isLive ? escapeHtml(activity?.etaLabel || '') : ''}</span>
          <span class="page-card-status"><i class="page-state-dot" data-state="${isLive ? 'live' : escapeHtml(state)}" title="${escapeHtml(status)}"></i></span>
        </div>
        <p class="page-hint">${escapeHtml(hint)}</p>
      </div>
    </article>`;
  }).join('');
  bindPageImages(deck);
  logTextLabCornerChips(deck, pages, 'textlab-rebuild');
}

// The Editable PPT stage: one card per slide, showing the artwork that becomes the
// background and how many native text boxes sit on top of it.
function renderEditableDeck(project, op) {
  const deck = elements.pptSlideDeck;
  if (!deck) return;
  const build = project?.editableBuild || { slides: [], totalTextBoxes: 0 };
  const building = op?.kind === 'editable-generation';
  const pages = Number(project?.stats?.total) || 0;

  const sourcePages = Number(project?.editableText?.pagesBuilt || 0);
  const set = (element, value) => { if (element) element.textContent = String(value); };
  set(elements.pptStatSlides, build.slides.length || sourcePages || pages || 0);
  set(elements.pptStatBoxes, build.totalTextBoxes || 0);
  set(elements.pptStatPages, sourcePages);
  const label = building ? 'Assembling…' : build.built ? 'Ready' : build.stale ? 'Needs rebuild' : 'Not built';
  set(elements.pptStatState, label);
  if (elements.editableBuildDot) {
    elements.editableBuildDot.dataset.state = building ? 'busy' : build.built ? 'ok' : build.stale ? 'off' : 'wait';
  }
  if (elements.pptOpenFolderButton) elements.pptOpenFolderButton.hidden = !build.built;

  // Both deliverables come from the same rebuilt pages, so they unlock together the
  // moment Interior Text has produced any - neither depends on the legacy editable
  // build having run.
  const busy = building || op?.kind === 'editable-text';
  const canExport = sourcePages > 0 && !busy;
  const blocked = sourcePages > 0
    ? (busy ? 'Assembly is running.' : '')
    : 'Run Text Lab first.';
  for (const [button, note] of [
    [elements.exportEditablePptxButton, elements.deliverablePptxNote],
    [elements.exportEditableDocxButton, elements.deliverableDocxNote],
    [elements.exportEditablePdfButton, elements.deliverablePdfNote]
  ]) {
    if (button) {
      button.disabled = !canExport;
      button.title = blocked;
    }
    if (note) {
      note.textContent = canExport
        ? `Built from ${sourcePages} rebuilt page${sourcePages === 1 ? '' : 's'}.`
        : blocked;
    }
  }
  if (elements.runEditableEngineButton) {
    elements.runEditableEngineButton.disabled = busy || sourcePages === 0;
    elements.runEditableEngineButton.textContent = building ? 'Assembling…' : 'Assemble deliverables';
  }

  if (!build.slides.length) {
    deck.innerHTML = `<p class="ppt-deck-empty">${building
      ? 'Assembling slides…'
      : sourcePages
        ? 'Assemble first.'
        : 'Run Text Lab first.'}</p>`;
    return;
  }
  deck.innerHTML = build.slides.map((slide) => `
    <article class="ppt-slide${build.stale ? ' is-stale' : ''}">
      <div class="ppt-slide-canvas">
        ${slide.jobId ? `<img src="tpt-image://job/${encodeURIComponent(slide.jobId)}?card=1&v=${encodeURIComponent(project.updatedAt ?? '')}" alt="Slide ${escapeHtml(String(slide.pageNumber ?? ''))} artwork" loading="lazy">` : ''}
        <span class="ppt-slide-badge">${slide.textBoxes} text box${slide.textBoxes === 1 ? '' : 'es'}</span>
      </div>
      <p class="ppt-slide-caption">Slide ${escapeHtml(String(slide.pageNumber ?? '—'))}</p>
    </article>`).join('');
}

/**
 * One mockup slot.
 *
 * The slot is the artifact, so it is also the only surface. It used to be a
 * bordered figure holding a dashed placeholder box inside a bordered grid
 * inside a bordered panel, which put the thing the user came to look at three
 * containers deep and left most of the slot empty.
 *
 * An empty slot reports the ordinal and what it is waiting for. It does not
 * report a percentage, because a slot that has not started is not 10% done.
 */
function tptThumbnailSlotHtml(project, listing, index, liveOp) {
  const path = listing?.thumbnailPaths?.[index];
  const label = index === 0 ? 'Cover' : `Mockup ${index + 1}`;
  const completed = (listing?.thumbnailPaths || []).filter(Boolean).length;
  const generating = listing?.status === 'thumbnails_generating' || liveOp?.kind === 'thumbnails';
  const isThis = generating && !path && index === completed;
  const fill = path ? 100 : isThis ? Math.max(28, Number(liveOp?.percent) || 55) : 0;
  const ordinal = String(index + 1).padStart(2, '0');
  if (path) {
    return `<figure class="tpt-thumbnail has-image">
      <img src="tpt-image://thumbnail/${encodeURIComponent(project.id)}/${index}?v=${encodeURIComponent(project.updatedAt ?? '')}" alt="${escapeHtml(label)}">
      <figcaption>
        <span class="tpt-thumbnail-name">${escapeHtml(label)}</span>
        <span class="tpt-thumbnail-tools">
          <button class="row-button" data-action="preview-tpt-thumbnail" data-thumbnail-index="${index}" type="button">Preview</button>
          <button class="row-button" data-action="regenerate-tpt-thumbnail" data-thumbnail-index="${index}" type="button">Regenerate</button>
          <button class="row-button" data-action="clear-tpt-thumbnail" data-thumbnail-index="${index}" type="button">Delete</button>
        </span>
      </figcaption>
    </figure>`;
  }
  return `<figure class="tpt-thumbnail is-pending ${isThis ? 'is-live' : ''}" style="--page-fill:${fill}%">
    <div class="page-fill-layer" aria-hidden="true"></div>
    <div class="page-fill-sheen" aria-hidden="true"></div>
    <div class="tpt-thumb-placeholder">
      <span class="tpt-thumb-ordinal">${ordinal}</span>
      <strong>${escapeHtml(label)}</strong>
      <span>${isThis ? escapeHtml(liveOp?.message || 'Generating') : generating ? 'Queued' : 'Not generated'}</span>
    </div>
  </figure>`;
}

/**
 * Durable stage state, read from the task queue rather than from live events.
 *
 * Progress events only exist while the window is open. A restart, or a stage that
 * ran while the app was closed, left the panels showing whatever they last caught
 * — usually nothing. The queue is a table, so it can be asked.
 *
 * Task state wins where it exists; live events still supply the moment-to-moment
 * percentage, because a checkpoint is written on a tick and the event is the tick.
 */
const TASK_KIND_BY_STAGE = {
  interior: 'interior',
  interior_artwork: 'interior',
  interior_text: 'interior_text',
  editable_ppt: 'editable_ppt',
  editable: 'editable_ppt',
  thumbnails: 'thumbnails',
  preview: 'preview',
  export: 'export',
  overview: 'analysis'
};

/**
 * What a stage should say about itself.
 *
 * The queue knows things the project row does not: that an attempt is in flight,
 * which attempt it is, and why the last one stopped. Saying so is the difference
 * between a stage that looks stuck and one that is explaining itself — which is
 * most of what made this need watching.
 */
function stageDetail(project, stage, fallback) {
  const task = taskStateFor(project, stage);
  if (!task) return fallback;
  if (task.state === 'failed') {
    const reason = String(task.lastError || 'Stopped').replace(/^[A-Z_]+:\s*/, '');
    return `Failed ${reason.slice(0, 60)}`;
  }
  if (task.state === 'leased') {
    return task.attempts > 1 ? `Running · attempt ${task.attempts}/${task.maxAttempts}` : 'Running';
  }
  if (task.state === 'pending' && task.attempts > 0) {
    return `Retrying · attempt ${task.attempts + 1}/${task.maxAttempts}`;
  }
  if (task.state === 'pending') return 'Queued';
  return fallback;
}

function taskStateFor(project, stage) {
  const kind = TASK_KIND_BY_STAGE[stage];
  if (!kind) return null;
  return state?.tasks?.byProject?.[project?.id]?.byKind?.[kind] ?? null;
}

/** True while the queue is actually holding this stage, restart or not. */
function taskIsRunning(project, stage) {
  return taskStateFor(project, stage)?.state === 'leased';
}

/** A stage the queue gave up on, with the reason it gave. */
function taskFailure(project, stage) {
  const task = taskStateFor(project, stage);
  return task && task.state === 'failed' ? task : null;
}

/**
 * The percentage the stage committed, which survives a restart.
 *
 * Returns null when the queue has nothing to say, so the caller keeps its own
 * derived figure rather than being told a stage is at zero.
 */
function taskPercent(project, stage) {
  const task = taskStateFor(project, stage);
  if (!task) return null;
  if (task.state === 'done') return 100;
  const percent = Number(task.checkpoint?.percent);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function tptMockupsHtml(project) {
  const listing = project.tptListing || {};
  const liveOp = activeLiveOperation(project);
  const thumbnails = Array.from({ length: 4 }, (_, index) => tptThumbnailSlotHtml(project, listing, index, liveOp)).join('');
  const done = (listing.thumbnailPaths || []).filter(Boolean).length;
  const percent = Math.round((done / 4) * 100);
  const thumbBusy = liveOp?.kind === 'thumbnails';
  const thumbReason = stageStartBlockReason('thumbnails', project);
  const startTitle = thumbBusy ? 'Generating.' : (thumbReason || 'Generate mockups.');
  const hasMockups = (listing.thumbnailPaths || []).some(Boolean);
  const made = listing.thumbnailProgress?.completed ?? done;
  // The count is a caption on the work, not a headline above it: a progress
  // meter and a 0/4 tile used to sit between the controls and the mockups,
  // which put telemetry ahead of the artifacts.
  const tally = made === 0 ? 'No mockups yet' : `${made} of 4 made`;
  return `<div class="section-header tpt-section-heading">
      <!-- The workspace title already reads "Mockups Lab". This heading is the
           pane's accessible name and the node mountMockupsDashboard() retitles,
           so it stays in the DOM and is hidden visually. -->
      <h3 class="lab-heading">Mockups Lab</h3>
      <p class="lab-tally">${escapeHtml(thumbBusy ? (liveOp.message || 'Generating') : tally)}</p>
      <div class="lab-actions">
        <button class="button button-gold" data-action="generate-tpt-thumbnails" type="button"${thumbBusy ? ` disabled title="${escapeHtml(startTitle)}"` : ` title="${escapeHtml(startTitle)}"`}>${thumbBusy ? 'Working…' : hasMockups ? 'Regenerate' : 'Generate'}</button>
        <button class="button button-ghost button-danger" data-action="clear-tpt-thumbnails" type="button" ${hasMockups ? '' : 'disabled'} title="${hasMockups ? 'Delete all.' : 'No mockups.'}">Delete all</button>
      </div>
      <div class="lab-meter" role="presentation"><span style="width:${percent}%"></span></div>
    </div>
    <div class="tpt-thumbnail-grid" data-state="${hasMockups ? 'filled' : thumbBusy ? 'working' : 'empty'}">${thumbnails}</div>`;
}

function tptPreviewHtml(project, liveOp = null) {
  const listing = project.tptListing || {};
  const videoPath = listing.videoPreviewPath;
  const status = listing.videoPreviewStatus || (videoPath ? 'ready' : 'pending');
  // A stored status can go stale - a crash or a pause can leave "generating" behind
  // while nothing is running, and the card then reports work that does not exist. The
  // live operation is the authority: it only exists while the step is actually running.
  const op = liveOp?.kind === 'preview' ? liveOp : null;
  const generating = status === 'generating' && Boolean(op);
  const staleGenerating = status === 'generating' && !op;
  const failed = status === 'failed';
  const thumbnailCount = listing.thumbnailPaths?.filter(Boolean).length ?? 0;
  const pageCount = project.jobs?.filter((job) => job.outputPath)?.length ?? 0;
  const statusLabel = videoPath ? 'Saved'
    : generating ? 'Generating'
    : staleGenerating ? 'Interrupted'
    : failed ? 'Needs retry' : 'Ready';
  // While it generates, the card fills like the artwork and mockup cards do. Video is
  // much slower than an image, so a card that shows nothing moving for ten minutes reads
  // as a hang - which is exactly how the long Veo renders looked.
  const percent = generating ? Math.max(4, Math.min(99, Math.round(Number(op?.percent) || 0))) : 0;
  const elapsed = Number(op?.elapsedMs) || 0;
  const elapsedLabel = elapsed > 0
    ? `${Math.floor(elapsed / 60000)}m ${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')}s elapsed`
    : '';
  const player = videoPath
    ? `<video class="tpt-preview-player" controls src="tpt-image://video-preview/${encodeURIComponent(project.id)}?v=${encodeURIComponent(project.updatedAt ?? '')}"></video>`
    : generating
      ? `<div class="tpt-preview-empty is-generating">
          <div class="tpt-preview-fill" style="height:${percent}%"></div>
          <div class="tpt-preview-empty-body">
            <span class="tpt-preview-play is-pulsing" aria-hidden="true"></span>
            <strong>${escapeHtml(op?.message || 'Generating…')}</strong>
            <span>${percent}%${elapsedLabel ? ` · ${escapeHtml(elapsedLabel)}` : ''}</span>
          </div>
        </div>`
      : `<div class="tpt-preview-empty">
          <span class="tpt-preview-play" aria-hidden="true"></span>
          <strong>${staleGenerating ? 'Interrupted' : 'No video yet'}</strong>
          <span>${staleGenerating ? 'Generate again.' : 'Mockups first.'}</span>
        </div>`;
  const error = failed && listing.videoPreviewError
    ? `<p class="error-box">${escapeHtml(listing.videoPreviewError)}</p>`
    : '';
  // One button, one appearance. It used to switch between button-primary and
  // button-ghost depending on whether a video already existed, which read as the control
  // randomly turning dark or blue - and it was only disabled on the listing's stored
  // status, so it stayed clickable while the browser was busy and then failed.
  const busyReason = generating
    ? 'Generating.'
    : (typeof browserBusyReason === 'function' ? browserBusyReason() : '');
  const disabled = Boolean(busyReason);
  const actionLabel = generating ? 'Generating…' : videoPath ? 'Regenerate' : 'Generate';
  return `<div class="section-header tpt-section-heading tpt-preview-heading">
      <div>
        <h3>Preview Lab</h3>
      </div>
    </div>
    ${error}
    <div class="tpt-preview-stage">${player}</div>
    <div class="tpt-preview-toolbar">
      <div class="tpt-preview-stats">
        <span><strong>${thumbnailCount}</strong> mockup${thumbnailCount === 1 ? '' : 's'}</span>
        <span><strong>${pageCount}</strong> page${pageCount === 1 ? '' : 's'}</span>
        <span class="tpt-preview-status is-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
      </div>
      <button class="v-btn v-btn-ghost button-danger" data-action="clear-tpt-preview" type="button"${disabled || !videoPath ? ' disabled' : ''}>Delete all</button>
      <button class="v-btn v-btn-primary" data-action="generate-tpt-preview-video" type="button"${disabled ? ' disabled' : ''} title="${escapeHtml(busyReason || 'Generate preview.')}">${escapeHtml(actionLabel)}</button>
    </div>
    ${videoPath ? `<p class="tpt-preview-file">${escapeHtml(localFileName(videoPath))}</p>` : ''}`;
}

function renderBundleQueue() {
  const allProjects = state.projects ?? [];
  const bundleState = state.bundleUpload ?? {};
  const { active: bundleActive, currentProjectId, queue: bundleQueue = [] } = bundleState;

  // Count ready-to-upload projects (whether or not the bundle is running)
  const readyProjects = allProjects.filter(
    (p) => p.tptListing?.status === 'ready_to_upload'
  );

  // Projects that are queued in a running bundle
  const queuedProjects = bundleActive
    ? allProjects.filter((p) => bundleQueue.includes(p.id))
    : [];

  // Update sidebar badge
  if (elements.bundleReadyBadge) {
    const count = bundleActive ? bundleQueue.length : readyProjects.length;
    elements.bundleReadyBadge.textContent = String(count);
    elements.bundleReadyBadge.hidden = count === 0;
  }

  // Update bundle sidebar button active state
  if (elements.bundleUploadSidebarBtn) {
    elements.bundleUploadSidebarBtn.classList.toggle('is-active', bundleViewActive);
  }

  if (!bundleViewActive) return;

  // Toggle start/stop buttons
  if (elements.startBundleBtn) {
    elements.startBundleBtn.hidden = bundleActive;
    elements.startBundleBtn.disabled = bundleActive;
  }
  if (elements.stopBundleBtn) {
    elements.stopBundleBtn.hidden = !bundleActive;
  }

  // Determine which list to show
  const displayProjects = bundleActive ? queuedProjects : readyProjects;

  if (elements.bundleEmptyState) {
    elements.bundleEmptyState.hidden = displayProjects.length > 0 || bundleActive;
  }

  if (!elements.bundleProjectsList) return;

  if (displayProjects.length === 0 && !bundleActive) {
    elements.bundleProjectsList.innerHTML = '';
    return;
  }

  elements.bundleProjectsList.innerHTML = displayProjects.map((project, index) => {
    const listing = project.tptListing ?? {};
    const isCurrent = bundleActive && project.id === currentProjectId;
    const isFailed = listing.status === 'upload_failed';
    const isDone = ['listing_published', 'draft_submitted'].includes(listing.status);
    const isUploading = ['uploading_listing', 'listing_form_ready', 'submitting_listing'].includes(listing.status) && isCurrent;

    let rowClass = 'bundle-project-row';
    if (isCurrent) rowClass += ' is-current';
    else if (isDone) rowClass += ' is-done';
    else if (isFailed) rowClass += ' is-failed';

    let chipClass = 'bundle-status-chip ready';
    let chipContent = 'Ready';
    if (isCurrent && isUploading) {
      chipClass = 'bundle-status-chip uploading';
      chipContent = '<span class="bundle-upload-dot"></span> Uploading';
    } else if (isFailed) {
      chipClass = 'bundle-status-chip failed';
      chipContent = '✕ Failed';
    } else if (isDone) {
      chipClass = 'bundle-status-chip done';
      chipContent = '✓ Done';
    }

    const indexDisplay = isDone ? '✓' : isFailed ? '✕' : (index + 1);
    const publicationLabel = projectMarketplace(project).settings.publicationStatus === 'active' ? 'Active listing' : 'Inactive draft';
    const message = projectMarketplace(project).upload.message || projectMarketplace(project).upload.error || 'Waiting in queue…';

    return `<div class="${rowClass}">
      <div class="bundle-row-index">${indexDisplay}</div>
      <div class="bundle-row-info">
        <div class="bundle-row-title">${escapeHtml(project.name || 'Untitled')}</div>
        <div class="bundle-row-meta">${escapeHtml(publicationLabel)} • ${escapeHtml(project.format || 'LETTER')}</div>
        <div class="bundle-row-message">${escapeHtml(message)}</div>
      </div>
      <div class="bundle-row-status"><span class="${chipClass}">${chipContent}</span></div>
    </div>`;
  }).join('');
}

function applyWorkspacePanes(view) {
  const requested = view === 'mockups' ? 'thumbnails' : view;
  const next = WORKSPACE_PANES.includes(requested) ? requested : 'overview';
  const fromIndex = WORKSPACE_PANES.indexOf(lastRenderedWorkspaceView);
  const toIndex = Math.max(0, WORKSPACE_PANES.indexOf(next));
  const dir = fromIndex < 0 || fromIndex === toIndex ? 0 : toIndex > fromIndex ? 1 : -1;
  const stage = document.getElementById('workspace-stage');
  const track = document.getElementById('workspace-track');
  if (stage) {
    stage.dataset.direction = dir === 1 ? 'forward' : dir === -1 ? 'back' : 'none';
    stage.style.height = '';
    stage.style.transform = '';
  }
  if (track) track.style.transform = 'none';
  document.querySelectorAll('[data-workspace-pane]').forEach((pane) => {
    const active = pane.dataset.workspacePane === next;
    const wasActive = pane.classList.contains('is-active');
    pane.classList.toggle('is-active', active);
    pane.setAttribute('aria-hidden', active ? 'false' : 'true');
    pane.style.opacity = '';
    pane.style.transform = '';
    pane.style.visibility = '';
    pane.style.pointerEvents = '';
    if (!active) {
      pane.classList.remove('view-enter', 'stage-slide-next', 'stage-slide-prev');
      return;
    }
    if (!wasActive && dir !== 0) {
      pane.classList.remove('view-enter', 'stage-slide-next', 'stage-slide-prev');
      void pane.offsetWidth;
      pane.classList.add(dir > 0 ? 'stage-slide-next' : 'stage-slide-prev', 'view-enter');
      pane.addEventListener('animationend', () => {
        pane.classList.remove('view-enter', 'stage-slide-next', 'stage-slide-prev');
        pane.style.opacity = '';
        pane.style.transform = '';
      }, { once: true });
    }
  });
  document.querySelectorAll('.workspace-tab').forEach((button) => {
    button.disabled = false;
    button.removeAttribute('aria-disabled');
    button.classList.toggle('is-active', button.dataset.viewTarget === next);
  });
  const stageHost = document.getElementById('workspace-stage');
  if (stageHost) stageHost.classList.toggle('is-text-lab', next === 'interior_text');
  mountInteriorDashboard(next);
  mountMockupsDashboard(next);
  if (typeof window.versaMazeLab?.mountMazeDashboard === 'function') window.versaMazeLab.mountMazeDashboard(next);
}

// Interior Artwork and Interior Text are the same page studio as the static Interior
// stage, so they share its one dashboard: the node moves into whichever pane is open.
// Moving it keeps every cached element reference valid, so rendering is untouched.
// Interior Text writes copy, not pictures, so it never borrows the artwork grid.
const INTERIOR_DASHBOARD_TITLES = {
  interior: 'Pages Lab',
  interior_artwork: 'Pages Lab'
};
function mountInteriorDashboard(view) {
  const section = document.querySelector('[data-workspace-section="interior"]');
  if (!section) return;
  const target = INTERIOR_DASHBOARD_TITLES[view] ? view : 'interior';
  const host = document.querySelector(`[data-workspace-pane="${target}"]`);
  if (host && section.parentElement !== host) host.appendChild(section);
  const heading = section.querySelector('.queue-panel .section-header h3');
  if (heading) heading.textContent = INTERIOR_DASHBOARD_TITLES[target];
}

function mountMockupsDashboard(view) {
  const section = document.querySelector('[data-workspace-section="thumbnails"]');
  if (!section) return;
  const host = document.querySelector('[data-workspace-pane="thumbnails"]');
  if (host && section.parentElement !== host) host.appendChild(section);
  const heading = section.querySelector('h3');
  if (heading) heading.textContent = 'Mockups Lab';
  void view;
}

function syncWorkspaceStageHeight() {
  const stage = document.getElementById('workspace-stage');
  if (stage) stage.style.height = '';
}

function visibleWorkspacePanes() {
  return [...document.querySelectorAll('#project-standard-view .workspace-tab')]
    .filter((tab) => !tab.hidden && !tab.hasAttribute('hidden') && !tab.hasAttribute('inert') && tab.tabIndex !== -1)
    .map((tab) => tab.dataset.viewTarget)
    .filter(Boolean);
}

function shiftWorkspacePane(delta) {
  if (activeWorkspaceView === 'interior_text') return false;
  const visible = visibleWorkspacePanes();
  const index = visible.indexOf(activeWorkspaceView);
  const next = visible[index + delta];
  if (!next) return false;
  activeWorkspaceView = next;
  renderProject();
  return true;
}

function renderProject() {
  const selected = activeProject();
  const mazeReady = selected?.productFormat === 'maze' && (
    mazeWorkspaceOpen
    || (selected.mazeProject?.pages || []).some((page) => page.generationStatus === 'ready')
  );
  if (incomingMarketBook && mazeReady) {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H161',location:'renderer/renderer.js:renderProject',message:'clearing incoming so Maze Lab can paint ready mazes',data:{projectId:selected.id,ready:(selected.mazeProject?.pages||[]).filter((page)=>page.generationStatus==='ready').length,mazeWorkspaceOpen},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    clearIncomingMarketplace();
  }
  if (incomingMarketBook) {
    paintIncomingMarketplace();
    return;
  }
  const project = selected;
  const hasProject = Boolean(project);
  const hasBooks = (state?.projects?.length || 0) > 0;
  elements.emptyState.hidden = hasProject || bundleViewActive;
  elements.projectWorkspace.hidden = !hasProject || bundleViewActive;
  if (elements.bundleUploadView) elements.bundleUploadView.hidden = !bundleViewActive;
  document.body.classList.toggle('has-books', hasBooks);
  document.body.classList.toggle('has-project', hasProject);
  const liveSearch = String(document.getElementById('ui-global-search')?.value || '').trim();
  if (liveSearch) document.body.dataset.studioPin = 'library';
  const pin = document.body.dataset.studioPin;
  const mode = bundleViewActive
    ? 'bundle'
    : (hasProject && pin !== 'library')
      ? 'studio'
      : 'library';
  document.body.dataset.mode = mode;
  if (typeof window.__versaSetStudioMode === 'function') window.__versaSetStudioMode(mode, false);
  if (!project) {
    selectedJobId = null;
    if (elements.storybookResumePhase2Button) elements.storybookResumePhase2Button.hidden = true;
    return;
  }

  const isMazeBook = project.productFormat === 'maze';
  const liveOp = activeLiveOperation(project);
  const mazeHasWork = isMazeBook && (
    mazeWorkspaceOpen
    || liveOp?.kind === 'maze'
    || (project.mazeProject?.pages || []).some((page) => page.generationStatus === 'ready')
  );
  const isConceptOnly = project.activityCount === 0 && project.projectType !== 'storybook' && !mazeHasWork;
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H60',location:'renderer/renderer.js:renderProject',message:'workspace gate for concept vs maze lab',data:{projectId:project.id,productFormat:project.productFormat||null,activityCount:project.activityCount,isConceptOnly,isMazeBook,mazeWorkspaceOpen,mazeHasWork,activeWorkspaceView},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (mazeHasWork && !['maze', 'overview', 'thumbnails', 'preview', 'export'].includes(activeWorkspaceView)) {
    activeWorkspaceView = 'maze';
  }
  applyLiveMazeToRail(project, liveOp);
  if (elements.projectConceptView) elements.projectConceptView.hidden = !isConceptOnly;
  if (elements.projectStandardView) elements.projectStandardView.hidden = isConceptOnly;
  if (elements.storybookResumePhase2Button) {
    elements.storybookResumePhase2Button.hidden = project.projectType !== 'storybook'
      || !['workflow_failed', 'phase2_failed'].includes(project.storybookPhase);
    elements.storybookResumePhase2Button.dataset.projectId = project.id;
  }

  if (isConceptOnly) {
    if (elements.conceptProjectTitle) elements.conceptProjectTitle.textContent = displayProjectName(project.name);
    if (elements.conceptProjectMeta) elements.conceptProjectMeta.textContent = `Concept · 0 pages`;
    if (elements.conceptDisplayAge) elements.conceptDisplayAge.textContent = project.targetAge || '—';
    if (elements.conceptDisplayDescription) elements.conceptDisplayDescription.textContent = project.description || '—';
    if (elements.conceptDisplayHighlights) {
      elements.conceptDisplayHighlights.innerHTML = (Array.isArray(project.highlights) ? project.highlights : [])
        .map((h) => `<li>${escapeHtml(h)}</li>`)
        .join('') || '';
    }
    renderConceptMockups(project);
    seedConceptMarketRail();
    if (elements.conceptGeneratePromptsBtn) {
      elements.conceptGeneratePromptsBtn.disabled = false;
      elements.conceptGeneratePromptsBtn.textContent = isMazeBook ? 'Generate mazes' : 'Generate prompts';
    }
    const lede = conceptLede();
    if (lede) {
      lede.textContent = 'Saved locally.';
    }
    const composeTitle = document.querySelector('.concept-brief__compose h3');
    const composeHint = document.querySelector('.concept-brief__compose .concept-brief__hint');
    if (composeTitle) composeTitle.textContent = isMazeBook ? 'Generate mazes' : 'Generate prompts';
    if (composeHint) {
      composeHint.textContent = isMazeBook
        ? 'Builds locally.'
        : 'One per page.';
    }
    return;
  }

  const characters = project.highlights && typeof project.highlights === 'object' && Array.isArray(project.highlights.characters)
    ? project.highlights.characters
    : [];
  if (elements.projectCharactersSection && elements.projectCharactersGrid) {
    elements.projectCharactersSection.hidden = false;
    elements.projectCharactersGrid.innerHTML = characters.length
      ? characterCardsHtml(project, project.storybookPhase === 'complete')
      : '<p class="muted">None</p>';
  }

  chooseDefaultJob(project);
  const { stats } = project;
  if (lastRenderedWorkspaceView !== activeWorkspaceView) {
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  applyWorkspacePanes(activeWorkspaceView);
  mountInteriorDashboard(activeWorkspaceView);
  mountMockupsDashboard(activeWorkspaceView);
  if (typeof window.versaMazeLab?.mountMazeDashboard === 'function') {
    window.versaMazeLab.mountMazeDashboard(activeWorkspaceView);
  }
  const viewChanged = lastRenderedWorkspaceView !== activeWorkspaceView;
  lastRenderedWorkspaceView = activeWorkspaceView;
  if (elements.tptThumbnailsReview) {
    const mockupsKey = `${project.id}|${(project.tptListing?.thumbnailPaths || []).join(',')}|${liveOp?.kind === 'thumbnails' ? 1 : 0}`;
    elements.tptThumbnailsReview.hidden = false;
    if (elements.tptThumbnailsReview.dataset.mountKey !== mockupsKey) {
      elements.tptThumbnailsReview.innerHTML = tptMockupsHtml(project);
      elements.tptThumbnailsReview.dataset.mountKey = mockupsKey;
    }
    elements.tptThumbnailsReview.dataset.filled = '1';
  }
  renderEditableEngineProgress(project);
  if (elements.tptPreviewReview) {
    const previewKey = `${project.id}|${project.tptListing?.videoPreviewPath || ''}|${project.tptListing?.videoPreviewStatus || ''}|${liveOp?.kind === 'preview' ? 1 : 0}`;
    elements.tptPreviewReview.hidden = false;
    if (elements.tptPreviewReview.dataset.mountKey !== previewKey) {
      elements.tptPreviewReview.innerHTML = tptPreviewHtml(project, liveOp);
      elements.tptPreviewReview.dataset.mountKey = previewKey;
    }
    elements.tptPreviewReview.dataset.filled = '1';
  }
  elements.projectMeta.textContent = `${projectSetupLabel(project)} • ${stats.total} ${stats.total === 1 ? 'page' : 'pages'}`;
  elements.projectTitle.textContent = displayProjectName(project.name);
  if (elements.projectFormatToggle) {
    const editable = project.productFormat === 'editable';
    const maze = project.productFormat === 'maze';
    elements.projectFormatToggle.textContent = maze ? 'Maze' : editable ? 'Editable' : 'Static';
    elements.projectFormatToggle.classList.toggle('is-editable', editable);
    elements.projectFormatToggle.hidden = false;
    elements.projectFormatToggle.disabled = Boolean(project.productEngine) || maze;
    elements.projectFormatToggle.title = maze
      ? 'Maze'
      : project.productEngine ? 'Locked' : 'Format';
  }
  if (elements.projectGenerationModeToggle) {
    const textFree = project.generationMode === 'editable';
    const show = project.productFormat === 'editable';
    elements.projectGenerationModeToggle.hidden = !show;
    elements.projectGenerationModeToggle.textContent = textFree ? 'Text free' : 'Baked text';
    elements.projectGenerationModeToggle.classList.toggle('is-editable', textFree);
    elements.projectGenerationModeToggle.title = textFree
      ? 'Live text.'
      : 'Baked text.';
  }
  if (elements.projectTheme) {
    elements.projectTheme.textContent = '';
    elements.projectTheme.hidden = true;
    elements.projectTheme.title = project.outputDir || '';
  }
  elements.statTotal.textContent = String(stats.total);
  elements.statComplete.textContent = String(stats.complete);
  if (elements.statRemaining) elements.statRemaining.textContent = String(stats.remaining);
  const pipeline = (typeof computeProductPipeline === 'function' ? computeProductPipeline : window.computeProductPipeline)(project, liveOp);
  const characterReferences = (project.characterSheets || []).filter((sheet) => sheet.status === 'complete' && sheet.outputPath).length;
  const characterNames = characters.map((character) => character.name).filter(Boolean);
  const listing = project.tptListing;
  const thumbnailCount = pipeline.thumbnailCount;
  const reviewApproved = tptListingReviewApproved(listing);
  const uploadReady = reviewApproved || ['ready_to_upload', 'uploading_listing', 'listing_form_ready', 'submitting_listing', 'draft_submitted', 'listing_published', 'upload_browser_open'].includes(listing?.status);
  const overviewCanExport = pipeline.pagesDone;
  const characterPct = pipeline.characterPct;
  const editablePct = pipeline.editablePct;
  const thumbPct = pipeline.thumbPct;
  const previewPct = pipeline.previewPct;
  const exportPct = pipeline.exportPct;
  elements.statPercent.textContent = `${pipeline.percent}%`;
  if (elements.overviewProductRing) elements.overviewProductRing.style.setProperty('--progress', String(pipeline.percent));
  if (elements.overviewOverallCard) elements.overviewOverallCard.dataset.viewTarget = pipeline.nextView;
  if (elements.overviewOpenStages) {
    elements.overviewOpenStages.textContent = pipeline.complete
      ? 'Done'
      : pipeline.requiredOpen.length
        ? pipeline.requiredOpen.map((stage) => stage.label).join(' · ')
        : pipeline.openStages.length
          ? pipeline.openStages.map((stage) => stage.label).join(' · ')
          : '';
  }
  setMeterWidth('overview-overall-meter', pipeline.percent);
  setMeterWidth('overview-interior-meter', pipeline.pagePercent);
  setMeterWidth('overview-interior-artwork-meter', pipeline.pagePercent);
  setMeterWidth('overview-interior-text-meter', pipeline.textPct);
  setMeterWidth('overview-editable-meter', editablePct);
  setMeterWidth('overview-maze-meter', pipeline.mazePct ?? 0);
  setMeterWidth('overview-thumbnails-meter', thumbPct);
  setMeterWidth('overview-mockups-meter', thumbPct);
  setMeterWidth('overview-preview-meter', previewPct);
  setMeterWidth('overview-export-meter', exportPct);
  const queueHere = Boolean(state?.queue?.running && state.queue.activeProjectId === project.id);
  // A stage is live if the queue is holding it, or if a live operation says so.
  // The queue is the half that survives a restart; the live op is the half that
  // knows about work started outside the queue.
  const stageLive = {
    overall: Boolean(liveOp || queueHere || state?.workBusy?.characters || state?.tasks?.runner?.active?.length),
    characters: Boolean(state?.workBusy?.characters) || (project.characterSheets || []).some((sheet) => sheet.status === 'generating'),
    interior: queueHere || taskIsRunning(project, 'interior'),
    interior_artwork: queueHere || taskIsRunning(project, 'interior_artwork'),
    interior_text: liveOp?.kind === 'editable-text' || taskIsRunning(project, 'interior_text'),
    editable_ppt: liveOp?.kind === 'editable-generation' || taskIsRunning(project, 'editable_ppt'),
    maze: liveOp?.kind === 'maze' || taskIsRunning(project, 'maze'),
    editable: liveOp?.kind === 'editable-generation' || taskIsRunning(project, 'editable'),
    thumbnails: liveOp?.kind === 'thumbnails' || taskIsRunning(project, 'thumbnails'),
    mockups: liveOp?.kind === 'thumbnails' || taskIsRunning(project, 'thumbnails'),
    preview: liveOp?.kind === 'preview' || taskIsRunning(project, 'preview'),
    export: liveOp?.kind === 'export' || taskIsRunning(project, 'export')
  };
  const stageBlocked = {
    interior: false,
    editable: false,
    thumbnails: false,
    preview: false,
    export: false
  };
  const stageSkipped = {
    editable: !pipeline.editable,
    interior_text: false,
    editable_ppt: !pipeline.editable
  };
  // A stage the queue failed reads as failed even if the project row still says
  // pending — the queue is what actually ran it, and it recorded why it stopped.
  const stepStatus = {
    interior: taskFailure(project, 'interior') ? 'failed' : project.stepInteriorStatus,
    interior_artwork: taskFailure(project, 'interior_artwork') ? 'failed' : project.stepInteriorStatus,
    interior_text: taskFailure(project, 'interior_text') ? 'failed' : project.stepEditableStatus,
    editable_ppt: taskFailure(project, 'editable_ppt') ? 'failed' : project.stepEditableGenerationStatus,
    maze: taskFailure(project, 'maze') ? 'failed' : project.stepMazeStatus,
    editable: taskFailure(project, 'editable') ? 'failed' : project.stepEditableGenerationStatus,
    thumbnails: taskFailure(project, 'thumbnails') ? 'failed' : project.stepThumbnailsStatus,
    mockups: taskFailure(project, 'thumbnails') ? 'failed' : project.stepThumbnailsStatus,
    preview: taskFailure(project, 'preview') ? 'failed' : project.stepPreviewStatus,
    export: taskFailure(project, 'export') ? 'failed' : project.stepExportStatus
  };
  // The committed percentage wins where the queue has one: it is what the stage
  // actually reached, and it is still there after a restart. Where it has none the
  // derived figure stands, so nothing regresses to zero.
  const withTask = (stage, derived) => taskPercent(project, stage) ?? derived;
  const stagePercent = {
    overall: pipeline.percent,
    interior: withTask('interior', pipeline.pagePercent),
    interior_artwork: withTask('interior_artwork', pipeline.pagePercent),
    interior_text: withTask('interior_text', pipeline.editable ? pipeline.textPct : pipeline.pagePercent),
    editable_ppt: withTask('editable_ppt', editablePct),
    maze: withTask('maze', pipeline.mazePct ?? 0),
    editable: withTask('editable', editablePct),
    thumbnails: withTask('thumbnails', thumbPct),
    mockups: withTask('thumbnails', thumbPct),
    preview: withTask('preview', previewPct),
    export: withTask('export', exportPct)
  };
  Object.entries(stagePercent).forEach(([id, pct]) => {
    const skipped = Boolean(stageSkipped[id]);
    const live = Boolean(stageLive[id]);
    const blocked = Boolean(stageBlocked[id]) && pct < 100 && !live;
    const failed = stepStatus[id] === 'failed' && !live;
    const stateName = skipped ? 'skipped' : failed ? 'error' : live ? 'live' : pct >= 100 ? 'done' : blocked ? 'blocked' : pct > 0 ? 'progress' : 'waiting';
    setStagePresentation(id, stateName, { filling: live, percent: pct });
    if (id !== 'overall') setTabMark(id, stateName);
  });
  // Characters stage removed from product UI.
  document.querySelectorAll(
    '.overview-stage-card[data-stage="characters"], [data-view-target="characters"], [data-workspace-pane="characters"], [data-workspace-section="characters"]'
  ).forEach((node) => {
    node.hidden = true;
    node.setAttribute('hidden', '');
  });
  // Editable products run their own pipeline: Interior Artwork -> Interior Text ->
  // Editable PPT replaces the static "Interior" step entirely, so only one set shows.
  const showEditableStage = project.productFormat === 'editable';
  const showMazeStage = project.productFormat === 'maze';
  const setStageVisible = (stage, visible) => {
    document.querySelectorAll(
      `.overview-stage-card[data-stage="${stage}"], [data-view-target="${stage}"], [data-workspace-pane="${stage}"]`
    ).forEach((node) => {
      const isTab = node.classList.contains('workspace-tab');
      node.hidden = !visible;
      if (visible) {
        node.removeAttribute('hidden');
        node.removeAttribute('inert');
        if (isTab) {
          node.tabIndex = 0;
          node.removeAttribute('aria-hidden');
        }
      } else {
        node.setAttribute('hidden', '');
        node.setAttribute('inert', '');
        if (isTab) {
          node.tabIndex = -1;
          node.setAttribute('aria-hidden', 'true');
        }
      }
    });
  };
  setStageVisible('interior_artwork', showEditableStage);
  setStageVisible('editable_ppt', showEditableStage);
  setStageVisible('interior_text', showEditableStage);
  setStageVisible('interior', !showEditableStage && !showMazeStage);
  setStageVisible('maze', showMazeStage);
  setStageVisible('editable', false);
  setStageVisible('mockups', false);
  const overviewTab = document.getElementById('overview-workspace-tab');
  if (overviewTab) overviewTab.textContent = showMazeStage ? 'Maze Overview' : 'Overview';
  renumberPipeline();
  mountInteriorDashboard(activeWorkspaceView);
  const hiddenStages = showMazeStage
    ? ['interior', 'interior_artwork', 'interior_text', 'editable_ppt', 'editable', 'mockups']
    : showEditableStage
    ? ['interior', 'editable', 'mockups', 'maze']
    : ['interior_artwork', 'interior_text', 'editable_ppt', 'editable', 'mockups', 'maze'];
  if (activeWorkspaceView === 'mockups') {
    activeWorkspaceView = 'thumbnails';
    applyWorkspacePanes('thumbnails');
  } else if (hiddenStages.includes(activeWorkspaceView)) {
    activeWorkspaceView = 'overview';
    applyWorkspacePanes('overview');
  }
  if (activeWorkspaceView === 'characters') {
    activeWorkspaceView = 'overview';
    applyWorkspacePanes('overview');
  }
  if (elements.overviewInteriorDetail) {
    elements.overviewInteriorDetail.textContent = stageDetail(project, 'interior',
      stats.remaining === 0 && stats.total > 0
        ? (projectPdf(project).productPath ? 'PDF ready' : 'Pages done')
        : `${stats.remaining} left`);
  }
  if (elements.overviewEditableStatus) {
    elements.overviewEditableStatus.textContent = project.stepEditableGenerationStatus === 'completed' ? 'PowerPoint ready' : 'Not built';
    elements.overviewEditableDetail.textContent = 'PowerPoint';
  }
  if (elements.overviewInteriorArtworkStatus) {
    elements.overviewInteriorArtworkStatus.textContent = `${stats.complete} / ${stats.total} pages`;
      elements.overviewInteriorArtworkDetail.textContent = stats.total && stats.remaining === 0
        ? 'Ready' : `${stats.remaining} left`;
  }
  const overviewMazeStatus = document.getElementById('overview-maze-status');
  const overviewMazeDetail = document.getElementById('overview-maze-detail');
  if (overviewMazeStatus) {
    const mazePages = project.mazeProject?.pages || [];
    const mazeReady = mazePages.filter((page) => page.generationStatus === 'ready').length;
    const mazeTotal = Number(project.mazeLab?.pageCount) || mazePages.length;
    overviewMazeStatus.textContent = mazeTotal
      ? `${mazeReady} / ${mazeTotal} mazes`
      : project.stepMazeStatus === 'completed' ? 'Ready' : 'Not generated';
    if (overviewMazeDetail) {
      const keyword = project.mazeProject?.config?.keyword || project.theme || 'Theme';
      const tier = project.mazeProject?.config?.difficultyTier;
      const diff = window.versaMazeLab?.mazeDifficultyLabel(tier) || 'Easy';
      overviewMazeDetail.textContent = `${keyword} · ${diff}`;
    }
  }
  if (elements.overviewInteriorTextStatus) {
    if (showEditableStage) {
      const ready = Number(project.editableText?.ready) || 0;
      const total = Number(project.editableText?.total) || 0;
      elements.overviewInteriorTextStatus.textContent = `${ready} / ${total} pages`;
      elements.overviewInteriorTextDetail.textContent = total && ready === total
        ? 'Ready' : 'Live text';
    } else {
      elements.overviewInteriorTextStatus.textContent = `${stats.complete} / ${stats.total} pages`;
      elements.overviewInteriorTextDetail.textContent = stats.total && stats.remaining === 0
        ? 'Ready' : 'On the pages';
    }
  }
  renderEditableEngineProgress(project);
  if (elements.runEditableEngineButton) {
    const reason = stageStartBlockReason('editable_generation', project);
    const editableRunning = liveOp?.kind === 'editable-generation';
    elements.runEditableEngineButton.disabled = Boolean(reason) || editableRunning || project.productFormat !== 'editable';
    elements.runEditableEngineButton.title = editableRunning
      ? 'Generating.'
      : (reason || 'Generate pages.');
  }
  document.querySelectorAll('[data-action="run-stage"]').forEach((btn) => {
    const step = btn.dataset.stage;
    const inNode = isOverviewNodeAction(btn);
    if (step === 'characters') {
      if (inNode) syncOverviewNodeAction(btn, { hide: true, disable: true });
      else {
        btn.hidden = true;
        btn.disabled = true;
      }
      return;
    }
    // The shared page dashboard carries its own interior run button. Editable books
    // start that work from their own stage button, so the duplicate is dropped.
    if (step === 'interior' && project.productFormat === 'editable') {
      if (inNode) syncOverviewNodeAction(btn, { hide: true, disable: true });
      else {
        btn.hidden = true;
        btn.disabled = true;
      }
      return;
    }
    const reason = stageStartBlockReason(step, project);
    const running = ((step === 'interior' || step === 'interior_artwork') && isGeneratingThisProject(project))
      || ((step === 'editable_generation' || step === 'editable_ppt') && liveOp?.kind === 'editable-generation')
      || (step === 'interior_text' && liveOp?.kind === 'editable-text')
      || (step === 'thumbnails' && liveOp?.kind === 'thumbnails')
      || (step === 'preview' && liveOp?.kind === 'preview')
      || (step === 'export' && liveOp?.kind === 'export')
      || (step === 'maze' && liveOp?.kind === 'maze');
    const interiorDone = (step === 'interior' || step === 'interior_artwork') && stats.total > 0 && stats.remaining === 0;
    if (interiorDone) {
      if (inNode) syncOverviewNodeAction(btn, { hide: true, disable: true });
      else {
        btn.hidden = true;
        btn.disabled = true;
      }
    } else {
      btn.hidden = step === 'editable' && project.productFormat !== 'editable';
      // Autonomy: keep lab/header controls enabled; toast the reason on click if it cannot run.
      btn.disabled = running;
      if (inNode) {
        const card = btn.closest('.overview-stage-card');
        const hasVideo = Boolean(listing?.videoPreviewPath);
        btn.textContent = overviewNodeActionLabel(step, { running, hasVideo });
        syncOverviewNodeAction(btn, {
          hide: Boolean(btn.hidden),
          disable: running || Boolean(reason)
        });
        const hint = card?.querySelector('.stage-run-reason');
        if (hint) {
          hint.hidden = true;
          hint.textContent = '';
        }
      } else {
        btn.title = running ? 'This stage is already running.' : (reason || `Start the ${step} stage.`);
        if (step === 'interior') {
          btn.textContent = btn.id === 'run-interior-button' || btn.classList.contains('stage-run-btn')
            ? 'Start pages'
            : btn.textContent;
        }
      }
    }
  });
  document.querySelectorAll('[data-action="regenerate-interior"]').forEach((btn) => {
    const interiorDone = stats.total > 0 && stats.remaining === 0;
    const running = isGeneratingThisProject(project);
    const regenerable = (project.jobs || []).some((job) => job.status === 'complete' && job.conversationUrl);
    if (isOverviewNodeAction(btn)) {
      btn.textContent = running ? 'Generating…' : 'Regenerate';
      syncOverviewNodeAction(btn, { hide: !interiorDone, disable: !interiorDone || running });
    } else {
      btn.hidden = !interiorDone;
      btn.disabled = !interiorDone || running;
      btn.title = running
        ? 'Regenerating.'
        : !regenerable
          ? 'No conversations.'
          : 'Regenerate pages.';
    }
  });
  document.querySelectorAll('[data-action="start-full-automation"]').forEach((btn) => {
    const running = Boolean(state?.automation?.active && !state?.automation?.paused);
    const reason = running
      ? 'Automation running.'
      : browserBusyReason();
    btn.disabled = Boolean(reason);
    btn.title = reason || 'Start.';
  });
  elements.overviewThumbnailCount.textContent = `${thumbnailCount} / 4`;
  elements.overviewThumbnailDetail.textContent = listing?.status === 'thumbnails_generating'
    ? 'Generating…'
    : thumbnailCount === 4 ? 'Saved' : thumbnailCount > 0 ? `${thumbnailCount} saved` : (pipeline.pagesDone ? 'Ready' : 'After pages');
  if (elements.overviewMockupsStatus) {
    elements.overviewMockupsStatus.textContent = `${thumbnailCount} / 4`;
    if (elements.overviewMockupsDetail) {
      elements.overviewMockupsDetail.textContent = listing?.status === 'thumbnails_generating'
        ? 'Generating…'
        : thumbnailCount === 4 ? 'Saved' : thumbnailCount > 0 ? `${thumbnailCount} saved` : (pipeline.pagesDone ? 'Ready' : 'After pages');
    }
  }
  
  if (elements.overviewPreviewStatus) {
    const previewStatus = listing?.videoPreviewStatus || (listing?.videoPreviewPath ? 'ready' : 'pending');
    elements.overviewPreviewStatus.textContent = listing?.videoPreviewPath
      ? 'Saved'
      : previewStatus === 'generating' ? 'Generating…' : previewStatus === 'failed' ? 'Failed' : 'Not generated';
    if (elements.overviewPreviewDetail) {
      elements.overviewPreviewDetail.textContent = listing?.videoPreviewPath
        ? localFileName(listing.videoPreviewPath)
        : '';
    }
  }
  const submittedToTpt = ['draft_submitted', 'listing_published'].includes(listing?.status) && projectMarketplace(project).upload.verified;
  elements.overviewExportStatus.textContent = !overviewCanExport
    ? 'Book incomplete'
    : listing?.status === 'draft_submitted' && projectMarketplace(project).upload.verified
      ? 'Draft submitted'
      : listing?.status === 'listing_published' && projectMarketplace(project).upload.verified
        ? 'Published & verified'
        : uploadReady ? 'Ready to upload' : 'Ready to export';
  elements.overviewExportDetail.textContent = !overviewCanExport
    ? `${stats.remaining} left`
    : submittedToTpt
      ? 'On TPT'
      : uploadReady ? 'Ready to upload' : 'Ready';
  const generatingElsewhere = isGeneratingElsewhere(project);
  const generatingHere = isGeneratingThisProject(project);
  const generatingBook = generatingProjectRecord();
  const dockPercent = liveOp ? liveOp.percent : generatingHere ? pipeline.pagePercent : pipeline.percent;
  elements.progressFill.style.width = `${dockPercent}%`;
  if (elements.progressPercentLabel) {
    elements.progressPercentLabel.textContent = `${Math.round(dockPercent)}%`;
  }
  if (elements.liveDock) {
    elements.liveDock.classList.toggle('is-live', Boolean(liveOp || generatingHere || generatingElsewhere));
  }
  const cooldownActive = generatingHere && Number(state.queue.cooldownRemainingMs) > 0;
  elements.queueCaption.textContent = generatingElsewhere
    ? `Background: ${displayProjectName(generatingBook?.name || 'another book')}`
    : liveOp
      ? `${Math.round(liveOp.percent)}% · ${liveOp.label}`
      : cooldownActive
        ? 'Automatic safety cooldown'
        : state.queue.running ? 'Engine running' : pipeline.complete ? 'Product ready' : `Pages ${pipeline.pagePercent}% · product ${pipeline.percent}%`;
  const activeCount = generatingHere ? (state.queue.activeJobIds?.length ?? (state.queue.activeJobId ? 1 : 0)) : 0;
  const current = generatingHere
    ? (project.jobs.find((job) => job.id === state.queue.activeJobId)
      ?? project.jobs.find((job) => job.status !== 'complete'))
    : project.jobs.find((job) => job.status !== 'complete');
  elements.currentJobLabel.textContent = generatingElsewhere
    ? displayProjectName(generatingBook?.name || 'Another book')
    : liveOp
      ? liveOp.message || liveOp.label
      : generatingHere && current
        ? `Page ${current.pageNumber}/${stats.total}`
        : 'Ready';
  elements.currentJobStatus.className = `status-chip status-${liveOp || generatingHere ? (liveOp ? 'generating' : (current?.status ?? 'generating')) : pipeline.complete ? 'complete' : 'pending'}`;
  elements.currentJobStatus.textContent = generatingElsewhere
    ? 'Background'
    : liveOp
      ? `${Math.round(liveOp.percent)}%`
      : generatingHere
        ? statusLabel(current?.status ?? 'generating')
        : pipeline.complete ? 'Ready' : 'Ready';
  if (liveOp) elements.heartbeatText.textContent = liveOp.message || liveOp.label;
  else if (generatingHere) elements.heartbeatText.textContent = `${pipeline.pagePercent}%`;
  else elements.heartbeatText.textContent = '';
  // The hero transport is the whole-pipeline control. It used to call startQueue, which
  // only generates the interior pages, while being labelled "Start" at the top of the
  // book - so there was no visible way to run the pipeline end to end, and the one
  // obvious button did something narrower than it looked.
  const automation = state?.automation || {};
  const pipelineRunning = Boolean(automation.active && !automation.paused);
  const pipelineOwnsThis = pipelineRunning && automation.currentProjectId === project?.id;
  const runBlocked = stageStartBlockReason('overview', project) || stageStartBlockReason('interior', project);
  elements.runButton.disabled = Boolean(runBlocked) || pipelineRunning;
  elements.runButton.hidden = false;
  elements.runButton.textContent = automation.paused ? 'Resume pipeline' : 'Run pipeline';
  elements.runButton.title = pipelineRunning
    ? (pipelineOwnsThis ? 'Running.' : 'Another book running.')
    : (runBlocked || 'Run every stage in order.');

  // The step the pipeline is on, so the control says what it is doing rather than only
  // that it is doing something.
  if (elements.pipelineStepLabel) {
    const step = automation.currentStep ? (STEP_LABELS?.[automation.currentStep] || automation.currentStep) : '';
    elements.pipelineStepLabel.textContent = pipelineOwnsThis && step
      ? `Pipeline · ${step}`
      : automation.paused ? 'Pipeline paused' : '';
    elements.pipelineStepLabel.hidden = !elements.pipelineStepLabel.textContent;
  }

  const pauseEnabled = isPipelineBusy() || pipelineRunning;
  const pauseLabel = liveOp?.message?.startsWith('Stopping') ? 'Stopping…' : 'Pause';
  elements.pauseButton.disabled = !pauseEnabled;
  elements.pauseButton.hidden = false;
  elements.pauseButton.textContent = pauseLabel;
  if (elements.livePauseButton) {
    elements.livePauseButton.disabled = !pauseEnabled;
    elements.livePauseButton.hidden = false;
    elements.livePauseButton.textContent = pauseLabel;
  }
  if (elements.studioStagePause) {
    elements.studioStagePause.disabled = !pauseEnabled;
    elements.studioStagePause.hidden = false;
    elements.studioStagePause.textContent = pauseLabel;
  }
  if (elements.studioBannerPause) {
    elements.studioBannerPause.disabled = !pauseEnabled;
    elements.studioBannerPause.hidden = false;
    elements.studioBannerPause.textContent = pauseLabel;
  }
  elements.retryAllButton.disabled = generatingHere || stats.remaining === 0;
  elements.outputFolderButton.disabled = false;
  elements.outputFolderButton.title = 'Folder';
  const canExport = Number(stats.complete) > 0 || Boolean(projectPdf(project).productPath);
  elements.exportAllFilesButton.disabled = !canExport;
  if (elements.exportToManagementButton) elements.exportToManagementButton.disabled = !canExport;
  if (elements.generateTptThumbnailsButton) {
    const reason = stageStartBlockReason('thumbnails', project);
    elements.generateTptThumbnailsButton.disabled = liveOp?.kind === 'thumbnails';
    elements.generateTptThumbnailsButton.title = liveOp?.kind === 'thumbnails' ? 'Generating.' : (reason || 'Start.');
  }
  if (elements.generateTptPreviewVideoButton) {
    const reason = stageStartBlockReason('preview', project);
    elements.generateTptPreviewVideoButton.disabled = liveOp?.kind === 'preview';
    elements.generateTptPreviewVideoButton.title = liveOp?.kind === 'preview' ? 'Preview is already generating.' : (reason || 'Start the preview video.');
  }
  if (elements.openTptUploadButton) {
    elements.openTptUploadButton.disabled = !projectPdf(project).productPath;
  }
  const completedForUpload = reviewApproved || ['ready_to_upload', 'uploading_listing', 'listing_form_ready', 'submitting_listing', 'draft_submitted', 'listing_published', 'upload_browser_open'].includes(project.tptListing?.status);
  [
    elements.whenCompleteControl,
    elements.outputFolderButton,
    elements.retryAllButton
  ].forEach((element) => {
    if (element) element.hidden = false;
  });
  if (completedForUpload && elements.storybookResumePhase2Button) elements.storybookResumePhase2Button.hidden = true;
  if (elements.markTptReadyButton) {
    elements.markTptReadyButton.hidden = true;
  }
  if (elements.startTptUploadingButton) {
    elements.startTptUploadingButton.hidden = true;
  }
  elements.exportPdfButton.disabled = !canExport;
  elements.exportPdfButton.title = canExport ? '' : 'Add pages or a PDF first.';
  elements.exportZipButton.disabled = !canExport;
  elements.exportZipButton.title = canExport ? '' : 'Add pages or a PDF first.';
  elements.exportPptxButton.disabled = !canExport;
  elements.exportPptxButton.title = canExport ? '' : 'Add pages or a PDF first.';
  elements.exportCaption.textContent = canExport
    ? 'Pick a book.'
    : 'Add pages first';
  renderEvents(project);
  renderJobs(project);
  renderDetail(project);
  if (showMazeStage && typeof window.versaMazeLab?.renderMazeLab === 'function') {
    const pages = project.mazeProject?.pages || [];
    if (selectedMazePageId && !pages.some((page) => page.pageId === selectedMazePageId)) {
      selectedMazePageId = null;
    }
    if (!selectedMazePageId) selectedMazePageId = pages[0]?.pageId || null;
    mazePreviewVariant = project.mazeLab?.previewVariant === 'solution' ? 'solution' : mazePreviewVariant;
    window.versaMazeLab.renderMazeLab(project, {
      view: activeWorkspaceView,
      selectedPageId: selectedMazePageId,
      previewVariant: mazePreviewVariant,
      livePageId: liveOp?.kind === 'maze' ? liveOp.jobId : null,
      aspect: previewAspectRatio(project)
    });
  }
  requestAnimationFrame(() => syncWorkspaceStageHeight());
}

function renderAutomationBar() {
  const bar = elements.automationBar;
  if (!bar) return;

  const autoState = state?.automation || { active: false, paused: false };

  bar.hidden = false; // Always show the automation bar

  if (!autoState.active && !autoState.paused) {
    if (elements.automationStartBtn) elements.automationStartBtn.hidden = false;
    if (elements.automationPauseBtn) elements.automationPauseBtn.hidden = true;
    if (elements.automationResumeBtn) elements.automationResumeBtn.hidden = true;
    if (elements.automationBarLabel) elements.automationBarLabel.textContent = 'Ready';
    const dot = bar.querySelector('.automation-pulsing-dot');
    if (dot) dot.style.animation = 'none';
  } else if (autoState.paused) {
    if (elements.automationStartBtn) elements.automationStartBtn.hidden = true;
    if (elements.automationPauseBtn) elements.automationPauseBtn.hidden = true;
    if (elements.automationResumeBtn) elements.automationResumeBtn.hidden = false;
    if (elements.automationBarLabel) elements.automationBarLabel.textContent = 'Paused';
    const dot = bar.querySelector('.automation-pulsing-dot');
    if (dot) dot.style.animation = 'none';
  } else {
    if (elements.automationStartBtn) elements.automationStartBtn.hidden = true;
    if (elements.automationPauseBtn) elements.automationPauseBtn.hidden = false;
    if (elements.automationResumeBtn) elements.automationResumeBtn.hidden = true;
    if (elements.automationBarLabel) elements.automationBarLabel.textContent = 'Running';
    const dot = bar.querySelector('.automation-pulsing-dot');
    if (dot) dot.style.animation = '';
  }

  const { currentBookIndex = 0, totalBooks = 0, currentStep = '' } = autoState;
  
  if (elements.automationBarDetail) {
    const stepLabel = STEP_LABELS[currentStep] || currentStep;

    if (totalBooks > 0) {
      const currentName = displayProjectName(
        (state.projects || []).find((item) => item.id === autoState.currentProjectId)?.name
          || activeProject()?.name
          || 'this book'
      );
      elements.automationBarDetail.textContent = totalBooks === 1
        ? `${currentName} → ${stepLabel}`
        : `Book ${currentBookIndex}/${totalBooks} → ${stepLabel}`;
    } else {
      elements.automationBarDetail.textContent = 'Starting…';
    }
  }

  if (elements.automationOverallFill) {
    if (totalBooks > 0) {
      const labOrder = ['interior_artwork', 'interior_text', 'editable_ppt', 'thumbnails', 'preview', 'export'];
      const staticOrder = ['interior', 'thumbnails', 'preview', 'export'];
      const mazeOrder = ['maze', 'thumbnails', 'preview', 'export'];
      const format = activeProject()?.productFormat;
      const order = format === 'editable' ? labOrder : format === 'maze' ? mazeOrder : staticOrder;
      const stepIndex = Math.max(0, order.indexOf(currentStep));
      const stepProgress = stepIndex / Math.max(1, order.length);
      const bookProgress = (currentBookIndex - 1) / totalBooks;
      const pct = Math.min(100, Math.max(0, (bookProgress + (stepProgress / totalBooks)) * 100));
      elements.automationOverallFill.style.width = `${pct}%`;
    } else {
      elements.automationOverallFill.style.width = '0%';
    }
  }
}

function renderBackgroundGenerationBar() {
  if (!elements.backgroundGenerationBar) return;
  const generating = generatingProjectRecord();
  const viewingOther = Boolean(generating && state.selectedProjectId && generating.id !== state.selectedProjectId);
  elements.backgroundGenerationBar.hidden = !viewingOther;
  if (elements.backgroundGenerationText && viewingOther) {
    elements.backgroundGenerationText.textContent = `"${displayProjectName(generating.name)}" generating.`;
  }
}

function render() {
  const renderStarted = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  renderUpdate();
  renderBrowser();
  renderAuth();
  renderSettingsConnections();
  renderProjectList();
  renderProject();
  syncMarketRailFromState(state);
  renderBundleQueue();
  renderAutomationBar();
  renderBackgroundGenerationBar();
  renderWindowsUrlPageSetup();
  applyEditableEngineUi();
  applyAppearanceUi();

  // Sync When Complete action dropdown
  if (elements.whenCompleteAction && state.app && state.app.whenCompleteAction) {
    elements.whenCompleteAction.value = state.app.whenCompleteAction;
  }

  // Render system action countdown overlay
  if (elements.countdownOverlay) {
    const sysAction = state.app?.systemAction;
    if (sysAction) {
      elements.countdownOverlay.classList.remove('hidden');
      if (elements.countdownActionTitle) {
        elements.countdownActionTitle.textContent = sysAction.actionType === 'sleep'
          ? 'Putting PC to sleep...'
          : 'Shutting down PC...';
      }
      if (elements.countdownNumber) {
        elements.countdownNumber.textContent = String(sysAction.secondsRemaining);
      }
    } else {
      elements.countdownOverlay.classList.add('hidden');
    }
  }
}

async function refreshState() {
  state = await api.getState();
  render();
}

function openCropDialog() {
  const job = selectedJob();
  const project = activeProject();
  if (!job || !project) return;

  elements.cropDialogTitle.textContent = `Page ${job.pageNumber}`;
  elements.cropPreviewImage.src = `tpt-image://job/${encodeURIComponent(job.id)}?raw=true&v=${encodeURIComponent(job.updatedAt ?? '')}`;

  const container = elements.cropPreviewContainer;
  const isLandscape = project.orientation === 'landscape';
  const isSquare = project.format === 'SQUARE';

  if (isSquare) {
    container.style.width = '320px';
    container.style.height = '320px';
  } else if (isLandscape) {
    container.style.width = '320px';
    container.style.height = '240px';
  } else {
    container.style.width = '320px';
    container.style.height = '414px';
  }

  const zoom = job.zoom ?? 1.0;
  const offsetX = job.offsetX ?? 0.0;
  const offsetY = job.offsetY ?? 0.0;

  elements.cropZoomSlider.value = zoom;
  elements.cropPanXSlider.value = offsetX;
  elements.cropPanYSlider.value = offsetY;

  updateCropPreview();
  elements.cropDialog.showModal();
}

function updateCropPreview() {
  const zoom = parseFloat(elements.cropZoomSlider.value) || 1.0;
  const offsetX = parseFloat(elements.cropPanXSlider.value) || 0.0;
  const offsetY = parseFloat(elements.cropPanYSlider.value) || 0.0;

  elements.cropZoomValue.textContent = Math.round(zoom * 100);
  elements.cropPanXValue.textContent = Math.round(offsetX * 100);
  elements.cropPanYValue.textContent = Math.round(offsetY * 100);

  const translateX = offsetX * 50;
  const translateY = offsetY * 50;

  elements.cropPreviewImage.style.transform = `scale(${zoom}) translate(${translateX / zoom}%, ${translateY / zoom}%)`;
}

async function saveCropAdjustment() {
  const job = selectedJob();
  if (!job) return;

  const btn = elements.cropSaveBtn;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving crop…';

  const zoom = parseFloat(elements.cropZoomSlider.value) || 1.0;
  const offsetX = parseFloat(elements.cropPanXSlider.value) || 0.0;
  const offsetY = parseFloat(elements.cropPanYSlider.value) || 0.0;

  try {
    await invoke(() => api.reprocessPageImage(job.id, zoom, offsetX, offsetY), {
      successMessage: 'Page image crop saved successfully.'
    });
    elements.cropDialog.close();
  } catch (e) {
    showToast(errorMessage(e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// The analysis decides the pipeline. The radios stay in the DOM so the value still
// reads back, but the choice is made for the user and shown as a decision, not a question.
function applyDetectedPipeline(detected) {
  const format = detected?.productFormat === 'editable' || detected?.productFormat === 'maze'
    ? detected.productFormat
    : 'static';
  const radios = [...document.querySelectorAll('input[name="analysisPipelineChoice"]')];
  for (const radio of radios) radio.checked = radio.value === format;

  const box = radios[0]?.closest('.page-count-selection-box');
  const heading = document.getElementById('analysis-pipeline-heading');
  const note = document.getElementById('analysis-pipeline-detected');
  if (heading) {
    heading.textContent = format === 'editable'
      ? 'Editable'
      : format === 'maze'
        ? 'Maze'
        : 'Static';
  }
  if (note) {
    note.hidden = false;
    note.textContent = format === 'editable'
      ? 'Editable pipeline.'
      : format === 'maze'
        ? 'Maze pipeline.'
        : 'Print pipeline.';
  }
  // Hide the options themselves; the engine is not a user decision any more.
  for (const radio of radios) {
    const option = radio.closest('.radio-option');
    if (option) option.hidden = true;
  }
  if (box) box.dataset.detectedFormat = format;
}

function openProjectDialog() {
  elements.projectForm.reset();
  elements.bulkPromptsText.value = '';
  storybookReviewState = null;
  storybookGenerationPending = false;
  storySelectedPhotoPath = null;
  if (elements.storyCharacterPhoto) elements.storyCharacterPhoto.value = '';
  if (elements.storyUploadFilename) elements.storyUploadFilename.textContent = 'No photo';
  if (elements.storyClearUploadBtn) elements.storyClearUploadBtn.classList.add('hidden');
  applyNewProjectDefaults();
  showProjectMethodStep('agent');
  renderBulkPromptCount();
  renderPageOutputSpec();
  elements.projectDialog.showModal();
}

async function persistMazeLabFromForm() {
  const project = activeProject();
  if (!project || project.productFormat !== 'maze' || !window.versaMazeLab) return null;
  const config = window.versaMazeLab.collectMazeConfig();
  const lab = window.versaMazeLab.collectMazeLab();
  if (typeof api.setMazeConfig === 'function') await api.setMazeConfig(project.id, config);
  if (typeof api.setMazeLab === 'function') {
    return api.setMazeLab(project.id, {
      ...lab,
      selectedPageId: selectedMazePageId,
      previewVariant: mazePreviewVariant
    });
  }
  return null;
}

async function persistAndGenerateMaze({ resume = false } = {}) {
  const project = activeProject();
  if (!project?.id) return;
  if (typeof api.generateMazeBook !== 'function') {
    showToast('Restart the app.', 'warning');
    return;
  }
  mazeWorkspaceOpen = true;
  setMarketLocalStage('prompts', resume ? 'Resuming…' : 'Generating…');
  return invoke(async () => {
    await persistMazeLabFromForm();
    const result = await api.generateMazeBook(project.id, {
      resume,
      force: !resume,
      pageCount: window.versaMazeLab?.collectMazeLab().pageCount
    });
    const ready = (result?.mazeProject?.pages || []).filter((page) => page.generationStatus === 'ready').length;
    await continueMazePipelineFromLab(project, ready);
    return result;
  }, { successMessage: resume ? 'Maze generation resumed.' : 'Mazes generated.' });
}

function resolveMazeGenerateCount(project) {
  const candidates = [
    Number.parseInt(analysisResult?.analysis?.pageCount, 10),
    Number.parseInt(project?.mazeLab?.pageCount, 10),
    Number.parseInt(elements.conceptGeneratePageCount?.value, 10)
  ];
  const picked = candidates.find((value) => Number.isSafeInteger(value) && value > 0 && value <= 50);
  return picked || 8;
}

async function generateMazeFromMarketplace(project) {
  if (!project?.id) return null;
  if (typeof api.generateMazeBook !== 'function') {
    showToast('Restart the app.', 'warning');
    return null;
  }
  const pageCount = resolveMazeGenerateCount(project);
  const livePages = (state?.activeProject?.id === project.id
    ? state.activeProject?.mazeProject?.pages
    : project.mazeProject?.pages || []);
  const liveReady = livePages.filter((page) => page.generationStatus === 'ready').length;
  const designStale = livePages.some((page) => page.generationStatus === 'ready'
    && page.topology?.design?.revision !== 3);
  const lookAlike = liveReady >= 2 && new Set(livePages
    .filter((page) => page.topology)
    .map((page) => `${page.topology.shape}|${page.topology.algorithm}|${page.topology.lattice}`)).size < 2;
  if (liveReady >= pageCount && pageCount > 0 && !designStale && !lookAlike) {
    await continueMazePipelineFromLab(project, liveReady);
    return { mazeProject: project.mazeProject || state?.activeProject?.mazeProject || null };
  }
  if (state?.liveOperation?.kind === 'maze' && state.liveOperation.projectId === project.id) {
    return null;
  }
  mazeWorkspaceOpen = true;
  activeWorkspaceView = 'maze';
  document.body.dataset.studioPin = '';
  setMarketLocalStage('prompts', `Generating ${pageCount}…`);
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H65',location:'renderer/renderer.js:generateMazeFromMarketplace',message:'marketplace generate started maze book',data:{projectId:project.id,pageCount,productFormat:project.productFormat||null,hasGenerateApi:typeof api.generateMazeBook==='function'},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const generateBtn = elements.conceptGeneratePromptsBtn;
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating…';
  }
  try {
    if (typeof api.setMazeLab === 'function') {
      await api.setMazeLab(project.id, { pageCount });
    }
    await api.selectProject(project.id);
    window.__versaSetStudioMode?.('studio', true);
    if (elements.projectDialog?.open) elements.projectDialog.close();
    renderProject();
    const result = await api.generateMazeBook(project.id, {
      pageCount,
      brief: {
        title: project.name || '',
        description: project.description || '',
        targetAge: project.targetAge || '',
        highlights: project.highlights || [],
        listingTitle: project.tptListing?.title || '',
        listingDescription: project.tptListing?.description || '',
        listingGrade: project.tptListing?.grade || project.targetAge || '',
        keyword: project.tptListing?.title || project.name || '',
        forceAgeFromListing: true
      }
    });
    const ready = (result?.mazeProject?.pages || []).filter((page) => page.generationStatus === 'ready').length;
    setMarketLocalStage('lab', `${ready} maze${ready === 1 ? '' : 's'} ready.`);
    showToast(`${ready} maze${ready === 1 ? '' : 's'} ready.`, 'success');
    await continueMazePipelineFromLab(project, ready);
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H65',location:'renderer/renderer.js:generateMazeFromMarketplace',message:'marketplace generate finished maze book',data:{projectId:project.id,ready,pageCount,cancelled:Boolean(result?.cancelled),failed:Number(result?.failed)||0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    await refreshState();
    renderProject();
    return result;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H66',location:'renderer/renderer.js:generateMazeFromMarketplace',message:'marketplace generate maze book failed',data:{projectId:project.id,pageCount,error:errorMessage(error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    failMarketSession(errorMessage(error));
    showToast(errorMessage(error), 'error');
    return null;
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate mazes';
    }
  }
}

async function handleAction(action, target) {
  const project = activeProject();
  const jobId = target.dataset.jobId ?? selectedJobId;
  if (action === 'check-update') {
    return invoke(async () => {
      showToast('Checking…', 'info');
      await api.checkForUpdates();
    }, { refresh: false });
  }
  if (action === 'install-update') return invoke(() => api.installUpdate(), { refresh: false });
  if (action === 'open-settings') return openSettings();
  if (action === 'set-appearance') {
    const appearance = String(target.dataset.appearance || 'light').toLowerCase();
    if (appearance === 'light' || appearance === 'dark') {
      document.documentElement.dataset.theme = appearance;
      document.documentElement.style.colorScheme = appearance;
      try { localStorage.setItem('versa-theme', appearance); } catch {}
      document.querySelectorAll('.appearance-switch [data-appearance]').forEach((button) => {
        const selected = button.dataset.appearance === appearance;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
    document.querySelectorAll('.appearance-choice[data-appearance]').forEach((button) => {
      const selected = button.dataset.appearance === appearance;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (typeof api?.setAppearance !== 'function') {
      showToast('Restart the app.', 'warning');
      return;
    }
    return invoke(() => api.setAppearance(appearance), { refresh: false });
  }
  if (action === 'delete-project') {
    return deleteProjectById(target.dataset.projectId);
  }
  if (action === 'close-settings') return elements.settingsDialog.close();
  if (action === 'select-settings-tab') return selectSettingsTab(target.dataset.settingsTarget);
  if (action === 'restore-customization-links') {
    restoreCustomizationLinks();
    if (elements.settingsSaveNote) elements.settingsSaveNote.textContent = 'Links restored.';
    return;
  }
  if (action === 'restore-customization-prompts') {
    restoreCustomizationPrompts();
    if (elements.settingsSaveNote) elements.settingsSaveNote.textContent = 'Prompts restored.';
    return;
  }
  if (action === 'restore-customization-field') {
    restoreCustomizationField(target);
    if (elements.settingsSaveNote) elements.settingsSaveNote.textContent = 'Field restored.';
    return;
  }
  if (action === 'test-sound') {
    const soundType = target.dataset.soundType || 'success';
    playChime(soundType);
    showRichToast({
      type: soundType === 'complete' ? 'complete' : soundType === 'error' ? 'error' : soundType === 'warning' ? 'warning' : 'success',
      title: 'Sound Test',
      message: `Playing "${soundType}" alert audio chime.`,
      duration: 3000
    });
    return;
  }
  if (action === 'settings-manage-chatgpt') {
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    return openAuthManager('gemini');
  }
  if (action === 'settings-manage-openai') {
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    return openAuthManager('chatgpt');
  }
  if (action === 'settings-manage-meta') {
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    return openAuthManager('meta');
  }
  if (action === 'set-ai-engine') {
    const requested = String(target.dataset.engine || '').toLowerCase();
    const engine = requested === 'gemini' || requested === 'meta' ? requested : 'chatgpt';
    return invoke(async () => {
      if (typeof api.setAiEngine !== 'function') {
        throw new Error('Restart the app to load the engine switch.');
      }
      const result = await api.setAiEngine(engine);
      showToast(`${engineLabel(engine)} is on. ${unusedEngineSummary(engine)}`, 'success');
      if (result?.loginRequired) openAuthManager(engine);
      return result;
    });
  }
  if (action === 'settings-verify-chatgpt') {
    const originalText = target.textContent;
    target.disabled = true;
    target.textContent = 'Verifying…';
    elements.settingsChatgptStatus.textContent = 'Checking Gemini';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'gemini' }));
      if (result?.authenticated) showToast('Gemini verified.', 'success');
      return result;
    } finally {
      target.disabled = false;
      target.textContent = originalText;
    }
  }
  if (action === 'settings-verify-openai') {
    const originalText = target.textContent;
    target.disabled = true;
    target.textContent = 'Verifying…';
    if (elements.settingsMockupsStatus) elements.settingsMockupsStatus.textContent = 'Checking ChatGPT';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'chatgpt' }));
      if (result?.authenticated) showToast('ChatGPT verified.', 'success');
      await populateSettingsForm();
      return result;
    } finally {
      target.disabled = false;
      target.textContent = originalText;
    }
  }
  if (action === 'settings-verify-meta') {
    const originalText = target.textContent;
    target.disabled = true;
    target.textContent = 'Verifying…';
    if (elements.settingsMetaStatus) elements.settingsMetaStatus.textContent = 'Checking Meta AI.';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'meta' }));
      if (result?.authenticated) showToast('Meta AI verified.', 'success');
      return result;
    } finally {
      target.disabled = false;
      target.textContent = originalText;
    }
  }
  if (action === 'ui-toggle-sidebar') {
    const sidebar = document.getElementById('ui-sidebar');
    const toggle = document.getElementById('ui-sidebar-toggle');
    if (!sidebar) return;
    const collapsed = sidebar.classList.toggle('is-collapsed');
    // The button advertises aria-pressed and the sidebar aria-expanded; both have to
    // follow the actual state or the control lies to assistive tech.
    toggle?.setAttribute('aria-pressed', String(collapsed));
    sidebar.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem('versa.sidebarCollapsed', collapsed ? '1' : '0'); } catch { /* private mode */ }
    return;
  }
  if (action === 'ui-focus-search') {
    const search = document.getElementById('ui-global-search');
    if (!search) return;
    search.focus();
    search.select?.();
    return;
  }
  if (action === 'settings-logout-openai') {
    const confirmed = confirm('Log out of ChatGPT?');
    if (!confirmed) return;
    const btn = elements.settingsOpenaiLogout;
    const originalText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Logging out…';
    }
    try {
      // preload exposes logoutChatGpt; logoutOpenAi never existed, so this button
      // threw a TypeError instead of ending the session.
      await invoke(() => api.logoutChatGpt());
      showToast('Logged out.', 'success');
      await populateSettingsForm();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
    return;
  }
  if (action === 'settings-open-mockups-gpt') {
    if (!state?.integrations?.chatgptMockups?.connected) {
      if (elements.settingsDialog.open) elements.settingsDialog.close();
      return openAuthManager('chatgpt');
    }
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    return invoke(() => api.openMockupsGpt(), { successMessage: 'ChatGPT opened with the verified profile.', refresh: false });
  }
  if (action === 'settings-logout-chatgpt') {
    const confirmed = confirm('Log out of Gemini?');
    if (!confirmed) return;
    const btn = elements.settingsChatgptLogout;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Logging out…';
    try {
      await invoke(() => api.logoutChatGpt());
      showToast('Logged out.', 'success');
      await populateSettingsForm();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
    return;
  }
  if (action === 'settings-logout-meta') {
    const confirmed = confirm('Log out of Meta AI?');
    if (!confirmed) return;
    const btn = elements.settingsMetaLogout;
    const originalText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Logging out…';
    }
    try {
      if (typeof api.logoutMeta !== 'function') throw new Error('Restart the app to load Meta logout.');
      await invoke(() => api.logoutMeta());
      showToast('Logged out.', 'success');
      await populateSettingsForm();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
    return;
  }
  if (action === 'run-stage') {
    const step = target.dataset.stage || 'editable';
    const view = step === 'editable_generation' ? 'editable' : step;
    if (WORKSPACE_PANES.includes(view)) activeWorkspaceView = view;
    const reason = stageStartBlockReason(step, project);
    if (reason) {
      showToast(reason, 'warning');
      return renderProject();
    }
    if (step === 'characters') {
      return invoke(() => {
        if (typeof api.generateAllCharacterSheets !== 'function') {
          throw new Error('Restart the app to load character generation.');
        }
        return api.generateAllCharacterSheets(project.id);
      }, { successMessage: 'Character references finished.' });
    }
    if (step === 'interior' || step === 'interior_artwork') return handleAction('start', target);
    if (step === 'interior_text') return handleAction('generate-editable-text', target);
    if (step === 'editable_generation' || step === 'editable_ppt') return handleAction('run-editable-engine', target);
    if (step === 'thumbnails') return handleAction('generate-tpt-thumbnails', target);
    if (step === 'preview') return handleAction('generate-tpt-preview-video', target);
    if (step === 'export') return handleAction('export-all-files', target);
    if (step === 'maze') return handleAction('generate-maze', target);
    showToast(`Unknown stage "${step}".`, 'warning');
    return;
  }
  if (action === 'start-full-automation') {
    if (!project?.id) {
      showToast('Select a book.', 'warning');
      return;
    }
    const reason = state?.automation?.active && !state?.automation?.paused
      ? 'Automation running.'
      : browserBusyReason();
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => api.startAutomation(project.id), { successMessage: 'Full automation started for this book.' });
  }
  if (action === 'run-editable-engine') {
    if (!project) return;
    return invoke(() => api.runEditableGeneration(project.id), {successMessage:'Native editable pages generated.'});
  }
  if (action === 'open-output-folder') {
    // The project's own output folder, which is where every deliverable is written.
    // This used to reveal editableBuild.pptxPath - the legacy engine's book-editable.pptx
    // - so "Show files" opened a stale file in a different place from the exports.
    if (!project?.outputDir) return showToast('No output folder.', 'warning');
    return api.revealPath(project.outputDir);
  }
  if (action === 'write-page-text') {
    if (!project) return;
    // The local engine needs no browser; only the gem fallback does.
    const reason = visionReady() ? '' : browserBusyReason();
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    const jobIds = [target.dataset.jobId];
    return invoke(() => api.generateEditablePageText(project.id, { jobIds, force: true }), {successMessage:'Page text written from this page artwork.'});
  }
  if (action === 'generate-editable-text') {
    if (!project) return;
    const reason = visionReady() ? '' : browserBusyReason();
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => api.generateEditablePageText(project.id), {
      successMessage: visionReady()
        ? 'Pages read and rebuilt with live, editable text.'
        : 'Page text written from the page artwork.'
    });
  }
  if (action === 'rebuild-editable-text') {
    if (!project) return;
    if (!window.confirm('Rebuild pages?')) return;
    const reason = visionReady() ? '' : browserBusyReason();
    if (reason) { showToast(reason, 'warning'); return; }
    return invoke(() => api.generateEditablePageText(project.id, { force: true }), {
      successMessage: 'Pages re-read and rebuilt.'
    });
  }
  if (action === 'export-editable-pptx') {
    if (!project) return;
    const path = await invoke(() => api.exportPptx(project.id, {}), {
      successMessage: 'Editable PowerPoint exported.'
    });
    if (path) openItem(path);
    return;
  }
  if (action === 'export-editable-docx') {
    if (!project) return;
    const path = await invoke(() => api.exportDocx(project.id, {}), {
      successMessage: 'Word document exported.'
    });
    if (path) openItem(path);
    return;
  }
  if (action === 'export-editable-pdf') {
    if (!project) return;
    const path = await invoke(() => api.exportPdf(project.id, {}), {
      successMessage: 'Layered PDF exported.'
    });
    if (path) openItem(path);
    return;
  }
  if (action === 'clear-tpt-thumbnails') {
    if (!window.confirm('Delete all mockups?')) return;
    return invoke(() => api.clearTptThumbnails(project.id), { successMessage: 'Mockups deleted.' });
  }
  if (action === 'clear-tpt-thumbnail') {
    if (!window.confirm('Delete this mockup?')) return;
    return invoke(() => api.clearTptThumbnail(project.id, Number.parseInt(target.dataset.thumbnailIndex, 10)), { successMessage: 'Mockup deleted.' });
  }
  if (action === 'clear-competitor-mockups') {
    if (!window.confirm('Delete competitor mockups?')) return;
    return invoke(() => api.clearCompetitorMockups(project.id), { successMessage: 'Competitor mockups deleted.' });
  }
  if (action === 'settings-open-custom-gpt') {
    if (!state?.integrations?.gemini?.connected) {
      if (elements.settingsDialog.open) elements.settingsDialog.close();
      return openAuthManager('gemini');
    }
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    return invoke(() => api.openStudio('planning'), { successMessage: 'Content Pages Gem opened.', refresh: false });
  }
  if (action === 'settings-open-studio') {
    const studioId = target.dataset.studio;
    const studios = [
      ...(state?.integrations?.studios?.gems ?? []),
      ...(state?.integrations?.studios?.gpts ?? [])
    ];
    const studio = studios.find((item) => item.id === studioId);
    if (studio?.engine === 'gemini' && !state?.integrations?.gemini?.connected) {
      if (elements.settingsDialog.open) elements.settingsDialog.close();
      return openAuthManager('gemini');
    }
    if (studio?.engine === 'chatgpt' && !state?.integrations?.chatgpt?.connected) {
      if (elements.settingsDialog.open) elements.settingsDialog.close();
      return openAuthManager('chatgpt');
    }
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    return invoke(() => api.openStudio(studioId), { successMessage: `${studio?.name || 'Studio'} opened.`, refresh: false });
  }
  if (action === 'toggle-product-format') {
    const project = state?.activeProject;
    if (!project?.id || typeof api.setProjectFormat !== 'function') return;
    if (project.productFormat === 'maze') return;
    const next = project.productFormat === 'editable' ? 'static' : 'editable';
    return invoke(() => api.setProjectFormat(project.id, next), {
      successMessage: next === 'editable'
        ? 'Marked editable (PowerPoint + SVG).'
        : 'Marked static (print only).'
    });
  }
  if (action === 'toggle-generation-mode') {
    const project = state?.activeProject;
    if (!project?.id || typeof api.setProjectGenerationMode !== 'function') return;
    const next = project.generationMode === 'editable' ? 'fixed' : 'editable';
    return invoke(() => api.setProjectGenerationMode(project.id, next), {
      successMessage: next === 'editable'
        ? 'Text free next.'
        : 'Baked text next.'
    });
  }
  if (action === 'generate-maze' || action === 'resume-maze') {
    if (!project || project.productFormat !== 'maze') return;
    return persistAndGenerateMaze({ resume: action === 'resume-maze' });
  }
  if (action === 'cancel-maze') {
    if (!project?.id || typeof api.cancelMaze !== 'function') return;
    return invoke(() => api.cancelMaze(project.id), { successMessage: 'Maze generation stopped. Finished pages were kept.' });
  }
  if (action === 'pick-management-folders') {
    if (typeof window.versaBookManagement?.chooseFolders === 'function') {
      return window.versaBookManagement.chooseFolders();
    }
    if (typeof api.chooseBookManagementRoot === 'function') {
      return invoke(() => api.chooseBookManagementRoot(), { successMessage: 'Folders saved.' });
    }
    return;
  }
  if (action === 'delete-all-maze-pages') {
    if (!project || project.productFormat !== 'maze' || typeof api.clearMazePages !== 'function') return;
    if (!window.confirm('Delete all mazes?')) return;
    return invoke(() => api.clearMazePages(project.id), { successMessage: 'Mazes deleted.' });
  }
  if (action === 'delete-all-job-images') {
    if (!project || typeof api.clearJobImages !== 'function') return;
    if (!window.confirm('Delete all pages?')) return;
    return invoke(() => api.clearJobImages(project.id), { successMessage: 'Pages deleted.' });
  }
  if (action === 'delete-all-text-lab') {
    if (!project || typeof api.clearTextLab !== 'function') return;
    if (!window.confirm('Delete all text?')) return;
    return invoke(() => api.clearTextLab(project.id), { successMessage: 'Text deleted.' });
  }
  if (action === 'delete-all-editable') {
    if (!project || typeof api.clearEditableLab !== 'function') return;
    if (!window.confirm('Delete all files?')) return;
    return invoke(() => api.clearEditableLab(project.id), { successMessage: 'Files deleted.' });
  }
  if (action === 'delete-maze-page') {
    if (!project || project.productFormat !== 'maze' || typeof api.clearMazePage !== 'function') return;
    const pageId = target.dataset.pageId || selectedMazePageId || project.mazeProject?.pages?.[0]?.pageId;
    if (!pageId) return showToast('Select a maze.', 'warning');
    if (!window.confirm('Delete this maze?')) return;
    selectedMazePageId = pageId;
    return invoke(() => api.clearMazePage(project.id, pageId), { successMessage: 'Maze deleted.' });
  }
  if (action === 'regenerate-maze-page') {
    if (!project || project.productFormat !== 'maze' || typeof api.generateMazePage !== 'function') return;
    const pageId = target.dataset.pageId || selectedMazePageId || project.mazeProject?.pages?.[0]?.pageId;
    if (!pageId) return showToast('Select a maze.', 'warning');
    selectedMazePageId = pageId;
    return invoke(async () => {
      await persistMazeLabFromForm();
      return api.generateMazePage(project.id, { pageId });
    }, { successMessage: 'Maze regenerated.' });
  }
  if (action === 'select-maze-page') {
    selectedMazePageId = target.dataset.pageId || null;
    return renderProject();
  }
  if (action === 'maze-preview-variant') {
    mazePreviewVariant = target.dataset.variant === 'solution' ? 'solution' : 'student';
    if (project?.id && typeof api.setMazeLab === 'function') {
      api.setMazeLab(project.id, { previewVariant: mazePreviewVariant }).catch(() => {});
    }
    return renderProject();
  }
  if (action === 'copy-maze-seed') {
    const seed = document.getElementById('maze-seed')?.value;
    if (!seed) return showToast('Generate first.', 'warning');
    return invoke(() => api.copyToClipboard(seed), { successMessage: 'Seed copied.', refresh: false });
  }
  if (action === 'toggle-maze-seed-lock') {
    if (!project?.id || typeof api.setMazeLab !== 'function') return;
    const next = !(project.mazeLab?.seedLocked);
    return invoke(() => api.setMazeLab(project.id, { seedLocked: next }), {
      successMessage: next ? 'Seed locked.' : 'Seed unlocked.'
    });
  }
  if (action === 'reroll-maze-seed') {
    if (!project?.id || typeof api.rerollMazeSeed !== 'function') return;
    if (project.mazeLab?.seedLocked) return showToast('Unlock seed.', 'warning');
    return invoke(() => api.rerollMazeSeed(project.id), { successMessage: 'New seed ready.' });
  }
  if (action === 'new-project') return openProjectDialog();
  if (action === 'close-dialog') return elements.projectDialog.close();
  if (action === 'open-storybook-dashboard') {
    const projectId = storybookReviewState?.project?.id;
    elements.projectDialog.close();
    storybookReviewState = null;
    if (projectId) return invoke(() => api.selectProject(projectId));
    return;
  }
  if (action === 'retry-storybook-phase2') {
    const retryProjectId = target.dataset.projectId || storybookReviewState?.project?.id || project?.id;
    const retryProject = state?.activeProject?.id === retryProjectId
      ? state.activeProject
      : storybookReviewState?.project;
    if (!retryProjectId || !retryProject) return;
    const phase1Preview = {
      blueprint: retryProject.storyBlueprint || '',
      exactPageText: retryProject.storyExactText || [],
      characters: retryProject.highlights?.characters || [],
      frontCover: retryProject.frontCoverPrompt || '',
      pages: [],
      backCover: retryProject.backCoverPrompt || ''
    };
    if (!elements.projectDialog.open) elements.projectDialog.showModal();
    renderStorybookReviewModal({ project: retryProject, parsed: phase1Preview }, 'characters_generating');
    storybookGenerationPending = true;
    try {
      const result = await invoke(() => api.retryStorybookPhase2(retryProjectId), { refresh: false });
      storybookGenerationPending = false;
      await refreshState();
      renderStorybookReviewModal(result, 'complete');
      showToast('Storybook recovered.', 'success');
      return result;
    } catch (error) {
      storybookGenerationPending = false;
      const currentProject = state?.activeProject?.id === retryProjectId ? state.activeProject : retryProject;
      renderStorybookReviewModal({ project: currentProject, parsed: phase1Preview }, 'workflow_failed', errorMessage(error));
      return;
    }
  }
  if (action === 'generate-character-sheet') {
    const projectId = target.dataset.projectId;
    const characterIndex = Number.parseInt(target.dataset.characterIndex, 10);
    target.disabled = true;
    target.textContent = 'Generating…';
    try {
      const updatedProject = await invoke(() => api.generateCharacterSheet(projectId, characterIndex), {
        successMessage: 'Character reference generated and saved with the storybook.'
      });
      if (storybookReviewState?.project?.id === projectId) {
        renderStorybookReviewModal({
          ...storybookReviewState,
          project: updatedProject
        }, storybookReviewState.phase, storybookReviewState.error);
      }
      return updatedProject;
    } catch {
      target.disabled = false;
      target.textContent = 'Generate';
      return;
    }
  }
  if (action === 'choose-prompt-method') return showProjectPromptStep();
  if (action === 'choose-analysis-method') return showProjectAnalysisInputStep();
  if (action === 'choose-agent-method') return showProjectAgentStep();
  if (action === 'agent-back') return showProjectMethodStep();
  if (action === 'run-agent') return runVersaAgent(target);
  if (action === 'back-to-methods') return showProjectMethodStep();
  if (action === 'back-to-analysis-input') return showProjectAnalysisInputStep();
  if (action === 'close-image-preview') return elements.imagePreviewDialog.close();
  if (action === 'previous-image-preview') return moveImagePreview(-1);
  if (action === 'next-image-preview') return moveImagePreview(1);
  if (action === 'toggle-character-prompt') {
    const card = target.closest('[data-character-card]');
    if (!card) return;
    const expanded = !card.classList.contains('is-prompt-expanded');
    card.classList.toggle('is-prompt-expanded', expanded);
    target.setAttribute('aria-expanded', String(expanded));
    target.textContent = expanded ? 'Hide Full Prompt' : 'Show Full Prompt';
    return;
  }
  if (action === 'copy-character-prompt') {
    const characterIndex = Number.parseInt(target.dataset.characterIndex, 10);
    const context = characterActionContext(target.dataset.projectId, characterIndex);
    if (!context?.character?.prompt) return;
    await navigator.clipboard.writeText(context.character.prompt);
    return showToast('Character prompt copied.', 'success');
  }
  if (action === 'preview-character') {
    const characterIndex = Number.parseInt(target.dataset.characterIndex, 10);
    const context = characterActionContext(target.dataset.projectId, characterIndex);
    if (!context?.sheet?.outputPath) return;
    const characterItems = context.project.characterSheets.map((sheet, index) => sheet.status === 'complete' && sheet.outputPath ? ({
      src: `tpt-image://character/${encodeURIComponent(context.project.id)}/${index}?v=${encodeURIComponent(context.project.updatedAt ?? '')}`,
      alt: `${context.project.highlights?.characters?.[index]?.name || `Character ${index + 1}`} character reference at full size`,
      title: `${context.project.highlights?.characters?.[index]?.name || `Character ${index + 1}`}`
    }) : null).filter(Boolean);
    showImagePreview(characterItems, characterItems.findIndex((item) => item.title.startsWith(`${context.character.name}`)));
    return;
  }
  if (action === 'toggle-page-prompt') {
    const details = target.closest('details');
    if (details) details.open = !details.open;
    return;
  }
  if (action === 'close-edit-dialog') return elements.editPageDialog.close();
  if (action === 'select-project') {
    selectedJobId = null;
    const picked = (state?.projects || []).find((item) => item.id === target.dataset.projectId);
    mazeWorkspaceOpen = picked?.productFormat === 'maze';
    activeWorkspaceView = mazeWorkspaceOpen ? 'maze' : 'overview';
    lastRenderedWorkspaceView = null;
    bundleViewActive = false; // exit bundle view when switching to a project
    document.body.dataset.studioPin = '';
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H62',location:'renderer/renderer.js:select-project',message:'library open chose workspace',data:{projectId:target.dataset.projectId||null,productFormat:picked?.productFormat||null,activeWorkspaceView},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return invoke(() => api.selectProject(target.dataset.projectId));
  }
  if (action === 'jump-generating-project') {
    const id = state?.queue?.activeProjectId;
    if (!id) return;
    selectedJobId = null;
    activeWorkspaceView = 'overview';
    lastRenderedWorkspaceView = null;
    bundleViewActive = false;
    return invoke(() => api.selectProject(id));
  }
  if (action === 'select-workspace-view') {
    const next = target.dataset.viewTarget === 'mockups' ? 'thumbnails' : (target.dataset.viewTarget || 'overview');
    const tab = document.querySelector(`#project-standard-view .workspace-tab[data-view-target="${next}"]`);
    if (tab && (tab.hidden || tab.hasAttribute('hidden') || tab.hasAttribute('inert'))) return;
    activeWorkspaceView = next;
    return renderProject();
  }
  if (action === 'reveal-project-folder') {
    if (project?.outputDir) api.revealPath(project.outputDir);
    return;
  }
  if (action === 'select-job') {
    selectedJobId = target.dataset.jobId;
    return renderProject();
  }
  if (action === 'zoom-job') {
    const job = project?.jobs.find((item) => item.id === jobId);
    if (!job?.outputPath) return;
    const items = jobPreviewItems(project);
    showImagePreview(items, items.findIndex((item) => item.src.includes(encodeURIComponent(job.id))));
    return;
  }
  if (action === 'edit-job') {
    const job = project?.jobs.find((item) => item.id === jobId);
    if (!job?.outputPath) return;
    editingJobId = job.id;
    elements.editPageTitle.textContent = `Edit page ${job.pageNumber}`;
    elements.editInstructionText.value = '';
    elements.editPageDialog.showModal();
    setTimeout(() => elements.editInstructionText.focus(), 50);
    return;
  }
  if (action === 'open-job') return invoke(() => api.openJobConversation(jobId), { refresh: false });
  if (action === 'import-job') return invoke(() => api.importPageImage(jobId), { successMessage: 'Image linked to this page.' });
  if (action === 'generate-job' || action === 'retry-job') return invoke(() => api.generateJob(jobId), { successMessage: 'Image generation queued.' });
  if (action === 'delete-job-image') {
    if (!window.confirm('Delete this page?')) return;
    return invoke(() => api.clearJobImage(jobId), { successMessage: 'Page image deleted.' });
  }
  if (action === 'regenerate-job') {
    return invoke(() => api.requestPageRegeneration(jobId), {
      successMessage: 'Regeneration queued in the saved conversation.'
    });
  }
  if (action === 'copy-prompt') {
    const job = selectedJob();
    if (!job) return;
    await navigator.clipboard.writeText(job.imagePrompt || job.prompt || '');
    return showToast('Prompt copied.', 'success');
  }
  if (action === 'start') {
    if (isGeneratingElsewhere(project)) {
      showToast(`"${displayProjectName(generatingProjectRecord()?.name || 'Another book')}" generating.`, 'info');
      return;
    }
    // Runs every stage in order. Individual stages still have their own buttons; this
    // one is the pipeline, which is what a Run control at the top of the book should be.
    const result = await invoke(() => api.startAutomation(project.id), { refresh: true });
    showToast('Pipeline started.', 'success');
    return result;
  }
  if (action === 'pause') {
    // Pause both: the pipeline must stop advancing, and whatever stage is mid-flight
    // must stop too, or the pipeline halts while a queue keeps generating behind it.
    const automation = state?.automation || {};
    if (automation.active && !automation.paused) await invoke(() => api.pauseAutomation());
    return invoke(() => api.pauseQueue(), { successMessage: 'Paused.' });
  }
  if (action === 'retry-all') return invoke(() => api.retryAll(project.id), { successMessage: 'Reset.' });
  if (action === 'regenerate-interior') {
    if (!project?.jobs?.length) return;
    const targets = project.jobs.filter((job) => job.status === 'complete' && job.conversationUrl);
    if (!targets.length) {
      showToast('No conversations.', 'warning');
      return;
    }
    if (!window.confirm(`Regenerate ${targets.length} page${targets.length === 1 ? '' : 's'}?`)) return;
    let queued = 0;
    for (const job of targets) {
      try {
        await api.requestPageRegeneration(job.id);
        queued += 1;
      } catch {
        /* continue queuing remaining pages */
      }
    }
    if (queued) {
      try {
        await api.startQueue(project.id);
      } catch {
        /* queue may already be running */
      }
    }
    await refreshState();
    showToast(queued ? `Regenerating ${queued}.` : 'Could not queue.', queued ? 'success' : 'warning');
    return renderProject();
  }
  if (action === 'open-versa-management') {
    if (!window.versaBookManagement?.openChannel) {
      return showToast('Restart the app.', 'warning');
    }
    return window.versaBookManagement.openChannel();
  }
  if (action === 'choose-output') return invoke(() => api.chooseOutputDirectory(project.id));
  if (action === 'launch-browser') return openAuthManager(activeEngine() === 'meta' ? 'meta' : 'gemini');
  if (action === 'focus-browser') {
    // Keep the managed browser parked. Login stays in Settings.
    return invoke(() => (typeof api.bringBrowserToFront === 'function'
      ? Promise.resolve({ background: true })
      : Promise.resolve({ background: true })), { refresh: false });
  }
  if (action === 'export-pdf') {
    const exportMode = elements.exportModeSelect?.value || 'STANDARD_SEQUENTIAL';
    const label = exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PDF created.' : 'PDF created.';
    const path = await invoke(() => api.exportPdf(project.id, { exportMode }), { successMessage: label });
    if (path) api.revealPath(path);
    return;
  }
    if (action === 'export-pptx') {
    const exportMode = elements.exportModeSelect?.value || 'STANDARD_SEQUENTIAL';
    const label = exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PPTX created.' : 'PPTX created.';
    const path = await invoke(() => api.exportPptx(project.id, { exportMode }), { successMessage: label });
    if (path) openItem(path);
    return;
  }
  if (action === 'export-zip') {
    const exportMode = elements.exportModeSelect?.value || 'STANDARD_SEQUENTIAL';
    const label = exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads ZIP created.' : 'ZIP created.';
    const path = await invoke(() => api.exportZip(project.id, { exportMode }), { successMessage: label });
    if (path) api.revealPath(path);
    return path;
  }
  if (action === 'export-all-files' || action === 'export-to-management') {
    const exportMode = elements.exportModeSelect?.value || 'STANDARD_SEQUENTIAL';
    if (!window.versaBookManagement?.pickAndExport) {
      showToast('Restart the app.', 'warning');
      return;
    }
    try {
      const path = await window.versaBookManagement.pickAndExport({
        project,
        exportMode,
        onSuccess: () => showToast('Exported.', 'success')
      });
      if (path) await refreshState();
      return path;
    } catch (error) {
      const message = errorMessage(error);
      if (error?.code === 'MANAGEMENT_UNAVAILABLE' || /Open Versa Management/i.test(message)) {
        showToast(message, 'error');
        return;
      }
      showToast(message, 'error');
      throw error;
    }
  }
  if (action === 'generate-tpt-thumbnails') {
    const reason = stageStartBlockReason('thumbnails', project);
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => api.generateTptThumbnails(project.id), { successMessage: 'Four mockups generated and saved.' });
  }
  if (action === 'clear-tpt-preview') {
    if (!project?.id) return;
    if (!window.confirm('Delete all previews?')) return;
    if (typeof api.clearTptPreview === 'function') {
      return invoke(() => api.clearTptPreview(project.id), { successMessage: 'Preview deleted.' });
    }
    if (typeof api.clearTptAsset !== 'function') return;
    return invoke(() => api.clearTptAsset(project.id, 'videoPreview'), { successMessage: 'Preview deleted.' });
  }
  if (action === 'generate-tpt-preview-video') {
    const reason = stageStartBlockReason('preview', project);
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    const force = Boolean(project.tptListing?.videoPreviewPath);
    return invoke(() => api.generateTptPreviewVideo(project.id, { force }), {
      successMessage: 'Preview video saved for teachers.'
    });
  }
  if (action === 'choose-tpt-asset') {
    return invoke(() => api.chooseTptAsset(project.id, target.dataset.tptAsset), { successMessage: 'Optional TPT asset saved locally.' });
  }
  if (action === 'clear-tpt-asset') {
    return invoke(() => api.clearTptAsset(project.id, target.dataset.tptAsset), { successMessage: 'Optional TPT asset removed from this listing record.' });
  }
  if (action === 'mark-tpt-ready') {
    if (!window.confirm('Mark ready?')) return;
    return invoke(() => api.markTptReady(project.id), { successMessage: 'Project marked ready to upload.' });
  }
  if (action === 'preview-tpt-thumbnail') {
    const index = Number.parseInt(target.dataset.thumbnailIndex, 10);
    const items = thumbnailPreviewItems(project);
    showImagePreview(items, items.findIndex((item) => item.title === `TPT Mockup ${index + 1}`));
    return;
  }
  if (action === 'regenerate-tpt-thumbnail') return invoke(() => api.regenerateTptThumbnail(project.id, Number.parseInt(target.dataset.thumbnailIndex, 10)), { successMessage: 'Mockup regeneration started.' });
  if (action === 'open-tpt-upload') {
    return invoke(() => api.openTptUpload(), { successMessage: 'TPT upload page opened. Review the draft before uploading.' }, { refresh: false });
  }
  if (action === 'open-saved-tpt-listing') {
    const listingUrl = project.tptListing?.uploadUrl;
    if (!listingUrl) throw new Error('No verified TPT listing link is saved for this product.');
    return invoke(() => api.openSavedTptListing(listingUrl), { successMessage: 'Saved TPT listing opened.' }, { refresh: false });
  }
  if (action === 'start-tpt-uploading') {
    target.disabled = true;
    target.textContent = 'Opening TPT upload…';
    try {
      return await invoke(() => api.startTptUploading(project.id), { successMessage: projectMarketplace(project).settings.publicationStatus === 'active'
        ? 'TPT upload workspace opened and the reviewed active-listing workflow started.'
        : 'TPT inactive draft submitted and verified automatically.' });
    } catch (error) {
      target.disabled = false;
      target.textContent = tptListingReviewApproved(project.tptListing) ? 'Resume uploading' : 'Start uploading';
      throw error;
    }
  }
  if (action === 'submit-tpt-listing') {
    const listing = project.tptListing || {};
    const imageCount = listing.thumbnailMode === 'manual' ? (listing.thumbnailPaths || []).filter(Boolean).length : 0;
    const statusLabel = projectMarketplace(project).settings.publicationStatus === 'active' ? 'Active' : 'Draft';
    const confirmation = `Submit “${listing.title || project.name}” as ${statusLabel}?`;
    if (!window.confirm(confirmation)) return;
    return invoke(() => api.submitTptListing(project.id), { successMessage: `TPT ${projectMarketplace(project).settings.publicationStatus === 'active' ? 'active listing' : 'draft'} submitted and verified.` });
  }
  if (action === 'submit-tpt-draft') {
    if (!window.confirm('Submit draft?')) return;
    return invoke(() => api.submitTptDraft(project.id), { successMessage: 'TPT draft submitted and kept inactive.' });
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  handleAction(target.dataset.action, target).catch(() => {});
});

document.addEventListener('new-project', openProjectDialog);
elements.launchBrowserButton.addEventListener('click', () => handleAction('launch-browser', elements.launchBrowserButton).catch(() => {}));
elements.focusBrowserButton.addEventListener('click', () => handleAction('focus-browser', elements.focusBrowserButton).catch(() => {}));
elements.runButton.addEventListener('click', () => handleAction('start', elements.runButton).catch(() => {}));
elements.pauseButton.addEventListener('click', () => handleAction('pause', elements.pauseButton).catch(() => {}));
if (elements.livePauseButton) {
  elements.livePauseButton.addEventListener('click', () => handleAction('pause', elements.livePauseButton).catch(() => {}));
}
if (elements.studioStagePause) {
  elements.studioStagePause.addEventListener('click', () => handleAction('pause', elements.studioStagePause).catch(() => {}));
}
if (elements.studioBannerPause) {
  elements.studioBannerPause.addEventListener('click', () => handleAction('pause', elements.studioBannerPause).catch(() => {}));
}

(() => {
  const stage = document.getElementById('workspace-stage');
  if (!stage) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let lastSwipeAt = 0;
  const interactive = (node) => node.closest?.('input, textarea, select, [contenteditable="true"]');
  const swipeBlocked = (node) => activeWorkspaceView === 'interior_text'
    || Boolean(node?.closest?.('#text-page-deck, [data-workspace-pane="interior_text"]'));
  const swipe = (delta) => {
    if (activeWorkspaceView === 'interior_text') return;
    const now = Date.now();
    if (now - lastSwipeAt < 380) return;
    lastSwipeAt = now;
    shiftWorkspacePane(delta);
  };
  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (interactive(event.target) || swipeBlocked(event.target)) return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
  });
  stage.addEventListener('pointerup', (event) => {
    if (!tracking) return;
    tracking = false;
    if (swipeBlocked(event.target)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy)) return;
    swipe(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { tracking = false; });
  stage.addEventListener('wheel', (event) => {
    if (interactive(event.target) || swipeBlocked(event.target)) return;
    if (Math.abs(event.deltaX) < 50 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
    event.preventDefault();
    swipe(event.deltaX > 0 ? 1 : -1);
  }, { passive: false });
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      syncWorkspaceStageHeight();
      layoutPipelineRail();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (interactive(event.target) || swipeBlocked(event.target)) return;
    if (document.querySelector('dialog[open]')) return;
    if (elements.projectWorkspace?.hidden) return;
    event.preventDefault();
    shiftWorkspacePane(event.key === 'ArrowRight' ? 1 : -1);
  });
})();

elements.retryAllButton.addEventListener('click', () => handleAction('retry-all', elements.retryAllButton).catch(() => {}));
elements.outputFolderButton.addEventListener('click', () => handleAction('choose-output', elements.outputFolderButton).catch(() => {}));
elements.copyPromptButton.addEventListener('click', () => handleAction('copy-prompt', elements.copyPromptButton).catch(() => {}));
elements.importImageButton.addEventListener('click', () => handleAction('import-job', elements.importImageButton).catch(() => {}));
elements.openConversationButton.addEventListener('click', () => handleAction('open-job', elements.openConversationButton).catch(() => {}));
elements.retryJobButton.addEventListener('click', () => {
  const action = 'generate-job';
  handleAction(action, elements.retryJobButton).catch(() => {});
});
elements.exportPdfButton.addEventListener('click', () => handleAction('export-pdf', elements.exportPdfButton).catch(() => {}));
elements.exportZipButton.addEventListener('click', () => handleAction('export-zip', elements.exportZipButton).catch(() => {}));
elements.exportPptxButton.addEventListener('click', () => handleAction('export-pptx', elements.exportPptxButton).catch(() => {}));
elements.exportAllFilesButton.addEventListener('click', () => handleAction('export-all-files', elements.exportAllFilesButton).catch(() => {}));
elements.exportToManagementButton?.addEventListener('click', () => handleAction('export-to-management', elements.exportToManagementButton).catch(() => {}));


document.addEventListener('generate-tpt-preview-video', () => handleAction('generate-tpt-preview-video', elements.generateTptPreviewVideoButton).catch(() => {}));

document.addEventListener('open-tpt-upload', () => handleAction('open-tpt-upload', elements.openTptUploadButton).catch(() => {}));

// Bundle upload sidebar toggle – custom event to toggle view

document.addEventListener('toggle-bundle-sidebar', () => {
  bundleViewActive = !bundleViewActive;
  if (bundleViewActive) {
    state = { ...state, selectedProjectId: null };
  }
  render();
});

elements.adjustCropButton.addEventListener('click', openCropDialog);
elements.cropZoomSlider.addEventListener('input', updateCropPreview);
elements.cropPanXSlider.addEventListener('input', updateCropPreview);
elements.cropPanYSlider.addEventListener('input', updateCropPreview);
elements.cropSaveBtn.addEventListener('click', saveCropAdjustment);

document.querySelectorAll('[data-action="close-crop-dialog"]').forEach((btn) => {
  btn.addEventListener('click', () => elements.cropDialog.close());
});

// Bundle Upload Queue sidebar + actions
if (elements.bundleUploadSidebarBtn) {
  elements.bundleUploadSidebarBtn.addEventListener('click', () => {
    bundleViewActive = !bundleViewActive;
    if (bundleViewActive) {
      // Deselect active project to show only the bundle view
      state = { ...state, selectedProjectId: null };
    }
    render();
  });
}
if (elements.startBundleBtn) {
  elements.startBundleBtn.addEventListener('click', async () => {
    try {
      elements.startBundleBtn.disabled = true;
      await api.startBundleUpload();
      await refreshState();
    } catch (error) {
      showToast(errorMessage(error), 'error');
      elements.startBundleBtn.disabled = false;
    }
  });
}
if (elements.stopBundleBtn) {
  elements.stopBundleBtn.addEventListener('click', async () => {
    try {
      await api.stopBundleUpload();
      await refreshState();
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  });
}
elements.imagePreviewDialog.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    moveImagePreview(-1);
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    moveImagePreview(1);
  }
});
elements.bulkPromptsText.addEventListener('input', renderBulkPromptCount);
elements.promptSplitMode.addEventListener('change', renderBulkPromptCount);
elements.projectOrientation.addEventListener('change', renderPageOutputSpec);
elements.pageFormat.addEventListener('change', renderPageOutputSpec);
elements.uploadPromptsButton.addEventListener('click', () => {
  elements.promptFileInput.value = '';
  elements.promptFileInput.click();
});
elements.clearPromptsButton.addEventListener('click', () => {
  elements.bulkPromptsText.value = '';
  renderBulkPromptCount();
  elements.bulkPromptsText.focus();
});
elements.promptFileInput.addEventListener('change', async () => {
  const [file] = elements.promptFileInput.files ?? [];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('File too large.', 'error');
    return;
  }
  try {
    elements.bulkPromptsText.value = await file.text();
    const count = renderBulkPromptCount();
    showToast(`Loaded ${count} ${count === 1 ? 'prompt' : 'prompts'}.`, 'success');
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
});

elements.analysisTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-analysis-mode]');
  if (!button) return;
  setAnalysisMode(button.dataset.analysisMode);
});

elements.startAnalysisButton.addEventListener('click', async () => {
  if (state?.app?.loginRequired) {
    showToast('Connect Gemini.', 'error');
    openAuthManager();
    return;
  }

  if (currentAnalysisMode === 'story') {
    const storyIdea = elements.storyIdea ? elements.storyIdea.value.trim() : '';
    const storyPageCountVal = elements.storyPageCount ? Number.parseInt(elements.storyPageCount.value, 10) : 10;
    const storyAgeRange = elements.storyAgeRange ? elements.storyAgeRange.value.trim() : '';
    const storyLanguage = elements.storyLanguage ? elements.storyLanguage.value.trim() : '';

    if (!storyIdea) {
      showToast('Enter an idea.', 'error');
      elements.storyIdea?.focus();
      return;
    }
    if (!storyPageCountVal || storyPageCountVal < 1 || storyPageCountVal > 100) {
      showToast('Enter page count.', 'error');
      elements.storyPageCount?.focus();
      return;
    }
    if (!storyAgeRange) {
      showToast('Enter age.', 'error');
      elements.storyAgeRange?.focus();
      return;
    }
    if (!storyLanguage) {
      showToast('Enter language.', 'error');
      elements.storyLanguage?.focus();
      return;
    }

    const checkedFormatRadio = elements.projectDialog?.querySelector('input[name="analysisPageFormat"]:checked');
    const format = checkedFormatRadio?.value || elements.analysisPageFormat?.value || 'LETTER';
    const orientation = elements.analysisProjectOrientation.value || 'portrait';
    const payload = {
      storyIdea,
      storyBody: elements.storyBody ? elements.storyBody.value.trim() : '',
      pageCount: storyPageCountVal,
      ageRange: storyAgeRange,
      language: storyLanguage,
      moralLesson: elements.storyMoralLesson ? elements.storyMoralLesson.value.trim() : '',
      attachmentPath: storySelectedPhotoPath,
      hasPhoto: Boolean(storySelectedPhotoPath),
      format,
      orientation
    };

    if (elements.analysisErrorBox) {
      elements.analysisErrorBox.hidden = true;
      elements.analysisErrorBox.textContent = '';
    }

    showProjectAnalysisLoadingStep();
    if (elements.projectDialogTitle) {
      elements.projectDialogTitle.textContent = 'Building…';
    }

    storybookGenerationPending = true;
    storybookReviewState = null;
    try {
      const result = await invoke(() => api.generateStorybook(payload), { refresh: false });
      storybookGenerationPending = false;
      storySelectedPhotoPath = null;
      if (elements.storyCharacterPhoto) elements.storyCharacterPhoto.value = '';
      if (elements.storyUploadFilename) elements.storyUploadFilename.textContent = 'No photo';
      if (elements.storyClearUploadBtn) elements.storyClearUploadBtn.classList.add('hidden');
      await refreshState();
      if (elements.projectDialog.open) {
        renderStorybookReviewModal(result, 'complete');
      } else if (result.project?.id) {
        await api.selectProject(result.project.id);
      }
      showToast('Storybook saved.', 'success');
    } catch (error) {
      storybookGenerationPending = false;
      if (storybookReviewState?.project) {
        renderStorybookReviewModal(storybookReviewState, 'workflow_failed', errorMessage(error));
      } else {
        if (elements.analysisErrorBox) {
          elements.analysisErrorBox.hidden = false;
          elements.analysisErrorBox.textContent = errorMessage(error);
        }
        showProjectAnalysisInputStep();
      }
    }
    return;
  }

  const isUrl = currentAnalysisMode === 'url';
  const productUrl = elements.analysisProductUrl ? elements.analysisProductUrl.value.trim() : '';
  const ideaText = elements.analysisBuilderIdea ? elements.analysisBuilderIdea.value.trim() : '';

  if (isUrl && !productUrl) {
    showToast('Enter a URL.', 'error');
    elements.analysisProductUrl.focus();
    return;
  }
  if (!isUrl && !ideaText) {
    showToast('Enter an idea.', 'error');
    elements.analysisBuilderIdea?.focus();
    return;
  }

  // Close any open pickers
  closeInfoPicker();
  closeTextPicker();

  const payload = isUrl
    ? {
      sourceMode: 'url', productUrl, keyword: '', tptNiche: '', activityType: '', metadataText: '', title: '', niche: '',
      ...(runningOnWindows() ? {
        format: elements.analysisUrlPageFormat?.value || 'LETTER',
        orientation: elements.analysisUrlPageOrientation?.value || 'portrait'
      } : {})
    }
    : getBuilderPayload();

  if (elements.analysisErrorBox) {
    elements.analysisErrorBox.hidden = true;
    elements.analysisErrorBox.textContent = '';
  }
  showProjectAnalysisLoadingStep(isUrl);
  try {
    const result = await invoke(() => api.analyzeProduct(payload), { refresh: false });
    renderAnalysisResult(result, isUrl);
  } catch (error) {
    if (elements.analysisErrorBox) {
      elements.analysisErrorBox.hidden = false;
      elements.analysisErrorBox.textContent = errorMessage(error);
    }
    showProjectAnalysisInputStep();
  }
});

// ── Page size card picker: sync radio → hidden select + highlight ──────────
const pageSizeCardsContainer = document.getElementById('page-size-cards');
if (pageSizeCardsContainer) {
  pageSizeCardsContainer.addEventListener('change', (e) => {
    const radio = e.target.closest('input[type="radio"][name="analysisPageFormat"]');
    if (!radio) return;
    // update is-selected on all cards
    pageSizeCardsContainer.querySelectorAll('.page-size-card').forEach((card) => {
      card.classList.toggle('is-selected', card.contains(radio));
    });
    // mirror to hidden select so payload code reads correct value
    if (elements.analysisPageFormat) elements.analysisPageFormat.value = radio.value;
    if (runningOnWindows()) {
      syncAnalysisPageSetup(radio.value, elements.analysisProjectOrientation?.value || 'portrait');
    }
  });
}

elements.analysisUrlPageFormat?.addEventListener('change', () => {
  syncAnalysisPageSetup(
    elements.analysisUrlPageFormat.value,
    elements.analysisUrlPageOrientation?.value || 'portrait'
  );
});

elements.analysisUrlPageOrientation?.addEventListener('change', () => {
  syncAnalysisPageSetup(
    elements.analysisUrlPageFormat?.value || 'LETTER',
    elements.analysisUrlPageOrientation.value
  );
});

elements.analysisProjectOrientation?.addEventListener('change', () => {
  if (runningOnWindows()) {
    syncAnalysisPageSetup(
      elements.analysisPageFormat?.value || 'LETTER',
      elements.analysisProjectOrientation.value
    );
  }
});

elements.generatePromptsButton.addEventListener('click', async () => {
  if (!analysisResult?.conversationUrl) {
    showToast('No analysis.', 'error');
    showProjectAnalysisInputStep();
    return;
  }
  const choice = elements.projectDialog.querySelector('input[name="pageCountChoice"]:checked')?.value;
  const customInput = Number.parseInt(elements.resultCustomCountInput.value, 10);
  const pageCount = choice === 'custom'
    ? (Number.isFinite(customInput) && customInput > 0 ? customInput : 20)
    : (analysisResult.analysis?.pageCount || 20);

  // read from card radios first, fallback to hidden select
  const checkedFormatRadio = elements.projectDialog?.querySelector('input[name="analysisPageFormat"]:checked');
  const format = checkedFormatRadio?.value || elements.analysisPageFormat?.value || 'LETTER';

    const includeCompetitorMockups = Boolean(elements.resultIncludeMockups?.checked);
  const mockupCount = includeCompetitorMockups
    ? (analysisResult?.competitorMockups?.images?.length || analysisResult?.project?.competitorMockups?.images?.length || 0)
    : 0;
  
  const selectedPipeline = elements.projectDialog.querySelector('input[name="analysisPipelineChoice"]:checked')?.value || 'static';
  if (selectedPipeline === 'maze' || analysisResult?.project?.productFormat === 'maze') {
    await generateMazeFromMarketplace(analysisResult.project);
    return;
  }

  const payload = {
    projectId: analysisResult?.project?.id,
    conversationUrl: analysisResult.conversationUrl,
    pageCount,
    format,
    orientation: elements.analysisProjectOrientation.value,
    name: analysisResult.analysis?.title,
    theme: analysisResult.analysis?.title,
    niche: analysisResult.analysis?.description,
    includeCompetitorMockups,
    productFormat: selectedPipeline
  };

  showProjectPromptsLoadingStep(pageCount, mockupCount);
  try {
    const project = await invoke(() => api.generatePromptsAndCreateProject(payload), {
      successMessage: `Created book project with ${pageCount} generated page prompts!`
    });
    elements.projectDialog.close();
    if (project?.id) {
      await api.selectProject(project.id);
    }
    finishMarketSession('lab', `${pageCount} pages ready.`);
  } catch (error) {
    failMarketSession(errorMessage(error));
    showProjectAnalysisResultStep();
  }
});

if (elements.conceptGeneratePromptsBtn) {
  elements.conceptGeneratePromptsBtn.addEventListener('click', async () => {
    const project = activeProject();
    if (!project) return;
    if (project.productFormat === 'maze') {
      await generateMazeFromMarketplace(project);
      return;
    }
    if (state?.app?.loginRequired) {
      showToast('Connect Gemini.', 'error');
      openAuthManager();
      return;
    }
    const pageCount = Number.parseInt(elements.conceptGeneratePageCount.value, 10) || 20;
    const format = elements.conceptPageFormat.value || 'LETTER';
    const orientation = elements.conceptProjectOrientation.value || 'portrait';

    const mockupCount = Array.isArray(project.competitorMockups?.images) ? project.competitorMockups.images.length : 0;
    const payload = {
      projectId: project.id,
      conversationUrl: project.conversationUrl,
      pageCount,
      format,
      orientation,
      includeCompetitorMockups: mockupCount > 0
    };

    const generateBtn = elements.conceptGeneratePromptsBtn;
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating…';
    }
    setMarketLocalStage('prompts', `Generating ${pageCount}…`);

    try {
      const updatedProject = await invoke(() => api.generatePromptsAndCreateProject(payload), {
        successMessage: `Generated ${pageCount} page prompts for this project!`
      });
      if (updatedProject?.id) {
        await api.selectProject(updatedProject.id);
      }
      finishMarketSession('lab', `${pageCount} pages ready.`);
    } catch (error) {
      failMarketSession(errorMessage(error));
      showToast(errorMessage(error), 'error');
    } finally {
      if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate prompts';
      }
    }
  });
}

elements.filterTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  currentFilter = button.dataset.filter;
  elements.filterTabs.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
  if (activeProject()) renderJobs(activeProject());
});

elements.jobsTable?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('[data-action="select-job"]');
  if (!card || event.target !== card) return;
  event.preventDefault();
  card.click();
});

if (elements.storyUploadBtn) {
  elements.storyUploadBtn.addEventListener('click', () => {
    elements.storyCharacterPhoto.click();
  });
}

if (elements.storyCharacterPhoto) {
  elements.storyCharacterPhoto.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      storySelectedPhotoPath = file.path;
      elements.storyUploadFilename.textContent = file.name;
      elements.storyClearUploadBtn.classList.remove('hidden');
    }
  });
}

if (elements.storyClearUploadBtn) {
  elements.storyClearUploadBtn.addEventListener('click', () => {
    storySelectedPhotoPath = null;
    elements.storyCharacterPhoto.value = '';
    elements.storyUploadFilename.textContent = 'No photo';
    elements.storyClearUploadBtn.classList.add('hidden');
  });
}

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.settingsSaveButton.disabled = true;
  elements.settingsSaveButton.textContent = 'Saving…';
  try {
    await invoke(() => api.updateSettings(collectSettingsForm()), {
      successMessage: 'Profile and default settings saved.'
    });
    await populateSettingsForm();
    elements.settingsSaveNote.textContent = 'Saved.';
  } catch (error) {
    elements.settingsSaveNote.textContent = errorMessage(error);
  } finally {
    elements.settingsSaveButton.disabled = false;
    elements.settingsSaveButton.textContent = 'Save settings';
  }
});

elements.settingsDialog.addEventListener('cancel', () => {
  if (elements.settingsSaveNote) elements.settingsSaveNote.textContent = '';
});

elements.settingsChatgptProfileSelect.addEventListener('change', async () => {
  const val = elements.settingsChatgptProfileSelect.value;
  let selectedProfile = null;
  if (val) {
    const [browser, profileKey] = val.split('/');
    selectedProfile = { browser, profileKey };
  }
  await invoke(() => api.setSelectedProfile(selectedProfile));
  renderSelectedProfileSessions(lastSystemProfiles);
});

// New Book pipeline choice (Static vs Editable) -> sets hidden productFormat input.
document.querySelectorAll('[data-pipeline-choice]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const choice = btn.getAttribute('data-pipeline-choice');
    const pipeline = choice === 'editable' || choice === 'maze' ? choice : 'static';
    const hidden = document.getElementById('project-pipeline-input');
    if (hidden) hidden.value = pipeline;
    document.querySelectorAll('[data-pipeline-choice]').forEach((b) => b.classList.toggle('method-card-active', b === btn));
    
    const analysisRadios = document.querySelectorAll('input[name="analysisPipelineChoice"]');
    analysisRadios.forEach((r) => {
      r.checked = (r.value === pipeline);
    });
  });
});

elements.projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.projectForm);
  const payload = Object.fromEntries(formData.entries());
  payload.sourceMode = 'bulk';
  if (renderBulkPromptCount() === 0) {
    showToast('Paste a prompt.', 'error');
    elements.bulkPromptsText.focus();
    return;
  }
  try {
    await invoke(() => api.createProject(payload), {
      successMessage: `Created an ordered ${bulkPromptCount()}-page book project.`
    });
    storySelectedPhotoPath = null;
    if (elements.storyCharacterPhoto) elements.storyCharacterPhoto.value = '';
    if (elements.storyUploadFilename) elements.storyUploadFilename.textContent = 'No photo';
    if (elements.storyClearUploadBtn) elements.storyClearUploadBtn.classList.add('hidden');
    elements.projectDialog.close();
  } catch {}
});

elements.editPageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const instruction = elements.editInstructionText.value.trim();
  if (!editingJobId || !instruction) return;
  try {
    await invoke(() => api.requestPageEdit(editingJobId, instruction), {
      successMessage: 'Page edit queued in its saved conversation.'
    });
    elements.editPageDialog.close();
    editingJobId = null;
  } catch {}
});

elements.authOpenButton.addEventListener('click', async () => {
  const chatgpt = authTarget === 'chatgpt';
  const meta = authTarget === 'meta';
  const geminiReady = Boolean(state?.integrations?.gemini?.connected);
  elements.authStatusText.textContent = chatgpt
      ? 'Opening ChatGPT…'
      : (meta
        ? 'Opening Meta AI…'
        : (geminiReady
          ? 'Opening…'
          : 'Opening Gemini…'));
  try {
    const result = await invoke(() => openLoginSession({ target: authTarget }), { refresh: false });
    elements.authStatusText.textContent = chatgpt
      ? 'Sign in, then Verify.'
      : (meta
        ? 'Sign in, then Verify.'
        : 'Sign in, then Verify.');
  } catch (error) {
    elements.authStatusText.textContent = errorMessage(error);
  }
});

elements.authVerifyButton.addEventListener('click', async () => {
  const chatgpt = authTarget === 'chatgpt';
  const meta = authTarget === 'meta';
  elements.authStatusText.textContent = chatgpt
    ? 'Checking ChatGPT…'
    : (meta ? 'Checking Meta AI…' : 'Checking Gemini…');
  elements.authVerifyButton.disabled = true;
  try {
    const result = await invoke(() => verifyLoginSession({ target: authTarget }));
    elements.authStatusText.textContent = result?.authenticated
      ? (chatgpt ? 'ChatGPT connected.' : (meta ? 'Meta AI connected.' : 'Gemini connected.'))
      : (chatgpt ? 'Not verified.' : (meta ? 'Not verified.' : 'Not verified.'));
    if (result?.authenticated) {
      authManagerOpenedManually = false;
      if (elements.authDialog.open) elements.authDialog.close();
    }
  } catch (error) {
    elements.authStatusText.textContent = errorMessage(error);
  } finally {
    elements.authVerifyButton.disabled = false;
  }
});

elements.authCloseButton.addEventListener('click', () => {
  const blockDismiss = Boolean(state?.app?.loginRequired) && authTarget === 'gemini';
  if (!blockDismiss && elements.authDialog.open) {
    authManagerOpenedManually = false;
    elements.authDialog.close();
  }
});

elements.authDialog.addEventListener('cancel', (event) => {
  const blockDismiss = Boolean(state?.app?.loginRequired) && authTarget === 'gemini';
  if (blockDismiss) event.preventDefault();
  else authManagerOpenedManually = false;
});

if (typeof api.onStorybookPhase1 === 'function') {
  api.onStorybookPhase1((payload) => {
    const tracksOpenWorkflow = storybookGenerationPending
      || storybookReviewState?.project?.id === payload?.project?.id;
    if (!tracksOpenWorkflow || !elements.projectDialog.open) return;
    renderStorybookReviewModal(payload, payload.phase || 'blueprint_complete', payload.error || null);
  });
}

function isAppearanceOnlyStateChange(prev, next) {
  if (!prev || !next) return false;
  const prevResolved = prev.app?.appearance?.resolved;
  const nextResolved = next.app?.appearance?.resolved;
  const prevPref = prev.app?.appearance?.preference;
  const nextPref = next.app?.appearance?.preference;
  if (prevResolved === nextResolved && prevPref === nextPref) return false;
  return prev.selectedProjectId === next.selectedProjectId
    && prev.activeProject?.id === next.activeProject?.id
    && prev.activeProject?.updatedAt === next.activeProject?.updatedAt
    && Boolean(prev.queue?.running) === Boolean(next.queue?.running)
    && prev.queue?.activeJobId === next.queue?.activeJobId
    && (prev.projects || []).length === (next.projects || []).length;
}

let lastUiRenderKey = '';
let automationProgressLogTick = 0;

function structuralUiKey(next) {
  const project = next?.activeProject;
  const jobIds = (project?.jobs || []).map((job) => job.id).join(',');
  return [
    next?.selectedProjectId || '',
    project?.id || '',
    jobIds,
    next?.queue?.running ? 1 : 0
  ].join('/');
}

api.onStateChanged((nextState) => {
  if (isAppearanceOnlyStateChange(state, nextState)) {
    state = nextState;
    applyAppearanceUi();
    return;
  }
  const nextKey = structuralUiKey(nextState);
  const hadLayout = Boolean(lastUiRenderKey);
  const layoutChanged = nextKey !== lastUiRenderKey;
  state = nextState;
  if (!hadLayout || layoutChanged) {
    lastUiRenderKey = nextKey;
    render();
    return;
  }
  const project = activeProject();
  if (project) {
    renderJobs(project);
    applyLiveStats(project);
    renderInteriorTextDeck(project, activeLiveOperation(project));
  }
  renderAutomationBar();
  syncMarketRailFromState(nextState);
});

if (typeof api.onQueueLog === 'function') {
  api.onQueueLog((event) => {
    if (!event || !state) return;
    const events = Array.isArray(state.events) ? state.events : [];
    state = { ...state, events: [event, ...events].slice(0, 80) };
    const project = activeProject();
    if (project) renderEvents(project);
  });
}

if (typeof api.onLoginProgress === 'function') {
  api.onLoginProgress(({ message }) => {
    if (message && elements.authDialog.open) elements.authStatusText.textContent = message;
    if (message && elements.settingsDialog.open) elements.settingsChatgptStatus.textContent = message;
  });
}

// Activity fill is observer-backed: generating true/false comes from the browser
// controller heartbeat, not a guessed timer. The fill height still eases on elapsed
// time because the model does not report a percentage.
function updateLiveImageFill() {
  const project=activeProject();
  if (!project || !isGeneratingThisProject(project) || state?.queue?.pauseRequested) return;
  const cards = [
    ...(elements.jobsTable?.querySelectorAll('.page-preview-card') || []),
    ...(elements.pagesStage?.querySelectorAll('.page-preview-card') || [])
  ];
  for (const card of cards) {
    const activity=generationActivity.get(card.dataset.jobId);
    if (!activity) continue;
    const generating = activity.generating === false
      ? false
      : (activity.generating === true || activity.phase === 'generating');
    const visual=card.querySelector('.page-visual');
    if (!generating) {
      card.classList.remove('is-live');
      card.removeAttribute('aria-busy');
      if (activity.phase === 'image_ready') visual?.style.setProperty('--page-fill', '96%');
      const label=card.querySelector('.page-placeholder span');
      if (label) label.textContent = activity.phase === 'failed' ? 'Needs attention' : activity.phase === 'image_ready' ? 'Almost there' : 'Ready';
      const dot = card.querySelector('.page-state-dot');
      if (dot?.dataset) {
        dot.dataset.state = activity.phase === 'failed' ? 'needs_user_action' : activity.phase === 'image_ready' ? 'validating' : 'complete';
        dot.title = label?.textContent || '';
      }
      continue;
    }
    const elapsed=Math.max(0,(activity.elapsedMs || 0) + Math.min(2000,Date.now()-(activity.receivedAt || Date.now())));
    const fill=`${Math.min(92,20+65*(1-Math.exp(-elapsed/90000)))}%`;
    card.classList.add('is-live');
    card.setAttribute('aria-busy','true');
    visual?.style.setProperty('--page-fill', fill);
    const label=card.querySelector('.page-placeholder span');
    if (label) label.textContent = activity.phase || 'Processing';
    const caption = card.querySelector('.pages-hero__caption span');
    if (caption && caption !== label) caption.textContent = 'Processing';
    const dot = card.querySelector('.page-state-dot');
    if (dot?.dataset) {
      dot.dataset.state = 'live';
      dot.title = 'Processing';
    }
  }
}

api.onHeartbeat(({ elapsedMs = 0, jobId, projectId, phase, remainingMs, pageNumber: heartbeatPageNumber, generating }) => {
  if (projectId && projectId !== activeProject()?.id) return;
  if (jobId) {
    const prev = generationActivity.get(jobId) || {};
    generationActivity.set(jobId, {
      elapsedMs,
      phase: phase || prev.phase,
      receivedAt: Date.now(),
      generating: typeof generating === 'boolean' ? generating : prev.generating
    });
  }
  updateLiveImageFill();
  lastHeartbeatAt = Date.now();
  if (phase === 'preparing_next') {
    const pageNumber = heartbeatPageNumber
      ?? activeProject()?.jobs.find((job) => job.id === jobId)?.pageNumber;
    elements.heartbeatText.textContent = `Preparing page ${pageNumber ?? ''}`;
    return;
  }
  if (phase === 'conversation_refresh') {
    const pageNumber = activeProject()?.jobs.find((job) => job.id === jobId)?.pageNumber;
    elements.heartbeatText.textContent = pageNumber ? `Refreshing page ${pageNumber}` : 'Refreshing';
    return;
  }
  if (phase === 'request_check') {
    elements.heartbeatText.textContent = 'Checking…';
    return;
  }
  if (phase === 'request_cooldown' || phase === 'submission_pacing') {
    const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    const pageNumber = activeProject()?.jobs.find((job) => job.id === jobId)?.pageNumber;
    elements.heartbeatText.textContent = phase === 'request_cooldown'
      ? `Gemini safety cooldown • resumes automatically in ${minutes}:${seconds}`
      : `Safe sending pace${pageNumber ? ` • page ${pageNumber}` : ''} submits in ${minutes}:${seconds}`;
    return;
  }
  const elapsedSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, '0');
  const pageNumber = activeProject()?.jobs.find((job) => job.id === jobId)?.pageNumber;
  const activeCount = state?.queue?.activeJobIds?.length ?? 1;
  elements.heartbeatText.textContent = `${activeCount} background ${activeCount === 1 ? 'job' : 'jobs'}${pageNumber ? ` • page ${pageNumber}` : ''}… ${minutes}:${seconds}`;
});

function updateLiveTextFill() {
  const deck = elements.textPageDeck;
  if (!deck) return;
  const project = activeProject();
  if (!project) return;
  const pages = textLabDeckPages(project);
  for (const card of deck.querySelectorAll('.page-preview-card[data-job-id]')) {
    const page = pages.find((entry) => entry.jobId === card.dataset.jobId);
    if (!page) continue;
    patchTextLabCard(card, page, { running: lastTextLabBeat?.generating || state?.liveOperation?.kind === 'editable-text' });
  }
}

if (typeof api.onTextLabHeartbeat === 'function') {
  api.onTextLabHeartbeat((snap) => {
    if (!snap) return;
    lastTextLabBeat = snap;
    if (snap.jobId) {
      textLabActivity.set(snap.jobId, {
        ...snap,
        receivedAt: Date.now()
      });
    }
    if (snap.generating === false) {
      textLabActivity.forEach((value, key) => {
        textLabActivity.set(key, { ...value, generating: false, phase: 'done' });
      });
    }
    const project = activeProject();
    if (project) {
      if (elements.editableTextStatus && snap.message) elements.editableTextStatus.textContent = snap.message;
      if (elements.textLabEta) {
        elements.textLabEta.hidden = !snap.generating;
        elements.textLabEta.textContent = snap.generating ? `Rebuild ${snap.etaLabel}` : '';
      }
      if (elements.heartbeatText && snap.message) elements.heartbeatText.textContent = snap.message;
      updateLiveTextFill();
    }
  });
}

setInterval(() => {
  updateLiveImageFill();
  updateLiveTextFill();
  if (state?.queue?.running && lastHeartbeatAt && Date.now() - lastHeartbeatAt > 15_000) {
    elements.heartbeatText.textContent = 'Engine waiting.';
  }
}, 1_000);

// Renaming & Deletion Actions
// Renaming & Deletion Actions
function renameActiveProject() {
  const project = activeProject();
  if (!project) return;
  elements.renameProjectInput.value = project.name;
  elements.renameProjectDialog.showModal();
  setTimeout(() => elements.renameProjectInput.focus(), 50);
}

if (elements.closeRenameDialogBtn) {
  elements.closeRenameDialogBtn.addEventListener('click', () => elements.renameProjectDialog.close());
}
if (elements.cancelRenameBtn) {
  elements.cancelRenameBtn.addEventListener('click', () => elements.renameProjectDialog.close());
}
if (elements.renameProjectForm) {
  elements.renameProjectForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const project = activeProject();
    if (!project) return;
    const trimmed = elements.renameProjectInput.value.trim();
    if (!trimmed) {
      showToast('Enter a name.', 'error');
      return;
    }
    try {
      await api.renameProject(project.id, trimmed);
      await refreshState();
      elements.renameProjectDialog.close();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

async function deleteProjectById(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const project = (state?.projects || []).find((item) => item.id === id)
    || (activeProject()?.id === id ? activeProject() : null);
  const name = displayProjectName(project?.name || 'this book');
  if (!confirm(`Delete “${name}”?`)) return;
  try {
    await api.deleteProject(id);
    if (incomingMarketBook) clearIncomingMarketplace();
    await refreshState();
    showToast(`Deleted “${name}”.`, 'success');
  } catch (err) {
    showToast(errorMessage(err), 'error');
  }
}

async function deleteActiveProject() {
  const project = activeProject();
  if (!project) return;
  return deleteProjectById(project.id);
}

// Wire rename/delete buttons
if (elements.conceptRenameBtn) elements.conceptRenameBtn.addEventListener('click', renameActiveProject);
if (elements.projectRenameBtn) elements.projectRenameBtn.addEventListener('click', renameActiveProject);
if (elements.conceptDeleteBtn) elements.conceptDeleteBtn.addEventListener('click', deleteActiveProject);
if (elements.projectDeleteBtn) elements.projectDeleteBtn.addEventListener('click', deleteActiveProject);
if (elements.conceptDeleteButton) elements.conceptDeleteButton.addEventListener('click', deleteActiveProject);

document.getElementById('maze-detail-panel')?.addEventListener('change', () => {
  persistMazeLabFromForm().catch(() => {});
});
document.getElementById('maze-detail-panel')?.addEventListener('focusout', (event) => {
  if (event.target?.id === 'maze-keyword' || event.target?.id === 'maze-page-count') {
    persistMazeLabFromForm().catch(() => {});
  }
});

// Wire When Complete action dropdown change
if (elements.whenCompleteAction) {
  elements.whenCompleteAction.addEventListener('change', async () => {
    const val = elements.whenCompleteAction.value;
    try {
      await api.setWhenCompleteAction(val);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

// Wire Cancel countdown button
if (elements.cancelCountdownBtn) {
  elements.cancelCountdownBtn.addEventListener('click', async () => {
    try {
      await api.cancelSystemAction();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

// Complete notification listener
api.onComplete(({ projectId }) => {
  const p = (state?.projects || []).find((proj) => proj.id === projectId);
  const title = p?.name || 'Book Project';
  sendDesktopNotification({
    title: 'Generation Complete',
    body: `Your book project "${title}" generation is complete!`
  });
  showRichToast({
    type: 'complete',
    title: 'Generation Complete',
    message: `Book "${title}" generation finished successfully!`,
    actionText: 'View Book',
    onAction: () => selectProject(projectId)
  });
  playChime('complete');
});

// Automation Event Listeners
if (elements.automationStartBtn) {
  elements.automationStartBtn.addEventListener('click', async () => {
    try {
      await api.startAutomation(activeProject()?.id);
      await refreshState();
      showToast('Automation started.', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

if (elements.automationPauseBtn) {
  elements.automationPauseBtn.addEventListener('click', async () => {
    try {
      await api.pauseAutomation();
      await refreshState();
      showToast('Paused.', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

if (elements.automationResumeBtn) {
  elements.automationResumeBtn.addEventListener('click', async () => {
    try {
      await api.startAutomation(activeProject()?.id);
      await refreshState();
      showToast('Automation resumed.', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

const autoStepSelects = [
  elements.autoStepOverview, elements.autoStepCharacters, elements.autoStepInterior,
  elements.autoStepEditable, elements.autoStepThumbnails, elements.autoStepPreview, elements.autoStepExport
];
autoStepSelects.forEach((select) => {
  if (select) {
    select.addEventListener('change', async (e) => {
      const stepName = e.target.dataset.step;
      const mode = e.target.value;
      try {
        await api.updateAutomationSetting(stepName, mode);
        await refreshState();
      } catch (err) {
        showToast(errorMessage(err), 'error');
      }
    });
  }
});

if (elements.automationAskProceed) {
  elements.automationAskProceed.addEventListener('click', async () => {
    try {
      elements.automationAskOverlay.classList.add('hidden');
      await api.resolveAutomationAsk('proceed');
      await refreshState();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

if (elements.automationAskSkip) {
  elements.automationAskSkip.addEventListener('click', async () => {
    try {
      elements.automationAskOverlay.classList.add('hidden');
      await api.resolveAutomationAsk('skip');
      await refreshState();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  });
}

if (typeof api.onAnalysisFinished === 'function') {
  api.onAnalysisFinished((payload) => {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H131',location:'renderer/renderer.js:onAnalysisFinished',message:'renderer received analysis:finished',data:{projectId:payload?.project?.id||null,productFormat:payload?.project?.productFormat||payload?.detectedFormat?.productFormat||null,incoming:Boolean(incomingMarketBook)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (payload?.project?.id) adoptedAnalysisTaskId = adoptedAnalysisTaskId || payload.project.id;
    void finishGateAnalysis(payload);
  });
}

if (typeof api.onPromptProgress === 'function') {
  api.onPromptProgress((payload) => {
    applyPromptProgressToRail(payload);
  });
}

if (typeof api.onAutomationProgress === 'function') {
  api.onAutomationProgress((payload) => {
    const step = payload?.activeStep || payload?.currentStep || '';
    const pct = Number(payload?.stepProgressPercentage);
    if (elements.automationBarLabel && Number.isFinite(pct)) {
      elements.automationBarLabel.textContent = `${step || 'Running'} ${Math.round(pct)}%`;
    }
    if (elements.heartbeatText && Number.isFinite(pct)) {
      elements.heartbeatText.textContent = `${step || 'Automation'} • ${Math.round(pct)}%`;
    }
  });
}

if (typeof api.onAutomationAskRequired === 'function') {
  api.onAutomationAskRequired((payload) => {
    if (elements.automationAskOverlay) {
      const stepName = payload?.stepName || payload?.step || '';
      const project = payload?.project || (state?.projects || []).find((p) => p.id === payload?.projectId);
      let stepLabel = stepName;
      if (stepLabel === 'overview') stepLabel = STEP_LABELS.overview;
      if (stepLabel === 'characters') stepLabel = STEP_LABELS.characters;
      if (stepLabel === 'interior' || stepLabel === 'interior_artwork') stepLabel = STEP_LABELS.interior_artwork;
      if (stepLabel === 'interior_text') stepLabel = STEP_LABELS.interior_text;
      if (stepLabel === 'editable_ppt' || stepLabel === 'editable_generation') stepLabel = STEP_LABELS.editable_ppt;
      if (stepLabel === 'thumbnails') stepLabel = STEP_LABELS.thumbnails;
      if (stepLabel === 'preview') stepLabel = STEP_LABELS.preview;
      if (stepLabel === 'export') stepLabel = STEP_LABELS.export;

      elements.automationAskTitle.textContent = `${stepLabel}?`;
      elements.automationAskBody.textContent = `Start ${stepLabel}?`;
      elements.automationAskOverlay.classList.remove('hidden');
    }
  });
}

if (elements.settingsSoundVolume) {
  elements.settingsSoundVolume.addEventListener('input', (e) => {
    if (elements.settingsSoundVolumeVal) {
      elements.settingsSoundVolumeVal.textContent = `${e.target.value}%`;
    }
  });
}

if (typeof api.onAutomationNotification === 'function') {
  api.onAutomationNotification((payload) => {
    const { type, level, title, message, projectId } = payload;
    
    // 1. Play audio chime
    if (type === 'step_completed') playChime('success');
    else if (type === 'action_required') playChime('warning');
    else if (type === 'step_failed') playChime('error');
    else if (type === 'step_stalled' || type === 'pipeline_stopped') playChime('warning');
    else if (type === 'book_completed' || type === 'all_completed') playChime('complete');
    else if (level === 'error') playChime('error');
    else if (level === 'warning') playChime('warning');
    else playChime('success');

    // 2. Rich In-App Toast
    showRichToast({
      type: level || (type === 'step_failed' ? 'error' : type === 'action_required' ? 'warning' : 'success'),
      title: title || 'Pipeline Update',
      message: message || '',
      actionText: projectId ? 'View Book' : null,
      onAction: projectId ? () => selectProject(projectId) : null,
      duration: (type === 'action_required' || type === 'step_stalled' || type === 'pipeline_stopped') ? 8000 : 5000
    });

    // 3. Desktop Notification
    sendDesktopNotification({
      title: title || 'VERSA CLASS',
      body: message || ''
    });
  });
}

let announcementTimerInterval = null;

async function initStartupAnnouncementModal() {
  return;
}

const GATE_STATUS_IDS = ['studio-intro-agent-status', 'canvas-agent-status'];

function setGateStatus(text) {
  const message = String(text || '').trim();
  GATE_STATUS_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message;
  });
  if (message && marketSession.active) {
    const detailRoots = document.querySelectorAll('[data-market-detail]');
    detailRoots.forEach((el) => { el.textContent = message; });
  }
}

function looksLikeProductUrl(value) {
  const text = String(value || '').trim();
  if (/^https?:\/\//i.test(text)) return true;
  return /teacherspayteachers\.com\/Product\//i.test(text) || /amazon\.[^/\s]+\/(?:dp|gp)\//i.test(text);
}

function handleGateError(error) {
  const message = errorMessage(error);
  failMarketSession(message);
  setGateStatus(message);
  if (incomingMarketBook) {
    incomingMarketBook.lede = message;
    incomingMarketBook.description = message;
    paintIncomingMarketplace();
  }
  showToast(message, 'error');
}

async function openCreatedMazeProject(project) {
  mazeWorkspaceOpen = true;
  activeWorkspaceView = 'maze';
  document.body.dataset.studioPin = '';
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H60',location:'renderer/renderer.js:openCreatedMazeProject',message:'opening maze book into Maze Lab',data:{projectId:project?.id||null,productFormat:project?.productFormat||null,activityCount:project?.activityCount},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (project?.id) {
    await api.selectProject(project.id);
    window.__versaSetStudioMode?.('studio', true);
  }
  if (elements.projectDialog?.open) elements.projectDialog.close();
  if (typeof renderProject === 'function') renderProject();
}

async function finishGateAnalysis(result) {
  analysisResult = result;
  clearIncomingMarketplace();
  if (result?.project?.id) adoptedAnalysisTaskId = adoptedAnalysisTaskId || `project:${result.project.id}`;
  if (!result?.conversationUrl && !result?.project?.id) {
    setMarketLocalStage('extract', 'Analysis finished.');
    setGateStatus('Analysis finished.');
    showToast('Analysis finished.', 'info');
    return;
  }
  const productFormat = result.project?.productFormat
    || document.querySelector('input[name="analysisPipelineChoice"]:checked')?.value
    || 'editable';
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H4',location:'renderer/renderer.js:finishGateAnalysis',message:'gate continue path after analysis',data:{productFormat,detectedFormat:result.detectedFormat||null,projectFormat:result.project?.productFormat||null,pageCount:Number(result.analysis?.pageCount)||20,title:result.analysis?.title||''},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (productFormat === 'maze' || result.detectedFormat?.productFormat === 'maze') {
    const project = result.project;
    const livePages = (state?.activeProject?.id === project?.id
      ? state.activeProject?.mazeProject?.pages
      : null) || project?.mazeProject?.pages || [];
    const readyCount = livePages.filter((page) => page.generationStatus === 'ready').length;
    if (project?.id && mazeAutoGenerateId === project.id) {
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H165',location:'renderer/renderer.js:finishGateAnalysis',message:'skipped duplicate maze auto-generate',data:{projectId:project.id,readyCount},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return;
    }
    mazeWorkspaceOpen = true;
    activeWorkspaceView = 'maze';
    if (project?.id) mazeAutoGenerateId = project.id;
    const briefCount = Number.parseInt(result.analysis?.pageCount, 10);
    if (elements.conceptGeneratePageCount && Number.isSafeInteger(briefCount) && briefCount > 0) {
      elements.conceptGeneratePageCount.value = String(Math.min(50, briefCount));
    }
    if (project?.id) {
      await api.selectProject(project.id);
      window.__versaSetStudioMode?.('studio', true);
    }
    if (elements.projectDialog?.open) elements.projectDialog.close();
    if (readyCount > 0) {
      setGateStatus(`${readyCount} mazes ready.`);
      showToast(`${readyCount} mazes ready.`, 'success');
      await continueMazePipelineFromLab(project, readyCount);
      renderProject();
      return;
    }
    markConceptReadyFromAnalysis('Generating…');
    setGateStatus('Generating…');
    await generateMazeFromMarketplace(project);
    return;
  }
  markConceptReadyFromAnalysis('Analysis saved.');
  if (result.project?.id) {
    await api.selectProject(result.project.id);
    window.__versaSetStudioMode?.('studio', true);
  }
  if (elements.projectDialog?.open) elements.projectDialog.close();
  setGateStatus('Concept ready.');
  showToast('Concept saved.', 'success');
}

async function runGateUrlAnalysis(productUrl) {
  try {
    setMarketLocalStage('analyze', 'Analyzing.');
    const result = await api.analyzeProduct({
      sourceMode: 'url',
      productUrl,
      keyword: '',
      tptNiche: '',
      activityType: '',
      metadataText: '',
      title: '',
      niche: ''
    });
    await finishGateAnalysis(result);
  } catch (error) {
    handleGateError(error);
  }
}

async function runGateKeywordScan(query) {
  try {
    const started = await api.scanTrends({ query, marketplace: 'tpt' });
    if (!started?.taskId) throw new Error('Scan failed.');
    const deadline = Date.now() + 11 * 60_000;
    const poll = async () => {
      const scan = await api.agentScanResult(started.taskId);
      if (!scan) return;
      if (scan.state === 'done') {
        const chosen = normalizeAgentAnalysisInput(scan.result);
        if (!chosen) throw new Error('No product URL.');
        applyIncomingListing(chosen);
        setMarketLocalStage('analyze', 'Analyzing…');
        setGateStatus('Analyzing…');
        if (state?.app?.loginRequired) {
          showToast('Connect Gemini.', 'error');
          openAuthManager();
          return;
        }
        const result = await api.analyzeProduct(chosen);
        await finishGateAnalysis(result);
        return;
      }
      if (scan.state === 'failed' || scan.state === 'cancelled') {
        throw new Error(scan.lastError || 'Scan failed.');
      }
      setMarketStage('scan', { detail: agentPhaseMessage(scan.checkpoint), session: 'running' });
      setGateStatus(agentPhaseMessage(scan.checkpoint));
      if (Date.now() < deadline) setTimeout(() => { void poll().catch(handleGateError); }, 1000);
    };
    void poll();
  } catch (error) {
    handleGateError(error);
  }
}

function startGateIngestion(rawQuery) {
  window.__versaEnterDoor?.();
  const query = String(rawQuery || '').trim();
  if (marketSession.active && ['scan', 'analyze', 'extract', 'prompts', 'capture'].includes(marketSession.localStage)) {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H163',location:'renderer/renderer.js:startGateIngestion',message:'ignored duplicate marketplace start while a job is live',data:{query,localStage:marketSession.localStage,active:marketSession.active,mazeAutoGenerateId},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return;
  }
  mazeAutoGenerateId = null;
  openIncomingMarketplace(query);
  beginMarketSession({
    marketplace: 'tpt',
    query,
    stage: looksLikeProductUrl(query) ? 'analyze' : 'scan',
    detail: query
      ? (looksLikeProductUrl(query) ? 'Analyzing…' : `Scanning "${query}"`)
      : 'Scanning…'
  });
  setGateStatus(query
    ? `Searching "${query}"`
    : 'Searching…');
  if (looksLikeProductUrl(query)) {
    if (state?.app?.loginRequired) {
      showToast('Connect Gemini.', 'error');
      openAuthManager();
      return;
    }
    void runGateUrlAnalysis(query);
    return;
  }
  void runGateKeywordScan(query);
}

[['studio-intro-prompt', 'studio-intro-route'], ['canvas-agent-prompt', 'canvas-agent-route']]
  .forEach(([formId, inputId]) => {
    document.getElementById(formId)?.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startGateIngestion(document.getElementById(inputId)?.value || '');
    });
  });

refreshState()
  .then(() => initStartupAnnouncementModal())
  .catch((error) => showToast(errorMessage(error), 'error'));
