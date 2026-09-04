'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');
const css = readFileSync(join(root, 'renderer/styles.css'), 'utf8');
const renderer = readFileSync(join(root, 'renderer/renderer.js'), 'utf8');
const preload = readFileSync(join(root, 'src/preload.cjs'), 'utf8');

test('workspace keeps a sticky live dock on every view', () => {
  assert.match(html, /id="live-dock"/);
  assert.match(html, /class="appearance-switch"/);
  assert.match(html, /class="workspace-command-strip"/);
  assert.doesNotMatch(html, /class="progress-card glass-panel" data-workspace-section="overview"/);
  assert.match(css, /\.live-dock\.is-live/);
  assert.match(css, /position:\s*sticky/);
});

test('overview is a pipeline plus activity board, not an 8-card wrap grid', () => {
  assert.match(html, /class="overview-board"/);
  assert.match(html, /class="logs-panel glass-panel"/);
  assert.match(css, /\.overview-board\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.22fr\)/s);
  assert.match(css, /counter-increment:\s*pipeline/);
  assert.match(css, /\.event-log[\s\S]*min-height:\s*420px/);
});

test('workspace panes slide on a track and listing shells stay on screen', () => {
  assert.match(html, /id="workspace-stage"/);
  assert.match(html, /id="workspace-track"/);
  assert.match(html, /id="tpt-thumbnails-review"/);
  assert.match(css, /@keyframes view-enter/);
  assert.match(css, /@keyframes stage-slide-next/);
  assert.match(css, /@keyframes page-fill-breathe/);
  assert.match(css, /@keyframes book-row-in/);
  assert.match(renderer, /stage-slide-next/);
  assert.match(renderer, /function shiftWorkspacePane/);
  assert.match(css, /\.workspace-pane\.is-active\s*\{\s*display:\s*block;/);
  assert.doesNotMatch(css, /\.workspace-pane\s*\{[^}]*visibility:\s*hidden/);
  assert.match(renderer, /const hasListing = hasListingDraft/);
  assert.match(preload, /clearCanvaTemplate:/);
  assert.match(preload, /clearTptListing:/);
  assert.match(preload, /clearJobImage:/);
});

test('overview product progress is separate from interior page completion', () => {
  assert.match(html, /Product progress/);
  assert.match(html, /id="overview-open-stages"/);
  assert.match(html, /product-pipeline\.js/);
  assert.match(html, /data-stage="listing"/);
  assert.doesNotMatch(html, /Overall generation/);
});

test('start and pause stay visible as a transport cluster without a forbidden cursor', () => {
  assert.match(html, /class="hero-transport"/);
  assert.match(html, /id="pause-button"/);
  assert.match(html, /id="live-pause-button"/);
  assert.match(html, /class="hero-utility-row"/);
  assert.match(css, /\.button-pause:not\(:disabled\)/);
  assert.match(css, /\.hero-transport-buttons[\s\S]*cursor:\s*pointer/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /button:disabled \{ opacity: 0.55; cursor: pointer !important; \}/);
  assert.doesNotMatch(css, /\.hero-transport[\s\S]{0,800}not-allowed/);
  assert.match(renderer, /function isPipelineBusy\(\)/);
  assert.match(renderer, /work\.stopping/);
  assert.doesNotMatch(renderer, /element\.hidden = completedForUpload/);
  const midnight = readFileSync(join(root, 'renderer/midnight-theme.css'), 'utf8');
  assert.match(midnight, /html\[data-theme="dark"\] \.button-pause/);
  assert.match(midnight, /#FF3B30|#FF453A|#D70015/);
});

test('workspace keeps Canva as a print PDF plus Magic Layer path', () => {
  assert.match(html, /id="canva-pdf-status"/);
  assert.match(html, /Import the finished print PDF once, then Magic Layer each page/);
  assert.match(html, /id="canva-page-board"/);
  assert.match(html, /id="canva-page-grid"/);
  assert.match(html, /<strong>Load PDF<\/strong>/);
  assert.match(html, /<strong>Import file<\/strong>/);
  assert.match(html, /<strong>Upload 100%<\/strong>/);
  assert.match(html, /<strong>Design ready<\/strong>/);
  assert.match(html, /<strong>Template link<\/strong>/);
  assert.match(html, /Build Canva layer/);
  assert.match(html, /data-action="run-stage"/);
  assert.match(html, /data-action="start-full-automation"/);
  assert.match(html, /data-stage="editable"/);
  assert.match(renderer, /function renderCanvaPageBoard/);
  assert.match(renderer, /jobs\.map\(\(job\) =>/);
  assert.match(renderer, /Magic Layer applied ✓/);
  assert.match(renderer, /Applying Magic Layer/);
  assert.match(renderer, /Not filled/);
  assert.match(renderer, /row\.layered && job\.outputPath/);
  assert.match(renderer, /action === 'run-stage'/);
  assert.match(renderer, /action === 'start-full-automation'/);
  assert.match(renderer, /function stageStartBlockReason/);
  assert.match(renderer, /function browserBusyReason/);
  assert.doesNotMatch(renderer, /liveOp\?\.kind === 'canva'[\s\S]{0,220}activeWorkspaceView = 'editable'/);
  assert.doesNotMatch(renderer, /visibleJobs/);
  assert.doesNotMatch(renderer, /one at a time when Magic Layer starts/);
  assert.doesNotMatch(renderer, /job\.outputPath \? 'ready'/);
  assert.doesNotMatch(renderer, /IMAGE_READY/);
  assert.doesNotMatch(html, /Add each finished page image to Canva/);
  assert.match(html, /id="run-canva-editable-button"/);
  assert.match(html, /id="canva-live-dashboard"/);
  assert.match(html, /Empty slots fill in as confirmation/);
  assert.match(html, /id="canva-coming-soon"/);
  assert.match(html, /Coming soon on Windows/);
  assert.match(renderer, /function canvaLocked/);
  assert.match(renderer, /function applyCanvaLockUi/);
  assert.doesNotMatch(html, /CANVA BULK CREATE TEMPLATES/);
  assert.doesNotMatch(html, /JPEG/);
});

test('mini Canva is gone from the production renderer', () => {
  assert.doesNotMatch(html, /id="mini-canva-dashboard"/);
  assert.doesNotMatch(html, /data-action="mini-toggle"/);
  assert.doesNotMatch(html, /Mini Canva/);
  assert.doesNotMatch(renderer, /mini-canva-dashboard/);
  const uiJs = readFileSync(join(root, 'renderer/ui.js'), 'utf8');
  const uiCss = readFileSync(join(root, 'renderer/ui.css'), 'utf8');
  assert.doesNotMatch(uiJs, /getElementById\('mini-canva-dashboard'\)/);
  assert.doesNotMatch(uiCss, /#mini-canva-dashboard/);
});

test('Control Center live Canva view is the dominant editor surface', () => {
  assert.match(html, /id="canva-live-dashboard"/);
  assert.match(html, /class="canva-live-dashboard canva-cc-activity"/);
  assert.match(html, /id="canva-live-frame"/);
  assert.match(html, /data-workspace-pane="editable"/);
  assert.match(css, /\.canva-cc-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.55fr\)\s+minmax\(240px,\s*300px\)/s);
  assert.match(css, /\.canva-cc-frame-wrap\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*10/s);
  assert.match(css, /\.canva-cc-frame-wrap\s*\{[^}]*min-height:\s*min\(62vh,\s*720px\)/s);
  assert.doesNotMatch(css, /#canva-live-frame\s*\{[^}]*height:\s*240px/);
  assert.doesNotMatch(css, /\.canva-cc-frame-wrap\s*\{[^}]*repeating-linear-gradient/);
  assert.doesNotMatch(html, /id="mini-canva-dashboard"/);
});

test('Control Center buttons are wired through handleAction', () => {
  for (const action of [
    'canva-pause', 'canva-resume', 'canva-retry-step', 'canva-retry-page',
    'canva-manual-help', 'canva-abort', 'canva-dry-run', 'canva-health-check',
    'canva-intervention-done', 'canva-intervention-retry', 'canva-intervention-abort',
    'run-canva-editable', 'open-canva-template', 'clear-canva-template',
    'focus-browser', 'ui-toggle-sidebar', 'ui-focus-search', 'new-project',
    'open-about', 'open-guide', 'toggle-bundle-view', 'pause-automation',
    'start-bundle-upload', 'launch-browser', 'start', 'pause'
  ]) {
    assert.match(renderer, new RegExp(`action === '${action}'`));
  }
  assert.match(html, /id="canva-wait-banner"/);
  assert.match(html, /WHY AM I WAITING \/ MANUAL HELP/);
  assert.match(html, /data-action="focus-browser"/);
  assert.match(html, /data-action="new-project"/);
  assert.match(preload, /resumeCanvaJob:/);
  assert.match(preload, /resolveCanvaIntervention:/);
});
