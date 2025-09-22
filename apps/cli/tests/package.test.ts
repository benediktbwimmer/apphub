import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import tar from 'tar';
import { test } from 'node:test';
import { createTempDir } from './helpers';
import { loadOrScaffoldBundle, packageBundle } from '../src/lib/bundle';
import { readJsonFile, writeJsonFile } from '../src/lib/json';
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

test('packageBundle stages python sources', { concurrency: false }, async (t) => {
  const dir = await createTempDir('apphub-cli-python-package-');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const initial = await loadOrScaffoldBundle(dir, {});
  const manifest = await readJsonFile<JobBundleManifest>(initial.context.manifestPath);
  manifest.runtime = 'python';
  manifest.pythonEntry = 'src/main.py';
  (manifest as Record<string, unknown>).entry = undefined;
  await writeJsonFile(initial.context.manifestPath, manifest);

  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'src', 'main.py'),
    [
      "async def handler(context):",
      "    context.logger('python-package', {'parameters': context.parameters})",
      "    return {'status': 'succeeded', 'result': {'echoed': context.parameters}}",
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(dir, 'src', 'util.py'), "VALUE = 42\n", 'utf8');
  await writeFile(path.join(dir, 'requirements.txt'), 'aiohttp==3.10.5\n', 'utf8');

  const { context } = await loadOrScaffoldBundle(dir, {});
  const result = await packageBundle(context, { force: true });

  const entries = await listTarEntries(result.tarballPath);
  assert(entries.includes('src/main.py'));
  assert(entries.includes('src/util.py'));
  assert(entries.includes('requirements.txt'));
  assert.equal(result.manifest.runtime, 'python');
  assert.equal(result.manifest.pythonEntry, 'src/main.py');
});
