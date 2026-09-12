'use strict';

/**
 * Phase 3C — SEO state isolation (compatibility layer)
 *
 * Persistence (no schema change):
 *   Migration target: tptListing.seo = {
 *     title, description, tags, seoText, highlights, grades, subjects, formats,
 *     customCategories, pageCount, teachingDuration, answerKey, standards,
 *     rawResponse, conversationUrl, seoDocumentPath, listingDetailsPath
 *   }
 *   Legacy mirror: same keys flat on tptListing
 *
 * Dual-write: every intentional SEO write updates BOTH representations.
 * Dual-read: getSeo() reconciles; new state is NOT yet sole authority.
 *
 * Reconciliation rule (documented + tested):
 *   1. Prefer new tptListing.seo when it contains meaningful data for a field.
 *   2. If new SEO state is absent, reconstruct from legacy flat fields.
 *   3. If both exist, merge conservatively field-by-field (meaningful wins).
 *   4. Do not fabricate SEO fields.
 *   5. Empty/null new values must not silently erase meaningful legacy values.
 *   6. Preserve existing types and structures.
 *   7. Completion requires title + description + tags (not title alone).
 *      Automation verifier additionally requires subjects (existing semantics).
 */

const SEO_KEYS = [
  'title',
  'description',
  'tags',
  'seoText',
  'highlights',
  'grades',
  'subjects',
  'formats',
  'customCategories',
  'pageCount',
  'teachingDuration',
  'answerKey',
  'standards',
  'rawResponse',
  'conversationUrl',
  'seoDocumentPath',
  'listingDetailsPath'
];

function emptyStandards() {
  return { ccss: [], ngss: [], teks: [], vaSol: [] };
}

function emptySeo() {
  return {
    title: '',
    description: '',
    tags: [],
    seoText: '',
    highlights: [],
    grades: [],
    subjects: [],
    formats: [],
    customCategories: [],
    pageCount: 0,
    teachingDuration: '',
    answerKey: '',
    standards: emptyStandards(),
    rawResponse: null,
    conversationUrl: null,
    seoDocumentPath: null,
    listingDetailsPath: null
  };
}

function isEmptySeoValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
  if (typeof value === 'object') {
    return Object.values(value).every((entry) => isEmptySeoValue(entry));
  }
  return false;
}

function cloneStandards(standards) {
  const source = standards && typeof standards === 'object' ? standards : {};
  return {
    ccss: Array.isArray(source.ccss) ? [...source.ccss] : [],
    ngss: Array.isArray(source.ngss) ? [...source.ngss] : [],
    teks: Array.isArray(source.teks) ? [...source.teks] : [],
    vaSol: Array.isArray(source.vaSol) ? [...source.vaSol] : []
  };
}

function normalizeSeo(input = {}) {
  return {
    title: typeof input.title === 'string' ? input.title : (input.title == null ? '' : String(input.title)),
    description: typeof input.description === 'string' ? input.description : (input.description == null ? '' : String(input.description)),
    tags: Array.isArray(input.tags) ? [...input.tags] : [],
    seoText: typeof input.seoText === 'string' ? input.seoText : '',
    highlights: Array.isArray(input.highlights) ? [...input.highlights] : [],
    grades: Array.isArray(input.grades) ? [...input.grades] : [],
    subjects: Array.isArray(input.subjects) ? [...input.subjects] : [],
    formats: Array.isArray(input.formats) ? [...input.formats] : [],
    customCategories: Array.isArray(input.customCategories) ? [...input.customCategories] : [],
    pageCount: Math.max(0, Number.parseInt(input.pageCount, 10) || 0),
    teachingDuration: typeof input.teachingDuration === 'string' ? input.teachingDuration : '',
    answerKey: typeof input.answerKey === 'string' ? input.answerKey : '',
    standards: cloneStandards(input.standards),
    rawResponse: input.rawResponse == null ? null : String(input.rawResponse),
    conversationUrl: input.conversationUrl ? String(input.conversationUrl) : null,
    seoDocumentPath: input.seoDocumentPath ? String(input.seoDocumentPath) : null
  };
}

function legacySeoFromListing(listing = {}) {
  return normalizeSeo({
    title: listing.title,
    description: listing.description,
    tags: listing.tags,
    seoText: listing.seoText,
    highlights: listing.highlights,
    grades: listing.grades,
    subjects: listing.subjects,
    formats: listing.formats,
    customCategories: listing.customCategories,
    pageCount: listing.pageCount,
    teachingDuration: listing.teachingDuration,
    answerKey: listing.answerKey,
    standards: listing.standards,
    rawResponse: listing.rawResponse,
    conversationUrl: listing.conversationUrl,
    seoDocumentPath: listing.seoDocumentPath
  });
}

function hasNewSeoState(listing) {
  return Boolean(listing && typeof listing === 'object' && listing.seo && typeof listing.seo === 'object');
}

function preferMeaningful(neuValue, legValue) {
  if (!isEmptySeoValue(neuValue)) return neuValue;
  if (!isEmptySeoValue(legValue)) return legValue;
  // Both empty — keep new shape default (may be [] / '' / 0 / null)
  return neuValue;
}

function mergeSeoStates(neu, leg) {
  const merged = emptySeo();
  for (const key of SEO_KEYS) {
    if (key === 'standards') {
      merged.standards = {
        ccss: preferMeaningful(neu.standards.ccss, leg.standards.ccss),
        ngss: preferMeaningful(neu.standards.ngss, leg.standards.ngss),
        teks: preferMeaningful(neu.standards.teks, leg.standards.teks),
        vaSol: preferMeaningful(neu.standards.vaSol, leg.standards.vaSol)
      };
      continue;
    }
    if (key === 'pageCount') {
      merged.pageCount = !isEmptySeoValue(neu.pageCount) ? neu.pageCount
        : (!isEmptySeoValue(leg.pageCount) ? leg.pageCount : 0);
      continue;
    }
    merged[key] = preferMeaningful(neu[key], leg[key]);
  }
  return normalizeSeo(merged);
}

function seoHasMeaningfulContent(seo) {
  const normalized = normalizeSeo(seo);
  return SEO_KEYS.some((key) => {
    if (key === 'pageCount') return normalized.pageCount > 0;
    return !isEmptySeoValue(normalized[key]);
  });
}

/**
 * Read SEO state with legacy fallback + conservative merge.
 * Does not mutate the project.
 */
function getSeo(project) {
  const listing = project?.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {};
  const legacy = legacySeoFromListing(listing);
  if (!hasNewSeoState(listing)) {
    return legacy;
  }
  const neu = normalizeSeo(listing.seo);
  if (!seoHasMeaningfulContent(neu)) {
    return legacy;
  }
  return mergeSeoStates(neu, legacy);
}

/**
 * Dual-write SEO into a listing object (nested + legacy flat fields).
 * listingExtras may include non-SEO listing fields (status, marketplace, etc.).
 */
function applySeoToListing(listing, seoPatch = {}, listingExtras = {}) {
  const base = listing && typeof listing === 'object' ? { ...listing } : {};
  const current = getSeo({ tptListing: base });
  const nextPatch = {};
  for (const key of SEO_KEYS) {
    if (Object.prototype.hasOwnProperty.call(seoPatch, key)) {
      nextPatch[key] = seoPatch[key];
    }
  }
  const next = normalizeSeo({ ...current, ...nextPatch });

  const dual = {
    ...base,
    ...listingExtras,
    seo: next
  };
  for (const key of SEO_KEYS) {
    dual[key] = next[key];
  }
  return dual;
}

/**
 * Ensure both representations exist after an external listing mutation
 * that may have touched only legacy SEO fields (or only seo).
 */
function mirrorSeoOnListing(listing) {
  if (!listing || typeof listing !== 'object') return listing;
  return applySeoToListing(listing, getSeo({ tptListing: listing }));
}

function setSeo(store, projectId, seo, {
  listingExtras = {},
  projectExtras = {}
} = {}) {
  const project = store.getProject(projectId);
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  const listing = applySeoToListing(project.tptListing, seo, listingExtras);
  return store.updateProject(projectId, {
    tptListing: listing,
    ...projectExtras
  });
}

function updateSeo(store, projectId, patch, options = {}) {
  const project = store.getProject(projectId);
  if (!project) {
    throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
  }
  const current = getSeo(project);
  return setSeo(store, projectId, { ...current, ...patch }, options);
}

/**
 * Content completeness for SEO stage: title + description + tags.
 * Does NOT treat Boolean(title) alone as complete.
 */
function isSeoContentComplete(projectOrSeo) {
  const looksLikeProject = Boolean(
    projectOrSeo
    && typeof projectOrSeo === 'object'
    && (Object.prototype.hasOwnProperty.call(projectOrSeo, 'tptListing')
      || Object.prototype.hasOwnProperty.call(projectOrSeo, 'id')
      || Object.prototype.hasOwnProperty.call(projectOrSeo, 'outputDir'))
  );
  const seo = looksLikeProject ? getSeo(projectOrSeo) : normalizeSeo(projectOrSeo || {});
  return Boolean(seo.title && seo.description && Array.isArray(seo.tags) && seo.tags.length);
}

/**
 * Existing automation verifier semantics: title + description + subjects + tags.
 */
function isSeoAutomationComplete(project) {
  const seo = getSeo(project);
  return Boolean(
    seo.title
    && seo.description
    && Array.isArray(seo.tags) && seo.tags.length
    && Array.isArray(seo.subjects) && seo.subjects.length
  );
}

function enrichProjectWithSeo(project) {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    seo: getSeo(project)
  };
}

function pickSeoFieldsFromObject(source = {}) {
  const picked = {};
  for (const key of SEO_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      picked[key] = source[key];
    }
  }
  return picked;
}

module.exports = {
  SEO_KEYS,
  emptySeo,
  normalizeSeo,
  getSeo,
  applySeoToListing,
  mirrorSeoOnListing,
  setSeo,
  updateSeo,
  isSeoContentComplete,
  isSeoAutomationComplete,
  enrichProjectWithSeo,
  legacySeoFromListing,
  hasNewSeoState,
  isEmptySeoValue,
  pickSeoFieldsFromObject,
  seoHasMeaningfulContent
};
