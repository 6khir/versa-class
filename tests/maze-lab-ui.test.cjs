'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const mazeLab = require('../renderer/maze-lab.js');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');

function selectBlock(id) {
  const match = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`));
  assert.ok(match, `${id} select is missing`);
  return match[0];
}

function optionValues(block) {
  return [...block.matchAll(/<option value="([^"]+)"/g)].map((item) => item[1]);
}

function fakeRoot(values) {
  const nodes = {};
  for (const [id, value] of Object.entries(values)) {
    const isCheck = typeof value === 'boolean';
    nodes[id] = {
      value: isCheck ? String(value) : value,
      checked: isCheck ? value : false,
      getAttribute() { return null; },
      classList: { contains: () => false }
    };
  }
  return { getElementById: (id) => nodes[id] || null };
}

test('Maze Lab HTML keeps Pages Lab controls and no Sample Lab', () => {
  assert.match(html, /data-stage="maze"/);
  assert.match(html, /data-workspace-section="maze"/);
  assert.match(html, /class="content-grid pages-lab"/);
  assert.match(html, /id="maze-pages-table"/);
  assert.match(html, /id="maze-detail-panel"/);
  assert.match(html, /id="maze-keyword"/);
  assert.match(html, /id="maze-age-band"/);
  assert.match(html, /id="maze-difficulty"/);
  assert.match(html, /id="maze-page-count"/);
  assert.match(html, /max="50"/);
  assert.match(html, /id="maze-include-answer-key"/);
  assert.match(html, /id="maze-start-asset"/);
  assert.match(html, /id="maze-end-asset"/);
  assert.match(html, /id="maze-seed"/);
  assert.match(html, /data-action="generate-maze"/);
  assert.match(html, /maze-lab-rail/);
  assert.match(html, /maze-lab-chrome/);
  assert.match(html, /maze-lab-toolbar/);
  assert.match(html, /data-market-stage="prompts"[^>]*>[\s\S]*?Generating</);
  assert.match(html, /data-action="cancel-maze"/);
  assert.match(html, /data-action="resume-maze"/);
  assert.match(html, /data-variant="student"/);
  assert.match(html, /data-variant="solution"/);
  assert.match(html, /data-action="copy-maze-seed"/);
  assert.match(html, /data-action="toggle-maze-seed-lock"/);
  assert.match(html, /data-action="reroll-maze-seed"/);
  assert.match(html, /data-action="regenerate-maze-page"/);
  assert.match(html, /data-action="delete-maze-page"/);
  assert.match(html, /id="maze-delete-page-button"/);
  assert.match(html, /data-action="delete-all-maze-pages"/);
  assert.match(html, /id="maze-delete-all-button"/);
  const mazeJs = readFileSync(join(root, 'renderer/maze-lab.js'), 'utf8');
  assert.match(mazeJs, /data-action="delete-maze-page"/);
  assert.match(mazeJs, /data-action="regenerate-maze-page"/);
  const mazeIpc = readFileSync(join(root, 'src/maze-ipc.cjs'), 'utf8');
  assert.match(mazeIpc, /maze:clear-all/);
  assert.match(mazeIpc, /clearMazePages/);
  assert.match(html, /data-view-target="thumbnails"/);
  assert.match(html, /data-view-target="preview"/);
  assert.doesNotMatch(html, /Sample Lab/);
});

test('difficulty options map to stable numeric tiers and icons stay allowlisted', () => {
  const difficulty = selectBlock('maze-difficulty');
  assert.deepEqual(optionValues(difficulty), ['1', '2', '3', '4', '5']);
  assert.match(difficulty, /value="1">Very Easy</);
  assert.match(difficulty, /value="5">Expert</);
  assert.deepEqual(optionValues(selectBlock('maze-start-asset')), [...mazeLab.MAZE_ASSET_IDS]);
  assert.deepEqual(optionValues(selectBlock('maze-end-asset')), [...mazeLab.MAZE_ASSET_IDS]);
});

test('collectMazeConfig reads Lab fields without calling a live provider', () => {
  const rootEl = fakeRoot({
    'maze-keyword': 'rockets',
    'maze-age-band': 'grades_1_2',
    'maze-difficulty': '4',
    'maze-start-asset': 'rocket',
    'maze-end-asset': 'planet',
    'maze-page-count': '12',
    'maze-include-answer-key': false
  });
  const config = mazeLab.collectMazeConfig(rootEl);
  const lab = mazeLab.collectMazeLab(rootEl);
  assert.equal(config.keyword, 'rockets');
  assert.equal(config.ageBand, 'grades_1_2');
  assert.equal(config.difficultyTier, 4);
  assert.equal(config.startAssetId, 'rocket');
  assert.equal(config.endAssetId, 'planet');
  assert.equal(lab.pageCount, 12);
  assert.equal(lab.includeAnswerKey, false);
});

test('student and solution preview URLs stay on the maze image protocol', () => {
  const page = {
    pageId: 'M01',
    seed: 'seed-1',
    render: { pngPreviewPath: '/tmp/m01.png', solutionSvgPath: '/tmp/m01.svg' }
  };
  const student = mazeLab.mazeImageSrc('book-1', page, 'student');
  const solution = mazeLab.mazeImageSrc('book-1', page, 'solution');
  assert.match(student, /^tpt-image:\/\/maze\/book-1\/M01\?variant=student/);
  assert.match(solution, /^tpt-image:\/\/maze\/book-1\/M01\?variant=solution/);
});

test('short maze keywords keep listing titles off the page header', () => {
  assert.equal(mazeLab.shortMazeKeyword('bees'), 'bees');
  assert.equal(
    mazeLab.shortMazeKeyword('Year-Long Word Search and Maze Puzzle Adventure BUNDLE'),
    'seasonal'
  );
  assert.equal(
    mazeLab.shortMazeKeyword('A-Maze-Ing Word Search Activity Book for the Year'),
    'seasonal'
  );
});

test('Maze Lab CSS paints paper cards instead of a washed canvas', () => {
  const css = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
  assert.match(css, /\[data-workspace-section="maze"\] #maze-pages-table \.page-preview-card \.page-visual/);
  assert.match(css, /\[data-workspace-section="maze"\] #maze-pages-table \.page-preview-card \.page-visual img/);
  assert.match(css, /\[data-workspace-section="maze"\] #maze-pages-table \.page-preview-card:not\(\.is-live\) \.page-fill-layer/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /maze-lab-chrome/);
  assert.match(css, /maze-lab-toolbar/);
  assert.match(css, /\[data-workspace-section="maze"\] \.maze-lab-rail \.concept-stage-rail/);
  assert.match(css, /\[data-workspace-section="maze"\] \.filter-tab\.is-active/);
});

test('maze project cards expose theme, age, difficulty, count, and date', () => {
  const meta = mazeLab.mazeProjectListMeta({
    theme: 'Space',
    updatedAt: '2026-09-12T00:00:00.000Z',
    mazeLab: { pageCount: 6 },
    mazeProject: {
      config: { keyword: 'rockets', ageBand: 'grades_1_2', difficultyTier: 3 },
      pages: [{ generationStatus: 'ready' }]
    }
  });
  assert.match(meta, /rockets/);
  assert.match(meta, /Grades 1–2/);
  assert.match(meta, /Medium/);
  assert.match(meta, /6 mazes/);
});
