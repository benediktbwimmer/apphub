import process from 'node:process';

type CleanupHandler = () => void | Promise<void>;

type RunE2EContext = {
  registerCleanup: (handler: CleanupHandler) => void;
};

export type RunE2EOptions = {
  name?: string;
};

type ProcessWithHandles = NodeJS.Process & {
  _getActiveHandles?: () => unknown[];
  _getActiveRequests?: () => unknown[];
};

function logLingeringHandles(name?: string): void {
  const proc = process as ProcessWithHandles;
  const getHandles = typeof proc._getActiveHandles === 'function' ? proc._getActiveHandles.bind(proc) : null;
  const getRequests =
    typeof proc._getActiveRequests === 'function' ? proc._getActiveRequests.bind(proc) : null;

  if (!getHandles && !getRequests) {
    console.warn('[runE2E] Active handle introspection unavailable');
    return;
  }

  const handles = getHandles ? getHandles() : [];
  const requests = getRequests ? getRequests() : [];
  const label = name ? ` for ${name}` : '';

  if (handles.length === 0 && requests.length === 0) {
    console.info(`[runE2E] No lingering handles${label}`);
    return;
  }

  console.warn(`[runE2E] Lingering handles detected${label}`);
  if (handles.length > 0) {
    console.warn(`[runE2E] Active handles (${handles.length}):`, handles);
  }
  if (requests.length > 0) {
    console.warn(`[runE2E] Active requests (${requests.length}):`, requests);
  }
}

async function runCleanupHandlers(handlers: CleanupHandler[]): Promise<boolean> {
  let encounteredFailure = false;
  for (const handler of handlers) {
    try {
      await handler();
    } catch (error) {
      encounteredFailure = true;
      console.error('[runE2E] Cleanup handler failed', error);
    }
  }
  return encounteredFailure;
}

export async function runE2E(
  main: (context: RunE2EContext) => void | Promise<void>,
  options: RunE2EOptions = {}
): Promise<never> {
  const cleanupHandlers: CleanupHandler[] = [];
  let exitCode = 0;

  const context: RunE2EContext = {
    registerCleanup(handler: CleanupHandler) {
      cleanupHandlers.unshift(handler);
    }
  };

  try {
    await main(context);
  } catch (error) {
    exitCode = 1;
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(error);
    }
  }

  const cleanupFailed = await runCleanupHandlers(cleanupHandlers);
  if (cleanupFailed) {
    exitCode = 1;
  }

  if (process.env.APPHUB_E2E_DEBUG_HANDLES) {
    logLingeringHandles(options.name);
  }

  process.exit(exitCode);
}
