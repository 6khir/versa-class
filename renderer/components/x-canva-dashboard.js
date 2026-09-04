// renderer/components/x-canva-dashboard.js

class XCanvaDashboard extends HTMLElement {
  constructor() {
    super();
    const template = document.createElement('template');
    template.innerHTML = `
      <style>
        @import url('./theme.css');
        .canva-dash-head { margin-bottom: 8px; }
        .canva-dash-pill { margin-right: 4px; }
        .canva-dash-card { margin-top: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 4px; }
        .stage-live-bar { margin-top: 12px; }
        .footer { text-align: center; font-size: 0.875rem; color: var(--text-muted); }
      </style>
      <section class="canva-live-dashboard" aria-label="Live editable build process">
        <header class="canva-dash-head">
          <div>
            <p class="eyebrow">Live editable build</p>
            <h4 id="canva-dash-title">Waiting</h4>
            <p id="canva-dash-status">Ready when you build. The print PDF is imported once, then Magic Layer runs page by page.</p>
          </div>
          <div class="canva-dash-pills">
            <span id="canva-dash-attempt" class="canva-dash-pill" hidden></span>
            <span id="canva-dash-clock" class="canva-dash-pill" hidden></span>
          </div>
        </header>
        <p id="canva-dash-error" class="canva-dash-error" hidden></p>
        <ol class="canva-path-steps" id="canva-path-steps">
          <li data-canva-step="1" data-canva-dash="pdf"><span class="step-fill" aria-hidden="true"></span><span class="step-copy"><strong>Load PDF</strong><small>Waiting</small></span><span class="step-percent">0%</span></li>
          <li data-canva-step="2" data-canva-dash="import"><span class="step-fill" aria-hidden="true"></span><span class="step-copy"><strong>Import file</strong><small>Waiting</small></span><span class="step-percent">0%</span></li>
          <li data-canva-step="3" data-canva-dash="upload"><span class="step-fill" aria-hidden="true"></span><span class="step-copy"><strong>Upload 100%</strong><small>Waiting</small></span><span class="step-percent">0%</span></li>
          <li data-canva-step="4" data-canva-dash="thumbnails"><span class="step-fill" aria-hidden="true"></span><span class="step-copy"><strong>Design ready</strong><small>Waiting</small></span><span class="step-percent">0%</span></li>
          <li data-canva-step="5" data-canva-dash="template"><span class="step-fill" aria-hidden="true"></span><span class="step-copy"><strong>Template link</strong><small>Waiting</small></span><span class="step-percent">0%</span></li>
          <li data-canva-step="6" data-canva-dash="saved"><span class="step-fill" aria-hidden="true"></span><span class="step-copy"><strong>Link saved</strong><small>Waiting</small></span><span class="step-percent">0%</span></li>
        </ol>
        <div class="canva-dash-cards">
          <article class="canva-dash-card" id="canva-dash-pdf-card">
            <strong>Print PDF</strong>
            <p id="canva-dash-pdf-copy">Uses book.pdf prepared in Interior.</p>
          </article>
          <article class="canva-dash-card" id="canva-dash-upload-card">
            <strong>Upload to 100%</strong>
            <div class="canva-dash-upload-meta">
              <span id="canva-dash-upload-percent">—</span>
              <span id="canva-dash-upload-elapsed"></span>
              <span id="canva-dash-upload-remaining"></span>
            </div>
            <div class="progress-track canva-dash-upload-track"><span id="canva-dash-upload-fill"></span></div>
            <p id="canva-dash-upload-copy">The 100% bar appears after Import file.</p>
          </article>
        </div>
        <div class="stage-live-bar" id="canva-live-bar">
          <div class="stage-live-meta">
            <strong id="canva-progress-label">Canva editable</strong>
            <span id="canva-progress-elapsed"></span>
            <span id="canva-progress-percent">0%</span>
          </div>
          <div class="progress-track"><span id="canva-progress-fill"></span></div>
          <p id="canva-progress-message">Ready. Empty page slots fill in as Magic Layer is applied.</p>
        </div>
        <details class="canva-dash-details" id="canva-dash-details">
          <summary>Show step details</summary>
          <ol id="canva-dash-log" class="canva-dash-log"></ol>
        </details>
        <p id="canva-pdf-status" class="canva-pdf-status muted"></p>
        <p id="canva-editable-status" class="canva-editable-status"></p>
        <p id="canva-editable-link" class="canva-editable-link muted"></p>
        <section class="canva-page-board" id="canva-page-board" aria-label="Canva page dashboard">
          <div class="canva-page-board-head">
            <div>
              <h4>Page dashboard</h4>
              <p class="muted" id="canva-page-board-meta">Same idea as Interior and Mockups: slots stay empty until Magic Layer fills them.</p>
            </div>
            <strong id="canva-page-board-count">0 / 0 Magic Layer applied</strong>
          </div>
          <div class="canva-page-grid" id="canva-page-grid"></div>
        </section>
        <div class="export-actions">
          <button id="run-canva-editable-button" class="button button-primary" data-action="run-canva-editable" type="button">Build Canva layer</button>
          <button id="open-canva-template-button" class="button button-ghost" data-action="open-canva-template" type="button">Open template</button>
          <button id="clear-canva-template-button" class="button button-ghost button-danger" data-action="clear-canva-template" type="button">Clear template</button>
        </div>
      </section>
    `;
    this.appendChild(template.content.cloneNode(true));
    // Cache frequently accessed elements for quick updates
    this._steps = this.querySelectorAll('#canva-path-steps li');
    this._progressFill = this.querySelector('#canva-progress-fill');
    this._progressPercent = this.querySelector('#canva-progress-percent');
    this._progressMessage = this.querySelector('#canva-progress-message');
  }

  /** Update a specific step's UI (e.g., status text or percent). */
  updateStep(stepNumber, { statusText, percent }) {
    const stepEl = this._steps[stepNumber - 1];
    if (!stepEl) return;
    const copySpan = stepEl.querySelector('.step-copy');
    if (statusText) copySpan.innerHTML = `<strong>${copySpan.querySelector('strong').textContent}</strong><small>${statusText}</small>`;
    if (percent !== undefined) stepEl.querySelector('.step-percent').textContent = `${percent}%`;
  }

  /** Update the live progress bar for the editable vectorize build. */
  setProgress({ percent, message }) {
    if (percent !== undefined) {
      this._progressFill.style.width = `${percent}%`;
      this._progressPercent.textContent = `${percent}%`;
    }
    if (message) this._progressMessage.textContent = message;
  }
}

customElements.define('x-canva-dashboard', XCanvaDashboard);
