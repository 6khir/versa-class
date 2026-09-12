const { randomUUID } = require('node:crypto');
const { resolveListingAnalysisInput } = require('./tpt-listing-mockups.cjs');
const { DEFAULT_LINKS, resolvePromptText } = require('./customization.cjs');

const ACTIVITIES = [
  'trace and write worksheet with large guide lines and simple icons',
  'cut and paste sorting activity with clear dashed cutting lines',
  'count and match worksheet with big objects and answer-friendly layout',
  'color by number page with simple preschool-friendly shapes',
  'maze activity page with clear start and finish markers',
  'I Spy visual search page with counting boxes',
  'shadow matching worksheet with large simple silhouettes',
  'pattern completion page with repeating AB and ABC patterns',
  'same and different visual discrimination worksheet',
  'beginning sounds phonics activity with picture choices',
  'alphabet tracing and recognition worksheet',
  'number tracing and counting worksheet',
  'shape matching and coloring worksheet',
  'dot marker activity page with big circles',
  'scissor skills path tracing and cutting page',
  'picture puzzle cut and assemble activity',
  'creative drawing prompt page with a large blank area',
  'write and draw response page with a simple sentence starter',
  'graphing and tally marks activity page',
  'logic grid matching activity for young learners',
  'find and color hidden objects worksheet',
  'fine motor line tracing practice page',
  'vocabulary labeling worksheet with a word bank',
  'memory match card printable page',
  'classroom poster or anchor chart page',
  'reward certificate page with a blank name line',
  'mini book page with fold and cut guides',
  'bingo board printable activity page',
  'roll and color dice game worksheet',
  'odd one out visual activity page',
  'measurement comparison worksheet',
  'symmetry drawing worksheet',
  'simple addition activity page',
  'simple subtraction activity page',
  'word search puzzle page with large letters'
];

const FORMAT_INSTRUCTIONS = {
  A4: {
    portrait: 'A4 portrait page (210 × 297 mm). Use a 1:1.414 portrait composition with safe print margins.',
    landscape: 'A4 landscape page (297 × 210 mm). Use a 1.414:1 landscape composition with safe print margins.'
  },
  LETTER: {
    portrait: 'US Letter portrait page (8.5 × 11 in). Use an 8.5:11 portrait composition with safe print margins.',
    landscape: 'US Letter landscape page (11 × 8.5 in). Use an 11:8.5 landscape composition with safe print margins.'
  },
  SQUARE: {
    portrait: 'Square 1:1 page with safe print margins.',
    landscape: 'Square 1:1 page with safe print margins.'
  }
};

function normalizeOrientation(value) {
  return value === 'landscape' ? 'landscape' : 'portrait';
}

function formatInstruction(format, orientation = 'portrait') {
  const selectedFormat = FORMAT_INSTRUCTIONS[format] ? format : 'A4';
  return FORMAT_INSTRUCTIONS[selectedFormat][normalizeOrientation(orientation)];
}

function cleanText(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function ensureImagePrefix(prompt) {
  const text = String(prompt ?? '').trim();
  if (!text) return text;
  if (/^@images?\b/i.test(text)) return text.replace(/^@images?\s*/i, '@image ');
  return `@image ${text}`;
}


/** Literal stubs left by skipped Extra Fields / incomplete listing drafts — not real SEO. */
function isSeoSkipStub(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return text === 'skipped'
    || text === 'skipped description'
    || text === 'skipped tags'
    || text === 'n/a'
    || text === 'na'
    || text === 'none';
}

function sanitizeSeoListingFields(listing = {}) {
  const titleRaw = cleanText(listing.title);
  const title = isSeoSkipStub(titleRaw) ? '' : titleRaw;
  const descriptionRaw = cleanText(listing.description);
  const description = isSeoSkipStub(descriptionRaw) ? '' : descriptionRaw;
  let tags;
  if (Array.isArray(listing.tags)) {
    tags = listing.tags.map((entry) => cleanText(entry)).filter((entry) => entry && !isSeoSkipStub(entry));
  } else {
    const rawTags = cleanText(listing.tags);
    tags = (!rawTags || isSeoSkipStub(rawTags))
      ? []
      : rawTags.split(/,|\n/).map((entry) => cleanText(entry)).filter((entry) => entry && !isSeoSkipStub(entry));
  }
  const next = { ...listing, title, description, tags };
  if (Array.isArray(listing.subjects)) {
    next.subjects = listing.subjects
      .map((entry) => cleanText(entry))
      .filter((entry) => entry && !isSeoSkipStub(entry));
  }
  return next;
}

function formatSeoBundleText(listing = {}) {
  const cleaned = sanitizeSeoListingFields(listing);
  const title = cleanText(cleaned.title);
  const description = cleanText(cleaned.description);
  const tags = Array.isArray(cleaned.tags)
    ? cleaned.tags.map((entry) => cleanText(entry)).filter(Boolean).join(', ')
    : cleanText(cleaned.tags);
  if (!title && !description && !tags) return '';
  return [
    `TITLE\n${title}`,
    `DESCRIPTION\n${description}`,
    `TAGS\n${tags}`
  ].join('\n\n').trim();
}

function parseSeoBundleText(rawText = '') {
  const raw = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { title: '', description: '', tags: '' };

  const headerMatch = /^(TITLE|DESCRIPTION|TAGS)\s*$/im;
  const looksLabeled = headerMatch.test(raw.split('\n', 1)[0] || '')
    || /\n(?:TITLE|DESCRIPTION|TAGS)\s*\n/i.test(raw);
  if (looksLabeled) {
    const result = { title: '', description: '', tags: '' };
    let current = null;
    for (const line of raw.split('\n')) {
      const header = line.trim().toUpperCase();
      if (header === 'TITLE' || header === 'DESCRIPTION' || header === 'TAGS') {
        current = header.toLowerCase();
        continue;
      }
      if (!current) continue;
      result[current] = result[current] ? `${result[current]}\n${line}` : line;
    }
    return {
      title: result.title.trim(),
      description: result.description.trim(),
      tags: result.tags.trim()
    };
  }

  const blocks = raw.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length === 1) return { title: blocks[0], description: '', tags: '' };
  if (blocks.length === 2) return { title: blocks[0], description: blocks[1], tags: '' };
  const tagsBlock = blocks[blocks.length - 1].replace(/^tags?:\s*/i, '').trim();
  return {
    title: blocks[0],
    description: blocks.slice(1, -1).join('\n\n').trim(),
    tags: tagsBlock
  };
}

function slugify(value, fallback = 'tpt-book') {
  const slug = cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function padPage(number) {
  return String(number).padStart(3, '0');
}

function splitPromptBlocks(value, mode = 'line') {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  if (mode === 'blank') {
    return text.split(/\n[\t ]*\n+/g).map((prompt) => prompt.trim()).filter(Boolean);
  }
  return text.split(/\n+/g).map((prompt) => prompt.trim()).filter(Boolean);
}

function promptTitle(prompt, index) {
  const summary = String(prompt).replace(/\s+/g, ' ').trim().slice(0, 74);
  return summary ? `Prompt ${index + 1}: ${summary}` : `Prompt ${index + 1}`;
}

function buildImportedJobs(input) {
  const { blankFileName } = require('./text-overlay-layout.cjs');
  const { normalizeTextOverlays } = require('./text-overlay-layout.cjs');
  const promptSplitMode = input.promptSplitMode === 'blank' ? 'blank' : 'line';
  const projectToken = cleanText(input.projectToken, randomUUID().split('-')[0]).toUpperCase();

  // New JSON blueprint path: pages with imagePrompt + textOverlays
  if (Array.isArray(input.pages) && input.pages.length) {
    const jobs = input.pages.map((page, index) => {
      const pageNumber = Number(page.pageNumber) || (index + 1);
      const imagePrompt = ensureImagePrefix(cleanPromptSection(page.imagePrompt || page.prompt || ''));
      const textOverlays = normalizeTextOverlays(page.textOverlays);
      return {
        id: randomUUID(),
        pageNumber,
        pageLabel: `${projectToken}-P${padPage(pageNumber)}`,
        kind: 'custom',
        title: promptTitle(imagePrompt, index),
        prompt: imagePrompt,
        imagePrompt,
        textOverlays,
        fileName: blankFileName(pageNumber),
        status: 'pending',
        attempts: 0
      };
    });
    return {
      normalized: { promptCount: jobs.length, promptSplitMode: 'blueprint', projectToken, blueprint: true },
      jobs
    };
  }

  const prompts = splitPromptBlocks(input.promptsText, promptSplitMode);
  if (!prompts.length) {
    throw Object.assign(new Error('Paste at least one prompt to create the queue.'), { code: 'NO_PROMPTS' });
  }
  if (prompts.length > 500) {
    throw Object.assign(new Error('A single book can contain up to 500 prompts.'), { code: 'TOO_MANY_PROMPTS' });
  }
  const jobs = prompts.map((prompt, index) => {
    const pageNumber = index + 1;
    return {
      id: randomUUID(),
      pageNumber,
      pageLabel: `${projectToken}-P${padPage(pageNumber)}`,
      kind: 'custom',
      title: promptTitle(prompt, index),
      prompt,
      imagePrompt: prompt,
      textOverlays: [],
      fileName: blankFileName(pageNumber),
      status: 'pending',
      attempts: 0
    };
  });
  return {
    normalized: { promptCount: prompts.length, promptSplitMode, projectToken },
    jobs
  };
}

function sharedStyle({ theme, niche, format, orientation, style }) {
  return [
    formatInstruction(format, orientation),
    `Theme: ${theme}. Educational niche: ${niche}.`,
    `Visual system: ${style}.`,
    'Premium Teachers Pay Teachers printable quality.',
    'Use a white background, clean margins, bold readable headings, consistent kid-friendly vector artwork and classroom-ready spacing.',
    'Keep the same illustration language, line weight, color palette and margin system across the entire book.',
    'No watermark, no brand logos, no mockup scene, no tiny text and no cropped content.',
    'Standard book page: Do not ask for or require reference images, attached files, or external image inputs. Generate the complete printable page image directly.',
    'Return one finished printable page only.'
  ].join('\n');
}

function isExplicitlyRequested(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'on';
}

function buildBookJobs(input) {
  const theme = cleanText(input.theme, 'Preschool learning');
  const niche = cleanText(input.niche, 'preschool worksheet');
  const style = cleanText(input.style, 'friendly modern classroom vectors, warm primary colors, thick clean outlines');
  const format = FORMAT_INSTRUCTIONS[input.format] ? input.format : 'A4';
  const orientation = normalizeOrientation(input.orientation);
  const activityCount = Math.max(1, Math.min(100, Number.parseInt(input.activityCount, 10) || 5));
  const requestedTotal = Number.parseInt(input.totalPageCount ?? input.pageCount, 10);
  const totalPageCount = Number.isFinite(requestedTotal) && requestedTotal > 0
    ? Math.min(102, requestedTotal)
    : null;
  const isSingleRequestedPage = activityCount === 1 || totalPageCount === 1;
  const includeCover = isSingleRequestedPage
    ? isExplicitlyRequested(input.includeCover)
    : !isExplicitlyRequested(input.skipCover);
  const includeThankYou = false; // VERSA editable-brain: thank-you page permanently removed
  const base = sharedStyle({ theme, niche, format, orientation, style });
  const projectToken = cleanText(input.projectToken, randomUUID().split('-')[0]).toUpperCase();
  const jobs = [];

  const pushJob = ({ kind, title, body, fileStem }) => {
    const pageNumber = jobs.length + 1;
    const pageLabel = `${projectToken}-P${padPage(pageNumber)}`;
    jobs.push({
      id: randomUUID(),
      pageNumber,
      pageLabel,
      kind,
      title,
      prompt: ensureImagePrefix([
        `Book production reference: ${pageLabel}. Do not print or render this reference on the page.`,
        body,
        base
      ].join('\n\n')),
      fileName: `${padPage(pageNumber)}_${fileStem}.png`,
      status: 'pending',
      attempts: 0
    });
  };

  if (includeCover) {
    pushJob({
      kind: 'cover',
      title: 'Cover',
      fileStem: 'cover',
      body: `Create the premium front cover for a printable workbook about ${theme}. Include a strong title area, a clear subtitle area and a balanced group of matching educational icons. Do not include activity instructions on the cover.`
    });
  }

  const activityPages = isSingleRequestedPage && totalPageCount === 1 && !includeCover && !includeThankYou
    ? 1
    : activityCount;
  for (let index = 0; index < activityPages; index += 1) {
    const activity = ACTIVITIES[index % ACTIVITIES.length];
    pushJob({
      kind: 'activity',
      title: `Activity ${index + 1}: ${activity}`,
      fileStem: `activity_${String(index + 1).padStart(2, '0')}`,
      body: `Create activity page ${index + 1} of ${activityPages}: a ${activity} about ${theme}. Include one short, readable instruction, large activity elements, age-appropriate difficulty and enough whitespace for students to answer. Ensure the educational task is logically solvable.`
    });
  }

  if (includeThankYou) {
    pushJob({
      kind: 'thank_you',
      title: 'Thank You',
      fileStem: 'thank_you',
      body: `Create the final thank-you page for a printable workbook about ${theme}. Include a large “Thank You!” heading, a friendly teacher note area and a small set of matching icons. Keep the center readable and uncluttered.`
    });
  }

  if (totalPageCount && jobs.length > totalPageCount) {
    jobs.length = totalPageCount;
    jobs.forEach((job, index) => {
      job.pageNumber = index + 1;
      job.pageLabel = `${projectToken}-P${padPage(index + 1)}`;
      job.fileName = `${padPage(index + 1)}_${String(job.fileName).replace(/^\d+_/, '')}`;
    });
  }

  return {
    normalized: { theme, niche, style, format, orientation, activityCount, projectToken },
    jobs
  };
}

const STANDARD_GEMINI_URL = 'https://gemini.google.com/app';
const SEO_GEM_URL = DEFAULT_LINKS.geminiSeo;
const CONTENT_PLANNING_GEM_URL = DEFAULT_LINKS.geminiPlanning;
const MOCKUPS_GEM_URL = DEFAULT_LINKS.geminiMockups;
const CONTENT_GEM_URL = DEFAULT_LINKS.geminiPages;
const CONTENT_GPT_URL = DEFAULT_LINKS.chatgptContent;
const MOCKUPS_GPT_URL = DEFAULT_LINKS.chatgptMockups;
const SEO_GPT_URL = DEFAULT_LINKS.chatgptSeo;

const IMAGE_JOB_KINDS = new Set([
  'page',
  'cover',
  'activity',
  'thank_you',
  'custom',
  'character',
  'thumbnail',
  'mockup',
  'front',
  'back',
  'front_cover',
  'back_cover',
  'story_page'
]);
const MOCKUP_JOB_KINDS = new Set(['thumbnail', 'mockup']);
const PLANNING_JOB_KINDS = new Set([
  'analysis',
  'blueprint',
  'planning',
  'prompts'
]);
const SEO_JOB_KINDS = new Set(['listing', 'tpt_listing', 'seo', 'title', 'description']);

function buildMockupJobs(input = {}) {
  const theme = cleanText(input.theme, 'Preschool learning');
  const projectToken = cleanText(input.projectToken, randomUUID().split('-')[0]).toUpperCase();
  const startPageNumber = Math.max(1, Number.parseInt(input.startPageNumber, 10) || 1);
  const jobs = [];

  const pushJob = ({ kind, title, body, fileStem }) => {
    const pageNumber = startPageNumber + jobs.length;
    jobs.push({
      id: randomUUID(),
      pageNumber,
      pageLabel: `${projectToken}-P${padPage(pageNumber)}`,
      kind,
      title,
      prompt: ensureImagePrefix(body),
      fileName: `${padPage(pageNumber)}_${fileStem}.png`,
      status: 'pending',
      attempts: 0
    });
  };

  pushJob({
    kind: 'mockup',
    title: 'TPT Listing Mockup',
    fileStem: 'listing_mockup',
    body: 'TODO: TPT store listing/cover mockup prompt (marketing image for the product listing, not a worksheet page).'
  });

  return {
    normalized: { theme, projectToken, mockupCount: jobs.length, startPageNumber },
    jobs
  };
}

function withMockupStage(jobs, input = {}) {
  const existing = Array.isArray(jobs) ? jobs : [];
  const mockups = buildMockupJobs({
    ...input,
    startPageNumber: existing.length + 1
  });
  return [...existing, ...mockups.jobs];
}

const COMPETITOR_MOCKUP_VISION_RULES = [
  'The attached images are public listing MOCKUPS from a competitor Teachers Pay Teachers product.',
  'Use them only as visual inspiration for product type, page types, layout patterns, mockup composition, information density, and grade-level vibe.',
  'You MUST create ORIGINAL educational content. Never copy headlines, characters, unique artwork, logos, seller branding, decorative motifs, or exact layouts.',
  'Infer structure and function, then invent new activities, original illustrations, original on-page text, and original compositions.',
  'Do not name or imitate the competitor seller. Do not reproduce copyrighted characters or protected intellectual property visible in the mockups.'
].join(' ');

function competitorMockupPromptLines(hasCompetitorMockups) {
  if (!hasCompetitorMockups) return [];
  return [
    '* Look at the attached competitor listing mockups before writing prompts. Infer product type, page types, layout patterns, composition, density, and grade vibe from those images.',
    `* ${COMPETITOR_MOCKUP_VISION_RULES}`,
    '* Write prompts for an ORIGINAL resource inspired by structure and function, not a clone of the attached listing.',
    ''
  ];
}

function buildAnalysisPrompt(input = {}) {
  const listing = resolveListingAnalysisInput(input);
  const isUrl = listing.sourceMode === 'url' && listing.productUrl;

  if (isUrl) {
    const mockupCount = Number.parseInt(input.mockupCount, 10) || 0;
    const scrapedPageCount = Number.parseInt(input.scrapedPageCount, 10);
    const hasScrapedCount = Number.isFinite(scrapedPageCount) && scrapedPageCount > 0;
    const visionLines = mockupCount > 0
      ? [
        `Look at the ${mockupCount} attached listing mockup image${mockupCount === 1 ? '' : 's'} first. They are the competitor product previews.`,
        'Infer the product type, likely page types, layout patterns, density, and grade vibe from what you SEE in those mockups. The URL is supplementary context only.',
        COMPETITOR_MOCKUP_VISION_RULES,
        ''
      ]
      : [];
    const pageCountDirective = hasScrapedCount
      ? `The competitor product listing indicates exactly ${scrapedPageCount} page(s). You MUST set "pageCount" to ${scrapedPageCount}.`
      : 'Analyze the competitor product URL, title, descriptions, and mockups carefully to determine the ACTUAL total number of printable/activity pages (for example: 1 page worksheet, 5 pages, 10 pages, 15 pages, 25 pages, 50 pages). Set "pageCount" to match the competitor product\'s true page count. DO NOT default to 20 if the competitor has a different page count.';
    const scrapedTitle = cleanText(input.listingTitle || listing.title || listing.concept, '');
    const scrapedDescription = cleanText(input.listingDescription || listing.description, '');
    const scrapedGrade = cleanText(input.listingGrade || listing.grade || listing.targetAge, '');
    const scrapedFacts = [
      scrapedTitle ? `Scraped listing title: ${scrapedTitle}` : '',
      scrapedDescription ? `Scraped listing description: ${scrapedDescription}` : '',
      scrapedGrade ? `Scraped grade / age band: ${scrapedGrade}` : ''
    ].filter(Boolean);

    return resolvePromptText('analysisUrl', {
      productUrl: cleanText(listing.productUrl),
      scrapedFacts: scrapedFacts.join('\n'),
      visionLines: visionLines.filter(Boolean).join('\n'),
      pageCountDirective,
      pageCount: hasScrapedCount ? scrapedPageCount : 1
    }, () => [
      'Analyze the following competitor product URL and provide a comprehensive product concept analysis.',
      `Product URL to analyze: ${cleanText(listing.productUrl)}`,
      '',
      ...scrapedFacts,
      scrapedFacts.length ? '' : '',
      ...visionLines,
      pageCountDirective,
      '',
      'Do not generate images, mockups, or visual pages. Return text only.',
      'You MUST respond ONLY with a valid JSON object matching this exact schema (no markdown explanations before or after):',
      '{',
      '  "title": "Exact or refined book title",',
      '  "description": "Comprehensive summary of product concept and learning goals",',
      '  "targetAge": "Target age group or grade level (e.g. Preschool / Pre-K - Kindergarten)",',
      '  "keyHighlights": ["Highlight 1", "Highlight 2", "Highlight 3", "Highlight 4"],',
      `  "pageCount": ${hasScrapedCount ? scrapedPageCount : 1},`,
      '  "productFormat": "maze", "editable", or "static" — "maze" if the listing is a maze/labyrinth book or the title/keyword contains maze. "editable" ONLY if it is explicitly sold as an editable/customizable resource (editable PowerPoint, editable Google Slides, fillable/typable fields). Otherwise "static".',
      '}'
    ].join('\n'));
  }

  // ── Builder mode: full TPT PRODUCT IDEA GENERATOR master prompt ───────
  const ideaText = cleanText(input.keyword || input.title, '');

  // Parse chips from metadataText (format: "Category → Sub → Leaf; Category2 → ...")
  // Each chip is separated by "; " and has parts joined by " → "
  const chipsRaw = cleanText(input.metadataText, '');
  const chipLines = chipsRaw
    ? chipsRaw.split(';').map((c) => c.trim()).filter(Boolean).map((chip) => {
        const parts = chip.split('→').map((p) => p.trim()).filter(Boolean);
        if (parts.length === 0) return null;
        const category = parts[0];
        const options = parts.slice(1).join(' › ') || parts[0];
        return `Category: ${category}\nOptions: ${options}`;
      }).filter(Boolean)
    : [];

  // If idea text is provided, add it as first selection
  const ideaLine = ideaText
    ? `Category: Book Concept / Idea\nOptions: ${ideaText}`
    : '';

  const allSelections = [ideaLine, ...chipLines].filter(Boolean).join('\n\n');

  const userSelectionsSection = allSelections
    ? `# USER SELECTIONS\n\nThe following Category → Options data controls the product concept.\n\n${allSelections}\n\nContinue reading additional Category → Options pairs if provided.\n\nGenerate ONE final TPT product concept using all relevant selections.`
    : '# USER SELECTIONS\n\nNo specific selections provided. Create a strong general TPT product concept for preschool / kindergarten learners.';

  return resolvePromptText('analysisIdea', { userSelections: userSelectionsSection }, () => [
    '# TPT PRODUCT IDEA GENERATOR — MASTER PROMPT',
    '',
    'You are an expert Teachers Pay Teachers (TPT) product strategist, curriculum resource designer, and educational product developer.',
    '',
    'Your task is to create ONE strong, practical, marketable, and classroom-appropriate TPT product concept based on the Category and Option selections provided below.',
    '',
    '## CORE INSTRUCTIONS',
    '',
    '1. Treat every provided Category and Option as a product requirement or preference.',
    '',
    '2. Combine all selected options into ONE coherent TPT product concept. Do not simply list the selections back to me.',
    '',
    '3. The final concept must make educational sense for the selected:',
    '',
    '* Grade / Age Group',
    '* Subject',
    '* Skill',
    '* Resource Type',
    '* Activity Type',
    '* Theme',
    '* Audience',
    '* Format',
    '* Difficulty',
    '* Educational Purpose',
    '* and any other categories provided.',
    '',
    '4. Categories are dynamic. I may provide only a few categories or many categories. You must automatically interpret any Category → Options pairs that I provide.',
    '',
    '5. Do NOT require categories that are missing. If an important detail is not provided, choose the most appropriate option yourself based on the other selections.',
    '',
    '6. If multiple Options are provided under one Category, intelligently combine them when compatible.',
    '',
    '7. If selected options conflict, prioritize:',
    '   Educational appropriateness → Grade-level suitability → Learning objective → Resource usability → Commercial potential.',
    '',
    '8. Do not force incompatible selections into the product. Resolve conflicts intelligently and briefly mention any important adjustment.',
    '',
    '9. Avoid generic product ideas. The concept should have a clear educational purpose, specific activities, and a strong reason for a teacher or parent to purchase it.',
    '',
    '10. The product must be realistic to create, printable/digital as appropriate, easy for teachers to understand, and suitable for sale on Teachers Pay Teachers.',
    '',
    '11. When relevant, design the concept so it can later be expanded into:',
    '',
    '* Related products',
    '* Product series',
    '* Grade-level versions',
    '* Seasonal versions',
    '* Bundles',
    '',
    '12. Do not use copyrighted characters, brands, books, franchises, logos, or protected intellectual property unless explicitly authorized.',
    '',
    '## PRODUCT DEVELOPMENT LOGIC',
    '',
    'Analyze the supplied selections in this order:',
    '',
    'Grade / Age Group',
    '→ Subject',
    '→ Skill / Learning Focus',
    '→ Educational Objective',
    '→ Resource Type',
    '→ Activity Type',
    '→ Theme',
    '→ Audience / Supports',
    '→ Format',
    '→ Difficulty',
    '→ Product Size',
    '→ Visual / Printing Style',
    '→ Market Strategy',
    '',
    'Then create the strongest possible product concept from the combined information.',
    '',
    '## REQUIRED OUTPUT',
    '',
    'Return the final product concept using this structure:',
    '',
    '### Product Title',
    '',
    'Create a clear, descriptive, TPT-friendly working title.',
    '',
    '### Core Product Concept',
    '',
    'Explain exactly what the resource is and how students or teachers will use it.',
    '',
    '### Target Learner',
    '',
    'Specify the recommended grade level, age range, audience, and learning level.',
    '',
    '### Subject & Skills',
    '',
    'Identify:',
    '',
    '* Primary Subject',
    '* Sub-Subject',
    '* Primary Skill',
    '* Secondary Skills',
    '* Learning Objectives',
    '',
    '### Resource Type',
    '',
    'Explain the final resource format and why it fits the selected requirements.',
    '',
    '### Product Structure',
    '',
    'Recommend:',
    '',
    '* Total Page Count',
    '* Number of Activities',
    '* Sections',
    '* Teacher Pages',
    '* Student Pages',
    '* Answer Keys',
    '* Additional Materials',
    '',
    '### Activity Structure',
    '',
    'Describe the different activity types included and how each supports the learning objective.',
    '',
    '### Page-by-Page Plan',
    '',
    'Create a practical page structure for the complete resource. Group repetitive pages when appropriate instead of unnecessarily describing identical pages individually.',
    '',
    '### Difficulty & Differentiation',
    '',
    'Explain the difficulty level and how the resource can support different learners.',
    '',
    '### Teacher Use Cases',
    '',
    'Explain how the resource can be used for:',
    '',
    '* Classroom Practice',
    '* Centers',
    '* Morning Work',
    '* Independent Work',
    '* Homework',
    '* Intervention',
    '* Early Finishers',
    '* Homeschool',
    '  when applicable.',
    '',
    '### Visual Direction',
    '',
    'Recommend:',
    '',
    '* Page Orientation',
    '* Page Size',
    '* Color Style',
    '* Illustration Style',
    '* Typography',
    '* Layout',
    '* Printing Strategy',
    '* Student-friendly design considerations',
    '',
    '### Unique Selling Proposition',
    '',
    'Explain what makes this product useful or different from a basic worksheet pack.',
    '',
    '### Commercial Potential',
    '',
    'Recommend whether the concept works best as:',
    '',
    '* Standalone Product',
    '* Product Series',
    '* Bundle',
    '* Seasonal Product',
    '* Evergreen Product',
    '  or a combination.',
    '',
    '### Expansion Opportunities',
    '',
    'Suggest 3–5 logical products that could be created next.',
    '',
    '### TPT SEO Direction',
    '',
    'Provide:',
    '',
    '* SEO-Friendly Product Title',
    '* Primary Keyword',
    '* Secondary Keywords',
    '* Long-Tail Keywords',
    '',
    '### Final Product Summary',
    '',
    'Give a concise final specification that can be passed directly to another AI system to generate the individual pages.',
    '',
    '---',
    '',
    userSelectionsSection,
    '',
    '## CRITICAL OUTPUT RULES',
    '',
    'Do not generate images, mockups, or visual pages. Return text only.',
    'After the full product concept, output ONE JSON object and nothing after it:',
    '{"title":"Final product title","description":"Short product concept summary","targetAge":"Target age or grade","keyHighlights":["Highlight 1","Highlight 2","Highlight 3"],"pageCount":12,"productFormat":"maze or editable or static"}',
    'pageCount must be the exact number of printable pages for this product. Do not inflate it with extra covers or closing pages unless they are part of that exact count.',
    '"productFormat" must be "maze" if the listing is a maze/labyrinth book or the title/keyword contains maze. "editable" ONLY if it is explicitly sold as an editable/customizable resource (editable PowerPoint, editable Google Slides, fillable/typable fields). Otherwise "static".'
  ].join('\n'));
}

const EDITABLE_PRODUCT_SIGNAL = /editable|customi[sz]able|google slides|powerpoint template|fillable|type[- ]?your[- ]?own/i;
const MAZE_PRODUCT_SIGNAL = /\bmazes?\b|\blabyrinths?\b/i;

function inferProductFormat(text, modelValue) {
  const raw = String(modelValue || '').trim().toLowerCase();
  const inferred = MAZE_PRODUCT_SIGNAL.test(String(text || '')) || raw === 'maze'
    ? 'maze'
    : EDITABLE_PRODUCT_SIGNAL.test(String(text || ''))
      ? 'editable'
      : raw === 'editable' ? 'editable' : 'static';
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H1',location:'src/prompt-builder.cjs:inferProductFormat',message:'inferProductFormat collapsed gem value',data:{rawModelValue:raw,inferred,textHasMaze:/\bmazes?\b/i.test(String(text||'')),textPreview:String(text||'').slice(0,160)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return inferred;
}

function normalizeAnalysisResult(parsed = {}, fallbackText = '', fallbackPageCount = null) {
  const pageCountInt = Number.parseInt(parsed.pageCount, 10);
  const fallbackCountInt = Number.parseInt(fallbackPageCount, 10);
  const highlights = Array.isArray(parsed.keyHighlights) && parsed.keyHighlights.length
    ? parsed.keyHighlights.map((item) => cleanText(item)).filter(Boolean)
    : [];

  let resolvedPageCount = 1;
  if (Number.isFinite(pageCountInt) && pageCountInt > 0) {
    resolvedPageCount = pageCountInt;
  } else if (Number.isFinite(fallbackCountInt) && fallbackCountInt > 0) {
    resolvedPageCount = fallbackCountInt;
  }

  return {
    title: cleanText(parsed.title, 'Analyzed Product Workbook'),
    description: cleanText(parsed.description, cleanText(fallbackText.slice(0, 300), 'Printable educational workbook based on analyzed product.')),
    targetAge: cleanText(parsed.targetAge, 'Pre-K to 2nd Grade'),
    keyHighlights: highlights.length ? highlights : ['Printable worksheets', 'Educational activities', 'Age-appropriate design'],
    pageCount: resolvedPageCount,
    productFormat: inferProductFormat(
      [parsed.title, parsed.description, fallbackText].filter(Boolean).join(' '),
      parsed.productFormat
    )
  };
}

function firstMarkdownHeadingValue(text, headingPattern) {
  const match = String(text ?? '').match(new RegExp(
    `(?:^|\\n)\\s*#{1,6}\\s*${headingPattern}\\s*\\n+\\s*([^\\n#]+)`,
    'i'
  ));
  return cleanText(match?.[1], '');
}

function parseAnalysisResponse(rawText, fallbackPageCount = null) {
  const text = String(rawText ?? '').trim();
  const parsed = tryParseAnalysisObject(text);
  if (parsed) return normalizeAnalysisResult(parsed, text, fallbackPageCount);
  throw new Error('Analysis extraction failed: The AI did not return a valid JSON object containing the book details.');
}

function resolvePixelDimensions(format, orientation) {
  const isLandscape = orientation === 'landscape';
  switch (format) {
    case 'LETTER':
      return isLandscape ? '3300 × 2550 px' : '2550 × 3300 px';
    case 'A4':
      return isLandscape ? '3508 × 2480 px' : '2480 × 3508 px';
    case 'HALF_LETTER':
    case 'DIGEST':
      return isLandscape ? '2550 × 1650 px' : '1650 × 2550 px';
    case 'SQUARE':
      return '2400 × 2400 px';
    case 'POSTER':
      return isLandscape ? '7200 × 5400 px' : '5400 × 7200 px';
    default:
      return isLandscape ? '3300 × 2550 px' : '2550 × 3300 px'; // Default Letter
  }
}

const PROMPT_BATCH_SIZE = 50;

function clampPromptPageCount(pageCount, fallback = 20) {
  const parsed = Number.parseInt(pageCount, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, Math.min(500, fallback));
  return Math.max(1, Math.min(500, parsed));
}

function promptPageBatches(pageCount, batchSize = PROMPT_BATCH_SIZE) {
  const total = clampPromptPageCount(pageCount);
  const size = clampPromptPageCount(batchSize, PROMPT_BATCH_SIZE);
  const batches = [];
  for (let startPage = 1; startPage <= total; startPage += size) {
    batches.push({
      startPage,
      endPage: Math.min(total, startPage + size - 1)
    });
  }
  return { total, batchSize: size, batches };
}

function resolvePromptPageRange(pageCount, options = {}) {
  const total = clampPromptPageCount(pageCount);
  const startRaw = Number.parseInt(options.startPage, 10);
  const endRaw = Number.parseInt(options.endPage, 10);
  const startPage = Number.isFinite(startRaw) && startRaw > 0 ? Math.min(total, startRaw) : 1;
  const endPage = Number.isFinite(endRaw) && endRaw > 0
    ? Math.min(total, Math.max(startPage, endRaw))
    : total;
  return {
    total,
    startPage,
    endPage,
    batchCount: endPage - startPage + 1,
    isPartial: startPage !== 1 || endPage !== total
  };
}

function buildPromptsGenerationRequest(pageCount, format, orientation, options = {}) {
  const count = clampPromptPageCount(pageCount);
  const pageSizeStr = resolvePixelDimensions(format, orientation);
  const hasCompetitorMockups = Boolean(options.hasCompetitorMockups);
  const visionLines = competitorMockupPromptLines(hasCompetitorMockups);
  const range = resolvePromptPageRange(count, options);
  const alreadyHave = Math.max(
    0,
    Number.parseInt(options.alreadyHave, 10) || (range.startPage > 1 ? range.startPage - 1 : 0)
  );

  if (count === 1) {
    return resolvePromptText('pagesSingle', {
      pageSize: pageSizeStr,
      visionLines: visionLines.filter(Boolean).join('\n')
    }, () => [
      'Using the TPT product idea you created above, turn the concept into a complete page-by-page image prompt plan.',
      '',
      'NUMBER OF PAGES: 1',
      '',
      `PAGE SIZE: ${pageSizeStr}`,
      '',
      'REQUIREMENTS:',
      '',
      ...visionLines,
      '* Create exactly ONE standalone image-generation prompt for the single requested page. Do not add extra pages, covers, or concluding pages.',
      '* Do not generate images in this step. Return prompt text only.',
      '* Every prompt MUST strictly begin with the prefix "@image " (e.g., "@image A flawless, high-resolution digital illustration of...").',
      '* Never omit the @image prefix. The @image prefix is mandatory to trigger the image tool directly.',
      `* The prompt must explicitly include the exact requested dimensions: ${pageSizeStr}.`,
      '* Describe the complete printable page: layout, illustrations, exact on-page text in quotation marks, instructions, and activity elements.',
      '* Describe that required copy as clean classroom print on flat pale paper bands — not collage letters, cut-paper glyphs, rainbow type, empty frames, or a text-free master.',
      '* Make the activity educationally appropriate for the selected grade, age, subject, skill, and difficulty.',
      '* Do not use copyrighted characters, brands, logos, or protected intellectual property.',
      '* Keep all important text and artwork inside safe print margins.',
      '* Do not create mockups. The prompt must describe only the actual printable/digital page.',
      '* Do not place multiple pages in one image.',
      '* The generated image must contain exactly ONE page.',
      '* Standard project: Do NOT write a prompt that asks for or depends on reference images, uploaded files, or external references. The prompt must describe the page completely so the AI generates the image immediately.',
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
      'Return exactly one line. Never omit the @image prefix. Do not write explanations, introductions, summaries, tables, extra pages, or additional commentary outside the prompt.'
    ].join('\n'));
  }

  const batchLines = range.isPartial
    ? [
      `THIS BATCH: write pages ${range.startPage}–${range.endPage} only (${range.batchCount} prompts).`,
      alreadyHave > 0
        ? `You already wrote pages 1–${alreadyHave}. Do not repeat those pages. Continue from Page ${range.startPage}.`
        : `Write Page ${range.startPage} through Page ${range.endPage} now. Remaining pages will be requested in later batches.`,
      ''
    ]
    : [];
  const countDirective = range.isPartial
    ? `* Create exactly ${range.batchCount} prompt lines for pages ${range.startPage}–${range.endPage} of the ${count}-page product. Do not add extra pages beyond page ${range.endPage} in this response.`
    : `* Create exactly ${count} pages. Do not add extra pages beyond that exact count.`;
  const distributionDirective = range.isPartial
    ? `* Keep the product identity consistent with the ${count}-page plan. Never exceed ${range.batchCount} prompts in this batch.`
    : `* Decide the best distribution of the content across exactly ${count} pages. Never exceed ${count} prompts.`;
  const stopLine = range.isPartial
    ? `Stop after Page ${range.endPage}. Do not rewrite pages before ${range.startPage} and do not continue past page ${range.endPage}.`
    : (count > 3
      ? `Continue until you have exactly ${count} pages and then stop. Do not add a cover, activity, or final page beyond page ${count}.`
      : `Stop after Page ${count}. Do not add a cover, activity, or final page beyond page ${count}.`);
  const importantLine = range.isPartial
    ? `Return exactly ${range.batchCount} prompt lines for pages ${range.startPage}–${range.endPage}. Never omit the @image prefix.`
    : `Return exactly ${count} prompt lines. Never omit the @image prefix. Each line must contain one complete prompt that can be copied and used independently in an AI image generator. Do not write explanations, introductions, summaries, tables, or additional commentary outside the prompts.`;

  return resolvePromptText('pagesPlan', {
    pageCount: count,
    pageSize: pageSizeStr,
    visionLines: visionLines.filter(Boolean).join('\n'),
    batchLines: batchLines.filter(Boolean).join('\n'),
    countDirective,
    distributionDirective,
    lastInterior: Math.max(1, count - 1),
    stopLine,
    importantLine
  }, () => [
    'Using the TPT product idea you created above, turn the concept into a complete page-by-page image prompt plan.',
    '',
    `NUMBER OF PAGES: ${count}`,
    '',
    ...batchLines,
    `PAGE SIZE: ${pageSizeStr}`,
    '',
    'REQUIREMENTS:',
    '',
    ...visionLines,
    countDirective,
    '* Do not generate images in this step. Return prompt text only.',
    '* Every prompt MUST strictly begin with the prefix "@image " (e.g., "@image A flawless, high-resolution digital illustration of...").',
    '* Never omit the @image prefix. The @image prefix is mandatory to trigger the image tool directly.',
    '* Include the front cover as Page 1 only if it fits inside the exact requested count.',
    `* Label every prompt as Page K of ${count} with an explicit role. Page 1 of ${count} is the front cover. Pages 2 through ${Math.max(1, count - 1)} are interior worksheets. Page ${count} of ${count} is the back or closing page.`,
    '* Never write a second cover, title splash, or listing mockup in the middle of the book.',
    '* Do not tell the later image model to paint "Page K", "K of N", or any folio on the artwork. The K of N label is prompt metadata only.',
    '* Include all necessary educational/activity/content pages within the exact requested count.',
    '* Include an appropriate final page only if it still fits inside the exact requested count, such as an answer key, completion page, credits page, or back cover.',
    distributionDirective,
    '* Every page must have its own complete, standalone image-generation prompt.',
    `* Every prompt must explicitly include the exact requested dimensions: ${pageSizeStr}.`,
    '* Keep the same visual style, illustration style, typography direction, color palette, line style, layout quality, and overall product identity across ALL pages.',
    '* Define the visual style clearly in the first prompt and repeat the essential style instructions in every following prompt so each page can be generated independently while remaining visually consistent.',
    '* Keep recurring characters, icons, objects, borders, decorative elements, and visual conventions consistent throughout the product when applicable.',
    '* Make every activity educationally appropriate for the selected grade, age, subject, skill, and difficulty.',
    '* Avoid unnecessary repetition. Each page should add meaningful value to the product.',
    '* For worksheets and activities, clearly describe the exact exercises, questions, answer spaces, illustrations, instructions, and layout required.',
    '* If text must appear on a generated page, include the EXACT text inside quotation marks in the prompt.',
    '* Describe that required copy as clean classroom print on flat pale paper bands — not collage letters, cut-paper glyphs, rainbow type, empty frames, or a text-free master.',
    '* Do not use copyrighted characters, brands, logos, or protected intellectual property.',
    '* Keep all important text and artwork inside safe print margins.',
    '* Do not create mockups. Each prompt must describe only the actual printable/digital page.',
    '* Do not place multiple pages in one image.',
    '* Each generated image must contain exactly ONE page.',
    '* Standard project: Do NOT write prompts that ask for or depend on reference images, uploaded files, or external references. Each prompt must describe the page completely so the AI generates the image immediately.',
    '* Maintain consistent orientation and dimensions across the complete product unless explicitly instructed otherwise.',
    '* If a cover is included inside the exact count, make it visually stronger than the interior pages while maintaining the same product identity.',
    '* If a final page is included inside the exact count, it must visually match the rest of the resource.',
    '',
    'OUTPUT FORMAT:',
    '',
    'Return ONLY the page prompts.',
    '',
    'One prompt per line.',
    '',
    'Use this exact structure:',
    '',
    ...Array.from({ length: Math.min(range.batchCount, 3) }, (_, index) => {
      const pageNumber = range.startPage + index;
      const role = pageNumber === 1 ? 'Cover' : (pageNumber === count ? 'Back' : 'Interior');
      return `Page ${pageNumber} of ${count} — ${role}: @image [complete visual description including ${pageSizeStr}]`;
    }).flatMap((line, index, lines) => (index === lines.length - 1 ? [line] : [line, ''])),
    '',
    stopLine,
    '',
    'IMPORTANT:',
    importantLine
  ].join('\n'));
}

function looksLikePageImagePrompt(prompt) {
  const body = String(prompt || '')
    .replace(/^@image\s*/i, '')
    .replace(/Generate this printable page image now\.[^\n]*/i, '')
    .replace(/Required print-production[\s\S]*$/i, '')
    .trim();
  if (body.length < 60) return false;
  if (/^(json|javascript|copy|output|schema|\{|\[)/i.test(body)) return false;
  if (/^"[a-zA-Z0-9_]+"\s*:/.test(body)) return false;
  if (/^```/.test(body)) return false;
  return true;
}

function parseEditablePageBlueprint(rawText, expectedCount = 20) {
  const { normalizeTextOverlays } = require('./text-overlay-layout.cjs');
  expectedCount = Math.max(1, Number.parseInt(expectedCount, 10) || 20);
  const text = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidates = [
    ...(fence ? [fence.trim()] : []),
    ...jsonObjectCandidates(text)
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const pagesRaw = Array.isArray(parsed?.pages) ? parsed.pages
        : (Array.isArray(parsed) ? parsed : null);
      if (!pagesRaw?.length) continue;
      const pages = pagesRaw.map((page, index) => {
        const pageNumber = Number(page.pageNumber ?? page.page ?? index + 1) || (index + 1);
        const imagePrompt = ensureImagePrefix(
          cleanPromptSection(page.imagePrompt ?? page.prompt ?? page.blankPrompt ?? '')
        );
        const textOverlays = normalizeTextOverlays(page.textOverlays ?? page.overlays ?? page.textBoxes ?? []);
        return { pageNumber, imagePrompt, textOverlays };
      }).filter((page) => page.imagePrompt && looksLikePageImagePrompt(page.imagePrompt));
      if (!pages.length) continue;
      return pages.slice(0, expectedCount);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function parseGeneratedPrompts(rawText, expectedCount = 20, options = {}) {
  expectedCount = Math.max(1, Number.parseInt(expectedCount, 10) || 20);
  const startPage = Number.parseInt(options.startPage, 10);
  const endPage = Number.parseInt(options.endPage, 10);
  const hasRange = Number.isFinite(startPage) && startPage > 0;
  const rangeStart = hasRange ? startPage : 1;
  const rangeEnd = Number.isFinite(endPage) && endPage > 0 ? endPage : expectedCount;
  const blueprint = parseEditablePageBlueprint(rawText, expectedCount);
  if (blueprint?.length) {
    const filtered = hasRange
      ? blueprint.filter((page) => page.pageNumber >= rangeStart && page.pageNumber <= rangeEnd)
      : blueprint;
    const prompts = filtered.map((page) => page.imagePrompt);
    prompts.pages = filtered;
    prompts.blueprint = true;
    prompts.pageNumbers = filtered.map((page) => page.pageNumber);
    return prompts;
  }

  const text = String(rawText ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/([.!?a-z0-9)])\s*(Page\s+\d+(?:\s+of\s+\d+)?\s*(?:[—–-]\s*[^:\n]{0,40})?:)/gi, '$1\n$2');
  const rawLines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const records = rawLines.map((line) => {
    const pageMatch = /(?:^|\b)page\s*(\d+)/i.exec(line);
    const pageNumber = pageMatch ? Number(pageMatch[1]) : null;
    let result = line;
    result = result.replace(/^(?:\*|-|\s)*page\s*\d+\s*(?:[—–-]\s*cover)?\s*[:.-]\s*/i, '');
    result = result.replace(/^(?:\*|-|\s)*prompt\s*\d+\s*[:.-]\s*/i, '');
    result = result.replace(/^(?:\*|-|\s)*\d+\s*[:.-]\s*/i, '');
    let previous;
    do {
      previous = result;
      result = result
        .replace(/^(?:\d+|page\s*\d*|prompt\s*\d*|\*|-)+[\s.:#-]+/i, '')
        .replace(/^"(.*)"$/, '$1')
        .trim();
    } while (result !== previous);
    return { pageNumber, prompt: result };
  }).filter((item) => item.prompt).filter((item) => looksLikePageImagePrompt(item.prompt))
    .map((item) => ({ ...item, prompt: ensureImagePrefix(item.prompt) }));
  const selected = hasRange
    ? records.filter((item) => Number.isFinite(item.pageNumber) && item.pageNumber >= rangeStart && item.pageNumber <= rangeEnd)
    : records;
  const finalPrompts = selected.map((item) => item.prompt).slice(0, Math.max(1, expectedCount));
  if (!finalPrompts.length && !options.allowEmpty) {
    throw Object.assign(new Error('The Content Gem returned JSON or commentary instead of page image prompts. Generate prompts again.'), {
      code: 'PROMPTS_NOT_PARSED'
    });
  }
  finalPrompts.pageNumbers = selected.slice(0, finalPrompts.length).map((item) => item.pageNumber);
  return finalPrompts;
}

function estimatePromptProgressFromSample(sample = {}, options = {}) {
  const startPage = Math.max(1, Number.parseInt(options.startPage, 10) || 1);
  const endPage = Math.max(startPage, Number.parseInt(options.endPage, 10) || startPage);
  const expectedCount = Math.max(
    1,
    Number.parseInt(options.expectedCount ?? options.batchCount, 10) || (endPage - startPage + 1)
  );
  const lastParsedCount = Math.max(0, Number.parseInt(options.lastParsedCount, 10) || 0);
  const suffix = String(sample.suffix || sample.text || '');
  const length = Number(sample.length) || suffix.length;
  let highestPage = 0;
  for (const match of suffix.matchAll(/Page\s+(\d+)\s*:/gi)) {
    const pageNumber = Number(match[1]);
    if (pageNumber >= startPage && pageNumber <= endPage) {
      highestPage = Math.max(highestPage, pageNumber);
    }
  }
  const fromSuffix = highestPage >= startPage ? highestPage - startPage + 1 : 0;
  const parsedCount = Math.min(expectedCount, Math.max(lastParsedCount, fromSuffix));
  return {
    parsedCount,
    highestPage: highestPage || (parsedCount ? startPage + parsedCount - 1 : 0),
    complete: parsedCount >= expectedCount,
    length
  };
}

function inspectGeneratedPromptProgress(rawText, options = {}) {
  const startPage = Math.max(1, Number.parseInt(options.startPage, 10) || 1);
  const endPage = Math.max(startPage, Number.parseInt(options.endPage, 10) || startPage);
  const expectedCount = Math.max(
    1,
    Number.parseInt(options.expectedCount ?? options.batchCount, 10) || (endPage - startPage + 1)
  );
  try {
    const parsed = parseGeneratedPrompts(rawText, expectedCount, {
      startPage,
      endPage,
      allowEmpty: true
    });
    const pageNumbers = Array.isArray(parsed.pageNumbers)
      ? parsed.pageNumbers.filter(Number.isFinite)
      : parsed.map((_, index) => startPage + index);
    const highestPage = pageNumbers.length ? Math.max(...pageNumbers) : 0;
    return {
      parsedCount: parsed.length,
      pageNumbers,
      highestPage,
      complete: parsed.length >= expectedCount
    };
  } catch {
    return {
      parsedCount: 0,
      pageNumbers: [],
      highestPage: 0,
      complete: false
    };
  }
}

function mergeGeneratedPromptSlots(slots, parsed, { startPage = 1, total = 0 } = {}) {
  const size = Math.max(
    Array.isArray(slots) ? slots.length : 0,
    Number.parseInt(total, 10) || 0,
    1
  );
  const next = Array.isArray(slots) ? slots.slice() : new Array(size).fill(null);
  while (next.length < size) next.push(null);
  const items = Array.isArray(parsed) ? parsed : [];
  const numbers = parsed?.pageNumbers;
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : null;
  if (pages?.length) {
    for (const page of pages) {
      const pageNumber = Number(page.pageNumber);
      if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > next.length) continue;
      if (!next[pageNumber - 1]) next[pageNumber - 1] = page.imagePrompt || page.prompt;
    }
    return next;
  }
  items.forEach((prompt, index) => {
    const pageNumber = Number(numbers?.[index]) || (startPage + index);
    if (pageNumber < 1 || pageNumber > next.length) return;
    if (!next[pageNumber - 1]) next[pageNumber - 1] = prompt;
  });
  return next;
}

function densePromptPrefix(slots = []) {
  const prefix = [];
  for (const item of slots) {
    if (!item) break;
    prefix.push(item);
  }
  return prefix;
}

function buildPromptsContinuationRequest(pageCount, format, orientation, options = {}) {
  const count = clampPromptPageCount(pageCount);
  const range = resolvePromptPageRange(count, options);
  const pageSizeStr = resolvePixelDimensions(format, orientation);
  const alreadyHave = Math.max(
    0,
    Number.parseInt(options.alreadyHave, 10) || Math.max(0, range.startPage - 1)
  );
  return resolvePromptText('pagesContinuation', {
    pageCount: count,
    alreadyHaveLine: alreadyHave > 0 ? `You already wrote pages 1–${alreadyHave}. Do not repeat those pages.` : '',
    startPage: range.startPage,
    endPage: range.endPage,
    batchCount: range.batchCount,
    pageSize: pageSizeStr
  }, () => [
    'Continue the same Teachers Pay Teachers page-by-page image prompt plan from this conversation.',
    `The finished product has exactly ${count} pages.`,
    alreadyHave > 0 ? `You already wrote pages 1–${alreadyHave}. Do not repeat those pages.` : '',
    `Write pages ${range.startPage} through ${range.endPage} now (${range.batchCount} prompts). Then stop.`,
    'Do not generate images. Return prompt text only.',
    'One prompt per line. Every line MUST start with the page label then @image.',
    `Use this structure: Page ${range.startPage}: @image [complete visual description including ${pageSizeStr}]`,
    'Keep the same visual style, dimensions, and original educational content as the earlier pages.',
    `Return exactly ${range.batchCount} prompt lines and nothing else.`
  ].filter(Boolean).join('\n'));
}

function buildStorybookPrompt(input) {
  const storyIdea = cleanText(input.storyIdea, '');
  const storyBody = cleanText(input.storyBody, '');
  const pageCount = input.pageCount || '10';
  const ageRange = cleanText(input.ageRange, '3-5 years');
  const language = cleanText(input.language, 'English');
  const moralLesson = cleanText(input.moralLesson, '');

  const storyIdeaVal = storyIdea || "[Invent an original, fun, and magical children's story idea from scratch.]";
  const storyBodyVal = storyBody || "[Create a captivating story plot and exact page text automatically based on the story idea.]";
  const moralLessonVal = moralLesson || "[Derive an inspiring moral lesson suited for this age group automatically.]";

  const promptLines = [
    'Execute every instruction in the exact order provided.',
    '',
    'BOOK INPUT',
    `Story Idea: ${storyIdeaVal}`,
    `Story Body: ${storyBodyVal}`,
    `Number of Pages: ${pageCount}`,
    `Age Range: ${ageRange}`,
    `Language: ${language}`,
    `Moral Lesson: ${moralLessonVal}`,
    '',
    "You are an award-winning children's book author, illustrator, and AI prompt engineer.",
    'Create the story package in the following exact order. Do not skip a section.',
    '',
    '## 0. Story Blueprint',
    'Write the approved blueprint for this book. It MUST include:',
    '- Book Title: one final title that will be reused verbatim.',
    '- Story Summary: a concise beginning, middle, and ending.',
    '- Visual Style: one consistent illustration direction for the entire book.',
    `- Exact Page Text: the final, print-ready story text for Page 1 through Page ${pageCount}. Do not paraphrase it later.`,
    '',
    '## 1. Character Prompts',
    'Identify ONLY the essential characters required for the story.',
    'For each character, output exactly ONE single-line image prompt in the following format:',
    '- Character Name: [Name] | Image Prompt: [Complete standalone prompt for generating a full-body character reference image]',
    '',
    '---',
    '',
    '## 2. Front Cover Prompt',
    "Generate ONE complete AI image prompt for the book's front cover.",
    "The prompt MUST instruct the AI to create a PROFESSIONAL children's book cover.",
    'Requirements:',
    "- Use the exact Book Title generated in the Story Blueprint.",
    '- Display the Book Title prominently at the top of the cover.',
    '- Do NOT change, shorten, or rewrite the title.',
    '- Do NOT invent any additional text.',
    '- Leave space at the bottom for the author name.',
    '- Feature the main character as the primary focus.',
    '- Include supporting characters only if they are important to the story.',
    '- Reflect the story\'s main theme and atmosphere.',
    '- Match the same illustration style used throughout the book.',
    '- The final result should look like a real bestselling children\'s book cover for Amazon KDP.',
    'Output ONLY the complete AI image prompt.'
  ];

  return promptLines.join('\n');
}

function parseStorybookResponse(rawText) {
  const text = String(rawText ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\*\*/g, '')
    .replace(/__/g, '');
  const lines = text.split('\n');

  const heading = (line) => String(line ?? '')
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+\s*[.)-]\s*/, '')
    .trim();
  const blueprintStart = lines.findIndex((line) => /^story\s+blueprint\s*:?/i.test(heading(line)));
  const characterStart = lines.findIndex((line) => /^(?:character\s+prompts?|characters)\s*:?/i.test(heading(line)));
  const frontCoverStart = lines.findIndex((line) => /^front\s+cover(?:\s+prompt)?\s*:?/i.test(heading(line)));

  const hasCharacters = characterStart !== -1;
  const hasFrontCover = frontCoverStart !== -1;

  if (!hasCharacters || !hasFrontCover) {
    const missing = [];
    if (!hasCharacters) missing.push('Character Prompts');
    if (!hasFrontCover) missing.push('Front Cover Prompt');
    throw Object.assign(
      new Error(`Gemini response is incomplete or invalid. Missing sections: ${missing.join(', ')}. Please retry or refine your inputs.`),
      { code: 'STORYBOOK_PARSING_FAILED' }
    );
  }

  const charEnd = frontCoverStart !== -1 ? frontCoverStart : lines.length;
  const charLines = lines.slice(characterStart + 1, charEnd);
  const characters = [];
  let currentCharacter = null;
  const flushCharacter = () => {
    if (!currentCharacter?.name) return;
    currentCharacter.prompt = cleanPromptSection(currentCharacter.prompt);
    characters.push(currentCharacter);
    currentCharacter = null;
  };
  for (const sourceLine of charLines) {
    const line = sourceLine.trim();
    if (!line || /^---+$/.test(line)) continue;
    const piped = line.match(/^(?:[-*]|\d+[.)])?\s*Character\s+Name\s*:\s*(.*?)\s*\|\s*Image\s+Prompt\s*:\s*(.+)$/i);
    if (piped) {
      flushCharacter();
      characters.push({ name: cleanPromptSection(piped[1]), prompt: cleanPromptSection(piped[2]) });
      continue;
    }
    const nameMatch = line.match(/^(?:[-*]|\d+[.)])?\s*(?:Character\s+)?Name\s*:\s*(.+)$/i);
    if (nameMatch) {
      flushCharacter();
      currentCharacter = { name: cleanPromptSection(nameMatch[1]), prompt: '' };
      continue;
    }
    const promptMatch = line.match(/^(?:[-*]|\d+[.)])?\s*(?:Image\s+)?Prompt\s*:\s*(.*)$/i);
    if (promptMatch && currentCharacter) {
      currentCharacter.prompt = promptMatch[1];
      continue;
    }
    if (currentCharacter?.prompt) currentCharacter.prompt += `\n${line}`;
  }
  flushCharacter();

  if (characters.length === 0) {
    for (const sourceLine of charLines) {
      const line = sourceLine.trim();
      const match = line.match(/^(?:[-*]|\d+[.)])\s*([^:|]{1,60})$/);
      if (match && !/prompt|character/i.test(match[1])) {
        characters.push({ name: cleanPromptSection(match[1]), prompt: '' });
      }
    }
  }

  const inlineFrontCover = heading(lines[frontCoverStart]).match(/^front\s+cover(?:\s+prompt)?\s*:\s*(.+)$/i)?.[1] ?? '';
  const frontCover = cleanPromptSection([
    inlineFrontCover,
    ...lines.slice(frontCoverStart + 1)
  ].filter(Boolean).join('\n'));

  const blueprintEndCandidates = [characterStart, frontCoverStart].filter((index) => index > blueprintStart);
  const blueprintEnd = blueprintEndCandidates.length ? Math.min(...blueprintEndCandidates) : lines.length;
  const inlineBlueprint = blueprintStart === -1
    ? ''
    : heading(lines[blueprintStart]).match(/^story\s+blueprint\s*:\s*(.+)$/i)?.[1] ?? '';
  const blueprint = blueprintStart === -1
    ? cleanPromptSection(lines.slice(0, characterStart).join('\n'))
    : cleanPromptSection([inlineBlueprint, ...lines.slice(blueprintStart + 1, blueprintEnd)].filter(Boolean).join('\n'));
  const title = cleanPromptSection(blueprint.match(/(?:^|\n)\s*(?:[-*]\s*)?Book\s+Title\s*:\s*(.+)/i)?.[1] ?? '');
  const exactPageText = parseExactPageText(blueprint);

  const emptySections = [];
  if (characters.length === 0) emptySections.push('Character Prompts content');
  if (!frontCover) emptySections.push('Front Cover Prompt content');
  if (emptySections.length) {
    throw Object.assign(
      new Error(`Gemini response is incomplete or invalid. Missing sections: ${emptySections.join(', ')}. Please retry or refine your inputs.`),
      { code: 'STORYBOOK_PARSING_FAILED' }
    );
  }

  return {
    characters,
    frontCover,
    blueprint,
    title,
    exactPageText,
    pages: [],
    backCover: ''
  };
}

function parseExactPageText(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  const records = [];
  const matches = [...text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:[-*]\s*)?Page\s*(\d+)\s*(?:Exact\s+Page\s+Text|Page\s+Text|Story\s+Text)?\s*:\s*/gi)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const storyText = cleanPromptSection(text.slice(start, end));
    if (storyText) records.push({ pageNumber: Number(match[1]), storyText });
  }
  return records.sort((left, right) => left.pageNumber - right.pageNumber);
}

function cleanPromptSection(val) {
  let cleaned = String(val ?? '')
    .replace(/^(?:\*|-|\s)*[:.-]\s*/i, '') // remove leading symbols/colons
    .trim();
  
  // Strip surrounding quotes if present
  cleaned = cleaned.replace(/^["']([\s\S]*?)["']$/, '$1').trim();
  return cleaned;
}

function storybookInputLines(input = {}) {
  const lines = [];
  const add = (label, value) => {
    const cleaned = cleanText(value, '');
    if (cleaned) lines.push(`${label}: ${cleaned}`);
  };
  add('Story Idea', input.storyIdea);
  add('Story Body', input.storyBody);
  lines.push(`Number of Story Pages: ${Math.max(1, Number.parseInt(input.pageCount, 10) || 10)}`);
  add('Age Range', input.ageRange);
  add('Language', input.language);
  add('Moral Lesson', input.moralLesson);
  if (input.hasPhoto || input.attachmentPath) {
    lines.push('Real Person Photo: Supplied locally. It will be attached only when the first/main character image is generated later.');
  }
  return lines;
}

function balancedJsonObjects(rawText) {
  const text = String(rawText ?? '');
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function quotedJsonField(text, key) {
  const match = String(text || '').match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'));
  return cleanText(match?.[1]?.replace(/\\"/g, '"'), '');
}

function extractAnalysisFields(rawText) {
  const text = String(rawText ?? '');
  const title = quotedJsonField(text, 'title')
    || firstMarkdownHeadingValue(text, 'title')
    || cleanText(text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:Book\s+)?Title\s*:\s*(.+)/i)?.[1], '');
  const description = quotedJsonField(text, 'description')
    || firstMarkdownHeadingValue(text, 'description|purpose')
    || cleanText(text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:Description|Purpose)\s*:\s*([\s\S]*?)(?=\n\s*(?:[-*]\s*)?(?:Target\s*Age|Highlights|pageCount|Page Count|$))/i)?.[1], '');
  const targetAge = quotedJsonField(text, 'targetAge')
    || cleanText(text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:Target\s*Age|Grade)\s*:\s*(.+)/i)?.[1], '');
  const pageCountMatch = text.match(/"pageCount"\s*:\s*(\d+)/i)
    || text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:Page Count|Pages)\s*:\s*(\d+)/i);
  const pageCount = Number.parseInt(pageCountMatch?.[1], 10);
  const highlightBlock = text.match(/"keyHighlights"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || '';
  const keyHighlights = [...highlightBlock.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((item) => cleanText(item[1])).filter(Boolean);
  if (!title || !(description || Number.isFinite(pageCount))) return null;
  return {
    title,
    description,
    targetAge,
    keyHighlights,
    pageCount: Number.isFinite(pageCount) ? pageCount : undefined
  };
}

function tryParseAnalysisObject(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) return null;
  const candidates = [
    ...(text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ? [text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)[1].trim()] : []),
    ...jsonObjectCandidates(text)
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && (parsed.title || parsed.description || parsed.pageCount)) {
        return parsed;
      }
    } catch {
      // Try the next candidate
    }
  }
  return extractAnalysisFields(text);
}

function analysisResponseReady(rawText) {
  return Boolean(tryParseAnalysisObject(rawText));
}

function jsonObjectCandidates(rawText) {
  const text = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  const balanced = balancedJsonObjects(text);
  const naive = text.includes('{') && text.lastIndexOf('}') > text.indexOf('{')
    ? [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
    : [];
  return [...fenced, ...balanced, ...naive].filter((candidate) => candidate && candidate.trim().startsWith('{'));
}

function firstParsedJsonObject(rawText) {
  for (const candidate of jsonObjectCandidates(rawText)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue to the tolerant text parser.
    }
  }
  return null;
}

function storybookParseError(missing) {
  return Object.assign(
    new Error(`Gemini response is incomplete or invalid. Missing sections: ${missing.join(', ')}. Please retry.`),
    { code: 'STORYBOOK_PARSING_FAILED' }
  );
}

/** Stage 1: create only the durable story idea/blueprint in the main conversation. */
function buildStorybookBlueprintPrompt(input = {}) {
  return [
    "You are helping plan a children's storybook. Read each supplied field separately and use only fields that are present.",
    '',
    'BOOK INPUT',
    ...storybookInputLines(input),
    '',
    'STAGE 1 — STORY IDEA AND BLUEPRINT ONLY',
    'Develop one coherent story concept with a clear beginning, middle, ending, tone, setting, visual direction, and moral appropriate for the requested age and language.',
    'If a real-person photo was supplied, only remember that the person will become the first/main cartoon character later. Do not create or describe character image prompts yet.',
    'Do not create characters, character prompts, page text, page prompts, a front cover, a back cover, or images in this stage.',
    'Return ONLY one valid JSON object with exactly these keys:',
    '{"title":"Final book title","storyIdea":"One concise approved story idea","blueprint":"Approved beginning, middle, ending, tone, setting, visual direction, and moral"}'
  ].join('\n');
}

function parseStorybookBlueprintResponse(rawText) {
  const parsed = firstParsedJsonObject(rawText);
  let title = cleanPromptSection(parsed?.title ?? parsed?.bookTitle ?? '');
  let storyIdea = cleanPromptSection(parsed?.storyIdea ?? parsed?.idea ?? parsed?.summary ?? '');
  let blueprint = cleanPromptSection(parsed?.blueprint ?? parsed?.storyBlueprint ?? '');
  if (!parsed) {
    const text = String(rawText ?? '').replace(/\*\*/g, '').replace(/__/g, '');
    title = cleanPromptSection(text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:Book\s+)?Title\s*:\s*(.+)/i)?.[1] ?? '');
    storyIdea = cleanPromptSection(text.match(/(?:^|\n)\s*(?:[-*]\s*)?Story\s+Idea\s*:\s*([\s\S]*?)(?=\n\s*(?:[-*]\s*)?(?:Story\s+)?Blueprint\s*:|$)/i)?.[1] ?? '');
    blueprint = cleanPromptSection(text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:Story\s+)?Blueprint\s*:\s*([\s\S]*)$/i)?.[1] ?? '');
  }
  const missing = [];
  if (!title) missing.push('Book Title');
  if (!storyIdea) missing.push('Story Idea');
  if (!blueprint) missing.push('Story Blueprint');
  if (missing.length) throw storybookParseError(missing);
  return { title, storyIdea, blueprint, characters: [], pages: [], exactPageText: [], frontCover: '', backCover: '' };
}

/** Stage 2: ask the same main conversation for character cards only. */
function buildStorybookCharactersPrompt(input = {}) {
  const blueprint = cleanPromptSection(input.blueprint ?? input.phase1?.blueprint ?? '');
  const photoInstruction = input.hasPhoto || input.attachmentPath
    ? 'The FIRST record must be the main child/person represented by the supplied real photo. Its prompt should define the story role, clothing, pose, and cartoon styling, explicitly preserve the attached photo identity, and avoid inventing facial, hair, or skin details that must come from that photo during image generation.'
    : 'Put the protagonist first.';
  return [
    'Continue from the approved story idea in this same conversation.',
    '',
    'APPROVED STORY BLUEPRINT',
    blueprint,
    '',
    'STAGE 2 — CHARACTERS ONLY',
    'Identify only the essential recurring characters required by the story.',
    photoInstruction,
    'Give every character exactly one complete standalone full-body cartoon reference prompt with stable visual traits, clothing, colors, proportions, age, and storybook illustration style.',
    'Do not create page text, page prompts, covers, or images in this stage.',
    'Return ONLY one valid JSON object. Put each character in its own record:',
    '{"characters":[{"name":"Character name","prompt":"Complete standalone character reference prompt"}]}'
  ].join('\n');
}

function parseStorybookCharactersResponse(rawText) {
  const parsed = firstParsedJsonObject(rawText);
  let records = Array.isArray(parsed?.characters) ? parsed.characters : [];
  let characters = records.map((record) => ({
    name: cleanPromptSection(record?.name ?? record?.characterName ?? ''),
    prompt: cleanPromptSection(record?.prompt ?? record?.imagePrompt ?? record?.characterPrompt ?? '')
  })).filter((record) => record.name && record.prompt);
  if (records.length && characters.length !== records.length) {
    throw storybookParseError(['A complete name and standalone prompt for every character']);
  }
  if (characters.length === 0) {
    characters = String(rawText ?? '').split('\n').map((line) => {
      const match = line.trim().match(/^(?:[-*]|\d+[.)])?\s*(?:Character\s+Name\s*:\s*)?([^|:]{1,80})\s*\|\s*(?:Image\s+)?Prompt\s*:\s*(.+)$/i);
      return match ? { name: cleanPromptSection(match[1]), prompt: cleanPromptSection(match[2]) } : null;
    }).filter(Boolean);
  }
  if (characters.length === 0) throw storybookParseError(['Character records']);
  return { characters };
}

/** Stage 4: after references exist, ask the main conversation for the official page cards. */
function buildStorybookPagesPrompt(input = {}) {
  const pageCount = Math.max(1, Number.parseInt(input.pageCount, 10) || 10);
  const characters = Array.isArray(input.characters) ? input.characters : [];
  const approvedExactText = Array.isArray(input.approvedExactText) ? input.approvedExactText : [];
  const responseLines = [
    'FRONT COVER | <one complete front-cover image prompt>',
    ...Array.from({ length: pageCount }, (_, index) => `PAGE ${index + 1} | STORY TEXT: <exact one-line page text> | IMAGE PROMPT: <one complete standalone prompt for this page>`),
    'BACK COVER | <one complete back-cover image prompt>'
  ];
  return [
    'Continue in this same main planning conversation. Give me only the complete final image-generation prompts for the whole book.',
    '',
    'APPROVED BOOK TITLE',
    cleanPromptSection(input.title),
    '',
    `BOOK LANGUAGE: ${cleanText(input.language, 'the language already approved in this conversation')}`,
    `TARGET AGE: ${cleanText(input.ageRange, 'the age range already approved in this conversation')}`,
    '',
    'APPROVED STORY BLUEPRINT',
    cleanPromptSection(input.blueprint),
    '',
    'APPROVED CHARACTERS',
    ...characters.map((character, index) => `${index + 1}. ${cleanPromptSection(character.name)} | ${cleanPromptSection(character.prompt)}`),
    ...(approvedExactText.length ? [
      '',
      'APPROVED EXACT PAGE TEXT',
      ...approvedExactText.map((record) => `PAGE ${record.pageNumber}: ${cleanPromptSection(record.storyText).replace(/\s+/g, ' ')}`)
    ] : []),
    '',
    'STAGE 4 — ONE COMPLETE PROMPT PER PHYSICAL LINE',
    `Create exactly ${pageCount + 2} prompts in this order: front cover, Page 1 through Page ${pageCount}, then back cover.`,
    'Each PAGE line must include STORY TEXT and IMAGE PROMPT. The IMAGE PROMPT must be complete and standalone, and must instruct the generator to print the STORY TEXT exactly in the requested language.',
    'Keep recurring character traits consistent with the approved character records. Keep every complete asset prompt on ONE physical line; replace intended story-text line breaks with spaces.',
    'The front-cover prompt must use the exact approved title prominently, contain no invented text, feature the protagonist, match the interior style, and leave author-name space.',
    'The back-cover prompt must continue the same world and visual style, contain no title or story/random text, and leave clear description and barcode areas.',
    'Do not generate images in this stage.',
    'Do NOT return JSON, Markdown, a code fence, headings, explanations, blank lines, or commentary.',
    'Return only the following labeled lines, replacing each angle-bracket description with the complete prompt:',
    ...responseLines,
    `The final response must contain exactly ${pageCount + 2} non-empty physical lines. Every label and every prompt must stay on its own single line.`
  ].join('\n');
}

function storybookPageParseOptions(expectedPageCount) {
  if (expectedPageCount && typeof expectedPageCount === 'object') {
    return {
      pageCount: Math.max(1, Number.parseInt(expectedPageCount.pageCount, 10) || 10),
      approvedExactText: Array.isArray(expectedPageCount.approvedExactText) ? expectedPageCount.approvedExactText : [],
      frontCoverFallback: cleanPromptSection(expectedPageCount.frontCoverFallback)
    };
  }
  return {
    pageCount: Math.max(1, Number.parseInt(expectedPageCount, 10) || 10),
    approvedExactText: [],
    frontCoverFallback: ''
  };
}

function compactStorybookPrompt(value) {
  return cleanPromptSection(value)
    .replace(/^\s*(?:image\s+)?prompt\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStoryTextFromPagePrompt(prompt) {
  const text = String(prompt ?? '');
  const patterns = [
    /(?:exact\s+)?story\s+text(?:\s+to\s+print)?\s*:\s*["“]([\s\S]*?)["”](?=\s+(?:the|place|print|render|use|keep|warm|no)\b|\s*$)/i,
    /exact\s+(?:Arabic\s+)?(?:page\s+)?text\s*:\s*["“]([\s\S]*?)["”](?=\s+(?:the|place|print|render|use|keep|warm|no)\b|\s*$)/i,
    /(?:story\s*text|text\s*to\s*print|exact\s*text)\s*:\s*([^|.]+?)(?=\s*(?:\||image\s*prompt\s*:|illustration\s*prompt\s*:)|$)/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanPromptSection(match[1]).replace(/\\n/g, '\n');
  }
  return '';
}

function validateStorybookPagePackage(candidate, options) {
  const approvedTextByPage = new Map(
    options.approvedExactText
      .map((record) => [Number(record.pageNumber), cleanPromptSection(record.storyText)])
      .filter(([pageNumber, storyText]) => Number.isFinite(pageNumber) && storyText)
  );
  const pages = (Array.isArray(candidate.pages) ? candidate.pages : []).map((page) => ({
    pageNumber: Number(page.pageNumber),
    storyText: approvedTextByPage.get(Number(page.pageNumber))
      || cleanPromptSection(page.storyText)
      || extractStoryTextFromPagePrompt(page.imagePrompt),
    imagePrompt: compactStorybookPrompt(page.imagePrompt)
  })).sort((left, right) => left.pageNumber - right.pageNumber);
  const frontCover = compactStorybookPrompt(candidate.frontCover || options.frontCoverFallback);
  const backCover = compactStorybookPrompt(candidate.backCover);
  const missing = [];
  if (!frontCover) missing.push('Front Cover Prompt');
  if (!backCover) missing.push('Back Cover Prompt');
  if (pages.length !== options.pageCount) missing.push(`Expected ${options.pageCount} page prompts but received ${pages.length}`);
  if (pages.some((page) => !page.imagePrompt)) missing.push('A complete prompt for every page');
  const sequential = pages.length === options.pageCount
    && pages.every((page, index) => page.pageNumber === index + 1);
  if (!sequential) missing.push(`Sequential page numbers 1 through ${options.pageCount}`);
  if (missing.length) throw storybookParseError(missing);
  return {
    frontCover,
    pages,
    backCover,
    exactPageText: pages.filter((page) => page.storyText).map(({ pageNumber, storyText }) => ({ pageNumber, storyText }))
  };
}

function parseStorybookPromptLines(rawText) {
  const lines = String(rawText ?? '').replace(/\r\n/g, '\n').split('\n');
  const candidate = { frontCover: '', pages: [], backCover: '' };
  let current = null;
  const append = (value) => {
    const text = String(value ?? '').trim();
    if (!text || /^```/.test(text) || !current) return;
    current.value = `${current.value} ${text}`.trim();
  };
  for (const sourceLine of lines) {
    const line = sourceLine.trim().replace(/^\*+|\*+$/g, '').trim();
    if (!line || /^```/.test(line)) continue;
    const front = line.match(/^(?:[-*]\s*)?FRONT\s+COVER(?:\s+PROMPT)?\s*(?:\||:|—|–|-)\s*(.+)$/i);
    if (front) {
      current = { type: 'front', value: front[1] };
      candidate.frontCover = current;
      continue;
    }
    const back = line.match(/^(?:[-*]\s*)?BACK\s+COVER(?:\s+PROMPT)?\s*(?:\||:|—|–|-)\s*(.+)$/i);
    if (back) {
      current = { type: 'back', value: back[1] };
      candidate.backCover = current;
      continue;
    }
    const page = line.match(/^(?:[-*]\s*)?(?:PAGE\s*)?(\d+)\s*(?:\||:|—|–|-|\.\s+)\s*(.+)$/i);
    if (page) {
      const payload = page[2];
      const structured = payload.match(/^STORY\s*TEXT\s*:\s*(.*?)\s*\|\s*IMAGE\s*PROMPT\s*:\s*(.+)$/i);
      current = {
        type: 'page',
        pageNumber: Number(page[1]),
        storyText: structured?.[1] ?? '',
        value: structured?.[2] ?? payload
      };
      candidate.pages.push(current);
      continue;
    }
    append(line);
  }
  return {
    frontCover: candidate.frontCover?.value ?? '',
    pages: candidate.pages.map((page) => ({ pageNumber: page.pageNumber, storyText: page.storyText, imagePrompt: page.value })),
    backCover: candidate.backCover?.value ?? ''
  };
}

function decodeLooseJsonText(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function looseJsonField(chunk, fieldName, nextFieldName = null) {
  const key = new RegExp(`["']?${fieldName}["']?\\s*:\\s*`, 'i').exec(chunk);
  if (!key) return '';
  let remainder = chunk.slice(key.index + key[0].length).trim();
  if (remainder.startsWith('"')) remainder = remainder.slice(1);
  if (nextFieldName) {
    const next = new RegExp(`"?\\s*,?\\s*["']?${nextFieldName}["']?\\s*:`, 'i').exec(remainder);
    if (next) remainder = remainder.slice(0, next.index);
  } else {
    const finalQuote = remainder.lastIndexOf('"');
    if (finalQuote !== -1) remainder = remainder.slice(0, finalQuote);
  }
  return decodeLooseJsonText(remainder.replace(/"?\s*,?\s*$/, ''));
}

function parseMalformedStorybookJson(rawText) {
  const text = String(rawText ?? '').replace(/\r\n/g, '\n');
  const pageMarkers = [...text.matchAll(/["']?pageNumber["']?\s*:\s*(\d+)/gi)];
  if (!pageMarkers.length) return { frontCover: '', pages: [], backCover: '' };
  const backMarker = /["']?backCoverPrompt["']?\s*:\s*/i.exec(text);
  const pages = [];
  for (let index = 0; index < pageMarkers.length; index += 1) {
    const marker = pageMarkers[index];
    const start = marker.index;
    const end = pageMarkers[index + 1]?.index ?? backMarker?.index ?? text.length;
    const chunk = text.slice(start, end);
    pages.push({
      pageNumber: Number(marker[1]),
      storyText: looseJsonField(chunk, 'storyText', 'imagePrompt'),
      imagePrompt: looseJsonField(chunk, 'imagePrompt')
    });
  }
  const parsed = firstParsedJsonObject(rawText);
  const frontCover = cleanPromptSection(
    parsed?.frontCoverPrompt
    ?? parsed?.frontCover?.imagePrompt
    ?? parsed?.frontCover?.prompt
    ?? parsed?.frontCover
    ?? ''
  );
  const backCover = backMarker ? looseJsonField(text.slice(backMarker.index), 'backCoverPrompt') : '';
  return { frontCover, pages, backCover };
}

function parseStorybookPagesResponse(rawText, expectedPageCount = null) {
  const options = storybookPageParseOptions(expectedPageCount);
  const candidates = [];
  const lineCandidate = parseStorybookPromptLines(rawText);
  if (lineCandidate.pages.length || lineCandidate.frontCover || lineCandidate.backCover) candidates.push(lineCandidate);
  const parsed = firstParsedJsonObject(rawText);
  if (parsed) {
    candidates.push({
      frontCover: parsed.frontCoverPrompt ?? parsed.frontCover?.imagePrompt ?? parsed.frontCover?.prompt ?? parsed.frontCover ?? '',
      pages: (Array.isArray(parsed.pages) ? parsed.pages : []).map((page, index) => ({
        pageNumber: Number(page.pageNumber ?? page.page ?? page.number ?? index + 1),
        storyText: page.storyText ?? page.exactPageText ?? page.text ?? '',
        imagePrompt: page.imagePrompt ?? page.prompt ?? page.illustrationPrompt ?? ''
      })),
      backCover: parsed.backCoverPrompt ?? parsed.backCover?.imagePrompt ?? parsed.backCover?.prompt ?? parsed.backCover ?? ''
    });
  }
  const malformedJson = parseMalformedStorybookJson(rawText);
  if (malformedJson.pages.length) candidates.push(malformedJson);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return validateStorybookPagePackage(candidate, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? storybookParseError([`Front cover, ${options.pageCount} page prompts, and back cover in one-line format`]);
}

function buildStorybookPromptPhase2(input) {
  const pageCount = input.pageCount || '10';
  const phase1 = input.phase1 && typeof input.phase1 === 'object' ? input.phase1 : {};
  const exactPageText = Array.isArray(phase1.exactPageText) ? phase1.exactPageText : [];
  const characters = Array.isArray(phase1.characters) ? phase1.characters : [];
  const approvedPackage = [
    'APPROVED STORY BLUEPRINT (VERBATIM)',
    cleanPromptSection(phase1.blueprint),
    '',
    'APPROVED EXACT PAGE TEXT (VERBATIM)',
    ...exactPageText.map((record) => `Page ${record.pageNumber}: ${cleanPromptSection(record.storyText)}`),
    '',
    'APPROVED CHARACTERS',
    ...characters.map((character) => `${character.name}: ${character.prompt}`),
    '',
    'APPROVED FRONT COVER PROMPT',
    cleanPromptSection(phase1.frontCover)
  ].filter((line) => line !== '').join('\n');
  return [
    'Using the approved Story Blueprint, characters, and front cover concept from your immediately previous response, generate the rest of the book\'s illustration prompts.',
    'The complete approved Phase 1 package is repeated below so this request remains deterministic even if conversation history is temporarily unavailable.',
    'Do not rewrite, shorten, expand, translate, or paraphrase the approved Exact Page Text.',
    '',
    approvedPackage,
    '',
    '## REQUIRED OUTPUT',
    `Generate one AI image prompt for every page (total ${pageCount} pages).`,
    'Return ONLY one valid JSON object. Do not use Markdown fences, headings, introductions, or commentary.',
    'Use this exact JSON structure:',
    '{',
    '  "pages": [',
    '    { "pageNumber": 1, "storyText": "Copy the approved exact text verbatim", "imagePrompt": "Complete standalone illustration prompt" }',
    '  ],',
    '  "backCoverPrompt": "Complete standalone back cover image prompt"',
    '}',
    '',
    `Repeat the page object for every page through Page ${pageCount}. Every page object must contain pageNumber, storyText, and imagePrompt. The pages array must contain exactly the requested number of records.`,
    'For the backCoverPrompt:',
    'Requirements:',
    '- Match the exact illustration style, color palette, lighting, and mood of the front cover.',
    '- Use the same characters only if necessary.',
    '- Create a clean, simple composition that complements the front cover.',
    '- Leave a large blank area in the center or right side for the book description.',
    '- Leave space at the bottom for the barcode.',
    '- Do NOT include the book title.',
    '- Do NOT include any story text.',
    '- Do NOT include any random text, logos, or watermarks.',
    '- The back cover should visually continue the world shown on the front cover, creating a seamless full-wrap book cover suitable for Amazon KDP.'
  ].join('\n');
}

function parseStorybookResponsePhase2(rawText, expectedPageCount = null) {
  const text = String(rawText ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\*\*/g, '')
    .replace(/__/g, '');
  let pages = [];
  let backCover = '';
  const jsonCandidates = [
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]),
    text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  ].filter((candidate) => candidate && candidate.trim().startsWith('{'));
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const jsonPages = Array.isArray(parsed.pages)
        ? parsed.pages
        : Array.isArray(parsed.pageIllustrationPrompts) ? parsed.pageIllustrationPrompts : [];
      if (jsonPages.length) {
        pages = jsonPages.map((page, index) => ({
          pageNumber: Number(page.pageNumber ?? page.page ?? page.number ?? index + 1),
          storyText: cleanPromptSection(page.storyText ?? page.exactPageText ?? page.text ?? ''),
          imagePrompt: cleanPromptSection(page.imagePrompt ?? page.prompt ?? page.illustrationPrompt ?? '')
        }));
        backCover = cleanPromptSection(
          parsed.backCoverPrompt
          ?? parsed.backCover?.imagePrompt
          ?? parsed.backCover?.prompt
          ?? parsed.backCover
          ?? ''
        );
        break;
      }
    } catch {
      // Fall through to the tolerant Markdown parser below.
    }
  }

  const backCoverMatch = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+\s*[.)-]\s*)?Back\s+Cover(?:\s+Prompt)?\s*:?\s*([^\n]*)/im.exec(text);
  const pagesEnd = backCoverMatch?.index ?? text.length;
  const pagesText = text.slice(0, pagesEnd);
  const pageHeader = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[-*]\s*)?Page(?:\s+Number)?\s*(?:#\s*)?[:.—–-]?\s*(\d+)\s*:?\s*([^\n]*)/gim;
  const matches = [...pagesText.matchAll(pageHeader)];
  if (pages.length === 0) {
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const chunkStart = match.index + match[0].length;
      const chunkEnd = matches[index + 1]?.index ?? pagesText.length;
      const chunk = [match[2], pagesText.slice(chunkStart, chunkEnd)].filter(Boolean).join('\n').trim();
      const storyMatch = /(?:^|\n)\s*(?:[-*]\s*)?Story\s+Text\s*:\s*([\s\S]*?)(?=\n\s*(?:[-*]\s*)?(?:Image\s+)?Prompt\s*:|$)/i.exec(chunk);
      const imageMatch = /(?:^|\n)\s*(?:[-*]\s*)?(?:Image\s+)?Prompt\s*:\s*([\s\S]*)$/i.exec(chunk);
      const storyText = cleanPromptSection(storyMatch?.[1] ?? '');
      const imagePrompt = cleanPromptSection(imageMatch?.[1] ?? '');
      if (storyText || imagePrompt) {
        pages.push({
          pageNumber: Number(match[1]),
          storyText,
          imagePrompt
        });
      }
    }
  }

  if (!backCover && backCoverMatch) {
    backCover = cleanPromptSection([backCoverMatch[1], text.slice(backCoverMatch.index + backCoverMatch[0].length)].filter(Boolean).join('\n'));
  }

  const missing = [];
  if (pages.length === 0) missing.push('Page Illustration Prompts');
  if (!backCover) missing.push('Back Cover Prompt');
  const expected = Number.parseInt(expectedPageCount, 10);
  if (Number.isFinite(expected) && expected > 0 && pages.length !== expected) {
    missing.push(`Expected ${expected} page records but received ${pages.length}`);
  }
  if (pages.some((page) => !page.storyText || !page.imagePrompt)) {
    missing.push('Story Text + Image Prompt pairs');
  }
  if (missing.length) {
    throw Object.assign(
      new Error(`Gemini response is incomplete or invalid. Missing sections: ${missing.join(', ')}. Please retry or refine your inputs.`),
      { code: 'STORYBOOK_PARSING_FAILED' }
    );
  }

  pages.sort((left, right) => left.pageNumber - right.pageNumber);

  return {
    pages,
    backCover,
    exactPageText: pages.map(({ pageNumber, storyText }) => ({ pageNumber, storyText }))
  };
}

function buildStorybookJobs(input) {
  const projectToken = cleanText(input.projectToken, randomUUID().split('-')[0]).toUpperCase();
  const conversationUrl = input.conversationUrl ?? null;
  const pages = Array.isArray(input.pages) ? [...input.pages].sort((left, right) => left.pageNumber - right.pageNumber) : [];
  const records = [
    {
      kind: 'front_cover',
      title: 'Front Cover',
      storyText: '',
      imagePrompt: cleanPromptSection(input.frontCover),
      fileStem: 'front_cover'
    },
    ...pages.map((page) => ({
      kind: 'story_page',
      title: `Story Page ${page.pageNumber}`,
      storyText: cleanPromptSection(page.storyText),
      imagePrompt: cleanPromptSection(page.imagePrompt),
      fileStem: `story_page_${padPage(page.pageNumber)}`
    })),
    {
      kind: 'back_cover',
      title: 'Back Cover',
      storyText: '',
      imagePrompt: cleanPromptSection(input.backCover),
      fileStem: 'back_cover'
    }
  ];

  if (!records[0].imagePrompt || !records.at(-1).imagePrompt || pages.length === 0) {
    throw Object.assign(new Error('The storybook package is missing a cover or story pages.'), { code: 'STORYBOOK_JOBS_INVALID' });
  }

  return records.map((record, index) => {
    const pageNumber = index + 1;
    const prompt = record.storyText
      ? [
          'Create one official illustrated storybook page using the approved package below.',
          `Story Text (render exactly, preserving every word): ${record.storyText}`,
          `Image Prompt: ${record.imagePrompt}`,
          'The printed story text must remain readable and must not be rewritten or supplemented.'
        ].join('\n\n')
      : record.imagePrompt;
    return {
      id: randomUUID(),
      pageNumber,
      pageLabel: `${projectToken}-P${padPage(pageNumber)}`,
      kind: record.kind,
      title: record.title,
      prompt,
      storyText: record.storyText,
      imagePrompt: record.imagePrompt,
      fileName: `${padPage(pageNumber)}_${record.fileStem}.png`,
      status: 'pending',
      attempts: 0,
      conversationUrl
    };
  });
}

const THUMBNAIL_NO_COLLAGE = [
  'CRITICAL OUTPUT RULE: produce exactly ONE single 2000x2000 hero listing graphic.',
  'Do NOT create a collage, 2x2 grid, contact sheet, moodboard, page fan, station grid, or any combination of multiple page pictures.',
  'Do NOT stitch, tile, or composite multiple worksheet scans into one image.',
  'Show the product as one mockup scene only (one cover or one page in a realistic frame/desk/device).'
].join(' ');

const THUMBNAIL_RULES = [
  '1 HERO — What is it? Large thumbnail-readable hand-lettered title; subtitle; accurate page-count badge; one unaltered cover or main page in a single mockup frame; relevant props/background; three short selling points; brand. Hierarchy: title -> product -> badge -> benefits/brand.',
  '2 SKILLS — What do they learn? Three-word action headline; ONE unaltered page or finished example in a single frame; four colorful circular hand-drawn-outline benefit badges; short VERIFIED benefits; clean white + breathing space; brand.',
  '3 HOW IT WORKS — How is it used? Process headline; 3-4 numbered steps as icons/short text matching ACTUAL product steps; diverse students/hands optional; ONE unaltered page in a single frame; branded footer. Never show cut/fold/laminate/assemble unless the product requires it.',
  '4 FEATURES — Why buy? Strongest VERIFIED feature banner; the product on one side as a single mockup; 3-4 checkmark benefits; outcome banner; brand. Short copy. Never a contact sheet.'
];

const THUMBNAIL_COORDINATION = 'Coordinated collection: square 2000x2000; bright classroom colors; large rounded HAND-LETTERED display (not sterile UI sans); strong contrast; white outlines/soft shadows on added type; crisp paper edges; natural light. Avoid tiny headlines, long paragraphs, overcrowding, four identical comps, distorted text/hands, copied seller designs, collages, 2x2 grids, contact sheets, page fans, and station grids.';

function buildTptThumbnailImagePrompt({ index = 0, title = '', brief = '' } = {}) {
  const thumbnailNumber = Number(index) + 1;
  const specificRule = THUMBNAIL_RULES[index % 4] || '';
  return resolvePromptText('mockupThumbnail', {
    thumbnailNumber,
    title,
    brief,
    specificRule,
    coordination: THUMBNAIL_COORDINATION,
    noCollage: THUMBNAIL_NO_COLLAGE
  }, () => [
    `Create thumbnail ${thumbnailNumber} of 4 for this Teachers Pay Teachers product.`,
    `Product title: ${title}.`,
    `Creative direction: ${brief}`,
    '=== THE FOUR MOCKUPS RULES ===',
    `Rule for this specific thumbnail: ${specificRule}`,
    THUMBNAIL_COORDINATION,
    THUMBNAIL_NO_COLLAGE,
    '==============================',
    'The attached files are the REAL product: page images and/or a Word document of this book. Put those exact pages inside this Mockups Gem’s standard mockup frames.',
    'Do not invent pages. Do not remix, shuffle, or combine random pages from memory. Never treat attached pages as tiles in a collage.',
    'Render one listing thumbnail from the inner mockup templates using the attached book art.',
    'Generate an image of exactly one polished 2000x2000 TPT hero thumbnail now. No watermark. No variations. No questions.'
  ].join('\n'));
}

function buildTptThumbnailRetryPrompt({ index = 0 } = {}) {
  const thumbnailNumber = Number(index) + 1;
  return resolvePromptText('mockupRetry', {
    thumbnailNumber,
    noCollage: THUMBNAIL_NO_COLLAGE
  }, () => [
    `Generate Thumbnail ${thumbnailNumber} now.`,
    'Use this Mockups Gem’s built-in TPT mockup style and the attached real book pages or Word document.',
    THUMBNAIL_NO_COLLAGE,
    'Generate an image of exactly one polished 2000x2000 TPT hero thumbnail now. No collage. No 2x2 grid. No watermark. No variations. No questions.'
  ].join('\n'));
}


const PREVIEW_CLIP_BRIEFS = [
  'Segment 1 of 3: exactly 8 seconds. Open on the listing mockups and the front cover. Show the product identity only.',
  'Segment 2 of 3: exactly 8 seconds. Move through the attached interior pages and the activity flow. Keep on-screen text short.',
  'Segment 3 of 3: exactly 8 seconds. Close on classroom use and the back page. End cleanly.'
];

function buildTptPreviewVideoPrompt(options = {}) {
  // Default single-clip sentence is verbatim so Veo generates instead of planning.
  const base = 'generate a preview video for this tpt product, best seller preview';
  const clips = Math.max(1, Number(options?.clipCount) || 1);
  const index = Math.min(PREVIEW_CLIP_BRIEFS.length - 1, Math.max(0, Number(options.clipIndex) || 0));
  const seconds = Math.max(1, Number(options.clipSeconds) || 8);
  const clipBrief = clips <= 1 ? '' : PREVIEW_CLIP_BRIEFS[index];
  const clipLength = clips <= 1 ? '' : `Length exactly ${seconds} seconds. Landscape 16:9 MP4. Generate the preview video now with Veo 3.`;
  return resolvePromptText('previewVideo', {
    base,
    clipBrief,
    clipLength,
    seconds
  }, () => {
    if (clips <= 1) return base;
    return [base, clipBrief, clipLength].join('\n');
  });
}

function mergeApprovedStoryText(pages, approvedExactText) {
  const approvedTextByPage = new Map(
    (Array.isArray(approvedExactText) ? approvedExactText : [])
      .map((record) => [Number(record.pageNumber), cleanPromptSection(record.storyText)])
      .filter(([, storyText]) => Boolean(storyText))
  );
  return (Array.isArray(pages) ? pages : []).map((page) => ({
    ...page,
    storyText: approvedTextByPage.get(Number(page.pageNumber)) || cleanPromptSection(page.storyText)
  }));
}

module.exports = {
  ACTIVITIES,
  STANDARD_GEMINI_URL,
  CONTENT_PLANNING_GEM_URL,
  CONTENT_GEM_URL,
  MOCKUPS_GEM_URL,
  CONTENT_GPT_URL,
  MOCKUPS_GPT_URL,
  SEO_GPT_URL,
  SEO_GEM_URL,
  buildMockupJobs,
  withMockupStage,
  FORMAT_INSTRUCTIONS,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  analysisResponseReady,
  tryParseAnalysisObject,
  inferProductFormat,
  buildPromptsGenerationRequest,
  parseGeneratedPrompts,
  parseEditablePageBlueprint,
  looksLikePageImagePrompt,
  buildBookJobs,
  buildImportedJobs,
  cleanText,
  ensureImagePrefix,
  formatInstruction,
  normalizeOrientation,
  padPage,
  splitPromptBlocks,
  slugify,
  buildStorybookPrompt,
  parseStorybookResponse,
  buildStorybookBlueprintPrompt,
  parseStorybookBlueprintResponse,
  buildStorybookCharactersPrompt,
  parseStorybookCharactersResponse,
  buildStorybookPagesPrompt,
  parseStorybookPagesResponse,
  buildStorybookPromptPhase2,
  parseStorybookResponsePhase2,
  buildStorybookJobs,
  mergeApprovedStoryText
  ,isSeoSkipStub
  ,sanitizeSeoListingFields
  ,formatSeoBundleText
  ,parseSeoBundleText
  ,COMPETITOR_MOCKUP_VISION_RULES
  ,buildTptThumbnailImagePrompt
  ,buildTptThumbnailRetryPrompt
  ,buildTptPreviewVideoPrompt
  ,PREVIEW_CLIP_BRIEFS
  ,PROMPT_BATCH_SIZE
  ,promptPageBatches
  ,resolvePromptPageRange
  ,buildPromptsContinuationRequest
  ,inspectGeneratedPromptProgress
  ,estimatePromptProgressFromSample
  ,mergeGeneratedPromptSlots
  ,densePromptPrefix
};
