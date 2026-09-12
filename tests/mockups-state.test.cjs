'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  getMockups,
  applyMockupsToListing,
  mirrorMockupsOnListing,
  setMockups,
  updateMockups,
  countValidMockupPaths,
  emptyMockups,
  hasNewMockupsState
} = require('../src/mockups-state.cjs');
const { collectFinalMockupPaths, buildFinalExportManifest } = require('../src/file-manager.cjs');

function makeExistingFile(dir, name) {
  const filePath = join(dir, name);
  writeFileSync(filePath, Buffer.alloc(1200, 7));
  return filePath;
}

test('1. legacy-only project readable via getMockups()', () => {
  const project = {
    tptListing: {
      thumbnailPaths: ['/a.png', '/b.png', null, '/d.png'],
      thumbnailBriefs: ['one', 'two'],
      thumbnailProgress: { completed: 3, total: 4 },
      thumbnailConversationUrl: 'https://chat.example/1',
      thumbnailError: null,
      thumbnailMode: 'manual'
    }
  };
  const mockups = getMockups(project);
  assert.equal(hasNewMockupsState(project.tptListing), false);
  assert.deepEqual(mockups.paths, ['/a.png', '/b.png', null, '/d.png']);
  assert.deepEqual(mockups.briefs, ['one', 'two']);
  assert.equal(mockups.conversationUrl, 'https://chat.example/1');
  assert.equal(mockups.mode, 'manual');
});

test('2. empty project gets safe defaults', () => {
  assert.deepEqual(getMockups({}), emptyMockups());
  assert.deepEqual(getMockups({ tptListing: null }), emptyMockups());
});

test('3–4. applyMockupsToListing dual-writes nested + legacy', () => {
  const listing = applyMockupsToListing(
    { title: 'Keep me', seoText: 'TITLE\nKeep' },
    {
      paths: ['/m1.png', '/m2.png'],
      briefs: ['a', 'b', 'c', 'd'],
      progress: { completed: 2, total: 4 },
      conversationUrl: 'https://chat.example/m',
      error: null,
      mode: 'manual'
    },
    { status: 'assets_ready' }
  );
  assert.equal(listing.title, 'Keep me');
  assert.equal(listing.seoText, 'TITLE\nKeep');
  assert.equal(listing.status, 'assets_ready');
  assert.ok(listing.mockups);
  assert.deepEqual(listing.mockups.paths, ['/m1.png', '/m2.png']);
  assert.deepEqual(listing.thumbnailPaths, ['/m1.png', '/m2.png']);
  assert.deepEqual(listing.thumbnailBriefs, ['a', 'b', 'c', 'd']);
  assert.deepEqual(listing.thumbnailProgress, { completed: 2, total: 4 });
  assert.equal(listing.thumbnailConversationUrl, 'https://chat.example/m');
  assert.equal(listing.thumbnailMode, 'manual');
  assert.equal(listing.videoPreviewPath, undefined);
});

test('5. regeneration-style patch updates both representations', () => {
  const base = applyMockupsToListing({}, {
    paths: ['/old1.png', null, null, null],
    progress: { completed: 1, total: 4 }
  });
  const next = applyMockupsToListing(base, {
    paths: ['/old1.png', '/new2.png', null, null],
    conversationUrl: 'https://chat.example/regen',
    progress: { completed: 2, total: 4 },
    error: null
  }, { status: 'assets_ready' });
  assert.deepEqual(next.mockups.paths, ['/old1.png', '/new2.png', null, null]);
  assert.deepEqual(next.thumbnailPaths, ['/old1.png', '/new2.png', null, null]);
  assert.equal(next.thumbnailConversationUrl, 'https://chat.example/regen');
  assert.equal(next.mockups.conversationUrl, 'https://chat.example/regen');
});

test('6. clear updates both representations', () => {
  const base = applyMockupsToListing({}, {
    paths: ['/a.png', '/b.png', '/c.png', '/d.png'],
    progress: { completed: 4, total: 4 }
  });
  const cleared = applyMockupsToListing(base, {
    paths: [],
    progress: { completed: 0, total: 4 },
    error: null
  }, { status: 'draft_ready' });
  assert.deepEqual(cleared.mockups.paths, []);
  assert.deepEqual(cleared.thumbnailPaths, []);
  assert.deepEqual(cleared.thumbnailProgress, { completed: 0, total: 4 });
});

test('7–8. filesystem-backed validity; nonexistent paths are not complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-mockups-'));
  try {
    const thumbDir = join(root, 'tpt-thumbnails');
    mkdirSync(thumbDir, { recursive: true });
    const real = [
      makeExistingFile(thumbDir, 'thumbnail_1.png'),
      makeExistingFile(thumbDir, 'thumbnail_2.png'),
      makeExistingFile(thumbDir, 'thumbnail_3.png'),
      makeExistingFile(thumbDir, 'thumbnail_4.png')
    ];
    const project = {
      outputDir: root,
      tptListing: applyMockupsToListing({}, { paths: real })
    };
    assert.equal(countValidMockupPaths(project), 4);

    const ghost = {
      tptListing: applyMockupsToListing({}, {
        paths: ['/missing/1.png', '/missing/2.png', '/missing/3.png', '/missing/4.png']
      })
    };
    assert.equal(countValidMockupPaths(ghost), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('9. export collectFinalMockupPaths uses getMockups', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-mockups-export-'));
  try {
    const thumbDir = join(root, 'tpt-thumbnails');
    mkdirSync(thumbDir, { recursive: true });
    const pathA = makeExistingFile(thumbDir, 'thumbnail_1.png');
    const pathB = makeExistingFile(thumbDir, 'thumbnail_2.png');
    const project = {
      name: 'Export Book',
      outputDir: root,
      tptListing: {
        // new state only — legacy absent on purpose
        mockups: {
          paths: [pathA, pathB],
          briefs: [],
          progress: { completed: 2, total: 4 },
          conversationUrl: null,
          error: null,
          mode: 'manual'
        }
      }
    };
    const collected = collectFinalMockupPaths(project);
    assert.deepEqual(collected, [pathA, pathB]);
    const manifest = buildFinalExportManifest(project, {
      pdfPath: makeExistingFile(root, 'book.pdf'),
      pptxPath: makeExistingFile(root, 'book.pptx'),
      docxPath: makeExistingFile(root, 'book.docx')
    });
    assert.equal(manifest.mockups.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reconciliation CASE A: new + legacy same paths', () => {
  const paths = ['/same/1.png', '/same/2.png'];
  const listing = {
    mockups: { paths, briefs: ['x'], progress: { completed: 2, total: 4 }, mode: 'manual' },
    thumbnailPaths: paths,
    thumbnailBriefs: ['x'],
    thumbnailProgress: { completed: 2, total: 4 },
    thumbnailMode: 'manual'
  };
  const mockups = getMockups({ tptListing: listing }, { existsSync: () => false });
  assert.deepEqual(mockups.paths, paths);
});

test('reconciliation CASE B: new missing, legacy valid', () => {
  const mockups = getMockups({
    tptListing: {
      thumbnailPaths: ['/legacy/a.png'],
      thumbnailBriefs: ['legacy brief'],
      thumbnailMode: 'manual'
    }
  });
  assert.deepEqual(mockups.paths, ['/legacy/a.png']);
  assert.deepEqual(mockups.briefs, ['legacy brief']);
});

test('reconciliation CASE C: new valid, legacy missing', () => {
  const mockups = getMockups({
    tptListing: {
      mockups: {
        paths: ['/new/a.png', '/new/b.png'],
        briefs: ['n'],
        progress: { completed: 2, total: 4 },
        mode: 'manual'
      }
    }
  }, { existsSync: () => false });
  assert.deepEqual(mockups.paths, ['/new/a.png', '/new/b.png']);
});

test('reconciliation CASE D: new nonexistent, legacy filesystem-valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-mockups-d-'));
  try {
    const real = makeExistingFile(root, 'real.png');
    const mockups = getMockups({
      tptListing: {
        mockups: {
          paths: [join(root, 'ghost.png')],
          briefs: ['new'],
          progress: { completed: 1, total: 4 },
          mode: 'manual'
        },
        thumbnailPaths: [real],
        thumbnailBriefs: ['legacy'],
        thumbnailProgress: { completed: 1, total: 4 }
      }
    });
    assert.deepEqual(mockups.paths, [real]);
    assert.equal(countValidMockupPaths({ tptListing: { mockups: { paths: mockups.paths } } }), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reconciliation CASE E: mixed missing files — do not invent completion', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-mockups-e-'));
  try {
    const real = makeExistingFile(root, 'ok.png');
    const project = {
      tptListing: applyMockupsToListing({}, {
        paths: [real, join(root, 'missing.png'), null, join(root, 'also-missing.png')]
      })
    };
    assert.equal(countValidMockupPaths(project), 1);
    assert.equal(getMockups(project).paths.filter(Boolean).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('14–16. Video / SEO / marketplace fields untouched by mockups dual-write', () => {
  const listing = applyMockupsToListing({
    title: 'SEO Title',
    description: 'SEO Desc',
    tags: ['tag'],
    seoText: 'TITLE\nSEO Title',
    videoPreviewPath: '/video.mp4',
    videoPreviewStatus: 'ready',
    videoPreviewError: null,
    videoPreviewConversationUrl: 'https://veo',
    productPdfPath: '/book.pdf',
    previewPdfPath: '/preview.pdf',
    status: 'ready_to_upload',
    uploadUrl: 'https://tpt.example/upload'
  }, {
    paths: ['/m.png'],
    progress: { completed: 1, total: 4 }
  });
  assert.equal(listing.title, 'SEO Title');
  assert.equal(listing.seoText, 'TITLE\nSEO Title');
  assert.equal(listing.videoPreviewPath, '/video.mp4');
  assert.equal(listing.videoPreviewStatus, 'ready');
  assert.equal(listing.videoPreviewConversationUrl, 'https://veo');
  assert.equal(listing.productPdfPath, '/book.pdf');
  assert.equal(listing.previewPdfPath, '/preview.pdf');
  assert.equal(listing.status, 'ready_to_upload');
  assert.equal(listing.uploadUrl, 'https://tpt.example/upload');
});

test('setMockups / updateMockups persist through store-shaped stub', () => {
  const projects = new Map();
  projects.set('p1', {
    id: 'p1',
    tptListing: { title: 'Keep', videoPreviewPath: '/v.mp4' }
  });
  const store = {
    getProject: (id) => projects.get(id),
    updateProject: (id, patch) => {
      const next = { ...projects.get(id), ...patch };
      projects.set(id, next);
      return next;
    }
  };
  setMockups(store, 'p1', {
    paths: ['/a.png', '/b.png'],
    briefs: ['b1', 'b2'],
    progress: { completed: 2, total: 4 },
    mode: 'manual'
  }, { listingExtras: { status: 'assets_ready' } });
  let project = store.getProject('p1');
  assert.deepEqual(project.tptListing.thumbnailPaths, ['/a.png', '/b.png']);
  assert.deepEqual(project.tptListing.mockups.paths, ['/a.png', '/b.png']);
  assert.equal(project.tptListing.title, 'Keep');
  assert.equal(project.tptListing.videoPreviewPath, '/v.mp4');

  updateMockups(store, 'p1', { paths: ['/a.png', '/b.png', '/c.png'], progress: { completed: 3, total: 4 } });
  project = store.getProject('p1');
  assert.deepEqual(project.tptListing.thumbnailPaths, ['/a.png', '/b.png', '/c.png']);
  assert.deepEqual(project.tptListing.mockups.paths, ['/a.png', '/b.png', '/c.png']);
});

test('mirrorMockupsOnListing syncs legacy-only listing into nested mockups', () => {
  const mirrored = mirrorMockupsOnListing({
    title: 'X',
    thumbnailPaths: ['/l1.png'],
    thumbnailBriefs: ['brief'],
    thumbnailMode: 'manual',
    videoPreviewPath: '/keep.mp4'
  });
  assert.deepEqual(mirrored.mockups.paths, ['/l1.png']);
  assert.deepEqual(mirrored.thumbnailPaths, ['/l1.png']);
  assert.equal(mirrored.videoPreviewPath, '/keep.mp4');
  assert.equal(mirrored.title, 'X');
});
