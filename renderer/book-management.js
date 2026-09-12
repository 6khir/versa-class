(function attachVersaBookManagement(global) {
  const api = () => global.tptDesktop || {};

  function byId(id) {
    return global.document.getElementById(id);
  }

  function setStatus(message, isError) {
    const node = byId('book-mgmt-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = isError ? 'error' : 'info';
  }

  function selectedButton(list) {
    return list?.querySelector('.book-mgmt-dialog__item.is-selected');
  }

  function destinationFromButton(button) {
    if (!button) return null;
    try {
      return JSON.parse(button.dataset.destination || 'null');
    } catch {
      return null;
    }
  }

  function renderBooks(books, selectedId) {
    const list = byId('book-mgmt-list');
    if (!list) return;
    const rows = Array.isArray(books) ? books : [];
    if (!rows.length) {
      list.innerHTML = '<li class="book-mgmt-dialog__empty">No books yet.</li>';
      return;
    }
    list.innerHTML = rows.map((book) => {
      const active = book.productId === selectedId;
        const badge = book.suggested ? 'Next empty' : (book.empty ? 'Empty' : (book.status || 'Book'));
      const title = book.productId || book.name || 'Untitled';
      const subtitle = book.name && book.name !== book.productId ? book.name : (book.bookPath || 'Management folder');
      return `<li>
        <button type="button" class="book-mgmt-dialog__item${active ? ' is-selected' : ''}" role="option" aria-selected="${active ? 'true' : 'false'}" data-id="${escapeAttr(book.productId)}" data-destination="${escapeAttr(JSON.stringify(book))}">
          <span>
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(subtitle)}</small>
          </span>
          <span class="book-mgmt-dialog__badge">${escapeHtml(badge)}</span>
        </button>
      </li>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", '&#039;');
  }

  function hostTheme() {
    return global.document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function frameUrl(base) {
    const root = String(base || 'http://127.0.0.1:5000/').replace(/\/?$/, '/');
    return `${root}?theme=${hostTheme()}`;
  }

  function needsFirstRun(status) {
    return !String(status?.rootPath || '').trim();
  }

  function showSetup(needsFolders) {
    const setup = byId('versa-management-setup');
    const frame = byId('versa-management-frame');
    if (needsFolders) {
      setup?.removeAttribute('hidden');
      if (frame) frame.hidden = true;
    } else {
      setup?.setAttribute('hidden', '');
      if (frame) frame.hidden = false;
    }
  }

  function refreshSettingsRoot(rootPath) {
    const node = byId('settings-management-root');
    if (!node) return;
    node.textContent = rootPath || 'No folders yet.';
  }

  function syncFrameTheme() {
    const frame = byId('versa-management-frame');
    const theme = hostTheme();
    if (!frame) return;
    try {
      frame.contentWindow?.postMessage({ type: 'versa-theme', theme }, '*');
    } catch {
      /* isolated until loaded */
    }
  }

  async function chooseFolders() {
    const status = byId('versa-management-status');
    const bridge = api();
    if (typeof bridge.chooseBookManagementRoot !== 'function') {
      if (status) status.textContent = 'Restart the app.';
      return { ok: false, code: 'BRIDGE_STALE' };
    }
    if (status) status.textContent = 'Choosing…';
    try {
      const result = await bridge.chooseBookManagementRoot();
      if (result?.cancelled) {
        if (status) status.textContent = 'Choose folders.';
        return result;
      }
      refreshSettingsRoot(result?.rootPath);
      showSetup(false);
      return openChannel();
    } catch (error) {
      if (status) status.textContent = error?.message || 'Could not start.';
      return { ok: false, error: error?.message };
    }
  }

  async function openChannel() {
    if (typeof global.__versaSetStudioMode === 'function') {
      global.__versaSetStudioMode('management', true);
    } else {
      global.document.body.dataset.mode = 'management';
      global.document.body.dataset.layer = 'management';
    }
    const channel = byId('versa-management-channel');
    const frame = byId('versa-management-frame');
    const status = byId('versa-management-status');
    channel?.removeAttribute('hidden');
    if (status) status.textContent = 'Starting…';
    const bridge = api();
    if (typeof bridge.bookManagementStatus !== 'function' || typeof bridge.ensureBookManagement !== 'function') {
      if (status) status.textContent = 'Restart the app.';
      return { ok: false, code: 'BRIDGE_STALE' };
    }
    try {
      const current = await bridge.bookManagementStatus();
      refreshSettingsRoot(current?.rootPath);
      if (needsFirstRun(current)) {
        showSetup(true);
        if (status) status.textContent = 'Choose folders.';
        return { ok: false, needsFolders: true, code: 'MANAGEMENT_ROOT_REQUIRED' };
      }
      showSetup(false);
      const state = await bridge.ensureBookManagement();
      if (frame) frame.src = frameUrl(state.url || current.url || 'http://127.0.0.1:5000/');
      if (status) status.textContent = state.ok ? 'Connected' : (state.error || 'Not running.');
      syncFrameTheme();
      return state;
    } catch (error) {
      if (status) status.textContent = error?.message || 'Could not start.';
      return { ok: false, error: error?.message, code: error?.code || 'MANAGEMENT_UNAVAILABLE' };
    }
  }

  async function loadPicker(query) {
    const bridge = api();
    if (typeof bridge.listBookManagement !== 'function') {
      throw Object.assign(new Error('Restart the app.'), { code: 'BRIDGE_STALE' });
    }
    return bridge.listBookManagement(query);
  }

  function closePicker(dialog, resolve, value) {
    if (dialog?.open) dialog.close();
    if (typeof resolve === 'function') resolve(value);
  }

  function pickDestination({ query = '' } = {}) {
    const dialog = byId('book-management-export-dialog');
    const search = byId('book-mgmt-search');
    const list = byId('book-mgmt-list');
    const form = byId('book-management-export-form');
    if (!dialog) {
      return Promise.reject(Object.assign(new Error('Restart the app.'), { code: 'MANAGEMENT_PICKER_MISSING' }));
    }

    return new Promise((resolve) => {
      let settled = false;
      let books = [];
      let selectedId = '';

      const finish = (value) => {
        if (settled) return;
        settled = true;
        closePicker(dialog, resolve, value);
      };

      const refresh = async () => {
        setStatus('Loading…');
        try {
          const payload = await loadPicker(search?.value || query);
          books = payload.books || [];
          if (!selectedId) selectedId = payload.suggested?.productId || books[0]?.productId || '';
          renderBooks(books, selectedId);
          setStatus(books.length
            ? `Pick a book${payload.suggested?.productId ? ` ${payload.suggested.productId}` : '.'}`
            : 'No books found.');
        } catch (error) {
          books = [];
          renderBooks([]);
          setStatus(error?.message || 'Not running.', true);
        }
      };

      list.onclick = (event) => {
        const button = event.target.closest('.book-mgmt-dialog__item');
        if (!button) return;
        selectedId = button.dataset.id || '';
        list.querySelectorAll('.book-mgmt-dialog__item').forEach((node) => {
          const on = node === button;
          node.classList.toggle('is-selected', on);
          node.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      };

      form.onsubmit = (event) => {
        event.preventDefault();
        const destination = destinationFromButton(selectedButton(list));
        if (!destination?.bookPath) {
          setStatus('Pick a book.', true);
          return;
        }
        finish(destination);
      };

      byId('book-mgmt-cancel').onclick = () => finish(null);
      byId('book-mgmt-close').onclick = () => finish(null);
      byId('book-mgmt-open-channel').onclick = () => {
        finish(null);
        openChannel();
      };
      let debounce = 0;
      search.oninput = () => {
        global.clearTimeout(debounce);
        debounce = global.setTimeout(() => { refresh(); }, 160);
      };

      if (search) search.value = query;
      if (!dialog.open) dialog.showModal();
      refresh();
    });
  }

  async function pickAndExport({ project, exportMode, onError, onSuccess } = {}) {
    const destination = await pickDestination();
    if (!destination) return null;
    const bridge = api();
    if (typeof bridge.exportAllFiles !== 'function') {
      const error = Object.assign(new Error('Restart the app.'), { code: 'BRIDGE_STALE' });
      onError?.(error);
      throw error;
    }
    try {
      const path = await bridge.exportAllFiles(project.id, {
        exportMode,
        managementDestination: destination,
        bookName: project.name
      });
      onSuccess?.(path, destination);
      return path;
    } catch (error) {
      onError?.(error);
      throw error;
    }
  }

  function bindChrome() {
    const open = (event) => {
      event?.preventDefault?.();
      openChannel();
    };
    byId('studio-management-btn')?.addEventListener('click', open);
    byId('versa-management-choose-folders')?.addEventListener('click', chooseFolders);
    byId('settings-management-pick-folders')?.addEventListener('click', chooseFolders);
    global.document.querySelectorAll('[data-action="open-versa-management"]').forEach((node) => {
      node.addEventListener('click', open);
    });
    syncFrameTheme();
    const themeWatcher = new global.MutationObserver(syncFrameTheme);
    themeWatcher.observe(global.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  global.versaBookManagement = {
    openChannel,
    chooseFolders,
    needsFirstRun,
    pickDestination,
    pickAndExport,
    renderBooks,
    bindChrome,
    syncTheme: syncFrameTheme
  };

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bindChrome, { once: true });
  } else {
    bindChrome();
  }
}(typeof window !== 'undefined' ? window : globalThis));
