'use strict';

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function readMockupPaths(project) {
  if (typeof projectMockups === 'function') {
    return projectMockups(project).paths || [];
  }
  const listing = project?.tptListing || {};
  if (project?.mockups?.paths) return project.mockups.paths;
  if (listing.mockups?.paths) return listing.mockups.paths;
  return listing.thumbnailPaths || [];
}

function projectMarketplace(project) {
  if (typeof window !== "undefined" && typeof window.projectMarketplace === "function" && window.projectMarketplace !== projectMarketplace) return window.projectMarketplace(project);
  const listing = project?.tptListing || {};
  const m = listing.marketplace || {};
  const r = m.review || {};
  return {
    settings: m.settings || {},
    upload: m.upload || {},
    review: {
      approved: r.approved !== undefined ? r.approved : listing.reviewApproved,
      sellerApproved: r.sellerApproved !== undefined ? r.sellerApproved : listing.sellerApproved
    }
  };
}

function readVideoState(project) {
  if (typeof projectVideo === 'function') {
    return projectVideo(project);
  }
  const listing = project?.tptListing || {};
  if (project?.video && typeof project.video === 'object') return project.video;
  if (listing.video && typeof listing.video === 'object') {
    return {
      path: listing.video.path || listing.videoPreviewPath || null,
      status: listing.video.status || listing.videoPreviewStatus || 'pending'
    };
  }
  return {
    path: listing.videoPreviewPath || null,
    status: listing.videoPreviewStatus || (listing.videoPreviewPath ? 'ready' : 'pending')
  };
}


function projectPdf(project) {
  if (typeof window !== "undefined" && typeof window.projectPdf === "function" && window.projectPdf !== projectPdf) return window.projectPdf(project);
  const meta = (project?.printPdfJson && typeof project.printPdfJson === 'object') ? project.printPdfJson : {};
  const productPath = meta.productPdfPath ?? project?.productPdfPath ?? project?.tptListing?.productPdfPath ?? null;
  const compressedPath = meta.compressedPdfPath ?? project?.compressedPdfPath ?? null;
  const thankYouPath = meta.thankYouPdfPath ?? project?.thankYouPdfPath ?? null;
  return { productPath, compressedPath, thankYouPath, metadata: meta };
}

function computeProductPipeline(project, liveOp = null, options = {}) {
  void options;
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
  const maze = project?.productFormat === 'maze';
  const listing = project?.tptListing || null;
  const thumbnailCount = (readMockupPaths(project)).filter(Boolean).length;
  const mReview = projectMarketplace(project).review;
  const reviewApproved = Boolean(mReview.approved || mReview.sellerApproved);
  const uploadReady = reviewApproved || ['ready_to_upload', 'uploading_listing', 'listing_form_ready', 'submitting_listing', 'draft_submitted', 'listing_published', 'upload_browser_open'].includes(listing?.status);
  const vectorDone = project?.stepEditableGenerationStatus === 'completed';
  const editablePct = liveOp?.kind === 'editable-generation' ? clampPercent(liveOp.percent) : vectorDone ? 100 : 0;
  const thumbPct = liveOp?.kind === 'thumbnails' ? clampPercent(liveOp.percent) : clampPercent((thumbnailCount / 4) * 100);
  const video = readVideoState(project);
  const previewPct = liveOp?.kind === 'preview'
    ? clampPercent(liveOp.percent)
    : video.path ? 100 : video.status === 'generating' ? 40 : 0;
  const mazePages = Array.isArray(project?.mazeProject?.pages) ? project.mazeProject.pages : [];
  const mazePlanned = Number(project?.mazeLab?.pageCount) || mazePages.length;
  const mazeReady = mazePages.filter((page) => page.generationStatus === 'ready').length;
  const mazePct = liveOp?.kind === 'maze'
    ? clampPercent(liveOp.percent)
    : mazePlanned
      ? clampPercent((mazeReady / mazePlanned) * 100)
      : project?.stepMazeStatus === 'completed' ? 100 : 0;
  const pagesDone = maze
    ? mazePlanned > 0 && mazeReady === mazePlanned
    : stats.total > 0 && stats.complete === stats.total;
  let exportPct = 0;
  if (project?.stepExportStatus === 'completed' || uploadReady) exportPct = 100;
  else if (liveOp?.kind === 'export') exportPct = clampPercent(liveOp.percent);

  // Editable books carry three generation stages instead of one interior stage.
  const textTotal = Number(project?.editableText?.total) || 0;
  const textPct = liveOp?.kind === 'editable-text'
    ? clampPercent(liveOp.percent)
    : textTotal ? clampPercent(((Number(project?.editableText?.ready) || 0) / textTotal) * 100) : 0;

  const weighted = [];
  if (maze) {
    weighted.push({ id: 'maze', label: 'Maze Lab', pct: mazePct, weight: 34 });
  } else if (editable) {
    weighted.push({ id: 'interior_artwork', label: 'Pages Lab', pct: pagePercent, weight: 20 });
    weighted.push({ id: 'interior_text', label: 'Text Lab', pct: textPct, weight: 12 });
    weighted.push({ id: 'editable_ppt', label: 'Editable Lab', pct: editablePct, weight: 12 });
  } else {
    weighted.push({ id: 'interior', label: 'Pages Lab', pct: pagePercent, weight: 34 });
  }
  weighted.push({ id: 'thumbnails', label: 'Mockups Lab', pct: thumbPct, weight: 24 });
  weighted.push({ id: 'preview', label: 'Preview Lab', pct: previewPct, weight: 24 });

  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const percent = clampPercent(weighted.reduce((sum, item) => sum + item.pct * item.weight, 0) / weightSum);

  const openStages = [];
  if (maze) {
    if (mazePct < 100) openStages.push({ id: 'maze', label: 'Maze Lab' });
  } else if (editable) {
    if (pagePercent < 100) openStages.push({ id: 'interior_artwork', label: 'Pages Lab' });
    if (textPct < 100) openStages.push({ id: 'interior_text', label: 'Text Lab' });
    if (editablePct < 100) openStages.push({ id: 'editable_ppt', label: 'Editable Lab' });
  } else if (pagePercent < 100) {
    openStages.push({ id: 'interior', label: 'Pages Lab' });
  }
  if (thumbPct < 100) openStages.push({ id: 'thumbnails', label: 'Mockups Lab' });
  if (previewPct < 100) openStages.push({ id: 'preview', label: 'Preview Lab' });
  if (exportPct < 100) openStages.push({ id: 'export', label: 'Export' });

  const requiredOpen = openStages.filter((stage) => !['preview', 'export'].includes(stage.id));
  const nextView = (requiredOpen[0] || openStages[0] || { id: 'export' }).id;

  return {
    percent,
    pagePercent,
    characterPct,
    editablePct,
    thumbPct,
    previewPct,
    textPct,
    exportPct,
    thumbnailCount,
    pagesDone,
    mazePct,
    maze,
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
