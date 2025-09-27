import 'ts-node/register/transpile-only';

import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import type { EventData } from 'node:test';
import { runE2E } from '@apphub/test-helpers';

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
});
