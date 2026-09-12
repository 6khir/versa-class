'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const comfy = require('../src/comfy-service.cjs');

test('a reachable server is used as-is and never adopted for shutdown', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
  const state = await comfy.ensureRunning();
  assert.equal(state.ok, true);
  assert.equal(state.running, true);
  // Nothing was started here, so there is nothing this module may kill. Shutting down
  // an instance the user launched themselves would be a genuinely bad surprise.
  assert.equal(state.managed, false);
  assert.equal(await comfy.shutdown(), false);
});

test('an unreachable server with no installation is reported, not thrown', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); });
  const home = comfy.findHome();
  if (home) return; // ComfyUI is installed on this machine; the launch path is covered manually
  const state = await comfy.ensureRunning({ timeoutMs: 100 });
  assert.equal(state.ok, false);
  assert.equal(state.code, 'COMFY_NOT_INSTALLED');
  assert.match(state.error, /VERSA_COMFY_HOME/);
});

test('font nodes are detected by name, and their absence is not an error', async (t) => {
  t.mock.method(global, 'fetch', async () => ({
    ok: true,
    json: async () => ({ CLIPTextEncode: {}, KSampler: {}, LoadImage: {} })
  }));
  assert.equal(await comfy.hasFontNodes(), false);

  t.mock.restoreAll();
  t.mock.method(global, 'fetch', async () => ({
    ok: true,
    json: async () => ({ ComfyFontSynthesis: {}, KSampler: {} })
  }));
  assert.equal(await comfy.hasFontNodes(), true);
});

test('an unreachable server reports no nodes rather than throwing', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
  assert.deepEqual(await comfy.availableNodes(), []);
  assert.equal(await comfy.ping(), false);
  const state = await comfy.status();
  assert.equal(state.running, false);
  assert.equal(state.fontNodes, false);
});

test('Interior Text uses local Option A and does not gate on ComfyUI', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = source.indexOf('      interior_text: async (projectId, onProgress) => {');
  const body = source.slice(start, source.indexOf('\n      },', start));
  assert.doesNotMatch(body, /comfy\.ensureRunning\(\)/);
  assert.doesNotMatch(body, /COMFYUI_UNAVAILABLE/);
  assert.doesNotMatch(body, /ComfyUI is required for Text Lab/);
  assert.doesNotMatch(body, /using local fonts only/);
  assert.doesNotMatch(body, /comfy\.shutdown\(\)/);
  assert.match(source, /comfy\.connectForever\(\)/);
  assert.match(source, /will-quit/);
  assert.match(source, /comfy\.shutdownSync\(\)/);
});

test('headless boot binds localhost, waits for /system_stats, and dies with the app', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'comfy-service.cjs'), 'utf8');
  assert.match(service, /ComfyUI-Installs/);
  assert.match(service, /function connectForever/);
  assert.match(service, /startKeepAlive/);
  assert.match(service, /must not outlive the app/);
  assert.match(service, /--listen/);
  assert.match(service, /127\.0\.0\.1/);
  assert.match(service, /--disable-auto-launch/);
  assert.match(service, /STARTUP_TIMEOUT_MS = 60_000/);
  assert.match(service, /POLL_INTERVAL_MS = 2_000/);
  assert.match(service, /\/system_stats/);
  assert.match(service, /function shutdownSync/);
  assert.equal(comfy.HOST, '127.0.0.1');
  assert.equal(comfy.PORT, 8188);
  assert.equal(comfy.STARTUP_TIMEOUT_MS, 60_000);
  assert.equal(comfy.POLL_INTERVAL_MS, 2_000);
  const home = comfy.findHome();
  if (!home) return;
  assert.ok(fs.existsSync(path.join(home, 'main.py')));
});

test('the Comfy watchdog can resuscitate through Node and report recovery', () => {
  assert.equal(typeof comfy.brutalRestart, 'function');
  assert.equal(typeof comfy.onRecovery, 'function');
  assert.equal(typeof comfy.startWatchdogServer, 'function');
  assert.match(comfy.HOOK_URL, /comfy\/resuscitate/);
  const python = fs.readFileSync(path.join(__dirname, '..', 'python', 'versa_comfy_bridge.py'), 'utf8');
  assert.match(python, /def execute_inpainting_workflow/);
  assert.doesNotMatch(python, /def synthesize_font/);
  assert.match(python, /class ComfyWatchdog/);
  assert.match(python, /VAEEncodeForInpaint/);
  assert.match(python, /request_resuscitation/);
  assert.match(python, /http:\/\/127\.0\.0\.1:8188/);
  assert.match(python, /requests\.Session\(\)/);
  assert.match(python, /urllib3\.util\.retry import Retry/);
  assert.match(python, /--listen/);
  assert.match(python, /def _is_invalid_workflow/);
  assert.match(python, /def has_checkpoint/);
  assert.doesNotMatch(python, /v1-5-pruned-emaonly/);
});
