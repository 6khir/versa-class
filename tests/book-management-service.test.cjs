'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { join } = require('node:path');

const service = require('../src/book-management-service.cjs');

test('the bundled plugin path includes their Flask app', () => {
  const home = service.serviceDir();
  assert.ok(home.endsWith(join('services', 'versa-book-management')));
  assert.match(service.BASE_URL, /127\.0\.0\.1:5000/);
});

test.describe('ensureRunning', { concurrency: 1 }, () => {
  test('a reachable health endpoint is used as-is and nothing is spawned', async () => {
    const spawned = [];
    const state = await service.ensureRunning({
      fetchImpl: async () => ({ ok: true, status: 200 }),
      spawnFn: () => { spawned.push('no'); throw new Error('should not spawn'); },
      timeoutMs: 200
    });
    assert.equal(state.ok, true);
    assert.equal(state.running, true);
    assert.equal(spawned.length, 0);
  });

  test('a missing plugin checkout is reported, not thrown', async () => {
    const state = await service.ensureRunning({
      home: join(__dirname, 'missing-book-management'),
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
      timeoutMs: 200
    });
    assert.equal(state.ok, false);
    assert.equal(state.code, 'MANAGEMENT_NOT_INSTALLED');
  });
});

test('ping talks to the isolated health route', async () => {
  let url = '';
  await service.ping({
    fetchImpl: async (target) => {
      url = String(target);
      return { ok: true, status: 200 };
    }
  });
  assert.match(url, /\/api\/integration\/health$/);
});

test('spawned children are the only processes this service will kill', () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.unref = () => {};
  assert.equal(typeof service.shutdownSync, 'function');
  assert.equal(typeof service.installQuitHooks, 'function');
});
