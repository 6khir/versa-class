'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  setWorkspaceRoot,
  resolvePageSaveDir,
  migrateProjectWorkingFiles,
  isPublishDeliverable
} = require('../src/project-workspace.cjs');

test('page images save under the app workspace, not Documents', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-ws-'));
  try {
    setWorkspaceRoot(root);
    const dir = resolvePageSaveDir({ id: 'book-1', outputDir: join(root, 'Documents', 'book') });
    assert.equal(dir, join(root, 'workspace', 'book-1', 'pages'));
    assert.ok(existsSync(dir));
  } finally {
    setWorkspaceRoot(null);
    rmSync(root, { recursive: true, force: true });
  }
});

test('migration leaves only publish files in the book folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-ws-'));
  try {
    setWorkspaceRoot(root);
    const outputDir = join(root, 'Documents', 'book');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'page_1.png'), 'img');
    writeFileSync(join(outputDir, 'book-editable.pptx'), 'deck');
    writeFileSync(join(outputDir, 'book-editable.pdf'), 'pdf');
    writeFileSync(join(outputDir, 'book.docx'), 'doc');
    const store = {
      updateJob(id, patch) { this.jobs[id] = { ...this.jobs[id], ...patch }; },
      jobs: { 'job-1': {} }
    };
    const project = {
      id: 'book-1',
      outputDir,
      jobs: [{ id: 'job-1', outputPath: join(outputDir, 'page_1.png') }]
    };
    migrateProjectWorkingFiles(store, project);
    assert.equal(existsSync(join(outputDir, 'page_1.png')), false);
    assert.equal(existsSync(join(root, 'workspace', 'book-1', 'pages', 'page_1.png')), true);
    assert.equal(existsSync(join(outputDir, 'book-editable.pptx')), true);
    assert.equal(existsSync(join(outputDir, 'book-editable.pdf')), true);
    assert.equal(existsSync(join(outputDir, 'book.docx')), true);
    assert.equal(project.jobs[0].outputPath, join(root, 'workspace', 'book-1', 'pages', 'page_1.png'));
  } finally {
    setWorkspaceRoot(null);
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish deliverables stay in the customer folder', () => {
  assert.equal(isPublishDeliverable('book-editable.pptx'), true);
  assert.equal(isPublishDeliverable('page_1.png'), false);
  assert.equal(isPublishDeliverable('page_1.card.jpg'), false);
});
