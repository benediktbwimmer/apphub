import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createTempDir } from './helpers';
import { loadOrScaffoldBundle } from '../src/lib/bundle';
import { readJsonFile, writeJsonFile } from '../src/lib/json';
import type { JobBundleManifest } from '../src/types';

test('loadOrScaffoldBundle enforces manifest schema', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-invalid-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const { context } = await loadOrScaffoldBundle(dir, {});
  const manifestPath = context.manifestPath;
  const manifest = await readJsonFile<JobBundleManifest>(manifestPath);
  manifest.entry = '';
  await writeJsonFile(manifestPath, manifest);

  await assert.rejects(async () => {
    await loadOrScaffoldBundle(dir, {});
  }, /Manifest validation failed/);
});
