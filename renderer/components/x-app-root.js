// renderer/components/x-app-root.js

class XAppRoot extends HTMLElement {
  constructor() {
    super();
    const template = document.createElement('template');
    template.innerHTML = `
      <link rel="stylesheet" href="./theme.css" />
      <x-header></x-header>
      <div class="layout" style="display:flex;">
        <x-sidebar></x-sidebar>
        <x-content></x-content>
      </div>
    `;
    this.appendChild(template.content.cloneNode(true));
    // Lazy load child component modules
    import('./x-header.js');
    import('./x-sidebar.js');
    import('./x-content.js');
    import('./x-footer.js');
    import('./x-canva-dashboard.js');
  }
}
customElements.define('x-app-root', XAppRoot);
