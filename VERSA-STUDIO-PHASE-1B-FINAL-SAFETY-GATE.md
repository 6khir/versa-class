# VERSA STUDIO — PHASE 1B FINAL SAFETY GATE

**FILES MODIFIED: 0** (during original review)

**Mode:** READ-ONLY SAFETY REVIEW  
**Depends on:** Phase 0 audit + Phase 1A classification B + Phase 1B watchdog design  
**Purpose:** Final gate before Phase 1C implementation

No application code was modified during this review.

---

## 1. Safety findings

### Passes
- Watchdog stays above workers conceptually (no DOM/auth/CDP ownership).
- Single-browser resource gate is correct for Phase 1B.
- AI cooldown use of `cooldownUntil` is correct.
- Canva cooldown as `WAITING_UNKNOWN_DURATION` is correct (no invented timers).
- Watchdog-as-disposable / fail-safe model is correct.
- No Phase 1C requirement to touch protected BrowserController/Canva/auth modules.

### Failures / corrections required before Phase 1C

| ID | Issue | Severity |
|---|---|---|
| **S1** | `automation.start` vs `queue.start` is ambiguous in Phase 1B; can bypass pipeline steps | **HIGH** |
| **S2** | Raw `project:run-canva-editable` is **not always safe**; no early-complete guard in runner | **HIGH** |
| **S3** | Design allows hard-stall → `pauseAllWork` without an explicit “ambiguous → WAIT” gate | **MEDIUM** |
| **S4** | Design mentions `retryJob`/`retryAll` as available; insufficient hard prohibition while QueueEngine owns `retry_wait` | **MEDIUM** |
| **S5** | Crash-resume “safe vs ambiguous” split is stated, but listing-submit / mid-Canva-without-design-URL cases need explicit NEEDS_USER_ACTION mapping | **MEDIUM** |

None of these require touching protected provider internals. They require **design rule tightening** before coding.

---

## 2. Automation vs Queue ownership decision

### Facts from code
- `AutomationManager` owns pipeline order:  
  `overview → characters → interior → editable → thumbnails → preview → export → listing`
- Interior step **internally** calls `queue.start(projectId)` and waits for completion, then print PDF.
- Editable step **internally** calls `runCanvaEditableForProject`.
- `automation.start({projectId})` while paused resumes the same scoped loop; `onResume` may `queue.start` only if current step is `interior`.
- Direct `queue.start` generates pages only; it does **not** run characters/editable/thumbnails/preview/export/listing.

### Deterministic rule (must replace Phase 1B ambiguity)

```
IF automation.getStatus().active === true
   (paused or not) AND scoped/current project is this project:
    → ONLY automation.start / automation.pause / automation.resolveAsk
    → NEVER queue.start
    → NEVER project:run-canva-editable
    (AutomationManager already owns those workers)

ELSE IF watchdog mode/policy === FULL_PIPELINE
   (default for “automate this book”):
    → ONLY automation.start({ projectId })
    → NEVER queue.start
    → NEVER direct Canva IPC

ELSE IF mode === INTERIOR_ONLY
   (explicit interior generation; automation inactive):
    → queue.start(projectId) allowed
    → NEVER automation.start
    → NEVER Canva unless separate explicit Canva-only mode

ELSE IF mode === CANVA_ONLY
   (explicit editable resume; automation inactive; prerequisites pass):
    → safe Canva adapter only (see §3)
    → NEVER queue.start / automation.start

ELSE:
    → no start command
```

### When watchdog must NEVER call `queue.start`
- Automation is active/paused for that book.
- Full-pipeline policy is on and later steps still matter (characters/editable/thumbnails/preview/export/listing).
- Calling queue would “continue the book” while skipping non-interior stages.

**Correction to Phase 1B:** remove dual unrestricted permission. Default Phase 1C = **FULL_PIPELINE → automation.start only**.

---

## 3. Canva resume verification

### Public paths

| Path | Gate | Notes |
|---|---|---|
| `project:run-canva-editable` | `assertIdle()` | Blocks if queue running or automation active+unpaused |
| `canva:resume-job` / retry variants | weaker/no `assertIdle` in places | Still call `runCanvaEditableForProject` |
| Automation `editable` step | internal | Correct owner during full pipeline |

### `runCanvaEditableForProject` behavior (actual)
- Skips only if `productFormat !== 'editable'`.
- **Does not** early-return when `canvaTemplateLink` already valid / `stepEditableStatus === 'completed'`.
- Requires all page images present; needs/builds compressed print PDF.
- Uses `resumeDesignUrl`, `layeredPageNumbers`, resume index from progress.
- If design URL missing, may re-import PDF path.
- Sets `liveOperation.kind='canva'`; finishes in `finally`.
- On success requires verified template link or throws `CANVA_TEMPLATE_LINK_MISSING`.
- Another browser op: IPC `assertIdle` helps for `project:run-canva-editable`, but runner itself does not self-check complete-state idempotency.

### Safety conclusion
**Not always safe to call blindly.**

Watchdog must use a **small safe adapter** (new helper allowed; not provider rewrite) that commands Canva only if all are true:

1. `productFormat === 'editable'`
2. Automation **not** owning this book
3. Browser/resource gate free + `assertIdle`-equivalent
4. Interior pages complete + print PDF available (or restorable)
5. `canvaLoginConfirmed`
6. Not already safely complete: valid `isCanvaTemplateLink(canvaTemplateLink)` **and** step editable completed / all required pages layered (policy)
7. If design URL missing and PDF missing/unrestorable → **NEEDS_USER_ACTION**, do not guess
8. If `canvaJobJson.intervention` / human-recoverable ambiguity → **NEEDS_USER_ACTION**

If already complete → command = **none** (idempotent no-op).

**UNKNOWN — REQUIRES VERIFICATION in 1C tests:** exact behavior when template link exists but some pages unlayered; adapter should prefer no-op or NEEDS_USER_ACTION, never silent full re-run.

---

## 4. Stall safety review

Phase 1B hard-stall → pause is **too aggressive** if evidence is ambiguous.

### Required stall rule
Before soft/hard stall action, check all of:

- known long-running step budgets (interior/Canva/preview)
- AutomationManager existing idle/hardCap behavior / `STEP_STALLED` notifies
- queue/browser heartbeats
- `queue.status`, `automation.getStatus`
- `liveOperation` changes
- recent events
- SQLite `updated_at`
- AI `cooldownUntil`

| Evidence | Action |
|---|---|
| Clear progress / heartbeat / cooldown wait | WAIT — not a stall |
| Soft threshold, ambiguous | WAIT + diagnose only |
| Hard threshold **and** no heartbeat **and** no cooldown **and** no liveOperation progress **and** worker claims active | then pause + bounded recover |
| Anything ambiguous | **WAIT — DO NOT KILL OR PAUSE** |

**Correction:** Phase 1C must encode explicit `AMBIGUOUS_STALL → WAIT`.

---

## 5. Retry safety review

QueueEngine owns:

- `retry_wait` lifecycle
- attempt counters (`maxAttempts` default 5)
- AI cooldown / rate_limit handling
- recovery via `start` on existing `retry_wait` + conversation baseline

### Required rule
While job status ∈ {`preparing`,`submitted`,`generating`,`downloading`,`validating`,`retry_wait`} **or** queue.running for that project:

- Watchdog may `queue.pause` (escalation only)
- Watchdog may later `queue.start` **once** to resume after idle/backoff
- Watchdog must **NOT** call `retryJob` / `retryAll` (those reset attempts and can duplicate work)

`retryJob`/`retryAll` only if:

- queue not running
- job demonstrably stuck outside lifecycle (e.g. stale `needs_user_action` after human cleared cause — still prefer human/manual)
- default Phase 1C: **disabled**

---

## 6. Crash-resume safety review

### Safe resume (auto allowed only if policy on)
- jobs `retry_wait` + clear incomplete pages + browser free + auth OK
- Canva interrupted **with** saved `canvaDesignUrl` + layered progress + PDF prerequisites + auth OK + automation not owning book
- automation paused mid-pipeline with unambiguous current step and no ask/auth block

### Ambiguous → NEEDS_USER_ACTION (no auto continue)
- listing status recovered to `upload_failed` / submit-in-progress uncertainty
- Canva processing interrupted **without** design URL and without restorable PDF
- auth/session unclear
- `needs_user_action` / `rate_limit_paused` without known eligible time and no human clearance
- conflicting signals (template link present but step failed, etc.)

Default boot auto-resume remains **false**.

---

## 7. Regression-risk table

| Proposed Phase 1C change | Protected system affected? | Risk | Mitigation |
|---|---|---|---|
| Add `src/watchdog-orchestrator.cjs` | No | Low | New file only; public API calls |
| Minimal `main.cjs` construct/subscribe/`watchdog:status` | No (wiring only) | Low–Med | No provider edits; feature flag off by default |
| Optional safe Canva command adapter in new file / thin main facade | No if it only prechecks + calls existing runner | Med | Never re-enter Canva click logic; complete-state no-op |
| Call `automation.start` only for full pipeline | No | Low | Deterministic ownership rule |
| Forbid direct `queue.start` under full pipeline | No | Low | Prevents step bypass |
| Stall WAIT-before-pause rule | No | Low | Avoid false pause during long Canva/interior |
| Disable supervisor `retryJob` by default | No | Low | Prevents fight with QueueEngine |
| Edit `browser-controller.cjs` | **YES — REJECT** | Critical | Out of Phase 1C |
| Edit Canva core modules / success criteria | **YES — REJECT** | Critical | Out of Phase 1C |
| Auth/cookies/CDP/profile changes | **YES — REJECT** | Critical | Out of Phase 1C |
| Provider selector changes | **YES — REJECT** | Critical | Out of Phase 1C |
| Invented Canva cooldown timers | N/A design violation | High | Keep `WAITING_UNKNOWN_DURATION` |
| Dual browser concurrency | Requires protected browser ownership | Critical | Later phase only |

---

## 8. Final classification: **YELLOW**

**YELLOW — Safe architecture, but specific design corrections are required before implementation.**

### Exact corrections required (do not implement yet)

1. **Ownership rule:** default FULL_PIPELINE → only `automation.start`; never dual-call `queue.start`/`Canva` while automation owns the book.
2. **Canva:** do not treat raw `project:run-canva-editable` as unconditionally safe; require a precheck adapter + complete-state no-op + ambiguous → NEEDS_USER_ACTION.
3. **Stall:** ambiguous evidence → WAIT; pause only on hard+clear stall.
4. **Retry:** disable supervisor `retryJob`/`retryAll` by default; never reset while QueueEngine lifecycle is active.
5. **Crash-resume:** explicit safe vs ambiguous matrices; listing-submit uncertainty never auto-resumes.

After these corrections are accepted into the design, Phase 1C may proceed as GREEN-eligible.

---

## 9. Exact next implementation step

**Not implementation — next human/design step:**

1. Accept the five corrections above as Phase 1B.1 addendum.
2. Then Phase 1C step 1 only:  
   create `src/watchdog-orchestrator.cjs` skeleton with `getStatus/start/stop/pause/tick` in **observe-only** mode (no worker commands), plus classifier unit tests.
3. Keep command paths behind feature flag until ownership + Canva adapter rules are coded and tested.

Do **not** implement now.

---

## Hard-requirement checklist

| Requirement | Result |
|---|---|
| Not a second worker | PASS with corrections S1–S4 enforced |
| Single command + re-read before act | PASS (keep as mandatory 1C invariant) |
| Worker authority boundaries | PASS after ownership rule |
| automation vs queue deterministic | **FAIL in current wording → corrected above** |
| Canva resume always safe? | **NO → adapter required** |
| Stall not false-kill | **Needs stronger WAIT rule** |
| Retry non-interference | **Needs hard disable of retryJob by default** |
| Ambiguous crash → NEEDS_USER_ACTION | PASS if matrix enforced |
| No invented Canva cooldown | PASS |
| Watchdog disposable | PASS |
| No protected-file Phase 1C edits | PASS |

---

## Watchdog must NOT become a second worker

Confirmed design intent (with corrections enforced):

The watchdog must NOT:

- generate pages
- generate images
- perform Canva operations directly
- manipulate browser DOM
- manage authentication
- manage cookies
- manage CDP
- implement provider-specific retries
- duplicate QueueEngine retry logic
- duplicate AutomationManager pipeline logic
- maintain a competing project/job state machine

It may only:

**OBSERVE → CLASSIFY → DECIDE → COMMAND THROUGH EXISTING PUBLIC API → VERIFY**

---

## Single command rule (mandatory invariant)

For every tick:

1. Snapshot current state.
2. Determine whether work is actionable.
3. Acquire watchdog-local in-flight mutex.
4. Re-read state immediately before command.
5. Re-check browser/resource availability.
6. Issue ONE command.
7. Release mutex only after command returns.
8. Re-observe actual resulting state.

If anything changed between steps 1 and 5:

**ABORT THE COMMAND.**

Do not rely on stale state.

---

## Worker authority (confirmed)

### QueueEngine remains authoritative for:
- page generation
- page retry behavior
- AI cooldown
- page lifecycle

### AutomationManager remains authoritative for:
- pipeline sequencing
- step execution
- step retries
- book progression

### ProjectStore remains authoritative for:
- durable project/job state
- artifacts
- recovery state

### Canva modules remain authoritative for:
- Canva browser interaction
- Magic Layers
- page verification
- template creation

### Watchdog remains authoritative ONLY for:
- scheduling policy
- supervision
- recovery orchestration
- bounded escalation
- diagnostics

---

## Canva cooldown (confirmed)

Phase 1B / Safety Gate does NOT invent:

- 3-minute cooldown
- 4-minute cooldown
- 180-second cooldown
- arbitrary retry-after

unless the value is explicitly observed from Canva.

Unknown Canva wait must remain:

`WAITING_UNKNOWN_DURATION`

---

## Watchdog failure (confirmed)

If the watchdog crashes:

- existing VERSA continues functioning
- QueueEngine remains usable
- AutomationManager remains usable
- SQLite remains valid
- browser/auth/session remain untouched
- user can manually continue the workflow

The watchdog must be disposable.

---

## How to use this file with another AI

Paste or attach together:

1. `VERSA-STUDIO-PHASE-0-ARCHITECTURE-AUDIT.md`
2. `VERSA-STUDIO-PHASE-1A-EXTENSION-POINT-VALIDATION.md`
3. `VERSA-STUDIO-PHASE-1B-WATCHDOG-DESIGN.md`
4. `VERSA-STUDIO-PHASE-1B-FINAL-SAFETY-GATE.md` (this file)

Recommended starter prompt:

```
You are reviewing VERSA STUDIO Phase 1B Final Safety Gate.

Read Phase 0, Phase 1A, Phase 1B design, and this Safety Gate.

The gate classification is YELLOW.

Hard rules:
- Do NOT implement yet.
- Do NOT touch protected modules.
- Enforce the five corrections (S1–S5) before Phase 1C.
- Default FULL_PIPELINE must use automation.start only.
- Canva resume requires a safe precheck adapter.
- Ambiguous stall = WAIT.
- retryJob disabled by default for watchdog.
- No invented Canva cooldown timers.

Confirm whether the design is ready for observe-only Phase 1C skeleton implementation after these corrections.
```

---

**MODIFICATIONS MADE: NONE** (during original review)

This file is a documentation export of the Phase 1B Final Safety Gate for sharing/review.
