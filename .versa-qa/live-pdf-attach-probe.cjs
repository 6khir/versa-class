'use strict';

/**
 * LIVE Canva PDF attach probe — connects to Chrome Canary CDP (9335),
 * exercises the new dedicated-input / uploads-folder attach path.
 */
const { chromium } = require('playwright-core');
const { appendFileSync, existsSync } = require('node:fs');
const { basename } = require('node:path');

const SESSION = '2f6f56';
const INGEST = 'http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d';
const LOG = '/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log';
const PDF = '/Users/abdelmouiz/Documents/VERSA CLASS/editable-name-tracing-practice-activity-pack-prek-k-d0332f/canva-import/Editable-Name-Tracing-Practice-Activity-Pack-PreK-K.pdf';
const CDP = process.env.CANVA_CDP_URL || 'http://127.0.0.1:9335';
const WANTED = basename(PDF);

function log(hypothesisId, location, message, data = {}) {
  const payload = {
    sessionId: SESSION,
    runId: 'live-probe',
    hypothesisId,
    location,
    message,
    data: { ...data, build: 'pdf-live-fix-2026-09-04' },
    timestamp: Date.now()
  };
  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION },
    body: JSON.stringify(payload)
  }).catch(() => {});
  try { appendFileSync(LOG, `${JSON.stringify(payload)}\n`); } catch {}
  console.log(JSON.stringify(payload));
}

async function rankInputs(page) {
  return page.evaluate(() => {
    const visit = (root, acc) => {
      if (!root) return acc;
      try {
        for (const el of root.querySelectorAll('input[type="file"]')) {
          const accept = el.getAttribute('accept') || '';
          let score = 1;
          if (/pdf/i.test(accept)) score += 50;
          else if (!accept) score += 10;
          if (el.closest('[role="dialog"], [aria-modal="true"]')) score += 20;
          if (el.files?.length) score += 15;
          if (el.hidden || getComputedStyle(el).display === 'none') score += 4;
          if (el.id === 'versa-pdf-file-input' || el.getAttribute('data-versa-pdf-input')) score += 0;
          acc.push({
            score,
            accept: accept.slice(0, 80),
            id: el.id || '',
            files: [...(el.files || [])].map((f) => f.name),
            synthetic: el.id === 'versa-pdf-file-input' || Boolean(el.getAttribute('data-versa-pdf-input'))
          });
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) visit(el.shadowRoot, acc);
        }
      } catch {}
      return acc;
    };
    return visit(document, []).sort((a, b) => b.score - a.score).slice(0, 8);
  }).catch(() => []);
}

async function buttonLabels(page) {
  return page.evaluate(() => {
    const labels = [];
    for (const el of document.querySelectorAll('button, [role="button"], a, [role="menuitem"]')) {
      const t = `${el.getAttribute('aria-label') || ''} ${(el.textContent || '')}`.replace(/\s+/g, ' ').trim();
      if (t && t.length < 60) labels.push(t.slice(0, 60));
    }
    return [...new Set(labels)].slice(0, 40);
  }).catch(() => []);
}

async function attachEvidence(page, wanted) {
  return page.evaluate((name) => {
    const text = String(document.body?.innerText || '');
    const named = text.toLowerCase().includes(String(name || '').toLowerCase());
    const visit = (root) => {
      if (!root) return false;
      try {
        for (const input of root.querySelectorAll('input[type="file"]')) {
          if (input.id === 'versa-pdf-file-input' || input.getAttribute('data-versa-pdf-input')) continue;
          for (const file of input.files || []) {
            if (String(file.name || '').toLowerCase() === String(name || '').toLowerCase()) return true;
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot && visit(el.shadowRoot)) return true;
        }
      } catch {}
      return false;
    };
    const inputHit = visit(document);
    const uploading = /uploading|uploaded to uploads|being imported|imports in progress/i.test(text);
    return { named, inputHit, uploading, fileNameHint: (text.match(/[^\s<>"]+\.pdf/i) || [])[0] || '' };
  }, wanted).catch(() => ({ named: false, inputHit: false, uploading: false, fileNameHint: '' }));
}

async function ensurePdfInputAndSet(page, pdfPath) {
  await page.evaluate(() => {
    let input = document.getElementById('versa-pdf-file-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'versa-pdf-file-input';
      input.accept = 'application/pdf,.pdf';
      input.setAttribute('data-versa-pdf-input', '1');
      input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      document.documentElement.appendChild(input);
    }
  });
  const locator = page.locator('#versa-pdf-file-input').first();
  await locator.setInputFiles(pdfPath, { timeout: 30_000 });
  await page.evaluate(() => {
    const el = document.getElementById('versa-pdf-file-input');
    if (!el?.files?.length) return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const dt = new DataTransfer();
    for (const file of el.files) dt.items.add(file);
    const nodes = [
      ...document.querySelectorAll('[role="dialog"], [data-dropzone], [class*="dropzone"], [class*="Dropzone"], main, body'),
      document.body
    ];
    for (const node of nodes) {
      if (!node) continue;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        node.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt
        }));
      }
    }
    return true;
  });
  return true;
}

async function clickFirst(page, patterns) {
  for (const pattern of patterns) {
    const btn = page.getByRole('button', { name: pattern }).first();
    if (await btn.isVisible({ timeout: 0 }).catch(() => false)) {
      await btn.click({ force: true, timeout: 3_000 }).catch(() => {});
      return String(pattern);
    }
    const link = page.getByRole('link', { name: pattern }).first();
    if (await link.isVisible({ timeout: 0 }).catch(() => false)) {
      await link.click({ force: true, timeout: 3_000 }).catch(() => {});
      return String(pattern);
    }
  }
  return null;
}

(async () => {
  if (!existsSync(PDF)) {
    log('LIVE', 'live-pdf-attach-probe', 'PDF missing', { pdf: PDF });
    process.exit(2);
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 15_000 });
  } catch (error) {
    log('LIVE', 'live-pdf-attach-probe', 'CDP connect failed', {
      cdp: CDP,
      error: String(error?.message || error).slice(0, 300)
    });
    process.exit(3);
  }

  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  let page = pages.find((p) => /canva\.com/i.test(p.url())) || pages[0] || await context.newPage();

  let uploadNetwork = 0;
  page.on('request', (req) => {
    try {
      const url = req.url();
      const method = String(req.method() || '').toUpperCase();
      if (/upload|import|binary/i.test(url) && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        uploadNetwork += 1;
      }
    } catch {}
  });

  log('LIVE', 'live-pdf-attach-probe', 'connected', {
    cdp: CDP,
    url: page.url(),
    pdf: WANTED,
    pages: pages.map((p) => p.url().slice(0, 80))
  });

  await page.goto('https://www.canva.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
  await page.waitForTimeout(800);

  const homeButtons = await buttonLabels(page);
  const homeInputs = await rankInputs(page);
  log('LIVE', 'live-pdf-attach-probe', 'home snapshot', {
    url: page.url(),
    buttons: homeButtons,
    inputs: homeInputs
  });

  // Mirror reveal path: Upload/Add media first (home Quick Create), then Create/Import, then folder/_uploads
  let uploadsClicked = Boolean(await clickFirst(page, [/^upload$/i, /add media/i, /^uploads$/i, /upload files/i]));
  await page.waitForTimeout(500);
  let createClicked = false;
  let importClicked = Boolean(await clickFirst(page, [/^import files$/i, /import files/i, /import file/i]));
  if (!importClicked) {
    createClicked = Boolean(await clickFirst(page, [/create a design/i, /create design/i]));
    await page.waitForTimeout(400);
    importClicked = Boolean(await clickFirst(page, [/^import files$/i, /import files/i, /import file/i]));
  }
  if (!uploadsClicked) {
    uploadsClicked = Boolean(await clickFirst(page, [/^upload$/i, /add media/i, /^uploads$/i, /upload files/i]));
  }
  await page.waitForTimeout(600);

  // Dom-click Upload / Add media like #canvaDomClickUploadish
  const domUpload = await page.evaluate(() => {
    const labelOf = (el) => {
      const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return { aria, text, joined: `${aria} ${text}`.replace(/\s+/g, ' ').trim() };
    };
    const isHit = (el) => {
      const { aria, text, joined } = labelOf(el);
      if (text.length > 72) return false;
      return /^(import files?|upload files?|uploads|add media|upload)$/i.test(aria)
        || /^(import files?|upload files?|uploads|add media|upload)$/i.test(text)
        || (/upload|add media|import files/i.test(joined) && joined.length < 40);
    };
    const nodes = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')];
    const hit = nodes.find(isHit);
    if (!hit) return { ok: false, candidates: nodes.slice(0, 8).map((el) => labelOf(el).joined.slice(0, 60)) };
    hit.click();
    return { ok: true, label: labelOf(hit).joined.slice(0, 80) };
  }).catch(() => ({ ok: false }));
  await page.waitForTimeout(700);

  let dropzoneVisible = await page.evaluate(() => {
    const text = String(document.body?.innerText || '');
    return /drop your (files|content) here|upload files|canva supports images/i.test(text)
      && !/uploaded to uploads|imports in progress/i.test(text);
  }).catch(() => false);

  log('LIVE', 'live-pdf-attach-probe', 'after home clicks', {
    createClicked,
    importClicked,
    uploadsClicked,
    domUpload,
    dropzoneVisible,
    url: page.url(),
    inputs: await rankInputs(page),
    buttons: await buttonLabels(page)
  });

  // Prefer filechooser via explicit "Upload files" (not Upload folder)
  let chooserAttached = false;
  try {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null);
    const uploadFilesBtn = page.getByRole('button', { name: /^upload files$/i }).first();
    if (await uploadFilesBtn.isVisible({ timeout: 800 }).catch(() => false)) {
      await uploadFilesBtn.click({ force: true, timeout: 3_000 }).catch(() => {});
    } else {
      await clickFirst(page, [/^upload files$/i, /choose files/i, /browse files/i]);
    }
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(PDF);
      chooserAttached = true;
      await page.waitForTimeout(2500);
    }
  } catch {}

  let dropzoneVisible2 = await page.evaluate(() => {
    const text = String(document.body?.innerText || '');
    return /drop your (files|content) here|upload files|canva supports images/i.test(text);
  }).catch(() => false);
  dropzoneVisible = dropzoneVisible || dropzoneVisible2;

  // Stay on home when dropzone is visible — do not navigate away to _uploads.
  if (!dropzoneVisible && !chooserAttached) {
    await page.goto('https://www.canva.com/folder/_uploads', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    await page.waitForTimeout(700);
    uploadsClicked = Boolean(await clickFirst(page, [/^upload$/i, /upload files/i, /import files/i])) || uploadsClicked;
    await page.waitForTimeout(400);
  }

  const beforeAttach = await attachEvidence(page, WANTED);
  const inputsBefore = await rankInputs(page);
  log('LIVE', 'live-pdf-attach-probe', 'before dedicated inject', {
    url: page.url(),
    beforeAttach,
    chooserAttached,
    inputs: inputsBefore,
    buttons: await buttonLabels(page)
  });

  // Set on real Canva file inputs with score >= 30 (skip synthetic / folder / */*)
  let nativeSet = false;
  const nativeInputs = page.locator('input[type="file"]');
  const nativeCount = await nativeInputs.count().catch(() => 0);
  for (let i = 0; i < nativeCount; i += 1) {
    const nth = nativeInputs.nth(i);
    const meta = await nth.evaluate((el) => ({
      id: el.id || '',
      accept: el.getAttribute('accept') || '',
      synthetic: el.id === 'versa-pdf-file-input' || Boolean(el.getAttribute('data-versa-pdf-input')),
      webkitdirectory: Boolean(el.webkitdirectory || el.hasAttribute('webkitdirectory')),
      inDialog: Boolean(el.closest('[role="dialog"], [aria-modal="true"]'))
    })).catch(() => null);
    if (!meta || meta.synthetic || meta.webkitdirectory) continue;
    let score = 1;
    if (/pdf/i.test(meta.accept)) score += 50;
    else if (!meta.accept) score += 10;
    if (meta.inDialog) score += 20;
    if (score < 30) continue;
    try {
      await nth.setInputFiles(PDF, { timeout: 20_000 });
      nativeSet = true;
      break;
    } catch {}
  }

  const setOk = nativeSet || await ensurePdfInputAndSet(page, PDF);
  await page.waitForTimeout(2000);
  const evidence = await attachEvidence(page, WANTED);
  const pass = Boolean(chooserAttached || nativeSet || evidence.named || evidence.inputHit || evidence.uploading || uploadNetwork > 0);

  log('LIVE', 'live-pdf-attach-probe', pass ? 'attach evidence PASS' : 'attach evidence FAIL', {
    pass,
    setOk,
    nativeSet,
    chooserAttached,
    evidence,
    uploadNetwork,
    url: page.url(),
    inputs: await rankInputs(page),
    buttons: await buttonLabels(page),
    wanted: WANTED
  });

  // Do not close the shared Canary browser.
  try { await browser.close(); } catch {}
  process.exit(pass ? 0 : 1);
})().catch((error) => {
  log('LIVE', 'live-pdf-attach-probe', 'probe crashed', { error: String(error?.stack || error).slice(0, 500) });
  process.exit(1);
});
