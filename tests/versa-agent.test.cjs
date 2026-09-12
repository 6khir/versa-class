'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanKeyword,
  extractTptSearchProducts,
  resolveAgentInput,
  tptBrowseSearchUrl
} = require('../src/versa-agent.cjs');

test('resolveAgentInput treats a TPT product link as a listing scrape', () => {
  const resolved = resolveAgentInput({
    keyword: 'https://www.teacherspayteachers.com/Product/Alphabet-Tracing-Workbook-8413716'
  });
  assert.equal(resolved.productUrl, 'https://www.teacherspayteachers.com/Product/Alphabet-Tracing-Workbook-8413716');
  assert.equal(resolved.productFormat, 'static');
});

test('resolveAgentInput keeps a maze product format', () => {
  const resolved = resolveAgentInput({ keyword: 'maze', productFormat: 'maze' });
  assert.equal(resolved.keyword, 'maze');
  assert.equal(resolved.productFormat, 'maze');
});

test('resolveAgentInput keeps a keyword for TPT search', () => {
  const resolved = resolveAgentInput({ keyword: '  kindergarten math centers  ', productFormat: 'editable' });
  assert.equal(resolved.keyword, 'kindergarten math centers');
  assert.equal(resolved.productUrl, '');
  assert.equal(resolved.productFormat, 'editable');
  assert.match(tptBrowseSearchUrl(resolved.keyword), /search=kindergarten%20math%20centers/);
});

test('extractTptSearchProducts returns unique product listings', () => {
  const html = `
    <a href="/Product/Phonics-Worksheets-1111111">Phonics</a>
    <a href="/Product/Phonics-Worksheets-1111111">again</a>
    <a href="https://www.teacherspayteachers.com/Product/Math-Centers-2222222">Math</a>
    <a href="/Store/seller">ignore</a>
  `;
  const hits = extractTptSearchProducts(html);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].productId, '1111111');
  assert.equal(hits[1].productId, '2222222');
  assert.equal(hits[0].title, 'Phonics Worksheets');
});

test('an empty Gate keyword opens the public TPT trending browse page', () => {
  assert.match(tptBrowseSearchUrl(''), /\/browse\?search=trending/);
  assert.match(tptBrowseSearchUrl(''), /sort=Best%20Sellers/);
  assert.match(tptBrowseSearchUrl('   '), /search=trending/);
  assert.match(tptBrowseSearchUrl('phonics'), /search=phonics/);
  assert.match(tptBrowseSearchUrl('phonics'), /sort=Best%20Sellers/);
});

test('cleanKeyword collapses whitespace', () => {
  assert.equal(cleanKeyword('  two   words '), 'two words');
});
