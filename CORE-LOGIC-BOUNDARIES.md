# CORE LOGIC BOUNDARIES — DO NOT TOUCH

This file is law for any AI working in this worktree or the VERSA CLASS repo.

If a task would edit, refactor, “simplify,” retry, or experiment on the files and functions below, **stop**. Do the work with **new files only**, or ask Versa. Never get close to this logic.

---

## What VERSA CLASS is

VERSA CLASS builds Teachers Pay Teachers (TPT) printable + editable products.

The working pipeline is:

1. Generate the book.
2. Send the print PDF to Canva.
3. Apply **Magic Layers** on every page so buyers can edit objects.
4. Publish a **real public Canva template link** (`canva.link` / public share).
5. Stamp that link into the thank-you PDF.
6. Name exports with the book code and zip for TPT.

That pipeline already works. Protect it.

---

## Current book (do not re-run Canva)

- Book: Visual Schedule & Positive Behavior Flipbook System (54 pages)
- Project id: `554dd8b0-b94b-4a1d-af27-eee9cac5d82f`
- Design: `DAHUJ55SiGI`
- Editor: `https://www.canva.com/design/DAHUJ55SiGI/fSUcqfFtxzQNr8QT0shBEg/edit`
- Public template (real): `https://canva.link/177ccnqdf1mf5uk`
- Dashboard: **54/54 layered**. Page 1 is operator-confirmed layered. Job state `JOB_COMPLETE`.
- Do **not** retry Magic Layers on page 1. Do **not** synthesize `/view?template=1`. Do **not** replace the saved `canva.link`.

Page 1 is a designed cover (illustration + text + frames), not a full-page raster like pages 2–54. The leftover work was dashboard persistence, not another Magic Layers pass.

---

## Sacred files — do not edit

| File | Why |
|---|---|
| `src/browser-controller.cjs` | Canva session, PDF import, Magic Layers, share, template link, PDF download, background Chrome lock |
| `src/canva-bulk.cjs` | Template-link validation (`isCanvaTemplateLink`, `toCanvaTemplateLink`) |
| `src/canva-job-state.cjs` | Page progress merge; keeps `layered: true` unless `forceUnlayer` |
| `src/cdp-activation-guard.cjs` | Blocks `Page.bringToFront` / window bounds so Chrome stays in the background |
| `src/file-manager.cjs` | Thank-you stamp (`stampThankYouTemplateLink`, `exportThankYouPdf`) and book-code naming |
| `src/store.cjs` `persistCanvaPageLayered` / `mergeCanvaPageProgress` usage | Dashboard + SQLite page state |
| `src/main.cjs` Canva job (`runCanvaEditableForProject`, `humanEnabled: false`, persist-link rules) | Orchestration that must stay fully automated |

Tests that lock these invariants (`tests/canva-bulk.test.cjs`, `tests/thank-you-pdf.test.cjs`, `tests/store.test.cjs` persist tests) may be **added to**, not weakened.

---

## Sacred behaviors — never “improve”

### Magic Layers success

- Success = **Ungroup** / layered toast / **layer count > 1** only.
- Never treat toolbar **Group** as layered.
- Never treat a Magic Layers **click** as proof it ran.
- Visible-intersection canvas click: `#canvaCanvasClickPoint`
- Edit panel detector: `#canvaProbeEditImagePanel` / `aria-label="Edit panel open"` (do not click Edit a second time; that toggles the panel shut).
- `#canvaPageLooksLayered` must stay ungroup/toast/count — not Group.

### Share / public template

- Do not match `/view all/i` (hits comments).
- Do not fuzzy `/template link/i` (hits help).
- Exact **Template link**. **See all** only `/^see all$/i`.
- Copy: `/^(copy|copy template link)$/i`
- Prefer harvested `canva.link`.
- Reject editor rewrite (`/view?template=1`) unless Create actually ran.
- Persist only if `isCanvaTemplateLink`.
- Login-redirect URLs are invalid.

### Download / automation

- PDF download wait is **20s**, not 180s.
- `humanEnabled: false` — no “Paused for you”.
- Resume skips already-layered pages. `mergeCanvaPageProgress` keeps `layered: true` unless `forceUnlayer`.

### Browser lock (zero glitch)

- `#lockCanvaBrowserBackground` / `canvaBackgroundLock` keeps Chrome Canary hidden.
- Do not call `bringToFront`, `Browser.setWindowBounds`, or periodic screenshots that focus Canva.
- Do not kill Chrome. Do not Cmd+Q the Canva profile.
- Clicks that must run while hidden use `force: true`.

---

## What you MAY do

- New files only (security wrappers, logging, CSS, docs).
- UI copy and dashboard **display** of already-computed progress.
- Tests that **assert** the invariants above.
- Bugfixes that do not change the Canva click / share / layer state machine unless Versa explicitly asks **and** runtime logs prove the bug.

## What you must NEVER do

- Rewrite, extract, or “clean up” `browser-controller.cjs`.
- Change Magic Layers click paths, canvas Y, or success criteria.
- Re-run Build Canva layer on this book to “fix page 1”.
- Invent a template URL from the editor link.
- Touch `dist/` packaged apps.
- Commit secrets, `.env`, or credentials.

---

## Runtime (if Versa asks you to run the app)

- Electron does **not** hot-reload `browser-controller.cjs`. Quit with Cmd+Q, then `npm start` from the project folder. Do not use Dock / `dist`.
- Welcome overlay `#studio-intro` covers **Build Canva layer**. Click **Start here** (`#studio-intro-enter`) first.
- Canva runs in connected Chrome Canary. VERSA UI CDP is `127.0.0.1:9222`.
- SQLite: `~/Library/Application Support/TPT VERSA/tpt-books.sqlite`
