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
      canva: { connected: true, available: true, locked: false, profile: { name: 'Versa' } },
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
    canvaLiveDashboard: null,
    events: [],
    workBusy: { queue: false, automation: false, liveOperation: false, tptListing: false, bundle: false, stopping: false },
    app: {
      version: '0.1.0',
      platform: 'darwin',
      canvaAvailable: true,
      loginRequired: false,
      whenCompleteAction: 'nothing',
      systemAction: null,
      update: { status: 'disabled', currentVersion: '0.1.0' }
    }
  };
}

const stubScript = `
window.__canvaCalls = [];
window.__canvaControlCalls = [];
window.__mockState = ${JSON.stringify(mockState())};
window.__stateListeners = [];
window.tptDesktop = {
  getState: async () => window.__mockState,
  runCanvaEditable: async (projectId) => {
    window.__canvaCalls.push(projectId);
    window.__mockState.activeProject.canvaTemplateLink = 'https://www.canva.com/design/TEST/view';
    window.__mockState.projects[0].canvaTemplateLink = 'https://www.canva.com/design/TEST/view';
    return { ok: true, templateLink: 'https://www.canva.com/design/TEST/view' };
  },
  pauseCanvaJob: async () => { window.__canvaControlCalls.push('pause'); },
  resumeCanvaJob: async () => { window.__canvaControlCalls.push('resume'); return { resumed: true }; },
  retryCanvaStep: async () => { window.__canvaControlCalls.push('retry-step'); },
  retryCanvaPage: async () => { window.__canvaControlCalls.push('retry-page'); },
  abortCanvaJob: async () => { window.__canvaControlCalls.push('abort'); },
  runCanvaDryRun: async () => { window.__canvaControlCalls.push('dry-run'); },
  canvaHealthCheck: async () => { window.__canvaControlCalls.push('health'); return { ok: true }; },
  resolveCanvaIntervention: async (decision) => { window.__canvaControlCalls.push(decision); return { decision }; },
  bringBrowserToFront: async () => { window.__canvaControlCalls.push('focus-browser'); },
  startAutomation: async () => { window.__canvaControlCalls.push('start-automation'); },
  pauseAutomation: async () => { window.__canvaControlCalls.push('pause-automation'); },
  startBundleUpload: async () => { window.__canvaControlCalls.push('start-bundle'); },
  stopBundleUpload: async () => { window.__canvaControlCalls.push('stop-bundle'); },
  resolveAutomationAsk: async () => { window.__canvaControlCalls.push('ask'); },
  cancelSystemAction: async () => { window.__canvaControlCalls.push('cancel-system'); },
  pauseQueue: async () => { window.__canvaControlCalls.push('pause-queue'); },
  onStateChanged(cb) { window.__stateListeners.push(cb); return () => {}; },
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
      panelText: panel.innerText.slice(0, 220),
      liveFrame: Boolean(document.getElementById('canva-live-frame')),
      waitBox: Boolean(document.getElementById('canva-wait-explanation')),
      waitBanner: Boolean(document.getElementById('canva-wait-banner')),
      miniCanva: Boolean(document.getElementById('mini-canva-dashboard')),
      lockFlag: Boolean(document.getElementById('canva-lock-flag')),
      dryRun: Boolean(document.getElementById('canva-dry-run-button')),
      liveWidth: Math.round(document.querySelector('.canva-cc-live')?.getBoundingClientRect().width || 0),
      intelWidth: Math.round(document.querySelector('.canva-cc-intel')?.getBoundingClientRect().width || 0),
      wrapWidth: Math.round(document.querySelector('.canva-cc-frame-wrap')?.getBoundingClientRect().width || 0),
      wrapHeight: Math.round(document.querySelector('.canva-cc-frame-wrap')?.getBoundingClientRect().height || 0)
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
  assert.match(proof.panelText, /page image/);
  assert.equal(proof.liveFrame, true);
  assert.equal(proof.waitBox, true);
  assert.equal(proof.waitBanner, true);
  assert.equal(proof.miniCanva, false);
  assert.equal(proof.lockFlag, true);
  assert.equal(proof.dryRun, true);
  assert.ok(proof.wrapWidth >= 700, `Live Canva wrap should be wide: ${JSON.stringify(proof)}`);
  assert.ok(proof.wrapHeight >= 420, `Live Canva wrap should be tall: ${JSON.stringify(proof)}`);
  assert.ok(proof.liveWidth > proof.intelWidth * 1.6, `Live Canva should dominate the intel column: ${JSON.stringify(proof)}`);
  const realErrors = errors.filter((message) => !/ERR_UNKNOWN_URL_SCHEME|404 \(Not Found\)/.test(message));
  assert.equal(realErrors.length, 0, `Renderer errors: ${realErrors.join('\n')}`);

  await page.locator('#run-canva-editable-button').scrollIntoViewIfNeeded();
  await page.click('#run-canva-editable-button');
  await page.waitForFunction(() => window.__canvaCalls.includes('book-canva-live'), { timeout: 4000 });

  await page.click('.workspace-tab[data-view-target="overview"]');
  await page.waitForFunction(() => document.querySelector('[data-workspace-pane="overview"]')?.classList.contains('is-active'), { timeout: 2500 });
  await page.evaluate(() => { window.__canvaCalls = []; });
  await page.locator('.overview-stage-card[data-stage="editable"] .stage-run-btn').scrollIntoViewIfNeeded();
  await page.click('.overview-stage-card[data-stage="editable"] .stage-run-btn');
  const called = await page.waitForFunction(() => window.__canvaCalls.includes('book-canva-live'), { timeout: 4000 });
  assert.ok(called, 'Overview Build Canva layer did not reach runCanvaEditable');
});

test('Canva live dashboard shows PDF import, retry, and saved states', async (t) => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await launchChrome();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(`http://127.0.0.1:${port}/renderer/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('project-workspace') && !document.getElementById('project-workspace').hidden, { timeout: 8000 });

  const apply = async (liveOperation, extra = {}) => {
    await page.evaluate(({ liveOperation, extra }) => {
      window.__mockState.liveOperation = liveOperation;
      window.__mockState.canvaLiveDashboard = liveOperation?.canvaDashboard || extra.canvaLiveDashboard || window.__mockState.canvaLiveDashboard;
      window.__mockState.automation = extra.automation || window.__mockState.automation;
      window.__mockState.events = extra.events || window.__mockState.events || [];
      if (extra.templateLink) {
        window.__mockState.activeProject.canvaTemplateLink = extra.templateLink;
        window.__mockState.projects[0].canvaTemplateLink = extra.templateLink;
      }
      window.__stateListeners.forEach((cb) => cb(window.__mockState));
    }, { liveOperation, extra });
  };

  await apply({
    kind: 'canva',
    label: 'Canva editable',
    percent: 18,
    stepIndex: 3,
    stepCount: 6,
    message: 'Sending print PDF from VERSA…',
    projectId: 'book-canva-live',
    startedAt: Date.now() - 4000,
    canvaDashboard: {
      step: 'upload',
      status: 'running',
      compression: { path: '/tmp/canva-live/book.pdf', originalBytes: 8_000_000, outputBytes: 2_400_000, skipped: false, reason: 'prepared in Interior' },
      upload: { fileName: 'compressed-book.pdf', percent: 42 },
      steps: { pdf: { status: 'ok' }, import: { status: 'ok' }, upload: { status: 'running', message: 'Sending print PDF from VERSA…' } },
      log: [{ at: Date.now(), step: 'upload', message: 'Sending print PDF from VERSA…', status: 'running' }]
    }
  });
  let dash = await page.evaluate(() => ({
    pane: document.querySelector('[data-workspace-pane="editable"]')?.classList.contains('is-active'),
    overview: document.querySelector('[data-workspace-pane="overview"]')?.classList.contains('is-active'),
    listingTabEnabled: document.querySelector('.workspace-tab[data-view-target="listing"]')?.disabled !== true,
    title: document.getElementById('canva-dash-title')?.textContent,
    status: document.getElementById('canva-dash-status')?.textContent,
    pdf: document.getElementById('canva-dash-pdf-copy')?.textContent,
    active: [...document.querySelectorAll('[data-canva-dash]')].filter((el) => el.classList.contains('is-active')).map((el) => el.dataset.canvaDash)
  }));
  assert.equal(dash.overview, true, 'Live Canva must not lock the workspace on the Canva pane');
  assert.equal(dash.pane, false);
  assert.equal(dash.listingTabEnabled, true);
  await page.click('.workspace-tab[data-view-target="listing"]');
  await page.waitForFunction(() => document.querySelector('[data-workspace-pane="listing"]')?.classList.contains('is-active'), { timeout: 2500 });
  const listingStillOpen = await page.evaluate(() => document.querySelector('[data-workspace-pane="listing"]')?.classList.contains('is-active'));
  assert.equal(listingStillOpen, true, 'Listing tab must stay open while Canva runs in the background');
  await page.click('.workspace-tab[data-view-target="editable"]');
  await page.waitForFunction(() => document.querySelector('[data-workspace-pane="editable"]')?.classList.contains('is-active'), { timeout: 2500 });
  dash = await page.evaluate(() => ({
    pane: document.querySelector('[data-workspace-pane="editable"]')?.classList.contains('is-active'),
    title: document.getElementById('canva-dash-title')?.textContent,
    pdf: document.getElementById('canva-dash-pdf-copy')?.textContent,
    active: [...document.querySelectorAll('[data-canva-dash]')].filter((el) => el.classList.contains('is-active')).map((el) => el.dataset.canvaDash)
  }));
  assert.equal(dash.pane, true, 'Canva dashboard stays available when you open the Canva tab');
  assert.match(dash.title, /Upload 100%/i);
  assert.match(dash.pdf, /MB/);
  assert.ok(dash.active.includes('upload'));

  await apply({
    kind: 'canva',
    label: 'Canva editable',
    percent: 22,
    stepIndex: 4,
    stepCount: 6,
    message: 'Imported the print PDF (4 pages). Next: click each page image, Edit, then Magic Layers.',
    projectId: 'book-canva-live',
    startedAt: Date.now() - 12_000,
    canvaDashboard: {
      step: 'thumbnails',
      status: 'ok',
      compression: { path: '/tmp/canva-live/book.pdf', originalBytes: 8_000_000, outputBytes: 2_400_000 },
      upload: { fileName: 'compressed-book.pdf', percent: 100 },
      steps: {
        pdf: { status: 'ok' },
        import: { status: 'ok' },
        upload: { status: 'ok' },
        thumbnails: { status: 'ok' }
      },
      log: [{ at: Date.now(), step: 'thumbnails', message: 'Imported the print PDF (4 pages).', status: 'ok' }]
    }
  });
  dash = await page.evaluate(() => ({
    pdf: document.getElementById('canva-dash-pdf-copy')?.textContent,
    file: document.getElementById('canva-dash-upload-copy')?.textContent,
    title: document.getElementById('canva-dash-title')?.textContent,
    status: document.getElementById('canva-dash-status')?.textContent,
    ready: document.querySelector('[data-canva-dash="thumbnails"]')?.classList.contains('is-done')
  }));
  assert.match(dash.pdf, /MB/);
  assert.match(dash.file, /compressed-book\.pdf/);
  assert.match(dash.title, /Design ready/i);
  assert.match(dash.status, /Imported the print PDF/);
  assert.equal(dash.ready, true);

  const stuck = 'Magic Layers was not in the Edit image panel. Confirm Canva Pro is signed in, then try this page again.';
  await apply({
    kind: 'canva',
    label: 'Canva editable',
    percent: 10,
    stepIndex: 4,
    stepCount: 6,
    message: stuck,
    lastError: stuck,
    attempt: 1,
    projectId: 'book-canva-live',
    startedAt: Date.now() - 180_000,
    canvaDashboard: {
      step: 'thumbnails',
      status: 'fail',
      lastError: stuck,
      attempt: 1,
      steps: { thumbnails: { status: 'fail', message: stuck } },
      log: [{ at: Date.now(), step: 'thumbnails', message: stuck, status: 'fail' }]
    }
  }, {
    automation: { active: true, paused: false, currentStep: 'editable', stepRetryCount: 1 },
    events: [{ level: 'warn', message: `[Automation] Step "editable" attempt 1 failed: ${stuck}. Retrying…`, createdAt: new Date().toISOString() }]
  });
  dash = await page.evaluate(() => {
    document.getElementById('canva-dash-details')?.setAttribute('open', '');
    return {
      error: document.getElementById('canva-dash-error')?.textContent,
      errorHidden: document.getElementById('canva-dash-error')?.hidden,
      attempt: document.getElementById('canva-dash-attempt')?.textContent,
      failStep: document.querySelector('[data-canva-dash="thumbnails"]')?.classList.contains('is-fail'),
      log: document.getElementById('canva-dash-log')?.textContent
    };
  });
  assert.equal(dash.errorHidden, false);
  assert.match(dash.error, /Magic Layers was not in the Edit image panel/);
  assert.match(dash.attempt, /Attempt/);
  assert.equal(dash.failStep, true);
  assert.match(dash.log, /Magic Layers was not in the Edit image panel/);

  await apply(null, {
    templateLink: 'https://www.canva.com/design/TEST/view?template=1',
    canvaLiveDashboard: {
      step: 'saved',
      status: 'ok',
      steps: { saved: { status: 'ok' } },
      log: [{ at: Date.now(), step: 'saved', message: 'Saving the public template link…', status: 'ok' }]
    }
  });
  dash = await page.evaluate(() => ({
    title: document.getElementById('canva-dash-title')?.textContent,
    saved: document.querySelector('[data-canva-dash="saved"]')?.classList.contains('is-done'),
    errorHidden: document.getElementById('canva-dash-error')?.hidden
  }));
  assert.match(dash.title, /Template saved/i);
  assert.equal(dash.saved, true);
  assert.equal(dash.errorHidden, true);
});

test('interrupted PDF import does not show WHY AM I WAITING and auto-resumes', async (t) => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await launchChrome();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(`http://127.0.0.1:${port}/renderer/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('project-workspace') && !document.getElementById('project-workspace').hidden, { timeout: 8000 });
  await page.click('.workspace-tab[data-view-target="editable"]');
  await page.waitForFunction(() => document.querySelector('[data-workspace-pane="editable"]')?.classList.contains('is-active'), { timeout: 2500 });

  const stuck = 'Canva did not open the print PDF as a design after 8m 56s. Still 0 of 54 pages. Confirm the upload reached 100% in Canva, then try again.';
  await page.evaluate((stuck) => {
    const job = {
      interrupted: true,
      lastError: stuck,
      state: 'CANVA_OPEN',
      pdfUploaded: false,
      designUrl: null,
      intervention: {
        happened: stuck,
        expected: 'The Upload dialog shows this book’s print PDF, the bar hits 100%, and Canva opens the new design.',
        undetermined: 'Whether Canva received the file. Homepage traffic is not an upload.',
        userShouldClick: 'In Chrome Canary: confirm the upload reached 100%, then press I HAVE DONE IT.'
      }
    };
    window.__mockState.liveOperation = null;
    window.__mockState.activeProject.canvaJobJson = job;
    window.__mockState.projects[0].canvaJobJson = job;
    window.__mockState.canvaLiveDashboard = { status: 'fail', lastError: stuck, step: 'upload' };
    window.__stateListeners.forEach((cb) => cb(window.__mockState));
  }, stuck);

  const ui = await page.evaluate(() => ({
    overlayHidden: document.getElementById('canva-intervention-overlay')?.hidden,
    overlayClassHidden: document.getElementById('canva-intervention-overlay')?.classList.contains('hidden'),
    bannerHidden: document.getElementById('canva-wait-banner')?.hidden,
    wait: document.getElementById('canva-wait-explanation')?.textContent,
    job: document.getElementById('canva-cc-job')?.textContent,
    state: document.getElementById('canva-cc-state')?.textContent
  }));
  assert.equal(ui.overlayHidden, true, `HITL overlay must not show for PDF import: ${JSON.stringify(ui)}`);
  assert.equal(ui.overlayClassHidden, true);
  assert.equal(ui.bannerHidden, true);
  assert.match(ui.wait, /automatically|Uploads|No I HAVE DONE IT/i);
  assert.equal(ui.job, 'INTERRUPTED');
  await page.waitForFunction(() => window.__canvaControlCalls.includes('resume'), { timeout: 4000 });
});
