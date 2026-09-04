'use strict';

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeProductPipeline(project, liveOp = null, options = {}) {
  const stats = project?.stats || { total: 0, complete: 0, remaining: 0, percent: 0 };
  const pagePercent = clampPercent(stats.percent);
  const characters = project?.highlights && typeof project.highlights === 'object' && Array.isArray(project.highlights.characters)
    ? project.highlights.characters
    : [];
  const characterSheets = Array.isArray(project?.characterSheets) ? project.characterSheets : [];
  const characterReady = characterSheets.filter((sheet) => sheet.status === 'complete' && sheet.outputPath).length;
  // Characters stage removed from product progress — keep sheets for storybook data only.
  const characterPct = 100;
  const editable = project?.productFormat === 'editable';
  const listing = project?.tptListing || null;
  const thumbnailCount = (listing?.thumbnailPaths || []).filter(Boolean).length;
  const listingReady = Boolean(listing?.title);
  const reviewApproved = Boolean(listing?.reviewApproved || listing?.sellerApproved);
  const uploadReady = reviewApproved || ['ready_to_upload', 'uploading_listing', 'listing_form_ready', 'submitting_listing', 'draft_submitted', 'listing_published', 'upload_browser_open'].includes(listing?.status);
  const vectorDone = project?.stepEditableStatus === 'completed'
    || Boolean(project?.canvaExportPath)
    || (typeof project?.canvaTemplateLink === 'string' && project.canvaTemplateLink.length > 0);
  const canvaPct = liveOp?.kind === 'canva' ? clampPercent(liveOp.percent) : vectorDone ? 100 : 0;
  const listingPct = liveOp?.kind === 'listing' ? clampPercent(liveOp.percent) : listingReady ? 100 : 0;
  const thumbPct = liveOp?.kind === 'thumbnails' ? clampPercent(liveOp.percent) : clampPercent((thumbnailCount / 4) * 100);
  const previewPct = liveOp?.kind === 'preview'
    ? clampPercent(liveOp.percent)
    : listing?.videoPreviewPath ? 100 : listing?.videoPreviewStatus === 'generating' ? 40 : 0;
  const pagesDone = stats.total > 0 && stats.complete === stats.total;
  let exportPct = pagePercent;
  if (pagesDone) exportPct = uploadReady ? 100 : listingReady ? 70 : 55;

  const weighted = [];
  weighted.push({ id: 'interior', label: 'Book interior', pct: pagePercent, weight: 34 });
  if (editable) weighted.push({ id: 'editable', label: 'Canva editable', pct: canvaPct, weight: 10 });
  weighted.push({ id: 'thumbnails', label: 'Mockups', pct: thumbPct, weight: 24 });
  weighted.push({ id: 'listing', label: 'SEO', pct: listingPct, weight: 24 });

  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const percent = clampPercent(weighted.reduce((sum, item) => sum + item.pct * item.weight, 0) / weightSum);

  const openStages = [];
  if (pagePercent < 100) openStages.push({ id: 'interior', label: 'Book interior' });
  if (editable && canvaPct < 100) openStages.push({ id: 'editable', label: 'Canva editable' });
  if (thumbPct < 100) openStages.push({ id: 'thumbnails', label: 'Mockups' });
  if (previewPct < 100) openStages.push({ id: 'preview', label: 'Preview video' });
  if (exportPct < 100) openStages.push({ id: 'export', label: 'Export' });
  if (listingPct < 100) openStages.push({ id: 'listing', label: 'SEO' });

  const requiredOpen = openStages.filter((stage) => !['preview', 'export'].includes(stage.id));
  const nextView = (requiredOpen[0] || openStages[0] || { id: 'export' }).id;

  return {
    percent,
    pagePercent,
    characterPct,
    canvaPct,
    listingPct,
    thumbPct,
    previewPct,
    exportPct,
    thumbnailCount,
    listingReady,
    pagesDone,
    editable,
    openStages,
    requiredOpen,
    nextView,
    complete: requiredOpen.length === 0 && percent >= 100
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clampPercent, computeProductPipeline };
}
if (typeof window !== 'undefined') {
  window.computeProductPipeline = computeProductPipeline;
}
