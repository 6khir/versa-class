'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  DEFAULT_LINKS,
  DEFAULT_PROMPTS,
  LINK_KEYS,
  PROMPT_KEYS,
  setCustomizationSource,
  normalizeCustomization,
  resolveLink,
  resolvePromptText,
  applyTemplate,
  isHttpUrl
} = require('../src/customization.cjs');
const { getJobStartUrl, listGeminiStudios, findStudio, CONTENT_GEM_URL, MOCKUPS_GEM_URL, PREVIEW_GEM_URL } = require('../src/ai-engine.cjs');
const { getProvider } = require('../src/ai-provider.cjs');
const { buildAnalysisPrompt, buildTptThumbnailImagePrompt, buildTptPreviewVideoPrompt } = require('../src/prompt-builder.cjs');
const { buildMazeThemePrompt } = require('../src/maze-prompts.cjs');

const root = join(__dirname, '..');

test.afterEach(() => {
  setCustomizationSource(null);
});

test('Versa destination defaults stay when settings are empty', () => {
  assert.equal(resolveLink('geminiMockups', {}), DEFAULT_LINKS.geminiMockups);
  assert.equal(resolveLink('geminiPlanning', { links: {} }), DEFAULT_LINKS.geminiPlanning);
  assert.equal(resolveLink('chatgptContent', { links: { chatgptContent: '' } }), DEFAULT_LINKS.chatgptContent);
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'gemini'), MOCKUPS_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'preview' }, 'chatgpt'), PREVIEW_GEM_URL);
  assert.equal(getJobStartUrl({ kind: 'analysis' }, 'chatgpt'), CONTENT_GEM_URL);
  assert.match(DEFAULT_LINKS.geminiMockups, /6d30d7350cbc/);
  assert.match(DEFAULT_LINKS.geminiPreview, /1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4/);
});

test('stored destination override wins and empty or invalid values fall back', () => {
  const custom = 'https://gemini.google.com/gem/custom-mockup?mode=image_creator';
  assert.equal(resolveLink('geminiMockups', { links: { geminiMockups: custom } }), custom);
  assert.equal(resolveLink('geminiMockups', { links: { geminiMockups: '   ' } }), DEFAULT_LINKS.geminiMockups);
  assert.equal(resolveLink('geminiMockups', { links: { geminiMockups: 'not-a-url' } }), DEFAULT_LINKS.geminiMockups);
  assert.equal(resolveLink('geminiMockups', { links: { geminiMockups: 'ftp://example.com/gem' } }), DEFAULT_LINKS.geminiMockups);
  assert.equal(resolveLink('unknownSlot', { links: { unknownSlot: custom } }), '');
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'gemini', { geminiMockups: custom }), custom);
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'gemini', { geminiMockups: '' }), DEFAULT_LINKS.geminiMockups);
  assert.equal(isHttpUrl('https://chatgpt.com/g/demo'), true);
  assert.equal(isHttpUrl('notaurl'), false);
});

test('unknown or empty prompt overrides fall back to the current hardcoded default', () => {
  const analysis = buildAnalysisPrompt({ sourceMode: 'url', productUrl: 'https://www.teacherspayteachers.com/Product/x' });
  assert.match(analysis, /productFormat/);
  assert.match(analysis, /Product URL to analyze/);
  assert.equal(
    resolvePromptText('analysisUrl', { productUrl: 'https://example.com/p' }, () => 'HARDCODED'),
    'HARDCODED'
  );
  assert.equal(
    resolvePromptText('analysisUrl', { productUrl: 'https://example.com/p' }, () => 'HARDCODED', { prompts: { analysisUrl: '' } }),
    'HARDCODED'
  );
  assert.equal(
    resolvePromptText('missingPrompt', {}, () => 'HARDCODED', { prompts: { missingPrompt: 'nope' } }),
    'HARDCODED'
  );
  const preview = buildTptPreviewVideoPrompt();
  assert.equal(preview, 'generate a preview video for this tpt product, best seller preview');
});

test('stored prompt override wins at runtime', () => {
  setCustomizationSource(() => ({
    prompts: {
      analysisUrl: 'CUSTOM ANALYSIS for {{productUrl}}',
      mockupThumbnail: 'CUSTOM MOCKUP {{thumbnailNumber}} {{title}}',
      mazeTheme: 'CUSTOM MAZE {{keyword}}'
    }
  }));
  const analysis = buildAnalysisPrompt({ sourceMode: 'url', productUrl: 'https://www.teacherspayteachers.com/Product/x' });
  assert.match(analysis, /CUSTOM ANALYSIS for https:\/\/www\.teacherspayteachers\.com\/Product\/x/);
  const mockup = buildTptThumbnailImagePrompt({ index: 0, title: 'Forest Mazes', brief: 'bright' });
  assert.match(mockup, /CUSTOM MOCKUP 1 Forest Mazes/);
  const maze = buildMazeThemePrompt({ keyword: 'dinosaurs', ageBand: 'kindergarten' });
  assert.match(maze, /CUSTOM MAZE dinosaurs/);
});

test('customization source drives getJobStartUrl and studio Open destinations', () => {
  const planning = 'https://gemini.google.com/gem/custom-planning';
  const mockups = 'https://gemini.google.com/gem/custom-mockups?mode=image_creator';
  setCustomizationSource(() => ({
    links: {
      geminiPlanning: planning,
      geminiMockups: mockups
    }
  }));
  assert.equal(getJobStartUrl({ kind: 'analysis' }, 'gemini'), planning);
  assert.equal(getJobStartUrl({ kind: 'thumbnail' }, 'gemini'), mockups);
  assert.equal(findStudio('planning').url, planning);
  assert.equal(findStudio('mockups-gem').url, mockups);
  assert.equal(listGeminiStudios().find((item) => item.id === 'preview').url, DEFAULT_LINKS.geminiPreview);
  assert.equal(getProvider('gemini').startUrlFor('mockups'), mockups);
  assert.equal(getProvider('gemini').startUrlFor('text'), planning);
});

test('normalizeCustomization keeps Versa defaults out of storage and rejects bad links', () => {
  const normalized = normalizeCustomization({
    links: {
      geminiMockups: DEFAULT_LINKS.geminiMockups,
      geminiPreview: 'javascript:alert(1)',
      chatgptContent: 'https://chatgpt.com/g/my-gpt'
    },
    prompts: {
      previewVideo: DEFAULT_PROMPTS.previewVideo,
      analysisUrl: '  Look at {{productUrl}}  '
    }
  });
  assert.equal(normalized.links.geminiMockups, '');
  assert.equal(normalized.links.geminiPreview, '');
  assert.equal(normalized.links.chatgptContent, 'https://chatgpt.com/g/my-gpt');
  assert.equal(normalized.prompts.previewVideo, '');
  assert.equal(normalized.prompts.analysisUrl, 'Look at {{productUrl}}');
  assert.deepEqual(LINK_KEYS.slice().sort(), Object.keys(normalized.links).sort());
  assert.deepEqual(PROMPT_KEYS.slice().sort(), Object.keys(normalized.prompts).sort());
});

test('applyTemplate fills placeholders and leaves unknown tokens empty', () => {
  assert.equal(applyTemplate('Hello {{name}}', { name: 'Versa' }), 'Hello Versa');
  assert.equal(applyTemplate('Hello {{missing}}', {}), 'Hello');
});

test('Settings has a Customization tab with destination and prompt fields', () => {
  const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');
  const renderer = readFileSync(join(root, 'renderer/renderer.js'), 'utf8');
  assert.match(html, /data-settings-target="customization"/);
  assert.match(html, /data-settings-panel="customization"/);
  assert.match(html, />Customization</);
  assert.match(html, /Destination URLs/);
  assert.match(html, /Default prompts/);
  assert.match(html, /data-customization-link="geminiMockups"/);
  assert.match(html, /data-customization-link="chatgptMockups"/);
  assert.match(html, /data-customization-link="metaPages"/);
  assert.match(html, /data-customization-prompt="analysisUrl"/);
  assert.match(html, /data-customization-prompt="mazeTheme"/);
  assert.match(html, /data-customization-prompt="mockupThumbnail"/);
  assert.match(html, /data-customization-prompt="previewVideo"/);
  assert.match(html, /data-action="restore-customization-links"/);
  assert.match(html, /data-action="restore-customization-prompts"/);
  assert.match(renderer, /function collectCustomizationForm/);
  assert.match(renderer, /customization: collectCustomizationForm\(\)/);
  assert.match(renderer, /'customization'/);
});
