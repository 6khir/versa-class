# VERSA STUDIO — PHASE 1B
# SAFE WATCHDOG / ORCHESTRATOR DESIGN

**FILES MODIFIED: 0** (during original design inspection)

**Mode:** DESIGN ONLY — no implementation  
**Depends on:** Phase 0 architecture audit + Phase 1A classification **B**  
**Scope:** Sequential supervisory layer above existing workers  
**Out of scope:** Book A Canva + Book B Gemini concurrency; invented Canva cooldown timers

Phase 1A classification was:

**B — MOSTLY POSSIBLE**

We can safely build a sequential watchdog/orchestrator above the existing workers, but true cross-book browser concurrency and Canva-specific cooldown detection are NOT currently available.

---

## ABSOLUTE RULES FOR THIS DESIGN

Treat these as sealed/protected:

- `src/browser-controller.cjs`
- `src/canva-bulk.cjs`
- `src/canva-job-state.cjs`
- `src/canva-pdf-inject.cjs`
- `src/ai-engine.cjs`
- Gemini authentication
- ChatGPT authentication
- Canva authentication
- `ChromeAutomationProfile`
- cookie/session handling
- CDP launch/profile behavior
- QueueEngine internals
- existing pipeline logic
- existing provider selectors
- existing Canva success criteria

The watchdog must NOT directly control provider DOM actions.

---

## 1. Architecture diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer / HTTP (127.0.0.1:31338) / optional watchdog:status │
└──────────────────────────────┬──────────────────────────────┘
                               │ observe / command (public APIs only)
┌──────────────────────────────▼──────────────────────────────┐
│                 WatchdogOrchestrator (NEW)                    │
│  Scheduler │ State Monitor │ Stall Detector │ Recovery Mgr    │
│  Retry Policy │ Cooldown Tracker │ Resource Gate │ Diagnostics│
└───────┬──────────────┬──────────────┬──────────────┬────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
 AutomationManager  QueueEngine   ProjectStore   liveOperation/
 (start/pause/      (start/pause/ (SQLite truth) workBusy from
  status/events)     status/events)               buildState()
        │              │
        └──────┬───────┘
               ▼
     Existing sealed workers
     (BrowserController / Canva / AI engines)
               ▲
               │ NEVER called directly by watchdog for DOM/auth/CDP
```

Conceptual data flow:

1. **Observe** SQLite + worker status + events + `workBusy`
2. **Classify** each project into an actionable category
3. **Gate** on single browser resource
4. **Decide** one safe action (or none)
5. **Act** via public APIs only
6. **Record** decision + next evaluation time
7. **Re-check** state before every action (duplicate protection)

### Proposed component

Design a new:

`src/watchdog-orchestrator.cjs`

It should sit ABOVE the existing workers.

Conceptually:

```
Existing Workers
        ↑
        │
Watchdog Orchestrator
        │
        ├── Scheduler
        ├── State Monitor
        ├── Stall Detector
        ├── Recovery Manager
        ├── Retry Policy
        ├── Cooldown Tracker
        ├── Resource Awareness
        └── Diagnostics
```

The watchdog should make decisions using existing public APIs.

---

## 2. Watchdog responsibilities

### Owns
- Periodic evaluation (`tick` / event-driven wake)
- Project priority ranking (sequential)
- Soft/hard stall escalation above existing worker watchdogs
- Crash-resume policy after boot (what to re-kick vs leave paused)
- Bounded supervisor-level retries / backoff
- AI cooldown awareness (`cooldownUntil`)
- Canva observation as `WAITING_UNKNOWN_DURATION` when no reliable timer exists
- Decision/diagnostics persistence via existing `setSetting` / `appendEvent`
- Ensuring at most one browser-consuming operation is requested at a time

### Does not own
- Page generation internals
- Canva clicks / Magic Layer success criteria
- Auth/cookies/CDP/profile
- Competing job/project state machines
- True multi-book browser concurrency

### Authority model
**Workers + SQLite remain authoritative.**  
Watchdog is advisory/commanding but disposable. If it dies, VERSA keeps working as today.

---

## 3. State model

### Principle
Do **not** invent a second project/job state machine.  
Watchdog keeps a thin **supervisory overlay** derived from existing truths.

### Ownership of state

| Domain | Authoritative owner | Watchdog role |
|---|---|---|
| Project/job/step/Canva durable fields | **ProjectStore (SQLite)** | Read; never invent alternate statuses |
| Interior generation runtime | **QueueEngine** (`running`, `activeProjectId`, cooldowns) | Observe + start/pause/retry |
| Pipeline runtime | **AutomationManager** (`active`, `paused`, `currentStep`, …) | Observe + start/pause/resolveAsk |
| Canva durable progress | **SQLite** (`canvaPageProgress`, `canvaJobJson`, `stepEditableStatus`, journal) | Observe + re-kick `project:run-canva-editable` |
| Live browser occupancy | **main.cjs** `liveOperation` / `workBusy` | Observe as resource lock input |
| Watchdog mode + decisions | **Watchdog** (in-memory + settings/events) | Soft state only |

### Watchdog mode (supervisor only)

| Mode | Meaning |
|---|---|
| `idle` | Constructed, not evaluating |
| `monitoring` | Running evaluation loop; no command in flight |
| `running` | Just issued / supervising an active worker action |
| `waiting` | Actionable work exists but deferred (resource busy, backoff, unknown Canva wait) |
| `cooldown` | Explicit AI cooldown known via `cooldownUntil` |
| `recovering` | Executing a recovery playbook |
| `blocked` | No safe automatic action (auth, needs_user_action, ambiguous crash state) |
| `needs_user_action` | Escalated to human |
| `failed` | Watchdog policy exhausted for a target (workers may still be paused/valid) |
| `completed` | No actionable work remaining in scope |
| `shutting_down` | Stop requested; no new commands |

These modes describe **the orchestrator**, not replace `projects.status` / `jobs.status` / `step_*_status` / Canva states.

### Derived project attention labels (diagnostics, not DB enums)
Examples:

- `READY_NOW`
- `RETRY_BACKOFF`
- `WAITING_AI_COOLDOWN`
- `WAITING_FOR_CANVA`
- `WAITING_UNKNOWN_DURATION`
- `BROWSER_BUSY`
- `NEEDS_USER_ACTION`
- `RECOVERING`
- `AUTH_REQUIRED`
- `STALL_DETECTED`
- `RESOURCE_CONFLICT`
- `NO_ACTIONABLE_WORK`
- `COMPLETED`

---

## 4. Scheduling algorithm

### Inputs per evaluation
From store/queue/automation/`buildState()`:

- `projects.status`, all `step_*_status`, jobs + attempts/errors
- `updated_at` / events / Canva journal
- `queue.status()` including cooldown fields
- `automation.getStatus()`
- `workBusy` / `liveOperation`
- Canva fields (`stepEditableStatus`, `canvaJobJson`, progress, template link)
- rate-limit / needs-user-action presence

### Deterministic categories (priority high → low)

1. **Ready to continue immediately**  
   Evidence of safe next worker call and browser free.  
   Examples:
   - automation paused/inactive + unfinished steps + no blockers
   - queue paused/`retry_wait` pages + browser free + no AI cooldown
   - editable interrupted with saved design URL + browser free

2. **Recoverable after retry delay**  
   Transient failure with `nextEligibleAt <= now` false → hold; when due → promote to #1

3. **Waiting for cooldown**  
   AI `cooldownRemainingMs > 0` or project/job `rate_limit_paused` with known/unknown wait

4. **Waiting for another resource**  
   Browser busy / automation scoped elsewhere / queue busy on another book

5. **Needs user intervention**  
   `needs_user_action`, auth-required, unresolved ask (unless auto-policy explicitly allows resolve)

6. **Permanently failed**  
   Policy max attempts / non-recoverable codes

7. **Completed**  
   project complete / all relevant steps completed+verified / publish-ready

### Selection rules

1. Filter to configured scope (selected project only **or** automation-eligible list).
2. Classify each project into exactly one highest-matching category.
3. Consider only category **1** for action in this tick.
4. If none in #1, enter `waiting`/`cooldown`/`blocked` and set `nextEvaluationAt`.
5. Among #1 candidates, pick **one**:
   - Prefer currently active automation/queue project (continuity)
   - Else oldest `created_at` (matches `listProjectsForAutomation` ordering)
   - Else lexicographic `projectId` tie-break

### Action mapping (examples)

| Condition | Command |
|---|---|
| Full pipeline intended + inactive/paused | `automation.start({ projectId })` |
| Interior incomplete + automation not owning it | `queue.start(projectId)` (via existing IPC semantics) |
| Editable interrupted / processing resume needed | `project:run-canva-editable` |
| Ask pending + policy says continue | `automation.resolveAsk(...)` (default: leave to user unless configured) |
| Stall soft | observe/log only |
| Stall hard | `pauseAllWork` equivalent (`queue.pause` / `automation.pause`) then bounded recover |

Only **one** command per tick.

---

## 5. Resource-lock model (no BrowserController changes)

### Concept: `BrowserResourceGate` (watchdog-local)

Derived read-only lock from existing signals:

```
busy = workBusy.queue
    || workBusy.automation
    || workBusy.liveOperation
    || workBusy.tptListing
    || workBusy.bundle
    || workBusy.characters
    || Boolean(liveOperation)
    || queue.status().running
```

Optional finer lock key for diagnostics:

- `interior`
- `canva`
- `listing`
- `thumbnails`
- `preview`
- `automation`
- `unknown`

### Rules

1. If gate busy → never schedule a second browser-consuming operation.
2. Watchdog does not implement its own CDP/profile lock.
3. Before every command, re-read gate; if race → abort command, log `RESOURCE_CONFLICT`, retry later.
4. Worker-thrown `BROWSER_BUSY` / `QUEUE_BUSY` / `AUTOMATION_BUSY` are treated as expected conflicts, not crashes.

### Implication

While Book A holds Canva (`liveOperation.kind='canva'`), Book B cannot be scheduled for Gemini. That is intentional in Phase 1B.

The current architecture has:

- one BrowserController
- one Chrome Canary
- one managed profile
- one CDP connection
- one live browser operation

The watchdog MUST respect this and never schedule two browser-consuming operations simultaneously.

---

## 6. Recovery playbooks (public APIs only)

### A. Electron crash / app restart

1. Existing boot already runs `store.recoverInterrupted()`.
2. Watchdog boot reconcile reads SQLite after that.
3. Classify:
   - jobs `retry_wait` + `APP_RESTARTED` → candidate queue re-kick if browser free and user/auto-resume enabled
   - Canva `interrupted` / `RECOVERING` / `stepEditableStatus` was processing → candidate `run-canva-editable`
   - listing `upload_failed` → **do not auto-submit**; mark `NEEDS_USER_ACTION` / paused
   - ambiguous auth → blocked
4. Record decision; auto-resume only “safe” class; leave unsafe paused.

### B. Chrome/CDP crash

**Recognize:** queue/browser errors `BROWSER_CONTEXT_CLOSED`, repeated launch/profile errors, sudden loss of heartbeats during active work + worker pause.  
**Wait:** short settle (e.g. 5–15s) to allow worker reconnect.  
**Pause:** if thrashing, `queue.pause` / `automation.pause`.  
**Re-kick:** after settle + gate free + durable incomplete work remains.  
**Stop retrying:** after supervisor max recovery attempts → `NEEDS_USER_ACTION`.

### C. Canva tab/editor disappearance

Use only existing resume: `project:run-canva-editable` / automation editable step path.  
Do not invent DOM recovery.  
Rely on SQLite layered progress + design URL.

### D. Gemini/ChatGPT interruption

Use `queue.pause`, `queue.start`, `queue.retryJob` / `retryAll` only when reset is required.  
Prefer letting QueueEngine consume `retry_wait` via `start` rather than competing retries.  
Do NOT create new provider-specific recovery.

### E. Network failure

Bounded backoff series (supervisor-level), then re-evaluate.  
No provider-specific hacks.

---

## 7. Stall detection model

### Sources

- `AutomationManager` `notify` / progress (incl. existing `STEP_STALLED`)
- `QueueEngine` `heartbeat` / `changed` / `log`
- browser heartbeats forwarded by queue
- SQLite `updated_at`, latest events, Canva journal timestamps
- `liveOperation` percent/message changes

### Distinctions

| Class | Evidence |
|---|---|
| REAL PROGRESS | heartbeat phase changes, percent increases, status transitions, new events, page completions, step status changes |
| LONG OPERATION | progress/heartbeats continue within step budget (interior/Canva can be long) |
| TRUE STALL | no progress signals beyond soft/hard thresholds **and** worker not in known cooldown wait |

### Proposed defaults (configurable later via settings)

| Knob | Initial default | Notes |
|---|---|---|
| Evaluate interval | 5s | event wake can be sooner |
| Soft stall | 15 min without progress while supposedly active | warn + diagnose only |
| Hard stall | 45 min, or align above AutomationManager step idle budgets | pause + recover playbook |
| Max supervisor recoveries per target | 3 | then escalate |
| AI cooldown honor | use `cooldownUntil` exactly | do not invent |
| Canva unknown wait poll | 2–5 min | `WAITING_UNKNOWN_DURATION` |

Do **not** use multi-second “kill” timeouts.  
Prefer existing step watchdogs; supervisor escalates only when those appear insufficient or workers are wedged without events.

### Configurability

Store under settings key e.g. `watchdogPolicy` JSON via `setSetting` — no migration required.

---

## 8. Retry policy

### Failure classes

| Class | Examples | Supervisor behavior |
|---|---|---|
| Transient | network blip, `BROWSER_CONTEXT_CLOSED` once | OBSERVE → WAIT(backoff) → RETRY(re-kick) |
| Recoverable | `retry_wait`, interrupted Canva with design URL | WAIT until eligible → RETRY via existing start/resume |
| Rate limit | `rate_limit_paused`, AI cooldown | WAIT using known cooldown if present; else unknown wait; do not fight QueueEngine cooldown |
| Auth | `AUTH_REQUIRED`, login flags false | ESCALATE `NEEDS_USER_ACTION`; never spam login APIs |
| Permanent | exhausted attempts, non-recoverable codes | mark failed/blocked; no auto retry |
| Unknown | unrecognized error | one cautious retry after backoff, then escalate |

### Supervise, don’t compete

- If QueueEngine is already in `retry_wait` / internal attempt loop, watchdog should **start/resume once**, not reset attempts repeatedly.
- Use `retryJob`/`retryAll` only when state is stuck and reset is explicitly required.
- Cap supervisor actions per project/step with attempt counters in watchdog settings/events.

Pattern for every action:

**OBSERVE → WAIT → RETRY → RECOVER → ESCALATE**

The watchdog must NOT create infinite retry loops.

---

## 9. Cooldown model

There are two different concepts.

### AI request cooldown (known)

Already detectable through:

- `cooldownUntil`
- `cooldownRemainingMs`
- queue status

Design:

- Read `queue.status().cooldownUntil` / `cooldownRemainingMs` / `cooldownLevel`
- Also honor project/job `rate_limit_paused`
- Scheduler: category **Waiting for cooldown**; `nextEvaluationAt = cooldownUntil` (or poll if absent)
- Do not start competing browser work “to fill time” in Phase 1B (single browser resource)

### Canva cooldown (unknown)

Currently:

**UNKNOWN — REQUIRES IMPLEMENTATION**

Do NOT invent a Canva cooldown duration.

Instead use a safe observation mechanism that could later record:

- detected cooldown
- evidence
- timestamp
- retry-after if explicitly exposed by Canva
- next eligible time if reliably known

Represent as:

```
{
  kind: 'WAITING_UNKNOWN_DURATION',
  resource: 'canva',
  evidence: <error/message/state observed>,
  detectedAt,
  retryAfter: null,           // only if Canva explicitly exposes it later
  nextEligibleAt: null,       // only if reliably known
  nextPollAt: now + pollInterval
}
```

If no reliable timing exists:

represent it as:

`WAITING_UNKNOWN_DURATION`

and do not pretend to know when Canva will be available.

---

## 10. Crash-resume boot sequence

After VERSA starts (after existing store recovery):

1. Load SQLite (already done).
2. Existing `recoverInterrupted()` already ran.
3. Watchdog `reconcileBoot()`:
   - snapshot projects/jobs/steps/Canva/listing
   - read queue/automation/liveOperation (should be idle at fresh boot)
4. Detect stale claims (should already be paused by recovery).
5. Build actionable set with safety filters.
6. Auto-resume **only if**:
   - policy `autoResumeOnBoot=true` (default **false** for safest first ship; can enable later)
   - browser gate free
   - target not auth-blocked / needs_user_action / listing-submit-ambiguous
   - durable resume point exists
7. Otherwise leave paused and emit diagnostics explaining why.
8. Persist boot decision record.
9. Enter `monitoring`.

Default recommendation: **safe auto-resume opt-in**, not blind resume-all.

The watchdog must never blindly resume every project.

---

## 11. Duplicate-protection model

Before every command:

1. Re-read SQLite + queue + automation + `workBusy`.
2. Abort if command already satisfied (e.g. pages complete, template link valid, step completed).
3. Abort if same project already running under queue/automation/liveOperation.
4. Abort if gate busy.
5. Maintain in-memory `inFlightCommand` mutex inside watchdog.
6. Never call `retryJob` on `complete` jobs.
7. Never schedule Canva if `productFormat !== 'editable'` or template already valid and step completed (unless explicit force policy — default off).
8. Treat idempotent worker returns (`start` while same project running) as success/no-op, not a new attempt.

Safeguards against:

- starting the same project twice
- starting QueueEngine twice
- running AutomationManager twice
- retrying a completed page
- regenerating an already-valid artifact
- processing the same Canva page twice
- conflicting recovery operations

Every supervisor action must first re-check current state.

---

## 12. Observability model

### Decision record (settings blob + mirrored event)

Persist via:

- `setSetting('watchdog:lastDecision', record)`
- `setSetting('watchdog:status', statusSnapshot)`
- `appendEvent({ projectId, level, message, details })`

No DB migration required for Phase 1B.

### Record fields

- `eventName` (e.g. `WATCHDOG_DECISION`)
- `timestamp`
- `watchdogMode`
- `projectId`
- `currentStep` / `activeJobId`
- `reason` (`WAITING_FOR_CANVA`, `BROWSER_BUSY`, `RETRY_BACKOFF`, …)
- `category` (scheduler category 1–7)
- `action` (`none` | `automation.start` | `queue.start` | `queue.pause` | `canva.resume` | …)
- `nextEvaluationAt`
- `recoveryAttempt`
- `evidence` (short codes/messages only)

### Why-is-this-book-not-running

Always answerable from latest decision reason for that `projectId`.

Example reasons:

- `WAITING_FOR_CANVA`
- `WAITING_FOR_AI_COOLDOWN`
- `BROWSER_BUSY`
- `RETRY_BACKOFF`
- `NEEDS_USER_ACTION`
- `RECOVERING`
- `NO_ACTIONABLE_WORK`
- `AUTH_REQUIRED`
- `STALL_DETECTED`
- `RESOURCE_CONFLICT`

Prefer existing `setSetting` / `appendEvent` where appropriate.  
Do NOT require a database migration unless proven necessary.

---

## 13. Failure safety (watchdog crash)

- Watchdog holds **no** exclusive durable locks beyond workers’ own state.
- No writes to cookies/profile/CDP.
- Commands are short and idempotent-checked.
- If watchdog process/module dies:
  - Queue/Automation/UI/HTTP continue
  - SQLite remains valid
  - user can still press Start/Pause manually
- On restart, watchdog re-derives from SQLite; does not assume previous in-memory mode.

Watchdog is **not** a single point of failure.

If watchdog dies:

- existing VERSA functionality must remain usable
- worker state must remain valid
- no provider state should become corrupted

---

## 14. Proposed `WatchdogOrchestrator` API (minimal)

```js
class WatchdogOrchestrator {
  constructor({
    store,
    queue,
    automation,
    getWorkBusy,          // () => buildState().workBusy / liveOperation snapshot
    runCanvaEditable,     // bound facade to existing safe runner/IPC path
    pauseAllWork,         // existing pauseAllWork
    appendDecisionEvent,  // wrapper over store.appendEvent
    policy                // optional overrides
  }) {}

  start()                 // begin monitoring loop
  stop()                  // shutting_down; clear timers; no new commands
  pause()                 // pause supervisory commanding (workers unaffected unless policy says pause workers)
  getStatus()             // watchdog mode + last decisions + nextEvaluationAt
  tick(reason = 'timer')  // one evaluate+maybe-act cycle (also used by event wakes)
  // no public recover() required — recover is internal playbook invoked by tick/boot
}
```

### Existing APIs it calls

- `store.getProject` / `listProjects` / `listProjectsForAutomation` / `listJobs` / `getJob`
- `store.getSetting` / `setSetting` / `appendEvent` / `listEvents` / `listCanvaJournal`
- `queue.status` / `queue.start` / `queue.pause` / `queue.retryJob` / `queue.retryAll` (rare)
- `automation.getStatus` / `automation.start` / `automation.pause` / `automation.resolveAsk` (optional/rare)
- `queue.on('heartbeat'|'changed'|'log'|'auth-required'|'complete')`
- `automation.on('progress'|'notify'|'ask_required')`
- facades: `pauseAllWork`, `runCanvaEditable`, `getWorkBusy`

### APIs it must not call

- BrowserController DOM/login/CDP/profile methods
- Canva click/success internals
- direct cookie DB edits

---

## 15. Minimal `main.cjs` wiring (conceptual)

Where: inside existing `app.whenReady` after `store`, `browser`, `queue`, `automation` are constructed and events are already wired — near current automation event forwarding / after `registerIpc()`.

Conceptual steps only:

1. `const watchdog = new WatchdogOrchestrator({ store, queue, automation, getWorkBusy, runCanvaEditable, pauseAllWork })`
2. Subscribe to `queue`/`automation` events → `watchdog.tick('event')`
3. `watchdog.start()` optionally deferred until app ready + recoverInterrupted done
4. Optional IPC: `watchdog:status` → `watchdog.getStatus()`
5. Optional HTTP via existing generic channel registration
6. On quit path: `watchdog.stop()` before browser close

No redesign of `main.cjs`. No provider logic edits.

---

## 16. Safe vs later vs high-risk boundaries

### SAFE NOW (Phase 1B/1C)

- New `src/watchdog-orchestrator.cjs`
- Minimal main wiring + optional `watchdog:status`
- Sequential scheduling, stall escalation, boot reconcile, AI cooldown honor
- Diagnostics via settings/events
- Tests around supervisor decisions

### LATER

- True multi-book concurrency while one book waits on Canva
- Canva-specific cooldown/retry-after detection implementation
- Default auto-resume-all-on-boot
- Rich supervisor DB tables (only if settings/events prove insufficient)

### HIGH RISK (explicitly excluded)

- BrowserController / CDP / profile / cookie changes
- Separate browser contexts per provider without a full isolation design
- Weakening Canva layered/template success criteria
- Competing retry loops inside QueueEngine/Canva

### Explicit concurrency boundary

**TRUE:**

Book A waiting in Canva

while simultaneously:

Book B using Gemini

must remain classified as a **later architectural phase**.

Do NOT attempt to solve that in Phase 1B.

---

## 17. Test plan (design before implementation)

| # | Case | INPUT | EXPECTED STATE | EXPECTED WATCHDOG DECISION | EXPECTED WORKER ACTION | REGRESSION RISK |
|---|---|---|---|---|---|---|
| 1 | One normal project | unfinished interior, browser free | monitoring→running | `queue.start` or `automation.start` | worker generates | low if APIs only |
| 2 | Two projects sequential | A then B eligible | A finishes/paused before B starts | never dual-start | one worker op at a time | medium (ordering) |
| 3 | Pause/resume | user/watchdog pause | waiting/monitoring | no commands while paused; resume re-kick | pause APIs used | low |
| 4 | Electron crash/restart | interrupted jobs/Canva | recovered SQLite | safe re-kick or leave paused per policy | existing recoverInterrupted + start/resume | medium |
| 5 | Browser crash | BROWSER_CONTEXT_CLOSED | recovering→retry/escalate | bounded re-kick | queue/canva existing recovery | medium |
| 6 | Gemini temp failure | retry_wait | recoverable | wait then `queue.start` | QueueEngine retries | low |
| 7 | AI cooldown | cooldownUntil future | cooldown | no start until due | none | low |
| 8 | Canva interruption | interrupted + design URL | recovering/waiting | `run-canva-editable` once | existing Canva resume | **high if wrong API** — stay on public path |
| 9 | Stall | no progress beyond hard threshold | stall detected | pause + recover attempts | pauseAllWork then re-kick | medium |
| 10 | Duplicate start | already running | resource conflict / no-op | suppress second start | none | low |
| 11 | Completed project | all done | completed/no actionable | none | none | low |
| 12 | needs_user_action | blocked job | needs_user_action | escalate, no spam | none | low |
| 13 | Watchdog crash | kill supervisor mid-run | workers continue | n/a | manual controls still work | low if non-authoritative |
| 14 | Mixed blocked+actionable | A auth-blocked, B ready | schedule B only if free; else wait | never touch A auth | start B only when gate free | medium |

---

## 18. Exact files that would eventually change

**Allowed in implementation phase (not now):**

- **New:** `src/watchdog-orchestrator.cjs`
- **New tests:** e.g. `tests/watchdog-orchestrator.test.cjs`
- **Minimal wiring:** `src/main.cjs` (construct/subscribe/IPC only)
- **Optional docs:** design/status markdown

## 19. Exact files that must remain untouched

- `src/browser-controller.cjs`
- `src/canva-bulk.cjs`
- `src/canva-job-state.cjs`
- `src/canva-pdf-inject.cjs`
- `src/ai-engine.cjs`
- QueueEngine internals (public API use only; no algorithm rewrite)
- AutomationManager pipeline internals (public API use only)
- Gemini/ChatGPT/Canva auth, `ChromeAutomationProfile`, cookies/sessions, CDP launch/profile behavior
- Provider selectors / Canva success criteria
- Existing pipeline step runners’ business logic

---

## 20. Remaining unknowns

1. **Canva cooldown/retry-after timing** — UNKNOWN — REQUIRES IMPLEMENTATION (observation only in 1B).
2. Whether default boot auto-resume should be on or off for production operators (recommend **off** initially).
3. Whether `automation.resolveAsk` should ever be auto-answered by watchdog (recommend **no** by default).
4. Exact product preference when both `automation.start` and bare `queue.start` are valid — recommend prefer automation when full pipeline mode enabled; else queue-only.
5. Whether HTTP generic channel should expose watchdog commands or only `watchdog:status` (recommend status-first).

---

## 21. Recommended Phase 1C implementation sequence

1. Add `watchdog-orchestrator.cjs` skeleton: `getStatus/start/stop/pause/tick`, no commands.
2. Implement read-only classifier + diagnostics (`WHY NOT RUNNING`).
3. Add unit tests for classification using fixtures (no browser).
4. Wire main.js subscribe + `watchdog:status` (still command-disabled behind flag).
5. Enable single safe command path: pause/resume + `queue.start` under feature flag.
6. Add Canva resume re-kick via existing public path.
7. Add boot reconcile with auto-resume **default false**.
8. Add stall soft/hard escalation.
9. Expand tests 1–14 with mocks.
10. Only then consider policy defaults for auto-resume.

**Still forbidden in 1C:** concurrency redesign, Canva DOM changes, auth/profile/CDP edits, invented Canva cooldown timers.

---

## How to use this file with another AI

Paste or attach these three files together:

1. `VERSA-STUDIO-PHASE-0-ARCHITECTURE-AUDIT.md`
2. `VERSA-STUDIO-PHASE-1A-EXTENSION-POINT-VALIDATION.md`
3. `VERSA-STUDIO-PHASE-1B-WATCHDOG-DESIGN.md` (this file)

Recommended starter prompt:

```
You are reviewing VERSA STUDIO Phase 1B: Safe Watchdog / Orchestrator Design.

Read:
1. Phase 0 architecture audit
2. Phase 1A extension-point validation (classification B)
3. This Phase 1B design

Hard rules:
- Do NOT propose edits to protected CRITICAL modules (browser-controller, Canva Magic Layer success criteria, shared Chrome profile/auth).
- Treat Gemini/ChatGPT/Canva sessions as sealed.
- Prefer new files and supervisors that call existing public APIs.
- Do not invent Canva cooldown timing — it is UNKNOWN — REQUIRES IMPLEMENTATION.
- Do not assume Book A Canva + Book B Gemini concurrency is possible in Phase 1B/1C.
- Workers + SQLite remain authoritative; watchdog must fail safely.

Based on these documents, review the Phase 1B design for gaps, contradictions, or unsafe assumptions before Phase 1C implementation.
```

---

**MODIFICATIONS MADE: NONE** (during original design)

This file is a documentation export of the Phase 1B design for sharing/review.
