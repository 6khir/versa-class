# AI HANDOFF — COMPLETE GUIDE

**Read this before writing any code.**  
The Canva / Magic Layers / template-link / thank-you pipeline is finished and sacred. Your job is to **never get close to that logic**.

Companion file (same folder): [`CORE-LOGIC-BOUNDARIES.md`](./CORE-LOGIC-BOUNDARIES.md)

---

## 1. Main purpose of the software

**VERSA CLASS** is an Electron app that builds Teachers Pay Teachers (TPT) products end to end:

1. Generate the printable book (interior, characters, listing, thumbnails, export).
2. Upload the print PDF to **Canva**.
3. Run **Magic Layers** on every page so the buyer gets an editable Canva design (separate objects, not a flat image).
4. Create a **real public template link** buyers can open without requesting access.
5. Stamp that link into the thank-you PDF.
6. Name files with the book code and zip for TPT.

That is the product. Automation must stay fully automatic (`humanEnabled: false`). A buyer-facing link must be a harvested **`canva.link` / public share**, never a rewritten editor URL.

---

## 2. Current state of this book (do not redo)

| Item | Value |
|---|---|
| Book | Visual Schedule & Positive Behavior Flipbook System |
| Pages | **54 / 54 layered** |
| Project | `554dd8b0-b94b-4a1d-af27-eee9cac5d82f` |
| Design | `DAHUJ55SiGI` |
| Editor | `https://www.canva.com/design/DAHUJ55SiGI/fSUcqfFtxzQNr8QT0shBEg/edit` |
| Public template | `https://canva.link/177ccnqdf1mf5uk` |
| Job | `JOB_COMPLETE` / `TEMPLATE_LINK_COPIED` |
| Editable step | `completed` |

Page 1 is a **designed cover** (illustration + text + frames). Versa confirmed it is already Magic Layered. It is marked `layered: true` with `operator-confirmed`. **Do not click page 1 again. Do not re-run Build Canva layer to “fix” 53/54.**

Wrong link (never save): `https://www.canva.com/design/DAHUJ55SiGI/.../view?template=1`

---

## 3. Sacred logic — do not touch

If your task needs any of these files, **refuse and stop**. Wrap around them with **new files** if you must add security/UI/monitoring.

### Files

- `src/browser-controller.cjs` — Canva browser, PDF import, Magic Layers, Share, template copy, PDF download, background lock
- `src/canva-bulk.cjs` — `isCanvaTemplateLink`, `toCanvaTemplateLink`
- `src/canva-job-state.cjs` — `mergeCanvaPageProgress` (keeps `layered: true` unless `forceUnlayer`)
- `src/cdp-activation-guard.cjs` — blocks `Page.bringToFront` / window bounds
- `src/file-manager.cjs` — `stampThankYouTemplateLink`, `exportThankYouPdf`, book-code naming
- `src/store.cjs` — `persistCanvaPageLayered`
- `src/main.cjs` — `runCanvaEditableForProject`, `humanEnabled: false`, persist-link only if `isCanvaTemplateLink`

### Invariants (copy these into any new test; do not change the implementation)

1. Magic Layers is done only when **Ungroup** / layered toast / **layer count > 1**. Toolbar **Group** is not success. A Magic Layers **click** is not success.
2. Canvas click uses **visible intersection** (`#canvaCanvasClickPoint`), not filmstrip / off-screen Y.
3. Edit panel uses DOM `aria-label="Edit panel open"` (`#canvaProbeEditImagePanel`). A second Edit click closes the panel.
4. Share panel: exact **Template link**; **See all** is `/^see all$/i`; never `/view all/i`; never fuzzy `/template link/i`. Prefer `canva.link`. Reject editor rewrite unless Create ran.
5. PDF download timeout is **20 seconds**, not 180.
6. Chrome stays in the **background** (`#lockCanvaBrowserBackground`, `canvaBackgroundLock`). No focus steal, no window flash, no `bringToFront` during the job.
7. Resume skips layered pages. Do not clear page 1 with `forceUnlayer`.

---

## 4. What you MAY do

- **New files only** for optional enterprise wrappers (keychain, encryption, Joi, rate limit, Pino, CSS).
- Dashboard / UI **display** of progress that is already stored.
- Docs and tests that **lock** the invariants above.
- CSS / accessibility that does not change click handlers or Canva IPC.

Do **not** “help” by retrying Magic Layers, changing click coordinates, or generating a template URL from the editor link.

---

## 5. How the Canva job works (high level — do not rewrite)

```
print PDF
  → Canva import (wait until page count matches the book)
  → Magic Layer each page (skip if already layered)
  → Share → Create template link → harvest canva.link
  → stamp thank-you PDF
  → dashboard 54/54 + JOB_COMPLETE
```

Chrome Canary stays attached in the background. VERSA CLASS talks to it over CDP. Electron does not hot-reload `browser-controller.cjs`: Cmd+Q, then `npm start` from the project folder. Not Dock. Not `dist`.

Welcome overlay `#studio-intro` covers **Build Canva layer**. Humans click **Start here** (`#studio-intro-enter`) first.

---

## 6. If you were about to edit core logic

Stop. Put the change in a **new** file, or tell Versa you cannot touch the pipeline.

The previous “4 enterprise layers in 15–17 hours” plan is allowed **only** as new wrapper files. It is **not** permission to modify the Canva controller.

Live repo: `/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )`  
SQLite: `~/Library/Application Support/TPT VERSA/tpt-books.sqlite`
