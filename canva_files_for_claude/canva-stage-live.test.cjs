'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');

function mockState() {
  const project = {
    id: 'book-canva-live',
    name: 'Canva Live Book',
    status: 'complete',
    projectType: 'printable',
    productFormat: 'editable',
    format: 'A4',
    orientation: 'portrait',
    activityCount: 4,
    outputDir: '/tmp/canva-live',
    characterSheets: [],
    highlights: [],
    canvaTemplateLink: null,
    canvaDesignUrl: null,
    productPdfPath: '/tmp/canva-live/book.pdf',
    tptListing: null,
    stats: { total: 4, complete: 4, remaining: 0, percent: 100 },
    jobs: [1, 2, 3, 4].map((pageNumber) => ({
      id: `job-${pageNumber}`,
      pageNumber,
      title: `Page ${pageNumber}`,
      status: 'complete',
      prompt: `Prompt ${pageNumber}`,
      outputPath: `/tmp/canva-live/p${pageNumber}.png`,
      conversationUrl: null
    }))
  };
  return {
    selectedProjectId: project.id,
    activeProject: project,
    projects: [project],
    queue: { running: false, activeProjectId: null, activeJobId: null, activeJobIds: [] },
    settings: { profile: { displayName: 'Versa' }, aiEngine: 'gemini' },
    browser: { connected: true, browserLabel: 'Chrome' },
    integrations: {
      aiEngine: 'gemini',
      chatgpt: { connected: false },
      gemini: { connected: true, profile: { name: 'Versa' } },
      meta: { connected: false },
      canva: { connected: true, profile: { name: 'Versa' } },
      customGpt: { connected: true },
      chatgptMockups: { connected: false },
      studios: { gems: [], gpts: [] }
    },
    profileRotation: { enabled: false, profiles: [] },
    bundleUpload: { active: false, queue: [] },
    automation: { active: false, paused: false },
    automationSettings: {},
    canvaTemplates: [],
    liveOperation: null,
    workBusy: { queue: false, automation: false, liveOperation: false, tptListing: false, bundle: false, stopping: false },
    app: {
      version: '0.1.0',
      platform: 'darwin',
      loginRequired: false,
      whenCompleteAction: 'nothing',
      systemAction: null,
      update: { status: 'disabled', currentVersion: '0.1.0' }
    }
  };
}

const stubScript = `
window.__canvaCalls = [];
window.__mockState = ${JSON.stringify(mockState())};
window.tptDesktop = {
  getState: async () => window.__mockState,
  runCanvaEditable: async (projectId) => {
    window.__canvaCalls.push(projectId);
    window.__mockState.activeProject.canvaTemplateLink = 'https://www.canva.com/design/TEST/view';
    window.__mockState.projects[0].canvaTemplateLink = 'https://www.canva.com/design/TEST/view';
    return { ok: true, templateLink: 'https://www.canva.com/design/TEST/view' };
  },
  onStateChanged() {},
  onHeartbeat() {},
  onComplete() {},
  onLoginProgress() {},
  onStorybookPhase1() {},
  onAutomationProgress() {},
  onAutomationAskRequired() {},
  onAutomationNotification() {}
};
`;

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/renderer/canva-live-stub.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(stubScript);
        return;
      }
      if (urlPath === '/' || urlPath === '/renderer/index.html') {
        const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8')
          .replace('<script src="./product-pipeline.js"></script>', '<script src="./canva-live-stub.js"></script>\n    <script src="./product-pipeline.js"></script>');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      const relative = urlPath.replace(/^\//, '');
      const filePath = path.join(root, relative);
      if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function launchChrome() {
  const attempts = [
    { channel: 'chrome' },
    { channel: 'chrome-canary' },
    { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { executablePath: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' }
  ];
  let lastError = null;
  for (const opts of attempts) {
    try {
      return await chromium.launch({ ...opts, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Chrome is required for the live Canva stage test.');
}

test('Canva stage is visible, interactive, and Build Canva layer runs', async (t) => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await launchChrome();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(`http://127.0.0.1:${port}/renderer/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const stubReady = await page.evaluate(() => Boolean(window.tptDesktop?.getState));
  assert.equal(stubReady, true, `Canva stub did not load. errors=${errors.join(' | ')}`);
  await page.waitForFunction(() => {
    const workspace = document.getElementById('project-workspace');
    return workspace && !workspace.hidden;
  }, { timeout: 8000 });

  await page.click('.workspace-tab[data-view-target="editable"]');
  await page.waitForFunction(() => {
    const pane = document.querySelector('[data-workspace-pane="editable"]');
    const tab = document.querySelector('.workspace-tab[data-view-target="editable"]');
    if (!pane?.classList.contains('is-active') || !tab?.classList.contains('is-active')) return false;
    const style = getComputedStyle(pane);
    const transform = style.transform;
    const settled = transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
    return style.display === 'block' && style.opacity === '1' && style.visibility === 'visible' && settled;
  }, { timeout: 2500 });

  const proof = await page.evaluate(() => {
    const pane = document.querySelector('[data-workspace-pane="editable"]');
    const panel = document.querySelector('.canva-editable-panel');
    const button = document.getElementById('run-canva-editable-button');
    const steps = [...document.querySelectorAll('[data-canva-step]')];
    const board = document.getElementById('canva-page-grid');
    const box = pane.getBoundingClientRect();
    const style = getComputedStyle(pane);
    return {
      active: pane.classList.contains('is-active'),
      ariaHidden: pane.getAttribute('aria-hidden'),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      transform: style.transform,
      width: Math.round(box.width),
      height: Math.round(box.height),
      top: Math.round(box.top),
      left: Math.round(box.left),
      inViewport: box.width > 400 && box.height > 200 && box.left >= 0 && box.left < 500 && box.top < 900,
      stepCount: steps.length,
      boardCards: board ? board.querySelectorAll('.canva-page-card').length : 0,
      boardWaiting: board ? board.querySelectorAll('.canva-page-card.is-waiting').length : 0,
      boardImages: board ? board.querySelectorAll('img').length : 0,
      boardCount: document.getElementById('canva-page-board-count')?.textContent || '',
      buttonDisabled: button.disabled,
      buttonLabel: button.textContent.trim(),
      panelText: panel.innerText.slice(0, 220)
    };
  });

  assert.equal(proof.active, true, `Canva pane should be active: ${JSON.stringify(proof)}`);
  assert.equal(proof.ariaHidden, 'false');
  assert.equal(proof.display, 'block');
  assert.equal(proof.visibility, 'visible');
  assert.equal(proof.opacity, '1');
  assert.equal(proof.pointerEvents, 'auto');
  assert.equal(proof.transform, 'none');
  assert.equal(proof.inViewport, true, `Canva pane is off-screen or clipped: ${JSON.stringify(proof)}`);
  assert.equal(proof.stepCount, 6);
  assert.equal(proof.boardCards, 4, `Page dashboard should show every interior page as an empty slot: ${JSON.stringify(proof)}`);
  assert.equal(proof.boardWaiting, 4, `Idle Canva slots should stay unfilled until Magic Layer: ${JSON.stringify(proof)}`);
  assert.equal(proof.boardImages, 0, `Interior pictures must not fill the Canva board until Magic Layer is applied: ${JSON.stringify(proof)}`);
  assert.match(proof.boardCount, /0 \/ 4 Magic Layer applied/);
  assert.equal(proof.buttonDisabled, false);
  assert.match(proof.buttonLabel, /Build Canva layer/);
  assert.match(proof.panelText, /Magic Layer/);
  assert.match(proof.panelText, /print PDF/);
  const realErrors = errors.filter((message) => !/ERR_UNKNOWN_URL_SCHEME|404 \(Not Found\)/.test(message));
  assert.equal(realErrors.length, 0, `Renderer errors: ${realErrors.join('\n')}`);

  await page.locator('#run-canva-editable-button').scrollIntoViewIfNeeded();
  await page.click('#run-canva-editable-button');
  const called = await page.waitForFunction(() => window.__canvaCalls.includes('book-canva-live'), { timeout: 4000 });
  assert.ok(called, 'Build Canva layer did not reach runCanvaEditable');
});
