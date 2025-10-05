import 'ts-node/register/transpile-only';

import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import type { EventData } from 'node:test';
import { runE2E } from '@apphub/test-helpers';
import { resetStagingWriteManager } from '../src/ingestion/stagingManager';
import { inspect } from 'node:util';
import { stopAllEmbeddedPostgres } from './utils/embeddedPostgres';

type TestEvent = {
  name: string;
  durationMs?: number;
  location?: { file?: string; line?: number; column?: number };
};

function formatLocation(event: TestEvent): string {
  const { file, line, column } = event.location ?? {};
  if (!file) {
    return '';
  }
  const parts = [path.relative(process.cwd(), file)];
  if (typeof line === 'number') {
    parts.push(String(line));
    if (typeof column === 'number') {
      parts.push(String(column));
    }
  }
  return parts.join(':');
}

runE2E(async () => {
  await stopAllEmbeddedPostgres();
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const entries = await readdir(testDir);
  const testFiles = entries
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => path.join(testDir, entry))
    .sort();

  if (testFiles.length === 0) {
    console.warn('[timestore] No test files found in', testDir);
    return;
  }

  const stream = run({ files: testFiles, concurrency: 1 });

  const failures: TestEvent[] = [];

  const handleWatcher = setInterval(() => {
    const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.();
    const requests = (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.();
    const totalHandles = handles?.length ?? 0;
    const totalRequests = requests?.length ?? 0;
    console.warn('[timestore:test-runner] periodic handle snapshot', {
      handles: totalHandles,
      requests: totalRequests,
      detail: handles && handles.length > 0
        ? handles.map((handle) => {
            const constructorName = (handle as { constructor?: { name?: string } }).constructor?.name ?? typeof handle;
            const summary: Record<string, unknown> = { constructorName };
            if (typeof (handle as { hasRef?: () => boolean }).hasRef === 'function') {
              summary.hasRef = (handle as { hasRef?: () => boolean }).hasRef!();
            }
            if (constructorName === 'Timeout' && typeof (handle as { _idleTimeout?: number })._idleTimeout === 'number') {
              summary.idleTimeout = (handle as { _idleTimeout?: number })._idleTimeout;
              summary.callback = inspect((handle as { _onTimeout?: unknown })._onTimeout, { depth: 1 });
            }
            if (constructorName === 'Immediate') {
              summary.callback = inspect((handle as { _onImmediate?: unknown })._onImmediate, { depth: 1 });
            }
            return summary;
          })
        : []
    });
  }, 5_000);
  if (typeof handleWatcher.unref === 'function') {
    handleWatcher.unref();
  }

  stream.on('test:pass', (event: EventData.TestPass) => {
    const location = formatLocation({ name: event.name, location: event });
    const duration = event.details?.duration_ms;
    const suffix = duration ? ` (${duration.toFixed(0)}ms)` : '';
    const locationLabel = location ? ` [${location}]` : '';
    console.info(`✓ ${event.name}${locationLabel}${suffix}`);
  });

  stream.on('test:fail', (event: EventData.TestFail) => {
    const location = formatLocation({ name: event.name, location: event });
    const duration = event.details?.duration_ms;
    const suffix = duration ? ` (${duration.toFixed(0)}ms)` : '';
    const locationLabel = location ? ` [${location}]` : '';
    console.error(`✖ ${event.name}${locationLabel}${suffix}`);
    if (event.details?.error) {
      console.error(event.details.error);
    }
    failures.push({
      name: event.name,
      durationMs: duration,
      location: event
    });
  });

  stream.on('test:diagnostic', (event: EventData.TestDiagnostic) => {
    const location = formatLocation({ name: event.message, location: event });
    const locationLabel = location ? ` [${location}]` : '';
    console.info(`ℹ ${event.message}${locationLabel}`);
  });

  await once(stream, 'close');

  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.();
  if (handles && handles.length > 0) {
    console.warn('[timestore:test-runner] active handles after tests', handles.map((handle) => {
      const constructorName = (handle as { constructor?: { name?: string } }).constructor?.name ?? typeof handle;
      const info: Record<string, unknown> = { constructorName };
      if (typeof (handle as { hasRef?: () => boolean }).hasRef === 'function') {
        info.hasRef = (handle as { hasRef?: () => boolean }).hasRef!();
      }
      if (constructorName === 'Timeout' && typeof (handle as { _onTimeout?: () => unknown })._onTimeout === 'function') {
        info.timer = 'timeout';
      }
      if (constructorName === 'Immediate') {
        info.timer = 'immediate';
      }
      return info;
    }));
  }

  await resetStagingWriteManager().catch((error) => {
    console.warn('[timestore] failed to reset staging manager during test shutdown', error);
  });
  clearInterval(handleWatcher);

  await forceCloseLingeringHandles();

  if (failures.length > 0) {
    const summary = failures
      .map((event) => {
        const location = formatLocation(event);
        const locationLabel = location ? ` (${location})` : '';
        return ` - ${event.name}${locationLabel}`;
      })
      .join('\n');
    throw new Error(`Test failures:\n${summary}`);
  }
  // Give any pending unref timers a chance to settle before forcing exit
  await sleep(10);
  if (typeof process.exit === 'function') {
    process.exit(0);
  }
});

async function forceCloseLingeringHandles(): Promise<void> {
  await stopAllEmbeddedPostgres();
  const getHandles = () => (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  let safety = 0;
  while (safety < 5) {
    const handles = getHandles();
    if (handles.length === 0) {
      break;
    }
    for (const handle of handles) {
      const constructorName = (handle as { constructor?: { name?: string } }).constructor?.name ?? typeof handle;
      try {
        if (constructorName === 'ChildProcess' && typeof (handle as { kill?: (signal?: string) => void }).kill === 'function') {
          console.warn('[timestore:test-runner] killing child process', inspect(handle, { depth: 1 }));
          (handle as { kill: (signal?: string) => void }).kill('SIGKILL');
          continue;
        }
        if (constructorName === 'Socket' && typeof (handle as { destroy?: () => void }).destroy === 'function') {
          (handle as { destroy: () => void }).destroy();
          continue;
        }
        if (constructorName === 'Server' && typeof (handle as { close?: (cb?: () => void) => void }).close === 'function') {
          await new Promise<void>((resolve) => {
            try {
              (handle as { close: (cb?: () => void) => void }).close(resolve);
            } catch (error) {
              resolve();
            }
          });
          continue;
        }
        if (constructorName === 'WriteStream' && typeof (handle as { end?: () => void }).end === 'function') {
          (handle as { end: () => void }).end();
          continue;
        }
      } catch (error) {
        console.warn('[timestore:test-runner] failed to close handle', { constructorName, error });
      }
    }
    await sleep(10);
    safety += 1;
  }
}
