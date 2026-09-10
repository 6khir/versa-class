/* renderer/ui.js
   UI-only chrome for Library / Atelier.
   Does not implement handleAction or call window.tptDesktop.
*/
(function initVersaUiChrome() {
  const STORAGE_LIBRARY_SIZE = 'ui-library-card-size';
  const STORAGE_LIBRARY_LAYOUT = 'ui-library-layout';
  const STORAGE_SIDEBAR = 'ui-sidebar-pinned';
  const STORAGE_JOURNEY = 'ui-studio-journey-w';
  const STORAGE_NOW = 'ui-studio-now-w';

  function readNumber(key, fallback, min, max) {
    let value = fallback;
    try {
      value = Number(localStorage.getItem(key) || fallback);
    } catch {
      value = fallback;
    }
    if (!Number.isFinite(value)) value = fallback;
    return Math.min(max, Math.max(min, value));
  }

  function writeNumber(key, value) {
    try {
      localStorage.setItem(key, String(Math.round(value)));
    } catch {
      /* ignore */
    }
  }

  function applyLibraryBoard() {
    const size = readNumber(STORAGE_LIBRARY_SIZE, 220, 168, 360);
    let layout = 'grid';
    try {
      layout = localStorage.getItem(STORAGE_LIBRARY_LAYOUT) === 'list' ? 'list' : 'grid';
    } catch {
      layout = 'grid';
    }
    document.body.dataset.libraryLayout = layout;
    document.getElementById('project-list')?.style.setProperty('--library-min', `${size}px`);
    document.getElementById('library-layout-grid')?.classList.toggle('is-active', layout === 'grid');
    document.getElementById('library-layout-list')?.classList.toggle('is-active', layout === 'list');
  }

  function applySplitColumns() {
    const view = document.getElementById('project-standard-view');
    if (!view) return;
    const viewW = Math.max(720, Math.round(view.getBoundingClientRect().width || window.innerWidth || 1200));
    const journey = readNumber(STORAGE_JOURNEY, 190, 148, 260);
    // Keep a usable center stage: never let journey + activity eat the viewport.
    const maxNow = Math.min(360, Math.max(220, viewW - journey - 480));
    const now = readNumber(STORAGE_NOW, Math.min(300, maxNow), 220, maxNow);
    view.style.setProperty('--studio-journey-w', `${journey}px`);
    view.style.setProperty('--studio-now-w', `${now}px`);
    if (now !== Number(localStorage.getItem(STORAGE_NOW))) writeNumber(STORAGE_NOW, now);
    if (journey !== Number(localStorage.getItem(STORAGE_JOURNEY))) writeNumber(STORAGE_JOURNEY, journey);
    placeSplitHandles();
    // #region agent log
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify({sessionId:'1c3662',runId:'layout-overflow',hypothesisId:'C',location:'ui.js:applySplitColumns',message:'clamped studio columns',data:{viewW,journey,now,maxNow},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  function placeSplitHandles() {
    const view = document.getElementById('project-standard-view');
    const journey = view?.querySelector('.project-workspace-nav');
    const now = view?.querySelector('.studio-now-column');
    const jHandle = document.getElementById('studio-split-journey');
    const nHandle = document.getElementById('studio-split-now');
    if (!view || !jHandle || !nHandle) return;
    const layer = document.body.dataset.layer;
    const show = layer === 'spine' || layer === 'split';
    jHandle.hidden = !show;
    nHandle.hidden = !show;
    if (!show || !journey || !now) return;
    const vr = view.getBoundingClientRect();
    const jr = journey.getBoundingClientRect();
    const nr = now.getBoundingClientRect();
    jHandle.style.left = `${jr.right - vr.left - 5}px`;
    jHandle.style.top = `${jr.top - vr.top}px`;
    jHandle.style.height = `${jr.height}px`;
    nHandle.style.left = `${nr.left - vr.left - 5}px`;
    nHandle.style.top = `${nr.top - vr.top}px`;
    nHandle.style.height = `${nr.height}px`;
  }

  const TELEMETRY_HTML = `
    <div class="studio-telemetry" hidden aria-hidden="true">
      <span class="studio-telemetry__end">Out</span>
      <div class="studio-telemetry__body">
        <p class="studio-telemetry__pulse">Live</p>
        <div class="studio-telemetry__lanes">
          <div class="studio-telemetry__lane is-out"></div>
          <div class="studio-telemetry__lane is-in"></div>
        </div>
      </div>
      <span class="studio-telemetry__end">In</span>
    </div>`;

  function mountTelemetry(host, variant) {
    if (!host || host.querySelector(':scope > .studio-telemetry')) return;
    host.insertAdjacentHTML('afterbegin', TELEMETRY_HTML);
    const node = host.querySelector(':scope > .studio-telemetry');
    if (node && variant) node.dataset.variant = variant;
  }

  function mountAllTelemetry() {
    document.querySelectorAll('[data-workspace-pane]').forEach((pane) => {
      if (pane.hidden || pane.hasAttribute('hidden')) return;
      mountTelemetry(pane, 'pane');
    });
    mountTelemetry(document.getElementById('live-dock'), 'now');
    mountTelemetry(document.getElementById('studio-scale-page'), 'banner');
    mountTelemetry(document.querySelector('.studio-stage-banner'), 'banner');
    mountTelemetry(document.querySelector('.project-workspace-nav'), 'rail');
    mountTelemetry(document.getElementById('library-board-frame'), 'library');
    document.querySelectorAll('.overview-stage-card:not([hidden])').forEach((card) => {
      mountTelemetry(card, 'card');
    });
  }

  function syncTelemetryStreams() {
    mountAllTelemetry();
    const progressing = Boolean(
      document.querySelector('#live-dock.is-live')
      || document.querySelector('.overview-stage-card.is-live')
      || document.querySelector('.tab-mark.is-live')
      || document.querySelector('.stage-live-bar.is-live')
      || document.querySelector('.canva-live-dashboard.is-live')
      || document.querySelector('#canva-live-bar.is-live')
      || document.querySelector('.page-preview-card.is-live')
      || document.querySelector('.canva-page-card.is-live')
      || document.querySelector('.project-item.is-generating')
    );
    document.body.classList.toggle('is-progressing', progressing);
    const pulse = document.getElementById('current-job-label')?.textContent?.trim() || 'Live';
    document.querySelectorAll('.studio-telemetry').forEach((node) => {
      node.hidden = !progressing;
      const label = node.querySelector('.studio-telemetry__pulse');
      if (label && label.textContent !== pulse) label.textContent = pulse;
    });
  }

  function applyAppearance(appearance) {
    const next = appearance === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('versa-theme', next);
    } catch {
      /* ignore */
    }
    document.querySelectorAll('[data-action="set-appearance"]').forEach((button) => {
      if (button.dataset.appearance !== 'light' && button.dataset.appearance !== 'dark') return;
      const selected = button.dataset.appearance === next;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  const shell = document.getElementById('ui-shell');
  const sidebar = document.getElementById('ui-sidebar');
  const search = document.getElementById('ui-global-search');
  const profileMenu = document.getElementById('ui-profile-menu');
  const profileToggle = document.getElementById('ui-profile-menu-toggle');
  const footerStatus = document.getElementById('ui-footer-status');
  const footerFill = document.getElementById('ui-footer-progress-fill');
  const footerDot = document.getElementById('ui-footer-dot');

  if (!shell) return;

  document.body.classList.remove('is-mini-open');

  function readFlag(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return raw === '1' || raw === 'true';
    } catch {
      return fallback;
    }
  }

  function writeFlag(key, value) {
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }

  function isTypingTarget(node) {
    if (!node || node === document.body) return false;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(node.isContentEditable);
  }

  function setSidebarPinned(pinned, persist) {
    document.body.classList.toggle('is-sidebar-pinned', pinned);
    sidebar?.setAttribute('aria-expanded', pinned ? 'true' : 'false');
    const toggle = document.getElementById('ui-sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    if (persist !== false) writeFlag(STORAGE_SIDEBAR, pinned);
  }

  function syncStudioModeButtons(mode) {
    const libraryBtn = document.getElementById('studio-library-btn');
    const cockpitBtn = document.getElementById('studio-cockpit-btn');
    libraryBtn?.classList.toggle('is-active', mode === 'library');
    cockpitBtn?.classList.toggle('is-active', mode === 'studio' || mode === 'bundle');
    libraryBtn?.setAttribute('aria-pressed', mode === 'library' ? 'true' : 'false');
    cockpitBtn?.setAttribute('aria-pressed', mode === 'studio' || mode === 'bundle' ? 'true' : 'false');
  }

  function hasEnteredDoor() {
    try {
      return sessionStorage.getItem('versa-door') === '1';
    } catch {
      return true;
    }
  }

  function enterDoor() {
    try {
      sessionStorage.setItem('versa-door', '1');
    } catch {
      /* ignore */
    }
    document.getElementById('studio-intro')?.setAttribute('hidden', '');
    syncLayer();
  }

  function setStudioMode(mode, persistPin) {
    const next = mode === 'studio' || mode === 'bundle' ? mode : 'library';
    document.body.dataset.mode = next;
    if (persistPin) {
      document.body.dataset.studioPin = next === 'library' ? 'library' : '';
    }
    syncStudioModeButtons(next);
    syncLayer();
  }

  function activeWorkspaceView() {
    return document.querySelector('.workspace-tab.is-active')?.dataset?.viewTarget || 'overview';
  }

  function syncLayer() {
    const body = document.body;
    const intro = document.getElementById('studio-intro');
    if (!hasEnteredDoor()) {
      body.dataset.layer = 'intro';
      intro?.removeAttribute('hidden');
      return;
    }
    intro?.setAttribute('hidden', '');
    const mode = body.dataset.mode || 'library';
    const hasBooks = body.classList.contains('has-books');
    const workspace = document.getElementById('project-workspace');
    const concept = document.getElementById('project-concept-view');
    const standard = document.getElementById('project-standard-view');
    const inWorkspace = Boolean(workspace && !workspace.hidden);
    const isConcept = Boolean(concept && !concept.hidden && standard?.hidden);
    let view = activeWorkspaceView();
    if (view === 'characters') {
      document.querySelector('[data-view-target="overview"]')?.click();
      view = 'overview';
    }

    let layer = 'command';
    if (mode === 'bundle') {
      layer = 'split';
    } else if (mode === 'library' || !inWorkspace) {
      layer = hasBooks ? 'library' : 'command';
    } else if (view === 'overview' || isConcept) {
      layer = 'spine';
    } else {
      layer = 'split';
    }

    body.dataset.layer = layer;
    body.dataset.view = view;
    requestAnimationFrame(placeSplitHandles);
  }

  document.getElementById('studio-library-btn')?.addEventListener('click', () => {
    setStudioMode('library', true);
  });
  document.getElementById('studio-cockpit-btn')?.addEventListener('click', () => {
    const hasWorkspace = document.getElementById('project-workspace') && !document.getElementById('project-workspace').hidden;
    if (!hasWorkspace) return;
    setStudioMode('studio', true);
  });
  window.__versaSetStudioMode = setStudioMode;

  const STAGE_RUN_MAP = {
    overview: () => document.querySelector('[data-action="start-full-automation"]'),
    characters: () => document.querySelector('[data-action="run-stage"][data-stage="characters"]'),
    interior: () => document.querySelector('[data-action="regenerate-interior"]:not([hidden])')
      || document.querySelector('#run-interior-button:not([hidden])')
      || document.querySelector('[data-action="run-stage"][data-stage="interior"]:not([hidden])'),
    editable: () => document.querySelector('#run-canva-editable-button')
      || document.querySelector('[data-action="run-stage"][data-stage="editable"]'),
    listing: () => document.querySelector('[data-action="generate-tpt-listing"]')
      || document.querySelector('[data-action="run-stage"][data-stage="listing"]'),
    thumbnails: () => document.querySelector('[data-action="generate-tpt-thumbnails"]')
      || document.querySelector('[data-action="run-stage"][data-stage="thumbnails"]'),
    preview: () => document.querySelector('[data-action="generate-tpt-preview-video"]')
      || document.querySelector('[data-action="run-stage"][data-stage="preview"]'),
    export: () => document.querySelector('#export-all-files-button:not([disabled])')
      || document.querySelector('#export-pdf-button:not([disabled])')
      || document.querySelector('[data-action="run-stage"][data-stage="export"]')
  };

  const STAGE_NAMES = {
    overview: 'Overview',
    characters: 'Characters',
    interior: 'Interior',
    editable: 'Canva',
    listing: 'SEO',
    thumbnails: 'Thumbnails',
    preview: 'Preview',
    export: 'Export'
  };

  function syncStageBanner() {
    const tabs = [...document.querySelectorAll('#project-standard-view .workspace-tab')].filter((tab) => !tab.hidden);
    const active = document.querySelector('#project-standard-view .workspace-tab.is-active') || tabs[0];
    const visibleIndex = Math.max(0, tabs.indexOf(active));
    const view = active?.dataset?.viewTarget || 'overview';
    const total = Math.max(tabs.length, 1);
    const book = document.getElementById('project-title')?.textContent?.trim() || '';
    const title = document.getElementById('studio-stage-title');
    const kicker = document.getElementById('studio-stage-kicker');
    const scaleMeta = document.getElementById('studio-scale-meta');
    const stageName = STAGE_NAMES[view] || 'Overview';
    if (title) title.textContent = stageName;
    const scaleTitle = document.getElementById('studio-scale-title');
    if (scaleTitle) scaleTitle.textContent = stageName;
    if (kicker) kicker.textContent = book || 'Atelier';
    const scaleKicker = document.querySelector('.studio-scale-page__kicker');
    if (scaleKicker) scaleKicker.textContent = book || 'Atelier';
    if (scaleMeta) scaleMeta.textContent = `Stage ${visibleIndex + 1} of ${total}`;
    const runBtn = document.getElementById('studio-stage-run');
    const bannerRun = document.getElementById('studio-banner-run');
    const regen = document.querySelector('[data-action="regenerate-interior"]:not([hidden])');
    const runLabel = view === 'interior' && regen ? 'Regenerate' : 'Run';
    if (runBtn) runBtn.textContent = runLabel;
    if (bannerRun) bannerRun.textContent = runLabel;
    syncLayer();
  }

  document.getElementById('studio-stage-run')?.addEventListener('click', () => {
    const view = activeWorkspaceView();
    const target = STAGE_RUN_MAP[view]?.();
    if (target && !target.disabled) {
      target.click();
      return;
    }
    // Disabled CTAs do not fire clicks — route through run-stage so the block reason toasts.
    const proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.hidden = true;
    proxy.dataset.action = 'run-stage';
    proxy.dataset.stage = view || 'overview';
    document.body.appendChild(proxy);
    proxy.click();
    proxy.remove();
  });
  document.getElementById('studio-banner-run')?.addEventListener('click', () => {
    document.getElementById('studio-stage-run')?.click();
  });

  document.getElementById('library-layout-grid')?.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_LIBRARY_LAYOUT, 'grid'); } catch { /* ignore */ }
    applyLibraryBoard();
  });
  document.getElementById('library-layout-list')?.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_LIBRARY_LAYOUT, 'list'); } catch { /* ignore */ }
    applyLibraryBoard();
  });

  document.getElementById('studio-intro-enter')?.addEventListener('click', () => {
    enterDoor();
  });

  document.getElementById('studio-intro-prompt')?.addEventListener('submit', (event) => {
    event.preventDefault();
    enterDoor();
  });

  document.getElementById('studio-split-start')?.addEventListener('click', () => {
    document.getElementById('run-button')?.click();
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-action="set-appearance"]');
    if (!button) return;
    const mode = button.dataset.appearance;
    if (mode === 'light' || mode === 'dark') applyAppearance(mode);
  }, true);

  let drag = null;

  function beginDrag(kind, event, start) {
    event.preventDefault();
    drag = { kind, startX: event.clientX, start };
    document.documentElement.classList.add('is-resizing');
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(event) {
    if (!drag) {
      const item = event.target.closest?.('.project-item');
      if (item && document.body.dataset.layer === 'library') {
        const rect = item.getBoundingClientRect();
        item.classList.toggle('is-edge', event.clientX >= rect.right - 14);
      }
      return;
    }
    const dx = event.clientX - drag.startX;
    if (drag.kind === 'library') {
      writeNumber(STORAGE_LIBRARY_SIZE, drag.start + dx);
      applyLibraryBoard();
      return;
    }
    if (drag.kind === 'journey') {
      writeNumber(STORAGE_JOURNEY, drag.start + dx);
      applySplitColumns();
      return;
    }
    if (drag.kind === 'now') {
      writeNumber(STORAGE_NOW, drag.start - dx);
      applySplitColumns();
    }
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    document.documentElement.classList.remove('is-resizing');
    placeSplitHandles();
  }

  document.getElementById('library-resize-handle')?.addEventListener('pointerdown', (event) => {
    beginDrag('library', event, readNumber(STORAGE_LIBRARY_SIZE, 220, 168, 360));
  });
  document.getElementById('studio-split-journey')?.addEventListener('pointerdown', (event) => {
    beginDrag('journey', event, readNumber(STORAGE_JOURNEY, 200, 148, 340));
  });
  document.getElementById('studio-split-now')?.addEventListener('pointerdown', (event) => {
    beginDrag('now', event, readNumber(STORAGE_NOW, 352, 240, 520));
  });

  document.getElementById('project-list')?.addEventListener('pointerdown', (event) => {
    if (document.body.dataset.layer !== 'library') return;
    const item = event.target.closest('.project-item');
    if (!item) return;
    const rect = item.getBoundingClientRect();
    if (event.clientX < rect.right - 14) return;
    beginDrag('library', event, readNumber(STORAGE_LIBRARY_SIZE, 220, 168, 360));
  });

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => requestAnimationFrame(placeSplitHandles));

  function filterProjects(query, options = {}) {
    const list = document.getElementById('project-list');
    if (!list) {
      // #region agent log
      const missPayload = {sessionId:'1c3662',runId:'search-debug',hypothesisId:'E',location:'ui.js:filterProjects',message:'project-list missing',data:{query:String(query||'').slice(0,40)},timestamp:Date.now()};
      fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify(missPayload)}).catch(()=>{});
      window.tptDesktop?.debugAgentLog?.(missPayload);
      // #endregion
      return { visible: 0, hiddenCount: 0, total: 0 };
    }
    const q = String(query || '').trim().toLowerCase();
    const beforeMode = document.body.dataset.mode;
    const beforeLayer = document.body.dataset.layer;
    if (q && options.revealLibrary !== false) {
      document.body.dataset.studioPin = 'library';
      setStudioMode('library', true);
      document.getElementById('studio-library-btn')?.classList.add('is-active');
      document.getElementById('studio-cockpit-btn')?.classList.remove('is-active');
    }
    const items = [...list.querySelectorAll('.project-item')];
    let visible = 0;
    let hiddenCount = 0;
    items.forEach((item) => {
      const hay = `${item.querySelector('strong')?.textContent || ''} ${item.textContent || ''}`.toLowerCase();
      const shouldHide = Boolean(q) && !hay.includes(q);
      item.classList.toggle('is-search-miss', shouldHide);
      item.hidden = shouldHide;
      if (shouldHide) {
        item.style.setProperty('display', 'none', 'important');
        hiddenCount += 1;
      } else {
        item.style.removeProperty('display');
        visible += 1;
      }
    });
    list.dataset.searchEmpty = q && visible === 0 ? '1' : '0';
    const countEl = document.getElementById('project-count');
    if (countEl) countEl.textContent = q ? String(visible) : String(items.length);
    const sampleMiss = items.find((item) => item.classList.contains('is-search-miss'));
    const sampleHit = items.find((item) => !item.classList.contains('is-search-miss'));
    // #region agent log
    const payload = {sessionId:'1c3662',runId:'search-debug',hypothesisId:'A',location:'ui.js:filterProjects',message:'filterProjects result',data:{q,total:items.length,visible,hiddenCount,beforeMode,beforeLayer,afterMode:document.body.dataset.mode,afterLayer:document.body.dataset.layer,pin:document.body.dataset.studioPin,missDisplay:sampleMiss?getComputedStyle(sampleMiss).display:null,hitDisplay:sampleHit?getComputedStyle(sampleHit).display:null,sidebarHidden:Boolean(document.getElementById('ui-sidebar')?.offsetParent===null&&document.body.dataset.mode==='studio'),revealLibrary:options.revealLibrary!==false},timestamp:Date.now()};
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify(payload)}).catch(()=>{});
    window.tptDesktop?.debugAgentLog?.(payload);
    // #endregion
    return { visible, hiddenCount, total: items.length };
  }

  window.versaUi = Object.assign(window.versaUi || {}, { filterProjects });

  function syncFooter() {
    const label = document.getElementById('current-job-label');
    const percent = document.getElementById('progress-percent-label');
    const fill = document.getElementById('progress-fill');
    if (footerStatus) {
      const live = label?.textContent?.trim() || 'Ready';
      const pct = percent?.textContent?.trim() || '0%';
      footerStatus.textContent = `${live} · ${pct}`;
    }
    if (footerFill) {
      const match = String(fill?.style?.width || '').trim();
      footerFill.style.width = match || '0%';
    }
    const running = /generat|run|upload|build/i.test(label?.textContent || '');
    footerDot?.classList.toggle('is-busy', running);
  }

  applyAppearance(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  setSidebarPinned(readFlag(STORAGE_SIDEBAR, false), false);
  applyLibraryBoard();
  applySplitColumns();
  mountAllTelemetry();
  syncFooter();
  syncStageBanner();
  syncLayer();
  syncTelemetryStreams();

  document.getElementById('ui-sidebar-toggle')?.addEventListener('click', () => {
    setSidebarPinned(!document.body.classList.contains('is-sidebar-pinned'));
  });

  const profilePanel = document.getElementById('ui-profile-menu-panel');

  function setProfileOpen(open) {
    profileMenu?.classList.toggle('is-open', open);
    profileToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!profilePanel) return;
    if (open) profilePanel.removeAttribute('inert');
    else profilePanel.setAttribute('inert', '');
  }

  setProfileOpen(false);

  profileToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    setProfileOpen(!profileMenu.classList.contains('is-open'));
  });

  document.addEventListener('click', (event) => {
    if (profileMenu && !profileMenu.contains(event.target)) {
      setProfileOpen(false);
    }

    const action = event.target.closest?.('[data-action]')?.dataset?.action;
    if (action === 'ui-toggle-sidebar') setSidebarPinned(!document.body.classList.contains('is-sidebar-pinned'));
    if (action === 'ui-focus-search') search?.focus();
  });

  // #region agent log
  {
    const initPayload = {sessionId:'1c3662',runId:'search-debug',hypothesisId:'B',location:'ui.js:init',message:'search wiring status',data:{searchFound:Boolean(search),shellFound:Boolean(shell),hasDebugLog:typeof window.tptDesktop?.debugAgentLog==='function'},timestamp:Date.now()};
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify(initPayload)}).catch(()=>{});
    window.tptDesktop?.debugAgentLog?.(initPayload);
  }
  // #endregion
  search?.addEventListener('input', () => {
    // #region agent log
    const inputPayload = {sessionId:'1c3662',runId:'search-debug',hypothesisId:'B',location:'ui.js:search-input',message:'search input fired',data:{value:String(search.value||'').slice(0,80),mode:document.body.dataset.mode,layer:document.body.dataset.layer},timestamp:Date.now()};
    fetch('http://127.0.0.1:7482/ingest/8a51ab2a-6ab7-4bf8-85e4-1555cfa4896d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1c3662'},body:JSON.stringify(inputPayload)}).catch(()=>{});
    window.tptDesktop?.debugAgentLog?.(inputPayload);
    // #endregion
    filterProjects(search.value, { revealLibrary: true });
  });
  search?.addEventListener('search', () => {
    filterProjects(search.value, { revealLibrary: Boolean(String(search.value || '').trim()) });
  });
  search?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const list = document.getElementById('project-list');
    const first = list?.querySelector('.project-item:not([hidden]):not(.is-search-miss)');
    if (!first) return;
    event.preventDefault();
    first.click();
  });

  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (!meta) {
      if (event.key === 'Escape' && profileMenu?.classList.contains('is-open')) {
        setProfileOpen(false);
      }
      if ((event.key === 'Enter' || event.key === ' ') && document.body.dataset.layer === 'intro' && !isTypingTarget(event.target)) {
        event.preventDefault();
        enterDoor();
      }
      return;
    }
    if (event.repeat) return;
    if (document.querySelector('dialog[open]')) return;

    const key = event.key.toLowerCase();
    if (key === 'b' && !isTypingTarget(event.target)) {
      event.preventDefault();
      const mode = document.body.dataset.mode === 'library' ? 'studio' : 'library';
      if (mode === 'studio' && document.getElementById('project-workspace')?.hidden) {
        setStudioMode('library', true);
        return;
      }
      setStudioMode(mode, true);
      return;
    }
    if (key === 'k') {
      event.preventDefault();
      search?.focus();
      search?.select();
    }
  });

  let chromeSyncQueued = false;
  const chromeObserver = new MutationObserver(() => {
    if (chromeSyncQueued) return;
    chromeSyncQueued = true;
    requestAnimationFrame(() => {
      chromeSyncQueued = false;
      syncFooter();
      syncStageBanner();
      syncLayer();
      placeSplitHandles();
      syncTelemetryStreams();
    });
  });
  chromeObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'class', 'style', 'hidden', 'data-mode', 'data-layer']
  });

  // Lazy load images
  if (typeof IntersectionObserver !== 'undefined') {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          imageObserver.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach((img) => {
      imageObserver.observe(img);
    });
  }
})();
