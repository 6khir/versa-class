'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
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

test('new project defaults to static product format and pending editable status', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    const project = store.createProject(sampleProject());
    assert.equal(project.productFormat, 'static');
    assert.equal(project.canvaTemplateLink, null);
    assert.equal(project.canvaExportPath, null);
    assert.equal(project.productPdfPath, null);
    assert.equal(project.compressedPdfPath, null);
    assert.equal(project.printPdfJson, null);
    assert.equal(project.stepEditableStatus, 'pending');
  } finally {
    store.close();
  }
});

test('migrate adds editable Canva columns on an old projects table', () => {
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
    assert.ok(columns.has('canva_template_link'));
    assert.ok(columns.has('canva_export_path'));
    assert.ok(columns.has('step_editable_status'));
    assert.ok(columns.has('product_pdf_path'));
    assert.ok(columns.has('compressed_pdf_path'));
    assert.ok(columns.has('print_pdf_json'));
    assert.ok(columns.has('canva_page_progress'));

    const project = store.getProject('old-1');
    assert.equal(project.productFormat, 'static');
    assert.equal(project.canvaTemplateLink, null);
    assert.equal(project.canvaExportPath, null);
    assert.equal(project.stepEditableStatus, 'pending');
  } finally {
    store.close();
  }
});

test('canva_templates settings round-trip through getSetting/setSetting', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    assert.deepEqual(store.getCanvaTemplates(), []);
    assert.deepEqual(store.getSetting('canva_templates') ?? [], []);

    const templates = [
      {
        id: 'letter-portrait-20pg',
        label: 'Letter Portrait — up to 20 pages',
        format: 'LETTER',
        orientation: 'portrait',
        maxPages: 20,
        canvaDesignUrl: 'https://www.canva.com/design/XXXXXXXX/edit'
      }
    ];
    store.setSetting('canva_templates', templates);
    assert.deepEqual(store.getSetting('canva_templates') ?? [], templates);
    assert.deepEqual(store.getCanvaTemplates(), templates);

    store.setCanvaTemplates([]);
    assert.deepEqual(store.getCanvaTemplates(), []);
  } finally {
    store.close();
  }
});

test('updateProject can persist product format and Canva fields', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    store.createProject(sampleProject());
    const updated = store.updateProject('proj-1', {
      productFormat: 'editable',
      canvaTemplateLink: 'https://www.canva.com/design/XXXXXXXX/edit',
      canvaExportPath: '/tmp/canva-export',
      stepEditableStatus: 'completed',
      canvaPageProgress: [
        { pageNumber: 1, uploaded: true, layered: true, error: null },
        { pageNumber: 2, uploaded: true, layered: false, error: 'Magic Layers was not found.' }
      ]
    });
    assert.equal(updated.productFormat, 'editable');
    assert.equal(updated.canvaTemplateLink, 'https://www.canva.com/design/XXXXXXXX/edit');
    assert.equal(updated.canvaExportPath, '/tmp/canva-export');
    assert.equal(updated.stepEditableStatus, 'completed');
    assert.equal(updated.canvaPageProgress[0].layered, true);
    assert.equal(updated.canvaPageProgress[1].layered, false);

    store.updateProjectStepStatus('proj-1', 'editable', 'processing');
    assert.equal(store.getProject('proj-1').stepEditableStatus, 'processing');
  } finally {
    store.close();
  }
});

test('persistCanvaPageLayered marks a failed page layered without inventing a layer count', () => {
  const store = new ProjectStore(tempStorePath());
  try {
    store.createProject(sampleProject());
    store.updateProject('proj-1', {
      canvaPageProgress: [
        {
          pageNumber: 1,
          uploaded: true,
          imported: true,
          started: true,
          layered: false,
          error: 'Could not read the layer count on page 1. Not separated.',
          status: 'FAILED',
          layerCount: null
        }
      ],
      canvaJobJson: {
        pages: [{ pageNumber: 1, layered: false, error: 'failed', status: 'FAILED' }]
      }
    });
    const updated = store.persistCanvaPageLayered('proj-1', 1, {
      lastVerification: 'operator-confirmed-layered',
      detectionMethod: 'operator-confirmed'
    });
    assert.equal(updated.canvaPageProgress[0].layered, true);
    assert.equal(updated.canvaPageProgress[0].status, 'SUCCESS');
    assert.equal(updated.canvaPageProgress[0].error, null);
    assert.equal(updated.canvaPageProgress[0].layerCount, null);
    assert.equal(updated.canvaJobJson.pages[0].layered, true);
    const wiped = store.persistCanvaPageLayered('proj-1', 1, { layered: false, forceUnlayer: true });
    assert.equal(wiped.canvaPageProgress[0].layered, true);
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
