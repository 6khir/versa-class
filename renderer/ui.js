/* renderer/ui.js
   UI-only chrome for the 1B USD redesign.
   Toggles Mini Canva (⌘M), sidebar (⌘B), and search focus (⌘K).
   Does not implement handleAction or call window.tptDesktop.
*/
(function initVersaUiChrome() {
  const STORAGE_MINI = 'ui-mini-canva-open';
  const STORAGE_SIDEBAR = 'ui-sidebar-pinned';
  const STORAGE_MINI_WIDTH = 'ui-mini-canva-width';
  const STORAGE_ZOOM = 'ui-mini-canva-zoom';
  const STORAGE_ROTATE = 'ui-mini-canva-rotate';

  const shell = document.getElementById('ui-shell');
  const sidebar = document.getElementById('ui-sidebar');
  const mini = document.getElementById('mini-canva-dashboard');
  const search = document.getElementById('ui-global-search');
  const profileMenu = document.getElementById('ui-profile-menu');
  const profileToggle = document.getElementById('ui-profile-menu-toggle');
  const preview = document.getElementById('mini-canva-preview');
  const previewImage = document.getElementById('mini-canva-preview-image');
  const zoomLabel = document.getElementById('ui-mini-zoom-label');
  const footerStatus = document.getElementById('ui-footer-status');
  const footerFill = document.getElementById('ui-footer-progress-fill');
  const footerDot = document.getElementById('ui-footer-dot');
  const resizeHandle = document.getElementById('ui-mini-resize');

  if (!shell || !mini) return;

  let zoom = Number(localStorage.getItem(STORAGE_ZOOM) || '1') || 1;
  let rotate = Number(localStorage.getItem(STORAGE_ROTATE) || '0') || 0;

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

  function setMiniOpen(open, persist) {
    mini.classList.toggle('is-open', open);
    mini.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('is-mini-open', open);
    if (open) mini.removeAttribute('inert');
    else mini.setAttribute('inert', '');
    if (persist !== false) writeFlag(STORAGE_MINI, open);
  }

  function setSidebarPinned(pinned, persist) {
    document.body.classList.toggle('is-sidebar-pinned', pinned);
    sidebar?.setAttribute('aria-expanded', pinned ? 'true' : 'false');
    const toggle = document.getElementById('ui-sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    if (persist !== false) writeFlag(STORAGE_SIDEBAR, pinned);
  }

  function applyPreviewTransform() {
    if (!previewImage) return;
    previewImage.style.transform = `scale(${zoom}) rotate(${rotate}deg)`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    try {
      localStorage.setItem(STORAGE_ZOOM, String(zoom));
      localStorage.setItem(STORAGE_ROTATE, String(rotate));
    } catch {
      /* ignore */
    }
  }

  function bumpZoom(delta) {
    zoom = Math.min(3, Math.max(0.25, Math.round((zoom + delta) * 20) / 20));
    applyPreviewTransform();
  }

  function syncPreviewFromCanvas() {
    if (!preview || !previewImage) return;
    const selected = document.querySelector('.page-preview-card.is-selected img, .page-preview-card.has-image img, .page-generated-image');
    const src = selected?.getAttribute('src');
    if (!src) {
      preview.classList.add('skeleton');
      previewImage.hidden = true;
      previewImage.removeAttribute('src');
      return;
    }
    previewImage.alt = selected.getAttribute('alt') || 'Live canvas preview';
    if (previewImage.src !== src) {
      preview.classList.add('skeleton');
      previewImage.hidden = true;
      previewImage.onload = () => {
        preview.classList.remove('skeleton');
        previewImage.hidden = false;
      };
      previewImage.onerror = () => {
        preview.classList.add('skeleton');
        previewImage.hidden = true;
      };
      previewImage.src = src;
    } else if (previewImage.complete && previewImage.naturalWidth) {
      preview.classList.remove('skeleton');
      previewImage.hidden = false;
    }
    applyPreviewTransform();
  }

  function filterProjects(query) {
    const list = document.getElementById('project-list');
    if (!list) return;
    const q = String(query || '').trim().toLowerCase();
    list.querySelectorAll('.project-item').forEach((item) => {
      const hay = item.textContent.toLowerCase();
      item.hidden = Boolean(q) && !hay.includes(q);
    });
  }

  function syncFooter() {
    const label = document.getElementById('current-job-label');
    const percent = document.getElementById('progress-percent-label');
    const fill = document.getElementById('progress-fill');
    if (footerStatus) {
      const live = label?.textContent?.trim() || 'Idle';
      const pct = percent?.textContent?.trim() || '0%';
      footerStatus.textContent = `${live} · ${pct}`;
    }
    if (footerFill) {
      const width = fill?.style?.width || fill?.getAttribute('style') || '';
      const match = String(fill?.style?.width || '').trim();
      footerFill.style.width = match || '0%';
    }
    const running = /generat|run|upload|build/i.test(label?.textContent || '');
    footerDot?.classList.toggle('is-busy', running);
  }

  function clickMiniAction(action) {
    const button = mini.querySelector(`[data-action="${action}"]`);
    button?.click();
  }

  setMiniOpen(readFlag(STORAGE_MINI, false), false);
  setSidebarPinned(readFlag(STORAGE_SIDEBAR, false), false);

  try {
    const storedWidth = Number(localStorage.getItem(STORAGE_MINI_WIDTH));
    if (storedWidth >= 280 && storedWidth <= 480) {
      document.body.style.setProperty('--ui-mini-w', `${storedWidth}px`);
      mini.style.width = `${storedWidth}px`;
    }
  } catch {
    /* ignore */
  }

  applyPreviewTransform();
  syncPreviewFromCanvas();
  syncFooter();

  document.getElementById('ui-sidebar-toggle')?.addEventListener('click', () => {
    setSidebarPinned(!document.body.classList.contains('is-sidebar-pinned'));
  });

  document.getElementById('ui-mini-close')?.addEventListener('click', () => {
    setMiniOpen(false);
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
    if (action === 'mini-zoom-in') bumpZoom(0.1);
    if (action === 'mini-zoom-out') bumpZoom(-0.1);
    if (action === 'mini-zoom-fit' || action === 'mini-zoom-reset') {
      zoom = 1;
      applyPreviewTransform();
    }
    if (action === 'mini-rotate') {
      rotate = (rotate + 90) % 360;
      applyPreviewTransform();
    }
    if (action === 'mini-toggle') setMiniOpen(!mini.classList.contains('is-open'));
    if (action === 'ui-toggle-sidebar') setSidebarPinned(!document.body.classList.contains('is-sidebar-pinned'));
    if (action === 'ui-focus-search') search?.focus();
  });

  search?.addEventListener('input', () => filterProjects(search.value));

  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (!meta) {
      if (event.key === 'Escape' && profileMenu?.classList.contains('is-open')) {
        setProfileOpen(false);
      }
      return;
    }
    if (event.repeat) return;

    if (document.querySelector('dialog[open]')) return;

    const key = event.key.toLowerCase();
    if (key === 'm') {
      event.preventDefault();
      setMiniOpen(!mini.classList.contains('is-open'));
      return;
    }
    if (key === 'b' && !isTypingTarget(event.target)) {
      event.preventDefault();
      setSidebarPinned(!document.body.classList.contains('is-sidebar-pinned'));
      return;
    }
    if (key === 'k') {
      event.preventDefault();
      search?.focus();
      search?.select();
      return;
    }
    if (key === 'e' && mini.classList.contains('is-open') && !isTypingTarget(event.target)) {
      event.preventDefault();
      clickMiniAction('mini-export');
      return;
    }
    if ((event.key === '+' || event.key === '=' || event.code === 'Equal') && mini.classList.contains('is-open')) {
      event.preventDefault();
      clickMiniAction('mini-zoom-in');
      return;
    }
    if ((event.key === '-' || event.code === 'Minus') && mini.classList.contains('is-open')) {
      event.preventDefault();
      clickMiniAction('mini-zoom-out');
    }
  });

  if (resizeHandle) {
    let dragging = false;
    let startX = 0;
    let startW = 320;
    resizeHandle.addEventListener('pointerdown', (event) => {
      dragging = true;
      startX = event.clientX;
      startW = mini.getBoundingClientRect().width;
      resizeHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    resizeHandle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = Math.min(480, Math.max(280, startW + (startX - event.clientX)));
      mini.style.width = `${next}px`;
      document.body.style.setProperty('--ui-mini-w', `${next}px`);
    });
    const stopDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(STORAGE_MINI_WIDTH, String(Math.round(mini.getBoundingClientRect().width)));
      } catch {
        /* ignore */
      }
      if (event && resizeHandle.hasPointerCapture?.(event.pointerId)) {
        resizeHandle.releasePointerCapture(event.pointerId);
      }
    };
    resizeHandle.addEventListener('pointerup', stopDrag);
    resizeHandle.addEventListener('pointercancel', stopDrag);
  }

  let previewSyncQueued = false;
  const previewObserver = new MutationObserver(() => {
    if (previewSyncQueued) return;
    previewSyncQueued = true;
    requestAnimationFrame(() => {
      previewSyncQueued = false;
      syncPreviewFromCanvas();
      syncFooter();
    });
  });
  previewObserver.observe(document.getElementById('ui-primary-canvas') || document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'class', 'style', 'hidden']
  });

  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 599px)').matches) {
      mini.style.width = '';
    }
  });
})();
