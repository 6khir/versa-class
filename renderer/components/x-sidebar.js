// renderer/components/x-sidebar.js

class XSidebar extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const template = document.createElement('template');
    template.innerHTML = `
      <style>
        @import url('./theme.css');
        .sidebar { width: 250px; background: var(--bg-secondary); color: var(--text); padding: 8px; box-sizing: border-box; }
        button { margin: 4px 0; width: 100%; }
      </style>
      <aside class="sidebar">
        <button id="new-project-button" class="button button-primary button-full">＋ New book</button>
        <div class="sidebar-heading">
          <span>Books</span>
          <span id="project-count" class="count-badge">0</span>
        </div>
        <div id="project-list" class="project-list"></div>
        <button id="bundle-upload-sidebar-btn" class="bundle-sidebar-btn" hidden style="display:none">⚡ Bundle upload</button>
        <span id="bundle-ready-badge" class="bundle-ready-badge" hidden>0</span>
        <div class="privacy-card">
          <span class="privacy-icon">⌂</span>
          <div><strong>Private</strong><p>Files stay on this Mac.</p></div>
        </div>
      </aside>
    `;
    shadow.appendChild(template.content.cloneNode(true));
    // Event delegation for buttons
    this.shadowRoot.querySelector('#new-project-button').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('new-project', { bubbles: true, composed: true }));
    });
    this.shadowRoot.querySelector('#bundle-upload-sidebar-btn').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('bundle-upload', { bubbles: true, composed: true }));
    });
  }
}
customElements.define('x-sidebar', XSidebar);
