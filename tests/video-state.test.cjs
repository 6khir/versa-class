'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  getVideo,
  applyVideoToListing,
  mirrorVideoOnListing,
  setVideo,
  updateVideo,
  hasValidVideoFile,
  emptyVideo,
  hasNewVideoState
} = require('../src/video-state.cjs');
const { resolveFinalExportVideoPath, buildFinalExportManifest } = require('../src/file-manager.cjs');

function makeMp4(dir, name = 'preview.mp4') {
  const filePath = join(dir, name);
  // Export gate uses minBytes 8000
  writeFileSync(filePath, Buffer.alloc(9000, 1));
  return filePath;
}

test('1. legacy-only project reads correctly via getVideo()', () => {
  const project = {
    tptListing: {
      videoPreviewPath: '/legacy/preview.mp4',
      videoPreviewStatus: 'ready',
      videoPreviewError: null,
      videoPreviewConversationUrl: 'https://chat.example/v'
    }
  };
  const video = getVideo(project, { existsSync: () => false });
  assert.equal(hasNewVideoState(project.tptListing), false);
  assert.equal(video.path, '/legacy/preview.mp4');
  // ready without FS is demoted (rule 6)
  assert.notEqual(video.status, 'ready');
  assert.equal(video.conversationUrl, 'https://chat.example/v');
});

test('2. new video state reads correctly', () => {
  const video = getVideo({
    tptListing: {
      video: {
        path: '/new/preview.mp4',
        status: 'generating',
        error: null,
        conversationUrl: 'https://new'
      }
    }
  }, { existsSync: () => false });
  assert.equal(video.path, '/new/preview.mp4');
  assert.equal(video.status, 'generating');
  assert.equal(video.conversationUrl, 'https://new');
});

test('3. missing new state falls back to legacy', () => {
  const video = getVideo({
    tptListing: {
      videoPreviewPath: '/only-legacy.mp4',
      videoPreviewStatus: 'failed',
      videoPreviewError: 'boom'
    }
  }, { existsSync: () => false });
  assert.equal(video.path, '/only-legacy.mp4');
  assert.equal(video.status, 'failed');
  assert.equal(video.error, 'boom');
});

test('4. dual-write updates nested + legacy', () => {
  const listing = applyVideoToListing(
    { title: 'Keep SEO', seoText: 'TITLE\nX', thumbnailPaths: ['/m.png'] },
    {
      path: '/v.mp4',
      status: 'ready',
      error: null,
      conversationUrl: 'https://veo'
    }
  );
  assert.equal(listing.title, 'Keep SEO');
  assert.equal(listing.seoText, 'TITLE\nX');
  assert.deepEqual(listing.thumbnailPaths, ['/m.png']);
  assert.ok(listing.video);
  assert.equal(listing.video.path, '/v.mp4');
  assert.equal(listing.videoPreviewPath, '/v.mp4');
  assert.equal(listing.videoPreviewStatus, 'ready');
  assert.equal(listing.videoPreviewConversationUrl, 'https://veo');
});

test('5. successful generation-style write preserves both representations', () => {
  const next = applyVideoToListing({ status: 'assets_ready' }, {
    path: '/out/tpt-preview/preview.mp4',
    status: 'ready',
    error: null,
    conversationUrl: 'https://chat/preview'
  });
  assert.equal(next.video.path, '/out/tpt-preview/preview.mp4');
  assert.equal(next.videoPreviewPath, '/out/tpt-preview/preview.mp4');
  assert.equal(next.video.status, 'ready');
  assert.equal(next.videoPreviewStatus, 'ready');
});

test('6. clear updates both representations', () => {
  const base = applyVideoToListing({}, {
    path: '/v.mp4',
    status: 'ready',
    conversationUrl: 'https://x'
  });
  const cleared = applyVideoToListing(base, {
    path: null,
    status: 'pending',
    error: null,
    conversationUrl: null
  });
  assert.equal(cleared.video.path, null);
  assert.equal(cleared.videoPreviewPath, null);
  assert.equal(cleared.video.status, 'pending');
  assert.equal(cleared.videoPreviewStatus, 'pending');
});

test('7. failed generation preserves error on both sides', () => {
  const failed = applyVideoToListing({}, {
    status: 'failed',
    error: 'Veo timed out'
  });
  assert.equal(failed.video.status, 'failed');
  assert.equal(failed.videoPreviewStatus, 'failed');
  assert.equal(failed.video.error, 'Veo timed out');
  assert.equal(failed.videoPreviewError, 'Veo timed out');
});

test('8–9. existing MP4 recognized; nonexistent not valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-video-'));
  try {
    const real = makeMp4(root);
    assert.equal(hasValidVideoFile({
      tptListing: applyVideoToListing({}, { path: real, status: 'ready' })
    }), true);
    assert.equal(hasValidVideoFile({
      tptListing: applyVideoToListing({}, { path: join(root, 'missing.mp4'), status: 'ready' })
    }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('10. new nonexistent + legacy valid → prefer filesystem reality', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-video-d-'));
  try {
    const real = makeMp4(root, 'legacy.mp4');
    const video = getVideo({
      tptListing: {
        video: {
          path: join(root, 'ghost.mp4'),
          status: 'ready',
          error: null,
          conversationUrl: 'https://new'
        },
        videoPreviewPath: real,
        videoPreviewStatus: 'ready',
        videoPreviewError: null
      }
    });
    assert.equal(video.path, real);
    assert.equal(hasValidVideoFile({ tptListing: { video: { path: video.path, status: 'ready' } } }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('11. both valid → new state wins', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-video-both-'));
  try {
    const neu = makeMp4(root, 'new.mp4');
    const leg = makeMp4(root, 'legacy.mp4');
    const video = getVideo({
      tptListing: {
        video: { path: neu, status: 'ready', conversationUrl: 'https://new' },
        videoPreviewPath: leg,
        videoPreviewStatus: 'ready',
        videoPreviewConversationUrl: 'https://legacy'
      }
    });
    assert.equal(video.path, neu);
    assert.equal(video.conversationUrl, 'https://new');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('12. export resolveFinalExportVideoPath uses getVideo', () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-video-export-'));
  try {
    const videoPath = makeMp4(root, 'export.mp4');
    const project = {
      name: 'Export Book',
      outputDir: root,
      tptListing: {
        // new state only
        video: { path: videoPath, status: 'ready', error: null, conversationUrl: null }
      }
    };
    assert.equal(resolveFinalExportVideoPath(project), videoPath);
    const manifest = buildFinalExportManifest(project, {
      pdfPath: makeMp4(root, 'book.pdf'),
      pptxPath: makeMp4(root, 'book.pptx'),
      docxPath: makeMp4(root, 'book.docx'),
      videoPath
    });
    assert.ok(manifest.artifacts.some((item) => item.type === 'video' && item.included));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('17–18. SEO / marketplace fields untouched by video dual-write', () => {
  const listing = applyVideoToListing({
    title: 'SEO',
    description: 'Desc',
    tags: ['a'],
    seoText: 'TITLE\nSEO',
    productPdfPath: '/book.pdf',
    previewPdfPath: '/preview.pdf',
    status: 'ready_to_upload',
    uploadUrl: 'https://tpt.example',
    thumbnailPaths: ['/m1.png']
  }, { path: '/v.mp4', status: 'ready' });
  assert.equal(listing.title, 'SEO');
  assert.equal(listing.seoText, 'TITLE\nSEO');
  assert.equal(listing.productPdfPath, '/book.pdf');
  assert.equal(listing.previewPdfPath, '/preview.pdf');
  assert.equal(listing.status, 'ready_to_upload');
  assert.equal(listing.uploadUrl, 'https://tpt.example');
  assert.deepEqual(listing.thumbnailPaths, ['/m1.png']);
});

test('setVideo / updateVideo persist through store-shaped stub', () => {
  const projects = new Map();
  projects.set('p1', {
    id: 'p1',
    tptListing: { title: 'Keep', thumbnailPaths: ['/m.png'] }
  });
  const store = {
    getProject: (id) => projects.get(id),
    updateProject: (id, patch) => {
      const next = { ...projects.get(id), ...patch };
      projects.set(id, next);
      return next;
    }
  };
  setVideo(store, 'p1', {
    path: '/a.mp4',
    status: 'ready',
    error: null,
    conversationUrl: 'https://c'
  });
  let project = store.getProject('p1');
  assert.equal(project.tptListing.videoPreviewPath, '/a.mp4');
  assert.equal(project.tptListing.video.path, '/a.mp4');
  assert.equal(project.tptListing.title, 'Keep');
  assert.deepEqual(project.tptListing.thumbnailPaths, ['/m.png']);

  updateVideo(store, 'p1', { status: 'failed', error: 'x' });
  project = store.getProject('p1');
  assert.equal(project.tptListing.videoPreviewStatus, 'failed');
  assert.equal(project.tptListing.video.error, 'x');
});

test('mirrorVideoOnListing syncs legacy-only listing into nested video', () => {
  const mirrored = mirrorVideoOnListing({
    title: 'X',
    videoPreviewPath: '/legacy.mp4',
    videoPreviewStatus: 'generating',
    seoText: 'TITLE\nX'
  }, { existsSync: () => false });
  assert.equal(mirrored.video.path, '/legacy.mp4');
  assert.equal(mirrored.videoPreviewPath, '/legacy.mp4');
  assert.equal(mirrored.video.status, 'generating');
  assert.equal(mirrored.seoText, 'TITLE\nX');
});

test('empty defaults', () => {
  assert.deepEqual(getVideo({}), emptyVideo());
});
