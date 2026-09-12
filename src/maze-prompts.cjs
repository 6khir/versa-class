'use strict';

const {
  AGE_BANDS,
  ASSET_IDS,
  DIFFICULTY_PRESETS,
  PAGE_ROLE_VALUES,
  PAGE_ROLES,
  difficultyPresetByTier
} = require('./maze-contract.cjs');
const { resolvePromptText } = require('./customization.cjs');

const DEFAULT_START_ASSET_ID = 'pencil';
const DEFAULT_END_ASSET_ID = 'apple';
const DEFAULT_THEME_ID = 'classroom';
const FRAME_VARIANT_IDS = Object.freeze(['edge-a', 'edge-b', 'edge-c']);
const MAZE_THEME_PROMPT_KIND = 'planning';
const MAZE_FRAME_JOB_KIND = 'maze_frame';

const THEME_RESPONSE_KEYS = Object.freeze([
  'themeId', 'ageIntent', 'difficultyIntent', 'startAssetId', 'endAssetId',
  'frameVariantId', 'framePrompt', 'title', 'instruction', 'pages'
]);
const PAGE_PLAN_KEYS = Object.freeze([
  'sequenceIndex', 'pageRole', 'title', 'instruction',
  'startAssetId', 'endAssetId', 'frameVariantId', 'framePrompt'
]);
const FORBIDDEN_THEME_KEYS = Object.freeze([
  'rows', 'cols', 'seed', 'walls', 'cellSize', 'wallThickness', 'iconSize',
  'horizontalWalls', 'verticalWalls', 'entrance', 'exit', 'topology',
  'generationSeed', 'mazePanel', 'minSolutionLength', 'minTurnCount',
  'minDeadEndCount', 'minEntranceExitDistance', 'maxRetries', 'difficultyTier',
  'solution', 'path', 'validationResult', 'rng', 'generationSpec',
  'algorithm', 'lattice', 'braidFactor', 'cellMask', 'hexWalls', 'radialWalls',
  'design', 'wallStyle', 'cellStyle', 'paletteId'
]);

const AGE_INTENT_ALIASES = Object.freeze({
  pre_k: Object.freeze(['pre_k', 'prek', 'preschool', 'prekindergarten', 'youngest']),
  kindergarten: Object.freeze(['kindergarten', 'kinder']),
  grades_1_2: Object.freeze(['grades_1_2', 'grade_1_2', 'first_second']),
  grades_3_5: Object.freeze(['grades_3_5', 'grade_3_5', 'upper_elementary']),
  grades_6_8: Object.freeze(['grades_6_8', 'grade_6_8', 'middle_school'])
});
const DIFFICULTY_INTENT_ALIASES = Object.freeze({
  very_easy: Object.freeze(['very_easy', 'beginner', 'simplest']),
  easy: Object.freeze(['easy', 'simple']),
  medium: Object.freeze(['medium', 'intermediate', 'normal']),
  hard: Object.freeze(['hard', 'challenging']),
  expert: Object.freeze(['expert', 'advanced'])
});

const FRAME_TEXT_TOKEN = /\b(letters?|numbers?|digits?|numerals?|labels?|logos?|signatures?|watermarks?|typography|writing|handwriting?|pseudo-?writing|words?|texts?|captions?|titles?|headings?|alphabet|typeface|fonts?|folio)\b/i;
const FRAME_CONSTRAINTS = Object.freeze([
  'Theme-specific decoration only near the outer edges of one printable activity page.',
  'Do not draw maze lines, paths, grids, walls, or puzzle topology.',
  'Do not draw letters, numbers, labels, logos, signatures, watermarks, or any pseudo-writing.',
  'No important objects in the large central activity area; keep that center empty.',
  'One consistent product theme for the whole book.'
]);

function normalizeIntent(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function sanitizeThemeId(value, fallback = DEFAULT_THEME_ID) {
  const raw = normalizeIntent(value).replace(/_/g, '-').replace(/^-+|-+$/g, '');
  if (/^[a-z0-9][a-z0-9.-]*$/.test(raw)) return raw.slice(0, 48);
  return fallback;
}

function resolveAgeIntent(value, fallback = AGE_BANDS.kindergarten.id) {
  const normalized = normalizeIntent(value);
  if (/^\d+$/.test(normalized)) return fallback;
  if (Object.hasOwn(AGE_BANDS, normalized)) return normalized;
  for (const [id, aliases] of Object.entries(AGE_INTENT_ALIASES)) {
    if (aliases.includes(normalized)) return id;
  }
  return fallback;
}

function resolveDifficultyIntent(value, ageBand) {
  const age = AGE_BANDS[ageBand] || AGE_BANDS.kindergarten;
  const fallback = age.defaultDifficulty;
  const normalized = normalizeIntent(value);
  if (!normalized || /^\d+$/.test(normalized)) return fallback;
  if (Object.hasOwn(DIFFICULTY_PRESETS, normalized)) return normalized;
  for (const [id, aliases] of Object.entries(DIFFICULTY_INTENT_ALIASES)) {
    if (aliases.includes(normalized)) return id;
  }
  return fallback;
}

function resolveThemeAssetId(value, fallback) {
  if (typeof value === 'string' && ASSET_IDS.includes(value)) return value;
  return fallback;
}

function resolveFrameVariantId(value, pageRole = PAGE_ROLES.MAZE_INTERIOR, sequenceIndex = 1) {
  if (FRAME_VARIANT_IDS.includes(value)) return value;
  if (pageRole === PAGE_ROLES.COVER) return FRAME_VARIANT_IDS[0];
  if (pageRole === PAGE_ROLES.ANSWER_KEY) return FRAME_VARIANT_IDS[1];
  if (pageRole === PAGE_ROLES.BACK_COVER) return FRAME_VARIANT_IDS[2];
  const index = Math.max(1, Number.parseInt(sequenceIndex, 10) || 1) - 1;
  return FRAME_VARIANT_IDS[index % FRAME_VARIANT_IDS.length];
}

function resolvePageRole(value, fallback = PAGE_ROLES.MAZE_INTERIOR) {
  return PAGE_ROLE_VALUES.includes(value) ? value : fallback;
}

function cleanCopy(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultFrameDecoration(themeId = DEFAULT_THEME_ID) {
  return `${sanitizeThemeId(themeId)} themed decoration only near the outer edges.`;
}

function stripFramePromptText(value) {
  const text = cleanCopy(value)
    .replace(/["“”'][^"“”']{0,80}["“”']/g, ' ')
    .replace(/\b[A-Z]{2,}\b/g, ' ')
    .replace(/\b\d+\b/g, ' ');
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() && !FRAME_TEXT_TOKEN.test(sentence))
    .join(' ')
    .replace(FRAME_TEXT_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return kept;
}

function sanitizeFramePrompt(value, themeId = DEFAULT_THEME_ID) {
  const stripped = stripFramePromptText(value);
  if (!stripped || FRAME_TEXT_TOKEN.test(stripped)) {
    return { prompt: defaultFrameDecoration(themeId), rejected: true, stripped: '' };
  }
  return { prompt: stripped, rejected: false, stripped };
}

function buildMazeFrameImagePrompt({ themeId, frameVariantId, pageRole, framePrompt } = {}) {
  const theme = sanitizeThemeId(themeId);
  const variant = resolveFrameVariantId(frameVariantId, pageRole);
  const sanitized = sanitizeFramePrompt(framePrompt, theme);
  return resolvePromptText('mazeFrame', {
    variant,
    theme,
    framePrompt: sanitized.prompt,
    constraints: FRAME_CONSTRAINTS.join(' ')
  }, () => [
    `Decorative page border, variant ${variant}, for a ${theme} classroom printable.`,
    sanitized.prompt,
    ...FRAME_CONSTRAINTS
  ].join(' '));
}

function extractJsonObject(text) {
  const start = String(text || '').indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseMazeThemeJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') {
    throw Object.assign(new Error('Maze theme response was not JSON.'), { code: 'MAZE_THEME_JSON_INVALID' });
  }
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object.');
    }
    return parsed;
  } catch (error) {
    const candidate = extractJsonObject(cleaned);
    if (!candidate) {
      throw Object.assign(new Error('Maze theme response was not valid JSON.'), {
        code: 'MAZE_THEME_JSON_INVALID',
        cause: error
      });
    }
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('Maze theme response was not a JSON object.'), {
        code: 'MAZE_THEME_JSON_INVALID'
      });
    }
    return parsed;
  }
}

function pickAllowed(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const picked = {};
  for (const key of allowed) {
    if (Object.hasOwn(value, key)) picked[key] = value[key];
  }
  return picked;
}

function mapPlannedPage(raw, index, fallback) {
  const picked = pickAllowed(raw, PAGE_PLAN_KEYS);
  const sequenceIndex = Number.isSafeInteger(picked.sequenceIndex) && picked.sequenceIndex > 0
    ? picked.sequenceIndex
    : index + 1;
  const pageRole = resolvePageRole(picked.pageRole, fallback.pageRole || PAGE_ROLES.MAZE_INTERIOR);
  return {
    sequenceIndex,
    pageRole,
    title: cleanCopy(picked.title ?? ''),
    instruction: cleanCopy(picked.instruction ?? ''),
    startAssetId: resolveThemeAssetId(picked.startAssetId, fallback.startAssetId),
    endAssetId: resolveThemeAssetId(picked.endAssetId, fallback.endAssetId),
    frameVariantId: resolveFrameVariantId(picked.frameVariantId, pageRole, sequenceIndex),
    framePrompt: sanitizeFramePrompt(picked.framePrompt, fallback.themeId).prompt
  };
}

function fallbackMazeTheme(input = {}, reason = 'fallback') {
  const ageBand = resolveAgeIntent(input.ageIntent ?? input.ageBand, AGE_BANDS.kindergarten.id);
  const difficultyId = resolveDifficultyIntent(input.difficultyIntent, ageBand);
  const preset = DIFFICULTY_PRESETS[difficultyId];
  const themeId = sanitizeThemeId(input.themeId || input.keyword, DEFAULT_THEME_ID);
  const frame = sanitizeFramePrompt(input.framePrompt, themeId);
  return {
    themeId,
    ageBand,
    difficultyId,
    difficultyTier: preset.tier,
    startAssetId: resolveThemeAssetId(input.startAssetId, DEFAULT_START_ASSET_ID),
    endAssetId: resolveThemeAssetId(input.endAssetId, DEFAULT_END_ASSET_ID),
    frameVariantId: resolveFrameVariantId(input.frameVariantId, PAGE_ROLES.MAZE_INTERIOR, 1),
    framePrompt: frame.prompt,
    title: cleanCopy(input.title ?? ''),
    instruction: cleanCopy(input.instruction ?? ''),
    pages: [],
    fallback: true,
    reason
  };
}

function mapMazeThemeResponse(raw, input = {}) {
  let parsed;
  try {
    parsed = parseMazeThemeJson(raw);
  } catch {
    return fallbackMazeTheme(input, 'malformed_json');
  }
  const picked = pickAllowed(parsed, THEME_RESPONSE_KEYS);
  const ageBand = resolveAgeIntent(
    picked.ageIntent ?? input.ageIntent ?? input.ageBand,
    AGE_BANDS.kindergarten.id
  );
  const difficultyId = resolveDifficultyIntent(
    picked.difficultyIntent ?? input.difficultyIntent,
    ageBand
  );
  const preset = DIFFICULTY_PRESETS[difficultyId];
  const themeId = sanitizeThemeId(picked.themeId || input.themeId || input.keyword, DEFAULT_THEME_ID);
  const startAssetId = resolveThemeAssetId(picked.startAssetId, resolveThemeAssetId(input.startAssetId, DEFAULT_START_ASSET_ID));
  const endAssetId = resolveThemeAssetId(picked.endAssetId, resolveThemeAssetId(input.endAssetId, DEFAULT_END_ASSET_ID));
  const frame = sanitizeFramePrompt(picked.framePrompt ?? input.framePrompt, themeId);
  const pageFallback = {
    themeId,
    startAssetId,
    endAssetId,
    pageRole: PAGE_ROLES.MAZE_INTERIOR
  };
  const pages = Array.isArray(picked.pages)
    ? picked.pages
      .filter((page) => page && typeof page === 'object' && !Array.isArray(page))
      .map((page, index) => mapPlannedPage(page, index, pageFallback))
      .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
    : [];
  return {
    themeId,
    ageBand,
    difficultyId,
    difficultyTier: preset.tier,
    startAssetId,
    endAssetId,
    frameVariantId: resolveFrameVariantId(picked.frameVariantId, PAGE_ROLES.MAZE_INTERIOR, 1),
    framePrompt: frame.prompt,
    title: cleanCopy(picked.title ?? input.title ?? ''),
    instruction: cleanCopy(picked.instruction ?? input.instruction ?? ''),
    pages,
    fallback: false,
    reason: null
  };
}

function mazeConfigPatchFromTheme(mapped) {
  return {
    ageBand: mapped.ageBand,
    difficultyTier: mapped.difficultyTier,
    startAssetId: mapped.startAssetId,
    endAssetId: mapped.endAssetId,
    themeId: mapped.themeId,
    frameVariantId: mapped.frameVariantId,
    framePrompt: mapped.framePrompt,
    title: mapped.title,
    instruction: mapped.instruction
  };
}

function applyMazePagePlan(pages, plannedPages, themeId) {
  const list = Array.isArray(pages) ? pages : [];
  const planned = Array.isArray(plannedPages) ? plannedPages : [];
  const byIndex = new Map(planned.map((page) => [page.sequenceIndex, page]));
  return [...list]
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
    .map((page) => {
      const plan = byIndex.get(page.sequenceIndex);
      if (!plan) {
        return themeId ? { ...page, themeId } : page;
      }
      return {
        ...page,
        themeId: themeId || page.themeId,
        pageRole: plan.pageRole || page.pageRole,
        title: plan.title || page.title,
        instruction: plan.instruction || page.instruction,
        startAssetId: plan.startAssetId || page.startAssetId,
        endAssetId: plan.endAssetId || page.endAssetId,
        frameVariantId: plan.frameVariantId || page.frameVariantId,
        framePrompt: plan.framePrompt || page.framePrompt
      };
    });
}

function ageIntentLabel(ageBand) {
  return AGE_BANDS[ageBand]?.label || AGE_BANDS.kindergarten.label;
}

function difficultyIntentLabel(tierOrId) {
  if (typeof tierOrId === 'number') return difficultyPresetByTier(tierOrId)?.label || 'Easy';
  return DIFFICULTY_PRESETS[tierOrId]?.label || 'Easy';
}

function suggestedDifficultyId(input, ageBand) {
  if (input.difficultyIntent) return resolveDifficultyIntent(input.difficultyIntent, ageBand);
  if (Number.isSafeInteger(input.difficultyTier)) {
    const preset = difficultyPresetByTier(input.difficultyTier);
    if (preset) return preset.id;
  }
  return resolveDifficultyIntent(undefined, ageBand);
}

function buildMazeThemePrompt(input = {}) {
  const ageBand = resolveAgeIntent(input.ageIntent ?? input.ageBand, AGE_BANDS.kindergarten.id);
  const difficultyId = suggestedDifficultyId(input, ageBand);
  const keyword = cleanCopy(input.keyword || 'classroom');
  return resolvePromptText('mazeTheme', {
    allowedKeys: JSON.stringify(THEME_RESPONSE_KEYS),
    pagePlanKeys: JSON.stringify(PAGE_PLAN_KEYS),
    keyword,
    ageChoices: Object.values(AGE_BANDS).map((band) => band.id).join(', '),
    suggestedAge: ageBand,
    suggestedAgeLabel: ageIntentLabel(ageBand),
    difficultyChoices: Object.keys(DIFFICULTY_PRESETS).join(', '),
    suggestedDifficulty: difficultyId,
    suggestedDifficultyLabel: difficultyIntentLabel(difficultyId),
    assetIds: ASSET_IDS.join(', '),
    pageRoles: PAGE_ROLE_VALUES.join(', '),
    frameVariants: FRAME_VARIANT_IDS.join(', ')
  }, () => [
    'You are the theme and art director for a printable maze activity book.',
    'You do not invent maze mathematics, grids, walls, paths, seeds, or topology.',
    'Return ONLY one JSON object. No markdown, no commentary.',
    '',
    'Allowed keys:',
    JSON.stringify(THEME_RESPONSE_KEYS),
    'Each pages[] item may use only:',
    JSON.stringify(PAGE_PLAN_KEYS),
    '',
    `Keyword: ${keyword}`,
    `Age intent (choose one): ${Object.values(AGE_BANDS).map((band) => band.id).join(', ')}`,
    `Suggested age intent: ${ageBand} (${ageIntentLabel(ageBand)})`,
    `Difficulty intent (choose one): ${Object.keys(DIFFICULTY_PRESETS).join(', ')}`,
    `Suggested difficulty intent: ${difficultyId} (${difficultyIntentLabel(difficultyId)})`,
    `Allowlisted start/end asset IDs: ${ASSET_IDS.join(', ')}`,
    `Page roles: ${PAGE_ROLE_VALUES.join(', ')}`,
    `Frame variants (reuse a small coordinated set): ${FRAME_VARIANT_IDS.join(', ')}`,
    '',
    'Rules:',
    '- Use ageIntent and difficultyIntent labels only. Never send rows, cols, seed, walls, cell size, or coordinates.',
    '- Suggest startAssetId and endAssetId only from the allowlist.',
    '- framePrompt describes outer-edge decoration only. It must not request letters, numbers, labels, logos, watermarks, maze lines, or objects in the central activity area.',
    '- Keep one consistent product theme. Reuse a few frame variants instead of a unique frame per page.',
    '- Page order uses sequenceIndex. Do not describe maze connectivity.'
  ].join('\n'));
}

module.exports = {
  DEFAULT_START_ASSET_ID,
  DEFAULT_END_ASSET_ID,
  DEFAULT_THEME_ID,
  FRAME_VARIANT_IDS,
  FRAME_CONSTRAINTS,
  FORBIDDEN_THEME_KEYS,
  THEME_RESPONSE_KEYS,
  MAZE_THEME_PROMPT_KIND,
  MAZE_FRAME_JOB_KIND,
  sanitizeThemeId,
  resolveAgeIntent,
  resolveDifficultyIntent,
  resolveThemeAssetId,
  resolveFrameVariantId,
  sanitizeFramePrompt,
  stripFramePromptText,
  defaultFrameDecoration,
  buildMazeThemePrompt,
  buildMazeFrameImagePrompt,
  parseMazeThemeJson,
  mapMazeThemeResponse,
  fallbackMazeTheme,
  mazeConfigPatchFromTheme,
  applyMazePagePlan
};
