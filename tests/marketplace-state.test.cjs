const test = require('node:test');
const assert = require('node:assert');
const { getMarketplace, applyMarketplaceToListing, mirrorMarketplaceOnListing } = require('../src/marketplace-state.cjs');

test('1. Empty Marketplace state', () => {
  const result = getMarketplace({});
  assert.strictEqual(result.settings.isFreeResource, undefined);
  assert.strictEqual(result.upload.stage, undefined);
});

test('2. Legacy-only state reconstruction', () => {
  const listing = {
    isFreeResource: true,
    suggestedPrice: '4.99',
    reviewApproved: true,
    uploadStage: 'testing'
  };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.settings.isFreeResource, true);
  assert.strictEqual(result.settings.suggestedPrice, '4.99');
  assert.strictEqual(result.review.approved, true);
  assert.strictEqual(result.upload.stage, 'testing');
});

test('3. Canonical-only state', () => {
  const listing = {
    marketplace: {
      settings: { isFreeResource: false, suggestedPrice: '5.99' },
      upload: { stage: 'done' }
    }
  };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.settings.isFreeResource, false);
  assert.strictEqual(result.settings.suggestedPrice, '5.99');
  assert.strictEqual(result.upload.stage, 'done');
});

test('4. Canonical + legacy merge', () => {
  const listing = {
    taxCode: 'tx_old',
    marketplace: {
      settings: { suggestedPrice: '2.99' }
    }
  };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.settings.taxCode, 'tx_old');
  assert.strictEqual(result.settings.suggestedPrice, '2.99');
});

test('5. Canonical meaningful value wins', () => {
  const listing = {
    suggestedPrice: 'old',
    marketplace: {
      settings: { suggestedPrice: 'new' }
    }
  };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.settings.suggestedPrice, 'new');
});

test('6. Legacy meaningful value survives canonical null', () => {
  const listing = {
    suggestedPrice: 'old',
    marketplace: {
      settings: { suggestedPrice: null }
    }
  };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.settings.suggestedPrice, 'old');
});

test('7. Boolean false survives reconciliation', () => {
  const listing = {
    isFreeResource: true,
    marketplace: {
      settings: { isFreeResource: false }
    }
  };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.settings.isFreeResource, false);
});

test('8. Exact value types preserved', () => {
  const listing = {
    formContract: { id: 123 }
  };
  const result = getMarketplace({ tptListing: listing });
  assert.deepStrictEqual(result.upload.formContract, { id: 123 });
});

test('9. Dual-write behavior', () => {
  const listing = { title: 'hello' };
  const next = applyMarketplaceToListing(listing, { settings: { taxCode: 'tx_123' } });
  assert.strictEqual(next.marketplace.settings.taxCode, 'tx_123');
  assert.strictEqual(next.taxCode, 'tx_123');
  assert.strictEqual(next.title, 'hello');
});

test('10. Legacy fields remain present', () => {
  const listing = applyMarketplaceToListing({}, { upload: { stage: 'done' } });
  assert.strictEqual(listing.uploadStage, 'done');
  assert.ok('uploadStage' in listing);
});

test('11. Unrelated tptListing fields remain untouched', () => {
  const listing = { unrelated: 'yes' };
  const next = applyMarketplaceToListing(listing, { settings: { isFreeResource: true } });
  assert.strictEqual(next.unrelated, 'yes');
});

test('12. Mockups remain untouched', () => {
  const listing = { mockups: { paths: ['a.png'] } };
  const next = applyMarketplaceToListing(listing, { settings: { isFreeResource: true } });
  assert.deepStrictEqual(next.mockups, { paths: ['a.png'] });
});

test('13. Video remains untouched', () => {
  const listing = { video: { path: 'a.mp4' } };
  const next = applyMarketplaceToListing(listing, { settings: { isFreeResource: true } });
  assert.deepStrictEqual(next.video, { path: 'a.mp4' });
});

test('14. SEO remains untouched', () => {
  const listing = { seo: { title: 'a' } };
  const next = applyMarketplaceToListing(listing, { settings: { isFreeResource: true } });
  assert.deepStrictEqual(next.seo, { title: 'a' });
});

test('15. tptListing.status remains untouched', () => {
  const listing = { status: 'uploading_listing' };
  const next = applyMarketplaceToListing(listing, { settings: { isFreeResource: true } });
  assert.strictEqual(next.status, 'uploading_listing');
  assert.strictEqual(next.marketplace.status, undefined);
});

test('16. Existing Marketplace upload fields remain compatible', () => {
  const listing = { uploadError: 'error' };
  const result = getMarketplace({ tptListing: listing });
  assert.strictEqual(result.upload.error, 'error');
  const next = mirrorMarketplaceOnListing(listing);
  assert.strictEqual(next.uploadError, 'error');
  assert.strictEqual(next.marketplace.upload.error, 'error');
});

test('17. Existing projects without marketplace continue working', () => {
  const listing = { suggestedPrice: '10' };
  const next = applyMarketplaceToListing(listing, { settings: { isFreeResource: false } });
  assert.strictEqual(next.suggestedPrice, '10');
  assert.strictEqual(next.isFreeResource, false);
});
