const process = require('node:process');

let forceExitScheduled = false;

function shouldLogHandles() {
  return Boolean(process.env.APPHUB_TEST_DEBUG_HANDLES ?? process.env.APPHUB_E2E_DEBUG_HANDLES);
}

function logActiveHandles(label) {
  const proc = process;
  const handles = typeof proc._getActiveHandles === 'function' ? proc._getActiveHandles.call(proc) : [];
  const requests = typeof proc._getActiveRequests === 'function' ? proc._getActiveRequests.call(proc) : [];

  if (handles.length === 0 && requests.length === 0) {
    const suffix = label ? ` for ${label}` : '';
    console.info(`[apphub:test] No lingering handles${suffix}`);
    return;
  }

  const suffix = label ? ` for ${label}` : '';
  console.warn(`[apphub:test] Lingering handles detected${suffix}`);
  if (handles.length > 0) {
    console.warn(`[apphub:test] Active handles (${handles.length}):`, handles);
  }
  if (requests.length > 0) {
    console.warn(`[apphub:test] Active requests (${requests.length}):`, requests);
  }
}

function scheduleForcedExit(options = {}) {
  if (forceExitScheduled) {
    return;
  }
  forceExitScheduled = true;

  const { gracePeriodMs = 250, name } = options;
  const initialExitCode =
    typeof options.exitCode === 'number'
      ? options.exitCode
      : typeof process.exitCode === 'number'
        ? process.exitCode
        : 0;

  if (shouldLogHandles()) {
    logActiveHandles(name);
  }

  const timer = setTimeout(() => {
    if (shouldLogHandles()) {
      logActiveHandles(name);
    }
    const resolvedCode =
      typeof process.exitCode === 'number' ? process.exitCode : initialExitCode;
    process.exit(resolvedCode);
  }, Math.max(0, gracePeriodMs));
  timer.unref();
}

function resetForcedExitStateForTesting() {
  forceExitScheduled = false;
}

module.exports = {
  logActiveHandles,
  scheduleForcedExit,
  resetForcedExitStateForTesting
};
