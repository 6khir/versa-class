'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Every other renderer test in this suite matches strings against the source. None of
// them can catch a ReferenceError, and one of those took the whole dashboard down: a
// deleted `const listingPct` left one live reference behind, renderProject() threw
// halfway through, and everything after that line stopped running - so the Interior tab
// reappeared in the editable engine and the Interior Artwork dashboard never mounted.
//
// This boots the real index.html with the real scripts and drives a render, which is
// the only kind of test that would have caught it.

const root = path.join(__dirname, '..');
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch { /* reported by the first test */ }

function boot(project) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8'), {
    runScripts: 'dangerously',
    url: 'http://localhost/'
  });
  const { window } = dom;
  let stateCallback = null;
  // Bridge calls return a promise that never settles. A resolved one would let the
  // renderer's `await` continuations run after teardown, touching a closed document.
  window.tptDesktop = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'onStateChanged') return (cb) => { stateCallback = cb; };
      return () => new Promise(() => {});
    }
  });
  window.versaUi = { filterProjects: () => 0 };
  // The renderer schedules timers. Left running they fire after the window is closed
  // and crash the test run with an unrelated error, so every handle is tracked and
  // cancelled in teardown.
  const timers = { timeouts: new Set(), intervals: new Set() };
  const realSetTimeout = window.setTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    const id = realSetTimeout(fn, ms, ...rest);
    timers.timeouts.add(id);
    return id;
  };
  window.setInterval = (fn, ms, ...rest) => {
    const id = realSetInterval(fn, ms, ...rest);
    timers.intervals.add(id);
    return id;
  };
  window.requestAnimationFrame = (cb) => window.setTimeout(cb, 0);
  window.fetch = () => Promise.resolve({ ok: true });
  // jsdom implements no layout, so stub what the renderer calls on real elements.
  window.Element.prototype.scrollTo = function scrollTo() {};
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.HTMLElement.prototype.animate = function animate() {
    return { finished: Promise.resolve(), cancel() {} };
  };

  // Injected as classic scripts, not eval: a strict-mode eval keeps its function
  // declarations out of global scope, which a browser does not do.
  for (const file of ['renderer/product-pipeline.js', 'renderer/maze-lab.js', 'renderer/renderer.js']) {
    const element = window.document.createElement('script');
    element.textContent = fs.readFileSync(path.join(root, file), 'utf8');
    window.document.body.appendChild(element);
  }
  assert.ok(stateCallback, 'renderer.js should register an onStateChanged handler');

  let error = null;
  try {
    stateCallback({
      projects: [project], activeProject: project, activeProjectId: project.id,
      selectedProjectId: project.id, queue: {}, app: {}, automation: {},
      automationSettings: {}, preferences: {}, workBusy: {}, liveOperation: null, events: []
    });
  } catch (caught) {
    error = caught;
  }
  const teardown = () => {
    for (const id of timers.timeouts) window.clearTimeout(id);
    for (const id of timers.intervals) window.clearInterval(id);
    window.close();
  };
  const pushState = (next) => {
    stateCallback({
      projects: [next], activeProject: next, activeProjectId: next.id,
      selectedProjectId: next.id, queue: {}, app: {}, automation: {},
      automationSettings: {}, preferences: {}, workBusy: {}, liveOperation: null, events: []
    });
  };
  return { dom, window, error, teardown, pushState };
}

function projectFixture(productFormat) {
  return {
    id: 'p1', name: 'Test Book', productFormat, projectType: 'activity',
    stats: { total: 12, complete: 12, remaining: 0, percent: 100 },
    jobs: [], events: [], characterSheets: [], highlights: { characters: [] },
    stepInteriorStatus: 'completed', stepEditableGenerationStatus: 'completed',
    stepThumbnailsStatus: 'pending', stepPreviewStatus: 'pending', stepExportStatus: 'pending',
    editableText: { ready: 12, total: 12 },
    tptListing: { thumbnailPaths: [], video: { path: null, status: 'pending' } },
    outputDir: '/tmp/versa-test'
  };
}

const tabVisible = (window, target) => {
  const node = window.document.querySelector(`.workspace-tab[data-view-target="${target}"]`);
  return node ? !node.hidden : null;
};

test('jsdom is available for renderer boot tests', () => {
  assert.ok(JSDOM, 'jsdom is required by tests/renderer-boot.test.cjs — run npm install');
});

test('a full render of an editable book throws nothing', () => {
  const { error, teardown } = boot(projectFixture('editable'));
  try {
    assert.equal(error, null, `renderProject threw: ${error && error.stack}`);
  } finally { teardown(); }
});

test('a full render of a static book throws nothing', () => {
  const { error, teardown } = boot(projectFixture('static'));
  try {
    assert.equal(error, null, `renderProject threw: ${error && error.stack}`);
  } finally { teardown(); }
});

test('a full render of a maze book throws nothing', () => {
  const { error, teardown } = boot(projectFixture('maze'));
  try {
    assert.equal(error, null, `renderProject threw: ${error && error.stack}`);
  } finally { teardown(); }
});

// The editable engine runs Interior Artwork -> Interior Text -> Editable PPT. There is
// no Interior stage in it at all; that belongs to the static engine only.

test('generation leaves workspace tabs clickable', () => {
  const project = projectFixture('editable');
  const { window, teardown, pushState } = boot(project);
  try {
    pushState({
      ...project,
      stepInteriorStatus: 'generating'
    });
    const tabs = [...window.document.querySelectorAll('#project-standard-view .workspace-tab')]
      .filter((tab) => !tab.hidden);
    assert.ok(tabs.length >= 6);
    for (const tab of tabs) {
      assert.equal(tab.disabled, false, `${tab.dataset.viewTarget} must stay enabled while a book generates`);
      assert.equal(tab.getAttribute('aria-disabled'), null);
    }
  } finally { teardown(); }
});

test('the editable engine shows its three stages and never the static Interior', () => {
  const { window, teardown } = boot(projectFixture('editable'));
  try {
    assert.equal(tabVisible(window, 'interior'), false, 'Interior must not appear in the editable engine');
    for (const stage of ['interior_artwork', 'interior_text', 'editable_ppt', 'thumbnails', 'preview', 'export']) {
      assert.equal(tabVisible(window, stage), true, `${stage} should be visible in the editable engine`);
    }
    const mockupsTab = window.document.querySelector('.workspace-tab[data-view-target="thumbnails"]');
    assert.match(mockupsTab.textContent, /Mockups Lab/);
    assert.equal(window.document.querySelector('.workspace-tab[data-view-target="mockups"]'), null);
  } finally { teardown(); }
});

test('Maze Lab mounts on the shared studio shell with Maze Overview', () => {
  const { window, teardown } = boot({
    ...projectFixture('maze'),
    mazeLab: { pageCount: 4, seedLocked: false, previewVariant: 'student' },
    mazeProject: {
      config: {
        keyword: 'bees',
        ageBand: 'kindergarten',
        difficultyTier: 2,
        seed: 'seed-1',
        startAssetId: 'bee',
        endAssetId: 'flower'
      },
      pages: []
    }
  });
  try {
    assert.equal(window.document.getElementById('overview-workspace-tab').textContent, 'Maze Overview');
    const tab = window.document.querySelector('.workspace-tab[data-view-target="maze"]');
    tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const dashboard = window.document.querySelector('[data-workspace-section="maze"]');
    assert.ok(dashboard);
    assert.equal(dashboard.parentElement.dataset.workspacePane, 'maze');
    assert.equal(dashboard.querySelector('.lab-heading').textContent, 'Maze Lab');
    assert.ok(window.document.getElementById('maze-keyword'));
    assert.ok(window.document.getElementById('maze-seed'));
    assert.ok(window.document.querySelector('[data-action="generate-maze"]'));
    assert.ok(window.document.querySelector('[data-variant="student"]'));
    assert.ok(window.document.querySelector('[data-variant="solution"]'));
    assert.doesNotMatch(window.document.body.textContent, /Sample Lab/);
  } finally { teardown(); }
});

test('a maze book with zero generated mazes stays on the concept brief until Maze Lab work starts', () => {
  const { window, teardown } = boot({
    ...projectFixture('maze'),
    activityCount: 0,
    stats: { total: 0, complete: 0, remaining: 0, percent: 0 }
  });
  try {
    assert.equal(window.document.getElementById('project-concept-view').hidden, false, 'unbuilt maze books stay on the brief');
    assert.equal(window.document.getElementById('project-standard-view').hidden, true, 'Maze Lab stays hidden until generate or library open');
    assert.equal(window.document.getElementById('concept-generate-prompts-btn').textContent, 'Generate mazes');
  } finally { teardown(); }
});

test('a maze book with ready maze pages opens Maze Lab, not the concept brief', () => {
  const { window, teardown } = boot({
    ...projectFixture('maze'),
    activityCount: 0,
    stats: { total: 0, complete: 0, remaining: 0, percent: 0 },
    mazeProject: {
      pages: [{ pageRole: 'maze_interior', generationStatus: 'ready' }]
    }
  });
  try {
    assert.equal(window.document.getElementById('project-concept-view').hidden, true, 'ready maze books must leave the concept brief');
    assert.equal(window.document.getElementById('project-standard-view').hidden, false, 'maze workspace must be visible');
    assert.equal(tabVisible(window, 'maze'), true, 'Maze Lab should be reachable after mazes exist');
    assert.equal(window.document.getElementById('overview-workspace-tab').textContent, 'Maze Overview');
  } finally { teardown(); }
});

test('the maze engine shows Maze Lab and hides Interior, Text Lab, and Editable Lab', () => {
  const { window, teardown } = boot(projectFixture('maze'));
  try {
    assert.equal(tabVisible(window, 'maze'), true, 'Maze Lab should be visible');
    assert.equal(tabVisible(window, 'interior'), false, 'Interior must not appear in the maze engine');
    assert.equal(tabVisible(window, 'interior_artwork'), false);
    assert.equal(tabVisible(window, 'interior_text'), false, 'Text Lab is not part of the maze engine');
    assert.equal(tabVisible(window, 'editable_ppt'), false, 'Editable Lab is not part of the maze engine');
    for (const stage of ['thumbnails', 'preview', 'export']) {
      assert.equal(tabVisible(window, stage), true);
    }
    const reachable = [...window.document.querySelectorAll('#project-standard-view .workspace-tab')]
      .filter((tab) => !tab.hidden && !tab.hasAttribute('inert') && tab.tabIndex !== -1)
      .map((tab) => tab.dataset.viewTarget);
    assert.deepEqual(reachable, ['overview', 'maze', 'thumbnails', 'preview', 'export']);
  } finally { teardown(); }
});

test('the static engine shows Pages Lab and Mockups Lab, never Text Lab or Editable Lab', () => {
  const { window, teardown } = boot(projectFixture('static'));
  try {
    assert.equal(tabVisible(window, 'interior'), true);
    assert.equal(tabVisible(window, 'interior_text'), false, 'Text Lab is editable-only');
    assert.equal(tabVisible(window, 'editable_ppt'), false, 'Editable Lab is editable-only');
    for (const stage of ['interior_artwork', 'editable_ppt']) {
      assert.equal(tabVisible(window, stage), false, `${stage} should be hidden in the static engine`);
    }
    for (const stage of ['thumbnails', 'preview', 'export']) {
      assert.equal(tabVisible(window, stage), true);
    }
    const mockupsTab = window.document.querySelector('.workspace-tab[data-view-target="thumbnails"]');
    assert.ok(mockupsTab);
    assert.match(mockupsTab.textContent, /Mockups Lab/);
    assert.equal(window.document.querySelector('.workspace-tab[data-view-target="mockups"]'), null);
  } finally { teardown(); }
});

// Interior Artwork and the static Interior share one dashboard node that moves between
// panes. If the render dies before mountInteriorDashboard runs, the stage opens empty.

test('the Interior Artwork dashboard mounts and fills in the editable engine', () => {
  const { window, teardown } = boot(projectFixture('editable'));
  try {
    const tab = window.document.querySelector('.workspace-tab[data-view-target="interior_artwork"]');
    tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const dashboard = window.document.querySelector('[data-workspace-section="interior"]');
    assert.ok(dashboard, 'the interior dashboard node must exist');
    assert.equal(dashboard.parentElement.dataset.workspacePane, 'interior_artwork');
    assert.equal(dashboard.querySelector('.queue-panel .section-header h3').textContent, 'Pages Lab');
    assert.ok(dashboard.innerHTML.length > 500, 'the dashboard should render content, not an empty shell');
    const pane = window.document.querySelector('[data-workspace-pane="interior_artwork"]');
    assert.ok(pane.classList.contains('is-active'));
  } finally { teardown(); }
});

test('the same dashboard serves the static Interior stage', () => {
  const { window, teardown } = boot(projectFixture('static'));
  try {
    const tab = window.document.querySelector('.workspace-tab[data-view-target="interior"]');
    tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const dashboard = window.document.querySelector('[data-workspace-section="interior"]');
    assert.equal(dashboard.parentElement.dataset.workspacePane, 'interior');
    assert.equal(dashboard.querySelector('.queue-panel .section-header h3').textContent, 'Pages Lab');
    assert.ok(dashboard.innerHTML.length > 500);
  } finally { teardown(); }
});

test('the cockpit mode button is labeled Studio, not Atelier', () => {
  const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
  assert.match(html, /id="studio-cockpit-btn"[^>]*>Studio</);
  assert.doesNotMatch(html, />Atelier</);
  const { window, teardown } = boot(projectFixture('static'));
  try {
    const cockpit = window.document.getElementById('studio-cockpit-btn');
    assert.ok(cockpit);
    assert.match(cockpit.textContent, /Studio/);
    assert.doesNotMatch(cockpit.textContent, /Atelier/);
    const chatgpt = window.document.querySelector('#settings-mockups-card h4');
    const gemini = window.document.querySelector('#settings-chatgpt-card h4');
    const meta = window.document.querySelector('#settings-meta-card h4');
    assert.equal(chatgpt?.textContent, 'ChatGPT');
    assert.equal(gemini?.textContent, 'Gemini');
    assert.equal(meta?.textContent, 'Meta AI');
    assert.ok(window.document.querySelector('#settings-mockups-card img[src*="chatgpt.png"]'));
    assert.ok(window.document.querySelector('#settings-chatgpt-card img[src*="gemini.png"]'));
    assert.ok(window.document.querySelector('#settings-meta-card img[src*="meta-ai.png"]'));
    const toastHost = window.document.getElementById('toast-host');
    assert.ok(toastHost);
    assert.ok(toastHost.classList.contains('versa-notice-stack'));
  } finally { teardown(); }
});

test('static engines hide Text Lab from sight, focus, and swipe', () => {
  const { window, teardown } = boot(projectFixture('static'));
  try {
    const textTab = window.document.querySelector('.workspace-tab[data-view-target="interior_text"]');
    const editTab = window.document.querySelector('.workspace-tab[data-view-target="editable_ppt"]');
    assert.equal(textTab.hidden, true);
    assert.equal(textTab.hasAttribute('inert'), true);
    assert.equal(textTab.tabIndex, -1);
    assert.equal(textTab.getAttribute('aria-hidden'), 'true');
    assert.equal(editTab.hidden, true);
    assert.equal(editTab.hasAttribute('inert'), true);
    const pages = window.document.querySelectorAll('#project-standard-view .workspace-tab');
    const reachable = [...pages].filter((tab) => !tab.hidden && !tab.hasAttribute('inert') && tab.tabIndex !== -1)
      .map((tab) => tab.dataset.viewTarget);
    assert.deepEqual(reachable, ['overview', 'interior', 'thumbnails', 'preview', 'export']);
  } finally { teardown(); }
});

test('switching from Editable to Static leaves Text Lab and returns to Overview', () => {
  const project = projectFixture('editable');
  const { window, teardown, pushState } = boot(project);
  try {
    const textTab = window.document.querySelector('.workspace-tab[data-view-target="interior_text"]');
    textTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(window.document.querySelector('[data-workspace-pane="interior_text"]').classList.contains('is-active'), true);
    const staticBook = { ...project, productFormat: 'static' };
    pushState(staticBook);
    assert.equal(window.document.querySelector('.workspace-tab[data-view-target="interior_text"]').hidden, true);
    assert.equal(window.document.querySelector('[data-workspace-pane="overview"]').classList.contains('is-active'), true);
    assert.equal(window.document.querySelector('.workspace-tab[data-view-target="overview"]').classList.contains('is-active'), true);
  } finally { teardown(); }
});

test('no SEO tab survives in either engine', () => {
  for (const format of ['editable', 'static', 'maze']) {
    const { window, teardown } = boot(projectFixture(format));
    try {
      assert.equal(window.document.querySelector('.workspace-tab[data-view-target="listing"]'), null);
      assert.equal(window.document.querySelector('[data-workspace-pane="listing"]'), null);
    } finally { teardown(); }
  }
});
