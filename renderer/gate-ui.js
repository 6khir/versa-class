/* Gate presentation: typewriter + prompt routing.
   Clicks existing production controls only — no fetch / IPC / state mutation. */
(function initVersaGate() {
  const typeEl = document.getElementById('studio-intro-typewriter');
  if (typeEl) {
    const phrases = [
      'Which book is in your mind today?',
      "Let's turn your idea into a masterpiece.",
      'What story are we writing next?'
    ];
    let phrase = 0;
    let index = 0;
    let deleting = false;
    const tick = () => {
      const full = phrases[phrase];
      typeEl.textContent = full.slice(0, index);
      if (!deleting && index < full.length) {
        index += 1;
        setTimeout(tick, 55);
      } else if (!deleting && index === full.length) {
        deleting = true;
        setTimeout(tick, 2600);
      } else if (deleting && index > 0) {
        index -= 1;
        setTimeout(tick, 26);
      } else {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        setTimeout(tick, 400);
      }
    };
    tick();
  }

  function syncEngineAttr() {
    const toggle = document.getElementById('project-format-toggle');
    const label = String(toggle?.textContent || toggle?.getAttribute('aria-label') || '').toLowerCase();
    const format = document.body.dataset.productFormat
      || (label.includes('editable') ? 'editable' : 'static');
    document.body.dataset.engine = format === 'editable' ? 'editable' : 'static';
    if (!document.body.dataset.productFormat) {
      document.body.dataset.productFormat = format === 'editable' ? 'editable' : 'static';
    }
  }

  function routeGateQuery(raw) {
    const query = String(raw || '').trim().toLowerCase();
    if (!query) return;

    if (/\b(settings|profile|account)\b/.test(query)) {
      document.querySelector('[data-action="open-settings"]')?.click();
      return;
    }
    if (/\b(history|library|books)\b/.test(query)) {
      document.getElementById('studio-library-btn')?.click();
      return;
    }
    if (/\b(atelier|studio|workspace|cockpit)\b/.test(query)) {
      document.getElementById('studio-cockpit-btn')?.click();
      return;
    }

    const wantsEditable = /\beditable\b/.test(query);
    const wantsStatic = /\bstatic\b/.test(query) || /\bnon[- ]?editable\b/.test(query);
    if (wantsEditable || wantsStatic) {
      document.body.dataset.productFormat = wantsEditable ? 'editable' : 'static';
      document.body.dataset.engine = wantsEditable ? 'editable' : 'static';
      const toggle = document.getElementById('project-format-toggle');
      const isEditableLabel = /editable/i.test(String(toggle?.textContent || ''));
      if (toggle && ((wantsEditable && !isEditableLabel) || (wantsStatic && isEditableLabel))) {
        toggle.click();
      }
    }

    const search = document.getElementById('ui-global-search');
    if (search && !/^(editable|static|non-?editable)$/i.test(query)) {
      search.value = String(raw || '').trim();
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (/\b(new book|create|generate)\b/.test(query) || wantsEditable || wantsStatic) {
      document.querySelector('[data-action="new-project"]')?.click();
    }
  }

  const form = document.getElementById('studio-intro-prompt');
  const routeInput = document.getElementById('studio-intro-route');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = routeInput?.value || '';
    // ui.js also listens for submit and calls enterDoor — route after the door opens.
    window.setTimeout(() => routeGateQuery(value), 40);
  });

  const observer = new MutationObserver(syncEngineAttr);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-product-format', 'class'] });
  document.getElementById('project-format-toggle')?.addEventListener('click', () => {
    window.setTimeout(syncEngineAttr, 0);
  });
  syncEngineAttr();
})();
