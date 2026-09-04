class XHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        @import url('./theme.css');
        .topbar { display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg); color: var(--text); }
        .brand-block { display: flex; align-items: center; gap: 8px; }
        .brand-icon { width: 24px; height: 24px; }
        .topbar-actions { display: flex; gap: 8px; }
        button { background: none; border: none; color: inherit; font: inherit; padding: 4px 8px; }
        button:focus { outline: 2px solid var(--color-primary); }
      </style>
      <header class="topbar">
        <div class="brand-block">
          <img class="brand-icon" src="../assets/brand/versa-monogram.png" alt="VERSA CLASS" />
          <div>
            <p class="eyebrow">MAKES SUCCESS</p>
            <h1>VERSA CLASS</h1>
          </div>
        </div>
        <div class="topbar-actions" id="topbar-actions">
          <!-- actions will be injected by renderer.js -->
        </div>
      </header>
    `;
  }
}
customElements.define('x-header', XHeader);
