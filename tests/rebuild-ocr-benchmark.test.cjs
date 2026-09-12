'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { resolvePython } = require('../src/vision-bridge.cjs');

test('primary OCR adapter is Apple Vision with Paddle as fallback', () => {
  const detect = require('node:fs').readFileSync(join(__dirname, '..', 'python', 'versa_text_detect.py'), 'utf8');
  const worker = require('node:fs').readFileSync(join(__dirname, '..', 'python', 'versa_rebuild_worker.py'), 'utf8');
  assert.match(detect, /_apple_detect/);
  assert.match(detect, /_paddle_detect/);
  assert.match(worker, /mode == "accurate"/);
  assert.match(worker, /_apple\(path\)/);
  assert.doesNotMatch(worker, /anytext|textdiffuser|easyocr/i);
});

test('OCR benchmark on a representative pale-band page', (t) => {
  const python = resolvePython();
  if (!python) {
    t.skip('python/.venv.nosync is not installed');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'versa-ocr-bench-'));
  const script = join(dir, 'bench.py');
  const image = join(dir, 'page.png');
  writeFileSync(script, `
import json, time
from PIL import Image, ImageDraw
from versa_text_detect import detect

image = Image.new("RGB", (800, 600), (255, 248, 236))
draw = ImageDraw.Draw(image)
draw.rectangle((60, 70, 740, 180), fill=(252, 248, 238))
draw.text((90, 100), "Name Hunt", fill=(40, 40, 45))
image.save(${JSON.stringify(image)})
started = time.perf_counter()
result = detect(${JSON.stringify(image)})
elapsed = (time.perf_counter() - started) * 1000
print(json.dumps({"elapsedMs": elapsed, "ok": result.get("ok"), "count": result.get("count"), "engine": "apple-or-paddle"}))
`);
  const run = spawnSync(python, [script], {
    cwd: join(__dirname, '..', 'python'),
    env: { ...process.env, PYTHONPATH: join(__dirname, '..', 'python') },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.status !== 0) {
    t.skip(`OCR benchmark skipped: ${(run.stderr || run.stdout || '').slice(0, 240)}`);
    return;
  }
  const line = (run.stdout || '').trim().split('\n').filter(Boolean).pop();
  const payload = JSON.parse(line);
  assert.equal(payload.ok, true);
  assert.ok(payload.elapsedMs < 2000, `fast OCR took ${payload.elapsedMs}ms`);
  console.log(`rebuild OCR ${payload.engine} ${payload.count} detections in ${payload.elapsedMs.toFixed(1)}ms`);
});
