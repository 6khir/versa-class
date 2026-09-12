'use strict';

const MAZE_AGE_BANDS = Object.freeze({
  pre_k: { id: 'pre_k', label: 'Pre-K (3–4)' },
  kindergarten: { id: 'kindergarten', label: 'Kindergarten (5–6)' },
  grades_1_2: { id: 'grades_1_2', label: 'Grades 1–2 (6–8)' },
  grades_3_5: { id: 'grades_3_5', label: 'Grades 3–5 (8–11)' },
  grades_6_8: { id: 'grades_6_8', label: 'Grades 6–8 (11–14)' }
});

const MAZE_DIFFICULTIES = Object.freeze([
  { id: 'very_easy', label: 'Very Easy', tier: 1 },
  { id: 'easy', label: 'Easy', tier: 2 },
  { id: 'medium', label: 'Medium', tier: 3 },
  { id: 'hard', label: 'Hard', tier: 4 },
  { id: 'expert', label: 'Expert', tier: 5 }
]);

const MAZE_ASSET_IDS = Object.freeze([
  'pencil', 'apple', 'school_bus', 'school', 'bee', 'flower', 'rocket', 'planet'
]);

function shortMazeKeyword(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'maze';
  if (/year\s*[-–—]?\s*long|\bfor the year\b|\bof the year\b|\bthe year\b|every month|seasonal|monthly/i.test(text)) return 'seasonal';
  if (/space|rocket|planet/i.test(text)) return 'space';
  if (/\bbees?\b|honey/i.test(text)) return 'bees';
  const words = text.split(/[\s,&/:]+/).filter((word) => (
    word
    && !/^(the|and|a|an|for|of|with|to|mazes?|puzzles?|activity|book|bundle|practice|word|search)$/i.test(word)
    && !/^a-?maze-?ing$/i.test(word)
  ));
  if (text.length <= 22 && words[0]) return words[0];
  return (words[0] || text).slice(0, 22);
}

function mazeDifficultyLabel(tier) {
  return MAZE_DIFFICULTIES.find((item) => item.tier === Number(tier))?.label || 'Easy';
}

function mazeAgeLabel(ageBand) {
  return MAZE_AGE_BANDS[ageBand]?.label || ageBand || '';
}

function mazePageStatusCopy(page, isLive) {
  if (isLive) return 'Processing';
  if (page?.generationStatus === 'ready') return 'Ready';
  if (page?.generationStatus === 'failed') return 'Attention';
  if (page?.generationStatus === 'pending') return 'Pending';
  return 'Idle';
}

function mazeImageSrc(projectId, page, variant, cacheKey) {
  if (!projectId || !page?.pageId) return '';
  const hasFile = variant === 'solution'
    ? page.render?.solutionSvgPath || page.render?.pngPreviewPath
    : page.render?.pngPreviewPath || page.render?.studentSvgPath;
  if (!hasFile) return '';
  return `tpt-image://maze/${encodeURIComponent(projectId)}/${encodeURIComponent(page.pageId)}?variant=${variant === 'solution' ? 'solution' : 'student'}&v=${encodeURIComponent(cacheKey || page.seed || '')}`;
}

function mazeFirstThumb(project) {
  const pages = project?.mazeProject?.pages || [];
  const ready = pages.find((page) => page.generationStatus === 'ready' && page.render?.pngPreviewPath);
  return ready ? mazeImageSrc(project.id, ready, 'student', project.updatedAt) : '';
}

function formatMazeModified(value) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  return new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function mazeProjectListMeta(project) {
  const config = project?.mazeProject?.config || {};
  const lab = project?.mazeLab || {};
  const pages = Array.isArray(project?.mazeProject?.pages) ? project.mazeProject.pages : [];
  const ready = pages.filter((page) => page.generationStatus === 'ready').length;
  const count = Number(lab.pageCount) || pages.length || project.activityCount || 0;
  const parts = [
    config.keyword || config.themeId || project.theme || '',
    mazeAgeLabel(config.ageBand || ''),
    mazeDifficultyLabel(config.difficultyTier),
    count ? `${count} maze${count === 1 ? '' : 's'}` : '',
    formatMazeModified(project.updatedAt)
  ].filter(Boolean);
  return parts.join(' · ');
}

function mazeProgress(project, liveOp) {
  if (liveOp?.kind === 'maze' && liveOp.projectId === project?.id) {
    const n = Number(liveOp.percent);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  }
  const pages = Array.isArray(project?.mazeProject?.pages) ? project.mazeProject.pages : [];
  const planned = Number(project?.mazeLab?.pageCount) || pages.length;
  if (!planned) return project?.stepMazeStatus === 'completed' ? 100 : 0;
  const ready = pages.filter((page) => page.generationStatus === 'ready').length;
  return Math.max(0, Math.min(100, Math.round((ready / planned) * 100)));
}

function collectMazeConfig(root = document) {
  const difficulty = Number.parseInt(root.getElementById('maze-difficulty')?.value, 10);
  const startAssetId = root.getElementById('maze-start-asset')?.value;
  const endAssetId = root.getElementById('maze-end-asset')?.value;
  return {
    keyword: String(root.getElementById('maze-keyword')?.value || '').trim(),
    ageBand: root.getElementById('maze-age-band')?.value || 'kindergarten',
    difficultyTier: [1, 2, 3, 4, 5].includes(difficulty) ? difficulty : 2,
    startAssetId: MAZE_ASSET_IDS.includes(startAssetId) ? startAssetId : 'pencil',
    endAssetId: MAZE_ASSET_IDS.includes(endAssetId) ? endAssetId : 'apple'
  };
}

function collectMazeLab(root = document) {
  const pageCount = Number.parseInt(root.getElementById('maze-page-count')?.value, 10);
  const lock = root.getElementById('maze-seed-lock');
  const includeAnswer = root.getElementById('maze-include-answer-key');
  return {
    pageCount: Number.isSafeInteger(pageCount) ? pageCount : 8,
    seedLocked: lock?.getAttribute('aria-pressed') === 'true' || lock?.classList.contains('is-locked'),
    includeAnswerKey: includeAnswer ? includeAnswer.checked !== false : true
  };
}

function mountMazeDashboard(view) {
  const section = document.querySelector('[data-workspace-section="maze"]');
  if (!section) return;
  const host = document.querySelector('[data-workspace-pane="maze"]');
  if (host && section.parentElement !== host) host.appendChild(section);
  void view;
}

function fillMazeConfig(project, root = document) {
  const config = project?.mazeProject?.config || {};
  const lab = project?.mazeLab || {};
  const keyword = root.getElementById('maze-keyword');
  const age = root.getElementById('maze-age-band');
  const difficulty = root.getElementById('maze-difficulty');
  const pageCount = root.getElementById('maze-page-count');
  const start = root.getElementById('maze-start-asset');
  const end = root.getElementById('maze-end-asset');
  const includeAnswer = root.getElementById('maze-include-answer-key');
  const seed = root.getElementById('maze-seed');
  const lock = root.getElementById('maze-seed-lock');
  if (keyword && document.activeElement !== keyword) keyword.value = config.keyword || '';
  if (age && document.activeElement !== age) age.value = config.ageBand || 'kindergarten';
  if (difficulty && document.activeElement !== difficulty) difficulty.value = String(config.difficultyTier || 2);
  if (pageCount && document.activeElement !== pageCount) pageCount.value = String(lab.pageCount || 8);
  if (includeAnswer && document.activeElement !== includeAnswer) {
    includeAnswer.checked = lab.includeAnswerKey !== false;
  }
  if (start && document.activeElement !== start) start.value = config.startAssetId || 'pencil';
  if (end && document.activeElement !== end) end.value = config.endAssetId || 'apple';
  if (seed && document.activeElement !== seed) seed.value = config.seed || '';
  if (lock) {
    const locked = Boolean(lab.seedLocked);
    lock.classList.toggle('is-locked', locked);
    lock.setAttribute('aria-pressed', locked ? 'true' : 'false');
    lock.textContent = locked ? 'Locked' : 'Lock';
  }
}

function mazeEmptyHtml() {
  return `<div class="pages-empty">
    <div class="pages-empty__sheet" aria-hidden="true"></div>
    <strong>No mazes yet</strong>
    <p>Set a theme.</p>
  </div>`;
}

function renderMazePages(project, { selectedPageId, previewVariant, livePageId, aspect } = {}) {
  const table = document.getElementById('maze-pages-table');
  const count = document.getElementById('maze-rail-count');
  if (!table) return;
  const pages = [...(project?.mazeProject?.pages || [])].sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  if (count) count.textContent = pages.length === 1 ? '1 maze' : `${pages.length} mazes`;
  if (!pages.length) {
    table.classList.add('is-empty');
    table.innerHTML = mazeEmptyHtml();
    return;
  }
  table.classList.remove('is-empty');
  table.innerHTML = pages.map((page) => {
    const isLive = livePageId === page.pageId;
    const src = mazeImageSrc(project.id, page, previewVariant, page.seed);
    const selected = page.pageId === selectedPageId;
    const status = mazePageStatusCopy(page, isLive);
    return `
      <article class="page-preview-card status-${page.generationStatus} ${selected ? 'is-selected' : ''} ${isLive ? 'is-live' : ''} ${src ? 'has-image' : ''}" data-action="select-maze-page" data-page-id="${page.pageId}" role="listitem" tabindex="0" aria-current="${selected ? 'page' : 'false'}" aria-busy="${isLive ? 'true' : 'false'}" aria-label="Maze ${page.sequenceIndex}">
        <div class="page-visual" style="--preview-aspect-ratio: ${aspect || '1 / 1.414'}; --page-fill: ${isLive ? 40 : 0}%;">
          <div class="page-fill-layer" aria-hidden="true"></div>
          <div class="page-fill-sheen" aria-hidden="true"></div>
          ${src ? `<img class="page-generated-image" src="${src}" alt="Maze ${page.sequenceIndex}" decoding="async" loading="lazy">` : ''}
          <div class="page-placeholder"${src ? ' hidden' : ''}>
            <strong>${String(page.sequenceIndex).padStart(2, '0')}</strong>
            <span>${status}</span>
          </div>
        </div>
        <div class="page-card-body">
          <div class="page-card-heading">
            <strong class="page-card-title">${page.sequenceIndex}</strong>${page.title ? `<span class="page-card-kicker">${String(page.title).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))}</span>` : ''}${page.topology?.shape ? `<span class="page-card-kicker">${String(page.topology.shape).replace(/_/g, ' ')}${page.topology.algorithm ? ` · ${String(page.topology.algorithm).replace(/_/g, ' ')}` : ''}</span>` : ''}
            <span class="page-card-status">${page.generationStatus === 'ready' && !isLive ? '' : `<i class="page-state-dot" data-state="${isLive ? 'live' : page.generationStatus}" title="${status}"></i>`}</span>
          </div>
          <div class="page-card-actions">
            <div class="page-card-tools">
              <button class="row-button is-danger" data-action="delete-maze-page" data-page-id="${page.pageId}" title="Delete" type="button"${src && !isLive ? '' : ' disabled'}>✕</button>
            </div>
            <button class="row-button is-regen" data-action="regenerate-maze-page" data-page-id="${page.pageId}" title="${src ? 'Regenerate' : 'Generate'}" type="button"${isLive ? ' disabled' : ''}>${src ? 'Regenerate' : 'Generate'}</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderMazeInspector(project, { selectedPageId, previewVariant, livePageId, aspect } = {}) {
  const pages = [...(project?.mazeProject?.pages || [])].sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  const selected = pages.find((page) => page.pageId === selectedPageId) || pages[0] || null;
  const title = document.getElementById('maze-detail-title');
  const statusWrap = document.getElementById('maze-detail-status-wrap');
  const status = document.getElementById('maze-lab-status');
  const error = document.getElementById('maze-detail-error');
  const preview = document.getElementById('maze-selected-preview');
  const visual = document.getElementById('maze-selected-visual');
  const regen = document.getElementById('maze-regenerate-page-button');
  const removeBtn = document.getElementById('maze-delete-page-button');
  const generateBtn = document.getElementById('maze-generate-button');
  const cancelBtn = document.getElementById('maze-cancel-button');
  const resumeBtn = document.getElementById('maze-resume-button');
  const deleteAllBtn = document.getElementById('maze-delete-all-button');
  const running = Boolean(livePageId);
  const ready = pages.filter((page) => page.generationStatus === 'ready').length;
  const incomplete = pages.some((page) => page.generationStatus !== 'ready');
  if (title) {
    if (!selected) title.textContent = 'Configure maze';
    else if (selected.title) title.textContent = selected.title;
    else title.textContent = `Maze ${selected.sequenceIndex}`;
  }
  if (statusWrap) {
    statusWrap.innerHTML = selected
      ? `<span class="pages-status" data-state="${livePageId === selected.pageId ? 'live' : selected.generationStatus}">${mazePageStatusCopy(selected, livePageId === selected.pageId)}</span>`
      : '';
  }
  if (status) {
    if (running) status.textContent = 'Generating…';
    else if (!pages.length) status.textContent = 'Set a theme.';
    else status.textContent = `${ready} / ${pages.length} ready.`;
  }
  const messages = selected?.validationResult?.messages || [];
  if (error) {
    error.hidden = !messages.length && selected?.generationStatus !== 'failed';
    error.textContent = messages.join(' ') || (selected?.generationStatus === 'failed' ? 'Validation failed.' : '');
  }
  const src = selected ? mazeImageSrc(project.id, selected, previewVariant, selected.seed) : '';
  if (preview) preview.hidden = !src;
  if (visual) {
    visual.style.setProperty('--preview-aspect-ratio', aspect || '1 / 1.414');
    visual.innerHTML = src ? `<img class="page-generated-image" src="${src}" alt="Selected maze">` : '';
  }
  if (regen) regen.disabled = !selected || running;
  if (removeBtn) {
    removeBtn.disabled = !selected || running || !src;
    if (selected) removeBtn.dataset.pageId = selected.pageId;
  }
  if (generateBtn) generateBtn.disabled = running;
  if (deleteAllBtn) deleteAllBtn.disabled = running || !ready;
  if (cancelBtn) {
    cancelBtn.hidden = !running;
    cancelBtn.disabled = !running;
  }
  if (resumeBtn) {
    resumeBtn.hidden = running || !incomplete || !ready;
    resumeBtn.disabled = running || !incomplete;
  }
  document.querySelectorAll('#maze-preview-tabs .filter-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.variant === previewVariant);
  });
}

function renderMazeLab(project, options = {}) {
  mountMazeDashboard(options.view);
  if (!project || project.productFormat !== 'maze') return;
  fillMazeConfig(project);
  renderMazePages(project, options);
  renderMazeInspector(project, options);
  const pages = project.mazeProject?.pages || [];
  const ready = pages.filter((page) => page.generationStatus === 'ready').length;
  const generateBtn = document.getElementById('maze-generate-button');
  // #region agent log
  fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d45d8d'},body:JSON.stringify({sessionId:'d45d8d',runId:'post-fix',hypothesisId:'H160',location:'renderer/maze-lab.js:renderMazeLab',message:'maze lab painted',data:{projectId:project.id,pageCount:pages.length,ready,livePageId:options.livePageId||null,generateDisabled:Boolean(generateBtn?.disabled),stepMazeStatus:project.stepMazeStatus||null,activityCount:project.activityCount},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

const mazeApi = {
  MAZE_AGE_BANDS,
  MAZE_DIFFICULTIES,
  MAZE_ASSET_IDS,
  shortMazeKeyword,
  mazeDifficultyLabel,
  mazeAgeLabel,
  mazeImageSrc,
  mazeFirstThumb,
  mazeProjectListMeta,
  mazeProgress,
  collectMazeConfig,
  collectMazeLab,
  mountMazeDashboard,
  renderMazeLab,
  formatMazeModified
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mazeApi;
}
if (typeof window !== 'undefined') {
  window.versaMazeLab = mazeApi;
}
