const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { extname, join } = require('node:path');

const MAX_LISTING_MOCKUPS = 8;
const MIN_IMAGE_BYTES = 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const TPT_HOST_PATTERN = /(^|\.)teacherspayteachers\.com$/i;
const TPT_CDN_HOST_PATTERN = /(?:cloudfront\.net|cloudflareusercontent\.com|tptcdn|tptdev|transcend-cdn\.com)$/i;
const EXCLUDED_PATH_PATTERN = /\/(?:avatars?|users?\/|seller|badges?|logos?|icons?|favicon|reviews?|ratings?|social|flags?|sprites?|placeholders?|pixel)(?:\/|$)/i;
const TRACKING_OR_UI_PATTERN = /(?:1x1|pixel\.gif|spinner|placeholder|watermark-badge|tpt-logo|follow-button|\/Product\/onerror)/i;
const LISTING_MEDIA_HINT = /thumbitem|preview|original-|\/images\/|\/product/i;

function cleanText(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function parseTptProductUrl(value) {
  try {
    const parsed = new URL(String(value ?? '').trim());
    if (!/^https?:$/i.test(parsed.protocol) || !TPT_HOST_PATTERN.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/Product\/(?:[^/]*?-)?(\d+)\/?$/i)
      || parsed.pathname.match(/\/Product\/(\d+)/i);
    if (!match) return null;
    parsed.hash = '';
    return {
      href: parsed.href,
      productId: match[1],
      hostname: parsed.hostname
    };
  } catch {
    return null;
  }
}

function isTptProductUrl(value) {
  return Boolean(parseTptProductUrl(value));
}

function resolveListingAnalysisInput(input = {}) {
  const productUrl = String(input.productUrl || input.url || '').trim();
  const parsed = parseTptProductUrl(productUrl);
  const explicit = String(input.sourceMode || '').trim().toLowerCase();
  const lockedMode = explicit === 'builder' || explicit === 'bulk';
  const sourceMode = lockedMode ? explicit : (parsed ? 'url' : explicit);
  return {
    ...input,
    productUrl: parsed?.href || productUrl,
    sourceMode
  };
}

function shouldCaptureListingMockups(input = {}) {
  const listing = resolveListingAnalysisInput(input);
  if (listing.sourceMode === 'builder' || listing.sourceMode === 'bulk') return false;
  return isTptProductUrl(listing.productUrl);
}

function unwrapCdnCgiImageUrl(url) {
  const href = String(url || '').trim();
  if (!href) return href;
  try {
    const parsed = new URL(href);
    const match = parsed.pathname.match(/\/cdn-cgi\/image\/[^/]+\/(.+)$/i);
    if (!match) return parsed.href;
    parsed.pathname = `/${match[1]}`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return href;
  }
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function resolveAbsoluteUrl(value, pageUrl) {
  const raw = decodeHtmlEntities(String(value ?? '').trim());
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
  try {
    const parsed = new URL(raw, pageUrl || 'https://www.teacherspayteachers.com/');
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function isAllowedListingHost(url) {
  try {
    const host = new URL(url).hostname;
    return TPT_HOST_PATTERN.test(host) || TPT_CDN_HOST_PATTERN.test(host);
  } catch {
    return false;
  }
}

function isImageLikeUrl(url) {
  const path = String(url || '').split('?')[0].toLowerCase();
  if (/\.(?:jpe?g|png|webp|gif|avif)$/i.test(path)) return true;
  return /thumbitem|\/images\/|preview|original-|large-|cdn/i.test(path);
}

function preferOriginalMockupUrl(url) {
  const href = unwrapCdnCgiImageUrl(url);
  return href.replace(
    /\/(?:large|medium|small|thumb|tiny|750f|\d{2,4}f?)-(\d+)-(\d+)\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i,
    '/original-$1-$2.$3$4'
  );
}

function mockupIdentity(url) {
  const upgraded = preferOriginalMockupUrl(url).split('?')[0];
  const match = upgraded.match(/original-(\d+)-(\d+)\./i);
  if (match) return `${match[1]}:${match[2]}`;
  return upgraded;
}

function urlIncludesProductId(url, productId) {
  if (!productId) return true;
  const id = String(productId);
  return new RegExp(`(?:^|\\D)${id}(?:\\D|$)`).test(url);
}

function isExcludedListingUrl(url) {
  try {
    const parsed = new URL(url);
    const haystack = `${parsed.pathname}${parsed.search}`;
    if (EXCLUDED_PATH_PATTERN.test(haystack) || TRACKING_OR_UI_PATTERN.test(haystack)) return true;
    if (/\/Store\//i.test(parsed.pathname) && !LISTING_MEDIA_HINT.test(haystack)) return true;
    return false;
  } catch {
    return true;
  }
}

function isLikelyListingMockup(url, productId) {
  if (!isAllowedListingHost(url) || !isImageLikeUrl(url) || isExcludedListingUrl(url)) return false;
  if (productId && !urlIncludesProductId(url, productId) && !LISTING_MEDIA_HINT.test(url)) return false;
  return true;
}

function collectUrlsFromUnknown(value, found, pageUrl) {
  if (typeof value === 'string') {
    const resolved = resolveAbsoluteUrl(value, pageUrl);
    if (resolved && isImageLikeUrl(resolved)) found.push(resolved);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrlsFromUnknown(item, found, pageUrl);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const preferredKeys = [
    'thumbnailOriginalUrl',
    'thumbnailLargeUrl',
    'originalUrl',
    'largeUrl',
    'previewUrl',
    'imageUrl',
    'url',
    'src',
    'contentUrl'
  ];
  for (const key of preferredKeys) {
    if (typeof value[key] === 'string') {
      const resolved = resolveAbsoluteUrl(value[key], pageUrl);
      if (resolved) found.push(resolved);
    }
  }
  if (typeof value.image === 'string' || Array.isArray(value.image) || (value.image && typeof value.image === 'object')) {
    collectUrlsFromUnknown(value.image, found, pageUrl);
  }
  for (const nested of Object.values(value)) collectUrlsFromUnknown(nested, found, pageUrl);
}

function extractMetaImageUrls(html, pageUrl) {
  const urls = [];
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["'][^>]*>/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const resolved = resolveAbsoluteUrl(match[1], pageUrl);
      if (resolved) urls.push(resolved);
    }
  }
  return urls;
}

function extractJsonLdImageUrls(html, pageUrl) {
  const urls = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const block = match[1].trim();
    try {
      collectUrlsFromUnknown(JSON.parse(block), urls, pageUrl);
    } catch {
      for (const found of block.matchAll(/https?:\\?\/\\?\/[^"'\s]+/gi)) {
        const resolved = resolveAbsoluteUrl(found[0], pageUrl);
        if (resolved) urls.push(resolved);
      }
    }
  }
  return urls;
}

function extractNextDataImageUrls(html, pageUrl) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  const urls = [];
  try {
    collectUrlsFromUnknown(JSON.parse(match[1]), urls, pageUrl);
  } catch {
    for (const found of match[1].matchAll(/https?:\\?\/\\?\/[^"'\s]+teacherspayteachers\.com[^"'\s]*/gi)) {
      const resolved = resolveAbsoluteUrl(found[0], pageUrl);
      if (resolved) urls.push(resolved);
    }
  }
  return urls;
}

function extractImgTagUrls(html, pageUrl) {
  const urls = [];
  for (const tag of html.matchAll(/<(?:img|source)[^>]+>/gi)) {
    const tagHtml = tag[0];
    for (const attr of tagHtml.matchAll(/(?:src|data-src|data-original|srcset)=["']([^"']+)["']/gi)) {
      for (const part of attr[1].split(',')) {
        const resolved = resolveAbsoluteUrl(part.trim().split(/\s+/)[0], pageUrl);
        if (resolved) urls.push(resolved);
      }
    }
  }
  return urls;
}

function extractCdnUrls(html, pageUrl) {
  const urls = [];
  for (const match of html.matchAll(/https?:\\?\/\\?\/(?:ecdn|cfcdn|images|cdn)[^"'\s<>]*teacherspayteachers\.com[^"'\s<>]*/gi)) {
    const resolved = resolveAbsoluteUrl(match[0], pageUrl);
    if (resolved) urls.push(resolved);
  }
  return urls;
}

function uniqueListingMockupUrls(urls, { productId = null, maxImages = MAX_LISTING_MOCKUPS } = {}) {
  const incoming = (Array.isArray(urls) ? urls : [])
    .map((url) => preferOriginalMockupUrl(unwrapCdnCgiImageUrl(url)))
    .filter((url) => isLikelyListingMockup(url, null));

  const matchingId = productId
    ? incoming.filter((url) => urlIncludesProductId(url, productId))
    : incoming;
  const pool = matchingId.length ? matchingId : incoming.filter((url) => LISTING_MEDIA_HINT.test(url));

  const ranked = [...pool].sort((left, right) => {
    const leftOriginal = /\/original-\d+-\d+\./i.test(left) ? 0 : 1;
    const rightOriginal = /\/original-\d+-\d+\./i.test(right) ? 0 : 1;
    return leftOriginal - rightOriginal;
  });

  const unique = [];
  const seen = new Set();
  for (const url of ranked) {
    const identity = mockupIdentity(url);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(url.split('?')[0]);
    if (unique.length >= maxImages) break;
  }
  return unique;
}

function extractListingMockupUrls(html, { pageUrl = '', productId = null, extraUrls = [] } = {}) {
  const source = String(html ?? '');
  const parsed = parseTptProductUrl(pageUrl);
  const id = productId || parsed?.productId || null;
  const collected = [
    ...extractMetaImageUrls(source, pageUrl),
    ...extractJsonLdImageUrls(source, pageUrl),
    ...extractNextDataImageUrls(source, pageUrl),
    ...extractImgTagUrls(source, pageUrl),
    ...extractCdnUrls(source, pageUrl),
    ...(Array.isArray(extraUrls) ? extraUrls : [])
  ]
    .map((url) => resolveAbsoluteUrl(url, pageUrl))
    .map((url) => (url ? unwrapCdnCgiImageUrl(url) : null))
    .filter(Boolean);
  return uniqueListingMockupUrls(collected, { productId: id });
}

function isCloudflareChallengeHtml(html) {
  const text = String(html ?? '');
  if (/<title>\s*Just a moment/i.test(text)) return true;
  const challenge = /cf-mitigated=["']challenge|id=["']challenge-form["']|cdn-cgi\/challenge-platform/i.test(text);
  if (!challenge) return false;
  // Live TPT listings still embed Cloudflare scripts after the gallery loads.
  return !/(thumbitem|property=["']og:image["']|__NEXT_DATA__)/i.test(text);
}

function imageExtensionFor(contentType, sourceUrl) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('avif')) return '.avif';
  const fromUrl = extname(String(sourceUrl || '').split('?')[0]).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(fromUrl)) return fromUrl === '.jpeg' ? '.jpg' : fromUrl;
  return '.jpg';
}

function isLikelyImageBuffer(buffer, contentType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_IMAGE_BYTES || buffer.length > MAX_IMAGE_BYTES) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return true;
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true;
  if (buffer.toString('ascii', 0, 3) === 'GIF') return true;
  return String(contentType).toLowerCase().startsWith('image/');
}

function extractPageCountFromTptHtml(html) {
  if (!html || typeof html !== 'string') return null;

  // 1. JSON-LD schema
  try {
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      const data = JSON.parse(match[1]);
      if (data && typeof data === 'object') {
        const pages = data.numberOfPages || data.props?.pageCount;
        if (pages && parseInt(pages, 10) > 0) return parseInt(pages, 10);
      }
    }
  } catch {}

  // 2. Next.js payload
  try {
    const nextMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextMatch) {
      const data = JSON.parse(nextMatch[1]);
      const product = data?.props?.pageProps?.product || data?.props?.pageProps?.initialProduct;
      const pages = product?.pageCount || product?.totalPages || product?.numberOfPages;
      if (pages && parseInt(pages, 10) > 0) return parseInt(pages, 10);
    }
  } catch {}

  // 3. Common TPT detail patterns in HTML
  const patterns = [
    /Total\s*Pages\s*[:\s<>/a-z="'-]*?(\d+)\s*pages?/i,
    /Total\s*Pages\s*[:\s<>/a-z="'-]*?(\d+)/i,
    /Number\s*of\s*Pages\s*[:\s<>/a-z="'-]*?(\d+)/i,
    /Page\s*Count\s*[:\s<>/a-z="'-]*?(\d+)/i,
    /(\d+)\s*pages?\s*(?:total|in\s*total|included|printable|worksheets?)/i,
    /(\d+)\s*page\s*(?:workbook|book|packet|pack|bundle|set|unit|worksheet|activity)/i
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && parseInt(m[1], 10) > 0) {
      return parseInt(m[1], 10);
    }
  }
  return null;
}

function emptyMockupResult({ status = 'empty', productUrl = '', warning = null, scrapedPageCount = null } = {}) {
  return {
    productUrl: cleanText(productUrl, ''),
    scrapedAt: new Date().toISOString(),
    status,
    warning,
    scrapedPageCount: Number.isFinite(scrapedPageCount) && scrapedPageCount > 0 ? scrapedPageCount : null,
    images: []
  };
}

async function downloadListingMockups({
  urls = [],
  destDir,
  fetchBuffer,
  productUrl = '',
  maxImages = MAX_LISTING_MOCKUPS,
  scrapedPageCount = null
} = {}) {
  if (!destDir || typeof fetchBuffer !== 'function') {
    return emptyMockupResult({ status: 'empty', productUrl, warning: 'Mockup download was not configured.', scrapedPageCount });
  }
  mkdirSync(destDir, { recursive: true });
  const images = [];
  const uniqueUrls = uniqueListingMockupUrls(urls, {
    maxImages,
    productId: parseTptProductUrl(productUrl)?.productId || null
  });
  for (const sourceUrl of uniqueUrls) {
    try {
      const payload = await fetchBuffer(sourceUrl);
      const buffer = payload?.buffer;
      const contentType = payload?.contentType || '';
      if (!isLikelyImageBuffer(buffer, contentType)) continue;
      const index = images.length + 1;
      const fileName = `mockup-${String(index).padStart(2, '0')}${imageExtensionFor(contentType, sourceUrl)}`;
      const path = join(destDir, fileName);
      writeFileSync(path, buffer);
      images.push({
        index: images.length,
        path,
        fileName,
        sourceUrl,
        bytes: buffer.length,
        contentType: contentType || 'image/jpeg'
      });
      if (images.length >= maxImages) break;
    } catch {
      // Skip a single failed image and keep the rest of the gallery.
    }
  }
  if (!images.length) {
    return emptyMockupResult({
      status: 'empty',
      productUrl,
      warning: 'Listing mockup URLs were found, but none could be downloaded as images.',
      scrapedPageCount
    });
  }
  return {
    productUrl: cleanText(productUrl, ''),
    scrapedAt: new Date().toISOString(),
    status: 'ok',
    warning: null,
    scrapedPageCount: Number.isFinite(scrapedPageCount) && scrapedPageCount > 0 ? scrapedPageCount : null,
    images
  };
}

function persistCompetitorMockups(result, outputDir, copyFile) {
  const record = result && typeof result === 'object'
    ? result
    : emptyMockupResult({ status: 'empty' });
  if (!outputDir || !Array.isArray(record.images) || !record.images.length || typeof copyFile !== 'function') {
    return record;
  }
  const destDir = join(outputDir, 'competitor-mockups');
  mkdirSync(destDir, { recursive: true });
  const images = record.images.map((image, index) => {
    const fileName = image.fileName || `mockup-${String(index + 1).padStart(2, '0')}${extname(image.path || '.jpg') || '.jpg'}`;
    const destPath = join(destDir, fileName);
    if (image.path && existsSync(image.path)) {
      if (image.path !== destPath) copyFile(image.path, destPath);
      return { ...image, path: existsSync(destPath) ? destPath : image.path, fileName };
    }
    return { ...image, fileName };
  });
  return { ...record, images };
}

function competitorMockupPaths(record) {
  return (Array.isArray(record?.images) ? record.images : [])
    .map((image) => image?.path)
    .filter((filePath) => filePath && existsSync(filePath));
}

function collectMockupUrlsInBrowser() {
  const urls = [];
  const push = (value) => {
    if (!value || typeof value !== 'string') return;
    for (const part of value.split(',')) {
      const raw = part.trim().split(/\s+/)[0];
      if (raw) urls.push(raw);
    }
  };
  const nodes = document.querySelectorAll([
    'img',
    'source',
    '[style*="background-image"]',
    '[data-testid*="preview" i] img',
    '[data-testid*="thumbnail" i] img',
    '[class*="Preview"] img',
    '[class*="Gallery"] img',
    '[aria-label*="Thumbnail" i] img',
    'button[aria-label*="Thumbnail" i] img'
  ].join(','));
  for (const element of nodes) {
    push(element.getAttribute('src'));
    push(element.getAttribute('data-src'));
    push(element.getAttribute('data-original'));
    push(element.getAttribute('srcset'));
    const style = element.getAttribute('style') || '';
    const background = style.match(/url\((['"]?)(.*?)\1\)/);
    if (background) push(background[2]);
  }
  return urls;
}

module.exports = {
  MAX_LISTING_MOCKUPS,
  collectMockupUrlsInBrowser,
  competitorMockupPaths,
  downloadListingMockups,
  emptyMockupResult,
  extractListingMockupUrls,
  extractPageCountFromTptHtml,
  isCloudflareChallengeHtml,
  isTptProductUrl,
  parseTptProductUrl,
  persistCompetitorMockups,
  preferOriginalMockupUrl,
  resolveListingAnalysisInput,
  shouldCaptureListingMockups,
  uniqueListingMockupUrls,
  unwrapCdnCgiImageUrl
};
