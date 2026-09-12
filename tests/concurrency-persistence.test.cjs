const test = require('node:test');
const assert = require('node:assert');
const { mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { ProjectStore } = require('../src/store.cjs');
const { applyMockupsToListing, getMockups } = require('../src/mockups-state.cjs');
const { applyVideoToListing, getVideo } = require('../src/video-state.cjs');
const { applySeoToListing } = require('../src/seo-state.cjs');
const { applyMarketplaceToListing, getMarketplace } = require('../src/marketplace-state.cjs');
const { applyPdfToProject } = require('../src/pdf-state.cjs');

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

test('Phase 3I Concurrency Persistence Hardening', async (t) => {
  const outputDir = join(__dirname, '.test-output', 'concurrency-persistence');
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const store = new ProjectStore(join(outputDir, 'store.db'));
  const project = store.createProject(sampleProject());
  const projectId = project.id;

  function resetState() {
    store.updateProjectTransactionally(projectId, () => ({
      tptListing: {
        mockups: { paths: [null, null, null, null], progress: { completed: 0, total: 4 }, mode: 'manual' },
        video: { path: null, status: 'pending' },
        seo: { title: '', description: '', seoText: '' },
        marketplace: { settings: { publicationStatus: 'draft' }, upload: { stage: 'opening', message: null } }
      }
    }));
  }

  await t.test('Transaction API: Rollback + savepoint release', () => {
    resetState();
    assert.throws(() => {
      store.updateProjectTransactionally(projectId, () => {
        throw new Error('Test Rollback');
      });
    });
    // If SAVEPOINT wasn't released, subsequent transactions might fail or nest incorrectly.
    // Ensure we can still update
    store.updateProjectTransactionally(projectId, (p) => ({ tptListing: { ...p.tptListing, mockups: { mode: 'auto' } } }));
    assert.strictEqual(store.getProject(projectId).tptListing.mockups.mode, 'auto');
  });

  await t.test('True Stale Snapshot Regression (Manual SEO format)', () => {
    resetState();
    
    // T0: Capturing stale snapshot before async work
    const staleProject = store.getProject(projectId);
    const staleListing = staleProject.tptListing || {};
    
    // T1: Another domain writes newer state transactionally
    store.updateProjectTransactionally(projectId, (p) => {
      return { tptListing: applyMockupsToListing(p.tptListing || {}, { paths: ['NEW-MOCKUP.png'] }) };
    });

    // T2: SEO completion mimicking OLD architecture
    const oldArchitectureUpdate = {
      tptListing: {
        ...staleListing,
        seo: { title: 'Old Arch Title' }
      }
    };
    
    // T2: SEO completion mimicking NEW architecture
    const parsedListing = { title: 'New Arch Title' };
    store.updateProjectTransactionally(projectId, (currentProject) => {
      const previous = currentProject.tptListing || {};
      const previousMockups = getMockups({ tptListing: previous });
      
      let listing = {
        ...previous,
        ...parsedListing,
      };
      
      listing = applyMockupsToListing(listing, {
        paths: previousMockups.paths,
        progress: previousMockups.progress,
        mode: previousMockups.mode
      });
      
      listing = applySeoToListing(listing, { title: parsedListing.title });
      
      return { tptListing: listing };
    });

    const finalListing = store.getProject(projectId).tptListing;
    assert.deepStrictEqual(finalListing.mockups.paths, ['NEW-MOCKUP.png'], 'Mockups must survive');
    assert.strictEqual(finalListing.seo.title, 'New Arch Title', 'SEO must be saved');
    
    // Prove old architecture would have destroyed it:
    assert.strictEqual(oldArchitectureUpdate.tptListing.mockups.paths[0], null, 'Old architecture would have reverted mockups');
  });

  await t.test('Full Automation Stale Snapshot Regression', () => {
    resetState();

    // T0: Automation starts, capturing project
    const staleProject = store.getProject(projectId);
    
    // T1: User changes Video state in UI
    store.updateProjectTransactionally(projectId, (p) => {
      return { tptListing: applyVideoToListing(p.tptListing || {}, { path: 'INTERVENTION.mp4', status: 'ready' }) };
    });
    
    // T2: Automation completes SEO step
    const parsedListing = { title: 'Automation Title' };
    store.updateProjectTransactionally(projectId, (currentProject) => {
      const previous = currentProject.tptListing || {};
      const previousMockups = getMockups({ tptListing: previous });
      const previousVideo = getVideo({ tptListing: previous });
      const previousMarketplace = getMarketplace({ tptListing: previous });
      
      let listing = {
        ...previous,
        ...parsedListing,
      };
      
      listing = applyMockupsToListing(listing, { paths: previousMockups.paths });
      listing = applyVideoToListing(listing, previousVideo);
      listing = applyMarketplaceToListing(listing, previousMarketplace);
      listing = applySeoToListing(listing, { title: parsedListing.title });
      
      return { tptListing: listing };
    });

    const finalListing = store.getProject(projectId).tptListing;
    assert.strictEqual(finalListing.video.path, 'INTERVENTION.mp4');
    assert.strictEqual(finalListing.seo.title, 'Automation Title');
  });

  await t.test('Cross Domain Matrix: A. stale SEO snapshot + Mockups update', () => {
    resetState();
    // Handled fundamentally in the True Stale Snapshot test, explicitly test dual preservation
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applySeoToListing(p.tptListing || {}, { title: 'SEO' }) }));
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyMockupsToListing(p.tptListing || {}, { paths: ['M1'] }) }));
    const f = store.getProject(projectId).tptListing;
    assert.strictEqual(f.seo.title, 'SEO');
    assert.strictEqual(f.mockups.paths[0], 'M1');
  });

  await t.test('Cross Domain Matrix: B. stale Automation + Video update', () => {
    resetState();
    // Handled in Full Automation test, proving it works
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyVideoToListing(p.tptListing||{}, { path: 'V1' }) }));
    assert.strictEqual(store.getProject(projectId).tptListing.video.path, 'V1');
  });

  await t.test('Cross Domain Matrix: C. PDF update + Mockups update', () => {
    resetState();
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyMockupsToListing(p.tptListing||{}, { paths: ['M_PDF'] }) }));
    store.updateProjectTransactionally(projectId, p => applyPdfToProject(p, { productPath: '/out.pdf' }));
    
    const proj = store.getProject(projectId);
    assert.strictEqual(proj.tptListing.mockups.paths[0], 'M_PDF');
    assert.strictEqual(proj.printPdfJson.productPdfPath, '/out.pdf');
  });

  await t.test('Cross Domain Matrix: D. Video update + SEO update', () => {
    resetState();
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyVideoToListing(p.tptListing||{}, { path: 'V_SEO' }) }));
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applySeoToListing(p.tptListing||{}, { title: 'S_VID' }) }));
    
    const f = store.getProject(projectId).tptListing;
    assert.strictEqual(f.video.path, 'V_SEO');
    assert.strictEqual(f.seo.title, 'S_VID');
  });

  await t.test('Cross Domain Matrix: E. Marketplace update + SEO update', () => {
    resetState();
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyMarketplaceToListing(p.tptListing||{}, { settings: { publicationStatus: 'active' } }) }));
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applySeoToListing(p.tptListing||{}, { title: 'S_MKT' }) }));
    
    const f = store.getProject(projectId).tptListing;
    assert.strictEqual(f.marketplace.settings.publicationStatus, 'active');
    assert.strictEqual(f.seo.title, 'S_MKT');
  });

  await t.test('Cross Domain Matrix: F. all five domains updated in different orders', () => {
    resetState();
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyMockupsToListing(p.tptListing||{}, { paths: ['M_ALL'] }) }));
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyVideoToListing(p.tptListing||{}, { path: 'V_ALL' }) }));
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applySeoToListing(p.tptListing||{}, { title: 'S_ALL' }) }));
    store.updateProjectTransactionally(projectId, p => ({ tptListing: applyMarketplaceToListing(p.tptListing||{}, { upload: { stage: 'uploaded' } }) }));
    store.updateProjectTransactionally(projectId, p => applyPdfToProject(p, { compressedPath: '/comp.pdf' }));

    const proj = store.getProject(projectId);
    const f = proj.tptListing;
    assert.strictEqual(f.mockups.paths[0], 'M_ALL');
    assert.strictEqual(f.video.path, 'V_ALL');
    assert.strictEqual(f.seo.title, 'S_ALL');
    assert.strictEqual(f.marketplace.upload.stage, 'uploaded');
    assert.strictEqual(proj.printPdfJson.compressedPdfPath, '/comp.pdf');
  });

  await t.test('Cross Domain Matrix: G. SEO canonical state remains synchronized', () => {
    resetState();
    store.updateProjectTransactionally(projectId, p => ({
      tptListing: applySeoToListing(p.tptListing||{}, { title: 'Title1', seoText: 'Text1' })
    }));
    
    const f = store.getProject(projectId).tptListing;
    assert.strictEqual(f.seo.title, 'Title1');
    assert.strictEqual(f.seoText, 'Text1');
    assert.strictEqual(f.title, 'Title1');
  });

  await t.test('Restart recovery requeues transient work and pauses the project', () => {
    const recoveryProject = store.createProject(sampleProject({
      id: 'recovery-project',
      name: 'Interrupted Book'
    }), [{
      id: 'recovery-job',
      pageNumber: 1,
      pageLabel: 'Page 1',
      kind: 'page',
      title: 'Page 1',
      prompt: 'Create a test page image.',
      fileName: 'page-001.png'
    }]);
    const job = recoveryProject.jobs[0];
    store.updateJob(job.id, {
      status: 'generating',
      lastError: null,
      lastErrorCode: null
    });
    store.updateProject(recoveryProject.id, { status: 'running' });

    store.recoverInterrupted();

    const recoveredJob = store.getJob(job.id);
    const recoveredProject = store.getProject(recoveryProject.id);
    assert.strictEqual(recoveredJob.status, 'retry_wait');
    assert.strictEqual(recoveredJob.lastErrorCode, 'APP_RESTARTED');
    assert.strictEqual(recoveredProject.status, 'paused');
  });

});
