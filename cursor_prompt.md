You are implementing a complete UI re-architecture of an Electron app while preserving ALL existing backend APIs, business logic, and data flows.

Workspace: `/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )`

The user's name is Versa. Follow the 1B USD UI/UX Engineering Standard in GEMINI.md (read it first). Follow user git commit rules: commit ONLY because they explicitly asked.

## High-Level Goals
- New aesthetic and layout: abandon the current sidebar-header-main-canvas structure; introduce fresh visual hierarchy, modern component placement, and a floating Mini Canva dashboard.
- Zero functional regression: keep all window.tptDesktop API calls, data-action attributes, and event-driven flows untouched.
- Optimistic UI & micro-interactions: instant UI updates, skeleton placeholders, spring-based animations, keyboard-first shortcuts, ARIA-compliant accessibility.
- Maintainability: pure HTML/CSS/JS (no new framework), CSS variables for theming, modular 4px/8px spacing, Inter/Geist typography.

## Constraints (Must-Follow)
- No changes to backend JavaScript (renderer/renderer.js) except optional additions to the elements map for new IDs.
- Preserve all existing data-action attributes – they continue to be consumed by handleAction(action, element).
- Do not introduce new runtime dependencies (no React, Vue, etc.).
- Comply with the 1B USD UI/UX Engineering Standard (optimistic UI, skeletons, spring physics, modular scale, Inter font, CSS variables, keyboard-first, zero data loss).
- All colors must be expressed via CSS variables – no raw #000/#fff in component CSS (variables themselves may define hex values).
- Avoid layout shift – reserve space for dynamic content.
- All new HTML must be valid and pass W3C validation.

## Design Requirements

### General Layout
- Header – minimal, contains app title, global search (⌘K), and a user-profile menu.
- Primary Canvas Area – takes the center-left of the viewport, fills remaining height.
- Mini Canva Dashboard – floating, resizable panel anchored to the right-hand side (desktop) or bottom sheet (mobile). Live preview of current canvas, toolbar with zoom, rotate, and quick-export buttons.
- Sidebar – collapsed by default; expands on hover or ⌘B. Holds project navigation, asset library, and settings.
- Footer – status bar with progress indicators and keyboard shortcut hints.

### Mini Canva Dashboard Specifics
- Component ID: mini-canva-dashboard
- ARIA role: region with aria-label="Mini Canva Dashboard"
- Keyboard shortcut: ⌘M toggles visibility; ⌘+/⌘- control zoom.
- Interaction: All internal buttons use data-action attributes (data-action="mini-zoom-in", data-action="mini-export", …) to route through existing handleAction flow.
- Skeleton state: while preview image is loading, show a gray block matching final dimensions.
- Animation: slide-in/out using Framer-Motion-style CSS spring (transition: transform 0.25s cubic-bezier(0.16,1,0.3,1)).
- Responsive: collapses to a bottom drawer on viewports < 600px.

Placeholder markup to include:
```html
<section id="mini-canva-dashboard" role="region" aria-label="Mini Canva Dashboard">
  <div class="mini-preview skeleton"></div>
  <div class="mini-toolbar">
    <button data-action="mini-zoom-in" title="Zoom In (⌘+)">+</button>
    <button data-action="mini-zoom-out" title="Zoom Out (⌘-)">‑</button>
    <button data-action="mini-export" title="Export (⌘E)">Export</button>
  </div>
</section>
```
Also add rotate if design requires it. Add any extra mini-canva buttons with data-action attributes.

### Typography & Spacing
- Font family: Inter, system-ui, sans-serif (fallback to Geist)
- Base font size: 16px; headings use 4/8 px modular scale (h1=32px, h2=24px)
- Letter-spacing: negative tracking on headers (letter-spacing: -0.02em)
- Margins/Paddings: multiples of 4px

### Colors (CSS Variables) — must include:
```css
:root {
  --color-bg: #f5f5f5;
  --color-bg-dark: #1a1a1a;
  --color-primary: #2563eb;
  --color-primary-dark: #60a5fa;
  --color-text: #111827;
  --color-text-dark: #d1d5db;
  --color-border: #e5e7eb;
  --color-border-dark: #374151;
}
```
Use these plus additional semantic tokens as needed. In dark mode, map backgrounds/text/borders via these tokens. No raw #000/#fff in rules outside :root variable definitions.

### Micro-Interactions
- Button press: subtle scale-down (transform: scale(0.97)) with spring-back
- Hover reveal: opacity fade-in, translateY(4px) using same cubic-bezier
- Toast notifications: slide-down from top, auto-dismiss after 3s, pause on hover

## Deliverables
1. `renderer/ui.css` – Complete stylesheet implementing the 1B USD design system (variables, modular scale, spring transitions, responsive layout, dark-mode support). Scope new CSS with BEM-style prefixes like `ui-` or component IDs to avoid clobbering existing styles.
2. `renderer/index.html` – New HTML skeleton: header, primary canvas container, collapsible sidebar, footer, and `<section id="mini-canva-dashboard">`. Preserve ALL existing IDs used by the backend (e.g. #runBtn, #pauseBtn). Link `<link rel="stylesheet" href="ui.css">` BEFORE any existing CSS. Keep index.html as the first/primary renderer HTML. All existing data-action attributes must remain.
3. `renderer/ui.js` (optional but expected) – Minimal helper to toggle Mini Canva dashboard (Cmd+M), persist open/closed in localStorage. Also Cmd+B for sidebar, Cmd+K for search focus if those are UI-only. No new business logic. Do NOT implement handleAction yourself for existing app actions.
4. `README-UI-REDESIGN.md` – Documentation: new structure, how to map existing data-actions, accessibility audit checklist.
5. `cursor_prompt.md` – Save the full end-to-end instruction set (the user's prompt) as this artifact at repo root.
6. Update elements map in `renderer/renderer.js` ONLY: add `miniCanvaDashboard: document.getElementById('mini-canva-dashboard')`. No other code changes in renderer.js.
7. If ui.js needs to be loaded, add a script tag in index.html. Do not break existing script loading of renderer.js.

## Implementation Steps
1. Explore the repo thoroughly: renderer/index.html, renderer/renderer.js, existing CSS, GEMINI.md, package.json, how data-action and elements map work, all IDs, all data-action values.
2. If repo is corrupted, first: `git reset --hard HEAD && git clean -fd` — ONLY if actually corrupted. Do not destroy uncommitted work unless the repo is actually unusable.
3. Create ui.css with CSS variables, global resets scoped carefully, typography, layout grid, animations.
4. Rewrite index.html: new structure but MOVE (do not delete) all existing functional controls/IDs into the new layout. Existing toolbar buttons (run, pause, export, etc.) must still exist with same IDs and data-actions.
5. Add ui.js for Cmd+M, Cmd+B, Cmd+K, localStorage persistence.
6. Update elements map in renderer.js (only that).
7. Add skeleton placeholders for async content.
8. Verify accessibility (focus order, ARIA, contrast).
9. Test: if possible `npm run start` or at least inspect files; `npm run lint` if lint script exists.
10. COMMIT with this exact message style:
```
feat(ui): complete redesign with Mini Canva dashboard – 1B USD compliance
```
User explicitly requested this commit. Follow git safety protocol:
- NEVER update git config
- NEVER skip hooks
- NEVER force push
- Run git status, git diff, git log in parallel first
- Do not commit secrets (.env, credentials)
- Stage relevant files only
- Commit via HEREDOC:
```
git commit -m "$(cat <<'EOF'
feat(ui): complete redesign with Mini Canva dashboard – 1B USD compliance

EOF
)"
```
- git status after commit
- Do NOT push unless asked (they did not ask to push)

## Critical preservation
You MUST inventory every:
- element id in index.html used by renderer.js
- data-action value
- class names that renderer.js or existing CSS/JS depend on
- script/link tags
- IPC / window.tptDesktop usage (do not change)

Re-home these into the new visual layout. Functionally identical.

Mini-canva data-actions (mini-zoom-in, mini-zoom-out, mini-export, etc.) should exist so they route through handleAction. If handleAction doesn't know them yet, that's OK — they still must use data-action so they go through the existing flow. Do NOT add new business logic in renderer.js for those actions unless the existing handleAction already has a default/unknown path that just logs.

CSS: all new CSS scoped with `ui-` BEM prefixes or component IDs.

Link order: ui.css BEFORE existing CSS.

You MAY split work into internal subagents if helpful (HTML inventory vs CSS vs docs) but you own the end-to-end result.

## Browser / app verification
If Electron can be started, do a smoke check. If browser tools exist, use them only if a web-served renderer is available. User rule: verify UI in browser if possible. If you cannot launch Electron, say what you verified by static inspection.

## Return to parent
When done, return a concise summary:
- Files created/changed
- How existing IDs/data-actions were preserved
- Whether commit succeeded (hash)
- Any verification you ran (lint, start, a11y)
- Anything you could not do
- Remaining risks

Do not modify files outside the requested deliverables except what's needed to wire ui.css/ui.js into index.html and the one elements-map line.
