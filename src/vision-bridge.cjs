'use strict';

/**
 * Bridge to the local MobileSAM + PaddleOCR worker.
 *
 * The worker is a long-lived Python process: model load costs seconds, per-page work
 * costs far less, so it is started once and reused. Every failure path here resolves
 * to a status object rather than throwing, because Interior Text must fall back to the
 * gem flow when the vision environment is absent instead of taking the pipeline down.
 */

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const PY_DIR = join(__dirname, '..', 'python');
const WORKER = join(PY_DIR, 'versa_vision.py');
// ".nosync" is the marker macOS iCloud Drive honours to skip a directory. The venv
// has to live behind it: this project sits on a synced Desktop, and iCloud was
// evicting individual package files, which surfaced as paddle losing utils/__init__.py
// and cv2 losing misc/__init__.py mid-run. The plain path is still accepted so an
// existing install keeps working.
const VENV_CANDIDATES = [
  join(PY_DIR, '.venv.nosync', 'bin', 'python'),
  join(PY_DIR, '.venv', 'bin', 'python'),
];
const REQUEST_TIMEOUT_MS = 180_000;
// Per page: MobileSAM mask + ComfyUI inpaint + ComfyUI glyph synthesis.
const COMPOSE_PAGE_BUDGET_MS = 900_000;

function resolvePython() {
  if (process.env.VERSA_PYTHON && existsSync(process.env.VERSA_PYTHON)) return process.env.VERSA_PYTHON;
  return VENV_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

class VisionBridge {
  #proc = null;
  #buffer = '';
  #pending = new Map();
  #nextId = 1;
  #starting = null;

  get available() {
    return Boolean(resolvePython()) && existsSync(WORKER);
  }

  /** Never throws. Returns why it is unavailable so the UI can explain itself. */
  async status({ probe = false } = {}) {
    const python = resolvePython();
    if (!python) {
      return { ok: false, ready: false, code: 'PYTHON_ENV_MISSING', error: 'Run python/setup_models.sh to create the vision environment.' };
    }
    if (!existsSync(WORKER)) {
      return { ok: false, ready: false, code: 'WORKER_MISSING', error: `Worker script not found at ${WORKER}` };
    }
    const checkpoint = existsSync(join(PY_DIR, 'models', 'mobile_sam.pt'));
    // Default is a cheap file check. Probing spawns the worker, which imports torch and
    // paddle and costs tens of seconds, so it only happens when a caller asks for it.
    if (!probe) {
      return {
        ok: true,
        ready: checkpoint,
        probed: false,
        code: checkpoint ? null : 'CHECKPOINT_MISSING',
        error: checkpoint ? null : 'MobileSAM checkpoint missing. Run python/setup_models.sh.'
      };
    }
    try {
      const result = await this.send({ cmd: 'ping' }, 120_000);
      return { ...result, probed: true };
    } catch (error) {
      return { ok: false, ready: false, probed: true, code: 'WORKER_UNAVAILABLE', error: error.message };
    }
  }

  #start() {
    if (this.#proc && !this.#proc.killed) return Promise.resolve();
    if (this.#starting) return this.#starting;
    const python = resolvePython();
    if (!python) return Promise.reject(Object.assign(new Error('Vision environment is not installed.'), { code: 'PYTHON_ENV_MISSING' }));

    this.#starting = new Promise((resolve, reject) => {
      // Its own process group, so a kill reaches whatever the worker spawned.
      const proc = spawn(python, [WORKER], {
        cwd: PY_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: {
          ...process.env,
          VERSA_COMFY_HOOK: process.env.VERSA_COMFY_HOOK || 'http://127.0.0.1:17881/comfy/resuscitate'
        }
      });
      let settled = false;
      proc.once('error', (error) => {
        if (!settled) { settled = true; this.#starting = null; reject(error); }
      });
      // Never hold the event loop open: a stuck worker must not stop Node exiting.
      proc.unref();
      proc.stdout.unref?.();
      proc.stderr.unref?.();
      proc.stdin.unref?.();
      proc.once('spawn', () => {
        if (!settled) { settled = true; this.#starting = null; resolve(); }
      });
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => this.#consume(chunk));
      proc.stderr.setEncoding('utf8');
      // Paddle and torch are chatty on import; only keep it for diagnosis.
      proc.stderr.on('data', (chunk) => { this.lastStderr = String(chunk).slice(-2000); });
      proc.once('exit', (code) => {
        this.#proc = null;
        const stderr = String(this.lastStderr || '').trim();
        const importCrash = /ImportError|ModuleNotFoundError|cannot import name/i.test(stderr);
        const message = importCrash
          ? `FATAL_ENGINE_ERROR: ${stderr.split('\n').filter(Boolean).slice(-2).join(' ')}`
          : `Vision worker exited (code ${code}).${stderr ? ` ${stderr.slice(-400)}` : ''}`;
        for (const [, entry] of this.#pending) {
          entry.reject(Object.assign(new Error(message), { code: importCrash ? 'FATAL_ENGINE_ERROR' : 'WORKER_EXITED', stderr }));
        }
        this.#pending.clear();
      });
      this.#proc = proc;
    });
    return this.#starting;
  }

  #consume(chunk) {
    this.#buffer += chunk;
    let index = this.#buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line) {
        let payload = null;
        try { payload = JSON.parse(line); } catch { payload = null; }
        if (payload && payload.id != null && this.#pending.has(payload.id)) {
          const entry = this.#pending.get(payload.id);
          this.#pending.delete(payload.id);
          clearTimeout(entry.timer);
          entry.resolve(payload);
        }
      }
      index = this.#buffer.indexOf('\n');
    }
  }

  async send(request, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.#start();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        // A timeout used to reject and leave the worker running. #proc stayed
        // set, so the next request went straight back into the same wedged
        // interpreter and timed out too — for the rest of the session. A worker
        // that misses its deadline is not trusted again: it is killed here, and
        // the next call starts a fresh one.
        this.#killWedged(`request ${request?.cmd ?? 'unknown'} timed out after ${Math.round(timeoutMs / 1000)}s`);
        reject(Object.assign(new Error('Vision worker timed out and was restarted.'), { code: 'WORKER_TIMEOUT', retryable: true }));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#proc.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
    });
  }

  /**
   * Kill a worker that stopped answering, along with anything it spawned.
   *
   * The group is signalled rather than the pid: the worker forks its own helpers
   * (and ComfyUI, when that path is in use), and killing only the parent leaves
   * them holding the port and the GPU.
   */
  #killWedged(reason) {
    const proc = this.#proc;
    if (!proc) return;
    this.#proc = null;
    this.#starting = null;
    this.#buffer = '';
    console.warn(`[vision] restarting worker: ${reason}`);
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error('Vision worker was restarted while this request was in flight.'), {
        code: 'WORKER_RESTARTED',
        retryable: true
      }));
    }
    this.#pending.clear();
    const pid = proc.pid;
    const signal = (sig) => {
      try { process.kill(-pid, sig); } catch { try { proc.kill(sig); } catch { /* already gone */ } }
    };
    signal('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) signal('SIGKILL');
    }, 3_000).unref?.();
  }

  /** Analyse one page. Resolves to {ok:false,...} rather than throwing. */
  async analyzePage(imagePath, { maxSide = 1400, prompt = '' } = {}) {
    try {
      return await this.send({ cmd: 'analyze', imagePath, maxSide, prompt });
    } catch (error) {
      return { ok: false, code: error.code || 'ANALYZE_FAILED', error: error.message };
    }
  }

  /**
   * Compile analysed pages into one layered PDF.
   *
   * Runs inside the same worker that produced the coordinates, so the PDF stage can
   * never be handed layer boxes from a different image than the one it embeds.
   * Composition is CPU-bound over full-resolution pages, so the timeout scales with
   * the page count rather than using the per-page default.
   */
  async composeLayeredPdf(spec) {
    const pages = Array.isArray(spec?.pages) ? spec.pages.length : 0;
    if (!pages) return { ok: false, code: 'NO_PAGES', error: 'At least one page is required.' };
    try {
      // Composing a page is not quick work: MobileSAM masks every text run, LaMa
      // reconstructs behind them, and the foundry traces a font per run. On an M2 that
      // is minutes per page, not the seconds the old flat-fill path took.
      return await this.send({ cmd: 'compose', spec }, Math.max(900_000, pages * COMPOSE_PAGE_BUDGET_MS));
    } catch (error) {
      return { ok: false, code: error.code || 'COMPOSE_FAILED', error: error.message };
    }
  }

  /**
   * Compile analysed pages into an editable PowerPoint deck.
   *
   * Same per-page cost as the PDF path - MobileSAM masks every run and LaMa repairs
   * behind them - so it gets the same budget rather than the default.
   */
  async composePptx(spec) {
    const pages = Array.isArray(spec?.pages) ? spec.pages.length : 0;
    if (!pages) return { ok: false, code: 'NO_PAGES', error: 'At least one page is required.' };
    try {
      const result = await this.send({ cmd: 'compose_pptx', spec }, Math.max(900_000, pages * COMPOSE_PAGE_BUDGET_MS));
      if (result && result.ok === false && /cannot import name|ImportError|ModuleNotFoundError/i.test(String(result.error || ''))) {
        result.code = 'FATAL_ENGINE_ERROR';
      }
      return result;
    } catch (error) {
      const fatal = error.code === 'FATAL_ENGINE_ERROR' || /cannot import name|ImportError|ModuleNotFoundError/i.test(String(error.message || ''));
      return { ok: false, code: fatal ? 'FATAL_ENGINE_ERROR' : (error.code || 'PPTX_COMPOSE_FAILED'), error: error.message };
    }
  }

  /** Combine per-page editable PDFs into one book. Concatenation, so it is quick. */
  async mergeLayeredPdfs(spec) {
    const inputs = Array.isArray(spec?.inputs) ? spec.inputs.length : 0;
    if (!inputs) return { ok: false, code: 'NO_PAGES', error: 'At least one page PDF is required.' };
    try {
      return await this.send({ cmd: 'merge', spec }, Math.max(120_000, inputs * 4_000));
    } catch (error) {
      return { ok: false, code: error.code || 'MERGE_FAILED', error: error.message };
    }
  }

  stop() {
    if (this.#proc && !this.#proc.killed) this.#proc.kill();
    this.#proc = null;
  }
}

/**
 * Turn the worker's layer model into the editable page text the app already consumes,
 * so Stage 3 assembly is unchanged. Layers with text become sections; the largest
 * text run near the top becomes the title.
 */
function visionResultToPageText(result) {
  if (!result?.ok || !Array.isArray(result.text) || !result.text.length) return null;
  const runs = [...result.text].sort((a, b) => a.box[1] - b.box[1]);
  const height = (run) => run.box[3] - run.box[1];
  const pageTop = result.height * 0.25;

  const titleCandidates = runs.filter((run) => run.box[1] <= pageTop);
  const title = (titleCandidates.length ? titleCandidates : runs)
    .reduce((best, run) => (height(run) > height(best) ? run : best));

  const rest = runs.filter((run) => run.id !== title.id);
  const instruction = rest.find((run) => /^(read|write|circle|colou?r|match|draw|cut|trace|answer|complete|choose|fill)\b/i.test(run.text));
  const footer = rest.find((run) => /\b(name|date)\b\s*[:_]/i.test(run.text));
  const used = new Set([title.id, instruction?.id, footer?.id].filter(Boolean));

  return {
    title: title.text,
    instruction: instruction?.text || '',
    sections: rest.filter((run) => !used.has(run.id)).map((run) => run.text).slice(0, 12),
    footer: footer?.text || ''
  };
}

module.exports = { VisionBridge, visionResultToPageText, resolvePython, WORKER, PY_DIR };
