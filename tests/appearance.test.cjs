'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  normalizeAppearance,
  resolveAppearance,
  windowBackground,
  splashBackground
} = require('../src/appearance.cjs');

test('appearance aliases map to light, dark, or system', () => {
  assert.equal(normalizeAppearance('light'), 'light');
  assert.equal(normalizeAppearance('day'), 'light');
  assert.equal(normalizeAppearance('dark'), 'dark');
  assert.equal(normalizeAppearance('midnight'), 'dark');
  assert.equal(normalizeAppearance('system'), 'system');
  assert.equal(normalizeAppearance('auto'), 'system');
  assert.equal(normalizeAppearance(''), 'light');
});

test('system appearance follows the OS, explicit modes do not', () => {
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
  assert.equal(resolveAppearance('dark', false), 'dark');
  assert.equal(resolveAppearance('light', true), 'light');
});

test('window chrome colors stay sky for day and midnight for night', () => {
  assert.equal(windowBackground('light'), '#F3F8FC');
  assert.equal(windowBackground('dark'), '#07080C');
  assert.equal(splashBackground('dark'), '#07080C');
});

test('the app ships a day/night switch without dropping the light theme', () => {
  const html = readFileSync(join(__dirname, '..', 'renderer/index.html'), 'utf8');
  const renderer = readFileSync(join(__dirname, '..', 'renderer/renderer.js'), 'utf8');
  const preload = readFileSync(join(__dirname, '..', 'src/preload.cjs'), 'utf8');
  const midnight = readFileSync(join(__dirname, '..', 'renderer/midnight-theme.css'), 'utf8');
  assert.match(html, /class="appearance-switch"/);
  assert.match(html, /data-appearance="dark"/);
  assert.match(html, /Midnight/);
  assert.match(html, /theme-boot\.js/);
  assert.match(html, /midnight-theme\.css/);
  assert.doesNotMatch(html, /apple-vibrancy-theme\.css"\>\s*<link rel="stylesheet" href="\.\/apple-vibrancy-theme\.css"/);
  assert.match(renderer, /function applyAppearanceUi/);
  assert.match(preload, /setAppearance:/);
  assert.match(midnight, /html\[data-theme="dark"\]/);
  assert.match(midnight, /\.live-dock\.is-live/);
  assert.match(midnight, /\.overview-stage-grid \.overview-stage-card:nth-child\(1\)/);
  assert.match(midnight, /\.button-pause/);
  assert.match(midnight, /#FF3B30|#FF453A|#D70015/);
  assert.match(html, /id="automation-pause-btn" class="button button-pause"/);
});
