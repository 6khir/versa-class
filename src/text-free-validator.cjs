'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { resolvePython } = require('./vision-bridge.cjs');

const DETECT_CLI = join(__dirname, '..', 'python', 'versa_text_detect.py');
const MAX_RETRIES = 2;

function defaultDetect(imagePath) {
  return new Promise((resolve, reject) => {
    const python = resolvePython() || process.env.VERSA_PYTHON || 'python3';
    const child = spawn(python, [DETECT_CLI, imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
      try {
        const payload = JSON.parse(line);
        resolve(payload);
      } catch {
        reject(Object.assign(new Error(stderr.trim() || 'Text detection failed.'), {
          code: 'TEXT_DETECT_FAILED',
          exitCode: code,
        }));
      }
    });
  });
}

function detectionsOf(result) {
  if (!result) return [];
  if (Array.isArray(result.detections)) return result.detections;
  if (Array.isArray(result.text)) return result.text;
  return [];
}

function detectionText(item) {
  return String(item?.text || '').replace(/\s+/g, ' ').trim();
}

function isIgnorableDetection(item) {
  const text = detectionText(item);
  if (!text) return true;
  if (/^\d{1,2}[.)]?$/.test(text)) return true;
  if (/^\[\s*[\d.,\s]+\]$/.test(text)) return true;
  if (/\b0\.\d{2,}/.test(text) && /,/.test(text)) return true;
  if (/empty reserved/i.test(text)) return true;
  if (/^\[/.test(text)) return true;
  if (text.length <= 2 && !/[A-Za-z]{2,}/.test(text)) return true;
  return false;
}

function leftoverWords(detections) {
  return (detections || []).filter((item) => !isIgnorableDetection(item));
}

/**
 * Grade a downloaded master. Gemini is not retried from here — a regenerate
 * loop burns credits on panel numbers and prompt-echo. Chrome (digits,
 * coordinates) is ignored. Leftover words are reported and accepted.
 */
async function assertTextFreeMaster(imagePath, {
  detect = defaultDetect,
  onRetry = () => {},
} = {}) {
  if (!imagePath || !existsSync(imagePath)) {
    throw Object.assign(new Error(`Master image is missing: ${imagePath}`), { code: 'IMAGE_MISSING' });
  }
  const result = await detect(imagePath);
  const detections = detectionsOf(result);
  const leftover = leftoverWords(detections);
  const chrome = detections.filter((item) => isIgnorableDetection(item));
  const attempt = {
    attempt: 0,
    imagePath,
    detectionCount: detections.length,
    leftoverCount: leftover.length,
    chromeCount: chrome.length,
    detections: detections.map((item) => ({
      text: detectionText(item).slice(0, 80),
      box: item.box || item.bbox || null,
      ignorable: isIgnorableDetection(item),
    })),
  };
  if (leftover.length) onRetry(attempt);
  return {
    ok: true,
    imagePath,
    acceptedWithLeftovers: leftover.length > 0,
    leftover,
    chrome,
    attempts: [attempt],
  };
}

module.exports = {
  assertTextFreeMaster,
  defaultDetect,
  isIgnorableDetection,
  leftoverWords,
  MAX_RETRIES,
  DETECT_CLI,
};
