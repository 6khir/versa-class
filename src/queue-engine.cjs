const { EventEmitter } = require('node:events');
const { existsSync, appendFileSync } = require('node:fs');
const { isPersistedConversationUrl } = require('./browser-controller.cjs');
const { getJobStartUrl, normalizeEngine, withEngineImagePrefix, engineDisplayName, isBrowserEngine, isMetaLocalUrl, conversationMatchesEngine } = require('./ai-engine.cjs');
const { resolvePageSetup } = require('./file-manager.cjs');
const { looksLikePageImagePrompt } = require('./prompt-builder.cjs');

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function debugGeminiHp(hypothesisId, location, message, data = {}) {
  // #region agent log
  const payload = {
    sessionId: '033a04',
    runId: data.runId || 'pre-fix',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now()
  };
  fetch('http://127.0.0.1:7583/ingest/41197195-aa7b-4904-9334-2c659b1953d0', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '033a04' },
    body: JSON.stringify(payload)
  }).catch(() => {});
  try {
    appendFileSync('/Users/abdelmouiz/Downloads/VERSA TPT BOT/.cursor/debug-033a04.log', `${JSON.stringify(payload)}\n`);
  } catch {}
  // #endregion
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
    this.browser.on('heartbeat', (payload) => this.emit('heartbeat', payload));
  }

  status() {
    return {
      running: this.running,
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

  start(projectId) {
    if (this.running) {
      if (this.activeProjectId && this.activeProjectId !== projectId) {
        const current = this.store.getProject(this.activeProjectId);
        throw Object.assign(
          new Error(`"${current?.name || 'Another book'}" is still generating. Pause it first, or keep browsing other projects — generation continues in the background.`),
          { code: 'QUEUE_BUSY' }
        );
      }
      return this.status();
    }
    const project = this.store.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
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
    this.activeProjectId = projectId;
    this.store.updateProject(projectId, { status: 'running' });
    const minimumGap = Math.max(1, Math.round(this.currentSubmissionSpacingMs / 1_000));
    const maximumGap = Math.max(minimumGap, Math.round((this.currentSubmissionSpacingMs + this.submissionJitterMs) / 1_000));
    this.#log({
      projectId,
      message: `Book generation queue started on ${engineDisplayName(engine)}. Five-page batches run with a safe ${minimumGap}–${maximumGap}s submission pace.`
    });
    this.#changed();
    this.runPromise = this.#run(projectId).catch((error) => {
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
      this.running = false;
      this.pauseRequested = false;
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
    });
    return this.status();
  }

  pause() {
    this.pauseRequested = true;
    this.browser.cancelWaits();
    if (this.activeProjectId) {
      this.store.updateProject(this.activeProjectId, { status: 'paused' });
      this.#log({ projectId: this.activeProjectId, jobId: this.activeJobId, level: 'warn', message: 'Generation paused. The current page stopped safely.' });
    }
    this.#changed();
    return this.status();
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

  async #bindImageEngine({ force = false } = {}) {
    const engine = normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt'));
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
          await this.browser.launch({ forceBrowser: false });
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
    await this.browser.assertAuthenticated();
    return engine;
  }

  async #run(projectId) {
    await this.#normalizeCompletedPages(projectId);
    try {
      await this.#bindImageEngine({ force: true });
    } catch (error) {
      if (error?.code === 'QUEUE_PAUSED' || this.pauseRequested) {
        this.store.updateProject(projectId, { status: 'paused' });
        this.#changed();
        return;
      }
      this.store.updateProject(projectId, { status: 'paused' });
      this.#log({
        projectId,
        level: (error.code === 'AUTH_REQUIRED' || error.code === 'META_API_UNAVAILABLE') ? 'warn' : 'error',
        message: error.message,
        details: { code: error.code ?? 'ENGINE_START_FAILED' }
      });
      if (error.code === 'AUTH_REQUIRED' || error.code === 'META_API_UNAVAILABLE') this.emit('auth-required');
      this.#changed();
      return;
    }
    try {
    while (!this.pauseRequested) {
      const project = this.store.getProject(projectId);
      const batch = this.store.getNextIncompleteBatch(projectId, this.batchSize);
      if (!batch.length) {
        this.store.updateProject(projectId, { status: 'complete' });
        this.#log({ projectId, level: 'success', message: `Book complete: ${project.stats.total}/${project.stats.total} pages. Next: convert and compress the print PDF in Interior.` });
        this.emit('complete', { projectId });
        this.#changed();
        return;
      }
      const runnable = batch.filter((job) => !['needs_user_action', 'rate_limit_paused'].includes(job.status));
      if (!runnable.length) {
        const blocked = batch[0];
        this.store.updateProject(projectId, { status: blocked.status === 'rate_limit_paused' ? 'rate_limit_paused' : 'paused' });
        this.#log({ projectId, jobId: blocked.id, level: 'warn', message: `Queue paused at page ${blocked.pageNumber}; user action is required.` });
        this.#changed();
        return;
      }
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
          await this.#bindImageEngine();
          batchOutcome = await this.#processJob(project, job, nextJob);
        } catch (error) {
          if (error.code === 'AUTH_REQUIRED' || error.code === 'META_API_UNAVAILABLE') {
            this.store.updateProject(projectId, { status: 'paused' });
            this.#log({ projectId, jobId: job.id, level: 'warn', message: error.message, details: { code: error.code } });
            this.emit('auth-required');
            batchOutcome = 'pause';
          } else {
            throw error;
          }
        } finally {
          await this.browser.releaseJob(job.id);
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
      this.store.updateProject(projectId, { status: 'paused' });
      this.#log({
        projectId,
        level: 'error',
        message: error.message || 'Generation paused because of an unexpected error.',
        details: { code: error.code ?? 'UNKNOWN_ERROR' }
      });
      this.#changed();
    }
  }

  async #processJob(project, initialJob, nextJob = null) {
    let job = this.store.getJob(initialJob.id);
    const engine = await this.#bindImageEngine();
    const preloadPromise = this.preloadPromises.get(job.id);
    if (preloadPromise) {
      if (this.preloadedEngine === engine) await preloadPromise.catch(() => {});
      this.preloadPromises.delete(job.id);
    }
    if (job.conversationUrl && isMetaLocalUrl(job.conversationUrl)) {
      job = this.store.updateJob(job.id, { conversationUrl: null, baselineJson: null });
    }
    const imageEngine = normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt'));
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
      message: `Preparing page ${job.pageNumber}/${project.stats.total} — attempt ${attempt}/${this.maxAttempts}.`
    });
    this.#changed();

    try {
      if (attempt > 1) await sleep(this.retryReloadDelayMs);
      const engine = normalizeEngine(this.store.getSetting('aiEngine', 'chatgpt'));
      if (typeof this.browser.setEngine === 'function') this.browser.setEngine(engine);

      // #region agent log
      try {
        require('node:fs').appendFileSync(
          '/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log',
          `${JSON.stringify({
            sessionId: '2f6f56',
            runId: 'fix-svg-ref',
            hypothesisId: 'A',
            location: 'queue-engine.cjs:#processJob',
            message: 'before edit-ref repair',
            data: {
              pageNumber: job.pageNumber,
              hasEdit: Boolean(job.editInstruction),
              editSourcePath: job.editSourcePath || null,
              outputPath: job.outputPath || null,
              editSourceExists: Boolean(job.editSourcePath && existsSync(job.editSourcePath)),
              outputExists: Boolean(job.outputPath && existsSync(job.outputPath)),
              conversationUrl: Boolean(job.conversationUrl)
            },
            timestamp: Date.now()
          })}\n`
        );
      } catch {}
      // #endregion

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
            message: `Page ${job.pageNumber}: missing edit reference (often a deleted .svg). Switching to a fresh Gemini generate — login profiles untouched.`
          });
          // #region agent log
          try {
            require('node:fs').appendFileSync(
              '/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/.cursor/debug-2f6f56.log',
              `${JSON.stringify({
                sessionId: '2f6f56',
                runId: 'fix-svg-ref',
                hypothesisId: 'A',
                location: 'queue-engine.cjs:#processJob',
                message: 'cleared dead svg edit ref → fresh generate',
                data: { pageNumber: job.pageNumber, clearedSrc: src },
                timestamp: Date.now()
              })}\n`
            );
          } catch {}
          // #endregion
        }
      }

      const isFollowUp = Boolean(job.editInstruction);
      const originalPrompt = isFollowUp ? job.editInstruction : job.prompt;
      if (!isFollowUp && !looksLikePageImagePrompt(originalPrompt)) {
        throw Object.assign(new Error('This page does not have a real image prompt yet. The saved text looks like JSON or commentary, so the gem would reply in text instead of drawing. Generate page prompts again before running the queue.'), {
          code: 'PROMPT_NOT_READY'
        });
      }
      const referencePayload = this.#characterReferencePayload(project, job, originalPrompt, { validatePaths: true });
      const constrained = this.#withPageConstraint(referencePayload.prompt, project);
      const prompt = withEngineImagePrefix(constrained, engine);
      const attachmentPaths = [...new Set([
        ...referencePayload.attachmentPaths,
        isFollowUp && !job.conversationUrl ? job.editSourcePath : null
      ].filter((filePath) => filePath && existsSync(filePath)))];
      await this.#waitForSubmissionSlot(job);
      const gptUrl = getJobStartUrl({ kind: job.kind || 'page', purpose: 'image' }, engine);
      // #region agent log
      debugGeminiHp('D', 'queue-engine.cjs:#processJob', 'assembled page prompt before submit', {
        pageNumber: job.pageNumber,
        jobId: String(job.id || '').slice(0, 12),
        engine,
        kind: job.kind || 'page',
        gptUrl: String(gptUrl || '').slice(0, 160),
        conversationUrl: String(job.conversationUrl || '').slice(0, 160),
        hasImageCreator: /mode=image_creator/i.test(String(gptUrl || '')),
        originalHead: String(originalPrompt || '').slice(0, 160),
        constrainedHead: String(constrained || '').slice(0, 220),
        promptHead: String(prompt || '').slice(0, 220),
        hasGenerate: /\bgenerate\b/i.test(prompt),
        hasRender: /\brender\b/i.test(prompt),
        hasEditable: /\beditable\b/i.test(prompt),
        hasImageOnly: /IMAGE ONLY/i.test(prompt),
        hasCreateExactly: /Create exactly one/i.test(prompt),
        promptHasAtImage: /^@image\b/i.test(String(prompt || '').trim()),
        productFormat: project.productFormat || null
      });
      // #endregion
      const submission = await this.browser.submitPrompt(prompt, {
        jobId: job.id,
        conversationUrl: job.conversationUrl,
        attachmentPaths,
        gptUrl,
        promptKind: job.kind || 'page'
      });
      // #region agent log
      debugGeminiHp('B', 'queue-engine.cjs:#processJob', 'submitted to gemini/chatgpt', {
        pageNumber: job.pageNumber,
        submissionUrl: String(submission?.conversationUrl || '').slice(0, 160)
      });
      // #endregion
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

      const image = await this.browser.waitForNewImage(submission.baseline, this.generationTimeoutMs, { jobId: job.id });
      return await this.#downloadAndComplete(project, job, image);
    } catch (error) {
      // #region agent log
      debugGeminiHp('A', 'queue-engine.cjs:#processJob', 'page generation failed', {
        pageNumber: job?.pageNumber,
        code: error?.code || null,
        errHead: String(error?.message || '').slice(0, 240),
        conversationUrl: String(this.store.getJob(job.id)?.conversationUrl || '').slice(0, 160)
      });
      // #endregion
      return this.#handleFailure(project, this.store.getJob(job.id), error);
    }
  }

  #startNextPromptPreload() {
    return;
  }

  async #tryRecovery(project, job) {
    this.#log({ projectId: project.id, jobId: job.id, message: `Checking a previous result for page ${job.pageNumber} before resubmitting.` });
    try {
      await this.browser.navigate(job.conversationUrl, { jobId: job.id });
      this.store.updateJob(job.id, { status: 'generating' });
      this.#changed();
      const image = await this.browser.waitForNewImage(job.baseline, this.recoveryTimeoutMs, {
        jobId: job.id,
        idleTimeoutMs: this.recoveryIdleTimeoutMs
      });
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
    const { buffer } = await this.browser.fetchImage(image.src, { jobId: job.id });
    this.store.updateJob(job.id, { status: 'validating' });
    const saved = await this.fileManager.saveGeneratedImage({
      buffer,
      job,
      outputDir: project.outputDir,
      format: project.format,
      orientation: project.orientation
    });
    let outputPath = saved.outputPath;
    // Blank template + textOverlays: stamp showcase PNG for Mockup GPT after each blank master saves.
    if (Array.isArray(job.textOverlays) && job.textOverlays.length && outputPath && existsSync(outputPath)) {
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
      attempts: Number(job.attempts || 0) + 1,
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
      message: `Safe sending pace relaxed to ${minimumGap}–${maximumGap}s after a successful page.`
    });
  }

  #withPageConstraint(prompt, project) {
    const setup = resolvePageSetup(project.format, project.orientation);
    // Keep constraints light — heavy "IMAGE ONLY / generate / render" wrappers made the
    // Content Pages Gem reply with text ("I cannot generate or render images…").
    const lines = [
      String(prompt || '').replace(/^@image\s*/i, '').trim(),
      '',
      `Create exactly one ${setup.label} page in ${setup.orientationLabel.toLowerCase()} orientation.`,
      `Use the ${setup.aspectRatioLabel} aspect ratio and compose for a final ${setup.width} × ${setup.height} pixel file at 300 DPI.`,
      'Keep all text and important artwork inside safe margins. Do not add a mockup, border outside the page, or a second page.'
    ];
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
    const setup = resolvePageSetup(project.format, project.orientation);
    const mismatched = project.jobs.filter((job) => (
      job.status === 'complete' &&
      job.outputPath &&
      (job.width !== setup.width || job.height !== setup.height)
    ));
    if (!mismatched.length) return;
    this.#log({
      projectId,
      message: `Normalizing ${mismatched.length} completed ${mismatched.length === 1 ? 'page' : 'pages'} to ${setup.label} ${setup.orientationLabel} at 300 DPI.`
    });
    for (const job of mismatched) {
      try {
        const saved = await this.fileManager.importImage({
          sourcePath: job.outputPath,
          job,
          outputDir: project.outputDir,
          format: project.format,
          orientation: project.orientation
        });
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
        ? await this.browser.checkRequestAccess()
        : { available: true, code: null };
      if (access.available) {
        this.cooldownUntil = 0;
        this.requestCooldownLevel = -1;
        this.#saveRequestPacing();
        this.#log({ projectId, message: 'ChatGPT safety check passed. The same queued pages will resume automatically.' });
        this.#changed();
        return;
      }
      if (access.code === 'AUTH_REQUIRED' || access.code === 'RATE_LIMIT') {
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
    if (code === 'PROMPT_NOT_READY') {
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
    if (code === 'RATE_LIMIT') {
      if (typeof this.browser.canSwapProfile === 'function' && this.browser.canSwapProfile()) {
        this.#log({
          projectId: project.id,
          jobId: job.id,
          level: 'warn',
          message: `Account usage limit reached on current profile. Swapping to next Google Chrome profile to resume queue...`
        });
        try {
          const swapResult = await this.browser.switchToNextProfile();
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
      this.store.updateJob(job.id, { status: 'rate_limit_paused', lastError: error.message, lastErrorCode: code });
      this.store.updateProject(project.id, { status: 'rate_limit_paused' });
      this.#log({ projectId: project.id, jobId: job.id, level: 'warn', message: error.message });
      this.#changed();
      return 'pause';
    }
    if (code === 'AUTH_REQUIRED' || code === 'META_API_UNAVAILABLE') {
      this.store.updateJob(job.id, { status: 'needs_user_action', lastError: error.message, lastErrorCode: code });
      this.store.updateProject(project.id, { status: 'paused' });
      this.#log({ projectId: project.id, jobId: job.id, level: 'warn', message: error.message });
      this.emit('auth-required');
      this.#changed();
      return 'pause';
    }
    if (job.attempts >= this.maxAttempts) {
      this.store.updateJob(job.id, { status: 'needs_user_action', lastError: error.message, lastErrorCode: code });
      this.store.updateProject(project.id, { status: 'paused' });
      this.#log({
        projectId: project.id,
        jobId: job.id,
        level: 'error',
        message: `Book paused at page ${job.pageNumber} after ${job.attempts} attempts. The page was not skipped.`,
        details: { code, error: error.message }
      });
      this.#changed();
      return 'pause';
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
    const cooldownMs = this.#cooldownDurationForLevel(this.requestCooldownLevel);
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

  #log(event) {
    this.store.appendEvent(event);
    this.emit('log', event);
  }

  #changed() {
    this.emit('changed', this.status());
  }
}

module.exports = { QueueEngine, sleep };
