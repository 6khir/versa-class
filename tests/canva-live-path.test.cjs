'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { BrowserController } = require('../src/browser-controller.cjs');
const { isCanvaTemplateLink } = require('../src/canva-bulk.cjs');

const DESIGN_PATH = '/design/DAFAKE123456/SHARETOKEN1/edit';
const TEMPLATE_LINK = 'https://www.canva.com/design/DAFAKE123456/SHARETOKEN1/view?template=1';
const MINIMAL_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

const HOME_HTML = `<!doctype html>
<html><body>
  <button>Create a design</button>
  <button id="import">Import file</button>
  <input id="pdf" type="file" accept="application/pdf,.pdf">
  <script>
    document.getElementById('import').addEventListener('click', () => {
      document.getElementById('pdf').style.display = 'block';
    });
    document.getElementById('pdf').addEventListener('change', go);
    document.getElementById('pdf').addEventListener('input', go);
    setInterval(go, 150);
    function go() {
      const input = document.getElementById('pdf');
      if (input.files && input.files.length && !window.__opened) {
        window.__opened = true;
        fetch('https://www.canva.com/__pdf-attached').catch(() => {});
        fetch('https://www.canva.com/designs/created').finally(() => {
          location.href = ${JSON.stringify(`https://www.canva.com${DESIGN_PATH}`)};
        });
      }
    }
  </script>
</body></html>`;

const EDITOR_HTML = `<!doctype html>
<html><body>
  <button id="share">Share</button>
  <div id="share-panel" hidden>
    <a href="https://www.canva.com/help/share-template-link/">Learn about template links</a>
    <button>Copy link</button>
    <button>See all</button>
    <button>Brand Template</button>
    <button>Template link</button>
    <button>Create Template link</button>
    <button id="copy-template">Copy</button>
    <input id="template-url" value="${TEMPLATE_LINK}">
    <a href="${TEMPLATE_LINK}">template</a>
  </div>
  <aside id="review">
    <h2>Review your design</h2>
    <button aria-label="Close">Close</button>
    <button>Auto-adjust 2 things</button>
  </aside>
  <button aria-label="Page 1" aria-current="page" class="canva-page-thumbnail" data-testid="page-thumbnail">Page 1</button>
  <button aria-label="Page 2" class="canva-page-thumbnail" data-testid="page-thumbnail">Page 2</button>
  <button aria-label="Page 3" class="canva-page-thumbnail" data-testid="page-thumbnail">Page 3</button>
  <img id="page-image" width="640" height="480" alt="Imported page" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
  <canvas width="640" height="480"></canvas>
  <div role="toolbar" id="image-toolbar" hidden>
    <button>Edit image</button>
    <button>BG Remover</button>
    <button>Eraser</button>
    <button>Flip</button>
    <button>Effects</button>
    <button>Animate</button>
    <button>Position</button>
  </div>
  <aside id="edit-panel" hidden>
    <h2>Edit image</h2>
    <div id="tools-grid">
      <button>Adjust</button>
      <div id="magic" role="button" aria-label="Magic Layers"><span>Magic Layers</span></div>
      <button>Magic Edit</button>
      <button>BG Remover</button>
    </div>
  </aside>
  <p id="busy" hidden>Creating layers</p>
  <div id="layers"></div>
  <script>
    fetch('https://www.canva.com/designs/created').catch(() => {});
    setInterval(() => { fetch('https://www.canva.com/designs/created').catch(() => {}); }, 250);
    const layered = { 1: false, 2: false, 3: false };
    let current = 1;
    const toolbar = document.getElementById('image-toolbar');
    const panel = document.getElementById('edit-panel');
    const busy = document.getElementById('busy');
    const layers = document.getElementById('layers');
    const review = document.getElementById('review');
    function thumbs() { return [...document.querySelectorAll('[aria-label^="Page "]')]; }
    function syncLayers() {
      layers.innerHTML = layered[current]
        ? '<div role="treeitem">Art</div><div role="treeitem">Text</div><div role="treeitem">Photo</div>'
        : '';
      let ungroup = document.getElementById('ungroup');
      if (layered[current]) {
        if (!ungroup) {
          ungroup = document.createElement('button');
          ungroup.id = 'ungroup';
          ungroup.textContent = 'Ungroup';
          toolbar.appendChild(ungroup);
        }
        ungroup.hidden = false;
      } else if (ungroup) {
        ungroup.hidden = true;
      }
    }
    function selectPage(n) {
      current = n;
      thumbs().forEach((btn, index) => {
        if (index + 1 === n) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
      });
      toolbar.hidden = true;
      panel.hidden = true;
      syncLayers();
    }
    function showToolbar() { toolbar.hidden = false; }
    thumbs().forEach((btn, index) => btn.addEventListener('click', () => selectPage(index + 1)));
    document.getElementById('page-image').addEventListener('click', showToolbar);
    document.querySelector('canvas').addEventListener('click', showToolbar);
    toolbar.querySelector('button').addEventListener('click', () => { panel.hidden = false; });
    document.getElementById('magic').addEventListener('click', () => {
      busy.hidden = false;
      setTimeout(() => {
        busy.hidden = true;
        layered[current] = true;
        syncLayers();
      }, 400);
    });
    document.querySelector('[aria-label="Close"]').addEventListener('click', () => { review.hidden = true; });
    document.getElementById('share').addEventListener('click', () => {
      document.getElementById('share-panel').hidden = false;
    });
    document.getElementById('copy-template')?.addEventListener('click', () => {
      window.__templateCopied = ${JSON.stringify(TEMPLATE_LINK)};
    });
  </script>
</body></html>`;

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
  throw lastError || new Error('Chrome is required for the live Canva path test.');
}

test('live Canva path uploads the PDF, Magic Layers every page, and saves the template link', { timeout: 200_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-live-'));
  const pdfPath = path.join(tmp, 'book.pdf');
  fs.writeFileSync(pdfPath, MINIMAL_PDF);
  const browser = await launchChrome();
  const context = await browser.newContext();
  t.after(async () => {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  let pdfAttachEvents = 0;
  await context.route(/https?:\/\/(www\.)?canva\.com\/.*/, async (route) => {
    const url = route.request().url();
    if (/__pdf-attached/i.test(url)) {
      pdfAttachEvents += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const editor = /\/design\/DAFAKE123456/i.test(url);
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: editor ? EDITOR_HTML : HOME_HTML
    });
  });
  const page = await context.newPage();
  const controller = new BrowserController({
    profileDir: path.join(tmp, 'profile'),
    downloadDir: path.join(tmp, 'downloads')
  });
  controller.attachLiveBrowser({ context, page });
  const messages = [];
  const started = Date.now();
  let sawLiveFrame = false;
  let copyWasClicked = false;
  const result = await controller.runCanvaBulkCreate({
    projectId: 'live-canva',
    pdfPath,
    expectedPages: 3,
    format: 'A4',
    orientation: 'portrait',
    applyMagicLayers: true,
    downloadDir: null,
    onProgress: async (info) => {
      if (info?.message) messages.push(info.message);
      if (info?.liveFrame) sawLiveFrame = true;
    }
  });
  copyWasClicked = await page.evaluate(() => Boolean(window.__templateCopied)).catch(() => false);
  const elapsedMs = Date.now() - started;
  assert.equal(isCanvaTemplateLink(result.templateLink), true, `template link was ${result.templateLink}`);
  assert.match(result.templateLink, /template=1/);
  assert.equal(result.canvaPageProgress.filter((item) => item.layered).length, 3);
  assert.ok(messages.some((item) => /PDF selected|Sending print PDF|Importing the finished print PDF/i.test(item)), messages.join(' | '));
  assert.ok(messages.some((item) => /Page 3 of 3 done — Magic Layer applied|Magic Layer applied to page 3/i.test(item)), messages.join(' | '));
  assert.ok(messages.some((item) => /Saving the public template link/i.test(item)), messages.join(' | '));
  assert.equal(copyWasClicked, true, 'template Copy was not clicked');
  assert.equal(sawLiveFrame, true, 'CDP live frame never reached onProgress');
  assert.ok(elapsedMs < 180_000, `live path was too slow: ${elapsedMs}ms`);
  assert.equal(pdfAttachEvents, 1, `print PDF was attached ${pdfAttachEvents} times`);
});

test('resume with a saved design URL does not attach the print PDF again', { timeout: 200_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-resume-'));
  const pdfPath = path.join(tmp, 'book.pdf');
  fs.writeFileSync(pdfPath, MINIMAL_PDF);
  const browser = await launchChrome();
  const context = await browser.newContext();
  t.after(async () => {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  let pdfAttachEvents = 0;
  await context.route(/https?:\/\/(www\.)?canva\.com\/.*/, async (route) => {
    const url = route.request().url();
    if (/__pdf-attached/i.test(url)) {
      pdfAttachEvents += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const editor = /\/design\/DAFAKE123456/i.test(url);
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: editor ? EDITOR_HTML : HOME_HTML
    });
  });
  const page = await context.newPage();
  await page.goto(`https://www.canva.com${DESIGN_PATH}`);
  const controller = new BrowserController({
    profileDir: path.join(tmp, 'profile'),
    downloadDir: path.join(tmp, 'downloads')
  });
  controller.attachLiveBrowser({ context, page });
  const result = await controller.runCanvaBulkCreate({
    projectId: 'resume-canva',
    pdfPath,
    expectedPages: 3,
    format: 'A4',
    orientation: 'portrait',
    resumeDesignUrl: `https://www.canva.com${DESIGN_PATH}`,
    layeredPageNumbers: [1],
    applyMagicLayers: true,
    downloadDir: null
  });
  assert.equal(pdfAttachEvents, 0, `resume attached the PDF ${pdfAttachEvents} times`);
  assert.equal(result.resumed, true);
  assert.equal(isCanvaTemplateLink(result.templateLink), true);
  assert.equal(controller.canvaPdfAttachedOnce, true);
});

test('Canva upload dialog receives the PDF without clicking Upload files or Upload folder', { timeout: 200_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-inject-'));
  const pdfPath = path.join(tmp, 'book.pdf');
  fs.writeFileSync(pdfPath, MINIMAL_PDF);
  const uploadHome = fs.readFileSync(path.join(__dirname, 'fixtures/canva-upload-dialog.html'), 'utf8');
  const browser = await launchChrome();
  const context = await browser.newContext();
  t.after(async () => {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  let pdfAttachEvents = 0;
  let uploadFilesClicks = 0;
  let uploadFolderClicks = 0;
  await context.route(/https?:\/\/(www\.)?canva\.com\/.*/, async (route) => {
    const url = route.request().url();
    if (/__pdf-attached/i.test(url)) {
      pdfAttachEvents += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (/__clicked-upload-files/i.test(url)) {
      uploadFilesClicks += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (/__clicked-upload-folder/i.test(url)) {
      uploadFolderClicks += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const editor = /\/design\/DAFAKE123456/i.test(url);
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: editor ? EDITOR_HTML : uploadHome
    });
  });
  const page = await context.newPage();
  const controller = new BrowserController({
    profileDir: path.join(tmp, 'profile'),
    downloadDir: path.join(tmp, 'downloads')
  });
  controller.attachLiveBrowser({ context, page });
  const result = await controller.runCanvaBulkCreate({
    projectId: 'inject-canva',
    pdfPath,
    expectedPages: 3,
    format: 'A4',
    orientation: 'portrait',
    applyMagicLayers: true,
    downloadDir: null
  });
  assert.equal(uploadFolderClicks, 0, 'Upload folder was clicked');
  assert.equal(uploadFilesClicks, 0, 'Upload files was clicked — that opens the OS picker');
  assert.equal(pdfAttachEvents, 1, `print PDF was attached ${pdfAttachEvents} times`);
  assert.equal(isCanvaTemplateLink(result.templateLink), true);
});

async function runFixtureCanvaJob(t, homeHtml, { expectedAttach = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-open-'));
  const pdfPath = path.join(tmp, 'book.pdf');
  fs.writeFileSync(pdfPath, MINIMAL_PDF);
  const browser = await launchChrome();
  const context = await browser.newContext();
  t.after(async () => {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  let pdfAttachEvents = 0;
  let uploadPanelClosed = false;
  await context.route(/https?:\/\/(www\.)?canva\.com\/.*/, async (route) => {
    const url = route.request().url();
    if (/__pdf-attached/i.test(url)) {
      pdfAttachEvents += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (/__upload-panel-closed/i.test(url)) {
      uploadPanelClosed = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const editor = /\/design\/DAFAKE123456/i.test(url);
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: editor ? EDITOR_HTML : homeHtml
    });
  });
  const page = await context.newPage();
  const controller = new BrowserController({
    profileDir: path.join(tmp, 'profile'),
    downloadDir: path.join(tmp, 'downloads')
  });
  controller.attachLiveBrowser({ context, page });
  const progress = [];
  const result = await controller.runCanvaBulkCreate({
    projectId: 'open-canva',
    pdfPath,
    expectedPages: 3,
    format: 'A4',
    orientation: 'portrait',
    applyMagicLayers: true,
    downloadDir: null,
    humanEnabled: true,
    onProgress: async (info) => {
      progress.push(info);
    }
  });
  const closed = uploadPanelClosed;
  if (expectedAttach != null) {
    assert.equal(pdfAttachEvents, expectedAttach, `print PDF was attached ${pdfAttachEvents} times`);
  }
  return { result, progress, pdfAttachEvents, closed, page, controller };
}

test('injects the print PDF once even if upload wait loops, then opens the design', { timeout: 200_000 }, async (t) => {
  const homeHtml = fs.readFileSync(path.join(__dirname, 'fixtures/canva-home-wait-open.html'), 'utf8');
  const { result, progress, pdfAttachEvents } = await runFixtureCanvaJob(t, homeHtml, { expectedAttach: 1 });
  assert.equal(pdfAttachEvents, 1);
  assert.equal(isCanvaTemplateLink(result.templateLink), true);
  const designIdx = progress.findIndex((item) => item?.designUrl);
  const magicIdx = progress.findIndex((item) => /Applying Magic Layer/i.test(item?.message || ''));
  assert.ok(designIdx >= 0, 'designUrl was never reported');
  assert.ok(magicIdx >= 0, 'Magic Layer never started');
  assert.ok(designIdx < magicIdx, 'designUrl must be stored before Magic Layer');
  assert.equal(progress.some((item) => item?.intervention), false, 'PDF import must not raise HITL');
});

test('Uploaded to Uploads plus imports in progress opens the design without a second attach', { timeout: 200_000 }, async (t) => {
  const homeHtml = fs.readFileSync(path.join(__dirname, 'fixtures/canva-home-uploads.html'), 'utf8');
  const { result, progress, pdfAttachEvents, closed, controller } = await runFixtureCanvaJob(t, homeHtml, { expectedAttach: 0 });
  assert.equal(pdfAttachEvents, 0, 'leftover Uploads item was re-attached');
  assert.equal(closed, true, 'upload panel was not closed after transfer');
  assert.equal(isCanvaTemplateLink(result.templateLink), true);
  assert.ok(progress.some((item) => /PDF in Uploads \/ import in progress/i.test(item?.message || '')));
  assert.equal(progress.some((item) => item?.intervention), false, 'PDF import must not raise HITL');
  assert.equal(controller.humanPaused, false);
  const designIdx = progress.findIndex((item) => item?.designUrl);
  const magicIdx = progress.findIndex((item) => /Applying Magic Layer/i.test(item?.message || ''));
  assert.ok(designIdx >= 0 && magicIdx >= 0 && designIdx < magicIdx);
});

test('PDF import timeout recovers then fails without HITL', { timeout: 200_000 }, async (t) => {
  const homeHtml = `<!doctype html><html><body>
    <button>Create a design</button>
    <button id="import">Import file</button>
    <p>Drop items to upload</p>
    <input id="pdf" type="file" accept="application/pdf,.pdf">
    <script>
      document.getElementById('pdf').addEventListener('change', () => {
        fetch('https://www.canva.com/__pdf-attached').catch(() => {});
      });
    </script>
  </body></html>`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-dead-'));
  const pdfPath = path.join(tmp, 'book.pdf');
  fs.writeFileSync(pdfPath, MINIMAL_PDF);
  const browser = await launchChrome();
  const context = await browser.newContext();
  t.after(async () => {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await context.route(/https?:\/\/(www\.)?canva\.com\/.*/, async (route) => {
    const url = route.request().url();
    if (/__pdf-attached/i.test(url)) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: /\/design\//i.test(url) ? EDITOR_HTML : homeHtml
    });
  });
  const page = await context.newPage();
  const controller = new BrowserController({
    profileDir: path.join(tmp, 'profile'),
    downloadDir: path.join(tmp, 'downloads')
  });
  controller.attachLiveBrowser({ context, page });
  const progress = [];
  const started = Date.now();
  await assert.rejects(
    () => controller.runCanvaBulkCreate({
      projectId: 'dead-canva',
      pdfPath,
      expectedPages: 3,
      format: 'A4',
      orientation: 'portrait',
      applyMagicLayers: true,
      downloadDir: null,
      humanEnabled: true,
      onProgress: async (info) => { progress.push(info); }
    }),
    (error) => {
      assert.equal(error.code, 'CANVA_PDF_IMPORT_STUCK');
      assert.match(error.message, /Not waiting for a manual click|Recovery from Uploads failed|No design URL/i);
      return true;
    }
  );
  assert.equal(controller.humanPaused, false);
  assert.equal(progress.some((item) => item?.intervention), false);
  assert.ok(Date.now() - started < 120_000, 'import timeout sat too long before failing');
});
