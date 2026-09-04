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
        location.href = ${JSON.stringify(`https://www.canva.com${DESIGN_PATH}`)};
      }
    }
  </script>
</body></html>`;

const EDITOR_HTML = `<!doctype html>
<html><body>
  <button id="share">Share</button>
  <div id="share-panel" hidden>
    <button>Template link</button>
    <input value="${TEMPLATE_LINK}">
    <a href="${TEMPLATE_LINK}">template</a>
  </div>
  <aside id="review">
    <h2>Review your design</h2>
    <button aria-label="Close">Close</button>
    <button>Auto-adjust 2 things</button>
  </aside>
  <button aria-label="Page 1" aria-current="page">Page 1</button>
  <button aria-label="Page 2">Page 2</button>
  <button aria-label="Page 3">Page 3</button>
  <canvas width="640" height="480"></canvas>
  <div role="toolbar" id="image-toolbar" hidden>
    <button>Edit</button>
    <button>BG Remover</button>
    <button>Eraser</button>
    <button>Flip</button>
    <button>Effects</button>
    <button>Animate</button>
    <button>Position</button>
  </div>
  <aside id="edit-panel" hidden>
    <h2>Edit image</h2>
    <button id="magic">Magic Layers</button>
  </aside>
  <p id="busy" hidden>Creating layers</p>
  <div id="layers"></div>
  <script>
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
    thumbs().forEach((btn, index) => btn.addEventListener('click', () => selectPage(index + 1)));
    document.querySelector('canvas').addEventListener('click', () => { toolbar.hidden = false; });
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

test('live Canva path uploads the PDF, Magic Layers every page, and saves the template link', { timeout: 40_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-live-'));
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
    }
  });
  const elapsedMs = Date.now() - started;
  assert.equal(isCanvaTemplateLink(result.templateLink), true, `template link was ${result.templateLink}`);
  assert.match(result.templateLink, /template=1/);
  assert.equal(result.canvaPageProgress.filter((item) => item.layered).length, 3);
  assert.ok(messages.some((item) => /PDF selected|Importing the finished print PDF/i.test(item)), messages.join(' | '));
  assert.ok(messages.some((item) => /Magic Layer applied to page 3/i.test(item)), messages.join(' | '));
  assert.ok(messages.some((item) => /Saving the public template link/i.test(item)), messages.join(' | '));
  assert.ok(elapsedMs < 45_000, `live path was too slow: ${elapsedMs}ms`);
});
