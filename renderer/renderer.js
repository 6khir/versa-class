const api = window.tptDesktop;

async function openLoginSession(options = {}) {
  if (typeof api?.openLoginBrowser === 'function') return api.openLoginBrowser(options);
  if (typeof api?.launchBrowser === 'function') return api.launchBrowser();
  throw new Error('The app bridge is out of date. Quit the app completely, then restart it.');
}

async function verifyLoginSession(options = {}) {
  if (typeof api?.verifyChatGptLogin === 'function') return api.verifyChatGptLogin(options);
  throw new Error('Login verification requires a full app restart to load the updated bridge.');
}

const STATUS_LABELS = {
  pending: 'Pending',
  preparing: 'Preparing',
  submitted: 'Submitted',
  generating: 'Generating',
  downloading: 'Downloading',
  validating: 'Validating image',
  complete: 'Complete',
  edit_pending: 'Revision queued',
  retry_wait: 'Retry queued',
  rate_limit_paused: 'Usage limit',
  needs_user_action: 'Needs attention'
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
let currentFilter = 'all';
let lastHeartbeatAt = null;
let editingJobId = null;
let authManagerOpenedManually = false;
let authTarget = 'gemini';
let activeWorkspaceView = 'overview';
let lastRenderedWorkspaceView = null;
const WORKSPACE_PANES = ['overview', 'characters', 'interior', 'editable', 'thumbnails', 'preview', 'export', 'listing'];
let activeSettingsTab = 'profile';
let imagePreviewItems = [];
let imagePreviewIndex = 0;
let bundleViewActive = false;

const elements = Object.fromEntries([
  'update-button', 'update-label', 'browser-pill', 'browser-label', 'focus-browser-button', 'launch-browser-button',
  'settings-profile-button', 'settings-profile-avatar', 'settings-profile-label', 'settings-dialog', 'settings-form',
  'settings-close-button', 'settings-profile-large-avatar',
  'settings-current-version', 'settings-update-status-badge', 'settings-update-message',
  'settings-update-progress-container', 'settings-update-progress-fill', 'settings-update-progress-text',
  'settings-update-last-checked', 'settings-check-update-btn', 'settings-install-update-btn',
  'settings-listing-tags', 'settings-listing-subjects', 'settings-listing-grades',
  'settings-listing-formats', 'settings-listing-tax-code', 'settings-listing-copyright',
  'settings-listing-pricing-mode', 'settings-listing-price', 'settings-listing-multi-price',
  'settings-listing-publication', 'settings-listing-thumbnail', 'settings-default-format',
  'settings-default-orientation', 'settings-when-complete', 'settings-save-button', 'settings-save-note',
  'settings-chatgpt-card', 'settings-chatgpt-status', 'settings-chatgpt-profile', 'settings-chatgpt-verified',
  'settings-chatgpt-logout', 'settings-chatgpt-profile-select', 'settings-selected-profile-sessions',
  'settings-enable-profile-swapping', 'settings-profile-rotation-list',
  'settings-mockups-card', 'settings-mockups-status', 'settings-mockups-profile', 'settings-mockups-verified',
  'settings-openai-logout',
  'engine-chatgpt-toggle', 'engine-chatgpt-state', 'engine-gemini-toggle', 'engine-gemini-state', 'engine-meta-toggle', 'engine-meta-state',
  'settings-meta-card', 'settings-meta-status', 'settings-meta-profile', 'settings-meta-verified', 'settings-meta-logout',
  'settings-canva-card', 'settings-canva-status', 'settings-canva-profile', 'settings-canva-verified', 'settings-canva-logout',
  'settings-gpt-card', 'settings-gpt-status', 'settings-gpt-profile', 'settings-studio-list',
  'new-project-button', 'project-count', 'project-list', 'empty-state', 'project-workspace',
  'bundle-upload-sidebar-btn', 'bundle-upload-view', 'bundle-projects-list', 'bundle-empty-state',
  'bundle-ready-badge', 'start-bundle-btn', 'stop-bundle-btn',
  'project-meta', 'project-title', 'project-format-toggle', 'project-theme', 'output-folder-button', 'retry-all-button',
  'pause-button', 'live-pause-button', 'studio-stage-pause', 'studio-banner-pause', 'run-button', 'stat-total', 'stat-complete', 'stat-remaining', 'stat-percent',
  'queue-caption', 'current-job-label', 'current-job-status', 'progress-fill', 'progress-percent-label', 'heartbeat-text', 'live-dock',
  'jobs-table', 'detail-title', 'detail-status-wrap', 'detail-error', 'detail-prompt',
  'detail-story-text-wrap', 'detail-story-text',
  'copy-prompt-button', 'import-image-button', 'open-conversation-button', 'retry-job-button',
  'export-caption', 'export-mode-select', 'export-all-files-button', 'export-pdf-button', 'export-zip-button', 'export-pptx-button', 'event-log', 'project-dialog',
  'tpt-listing-caption', 'generate-tpt-listing-button', 'generate-tpt-thumbnails-button', 'generate-tpt-preview-video-button', 'open-tpt-upload-button',
  'mark-tpt-ready-button', 'start-tpt-uploading-button', 'when-complete-control', 'open-project-folder-button',
  'tpt-listing-review', 'tpt-thumbnails-review', 'tpt-preview-review',
  'overview-character-count', 'overview-character-names', 'overview-interior-detail', 'overview-editable-status', 'overview-editable-detail', 'overview-listing-status',
  'overview-listing-detail', 'overview-thumbnail-count', 'overview-thumbnail-detail', 'overview-preview-status', 'overview-preview-detail', 'overview-export-status', 'overview-export-detail',
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
  'auto-step-overview', 'auto-step-characters', 'auto-step-interior', 'auto-step-editable', 'auto-step-listing', 'auto-step-thumbnails', 'auto-step-preview', 'auto-step-export',
  'canva-editable-status', 'canva-editable-link', 'canva-pdf-status', 'run-canva-editable-button', 'open-canva-template-button',
  'canva-progress-percent', 'canva-progress-fill', 'canva-progress-message', 'canva-progress-label', 'canva-progress-elapsed', 'clear-canva-template-button',
  'automation-ask-overlay', 'automation-ask-title', 'automation-ask-body', 'automation-ask-skip', 'automation-ask-proceed',
  'settings-sound-enabled', 'settings-sound-volume', 'settings-sound-volume-val', 'settings-toasts-enabled', 'settings-desktop-notifications-enabled',
  'mini-canva-dashboard'
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
    title: `Page ${job.pageNumber} — ${job.fileName}`
  }));
}

function thumbnailPreviewItems(project) {
  return (project.tptListing?.thumbnailPaths ?? []).map((path, index) => path ? ({
    src: `tpt-image://thumbnail/${encodeURIComponent(project.id)}/${index}?v=${encodeURIComponent(project.updatedAt ?? '')}`,
    alt: `TPT thumbnail ${index + 1}`,
    title: `TPT Thumbnail ${index + 1}`
  }) : null).filter(Boolean);
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status ?? '—';
}

function statusChip(status) {
  return `<span class="status-chip status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
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

function jobFillPercent(job, isLive = false) {
  if (job?.outputPath || job?.status === 'complete') return 100;
  const base = JOB_FILL_PERCENT[job?.status] ?? 8;
  return isLive ? Math.min(92, base + 10) : base;
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
  progress: 'In progress',
  waiting: 'Ready',
  blocked: 'Waiting',
  skipped: 'Not in this book',
  error: 'Error'
};

function setStagePresentation(stageId, state, extraClass = {}) {
  const card = document.querySelector(`.overview-stage-card[data-stage="${stageId}"]`);
  if (!card) return;
  const states = ['done', 'live', 'progress', 'waiting', 'blocked', 'skipped', 'error'];
  states.forEach((name) => card.classList.toggle(`is-${name}`, name === state));
  card.classList.toggle('is-filling', Boolean(extraClass.filling));
  card.classList.toggle('done', state === 'done');
  card.classList.toggle('active', state === 'live' || state === 'progress');
  card.classList.toggle('pending', state === 'waiting' || state === 'blocked' || state === 'skipped');
  const chip = card.querySelector('.stage-state');
  if (chip) chip.textContent = STAGE_STATE_LABELS[state] || 'Waiting';
}

function setTabMark(view, state) {
  const mark = document.querySelector(`[data-tab-mark="${view}"]`);
  if (!mark) return;
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
}

function canvaLocked() {
  if (state?.app?.canvaAvailable === false || state?.integrations?.canva?.available === false) return true;
  if (state?.app?.canvaAvailable === true || state?.integrations?.canva?.available === true) return false;
  return runningOnWindows();
}

function canvaLockMessage() {
  return state?.app?.canvaLockMessage
    || state?.integrations?.canva?.lockMessage
    || 'Canva Magic Layer is coming soon on Windows. ChatGPT, Gemini, Meta AI, listing, mockups, and TPT still work.';
}

function applyCanvaLockUi() {
  const locked = canvaLocked();
  document.body.classList.toggle('canva-locked', locked);
  document.querySelector('[data-view-target="editable"]')?.classList.toggle('is-locked', locked);
  document.querySelector('[data-workspace-pane="editable"]')?.classList.toggle('is-canva-locked', locked);
  const banner = document.getElementById('canva-coming-soon');
  if (banner) banner.hidden = !locked;
  if (elements.settingsCanvaCard) {
    elements.settingsCanvaCard.classList.toggle('is-locked', locked);
    elements.settingsCanvaCard.querySelectorAll('[data-action="settings-manage-canva"], [data-action="settings-verify-canva"], [data-action="settings-logout-canva"]').forEach((button) => {
      button.disabled = locked;
      if (button.dataset.action === 'settings-logout-canva' && locked) button.style.display = 'none';
    });
  }
  if (elements.autoStepEditable) {
    elements.autoStepEditable.disabled = locked;
    elements.autoStepEditable.title = locked ? canvaLockMessage() : '';
  }
  document.getElementById('automation-step-editable')?.classList.toggle('is-locked', locked);
  const autoCopy = document.getElementById('automation-step-editable-copy');
  if (autoCopy) {
    autoCopy.textContent = locked
      ? 'Coming soon on Windows. Automation skips this step so listing, mockups, and export still run.'
      : 'Import the print PDF once, Magic Layer each page, save a verified template link. Skips static books. Defaults to Ask.';
  }
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
    [/^تجهيز الصفحة (\d+)\/(\d+) — المحاولة (\d+)\/(\d+)\.$/u, 'Preparing page $1/$2 — attempt $3/$4.'],
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

  const closeBtn = toast.querySelector('.toast-close-btn');
  closeBtn?.addEventListener('click', () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  });

  if (actionText && typeof onAction === 'function') {
    const actionBtn = toast.querySelector('.toast-action-btn');
    actionBtn?.addEventListener('click', () => {
      onAction();
      toast.remove();
    });
  }

  elements.toastHost.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.isConnected) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
      }
    }, duration);
  }
}

function showToast(message, type = 'info') {
  showRichToast({
    type,
    title: type === 'error' ? 'Error' : type === 'success' ? 'Success' : '',
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
    showToast(code === 'QUEUE_PAUSED' ? 'Stopped. Start again when you are ready.' : message, info ? 'info' : 'error');
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
    return `Interior is generating on "${displayProjectName(generatingProjectRecord()?.name || 'this book')}". Pause it to start another browser stage. You can still open other tabs.`;
  }
  const live = state?.liveOperation;
  if (live?.kind === 'canva') return 'Canva is using the browser. You can still open listing, interior, export, and settings.';
  if (live?.kind === 'listing') return 'SEO is using the browser. You can still open other tabs.';
  if (live?.kind === 'thumbnails') return 'Mockups are using the browser. You can still open other tabs.';
  if (live?.kind === 'preview') return 'Preview is using the browser. You can still open other tabs.';
  if (state?.workBusy?.characters) return 'Character references are generating. You can still open other tabs.';
  if (state?.workBusy?.tptListing) return 'SEO work is running in the background. You can still open other tabs.';
  if (state?.automation?.active && !state?.automation?.paused) {
    return 'Full automation is running. Pause it to start a stage by itself. You can still open other tabs.';
  }
  return '';
}

function stageStartBlockReason(step, project) {
  const stats = project?.stats || {};
  const listing = project?.tptListing || {};
  const thumbnailCount = (listing.thumbnailPaths || []).filter(Boolean).length;
  const hasPages = Number(stats.complete) > 0 || Number(stats.total) > 0;
  const hasPdf = Boolean(listing.productPdfPath || project?.productPdfPath);
  const hasListingContent = Boolean(listing.title || listing.rawResponse || listing.description);
  if (step === 'characters') {
    return 'Characters is not part of this studio.';
  }
  if (step === 'interior') {
    if (!stats.total) return 'Create pages first.';
    if (stats.remaining === 0) return 'All interior pages are already done.';
    return browserBusyReason();
  }
  if (step === 'editable') {
    if (canvaLocked()) return canvaLockMessage();
    if (project?.productFormat !== 'editable') return 'Canva Magic Layer is only for editable books.';
    if (!hasPages && !hasPdf) return 'Add pages or a print PDF first.';
    return browserBusyReason();
  }
  if (step === 'listing') {
    if (!hasPages && !hasPdf) return 'Add pages or a PDF before SEO.';
    return browserBusyReason();
  }
  if (step === 'thumbnails') {
    if (!hasPages && !hasPdf && !hasListingContent) {
      return 'Add pages, a PDF, or listing content before mockups.';
    }
    return browserBusyReason();
  }
  if (step === 'preview') {
    if (thumbnailCount === 0) return 'Generate mockups first.';
    return browserBusyReason();
  }
  if (step === 'export') {
    if (!hasPages && !hasPdf) return 'Add pages or a PDF before export.';
    return '';
  }
  return '';
}

function isGeneratingThisProject(project) {
  if (!project?.id) return false;
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
          <span>${complete ? 'Reference ready' : busy ? 'Generating…' : 'Not generated'}</span>
        </header>
        <div class="character-thumbnail-shell">
          ${complete ? `
            <button class="character-thumbnail-button" data-action="preview-character" data-project-id="${projectId}" data-character-index="${index}" type="button" title="Open ${characterName} at full size" aria-label="Open ${characterName} character reference at full size">
              <img class="character-thumbnail" src="tpt-image://character/${encodeURIComponent(project.id)}/${index}?v=${encodeURIComponent(project.updatedAt ?? '')}" alt="${characterName} character reference">
              <span class="character-thumbnail-hint">View full size</span>
            </button>
          ` : `
            <div class="character-thumbnail-placeholder" aria-label="Character reference has not been generated">
              <span aria-hidden="true">◇</span>
              <small>Reference preview</small>
            </div>
          `}
        </div>
        <div id="${escapeHtml(promptId)}" class="character-prompt-box">${escapeHtml(character.prompt || 'No image prompt was returned.')}</div>
        <div class="character-prompt-actions">
          <button class="character-text-button" data-action="toggle-character-prompt" data-project-id="${projectId}" data-character-index="${index}" aria-controls="${escapeHtml(promptId)}" aria-expanded="false" type="button">Show Full Prompt</button>
          <button class="character-text-button" data-action="copy-character-prompt" data-project-id="${projectId}" data-character-index="${index}" type="button" ${character.prompt ? '' : 'disabled'}>Copy Prompt</button>
        </div>
        ${sheet.error ? `<small class="error-box character-card-error">${escapeHtml(sheet.error)}</small>` : ''}
        <button class="button ${complete ? 'button-ghost' : 'button-primary'} button-full character-generate-button" data-action="generate-character-sheet" data-project-id="${projectId}" data-character-index="${index}" type="button" ${disabled ? 'disabled' : ''}>
          ${busy ? 'Generating Character Reference…' : complete ? 'Regenerate Character Reference' : 'Generate Character Reference'}
        </button>
      </article>
    `;
  }).join('') || '<p class="muted">No character cards were returned.</p>';
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
    blueprint_complete: ['Idea saved', 'The story idea and blueprint are saved with the main Gemini conversation link.'],
    characters_generating: ['Requesting character cards', 'Asking only for the essential characters, one standalone prompt per character.'],
    characters_complete: ['Character cards saved', 'The character prompts are ready. Reference image generation starts next.'],
    references_generating: ['Generating character references', payload.progress?.currentName
      ? `Creating ${payload.progress.currentName} (${Math.min((payload.progress.completed ?? 0) + 1, payload.progress.total ?? 1)} of ${payload.progress.total ?? 1}) in an independent chat.`
      : 'Creating each character in an independent chat; the original photo is attached only to the first character.'],
    references_complete: ['Character references ready', 'All cartoon character references are saved. Returning to the main planning conversation.'],
    pages_generating: ['Requesting official page cards', 'Asking for the front cover, exact story page text and prompts, and the back cover only now.'],
    workflow_failed: ['Workflow needs attention', 'The saved project can resume from its first incomplete stage.'],
    phase2_failed: ['Workflow needs attention', 'This older project can resume from its first incomplete stage.'],
    complete: ['Storybook package saved', 'All five planning stages are complete. Page generation will attach every saved character reference.']
  };
  const [stageTitle, stageDetail] = stageCopy[phase] ?? ['Building Storybook', 'Continuing the controlled Storybook workflow.'];
  hideAllProjectSteps();
  elements.projectDialog.classList.add('storybook-review-open');
  elements.storybookReviewStep.hidden = false;
  elements.projectDialogTitle.textContent = 'Storybook Studio Preview';
  elements.storybookReviewTitle.textContent = displayProjectName(project.name || parsed.title || 'Story package review');
  elements.storybookPhaseBadge.className = `status-chip status-${phaseComplete ? 'complete' : phaseFailed ? 'needs_user_action' : 'generating'}`;
  elements.storybookPhaseBadge.textContent = stageTitle;
  const approvedStoryIdea = parsed.storyIdea || project.storyInput?.approvedStoryIdea || project.description || '';
  const approvedBlueprint = parsed.blueprint || project.storyBlueprint || 'Blueprint saved in the project.';
  elements.storybookBlueprintPreview.textContent = approvedStoryIdea
    ? `STORY IDEA\n${approvedStoryIdea}\n\nBLUEPRINT\n${approvedBlueprint}`
    : approvedBlueprint;
  elements.storybookFrontCoverPreview.textContent = parsed.frontCover || project.frontCoverPrompt || 'Requested only after all character references are ready.';
  elements.storybookCharacterCards.innerHTML = storybookCharacterCardsHtml(project, phaseComplete);
  elements.storybookPhase2Progress.hidden = phaseComplete || phaseFailed;
  if (elements.storybookProgressTitle) elements.storybookProgressTitle.textContent = stageTitle;
  if (elements.storybookProgressDetail) elements.storybookProgressDetail.textContent = stageDetail;
  elements.storybookReviewError.hidden = !resolvedError;
  elements.storybookReviewError.textContent = resolvedError ? `The Storybook workflow paused safely: ${resolvedError}` : '';
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

function showProjectMethodStep() {
  hideAllProjectSteps();
  elements.projectMethodStep.hidden = false;
  elements.projectDialogTitle.textContent = 'How do you want to create this book?';
}

function showProjectPromptStep() {
  hideAllProjectSteps();
  elements.projectPromptStep.hidden = false;
  elements.bulkPromptsText.required = true;
  elements.projectDialogTitle.textContent = 'Paste your ordered page prompts';
  renderBulkPromptCount();
  setTimeout(() => elements.bulkPromptsText.focus(), 50);
}

function showProjectAnalysisInputStep() {
  hideAllProjectSteps();
  elements.projectAnalysisInputStep.hidden = false;
  renderWindowsUrlPageSetup();
  setAnalysisMode(currentAnalysisMode);
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
      elements.resultMockupsStatus.textContent = `${count} listing mockup${count === 1 ? '' : 's'} captured. These will be attached so the model can see structure and style, then write original pages.`;
    } else if (status === 'skipped') {
      elements.resultMockupsStatus.textContent = mockups?.warning || 'Listing mockup capture is available for Teachers Pay Teachers product links.';
    } else if (status === 'blocked') {
      elements.resultMockupsStatus.textContent = mockups?.warning || 'The listing page could not be opened. Prompt generation will use the URL and text analysis only.';
    } else {
      elements.resultMockupsStatus.textContent = mockups?.warning || 'No listing mockups were found. Prompt generation will use the URL and text analysis only.';
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
    elements.conceptMockupsStatus.textContent = `${count} listing mockup${count === 1 ? '' : 's'} will be attached when you generate page prompts.`;
  }
  if (elements.conceptMockupsStrip) {
    elements.conceptMockupsStrip.innerHTML = `${competitorMockupStripHtml(project.id, mockups, project.updatedAt)}
      <button class="button button-ghost button-danger" data-action="clear-competitor-mockups" type="button">Delete mockups</button>`;
  }
}

function showProjectAnalysisLoadingStep(isUrl = false) {
  hideAllProjectSteps();
  elements.projectAnalysisLoadingStep.hidden = false;
  elements.projectDialogTitle.textContent = 'Connecting to Content Gem…';
  if (elements.analysisLoadingDetail) {
    elements.analysisLoadingDetail.textContent = isUrl
      ? 'Collecting listing mockups from the public product page, then analyzing the concept with Content Gem.'
      : 'Analyzing product concept, grade level, and page count structure.';
  }
}

function showProjectAnalysisResultStep() {
  hideAllProjectSteps();
  elements.projectAnalysisResultStep.hidden = false;
  if (runningOnWindows() && analysisResult?.project) {
    syncAnalysisPageSetup(analysisResult.project.format, analysisResult.project.orientation);
  }
  renderAnalysisMockups(analysisResult);
  elements.projectDialogTitle.textContent = 'Competitor analysis & page count';
}

function showProjectPromptsLoadingStep(pageCount, mockupCount = 0) {
  hideAllProjectSteps();
  elements.projectPromptsLoadingStep.hidden = false;
  elements.promptsLoadingTitle.textContent = `Generating ${pageCount} page prompts…`;
  elements.projectDialogTitle.textContent = 'Generating page prompts…';
  if (elements.promptsLoadingDetail) {
    const batchNote = Number(pageCount) > 50
      ? ` Watching Gemini in 50-page batches until all ${pageCount} prompts are drafted, keeping the signed-in tab and continuing or shrinking if it lags.`
      : ' Watching Gemini until the draft finishes, then saving the prompts.';
    elements.promptsLoadingDetail.textContent = mockupCount
      ? `Attaching ${mockupCount} competitor listing mockup${mockupCount === 1 ? '' : 's'} so the model can see structure and style, then generating original page prompts.${batchNote}`
      : `Generating distinct single-line prompts for each page slot in the Content Gem conversation.${batchNote}`;
  }
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
      elements.startAnalysisButton.textContent = 'Analyze Product URL with Content Gem →';
    } else if (currentAnalysisMode === 'builder') {
      elements.startAnalysisButton.textContent = 'Build Book Concept with Content Gem →';
    } else {
      elements.startAnalysisButton.textContent = 'Generate Storybook & Prompts →';
    }
  }
  if (elements.projectDialogTitle) {
    if (currentAnalysisMode === 'url') {
      elements.projectDialogTitle.textContent = 'Analyze Competitor Product URL';
    } else if (currentAnalysisMode === 'builder') {
      elements.projectDialogTitle.textContent = 'Book Concept & Prompt Builder';
    } else {
      elements.projectDialogTitle.textContent = "Children's Storybook Mode";
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
  if (engine === 'meta') return 'Meta AI';
  return 'ChatGPT';
}

function unusedEngineSummary(engine = activeEngine()) {
  if (engine === 'meta') return 'ChatGPT and Gemini stay signed in.';
  if (engine === 'gemini') return 'ChatGPT and Meta AI stay signed in.';
  return 'Gemini and Meta AI stay signed in.';
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
      ? 'Meta: sign in from Settings'
      : (connected ? 'Meta running in background' : 'Meta ready');
    return;
  }
  elements.browserLabel.textContent = connected
    ? (queueRunning || state.browser.headless || !state.browser.loginMode
      ? 'Engine running in background'
      : (loginRequired ? 'Sign in from Settings when ready' : 'Engine connected'))
    : (loginRequired ? 'Sign in from Settings' : 'Engine ready');
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
      if (status === 'checking') elements.updateLabel.textContent = 'Checking for updates…';
      else if (status === 'available') elements.updateLabel.textContent = `Downloading v${availableVersion}…`;
      else if (status === 'downloading') elements.updateLabel.textContent = `Downloading update… ${percent}%`;
      else if (status === 'ready') elements.updateLabel.textContent = `Restart to update v${availableVersion}`;
      else if (status === 'installing') elements.updateLabel.textContent = 'Installing update…';
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
      elements.settingsUpdateMessage.textContent = 'Checking official release servers for new updates…';
    } else if (status === 'available') {
      elements.settingsUpdateMessage.textContent = `New update version ${availableVersion} found! Starting automatic download…`;
    } else if (status === 'downloading') {
      elements.settingsUpdateMessage.textContent = `Downloading update version ${availableVersion} (${percent}%)…`;
    } else if (status === 'ready') {
      elements.settingsUpdateMessage.textContent = `Version ${availableVersion} has been downloaded and is ready to install! Restart the app to complete the update.`;
    } else if (status === 'up-to-date') {
      elements.settingsUpdateMessage.textContent = `You are running the latest version (v${currentVersion}). No new updates available.`;
    } else if (status === 'error') {
      elements.settingsUpdateMessage.textContent = update?.message || 'Failed to check for updates or update service is temporarily unavailable.';
    } else if (status === 'disabled') {
      elements.settingsUpdateMessage.textContent = `Running unpackaged dev build (v${currentVersion}). Auto-updater is active only in installed releases.`;
    } else {
      elements.settingsUpdateMessage.textContent = `Current version: v${currentVersion}. Click "Check for Updates" to look for new releases.`;
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
        elements.settingsUpdateLastChecked.textContent = `Last checked: ${date.toLocaleTimeString()} (${date.toLocaleDateString()})`;
      } catch (e) {
        elements.settingsUpdateLastChecked.textContent = `Last checked: ${checkedAt}`;
      }
    } else {
      elements.settingsUpdateLastChecked.textContent = 'Last checked: Not checked yet';
    }
  }

  if (elements.settingsCheckUpdateBtn) {
    const isCheckingOrDownloading = ['checking', 'downloading', 'installing'].includes(status);
    elements.settingsCheckUpdateBtn.disabled = isCheckingOrDownloading;
    elements.settingsCheckUpdateBtn.innerHTML = isCheckingOrDownloading
      ? '<span class="update-spinner">↻</span> Checking…'
      : '<span class="btn-icon">↻</span> Check for Updates';
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
  chatgpt: { className: 'auth-brand-logo brand-chatgpt', html: '<img class="brand-mark" src="../assets/brand/chatgpt.png" alt="ChatGPT">' },
  gemini: { className: 'auth-brand-logo brand-gemini', html: '<img class="brand-mark" src="../assets/brand/gemini.png" alt="Gemini">' },
  meta: { className: 'auth-brand-logo brand-meta', html: '<img class="brand-mark" src="../assets/brand/meta.png" alt="Meta AI">' }
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
    elements.authEyebrow.textContent = chatgpt ? 'CHATGPT LOGIN' : (meta ? 'META AI LOGIN' : 'GEMINI LOGIN');
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
      ? 'Sign in to ChatGPT once. After that Canary stays in the background and VERSA CLASS keeps the login. This does not verify Gemini.'
      : (meta
        ? 'Sign in on meta.ai once. After that Canary stays in the background. ChatGPT and Gemini stay signed in separately.'
        : (geminiConnected
          ? `Your Google account${geminiEmail ? ` (${geminiEmail})` : ''} is already verified in Settings. Click Sign in and VERSA CLASS restores that profile in the live Gemini tab — it will not open a guest tab.`
          : 'Sign in to Google Gemini once. After that Canary stays in the background and VERSA CLASS keeps the login. This does not verify ChatGPT.'));
  }
  if (elements.authOpenButton) {
    elements.authOpenButton.textContent = chatgpt
      ? 'Sign in to ChatGPT'
      : (meta ? 'Sign in to Meta AI' : (geminiConnected ? 'Sign in with saved profile' : 'Sign in to Gemini'));
  }
  if (elements.authVerifyButton) {
    elements.authVerifyButton.textContent = chatgpt
      ? 'Verify ChatGPT'
      : (meta ? 'Verify Meta AI' : 'Verify Gemini');
  }
}

function openAuthManager(target = 'gemini') {
  const required = Boolean(state?.app?.loginRequired) && target !== 'chatgpt' && target !== 'meta';
  authManagerOpenedManually = true;
  configureAuthDialog(target);
  elements.authCloseButton.hidden = required;
  elements.authStatusText.textContent = required
    ? 'Gemini is not verified yet. Sign in to Gemini in Google Chrome Canary.'
    : (target === 'chatgpt'
      ? 'Sign in to ChatGPT in Google Chrome Canary, then import and verify that session.'
      : (target === 'meta'
        ? 'Sign in on meta.ai in Google Chrome Canary, then import and verify that session.'
        : 'Your Gemini profile is verified. Click Sign in to restore that Google account in the live tab.'));
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
  return `<span class="session-chip ${chatgptOn ? 'is-on' : 'is-off'}"><img class="session-chip__mark" src="../assets/brand/chatgpt.png" alt="">ChatGPT</span><span class="session-chip ${geminiOn ? 'is-on' : 'is-off'}"><img class="session-chip__mark" src="../assets/brand/gemini.png" alt="">Gemini</span>`;
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
      : '<span class="session-chip is-off"><img class="session-chip__mark" src="../assets/brand/chatgpt.png" alt="">ChatGPT</span><span class="session-chip is-off"><img class="session-chip__mark" src="../assets/brand/gemini.png" alt="">Gemini</span>';
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
      ? 'Verified ChatGPT connection'
      : (selected?.hasChatGptSession
        ? 'Signed in Chrome — verify ChatGPT'
        : (chatgptCount ? `${chatgptCount} other profile${chatgptCount === 1 ? '' : 's'} signed into ChatGPT` : 'ChatGPT sign-in required'));
  }
  if (elements.settingsMockupsProfile) {
    elements.settingsMockupsProfile.textContent = chatgptVerified
      ? 'ChatGPT is verified.'
      : 'Use Sign in / manage, then Verify ChatGPT.';
  }
  if (elements.settingsMockupsVerified) {
    const mockupProfile = mockups.profile ?? {};
    const verifiedParts = [
      mockupProfile.sourceBrowser && `${mockupProfile.sourceBrowser} / ${mockupProfile.sourceProfile || 'profile'}`,
      mockupProfile.verifiedAt && `verified ${new Date(mockupProfile.verifiedAt).toLocaleString()}`
    ].filter(Boolean);
    elements.settingsMockupsVerified.textContent = verifiedParts.join(' · ')
      || (selected ? `${selected.browser} / ${selected.profileName || selected.profileKey} · ${profileSessionLabel(selected)}` : '');
  }
  if (elements.settingsOpenaiLogout) {
    elements.settingsOpenaiLogout.style.display = chatgptVerified ? 'inline-flex' : 'none';
  }
}

function renderStudioList() {
  if (!elements.settingsStudioList) return;
  const gems = state?.integrations?.studios?.gems ?? [];
  const gpts = state?.integrations?.studios?.gpts ?? [];
  const rows = [
    ...gems.map((studio) => ({ ...studio, group: 'Gemini Gem' })),
    ...gpts.map((studio) => ({ ...studio, group: 'ChatGPT Custom GPT' }))
  ];
  if (!rows.length) {
    elements.settingsStudioList.innerHTML = '<p class="muted">Gems load after the app finishes starting.</p>';
    return;
  }
  elements.settingsStudioList.innerHTML = rows.map((studio) => {
    const gem = String(studio.group || '').startsWith('Gemini');
    const mark = gem ? '../assets/brand/gemini.png' : '../assets/brand/chatgpt.png';
    const markAlt = gem ? 'Gemini' : 'ChatGPT';
    return `
    <div class="studio-row ${studio.connected ? 'is-ready' : 'is-waiting'}">
      <img class="brand-mark studio-row__mark" src="${mark}" alt="${markAlt}">
      <div>
        <strong>${escapeHtml(studio.name)}</strong>
        <small>${escapeHtml(studio.group)}${studio.connected ? ' · ready' : ' · verify to open'}</small>
      </div>
      <button class="button button-ghost" data-action="settings-open-studio" data-studio="${escapeHtml(studio.id)}" type="button">Open</button>
    </div>
  `;
  }).join('');
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

  elements.settingsProfileLabel.textContent = displayName;
  elements.settingsProfileAvatar.textContent = initial;
  elements.settingsProfileLargeAvatar.textContent = initial;
  elements.settingsChatgptCard.classList.toggle('is-connected', connected);
  elements.settingsGptCard.classList.toggle('is-connected', customGptConnected);
  elements.settingsChatgptStatus.textContent = connected ? 'Verified connection' : 'Connection required';
  elements.settingsGptStatus.textContent = customGptConnected
    ? 'Gems and Custom GPTs ready'
    : 'Verify Gemini and ChatGPT to open Gems and GPTs';
  if (elements.settingsChatgptLogout) {
    elements.settingsChatgptLogout.style.display = connected ? 'inline-flex' : 'none';
  }

  let detectedIdentity = [detected.name, detected.email].filter(Boolean).join(' · ');
  
  if (connected && state?.profileRotation?.enabled && state.profileRotation.profiles && state.profileRotation.profiles.length > 1) {
    const rotationCount = state.profileRotation.profiles.length;
    detectedIdentity = `${detectedIdentity || 'Valid Session'} (Auto-swapping between ${rotationCount} accounts)`;
  }
  
  elements.settingsChatgptProfile.textContent = connected
    ? (detectedIdentity || 'Gemini is verified.')
    : 'Sign in and verify Gemini.';
  const verifiedParts = [
    detected.sourceBrowser && `${detected.sourceBrowser} / ${detected.sourceProfile || 'profile'}`,
    detected.verifiedAt && `verified ${new Date(detected.verifiedAt).toLocaleString()}`
  ].filter(Boolean);
  elements.settingsChatgptVerified.textContent = verifiedParts.join(' · ');
  elements.settingsGptProfile.textContent = customGptConnected
    ? 'Gems and Custom GPTs use the verified Gemini and ChatGPT sessions.'
    : 'Verify Gemini and ChatGPT to unlock Gems and Custom GPTs.';
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
      elements.settingsMetaStatus.textContent = engine !== 'meta'
        ? (metaConnected ? 'Signed in' : 'Off')
        : (metaConnected ? 'Active · verified' : 'Active · connection required');
    }
    if (elements.settingsMetaLogout) {
      elements.settingsMetaLogout.style.display = metaConnected ? 'inline-flex' : 'none';
    }
    if (elements.settingsMetaProfile) {
      const metaIdentity = [metaDetected.name, metaDetected.email].filter(Boolean).join(' · ');
      elements.settingsMetaProfile.textContent = metaConnected
        ? (metaIdentity || 'Meta AI is verified.')
        : 'Sign in on meta.ai, then verify.';
    }
    if (elements.settingsMetaVerified) {
      const metaVerifiedParts = [
        metaDetected.sourceBrowser && `${metaDetected.sourceBrowser} / ${metaDetected.sourceProfile || 'profile'}`,
        metaDetected.verifiedAt && `verified ${new Date(metaDetected.verifiedAt).toLocaleString()}`
      ].filter(Boolean);
      elements.settingsMetaVerified.textContent = metaVerifiedParts.join(' · ');
    }
  }

  const canva = state?.integrations?.canva ?? {};
  const canvaConnected = Boolean(canva.connected) && !canvaLocked();
  const canvaDetected = canva.profile ?? {};
  if (elements.settingsCanvaCard) {
    elements.settingsCanvaCard.classList.toggle('is-connected', canvaConnected);
    if (elements.settingsCanvaStatus) {
      elements.settingsCanvaStatus.textContent = canvaLocked()
        ? 'Coming soon on Windows'
        : canvaConnected ? 'Verified Canva Pro connection' : 'Connection required';
    }
    if (elements.settingsCanvaLogout) {
      elements.settingsCanvaLogout.style.display = canvaConnected ? 'inline-flex' : 'none';
    }
    if (elements.settingsCanvaProfile) {
      const canvaIdentity = [canvaDetected.name, canvaDetected.email].filter(Boolean).join(' · ');
      elements.settingsCanvaProfile.textContent = canvaLocked()
        ? canvaLockMessage()
        : canvaConnected
          ? (canvaIdentity || 'Canva login is optional now. Editable products build PowerPoint + SVG files instead of Magic Layers.')
          : 'Sign in to Canva Pro in Google Chrome Canary, then verify. This is separate from Gemini and ChatGPT.';
    }
    if (elements.settingsCanvaVerified) {
      elements.settingsCanvaVerified.textContent = canvaLocked()
        ? 'Available soon. Other logins are unchanged.'
        : [
          canvaDetected.sourceBrowser && `${canvaDetected.sourceBrowser} / ${canvaDetected.sourceProfile || 'profile'}`,
          canvaDetected.verifiedAt && `verified ${new Date(canvaDetected.verifiedAt).toLocaleString()}`
        ].filter(Boolean).join(' · ');
    }
  }

  applyCanvaLockUi();

  renderSelectedProfileSessions(lastSystemProfiles);
}

function selectSettingsTab(tab) {
  activeSettingsTab = ['profile', 'listing', 'workflow', 'automation', 'notifications', 'updates'].includes(tab) ? tab : 'profile';
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
  const listing = preferences.listingDefaults ?? {};
  const workflow = preferences.workflow ?? {};
  const setValue = (element, value = '') => { if (element) element.value = value ?? ''; };

  setValue(elements.settingsListingTags, (listing.tags ?? []).join(', '));
  setValue(elements.settingsListingSubjects, (listing.subjects ?? []).join(', '));
  setValue(elements.settingsListingGrades, (listing.grades ?? []).join(', '));
  setValue(elements.settingsListingFormats, (listing.formats ?? []).join(', '));
  setValue(elements.settingsListingTaxCode, listing.taxCode);
  setValue(elements.settingsListingCopyright, listing.copyrightDeclaration);
  setValue(elements.settingsListingPricingMode, listing.pricingMode || 'paid');
  setValue(elements.settingsListingPrice, listing.suggestedPrice);
  setValue(elements.settingsListingMultiPrice, listing.multipleLicensePrice);
  setValue(elements.settingsListingPublication, listing.publicationStatus || 'draft');
  setValue(elements.settingsListingThumbnail, listing.thumbnailMode || 'manual');
  setValue(elements.settingsDefaultFormat, workflow.defaultFormat || 'LETTER');
  setValue(elements.settingsDefaultOrientation, workflow.defaultOrientation || 'portrait');
  setValue(elements.settingsWhenComplete, workflow.whenCompleteAction || state?.app?.whenCompleteAction || 'nothing');
  elements.settingsSaveNote.textContent = 'Changes are saved locally and used for future projects.';

  const autoSettings = state?.automationSettings || {};
  setValue(elements.autoStepOverview, autoSettings.overview || 'always');
  setValue(elements.autoStepCharacters, autoSettings.characters || 'always');
  setValue(elements.autoStepInterior, autoSettings.interior || 'always');
  setValue(elements.autoStepEditable, autoSettings.editable || 'ask');
  setValue(elements.autoStepListing, autoSettings.listing || 'always');
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
        option.textContent = `${profileSessionLabel(p)} — ${p.browser} - ${p.profileName} (${p.email || 'No email'}) ${p.isLastUsed ? '[Last Active]' : ''}`.trim();
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
    listingDefaults: {
      tags: elements.settingsListingTags.value,
      subjects: elements.settingsListingSubjects.value,
      grades: elements.settingsListingGrades.value,
      formats: elements.settingsListingFormats.value,
      taxCode: elements.settingsListingTaxCode.value,
      copyrightDeclaration: elements.settingsListingCopyright.value,
      pricingMode: elements.settingsListingPricingMode.value,
      suggestedPrice: elements.settingsListingPrice.value,
      multipleLicensePrice: elements.settingsListingMultiPrice.value,
      publicationStatus: elements.settingsListingPublication.value,
      thumbnailMode: elements.settingsListingThumbnail.value
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
    }
  };
}

async function openSettings() {
  await populateSettingsForm();
  selectSettingsTab(activeSettingsTab);
  elements.settingsDialog.scrollTop = 0;
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
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
        <span class="project-cover" aria-hidden="true" data-letter="${escapeHtml((displayProjectName(project.name) || 'B').trim().charAt(0).toUpperCase())}"></span>
        <span class="project-item-main">
          <strong>${escapeHtml(displayProjectName(project.name))}</strong>
          <span class="project-badges"><span class="project-type-badge">${escapeHtml(projectTypeLabel(project))}</span>${project.productFormat === 'editable' ? '<span class="project-format-badge">Editable</span>' : ''}${generating ? '<span class="project-live-badge">Live</span>' : ''}</span>
          <small>${escapeHtml(projectSetupLabel(project))}</small>
          <span class="project-readiness">${escapeHtml(pageSummary)}</span>
        </span>
        <span class="project-progress-mini">${percent}%</span>
      </button>
    `;
  }).join('');
  const liveSearch = document.getElementById('ui-global-search')?.value;
  if (window.versaUi?.filterProjects) {
    const applied = window.versaUi.filterProjects(liveSearch || '', { revealLibrary: false });
    // #region agent log
    if (String(liveSearch || '').trim()) {
      const rePayload = {sessionId:'1c3662',runId:'search-debug',hypothesisId:'D',location:'renderer.js:renderProjectList',message:'reapplied search after render',data:{liveSearch:String(liveSearch).slice(0,80),applied},timestamp:Date.now()};
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify(rePayload)}).catch(()=>{});
      window.tptDesktop?.debugAgentLog?.(rePayload);
    }
    // #endregion
  } else if (String(liveSearch || '').trim()) {
    // #region agent log
    const missingApi = {sessionId:'1c3662',runId:'search-debug',hypothesisId:'D',location:'renderer.js:renderProjectList',message:'versaUi.filterProjects missing during render',data:{liveSearch:String(liveSearch).slice(0,80)},timestamp:Date.now()};
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify(missingApi)}).catch(()=>{});
    window.tptDesktop?.debugAgentLog?.(missingApi);
    // #endregion
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

function renderJobs(project) {
  const jobs = filterJobs(project.jobs);
  const queueLocksThisProject = isGeneratingThisProject(project);
  const busyBrowser = browserBusy();
  const liveIds = new Set([
    ...(Array.isArray(state?.queue?.activeJobIds) ? state.queue.activeJobIds : []),
    state?.queue?.activeJobId
  ].filter(Boolean));
  elements.jobsTable.classList.toggle('is-storybook-grid', project.projectType === 'storybook');
  elements.jobsTable.innerHTML = jobs.map((job) => {
    const storyText = resolvedStoryText(project, job);
    const isStoryPage = Boolean(storyText) || job.kind === 'story_page';
    const isLive = queueLocksThisProject && liveIds.has(job.id);
    const hasImage = Boolean(job.outputPath);
    const fill = jobFillPercent(job, isLive);
    const liveCopy = job.status === 'generating' || job.status === 'submitted'
      ? 'Filling in'
      : job.status === 'downloading' || job.status === 'validating'
        ? 'Almost there'
        : job.status === 'preparing'
          ? 'Starting'
          : statusLabel(job.status);
    return `
      <article class="page-preview-card status-${escapeHtml(job.status)} ${isStoryPage ? 'story-page-card' : ''} ${job.id === selectedJobId ? 'is-selected' : ''} ${isLive ? 'is-live' : ''} ${hasImage ? 'has-image' : ''}" data-action="select-job" data-job-id="${escapeHtml(job.id)}">
        <div class="page-visual" style="--preview-aspect-ratio: ${previewAspectRatio(project)}; --page-fill: ${fill}%;">
          <div class="page-fill-layer" aria-hidden="true"></div>
          <div class="page-fill-sheen" aria-hidden="true"></div>
          ${hasImage ? `
            <img class="page-generated-image" src="tpt-image://job/${encodeURIComponent(job.id)}?v=${encodeURIComponent(job.updatedAt ?? '')}" alt="Page ${job.pageNumber}">
            <div class="page-placeholder image-missing-placeholder" hidden>
              <strong>${String(job.pageNumber).padStart(3, '0')}</strong>
              <span>File missing</span>
            </div>
          ` : `
            <div class="page-placeholder">
              <strong>${String(job.pageNumber).padStart(3, '0')}</strong>
              <span>${escapeHtml(isLive ? liveCopy : statusLabel(job.status))}</span>
              <em>${fill}%</em>
            </div>
          `}
        </div>
        <div class="page-card-body">
          <div class="page-card-heading">
            <strong class="page-card-title">${escapeHtml(humanPageLabel(job))}</strong>
            <span class="page-card-status">${statusChip(job.status)}</span>
          </div>
          ${isStoryPage ? `
            ${storyText ? `
            <section class="story-page-text-section">
              <span class="page-content-label">Story text</span>
              <p>${escapeHtml(storyText)}</p>
            </section>
            ` : ''}
            <details class="story-image-prompt-details">
              <summary data-action="toggle-page-prompt">
                <span>Image prompt</span>
                <span class="prompt-accordion-icon" aria-hidden="true">⌄</span>
              </summary>
              <div class="story-image-prompt-body">${escapeHtml(job.imagePrompt || job.prompt)}</div>
            </details>
          ` : `
            <details class="page-card-prompt-wrap">
              <summary>Prompt</summary>
              <p class="page-card-prompt">${escapeHtml(job.imagePrompt || job.prompt)}</p>
            </details>
          `}
          <div class="page-card-meta">
            <span>${job.conversationUrl ? 'Conversation saved' : `Attempt ${job.attempts}/5`}</span>
          </div>
        </div>
        <div class="page-card-actions">
          <div class="page-card-tools">
            <button class="row-button" data-action="zoom-job" data-job-id="${escapeHtml(job.id)}" title="Open full-size preview" type="button" ${job.outputPath ? '' : 'disabled'}>⛶</button>
            <button class="row-button" data-action="open-job" data-job-id="${escapeHtml(job.id)}" title="Open saved conversation" type="button" ${busyBrowser || !job.conversationUrl ? 'disabled' : ''}>↗</button>
            <button class="row-button" data-action="edit-job" data-job-id="${escapeHtml(job.id)}" title="Edit image in this conversation" type="button" ${queueLocksThisProject || !job.outputPath || job.editInstruction ? 'disabled' : ''}>✎</button>
            <button class="row-button is-danger" data-action="delete-job-image" data-job-id="${escapeHtml(job.id)}" title="Delete this page image" type="button" ${queueLocksThisProject || !job.outputPath ? 'disabled' : ''}>✕</button>
          </div>
          <button class="row-button is-regen" data-action="${job.status === 'complete' ? 'regenerate-job' : 'retry-job'}" data-job-id="${escapeHtml(job.id)}" title="${job.status === 'complete' ? 'Regenerate this page' : 'Retry this page'}" type="button" ${queueLocksThisProject || job.editInstruction || (job.status === 'complete' && !job.conversationUrl) ? 'disabled' : ''}>${job.status === 'complete' ? 'Regenerate' : 'Retry'}</button>
        </div>
      </article>
    `;
  }).join('') || '<div class="muted">No pages match this filter.</div>';

  elements.jobsTable.querySelectorAll('.page-generated-image').forEach((image) => {
    image.addEventListener('error', () => {
      image.hidden = true;
      const placeholder = image.nextElementSibling;
      if (placeholder) placeholder.hidden = false;
    }, { once: true });
  });
}

function renderDetail(project) {
  const job = selectedJob();
  const disabled = !job;
  // Keep raw prompt data only inside the collapsed disclosure — never in the title.
  elements.detailTitle.textContent = job ? humanPageLabel(job) : 'Select a page';
  elements.detailStatusWrap.innerHTML = job ? statusChip(job.status) : '';
  const promptText = job?.imagePrompt || job?.prompt || '';
  elements.detailPrompt.textContent = promptText || '—';
  elements.detailError.hidden = !job?.lastError;
  elements.detailError.textContent = job?.lastError
    ? `${job.lastErrorCode ? `[${job.lastErrorCode}] ` : ''}${translateLegacyText(job.lastError)}`
    : '';
  if (elements.detailStoryTextWrap && elements.detailStoryText) {
    elements.detailStoryTextWrap.hidden = !job?.storyText;
    elements.detailStoryText.textContent = job?.storyText || '—';
  }
  elements.copyPromptButton.disabled = disabled || !promptText;
  const queueLocksThisProject = isGeneratingThisProject(project);
  const busyBrowser = browserBusy();
  elements.importImageButton.disabled = disabled || queueLocksThisProject;
  const regeneration = job?.status === 'complete';
  if (elements.adjustCropButton) {
    elements.adjustCropButton.hidden = !regeneration || queueLocksThisProject;
  }
  elements.openConversationButton.disabled = disabled || busyBrowser || !job?.conversationUrl;
  elements.openConversationButton.textContent = job?.conversationUrl ? 'Open saved conversation' : 'No conversation saved yet';
  elements.retryJobButton.disabled = disabled
    || queueLocksThisProject
    || Boolean(job?.editInstruction)
    || (regeneration && !job?.conversationUrl);
  elements.retryJobButton.textContent = regeneration ? 'Regenerate' : 'Retry page';
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
        <div class="note-card__meta">
          <strong class="note-card__app">VERSA CLASS</strong>
          <strong class="note-card__kicker">${titleFor(level)}</strong>
        </div>
        <p class="note-card__text">${escapeHtml(translateLegacyText(event.message))}</p>
      </div>
      <time class="note-card__time">${escapeHtml(formatTime(event.createdAt))}</time>
    </article>`;
  }).join('') || '<div class="note-empty">No notifications yet</div>';
}

function getMissingPublicationFields(listing) {
  const missing = [];
  if (!listing?.title) missing.push('Title');
  if (!listing?.description) missing.push('Description');
  if (!listing?.isFreeResource && (!listing?.suggestedPrice || !Number.isFinite(Number.parseFloat(listing.suggestedPrice)))) missing.push('Price');
  if (!listing?.multipleLicensePrice || !Number.isFinite(Number.parseFloat(listing.multipleLicensePrice))) missing.push('Multiple Licenses Price');
  if (!listing?.taxCode) missing.push('Tax Code');
  if (!['original', 'licensed'].includes(listing?.copyrightDeclaration)) missing.push('Copyright Declaration');
  if (!listing?.tags?.length) missing.push('Tags');
  if (!listing?.grades?.length) missing.push('Grades');
  if (!listing?.subjects?.length) missing.push('Subjects');
  return missing;
}

function tptListingReviewApproved(listing) {
  return Boolean(listing?.reviewApprovedAt || listing?.reviewedAt || listing?.uploadStartedAt);
}

function tptListingThumbnailsReady(listing) {
  const thumbnailMode = ['auto', 'manual', 'later'].includes(listing?.thumbnailMode) ? listing.thumbnailMode : 'manual';
  return thumbnailMode !== 'manual' || Boolean(listing?.thumbnailPaths?.[0]);
}

function tptListingPublicationReady(listing) {
  return Boolean(
    listing?.title
    && listing.description
    && listing.taxCode
    && listing.tags?.length
    && listing.grades?.length
    && listing.subjects?.length
    && (listing.isFreeResource === true || Number.isFinite(Number.parseFloat(listing.suggestedPrice)))
    && Number.isFinite(Number.parseFloat(listing.multipleLicensePrice))
    && ['original', 'licensed'].includes(listing.copyrightDeclaration)
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

const CANVA_DASH_STEPS = [
  { id: 'pdf', label: 'Load PDF' },
  { id: 'import', label: 'Import file' },
  { id: 'upload', label: 'Upload 100%' },
  { id: 'thumbnails', label: 'Design ready' },
  { id: 'template', label: 'Template link' },
  { id: 'saved', label: 'Link saved' }
];

function canvaDashboardFromState(project, canvaOp) {
  return canvaOp?.canvaDashboard || state?.canvaLiveDashboard || null;
}

function lastCanvaError(project, dashboard) {
  if (dashboard?.lastError) return dashboard.lastError;
  const events = state?.events || [];
  const hit = [...events].reverse().find((event) => /canva|editable|print pdf|template link/i.test(String(event?.message || '')) && (event.level === 'error' || event.level === 'warn'));
  return hit?.message || null;
}

function renderCanvaProgress(project) {
  const op = activeLiveOperation(project);
  const canvaOp = op?.kind === 'canva' ? op : null;
  const dashboard = canvaDashboardFromState(project, canvaOp);
  const done = Boolean(project?.canvaTemplateLink);
  const percent = canvaOp ? canvaOp.percent : done ? 100 : 0;
  const activeStep = canvaOp?.stepIndex || (done ? 6 : 0);
  const stepStatus = dashboard?.steps || {};
  document.querySelectorAll('[data-canva-step]').forEach((item) => {
    const step = Number(item.dataset.canvaStep);
    const dashId = item.dataset.canvaDash;
    const row = dashId ? stepStatus[dashId] : null;
    const failed = row?.status === 'fail' || (dashboard?.status === 'fail' && dashId && dashboard.step === dashId);
    const finished = done || row?.status === 'ok' || (activeStep && step < activeStep && !failed);
    const current = !failed && ((Boolean(canvaOp) && step === activeStep) || row?.status === 'running');
    item.classList.toggle('is-done', finished && !failed);
    item.classList.toggle('is-active', current);
    item.classList.toggle('is-fail', Boolean(failed));
    item.classList.toggle('is-waiting', !finished && !current && !failed);
    const fill = item.querySelector('.step-fill');
    const pct = item.querySelector('.step-percent');
    const hint = item.querySelector('small');
    const width = failed ? 100 : finished ? 100 : current ? Math.max(18, dashId === 'upload' && dashboard?.upload?.percent != null ? dashboard.upload.percent : percent) : 8;
    if (fill) fill.style.width = `${width}%`;
    if (pct) {
      if (dashId === 'upload' && dashboard?.upload?.percent != null && (current || failed)) {
        pct.textContent = `${Math.round(dashboard.upload.percent)}%`;
      } else {
        pct.textContent = `${failed ? 0 : finished ? 100 : current ? Math.round(percent) : 0}%`;
      }
    }
    if (hint) {
      hint.textContent = failed
        ? 'Failed'
        : finished
          ? 'Finished'
          : current
            ? (row?.message || canvaOp?.message || 'In progress')
            : 'Waiting';
    }
  });
  const dashRoot = document.getElementById('canva-live-dashboard');
  if (dashRoot) {
    dashRoot.classList.toggle('is-live', Boolean(canvaOp) && !canvaLocked());
    dashRoot.classList.toggle('is-fail', Boolean(dashboard?.status === 'fail' || (!canvaOp && dashboard?.lastError && !done)));
  }
  const title = document.getElementById('canva-dash-title');
  const status = document.getElementById('canva-dash-status');
  const attemptEl = document.getElementById('canva-dash-attempt');
  const clockEl = document.getElementById('canva-dash-clock');
  const errorEl = document.getElementById('canva-dash-error');
  const attempt = Number(canvaOp?.attempt || dashboard?.attempt || state?.automation?.stepRetryCount || 0);
  const autoAttempt = state?.automation?.active && state?.automation?.currentStep === 'editable'
    ? Number(state.automation.stepRetryCount || 0) + 1
    : attempt;
  if (title) {
    title.textContent = canvaLocked()
      ? 'Coming soon'
      : canvaOp
        ? (CANVA_DASH_STEPS.find((item) => item.id === dashboard?.step)?.label || canvaOp.label || 'Live')
        : done
          ? 'Template ready'
          : dashboard?.status === 'fail'
            ? 'Stopped — see the error'
            : 'Waiting';
  }
  if (status) {
    status.textContent = canvaLocked()
      ? canvaLockMessage()
      : canvaOp?.message
        || dashboard?.steps?.[dashboard.step]?.message
        || (done ? 'Canva editable layer is ready. Open the template link anytime.' : 'Ready when you build. The print PDF is imported once, then Magic Layer runs page by page.');
  }
  if (attemptEl) {
    const showAttempt = autoAttempt > 1 || (canvaOp && autoAttempt >= 1 && state?.automation?.currentStep === 'editable');
    attemptEl.hidden = !showAttempt;
    attemptEl.textContent = showAttempt ? `Attempt ${autoAttempt}` : '';
  }
  if (clockEl) {
    clockEl.hidden = !canvaOp?.startedAt;
    clockEl.textContent = canvaOp?.startedAt ? `Elapsed ${formatElapsedClock(Date.now() - canvaOp.startedAt)}` : '';
  }
  const errorText = lastCanvaError(project, dashboard);
  if (errorEl) {
    const showError = Boolean(errorText) && (dashboard?.status === 'fail' || !canvaOp) && !done;
    errorEl.hidden = !showError;
    errorEl.textContent = showError ? errorText : '';
  }

  const pdfCopy = document.getElementById('canva-dash-pdf-copy');
  if (pdfCopy) {
    const compression = dashboard?.compression;
    if (compression && (compression.originalBytes || compression.reason || compression.path)) {
      const name = String(compression.path || '').split(/[\\/]/).pop() || 'book.pdf';
      pdfCopy.textContent = compression.skipped
        ? `${name} · ${formatFileSize(compression.originalBytes)}${compression.reason ? ` — ${compression.reason}` : ''}`
        : `${name} · ${formatFileSize(compression.originalBytes)} → ${formatFileSize(compression.outputBytes)}`;
    } else {
      pdfCopy.textContent = canvaOp ? 'Loading the Interior print PDF…' : 'Uses book.pdf prepared in Interior.';
    }
  }
  const upload = dashboard?.upload;
  const uploadPercentEl = document.getElementById('canva-dash-upload-percent');
  const uploadElapsedEl = document.getElementById('canva-dash-upload-elapsed');
  const uploadRemainingEl = document.getElementById('canva-dash-upload-remaining');
  const uploadFill = document.getElementById('canva-dash-upload-fill');
  const uploadCopy = document.getElementById('canva-dash-upload-copy');
  const uploadPct = upload?.percent != null ? Math.max(0, Math.min(100, Number(upload.percent))) : (dashboard?.step === 'upload' ? percent : null);
  if (uploadPercentEl) uploadPercentEl.textContent = uploadPct != null ? `${Math.round(uploadPct)}%` : '—';
  if (uploadElapsedEl) uploadElapsedEl.textContent = upload?.elapsedMs != null ? `Elapsed ${formatElapsedClock(upload.elapsedMs)}` : '';
  if (uploadRemainingEl) {
    const remaining = upload?.idleRemainingMs ?? upload?.remainingMs;
    uploadRemainingEl.textContent = remaining != null ? `${formatElapsedClock(remaining)} left` : '';
  }
  if (uploadFill) uploadFill.style.width = `${uploadPct != null ? uploadPct : 0}%`;
  if (uploadCopy) {
    uploadCopy.textContent = upload?.fileName
      ? `File: ${upload.fileName}`
            : (dashboard?.step === 'upload' ? (canvaOp?.message || 'Waiting for the 100% bar…') : 'The 100% bar appears after Import file.');
  }
  const logEl = document.getElementById('canva-dash-log');
  if (logEl) {
    const rows = Array.isArray(dashboard?.log) ? dashboard.log.slice(-12).reverse() : [];
    logEl.innerHTML = rows.map((row) => {
      const when = row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      return `<li><time>${escapeHtml(when)}</time> ${escapeHtml(row.message || '')}</li>`;
    }).join('') || '<li class="muted">Step messages show up here while Canva runs.</li>';
  }
  if (elements.canvaProgressPercent) elements.canvaProgressPercent.textContent = `${Math.round(percent)}%`;
  if (elements.canvaProgressFill) elements.canvaProgressFill.style.width = `${percent}%`;
  if (elements.canvaProgressMessage) {
    elements.canvaProgressMessage.textContent = canvaLocked()
      ? canvaLockMessage()
      : canvaOp?.message
        || (done ? 'Saved. Open the verified Canva template link anytime.' : 'Ready. Empty page slots fill in as editable vectors are built.');
  }
  if (elements.canvaProgressLabel) {
    elements.canvaProgressLabel.textContent = canvaLocked() ? 'Coming soon' : canvaOp ? 'Live' : done ? 'Ready' : 'Canva editable';
  }
  if (elements.canvaProgressElapsed) {
    elements.canvaProgressElapsed.textContent = canvaOp?.startedAt
      ? `Working ${formatElapsedClock(Date.now() - canvaOp.startedAt)}`
      : '';
  }
  document.getElementById('canva-live-bar')?.classList.toggle('is-live', Boolean(canvaOp) && !canvaLocked());
  if (elements.clearCanvaTemplateButton) {
    elements.clearCanvaTemplateButton.disabled = canvaLocked() || (!project?.canvaTemplateLink && !project?.canvaDesignUrl);
  }
  if (elements.openCanvaTemplateButton) {
    elements.openCanvaTemplateButton.disabled = canvaLocked() || !project?.canvaTemplateLink;
  }
  renderCanvaPageBoard(project, canvaOp);
}

function renderCanvaPageBoard(project, canvaOp) {
  const grid = document.getElementById('canva-page-grid');
  const meta = document.getElementById('canva-page-board-meta');
  const count = document.getElementById('canva-page-board-count');
  if (!grid) return;
  const jobs = [...(project?.jobs || [])].sort((left, right) => (Number(left.pageNumber) || 0) - (Number(right.pageNumber) || 0));
  const progress = Array.isArray(canvaOp?.canvaPageProgress)
    ? canvaOp.canvaPageProgress
    : Array.isArray(project?.canvaPageProgress) ? project.canvaPageProgress : [];
  const byPage = new Map(progress.map((item) => [Number(item.pageNumber), item]));
  const layered = progress.filter((item) => item?.layered).length;
  const missed = progress.filter((item) => item?.error && !item?.layered).length;
  const activeMessage = String(canvaOp?.message || '');
  const activePage = Number(canvaOp?.activeCanvaPage)
    || Number((activeMessage.match(/page (\d+)/i) || [])[1])
    || 0;
  if (meta) {
    if (!jobs.length) {
      meta.textContent = 'Finish interior pages first. Then every page gets an empty slot here, like Interior and Mockups.';
    } else if (canvaOp) {
      meta.textContent = layered
        ? `${layered} of ${jobs.length} done. Each filled card means Magic Layer applied.`
        : 'Empty slots fill in as Magic Layer runs. Waiting pages stay blank until their turn.';
    } else if (layered) {
      meta.textContent = missed
        ? `${layered} filled with Magic Layer applied. ${missed} not separated.`
        : `${layered} of ${jobs.length} pages ready. Template link is the buyer editable.`;
    } else {
      meta.textContent = 'Same idea as Interior and Mockups: slots stay empty until Magic Layer fills them.';
    }
  }
  if (count) count.textContent = `${layered} / ${jobs.length} Magic Layer applied`;
  if (!jobs.length) {
    grid.innerHTML = `<div class="canva-page-empty-state"><strong>No page slots yet</strong><p>Finish interior pages first. The board then shows one empty slot per page, and each slot fills when Magic Layer is applied.</p></div>`;
    return;
  }
  grid.innerHTML = jobs.map((job) => {
    const row = byPage.get(Number(job.pageNumber)) || {};
    const live = Boolean(canvaOp) && !row.layered && !row.error && Number(job.pageNumber) === activePage;
    const filling = Boolean(!row.layered && !row.error && (live || row.started));
    const state = row.layered ? 'layered' : row.error ? 'error' : filling ? 'live' : 'waiting';
    const fill = row.layered
      ? 100
      : filling
        ? Math.max(32, Math.min(88, Number(canvaOp?.percent) || 55))
        : 8;
    const label = row.layered
      ? `Page ${job.pageNumber} done — Magic Layer applied`
      : row.error
        ? 'Not separated'
        : filling
          ? 'Applying Magic Layer…'
          : canvaOp
            ? 'Waiting'
            : 'Not filled';
    const visual = row.layered && job.outputPath
      ? `<img src="tpt-image://job/${encodeURIComponent(job.id)}?v=${encodeURIComponent(job.updatedAt ?? project?.updatedAt ?? '')}" alt="Page ${job.pageNumber}">
         <span class="canva-page-badge">Magic Layer applied ✓</span>`
      : row.layered
        ? `<div class="canva-page-placeholder is-done">
           <strong>${String(job.pageNumber).padStart(2, '0')}</strong>
           <span>Magic Layer applied</span>
           <em>100%</em>
         </div>`
      : `<div class="page-fill-layer" aria-hidden="true"></div>
         <div class="page-fill-sheen" aria-hidden="true"></div>
         <div class="canva-page-placeholder">
           <strong>${String(job.pageNumber).padStart(2, '0')}</strong>
           <span>${escapeHtml(filling ? 'Filling in' : label)}</span>
           <em>${Math.round(fill)}%</em>
         </div>`;
    return `<article class="canva-page-card is-${state}${filling ? ' is-live' : ''}${row.layered ? ' has-image' : ''}" style="--page-fill:${fill}%" data-canva-page="${job.pageNumber}">
      <div class="canva-page-visual">${visual}</div>
      <small>Page ${job.pageNumber}</small>
      <em>${escapeHtml(label)}</em>
    </article>`;
  }).join('');
  grid.querySelector('.canva-page-card.is-live')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function tptThumbnailSlotHtml(project, listing, index, liveOp) {
  const path = listing?.thumbnailPaths?.[index];
  const label = index === 0 ? 'Main Cover' : `Optional mockup ${index}`;
  const completed = (listing?.thumbnailPaths || []).filter(Boolean).length;
  const generating = listing?.status === 'thumbnails_generating' || liveOp?.kind === 'thumbnails';
  const isThis = generating && !path && index === completed;
  const fill = path ? 100 : isThis ? Math.max(28, Number(liveOp?.percent) || 55) : 10;
  if (path) {
    return `<figure class="tpt-thumbnail has-image">
      <img src="tpt-image://thumbnail/${encodeURIComponent(project.id)}/${index}?v=${encodeURIComponent(project.updatedAt ?? '')}" alt="${escapeHtml(label)}">
      <figcaption>${escapeHtml(label)} ✓
        <span>
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
      <strong>${escapeHtml(label)}</strong>
      <span>${isThis ? escapeHtml(liveOp?.message || 'Filling in') : generating ? 'Waiting in line' : 'Ready to generate'}</span>
      <em>${Math.round(fill)}%</em>
    </div>
  </figure>`;
}

function isSeoSkipStub(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return text === 'skipped'
    || text === 'skipped description'
    || text === 'skipped tags'
    || text === 'n/a'
    || text === 'na'
    || text === 'none';
}

function sanitizeSeoListingForUi(listing = {}) {
  const titleRaw = String(listing.title || '').trim();
  const title = isSeoSkipStub(titleRaw) ? '' : titleRaw;
  const descriptionRaw = String(listing.description || '').trim();
  const description = isSeoSkipStub(descriptionRaw) ? '' : descriptionRaw;
  const tags = Array.isArray(listing.tags)
    ? listing.tags.map((entry) => String(entry || '').trim()).filter((entry) => entry && !isSeoSkipStub(entry))
    : String(listing.tags || '')
      .split(/,|\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry && !isSeoSkipStub(entry));
  return { title, description, tags };
}

function formatSeoBundleForUi(listing = {}) {
  const cleaned = sanitizeSeoListingForUi(listing);
  const title = cleaned.title;
  const description = cleaned.description;
  const tags = cleaned.tags.join(', ');
  if (title || description || tags) {
    const text = `TITLE\n${title}\n\nDESCRIPTION\n${description}\n\nTAGS\n${tags}`.trim();
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify({sessionId:'1c3662',runId:'seo-ui',hypothesisId:'A',location:'renderer.js:formatSeoBundleForUi',message:'seo bundle formatted for UI',data:{titleLen:title.length,descriptionLen:description.length,tagLen:tags.length,rawDescriptionWasStub:isSeoSkipStub(listing.description),rawTagsWereStub:Array.isArray(listing.tags)?listing.tags.some(isSeoSkipStub):isSeoSkipStub(listing.tags),bundleHasSkipped:/skipped/i.test(text)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return text;
  }
  const raw = String(listing.seoText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';
  const parsed = sanitizeSeoListingForUi(parseSeoBundleForUi(raw));
  if (!parsed.title && !parsed.description && !parsed.tags.length) return '';
  const text = `TITLE\n${parsed.title}\n\nDESCRIPTION\n${parsed.description}\n\nTAGS\n${parsed.tags.join(', ')}`.trim();
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify({sessionId:'1c3662',runId:'seo-ui',hypothesisId:'A',location:'renderer.js:formatSeoBundleForUi:seoText',message:'seo bundle from seoText fallback',data:{titleLen:parsed.title.length,descriptionLen:parsed.description.length,tagCount:parsed.tags.length,bundleHasSkipped:/skipped/i.test(text)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return text;
}

function parseSeoBundleForUi(rawText = '') {
  const raw = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { title: '', description: '', tags: '' };

  const looksLabeled = /^(TITLE|DESCRIPTION|TAGS)\s*$/im.test(raw.split('\n', 1)[0] || '')
    || /\n(?:TITLE|DESCRIPTION|TAGS)\s*\n/i.test(raw);
  if (looksLabeled) {
    const result = { title: '', description: '', tags: '' };
    let current = null;
    for (const line of raw.split('\n')) {
      const header = line.trim().toUpperCase();
      if (header === 'TITLE' || header === 'DESCRIPTION' || header === 'TAGS') {
        current = header.toLowerCase();
        continue;
      }
      if (!current) continue;
      result[current] = result[current] ? `${result[current]}\n${line}` : line;
    }
    return {
      title: result.title.trim(),
      description: result.description.trim(),
      tags: result.tags.trim()
    };
  }

  const blocks = raw.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length === 1) return { title: blocks[0], description: '', tags: '' };
  if (blocks.length === 2) return { title: blocks[0], description: blocks[1], tags: '' };
  return {
    title: blocks[0],
    description: blocks.slice(1, -1).join('\n\n').trim(),
    tags: blocks[blocks.length - 1].replace(/^tags?:\s*/i, '').trim()
  };
}

function tptListingHtml(project, view = activeWorkspaceView) {
  const listing = project.tptListing || {};
  const liveOp = activeLiveOperation(project);
  const listingLive = liveOp?.kind === 'listing';
  const thumbnails = Array.from({ length: 4 }, (_, index) => tptThumbnailSlotHtml(project, listing, index, liveOp)).join('');
  const showListing = view === 'listing';
  const hasListingDraft = Boolean(project.tptListing);
  const cleanedListing = sanitizeSeoListingForUi(listing);
  const hasRealSeo = Boolean(cleanedListing.title && cleanedListing.description && cleanedListing.tags.length);
  const hasListing = hasListingDraft && (hasRealSeo || Boolean(listing.rawResponse && listing.rawResponse !== '{}'));
  const seoBundle = formatSeoBundleForUi(listing);
  const listingMessage = listingLive
    ? (liveOp.message || 'Drafting best-seller SEO…')
    : hasRealSeo
      ? 'Ready'
      : 'Generate SEO from the finished book PDF.';
  const listingPercent = listingLive ? Math.round(liveOp.percent || 0) : (hasRealSeo ? 100 : 0);
  return `<div class="section-header tpt-section-heading"><div><p class="eyebrow">Studio</p><h3>${showListing ? 'SEO' : 'Mockups'}</h3></div>
      <div class="export-actions">
        ${showListing ? `<button class="button button-primary" data-action="generate-tpt-listing" type="button"${liveOp?.kind === 'listing' ? ' disabled title="SEO is already running."' : ` title="${escapeHtml(stageStartBlockReason('listing', project) || (hasListing ? 'Regenerate best-seller SEO' : 'Draft best-seller SEO from the finished book PDF'))}"`}>${hasListing ? 'Regenerate SEO' : 'Generate SEO'}</button>
        <button class="button button-ghost button-danger" data-action="clear-tpt-listing" type="button" ${hasListing ? '' : 'disabled'}>Delete SEO</button>` : (() => {
          const thumbReason = stageStartBlockReason('thumbnails', project);
          const thumbBusy = liveOp?.kind === 'thumbnails';
          const title = thumbBusy ? 'Mockups are already generating.' : (thumbReason || 'Generate four mockups for this book.');
          return `<button class="button button-gold" data-action="generate-tpt-thumbnails" type="button"${thumbBusy ? ` disabled title="${escapeHtml(title)}"` : ` title="${escapeHtml(title)}"`}>${thumbBusy ? 'Generating…' : 'Generate mockups'}</button>
        <button class="button button-ghost button-danger" data-action="clear-tpt-thumbnails" type="button" ${(listing.thumbnailPaths || []).some(Boolean) ? '' : 'disabled'} title="${(listing.thumbnailPaths || []).some(Boolean) ? 'Delete all mockups for this book.' : 'No mockups to delete yet.'}">Delete all mockups</button>`;
        })()}
      </div>
    </div>
    <div class="stage-live-bar ${listingLive || liveOp?.kind === 'thumbnails' ? 'is-live' : ''}">
      <div class="stage-live-meta">
        <strong>${showListing ? (listingLive ? 'Drafting' : hasRealSeo ? 'Ready' : 'SEO') : (liveOp?.kind === 'thumbnails' ? 'Filling' : 'Mockups')}</strong>
        <span>${showListing ? listingPercent : Math.round(((listing.thumbnailPaths || []).filter(Boolean).length / 4) * 100)}%</span>
      </div>
      <div class="progress-track"><span style="width:${showListing ? listingPercent : Math.round(((listing.thumbnailPaths || []).filter(Boolean).length / 4) * 100)}%"></span></div>
      <p>${escapeHtml(showListing ? listingMessage : (liveOp?.kind === 'thumbnails' ? (liveOp.message || 'Filling…') : ''))}</p>
    </div>
    ${showListing ? `
    <section class="tpt-seo-bundle ${seoBundle ? 'is-ready' : listingLive ? 'is-filling' : 'is-empty'}" data-tpt-publication-settings>
      <div class="tpt-seo-bundle__head">
        <div>
          <p class="eyebrow">One copy block</p>
          <h4>Title · description · tags</h4>
          <p class="muted">Labeled, paste-ready SEO. Edit here, then Save or Copy.</p>
        </div>
        <button class="button button-ghost tpt-seo-bundle__copy" data-action="copy-seo-bundle" type="button" ${seoBundle ? '' : 'disabled'}>Copy SEO</button>
      </div>
      <textarea class="tpt-seo-bundle__text" data-tpt-setting="seo-bundle" rows="18" placeholder="${listingLive ? 'Drafting best-seller SEO…' : 'TITLE\n…\n\nDESCRIPTION\n…\n\nTAGS\n…'}">${escapeHtml(seoBundle)}</textarea>
      <button class="button button-ghost tpt-save-record" data-action="save-tpt-publication-settings" type="button">Save</button>
    </section>
    <details class="tpt-source-response"><summary>Source chat</summary><pre class="prompt-box">${escapeHtml(listing.rawResponse || '—')}</pre></details>` : ''}
    ${showListing ? '' : `<div class="tpt-thumbnails"><div class="tpt-thumbnail-status"><h4>${listing.thumbnailProgress?.completed ?? listing.thumbnailPaths?.filter(Boolean).length ?? 0}/4</h4></div><div class="tpt-thumbnail-grid">${thumbnails}</div></div>`}`;
}

function tptPreviewHtml(project) {
  const listing = project.tptListing || {};
  const videoPath = listing.videoPreviewPath;
  const status = listing.videoPreviewStatus || (videoPath ? 'ready' : 'pending');
  const generating = status === 'generating';
  const failed = status === 'failed';
  const thumbnailCount = listing.thumbnailPaths?.filter(Boolean).length ?? 0;
  const pageCount = project.jobs?.filter((job) => job.outputPath)?.length ?? 0;
  const statusLabel = videoPath ? 'Saved' : generating ? 'Generating' : failed ? 'Needs retry' : 'Ready';
  const player = videoPath
    ? `<video class="tpt-preview-player" controls src="tpt-image://video-preview/${encodeURIComponent(project.id)}?v=${encodeURIComponent(project.updatedAt ?? '')}"></video>`
    : `<div class="tpt-preview-empty">
        <span class="tpt-preview-play" aria-hidden="true"></span>
        <strong>${generating ? 'Generating…' : 'No video yet'}</strong>
        <span>${generating ? 'This can take a few minutes.' : 'Generate after mockups.'}</span>
      </div>`;
  const error = failed && listing.videoPreviewError
    ? `<p class="error-box">${escapeHtml(listing.videoPreviewError)}</p>`
    : '';
  const actionLabel = videoPath ? 'Regenerate video' : generating ? 'Generating…' : 'Generate video';
  return `<div class="section-header tpt-section-heading tpt-preview-heading">
      <div>
        <p class="eyebrow">Preview</p>
        <h3>Video</h3>
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
      <button class="button ${videoPath ? 'button-ghost' : 'button-primary'}" data-action="generate-tpt-preview-video" type="button"${generating ? ' disabled' : ''}>${actionLabel}</button>
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
    const publicationLabel = listing.publicationStatus === 'active' ? 'Active listing' : 'Inactive draft';
    const message = listing.uploadMessage || listing.uploadError || 'Waiting in queue…';

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
  const next = WORKSPACE_PANES.includes(view) ? view : 'overview';
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
    button.classList.toggle('is-active', button.dataset.viewTarget === next);
  });
}

function syncWorkspaceStageHeight() {
  const stage = document.getElementById('workspace-stage');
  if (stage) stage.style.height = '';
}

function shiftWorkspacePane(delta) {
  const index = WORKSPACE_PANES.indexOf(activeWorkspaceView);
  const next = WORKSPACE_PANES[index + delta];
  if (!next) return false;
  activeWorkspaceView = next;
  renderProject();
  return true;
}

function renderProject() {
  const project = activeProject();
  const hasProject = Boolean(project);
  const hasBooks = (state?.projects?.length || 0) > 0;
  elements.emptyState.hidden = hasProject || bundleViewActive || hasBooks;
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

  const isConceptOnly = project.activityCount === 0 && project.projectType !== 'storybook';
  if (elements.projectConceptView) elements.projectConceptView.hidden = !isConceptOnly;
  if (elements.projectStandardView) elements.projectStandardView.hidden = isConceptOnly;
  if (elements.storybookResumePhase2Button) {
    elements.storybookResumePhase2Button.hidden = project.projectType !== 'storybook'
      || !['workflow_failed', 'phase2_failed'].includes(project.storybookPhase);
    elements.storybookResumePhase2Button.dataset.projectId = project.id;
  }

  if (isConceptOnly) {
    if (elements.conceptProjectTitle) elements.conceptProjectTitle.textContent = displayProjectName(project.name);
    if (elements.conceptProjectMeta) elements.conceptProjectMeta.textContent = `Concept Only • 0 pages`;
    if (elements.conceptDisplayAge) elements.conceptDisplayAge.textContent = project.targetAge || 'Not specified';
    if (elements.conceptDisplayDescription) elements.conceptDisplayDescription.textContent = project.description || 'No description provided.';
    if (elements.conceptDisplayHighlights) {
      elements.conceptDisplayHighlights.innerHTML = (Array.isArray(project.highlights) ? project.highlights : [])
        .map((h) => `<li>${escapeHtml(h)}</li>`)
        .join('') || '<li>No highlights saved</li>';
    }
    renderConceptMockups(project);
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
  const liveOp = activeLiveOperation(project);
  if (lastRenderedWorkspaceView !== activeWorkspaceView) {
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  applyWorkspacePanes(activeWorkspaceView);
  const viewChanged = lastRenderedWorkspaceView !== activeWorkspaceView;
  lastRenderedWorkspaceView = activeWorkspaceView;
  const canvaOnlyTick = liveOp?.kind === 'canva' && !viewChanged;
  if (elements.tptListingReview) {
    elements.tptListingReview.hidden = false;
    if (!canvaOnlyTick || !elements.tptListingReview.dataset.filled) {
      elements.tptListingReview.innerHTML = tptListingHtml(project, 'listing');
      elements.tptListingReview.dataset.filled = '1';
    }
  }
  if (elements.tptThumbnailsReview) {
    elements.tptThumbnailsReview.hidden = false;
    if (!canvaOnlyTick || !elements.tptThumbnailsReview.dataset.filled) {
      elements.tptThumbnailsReview.innerHTML = tptListingHtml(project, 'thumbnails');
      elements.tptThumbnailsReview.dataset.filled = '1';
    }
  }
  renderCanvaProgress(project);
  if (elements.tptPreviewReview) {
    elements.tptPreviewReview.hidden = false;
    if (!canvaOnlyTick || !elements.tptPreviewReview.dataset.filled) {
      elements.tptPreviewReview.innerHTML = tptPreviewHtml(project);
      elements.tptPreviewReview.dataset.filled = '1';
    }
  }
  elements.projectMeta.textContent = `${projectSetupLabel(project)} • ${stats.total} ${stats.total === 1 ? 'page' : 'pages'}`;
  elements.projectTitle.textContent = displayProjectName(project.name);
  if (elements.projectFormatToggle) {
    const editable = project.productFormat === 'editable';
    elements.projectFormatToggle.textContent = editable ? 'Editable' : 'Static';
    elements.projectFormatToggle.classList.toggle('is-editable', editable);
    elements.projectFormatToggle.hidden = false;
    document.body.dataset.productFormat = editable ? 'editable' : 'static';
    document.body.dataset.engine = editable ? 'editable' : 'static';
  }
  if (elements.projectTheme) {
    elements.projectTheme.textContent = '';
    elements.projectTheme.hidden = true;
    elements.projectTheme.title = project.outputDir || '';
  }
  elements.statTotal.textContent = String(stats.total);
  elements.statComplete.textContent = String(stats.complete);
  if (elements.statRemaining) elements.statRemaining.textContent = String(stats.remaining);
  const pipeline = (typeof computeProductPipeline === 'function' ? computeProductPipeline : window.computeProductPipeline)(project, liveOp, { canvaLocked: canvaLocked() });
  const characterReferences = (project.characterSheets || []).filter((sheet) => sheet.status === 'complete' && sheet.outputPath).length;
  const characterNames = characters.map((character) => character.name).filter(Boolean);
  const listing = project.tptListing;
  const thumbnailCount = pipeline.thumbnailCount;
  const listingReady = pipeline.listingReady;
  const reviewApproved = tptListingReviewApproved(listing);
  const uploadReady = reviewApproved || ['ready_to_upload', 'uploading_listing', 'listing_form_ready', 'submitting_listing', 'draft_submitted', 'listing_published', 'upload_browser_open'].includes(listing?.status);
  const overviewCanExport = pipeline.pagesDone;
  const characterPct = pipeline.characterPct;
  const canvaPct = pipeline.canvaPct;
  const listingPct = pipeline.listingPct;
  const thumbPct = pipeline.thumbPct;
  const previewPct = pipeline.previewPct;
  const exportPct = overviewCanExport ? (uploadReady ? 100 : listingReady ? 70 : 55) : pipeline.pagePercent;
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
  setMeterWidth('overview-editable-meter', canvaPct);
  setMeterWidth('overview-listing-meter', listingPct);
  setMeterWidth('overview-thumbnails-meter', thumbPct);
  setMeterWidth('overview-preview-meter', previewPct);
  setMeterWidth('overview-export-meter', exportPct);
  const queueHere = Boolean(state?.queue?.running && state.queue.activeProjectId === project.id);
  const stageLive = {
    overall: Boolean(liveOp || queueHere || state?.workBusy?.characters),
    characters: Boolean(state?.workBusy?.characters) || (project.characterSheets || []).some((sheet) => sheet.status === 'generating'),
    interior: queueHere,
    editable: liveOp?.kind === 'canva',
    listing: liveOp?.kind === 'listing',
    thumbnails: liveOp?.kind === 'thumbnails',
    preview: liveOp?.kind === 'preview',
    export: liveOp?.kind === 'export'
  };
  const stageBlocked = {
    interior: false,
    editable: false,
    listing: false,
    thumbnails: false,
    preview: false,
    export: false
  };
  const stageSkipped = {
    editable: !pipeline.editable
  };
  const stepStatus = {
    interior: project.stepInteriorStatus,
    editable: project.stepEditableStatus,
    listing: project.stepListingStatus,
    thumbnails: project.stepThumbnailsStatus,
    preview: project.stepPreviewStatus,
    export: project.stepExportStatus
  };
  const stagePercent = {
    overall: pipeline.percent,
    interior: pipeline.pagePercent,
    editable: canvaPct,
    listing: listingPct,
    thumbnails: thumbPct,
    preview: previewPct,
    export: exportPct
  };
  Object.entries(stagePercent).forEach(([id, pct]) => {
    const skipped = Boolean(stageSkipped[id]);
    const live = Boolean(stageLive[id]);
    const blocked = Boolean(stageBlocked[id]) && pct < 100 && !live;
    const failed = stepStatus[id] === 'failed' && !live;
    const stateName = skipped ? 'skipped' : failed ? 'error' : live ? 'live' : pct >= 100 ? 'done' : blocked ? 'blocked' : pct > 0 ? 'progress' : 'waiting';
    setStagePresentation(id, stateName, { filling: live });
    if (id !== 'overall') setTabMark(id, stateName);
  });
  // Characters stage removed from product UI.
  document.querySelectorAll(
    '.overview-stage-card[data-stage="characters"], [data-view-target="characters"], [data-workspace-pane="characters"], [data-workspace-section="characters"]'
  ).forEach((node) => {
    node.hidden = true;
    node.setAttribute('hidden', '');
  });
  // Canva stage only for editable books.
  const showCanvaStage = project.productFormat === 'editable';
  document.querySelectorAll(
    '.overview-stage-card[data-stage="editable"], [data-view-target="editable"], [data-workspace-pane="editable"]'
  ).forEach((node) => {
    node.hidden = !showCanvaStage;
    if (showCanvaStage) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
  });
  if (!showCanvaStage && activeWorkspaceView === 'editable') {
    activeWorkspaceView = 'overview';
    applyWorkspacePanes('overview');
  }
  if (activeWorkspaceView === 'characters') {
    activeWorkspaceView = 'overview';
    applyWorkspacePanes('overview');
  }
  if (elements.overviewInteriorDetail) {
    elements.overviewInteriorDetail.textContent = stats.remaining === 0 && stats.total > 0
      ? (project.productPdfPath ? 'PDF ready' : 'Pages done')
      : `${stats.remaining} left`;
  }
  if (elements.overviewEditableStatus) {
    const editable = project.productFormat === 'editable';
    elements.overviewEditableStatus.textContent = canvaLocked()
      ? 'Coming soon'
      : !editable
        ? 'Static print'
        : project.canvaTemplateLink
          ? 'PowerPoint ready'
          : stats.complete === stats.total && stats.total > 0
            ? 'Ready to build'
            : 'Waiting for pages';
    elements.overviewEditableDetail.textContent = canvaLocked()
      ? 'Windows — available soon'
      : !editable
        ? 'Toggle Editable'
        : project.canvaTemplateLink
          ? 'Template link saved'
          : 'After pages finish';
  }
  if (elements.canvaEditableStatus) {
    const editable = project.productFormat === 'editable';
    elements.canvaEditableStatus.textContent = canvaLocked()
      ? canvaLockMessage()
      : !editable
        ? 'Mark Editable to unlock Canva Magic Layer.'
        : project.canvaTemplateLink
          ? 'Canva template link saved.'
          : stats.complete === stats.total && stats.total > 0
            ? 'Pages ready. Build Canva layer imports the print PDF, then Magic Layer each page.'
            : 'Finish the pages first.';
  }
  if (elements.canvaPdfStatus) {
    const readyPages = (project.jobs || []).filter((job) => job?.status === 'complete' && job?.outputPath).length;
    elements.canvaPdfStatus.textContent = readyPages
      ? `${readyPages} interior page${readyPages === 1 ? '' : 's'} ready. Print PDF is the Canva import.`
      : '';
  }
  if (elements.canvaEditableLink) {
    elements.canvaEditableLink.textContent = project.canvaTemplateLink || '';
  }
  if (elements.runCanvaEditableButton) {
    const reason = stageStartBlockReason('editable', project);
    const canvaRunning = liveOp?.kind === 'canva';
    elements.runCanvaEditableButton.disabled = canvaRunning || project.productFormat !== 'editable';
    elements.runCanvaEditableButton.title = canvaRunning
      ? 'Canva is already running in the background.'
      : (reason || 'Build the Canva editable layer for this book.');
  }
  document.querySelectorAll('[data-action="run-stage"]').forEach((btn) => {
    const step = btn.dataset.stage;
    if (step === 'characters') {
      btn.hidden = true;
      btn.disabled = true;
      return;
    }
    const reason = stageStartBlockReason(step, project);
    const running = (step === 'interior' && isGeneratingThisProject(project))
      || (step === 'editable' && liveOp?.kind === 'canva')
      || (step === 'listing' && liveOp?.kind === 'listing')
      || (step === 'thumbnails' && liveOp?.kind === 'thumbnails')
      || (step === 'preview' && liveOp?.kind === 'preview')
      || (step === 'export' && liveOp?.kind === 'export');
    const interiorDone = step === 'interior' && stats.total > 0 && stats.remaining === 0;
    if (interiorDone) {
      btn.hidden = true;
      btn.disabled = true;
    } else {
      btn.hidden = step === 'editable' && project.productFormat !== 'editable';
      // Autonomy: keep controls enabled; toast the reason on click if it cannot run.
      btn.disabled = running;
      btn.title = running ? 'This stage is already running.' : (reason || `Start the ${step} stage.`);
      if (step === 'interior') btn.textContent = btn.classList.contains('stage-run-btn') ? 'Start pages' : (btn.id === 'run-interior-button' ? 'Start pages' : btn.textContent);
    }
  });
  document.querySelectorAll('[data-action="regenerate-interior"]').forEach((btn) => {
    const interiorDone = stats.total > 0 && stats.remaining === 0;
    const running = isGeneratingThisProject(project);
    const regenerable = (project.jobs || []).some((job) => job.status === 'complete' && job.conversationUrl);
    btn.hidden = !interiorDone;
    btn.disabled = !interiorDone || running;
    btn.title = running
      ? 'Pages are already regenerating.'
      : !regenerable
        ? 'No saved conversations to regenerate from.'
        : 'Regenerate every completed page in its saved conversation.';
  });
  document.querySelectorAll('[data-action="start-full-automation"]').forEach((btn) => {
    const running = Boolean(state?.automation?.active && !state?.automation?.paused);
    const reason = running
      ? 'Full automation is already running. Pause it to start again.'
      : browserBusyReason();
    btn.disabled = Boolean(reason);
    btn.title = reason || 'Start the full pipeline for this book.';
  });
  elements.overviewListingStatus.textContent = listingReady ? (uploadReady ? 'Reviewed & ready' : 'SEO ready') : 'Not created';
  elements.overviewListingDetail.textContent = listingReady
    ? `${listing?.title || 'Untitled SEO'} • ${listing?.tags?.length ?? 0} tags`
    : 'Last stage · PDF SEO';
  elements.overviewThumbnailCount.textContent = `${thumbnailCount} / 4`;
  elements.overviewThumbnailDetail.textContent = listing?.status === 'thumbnails_generating'
    ? 'Generating…'
    : thumbnailCount === 4 ? 'Saved' : thumbnailCount > 0 ? `${thumbnailCount} saved` : (pipeline.pagesDone ? 'Ready' : 'After pages');
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify({sessionId:'1c3662',runId:'seo-functional',hypothesisId:'A',location:'renderer.js:overviewThumbnailDetail',message:'overview SEO-safe listing status',data:{listingNull:listing==null,status:listing?.status??null,listingReady:Boolean(listingReady),thumb:thumbnailCount},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (elements.overviewPreviewStatus) {
    const previewStatus = listing?.videoPreviewStatus || (listing?.videoPreviewPath ? 'ready' : 'pending');
    elements.overviewPreviewStatus.textContent = listing?.videoPreviewPath
      ? 'Saved'
      : previewStatus === 'generating' ? 'Generating…' : previewStatus === 'failed' ? 'Failed' : 'Not generated';
    elements.overviewPreviewDetail.textContent = listing?.videoPreviewPath
      ? localFileName(listing.videoPreviewPath)
      : thumbnailCount === 0 ? 'After mockups' : 'Ready';
  }
  const submittedToTpt = ['draft_submitted', 'listing_published'].includes(listing?.status) && listing?.uploadVerified;
  elements.overviewExportStatus.textContent = !overviewCanExport
    ? 'Book incomplete'
    : listing?.status === 'draft_submitted' && listing?.uploadVerified
      ? 'Draft submitted'
      : listing?.status === 'listing_published' && listing?.uploadVerified
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
  elements.runButton.disabled = Boolean(stageStartBlockReason('interior', project));
  elements.runButton.hidden = false;
  elements.runButton.textContent = 'Start';
  elements.runButton.title = stageStartBlockReason('interior', project) || 'Start interior page generation.';
  const pauseEnabled = isPipelineBusy();
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
  elements.outputFolderButton.title = 'Choose or change the output folder anytime.';
  const canExport = Number(stats.complete) > 0 || Boolean(project.productPdfPath || project.tptListing?.productPdfPath);
  elements.exportAllFilesButton.disabled = !canExport;
  if (elements.generateTptListingButton) {
    const reason = stageStartBlockReason('listing', project);
    elements.generateTptListingButton.disabled = liveOp?.kind === 'listing';
    elements.generateTptListingButton.title = liveOp?.kind === 'listing' ? 'Listing is already running.' : (reason || 'Start the listing stage.');
  }
  if (elements.generateTptThumbnailsButton) {
    const reason = stageStartBlockReason('thumbnails', project);
    elements.generateTptThumbnailsButton.disabled = liveOp?.kind === 'thumbnails';
    elements.generateTptThumbnailsButton.title = liveOp?.kind === 'thumbnails' ? 'Mockups are already generating.' : (reason || 'Start mockups.');
  }
  if (elements.generateTptPreviewVideoButton) {
    const reason = stageStartBlockReason('preview', project);
    elements.generateTptPreviewVideoButton.disabled = liveOp?.kind === 'preview';
    elements.generateTptPreviewVideoButton.title = liveOp?.kind === 'preview' ? 'Preview is already generating.' : (reason || 'Start the preview video.');
  }
  if (elements.openTptUploadButton) {
    elements.openTptUploadButton.disabled = !project.tptListing?.productPdfPath;
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
  elements.exportCaption.textContent = canExport ? 'Ready' : 'Add pages first';
  if (elements.tptListingCaption) {
    elements.tptListingCaption.textContent = project.tptListing?.title
      ? `${project.tptListing.uploadMessage || `Draft ready: ${project.tptListing.title} • ${project.tptListing.thumbnailProgress?.completed ?? project.tptListing.thumbnailPaths?.filter(Boolean).length ?? 0}/4 thumbnails${project.tptListing.status === 'thumbnails_failed' ? ' • retry missing thumbnails' : ''}.`}`
      : canExport ? 'Create listing.' : 'Finish pages first.';
  }
  renderEvents(project);
  if (!canvaOnlyTick) {
    renderJobs(project);
    renderDetail(project);
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
    if (elements.automationBarLabel) elements.automationBarLabel.textContent = 'Automation Ready';
    const dot = bar.querySelector('.automation-pulsing-dot');
    if (dot) dot.style.animation = 'none';
  } else if (autoState.paused) {
    if (elements.automationStartBtn) elements.automationStartBtn.hidden = true;
    if (elements.automationPauseBtn) elements.automationPauseBtn.hidden = true;
    if (elements.automationResumeBtn) elements.automationResumeBtn.hidden = false;
    if (elements.automationBarLabel) elements.automationBarLabel.textContent = 'Automation Paused';
    const dot = bar.querySelector('.automation-pulsing-dot');
    if (dot) dot.style.animation = 'none';
  } else {
    if (elements.automationStartBtn) elements.automationStartBtn.hidden = true;
    if (elements.automationPauseBtn) elements.automationPauseBtn.hidden = false;
    if (elements.automationResumeBtn) elements.automationResumeBtn.hidden = true;
    if (elements.automationBarLabel) elements.automationBarLabel.textContent = 'Automation Active';
    const dot = bar.querySelector('.automation-pulsing-dot');
    if (dot) dot.style.animation = '';
  }

  const { currentBookIndex = 0, totalBooks = 0, currentStep = '' } = autoState;
  
  if (elements.automationBarDetail) {
    let stepLabel = currentStep;
    if (stepLabel === 'overview') stepLabel = 'Overview & Idea Extraction';
    if (stepLabel === 'characters') stepLabel = 'Character Generation';
    if (stepLabel === 'interior') stepLabel = 'Book Interior Generation';
    if (stepLabel === 'listing') stepLabel = 'TPT Listing Generation';
    if (stepLabel === 'thumbnails') stepLabel = 'Marketing Thumbnails Creation';
    if (stepLabel === 'export') stepLabel = 'PDF, ZIP & PPTX Exporting';

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
      elements.automationBarDetail.textContent = 'Starting pipeline...';
    }
  }

  if (elements.automationOverallFill) {
    if (totalBooks > 0) {
      const stepIndex = ['overview', 'characters', 'interior', 'listing', 'thumbnails', 'export'].indexOf(currentStep);
      const stepProgress = Math.max(0, stepIndex) / 6;
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
    elements.backgroundGenerationText.textContent = `"${displayProjectName(generating.name)}" is generating in the background. This book stays fully open.`;
  }
}

function render() {
  renderUpdate();
  renderBrowser();
  renderAuth();
  renderSettingsConnections();
  renderProjectList();
  renderProject();
  renderBundleQueue();
  renderAutomationBar();
  renderBackgroundGenerationBar();
  renderWindowsUrlPageSetup();
  applyCanvaLockUi();
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

  elements.cropDialogTitle.textContent = `Adjust Page ${job.pageNumber}: ${job.title}`;
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

function openProjectDialog() {
  elements.projectForm.reset();
  elements.bulkPromptsText.value = '';
  storybookReviewState = null;
  storybookGenerationPending = false;
  storySelectedPhotoPath = null;
  if (elements.storyCharacterPhoto) elements.storyCharacterPhoto.value = '';
  if (elements.storyUploadFilename) elements.storyUploadFilename.textContent = 'No photo selected';
  if (elements.storyClearUploadBtn) elements.storyClearUploadBtn.classList.add('hidden');
  applyNewProjectDefaults();
  showProjectMethodStep();
  renderBulkPromptCount();
  renderPageOutputSpec();
  elements.projectDialog.showModal();
}

async function handleAction(action, target) {
  const project = activeProject();
  const jobId = target.dataset.jobId ?? selectedJobId;
  if (action === 'check-update') {
    return invoke(async () => {
      showToast('Checking official servers for updates…', 'info');
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
      showToast('Restart the app to load appearance settings.', 'warning');
      return;
    }
    return invoke(() => api.setAppearance(appearance), { refresh: true });
  }
  if (action === 'close-settings') return elements.settingsDialog.close();
  if (action === 'select-settings-tab') return selectSettingsTab(target.dataset.settingsTarget);
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
  if (action === 'settings-manage-canva') {
    if (canvaLocked()) {
      showToast(canvaLockMessage(), 'warning');
      return;
    }
    return invoke(() => openLoginSession({ target: 'canva' }), {
      successMessage: 'Chrome Canary opened on Canva. Sign in to Canva Pro, then click Verify Canva.',
      refresh: false
    });
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
    elements.settingsChatgptStatus.textContent = 'Checking Gemini in the background';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'gemini' }));
      if (result?.authenticated) showToast('Gemini session verified.', 'success');
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
    if (elements.settingsMockupsStatus) elements.settingsMockupsStatus.textContent = 'Checking ChatGPT in the background';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'chatgpt' }));
      if (result?.authenticated) showToast('ChatGPT session verified.', 'success');
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
    if (elements.settingsMetaStatus) elements.settingsMetaStatus.textContent = 'Checking Meta in the background';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'meta' }));
      if (result?.authenticated) showToast('Meta session verified. Turn it On to generate images.', 'success');
      return result;
    } finally {
      target.disabled = false;
      target.textContent = originalText;
    }
  }
  if (action === 'settings-verify-canva') {
    if (canvaLocked()) {
      showToast(canvaLockMessage(), 'warning');
      return;
    }
    const originalText = target.textContent;
    target.disabled = true;
    target.textContent = 'Verifying…';
    if (elements.settingsCanvaStatus) elements.settingsCanvaStatus.textContent = 'Checking Canva in the background';
    try {
      const result = await invoke(() => verifyLoginSession({ target: 'canva' }));
      if (result?.authenticated) showToast('Canva Pro session verified.', 'success');
      return result;
    } finally {
      target.disabled = false;
      target.textContent = originalText;
    }
  }
  if (action === 'settings-logout-openai') {
    const confirmed = confirm('Log out of the verified ChatGPT mockup session? Gemini stays connected.');
    if (!confirmed) return;
    const btn = elements.settingsOpenaiLogout;
    const originalText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Logging out…';
    }
    try {
      await invoke(() => api.logoutOpenAi());
      showToast('Logged out of ChatGPT mockup session.', 'success');
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
    return invoke(() => api.openMockupsGpt(), { successMessage: 'Mockups Custom GPT opened with the verified ChatGPT profile.', refresh: false });
  }
  if (action === 'settings-logout-chatgpt') {
    const confirmed = confirm('Are you sure you want to log out of your Gemini session? This will clear the imported session cookies from the app.');
    if (!confirmed) return;
    const btn = elements.settingsChatgptLogout;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Logging out…';
    try {
      await invoke(() => api.logoutChatGpt());
      showToast('Logged out of Gemini session.', 'success');
      await populateSettingsForm();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
    return;
  }
  if (action === 'settings-logout-meta') {
    const confirmed = confirm('Log out of Meta only? ChatGPT and Gemini stay signed in.');
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
      showToast('Logged out of Meta. ChatGPT and Gemini were not signed out.', 'success');
      await populateSettingsForm();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
    return;
  }
  if (action === 'settings-logout-canva') {
    if (canvaLocked()) {
      showToast(canvaLockMessage(), 'warning');
      return;
    }
    const confirmed = confirm('Log out of Canva only? ChatGPT, Gemini, and Meta stay signed in.');
    if (!confirmed) return;
    const btn = elements.settingsCanvaLogout;
    const originalText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Logging out…';
    }
    try {
      if (typeof api.logoutCanva !== 'function') throw new Error('Restart the app to load Canva logout.');
      await invoke(() => api.logoutCanva());
      showToast('Logged out of Canva. Other sessions were not signed out.', 'success');
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
    const view = step === 'editable' ? 'editable' : step;
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
    if (step === 'interior') return handleAction('start', target);
    if (step === 'editable') return handleAction('run-canva-editable', target);
    if (step === 'listing') return handleAction('generate-tpt-listing', target);
    if (step === 'thumbnails') return handleAction('generate-tpt-thumbnails', target);
    if (step === 'preview') return handleAction('generate-tpt-preview-video', target);
    if (step === 'export') return handleAction('export-all-files', target);
    showToast(`Unknown stage "${step}".`, 'warning');
    return;
  }
  if (action === 'start-full-automation') {
    if (!project?.id) {
      showToast('Select a book first.', 'warning');
      return;
    }
    const reason = state?.automation?.active && !state?.automation?.paused
      ? 'Full automation is already running. Pause it to start again.'
      : browserBusyReason();
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => api.startAutomation(project.id), { successMessage: 'Full automation started for this book.' });
  }
  if (action === 'run-canva-editable') {
    if (!project) return;
    if (canvaLocked()) {
      showToast(canvaLockMessage(), 'warning');
      return;
    }
    const reason = stageStartBlockReason('editable', project);
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => {
      if (typeof api.runCanvaEditable !== 'function') throw new Error('Restart the app to load Canva editable.');
      return api.runCanvaEditable(project.id);
    }, { successMessage: 'Canva Magic Layer finished. Template link saved.' });
  }
  if (action === 'open-canva-template') {
    if (!project?.canvaTemplateLink) {
      showToast('No template link yet. Build Canva layer first.', 'warning');
      return;
    }
    return invoke(() => api.openExternal(project.canvaTemplateLink), { refresh: false });
  }
  if (action === 'clear-canva-template') {
    if (!window.confirm('Clear the Canva template link so you can rebuild Magic Layers?')) return;
    return invoke(() => api.clearCanvaTemplate(project.id), { successMessage: 'Canva template cleared.' });
  }
  if (action === 'clear-tpt-listing') {
    if (!window.confirm('Delete this listing, its mockups, and preview video? You can generate them again.')) return;
    return invoke(() => api.clearTptListing(project.id), { successMessage: 'Listing deleted.' });
  }
  if (action === 'clear-tpt-thumbnails') {
    if (!window.confirm('Delete all listing mockups? The four slots stay so you can generate them again.')) return;
    return invoke(() => api.clearTptThumbnails(project.id), { successMessage: 'Mockups deleted.' });
  }
  if (action === 'clear-tpt-thumbnail') {
    if (!window.confirm('Delete this mockup? The slot stays empty until you regenerate it.')) return;
    return invoke(() => api.clearTptThumbnail(project.id, Number.parseInt(target.dataset.thumbnailIndex, 10)), { successMessage: 'Mockup deleted.' });
  }
  if (action === 'clear-competitor-mockups') {
    if (!window.confirm('Delete the competitor listing mockups for this book?')) return;
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
    const next = project.productFormat === 'editable' ? 'static' : 'editable';
    if (next === 'editable' && canvaLocked()) {
      showToast(canvaLockMessage(), 'warning');
    }
    return invoke(() => api.setProjectFormat(project.id, next), {
      successMessage: next === 'editable'
        ? (canvaLocked() ? 'Marked editable. Build Editable will create PowerPoint + SVG pages.' : 'Marked editable (PowerPoint + SVG).')
        : 'Marked static (print only).'
    });
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
      showToast(`Storybook workflow recovered ${result.parsed.pages.length} story pages and both covers.`, 'success');
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
    target.textContent = 'Generating Character Reference…';
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
      target.textContent = 'Generate Character Reference';
      return;
    }
  }
  if (action === 'choose-prompt-method') return showProjectPromptStep();
  if (action === 'choose-analysis-method') return showProjectAnalysisInputStep();
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
      title: `${context.project.highlights?.characters?.[index]?.name || `Character ${index + 1}`} — Character Reference`
    }) : null).filter(Boolean);
    showImagePreview(characterItems, characterItems.findIndex((item) => item.title.startsWith(`${context.character.name} —`)));
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
    activeWorkspaceView = 'overview';
    lastRenderedWorkspaceView = null;
    bundleViewActive = false; // exit bundle view when switching to a project
    document.body.dataset.studioPin = '';
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
    activeWorkspaceView = target.dataset.viewTarget || 'overview';
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
  if (action === 'retry-job') return invoke(() => api.retryJob(jobId), { successMessage: 'This page will retry in the same ordered slot.' });
  if (action === 'delete-job-image') {
    if (!window.confirm('Delete this page image? You can regenerate it after.')) return;
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
      showToast(`"${displayProjectName(generatingProjectRecord()?.name || 'Another book')}" is generating in the background. Pause it only if you want to generate this book instead.`, 'info');
      return;
    }
    const result = await invoke(() => api.startQueue(project.id), { refresh: true });
    if (!result?.cancelled) showToast('Generation started.', 'success');
    return result;
  }
  if (action === 'pause') return invoke(() => api.pauseQueue(), { successMessage: 'Stopped. Start again when you are ready.' });
  if (action === 'retry-all') return invoke(() => api.retryAll(project.id), { successMessage: 'Incomplete pages reset and ready.' });
  if (action === 'regenerate-interior') {
    if (!project?.jobs?.length) return;
    const targets = project.jobs.filter((job) => job.status === 'complete' && job.conversationUrl);
    if (!targets.length) {
      showToast('No saved conversations to regenerate from.', 'warning');
      return;
    }
    if (!window.confirm(`Regenerate ${targets.length} page${targets.length === 1 ? '' : 's'} in their saved conversations?`)) return;
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
    showToast(queued ? `Regenerating ${queued} page${queued === 1 ? '' : 's'}.` : 'Could not queue regenerate.', queued ? 'success' : 'warning');
    return renderProject();
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
  if (action === 'export-all-files') {
    const exportMode = elements.exportModeSelect?.value || 'STANDARD_SEQUENTIAL';
    const path = await invoke(() => api.exportAllFiles(project.id, { exportMode }), { successMessage: 'Complete book folder exported.' });
    if (path) api.revealPath(path);
    return path;
  }
  if (action === 'generate-tpt-listing') {
    const reason = stageStartBlockReason('listing', project);
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => api.generateTptListing(project.id), { successMessage: 'Best-seller SEO saved (title, description, tags).' });
  }
  if (action === 'generate-tpt-thumbnails') {
    const reason = stageStartBlockReason('thumbnails', project);
    if (reason) {
      showToast(reason, 'warning');
      return;
    }
    return invoke(() => api.generateTptThumbnails(project.id), { successMessage: 'Four mockups generated and saved.' });
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
  if (action === 'regenerate-tpt-field') return invoke(() => api.regenerateTptField(project.id, target.dataset.tptField), { successMessage: 'Listing field regenerated.' });
  if (action === 'copy-seo-bundle') {
    const root = document.querySelector('[data-workspace-pane="listing"]') || target.closest('.tpt-seo-bundle');
    const text = root?.querySelector('[data-tpt-setting="seo-bundle"]')?.value?.trim() || '';
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify({sessionId:'1c3662',runId:'seo-ui',hypothesisId:'E',location:'renderer.js:copy-seo-bundle',message:'copy SEO clicked',data:{textLen:text.length,hasSkipped:/skipped/i.test(text),head:text.slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!text) {
      showToast('Generate SEO first.', 'warning');
      return;
    }
    if (/skipped/i.test(text)) {
      showToast('SEO still has skip stubs. Regenerate SEO first.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('SEO copied.', 'success');
    } catch {
      showToast('Could not copy SEO.', 'error');
    }
    return;
  }
  if (action === 'save-tpt-publication-settings') {
    const root = document.querySelector('[data-workspace-pane="listing"]') || target.closest('[data-tpt-publication-settings]');
    if (!root) return;
    const seoRaw = root.querySelector('[data-tpt-setting="seo-bundle"]')?.value;
    const parsedSeo = seoRaw != null ? parseSeoBundleForUi(seoRaw) : null;
    if (!parsedSeo || (!parsedSeo.title && !parsedSeo.description && !parsedSeo.tags && !String(seoRaw || '').trim())) {
      showToast('Generate or paste SEO first.', 'warning');
      return;
    }
    return invoke(() => api.updateTptPublication(project.id, {
      title: parsedSeo.title,
      description: parsedSeo.description,
      tags: parsedSeo.tags,
      seoText: String(seoRaw || '').trim()
    }), { successMessage: 'SEO saved.' });
  }
  if (action === 'choose-tpt-asset') {
    return invoke(() => api.chooseTptAsset(project.id, target.dataset.tptAsset), { successMessage: 'Optional TPT asset saved locally.' });
  }
  if (action === 'clear-tpt-asset') {
    return invoke(() => api.clearTptAsset(project.id, target.dataset.tptAsset), { successMessage: 'Optional TPT asset removed from this listing record.' });
  }
  if (action === 'mark-tpt-ready') {
    if (!window.confirm('Confirm that you reviewed the product PDF, full TPT metadata, all commercial fields, tax code, taxonomy, thumbnail mode, optional assets, standards, copyright declaration, and Draft/Active status. Mark this listing ready for upload? Starting upload will prepare and submit an INACTIVE DRAFT automatically. Active publication still keeps its separate final confirmation.')) return;
    return invoke(() => api.markTptReady(project.id), { successMessage: 'Project marked ready to upload.' });
  }
  if (action === 'preview-tpt-thumbnail') {
    const index = Number.parseInt(target.dataset.thumbnailIndex, 10);
    const items = thumbnailPreviewItems(project);
    showImagePreview(items, items.findIndex((item) => item.title === `TPT Thumbnail ${index + 1}`));
    return;
  }
  if (action === 'regenerate-tpt-thumbnail') return invoke(() => api.regenerateTptThumbnail(project.id, Number.parseInt(target.dataset.thumbnailIndex, 10)), { successMessage: 'Thumbnail regeneration started.' });
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
      return await invoke(() => api.startTptUploading(project.id), { successMessage: project.tptListing?.publicationStatus === 'active'
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
    const statusLabel = listing.publicationStatus === 'active' ? 'ACTIVE and PUBLIC' : 'an INACTIVE DRAFT';
    const confirmation = `Final confirmation: click Submit on Teachers Pay Teachers and save “${listing.title || project.name}” as ${statusLabel}? The product PDF, ${imageCount} manual listing image${imageCount === 1 ? '' : 's'}, optional previews, and reviewed listing metadata have been transmitted to TPT. This action will create the listing.`;
    if (!window.confirm(confirmation)) return;
    return invoke(() => api.submitTptListing(project.id), { successMessage: `TPT ${listing.publicationStatus === 'active' ? 'active listing' : 'draft'} submitted and verified.` });
  }
  if (action === 'submit-tpt-draft') {
    if (!window.confirm('Submit this prepared product to Teachers Pay Teachers as an INACTIVE DRAFT? The selected product files, listing images, and reviewed metadata will be sent to TPT.')) return;
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
  const swipe = (delta) => {
    const now = Date.now();
    if (now - lastSwipeAt < 380) return;
    lastSwipeAt = now;
    shiftWorkspacePane(delta);
  };
  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (interactive(event.target)) return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
  });
  stage.addEventListener('pointerup', (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy)) return;
    swipe(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { tracking = false; });
  stage.addEventListener('wheel', (event) => {
    if (interactive(event.target)) return;
    if (Math.abs(event.deltaX) < 50 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
    event.preventDefault();
    swipe(event.deltaX > 0 ? 1 : -1);
  }, { passive: false });
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => syncWorkspaceStageHeight());
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (interactive(event.target)) return;
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
  const action = selectedJob()?.status === 'complete' ? 'regenerate-job' : 'retry-job';
  handleAction(action, elements.retryJobButton).catch(() => {});
});
elements.exportPdfButton.addEventListener('click', () => handleAction('export-pdf', elements.exportPdfButton).catch(() => {}));
elements.exportZipButton.addEventListener('click', () => handleAction('export-zip', elements.exportZipButton).catch(() => {}));
elements.exportPptxButton.addEventListener('click', () => handleAction('export-pptx', elements.exportPptxButton).catch(() => {}));
elements.exportAllFilesButton.addEventListener('click', () => handleAction('export-all-files', elements.exportAllFilesButton).catch(() => {}));


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
    showToast('The TXT file is larger than 5 MB.', 'error');
    return;
  }
  try {
    elements.bulkPromptsText.value = await file.text();
    const count = renderBulkPromptCount();
    showToast(`Loaded ${count} ${count === 1 ? 'prompt' : 'prompts'} from ${file.name}.`, 'success');
  } catch (error) {
    showToast(`Could not read the file: ${errorMessage(error)}`, 'error');
  }
});

elements.analysisTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-analysis-mode]');
  if (!button) return;
  setAnalysisMode(button.dataset.analysisMode);
});

elements.startAnalysisButton.addEventListener('click', async () => {
  if (state?.app?.loginRequired) {
    showToast('Connect Gemini before starting analysis.', 'error');
    openAuthManager();
    return;
  }

  if (currentAnalysisMode === 'story') {
    const storyIdea = elements.storyIdea ? elements.storyIdea.value.trim() : '';
    const storyPageCountVal = elements.storyPageCount ? Number.parseInt(elements.storyPageCount.value, 10) : 10;
    const storyAgeRange = elements.storyAgeRange ? elements.storyAgeRange.value.trim() : '';
    const storyLanguage = elements.storyLanguage ? elements.storyLanguage.value.trim() : '';

    if (!storyIdea) {
      showToast('Enter your story idea first.', 'error');
      elements.storyIdea?.focus();
      return;
    }
    if (!storyPageCountVal || storyPageCountVal < 1 || storyPageCountVal > 100) {
      showToast('Enter a valid page count between 1 and 100.', 'error');
      elements.storyPageCount?.focus();
      return;
    }
    if (!storyAgeRange) {
      showToast('Enter the target age range.', 'error');
      elements.storyAgeRange?.focus();
      return;
    }
    if (!storyLanguage) {
      showToast('Enter the story language.', 'error');
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
      elements.projectDialogTitle.textContent = 'Building Storybook in 5 Stages…';
    }

    storybookGenerationPending = true;
    storybookReviewState = null;
    try {
      const result = await invoke(() => api.generateStorybook(payload), { refresh: false });
      storybookGenerationPending = false;
      storySelectedPhotoPath = null;
      if (elements.storyCharacterPhoto) elements.storyCharacterPhoto.value = '';
      if (elements.storyUploadFilename) elements.storyUploadFilename.textContent = 'No photo selected';
      if (elements.storyClearUploadBtn) elements.storyClearUploadBtn.classList.add('hidden');
      await refreshState();
      if (elements.projectDialog.open) {
        renderStorybookReviewModal(result, 'complete');
      } else if (result.project?.id) {
        await api.selectProject(result.project.id);
      }
      showToast(`Storybook Studio saved ${result.parsed.pages.length + 2} official pages.`, 'success');
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
    showToast('Enter a competitor product URL first.', 'error');
    elements.analysisProductUrl.focus();
    return;
  }
  if (!isUrl && !ideaText) {
    showToast('Describe your book idea first.', 'error');
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
    analysisResult = result;
    const { analysis } = result;

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
    showToast('No active analysis session found.', 'error');
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
  const payload = {
    projectId: analysisResult?.project?.id,
    conversationUrl: analysisResult.conversationUrl,
    pageCount,
    format,
    orientation: elements.analysisProjectOrientation.value,
    name: analysisResult.analysis?.title,
    theme: analysisResult.analysis?.title,
    niche: analysisResult.analysis?.description,
    includeCompetitorMockups
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
  } catch (error) {
    showProjectAnalysisResultStep();
  }
});

if (elements.conceptGeneratePromptsBtn) {
  elements.conceptGeneratePromptsBtn.addEventListener('click', async () => {
    const project = activeProject();
    if (!project) return;
    if (state?.app?.loginRequired) {
      showToast('Connect Gemini before generating prompts.', 'error');
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

    elements.projectDialog.showModal();
    showProjectPromptsLoadingStep(pageCount, mockupCount);

    try {
      const updatedProject = await invoke(() => api.generatePromptsAndCreateProject(payload), {
        successMessage: `Generated ${pageCount} page prompts for this project!`
      });
      elements.projectDialog.close();
      if (updatedProject?.id) {
        await api.selectProject(updatedProject.id);
      }
    } catch (error) {
      elements.projectDialog.close();
      showToast(`Prompt generation failed: ${errorMessage(error)}`, 'error');
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
    elements.storyUploadFilename.textContent = 'No photo selected';
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
    elements.settingsSaveNote.textContent = 'Saved locally. New listing and workflow defaults are active.';
  } catch (error) {
    elements.settingsSaveNote.textContent = errorMessage(error);
  } finally {
    elements.settingsSaveButton.disabled = false;
    elements.settingsSaveButton.textContent = 'Save settings';
  }
});

elements.settingsDialog.addEventListener('cancel', () => {
  elements.settingsSaveNote.textContent = 'Changes are saved locally and used for future projects.';
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

elements.projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.projectForm);
  const payload = Object.fromEntries(formData.entries());
  payload.sourceMode = 'bulk';
  if (renderBulkPromptCount() === 0) {
    showToast('Paste at least one prompt.', 'error');
    elements.bulkPromptsText.focus();
    return;
  }
  try {
    await invoke(() => api.createProject(payload), {
      successMessage: `Created an ordered ${bulkPromptCount()}-page book project.`
    });
    storySelectedPhotoPath = null;
    if (elements.storyCharacterPhoto) elements.storyCharacterPhoto.value = '';
    if (elements.storyUploadFilename) elements.storyUploadFilename.textContent = 'No photo selected';
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
    ? 'Opening ChatGPT in Google Chrome Canary…'
    : (meta
      ? 'Opening Meta in Google Chrome Canary…'
      : (geminiReady
        ? 'Signing in with the Google account saved in Settings…'
        : 'Opening Gemini in Google Chrome Canary…'));
  try {
    const result = await invoke(() => openLoginSession({ target: authTarget }), { refresh: false });
    elements.authStatusText.textContent = chatgpt
      ? `${result?.browserLabel || 'Google Chrome Canary'} is ready for ChatGPT sign-in. Finish login, then click Verify ChatGPT. The window hides after that.`
      : (meta
        ? `${result?.browserLabel || 'Google Chrome Canary'} is ready for Meta sign-in. Finish login, then click Verify Meta.`
        : (result?.signedIn
          ? 'Gemini signed in with your saved Google profile. Click Verify Gemini if the status is not green yet.'
          : `${result?.browserLabel || 'Google Chrome Canary'} is on Gemini. Click Sign in if the guest page is showing — your saved Google account is already listed.`));
  } catch (error) {
    elements.authStatusText.textContent = `Could not open the browser: ${errorMessage(error)}`;
  }
});

elements.authVerifyButton.addEventListener('click', async () => {
  const chatgpt = authTarget === 'chatgpt';
  const meta = authTarget === 'meta';
  elements.authStatusText.textContent = chatgpt
    ? 'Checking your ChatGPT login in the background…'
    : (meta ? 'Checking your Meta login in the background…' : 'Checking your Gemini login in the background…');
  elements.authVerifyButton.disabled = true;
  try {
    const result = await invoke(() => verifyLoginSession({ target: authTarget }));
    elements.authStatusText.textContent = result?.authenticated
      ? (chatgpt ? 'ChatGPT connected.' : (meta ? 'Meta AI connected.' : 'Gemini connected.'))
      : (chatgpt ? 'ChatGPT is not valid yet. Stay signed in, then verify again.' : (meta ? 'Meta is not valid yet. Stay signed in, then verify again.' : 'Gemini is not valid yet. Stay signed in, then verify again.'));
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

api.onStateChanged((nextState) => {
  state = nextState;
  render();
});

if (typeof api.onLoginProgress === 'function') {
  api.onLoginProgress(({ message }) => {
    if (message && elements.authDialog.open) elements.authStatusText.textContent = message;
    if (message && elements.settingsDialog.open) elements.settingsChatgptStatus.textContent = message;
  });
}

api.onHeartbeat(({ elapsedMs, jobId, phase, remainingMs, pageNumber: heartbeatPageNumber }) => {
  lastHeartbeatAt = Date.now();
  if (phase === 'preparing_next') {
    const pageNumber = heartbeatPageNumber
      ?? activeProject()?.jobs.find((job) => job.id === jobId)?.pageNumber;
    elements.heartbeatText.textContent = `Preparing page ${pageNumber ?? ''} in the next chat • prompt will not be submitted yet…`;
    return;
  }
  if (phase === 'conversation_refresh') {
    const pageNumber = activeProject()?.jobs.find((job) => job.id === jobId)?.pageNumber;
    elements.heartbeatText.textContent = `Refreshing the saved conversation${pageNumber ? ` for page ${pageNumber}` : ''} to check for the completed image…`;
    return;
  }
  if (phase === 'request_check') {
    elements.heartbeatText.textContent = 'Checking whether Gemini has removed the temporary restriction…';
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

setInterval(() => {
  if (state?.queue?.running && lastHeartbeatAt && Date.now() - lastHeartbeatAt > 15_000) {
    elements.heartbeatText.textContent = 'Engine connected and waiting for a Gemini page update…';
  }
  const canvaOp = state?.liveOperation?.kind === 'canva' ? state.liveOperation : null;
  if (elements.canvaProgressElapsed) {
    elements.canvaProgressElapsed.textContent = canvaOp?.startedAt
      ? `Working ${formatElapsedClock(Date.now() - canvaOp.startedAt)}`
      : '';
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
      showToast('Project name cannot be empty.', 'error');
      return;
    }
    try {
      await api.renameProject(project.id, trimmed);
      await refreshState();
      elements.renameProjectDialog.close();
    } catch (err) {
      showToast(`Failed to rename project: ${errorMessage(err)}`, 'error');
    }
  });
}

async function deleteActiveProject() {
  const project = activeProject();
  if (!project) return;
  const confirmMessage = `Are you sure you want to permanently delete "${project.name}"?\n\nThis will delete the project record and all of its generated page images on disk. This action CANNOT be undone.`;
  if (!confirm(confirmMessage)) return;
  try {
    await api.deleteProject(project.id);
    await refreshState();
  } catch (err) {
    showToast(`Failed to delete project: ${errorMessage(err)}`, 'error');
  }
}

// Wire rename/delete buttons
if (elements.conceptRenameBtn) elements.conceptRenameBtn.addEventListener('click', renameActiveProject);
if (elements.projectRenameBtn) elements.projectRenameBtn.addEventListener('click', renameActiveProject);
if (elements.conceptDeleteBtn) elements.conceptDeleteBtn.addEventListener('click', deleteActiveProject);
if (elements.projectDeleteBtn) elements.projectDeleteBtn.addEventListener('click', deleteActiveProject);
if (elements.conceptDeleteButton) elements.conceptDeleteButton.addEventListener('click', deleteActiveProject);

// Wire When Complete action dropdown change
if (elements.whenCompleteAction) {
  elements.whenCompleteAction.addEventListener('change', async () => {
    const val = elements.whenCompleteAction.value;
    try {
      await api.setWhenCompleteAction(val);
    } catch (err) {
      showToast(`Failed to set completion action: ${errorMessage(err)}`, 'error');
    }
  });
}

// Wire Cancel countdown button
if (elements.cancelCountdownBtn) {
  elements.cancelCountdownBtn.addEventListener('click', async () => {
    try {
      await api.cancelSystemAction();
    } catch (err) {
      showToast(`Failed to cancel action: ${errorMessage(err)}`, 'error');
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
      showToast('Full automation started for this book.', 'success');
    } catch (err) {
      showToast(`Failed to start automation: ${errorMessage(err)}`, 'error');
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
      showToast(`Failed to pause automation: ${errorMessage(err)}`, 'error');
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
      showToast(`Failed to resume automation: ${errorMessage(err)}`, 'error');
    }
  });
}

const autoStepSelects = [
  elements.autoStepOverview, elements.autoStepCharacters, elements.autoStepInterior,
  elements.autoStepEditable, elements.autoStepListing, elements.autoStepThumbnails, elements.autoStepPreview, elements.autoStepExport
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
        showToast(`Failed to update setting: ${errorMessage(err)}`, 'error');
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
      showToast(`Failed to proceed: ${errorMessage(err)}`, 'error');
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
      showToast(`Failed to skip: ${errorMessage(err)}`, 'error');
    }
  });
}

if (typeof api.onAutomationProgress === 'function') {
  api.onAutomationProgress(async (payload) => {
    // Optionally log or handle granular progress here.
    // The main state is synced via 'state:changed' event, so we just trigger a refresh.
    await refreshState();
  });
}

if (typeof api.onAutomationAskRequired === 'function') {
  api.onAutomationAskRequired((payload) => {
    if (elements.automationAskOverlay) {
      const stepName = payload?.stepName || payload?.step || '';
      const project = payload?.project || (state?.projects || []).find((p) => p.id === payload?.projectId);
      let stepLabel = stepName;
      if (stepLabel === 'overview') stepLabel = 'Overview & Idea Extraction';
      if (stepLabel === 'characters') stepLabel = 'Character Generation';
      if (stepLabel === 'interior') stepLabel = 'Book Interior Generation';
      if (stepLabel === 'listing') stepLabel = 'TPT Listing Generation';
      if (stepLabel === 'thumbnails') stepLabel = 'Marketing Thumbnails Creation';
      if (stepLabel === 'export') stepLabel = 'PDF, ZIP & PPTX Exporting';

      elements.automationAskTitle.textContent = `Proceed with ${stepLabel}?`;
      elements.automationAskBody.textContent = `The pipeline is ready to start ${stepLabel} for "${project?.name || 'the project'}".`;
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

refreshState()
  .then(() => initStartupAnnouncementModal())
  .catch((error) => showToast(errorMessage(error), 'error'));

