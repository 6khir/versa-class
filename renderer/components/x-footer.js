// renderer/components/x-footer.js

class XFooter extends HTMLElement {
  constructor() {
    super();
    const template = document.createElement('template');
    template.innerHTML = `
      <style>
        @import url('./theme.css');
        .footer { padding: 8px; text-align: center; font-size: 0.875rem; color: var(--text-muted); }
      </style>
      <footer class="footer">
        <slot>© 2026 VERSA CLASS</slot>
      </footer>
    `;
    this.appendChild(template.content.cloneNode(true));
  }
}
customElements.define('x-footer', XFooter);
