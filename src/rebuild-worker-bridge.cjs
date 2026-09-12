'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { resolvePython } = require('./vision-bridge.cjs');

const PY_DIR = join(__dirname, '..', 'python');
const WORKER = join(PY_DIR, 'versa_rebuild_worker.py');
const REQUEST_TIMEOUT_MS = 120_000;

class RebuildWorkerBridge {
  #proc = null;
  #buffer = '';
  #pending = new Map();
  #nextId = 1;
  #starting = null;
  #queue = Promise.resolve();

  get available() {
    return Boolean(resolvePython()) && existsSync(WORKER);
  }

  async status() {
    if (!this.available) {
      return { ok: false, ready: false, code: 'REBUILD_WORKER_MISSING' };
    }
    try {
      return await this.send({ cmd: 'ping' }, 20_000);
    } catch (error) {
      return { ok: false, ready: false, code: error.code || 'WORKER_UNAVAILABLE', error: error.message };
    }
  }

  #start() {
    if (this.#proc && !this.#proc.killed) return Promise.resolve();
    if (this.#starting) return this.#starting;
    const python = resolvePython();
    if (!python) {
      return Promise.reject(Object.assign(new Error('Vision environment is not installed.'), { code: 'PYTHON_ENV_MISSING' }));
    }
    this.#starting = new Promise((resolve, reject) => {
      const proc = spawn(python, [WORKER], {
        cwd: PY_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });
      let settled = false;
      proc.once('error', (error) => {
        if (!settled) { settled = true; this.#starting = null; reject(error); }
      });
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
      proc.stderr.on('data', (chunk) => { this.lastStderr = String(chunk).slice(-2000); });
      proc.once('exit', () => {
        this.#proc = null;
        for (const [, entry] of this.#pending) {
          entry.reject(Object.assign(new Error('Rebuild worker exited.'), { code: 'WORKER_EXITED' }));
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

  send(request, timeoutMs = REQUEST_TIMEOUT_MS) {
    const run = async () => {
      await this.#start();
      const id = this.#nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(Object.assign(new Error('Rebuild worker timed out.'), { code: 'WORKER_TIMEOUT' }));
        }, timeoutMs);
        this.#pending.set(id, { resolve, reject, timer });
        this.#proc.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
      });
    };
    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }

  ocr(imagePath, mode = 'fast') {
    return this.send({ cmd: 'ocr', imagePath, mode });
  }

  inspectBands(imagePath, boxes) {
    return this.send({ cmd: 'inspect_bands', imagePath, boxes });
  }

  cleanup(imagePath, outputPath, boxes, options = {}) {
    return this.send({
      cmd: 'cleanup',
      imagePath,
      outputPath,
      boxes,
      expandPx: options.expandPx || 2,
      fillInner: options.fillInner,
      legacyTextured: Boolean(options.legacyTextured),
      detections: options.detections || [],
    });
  }

  composePptx(spec) {
    const pages = Array.isArray(spec?.pages) ? spec.pages.length : 1;
    return this.send({ cmd: 'compose_pptx', spec }, Math.max(120_000, pages * 8_000));
  }

  stop() {
    if (this.#proc && !this.#proc.killed) this.#proc.kill();
    this.#proc = null;
  }
}

const sharedRebuildWorker = new RebuildWorkerBridge();

module.exports = { RebuildWorkerBridge, sharedRebuildWorker, WORKER };
