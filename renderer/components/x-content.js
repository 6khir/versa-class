// renderer/components/x-content.js

class XContent extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const template = document.createElement('template');
    template.innerHTML = `
      <style>
        @import url('./theme.css');
        .content { flex: 1; padding: 8px; background: var(--bg); color: var(--text); overflow: auto; }
      </style>
      <main class="content">
        <slot></slot>
      </main>
    `;
    shadow.appendChild(template.content.cloneNode(true));
  }
}
customElements.define('x-content', XContent);
