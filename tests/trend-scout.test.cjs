'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCES, ALLOWED_HOSTS, isAllowedTrendUrl, isBlacklistedNiche, isEducationalProductCandidate,
  isAllowedTrendCandidate, rankCandidates, scoreCandidate, scrapeSource, toAnalysisInput,
  pickTrendListing, rememberTrendPick, recentTrendPickUrls, canonicalizeProductUrl
} = require('../src/trend-scout.cjs');
const { STAGE, STAGE_LAG_MS, isMarketplacePageUrl, observeStageProgress } = require('../src/stage-watchdog.cjs');

// The agent reads public market pages. The allowlist is the boundary, and it has
// to hold against a followed link as well as a configured one — a scraper walks
// wherever the hrefs on the page take it.

test('only the four market-intelligence sources are reachable', () => {
  assert.deepEqual(Object.keys(SOURCES).sort(), ['etsy', 'kdp', 'tpt', 'trending']);
  for (const url of [
    'https://trending.ytuong.me/',
    'https://www.teacherspayteachers.com/browse?search=phonics',
    'https://www.teacherspayteachers.com/Browse/Search:phonics',
    'https://www.amazon.com/s?k=activity+book',
    'https://www.etsy.com/search?q=printable'
  ]) {
    assert.equal(isAllowedTrendUrl(url), true, url);
  }
});

test('anything off the allowlist is refused', () => {
  for (const url of [
    'https://example.com/',
    'https://google.com/search?q=x',
    'https://gemini.google.com/app',
    'https://teacherspayteachers.com.evil.test/Product/1',
    'http://www.etsy.com/search?q=x',            // plain http
    'file:///etc/passwd',
    'javascript:alert(1)'
  ]) {
    assert.equal(isAllowedTrendUrl(url), false, url);
  }
});

test('account and transaction surfaces are refused even on an allowed host', () => {
  // A search page and a seller dashboard share a domain. The allowlist gets the
  // agent to the right site; this keeps it on the public half of it.
  for (const url of [
    'https://www.amazon.com/gp/cart/view.html',
    'https://www.amazon.com/your-account',
    'https://kdp.amazon.com/en_US/reports',
    'https://www.etsy.com/your/account',
    'https://www.teacherspayteachers.com/Login',
    'https://www.etsy.com/cart',
    'https://www.amazon.com/ap/signin'
  ]) {
    assert.equal(isAllowedTrendUrl(url), false, url);
  }
});

test('blacklisted niches cannot pass even when they look educational', () => {
  for (const title of [
    'Christmas Math Worksheets for Kindergarten',
    'Easter Phonics Printable Workbook',
    'Halloween Sight Words Task Cards',
    'Bible Verse Handwriting Practice Pages',
    'LGBTQ Pride Classroom Posters',
    'Gender Identity Lesson Plan'
  ]) {
    assert.equal(isBlacklistedNiche(title), true, title);
    assert.equal(isAllowedTrendCandidate({ title }), false, title);
    assert.equal(scoreCandidate({ title, url: 'https://www.etsy.com/listing/1/x', price: '$6.00', reviews: '900' }), -1, title);
  }
});

test('educational product candidates are explicitly allowed and generic products are not', () => {
  for (const title of [
    'Phonics Centers for Kindergarten',
    'Sight Words Practice Pages Bundle',
    'Fractions Workbook for Third Grade',
    'Alphabet Tracing Printable Worksheets'
  ]) {
    assert.equal(isEducationalProductCandidate({ title }), true, title);
    assert.equal(isAllowedTrendCandidate({ title }), true, title);
  }

  for (const title of [
    'Boho Wall Art Printable',
    'Teacher Coffee Mug',
    'Digital Planner Stickers',
    'Birthday Party Invitation Template'
  ]) {
    assert.equal(isEducationalProductCandidate({ title }), false, title);
    assert.equal(isAllowedTrendCandidate({ title }), false, title);
  }
});

test('no source URL builder can produce a forbidden page', () => {
  // A query is user input; it must not be able to steer the agent off the public
  // surface by injecting a path.
  const nasty = '../../your-account?x=/signin';
  const expected = {
    trending: '/',
    tpt: '/browse',
    kdp: '/s',
    etsy: '/search'
  };
  for (const [id, source] of Object.entries(SOURCES)) {
    const url = source.url(nasty);
    // Encoding is what makes this safe: the query becomes one opaque segment, so
    // the slashes and the "?" in it are data rather than structure.
    assert.equal(isAllowedTrendUrl(url), true, `${id} built an unusable URL: ${url}`);
    const parsed = new URL(url);
    assert.ok(parsed.pathname.startsWith(expected[id]), `${id} landed on ${parsed.pathname}, not a search page`);
    assert.ok(!parsed.pathname.includes('/your-account'), `${id} let the injection become a real path`);
  }
});

test('candidates are ranked so a product beats a nav link', () => {
  const ranked = rankCandidates([
    { url: 'https://www.etsy.com/listing/1/alphabet-tracing-worksheets-for-pre-k', title: 'Alphabet Tracing Worksheets for Pre-K', price: '$4.50', rating: '4.8', reviews: '1,204' },
    { url: 'https://www.etsy.com/search?q=home', title: 'Home' },
    { url: 'https://www.etsy.com/listing/2/short', title: 'Short' },
    { url: 'https://www.etsy.com/listing/3/counting-to-twenty-activity-pack', title: 'Counting to Twenty Activity Pack' }
  ]);
  assert.equal(ranked[0].title, 'Alphabet Tracing Worksheets for Pre-K');
  assert.ok(!ranked.some((c) => c.title === 'Home'), 'navigation is not a product');
  assert.ok(!ranked.some((c) => c.title === 'Short'), 'a two-word link is not a product');
});

test('ranking drops anything that is not an allowed URL', () => {
  const ranked = rankCandidates([
    { url: 'https://evil.test/listing/1', title: 'Phonics Centers for Kindergarten', price: '$9.99' },
    { url: 'https://www.etsy.com/listing/9/phonics-centers-kindergarten', title: 'Phonics Centers for Kindergarten', price: '$9.99' }
  ]);
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].url, /etsy\.com/);
});

test('ranking drops forbidden and noneducational candidates before they can score', () => {
  const ranked = rankCandidates([
    { url: 'https://www.etsy.com/listing/1/christmas-math', title: 'Christmas Math Worksheets for Kindergarten', price: '$9.99', reviews: '4,000' },
    { url: 'https://www.etsy.com/listing/2/teacher-mug', title: 'Teacher Coffee Mug', price: '$15.00', reviews: '2,000' },
    { url: 'https://www.etsy.com/listing/3/sight-words', title: 'Sight Words Practice Pages', price: '$4.00', reviews: '250' }
  ]);
  assert.deepEqual(ranked.map((candidate) => candidate.title), ['Sight Words Practice Pages']);
});

test('a maze query prefers a maze book over a letter packet that only mentions maze', () => {
  const ranked = rankCandidates([
    {
      url: 'https://www.teacherspayteachers.com/Product/Alphabet-Letter-Books-Tracing-Worksheets-Sounds-Recognition-ABC-Activities-Maze-5992537',
      title: 'Alphabet Letter Books Tracing Worksheets Sounds Recognition ABC Activities Maze',
      price: '$8.00',
      rating: '4.9',
      reviews: '4,200'
    },
    {
      url: 'https://www.teacherspayteachers.com/Product/Maze-Puzzle-Book-for-Kindergarten-9990011',
      title: 'Maze Puzzle Book for Kindergarten',
      price: '$4.50',
      rating: '4.8',
      reviews: '180'
    },
    {
      url: 'https://www.teacherspayteachers.com/Product/Four-Seasons-Mazes-1110002',
      title: 'Four Seasons Mazes - 3rd 4th 5th Grade Fun Packet',
      price: '$5.00',
      rating: '4.8',
      reviews: '90'
    }
  ], { query: 'maze' });
  assert.equal(ranked[0].title, 'Maze Puzzle Book for Kindergarten');
  assert.ok(ranked.some((item) => item.title.startsWith('Four Seasons Mazes')));
  assert.ok(ranked[0].score > (ranked.find((item) => /Alphabet Letter Books/.test(item.title))?.score || 0));
});

test('a maze query keeps a maze bestseller and drops an unrelated long title', () => {
  const ranked = rankCandidates([
    {
      url: 'https://www.teacherspayteachers.com/Product/BANNED-BOOKS-WEEK-Activities-Literary-Censorship-Worksheets-Reading-Project-PACK-12253188',
      title: 'BANNED BOOKS WEEK Activities Literary Censorship Worksheets Reading Project PACK',
      price: '$8.00',
      rating: '4.9',
      reviews: '4,200'
    },
    {
      url: 'https://www.teacherspayteachers.com/Product/Maze-Puzzle-Book-for-Kindergarten-9990011',
      title: 'Maze Puzzle Book for Kindergarten',
      price: '$4.50',
      rating: '4.8',
      reviews: '180'
    }
  ], { query: 'maze puzzle book' });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, 'Maze Puzzle Book for Kindergarten');
});

test('the same listing is not offered twice', () => {
  const ranked = rankCandidates([
    { url: 'https://www.etsy.com/listing/1/kindergarten-math-centers?ref=a', title: 'Kindergarten Math Centers Bundle' },
    { url: 'https://www.etsy.com/listing/1/kindergarten-math-centers?ref=b', title: 'Kindergarten Math Centers Bundle' }
  ]);
  assert.equal(ranked.length, 1, 'query strings must not make one listing look like two');
});

test('a candidate becomes the input the analysis stage already takes', () => {
  const input = toAnalysisInput(
    { url: 'https://www.teacherspayteachers.com/Product/123/races-writing', title: 'RACES Writing Strategy Posters', price: '$5.00', rating: '4.9', reviews: '312' },
    { source: 'tpt', query: 'races writing' }
  );
  assert.equal(input.sourceMode, 'url');
  assert.equal(input.productUrl, 'https://www.teacherspayteachers.com/Product/123/races-writing');
  assert.equal(input.concept, 'RACES Writing Strategy Posters');
  // Carried through so the gem sees what the market said, and so a run can be
  // traced back to where it came from.
  assert.equal(input.trendMetadata.source, 'tpt');
  assert.equal(input.trendMetadata.price, '$5.00');
  assert.ok(input.trendMetadata.capturedAt);
});

test('a candidate off the allowlist cannot be turned into an analysis input', () => {
  assert.throws(
    () => toAnalysisInput({ url: 'https://evil.test/x', title: 'Something Long Enough' }, { source: 'tpt' }),
    (error) => error.retryable === false
  );
});

// The scrape itself, against a fake page — no network, but the real navigation
// guard and the real ranking.

test('scraping refuses an unknown source and never opens a page', async () => {
  let opened = 0;
  await assert.rejects(
    () => scrapeSource({ source: 'facebook', query: 'x', openPage: async () => { opened += 1; } }),
    (error) => error.retryable === false
  );
  assert.equal(opened, 0, 'the guard runs before anything is opened');
});

test('scraping opens the source page and returns ranked candidates', async () => {
  const visited = [];
  const fakePage = {
    goto: async (url) => { visited.push(url); },
    waitForTimeout: async () => {},
    evaluate: async () => ([
      { url: 'https://www.teacherspayteachers.com/Product/1/alphabet-tracing-practice-pack', title: 'Alphabet Tracing Practice Pack', price: '$4.00', rating: '4.7', reviews: '512' },
      { url: 'https://www.teacherspayteachers.com/Login', title: 'Sign in to your account' }
    ]),
    close: async () => {}
  };
  const result = await scrapeSource({ source: 'tpt', query: 'alphabet', openPage: async () => fakePage });
  assert.equal(result.source, 'tpt');
  assert.match(visited[0], /teacherspayteachers\.com\/browse\?search=alphabet/);
  assert.equal(result.candidates.length, 1, 'the login link is filtered by the same guard');
  assert.match(result.candidates[0].url, /\/Product\/1\//);
});

test('TPT scrape falls back to product links in the HTML when the DOM is empty', async () => {
  const visited = [];
  const fakePage = {
    goto: async (url) => { visited.push(url); },
    waitForTimeout: async () => {},
    evaluate: async () => [],
    content: async () => `
      <a href="/Product/Phonics-Worksheets-for-Kindergarten-8413716">View</a>
      <a href="/Product/Phonics-Centers-Bundle-2222222">Open</a>
      <a href="/Product/Banned-Books-Week-Pack-3333333">Skip</a>
    `,
    close: async () => {}
  };
  const result = await scrapeSource({ source: 'tpt', query: 'phonics', openPage: async () => fakePage });
  assert.match(visited[0], /browse\?search=phonics/);
  assert.match(visited[0], /sort=Best%20Sellers/);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((item) => /Phonics/i.test(item.title)));
  assert.ok(!result.candidates.some((item) => /Banned/i.test(item.title)));
});

test('an empty TPT query opens the trending browse page', async () => {
  const visited = [];
  const fakePage = {
    goto: async (url) => { visited.push(url); },
    waitForTimeout: async () => {},
    evaluate: async () => [
      { url: 'https://www.teacherspayteachers.com/Product/1/kindergarten-math-centers', title: 'Kindergarten Math Centers', price: '$4.00' }
    ],
    close: async () => {}
  };
  await scrapeSource({ source: 'tpt', query: '', openPage: async () => fakePage });
  assert.match(visited[0], /browse\?search=trending/);
});

test('an aborted scrape stops before reading the page', async () => {
  const controller = new AbortController();
  const fakePage = {
    goto: async () => { controller.abort(new Error('stopped')); },
    waitForTimeout: async () => {},
    evaluate: async () => { throw new Error('should not read the page after an abort'); },
    close: async () => {}
  };
  await assert.rejects(
    () => scrapeSource({ source: 'etsy', query: 'x', openPage: async () => fakePage, signal: controller.signal }),
    /stopped/
  );
});

test('a hung marketplace DOM read opens a fresh page once', async () => {
  let opened = 0;
  const result = await scrapeSource({
    source: 'tpt',
    query: 'maze',
    timeoutMs: 80,
    openPage: async () => {
      opened += 1;
      if (opened === 1) {
        return {
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async () => new Promise(() => {}),
          close: async () => {}
        };
      }
      return {
        goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => ([
          { url: 'https://www.teacherspayteachers.com/Product/1/alphabet-maze-book', title: 'Alphabet Maze Book', price: '$4.00' }
        ]),
        close: async () => {}
      };
    }
  });
  assert.equal(opened, 2);
  assert.equal(result.candidates.length, 1);
});

test('a Cloudflare challenge title recycles the market tab once', async () => {
  let opened = 0;
  const result = await scrapeSource({
    source: 'tpt',
    query: 'maze',
    timeoutMs: 80,
    openPage: async () => {
      opened += 1;
      if (opened === 1) {
        return {
          goto: async () => {},
          title: async () => 'Just a moment...',
          waitForTimeout: async () => {},
          evaluate: async () => [],
          close: async () => {}
        };
      }
      return {
        goto: async () => {},
        title: async () => 'Teachers Pay Teachers',
        waitForTimeout: async () => {},
        evaluate: async () => ([
          { url: 'https://www.teacherspayteachers.com/Product/1/alphabet-maze-book', title: 'Alphabet Maze Book', price: '$4.00' }
        ]),
        close: async () => {}
      };
    }
  });
  assert.equal(opened, 2);
  assert.equal(result.candidates.length, 1);
});

test('a stalled marketplace navigation opens a fresh page once', async () => {
  let opened = 0;
  const result = await scrapeSource({
    source: 'tpt',
    query: 'maze',
    timeoutMs: 80,
    openPage: async () => {
      opened += 1;
      if (opened === 1) {
        return {
          goto: async () => new Promise(() => {}),
          waitForTimeout: async () => {},
          evaluate: async () => [],
          close: async () => {}
        };
      }
      return {
        goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => ([
          { url: 'https://www.teacherspayteachers.com/Product/1/alphabet-maze-book', title: 'Alphabet Maze Book', price: '$4.00' }
        ]),
        close: async () => {}
      };
    }
  });
  assert.equal(opened, 2);
  assert.equal(result.candidates.length, 1);
});

test('the page is always closed, even when the scrape fails', async () => {
  let closed = 0;
  const fakePage = {
    goto: async () => { throw new Error('navigation failed'); },
    waitForTimeout: async () => {},
    evaluate: async () => [],
    close: async () => { closed += 1; }
  };
  await assert.rejects(() => scrapeSource({ source: 'kdp', query: 'x', openPage: async () => fakePage }));
  assert.equal(closed, 1, 'a failed scrape must not leak a tab');
});

test('the allowlist is small and stated in one place', () => {
  assert.ok(ALLOWED_HOSTS.length <= 10, 'widening reach should be a visible decision');
  assert.ok(ALLOWED_HOSTS.includes('trending.ytuong.me'));
  assert.ok(!ALLOWED_HOSTS.some((host) => /kdp\.amazon|sellercentral/i.test(host)), 'no seller dashboards');
});

// --- Two phases: discovery answers "what is rising", validation answers
// --- "does it sell" on the selected marketplace. Merging them into one ranked
// --- list threw that away.

const {
  DISCOVERY_SOURCE, MARKETPLACES, titleToKeyword, extractKeywords,
  summariseMarket, scoreOpportunity, discoverKeywords, validateKeyword, chooseOpportunity
} = require('../src/trend-scout.cjs');

test('discovery and validation are different jobs, done by different sources', () => {
  assert.equal(DISCOVERY_SOURCE, 'trending');
  assert.deepEqual([...MARKETPLACES].sort(), ['etsy', 'kdp', 'tpt']);
  assert.ok(!MARKETPLACES.includes(DISCOVERY_SOURCE), 'a trend feed is not a marketplace');
});

test('a sales title becomes something a person would actually search for', () => {
  // A title is a pitch; a keyword is what someone types.
  assert.equal(titleToKeyword('Editable Alphabet Tracing Practice Pack | Instant Download Printable'), 'alphabet tracing practice');
  assert.equal(titleToKeyword('THE BEST Free Printable Sight Words Bundle for Your Classroom'), 'sight words classroom');
  assert.equal(titleToKeyword('Shop'), '');
});

test('the same topic trending twice is one keyword, and counts for more', () => {
  const keywords = extractKeywords([
    { title: 'Sight Words Practice Pages for Kindergarten', score: 10 },
    { title: 'Sight Words Practice Pages Bundle', score: 12 },
    { title: 'Counting to Twenty Math Centers', score: 9 },
    { title: 'Halloween Math Worksheets', score: 99 },
    { title: 'Teacher Coffee Mug', score: 95 }
  ]);
  assert.equal(keywords.length, 2, 'two listings about one topic are one keyword');
  assert.equal(keywords[0].keyword, 'sight words practice pages');
  assert.equal(keywords[0].seenIn, 2);
  assert.ok(keywords[0].score > 12, 'appearing twice in a trend feed is itself a signal');
});

test('a market summary is the evidence a person would gather by hand', () => {
  const summary = summariseMarket('tpt', [
    { price: '$4.50', reviews: '312' },
    { price: '$6.00', reviews: '1,204' },
    { price: '$3.00', reviews: null }
  ]);
  assert.equal(summary.listings, 3);
  assert.equal(summary.medianPrice, 4.5);
  assert.equal(summary.priceLow, 3);
  assert.equal(summary.priceHigh, 6);
  assert.equal(summary.topReviews, 1204);
  assert.equal(summary.provenDemand, 1516);
});

// Scoring is the part that decides what gets built, so it is worth being
// explicit about what it prefers.

test('a proven but unwinnable market scores below a proven, open one', () => {
  const open = scoreOpportunity({
    demandScore: 10,
    markets: [summariseMarket('tpt', [{ price: '$5', reviews: '300' }, { price: '$4', reviews: '180' }])]
  });
  const lockedUp = scoreOpportunity({
    demandScore: 10,
    markets: [summariseMarket('tpt', [{ price: '$5', reviews: '48000' }, { price: '$4', reviews: '19000' }])]
  });
  assert.ok(open > lockedUp, 'a category owned by a 48k-review leader is a wall, not an opening');
});

test('demand confirmed in more than one marketplace beats demand in one', () => {
  const listings = [{ price: '$5', reviews: '400' }, { price: '$4', reviews: '250' }];
  const one = scoreOpportunity({ markets: [summariseMarket('tpt', listings)] });
  const three = scoreOpportunity({
    markets: [summariseMarket('tpt', listings), summariseMarket('etsy', listings), summariseMarket('kdp', listings)]
  });
  assert.ok(three > one);
});

test('a market with no sales at all scores nothing', () => {
  assert.equal(scoreOpportunity({ markets: [] }), 0);
  assert.equal(scoreOpportunity({ markets: [summariseMarket('tpt', [])] }), 0);
});

test('a market selling at pennies is penalised', () => {
  const listings = (price) => [{ price, reviews: '400' }, { price, reviews: '300' }];
  assert.ok(
    scoreOpportunity({ markets: [summariseMarket('etsy', listings('$5.00'))] })
    > scoreOpportunity({ markets: [summariseMarket('etsy', listings('$0.99'))] }),
    'a market pricing at pennies is not worth the production cost'
  );
});

// Degradation: losing the trend feed is survivable only when the user supplied
// an in-scope educational seed.

test('a broken trend feed falls back to the keyword the person typed', async () => {
  const discovery = await discoverKeywords({
    openPage: async () => { throw new Error('feed is down'); },
    seed: 'sight words'
  });
  assert.equal(discovery.degraded, true, 'and it says so, rather than pretending');
  assert.equal(discovery.keywords[0].keyword, 'sight words');
  assert.equal(discovery.source, 'seed');
});

test('a broken trend feed with no keyword is a real failure', async () => {
  await assert.rejects(
    () => discoverKeywords({ openPage: async () => { throw new Error('feed is down'); }, seed: '' }),
    (error) => error.code === 'TREND_DISCOVERY_EMPTY' || /feed is down/.test(error.message)
  );
});

test('a broken trend feed cannot fall back to a forbidden or noneducational keyword', async () => {
  for (const seed of ['Halloween math worksheets', 'Teacher coffee mug']) {
    await assert.rejects(
      () => discoverKeywords({ openPage: async () => { throw new Error('feed is down'); }, seed }),
      (error) => error.code === 'TREND_SCOPE_REJECTED'
    );
  }
});

test('a marketplace failing is recorded without hiding successful validations', async () => {
  let call = 0;
  const openPage = async () => {
    call += 1;
    if (call === 2) throw new Error('etsy changed its markup');
    return {
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => ([
        { url: 'https://www.teacherspayteachers.com/Product/1/sight-words-practice-pages', title: 'Sight Words Practice Pages Bundle', price: '$4.50', reviews: '312' }
      ]),
      close: async () => {}
    };
  };
  const result = await validateKeyword({ keyword: 'sight words', marketplaces: ['tpt', 'etsy', 'kdp'], openPage });
  assert.equal(result.problems.length, 1, 'the failure is recorded');
  assert.equal(result.problems[0].source, 'etsy');
  assert.ok(result.markets.length >= 2, 'two out of three still tells you whether it sells');
});

test('the choice carries the reason for it', () => {
  const strong = {
    keyword: 'sight words practice',
    demandScore: 14,
    problems: [],
    markets: [
      summariseMarket('tpt', [{ price: '$4.50', reviews: '312' }, { price: '$5.00', reviews: '260' }]),
      summariseMarket('etsy', [{ price: '$4.00', reviews: '180' }])
    ],
    listings: [
      { url: 'https://www.teacherspayteachers.com/Product/1/sight-words-practice-pages', title: 'Sight Words Practice Pages Bundle', score: 30, source: 'tpt' },
      { url: 'https://www.etsy.com/listing/2/sight-words-cards-for-kindergarten', title: 'Sight Words Cards for Kindergarten', score: 18, source: 'etsy' }
    ]
  };
  const weak = {
    keyword: 'nothing sells here',
    demandScore: 1,
    problems: [],
    markets: [summariseMarket('kdp', [])],
    listings: []
  };
  const choice = chooseOpportunity([weak, strong]);
  assert.equal(choice.keyword, 'sight words practice');
  // A pipeline that can say why it chose is one whose decisions can be argued
  // with; one that just returns a URL is not.
  assert.deepEqual(choice.evidence.marketplaces, ['tpt', 'etsy']);
  assert.equal(choice.evidence.listings, 3);
  // A median of the marketplace medians (TPT 4.75, Etsy 4.00), not of every
  // listing pooled — so a marketplace that returned thirty results does not
  // outvote one that returned three.
  assert.equal(choice.evidence.medianPrice, 4.38);
  assert.equal(choice.evidence.topReviews, 312);
  assert.equal(choice.candidate.title, 'Sight Words Practice Pages Bundle', 'the best listing for the winning keyword');
  assert.ok(choice.candidate.score > 0);
  assert.ok(Array.isArray(choice.runnersUp));
});

test('nothing selling anywhere yields no choice rather than a bad one', () => {
  assert.equal(chooseOpportunity([]), null);
  assert.equal(chooseOpportunity([{ keyword: 'x', markets: [], listings: [] }]), null);
});

test('the stage watchdog recycles a market page with no progress after 20s', () => {
  assert.equal(isMarketplacePageUrl('https://www.teacherspayteachers.com/browse?search=maze'), true);
  assert.equal(isMarketplacePageUrl('https://gemini.google.com/app'), false);
  const startedAt = 1_000_000;
  const first = observeStageProgress(null, {
    stage: STAGE.TREND_SCAN,
    url: 'https://www.teacherspayteachers.com/browse?search=maze',
    candidateCount: 0,
    startedAt,
    now: startedAt
  });
  assert.equal(first.action, 'wait');
  const stalled = observeStageProgress(first, {
    stage: STAGE.TREND_SCAN,
    url: first.url,
    candidateCount: 0,
    startedAt,
    now: startedAt + STAGE_LAG_MS
  });
  assert.equal(stalled.action, 'recycle');
  assert.match(stalled.reason, /lag-trend-scan/);
});

test('the stage watchdog does not recycle Gemini once analysis JSON is ready', () => {
  const startedAt = 1_000_000;
  const first = observeStageProgress(null, {
    stage: STAGE.GEMINI_ANALYSIS,
    url: 'https://gemini.google.com/app',
    draftLength: 240,
    analysisReady: true,
    hasTitleJson: true,
    startedAt,
    now: startedAt
  });
  assert.equal(first.action, 'wait');
  const later = observeStageProgress(first, {
    stage: STAGE.GEMINI_ANALYSIS,
    url: first.url,
    draftLength: 0,
    analysisReady: true,
    hasTitleJson: true,
    startedAt,
    now: startedAt + STAGE_LAG_MS + 5_000
  });
  assert.equal(later.action, 'wait');
  assert.equal(later.reason, 'analysis-ready');
});

test('pickTrendListing skips the last N product URLs so the agent does not repeat a book', () => {
  const kindergarten = {
    url: 'https://www.teacherspayteachers.com/Product/Maze-Puzzle-Book-for-Kindergarten-9990011',
    title: 'Maze Puzzle Book for Kindergarten',
    price: '$4.50',
    rating: '4.8',
    reviews: '180',
    browseRank: 1
  };
  const seasons = {
    url: 'https://www.teacherspayteachers.com/Product/Four-Seasons-Mazes-1110002',
    title: 'Four Seasons Mazes - 3rd 4th 5th Grade Fun Packet',
    price: '$5.00',
    rating: '4.8',
    reviews: '90',
    browseRank: 2
  };
  const first = pickTrendListing([kindergarten, seasons], { query: 'maze' });
  assert.ok(first?.url);
  const next = pickTrendListing([kindergarten, seasons], {
    query: 'maze',
    excludeUrls: [first.url]
  });
  assert.ok(next?.url);
  assert.notEqual(canonicalizeProductUrl(next.url), canonicalizeProductUrl(first.url));
});

test('rememberTrendPick stores unique recent URLs for the next scan', () => {
  const memory = {
    value: [],
    getSetting(key, fallback) { return key === 'recentTrendPicks' ? this.value : fallback; },
    setSetting(key, value) { if (key === 'recentTrendPicks') this.value = value; }
  };
  rememberTrendPick(memory, {
    url: 'https://www.teacherspayteachers.com/Product/A-Maze-Book-1?ref=x',
    title: 'A Maze Book for Kindergarten'
  });
  rememberTrendPick(memory, {
    url: 'https://www.teacherspayteachers.com/Product/B-Maze-Book-2',
    title: 'B Maze Book for First Grade'
  });
  rememberTrendPick(memory, {
    url: 'https://www.teacherspayteachers.com/Product/A-Maze-Book-1?ref=y',
    title: 'A Maze Book for Kindergarten'
  });
  const urls = recentTrendPickUrls(memory);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], canonicalizeProductUrl('https://www.teacherspayteachers.com/Product/A-Maze-Book-1'));
});
