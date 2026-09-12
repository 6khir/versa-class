const { EventEmitter } = require('node:events');
const { existsSync, statSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { parse } = require('node:path');
const { runOperation, waitForRetry } = require('./generation-control.cjs');
const { isPersistedConversationUrl } = require('./browser-controller.cjs');
const { getJobStartUrl, normalizeEngine, withEngineImagePrefix, engineDisplayName, isBrowserEngine, isMetaLocalUrl, conversationMatchesEngine, jobRouteKind } = require('./ai-engine.cjs');
const { resolveStageEngine, getProvider } = require('./ai-provider.cjs');
const { isQuotaError } = require('./account-pool.cjs');
const { resolvePageSetup } = require('./file-manager.cjs');
const { looksLikePageImagePrompt } = require('./prompt-builder.cjs');

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const DEFAULT_PACING_MEMORY_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_PACING_RELAXATION_STEP_MS = 15_000;
const PACING_IDLE_DECAY_INTERVAL_MS = 60 * 60 * 1_000;

class QueueEngine extends EventEmitter {
  constructor({
    store,
    browser,
    fileManager,
    maxAttempts = 5,
    generationTimeoutMs = 1_200_000,
    recoveryTimeoutMs = 600_000,
    retryDelayMs = 4_000,
    retryReloadDelayMs = 1_000,
    batchSize = 5,
    submissionSpacingMs = 3_500,
    submissionJitterMs = 1_000,
    requestCooldownMs = 60_000,
    pacingMemoryMs = DEFAULT_PACING_MEMORY_MS,
    pacingRelaxationStepMs = DEFAULT_PACING_RELAXATION_STEP_MS,
    operationTimeoutMs = 120_000,
    heartbeatMs = 1_000,
    recoveryIdleTimeoutMs = 120_000
  }) {
    super();
    this.store = store;
    this.browser = browser;
    this.fileManager = fileManager;
    this.maxAttempts = maxAttempts;
    this.generationTimeoutMs = generationTimeoutMs;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.retryDelayMs = retryDelayMs;
    this.retryReloadDelayMs = retryReloadDelayMs;
    this.batchSize = Math.max(1, Math.min(5, Number(batchSize) || 5));
    this.baseSubmissionSpacingMs = Math.max(0, Number(submissionSpacingMs) || 0);
    this.submissionJitterMs = Math.max(0, Number(submissionJitterMs) || 0);
    this.requestCooldownMs = Number.isFinite(Number(requestCooldownMs))
      ? Math.max(0, Number(requestCooldownMs))
      : 60_000;
    this.pacingMemoryMs = Number.isFinite(Number(pacingMemoryMs))
      ? Math.max(0, Number(pacingMemoryMs))
      : DEFAULT_PACING_MEMORY_MS;
    this.pacingRelaxationStepMs = Number.isFinite(Number(pacingRelaxationStepMs))
      ? Math.max(0, Number(pacingRelaxationStepMs))
      : DEFAULT_PACING_RELAXATION_STEP_MS;
    this.recoveryIdleTimeoutMs = Number.isFinite(Number(recoveryIdleTimeoutMs))
      ? Math.max(0, Number(recoveryIdleTimeoutMs))
      : 120_000;
    this.currentSubmissionSpacingMs = this.baseSubmissionSpacingMs;
    this.lastSubmissionAt = 0;
    this.lastSubmissionJitterMs = 0;
    this.nextSubmissionAt = 0;
    this.cooldownUntil = 0;
    this.requestCooldownLevel = -1;
    this.submissionGate = Promise.resolve();
    this.running = false;
    this.pauseRequested = false;
    this.activeProjectId = null;
    this.activeJobId = null;
    this.activeJobIds = [];
    this.preloadedJobId = null;
    this.preloadedEngine = null;
    this.preloadPromises = new Map();
    this.boundEngine = null;
    this.engineNeedsBind = true;
    this.runPromise = null;
    this.operationTimeoutMs = operationTimeoutMs;
    this.heartbeatMs = heartbeatMs;
    this.controller = null;
    this.priorityJobs = [];
    this.scope = null;
    this.progress = null;
    this.resumeRequested = false;
    this.browser.on('heartbeat', (payload) => {
      if (this.running && !this.pauseRequested) this.emit('heartbeat', {...payload, jobId:this.activeJobId, projectId:this.activeProjectId});
    });
  }

  status() {
    return {
      running: this.running,
      stopping: this.running && this.pauseRequested,
      resumeRequested: this.resumeRequested,
      progress: this.progress,
      queuedJobIds: [...this.priorityJobs],
      pauseRequested: this.pauseRequested,
      activeProjectId: this.activeProjectId,
      activeJobId: this.activeJobId,
      activeJobIds: this.activeJobIds,
      engine: normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt')),
      preloadedJobId: this.preloadedJobId,
      batchSize: this.batchSize,
      submissionSpacingMs: this.currentSubmissionSpacingMs,
      cooldownUntil: this.cooldownUntil || null,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - Date.now()),
      cooldownLevel: this.requestCooldownLevel
    };
  }

  start(projectId, { jobId = null } = {}) {
    if (this.running) {
      if (this.activeProjectId && this.activeProjectId !== projectId) {
        const current = this.store.getProject(this.activeProjectId);
        throw Object.assign(
          new Error(`"${current?.name || 'Another book'}" is generating.`),
          { code: 'QUEUE_BUSY' }
        );
      }
      if (this.pauseRequested) this.resumeRequested = true;
      else if (!jobId) this.scope = null;
      this.#changed();
      return this.status();
    }
    const project = this.store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    this.controller = new AbortController();
    if (jobId && !project.jobs.some(job => job.id === jobId)) throw Object.assign(new Error("Page not found."), {code:"JOB_NOT_FOUND"});
    this.scope = jobId ? new Set([jobId]) : null;
    this.resumeRequested = false;
    this.running = true;
    this.pauseRequested = false;
    if (typeof this.browser.beginWork === 'function') this.browser.beginWork();
    const engine = normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt'));
    const isFastEngine = engine === 'gemini' || engine === 'meta';
    const savedPacing = this.#loadRequestPacing(projectId);
    this.currentSubmissionSpacingMs = isFastEngine ? 1_500 : savedPacing.spacingMs;
    this.submissionJitterMs = isFastEngine ? 500 : 1_000;
    this.lastSubmissionAt = 0;
    this.lastSubmissionJitterMs = 0;
    this.nextSubmissionAt = 0;
    this.cooldownUntil = isFastEngine ? 0 : savedPacing.cooldownUntil;
    this.requestCooldownLevel = isFastEngine ? -1 : savedPacing.cooldownLevel;
    this.submissionGate = Promise.resolve();
    this.preloadedJobId = null;
    this.preloadedEngine = null;
    this.preloadPromises.clear();
    this.boundEngine = null;
    this.engineNeedsBind = true;
    this.priorityJobs = this.priorityJobs.filter(id => this.store.getJob(id)?.projectId === projectId);
    this.activeProjectId = projectId;
    this.store.updateProject(projectId, { status: 'running' });
    const minimumGap = Math.max(1, Math.round(this.currentSubmissionSpacingMs / 1_000));
    const maximumGap = Math.max(minimumGap, Math.round((this.currentSubmissionSpacingMs + this.submissionJitterMs) / 1_000));
    this.#log({
      projectId,
      message: `Queue started on ${engineDisplayName(engine)}.`
    });
    this.#changed();
    this.runPromise = this.#supervise(projectId).catch((error) => {
      if (error?.code === 'QUEUE_PAUSED') {
        this.store.updateProject(projectId, { status: 'paused' });
        this.#log({ projectId, level: 'warn', message: 'Generation paused safely. Start again when you are ready.' });
        return;
      }
      if (error?.code === 'PROMPT_NOT_READY') {
        this.store.updateProject(projectId, { status: 'paused' });
        this.#log({ projectId, level: 'error', message: error.message, details: { code: error.code } });
        return;
      }
      this.#log({ projectId, level: 'error', message: error.message || 'Generation paused because of an unexpected error.', details: { code: error.code ?? 'UNKNOWN_ERROR' } });
      this.store.updateProject(projectId, { status: 'paused' });
    }).finally(() => {
      const restart = this.resumeRequested;
      const restartScope = this.scope;
      this.running = false;
      this.pauseRequested = false;
      this.resumeRequested = false;
      this.progress = null;
      if (typeof this.browser.endWork === 'function') this.browser.endWork();
      this.activeProjectId = null;
      this.activeJobId = null;
      this.activeJobIds = [];
      this.preloadedJobId = null;
      this.preloadedEngine = null;
      this.preloadPromises.clear();
      this.boundEngine = null;
      this.engineNeedsBind = true;
      this.runPromise = null;
      this.#changed();
      if (restart) this.start(projectId, {jobId:restartScope?.values().next().value || null});
    });
    return this.status();
  }

  pause() {
    this.pauseRequested = true;
    this.resumeRequested = false;
    this.controller?.abort();
    this.browser.cancelWaits();
    for (const id of this.activeJobIds) Promise.resolve(this.browser.abortJob?.(id)).catch(() => {});
    if (this.activeProjectId) {
      this.store.updateProject(this.activeProjectId, { status: 'paused' });
      this.#log({ projectId: this.activeProjectId, jobId: this.activeJobId, level: 'warn', message: 'Generation paused. The current page stopped safely.' });
    }
    this.#changed();
    return this.status();
  }

  /**
   * Requests a normal queue pause and, when requested, waits a bounded amount
   * of time for the current run to release its browser work and become idle.
   * The captured promise belongs to the run that was active when pause began,
   * so a later run can never satisfy this shutdown fence accidentally.
   */
  async pauseAndWait({ timeoutMs = 0 } = {}) {
    const activeRun = this.runPromise;
    this.pause();
    if (!activeRun) return { settled: true, status: this.status() };

    const boundedMs = Math.max(0, Number(timeoutMs) || 0);
    if (!boundedMs) {
      await activeRun;
      return { settled: true, status: this.status() };
    }

    let timeout = null;
    const settled = await Promise.race([
      activeRun.then(() => true, () => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), boundedMs);
      })
    ]);
    if (timeout) clearTimeout(timeout);
    return { settled, status: this.status() };
  }

  #stageSettings() {
    return {
      aiEngine: this.store.getSetting('aiEngine', 'chatgpt'),
      pagesEngine: this.store.getSetting('aiEngine', 'chatgpt'),
      stageProviders: this.store.getSetting('stageProviders', null)
    };
  }

  #stageForJob(job = {}) {
    const route = jobRouteKind({ kind: job.kind || 'page', purpose: job.purpose || 'image' });
    if (route === 'mockups') return 'mockups';
    if (route === 'preview') return 'preview';
    return 'pages';
  }

  #engineForJob(job = null) {
    const stage = job ? this.#stageForJob(job) : 'pages';
    const requested = resolveStageEngine(stage, this.#stageSettings());
    return getProvider(requested).runtimeEngineFor(stage);
  }

  generate(jobId) {
    const job = this.store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), {code:'JOB_NOT_FOUND'});
    if (this.running && this.activeProjectId !== job.projectId) throw Object.assign(new Error('Another book is generating.'), {code:'QUEUE_BUSY'});
    if (this.running && this.pauseRequested) throw Object.assign(new Error('Queue is stopping. Press Start to resume.'), {code:'QUEUE_PAUSED'});
    if (this.running && this.activeJobId === jobId) return this.status();
    this.store.resetJob(jobId);
    this.store.updateJob(jobId, {conversationUrl:null, baselineJson:null});
    if (!this.priorityJobs.includes(jobId)) this.priorityJobs.push(jobId);
    if (this.running) { this.scope?.add(jobId); this.#changed(); return this.status(); }
    return this.start(job.projectId, {jobId});
  }

  retryJob(jobId) {
    const job = this.store.getJob(jobId);
    if (!job) throw Object.assign(new Error('Page not found.'), { code: 'JOB_NOT_FOUND' });
    if (job.status === 'complete') return job;
    const updated = this.store.resetJob(jobId);
    this.store.updateProject(job.projectId, { status: 'paused' });
    this.#log({ projectId: job.projectId, jobId, message: `Page ${job.pageNumber} reset for retry.` });
    this.#changed();
    return updated;
  }

  retryAll(projectId) {
    this.store.resetIncomplete(projectId);
    this.store.updateProject(projectId, { status: 'paused' });
    this.#log({ projectId, message: 'All incomplete pages were reset for retry.' });
    this.#changed();
  }

  notifyEngineChange(engine) {
    const next = normalizeEngine(engine);
    if (typeof this.browser.setEngine === 'function') this.browser.setEngine(next);
    const isFastEngine = next === 'gemini' || next === 'meta';
    this.currentSubmissionSpacingMs = isFastEngine ? 1_500 : this.baseSubmissionSpacingMs;
    this.submissionJitterMs = isFastEngine ? 500 : 1_000;
    if (isFastEngine) {
      this.cooldownUntil = 0;
      this.requestCooldownLevel = -1;
    }
    if (this.boundEngine !== next) {
      this.engineNeedsBind = true;
      this.#dropPreparedWork(this.running && this.activeProjectId
        ? `Image engine switched to ${engineDisplayName(next)}. Remaining pages of this book will generate on ${engineDisplayName(next)}.`
        : null);
    }
    this.boundEngine = next;
    this.#changed();
    return this.status();
  }

  #dropPreparedWork(message = null) {
    this.preloadedJobId = null;
    this.preloadedEngine = null;
    this.preloadPromises.clear();
    if (this.browser?.preparedJobs && typeof this.browser.preparedJobs.clear === 'function') {
      this.browser.preparedJobs.clear();
    }
    if (message && this.activeProjectId) {
      this.#log({ projectId: this.activeProjectId, level: 'info', message });
    }
  }

  async #bindImageEngine({ force = false, job = null } = {}) {
    const engine = this.#engineForJob(job);
    if (typeof this.browser.setEngine === 'function') this.browser.setEngine(engine);
    const changed = force || this.engineNeedsBind || this.boundEngine !== engine;
    if (!changed) return engine;
    if (this.boundEngine && this.boundEngine !== engine) {
      this.#dropPreparedWork(`Image engine switched to ${engineDisplayName(engine)}. The current book keeps going on ${engineDisplayName(engine)}.`);
    } else {
      this.#dropPreparedWork();
    }
    this.boundEngine = engine;
    this.engineNeedsBind = false;
    if (isBrowserEngine(engine)) {
      let launched = false;
      for (let attempt = 0; attempt < 2 && !launched; attempt += 1) {
        try {
          await this.#operation('connecting', () => this.browser.launch({ forceBrowser: false }));
          launched = true;
        } catch (error) {
          const reconnect = error.code === 'BROWSER_PROFILE_IN_USE'
            || error.code === 'BROWSER_RECONNECTING'
            || /already in use|profile lock|still starting/i.test(String(error.message || ''));
          if (!reconnect || attempt === 1) throw error;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
    await this.#operation('checking session', () => this.browser.assertAuthenticated());
    return engine;
  }

  async #supervise(projectId) {
    while (!this.pauseRequested) {
      try { return await this.#run(projectId); }
      catch(error) {
        if (this.pauseRequested || ['QUEUE_PAUSED','AUTH_REQUIRED','PROMPT_NOT_READY','ENOSPC','EACCES'].includes(error.code)) throw error;
        this.engineNeedsBind=true;
        this.#log({projectId,jobId:this.activeJobId,level:'warn',message:`Recovering the queue automatically: ${error.message}`});
        this.browser.cancelWaits();
        await runOperation(()=>this.browser.abortJob?.(this.activeJobId),{timeoutMs:2000,phase:'recover page'}).catch(()=>{});
        if (!this.pauseRequested) this.browser.beginWork?.();
        await waitForRetry(Math.max(1,this.retryDelayMs),this.controller.signal);
      }
    }
  }

  async #run(projectId) {
    await this.#normalizeCompletedPages(projectId);
    try {
    while (!this.pauseRequested) {
      const project = this.store.getProject(projectId);
      this.priorityJobs = this.priorityJobs.filter(id => this.store.getJob(id)?.status !== 'complete');
      const priority = this.priorityJobs.map(id => this.store.getJob(id)).filter(job => job?.projectId === projectId);
      const batch = priority.length ? [priority[0]] : this.store.getNextIncompleteBatch(projectId, this.batchSize).filter(job => !this.scope || this.scope.has(job.id));
      if (!batch.length) {
        if (project.jobs.some(job => job.status !== 'complete')) {
          this.store.updateProject(projectId, {status:'paused'});
          return;
        }
        const { canCompleteProject } = require('./pipeline-watchdog.cjs');
        if (!canCompleteProject(project.jobs, {
          sequenceKey: 'pageNumber',
          statusKey: 'status',
          readyValue: 'complete',
          expectedTotal: project.stats?.total || project.jobs.length
        })) {
          this.store.updateProject(projectId, { status: 'paused' });
          this.#log({
            projectId,
            level: 'warn',
            message: 'The book is not complete. A page is still missing or invalid, so the project stays open.'
          });
          return;
        }
        this.store.updateProject(projectId, { status: 'complete' });
        this.#log({ projectId, level: 'success', message: `Book complete: ${project.stats.total}/${project.stats.total} pages. Next: convert and compress the print PDF in Interior.` });
        this.emit('complete', { projectId });
        this.#changed();
        return;
      }
      // Recover old terminal retry states, but preserve genuine input/authentication blockers.
      const blocked = batch.find(job => job.status === 'needs_user_action' && ['PROMPT_NOT_READY','CHARACTER_REFERENCES_INCOMPLETE','CHARACTER_REFERENCE_MISSING'].includes(job.lastErrorCode));
      if (blocked) {
        this.store.updateProject(projectId, {status:'paused'});
        this.#log({projectId,jobId:blocked.id,level:'warn',message:blocked.lastError || 'Authentication or page input is required.'});
        return;
      }
      const runnable = batch;
      this.activeJobIds = [];
      this.activeJobId = null;
      this.#log({
        projectId,
        message: `Started a protected batch of ${runnable.length} pages: ${runnable.map((job) => job.pageNumber).join(', ')}. The next prompt may be preloaded, but it cannot be submitted until the current page is downloaded and saved.`
      });
      this.#changed();
      let batchOutcome = 'complete';
      for (let index = 0; index < runnable.length; index += 1) {
        const job = runnable[index];
        const nextJob = runnable[index + 1]
          ?? project.jobs.find((candidate) => (
            candidate.pageNumber > job.pageNumber
            && !['complete', 'needs_user_action', 'rate_limit_paused'].includes(candidate.status)
          ))
          ?? null;
        if (this.pauseRequested) {
          batchOutcome = 'pause';
          break;
        }
        this.activeJobIds = [job.id];
        this.activeJobId = job.id;
        this.#changed();
        try {
          await this.#bindImageEngine({ job });
          batchOutcome = await this.#processJob(project, job, nextJob);
        } catch (error) {
          this.engineNeedsBind = true;
          batchOutcome = await this.#handleFailure(project, this.store.getJob(job.id), error);
        } finally {
          await runOperation(() => this.browser.releaseJob(job.id), {timeoutMs:2000,phase:'release page'}).catch(() => {});
        }
        if (batchOutcome === 'complete') {
          this.#log({
            projectId,
            jobId: job.id,
            message: `Page ${job.pageNumber} saved. Generation continues in the background.`
          });
        }
        if (batchOutcome !== 'complete') break;
      }
      this.activeJobIds = [];
      this.activeJobId = null;
      this.#changed();
      if (batchOutcome === 'pause') return;
      if (batchOutcome === 'throttled') {
        try {
          await this.#waitForCooldown(projectId);
        } catch (error) {
          if (error.code === 'QUEUE_PAUSED') return;
          throw error;
        }
      }
    }
    if (this.activeProjectId) this.store.updateProject(this.activeProjectId, { status: 'paused' });
    } catch (error) {
      if (error?.code === 'QUEUE_PAUSED' || this.pauseRequested) {
        this.store.updateProject(projectId, { status: 'paused' });
        return;
      }
      throw error;
    }
  }

  async #processJob(project, initialJob, nextJob = null) {
    let job = this.store.getJob(initialJob.id);
    const engine = await this.#bindImageEngine({ job: initialJob });
    const preloadPromise = this.preloadPromises.get(job.id);
    if (preloadPromise) {
      if (this.preloadedEngine === engine) await preloadPromise.catch(() => {});
      this.preloadPromises.delete(job.id);
    }
    if (job.conversationUrl && isMetaLocalUrl(job.conversationUrl)) {
      job = this.store.updateJob(job.id, { conversationUrl: null, baselineJson: null });
    }
    const imageEngine = this.#engineForJob(job);
    if (job.conversationUrl && !conversationMatchesEngine(job.conversationUrl, imageEngine)) {
      this.#log({
        projectId: project.id,
        jobId: job.id,
        level: 'warn',
        message: `Page ${job.pageNumber} will start on ${engineDisplayName(imageEngine)} instead of a saved conversation from another engine.`
      });
      job = this.store.updateJob(job.id, { conversationUrl: null, baselineJson: null });
      this.#changed();
    }
    if (job.conversationUrl && !isPersistedConversationUrl(job.conversationUrl)) {
      job = this.store.updateJob(job.id, { conversationUrl: null, baselineJson: null });
      this.#log({
        projectId: project.id,
        jobId: job.id,
        level: 'warn',
        message: `Page ${job.pageNumber} had only a temporary conversation link. It will retry normally instead of waiting on an unrecoverable conversation.`
      });
      this.#changed();
    }
    if (job.conversationUrl && job.baseline.length && job.status === 'retry_wait') {
      if (isMetaLocalUrl(job.conversationUrl)) {
        job = this.store.updateJob(job.id, { conversationUrl: null, baselineJson: null });
      } else {
        const recovered = await this.#tryRecovery(project, job);
        if (recovered === 'complete') return 'complete';
        if (recovered === 'pause') return 'pause';
        job = this.store.updateJob(job.id, { baselineJson: null });
      }
    }

    if (this.pauseRequested) return 'pause';
    const attempt = job.attempts + 1;
    this.store.updateJob(job.id, {
      status: 'preparing',
      attempts: attempt,
      lastError: null,
      lastErrorCode: null
    });
    this.#log({
      projectId: project.id,
      jobId: job.id,
      message: `Preparing page ${job.pageNumber}/${project.stats.total} attempt ${attempt}/${this.maxAttempts}.`
    });
    this.#changed();

    try {
      if (attempt > 1) await waitForRetry(this.retryReloadDelayMs, this.controller.signal);
      const engine = normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt'));
      if (typeof this.browser.setEngine === 'function') this.browser.setEngine(engine);


      // Abandoned SVG vectorize left editSourcePath/outputPath on deleted .svg files.
      // That makes Gemini attach fail with REFERENCE_IMAGE_MISSING. Fall back to a fresh generate.
      if (job.editInstruction) {
        const src = job.editSourcePath || job.outputPath || '';
        const srcOk = Boolean(src && existsSync(src) && !/\.svg$/i.test(src));
        if (!srcOk) {
          job = this.store.updateJob(job.id, {
            editInstruction: null,
            editSourcePath: null,
            outputPath: (job.outputPath && existsSync(job.outputPath) && !/\.svg$/i.test(job.outputPath))
              ? job.outputPath
              : null,
            conversationUrl: null,
            status: 'pending',
            lastError: null,
            lastErrorCode: null
          });
          this.#log({
            projectId: project.id,
            jobId: job.id,
            level: 'warn',
            message: `Page ${job.pageNumber}: missing edit. Regenerating.`
          });
        }
      }

      const isFollowUp = Boolean(job.editInstruction);
      const originalPrompt = isFollowUp ? job.editInstruction : (looksLikePageImagePrompt(job.imagePrompt) ? job.imagePrompt : job.prompt);
      if (!isFollowUp && !looksLikePageImagePrompt(originalPrompt)) {
        throw Object.assign(new Error('This page does not have a real image prompt yet. The saved text looks like JSON or commentary, so the gem would reply in text instead of drawing. Generate page prompts again before running the queue.'), {
          code: 'PROMPT_NOT_READY'
        });
      }
      const referencePayload = this.#characterReferencePayload(project, job, originalPrompt, { validatePaths: true });
      const { resolveStoredGenerationMode, applyEditableMasterPrompt, isolateCurrentPagePrompt } = require('./editable-mode.cjs');
      const { applyTextRebuildSourcePrompt, shouldApplyTextRebuildSource } = require('./text-rebuild-source.cjs');
      const { isRebuildPipelineEnabled, ensureRebuildPlan, writeRebuildPage, setPageState, makePageId, readRebuildPage } = require('./rebuild-page-record.cjs');
      const editableRequested = resolveStoredGenerationMode(this.store, project, job) === 'editable';
      const rebuildRequested = isRebuildPipelineEnabled(this.store, project);
      let rebuildRecord = null;
      if (rebuildRequested) {
        ensureRebuildPlan(this.store, project);
        rebuildRecord = readRebuildPage(this.store, project.id, makePageId(project.id, job.id));
        if (rebuildRecord) {
          writeRebuildPage(this.store, setPageState(rebuildRecord, 'GENERATING', {
            generationAttempt: Number(rebuildRecord.generationAttempt || 0) + 1,
          }));
        }
      }
      let submitPrompt = referencePayload.prompt;
      const withPrefix = (value) => (/^@image\b/i.test(value) ? value : `@image ${String(value).replace(/^@image\s*/i, '')}`);
      const isolatedStored = isolateCurrentPagePrompt(String(job.imagePrompt || ''), job.pageNumber);
      if (isolatedStored && isolatedStored.length + 80 < String(job.imagePrompt || '').length) {
        job = this.store.updateJob(job.id, { imagePrompt: withPrefix(isolatedStored) });
      }
      const isolatedSubmit = isolateCurrentPagePrompt(String(submitPrompt || ''), job.pageNumber);
      if (isolatedSubmit) submitPrompt = withPrefix(isolatedSubmit);
      const pageCount = Array.isArray(project?.jobs) ? project.jobs.length : 0;
      const constrained = this.#withPageConstraint(submitPrompt, project, {
        textFree: editableRequested,
        job,
        pageCount,
      });
      const sourceRequested = shouldApplyTextRebuildSource({
        project,
        job,
        textFree: editableRequested,
      });
      const constrainedPrompt = editableRequested
        ? applyEditableMasterPrompt({
          prompt: constrained,
          project,
          job,
          pageCount: pageCount || job.pageNumber,
        })
        : sourceRequested
          ? applyTextRebuildSourcePrompt({
            prompt: constrained,
            project,
            job,
            pageCount: pageCount || job.pageNumber,
            record: rebuildRecord,
          })
          : constrained;
      const prompt = withEngineImagePrefix(constrainedPrompt, engine);
      const attachmentPaths = [...new Set([
        ...referencePayload.attachmentPaths,
        isFollowUp && !job.conversationUrl ? job.editSourcePath : null
      ].filter((filePath) => filePath && existsSync(filePath)))];
      await this.#waitForSubmissionSlot(job);
      const gptUrl = getJobStartUrl(
        { kind: job.kind || 'page', purpose: 'image', productFormat: project?.productFormat },
        engine
      );
      const submission = await this.#operation('submitting', () => this.browser.submitPrompt(prompt, {
        jobId: job.id,
        conversationUrl: job.conversationUrl,
        attachmentPaths,
        gptUrl,
        promptKind: job.kind || 'page'
      }));
      job = this.store.updateJob(job.id, {
        status: 'submitted',
        conversationUrl: submission.conversationUrl,
        baselineJson: submission.baseline
      });
      this.#log({
        projectId: project.id,
        jobId: job.id,
        message: referencePayload.attachmentPaths.length
          ? `Page ${job.pageNumber} submitted to ${engineDisplayName(engine)} with ${referencePayload.attachmentPaths.length} character reference image(s).`
          : `Page ${job.pageNumber} submitted to ${engineDisplayName(engine)}.`
      });
      this.store.updateJob(job.id, { status: 'generating' });
      this.#changed();

      const image = await this.#operation('generating', () => this.browser.waitForNewImage(submission.baseline, this.generationTimeoutMs, { jobId: job.id, idleTimeoutMs:this.recoveryIdleTimeoutMs }), this.generationTimeoutMs);
      return await this.#downloadAndComplete(project, job, image);
    } catch (error) {
      return this.#handleFailure(project, this.store.getJob(job.id), error);
    }
  }

  #startNextPromptPreload() {
    return;
  }

  async #tryRecovery(project, job) {
    this.#log({ projectId: project.id, jobId: job.id, message: `Checking a previous result for page ${job.pageNumber} before resubmitting.` });
    try {
      await this.#operation('recovering conversation', () => this.browser.navigate(job.conversationUrl, { jobId: job.id }));
      this.store.updateJob(job.id, { status: 'generating' });
      this.#changed();
      const image = await this.#operation('recovering image', () => this.browser.waitForNewImage(job.baseline, this.recoveryTimeoutMs, {
        jobId: job.id,
        idleTimeoutMs: this.recoveryIdleTimeoutMs
      }), this.recoveryTimeoutMs);
      return await this.#downloadAndComplete(project, job, image);
    } catch (error) {
      if (['REQUEST_THROTTLED', 'RATE_LIMIT', 'AUTH_REQUIRED', 'META_API_UNAVAILABLE', 'QUEUE_PAUSED'].includes(error.code)) {
        return this.#handleFailure(project, this.store.getJob(job.id), error);
      }
      this.store.updateJob(job.id, { conversationUrl: null });
      this.#log({
        projectId: project.id,
        jobId: job.id,
        level: 'warn',
        message: `No recoverable result was found for page ${job.pageNumber}; the same page will retry in a new conversation.`,
        details: { code: error.code ?? null }
      });
      return 'retry';
    }
  }

  async #downloadAndComplete(project, job, image) {
    this.store.updateJob(job.id, { status: 'downloading' });
    this.#changed();
    const { buffer } = await this.#operation('downloading', () => this.browser.fetchImage(image.src, { jobId: job.id }));
    this.store.updateJob(job.id, { status: 'validating' });
    const file = parse(job.fileName);
    const { resolvePageSaveDir } = require('./project-workspace.cjs');
    const pageDir = resolvePageSaveDir(project) || project.outputDir;
    const saved = await this.#operation('saving', () => this.fileManager.saveGeneratedImage({
      buffer,
      job: {...job,fileName:`${file.name}-${randomUUID()}${file.ext || ".png"}`},
      outputDir: pageDir,
      format: project.format,
      orientation: project.orientation
    }));
    if (this.pauseRequested) return 'pause';
    let outputPath = saved.outputPath;
    const { resolveStoredGenerationMode } = require('./editable-mode.cjs');
    const editableRequested = resolveStoredGenerationMode(this.store, project, job) === 'editable';
    const { attachGeneratedPage } = require('./rebuild-pipeline.cjs');
    attachGeneratedPage(this.store, project, job, outputPath);
    if (editableRequested && outputPath && existsSync(outputPath)) {
      const { assertTextFreeMaster } = require('./text-free-validator.cjs');
      const { loadTemplate, pageTypeForJob, slugTheme } = require('./layout-templates.cjs');
      const { buildManifest, copyFromJob, manifestKey } = require('./editable-manifest.cjs');
      this.store.updateJob(job.id, { status: 'validating' });
      const validated = await assertTextFreeMaster(outputPath, {
        onRetry: (info) => this.#log({
          projectId: project.id,
          jobId: job.id,
          level: 'warn',
          message: `Page ${job.pageNumber} kept after OCR: ${info.leftoverCount || 0} leftover word(s), ${info.chromeCount || 0} layout mark(s) ignored. Not regenerated.`,
          details: info,
        }),
      });
      outputPath = validated.imagePath;
      if (validated.acceptedWithLeftovers) {
        this.#log({
          projectId: project.id,
          jobId: job.id,
          level: 'warn',
          message: `Page ${job.pageNumber} accepted.`,
          details: { leftover: (validated.leftover || []).map((item) => String(item.text || '').slice(0, 80)).slice(0, 8) },
        });
      } else if ((validated.chrome || []).length) {
        this.#log({
          projectId: project.id,
          jobId: job.id,
          message: `Page ${job.pageNumber} passed. ${validated.chrome.length} layout mark(s) ignored (panel numbers / coordinates).`,
        });
      }
      const jobs = project.jobs || [];
      const template = loadTemplate(slugTheme(project.theme), pageTypeForJob(job, jobs.length));
      this.store.setSetting(manifestKey(project.id, job.id), buildManifest({
        pageId: `${project.id}_${job.id}`,
        themeId: slugTheme(project.theme),
        template,
        copyByZone: copyFromJob(job, template) || {},
      }));
    } else if (Array.isArray(job.textOverlays) && job.textOverlays.length && outputPath && existsSync(outputPath)) {
      const { cleanBlankMaster } = require('./text-inpaint-bridge.cjs');
      this.store.updateJob(job.id, { status: 'validating' });
      this.#log({
        projectId: project.id,
        jobId: job.id,
        message: `OCR/LaMa is cleaning baked text on page ${job.pageNumber} before assembly.`
      });
      await cleanBlankMaster(outputPath);
    }
    // Blank template + textOverlays: stamp showcase PNG for Mockup GPT after each blank master saves.
    if (!editableRequested && Array.isArray(job.textOverlays) && job.textOverlays.length && outputPath && existsSync(outputPath)) {
      try {
        const { buildShowcaseForJob } = require('./showcase-builder.cjs');
        const refreshedJob = { ...job, outputPath };
        await buildShowcaseForJob(project, refreshedJob);
      } catch (showcaseError) {
        this.#log({
          projectId: project.id,
          jobId: job.id,
          level: 'warn',
          message: `Showcase stamp deferred for page ${job.pageNumber}: ${showcaseError.message}`
        });
      }
    }
    this.store.updateJob(job.id, {
      status: 'complete',
      attempts: Number(job.attempts || 0),
      outputPath,
      width: saved.width,
      height: saved.height,
      conversationUrl: image.conversationUrl || job.conversationUrl,
      lastError: null,
      lastErrorCode: null,
      baselineJson: null,
      editInstruction: null,
      editSourcePath: null
    });
    this.#log({
      projectId: project.id,
      jobId: job.id,
      level: 'success',
      message: `Page ${job.pageNumber} complete: ${job.fileName}`,
      details: { width: saved.width, height: saved.height }
    });
    this.#relaxRequestPacing(project, job);
    this.#changed();
    return 'complete';
  }

  #relaxRequestPacing(project, job) {
    const engine = normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt'));
    const isFastEngine = engine === 'gemini' || engine === 'meta';
    const baseGap = isFastEngine ? 1_500 : this.baseSubmissionSpacingMs;
    const previousSpacingMs = this.currentSubmissionSpacingMs;
    const nextSpacingMs = Math.max(
      baseGap,
      previousSpacingMs - this.pacingRelaxationStepMs
    );
    this.requestCooldownLevel = -1;
    if (nextSpacingMs === previousSpacingMs) {
      this.#saveRequestPacing();
      return;
    }

    this.currentSubmissionSpacingMs = nextSpacingMs;
    if (this.lastSubmissionAt) {
      this.nextSubmissionAt = Math.min(
        this.nextSubmissionAt,
        this.lastSubmissionAt + nextSpacingMs + this.lastSubmissionJitterMs
      );
    }
    this.#saveRequestPacing();
    const minimumGap = Math.max(1, Math.round(nextSpacingMs / 1_000));
    const maximumGap = Math.max(minimumGap, Math.round((nextSpacingMs + this.submissionJitterMs) / 1_000));
    this.#log({
      projectId: project.id,
      jobId: job.id,
      message: `Pace ${minimumGap} to ${maximumGap}s.`
    });
  }

  #withPageConstraint(prompt, project, { textFree = false, job = null, pageCount = 0 } = {}) {
    const setup = resolvePageSetup(project.format, project.orientation);
    const total = Math.max(1, Number(pageCount) || (Array.isArray(project?.jobs) ? project.jobs.length : 0) || 1);
    const pageNumber = Math.max(1, Number(job?.pageNumber) || 1);
    const role = pageNumber === 1 ? 'front cover' : (pageNumber === total ? 'back cover' : 'interior worksheet');
    // Keep constraints light — heavy "IMAGE ONLY / generate / render" wrappers made the
    // Content Pages Gem reply with text ("I cannot generate or render images…").
    const lines = [
      String(prompt || '').replace(/^@image\s*/i, '').trim(),
      '',
      `This request is page ${pageNumber} of ${total} (${role}). Generate only that page in the product sequence.`,
      'Do not paint the page number, a folio, "page N", or any n-of-n mark on the artwork.',
      pageNumber === 1 ? 'This page is the front cover only. Do not draw an interior worksheet here.' : '',
      pageNumber > 1 && pageNumber < total ? 'This page is an interior worksheet. Do not draw a second cover or listing splash here.' : '',
      pageNumber === total && total > 1 ? 'This page is the back or closing page. Do not draw the front cover here.' : '',
      `Create exactly one ${setup.label} page in ${setup.orientationLabel.toLowerCase()} orientation.`,
      `Use the ${setup.aspectRatioLabel} aspect ratio and compose for a final ${setup.width} × ${setup.height} pixel file at 300 DPI.`,
      textFree
        ? 'Keep all important artwork inside safe margins. Do not add a mockup, border outside the page, a second page, or any page number.'
        : 'Keep all text and important artwork inside safe margins. Do not add a mockup, border outside the page, or a second page.'
    ].filter(Boolean);
    if (project.projectType !== 'storybook') {
      lines.push('Do not ask for or require reference images, attached files, or external references.');
    }
    const assembled = lines.join('\n').trim();
    return assembled.startsWith('@image') ? assembled : `@image ${assembled}`;
  }

  #characterReferencePayload(project, job, prompt, { validatePaths = false } = {}) {
    if (project.projectType !== 'storybook' || typeof this.store.listCompleteCharacters !== 'function') {
      return { prompt, attachmentPaths: [], characterNames: [] };
    }
    const expectedReferences = Array.isArray(project.characterSheets) ? project.characterSheets : [];
    const unavailable = expectedReferences.filter((character) => (
      character.status !== 'complete' || !character.outputPath || !existsSync(character.outputPath)
    ));
    if (validatePaths && (expectedReferences.length === 0 || unavailable.length)) {
      const names = unavailable.map((character) => character.name).filter(Boolean);
      throw Object.assign(new Error(
        expectedReferences.length === 0
          ? 'Generate the Storybook character references before starting page generation.'
          : `Character reference is not ready for ${names.join(', ')}. Complete every character reference before continuing.`
      ), {
        code: 'CHARACTER_REFERENCES_INCOMPLETE',
        characterIds: unavailable.map((character) => character.id).filter(Boolean)
      });
    }
    const references = this.store.listCompleteCharacters(project.id);
    if (!references.length) return { prompt, attachmentPaths: [], characterNames: [] };
    const missing = references.filter((character) => !character.outputPath || !existsSync(character.outputPath));
    if (validatePaths && missing.length) {
      throw Object.assign(new Error(`Character reference file is missing for ${missing.map((character) => character.name).join(', ')}. Regenerate the missing reference before continuing.`), {
        code: 'CHARACTER_REFERENCE_MISSING',
        characterIds: missing.map((character) => character.id)
      });
    }
    const available = references.filter((character) => character.outputPath && existsSync(character.outputPath));
    if (!available.length) return { prompt, attachmentPaths: [], characterNames: [] };
    const pageContext = `${job.storyText || ''}\n${job.imagePrompt || ''}\n${prompt}`.toLocaleLowerCase('en-US');
    const mentioned = available.filter((character) => pageContext.includes(String(character.name).toLocaleLowerCase('en-US')));
    const names = available.map((character) => character.name);
    const nameList = names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
    const relevantNames = mentioned.map((character) => character.name);
    const relevanceInstruction = relevantNames.length && relevantNames.length < names.length
      ? ` The scene specifically uses ${relevantNames.join(', ')}; keep the other attached references available for continuity but do not add characters that the scene does not request.`
      : '';
    const instruction = `Refer to ALL ATTACHED character reference images to ensure 100% character visual consistency for ${nameList} throughout this storybook.${relevanceInstruction}`;
    return {
      prompt: `${instruction}\n\n${prompt}`,
      attachmentPaths: available.map((character) => character.outputPath),
      characterNames: names
    };
  }

  async #normalizeCompletedPages(projectId) {
    const project = this.store.getProject(projectId);
    if (!project) return;
    for (const job of project.jobs) {
      if (job.status === 'complete' && (!job.outputPath || !existsSync(job.outputPath) || statSync(job.outputPath).size === 0)) {
        this.store.resetJob(job.id);
        this.store.updateJob(job.id, {outputPath:null,conversationUrl:null,baselineJson:null});
      }
    }
    const setup = resolvePageSetup(project.format, project.orientation);
    const mismatched = project.jobs.filter((job) => (
      job.status === 'complete' &&
      job.outputPath && existsSync(job.outputPath) &&
      (job.width !== setup.width || job.height !== setup.height)
    ));
    if (!mismatched.length) return;
    this.#log({
      projectId,
      message: `Normalizing ${mismatched.length} completed ${mismatched.length === 1 ? 'page' : 'pages'} to ${setup.label} ${setup.orientationLabel} at 300 DPI.`
    });
    for (const job of mismatched) {
      try {
        const { resolvePageSaveDir } = require('./project-workspace.cjs');
        const saved = await this.#operation('checking saved image', () => this.fileManager.importImage({
          sourcePath: job.outputPath,
          job,
          outputDir: resolvePageSaveDir(project) || project.outputDir,
          format: project.format,
          orientation: project.orientation
        }));
        this.store.updateJob(job.id, { width: saved.width, height: saved.height });
      } catch (error) {
        this.#log({
          projectId,
          jobId: job.id,
          level: 'warn',
          message: `Page ${job.pageNumber} could not be normalized: ${error.message}`,
          details: { code: error.code ?? 'NORMALIZE_FAILED' }
        });
      }
    }
    this.#changed();
  }

  async #waitForSubmissionSlot(job) {
    const scheduled = this.submissionGate.then(async () => {
      while (true) {
        if (this.pauseRequested) {
          throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED', beforeSubmission: true });
        }
        if (this.cooldownUntil) {
          await this.#waitForCooldown(job.projectId, job.id);
          continue;
        }
        const now = Date.now();
        const target = this.nextSubmissionAt;
        if (target <= now) break;
        const remainingMs = target - now;
        this.emit('heartbeat', { elapsedMs: 0, remainingMs, phase: 'submission_pacing', jobId: job.id });
        await sleep(Math.min(1_000, remainingMs));
      }
      const jitter = this.submissionJitterMs ? Math.floor(Math.random() * (this.submissionJitterMs + 1)) : 0;
      this.lastSubmissionAt = Date.now();
      this.lastSubmissionJitterMs = jitter;
      this.nextSubmissionAt = this.lastSubmissionAt + this.currentSubmissionSpacingMs + jitter;
      this.#changed();
    });
    this.submissionGate = scheduled.catch(() => {});
    return scheduled;
  }

  async #waitForCooldown(projectId, jobId = this.activeJobId) {
    while (this.cooldownUntil) {
      while (Date.now() < this.cooldownUntil) {
        if (this.pauseRequested) throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
        const remainingMs = this.cooldownUntil - Date.now();
        this.emit('heartbeat', { elapsedMs: 0, remainingMs, phase: 'request_cooldown', jobId });
        await sleep(Math.min(1_000, remainingMs));
      }
      if (this.pauseRequested) throw Object.assign(new Error('Waiting was paused.'), { code: 'QUEUE_PAUSED' });
      this.emit('heartbeat', { elapsedMs: 0, remainingMs: 0, phase: 'request_check', jobId });
      const access = typeof this.browser.checkRequestAccess === 'function'
        ? await this.#operation('checking cooldown', () => this.browser.checkRequestAccess())
        : { available: true, code: null };
      if (access.available) {
        this.cooldownUntil = 0;
        this.requestCooldownLevel = -1;
        this.#saveRequestPacing();
        this.#log({ projectId, message: 'ChatGPT safety check passed. The same queued pages will resume automatically.' });
        this.#changed();
        return;
      }
      if (access.code === 'AUTH_REQUIRED') {
        throw Object.assign(new Error(access.message), { code: access.code });
      }
      this.requestCooldownLevel = Math.min(2, this.requestCooldownLevel + 1);
      const nextCooldownMs = this.#cooldownDurationForLevel(this.requestCooldownLevel);
      this.cooldownUntil = Date.now() + nextCooldownMs;
      this.#saveRequestPacing();
      const minutes = Math.ceil(nextCooldownMs / 60_000);
      this.#log({
        projectId,
        jobId,
        level: 'warn',
        message: `ChatGPT safety check shows the restriction is still active. The next check will run in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
        details: { code: access.code ?? 'REQUEST_THROTTLED', cooldownMs: nextCooldownMs, cooldownLevel: this.requestCooldownLevel }
      });
      this.#changed();
    }
  }

  #cooldownDurationForLevel(level) {
    return this.requestCooldownMs * [1, 2, 5][Math.max(0, Math.min(2, level))];
  }

  #loadRequestPacing(projectId) {
    const now = Date.now();
    const saved = this.store.getSetting('chatgptRequestPacing', null);
    const savedAt = Number(saved?.updatedAt) || 0;
    if (savedAt && now - savedAt < this.pacingMemoryMs) {
      const legacyPacing = !Number.isInteger(saved.cooldownLevel);
      const savedUntil = Math.max(0, Number(saved.cooldownUntil) || 0);
      const activeCooldown = savedUntil > now;
      const savedSpacingMs = Math.max(
        this.baseSubmissionSpacingMs,
        Math.min(120_000, Number(saved.spacingMs) || 0)
      );
      const idleDecaySteps = activeCooldown
        ? 0
        : Math.floor((now - savedAt) / PACING_IDLE_DECAY_INTERVAL_MS);
      return {
        spacingMs: Math.max(
          this.baseSubmissionSpacingMs,
          savedSpacingMs - idleDecaySteps * this.pacingRelaxationStepMs
        ),
        cooldownUntil: activeCooldown
          ? (legacyPacing ? Math.min(savedUntil, now + this.requestCooldownMs) : savedUntil)
          : 0,
        cooldownLevel: activeCooldown && !legacyPacing
          ? Math.max(-1, Math.min(2, Number(saved.cooldownLevel)))
          : -1
      };
    }
    const recentThrottle = this.store.listEvents(projectId, 50).find((event) => event.details?.code === 'REQUEST_THROTTLED');
    if (recentThrottle) {
      const occurredAt = Date.parse(recentThrottle.createdAt) || 0;
      const hasProgressiveLevel = Number.isInteger(recentThrottle.details?.cooldownLevel);
      const inferredDuration = hasProgressiveLevel
        ? (Number(recentThrottle.details?.cooldownMs) || this.requestCooldownMs)
        : this.requestCooldownMs;
      const inferredUntil = occurredAt + inferredDuration;
      if (now - occurredAt < this.pacingMemoryMs) {
        const activeCooldown = now < inferredUntil;
        const recordedSpacingMs = Math.max(
          this.baseSubmissionSpacingMs,
          Math.min(120_000, Number(recentThrottle.details?.submissionSpacingMs) || 0)
        );
        const idleDecaySteps = activeCooldown
          ? 0
          : Math.floor((now - occurredAt) / PACING_IDLE_DECAY_INTERVAL_MS);
        return {
          spacingMs: Math.max(
            this.baseSubmissionSpacingMs,
            recordedSpacingMs - idleDecaySteps * this.pacingRelaxationStepMs
          ),
          cooldownUntil: activeCooldown ? inferredUntil : 0,
          cooldownLevel: activeCooldown && hasProgressiveLevel
            ? Math.max(-1, Math.min(2, Number(recentThrottle.details.cooldownLevel)))
            : -1
        };
      }
    }
    return { spacingMs: this.baseSubmissionSpacingMs, cooldownUntil: 0, cooldownLevel: -1 };
  }

  #saveRequestPacing() {
    this.store.setSetting('chatgptRequestPacing', {
      spacingMs: this.currentSubmissionSpacingMs,
      cooldownUntil: this.cooldownUntil,
      cooldownLevel: this.requestCooldownLevel,
      updatedAt: Date.now()
    });
  }

  async #handleFailure(project, job, error) {
    const code = error.code ?? 'UNKNOWN_ERROR';
    if (['PROMPT_NOT_READY','CHARACTER_REFERENCES_INCOMPLETE','CHARACTER_REFERENCE_MISSING'].includes(code)) {
      this.store.updateJob(job.id, { status: 'needs_user_action', lastError: error.message, lastErrorCode: code });
      this.store.updateProject(project.id, { status: 'paused' });
      this.#log({ projectId: project.id, jobId: job.id, level: 'error', message: error.message, details: { code } });
      this.#changed();
      return 'pause';
    }
    if (code === 'QUEUE_PAUSED' || this.pauseRequested) {
      this.store.updateJob(job.id, {
        status: 'retry_wait',
        attempts: error.beforeSubmission ? Math.max(0, job.attempts - 1) : job.attempts,
        lastError: error.message,
        lastErrorCode: code
      });
      this.#changed();
      return 'pause';
    }
    if (code === 'REQUEST_THROTTLED') return this.#registerRequestThrottle(project, job, error);
    if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED' || isQuotaError(error)) {
      if (typeof this.browser.canSwapProfile === 'function' && this.browser.canSwapProfile()) {
        this.#log({
          projectId: project.id,
          jobId: job.id,
          level: 'warn',
          message: `Account usage limit reached on the current profile. Swapping to the next saved account and resuming page ${job.pageNumber}...`
        });
        try {
          const swapResult = await this.#operation('reconnecting session', () => this.browser.switchToNextProfile());
          if (swapResult?.swapped) {
            this.#log({
              projectId: project.id,
              jobId: job.id,
              level: 'info',
              message: `Swapped to profile "${swapResult.profileName}". Resuming page ${job.pageNumber}...`
            });
            this.store.updateJob(job.id, {
              status: 'retry_wait',
              attempts: job.attempts,
              conversationUrl: null,
              lastError: null,
              lastErrorCode: null
            });
            this.#changed();
            return 'retry';
          }
        } catch (swapError) {
          this.#log({
            projectId: project.id,
            jobId: job.id,
            level: 'warn',
            message: `Profile swap failed (${swapError.message}). Pausing queue.`
          });
        }
      }
      return this.#registerRequestThrottle(project, job, error);
    }
    if (code === 'AUTH_REQUIRED' || code === 'META_API_UNAVAILABLE') {
      this.store.updateJob(job.id, { status: 'needs_user_action', lastError: error.message, lastErrorCode: code });
      this.store.updateProject(project.id, { status: 'paused' });
      this.#log({ projectId: project.id, jobId: job.id, level: 'warn', message: error.message });
      this.emit('auth-required');
      this.#changed();
      return 'pause';
    }
    if (code === 'TEXT_INPAINT_DEPS_MISSING' || code === 'LAMA_REQUIRED' || code === 'PADDLE_OCR_MISSING' || code === 'TEXT_INPAINT_RESIDUAL') {
      this.store.updateJob(job.id, { status: 'needs_user_action', lastError: error.message, lastErrorCode: code });
      this.store.updateProject(project.id, { status: 'paused' });
      this.#log({ projectId: project.id, jobId: job.id, level: 'error', message: error.message, details: { code } });
      this.#changed();
      return 'pause';
    }
    if (job.attempts >= this.maxAttempts) {
      this.#log({projectId:project.id,jobId:job.id,level:'warn',message:`Recovering page ${job.pageNumber} automatically after ${job.attempts} attempts.`,details:{code}});
      this.engineNeedsBind = true;
    }
    if (['GENERATION_STUCK','BROWSER_CONTEXT_CLOSED','BROWSER_RECONNECTING'].includes(code) || /closed|disconnected|crash/i.test(error.message || '')) {
      this.engineNeedsBind = true;
      this.browser.cancelWaits();
      await runOperation(() => this.browser.abortJob?.(job.id), {timeoutMs:2000,phase:'recover browser page'}).catch(() => {});
      if (!this.pauseRequested) this.browser.beginWork?.();
    }
    this.store.updateJob(job.id, { status: 'retry_wait', conversationUrl: null, lastError: error.message, lastErrorCode: code });
    this.#log({
      projectId: project.id,
      jobId: job.id,
      level: 'warn',
      message: `Page ${job.pageNumber} attempt failed: ${error.message} The same page will retry in a fresh conversation.`,
      details: { code, attempt: job.attempts }
    });
    this.#changed();
    const delay = Math.min(60_000, this.retryDelayMs * Math.max(1, job.attempts));
    const deadline = Date.now() + delay;
    while (!this.pauseRequested && Date.now() < deadline) await sleep(Math.min(500, deadline - Date.now()));
    return this.pauseRequested ? 'pause' : 'retry';
  }

  #registerRequestThrottle(project, job, error, { attemptConsumed = true, duringPreload = false } = {}) {
    const code = 'REQUEST_THROTTLED';
    this.requestCooldownLevel = Math.min(2, this.requestCooldownLevel + 1);
    const cooldownMs = Math.max(this.#cooldownDurationForLevel(this.requestCooldownLevel), Number(error.cooldownMs) || 0);
    const previousCooldown = this.cooldownUntil;
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + cooldownMs);
    this.currentSubmissionSpacingMs = Math.min(
      120_000,
      Math.max(this.baseSubmissionSpacingMs, Math.round(this.currentSubmissionSpacingMs * 1.75))
    );
    this.lastSubmissionJitterMs = 0;
    this.#saveRequestPacing();
    if (attemptConsumed) {
      this.store.updateJob(job.id, {
        status: 'retry_wait',
        attempts: Math.max(0, job.attempts - 1),
        lastError: error.message,
        lastErrorCode: code
      });
    }
    if (this.cooldownUntil > previousCooldown) {
      const minutes = Math.ceil(cooldownMs / 60_000);
      this.#log({
        projectId: project.id,
        jobId: job.id,
        level: 'warn',
        message: duringPreload
          ? `ChatGPT limited preparation of the next conversation. Page ${job.pageNumber} was not submitted and no attempt was consumed; an automatic ${minutes}-minute safety cooldown started.`
          : `ChatGPT temporarily limited rapid requests. Automatic ${minutes}-minute safety cooldown started; page ${job.pageNumber} will retry in the same slot.`,
        details: {
          code,
          cooldownMs,
          cooldownLevel: this.requestCooldownLevel,
          submissionSpacingMs: this.currentSubmissionSpacingMs,
          duringPreload
        }
      });
    }
    this.#changed();
    return 'throttled';
  }

  async #operation(phase, work, timeoutMs = this.operationTimeoutMs) {
    const startedAt = Date.now();
    const tick = () => {
      this.progress = {projectId:this.activeProjectId,jobId:this.activeJobId,phase,elapsedMs:Date.now()-startedAt,timeoutMs};
      this.emit('heartbeat',this.progress);
    };
    tick();
    const timer = setInterval(tick,this.heartbeatMs);
    try { return await runOperation(work,{signal:this.controller?.signal,timeoutMs,phase,onTimeout:()=>this.browser.cancelWaits()}); }
    finally { clearInterval(timer); }
  }

  #log(event) {
    this.store.appendEvent(event);
    this.emit('log', event);
  }

  #changed() {
    this.emit('changed', this.status());
  }
}

module.exports = { QueueEngine, sleep };
