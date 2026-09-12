'use strict';

const { parseTptProductUrl } = require('./tpt-listing-mockups.cjs');

const TPT_BROWSE = 'https://www.teacherspayteachers.com/browse';
const TPT_TRENDING_QUERY = 'trending';

function cleanKeyword(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isTrendingQuery(keyword) {
  const value = cleanKeyword(keyword).toLowerCase();
  return !value || value === TPT_TRENDING_QUERY || value === 'best sellers' || value === 'bestsellers';
}

function tptBrowseSearchUrl(keyword) {
  const q = isTrendingQuery(keyword) ? TPT_TRENDING_QUERY : cleanKeyword(keyword);
  return `${TPT_BROWSE}?search=${encodeURIComponent(q)}&sort=${encodeURIComponent('Best Sellers')}`;
}

function titleFromTptHref(href) {
  try {
    const path = decodeURIComponent(new URL(href).pathname);
    const slug = path.split('/Product/')[1] || '';
    return slug.replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

function extractTptSearchProducts(html, pageUrl = TPT_BROWSE) {
  const found = [];
  const seen = new Set();
  const source = String(html || '');
  const hrefPattern = /(?:href|url)=["']([^"'#]*\/Product\/[^"'?#]+)/gi;
  let match = hrefPattern.exec(source);
  while (match) {
    let href = String(match[1] || '').replace(/&amp;/gi, '&');
    try {
      href = new URL(href, pageUrl).href;
    } catch {
      match = hrefPattern.exec(source);
      continue;
    }
    const parsed = parseTptProductUrl(href);
    if (parsed && !seen.has(parsed.productId)) {
      seen.add(parsed.productId);
      found.push({
        href: parsed.href,
        productId: parsed.productId,
        title: titleFromTptHref(parsed.href)
      });
    }
    match = hrefPattern.exec(source);
  }
  return found;
}

function listingsFromBrowseHtml(html, pageUrl = TPT_BROWSE) {
  return extractTptSearchProducts(html, pageUrl).map((item) => ({
    url: item.href,
    title: item.title,
    productId: item.productId,
    price: null,
    rating: null,
    reviews: null
  }));
}

function pickTopProduct(products = []) {
  return (Array.isArray(products) ? products : []).find((item) => item?.href || item?.url) || null;
}

function resolveAgentInput(input = {}) {
  const keyword = cleanKeyword(input.keyword || input.query || input.title || '');
  const parsed = parseTptProductUrl(input.productUrl || input.url || keyword);
  const format = String(input.productFormat || input.engine || '').trim().toLowerCase();
  const productFormat = format === 'editable' ? 'editable' : format === 'maze' ? 'maze' : 'static';
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H2',location:'src/versa-agent.cjs:resolveAgentInput',message:'resolveAgentInput format mapping',data:{inputFormat:format,productFormat,keyword},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return {
    keyword: parsed ? keyword.replace(parsed.href, '').trim() : keyword,
    productUrl: parsed?.href || '',
    productFormat
  };
}

module.exports = {
  TPT_BROWSE,
  TPT_TRENDING_QUERY,
  cleanKeyword,
  extractTptSearchProducts,
  isTrendingQuery,
  listingsFromBrowseHtml,
  pickTopProduct,
  resolveAgentInput,
  titleFromTptHref,
  tptBrowseSearchUrl
};
