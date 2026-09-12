'use strict';

const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { resolvePython } = require('./vision-bridge.cjs');

const PYTHON_CLI = join(__dirname, '..', 'python', 'versa_text_inpaint.py');
const MAX_INPAINT_RETRIES = 3;

function defaultPythonBin() {
  // Prefer VERSA_PYTHON, then python/.venv.nosync, then python/.venv.
  return resolvePython() || process.env.VERSA_PYTHON || 'python3';
}

function shouldCleanBakedText(job) {
  return Array.isArray(job?.textOverlays) && job.textOverlays.some((item) => String(item?.text || item?.placeholderText || '').trim());
}

function inpaintOkSidecar(imagePath) {
  const match = String(imagePath || '').match(/^(.*)(\.[^.]+)$/);
  if (!match) return `${imagePath}.inpaint-ok.json`;
  return `${match[1]}.inpaint-ok.json`;
}

function sidecarIsClean(imagePath) {
  const sidecar = inpaintOkSidecar(imagePath);
  if (!existsSync(sidecar)) return false;
  try {
    const payload = JSON.parse(readFileSync(sidecar, 'utf8'));
    return payload?.ok === true && Number(payload.residual_count || 0) === 0;
  } catch {
    return false;
  }
}

function runPython(args, { pythonBin = defaultPythonBin(), timeoutMs = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('Text inpaint timed out.'), { code: 'TEXT_INPAINT_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`Python is not available for OCR/ComfyUI (${error.message}).`), {
        code: 'TEXT_INPAINT_DEPS_MISSING'
      }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
      let payload = null;
      try {
        payload = line ? JSON.parse(line) : null;
      } catch {
        payload = null;
      }
      if (code === 0 && payload?.ok) {
        resolve(payload);
        return;
      }
      const errCode = payload?.code || (code === 2 ? 'TEXT_INPAINT_RESIDUAL' : 'TEXT_INPAINT_FAILED');
      reject(Object.assign(new Error(payload?.error || stderr.trim() || 'Blank-master text inpaint failed.'), {
        code: errCode,
        details: payload
      }));
    });
  });
}

async function cleanBlankMaster(imagePath, options = {}) {
  if (!imagePath || !existsSync(imagePath)) {
    throw Object.assign(new Error('Blank master PNG is missing for OCR/LaMa cleanup.'), {
      code: 'EDITABLE_BG_MISSING'
    });
  }
  if (sidecarIsClean(imagePath) && options.force !== true) return { ok: true, skipped: true, reason: 'sidecar' };
  if (!existsSync(PYTHON_CLI)) {
    throw Object.assign(new Error('python/versa_vision.py is missing from the app bundle.'), {
      code: 'TEXT_INPAINT_DEPS_MISSING'
    });
  }
  return runPython([PYTHON_CLI, '--input', imagePath, '--output', options.outputPath || imagePath], options);
}

async function assertBlankMasterClean(imagePath, job, options = {}) {
  if (!shouldCleanBakedText(job)) return { ok: true, skipped: true, reason: 'no-overlays' };
  if (sidecarIsClean(imagePath)) return { ok: true, skipped: true, reason: 'sidecar' };
  return cleanBlankMaster(imagePath, options);
}

module.exports = {
  MAX_INPAINT_RETRIES,
  PYTHON_CLI,
  assertBlankMasterClean,
  cleanBlankMaster,
  defaultPythonBin,
  inpaintOkSidecar,
  resolvePython,
  shouldCleanBakedText,
  sidecarIsClean
};
