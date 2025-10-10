import 'ts-node/register/transpile-only';

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runE2E } from '@apphub/test-helpers';
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

  const failures: TestEvent[] = [];
  let hasFailures = false;
  for (const testFile of testFiles) {
    const relativePath = path.relative(process.cwd(), testFile);
    console.info(`[timestore:test-runner] running ${relativePath}`);

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', testFile],
      {
        stdio: 'inherit',
        env: {
          ...process.env
        }
      }
    );

    const [exitCode, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
    if (exitCode !== 0) {
      hasFailures = true;
      process.exitCode = Math.max(typeof process.exitCode === 'number' ? process.exitCode : 0, exitCode ?? 1);
      failures.push({
        name: relativePath,
        durationMs: undefined,
        location: { file: testFile }
      });
      console.error('[timestore:test-runner] test failed', { file: relativePath, exitCode, signal });
    } else {
      console.info(`[timestore:test-runner] completed ${relativePath}`);
    }
  }

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

  await forceCloseLingeringHandles();

  if (hasFailures || failures.length > 0) {
    process.exitCode = Math.max(typeof process.exitCode === 'number' ? process.exitCode : 0, 1);
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
  process.exit(hasFailures ? 1 : 0);
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
