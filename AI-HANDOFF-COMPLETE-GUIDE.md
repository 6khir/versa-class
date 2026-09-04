# VERSA CLASS — AI HANDOFF COMPLETE GUIDE

**Read this before you touch anything.**  
If you are an AI, your default action on the Canva / Magic Layer / share / thank-you pipeline is **do not change it**.

This file exists so future agents refuse to “improve,” simplify, retry, or rewrite the working automation. The product already ships TPT books. The Canva path is proven. Experimentation here costs real books, real Canva sessions, and hours of recovery.

---

## Main purpose of the software

**VERSA CLASS** is an Electron app that builds Teachers Pay Teachers (TPT) printable + editable products.

What it actually does:

1. Generate a book (interior pages, listing, mockups, print PDF).
2. Send the **print PDF** to Canva (not per-page image uploads).
3. Apply **Magic Layers** on every page so TPT buyers can edit the design.
4. Publish a **real public Canva template link** (`canva.link` / public share).
5. Stamp that link into the thank-you PDF.
6. Name exports with the book code and zip for TPT.

This is **not** a generic Canva bot. It is not a playground for click heuristics. It is a production pipeline for one product at a time.

### This book (live project)

- Title: **Visual Schedule & Positive Behavior Flipbook System**
- Pages: **54**
- Project id: `554dd8b0-b94b-4a1d-af27-eee9cac5d82f`
- Design: `DAHUJ55SiGI`
- Editor: `https://www.canva.com/design/DAHUJ55SiGI/fSUcqfFtxzQNr8QT0shBEg/edit`
- Public template (real, harvested): `https://canva.link/177ccnqdf1mf5uk`
- SQLite: `/Users/abdelmouiz/Library/Application Support/TPT VERSA/tpt-books.sqlite`
- Pages 2–54 were Magic Layered by the job. Page 1 is a designed cover (illustration + text + frames), not a full-page raster. The operator confirmed page 1 **is already Magic Layered**. The leftover work was dashboard persistence (`53/54` → `54/54`), **not** retrying Magic Layers on the cover.

Do **not** synthesize a `/view?template=1` URL from the editor. Do **not** treat a login-redirect as a buyer link. The saved link is a real `canva.link`.

---

## Sacred rule (read twice)

**Never get close to the Canva click / share / layer state machine unless the human explicitly asks and runtime logs prove a bug.**

Do not rewrite it. Do not “simplify” it. Do not merge helpers. Do not change success criteria because a toolbar looks greener. Do not retry Magic Layers on a page the user said is already layered. Do not invent Ungroup-from-Group false positives. Do not “fix” a 53/54 dashboard by clicking the cover again.

If you are tempted to touch `src/browser-controller.cjs` Canva methods, **stop**. Update UI copy, docs, tests that lock invariants, or dashboard display of **already computed** progress. That is allowed. The controller is not.

---

## How the Canva job actually works (high level — not a rewrite)

Entry: `runCanvaEditableForProject` in `src/main.cjs` → `browser.runCanvaBulkCreate` in `src/browser-controller.cjs`.

1. **Print PDF** is prepared in Interior (`prepareCanvaImportPdf` / `buildPrintPdfPackage` in `src/file-manager.cjs`). Canva never gets 54 separate page uploads.
2. Controller connects to **headed Chrome Canary** over CDP and keeps it **in the background** (`#lockCanvaBrowserBackground`). `humanEnabled: false`.
3. If `canvaDesignUrl` exists, **resume** that design. Do not re-upload the PDF. `layeredPageNumbers` + `resumeFromIndex` skip pages already `layered: true`.
4. Wait until the editor has **all** expected pages (`#canvaEditorPageCount` / `inferCanvaEditorPageCount`). Leftover 4-page counts are not “the book is 4 pages.”
5. For each unlayered page: select thumb → visible-intersection canvas click → Edit panel → Magic Layers → **verify** (Ungroup / success toast / layer count > 1). A click is never success.
6. Audit (`#canvaAuditAllPages`) then **Share → Template link → Create → Copy**. Harvest `canva.link`. Reject editor rewrite unless Create actually ran.
7. Stamp the harvested link into the thank-you PDF (`exportThankYouPdf` / `stampThankYouTemplateLink`). Download PDF timeout is **20s**, not 180s.
8. Persist `canvaPageProgress`, `canvaTemplateLink` (only if `isCanvaTemplateLink`), `canvaDesignUrl`, dashboard.

Dashboard copy of progress lives in `renderer/renderer.js` `renderCanvaPageBoard` (`N / M Magic Layer applied`). It reads `canvaOp.canvaPageProgress` or `project.canvaPageProgress`. It does not decide Magic Layer success.

---

## Sacred / DO NOT TOUCH logic

These files and functions are load-bearing. Do not rewrite, rename for taste, “clean up,” or experiment on them.

### Magic Layers success criteria

**File:** `src/browser-controller.cjs`

- `#canvaPageLooksLayered` — success is **Ungroup** (`ungroupBtn` / `probe.ungroup`), a **layers-created toast**, or **layer count > 1**.  
  **NEVER** treat toolbar **Group** (`groupBtn` / `probe.group`) as success.  
  **NEVER** treat “we clicked Magic Layers” as success (`canvaMagicClickedPages` is not proof).
- `#canvaInspectLayerCount` / `#canvaReadPageLayerCount` — real counts only. Do not invent `2` from a Group control.
- `#canvaLayerOnePage` — 3 attempts; already-layered short-circuit uses `#canvaPageLooksLayered`, not a click.
- `#canvaWaitWhileMagicLayersRuns` — leftover “something went wrong / try another thing” toasts are **not** proof the current page started. `CANVA_MAGIC_LAYERS_NOT_STARTED` is a real failure, not a prompt to click a different Y on the cover.
- `#canvaClickMagicLayersTool` — `secondClickSkipped: true` is intentional. Do not add a second Magic Layers click.

### Canvas click / Edit panel

- `#canvaCanvasClickPoint` — **visible-intersection** of the page image/canvas vs the viewport (not naive 48% of a box that can sit off-screen under print-review). Optional `horizontalFraction` / `verticalFraction` default to `0.5` / `0.48`. Do not retune Y to “fix page 1.”
- `#canvaSelectPageImage` — mouse clicks at that point; image toolbar must appear (`#canvaImageToolbarVisible`).
- `#canvaProbeEditImagePanel` / `#canvaEditImagePanelOpen` — Edit panel is open when `aria-label="Edit panel open"` (or equivalent probe: pressed Edit, Magic Layers visible, Edit image heading). Skip the Edit click if the panel is already open.
- `#canvaClickToolbarEdit` — exact Edit / Edit image / Edit photo on the **photo** toolbar (BG remover / eraser / flip / effects / position nearby). Do not click a random “Edit.”

### Share panel / public template link

- `#canvaReadTemplateLinkFromSharePanel`
- `#canvaClickSharePanelButton` — exact **`/^template link$/i`**. **See all** is only `/^see all$/i`. **Do not** match `/view all/i`.
- `#canvaShareControlIsHelp` — skip Canva help / “learn about” / help+template that is not the exact Template link control.
- Harvest order: prefer **`canva.link`**. `#canvaNormalizeHarvestedTemplate` + `canvaTemplateLinkFromShare` / `isCanvaShortTemplateLink` / `isCanvaTemplateLink` in `src/canva-bulk.cjs`.
- Reject editor `/edit` rewrite unless **Create template link** actually ran (`created` flag). `toCanvaTemplateLink(editorUrl)` is **not** a harvested public share.
- Persist in `src/main.cjs` only when `isCanvaTemplateLink(info.templateLink)` / `isCanvaTemplateLink(result.templateLink)`. Never save a login-redirect or raw editor URL as the buyer link.

### PDF import, download, naming, thank-you

- `#canvaImportPdfAsDesign` / `#canvaInjectLocalPdf` / `#setAnyPageFileInput` — local PDF inject; do not revive bulk-create CSV or per-page image upload.
- `#canvaDownloadPdf` — `page.waitForEvent('download', { timeout: 20_000 })`. **Not 180s.**
- `humanEnabled: false` in `runCanvaEditableForProject` (`src/main.cjs`). Do not turn the human loop back on.
- `src/file-manager.cjs`: `exportThankYouPdf`, `stampThankYouTemplateLink`, `bookFileCode`, `compressedPrintPdfDest`. Stamp the harvested link into the thank-you PDF URI annotations. Name files with the book code.

### Resume / dashboard persistence

- `mergeCanvaPageProgress` in `src/canva-job-state.cjs` (used by `src/main.cjs` and `CanvaJobState.patchPage`).
- **Keeps `layered: true` unless `forceUnlayer` is set.** A later `layered: false` patch without `forceUnlayer` must not wipe a layered page.
- `seedCanvaPageProgress` + `layeredPageNumbers` + `resumeFromIndex` in `runCanvaEditableForProject` — skip already-layered pages. Do not start over at page 1 because the cover is a different art type.
- `ProjectStore.persistCanvaPageLayered` in `src/store.cjs` — dashboard/SQLite persist path. SQLite column: `canva_page_progress` (JSON array). Also mirrored on `canva_job_json.pages`.
- Renderer: `renderCanvaPageBoard` in `renderer/renderer.js` — displays counts; it does not run Magic Layers.

### Browser lock (background Canva)

- `#lockCanvaBrowserBackground` — Canva Chrome stays attached, **hidden**, no focus steal.
- `CdpActivationGuard` / `src/cdp-activation-guard.cjs` — blocks `Page.bringToFront`, `Target.activateTarget`, `Browser.setWindowBounds` while not interactive.
- `#silencePageActivation` — Playwright `page.bringToFront` is a no-op unless the user asked to show the browser.
- Do **not** call `#revealCanvaBrowser` / `#showWindow` / `bringToFront()` during Magic Layer, share, or PDF work.
- Do **not** start `#startCanvaLiveFrame` during a Canva job (periodic screenshots flicker the Electron dashboard and can disturb the OS window).
- Do **not** kill Chrome Canary. Do **not** Cmd+Q the Canva profile. Lock means: while VERSA CLASS is running, the connected Canary stays alive in the background.
- `browser:focus` / `bringToFront()` is the **only** intentional show path (user asked). Login (`openLoginBrowser`) may show Canary for sign-in, then park again.

---

## What AIs MAY do

- UI copy, labels, empty states, welcome overlay wording.
- Dashboard **display** of already-computed `canvaPageProgress` (including marking a page layered **only** via `mergeCanvaPageProgress` / `persistCanvaPageLayered` when the operator confirmed it — never by re-clicking Canva).
- Docs (this file).
- Tests that **lock** the sacred invariants (Ungroup-not-Group, `/^see all$/i` not `/view all/i`, 20s download, `humanEnabled: false`, `isCanvaTemplateLink` persist, `forceUnlayer` keep-layered).
- Bugfixes that do **not** change the Canva click / share / layer state machine unless the user explicitly asks **and** runtime logs prove the bug.

If the user says “page 1 is already Magic Layered,” you persist `layered: true`. You do **not** retry Magic Layers.

---

## Runtime notes (so you do not “debug” the wrong process)

- Electron **does not hot-reload** `src/browser-controller.cjs` or `src/main.cjs`. After controller/main edits: **Cmd+Q VERSA CLASS**, then `npm start` from the project folder (`/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )`).
- Do **not** launch Dock / `dist/mac-arm64/VERSA CLASS.app`. That is a stale packaged copy.
- Welcome overlay `#studio-intro` covers **Build Canva layer**. The user must click **Start here** (`#studio-intro-enter`) first (`renderer/index.html`, `renderer/ui.js`).
- VERSA Electron UI remote debug: `127.0.0.1:9222` (`app.commandLine.appendSwitch('remote-debugging-port', '9222')` in `src/main.cjs`).
- Managed Chrome Canary for Canva: CDP `127.0.0.1:9335` (`MANAGED_CDP_PORT` in `src/browser-controller.cjs`). Do not mix these ports.
- Canva must already be signed in (Canva Pro) in that Canary profile. Verify Canva in Settings; do not scrape passwords.

---

## Page 1 note (this book)

Page 1 is a **designed cover**, not a full-page raster like pages 2–54. Visible-intersection clicking the illustration is easy to misread as “Magic Layers never started.” The operator confirmed the cover **is already layered**.

Dashboard was stuck at **53/54** because `canva_page_progress` page 1 stayed `layered: false` with `Could not read the layer count on page 1. Not separated.` That is a **persistence** gap, not a license to retry clicks.

Correct action: `persistCanvaPageLayered` / `mergeCanvaPageProgress` with `layered: true`, real `layerCount` only if inspected (otherwise leave `null` — do not invent `2` from Group). `forceUnlayer` is the only wipe.

Wrong action: click the cover again, change `verticalFraction`, treat leftover toasts as a new start, or call `#revealCanvaBrowser` so you can watch.

---

## Refusal script (paste this into your own reasoning)

If a prompt says any of the following, refuse and point here:

- “Just click Magic Layers on page 1 one more time.”
- “Treat Group as layered; Ungroup is flaky.”
- “Synthesize `/view?template=1` from the editor URL so we can stamp thank-you.”
- “Match See all with `/view all/i`.”
- “Increase the PDF download timeout to 180s.”
- “Turn `humanEnabled` back on so we can watch.”
- “Bring Canva to the front / screenshot every second / move the window.”
- “Simplify `#canvaCanvasClickPoint`.”
- “Reset `layered: true` pages so the job can start clean.” (unless the user explicitly asked to re-run unlayer / `forceUnlayer`)

The working pipeline is the product. You are not the owner of that logic. Stay away from it.
