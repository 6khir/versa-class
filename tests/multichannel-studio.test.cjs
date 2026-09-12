'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');
const renderer = readFileSync(join(root, 'renderer/renderer.js'), 'utf8');
const ui = readFileSync(join(root, 'renderer/ui.js'), 'utf8');

const SACRED_IDS = [
  'canva-live-dashboard',
  'canva-page-grid',
  'canva-page-board',
  'run-canva-editable-button',
  'open-canva-template-button',
  'clear-canva-template-button',
  'canva-coming-soon',
  'tpt-listing-review',
  'tpt-thumbnails-review',
  'tpt-preview-review',
  'workspace-stage',
  'workspace-track',
  'studio-library-btn',
  'studio-cockpit-btn'
];

test('multichannel studio keeps sacred Canva and lab ids', () => {
  for (const id of SACRED_IDS) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-action="run-canva-editable"/);
  assert.match(html, /data-action="open-canva-template"/);
  assert.match(html, /data-action="clear-canva-template"/);
  assert.match(html, /data-action="select-workspace-view"/);
  assert.match(html, /data-workspace-pane="editable"/);
  assert.match(html, /data-workspace-pane="listing"/);
});

test('every lab pane is a mounted independent channel', () => {
  for (const channel of ['overview', 'interior', 'listing', 'editable', 'thumbnails', 'preview', 'export']) {
    assert.match(html, new RegExp(`data-workspace-pane="${channel}"[^>]*data-channel="${channel}"|data-channel="${channel}"[^>]*data-workspace-pane="${channel}"`));
    assert.match(html, new RegExp(`data-view-target="${channel}"[^>]*data-channel="${channel}"|data-channel="${channel}"[^>]*data-view-target="${channel}"`));
  }
  assert.match(html, /data-multichannel="connected"/);
  assert.match(html, /studio-channel-rack/);
  assert.match(html, /data-channel="library"/);
  assert.match(html, /data-channel="studio"/);
});

test('channel switches preserve pane HTML instead of wiping sibling labs', () => {
  assert.match(renderer, /function setChannelHtml/);
  assert.match(renderer, /function visibleWorkspaceViews/);
  assert.match(renderer, /#project-standard-view \.workspace-tab/);
  assert.match(renderer, /isChannelContractHidden/);
  assert.match(renderer, /setChannelHtml\(elements\.tptListingReview/);
  assert.match(renderer, /setChannelHtml\(elements\.tptThumbnailsReview/);
  assert.match(renderer, /setChannelHtml\(elements\.tptPreviewReview/);
  assert.match(renderer, /setChannelHtml\(elements\.jobsTable/);
  assert.match(renderer, /setChannelHtml\(grid, boardHtml, 'canvaBoard'\)/);
  assert.doesNotMatch(renderer, /elements\.tptListingReview\.innerHTML = tptListingHtml/);
  assert.doesNotMatch(renderer, /pane\.hidden = !active/);
  assert.match(ui, /dataset\.world/);
});
