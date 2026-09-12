'use strict';

const EventEmitter = require('node:events');

const { detectProductEngine, ENGINE_TYPES } = require('./product-engine-boundary.cjs');
const NORMAL_PIPELINE = Object.freeze(['overview', 'interior', 'thumbnails', 'preview', 'export']);
// Editable products replace the single "interior" step with the three-stage editable
// pipeline: artwork, then the text written against it, then the PowerPoint assembly.
const EDITABLE_PIPELINE = Object.freeze([
  'overview', 'interior_artwork', 'interior_text', 'editable_ppt',
  'thumbnails', 'preview', 'export'
]);
const MAZE_PIPELINE = Object.freeze(['overview', 'maze', 'thumbnails', 'preview', 'export']);
const PIPELINE_STEPS = NORMAL_PIPELINE;
const EDITABLE_ONLY_STEPS = Object.freeze(['interior_artwork', 'interior_text', 'editable_ppt']);
const MAZE_ONLY_STEPS = Object.freeze(['maze']);
function getPipelineSteps(project) {
  const engine = detectProductEngine(project);
  if (engine === ENGINE_TYPES.NATIVE_TEXT_EDITABLE) return EDITABLE_PIPELINE;
  if (engine === ENGINE_TYPES.MAZE) return MAZE_PIPELINE;
  return NORMAL_PIPELINE;
}
function pipelineDependencies(pipeline) {
  return Object.fromEntries(pipeline.map((step, i) => [step, i ? [pipeline[i - 1]] : []]));
}
// Each pipeline is a strict chain, so a step depends only on the one before it in
// whichever pipeline the project actually runs. Shared downstream keys stay on the
// static/editable maps so maze does not rewrite thumbnails → preview → export.
const STEP_DEPENDENCIES = {
  ...pipelineDependencies(EDITABLE_PIPELINE),
  ...pipelineDependencies(NORMAL_PIPELINE),
  maze: ['overview']
};
function getStepDependencies(project, step) {
  return pipelineDependencies(getPipelineSteps(project))[step] || [];
}

const STEP_LABELS = {
  overview: 'Overview & Idea Extraction',
  characters: 'Character Generation',
  interior: 'Book Interior Generation',
  interior_artwork: 'Interior Artwork',
  interior_text: 'Interior Text',
  editable_ppt: 'Editable PowerPoint',
  editable_generation: 'Editable Page Generation',
  maze: 'Maze Lab',
  thumbnails: 'Marketing Thumbnails Creation',
  preview: 'Preview Video Generation',
  export: 'PDF, ZIP & PPTX Exporting'
};

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]; // exponential backoff

/**
 * Stall watchdog budgets per step.
 *
 *   idleMs    — no progress callback for this long ⇒ the step is considered hung.
 *   hardCapMs — absolute ceiling regardless of progress.
 *
 * Steps that report incremental progress (interior, thumbnails, characters) get a
 * short idle window and a generous ceiling. Steps that only report 0% then 100%
 * (overview, export) cannot be judged on idleness, so their idle window
 * equals their ceiling.
 */
const STEP_TIMEOUTS = {
  overview: { idleMs: 120_000, hardCapMs: 120_000 },
  characters: { idleMs: 20 * 60_000, hardCapMs: 90 * 60_000 },
  interior: { idleMs: 45 * 60_000, hardCapMs: 12 * 60 * 60_000 },
  interior_artwork: { idleMs: 45 * 60_000, hardCapMs: 12 * 60 * 60_000 },
  interior_text: { idleMs: 20 * 60_000, hardCapMs: 180 * 60_000 },
  // Assembly is local and finishes in milliseconds.
  editable_ppt: { idleMs: 5 * 60_000, hardCapMs: 10 * 60_000 },
  editable_generation: { idleMs: 20 * 60_000, hardCapMs: 180 * 60_000 },
  maze: { idleMs: 20 * 60_000, hardCapMs: 180 * 60_000 },
  thumbnails: { idleMs: 30 * 60_000, hardCapMs: 90 * 60_000 },
  preview: { idleMs: 45 * 60_000, hardCapMs: 90 * 60_000 },
  export: { idleMs: 30 * 60_000, hardCapMs: 30 * 60_000 }
};

const DEFAULT_STEP_TIMEOUT = { idleMs: 30 * 60_000, hardCapMs: 60 * 60_000 };

const WATCHDOG_TICK_MS = 5_000;

// After aborting a stalled step we give the orphaned runner this long to unwind
// (its pending Playwright calls reject once the abort hook tears the browser down)
// before starting a retry, so two runs never share the same browser profile.
const ORPHAN_SETTLE_GRACE_MS = 60_000;

function formatDuration(ms) {
  const totalSeconds = Math.round(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function stepStatusKey(step) {
  return `step${step.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')}Status`;
}

// Editable stages share the store columns written by updateProjectStepStatus:
// interior_artwork → step_interior_status, interior_text → step_editable_status,
// editable_ppt → step_editable_generation_status. The camelCase keys from
// stepStatusKey() are not on production project rows, so a missing field must
// fall back to those shared columns instead of treating the step as pending.
const STEP_STATUS_COLUMNS = Object.freeze({
  interior_artwork: 'stepInteriorStatus',
  interior_text: 'stepEditableStatus',
  editable_ppt: 'stepEditableGenerationStatus'
});

function readStepStatus(project, step) {
  const direct = project?.[stepStatusKey(step)];
  if (direct != null) return direct;
  const shared = STEP_STATUS_COLUMNS[step];
  return project?.[shared] ?? 'pending';
}

function isStepSatisfied(status) {
  return status === 'completed' || status === 'skipped';
}

class AutomationManager extends EventEmitter {
  /**
   * @param {object}   options
   * @param {Function} [options.abortStep] - async (step, projectId, reason) invoked when a
   *   step stalls. Must tear down whatever the step is blocked on (browser, queue) so the
   *   runner's pending awaits reject instead of hanging forever.
   * @param {Function} [options.dispatchStep] - async ({ step, projectId, onProgress, runner }).
   *   When present, steps run through it instead of being called directly — this is how
   *   the durable queue takes ownership of a stage without the manager losing its
   *   retry, verify and notify semantics.
   * @param {object}   [options.stepVerifiers] - map of step → async (projectId) that throws
   *   when the runner returned without producing usable output.
   * @param {Function} [options.resetBeforeRetry] - async (step, projectId, attempt) invoked
   *   before every retry attempt. A failed attempt can leave the browser half-open and
   *   still holding its profile lock, which otherwise makes every later attempt fail.
   */
  constructor({
    store,
    stepRunners,
    broadcast,
    abortStep = null,
    resetBeforeRetry = null,
    onPause = null,
    onResume = null,
    stepVerifiers = {},
    dispatchStep = null,
    stepTimeouts = STEP_TIMEOUTS,
    watchdogTickMs = WATCHDOG_TICK_MS,
    orphanSettleGraceMs = ORPHAN_SETTLE_GRACE_MS,
    retryDelaysMs = RETRY_DELAYS_MS
  }) {
    super();
    this._store = store;
    this._stepRunners = stepRunners;
    this._broadcast = broadcast;
    this._abortStep = abortStep;
    this._resetBeforeRetry = resetBeforeRetry;
    this._onPause = typeof onPause === 'function' ? onPause : null;
    this._onResume = typeof onResume === 'function' ? onResume : null;
    this._stepVerifiers = stepVerifiers;
    this._dispatchStep = dispatchStep;
    this._stepTimeouts = stepTimeouts;
    this._watchdogTickMs = watchdogTickMs;
    this._orphanSettleGraceMs = orphanSettleGraceMs;
    this._retryDelaysMs = retryDelaysMs;

    this._active = false;
    this._paused = false;
    this._currentProjectId = null;
    this._currentStep = null;
    this._stepRetryCount = 0;
    this._currentBookIndex = 0;
    this._totalBooks = 0;
    this._askResolver = null;
    this._loopPromise = null;
    this._pauseResolvers = [];
    this._completedBooks = 0;
    this._failedBooks = 0;
    this._scopeProjectId = null;
  }

  getStatus() {
    return {
      active: this._active,
      paused: this._paused,
      currentProjectId: this._currentProjectId,
      currentStep: this._currentStep,
      currentBookIndex: this._currentBookIndex,
      totalBooks: this._totalBooks,
      stepRetryCount: this._stepRetryCount,
      awaitingAsk: Boolean(this._askResolver),
      completedBooks: this._completedBooks,
      failedBooks: this._failedBooks
    };
  }

  async start({ projectId = null } = {}) {
    if (this._active) {
      if (!this._paused) {
        return this.getStatus();
      }
      if (projectId && this._scopeProjectId && projectId !== this._scopeProjectId) {
        throw Object.assign(
          new Error('Full automation is paused on another book. Resume that book, or finish it, then start this one.'),
          { code: 'AUTOMATION_BUSY' }
        );
      }
      this._paused = false;
      try { this._onResume?.(); } catch {}
      const resolvers = this._pauseResolvers.splice(0);
      for (const resolve of resolvers) resolve();
      await this._broadcast();
      return this.getStatus();
    }
    this._active = true;
    this._paused = false;
    this._completedBooks = 0;
    this._failedBooks = 0;
    this._scopeProjectId = projectId || null;
    this._loopPromise = this._runLoop().catch((error) => {
      console.error('[AutomationManager] Loop crashed:', error);
      this._active = false;
      this._paused = false;
      this._currentProjectId = null;
      this._currentStep = null;
      this._store.appendEvent({
        level: 'error',
        message: `[Automation] Pipeline crashed: ${error.message}`,
        details: { code: error.code ?? 'AUTOMATION_CRASHED' }
      });
      this.emit('notify', {
        type: 'pipeline_failed',
        level: 'error',
        title: 'Pipeline Failed',
        message: `Automation stopped unexpectedly: ${error.message}`
      });
      this._broadcast().catch(() => {});
    }).finally(() => {
      this._loopPromise = null;
    });
    return this.getStatus();
  }

  pause() {
    if (!this._active) return this.getStatus();
    this._paused = true;
    try { this._onPause?.(); } catch {}
    this._broadcast().catch(() => {});
    return this.getStatus();
  }

  resolveAsk(decision) {
    if (!this._askResolver) {
      throw Object.assign(new Error('No pending ask to resolve.'), { code: 'NO_PENDING_ASK' });
    }
    const { resolve } = this._askResolver;
    this._askResolver = null;
    resolve(decision);
  }

  _automationProjects() {
    const listed = this._store.listProjectsForAutomation();
    if (!this._scopeProjectId) return listed;
    const scoped = listed.filter((project) => project.id === this._scopeProjectId);
    if (scoped.length) return scoped;
    const one = this._store.getProject(this._scopeProjectId);
    return one ? [one] : [];
  }

  async _runLoop() {
    for (const project of this._automationProjects()) {
      for (const step of getPipelineSteps(project)) {
        if (readStepStatus(project, step) === 'completed') {
          await this._ensureCompletedStepStillValid(project.id, step);
        }
      }
    }

    const projects = this._automationProjects().filter((project) => getPipelineSteps(project).some((step) => {
      return !(step === 'editable_generation' ? ['completed'] : ['completed', 'skipped']).includes(readStepStatus(project, step));
    }));
    this._totalBooks = projects.length;
    this._currentBookIndex = 0;

    if (projects.length === 0) {
      this._store.appendEvent({
        level: 'info',
        message: '[Automation] No pending automation steps were found.'
      });
      this._active = false;
      await this._broadcast();
      return;
    }

    let stoppedEarly = false;
    for (const project of projects) {
      await this._waitWhilePaused();
      if (!this._active) {
        stoppedEarly = true;
        break;
      }
      this._currentBookIndex += 1;
      this._currentProjectId = project.id;
      await this._broadcast();
      this._store.appendEvent({
        projectId: project.id,
        level: 'info',
        message: `[Automation] Starting book ${this._currentBookIndex}/${this._totalBooks}: ${project.name}`
      });
      const result = await this._processBook(project.id);
      if (result === 'completed') this._completedBooks += 1;
      if (result === 'failed') this._failedBooks += 1;
      if (result === 'stopped') {
        stoppedEarly = true;
        break;
      }
    }

    const processedCount = this._currentBookIndex;
    const unprocessedBooks = this._totalBooks - (this._completedBooks + this._failedBooks);
    this._active = false;
    this._paused = false;
    this._currentProjectId = null;
    this._currentStep = null;
    await this._broadcast();

    // A halted run is not a successful one. Reporting "all completed" here was the
    // source of the false success alert: a book that returned 'stopped' counts as
    // neither completed nor failed, so the failure branch below was skipped.
    if (stoppedEarly || unprocessedBooks > 0) {
      const summary = this._completedBooks > 0
        ? `${this._completedBooks} of ${this._totalBooks} book(s) finished before the pipeline stopped.`
        : `No books were completed before the pipeline stopped.`;
      this._store.appendEvent({
        level: 'warn',
        message: `[Automation] Pipeline stopped early. ${summary} ${unprocessedBooks} book(s) were never processed.`
      });
      this.emit('notify', {
        type: 'pipeline_stopped',
        level: 'warning',
        totalBooks: this._totalBooks,
        processedCount,
        completedBooks: this._completedBooks,
        failedBooks: this._failedBooks,
        unprocessedBooks,
        title: 'Pipeline Stopped Early',
        message: `${summary} Review the remaining steps, then start the automation again.`
      });
      return;
    }

    if (this._failedBooks > 0) {
      this._store.appendEvent({
        level: 'error',
        message: `[Automation] Pipeline finished with ${this._failedBooks} failed and ${this._completedBooks} completed book(s).`
      });
      this.emit('notify', {
        type: 'pipeline_failed',
        level: 'error',
        totalBooks: this._totalBooks,
        processedCount,
        completedBooks: this._completedBooks,
        failedBooks: this._failedBooks,
        title: 'Pipeline Finished with Errors',
        message: `${this._completedBooks} book(s) completed and ${this._failedBooks} failed. Review the failed steps before retrying.`
      });
    } else {
      this._store.appendEvent({
        level: 'success',
        message: `[Automation] Pipeline run finished. Successfully processed ${this._completedBooks} book(s).`
      });
      this.emit('notify', {
        type: 'all_completed',
        level: 'complete',
        totalBooks: this._totalBooks,
        processedCount,
        completedBooks: this._completedBooks,
        failedBooks: 0,
        title: 'Pipeline Finished',
        message: `All ${this._completedBooks} book(s) processed successfully!`
      });
    }
  }

  async _processBook(projectId) {
    // The editable pipeline is longer than the static one, and classification can
    // change which pipeline applies at index 1, so bound by whichever is longest.
    const maxSteps = Math.max(NORMAL_PIPELINE.length, EDITABLE_PIPELINE.length, MAZE_PIPELINE.length);
    for (let pipelineIndex = 0; pipelineIndex < maxSteps; pipelineIndex++) {
      // Re-read classification AFTER overview, then persist the engine lock.
      if (pipelineIndex === 1 && this._store.lockProductEngine) this._store.lockProductEngine(projectId);
      const step = getPipelineSteps(this._store.getProject(projectId))[pipelineIndex];
      if (!step) break;
      await this._waitWhilePaused();
      if (!this._active) return 'stopped';
      const project = this._store.getProject(projectId);
      if (!project) return 'stopped';

      let currentStatus = readStepStatus(project, step);

      if (step === 'editable_generation' && currentStatus === 'skipped') {
        this._store.updateProjectStepStatus(projectId, step, 'pending');
        currentStatus = 'pending';
      }
      if (currentStatus === 'skipped') {
        this._emitProgress(step, 100);
        continue;
      }
      if (currentStatus === 'completed') {
        if (await this._ensureCompletedStepStillValid(projectId, step)) {
          this._emitProgress(step, 100);
          continue;
        }
      }

      const dependencyBlock = this._unsatisfiedDependency(projectId, step);
      if (dependencyBlock) {
        this._store.updateProjectStepStatus(projectId, step, 'failed');
        this._store.appendEvent({
          projectId,
          level: 'error',
          message: `[Automation] Cannot run "${STEP_LABELS[step] || step}" until "${STEP_LABELS[dependencyBlock.step] || dependencyBlock.step}" is completed or skipped (status: ${dependencyBlock.status}).`,
          details: { code: 'PIPELINE_DEPENDENCY_BLOCKED', step, dependency: dependencyBlock.step }
        });
        this.emit('notify', {
          type: 'step_failed',
          level: 'error',
          projectId,
          project: this._store.getProject(projectId),
          step,
          stepName: step,
          bookIndex: this._currentBookIndex,
          totalBooks: this._totalBooks,
          title: 'Pipeline Order Blocked',
          message: `Step "${STEP_LABELS[step] || step}" cannot start before "${STEP_LABELS[dependencyBlock.step] || dependencyBlock.step}" finishes.`
        });
        return 'failed';
      }

      const settings = this._store.getAutomationSettings();
      let mode = settings[step] ?? 'always';
      if (['interior', 'editable_generation'].includes(step)) mode = 'always';

      if (mode === 'manual') {
        this._store.updateProjectStepStatus(projectId, step, 'awaiting_input');
        this._currentStep = step;
        await this._broadcast();
        this._store.appendEvent({
          projectId,
          level: 'info',
          message: `[Automation] Step "${STEP_LABELS[step] || step}" is set to Manual Only. Pausing pipeline for manual action.`
        });
        this.emit('notify', {
          type: 'action_required',
          level: 'warning',
          projectId,
          project,
          step,
          stepName: step,
          bookIndex: this._currentBookIndex,
          totalBooks: this._totalBooks,
          title: project.name || 'Manual Action Required',
          message: `Step "${STEP_LABELS[step] || step}" is set to Manual Only. Perform this step manually to proceed.`
        });
        return 'stopped';
      }

      if (mode === 'ask') {
        this._store.updateProjectStepStatus(projectId, step, 'awaiting_input');
        this._currentStep = step;
        await this._broadcast();
        const askPayload = {
          projectId,
          project,
          step,
          stepName: step,
          stepIndex: getPipelineSteps(project).indexOf(step),
          bookIndex: this._currentBookIndex,
          totalBooks: this._totalBooks
        };
        this.emit('ask_required', askPayload);
        this.emit('notify', {
          type: 'action_required',
          level: 'warning',
          projectId,
          project,
          step,
          stepName: step,
          bookIndex: this._currentBookIndex,
          totalBooks: this._totalBooks,
          title: project.name || 'Action Required',
          message: `Action Required: Step "${STEP_LABELS[step] || step}" is waiting for your confirmation.`
        });
        let decision;
        try {
          decision = await this._waitForAskDecision();
        } catch {
          return 'stopped';
        }
        await this._waitWhilePaused();
        if (!this._active) return 'stopped';
        if (decision === 'skip') {
          if (step === 'editable_generation') {
            this._store.updateProjectStepStatus(projectId, step, 'awaiting_input');
            return 'stopped';
          }
          {
            this._store.updateProjectStepStatus(projectId, step, 'skipped');
            this._store.appendEvent({ projectId, level: 'info', message: `[Automation] Step "${step}" skipped by user.` });
            this._emitProgress(step, 100);
            await this._broadcast();
            continue;
          }
        }
        // decision === 'proceed' → fall through
      }

      const succeeded = await this._executeStepWithRetry(projectId, step);
      if (!succeeded) {
        this._store.appendEvent({
          projectId,
          level: 'error',
          message: `[Automation] Halted at "${step}".`
        });
        return 'failed';
      }
    }

    const completedProject = this._store.getProject(projectId);
    this.emit('notify', {
      type: 'book_completed',
      level: 'complete',
      projectId,
      project: completedProject,
      bookIndex: this._currentBookIndex,
      totalBooks: this._totalBooks,
      title: completedProject?.name || 'Book Completed',
      message: `Book ${this._currentBookIndex}/${this._totalBooks} ("${completedProject?.name || 'Untitled'}") reached 100% completion!`
    });
    return 'completed';
  }

  /**
   * Returns the first unsatisfied predecessor for `step`, or null when order is OK.
   * Completed/skipped predecessors satisfy the gate. Failed/pending/processing block.
   */
  _unsatisfiedDependency(projectId, step) {
    const project = this._store.getProject(projectId);
    const steps = getPipelineSteps(project);
    const index = steps.indexOf(step);
    const deps = index > 0 ? [steps[index - 1]] : [];
    if (!deps.length) return null;
    if (!project) return { step: deps[0], status: 'missing_project' };
    for (const dep of deps) {
      const status = readStepStatus(project, dep);
      const mustComplete = dep === 'editable_generation' || EDITABLE_ONLY_STEPS.includes(dep) || MAZE_ONLY_STEPS.includes(dep);
      if (mustComplete ? status !== 'completed' : !isStepSatisfied(status)) return { step: dep, status };
    }
    return null;
  }

  async _executeStepWithRetry(projectId, step) {
    const runner = this._stepRunners[step];
    if (!runner) {
      // Editable stages must fail closed: skipping one would ship a book whose
      // artwork, text or PowerPoint was never built.
      if (step === 'editable_generation' || EDITABLE_ONLY_STEPS.includes(step) || MAZE_ONLY_STEPS.includes(step)) {
        this._store.updateProjectStepStatus(projectId, step, 'failed');
        return false;
      }
      this._store.updateProjectStepStatus(projectId, step, 'skipped');
      return true;
    }

    this._currentStep = step;
    this._stepRetryCount = 0;
    await this._broadcast();

    const retryDelays = this._retryDelaysMs;
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      await this._waitWhilePaused();
      if (!this._active) return false;
      try {
        // Start each retry from a clean slate. Without this, one failed attempt that
        // leaves a browser holding the profile lock makes every remaining attempt fail
        // instantly with the same error.
        if (attempt > 0 && typeof this._resetBeforeRetry === 'function') {
          try {
            await this._resetBeforeRetry(step, projectId, attempt);
          } catch (resetError) {
            this._store.appendEvent({
              projectId,
              level: 'warn',
              message: `[Automation] Could not fully reset before retrying "${step}": ${resetError.message}`,
              details: { code: 'STEP_RESET_FAILED' }
            });
          }
        }
        this._store.updateProjectStepStatus(projectId, step, 'processing');
        this._store.appendEvent({
          projectId,
          level: 'info',
          message: `[Automation] Step "${step}" attempt ${attempt + 1}/${retryDelays.length + 1}.`
        });
        await this._broadcast();
        this._emitProgress(step, 0);

        // Step runners own operation-specific timeouts, but several of their waits
        // are unbounded (manual TPT verification, queue events, Playwright evaluate).
        // The watchdog below is the backstop: it aborts the underlying browser/queue
        // so the runner's awaits reject, then waits for the orphan to unwind before
        // this loop is allowed to retry.
        await this._runStepWithWatchdog(step, projectId, runner);

        // A runner returning without throwing is not proof it produced anything.
        await this._verifyStepOutput(step, projectId);

        this._store.updateProjectStepStatus(projectId, step, 'completed');
        this._store.appendEvent({ projectId, level: 'success', message: `[Automation] Step "${step}" completed.` });
        this._emitProgress(step, 100);
        await this._broadcast();

        const proj = this._store.getProject(projectId);
        this.emit('notify', {
          type: 'step_completed',
          level: 'success',
          projectId,
          project: proj,
          step,
          stepName: step,
          bookIndex: this._currentBookIndex,
          totalBooks: this._totalBooks,
          title: proj?.name || 'Step Completed',
          message: `${STEP_LABELS[step] || step} completed for "${proj?.name || 'Book'}".`
        });

        return true;
      } catch (error) {
        // Some recovery failures mean the previous runner may still be alive.
        // Retrying those errors could run two copies of the same step against the
        // same browser profile, so they must fail closed on the current attempt.
        const retryAllowed = error?.retryable !== false;
        const isLastAttempt = attempt === retryDelays.length || !retryAllowed;
        this._stepRetryCount = attempt + 1;
        this._store.appendEvent({
          projectId,
          level: isLastAttempt ? 'error' : 'warn',
          message: `[Automation] Step "${step}" attempt ${attempt + 1} failed: ${error.message}${isLastAttempt ? '. Halting.' : '. Retrying…'}`,
          details: { code: error.code ?? 'STEP_ERROR' }
        });
        if (isLastAttempt) {
          this._store.updateProjectStepStatus(projectId, step, 'failed');
          await this._broadcast();

          const proj = this._store.getProject(projectId);
          this.emit('notify', {
            type: 'step_failed',
            level: 'error',
            projectId,
            project: proj,
            step,
            stepName: step,
            bookIndex: this._currentBookIndex,
            totalBooks: this._totalBooks,
            title: proj?.name || 'Step Failed',
            message: retryAllowed
              ? `Step "${STEP_LABELS[step] || step}" failed for "${proj?.name || 'Book'}" after all retry attempts.`
              : `Step "${STEP_LABELS[step] || step}" could not be recovered safely for "${proj?.name || 'Book'}". No overlapping retry was started.`
          });

          return false;
        }
        await this._broadcast();
        await this._sleep(retryDelays[attempt]);
      }
    }
    return false;
  }

  /**
   * Runs a step runner under an idle + hard-cap stall watchdog.
   *
   * On a stall the abort hook tears down the resource the runner is blocked on, which
   * turns its unbounded await into a rejection. We then wait (bounded) for the orphaned
   * runner to actually settle so a retry never races a still-live run.
   */
  async _runStepWithWatchdog(step, projectId, runner) {
    const policy = { ...DEFAULT_STEP_TIMEOUT, ...(this._stepTimeouts?.[step] ?? {}) };
    let startedAt = Date.now();
    let lastActivityAt = startedAt;
    let pausedAt = this._paused ? startedAt : null;
    let finished = false;
    let timer = null;

    // A step is dispatched through the durable queue when one is wired in, so its
    // progress is committed and a crash mid-step resumes rather than restarts.
    // Without a dispatcher the runner is called directly, which is what the unit
    // tests do and what a build with no queue falls back to. Either way this
    // watchdog is still the backstop for a wait that never returns.
    const invoke = typeof this._dispatchStep === 'function'
      ? (onProgress) => this._dispatchStep({ step, projectId, onProgress, runner })
      : (onProgress) => runner(projectId, onProgress);

    const runPromise = (async () => invoke((pct) => {
      lastActivityAt = Date.now();
      this._onStepProgress(step, pct);
    }))();
    // The race below may leave this promise pending; keep it from becoming an
    // unhandled rejection while the orphan unwinds.
    runPromise.catch(() => {});

    const watchdog = new Promise((_resolve, reject) => {
      const tick = () => {
        if (finished) return;
        const now = Date.now();

        // Time spent paused or waiting on the user is not a stall.
        if (this._paused || this._askResolver) {
          pausedAt ??= now;
          timer = this._scheduleTick(tick);
          return;
        }
        if (pausedAt !== null) {
          // Shift both clocks forward so a long pause counts against neither budget.
          const pausedFor = now - pausedAt;
          lastActivityAt += pausedFor;
          startedAt += pausedFor;
          pausedAt = null;
        }

        const idleFor = now - lastActivityAt;
        const ranFor = now - startedAt;
        if (policy.idleMs && idleFor >= policy.idleMs) {
          reject(Object.assign(
            new Error(`Step "${step}" stopped reporting progress for ${formatDuration(idleFor)} and was treated as frozen.`),
            { code: 'STEP_STALLED', stallKind: 'idle', step, elapsedMs: ranFor, idleMs: idleFor }
          ));
          return;
        }
        if (policy.hardCapMs && ranFor >= policy.hardCapMs) {
          reject(Object.assign(
            new Error(`Step "${step}" exceeded its ${formatDuration(policy.hardCapMs)} time limit and was treated as frozen.`),
            { code: 'STEP_STALLED', stallKind: 'hard_cap', step, elapsedMs: ranFor, idleMs: idleFor }
          ));
          return;
        }
        timer = this._scheduleTick(tick);
      };
      timer = this._scheduleTick(tick);
    });

    try {
      return await Promise.race([runPromise, watchdog]);
    } catch (error) {
      if (error?.code === 'STEP_STALLED') await this._recoverFromStall(step, projectId, error, runPromise);
      throw error;
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
    }
  }

  _scheduleTick(tick) {
    const timer = setTimeout(tick, this._watchdogTickMs);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  async _recoverFromStall(step, projectId, error, runPromise) {
    this._store.appendEvent({
      projectId,
      level: 'warn',
      message: `[Automation] ${error.message} Shutting down the stalled browser session before retrying.`,
      details: { code: 'STEP_STALLED', stallKind: error.stallKind, step }
    });
    this.emit('notify', {
      type: 'step_stalled',
      level: 'warning',
      projectId,
      project: this._store.getProject(projectId),
      step,
      stepName: step,
      bookIndex: this._currentBookIndex,
      totalBooks: this._totalBooks,
      title: 'Recovering',
      message: `${STEP_LABELS[step] || step} stopped responding. Closing the stuck session and retrying.`
    });
    await this._broadcast().catch(() => {});

    if (typeof this._abortStep === 'function') {
      const abortPromise = Promise.resolve().then(() => this._abortStep(step, projectId, error));
      // Keep a late rejection handled if the timeout wins the race.
      abortPromise.catch(() => {});
      const abortOutcome = await Promise.race([
        abortPromise.then(
          () => ({ settled: true, error: null }),
          (abortError) => ({ settled: true, error: abortError })
        ),
        this._sleep(this._orphanSettleGraceMs).then(() => ({ settled: false, error: null }))
      ]);
      if (!abortOutcome.settled) {
        const abortTimeout = Object.assign(
          new Error(`The frozen "${step}" cleanup did not finish within ${formatDuration(this._orphanSettleGraceMs)}. The step was stopped without retrying to prevent overlapping runs.`),
          { code: 'STEP_ABORT_TIMEOUT', retryable: false, step }
        );
        this._store.appendEvent({
          projectId,
          level: 'error',
          message: `[Automation] ${abortTimeout.message}`,
          details: { code: abortTimeout.code, step }
        });
        throw abortTimeout;
      }
      if (abortOutcome.error) {
        const abortError = abortOutcome.error;
        this._store.appendEvent({
          projectId,
          level: 'error',
          message: `[Automation] Could not cleanly abort the frozen step "${step}": ${abortError.message}`,
          details: { code: 'STEP_ABORT_FAILED' }
        });
      }
    }

    // Bounded wait for the orphaned runner so the retry starts from a clean slate.
    const settled = await Promise.race([
      runPromise.then(() => true, () => true),
      this._sleep(this._orphanSettleGraceMs).then(() => false)
    ]);
    if (!settled) {
      const orphanError = Object.assign(
        new Error(`The frozen "${step}" run did not shut down within ${formatDuration(this._orphanSettleGraceMs)}. The step was stopped without retrying to prevent overlapping runs.`),
        { code: 'STEP_ORPHAN_LINGERING', retryable: false, step }
      );
      this._store.appendEvent({
        projectId,
        level: 'error',
        message: `[Automation] ${orphanError.message}`,
        details: { code: 'STEP_ORPHAN_LINGERING' }
      });
      throw orphanError;
    }
  }

  /**
   * Guards against a runner returning successfully without producing usable output.
   * Verifier failures are surfaced as normal step errors so the retry loop applies.
   */
  async _verifyStepOutput(step, projectId) {
    const verify = this._stepVerifiers?.[step];
    if (typeof verify !== 'function') return;
    await verify(projectId);
  }

  async _ensureCompletedStepStillValid(projectId, step) {
    if (typeof this._stepVerifiers?.[step] !== 'function') return true;
    try {
      await this._verifyStepOutput(step, projectId);
      return true;
    } catch (error) {
      this._store.updateProjectStepStatus(projectId, step, 'pending');
      this._store.appendEvent({
        projectId,
        level: 'warn',
        message: `[Automation] Step "${step}" was marked complete but its output is missing. It will run again. ${error.message}`
      });
      return false;
    }
  }

  _emitProgress(step, stepProgressPercentage) {
    this.emit('progress', {
      currentBookIndex: this._currentBookIndex,
      totalBooks: this._totalBooks,
      activeStep: step,
      stepProgressPercentage,
      currentProjectId: this._currentProjectId
    });
  }

  _onStepProgress(step, percentage) {
    this._emitProgress(step, Math.min(100, Math.max(0, Number(percentage) || 0)));
  }

  _waitForAskDecision() {
    return new Promise((resolve, reject) => {
      this._askResolver = { resolve, reject };
    });
  }

  _waitWhilePaused() {
    if (!this._paused) return Promise.resolve();
    return new Promise((resolve) => this._pauseResolvers.push(resolve));
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = {
  AutomationManager,
  PIPELINE_STEPS, NORMAL_PIPELINE, EDITABLE_PIPELINE, MAZE_PIPELINE, EDITABLE_ONLY_STEPS, MAZE_ONLY_STEPS, getPipelineSteps,
  STEP_DEPENDENCIES, getStepDependencies,
  STEP_TIMEOUTS,
  stepStatusKey,
  readStepStatus
};
