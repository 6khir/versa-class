'use strict';

const DEFAULT_LINKS = Object.freeze({
  geminiPlanning: 'https://gemini.google.com/gem/a825fb54b4cf',
  geminiPages: 'https://gemini.google.com/gem/a825fb54b4cf',
  geminiSeo: 'https://gemini.google.com/gem/1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG?usp=sharing',
  geminiMockups: 'https://gemini.google.com/gem/6d30d7350cbc?mode=image_creator',
  geminiPreview: 'https://gemini.google.com/gem/1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4?usp=sharing',
  chatgptContent: 'https://chatgpt.com/g/g-6a7edaa37a388191b56980c770c7a1ef-versa-tpt-book-creation',
  chatgptMockups: 'https://chatgpt.com/g/g-6a6f85e57f8c8191b0c05fcdad501783-tpt-winner-mockups-by-versa-class',
  chatgptSeo: 'https://chatgpt.com/g/g-678147a6a908819191c940b4dba2c6ec-tpt-title-seo-friendly',
  metaPages: 'https://www.meta.ai/',
  metaMockups: 'https://www.meta.ai/'
});

const LINK_KEYS = Object.freeze(Object.keys(DEFAULT_LINKS));

const LINK_FIELDS = Object.freeze([
  { key: 'geminiPlanning', group: 'gemini', label: 'Planning', hint: 'Planning gem.' },
  { key: 'geminiPages', group: 'gemini', label: 'Pages', hint: 'Pages gem.' },
  { key: 'geminiSeo', group: 'gemini', label: 'SEO', hint: 'SEO gem.' },
  { key: 'geminiMockups', group: 'gemini', label: 'Mockups', hint: 'Mockups gem.' },
  { key: 'geminiPreview', group: 'gemini', label: 'Preview', hint: 'Preview gem.' },
  { key: 'chatgptContent', group: 'chatgpt', label: 'Pages', hint: 'Pages GPT.' },
  { key: 'chatgptMockups', group: 'chatgpt', label: 'Mockups', hint: 'Mockups GPT.' },
  { key: 'chatgptSeo', group: 'chatgpt', label: 'SEO', hint: 'SEO GPT.' },
  { key: 'metaPages', group: 'meta', label: 'Pages', hint: 'Pages.' },
  { key: 'metaMockups', group: 'meta', label: 'Mockups', hint: 'Mockups.' }
]);

const DEFAULT_PROMPTS = Object.freeze({
  analysisUrl: [
    'Analyze the following competitor product URL and provide a comprehensive product concept analysis.',
    'Product URL to analyze: {{productUrl}}',
    '',
    '{{scrapedFacts}}',
    '{{visionLines}}',
    '{{pageCountDirective}}',
    '',
    'Do not generate images, mockups, or visual pages. Return text only.',
    'You MUST respond ONLY with a valid JSON object matching this exact schema (no markdown explanations before or after):',
    '{',
    '  "title": "Exact or refined book title",',
    '  "description": "Comprehensive summary of product concept and learning goals",',
    '  "targetAge": "Target age group or grade level (e.g. Preschool / Pre-K - Kindergarten)",',
    '  "keyHighlights": ["Highlight 1", "Highlight 2", "Highlight 3", "Highlight 4"],',
    '  "pageCount": {{pageCount}},',
    '  "productFormat": "maze", "editable", or "static" — "maze" if the listing is a maze/labyrinth book or the title/keyword contains maze. "editable" ONLY if it is explicitly sold as an editable/customizable resource (editable PowerPoint, editable Google Slides, fillable/typable fields). Otherwise "static".',
    '}'
  ].join('\n'),
  analysisIdea: [
    '# TPT PRODUCT IDEA GENERATOR — MASTER PROMPT',
    '',
    'You are an expert Teachers Pay Teachers (TPT) product strategist, curriculum resource designer, and educational product developer.',
    '',
    'Your task is to create ONE strong, practical, marketable, and classroom-appropriate TPT product concept based on the Category and Option selections provided below.',
    '',
    '## CORE INSTRUCTIONS',
    '',
    '1. Treat every provided Category and Option as a product requirement or preference.',
    '2. Combine all selected options into ONE coherent TPT product concept. Do not simply list the selections back to me.',
    '3. The final concept must make educational sense for the selected grade, subject, skill, resource type, activity, theme, audience, format, difficulty, and purpose.',
    '4. Categories are dynamic. Interpret any Category → Options pairs provided.',
    '5. Do NOT require categories that are missing. Choose the most appropriate option yourself when needed.',
    '6. If multiple Options are provided under one Category, intelligently combine them when compatible.',
    '7. If selected options conflict, prioritize: Educational appropriateness → Grade-level suitability → Learning objective → Resource usability → Commercial potential.',
    '8. Do not force incompatible selections into the product.',
    '9. Avoid generic product ideas. The concept should have a clear educational purpose, specific activities, and a strong reason to purchase.',
    '10. The product must be realistic to create and suitable for sale on Teachers Pay Teachers.',
    '11. Do not use copyrighted characters, brands, books, franchises, logos, or protected intellectual property unless explicitly authorized.',
    '',
    '{{userSelections}}',
    '',
    '## CRITICAL OUTPUT RULES',
    '',
    'Do not generate images, mockups, or visual pages. Return text only.',
    'After the full product concept, output ONE JSON object and nothing after it:',
    '{"title":"Final product title","description":"Short product concept summary","targetAge":"Target age or grade","keyHighlights":["Highlight 1","Highlight 2","Highlight 3"],"pageCount":12,"productFormat":"maze or editable or static"}',
    'pageCount must be the exact number of printable pages for this product.',
    '"productFormat" must be "maze" if the listing is a maze/labyrinth book or the title/keyword contains maze. "editable" ONLY if it is explicitly sold as an editable/customizable resource. Otherwise "static".'
  ].join('\n'),
  pagesSingle: [
    'Using the TPT product idea you created above, turn the concept into a complete page-by-page image prompt plan.',
    '',
    'NUMBER OF PAGES: 1',
    '',
    'PAGE SIZE: {{pageSize}}',
    '',
    'REQUIREMENTS:',
    '',
    '{{visionLines}}',
    '* Create exactly ONE standalone image-generation prompt for the single requested page. Do not add extra pages, covers, or concluding pages.',
    '* Do not generate images in this step. Return prompt text only.',
    '* Every prompt MUST strictly begin with the prefix "@image ".',
    '* The prompt must explicitly include the exact requested dimensions: {{pageSize}}.',
    '* Describe the complete printable page: layout, illustrations, exact on-page text in quotation marks, instructions, and activity elements.',
    '* Do not create mockups. The prompt must describe only the actual printable/digital page.',
    '',
    'OUTPUT FORMAT:',
    '',
    'Return ONLY the page prompt.',
    '',
    'Use this exact structure:',
    '',
    'Page 1: @image [complete visual description including dimensions]',
    '',
    'IMPORTANT:',
    'Return exactly one line. Never omit the @image prefix.'
  ].join('\n'),
  pagesPlan: [
    'Using the TPT product idea you created above, turn the concept into a complete page-by-page image prompt plan.',
    '',
    'NUMBER OF PAGES: {{pageCount}}',
    '',
    '{{batchLines}}',
    'PAGE SIZE: {{pageSize}}',
    '',
    'REQUIREMENTS:',
    '',
    '{{visionLines}}',
    '{{countDirective}}',
    '* Do not generate images in this step. Return prompt text only.',
    '* Every prompt MUST strictly begin with the prefix "@image ".',
    '* Label every prompt as Page K of {{pageCount}} with an explicit role. Page 1 of {{pageCount}} is the front cover. Pages 2 through {{lastInterior}} are interior worksheets. Page {{pageCount}} of {{pageCount}} is the back or closing page.',
    '* Do not tell the later image model to paint "Page K", "K of N", or any folio on the artwork. The K of N label is prompt metadata only.',
    '{{distributionDirective}}',
    '* Every page must have its own complete, standalone image-generation prompt.',
    '* Every prompt must explicitly include the exact requested dimensions: {{pageSize}}.',
    '* Keep the same visual style across ALL pages.',
    '* Do not create mockups. Each prompt must describe only the actual printable/digital page.',
    '',
    'OUTPUT FORMAT:',
    '',
    'Return ONLY the page prompts.',
    '',
    '{{stopLine}}',
    '{{importantLine}}'
  ].join('\n'),
  pagesContinuation: [
    'Continue the same Teachers Pay Teachers page-by-page image prompt plan from this conversation.',
    'The finished product has exactly {{pageCount}} pages.',
    '{{alreadyHaveLine}}',
    'Write pages {{startPage}} through {{endPage}} now ({{batchCount}} prompts). Then stop.',
    'Do not generate images. Return prompt text only.',
    'One prompt per line. Every line MUST start with the page label then @image.',
    'Use this structure: Page {{startPage}}: @image [complete visual description including {{pageSize}}]',
    'Keep the same visual style, dimensions, and original educational content as the earlier pages.',
    'Return exactly {{batchCount}} prompt lines and nothing else.'
  ].join('\n'),
  mazeTheme: [
    'You are the theme and art director for a printable maze activity book.',
    'You do not invent maze mathematics, grids, walls, paths, seeds, or topology.',
    'Return ONLY one JSON object. No markdown, no commentary.',
    '',
    'Allowed keys:',
    '{{allowedKeys}}',
    'Each pages[] item may use only:',
    '{{pagePlanKeys}}',
    '',
    'Keyword: {{keyword}}',
    'Age intent (choose one): {{ageChoices}}',
    'Suggested age intent: {{suggestedAge}} ({{suggestedAgeLabel}})',
    'Difficulty intent (choose one): {{difficultyChoices}}',
    'Suggested difficulty intent: {{suggestedDifficulty}} ({{suggestedDifficultyLabel}})',
    'Allowlisted start/end asset IDs: {{assetIds}}',
    'Page roles: {{pageRoles}}',
    'Frame variants (reuse a small coordinated set): {{frameVariants}}',
    '',
    'Rules:',
    '- Use ageIntent and difficultyIntent labels only. Never send rows, cols, seed, walls, cell size, or coordinates.',
    '- Suggest startAssetId and endAssetId only from the allowlist.',
    '- framePrompt describes outer-edge decoration only. It must not request letters, numbers, labels, logos, watermarks, maze lines, or objects in the central activity area.',
    '- Keep one consistent product theme. Reuse a few frame variants instead of a unique frame per page.',
    '- Page order uses sequenceIndex. Do not describe maze connectivity.'
  ].join('\n'),
  mazeFrame: [
    'Decorative page border, variant {{variant}}, for a {{theme}} classroom printable.',
    '{{framePrompt}}',
    '{{constraints}}'
  ].join(' '),
  mockupThumbnail: [
    'Create thumbnail {{thumbnailNumber}} of 4 for this Teachers Pay Teachers product.',
    'Product title: {{title}}.',
    'Creative direction: {{brief}}',
    '=== THE FOUR MOCKUPS RULES ===',
    'Rule for this specific thumbnail: {{specificRule}}',
    '{{coordination}}',
    '{{noCollage}}',
    '==============================',
    'The attached files are the REAL product: page images and/or a Word document of this book. Put those exact pages inside this Mockups Gem’s standard mockup frames.',
    'Do not invent pages. Do not remix, shuffle, or combine random pages from memory. Never treat attached pages as tiles in a collage.',
    'Render one listing thumbnail from the inner mockup templates using the attached book art.',
    'Generate an image of exactly one polished 2000x2000 TPT hero thumbnail now. No watermark. No variations. No questions.'
  ].join('\n'),
  mockupRetry: [
    'Generate Thumbnail {{thumbnailNumber}} now.',
    'Use this Mockups Gem’s built-in TPT mockup style and the attached real book pages or Word document.',
    '{{noCollage}}',
    'Generate an image of exactly one polished 2000x2000 TPT hero thumbnail now. No collage. No 2x2 grid. No watermark. No variations. No questions.'
  ].join('\n'),
  previewVideo: [
    'generate a preview video for this tpt product, best seller preview',
    '{{clipBrief}}',
    '{{clipLength}}'
  ].join('\n'),
  editableArtwork: [
    'Illustration of an educational activity page with decorative themed borders, illustrations,',
    'and empty blank frames. Clear, clean white negative space inside the boxes. Pure illustration',
    'only, completely blank inside the frames — no writing, no words, no letters, no numbers,',
    'no labels, no typography. High quality, print-ready 300 DPI layout, flat 2D graphic style',
    'suitable for a children\'s workbook page.',
    '',
    'PAGE TOPIC & THEME:',
    '{{pageCode}}: {{brief}}'
  ].join('\n'),
  editablePageText: [
    '{{pageCode}}: Here is a blank educational activity page layout. Look at the empty frames, boxes, and',
    'decorative theme in this image. Write the educational text — a title, brief instructions,',
    'and any questions or activity content — sized and structured to fit cleanly inside each',
    'visible blank frame. Match the tone and theme to the artwork shown. Return the text',
    'organized by frame/section (e.g., Title, Instructions, Question 1, Question 2), not as a',
    'single paragraph, so it can be placed into separate text boxes later.',
    '',
    'PAGE TOPIC & THEME: {{topic}}',
    '',
    'Return ONLY JSON with these keys:',
    '- title: main heading string',
    '- instruction: clear directions string',
    '- sections: array of the questions or activity items, one string per frame/section',
    '- footer: name/date/classroom string'
  ].join('\n')
});

const PROMPT_KEYS = Object.freeze(Object.keys(DEFAULT_PROMPTS));

const PROMPT_FIELDS = Object.freeze([
  { key: 'analysisUrl', group: 'analysis', label: 'URL analysis' },
  { key: 'analysisIdea', group: 'analysis', label: 'Idea generator' },
  { key: 'pagesSingle', group: 'pages', label: 'Single page' },
  { key: 'pagesPlan', group: 'pages', label: 'Multi page' },
  { key: 'pagesContinuation', group: 'pages', label: 'Continuation' },
  { key: 'mazeTheme', group: 'pages', label: 'Maze theme' },
  { key: 'mazeFrame', group: 'pages', label: 'Maze frame' },
  { key: 'editableArtwork', group: 'pages', label: 'Artwork wrapper' },
  { key: 'editablePageText', group: 'pages', label: 'Page text' },
  { key: 'mockupThumbnail', group: 'mockups', label: 'Mockup thumbnail' },
  { key: 'mockupRetry', group: 'mockups', label: 'Mockup retry' },
  { key: 'previewVideo', group: 'preview', label: 'Preview video' }
]);

let overrideSource = null;

function setCustomizationSource(fn) {
  overrideSource = typeof fn === 'function' ? fn : null;
}

function emptyCustomization() {
  return {
    links: Object.fromEntries(LINK_KEYS.map((key) => [key, ''])),
    prompts: Object.fromEntries(PROMPT_KEYS.map((key) => [key, '']))
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeCustomization(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const incomingLinks = source.links && typeof source.links === 'object' && !Array.isArray(source.links)
    ? source.links
    : source;
  const incomingPrompts = source.prompts && typeof source.prompts === 'object' && !Array.isArray(source.prompts)
    ? source.prompts
    : {};
  const links = {};
  for (const key of LINK_KEYS) {
    const value = String(incomingLinks[key] ?? '').trim();
    links[key] = isHttpUrl(value) && value !== DEFAULT_LINKS[key] ? value.slice(0, 2000) : '';
  }
  const prompts = {};
  for (const key of PROMPT_KEYS) {
    const value = normalizeText(incomingPrompts[key]).slice(0, 40_000);
    prompts[key] = value && value !== DEFAULT_PROMPTS[key] ? value : '';
  }
  return { links, prompts };
}

function readStoredCustomization() {
  try {
    const raw = typeof overrideSource === 'function' ? overrideSource() : null;
    return normalizeCustomization(raw || {});
  } catch {
    return emptyCustomization();
  }
}

function currentCustomization(stored) {
  if (stored && typeof stored === 'object') return normalizeCustomization(stored);
  return readStoredCustomization();
}

function resolveLink(key, stored) {
  if (!Object.hasOwn(DEFAULT_LINKS, key)) return '';
  const custom = currentCustomization(stored);
  const value = String(custom.links?.[key] || '').trim();
  return isHttpUrl(value) ? value : DEFAULT_LINKS[key];
}

function getResolvedLinks(stored) {
  const links = {};
  for (const key of LINK_KEYS) links[key] = resolveLink(key, stored);
  return links;
}

function getStoredPrompt(key, stored) {
  if (!Object.hasOwn(DEFAULT_PROMPTS, key)) return '';
  const custom = currentCustomization(stored);
  return normalizeText(custom.prompts?.[key] || '');
}

function applyTemplate(template, vars = {}) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const value = vars[name];
    return value == null ? '' : String(value);
  }).replace(/\n{3,}/g, '\n\n').trim();
}

function resolvePromptText(key, vars, fallbackFn, stored) {
  const override = getStoredPrompt(key, stored);
  if (override) return applyTemplate(override, vars || {});
  if (typeof fallbackFn === 'function') return fallbackFn();
  return applyTemplate(DEFAULT_PROMPTS[key] || '', vars || {});
}

function customizationDefaults() {
  return {
    links: { ...DEFAULT_LINKS },
    prompts: { ...DEFAULT_PROMPTS }
  };
}

function customizationCatalog() {
  return {
    links: LINK_FIELDS,
    prompts: PROMPT_FIELDS
  };
}

module.exports = {
  DEFAULT_LINKS,
  DEFAULT_PROMPTS,
  LINK_KEYS,
  LINK_FIELDS,
  PROMPT_KEYS,
  PROMPT_FIELDS,
  setCustomizationSource,
  emptyCustomization,
  isHttpUrl,
  normalizeCustomization,
  currentCustomization,
  resolveLink,
  getResolvedLinks,
  getStoredPrompt,
  applyTemplate,
  resolvePromptText,
  customizationDefaults,
  customizationCatalog
};
