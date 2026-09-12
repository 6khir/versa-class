'use strict';

/**
 * VERSA AGENT — market-intelligence scraping.
 *
 * Reads what is already public on a handful of trend and marketplace pages, picks
 * candidates, and hands a product URL plus its metadata to the analysis stage.
 * From there the existing pipeline takes over unchanged: analysis writes the
 * concept, and the specs it produces end up in the compiled .docx that mockups,
 * preview and SEO all read.
 *
 * The boundaries are deliberate and enforced, not conventional:
 *
 *   public pages only    every source below is a page anyone can open. The agent
 *                        never signs in, never sends a cookie jar, and never
 *                        touches a seller dashboard or an account page. A URL
 *                        that is not on the allowlist is refused rather than
 *                        fetched, so a bad selector cannot walk the agent
 *                        somewhere it should not be.
 *   read, never write    it opens pages and reads text. It submits no forms,
 *                        clicks no buy button, and posts nothing.
 *   metadata, not works  it collects titles, prices, ranks and links — the facts
 *                        a listing states about itself. It does not copy page
 *                        content into the product being made; that is what the
 *                        analysis gem writes from scratch.
 */

/**
 * Every host the agent may open, and what it is for.
 *
 * Adding a host here is the only way to widen the agent's reach, which keeps the
 * decision visible in review instead of buried in a selector.
 */
const { listingsFromBrowseHtml, tptBrowseSearchUrl } = require('./versa-agent.cjs');
const { STAGE, observeStageProgress } = require('./stage-watchdog.cjs');

const SOURCES = Object.freeze({
  trending: {
    id: 'trending',
    label: 'Trending feed',
    hosts: ['trending.ytuong.me'],
    // A trend feed, so no query is needed — the page is the answer.
    url: () => 'https://trending.ytuong.me/'
  },
  tpt: {
    id: 'tpt',
    label: 'Teachers Pay Teachers',
    hosts: ['teacherspayteachers.com', 'www.teacherspayteachers.com'],
    // Direct browse URL — never type into TPT's search box. Empty queries
    // open the public trending browse page.
    url: (query) => tptBrowseSearchUrl(query)
  },
  kdp: {
    id: 'kdp',
    label: 'Amazon KDP',
    // The public storefront, not the KDP dashboard: bestseller and search pages
    // anyone can read without an account.
    hosts: ['amazon.com', 'www.amazon.com'],
    url: (query) => `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=stripbooks&s=review-rank`
  },
  etsy: {
    id: 'etsy',
    label: 'Etsy',
    hosts: ['etsy.com', 'www.etsy.com'],
    url: (query) => `https://www.etsy.com/search?q=${encodeURIComponent(query)}&order=most_relevant`
  }
});

/** Hosts the agent is allowed to open, flattened for checking. */
const ALLOWED_HOSTS = Object.freeze(
  Object.values(SOURCES).flatMap((source) => source.hosts)
);

/**
 * Anything that smells like an account surface, refused even on an allowed host.
 *
 * A search page and a seller dashboard live on the same domain. The allowlist
 * gets the agent to the right site; this keeps it on the public half of it.
 */
const FORBIDDEN_PATHS = [
  /\/(signin|login|logout|register|auth)\b/i,
  /\/(account|dashboard|my-account|your-account)\b/i,
  /\/(cart|checkout|orders|payment|wallet)\b/i,
  /kdp\.amazon\./i,
  /sellercentral/i,
  /\/messages?\b/i
];

/**
 * Is this a page the agent may open?
 *
 * Called before every navigation, including on links found while scraping — a
 * followed link is exactly how a scraper ends up somewhere it was never meant
 * to go.
 */
function isAllowedTrendUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return false;
  const target = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  return !FORBIDDEN_PATHS.some((pattern) => pattern.test(target));
}

/** Trim, collapse whitespace, and cap — scraped text is never trusted raw. */
function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function searchableText(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return clean(value, 1_500);
  const parts = [];
  for (const key of ['keyword', 'title', 'concept', 'description', 'label', 'url']) {
    if (value[key]) parts.push(value[key]);
  }
  if (Array.isArray(value.tags)) parts.push(value.tags.join(' '));
  return clean(parts.join(' '), 1_500);
}

function normalizedSearchText(value) {
  return ` ${searchableText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

function hasTerm(normalizedText, term) {
  const normalizedTerm = String(term)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizedTerm ? normalizedText.includes(` ${normalizedTerm} `) : false;
}

const BLACKLIST_NICHE_TERMS = Object.freeze([
  // Religious niches and holidays.
  'christmas', 'xmas', 'easter', 'advent', 'nativity', 'lent', 'bible',
  'biblical', 'christian', 'christianity', 'jesus', 'gospel', 'scripture',
  'church', 'prayer', 'religion', 'religious', 'faith', 'god', 'lord',
  'sunday school', 'noahs ark', 'noah s ark', 'noah ark', 'saint', 'saints', 'hanukkah',
  'chanukah', 'passover', 'rosh hashanah', 'yom kippur', 'ramadan', 'eid',
  'islamic', 'muslim', 'jewish', 'judaism', 'hindu', 'hinduism', 'diwali',
  'holi', 'buddhist', 'buddhism',
  // Halloween niches.
  'halloween', 'trick or treat', 'jack o lantern', 'spooky', 'haunted',
  'witch', 'witches', 'ghost', 'ghosts', 'zombie', 'zombies', 'vampire',
  'vampires', 'monster', 'monsters', 'costume', 'costumes', 'frankenstein',
  'mummy', 'mummies',
  // LGBTQ+ niches.
  'lgbt', 'lgbt+', 'lgbtq', 'lgbtq+', 'lgbtqia', 'lgbtqia+', 'queer',
  'lesbian', 'gay', 'bisexual', 'transgender', 'nonbinary', 'non binary',
  'genderfluid', 'intersex', 'two spirit', 'gender identity',
  'sexual orientation', 'same sex', 'pride month', 'pride flag',
  'rainbow pride', 'gender pronouns', 'preferred pronouns'
]);

const EDUCATIONAL_SUBJECT_TERMS = Object.freeze([
  'phonics', 'sight word', 'sight words', 'cvc', 'alphabet', 'letter sound',
  'letter sounds', 'letter recognition', 'tracing', 'handwriting', 'reading',
  'reading comprehension', 'fluency', 'vocabulary', 'grammar', 'spelling',
  'sentence writing', 'writing', 'races writing', 'math', 'addition',
  'subtraction', 'multiplication', 'division', 'fractions', 'geometry',
  'counting', 'number sense', 'place value', 'ten frame', 'base ten',
  'measurement', 'telling time', 'counting money', 'science', 'stem', 'social studies',
  'ela', 'literacy', 'language arts', 'decodable', 'comprehension',
  'fine motor', 'speech therapy', 'special education', 'iep', 'sel',
  'classroom management', 'morning work', 'homeschool', 'montessori',
  'maze', 'mazes', 'labyrinth', 'puzzle', 'puzzles'
]);

const EDUCATIONAL_AUDIENCE_TERMS = Object.freeze([
  'preschool', 'pre k', 'prekindergarten', 'kindergarten', 'first grade',
  'second grade', 'third grade', 'fourth grade', 'fifth grade', 'sixth grade',
  'grade 1', 'grade 2', 'grade 3', 'grade 4', 'grade 5', 'grade 6',
  'elementary', 'teacher', 'teachers', 'student', 'students', 'classroom',
  'school', 'homeschool'
]);

const EDUCATIONAL_PRODUCT_TERMS = Object.freeze([
  'book', 'books', 'workbook', 'workbooks', 'worksheet', 'worksheets',
  'printable', 'printables', 'activity book', 'activity books',
  'activity page', 'activity pages', 'activity pack', 'activity packs',
  'practice page', 'practice pages', 'practice pack', 'practice packs',
  'center', 'centers', 'math center', 'math centers', 'literacy center',
  'literacy centers', 'task card', 'task cards', 'flash card', 'flash cards',
  'flashcard', 'flashcards', 'poster', 'posters', 'anchor chart',
  'anchor charts', 'lesson plan', 'lesson plans', 'curriculum', 'unit study',
  'assessment', 'quiz', 'test prep', 'interactive notebook', 'foldable',
  'reader', 'readers', 'decodable reader', 'decodable readers',
  'maze', 'mazes', 'maze book', 'maze books', 'puzzle book', 'puzzle books'
]);

function isBlacklistedNiche(value) {
  const text = normalizedSearchText(value);
  if (!text.trim()) return false;
  return BLACKLIST_NICHE_TERMS.some((term) => hasTerm(text, term));
}

function isEducationalProductCandidate(value) {
  if (isBlacklistedNiche(value)) return false;
  const text = normalizedSearchText(value);
  if (!text.trim()) return false;
  const isStructuredCandidate = value != null && typeof value === 'object';
  const hasSubject = EDUCATIONAL_SUBJECT_TERMS.some((term) => hasTerm(text, term));
  const hasAudience = EDUCATIONAL_AUDIENCE_TERMS.some((term) => hasTerm(text, term));
  const hasProduct = EDUCATIONAL_PRODUCT_TERMS.some((term) => hasTerm(text, term));
  if (hasSubject && (!isStructuredCandidate || hasProduct || hasAudience)) return true;
  return hasAudience && hasProduct;
}

function isAllowedTrendCandidate(value) {
  return !isBlacklistedNiche(value) && isEducationalProductCandidate(value);
}

/**
 * Read candidate products off a rendered page.
 *
 * Runs in the page, so it sees what a reader sees rather than markup that may
 * never render. The selector list is per source and intentionally broad: these
 * sites reshuffle their class names, and a scraper that matches one exact class
 * is a scraper that silently returns nothing next month.
 */
function collectCandidatesInPage(sourceId) {
  const SELECTORS = {
    trending: ['article a[href]', '.trend-item a[href]', 'li a[href]', 'h2 a[href], h3 a[href]'],
    tpt: ['[data-testid*="ProductRow"] a[href*="/Product/"]', 'a[href*="/Product/"]'],
    kdp: ['[data-component-type="s-search-result"] h2 a[href]', 'a.a-link-normal[href*="/dp/"]'],
    etsy: ['a.listing-link[href*="/listing/"]', 'a[href*="/listing/"]']
  };
  const selectors = SELECTORS[sourceId] || ['a[href]'];
  const seen = new Set();
  const out = [];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const href = node.href;
      if (!href || seen.has(href)) continue;
      const rect = node.getBoundingClientRect();
      // Zero-sized nodes are hidden scaffolding, not results a person would see.
      if (rect.width === 0 && rect.height === 0) continue;
      const container = node.closest('article, li, [data-component-type], [data-testid], div') || node;
      const text = (node.innerText || node.textContent || '').trim();
      const price = (container.innerText || '').match(/(?:US\s*)?[$£€]\s?\d+(?:[.,]\d{2})?/);
      const rating = (container.innerText || '').match(/([0-5][.,]\d)\s*(?:out of 5|stars?)/i);
      const reviews = (container.innerText || '').match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      seen.add(href);
      out.push({
        url: href,
        title: text.slice(0, 300),
        price: price ? price[0] : null,
        rating: rating ? rating[1] : null,
        reviews: reviews ? reviews[1] : null,
        browseRank: out.length + 1
      });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

const QUERY_STOP_WORDS = Object.freeze(new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'book', 'books',
  'pack', 'set', 'unit', 'kids', 'kid', 'printable', 'printables',
  'pages', 'page', 'activity', 'activities', 'best', 'seller', 'sellers',
  'trending', 'trendy'
]));

function queryTokens(query) {
  return clean(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));
}

function titleMatchesQuery(title, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const hay = String(title || '').toLowerCase();
  return tokens.some((token) => hay.includes(token));
}

function queryRelevance(title, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const hay = String(title || '').toLowerCase();
  const hits = tokens.filter((token) => hay.includes(token));
  if (!hits.length) return 0;
  return (hits.length / tokens.length) * 40 + (hits.length === tokens.length ? 12 : 0);
}

function productFocusScore(title, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const hay = String(title || '').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!hay.includes(token)) continue;
    const atStart = new RegExp(`^(?:the\\s+)?${token}`).test(hay);
    const asProduct = new RegExp(`\\b${token}(?:s|d)?\\s+(?:book|puzzle|puzzles|labyrinth|packet|pack|pages)\\b`).test(hay)
      || new RegExp(`\\b${token}(?:s|d)?\\s*[-–—]`).test(hay);
    const idx = hay.indexOf(token);
    const before = hay.slice(0, Math.max(0, idx));
    const clutter = (before.match(/\b(letter|alphabet|abc|number|numbers|worksheet|worksheets|coloring|tracing|word search|crossword|valentine|thanksgiving|figurative)\b/g) || []).length;
    if (atStart) score += 32;
    else if (asProduct) score += 26;
    else if (clutter >= 2) score += 1;
    else score += 12;
  }
  return score;
}

/**
 * Score a candidate so the agent picks a product rather than a nav link.
 *
 * A typed query must appear in the title. Among matches, reviews and rating
 * mark a bestseller. Title length is only a weak tiebreaker.
 */
function canonicalizeProductUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return parsed.href.replace(/\/$/, '');
  } catch {
    return String(rawUrl || '').split('?')[0].replace(/\/$/, '');
  }
}

function browseRankBonus(candidate) {
  const rank = Number(candidate?.browseRank);
  if (!Number.isFinite(rank) || rank < 1) return 0;
  return Math.max(0, 20 - rank);
}

function scoreCandidate(candidate, query = '') {
  const title = clean(candidate?.title);
  if (!isAllowedTrendCandidate(candidate)) return -1;
  if (title.length < 12) return -1;
  if (/^(home|shop|browse|categories|sign in|help|about|next|previous)$/i.test(title)) return -1;
  if (!titleMatchesQuery(title, query)) return -1;
  let score = Math.min(8, title.length / 12);
  score += queryRelevance(title, query);
  score += productFocusScore(title, query);
  score += browseRankBonus(candidate);
  if (candidate.price) score += 4;
  if (candidate.rating) score += Number(String(candidate.rating).replace(',', '.')) * 3;
  if (candidate.reviews) score += Math.min(18, Math.log10(Number(String(candidate.reviews).replace(/,/g, '')) || 1) * 8);
  if (candidate.capturedAt) {
    const ageMs = Date.now() - Date.parse(candidate.capturedAt);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 14 * 24 * 60 * 60_000) score += 6;
  }
  return score;
}

/**
 * Rank and de-duplicate candidates, best first.
 *
 * Exported because the ranking is the part worth testing on its own — running it
 * needs no browser.
 */
function rankCandidates(candidates, { limit = 10, query = '' } = {}) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && isAllowedTrendUrl(candidate.url) && isAllowedTrendCandidate(candidate))
    .map((candidate, index) => ({
      ...candidate,
      title: clean(candidate.title),
      browseRank: Number(candidate.browseRank) || (index + 1),
      score: scoreCandidate({
        ...candidate,
        browseRank: Number(candidate.browseRank) || (index + 1)
      }, query)
    }))
    .filter((candidate) => candidate.score > 0)
    .filter((candidate) => {
      const key = canonicalizeProductUrl(candidate.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.score - left.score || (left.browseRank || 99) - (right.browseRank || 99))
    .slice(0, Math.max(1, limit));
}

const RECENT_TREND_PICK_LIMIT = 8;

function pickTrendListing(candidates, { query = '', excludeUrls = [], limit = 10 } = {}) {
  const ranked = rankCandidates(candidates, { query, limit: Math.max(limit, 16) });
  const excluded = new Set(
    (Array.isArray(excludeUrls) ? excludeUrls : [])
      .map((item) => canonicalizeProductUrl(item?.url || item))
      .filter(Boolean)
  );
  const fresh = ranked.filter((item) => !excluded.has(canonicalizeProductUrl(item.url)));
  return (fresh.length ? fresh : ranked)[0] || null;
}

function recentTrendPickUrls(store) {
  const rows = store && typeof store.getSetting === 'function'
    ? store.getSetting('recentTrendPicks', [])
    : [];
  return (Array.isArray(rows) ? rows : [])
    .map((item) => canonicalizeProductUrl(item?.url || item))
    .filter(Boolean);
}

function rememberTrendPick(store, candidate) {
  if (!store || typeof store.getSetting !== 'function' || typeof store.setSetting !== 'function') return [];
  const url = canonicalizeProductUrl(candidate?.url);
  if (!url) return store.getSetting('recentTrendPicks', []) || [];
  const previous = Array.isArray(store.getSetting('recentTrendPicks', []))
    ? store.getSetting('recentTrendPicks', [])
    : [];
  const next = [
    { url, title: clean(candidate?.title, 200), at: new Date().toISOString() },
    ...previous.filter((item) => canonicalizeProductUrl(item?.url || item) !== url)
  ].slice(0, RECENT_TREND_PICK_LIMIT);
  store.setSetting('recentTrendPicks', next);
  return next;
}

/**
 * Open one source and read its candidates.
 *
 * `openPage` is injected — the caller supplies a page from the scoped headless
 * scratch context, while the task runner keeps the work serialized in the
 * browser lane.
 */
function raceMarketNavigation(work, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('Market page navigation stalled.'), {
          code: 'MARKET_NAV_STALLED',
          retryable: true
        }));
      }, timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function isRetryableMarketError(error) {
  const text = String(error?.message || error || '');
  return error?.code === 'MARKET_NAV_STALLED'
    || /timeout|stalled|net::err|cloudflare|just a moment/i.test(text);
}

async function scrapeSource({ source, query, openPage, signal = null, timeoutMs = 20_000 }) {
  const definition = SOURCES[source];
  if (!definition) throw Object.assign(new Error(`Unknown trend source "${source}".`), { retryable: false });
  const url = definition.url(query || '');
  if (!isAllowedTrendUrl(url)) {
    throw Object.assign(new Error(`Refusing to open ${url}: not an allowed market-intelligence page.`), { retryable: false });
  }
  const requested = Number(timeoutMs);
  const navTimeout = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.max(requested, 80), 22_000)
    : 20_000;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw signal.reason;
    const page = await openPage();
    try {
      if (typeof page.setDefaultTimeout === 'function') page.setDefaultTimeout(navTimeout);
      if (typeof page.setDefaultNavigationTimeout === 'function') page.setDefaultNavigationTimeout(navTimeout);
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H24',location:'src/trend-scout.cjs:scrapeSource',message:'trend-scan opening market page',data:{attempt,source:definition.id,query:String(query||'').slice(0,80),navTimeout},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await raceMarketNavigation(
        () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout }),
        navTimeout + 2_000
      );
      if (signal?.aborted) throw signal.reason;
      const title = typeof page.title === 'function'
        ? await raceMarketNavigation(() => page.title(), 4_000).catch(() => '')
        : '';
      const currentUrl = typeof page.url === 'function' ? String(page.url() || url) : url;
      const challenged = /just a moment|attention required|verify you are human|checking your browser/i.test(title);
      const stage = observeStageProgress(null, {
        stage: STAGE.TREND_SCAN,
        url: currentUrl,
        challenged,
        now: Date.now()
      });
      if (stage.action === 'recycle') {
        // #region agent log
        fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H25',location:'src/trend-scout.cjs:scrapeSource',message:'trend-scan challenge or stall; recycling tab',data:{attempt,source:definition.id,reason:stage.reason,title:String(title).slice(0,80)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        throw Object.assign(new Error('Market page hit a bot check.'), { code: 'MARKET_NAV_STALLED', retryable: true });
      }
      if (typeof page.waitForTimeout === 'function') {
        await raceMarketNavigation(() => page.waitForTimeout(800), 1_200).catch(() => {});
      }
      if (definition.id === 'tpt' && typeof page.waitForSelector === 'function') {
        await page.waitForSelector('a[href*="/Product/"]', { timeout: 6_000 }).catch(() => {});
      }
      let raw;
      try {
        raw = await raceMarketNavigation(
          () => page.evaluate(collectCandidatesInPage, definition.id),
          Math.min(navTimeout, 12_000)
        );
      } catch (error) {
        if (isRetryableMarketError(error) || signal?.aborted) throw error;
        raw = [];
      }
      let merged = Array.isArray(raw) ? raw.slice() : [];
      if (definition.id === 'tpt') {
        const html = typeof page.content === 'function'
          ? await raceMarketNavigation(() => page.content(), 8_000).catch(() => '')
          : '';
        const extras = listingsFromBrowseHtml(html, url).map((item, index) => ({
          ...item,
          browseRank: item.browseRank || (merged.length + index + 1)
        }));
        merged = merged.concat(extras);
      }
      const candidates = rankCandidates(merged, { query });
      // #region agent log
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H80',location:'src/trend-scout.cjs:scrapeSource',message:'trend-scan ranked listings',data:{attempt,source:definition.id,query:String(query||'').slice(0,80),openedUrl:String(currentUrl||url).slice(0,160),merged:merged.length,ranked:candidates.slice(0,5).map((item)=>({title:item.title,score:item.score})),droppedUnrelated:queryTokens(query).length?merged.filter((item)=>!titleMatchesQuery(item.title,query)).length:0},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (candidates.length || attempt === 2) {
        return {
          source: definition.id,
          label: definition.label,
          url,
          candidates
        };
      }
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw signal.reason;
      if (!isRetryableMarketError(error) || attempt === 2) throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }
  throw lastError || Object.assign(new Error('Market page navigation stalled.'), { code: 'MARKET_NAV_STALLED', retryable: true });
}

/**
 * Turn a chosen candidate into the shape the analysis stage already accepts.
 *
 * The agent's whole job ends here: it produces a product URL and what the
 * listing says about itself, and the existing pipeline does the rest.
 */
function toAnalysisInput(candidate, { source, query = '' } = {}) {
  if (!candidate?.url || !isAllowedTrendUrl(candidate.url)) {
    throw Object.assign(new Error('That candidate is not an allowed product URL.'), { retryable: false });
  }
  if (!isAllowedTrendCandidate(candidate)) {
    throw Object.assign(new Error('That candidate is outside VERSA AGENT educational scope.'), {
      code: 'TREND_SCOPE_REJECTED',
      retryable: false
    });
  }
  return {
    sourceMode: 'url',
    productUrl: candidate.url,
    concept: clean(candidate.title, 300),
    // Carried through so the analysis gem sees what the market said, not just a
    // link, and so the run can be traced back to where it came from.
    trendMetadata: {
      source,
      query: clean(query, 120),
      title: clean(candidate.title, 300),
      price: candidate.price ?? null,
      rating: candidate.rating ?? null,
      reviews: candidate.reviews ?? null,
      capturedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  SOURCES,
  ALLOWED_HOSTS,
  isAllowedTrendUrl,
  isBlacklistedNiche,
  isEducationalProductCandidate,
  isAllowedTrendCandidate,
  rankCandidates,
  scoreCandidate,
  canonicalizeProductUrl,
  pickTrendListing,
  recentTrendPickUrls,
  rememberTrendPick,
  scrapeSource,
  toAnalysisInput,
  collectCandidatesInPage
};

/* ===========================================================================
 * Two phases, not four peers
 *
 * The discovery feed and marketplace sources answer different questions.
 * Merging their results into one ranked list threw that away: a rising keyword
 * with no proven demand ended up competing against a proven seller nobody is
 * searching for, and whichever scored higher won more or less by accident.
 *
 *   discovery    the trend feed says what topic is rising
 *   validation   the selected marketplace says whether it sells, at what price, and
 *                against how much competition
 *
 * So the agent discovers keywords, validates each against the chosen
 * marketplace, and hands over the one with real demand and a beatable competitor — with the
 * evidence attached, so analysis is told what the market actually looks like
 * rather than just given a link.
 *
 * It also degrades in the right direction. No trend feed: validate the
 * educational keyword the person typed.
 * ========================================================================= */

/** The feed that answers "what is rising". */
const DISCOVERY_SOURCE = 'trending';

/** The sources that answer "does it sell". */
const MARKETPLACES = Object.freeze(['tpt', 'kdp', 'etsy']);

/** Words that carry no search intent, stripped when a title becomes a keyword. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'by',
  'your', 'my', 'our', 'this', 'that', 'these', 'those', 'new', 'best', 'top',
  'free', 'printable', 'printables', 'digital', 'download', 'instant', 'pdf',
  'bundle', 'set', 'pack', 'kit', 'editable', 'worksheets', 'activities'
]);

/**
 * Turn a listing title into something worth searching for.
 *
 * A title is a sales pitch; a keyword is what someone types. Dropping the
 * boilerplate ("instant download printable bundle") leaves the subject, which is
 * what the marketplaces should be asked about.
 */
function titleToKeyword(title, { maxWords = 4 } = {}) {
  if (!isAllowedTrendCandidate(title)) return '';
  const words = clean(title, 160)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  // One word is a category, not a topic worth validating — "shop", "math". Four
  // is the ceiling because a longer phrase stops two listings about the same
  // subject collapsing into one keyword, which is the whole point of this step.
  if (words.length < 2) return '';
  const keyword = words.slice(0, maxWords).join(' ').trim();
  return isAllowedTrendCandidate(keyword) ? keyword : '';
}

/**
 * Candidate keywords from the trend feed, most promising first.
 *
 * Duplicates collapse: two trending listings about sight words are one keyword
 * worth validating, not two.
 */
function extractKeywords(candidates, { limit = 5 } = {}) {
  const byKeyword = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!isAllowedTrendCandidate(candidate)) continue;
    const keyword = titleToKeyword(candidate?.title);
    if (!keyword || keyword.split(' ').length < 2) continue;
    const existing = byKeyword.get(keyword);
    const score = Number(candidate.score) || 0;
    if (!existing) {
      byKeyword.set(keyword, { keyword, score, seenIn: 1, example: clean(candidate.title, 200) });
    } else {
      // Appearing twice in a trend feed is itself a signal.
      existing.seenIn += 1;
      existing.score = Math.max(existing.score, score) + 2;
    }
  }
  return [...byKeyword.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

/** Parse "$4.50" / "US $12" / "£3,99" into a number, or null. */
function parsePrice(value) {
  const match = String(value ?? '').match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const price = Number(match[1].replace(',', '.'));
  return Number.isFinite(price) && price > 0 && price < 10_000 ? price : null;
}

function parseCount(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  const count = Number(digits);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function median(numbers) {
  const sorted = numbers.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

/**
 * What one marketplace says about a keyword.
 *
 * These are the facts a listing states about itself — how many are selling, what
 * they charge, how much social proof the leaders have. It is the evidence a
 * person would gather by hand before deciding to make the thing.
 */
function summariseMarket(source, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const prices = list.map((item) => parsePrice(item.price)).filter((n) => n !== null);
  const reviews = list.map((item) => parseCount(item.reviews)).filter((n) => n !== null);
  return {
    source,
    listings: list.length,
    medianPrice: median(prices),
    priceLow: prices.length ? Math.min(...prices) : null,
    priceHigh: prices.length ? Math.max(...prices) : null,
    topReviews: reviews.length ? Math.max(...reviews) : null,
    // A market where the leaders have modest review counts is one a new listing
    // can still reach the front of.
    provenDemand: reviews.length ? reviews.reduce((sum, n) => sum + n, 0) : 0
  };
}

/**
 * Rank an opportunity: real demand, beatable competition.
 *
 * Deliberately not "highest demand wins". A keyword whose leaders have tens of
 * thousands of reviews is proven and unwinnable; one with none is unproven. The
 * shape wanted is a market that clearly sells but is not yet locked up, so
 * demand is rewarded and a runaway leader is penalised.
 */
function scoreOpportunity({ markets = [], demandScore = 0 } = {}) {
  const seen = markets.filter((market) => market.listings > 0);
  if (!seen.length) return 0;
  const listings = seen.reduce((sum, market) => sum + market.listings, 0);
  const proof = seen.reduce((sum, market) => sum + (market.provenDemand || 0), 0);
  const leader = Math.max(0, ...seen.map((market) => market.topReviews || 0));

  let score = 0;
  score += Math.min(20, listings);                          // it exists in the market
  score += Math.min(25, Math.log10(proof + 1) * 9);         // and it sells
  score += seen.length * 6;                                 // confirmed in more than one place
  score += Math.min(15, demandScore / 2);                   // and it is trending
  // A leader with 5k+ reviews owns the category; that is a wall, not an opening.
  if (leader > 5_000) score -= 18;
  else if (leader > 1_500) score -= 8;
  const price = median(seen.map((market) => market.medianPrice).filter((n) => n !== null));
  // A market pricing at pennies is not worth the production cost.
  if (price !== null && price < 2) score -= 6;
  return Math.max(0, Number(score.toFixed(2)));
}

/**
 * Phase 1 — read the trend feed and propose keywords.
 *
 * Falls back to the keyword the person typed when the feed cannot be read, so a
 * broken discovery source does not stop the run.
 */
async function discoverKeywords({ openPage, signal = null, seed = '', limit = 4 } = {}) {
  const seedKeyword = clean(seed, 120).toLowerCase();
  try {
    const feed = await scrapeSource({ source: DISCOVERY_SOURCE, query: seedKeyword, openPage, signal });
    const keywords = extractKeywords(feed.candidates, { limit });
    if (keywords.length) return { keywords, source: DISCOVERY_SOURCE, degraded: false };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (!seedKeyword) throw error;
  }
  if (!seedKeyword) {
    throw Object.assign(
      new Error('The trending feed could not be read and no keyword was given, so there is nothing to validate.'),
      { code: 'TREND_DISCOVERY_EMPTY' }
    );
  }
  if (!isAllowedTrendCandidate(seedKeyword)) {
    throw Object.assign(
      new Error('The keyword is outside VERSA AGENT educational scope. Use an educational book, workbook or printable topic.'),
      { code: 'TREND_SCOPE_REJECTED', retryable: false }
    );
  }
  // Degraded, and says so: the keyword is the person's, not the market's.
  return { keywords: [{ keyword: seedKeyword, score: 0, seenIn: 0, example: seedKeyword }], source: 'seed', degraded: true };
}

/**
 * Phase 2 — ask the selected marketplace about one keyword.
 *
 * The app normally passes a single marketplace. The function still accepts a
 * list for direct tests and older queued tasks.
 */
async function validateKeyword({ keyword, marketplaces = MARKETPLACES, openPage, signal = null } = {}) {
  const query = clean(keyword, 120);
  if (!query) throw Object.assign(new Error('A keyword is required to validate.'), { retryable: false });
  if (!isAllowedTrendCandidate(query)) {
    throw Object.assign(
      new Error('The keyword is outside VERSA AGENT educational scope. Use an educational book, workbook or printable topic.'),
      { code: 'TREND_SCOPE_REJECTED', retryable: false }
    );
  }
  const markets = [];
  const problems = [];
  const listings = [];
  for (const source of marketplaces) {
    if (signal?.aborted) throw signal.reason;
    if (!SOURCES[source] || source === DISCOVERY_SOURCE) continue;
    try {
      const result = await scrapeSource({ source, query, openPage, signal });
      markets.push(summariseMarket(source, result.candidates));
      listings.push(...result.candidates.map((candidate) => ({ ...candidate, source })));
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      problems.push({ source, error: String(error.message ?? error).slice(0, 200) });
    }
  }
  return { keyword: query, markets, problems, listings };
}

/**
 * Phase 3 — choose what to build, and say why.
 *
 * The reason travels with the choice. A pipeline that says "this keyword is
 * trending, twenty-two sellers across two marketplaces, median $4.50, the leader
 * has 312 reviews" is one whose decisions can be argued with; one that says
 * "here is a URL" is not.
 */
function chooseOpportunity(validations, { excludeUrls = [] } = {}) {
  const scored = (Array.isArray(validations) ? validations : [])
    .map((validation) => ({
      ...validation,
      listings: (validation.listings || []).filter((candidate) => isAllowedTrendCandidate(candidate)),
      score: scoreOpportunity({ markets: validation.markets, demandScore: validation.demandScore || 0 })
    }))
    .filter((validation) => validation.score > 0 && validation.listings?.length && isAllowedTrendCandidate(validation.keyword))
    .sort((left, right) => right.score - left.score);
  if (!scored.length) return null;

  const winner = scored[0];
  const relevant = winner.listings.filter((candidate) => titleMatchesQuery(candidate.title, winner.keyword));
  if (!relevant.length) return null;
  const best = pickTrendListing(relevant, { query: winner.keyword, excludeUrls });
  if (!best) return null;
  const seen = winner.markets.filter((market) => market.listings > 0);
  return {
    keyword: winner.keyword,
    score: winner.score,
    candidate: best,
    evidence: {
      marketplaces: seen.map((market) => market.source),
      listings: seen.reduce((sum, market) => sum + market.listings, 0),
      medianPrice: median(seen.map((market) => market.medianPrice).filter((n) => n !== null)),
      topReviews: Math.max(0, ...seen.map((market) => market.topReviews || 0)),
      problems: winner.problems ?? []
    },
    runnersUp: scored.slice(1, 4).map((validation) => ({ keyword: validation.keyword, score: validation.score }))
  };
}

module.exports.DISCOVERY_SOURCE = DISCOVERY_SOURCE;
module.exports.MARKETPLACES = MARKETPLACES;
module.exports.titleToKeyword = titleToKeyword;
module.exports.extractKeywords = extractKeywords;
module.exports.summariseMarket = summariseMarket;
module.exports.scoreOpportunity = scoreOpportunity;
module.exports.discoverKeywords = discoverKeywords;
module.exports.validateKeyword = validateKeyword;
module.exports.chooseOpportunity = chooseOpportunity;
