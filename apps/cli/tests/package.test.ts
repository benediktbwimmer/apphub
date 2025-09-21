import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import tar from 'tar';
import { test } from 'node:test';
import { createTempDir } from './helpers';
import { loadOrScaffoldBundle, packageBundle } from '../src/lib/bundle';
import { readJsonFile } from '../src/lib/json';
import type { BundleConfig, JobBundleManifest } from '../src/types';

async function listTarEntries(tarball: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.list({
    file: tarball,
    onentry(entry) {
      entries.push(entry.path);
    }
  });
  return entries;
}

test('packageBundle builds artifacts and checksum', { concurrency: false }, async (t) => {
  const dir = await createTempDir();
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const { context } = await loadOrScaffoldBundle(dir, {});
  const result = await packageBundle(context, { force: true });

  const config = await readJsonFile<BundleConfig>(path.join(dir, 'apphub.bundle.json'));
  const manifest = await readJsonFile<JobBundleManifest>(path.join(dir, context.config.manifestPath));

  assert.equal(result.config.slug, config.slug);
  assert.equal(result.manifest.version, manifest.version);

  const distPath = path.resolve(dir, manifest.entry);
  await access(distPath);

  const tarball = result.tarballPath;
  await access(tarball);
  await access(`${tarball}.sha256`);

  const entries = await listTarEntries(tarball);
  assert(entries.includes('manifest.json'));
  assert(entries.some((entry) => entry.startsWith('dist/')));

  const checksumFile = await readFile(`${tarball}.sha256`, 'utf8');
  assert.ok(checksumFile.includes(result.checksum));
});
