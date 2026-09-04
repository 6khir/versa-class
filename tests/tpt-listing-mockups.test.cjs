const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  downloadListingMockups,
  extractListingMockupUrls,
  extractPageCountFromTptHtml,
  isCloudflareChallengeHtml,
  isTptProductUrl,
  parseTptProductUrl,
  persistCompetitorMockups,
  preferOriginalMockupUrl,
  uniqueListingMockupUrls
} = require('../src/tpt-listing-mockups.cjs');

const FIXTURE_PATH = join(__dirname, 'fixtures', 'tpt-product-gallery.html');
const PRODUCT_URL = 'https://www.teacherspayteachers.com/Product/Alphabet-Tracing-Workbook-8413716';

function fakeJpeg(size = 2048) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 1)]);
}

test('parses TPT product URLs and rejects other hosts', () => {
  assert.equal(isTptProductUrl(PRODUCT_URL), true);
  assert.equal(parseTptProductUrl(PRODUCT_URL)?.productId, '8413716');
  assert.equal(isTptProductUrl('https://www.amazon.com/dp/B000'), false);
  assert.equal(isTptProductUrl('not a url'), false);
});

test('upgrades listing thumb sizes to original files', () => {
  const large = 'https://ecdn.teacherspayteachers.com/thumbitem/Alphabet-Tracing-Workbook-8413716-1726769007/large-8413716-2.jpg';
  assert.match(preferOriginalMockupUrl(large), /\/original-8413716-2\.jpg$/);
});

test('extracts listing mockups only from fixture HTML', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf8');
  const urls = extractListingMockupUrls(html, { pageUrl: PRODUCT_URL, productId: '8413716' });
  assert.deepEqual(urls, [
    'https://ecdn.teacherspayteachers.com/thumbitem/Alphabet-Tracing-Workbook-8413716-1726769007/original-8413716-1.jpg',
    'https://ecdn.teacherspayteachers.com/thumbitem/Alphabet-Tracing-Workbook-8413716-1726769007/original-8413716-2.jpg',
    'https://ecdn.teacherspayteachers.com/thumbitem/Alphabet-Tracing-Workbook-8413716-1726769007/original-8413716-3.jpg'
  ]);
  assert.equal(urls.some((url) => url.includes('9990001')), false);
  assert.equal(urls.some((url) => url.includes('/avatars/')), false);
  assert.equal(urls.some((url) => url.includes('/reviews/')), false);
  assert.equal(urls.some((url) => url.includes('tpt-logo')), false);
});

test('returns no mockups for empty or challenge HTML', () => {
  assert.deepEqual(extractListingMockupUrls('', { pageUrl: PRODUCT_URL }), []);
  assert.equal(isCloudflareChallengeHtml('<title>Just a moment...</title>'), true);
  assert.equal(isCloudflareChallengeHtml('<title>Alphabet Tracing Workbook</title>'), false);
});

test('does not treat loaded listings as Cloudflare blocks and skips onerror fallbacks', () => {
  const html = [
    '<title>Alphabet Tracing Workbook</title>',
    '<script src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    '<meta property="og:image" content="https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/original-8413716-1.jpg">',
    '<img src="https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/original-8413716-1.jpg">',
    '<img src="https://www.teacherspayteachers.com/Product/onerror=redirect/thumbitem/x-8413716-1/750f-8413716-1.jpg">'
  ].join('\n');
  assert.equal(isCloudflareChallengeHtml(html), false);
  assert.deepEqual(extractListingMockupUrls(html, { pageUrl: PRODUCT_URL, productId: '8413716' }), [
    'https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/original-8413716-1.jpg'
  ]);
});

test('dedupes large and original variants of the same mockup', () => {
  const urls = uniqueListingMockupUrls([
    'https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/large-8413716-1.jpg',
    'https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/original-8413716-1.jpg'
  ], { productId: '8413716' });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /original-8413716-1\.jpg$/);
});

test('downloads mockup bytes and skips invalid payloads', async () => {
  const destDir = mkdtempSync(join(tmpdir(), 'versa-mockups-'));
  const jpeg = fakeJpeg();
  const result = await downloadListingMockups({
    destDir,
    productUrl: PRODUCT_URL,
    urls: [
      'https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/original-8413716-1.jpg',
      'https://ecdn.teacherspayteachers.com/thumbitem/x-8413716-1/original-8413716-2.jpg',
      'https://ecdn.teacherspayteachers.com/avatars/skip-me.png'
    ],
    fetchBuffer: async (url) => {
      if (url.includes('8413716-2')) return { buffer: Buffer.from('not-an-image'), contentType: 'text/html' };
      return { buffer: jpeg, contentType: 'image/jpeg' };
    }
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].fileName, 'mockup-01.jpg');
  assert.equal(readFileSync(result.images[0].path).length, jpeg.length);
  rmSync(destDir, { recursive: true, force: true });
});

test('prompt generation asks the model to look at attached mockups without cloning', () => {
  const { buildAnalysisPrompt, buildPromptsGenerationRequest } = require('../src/prompt-builder.cjs');
  const analysis = buildAnalysisPrompt({
    sourceMode: 'url',
    productUrl: PRODUCT_URL,
    mockupCount: 3
  });
  assert.match(analysis, /attached listing mockup/i);
  assert.match(analysis, /ORIGINAL educational content/);
  const fleetShape = buildAnalysisPrompt({
    url: PRODUCT_URL,
    format: 'LETTER',
    mockupCount: 4
  });
  assert.match(fleetShape, /Look at the 4 attached listing mockup/i);
  const prompts = buildPromptsGenerationRequest(12, 'LETTER', 'portrait', { hasCompetitorMockups: true });
  assert.match(prompts, /attached competitor listing mockups/i);
  assert.match(prompts, /not a clone/i);
  const without = buildPromptsGenerationRequest(12, 'LETTER', 'portrait');
  assert.equal(/attached competitor listing mockups/i.test(without), false);
});

test('persists mockups into a project output folder', () => {
  const stagingDir = mkdtempSync(join(tmpdir(), 'versa-mockups-stage-'));
  const outputDir = mkdtempSync(join(tmpdir(), 'versa-mockups-out-'));
  const sourcePath = join(stagingDir, 'mockup-01.jpg');
  require('node:fs').writeFileSync(sourcePath, fakeJpeg());
  const persisted = persistCompetitorMockups({
    status: 'ok',
    images: [{ path: sourcePath, fileName: 'mockup-01.jpg', sourceUrl: 'https://example.invalid/a.jpg', index: 0 }]
  }, outputDir, require('node:fs').copyFileSync);
  assert.match(persisted.images[0].path, /competitor-mockups\/mockup-01\.jpg$/);
  assert.equal(readFileSync(persisted.images[0].path).length > 0, true);
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

test('extracts actual competitor page count from HTML and schema correctly', () => {
  const { parseAnalysisResponse, buildAnalysisPrompt, buildTptListingPrompt } = require('../src/prompt-builder.cjs');

  const htmlWithJsonLd = '<html><head><script type="application/ld+json">{"@type":"Product","name":"1-Page All About Me Worksheet","numberOfPages":1}</script></head><body></body></html>';
  assert.equal(extractPageCountFromTptHtml(htmlWithJsonLd), 1);

  const htmlWithDetails = '<div class="ProductDetails"><span>Total Pages</span><span>15 pages</span></div>';
  assert.equal(extractPageCountFromTptHtml(htmlWithDetails), 15);

  const analysis = buildAnalysisPrompt({
    sourceMode: 'url',
    productUrl: PRODUCT_URL,
    mockupCount: 3,
    scrapedPageCount: 15
  });
  assert.match(analysis, /exactly 15 page/i);
  assert.match(analysis, /"pageCount": 15/);

  const listingPrompt = buildTptListingPrompt({ name: 'Alphabet Pack' });
  assert.match(listingPrompt, /attached finished educational product PDF/i);
  assert.doesNotMatch(listingPrompt, /Google Doc \/ Word document/i);

  const responseJson = JSON.stringify({
    title: 'Kindergarten Math Worksheet',
    description: '1 single page worksheet for numbers practice',
    targetAge: 'Kindergarten',
    keyHighlights: ['Counting', 'Writing numbers'],
    pageCount: 1
  });
  const parsed = parseAnalysisResponse(responseJson);
  assert.equal(parsed.pageCount, 1);
});

test('RATE_LIMIT_PATTERNS detects all Gemini rate limit variations', () => {
  const { RATE_LIMIT_PATTERNS } = require('../src/browser-controller.cjs');
  const samples = [
    "You've reached the current usage cap for Gemini Pro.",
    "You've reached your image generation limit. Please try again later.",
    "You've reached the current usage limit.",
    "Please try again in 3 hours.",
    "Try again in 45 minutes.",
    "Limit resets at 3:00 PM.",
    "You've reached your usage limit."
  ];

  for (const text of samples) {
    const matched = RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
    assert.equal(matched, true, `Pattern should match: "${text}"`);
  }
});
