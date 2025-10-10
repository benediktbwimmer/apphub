import process from 'node:process';

import { scheduleForcedExit, logActiveHandles } from './forceExit';
import { stopAllEmbeddedPostgres } from './embeddedPostgres';

const DEFAULT_CLEANUP_TIMEOUT_MS = 60_000;

type CleanupHandler = () => void | Promise<void>;

type RunE2EContext = {
  registerCleanup: (handler: CleanupHandler) => void;
};

export type RunE2EOptions = {
  name?: string;
  gracePeriodMs?: number;
  cleanupTimeoutMs?: number;
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
  if (options.name) {
    console.info('[runE2E] Starting scenario', { name: options.name });
  } else {
    console.info('[runE2E] Starting scenario');
  }
  const cleanupHandlers: CleanupHandler[] = [
    async () => {
      await stopAllEmbeddedPostgres();
    }
  ];
  let exitCode = 0;
  let shutdownPromise: Promise<void> | null = null;
  let receivedSignal = false;

  const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = {
    SIGINT: 130,
    SIGTERM: 143
  };

  const signalHandlers = new Map<NodeJS.Signals, () => void>();

  const removeSignalHandlers = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };

  const context: RunE2EContext = {
    registerCleanup(handler: CleanupHandler) {
      cleanupHandlers.unshift(handler);
    }
  };

  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;

  const shutdown = async (code: number, reason: string): Promise<void> => {
    exitCode = Math.max(exitCode, code);
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    if (reason !== 'main completed' || exitCode !== 0) {
      console.info(`[runE2E] Shutting down (${reason}) with exit code ${exitCode}`);
    }

    const timeout = setTimeout(() => {
      const forcedCode = exitCode === 0 ? 1 : exitCode;
      console.error(`[runE2E] Cleanup timed out after ${cleanupTimeoutMs}ms; forcing exit (${forcedCode})`);
      process.exit(forcedCode);
    }, cleanupTimeoutMs);
    timeout.unref();

    shutdownPromise = (async () => {
      let cleanupFailed = false;

      try {
        cleanupFailed = await runCleanupHandlers(cleanupHandlers);
      } catch (error) {
        cleanupFailed = true;
        console.error('[runE2E] Unexpected error while executing cleanup handlers', error);
      } finally {
        clearTimeout(timeout);
      }

      if (cleanupFailed && exitCode === 0) {
        exitCode = 1;
      }

      removeSignalHandlers();

      if (process.env.APPHUB_E2E_DEBUG_HANDLES) {
        logActiveHandles(options.name);
      }

      process.exitCode = exitCode;
      scheduleForcedExit({
        exitCode,
        name: options.name,
        gracePeriodMs: options.gracePeriodMs
      });
    })();

    await shutdownPromise;
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    const code = signalExitCodes[signal] ?? 1;
    if (receivedSignal) {
      console.warn(`[runE2E] Received additional ${signal}; forcing immediate exit (${code})`);
      process.exit(code);
      return;
    }

    receivedSignal = true;
    console.warn(`[runE2E] Received ${signal}; beginning shutdown.`);

    void shutdown(code, `signal ${signal}`)
      .catch((error) => {
        console.error('[runE2E] Error during shutdown after signal', error);
        process.exit(code);
      })
      .finally(() => {
        process.exit(exitCode === 0 ? code : exitCode);
      });
  };

  for (const signal of Object.keys(signalExitCodes) as NodeJS.Signals[]) {
    const handler = handleSignal.bind(undefined, signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    await main(context);
    if (typeof process.exitCode === 'number') {
      exitCode = Math.max(exitCode, process.exitCode);
    }
  } catch (error) {
    exitCode = 1;
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(error);
    }
  } finally {
    if (typeof process.exitCode === 'number') {
      exitCode = Math.max(exitCode, process.exitCode);
    }
    console.info('[runE2E] main completed with exitCode', exitCode, 'process.exitCode', process.exitCode);
  }

  await shutdown(exitCode, 'main completed');

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  return new Promise<never>(() => {
    // Promise intentionally never resolves; forced exit terminates the process.
  });
}
