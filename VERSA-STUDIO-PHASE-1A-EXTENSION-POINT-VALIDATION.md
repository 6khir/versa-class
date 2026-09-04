# VERSA STUDIO — PHASE 1A
# SAFE EXTENSION-POINT VALIDATION

**FILES MODIFIED: 0** (during original inspection)

**Mode:** READ-ONLY — ZERO MODIFICATIONS  
**Depends on:** Phase 0 architecture audit  
**Purpose:** Determine whether a new orchestration/watchdog layer can be built ABOVE existing workers using existing public APIs and state — without touching protected provider infrastructure.

---

## 1. PUBLIC API INVENTORY

### AutomationManager (`src/automation-manager.cjs`)

| Method | Params | Returns | Behavior / safety |
|---|---|---|---|
| `getStatus()` | none | `{ active, paused, currentProjectId, currentStep, currentBookIndex, totalBooks, stepRetryCount, awaitingAsk, completedBooks, failedBooks }` | Safe read |
| `start({ projectId = null } = {})` | optional `projectId` | `getStatus()` | If inactive → starts `_runLoop`, scopes to `projectId` when set. If active+paused → resumes same scope (`_onResume`). If paused on **another** scoped book → throws `AUTOMATION_BUSY`. If active+unpaused → idempotent return. |
| `pause()` | none | `getStatus()` | Sets `_paused`, calls `_onPause` (wired to `queue.pause` + `browser.cancelWaits`). Safe. Does **not** clear `_active`. |
| `resolveAsk(decision)` | decision string (`skip` / continue-equivalent) | undefined (throws `NO_PENDING_ASK`) | Resolves pending ask gate only |

**Not present as public APIs:**
- `stop()` — none (only `pause`)
- `resume()` — none (resume = `start()` while paused)
- direct step execution API — steps run only inside private `_processBook` / `_executeStepWithRetry`
- book-list control beyond constructor/`start({projectId})` scope
- dedicated `retry()` — retries are internal (`RETRY_DELAYS_MS`)

**Events emitted:**
- `progress` — `{ currentProjectId, currentBookIndex, totalBooks, currentStep, stepProgressPercentage, overallProgressPercentage }`
- `ask_required` — ask payload for UI
- `notify` — includes types/events such as pipeline/book completion, step retries, stall recovery, `pipeline_failed`

**External call safety:** Yes for `getStatus` / `start` / `pause` / `resolveAsk`.  
**Cross-book risk:** `start({projectId})` while paused on another scoped book throws. Unscoped start walks `listProjectsForAutomation()` sequentially — calling start/pause affects the single global automation loop, not an isolated per-book worker.

---

### QueueEngine (`src/queue-engine.cjs`)

| Method | Params | Returns | Behavior / safety |
|---|---|---|---|
| `status()` | none | `{ running, pauseRequested, activeProjectId, activeJobId, activeJobIds, engine, preloadedJobId, batchSize, submissionSpacingMs, cooldownUntil, cooldownRemainingMs, cooldownLevel }` | Safe read; includes AI request cooldown fields |
| `start(projectId)` | project UUID | `status()` | One active project. Other project while running → `QUEUE_BUSY`. Same project while running → idempotent. |
| `pause()` | none | `status()` | Sets `pauseRequested`, `browser.cancelWaits()`, project → `paused` |
| `retryJob(jobId)` | job UUID | updated job | Resets incomplete job via store; project → `paused`. Does **not** auto-start generation. |
| `retryAll(projectId)` | project UUID | void | Resets incomplete jobs; project → `paused`. Does **not** auto-start. |
| `notifyEngineChange(engine)` | engine id | `status()` | Updates browser engine + pacing; may drop prepared work |

**Not present:**
- `stop()` distinct from `pause`
- `resume()` (resume = `start(projectId)` again)
- page-selection API for “process only page N” (batching is internal)
- public step/page processor hooks

**Events:**
- `heartbeat` — forwarded from browser + local phases `submission_pacing`, `request_cooldown`, `request_check`
- `changed` — emits `status()`
- `log` — activity events persisted via store path in `#log`
- `auth-required`
- `complete` — `{ projectId }`

**Supervisor control without editing internals:** **Yes** — start/pause/retry/status/events are sufficient to drive the queue from above.

---

## 2. SQLITE / STATE CAPABILITIES

**Store:** `ProjectStore` → `userData/tpt-books.sqlite`  
**Schema changes required for read-only orchestration truth?** **No** for monitoring existing worker state.

### Reliably identifiable via existing public APIs

| Need | How |
|---|---|
| Pending / incomplete books | `listProjects()`, `getProjectStats()`, job statuses |
| Running books | `projects.status === 'running'` + `queue.status().activeProjectId` |
| Paused books | `projects.status === 'paused'` |
| Completed books | `projects.status === 'complete'` and/or stats complete==total |
| Failed / blocked | jobs `needs_user_action`; steps `failed`; listing `upload_failed` |
| Rate-limited books | `projects.status === 'rate_limit_paused'` and/or jobs `rate_limit_paused` |
| Current pipeline step | `automation.getStatus().currentStep` + `step_*_status` columns |
| Current page | `queue.status().activeJobId` + `getJob` / `listJobs` |
| Canva page progress | `canvaPageProgress`, `canvaJobJson`, `stepEditableStatus`, `listCanvaJournal` |
| Retry state | job `attempts`, `retry_wait`, automation `stepRetryCount` |
| Timestamps | `created_at` / `updated_at` on projects/jobs; events; Canva journal |
| Error state | `lastError`, `lastErrorCode`, events, Canva journal outcomes |
| Last activity | `touchProject` / `updated_at` + `listEvents` |

### Automation eligibility already encoded
`listProjectsForAutomation()` excludes:
- `is_ready_to_publish = 1`
- projects with no jobs
- projects with any job in `needs_user_action` or `rate_limit_paused`

### Supervisor-owned decision persistence without schema change
Possible via existing:
- `setSetting` / `getSetting` (JSON blobs for orchestrator decisions)
- `appendEvent` / `listEvents`
- `appendCanvaJournal` / `listCanvaJournal` (Canva-specific audit)

Dedicated orchestrator tables are **not required** for v1, but also **do not exist**.

---

## 3. EVENT / HEARTBEAT CAPABILITIES

### AutomationManager
- `progress`, `ask_required`, `notify`  
- Stall detection already exists internally (`STEP_STALLED` via idle/hardCap watchdog)

### QueueEngine
- `heartbeat` (includes cooldown phases)
- `changed`, `log`, `auth-required`, `complete`

### BrowserController
- Emits `heartbeat` during long waits (e.g. image wait / preview)
- Also `status`, `login-progress`
- QueueEngine forwards browser `heartbeat`

### Canva telemetry (`canva-telemetry.cjs`)
- WebSocket broadcaster: `startTelemetry` / `stopTelemetry` / `emit(payload)`
- Not a structured domain event bus; payload shape depends on callers (main uses liveOperation-style payloads)
- **Not** a guaranteed durable heartbeat for Canva cooldown

### Evidence summary
Heartbeat support **does exist** for queue/browser pacing/cooldown.  
It does **not** provide a first-class multi-book supervisor bus. A new orchestrator can subscribe in-process to `automation`/`queue` emitters if wired in `main.cjs`, or poll SQLite + `state:get`.

---

## 4. HTTP CONTROL CAPABILITIES

Server: `src/automation-http.cjs` on `127.0.0.1:31338`  
Handlers = same IPC `apiHandlers` map from `main.cjs`.

| Method | Endpoint | Parameters | Effect | Safety |
|---|---|---|---|---|
| GET | `/` or `/health` | none | health + engine/queue snapshot | Safe read |
| GET | `/state` or `/snapshot` | none | full `state:get` / `buildState()` | Safe read |
| GET | `/engine` or `/ai-engine` | none | current engine health | Safe read |
| POST | `/engine` or `/ai-engine` | `{ engine }` | `settings:set-ai-engine` | Changes active AI engine — **do not use casually**; auth/routing impact |
| POST | `/queue/start` | `{ projectId, options?, engine?, outputDir? }` | `queue:start` with `automation:true` defaulted in HTTP path | Starts interior generation; can throw `QUEUE_BUSY` / `BROWSER_BUSY` (unless automation bypass on assertBrowserFree for queue path with `opts.automation`) |
| POST | `/queue/pause` | none | `queue:pause` → `pauseAllWork()` | Safe pause of queue+automation+waits |
| POST | `/continue` or `/automation/continue` | `{ projectId?, engine?, start?, outputDir?, automation? }` | may call `queue:start` if remaining pages | Continues queue, not full pipeline step machine |
| POST | `/` (generic) | `{ channel, args[] }` | invokes any registered IPC channel | **Powerful / dangerous** — can reach login/Canva/settings channels if registered |

Relevant IPC channels already registered for supervisor use:
- `state:get`
- `queue:start`, `queue:pause`, `queue:retry-job`, `queue:retry-all`
- `automation:start`, `automation:pause`, `automation:status`, `automation:continue`, `automation:resolve_ask`, `automation:get-settings`, `automation:update-setting`
- `project:run-canva-editable` (Canva resume/run)

**Safe supervisor pattern over HTTP:** prefer dedicated paths + `state:get` / automation+queue channels; avoid blind generic channel use for auth/browser/login.

---

## 5. CURRENT CONCURRENCY BARRIERS

### Explicit answer
**Current architecture does NOT permit** Book A waiting on Canva **while** Book B performs Gemini/ChatGPT work on a separate independent browser context.

There is **one** shared `BrowserController`, **one** `~/ChromeAutomationProfile`, **one** Canary/CDP process.

### Barriers that prevent concurrency

| Barrier | Location | Effect |
|---|---|---|
| Single `QueueEngine.running` / `activeProjectId` | `queue-engine.cjs` | `QUEUE_BUSY` if another book generating |
| `assertBrowserFree` / `liveWorkLabel` | `main.cjs` | Any `liveOperation.kind === 'canva'` blocks other browser stages (`BROWSER_BUSY`) |
| `assertIdle` | `main.cjs` | Blocks new workflows while queue running or automation active+unpaused |
| `liveOperation` singleton | `main.cjs` | One labeled live browser job at a time |
| Automation single loop | `automation-manager.cjs` | Sequential books/steps; `AUTOMATION_BUSY` across scoped pause |
| Shared browser begin/end work | queue ↔ browser | Generation and Canva contend for same controller |
| Canva sets `liveOperation.kind='canva'` | `runCanvaEditableForProject` | Holds browser-busy gate for duration |

**UI browsing other books is allowed; concurrent provider work is not.**

---

## 6. CANVA COOLDOWN DETECTION

| Signal | Detectable / Persistable today? |
|---|---|
| Canva processing | **Yes** — `stepEditableStatus='processing'`, `liveOperation.kind='canva'`, `canvaJobJson.state`, page statuses (`MAGIC_LAYER_PROCESSING`, etc.), journal |
| Page completed / pending / failed | **Yes** — `canvaPageProgress` (`layered`), page `SUCCESS`/`FAILED`/`PENDING`, template link fields |
| Failed Magic Layer | **Yes** — page `FAILED`, errors/codes, journal outcomes |
| AI/ChatGPT request cooldown | **Yes** — queue `cooldownUntil` / `cooldownRemainingMs` / settings pacing (this is **not** Canva) |
| Job/project rate limit | **Yes** — `rate_limit_paused` (AI path) |
| **Canva-specific cooldown** | **UNKNOWN — REQUIRES IMPLEMENTATION** |
| **Canva retry-after timing** | **UNKNOWN — REQUIRES IMPLEMENTATION** |

No Canva module matches for `cooldown` / `RATE_LIMIT` / `retry_after` were found under `src/canva*.cjs`.

---

## 7. CRASH RECOVERY CAPABILITIES

| Scenario | What exists today | Can supervisor recover via public APIs? |
|---|---|---|
| **A. Electron crashes** | Boot `store.recoverInterrupted()`: transient jobs → `retry_wait`; `running`→`paused`; Canva `processing`→ interrupted/`RECOVERING`; interrupted listings → `upload_failed`. No auto-resume. | **Yes (re-kick only):** after relaunch, call `automation:start` / `queue:start` / `project:run-canva-editable` based on SQLite. |
| **B. Chrome crashes** | CDP disconnect; next `launch()` respawns/adopts; waits may throw `BROWSER_CONTEXT_CLOSED`; queue retries/pauses | **Partially:** pause/start queue or re-run Canva; cannot surgically repair mid-DOM without workers. |
| **C. Canva tab disappears** | Ensure-editor / recovery paths inside browser/Canva job; durable progress in SQLite | **Partially:** re-invoke `project:run-canva-editable` resume path; do not reinvent clicks. |
| **D/E. Gemini/ChatGPT tab disappears** | Job pages rebound on next submit; conversationUrl recovery for `retry_wait` | **Partially:** `queue.start` / retry APIs. |
| **F. Temporary network failure** | Treated as wait/failure/retry inside workers; no separate supervisor network policy | **Partially:** observe errors/events, backoff, then restart via public start APIs. |

Supervisor can **orchestrate recovery**, not replace provider recovery logic.

---

## 8. SAFE ORCHESTRATOR CAPABILITY

A new `src/watchdog-orchestrator.cjs` **can** sit above workers and, without editing protected provider modules, do:

| Desired capability | Feasible now? |
|---|---|
| Monitor multiple books | **Yes** (SQLite + `state:get`) |
| Monitor pipeline stages | **Yes** (`step_*_status` + automation status/events) |
| Detect waiting/cooldown (AI queue) | **Yes** |
| Detect Canva cooldown timing | **No** (unknown/not implemented) |
| Detect stalled jobs | **Yes** (events + timeouts + `updated_at` polling; automation already emits stall notifies) |
| Allow Book B actionable work while Book A Canva-waits | **No** (concurrency barriers) |
| Resume waiting work automatically | **Yes** (call existing start/continue/Canva APIs) |
| Recover after app/browser failures | **Yes (re-kick)** using recovered SQLite state |
| Persist supervisor decisions | **Yes** via settings/events (no schema change required) |
| Avoid infinite retries | **Yes** (supervisor policy) |
| Avoid touching provider automation | **Yes** if it only calls public APIs |
| Preserve Gemini/ChatGPT/Canva auth | **Yes** if it never touches profile/cookies/CDP/login channels |

Protected modules that must remain untouched for a sequential supervisor:
- `browser-controller.cjs`
- `canva-bulk.cjs`
- `canva-job-state.cjs`
- `canva-pdf-inject.cjs`
- `ai-engine.cjs`
- Gemini authentication
- ChatGPT authentication
- `ChromeAutomationProfile`
- cookie/session handling
- QueueEngine internals
- existing pipeline logic

---

## 9. REQUIRED CHANGES (IF ANY) — DO NOT IMPLEMENT

### Minimum for a sequential watchdog (monitor + pause/resume + crash re-kick)
1. **New file only:** `src/watchdog-orchestrator.cjs` (or equivalent).  
2. **Small wiring in `main.cjs`:** construct orchestrator with references to `store`, `queue`, `automation`, optional event subscriptions, and maybe expose `watchdog:status` IPC/HTTP.  
   - This is an extension-point wiring change, **not** a provider rewrite.  
3. **Optional:** supervisor settings keys via existing `setSetting` (no schema migration required).

### Required later for full multi-book “Canva wait + other book AI work”
These are **not** small safe additions; they collide with protected browser ownership:
- Split or relax `liveOperation` / `assertBrowserFree` policy
- Multi-context or multi-queue browser ownership model
- Likely changes near `BrowserController` launch/profile semantics

### Required for true Canva cooldown-aware scheduling
- Detection/persistence of Canva cooldown/retry-after  
  **UNKNOWN — REQUIRES IMPLEMENTATION** (new observation layer; must not invent timing)

---

## 10. FINAL CLASSIFICATION: **B**

**B — MOSTLY POSSIBLE, but specific small safe API additions are required**

### Why not A
- No in-process orchestrator module exists yet; it must be created and wired.
- True cross-book concurrency while Canva holds the shared browser is **not** available from current public APIs.
- Canva cooldown timing is not detectable today.

### Why not C
- Monitoring, stall detection, pause/resume, crash re-kick, decision persistence, and provider isolation **are** achievable above the workers using:
  - `AutomationManager` public methods/events
  - `QueueEngine` public methods/events
  - `ProjectStore` read/write APIs
  - `automation-http` / IPC control surface  
- without modifying `browser-controller.cjs`, Canva core modules, `ai-engine.cjs`, auth/profile/cookie/CDP, or QueueEngine internals.

### Practical Phase 1 recommendation (design only)
Build a **sequential** watchdog first (classification-B subset). Treat cross-book concurrency and Canva cooldown sensing as later phases requiring explicit architecture changes beyond current safe extension points.

---

## How to use this file with another AI

Paste or attach this file together with `VERSA-STUDIO-PHASE-0-ARCHITECTURE-AUDIT.md`. Recommended starter prompt:

```
You are reviewing a Phase 1A safe extension-point validation for VERSA STUDIO.

Read:
1. Phase 0 architecture audit
2. This Phase 1A validation (classification B)

Hard rules:
- Do NOT propose edits to protected CRITICAL modules (browser-controller, Canva Magic Layer success criteria, shared Chrome profile/auth).
- Treat Gemini/ChatGPT/Canva sessions as sealed.
- Prefer new files and supervisors that call existing public APIs.
- Do not invent Canva cooldown timing — it is UNKNOWN — REQUIRES IMPLEMENTATION.
- Do not assume Book A Canva + Book B Gemini concurrency is possible without infrastructure changes.

Based on Phase 0 + Phase 1A, propose the safest sequential Phase 1B design for a watchdog/orchestrator.
```

---

**MODIFICATIONS MADE: NONE** (during original inspection)
