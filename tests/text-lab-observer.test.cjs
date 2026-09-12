'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextLabObserver, formatEta, PHASE_PRIORS_MS } = require('../src/text-lab-observer.cjs');

test('formatEta renders seconds and minutes', () => {
  assert.equal(formatEta(0), '0s left');
  assert.equal(formatEta(4500), '5s left');
  assert.equal(formatEta(90_000), '1:30 left');
});

test('remaining time starts from priors and then uses measured page samples', () => {
  let clock = 1_000;
  const observer = createTextLabObserver({ now: () => clock, intervalMs: 60_000 });
  const pages = [
    { jobId: 'a', pageNumber: 1 },
    { jobId: 'b', pageNumber: 2 }
  ];
  observer.start({ projectId: 'p1', pages });
  let snap = observer.snapshot();
  assert.equal(snap.phase, 'starting');
  assert.equal(snap.generating, true);
  assert.equal(
    snap.remainingMs,
    PHASE_PRIORS_MS.starting + (2 * PHASE_PRIORS_MS.reading) + (2 * PHASE_PRIORS_MS.rebuilding)
  );

  observer.setPhase('reading');
  observer.pageBegin({ jobId: 'a', pageNumber: 1, phase: 'reading' });
  clock += 4_000;
  snap = observer.snapshot();
  assert.equal(snap.jobId, 'a');
  assert.equal(snap.phase, 'reading');
  assert.equal(
    snap.remainingMs,
    (PHASE_PRIORS_MS.reading - 4_000) + PHASE_PRIORS_MS.reading + (2 * PHASE_PRIORS_MS.rebuilding)
  );

  observer.pageEnd({ phase: 'reading', cached: false });
  observer.pageBegin({ jobId: 'b', pageNumber: 2, phase: 'reading' });
  clock += 4_000;
  snap = observer.snapshot();
  assert.equal(snap.jobId, 'b');
  assert.equal(snap.remainingMs, 2 * PHASE_PRIORS_MS.rebuilding);

  observer.pageEnd({ phase: 'reading', cached: false });
  observer.setPhase('rebuilding');
  observer.pageBegin({ jobId: 'a', pageNumber: 1, phase: 'rebuilding' });
  clock += 10_000;
  snap = observer.snapshot();
  assert.equal(snap.phase, 'rebuilding');
  assert.equal(snap.remainingMs, (PHASE_PRIORS_MS.rebuilding - 10_000) + PHASE_PRIORS_MS.rebuilding);
  assert.ok(snap.pageFill > 0 && snap.pageFill < 100);
});

test('cached and sub-200ms samples do not pull the rolling average down', () => {
  let clock = 0;
  const observer = createTextLabObserver({ now: () => clock, intervalMs: 60_000 });
  observer.start({ pages: [{ jobId: 'a', pageNumber: 1 }, { jobId: 'b', pageNumber: 2 }] });
  observer.pageBegin({ jobId: 'a', pageNumber: 1, phase: 'reading' });
  clock += 80;
  observer.pageEnd({ phase: 'reading', cached: false });
  observer.pageBegin({ jobId: 'b', pageNumber: 2, phase: 'reading' });
  clock += 50;
  observer.pageEnd({ phase: 'reading', cached: true });
  observer.setPhase('rebuilding');
  const snap = observer.snapshot();
  assert.ok(snap.remainingMs >= PHASE_PRIORS_MS.rebuilding);
});

test('stop reports done and zero remaining time', () => {
  const beats = [];
  const observer = createTextLabObserver({ now: () => 0, intervalMs: 60_000 });
  observer.on('heartbeat', (snap) => beats.push(snap));
  observer.start({ pages: [{ jobId: 'a', pageNumber: 1 }] });
  const last = observer.stop();
  assert.equal(last.generating, true);
  const done = beats.at(-1);
  assert.equal(done.generating, false);
  assert.equal(done.phase, 'done');
  assert.equal(done.remainingMs, 0);
  assert.equal(done.percent, 100);
});
