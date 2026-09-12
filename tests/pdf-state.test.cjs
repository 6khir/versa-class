const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getPdf, applyPdfToProject, hasValidPdfFile } = require('../src/pdf-state.cjs');

test('Phase 3F PDF State Isolation', async (t) => {
  await t.test('1. Empty project state', () => {
    const pdf = getPdf({});
    assert.equal(pdf.productPath, null);
    assert.equal(pdf.compressedPath, null);
    assert.equal(pdf.thankYouPath, null);
    assert.deepEqual(pdf.metadata, {
      stage: null, error: null, message: null, originalBytes: null, outputBytes: null,
      pageCount: null, skipped: null, reason: null, checksum: null, updatedAt: null
    });
  });

  await t.test('2. Legacy root fallback', () => {
    const pdf = getPdf({ productPdfPath: '/root.pdf', compressedPdfPath: '/root-comp.pdf', thankYouPdfPath: '/root-ty.pdf' });
    assert.equal(pdf.productPath, '/root.pdf');
    assert.equal(pdf.compressedPath, '/root-comp.pdf');
    assert.equal(pdf.thankYouPath, '/root-ty.pdf');
  });

  await t.test('3. tptListing fallback', () => {
    const pdf = getPdf({ tptListing: { productPdfPath: '/tpt.pdf' } });
    assert.equal(pdf.productPath, '/tpt.pdf');
  });

  await t.test('4. printPdfJson canonical extraction', () => {
    const pdf = getPdf({
      printPdfJson: {
        productPdfPath: '/can.pdf', compressedPdfPath: '/can-comp.pdf', thankYouPdfPath: '/can-ty.pdf',
        stage: 'ready', checksum: 'abc'
      }
    });
    assert.equal(pdf.productPath, '/can.pdf');
    assert.equal(pdf.compressedPath, '/can-comp.pdf');
    assert.equal(pdf.thankYouPath, '/can-ty.pdf');
    assert.equal(pdf.metadata.stage, 'ready');
    assert.equal(pdf.metadata.checksum, 'abc');
  });

  await t.test('5. Conservative merge and precedence', () => {
    // printPdfJson wins over root, root wins over tptListing
    const pdf = getPdf({
      tptListing: { productPdfPath: '/tpt.pdf' },
      productPdfPath: '/root.pdf',
      printPdfJson: { productPdfPath: '/can.pdf' }
    });
    assert.equal(pdf.productPath, '/can.pdf');
    
    const pdf2 = getPdf({
      tptListing: { productPdfPath: '/tpt.pdf' },
      productPdfPath: '/root.pdf'
    });
    assert.equal(pdf2.productPath, '/root.pdf');
  });

  await t.test('6. Never allow empty/null canonical to erase legacy', () => {
    const pdf = getPdf({
      tptListing: { productPdfPath: '/tpt.pdf' },
      printPdfJson: { }
    });
    assert.equal(pdf.productPath, '/tpt.pdf');
  });

  await t.test('7. applyPdfToProject dual-write compatibility', () => {
    const patch1 = applyPdfToProject({}, { productPath: '/new.pdf', compressedPath: '/new-comp.pdf', metadata: { stage: 'converting' } });
    assert.equal(patch1.productPdfPath, '/new.pdf');
    assert.equal(patch1.compressedPdfPath, '/new-comp.pdf');
    assert.equal(patch1.printPdfJson.productPdfPath, '/new.pdf');
    assert.equal(patch1.printPdfJson.compressedPdfPath, '/new-comp.pdf');
    assert.equal(patch1.printPdfJson.stage, 'converting');
    assert.equal(patch1.tptListing, undefined);
    
    const patch2 = applyPdfToProject({ tptListing: { status: 'draft' } }, { productPath: '/new2.pdf' });
    assert.equal(patch2.tptListing.productPdfPath, '/new2.pdf');
    assert.equal(patch2.tptListing.status, 'draft');
  });

  await t.test('8. Preservation of unrelated state (Mockups, Video, SEO, Marketplace, etc.)', () => {
    const proj = {
      mockups: { status: 'ready' },
      video: { path: '/v.mp4' },
      tptListing: {
        seoText: 'hello',
        marketplace: { suggestedPrice: '5.00' }
      }
    };
    const patch = applyPdfToProject(proj, { productPath: '/book.pdf' });
    
    // The patch should NOT contain unrelated root properties
    assert.equal(patch.mockups, undefined);
    assert.equal(patch.video, undefined);
    assert.equal(patch.title, undefined);
    
    // It should include the mutated tptListing but preserve existing values
    assert.equal(patch.tptListing.productPdfPath, '/book.pdf');
    assert.equal(patch.tptListing.seoText, 'hello');
    assert.equal(patch.tptListing.marketplace.suggestedPrice, '5.00');
  });

  await t.test('9. Explicit null clears properties', () => {
    const proj = { productPdfPath: '/old.pdf', tptListing: { productPdfPath: '/old.pdf' }, printPdfJson: { productPdfPath: '/old.pdf' } };
    const patch = applyPdfToProject(proj, { productPath: null });
    // It returns an explicit null to trigger store deletion logic
    assert.equal(patch.productPdfPath, null);
    assert.equal(patch.tptListing.productPdfPath, undefined); // deleted from the nested object
    assert.equal(patch.printPdfJson.productPdfPath, undefined);
  });

  await t.test('10. Filesystem validation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
    const goodPath = path.join(tmpDir, 'good.pdf');
    fs.writeFileSync(goodPath, '%PDF-1.7\n');
    
    assert.equal(hasValidPdfFile(goodPath), true);
    assert.equal(hasValidPdfFile(path.join(tmpDir, 'missing.pdf')), false);
    assert.equal(hasValidPdfFile(null), false);
    assert.equal(hasValidPdfFile(''), false);
    
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
