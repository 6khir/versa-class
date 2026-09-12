'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { ProcessSupervisor, STATES } = require('../src/process-supervisor.cjs');

// A fake child that behaves like a real one for the parts the supervisor touches:
// it has a pid, emits exit, and records the signals sent to it.
class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.stdin = { write() {} };
  }
  die(code = 1, signal = null) {
    this.exitCode = code;
    this.emit('exit', code, signal);
  }
}

// Timers run immediately in order, so backoff and grace periods are exercised
// without the test sleeping.
function harness({ probe = null, ...tuning } = {}) {
  const spawned = [];
  const signals = [];
  let pid = 1000;
  let clock = 0;
  const pending = [];

  const supervisor = new ProcessSupervisor({
    command: '/usr/bin/python3',
    args: ['worker.py'],
    name: 'vision worker',
    probe,
    spawnFn: () => { const c = new FakeChild(pid += 1); spawned.push(c); return c; },
    killFn: (target, signal) => { signals.push({ target, signal }); },
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms }; pending.push(t); return t; },
    clearTimer: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    ...tuning
  });

  // Drain queued timers.
  //
  // The callback is fired but not awaited: a timer callback often schedules the
  // next timer (a probe reschedules itself, a restart waits out its backoff), and
  // awaiting it here would block the very loop that has to deliver that timer.
  // Each round yields to the real event loop so microtasks settle first.
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const tick = async (rounds = 12) => {
    for (let i = 0; i < rounds; i += 1) {
      if (pending.length) {
        const t = pending.shift();
        clock += t.ms;
        t.fn();
      }
      await flush();
    }
  };

  return { supervisor, spawned, signals, tick, advance: (ms) => { clock += ms; }, pending };
}

test('start brings the process up and reports it', async () => {
  const { supervisor, spawned } = harness();
  const events = [];
  supervisor.on('up', (e) => events.push(e));
  await supervisor.start();
  assert.equal(supervisor.state, STATES.RUNNING);
  assert.equal(spawned.length, 1);
  assert.equal(supervisor.pid, spawned[0].pid);
  assert.equal(events.length, 1);
});

test('the child is spawned in its own group so its children die with it', async () => {
  let captured = null;
  const supervisor = new ProcessSupervisor({
    command: 'x',
    spawnFn: (_cmd, _args, options) => { captured = options; const c = new FakeChild(7); return c; },
    setTimer: () => null,
    clearTimer: () => {}
  });
  await supervisor.start();
  // ComfyUI forks its own workers; without a group they survive the kill and keep
  // holding the port.
  assert.equal(captured.detached, true);
});

test('a kill escalates from SIGTERM to SIGKILL and targets the group', async () => {
  const { supervisor, spawned, signals, tick } = harness({ killGraceMs: 100 });
  await supervisor.start();
  const pid = spawned[0].pid;
  const stopping = supervisor.stop({ reason: 'test' });
  await tick();
  await stopping;
  assert.deepEqual(signals[0], { target: -pid, signal: 'SIGTERM' }, 'the group is signalled, not just the pid');
  assert.deepEqual(signals[1], { target: -pid, signal: 'SIGKILL' }, 'a process that ignores SIGTERM is not asked twice');
});

test('a child that exits on its own is brought back', async () => {
  const { supervisor, spawned, tick } = harness();
  await supervisor.start();
  const down = [];
  supervisor.on('down', (e) => down.push(e));
  spawned[0].die(1);
  await tick();
  assert.equal(down.length, 1);
  assert.equal(down[0].unexpected, true);
  assert.equal(spawned.length, 2, 'a replacement was started');
  assert.equal(supervisor.state, STATES.RUNNING);
});

test('a deliberate stop is not treated as a crash', async () => {
  const { supervisor, spawned, tick } = harness();
  await supervisor.start();
  const stopping = supervisor.stop();
  await tick();
  await stopping;
  spawned[0].die(0);
  await tick();
  assert.equal(spawned.length, 1, 'quitting must not race the watchdog into a respawn');
  assert.equal(supervisor.state, STATES.STOPPED);
});

// The failure this whole class exists for: the process is alive but answering
// nothing. The old bridge left it in place and every later request timed out.

test('a wedged process is killed and replaced, not left in place', async () => {
  let answers = true;
  const { supervisor, spawned, signals, tick } = harness({
    probe: async () => answers,
    probeIntervalMs: 1_000,
    killGraceMs: 10
  });
  await supervisor.start();
  const unhealthy = [];
  supervisor.on('unhealthy', (e) => unhealthy.push(e));

  answers = false;           // the interpreter wedges
  await tick(20);

  assert.ok(unhealthy.length >= 1, 'silence is detected as a fault');
  assert.ok(signals.some((s) => s.signal === 'SIGTERM'), 'the wedged process is actually killed');
  // More than one replacement is correct here: the probe never starts answering,
  // so the supervisor keeps trying until its breaker trips. What matters is that
  // the wedged process did not simply stay in place.
  assert.ok(spawned.length >= 2, `replaced at least once, got ${spawned.length}`);
  assert.notEqual(supervisor.pid, spawned[0].pid, 'the wedged pid is not the live one');
});

test('a probe that never returns counts as unhealthy', async () => {
  const { supervisor, spawned, tick } = harness({
    probe: () => new Promise(() => {}),   // never settles, like a hung worker
    probeIntervalMs: 1_000,
    probeTimeoutMs: 500,
    killGraceMs: 10
  });
  await supervisor.start();
  await tick(20);
  assert.ok(spawned.length >= 2, `a hang is a fault, not a pause (spawned ${spawned.length})`);
});

test('a healthy process is left alone', async () => {
  const { supervisor, spawned, signals, tick } = harness({
    probe: async () => true,
    probeIntervalMs: 1_000
  });
  await supervisor.start();
  await tick(6);
  assert.equal(spawned.length, 1);
  assert.equal(signals.length, 0);
  assert.equal(supervisor.state, STATES.RUNNING);
});

test('a crash loop trips a breaker instead of respawning forever', async () => {
  const { supervisor, spawned, tick } = harness({ maxRapidRestarts: 3, stabilityWindowMs: 10 ** 9 });
  const gaveUp = [];
  supervisor.on('gave-up', (e) => gaveUp.push(e));
  await supervisor.start();
  for (let i = 0; i < 8 && supervisor.state !== STATES.GAVE_UP; i += 1) {
    const child = spawned[spawned.length - 1];
    if (child && child.exitCode === null) child.die(1);
    await tick(6);
  }
  assert.equal(supervisor.state, STATES.GAVE_UP);
  assert.equal(gaveUp.length, 1);
  assert.ok(spawned.length <= 5, `bounded respawns, got ${spawned.length}`);
  await assert.rejects(() => supervisor.start(), { code: 'SUPERVISOR_GAVE_UP' });
});

test('surviving the stability window clears the crash streak', async () => {
  const { supervisor, spawned, tick, advance } = harness({ maxRapidRestarts: 2, stabilityWindowMs: 1_000 });
  await supervisor.start();
  spawned[0].die(1);
  await tick(6);
  assert.equal(supervisor.rapidRestarts, 1);

  advance(5_000);              // the replacement runs happily for a while
  spawned[spawned.length - 1].die(1);
  await tick(6);
  // A process that ran for five seconds then died is a fresh incident, not the
  // second strike of a loop.
  assert.equal(supervisor.rapidRestarts, 1);
  assert.notEqual(supervisor.state, STATES.GAVE_UP);
});

test('reset clears the breaker so a fixed engine can start again', async () => {
  const { supervisor, spawned, tick } = harness({ maxRapidRestarts: 1, stabilityWindowMs: 10 ** 9 });
  await supervisor.start();
  for (let i = 0; i < 6 && supervisor.state !== STATES.GAVE_UP; i += 1) {
    const child = spawned[spawned.length - 1];
    if (child && child.exitCode === null) child.die(1);
    await tick(6);
  }
  assert.equal(supervisor.state, STATES.GAVE_UP);
  supervisor.reset();
  assert.equal(supervisor.state, STATES.STOPPED);
  await supervisor.start();
  assert.equal(supervisor.state, STATES.RUNNING);
});

test('status is enough to render the engine chip without asking the process', async () => {
  const { supervisor } = harness();
  assert.equal(supervisor.status().state, STATES.STOPPED);
  await supervisor.start();
  const s = supervisor.status();
  assert.equal(s.running, true);
  assert.equal(s.name, 'vision worker');
  assert.ok(Number.isInteger(s.pid));
});
