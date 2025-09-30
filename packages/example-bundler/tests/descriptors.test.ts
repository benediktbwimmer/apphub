import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import simpleGit from 'simple-git';
import { ExampleBundler, type ExampleDescriptorReference } from '@apphub/example-bundler';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const descriptorModule = 'github.com/apphub/examples/environmental-observatory-event-driven';
const descriptorPath = 'examples/environmental-observatory-event-driven';
const descriptorSlug = 'observatory-data-generator';

function bundler(): ExampleBundler {
  return new ExampleBundler({ repoRoot });
}

test('packages local descriptor example', async () => {
  const result = await bundler().packageExampleByDescriptor({
    slug: descriptorSlug,
    descriptor: {
      module: descriptorModule,
      path: descriptorPath
    }
  });

  assert.equal(result.slug, descriptorSlug);
  assert.ok(result.fingerprint.length > 0, 'fingerprint should not be empty');
  assert.equal(typeof result.manifest.version, 'string');
});

test('packages descriptor from git repository clone', async () => {
  const tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'example-bundler-repo-'));
  try {
    const sourceDir = path.resolve(repoRoot, descriptorPath);
    const destinationDir = path.join(tempRepoRoot, descriptorPath);
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.cp(sourceDir, destinationDir, { recursive: true });

    const git = simpleGit(tempRepoRoot);
    await git.init();
    await git.add('.');
    await git.commit('initial commit');

    const tracked = await git.raw(['ls-files']);
    if (
      !tracked.includes(path.posix.join(descriptorPath, 'jobs/observatory-data-generator/tests/sample-input.json')) ||
      !tracked.includes(path.posix.join(descriptorPath, 'jobs/observatory-data-generator/src/index.ts'))
    ) {
      throw new Error('bundle sources were not tracked in temporary repository');
    }

    const gitDescriptor: ExampleDescriptorReference = {
      module: descriptorModule,
      repo: tempRepoRoot,
      configPath: path.join(descriptorPath, 'config.json')
    };

    const result = await bundler().packageExampleByDescriptor({
      slug: descriptorSlug,
      descriptor: gitDescriptor
    });

    assert.equal(result.slug, descriptorSlug);
    assert.ok(result.fingerprint.length > 0, 'fingerprint should not be empty');
  } finally {
    await fs.rm(tempRepoRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('includes declared runtime dependencies in packaged tarball', async () => {
  const bundle = await bundler().packageExampleBySlug('observatory-inbox-normalizer');
  const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-runtime-'));
  try {
    const tarballPath = path.join(extractRoot, bundle.filename);
    await fs.writeFile(tarballPath, bundle.buffer);
    await tar.x({ file: tarballPath, cwd: extractRoot });

    const bullmqPackagePath = path.join(
      extractRoot,
      'dist',
      'node_modules',
      'bullmq',
      'package.json'
    );
    let exists = false;
    try {
      await fs.stat(bullmqPackagePath);
      exists = true;
    } catch {
      exists = false;
    }

    assert.ok(exists, 'expected bullmq package.json in dist/node_modules/bullmq');
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
  }
});
