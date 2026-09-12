'use strict';

const { EventEmitter } = require('node:events');

const PHASE_PRIORS_MS = Object.freeze({
  starting: 25_000,
  reading: 18_000,
  rebuilding: 90_000
});

const PHASE_LABEL = Object.freeze({
  starting: 'Starting the Text Lab engine…',
  reading: 'Reading the page…',
  rebuilding: 'Rebuilding into editable…',
  done: 'Text Lab finished.'
});

function average(samples, fallback) {
  if (!samples.length) return fallback;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function formatEta(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  if (minutes <= 0) return `${totalSeconds}s left`;
  return `${minutes}:${seconds} left`;
}

function createTextLabObserver({ now = Date.now, intervalMs = 400 } = {}) {
  const emitter = new EventEmitter();
  const samples = {
    reading: [],
    rebuilding: []
  };
  let timer = null;
  let session = null;

  function remember(phase, elapsedMs, cached) {
    if (cached || elapsedMs < 200) return;
    if (phase !== 'reading' && phase !== 'rebuilding') return;
    samples[phase].push(elapsedMs);
    if (samples[phase].length > 8) samples[phase].shift();
  }

  function workUnits(total) {
    return Math.max(1, total * 2);
  }

  function snapshot() {
    if (!session) {
      return {
        kind: 'text-lab',
        generating: false,
        phase: 'done',
        percent: 0,
        remainingMs: 0,
        elapsedMs: 0,
        message: PHASE_LABEL.done
      };
    }
    const clock = now();
    const total = session.pages.length;
    const pageElapsed = Math.max(0, clock - session.pageStartedAt);
    const avgRead = average(samples.reading, PHASE_PRIORS_MS.reading);
    const avgRebuild = average(samples.rebuilding, PHASE_PRIORS_MS.rebuilding);
    const currentAvg = session.phase === 'reading'
      ? avgRead
      : session.phase === 'rebuilding'
        ? avgRebuild
        : PHASE_PRIORS_MS.starting;
    const currentRemain = session.phase === 'starting' || session.phase === 'reading' || session.phase === 'rebuilding'
      ? Math.max(0, currentAvg - pageElapsed)
      : 0;
    const readingLeft = Math.max(0, total - session.doneReading - (session.phase === 'reading' ? 1 : 0));
    const rebuildLeft = Math.max(0, total - session.doneRebuild - (session.phase === 'rebuilding' ? 1 : 0));
    const remainingMs = Math.round(
      currentRemain
      + readingLeft * avgRead
      + rebuildLeft * avgRebuild
    );
    const currentFraction = Math.min(0.92, pageElapsed / Math.max(1, currentAvg));
    const doneUnits = session.doneReading + session.doneRebuild
      + (session.phase === 'reading' || session.phase === 'rebuilding' ? currentFraction : 0);
    const percent = session.phase === 'starting'
      ? Math.min(4, Math.round((pageElapsed / PHASE_PRIORS_MS.starting) * 4))
      : Math.max(1, Math.min(99, Math.round((doneUnits / workUnits(total)) * 100)));
    const pageFill = session.phase === 'starting'
      ? Math.min(18, Math.round((pageElapsed / PHASE_PRIORS_MS.starting) * 18))
      : Math.max(6, Math.round(currentFraction * 100));
    const pageLabel = session.pageNumber ? `Page ${session.pageNumber}` : 'Text Lab';
    const message = session.phase === 'starting'
      ? `${PHASE_LABEL.starting} ${formatEta(remainingMs)}`
      : `${pageLabel} · ${PHASE_LABEL[session.phase] || 'Working…'} ${formatEta(remainingMs)}`;

    return {
      kind: 'text-lab',
      projectId: session.projectId,
      jobId: session.jobId,
      pageNumber: session.pageNumber,
      phase: session.phase,
      generating: session.phase === 'reading' || session.phase === 'rebuilding' || session.phase === 'starting',
      elapsedMs: clock - session.startedAt,
      remainingMs,
      percent,
      pageFill,
      doneReading: session.doneReading,
      doneRebuild: session.doneRebuild,
      total,
      etaLabel: formatEta(remainingMs),
      message
    };
  }

  function emitBeat() {
    emitter.emit('heartbeat', snapshot());
  }

  function start(input = {}) {
    const pages = Array.isArray(input.pages) ? input.pages.filter((page) => page?.jobId) : [];
    session = {
      projectId: input.projectId || null,
      pages,
      phase: 'starting',
      jobId: pages[0]?.jobId || null,
      pageNumber: pages[0]?.pageNumber || null,
      startedAt: now(),
      pageStartedAt: now(),
      doneReading: 0,
      doneRebuild: 0
    };
    if (timer) clearInterval(timer);
    timer = setInterval(emitBeat, Math.max(200, Number(intervalMs) || 400));
    if (typeof timer.unref === 'function') timer.unref();
    emitBeat();
    return snapshot();
  }

  function pageBegin({ jobId, pageNumber, phase } = {}) {
    if (!session) return snapshot();
    session.phase = phase === 'rebuilding' ? 'rebuilding' : 'reading';
    session.jobId = jobId || session.jobId;
    session.pageNumber = pageNumber ?? session.pageNumber;
    session.pageStartedAt = now();
    emitBeat();
    return snapshot();
  }

  function pageEnd({ phase, cached } = {}) {
    if (!session) return snapshot();
    const elapsed = now() - session.pageStartedAt;
    const resolved = phase === 'rebuilding' ? 'rebuilding' : 'reading';
    remember(resolved, elapsed, Boolean(cached));
    if (resolved === 'reading') session.doneReading += 1;
    else session.doneRebuild += 1;
    emitBeat();
    return snapshot();
  }

  function setPhase(phase) {
    if (!session) return snapshot();
    session.phase = phase;
    session.pageStartedAt = now();
    emitBeat();
    return snapshot();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const last = snapshot();
    session = null;
    emitter.emit('heartbeat', { ...last, generating: false, phase: 'done', percent: 100, remainingMs: 0, message: PHASE_LABEL.done, etaLabel: 'Done' });
    return last;
  }

  return Object.assign(emitter, {
    start,
    pageBegin,
    pageEnd,
    setPhase,
    stop,
    snapshot,
    formatEta
  });
}

module.exports = {
  createTextLabObserver,
  formatEta,
  PHASE_PRIORS_MS,
  PHASE_LABEL
};
