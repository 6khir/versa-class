'use strict';
function aborted() { return Object.assign(new Error('Generation paused.'), { code: 'QUEUE_PAUSED' }); }
/** Every external operation has a deadline and an independent cancellation fence. */
function runOperation(work, { signal, timeoutMs = 120000, phase = 'generation', onTimeout = () => {} } = {}) {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      fn(value);
    };
    const cancel = () => finish(reject, aborted());
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error(`${phase} stopped responding; recovering automatically.`), { code: 'GENERATION_STUCK', phase }));
      try { onTimeout(); } catch {}
    }, timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    Promise.resolve().then(() => { if (signal?.aborted) throw aborted(); return work(); })
      .then(value => finish(resolve, value), error => finish(reject, error));
  });
}
function waitForRetry(ms, signal) {
  return runOperation(() => new Promise(resolve => {
    const timer = setTimeout(done, Math.max(0, ms));
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  }), {signal, timeoutMs: Math.max(1, ms) + 1000, phase:'retry delay'});
}
module.exports = { runOperation, waitForRetry };
