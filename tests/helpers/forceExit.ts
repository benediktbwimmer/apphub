import process from 'node:process';

export type ForcedExitOptions = {
  exitCode?: number;
  name?: string;
  gracePeriodMs?: number;
};

type ProcessWithIntrospection = NodeJS.Process & {
  _getActiveHandles?: () => unknown[];
  _getActiveRequests?: () => unknown[];
};

let forceExitScheduled = false;

function shouldLogHandles(): boolean {
  return Boolean(process.env.APPHUB_TEST_DEBUG_HANDLES ?? process.env.APPHUB_E2E_DEBUG_HANDLES);
}

export function logActiveHandles(label?: string): void {
  const proc = process as ProcessWithIntrospection;
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

export function scheduleForcedExit(options: ForcedExitOptions = {}): void {
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
  // Do not keep the event loop alive if nothing else is pending.
  timer.unref();
}

export function resetForcedExitStateForTesting(): void {
  forceExitScheduled = false;
}
