'use strict';

/**
 * Decides whether an analysed listing is an editable product or a static printable.
 *
 * The analysis gem is asked for a productFormat, but it often omits the field. Falling
 * back to 'static' silently sent editable books down the print pipeline, so the listing
 * text itself is scored here instead. Signals are weighted: an explicit file format is
 * worth more than a marketing adjective.
 */

const EDITABLE_SIGNALS = [
  [/\beditable\b/i, 5],
  [/\bpower\s?point\b|\bpptx?\b/i, 5],
  [/\bgoogle\s+slides?\b/i, 5],
  [/\bgoogle\s+docs?\b/i, 4],
  [/\bmicrosoft\s+word\b|\bdocx\b/i, 4],
  [/\bcustomi[sz]able\b/i, 3],
  [/\btype\s+(?:in|your\s+own)\b/i, 3],
  [/\badd\s+your\s+own\s+(?:text|words|names?)\b/i, 3],
  [/\bedit\s+the\s+text\b/i, 3],
  [/\bfully\s+editable\b/i, 5],
  [/\btemplates?\b/i, 2],
  [/\bdigital\s+resource\b/i, 1]
];

const STATIC_SIGNALS = [
  [/\bprint\s*(?:and|&|-)\s*go\b/i, 3],
  [/\bno\s*[- ]?prep\b/i, 2],
  [/\bprintable\s+only\b/i, 4],
  [/\bnot\s+editable\b/i, 6],
  [/\bpdf\s+only\b/i, 5],
  [/\bnon-?editable\b/i, 6]
];

const MAZE_SIGNALS = [
  [/\bmazes?\b/i, 6],
  [/\blabyrinths?\b/i, 5],
  [/\bmaze\s+book\b/i, 6],
  [/\bmaze\s+puzzles?\b/i, 5],
  [/\banswer\s+key\b.*\bmaze|\bmaze\b.*\banswer\s+key\b/i, 3]
];

const THRESHOLD = 4;

function harvest(listing) {
  if (!listing || typeof listing !== 'object') return '';
  const parts = [];
  const push = (value) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(push);
  };
  push(listing.title);
  push(listing.concept);
  push(listing.description);
  push(listing.keyHighlights);
  push(listing.highlights);
  push(listing.formats);
  push(listing.fileTypes);
  push(listing.rawText);
  push(listing.trendMetadata?.title);
  return parts.join('\n');
}

function score(text) {
  let editable = 0;
  let staticScore = 0;
  let maze = 0;
  const matched = [];
  for (const [pattern, weight] of EDITABLE_SIGNALS) {
    if (pattern.test(text)) {
      editable += weight;
      matched.push(pattern.source);
    }
  }
  for (const [pattern, weight] of STATIC_SIGNALS) {
    if (pattern.test(text)) staticScore += weight;
  }
  for (const [pattern, weight] of MAZE_SIGNALS) {
    if (pattern.test(text)) {
      maze += weight;
      matched.push(pattern.source);
    }
  }
  return { editable, staticScore, maze, matched };
}

/**
 * @returns {{ productFormat: 'editable'|'static'|'maze', source: string, editableScore: number, staticScore: number, mazeScore: number, matched: string[] }}
 */
function detectProductFormat(analysis, listing = null) {
  const declared = String(analysis?.productFormat || '').trim().toLowerCase();
  const text = `${harvest(analysis)}\n${harvest(listing)}`;
  const { editable, staticScore, maze, matched } = score(text);
  // A gem that can only emit static/editable must not hide maze titles or keywords.
  if (maze >= THRESHOLD) {
    const productFormat = 'maze';
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H5',location:'src/product-format-detector.cjs:detectProductFormat',message:'listing-signal scores',data:{productFormat,editable,staticScore,maze,matched,harvestPreview:text.slice(0,220)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return {
      productFormat: 'maze',
      source: declared === 'maze' ? 'analysis' : 'listing-signals',
      editableScore: editable,
      staticScore,
      mazeScore: maze,
      matched
    };
  }
  if (declared === 'editable' || declared === 'static' || declared === 'maze') {
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H1',location:'src/product-format-detector.cjs:detectProductFormat',message:'declared analysis format won before maze scoring',data:{declared,title:analysis?.title||listing?.title||'',keyword:listing?.keyword||listing?.trendMetadata?.query||''},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return { productFormat: declared, source: 'analysis', editableScore: 0, staticScore: 0, mazeScore: 0, matched: [] };
  }
  const productFormat = editable >= THRESHOLD && editable > staticScore ? 'editable' : 'static';
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'pre-fix',hypothesisId:'H5',location:'src/product-format-detector.cjs:detectProductFormat',message:'listing-signal scores',data:{productFormat,editable,staticScore,maze,matched,harvestPreview:text.slice(0,220)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return { productFormat, source: 'listing-signals', editableScore: editable, staticScore, mazeScore: maze, matched };
}

module.exports = { detectProductFormat, THRESHOLD };
