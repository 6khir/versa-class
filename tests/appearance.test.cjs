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
  assert.match(midnight, /\.button-pause/);
  assert.match(midnight, /#FF3B30|#FF453A|#D70015/);
  assert.match(html, /id="automation-pause-btn" class="button button-pause"/);
});

test('exactly one day/night control is reachable in the studio chrome', () => {
  const html = readFileSync(join(__dirname, '..', 'renderer/index.html'), 'utf8');
  // The intro screen keeps its own switch; it is never on screen at the same
  // time as the header. Two switches were visible in the studio before this.
  const switches = html.match(/class="[^"]*appearance-switch[^"]*"/g) || [];
  assert.equal(switches.length, 2);
  assert.equal(switches.filter((s) => s.includes('studio-intro__appearance')).length, 1);
  assert.match(html, /<div class="appearance-switch" id="global-appearance-switch"/);
  assert.doesNotMatch(
    html,
    /ui-profile-menu__panel[\s\S]{0,2000}?appearance-switch/,
    'the profile panel must not carry a second theme switch',
  );
});

test('Day/Night switch crossfades materials in CSS without a timeout or Overview refresh', () => {
  const rendererSrc = readFileSync(join(__dirname, '..', 'renderer/renderer.js'), 'utf8');
  const refinedSrc = readFileSync(join(__dirname, '..', 'renderer/refined.css'), 'utf8');
  const apply = rendererSrc.slice(
    rendererSrc.indexOf('function applyAppearanceUi'),
    rendererSrc.indexOf('function applyEditableEngineUi')
  );
  assert.doesNotMatch(apply, /setTimeout/);
  assert.doesNotMatch(apply, /theme-crossfade/);
  assert.match(rendererSrc, /setAppearance\(appearance\), \{ refresh: false \}/);
  assert.match(rendererSrc, /function isAppearanceOnlyStateChange/);
  assert.match(refinedSrc, /background-color 240ms var\(--vs-ease\)/);
  assert.doesNotMatch(
    refinedSrc.slice(refinedSrc.indexOf('Theme switch — material only'), refinedSrc.indexOf('THE OVERVIEW — PRODUCTION PIPELINE')),
    /width 240ms|height 240ms|grid 240ms|transform 240ms/
  );
});

test('Day/Night switch is a Library/Studio segmented control, not an iOS toggle', () => {
  const html = readFileSync(join(__dirname, '..', 'renderer/index.html'), 'utf8');
  const refined = readFileSync(join(__dirname, '..', 'renderer/refined.css'), 'utf8');
  assert.match(html, /id="global-appearance-switch"/);
  assert.match(html, /data-action="set-appearance" data-appearance="light"/);
  assert.match(html, /data-action="set-appearance" data-appearance="dark"/);
  const twin = refined.slice(refined.lastIndexOf('Library/Studio and Day/Night'));
  assert.match(twin, /\.studio-modes,\s*\nhtml body\.ui-redesign\.versa-studio\.pro-suite \.appearance-switch/);
  assert.match(twin, /background:\s*#3AA0F2/);
  assert.match(twin, /border-radius:\s*999px/);
  assert.match(twin, /height:\s*30px/);
  assert.doesNotMatch(twin, /rgba\(118,\s*118,\s*128/);
});
