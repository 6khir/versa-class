'use strict';

/**
 * Run a fixed snapshot of TPT projects sequentially.
 *
 * Submission failures already handled by the TPT workflow are isolated to the
 * current product. Other failures stop the bundle so a form/session problem is
 * not repeated across every queued product. Cleanup always runs.
 */
async function runBundleUploadSequence({
  projectIds = [],
  isActive = () => true,
  onCurrent = async () => {},
  execute,
  onCompleted = async () => {},
  onError = async () => {},
  onFinally = async () => {}
} = {}) {
  if (typeof execute !== 'function') throw new TypeError('Bundle execute callback is required.');
  let completed = 0;
  let failed = 0;
  let stopped = false;

  try {
    for (const projectId of [...projectIds]) {
      if (!isActive()) {
        stopped = true;
        break;
      }
      await onCurrent(projectId);
      try {
        await execute(projectId);
        completed += 1;
        await onCompleted(projectId, { handledFailure: false });
      } catch (error) {
        failed += 1;
        const handledFailure = Boolean(error?.tptSubmissionHandled);
        await onError(projectId, error, { handledFailure });
        if (!handledFailure) {
          stopped = true;
          break;
        }
        await onCompleted(projectId, { handledFailure: true });
      }
    }
    return { completed, failed, stopped };
  } finally {
    await onFinally({ completed, failed, stopped });
  }
}

module.exports = { runBundleUploadSequence };
