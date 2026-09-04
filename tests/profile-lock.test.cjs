'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir, hostname } = require('node:os');

const { profileLockOwnerPid, clearStaleProfileLocks } = require('../src/browser-controller.cjs');

function makeProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'tpt-profile-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    writeLock: (target) => symlinkSync(target, join(dir, 'SingletonLock'))
  };
}

test('a lock owned by a live process this app can signal is respected', () => {
  const profile = makeProfile();
  try {
    // Our own PID stands in for the automation Chrome: same user, signalable.
    profile.writeLock(`${hostname()}-${process.pid}`);
    assert.strictEqual(profileLockOwnerPid(profile.dir), process.pid);

    const result = clearStaleProfileLocks(profile.dir);
    assert.strictEqual(result.cleared, false, 'a genuinely held lock must not be cleared');
    assert.strictEqual(result.ownerPid, process.pid);
  } finally {
    profile.cleanup();
  }
});

test('a lock left by a dead process is treated as stale and cleared', () => {
  const profile = makeProfile();
  try {
    // PID 2^22 is above the maximum on macOS/Linux, so it can never be live.
    profile.writeLock(`${hostname()}-4194304`);
    assert.strictEqual(profileLockOwnerPid(profile.dir), null);

    const result = clearStaleProfileLocks(profile.dir);
    assert.strictEqual(result.ownerPid, null);
    assert.strictEqual(result.cleared, true);
    assert.ok(!existsSync(join(profile.dir, 'SingletonLock')), 'the stale lock should be removed');
  } finally {
    profile.cleanup();
  }
});

test('a lock written by a different machine is treated as stale', () => {
  const profile = makeProfile();
  try {
    // Same PID as this process, but a foreign hostname: it cannot be our browser.
    profile.writeLock(`some-other-machine.local-${process.pid}`);
    assert.strictEqual(
      profileLockOwnerPid(profile.dir),
      null,
      'a lock from another host must never be considered held'
    );
  } finally {
    profile.cleanup();
  }
});

test('clearing removes every Chrome singleton artifact, not just SingletonLock', () => {
  const profile = makeProfile();
  try {
    profile.writeLock(`${hostname()}-4194304`);
    for (const name of ['SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', 'LOCK']) {
      writeFileSync(join(profile.dir, name), 'x');
    }

    clearStaleProfileLocks(profile.dir);

    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', 'LOCK']) {
      assert.ok(!existsSync(join(profile.dir, name)), `${name} should have been removed`);
    }
  } finally {
    profile.cleanup();
  }
});

test('a profile with no lock file reports no owner', () => {
  const profile = makeProfile();
  try {
    assert.strictEqual(profileLockOwnerPid(profile.dir), null);
    assert.strictEqual(clearStaleProfileLocks(profile.dir).ownerPid, null);
  } finally {
    profile.cleanup();
  }
});
