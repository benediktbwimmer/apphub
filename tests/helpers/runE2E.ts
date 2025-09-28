import process from 'node:process';

import { scheduleForcedExit, logActiveHandles } from './forceExit';

type CleanupHandler = () => void | Promise<void>;

type RunE2EContext = {
  registerCleanup: (handler: CleanupHandler) => void;
};

export type RunE2EOptions = {
  name?: string;
  gracePeriodMs?: number;
};

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
    logActiveHandles(options.name);
  }

  process.exitCode = exitCode;
  scheduleForcedExit({
    exitCode,
    name: options.name,
    gracePeriodMs: options.gracePeriodMs
  });

  return new Promise<never>(() => {
    // Promise intentionally never resolves; forced exit terminates the process.
  });
}
