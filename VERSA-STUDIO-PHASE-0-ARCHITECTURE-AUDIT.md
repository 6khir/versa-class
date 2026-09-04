# VERSA STUDIO — PHASE 0: PRODUCTION ARCHITECTURE AUDIT

**FILES MODIFIED: 0** (during original inspection)

**Inspection commit:** `e4a595ae` — *Sync Versa Software (TPT) laptop updates*  
**Mode:** READ-ONLY / ZERO MODIFICATIONS  
**Purpose:** Accurate map of the existing system before any orchestration/watchdog work.

---

## 1. CURRENT ARCHITECTURE

### Runtime identity
- **App:** Electron desktop app (`versa-class` / VERSA CLASS / VERSA STUDIO)
- **Entry:** `package.json` → `"main": "src/main.cjs"` → `npm start` runs `electron .`
- **UI:** `renderer/index.html` + `renderer/renderer.js` via Electron BrowserWindow + `src/preload.cjs` IPC bridge (`tptDesktop.*`)
- **Persistence:** SQLite `tpt-books.sqlite` under Electron `userData`
- **Browser automation:** Playwright-core over CDP against **Google Chrome Canary**, single managed profile `~/ChromeAutomationProfile`, CDP port `9335`

### Layer map (actual modules)

| Concern | Actual files |
|---|---|
| Application entry / orchestration | `src/main.cjs` (~5097 lines) |
| Frontend | `renderer/index.html`, `renderer/renderer.js`, `renderer/ui.js`, `renderer/product-pipeline.js`, CSS suite, `renderer/components/*` |
| Preload / IPC surface | `src/preload.cjs` |
| Queue / page generation engine | `src/queue-engine.cjs` |
| Multi-step book pipeline | `src/automation-manager.cjs` |
| Browser automation (ALL providers) | `src/browser-controller.cjs` (~12016 lines) — **CRITICAL CROSS-SYSTEM DEPENDENCY** |
| AI engine routing | `src/ai-engine.cjs` |
| Prompt / SEO / format inference | `src/prompt-builder.cjs` |
| Persistence / state | `src/store.cjs` (`ProjectStore`) |
| Files / PDF / ZIP / PPTX / thank-you | `src/file-manager.cjs`, `src/compress-pdf.mjs`, `src/pptx-assembler.cjs`, `src/imposition.cjs`, `src/showcase-builder.cjs` |
| Canva control plane | `src/canva-job-state.cjs`, `src/canva-bulk.cjs`, `src/canva-pdf-inject.cjs`, `src/canva-availability.cjs`, `src/canva-temp-storage.cjs`, `src/canva-telemetry.cjs` |
| Mockups / TPT listing helpers | `src/tpt-listing-mockups.cjs`, `src/tpt-taxonomy.cjs` |
| Meta AI | `src/meta-api-controller.cjs` (browser Meta path appears largely gated; **UNKNOWN — REQUIRES VERIFICATION** of live Meta usage) |
| Local HTTP automation API | `src/automation-http.cjs` (`127.0.0.1:31338`) |
| Telemetry | `src/telemetry.cjs` → `podnetwork.store`; Canva live ops via `canva-telemetry.cjs` |
| Updates | `src/update-manager.cjs` |
| Appearance | `src/appearance.cjs` |
| CDP activation guard (implemented, **not wired into live launch**) | `src/cdp-activation-guard.cjs` |
| Supabase (optional Canva PDF temp memory) | `src/canva-temp-storage.cjs` + `supabase/migrations/20260902193000_canva_import_temp.sql` |
| Express “enterprise” backend | `backend/server.js` + `backend/core/*` + `backend/security/*` — **not required by `main.cjs`**; parallel/legacy layer, not the production Electron control path |
| Firebase | **Not found** |
| Packaging | `package.json` electron-builder; `windows-packaging/*`; `scripts/*` |

### Control topology (factual)

```
UI / automation-http
  → main.cjs IPC (assertIdle / assertBrowserFree / liveOperation)
      → AutomationManager (sequential books × sequential steps)
          → stepRunners (interior → QueueEngine; editable → Canva; listing/SEO; thumbnails; preview; export)
      → QueueEngine (one project; sequential page jobs)
          → BrowserController (shared Canary)
          → FileManager
          → ProjectStore (SQLite)
```

---

## 2. ACTUAL END-TO-END WORKFLOW

Documented pipeline order in `AutomationManager` (`PIPELINE_STEPS`):

`overview → characters → interior → editable → thumbnails → preview → export → listing`

(Comment in module lists listing as step 8; array places listing last.)

### Stage mapping

| Requested stage | Actual mechanism |
|---|---|
| BOOK INPUT | IPC `project:create` / `analysis:analyze` / `analysis:generate-storybook` / `analysis:generate-prompts` → `ProjectStore.createProject` / `populateProjectJobs` |
| CONTENT | `prompt-builder.cjs` builds page jobs; AI Content Gem/GPT via browser |
| IMAGE GENERATION | `QueueEngine` → `browser.submitPrompt` → `waitForNewImage` → `fileManager.saveGeneratedImage` |
| PDF / PAGE ASSETS | After all pages complete: `ensureProductPdf` → convert + compress print PDF |
| EDITABLE DECISION | `project.productFormat` is `'editable'` or `'static'` (default `'static'`); set via `project:set-format` or analysis inference (`inferProductFormat`) |
| EDITABLE PROCESSING | Only if `productFormat === 'editable'`: `runCanvaEditableForProject` |
| CANVA | PDF import → Magic Layers per page → public template link |
| MOCKUPS / THUMBNAILS | `browser.generateTptThumbnailsWithGpt` (4 thumbnails) |
| SEO | `browser.generateTptListingWithGpt` (listing step; uses book PDF) |
| EXPORT | `ensureThankYouPdfForProject` + `fileManager.exportZip` |

### Forensic Q&A

1. **What starts the workflow?**  
   - Manual: UI IPC (`queue:start`, `project:run-canva-editable`, listing/thumbnail handlers, etc.)  
   - Automated: `automation:start` → `AutomationManager.start` → `_runLoop` → `_processBook`

2. **What creates a job?**  
   Page jobs created at project populate time (`buildBookJobs` / `buildImportedJobs` / storybook builders) with `id: randomUUID()`, unique `(project_id, page_number)`.

3. **Where is job state stored?**  
   SQLite table `jobs` (+ project columns for pipeline/Canva/listing). No separate queue checkpoint file.

4. **How is a book identified?**  
   `projects.id` (UUID). Output dir uses name slug + first 6 of id.

5. **How are pages identified?**  
   `jobs.page_number` + `pageLabel` like `{TOKEN}-P{padded}`.

6. **How does the system know a stage completed?**  
   - Queue: job → `'complete'`; project → `'complete'` when no incomplete jobs  
   - Automation: runner finishes + `stepVerifiers` pass → `step_*_status = 'completed'`  
   - Canva: per-page layered verification + valid public template link (`isCanvaTemplateLink`)

7. **How does it know a stage failed?**  
   Thrown error codes; queue `#handleFailure`; automation retries then `'failed'`; Canva page `'FAILED'` / job recovery policies; watchdog `STEP_STALLED`

8. **What happens after failure?**  
   Retries with delays; else pause / `needs_user_action` / `rate_limit_paused` / step `'failed'`. Does **not** auto-switch to another book.

9. **What happens if the application crashes?**  
   On next boot `ProjectStore.recoverInterrupted()`: transient job statuses → `'retry_wait'`; projects `'running'` → `'paused'`; Canva jobs mid-`processing` marked interrupted/`RECOVERING`. **Queue does not auto-resume.**

10. **What happens if the browser crashes?**  
    CDP disconnect clears Playwright session; next `launch()` respawns/adopts Canary. In-flight waits surface `BROWSER_CONTEXT_CLOSED`; queue treats as retryable failure. Mid-Canva survival after respawn: **UNKNOWN — REQUIRES VERIFICATION** beyond resume-from-SQLite design intent.

11. **What happens if an AI provider becomes unavailable?**  
    Auth → `needs_user_action` + `auth-required`; rate limit → profile swap or `rate_limit_paused`; throttle → cooldown/`retry_wait`.

12. **What happens if Canva becomes unavailable?**  
    Windows: `isCanvaAvailable()` false → `CANVA_UNAVAILABLE`. Auth fail → `CANVA_AUTH_REQUIRED`. Expired session policy → FAIL. Upload/Magic Layer timeouts fail after capped recoveries.

13. **Can another book run while one book is waiting?**  
    **No** concurrent generation. One `QueueEngine.activeProjectId`; automation processes books sequentially.

14. **Can two workers operate independently?**  
    **No.** One shared `BrowserController` / Canary / profile. Logical engines switch; physical browser is shared.

15. **Where can the workflow become permanently stuck?**  
    - Waiting on AI image / Canva upload / Magic Layers near timeout ceilings  
    - `needs_user_action` / `rate_limit_paused` with no auto-escalation to next book  
    - Automation `ask`/`manual` modes awaiting user  
    - HITL paths largely disabled (`humanEnabled: false`) so recoverable Canva issues may fail instead of pausing for help  
    - Shared browser busy gates (`BROWSER_BUSY` / `QUEUE_BUSY`) blocking other stages

---

## 3. CURRENT STATE MACHINE

The system has **multiple** real state machines — not one universal PENDING/RUNNING/WAITING model.

### A. Job statuses (`jobs.status`) — actual literals
`pending`, `edit_pending`, `preparing`, `submitted`, `generating`, `downloading`, `validating`, `complete`, `retry_wait`, `needs_user_action`, `rate_limit_paused`

Stored: SQLite `jobs.status`. Changed by: `QueueEngine` / `ProjectStore.updateJob`. Transient in-flight statuses rewritten to `retry_wait` on app restart.

### B. Project statuses (`projects.status`) — actual literals
`draft`, `running`, `paused`, `complete`, `rate_limit_paused`

### C. Pipeline step statuses (`step_*_status`) — actual literals
`pending`, `processing`, `completed`, `failed`, `skipped`, `awaiting_input`

Steps: `overview`, `characters`, `interior`, `editable`, `thumbnails`, `preview`, `export`, `listing`

### D. Canva job states (`CANVA_STATES`) — actual literals
`BOOT`, `BROWSER_READY`, `CANVA_SESSION_READY`, `CANVA_OPEN`, `CREATE_DESIGN_READY`, `IMAGE_INPUT_READY`, `IMAGE_SELECTED`, `IMAGE_ON_CANVAS`, `IMAGE_READY`, `PAGE_ADDED`, `IMPORT_DIALOG_READY`, `PDF_SELECTED`, `PDF_UPLOADING`, `PDF_UPLOAD_COMPLETE`, `PROJECT_OPENING`, `CANVA_EDITOR_READY`, `PAGE_DETECTION`, `EDIT_PANEL_READY`, `MAGIC_LAYER_READY`, `MAGIC_LAYER_PROCESSING`, `MAGIC_LAYER_VERIFIED`, `PAGE_COMPLETE`, `NEXT_PAGE`, `ALL_PAGES_COMPLETE`, `SHARE_READY`, `TEMPLATE_LINK_MENU`, `TEMPLATE_LINK_CREATED`, `TEMPLATE_LINK_COPIED`, `JOB_COMPLETE`, `RECOVERING`, `MANUAL_INTERVENTION_REQUIRED`

### E. Canva page statuses (`PAGE_STATUSES`)
`PENDING`, `DETECTING`, `SELECTING`, `IMAGE_READY`, `EDITING`, `MAGIC_LAYER_PROCESSING`, `VERIFYING`, `SUCCESS`, `RECOVERING`, `MANUAL_INTERVENTION_REQUIRED`, `FAILED`

### F. Wait outcomes
`SUCCESS`, `RETRY`, `RECOVER`, `MANUAL_INTERVENTION`, `FAIL`

### G. Related (not the page queue)
- Characters: `not_generated`, `generating`, `complete`, `failed`
- Storybook phases include: `blueprint_complete`, `characters_generating`, `characters_complete`, `references_generating`, `pages_generating`, `complete`, `workflow_failed`
- Listing statuses include interrupted set: `uploading_listing`, `listing_form_ready`, `draft_form_ready`, `submitting_listing` → recovered to `upload_failed`
- Listing generation statuses seen: `draft_ready`, `thumbnails_generating`, `assets_ready` (and more in TPT upload path)

### Transition failure behavior
- Queue: `#handleFailure` → retry_wait / needs_user_action / rate_limit_paused / pause project  
- Automation: retry delays `[5s, 15s, 30s]` then `'failed'`; stall abort may `queue.pause()` + `browser.close()`  
- Canva: policy-capped retries; expired session → FAIL  
- If transition persistence fails: **UNKNOWN — REQUIRES VERIFICATION** beyond normal SQLite write path (no separate compensation transaction layer observed)

---

## 4. CANVA AUTOMATION ARCHITECTURE

### Opening / browser / profile
- Chrome Canary only; profile `~/ChromeAutomationProfile`; CDP `9335`
- Orchestration: `runCanvaEditableForProject` → `browser.runCanvaBulkCreate`
- PDF import stage unlocks visible Canary; Magic Layers / after design URL locks background (`#lockCanvaBrowserBackground`)
- Unavailable on Windows (`canva-availability.cjs`)

### Auth
- Gate: `canvaLoginConfirmed` setting + `#verifyCanvaLogin`
- Persist: cookies in managed profile + `saved-logins/canva.json`
- Job-time re-check; fail → `CANVA_AUTH_REQUIRED`
- Expired session policy: maxAttempts `1`, next `FAIL`

### Upload
- Source: compressed print PDF from Interior (`prepareCanvaImportPdf`)
- Inject strategies: file chooser / hidden input / CDP set files / drop
- Hard timeouts: upload 10 min; start 18s; idle 40s; import overall scales with page count (4–20 min)
- Once-only attach flags to prevent double upload
- Optional Supabase temp remember/restore (`canva-import-temp`)

### Navigation / Magic Layer / completion
- Page rails + `#canvaSelectEditorPage` / current-page detection
- Per page: select image → Edit → Magic Layers → Create Layers → wait up to 180s → verify layered (Ungroup / toast / layer count > 1)
- After all pages: audit; Share → Template link → must be real public template (`isCanvaTemplateLink`), not editor rewrite
- `humanEnabled: false` in production runner

### Blocking / isolation
- Sets `liveOperation.kind = 'canva'` → other browser stages hit `BROWSER_BUSY`
- **Not isolated** from Gemini/ChatGPT — same controller/profile/CDP (**CRITICAL CROSS-SYSTEM DEPENDENCY**)

### Persisted Canva state
SQLite: `canva_template_link`, `canva_design_url`, `canva_page_progress`, `canva_pdf_uploaded`, `canva_job_json`, `canva_export_path`, `step_editable_status`  
Plus diagnostics under `userData/canva-diagnostics/`

### Documented risks (code-backed)
Repeated/failed pages continue; resume from first unlayered; shared stale browser; retries capped (not infinite); upload/processing can wait near hard ceilings; Canva-specific rate-limit handling **UNKNOWN — REQUIRES VERIFICATION**

Sacred invariants also recorded in repo file `CORE-LOGIC-BOUNDARIES.md`.

---

## 5. GEMINI / CHATGPT SESSION ARCHITECTURE

### Profile / session
- Same managed Canary profile for all services
- Gemini cookies: Google SID/HSID/APISID family; snapshot `saved-logins/gemini.json`; flag `geminiLoginConfirmed`
- ChatGPT cookies: next-auth / oai family; snapshot `saved-logins/chatgpt.json`; flag `chatgptLoginConfirmed`
- System Canary profile import via `getSystemProfiles` / `importSystemLoginSession`
- Cookie merge preserves other services when importing one (`mergePreservedSessionCookies`) — documented by tests

### Tabs / engines
- `this.page`, `jobPages`, `canvaPage`, TPT pages on one context
- Engine: `aiEngine` setting → `normalizeEngine()` → `chatgpt` | `gemini` | `meta`
- Provider-specific selectors/URLs in `browser-controller.cjs` + `ai-engine.cjs` + `prompt-builder.cjs`
- Planning/preview forced to Gemini gems even if active engine is ChatGPT

### Extension communication
**None found.**

### Shared with Canva — CRITICAL CROSS-SYSTEM DEPENDENCY
1. Single `BrowserController` instance  
2. `~/ChromeAutomationProfile`  
3. Canary + CDP 9335  
4. Launch/close/park/hide/visibility  
5. `liveOperation` / `assertBrowserFree` / `assertIdle` / `pauseAllWork`  
6. Cookie DB + saved-logins directory  
7. Profile lock / swap tears down shared context  

**Implication:** Changing Canva browser lifecycle, profile paths, CDP attach, cookie import, or desk-lock behavior can break Gemini/ChatGPT auth — matching prior incident pattern.

---

## 6. CONCURRENCY ANALYSIS

| Question | Answer |
|---|---|
| Can Book A wait for Canva while Book B continues? | **No** — sequential automation; shared browser busy while Canva runs |
| Can Book A's worker block Book B? | **Yes** |
| Global automation lock? | **Yes** — `AutomationManager._active`; `QueueEngine.running`; `assertIdle` / `assertBrowserFree` |
| Single global browser worker? | **Yes** — one `BrowserController` |
| Workers isolated? | **No** at process/profile level |
| Scheduler? | Simple sequential `_runLoop` over `listProjectsForAutomation` |
| Queue? | **Yes** — `QueueEngine` (pages within one project) |
| Persistent job state? | **Yes** — SQLite |
| Jobs resume after restart? | State recovered to safe paused/`retry_wait`; **manual/automation restart required** |
| Prioritize actionable work? | **No** dedicated priority scheduler; blocked books excluded from automation list |

---

## 7. FAILURE & RECOVERY ANALYSIS

| Component | Failure Risk | Current Detection | Current Recovery | Persistent State? | Severity |
|---|---|---|---|---|---|
| Shared browser / CDP | High — single point of failure | disconnect handlers, `BROWSER_CONTEXT_CLOSED` | relaunch/adopt Canary; queue retry | cookies yes; in-memory no | **CRITICAL** |
| Profile lock / SingletonLock | High | `BROWSER_PROFILE_IN_USE` | clear stale locks; reconnect | lock files on disk | **CRITICAL** |
| Gemini auth/session | High | auth probes / sign-in URL | pause + `auth-required`; restore cookies | yes | **CRITICAL** |
| ChatGPT auth/session | High | same pattern | same | yes | **CRITICAL** |
| Canva auth/session | High | `#verifyCanvaLogin`, session cookies | fail / login required | yes | **CRITICAL** |
| Canva PDF upload | High | upload start/idle/timeout | ≤2 recoveries then fail | progress + flags | **HIGH** |
| Canva Magic Layers | High | layered verification (not click) | ≤3 page attempts; continue other pages | `canva_page_progress` | **HIGH** |
| Canva template link | High | `isCanvaTemplateLink` | fail step if missing | `canva_template_link` | **CRITICAL** |
| Queue page generation | Medium–High | image wait / blockers / notices | retry_wait, throttle, rate-limit swap | jobs table | **HIGH** |
| Rate limits | Medium–High | notice classification | profile rotation or `rate_limit_paused` | yes | **HIGH** |
| Automation step stall | Medium–High | idle + hardCap watchdog | abort browser/queue; retry delays | step status | **HIGH** |
| Print PDF / compress | Medium | file existence verifiers | rebuild via `ensureProductPdf` | `print_pdf_json` / paths | **HIGH** |
| SEO listing | Medium | field verifier | step retry / re-run | `tpt_listing_json` | **MEDIUM** |
| Thumbnails | Medium | 4-path verifier | step retry | listing JSON paths | **MEDIUM** |
| Preview video | Medium | path/status verifier | skip if exists; else regenerate | listing JSON | **MEDIUM** |
| Export ZIP | Medium | page completeness gate | re-run export | filesystem + step status | **MEDIUM** |
| Supabase temp PDF | Low–Medium | upload/download failures | warn + continue with local | optional remote | **LOW** |
| Express `backend/` | Low (unused by Electron main path) | N/A in production path | N/A | N/A | **LOW** |
| App crash mid-job | High | `recoverInterrupted` on boot | pause / retry_wait / Canva RECOVERING | yes | **HIGH** |

---

## 8. PROTECTED SYSTEM SURFACE

| Module / surface | Class | Why |
|---|---|---|
| `src/browser-controller.cjs` | **CRITICAL** | All provider automation; shared profile/CDP; Canva Magic Layers/share |
| `~/ChromeAutomationProfile` (+ locks, Cookies, saved-logins) | **CRITICAL** | Auth for Gemini/ChatGPT/Canva/Meta/TPT |
| `src/canva-job-state.cjs` | **CRITICAL** | Layered permanence; resume; wait outcomes |
| `src/canva-bulk.cjs` | **CRITICAL** | Template link validation |
| `src/canva-pdf-inject.cjs` | **CRITICAL** | Upload evidence / inject scoring |
| `src/main.cjs` Canva orchestration (`runCanvaEditableForProject`, login gates, liveOperation) | **CRITICAL** | Production Canva path; `humanEnabled: false` |
| `src/store.cjs` Canva/job/project persistence + `recoverInterrupted` | **CRITICAL** | Sole durable state |
| `src/file-manager.cjs` print PDF / thank-you stamp / naming | **CRITICAL** | Product integrity |
| `src/queue-engine.cjs` | **HIGH** | Page generation + failure/rate-limit behavior |
| `src/ai-engine.cjs` + Gemini/ChatGPT URL/routing | **HIGH** | Provider identity |
| `src/prompt-builder.cjs` | **HIGH** | Content/SEO/format contracts |
| Cookie merge / login verify / profile import paths | **CRITICAL** | Cross-provider auth preservation |
| `src/automation-manager.cjs` step order/timeouts/verifiers | **HIGH** | Pipeline contracts |
| `src/cdp-activation-guard.cjs` + background lock behaviors | **HIGH** | Prevent UI focus glitches (guard currently unwired; lock logic in controller is live) |
| `src/preload.cjs` IPC contracts for login/Canva/queue | **HIGH** | Security boundary |
| `CORE-LOGIC-BOUNDARIES.md` sacred behaviors | **CRITICAL** | Explicit do-not-touch law already in repo |
| `renderer/*` UX for active workflows | **MEDIUM** | User-facing; avoid casual redesign mid-pipeline |
| `src/canva-temp-storage.cjs` / Supabase settings | **MEDIUM** | Optional resume aid |
| `backend/*` Express stack | **LOW** | Not on Electron hot path |
| Patch/refactor Python scripts in repo root | **LOW** | Historical tooling; not runtime |

---

## 9. SAFE EXTENSION POINTS

Places a **new orchestration/watchdog/recovery layer** could sit **above** workers without rewriting provider logic:

1. **Around `AutomationManager` events** (`progress`, `ask_required`, `notify`) — observe book/step transitions; decide start/pause/resolve externally.  
2. **Around `QueueEngine` events** (`changed`, `heartbeat`, `auth-required`, `complete`, `log`) — detect stalls/retries without editing `#processJob`.  
3. **`liveOperation` / `buildState().workBusy` read model** — external supervisor can see what is busy without touching browser clicks.  
4. **`automation-http.cjs` (localhost API)** — already bridges to IPC; a supervisor process could drive `queue:start`, `queue:pause`, `automation:continue`, `state:get` without modifying providers.  
5. **New module only** (as `CORE-LOGIC-BOUNDARIES.md` already allows): e.g. `src/watchdog-orchestrator.cjs` that *calls* existing public methods (`automation.start/pause`, `queue.start/pause`, `store.getProject`) and never imports Canva click internals.  
6. **SQLite observers** — poll `jobs` / `step_*_status` / `canva_job_json` for durable truth after crashes.  
7. **Step verifier / runner injection boundary** — `AutomationManager` already accepts injected `stepRunners`, `stepVerifiers`, `abortStep`, `resetBeforeRetry`; wrapping these at construction time in `main.cjs` is safer than editing Canva/Gemini internals.  
8. **Do not extend via:** editing `browser-controller.cjs` click paths, shared profile launch, cookie merge, or Canva Magic Layer success criteria.

---

## 10. CRITICAL ARCHITECTURAL RISKS

1. **Single shared browser profile for Gemini + ChatGPT + Canva + TPT** — highest systemic risk; any Canva “fix” can regress AI auth.  
2. **No true multi-book concurrency** — Canva wait blocks actionable work on other books.  
3. **No auto-resume scheduler after crash** — durable state exists, but human/automation must restart.  
4. **Global busy gates** — one long Canva/interior job monopolizes the automation engine.  
5. **Canva success depends on fragile DOM/a11y heuristics** — already hardened by sacred rules; still UI-drift sensitive.  
6. **HITL disabled** (`humanEnabled: false`) — recoverable UI ambiguity may hard-fail.  
7. **`CdpActivationGuard` unwired** while background-lock behavior is critical — divergence between intended and live activation suppression.  
8. **Dual stacks** — Electron production path vs unused/parallel `backend/` Express modernization; risk of future agents “fixing” the wrong stack.  
9. **Meta path ambiguity** — `isBrowserEngine` always true; Meta local API reachability unclear.  
10. **Large monolithic files** (`browser-controller.cjs`, `main.cjs`) — high blast radius for any edit.

---

## 11. RECOMMENDED NEXT DEVELOPMENT PHASE

**Phase 1 (design only, still no worker rewrites):** specify an external Orchestration/Watchdog service that:
- Reads SQLite + `AutomationManager`/`QueueEngine` events/`workBusy`
- Owns cross-book scheduling policy (what may run when Canva waits — *policy design only until concurrency primitives exist*)
- Defines crash-resume playbooks that call existing `start`/`pause`/`runCanvaEditable` APIs
- Treats Gemini/ChatGPT/Canva browser modules as sealed adapters
- Adds observability (stall detectors, attempt budgets) **outside** `browser-controller.cjs`

**Explicit non-goals for Phase 1:** no Canva click changes, no profile path changes, no cookie/auth changes, no Gemini/ChatGPT selector changes, no queue semantics rewrite, no UI redesign.

**Gate to Phase 2:** written contracts for (a) protected APIs, (b) allowed supervisor actions, (c) test plan proving Gemini login survives Canva runs under the new supervisor.

---

**MODIFICATIONS MADE: NONE** (during original inspection)

---

## How to use this file with ChatGPT

Paste or attach this entire markdown file. Recommended starter prompt:

```
You are helping design Phase 1 of VERSA STUDIO: an orchestration/watchdog layer ABOVE existing workers.

Read the attached Phase 0 architecture audit carefully.

Hard rules:
- Do NOT propose edits to protected CRITICAL modules (especially browser-controller, Canva Magic Layer success criteria, shared Chrome profile/auth).
- Treat Gemini/ChatGPT/Canva sessions as sealed.
- Prefer new files and supervisors that call existing public APIs.
- Do not invent states that are not in the audit.
- If uncertain, label UNKNOWN — REQUIRES VERIFICATION.

Based only on this audit, propose the Phase 1 orchestration design.
```
