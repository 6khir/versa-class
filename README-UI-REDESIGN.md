# VERSA CLASS UI redesign

This document describes the 1B USD UI/UX re-architecture. Backend APIs, `window.tptDesktop`, and `handleAction` flows are unchanged.

## New structure

The renderer shell is `renderer/index.html` (still the primary Electron HTML). New chrome wraps the existing workspace instead of replacing it.

```
body.ui-redesign
  skip link
  #ui-shell
    #ui-header          title, ⌘K search, profile cluster
    #ui-body
      .workspace
        #ui-sidebar     books, bundle upload, library + settings
        .ui-canvas-column
          #automation-bar
          #background-generation-bar
          #ui-primary-canvas.main-content
            existing project workspace, tabs, Canva Magic Layer, listing, export
      #mini-canva-dashboard
    #ui-footer          status, progress, shortcut hints
  existing dialogs, overlays, #toast-host
  product-pipeline.js → renderer.js → guide.js → ui.js
```

Stylesheet order: `ui.css` first, then the original theme sheets (`styles.css`, `guide.css`, `mac-theme.css`, `apple-vibrancy-theme.css`, `midnight-theme.css`). New rules are scoped with `ui-` BEM prefixes, `#mini-canva-dashboard`, or `body.ui-redesign` so they override layout without clobbering component CSS.

### Layout behavior

| Region | Default | Keyboard | Persistence |
| --- | --- | --- | --- |
| Sidebar | Collapsed 48px rail; expands on hover / focus | ⌘B pins open | `localStorage.ui-sidebar-pinned` |
| Mini Canva | Hidden, floating right (bottom drawer &lt; 600px) | ⌘M | `localStorage.ui-mini-canva-open` |
| Search | Header field | ⌘K focuses | Filters `.project-item` text only |
| Zoom | Preview transform | ⌘+ / ⌘- when Mini Canva is open | `localStorage.ui-mini-canva-zoom` |

`renderer/ui.js` is UI-only. It does not call `window.tptDesktop` and does not reimplement `handleAction`.

## Mapping existing data-actions

Existing controls keep their original `data-action` values. Clicks still bubble to the document listener in `renderer/renderer.js`, which calls `handleAction(action, element)`.

Preserve these (non-exhaustive; the HTML still contains the full set):

- Project: `new-project`, `select-project`, `select-job`, `select-workspace-view`, `run-stage`, `start-full-automation`, `toggle-product-format`
- Settings / appearance: `open-settings`, `close-settings`, `select-settings-tab`, `set-appearance`, `set-ai-engine`, `check-update`, `install-update`
- Canva workspace: `run-canva-editable`, `open-canva-template`, `clear-canva-template`
- Dialogs: `close-dialog`, `choose-prompt-method`, `choose-analysis-method`, `back-to-methods`, …

IDs consumed by the `elements` map (`run-button`, `pause-button`, `jobs-table`, `project-list`, …) were moved, not renamed.

### New UI-only data-actions

These buttons still go through `handleAction`. Unknown actions currently no-op in renderer.js (they are not given new business logic). `ui.js` applies the visual behavior.

| `data-action` | UI effect |
| --- | --- |
| `mini-zoom-in` | Scale live preview up |
| `mini-zoom-out` | Scale live preview down |
| `mini-zoom-fit` | Reset scale to 100% |
| `mini-rotate` | Rotate preview 90° |
| `mini-export` | Present in the toolbar (⌘E clicks it). No new export pipeline. |
| `mini-toggle` | Show / hide Mini Canva |
| `ui-toggle-sidebar` | Pin / unpin sidebar |
| `ui-focus-search` | Focus the header search field |

`elements.miniCanvaDashboard` is the only renderer.js addition (`#mini-canva-dashboard`).

## Accessibility audit checklist

- [x] One `h1` in the app header; Mini Canva uses `h2`
- [x] Skip link to `#ui-primary-canvas`
- [x] Mini Canva is `role="region"` with `aria-label="Mini Canva Dashboard"`
- [x] Toolbar uses `role="toolbar"`; icon buttons have `aria-label` or visible text
- [x] Sidebar `aria-expanded` / toggle `aria-pressed` stay in sync
- [x] Closed Mini Canva uses `aria-hidden` and `inert` (not `hidden`, so the spring can play)
- [x] Search input has a `<label>` (visually hidden)
- [x] Decorative monogram uses empty `alt`; `h1` names the app
- [x] `:focus-visible` rings on new chrome
- [x] Keyboard: ⌘K, ⌘B, ⌘M, ⌘+/⌘-, Escape closes the profile menu
- [x] Shortcuts are ignored while a `<dialog open>` is in front
- [x] `prefers-reduced-motion` disables springs
- [x] Skeleton blocks reserve Mini Canva preview, project-list, jobs table, event log height
- [x] Contrast on new chrome uses `--color-text` / `--color-bg` tokens (no raw `#000` / `#fff` in `ui.css` rules)
- [ ] Screen-reader pass in VoiceOver (run on device)
- [ ] Full W3C Nu Html Checker pass (system `tidy` is HTML4-only; structural parser reported balanced tags)

## Files

| File | Role |
| --- | --- |
| `renderer/ui.css` | Design tokens, shell layout, Mini Canva, springs, dark-mode mapping |
| `renderer/ui.js` | Chrome toggles, localStorage, preview transform, project-list filter |
| `renderer/index.html` | New shell; all previous functional IDs and data-actions retained |
| `renderer/renderer.js` | `mini-canva-dashboard` added to the elements map only |
| `cursor_prompt.md` | Source prompt for this redesign |

Do not add React/Vue or new runtime dependencies. Do not change IPC or `window.tptDesktop` usage.
