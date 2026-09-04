'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ProjectStore } = require('../src/store.cjs');
const {
  CANVA_STATES,
  PAGE_STATUSES,
  CanvaJobState,
  enrichPageProgress,
  mergeCanvaPageProgress,
  resumeCursor,
  shouldReuseCanvaDesign,
  explainWait,
  decideWaitOutcome,
  decideRecovery,
  observeResumeDecision,
  normalizeCanvaProgressArgs,
  decideHumanLoopExit,
  summarizeHealth,
  buildFailureSnapshot
} = require('../src/canva-job-state.cjs');

function tempStorePath() {
  return join(mkdtempSync(join(tmpdir(), 'versa-canva-job-')), 'versa.sqlite');
}

function sampleProject(overrides = {}) {
  return {
    id: 'proj-canva',
    name: 'Canva Book',
    theme: 'Space',
    niche: 'Science',
    format: 'letter',
    orientation: 'portrait',
    style: 'watercolor',
    activityCount: 8,
    outputDir: '/tmp/versa-out',
    ...overrides
  };
}

test('Canva state machine includes the control-center states', () => {
  for (const state of [
    'BOOT', 'BROWSER_READY', 'CANVA_SESSION_READY', 'PDF_UPLOAD_COMPLETE',
    'IMAGE_INPUT_READY', 'IMAGE_READY', 'PAGE_ADDED',
    'CANVA_EDITOR_READY', 'MAGIC_LAYER_PROCESSING', 'TEMPLATE_LINK_COPIED',
    'JOB_COMPLETE', 'RECOVERING', 'MANUAL_INTERVENTION_REQUIRED'
  ]) {
    assert.ok(CANVA_STATES.includes(state), state);
  }
  for (const status of ['PENDING', 'IMAGE_READY', 'SUCCESS', 'FAILED', 'MANUAL_INTERVENTION_REQUIRED']) {
    assert.ok(PAGE_STATUSES.includes(status), status);
  }
});

test('page progress keeps old fields and adds richer status additively', () => {
  const row = enrichPageProgress(
    { pageNumber: 3, jobId: 'j3', uploaded: true, imported: true, layered: false },
    { status: 'EDITING', attempts: 2, lastAction: 'select-image', confidence: 0.8 }
  );
  assert.equal(row.pageNumber, 3);
  assert.equal(row.uploaded, true);
  assert.equal(row.imported, true);
  assert.equal(row.layered, false);
  assert.equal(row.status, 'EDITING');
  assert.equal(row.attempts, 2);
  assert.equal(row.lastAction, 'select-image');
  assert.equal(row.confidence, 0.8);
});

test('layered pages stay layered unless forceUnlayer is set', () => {
  const kept = mergeCanvaPageProgress(
    [{ pageNumber: 1, layered: true, status: 'SUCCESS', layerCount: 6, error: null }],
    1,
    { layered: false, error: 'retry', status: 'FAILED' }
  );
  assert.equal(kept[0].layered, true);
  assert.equal(kept[0].status, 'SUCCESS');
  assert.equal(kept[0].error, null);
  assert.equal(kept[0].layerCount, 6);
  const reset = mergeCanvaPageProgress(kept, 1, { layered: false, forceUnlayer: true, status: 'PENDING' });
  assert.equal(reset[0].layered, false);
  assert.equal(reset[0].status, 'PENDING');
});

test('resume cursor never asks for a PDF re-upload', () => {
  const cursor = resumeCursor([
    { pageNumber: 1, layered: true },
    { pageNumber: 2, layered: true },
    { pageNumber: 3, layered: false }
  ]);
  assert.equal(cursor.resumeFromPage, 3);
  assert.equal(cursor.resumeFromIndex, 2);
  assert.deepEqual(cursor.layeredPageNumbers, [1, 2]);
  assert.equal(cursor.shouldReuploadPdf, false);
  assert.equal(shouldReuseCanvaDesign({ designUrl: 'https://www.canva.com/design/AAA/edit' }), true);
  assert.equal(shouldReuseCanvaDesign({ pdfUploaded: true }), true);
  assert.equal(shouldReuseCanvaDesign({}), false);
});

test('wait explanations do not wrap an error sentence as Waiting for …', () => {
  const wait = explainWait({
    expected: 'Canva did not finish uploading the print PDF after 10m 00s. Wait until the upload hits 100%, then try again.',
    detected: 'running'
  });
  assert.match(wait.message, /^Canva did not finish uploading/);
  assert.doesNotMatch(wait.message, /^Waiting for Canva did not/);
});

test('homepage POSTs and an open Upload dialog are not PDF upload evidence', () => {
  const {
    isPdfUploadEvidence,
    isPdfUploadPickerWaiting,
    isPdfUploadNetworkUrl,
    pdfImportHumanHelp,
    isHumanRecoverableCanvaError
  } = require('../src/canva-job-state.cjs');
  const picker = {
    text: 'Drop your content here or Upload files Upload folder Canva supports images',
    percent: 0,
    fileSelected: false,
    pickerWaiting: true
  };
  assert.equal(isPdfUploadPickerWaiting(picker), true);
  assert.equal(isPdfUploadEvidence(picker, { posts: 12, active: true }), false);
  assert.equal(isPdfUploadEvidence({ fileSelected: true, text: 'book.pdf' }), true);
  assert.equal(isPdfUploadEvidence({ percent: 42, uploading: true }), true);
  const leftover = {
    text: 'Drop items to upload 1 of 6 items uploaded compressed-1.pdf This document is currently being imported. Please check your imports in progress. Uploaded to Uploads',
    uploadFinished: true,
    importInProgress: true,
    transferSuccess: true,
    uploadItems: 6,
    fileName: 'compressed-1788351443672.pdf'
  };
  assert.equal(isPdfUploadPickerWaiting(leftover), false);
  assert.equal(isPdfUploadEvidence(leftover), true);
  const openHelp = pdfImportHumanHelp('The print PDF is in Uploads / import in progress, but it has not opened as a design.');
  assert.match(openHelp.userShouldClick, /Click the imported PDF to open it as a design/i);
  assert.match(openHelp.userShouldClick, /Do not choose a file from disk/i);
  assert.equal(isPdfUploadNetworkUrl('https://www.canva.com/graphql'), false);
  assert.equal(isPdfUploadNetworkUrl('https://www.canva.com/_ajax/home'), false);
  assert.equal(isPdfUploadNetworkUrl('https://upload.canva.com/resumable/abc'), true);
  const {
    isCanvaDesignCreateNetworkUrl,
    isPdfImportOpenDesignStage,
    decideImportWaitOutcome,
    decideImportRecovery
  } = require('../src/canva-job-state.cjs');
  assert.equal(isCanvaDesignCreateNetworkUrl('https://www.canva.com/designs/created'), true);
  assert.equal(isCanvaDesignCreateNetworkUrl('https://www.canva.com/graphql'), false);
  const help = pdfImportHumanHelp('Canva did not finish uploading the print PDF after 10m 00s.');
  assert.match(help.userShouldClick, /Chrome Canary/);
  assert.match(help.userShouldClick, /confirm the upload reached 100%/i);
  assert.doesNotMatch(help.userShouldClick, /drop or choose the print PDF/i);
  assert.equal(isHumanRecoverableCanvaError({ code: 'CANVA_PDF_IMPORT_STUCK', message: help.happened }), false);
  assert.equal(isHumanRecoverableCanvaError({ code: 'CANVA_MAGIC_LAYERS_MISSING', message: 'Magic Layers was not in the Edit image panel.' }), true);
  assert.equal(isHumanRecoverableCanvaError({ code: 'CANVA_EDIT_IMAGE_PANEL_MISSING' }), true);
  assert.equal(isHumanRecoverableCanvaError({ code: 'CANVA_PAGE_NOT_SEPARATED' }), false);
  assert.equal(isHumanRecoverableCanvaError({ code: 'CANVA_SELECTION_MISSING' }), false);
  assert.equal(isPdfImportOpenDesignStage({ code: 'CANVA_PDF_IMPORT_STUCK', message: help.happened }), true);
  assert.equal(decideImportWaitOutcome({ timedOut: true, uncertain: true, attempts: 3, maxAttempts: 3 }), 'RECOVER');
  assert.equal(decideImportRecovery('PDF_IMPORT', 9).outcome, 'FAIL');
  assert.doesNotMatch(decideImportRecovery('PDF_IMPORT', 9).outcome, /MANUAL/);
});

test('every wait explanation names expected, detected, retries, and recovery', () => {
  const wait = explainWait({
    expected: 'Magic Layer finished',
    detected: { detail: 'still Creating layers' },
    attempt: 4,
    retries: 12,
    elapsedMs: 8_000,
    timeoutMs: 20_000,
    recoveryAttempted: true,
    state: 'MAGIC_LAYER_PROCESSING'
  });
  assert.match(wait.message, /Magic Layer finished/);
  assert.match(wait.message, /still Creating layers/);
  assert.match(wait.message, /Retry 4/);
  assert.match(wait.message, /Recovery already attempted/);
  assert.equal(wait.expected, 'Magic Layer finished');
  assert.equal(wait.retries, 4);
});

test('wait outcomes never stay unknown', () => {
  assert.equal(decideWaitOutcome({ verified: true }), 'SUCCESS');
  assert.equal(decideWaitOutcome({ timedOut: false, attempts: 1, maxAttempts: 3 }), 'RETRY');
  assert.equal(decideWaitOutcome({ timedOut: true, recoverable: true, maxAttempts: 1, attempts: 1 }), 'RECOVER');
  assert.equal(decideWaitOutcome({ timedOut: true, uncertain: true, attempts: 3, maxAttempts: 3 }), 'MANUAL_INTERVENTION');
  assert.equal(decideWaitOutcome({ fatal: true }), 'FAIL');
});

test('recovery policies cover slow load, modal, disconnect, wrong selection, and restart', () => {
  assert.equal(decideRecovery('WRONG_OBJECT', 1).outcome, 'RETRY');
  assert.equal(decideRecovery('WRONG_OBJECT', 9).outcome, 'MANUAL_INTERVENTION');
  assert.equal(decideRecovery('MODAL', 1).action.includes('close only if safe'), true);
  assert.equal(decideRecovery('BROWSER_UNRESPONSIVE', 1).action.includes('reconnect CDP'), true);
  assert.equal(decideRecovery('EXPIRED_SESSION', 1).outcome, 'FAIL');
  assert.equal(decideRecovery('SLOW_UPLOAD', 1).action.includes('do not start a second upload'), true);
  assert.equal(decideRecovery('PDF_IMPORT', 1).action.includes('Uploads'), true);
  assert.equal(decideRecovery('PDF_IMPORT', 9).outcome, 'FAIL');
  assert.equal(decideRecovery('APP_RESTART', 1).action.includes('saved design URL'), true);
  assert.equal(decideRecovery('USER_INTERACTION', 1).next, 'MANUAL_INTERVENTION');
});

test('HITL observe-resume does not trust the button click', () => {
  assert.equal(observeResumeDecision({ humanSaidDone: false }), 'WAIT_FOR_HUMAN');
  assert.equal(observeResumeDecision({ humanSaidDone: true, detectedMatchesExpected: false }), 'KEEP_OBSERVING');
  assert.equal(observeResumeDecision({ humanSaidDone: true, detectedMatchesExpected: true }), 'RESUME');
  assert.equal(observeResumeDecision({ abort: true }), 'FAIL');
});

test('progress payload objects keep liveFrame instead of treating the object as a percent', () => {
  const fromObject = normalizeCanvaProgressArgs({
    liveFrame: 'data:image/jpeg;base64,abc',
    heartbeat: true,
    url: 'https://www.canva.com/design/AAA/edit'
  });
  assert.equal(fromObject.percent, undefined);
  assert.equal(fromObject.extra.liveFrame.startsWith('data:image/jpeg'), true);
  assert.equal(fromObject.extra.heartbeat, true);
  const fromTriple = normalizeCanvaProgressArgs(42, 'Applying Magic Layer', { designUrl: 'https://www.canva.com/design/AAA/edit' });
  assert.equal(fromTriple.percent, 42);
  assert.equal(fromTriple.message, 'Applying Magic Layer');
  assert.equal(fromTriple.extra.designUrl.includes('/design/'), true);
  const fromNullPercent = normalizeCanvaProgressArgs(null, 'Paused for you');
  assert.equal(fromNullPercent.percent, null);
  assert.equal(fromNullPercent.message, 'Paused for you');
});

test('HITL resume and retry controls retry the step instead of failing the page', () => {
  assert.equal(decideHumanLoopExit({ humanPaused: true }), 'WAIT_FOR_HUMAN');
  assert.equal(decideHumanLoopExit({ retryDecision: true }), 'RETRY');
  assert.equal(decideHumanLoopExit({ retryPage: true }), 'RETRY');
  assert.equal(decideHumanLoopExit({ retryStep: true }), 'RETRY');
  assert.equal(decideHumanLoopExit({ humanPaused: false, observeRequested: false }), 'RETRY');
  assert.equal(decideHumanLoopExit({ observeRequested: true, observedOk: true }), 'RESUME');
  assert.equal(decideHumanLoopExit({ observeRequested: true, observedOk: false }), 'KEEP_OBSERVING');
  assert.equal(decideHumanLoopExit({ abort: true }), 'ABORT');
});

test('job state records transitions and can restore a crash snapshot', () => {
  const records = [];
  const job = new CanvaJobState({
    projectId: 'proj-canva',
    expectedPages: 40,
    onRecord: (row) => records.push(row)
  });
  job.enter('CANVA_EDITOR_READY', { action: 'open-editor', expected: 'Share visible' });
  job.markPdfUploaded('https://www.canva.com/design/AAA/edit');
  job.patchPage(37, { status: 'FAILED', layered: false, error: 'timeout' });
  const saved = job.snapshot();
  const restored = new CanvaJobState({ projectId: 'proj-canva' }).restore(saved);
  assert.equal(restored.pdfUploaded, true);
  assert.equal(restored.designUrl, 'https://www.canva.com/design/AAA/edit');
  assert.equal(restored.pages[0].pageNumber, 37);
  assert.ok(records.length >= 2);
  const view = job.controllerView();
  assert.equal(view.lockMessage, 'Canva browser currently controlled by VERSA.');
  job.enter('PROJECT_OPENING', { action: 'open-imported-pdf', expected: 'PDF in Uploads / import in progress — opening design' });
  assert.equal(job.controllerView().recoveryDecision, 'navigate');
});

test('health check stops with an exact fix when the session is a login screen', () => {
  const health = summarizeHealth({
    canaryAvailable: true,
    profileOk: true,
    cdpHealthy: true,
    sessionOk: false,
    loginScreen: true,
    canvaAccessible: true,
    editorCanLoad: true,
    viewportOk: true,
    blockingModal: false
  });
  assert.equal(health.ok, false);
  assert.ok(health.issues.some((item) => item.code === 'CANVA_LOGIN_SCREEN'));
  assert.match(health.message, /Sign in to Canva Pro/);
});

test('failure snapshots include controller state and last action', () => {
  const snap = buildFailureSnapshot({
    url: 'https://www.canva.com/design/AAA/edit',
    pageNumber: 12,
    lastAction: 'click Magic Layers',
    expected: 'layerCount > 1',
    detected: 'busy spinner',
    retryCount: 3,
    error: Object.assign(new Error('stuck'), { code: 'CANVA_PAGE_NOT_SEPARATED' })
  });
  assert.equal(snap.pageNumber, 12);
  assert.equal(snap.lastAction, 'click Magic Layers');
  assert.equal(snap.error.code, 'CANVA_PAGE_NOT_SEPARATED');
});

test('canva journal persists across a store reopen', () => {
  const dbPath = tempStorePath();
  const store = new ProjectStore(dbPath);
  try {
    store.createProject(sampleProject());
    store.appendCanvaJournal({
      projectId: 'proj-canva',
      state: 'MAGIC_LAYER_PROCESSING',
      pageNumber: 4,
      action: 'wait',
      expected: 'layerCount > 1',
      detected: 'busy',
      verification: false,
      outcome: 'RETRY',
      retryCount: 2
    });
  } finally {
    store.close();
  }
  const reopened = new ProjectStore(dbPath);
  try {
    const rows = reopened.listCanvaJournal('proj-canva', 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pageNumber, 4);
    assert.equal(rows[0].outcome, 'RETRY');
    assert.equal(rows[0].expected, 'layerCount > 1');
  } finally {
    reopened.close();
  }
});

test('pauseForHuman keeps CDP waits alive without cancelWaits', async () => {
  const { BrowserController } = require('../src/browser-controller.cjs');
  const browser = new BrowserController({ profileDir: '/tmp/versa-canva-profile', downloadDir: '/tmp/versa-canva-dl' });
  const version = browser.cancelVersion;
  browser.pauseForHuman({
    happened: 'Magic Layers was not found',
    expected: 'Magic Layers in the Edit panel',
    undetermined: 'Whether the image is still selected',
    userShouldClick: 'Edit → Magic Layers'
  });
  assert.equal(browser.humanPaused, true);
  assert.equal(browser.cancelVersion, version);
  assert.equal(browser.abortRequested, false);
  const done = browser.resolveCanvaIntervention('done');
  assert.equal(done.decision, 'done');
  assert.equal(browser.humanObserveRequested, true);
  assert.equal(browser.abortRequested, false);
  browser.resumeCanvaAutomation();
  assert.equal(browser.humanPaused, false);
});

test('recoverInterrupted keeps the Canva design URL and resumes from page N', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    store.createProject(sampleProject({ productFormat: 'editable' }));
    store.updateProject('proj-canva', {
      productFormat: 'editable',
      canvaDesignUrl: 'https://www.canva.com/design/AAA/edit',
      canvaPdfUploaded: true,
      stepEditableStatus: 'processing',
      canvaPageProgress: [
        { pageNumber: 1, layered: true, uploaded: true, imported: true },
        { pageNumber: 2, layered: true, uploaded: true, imported: true },
        { pageNumber: 3, layered: false, uploaded: true, imported: true, started: true }
      ]
    });
    store.recoverInterrupted();
    const project = store.getProject('proj-canva');
    assert.equal(project.canvaDesignUrl, 'https://www.canva.com/design/AAA/edit');
    assert.equal(project.canvaPdfUploaded, true);
    assert.equal(project.canvaJobJson.interrupted, true);
    assert.equal(project.canvaJobJson.resumeFromPage, 3);
    assert.equal(project.canvaJobJson.pdfUploaded, true);
    const journal = store.listCanvaJournal('proj-canva', 5);
    assert.ok(journal.some((row) => row.state === 'RECOVERING'));
  } finally {
    store.close();
  }
});
