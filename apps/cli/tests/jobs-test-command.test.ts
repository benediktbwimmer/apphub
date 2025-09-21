import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { createTempDir } from './helpers';
import { loadOrScaffoldBundle, buildBundle } from '../src/lib/bundle';
import { executeBundle } from '../src/lib/harness';
import type { JsonValue } from '../src/types';

test('executeBundle runs the generated handler', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-run-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const { context } = await loadOrScaffoldBundle(dir, {});
  await buildBundle(context);

  const parameters: JsonValue = { hello: 'world' };
  const execution = await executeBundle(context, parameters);
  assert.equal(execution.result.status ?? 'succeeded', 'succeeded');
  const jobResult = execution.result.result as { echoed?: { hello?: string } } | null;
  assert.equal(jobResult?.echoed?.hello, 'world');
});
