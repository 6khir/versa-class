'use strict';

const { AGE_BANDS, ASSET_IDS, DIFFICULTY_PRESETS } = require('./maze-contract.cjs');
const { planMazePageDesign } = require('./maze-design.cjs');

const FILLER_WORD = /^(the|and|a|an|for|of|with|to|in|or|on|at|by|from|your|our|this|that|mazes?|puzzles?|puzzle|activity|activities|book|books|bundle|practice|printable|worksheets?|pages?|workbook|pack|set|unit|no|prep|fun|best|seller|digital|pdf|word|search)$/i;
const TITLE_PUN = /^(a-?maze-?ing|amazing)$/i;
const SEASONAL_TITLES = Object.freeze([
  'August Maze',
  'September Maze',
  'October Maze',
  'November Maze',
  'Winter Maze',
  'January Maze',
  'February Maze',
  'March Maze',
  'Spring Maze',
  'April Maze',
  'May Maze',
  'June Maze'
]);
const ASSET_PAIRS = Object.freeze([
  Object.freeze(['pencil', 'apple']),
  Object.freeze(['school_bus', 'school']),
  Object.freeze(['bee', 'flower']),
  Object.freeze(['rocket', 'planet'])
]);

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function looksLikeListingDump(value) {
  const text = cleanText(value, 400);
  if (!text) return false;
  return text.split(/\s+/).length > 4 || /activity book|bundle for the|word search activity/i.test(text);
}

function harvestBriefText(brief = {}) {
  const highlights = Array.isArray(brief.highlights) ? brief.highlights.join(' ') : '';
  return [
    brief.listingTitle,
    brief.listingDescription,
    brief.listingGrade,
    brief.title,
    brief.description,
    brief.targetAge,
    brief.keyword,
    highlights
  ].filter(Boolean).join(' ');
}

function mazeThemeKeyword(briefOrText) {
  const text = typeof briefOrText === 'string' ? briefOrText : harvestBriefText(briefOrText);
  const lower = text.toLowerCase();
  if (/year\s*[-–—]?\s*long|\bfor the year\b|\bof the year\b|\bthe year\b|every month|seasonal|seasons?|monthly/.test(lower)) return 'seasonal';
  if (/space|rocket|planet|solar/.test(lower)) return 'space';
  if (/\bbees?\b|honeycomb|garden/.test(lower)) return 'bees';
  if (/school bus|back to school|\bschool\b/.test(lower)) return 'school';
  const words = text
    .split(/[\s,&/:|]+/)
    .map((word) => word.replace(/[^A-Za-z0-9-]/g, ''))
    .filter((word) => word && !FILLER_WORD.test(word) && !TITLE_PUN.test(word));
  const picked = words.find((word) => word.length >= 4) || words[0] || 'classroom';
  return picked.slice(0, 22).toLowerCase();
}

function ageBandFromText(value, fallback = AGE_BANDS.kindergarten.id) {
  const lower = String(value || '').toLowerCase();
  if (/grades?\s*[6-8]|middle school|11[-–]14/.test(lower)) return 'grades_6_8';
  if (/grades?\s*[3-5]|upper elementary|8[-–]11/.test(lower)) return 'grades_3_5';
  if (/grades?\s*1|first.?second|grades_1_2|6[-–]8 year/.test(lower)) return 'grades_1_2';
  if (/kinder|5[-–]6|early learner/.test(lower)) return 'kindergarten';
  if (/pre-?k|preschool|3[-–]4/.test(lower)) return 'pre_k';
  return Object.hasOwn(AGE_BANDS, fallback) ? fallback : AGE_BANDS.kindergarten.id;
}

function assetPairsForKeyword(keyword) {
  if (keyword === 'space') {
    return [
      ['rocket', 'planet'],
      ['pencil', 'planet'],
      ['rocket', 'apple'],
      ['school_bus', 'planet']
    ];
  }
  if (keyword === 'bees') {
    return [
      ['bee', 'flower'],
      ['bee', 'apple'],
      ['flower', 'bee'],
      ['pencil', 'flower']
    ];
  }
  return ASSET_PAIRS;
}

function resolveAssetId(value, fallback) {
  return ASSET_IDS.includes(value) ? value : fallback;
}

function difficultyProgression(ageBand, count, startTier = null) {
  const age = AGE_BANDS[ageBand] || AGE_BANDS.kindergarten;
  const start = Number.isSafeInteger(startTier) && startTier >= 1 && startTier <= 5
    ? startTier
    : DIFFICULTY_PRESETS[age.defaultDifficulty].tier;
  const span = ageBand === 'pre_k' ? 0 : ageBand === 'kindergarten' ? 1 : 2;
  const max = Math.min(5, start + span);
  const total = Math.max(1, count);
  return Array.from({ length: total }, (_, index) => {
    if (total === 1) return start;
    return Math.max(1, Math.min(5, start + Math.round((index / (total - 1)) * (max - start))));
  });
}

function pageTitlesFromBrief(brief, count, keyword) {
  const text = harvestBriefText(brief);
  if (keyword === 'seasonal' || /year\s*[-–—]?\s*long|\bfor the year\b|\bof the year\b|every month|seasonal|monthly/.test(text)) {
    return Array.from({ length: count }, (_, index) => SEASONAL_TITLES[index % SEASONAL_TITLES.length]);
  }
  const label = String(keyword || 'Maze')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || 'Maze';
  return Array.from({ length: count }, (_, index) => `${label} Maze ${index + 1}`);
}

function planMazeBookFromBrief(brief = {}, pageCount = 8, existingConfig = {}) {
  const count = Math.max(1, Math.min(50, Number.parseInt(pageCount, 10) || 8));
  const keepKeyword = existingConfig.keyword && !looksLikeListingDump(existingConfig.keyword);
  const keyword = keepKeyword ? cleanText(existingConfig.keyword, 22) : mazeThemeKeyword(brief);
  const ageBand = Object.hasOwn(AGE_BANDS, existingConfig.ageBand) && !brief.forceAgeFromListing
    ? existingConfig.ageBand
    : ageBandFromText(brief.listingGrade || brief.targetAge || harvestBriefText(brief), existingConfig.ageBand);
  const startTier = Number.isSafeInteger(existingConfig.difficultyTier) ? existingConfig.difficultyTier : null;
  const tiers = difficultyProgression(ageBand, count, startTier);
  const titles = pageTitlesFromBrief(brief, count, keyword);
  const pairs = assetPairsForKeyword(keyword);
  const pages = titles.map((title, index) => {
    const pair = pairs[index % pairs.length];
    const startAssetId = resolveAssetId(pair[0], 'pencil');
    const endAssetId = resolveAssetId(pair[1], 'apple');
    const design = planMazePageDesign({
      title,
      keyword,
      sequenceIndex: index + 1
    });
    return {
      sequenceIndex: index + 1,
      title,
      instruction: `Find the ${endAssetId.replace(/_/g, ' ')}.`,
      startAssetId,
      endAssetId,
      difficultyTier: tiers[index],
      shape: design.shape,
      algorithm: design.algorithm,
      lattice: design.lattice
    };
  });
  const first = pages[0];
  return {
    config: {
      keyword,
      themeId: keyword,
      ageBand,
      difficultyTier: first.difficultyTier,
      startAssetId: first.startAssetId,
      endAssetId: first.endAssetId,
      title: first.title,
      instruction: first.instruction
    },
    pages
  };
}

function briefFromProject(project = {}, extra = {}) {
  const listing = project.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {};
  return {
    title: extra.title || project.name || project.theme || '',
    description: extra.description || project.description || project.niche || '',
    targetAge: extra.targetAge || project.targetAge || '',
    highlights: extra.highlights || project.highlights || [],
    listingTitle: extra.listingTitle || listing.title || '',
    listingDescription: extra.listingDescription || listing.description || '',
    listingGrade: extra.listingGrade || listing.grade || '',
    keyword: extra.keyword || '',
    forceAgeFromListing: extra.forceAgeFromListing === true
  };
}

module.exports = {
  SEASONAL_TITLES,
  ageBandFromText,
  briefFromProject,
  harvestBriefText,
  looksLikeListingDump,
  mazeThemeKeyword,
  planMazeBookFromBrief
};
