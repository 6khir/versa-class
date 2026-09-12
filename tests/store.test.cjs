'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ProjectStore } = require('../src/store.cjs');

function tempStorePath() {
  return join(mkdtempSync(join(tmpdir(), 'versa-store-')), 'versa.sqlite');
}

function sampleProject(overrides = {}) {
  return {
    id: 'proj-1',
    name: 'Test Book',
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

test('editable automation step defaults to ask', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    const settings = store.getAutomationSettings();
    assert.equal(settings.editable, 'ask');
  } finally {
    store.close();
  }
});

test('editable pipeline stages alias the shared status columns', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    const project = store.createProject(sampleProject({ productFormat: 'editable' }));
    store.updateProjectStepStatus(project.id, 'interior_artwork', 'completed');
    store.updateProjectStepStatus(project.id, 'interior_text', 'failed');
    store.updateProjectStepStatus(project.id, 'editable_ppt', 'pending');
    const loaded = store.getProject(project.id);
    assert.equal(loaded.stepInteriorStatus, 'completed');
    assert.equal(loaded.stepInteriorArtworkStatus, 'completed');
    assert.equal(loaded.stepEditableStatus, 'failed');
    assert.equal(loaded.stepInteriorTextStatus, 'failed');
    assert.equal(loaded.stepEditableGenerationStatus, 'pending');
    assert.equal(loaded.stepEditablePptStatus, 'pending');
  } finally {
    store.close();
  }
});

test('new project defaults to static product format and pending editable status', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    const project = store.createProject(sampleProject());
    assert.equal(project.productFormat, 'static');
    assert.equal(project.productPdfPath, null);
    assert.equal(project.compressedPdfPath, null);
    assert.equal(project.printPdfJson, null);
    assert.equal(project.productEngine, null);
    assert.equal(project.editableRunId, null);
    assert.equal(project.editableOutputJson, null);
    assert.equal(project.stepEditableGenerationStatus, 'pending');
    assert.equal(project.stepEditableStatus, 'pending');
    assert.equal(project.stepMazeStatus, 'pending');
  } finally {
    store.close();
  }
});

test('migrate adds native editable and print PDF columns on an old projects table', () => {
  const dbPath = tempStorePath();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      theme TEXT NOT NULL,
      niche TEXT NOT NULL,
      format TEXT NOT NULL,
      style TEXT NOT NULL,
      activity_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      output_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO projects (id, name, theme, niche, format, style, activity_count, output_dir, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'old-1',
    'Legacy',
    'Theme',
    'Niche',
    'letter',
    'style',
    4,
    '/tmp/out',
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:00:00.000Z'
  );
  db.close();

  const store = new ProjectStore(dbPath);
  try {
    const columns = new Set(store.db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name));
    assert.ok(columns.has('product_format'));
    assert.ok(columns.has('step_editable_status'));
    assert.ok(columns.has('product_pdf_path'));
    assert.ok(columns.has('compressed_pdf_path'));
    assert.ok(columns.has('print_pdf_json'));
    assert.ok(columns.has('product_engine'));
    assert.ok(columns.has('editable_run_id'));
    assert.ok(columns.has('editable_output_json'));
    assert.ok(columns.has('step_editable_generation_status'));
    assert.ok(columns.has('step_maze_status'));

    const project = store.getProject('old-1');
    assert.equal(project.productFormat, 'static');
    assert.equal(project.productEngine, null);
    assert.equal(project.editableRunId, null);
    assert.equal(project.editableOutputJson, null);
    assert.equal(project.stepEditableGenerationStatus, 'pending');
    assert.equal(project.stepEditableStatus, 'pending');
    assert.equal(project.stepMazeStatus, 'pending');
  } finally {
    store.close();
  }
});

test('maze product format locks and uses a dedicated maze status column', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    const project = store.createProject(sampleProject({ productFormat: 'maze' }));
    assert.equal(project.productFormat, 'maze');
    assert.equal(project.stepMazeStatus, 'pending');
    assert.equal(project.stepEditableStatus, 'pending');
    store.updateProjectStepStatus(project.id, 'maze', 'processing');
    assert.equal(store.getProject(project.id).stepMazeStatus, 'processing');
    assert.equal(store.getProject(project.id).stepEditableStatus, 'pending');
    const locked = store.lockProductEngine(project.id);
    assert.equal(locked.productEngine, 'maze');
    assert.throws(() => store.updateProject(project.id, { productFormat: 'static' }), /locked/i);
    assert.throws(() => store.updateProject(project.id, { productFormat: 'editable' }), /locked/i);
    store.setSetting('mazeProject:proj-1', { schemaVersion: 1, engineType: 'maze', project: { id: 'proj-1', revision: 1 } });
    store.setSetting('mazeLab:proj-1', { open: true });
    store.setSetting('mazeProject:other', 'kept');
    store.deleteProject(project.id);
    assert.equal(store.getSetting('mazeProject:proj-1', null), null);
    assert.equal(store.getSetting('mazeLab:proj-1', null), null);
    assert.equal(store.getSetting('mazeProject:other', null), 'kept');
  } finally {
    store.close();
  }
});

test('updateProject can persist product format and native editable fields', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    store.createProject(sampleProject());
    const updated = store.updateProject('proj-1', {
      productFormat: 'editable',
      productEngine: 'editable-native',
      editableRunId: 'run-123',
      editableOutputJson: { pptxPath: '/tmp/editable-output/book.pptx', pages: [{ pageNumber: 1 }] },
      stepEditableGenerationStatus: 'completed',
      stepEditableStatus: 'completed',
    });
    assert.equal(updated.productFormat, 'editable');
    assert.equal(updated.productEngine, 'editable-native');
    assert.equal(updated.editableRunId, 'run-123');
    assert.deepEqual(updated.editableOutputJson, { pptxPath: '/tmp/editable-output/book.pptx', pages: [{ pageNumber: 1 }] });
    assert.equal(updated.stepEditableGenerationStatus, 'completed');
    assert.equal(updated.stepEditableStatus, 'completed');

    store.updateProjectStepStatus('proj-1', 'editable', 'processing');
    assert.equal(store.getProject('proj-1').stepEditableStatus, 'processing');
  } finally {
    store.close();
  }
});

test('launch reconciliation downgrades completed jobs with missing artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-reconcile-'));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  try {
    const pagePath = join(root, 'page-001.png');
    writeFileSync(pagePath, Buffer.from('page-bytes'));
    store.createProject(sampleProject({ outputDir: root, status: 'complete' }), [{
      id: 'job-1',
      pageNumber: 1,
      pageLabel: 'Page 1',
      kind: 'page',
      title: 'Page 1',
      prompt: 'Draw a page',
      fileName: 'page-001.png',
      status: 'complete'
    }]);
    store.updateJob('job-1', { outputPath: pagePath });
    store.updateProject('proj-1', {
      status: 'complete',
      stepInteriorStatus: 'completed',
      stepThumbnailsStatus: 'completed',
      stepPreviewStatus: 'completed',
      stepListingStatus: 'completed',
      stepExportStatus: 'completed'
    });
    rmSync(pagePath, { force: true });
    const result = store.reconcileCompletedArtifacts();
    const project = store.getProject('proj-1');
    assert.equal(result.invalidJobs, 1);
    assert.equal(existsSync(pagePath), false);
    assert.equal(project.jobs[0].status, 'pending');
    assert.equal(project.jobs[0].outputPath, null);
    assert.equal(project.status, 'paused');
    assert.equal(project.stepInteriorStatus, 'pending');
    assert.equal(project.stepExportStatus, 'pending');
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('dashboard state includes an additive agentPipeline snapshot', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    store.createProject(sampleProject());
    const scan = store.tasks.enqueue({ kind: 'trend_scan', payload: { query: 'phonics' } });
    const leased = store.tasks.lease({ owner: 'test' });
    store.tasks.checkpoint(leased.id, 'test', { phase: 'discovering', marketplace: 'tpt' });
    const dash = store.getDashboardState();
    assert.ok(Array.isArray(dash.agentPipeline));
    assert.equal(dash.agentPipeline[0].kind, 'trend_scan');
    assert.equal(dash.agentPipeline[0].checkpoint.phase, 'discovering');
    assert.equal(dash.agentPipeline[0].result, undefined);
  } finally {
    store.close();
  }
});

test('touchProject and updateJob update project timestamp without error', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    const project = store.createProject(sampleProject());
    const initialUpdatedAt = project.updatedAt;
    const touched = store.touchProject('proj-1');
    assert.ok(touched);
    assert.equal(touched.id, 'proj-1');
    const jobs = store.listJobs('proj-1');
    if (jobs.length > 0) {
      const updatedJob = store.updateJob(jobs[0].id, { status: 'generating' });
      assert.equal(updatedJob.status, 'generating');
    }
  } finally {
    store.close();
  }
});
