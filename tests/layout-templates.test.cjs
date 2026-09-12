'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slugTheme,
  pageTypeForJob,
  loadTemplate,
  listTemplates,
  describeZones,
  DEFAULT_THEME,
} = require('../src/layout-templates.cjs');

test('theme slugs and page types resolve to checked-in templates', () => {
  assert.equal(slugTheme('Washable Marker'), 'washable-marker');
  assert.equal(pageTypeForJob({ pageNumber: 1 }, 7), 'cover');
  assert.equal(pageTypeForJob({ pageNumber: 3 }, 7), 'interior');
  assert.equal(pageTypeForJob({ pageNumber: 7 }, 7), 'back');
  assert.equal(pageTypeForJob({ kind: 'back cover', pageNumber: 2 }, 7), 'back');
  const names = listTemplates();
  assert.ok(names.includes('washable-marker__interior'));
  assert.ok(names.includes('construction-paper__cover'));
});

test('unknown themes fall back to washable-marker without changing canvas size', () => {
  const template = loadTemplate('unknown-theme', 'interior');
  assert.equal(template.fromDefault, true);
  assert.equal(template.canvas.width, 2480);
  assert.equal(template.canvas.height, 3508);
  assert.equal(template.theme_id, 'unknown-theme');
  assert.ok(describeZones(template).some((line) => line.startsWith('title ')));
  assert.equal(describeZones(template).join(' ').includes('0.'), false);
  assert.equal(DEFAULT_THEME, 'washable-marker');
});
