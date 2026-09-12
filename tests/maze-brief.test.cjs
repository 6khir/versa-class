'use strict';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectStore } = require('../src/store.cjs');
const { generateMazeBook } = require('../src/maze-lab.cjs');
const {
  ageBandFromText,
  mazeThemeKeyword,
  planMazeBookFromBrief,
  looksLikeListingDump
} = require('../src/maze-brief.cjs');
const { extractTptListingFacts } = require('../src/tpt-listing-mockups.cjs');

test('listing dumps become a seasonal theme instead of A-Maze-Ing', () => {
  assert.equal(
    mazeThemeKeyword('A-Maze-Ing Word Search Activity Book for the Year'),
    'seasonal'
  );
  assert.equal(
    mazeThemeKeyword('Year-Long Word Search and Maze Puzzle Adventure BUNDLE'),
    'seasonal'
  );
  assert.equal(looksLikeListingDump('A-Maze-Ing Word Search Activity Book for the Year'), true);
  assert.equal(looksLikeListingDump('bees'), false);
});

test('age band reads early-learner and grade copy', () => {
  assert.equal(ageBandFromText('Engage early learners in kindergarten'), 'kindergarten');
  assert.equal(ageBandFromText('Grades 3-5'), 'grades_3_5');
  assert.equal(ageBandFromText('Pre-K and Preschool'), 'pre_k');
});

test('year-long brief plans unique seasonal titles and rising difficulty', () => {
  const planned = planMazeBookFromBrief({
    title: 'A-Maze-Ing Word Search Activity Book for the Year',
    description: 'Seasonal activity pages for every month of the school year.',
    targetAge: 'early learners',
    listingTitle: 'Word Search Puzzles and Maze Puzzles and Practice BUNDLE for the YEAR',
    forceAgeFromListing: true
  }, 8);
  assert.equal(planned.config.keyword, 'seasonal');
  assert.equal(planned.config.ageBand, 'kindergarten');
  assert.equal(planned.pages.length, 8);
  const titles = planned.pages.map((page) => page.title);
  assert.ok(!titles.some((title) => /A-Maze-Ing Word Search Activity Book/i.test(title)));
  assert.equal(new Set(titles).size, titles.length);
  assert.ok(planned.pages[0].title.includes('August') || planned.pages[0].title.includes('Maze'));
  assert.ok(planned.pages.some((page) => page.startAssetId !== planned.pages[0].startAssetId));
  assert.ok(planned.pages[planned.pages.length - 1].difficultyTier >= planned.pages[0].difficultyTier);
  const shapes = new Set(planned.pages.map((page) => page.shape));
  const algorithms = new Set(planned.pages.map((page) => page.algorithm));
  assert.ok(shapes.size >= 4, `expected seasonal shape variety, got ${[...shapes]}`);
  assert.ok(algorithms.size >= 3, `expected algorithm variety, got ${[...algorithms]}`);
});

test('scraped TPT HTML carries title, description, grade, and page count', () => {
  const html = `
    <title>Word Search Puzzles and Maze Puzzles | Teachers Pay Teachers</title>
    <meta property="og:title" content="Word Search Puzzles and Maze Puzzles and Practice BUNDLE for the YEAR">
    <meta property="og:description" content="A year-long maze and word search pack for Kindergarten. 48 pages.">
    <script type="application/ld+json">{"@type":"Product","name":"Word Search Puzzles and Maze Puzzles and Practice BUNDLE for the YEAR","description":"Monthly mazes for Kindergarten.","numberOfPages":48}</script>
  `;
  const facts = extractTptListingFacts(html, 'https://www.teacherspayteachers.com/Product/Word-Search-Puzzles-8296994');
  assert.match(facts.title, /Word Search Puzzles/);
  assert.match(facts.description, /year-long|Monthly mazes/i);
  assert.match(facts.grade, /Kindergarten/i);
  assert.equal(facts.pageCount, 48);
});

test('generateMazeBook uses the listing brief instead of cloning one easy maze', async () => {
  const root = mkdtempSync(join(tmpdir(), 'versa-maze-brief-'));
  const store = new ProjectStore(join(root, 'versa.sqlite'));
  try {
    store.createProject({
      id: 'maze-brief-1',
      name: 'A-Maze-Ing Word Search Activity Book for the Year',
      theme: 'A-Maze-Ing Word Search Activity Book for the Year',
      niche: 'Seasonal mazes for every month',
      format: 'letter',
      orientation: 'portrait',
      style: 'flat',
      activityCount: 0,
      outputDir: root,
      productFormat: 'maze',
      targetAge: 'early learners / Kindergarten',
      description: 'Engage early learners with seasonal maze pages for every month of the school year.',
      tptListing: {
        title: 'Word Search Puzzles and Maze Puzzles and Practice BUNDLE for the YEAR',
        description: 'Year-long maze and word-search practice for kindergarten.',
        grade: 'Kindergarten',
        productUrl: 'https://www.teacherspayteachers.com/Product/Word-Search-Puzzles-8296994'
      }
    });
    const generated = await generateMazeBook(store, 'maze-brief-1', {
      pageCount: 8,
      persistRender: false,
      skipArtwork: true,
      brief: {
        title: 'A-Maze-Ing Word Search Activity Book for the Year',
        description: 'Engage early learners with seasonal maze pages for every month of the school year.',
        targetAge: 'early learners / Kindergarten',
        listingTitle: 'Word Search Puzzles and Maze Puzzles and Practice BUNDLE for the YEAR',
        listingDescription: 'Year-long maze and word-search practice for kindergarten.',
        listingGrade: 'Kindergarten',
        forceAgeFromListing: true
      }
    });
    const pages = generated.mazeProject.pages;
    assert.equal(pages.length, 8);
    assert.equal(generated.mazeProject.config.keyword, 'seasonal');
    assert.ok(!/A-Maze-Ing Word Search Activity Book/i.test(generated.mazeProject.config.title));
    const titles = new Set(pages.map((page) => page.title));
    assert.equal(titles.size, 8);
    const assets = new Set(pages.map((page) => `${page.startAssetId}:${page.endAssetId}`));
    assert.ok(assets.size > 1);
    const tiers = pages.map((page) => page.difficultyTier);
    assert.ok(Math.max(...tiers) > Math.min(...tiers) || pages.length === 1);
    assert.ok(pages.every((page) => page.generationStatus === 'ready'));
    const shapes = new Set(pages.map((page) => page.topology?.shape));
    const algorithms = new Set(pages.map((page) => page.topology?.algorithm));
    const fingerprints = new Set(pages.map((page) => [
      page.topology?.shape,
      page.topology?.algorithm,
      page.topology?.lattice,
      page.topology?.design?.frameStyle,
      page.title
    ].join('|')));
    assert.ok(shapes.size >= 4, `expected generated shape variety, got ${[...shapes]}`);
    assert.ok(algorithms.size >= 3, `expected generated algorithm variety, got ${[...algorithms]}`);
    assert.equal(fingerprints.size, pages.length);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
