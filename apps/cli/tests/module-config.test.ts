import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { access, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { generateModuleConfig, validateModuleConfig } from '../src/lib/module';
import { readJsonFile } from '../src/lib/json';
import type { ModuleConfigFile } from '../src/lib/module';

const OBSERVATORY_MODULE_PATH = path.resolve(__dirname, '../../..', 'modules/environmental-observatory');
const SUITE_SCRATCH_ROOT = path.join(os.tmpdir(), 'apphub-cli-tests');
process.env.APPHUB_SCRATCH_ROOT = SUITE_SCRATCH_ROOT;
process.env.APPHUB_SCRATCH_PREFIXES = path.join(os.tmpdir(), 'apphub-cli-');

test('generateModuleConfig writes defaults and capability config', { concurrency: false }, async (t) => {
  const scratchRoot = path.join(SUITE_SCRATCH_ROOT, 'module-config');
  const tempDir = path.join(SUITE_SCRATCH_ROOT, 'tmp', randomUUID());
  await mkdir(tempDir, { recursive: true });
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  t.after(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  const outputPath = path.join(scratchRoot, 'config', 'observatory-config.json');
  const result = await generateModuleConfig({
    modulePath: OBSERVATORY_MODULE_PATH,
    definitionPath: 'dist/module.js',
    outputPath,
    scratchDir: scratchRoot,
    overwrite: true
  });

  assert.equal(result.outputPath, path.resolve(outputPath));
  await access(result.outputPath);

  const written = await readJsonFile<ModuleConfigFile>(result.outputPath);
  assert.equal(written.module.name, 'environmental-observatory');
  assert.equal(typeof written.settings, 'object');
  assert.equal(typeof written.secrets, 'object');
  assert.equal(typeof written.capabilities, 'object');
  assert.ok(Object.keys(written.capabilities).includes('filestore'));
  assert.ok(Object.keys(written.capabilities).includes('timestore'));
  assert.ok(path.isAbsolute(written.scratchDir));
  assert.ok(written.generatedAt.length > 0);
});

test('validateModuleConfig verifies capability wiring', { concurrency: false }, async (t) => {
  const scratchRoot = path.join(SUITE_SCRATCH_ROOT, 'module-doctor');
  const tempDir = path.join(SUITE_SCRATCH_ROOT, 'tmp', randomUUID());
  await mkdir(tempDir, { recursive: true });
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  t.after(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  const configPath = path.join(scratchRoot, 'config', 'observatory-config.json');
  await generateModuleConfig({
    modulePath: OBSERVATORY_MODULE_PATH,
    definitionPath: 'dist/module.js',
    outputPath: configPath,
    scratchDir: scratchRoot,
    overwrite: true
  });

  const result = await validateModuleConfig({
    modulePath: OBSERVATORY_MODULE_PATH,
    configPath,
    definitionPath: 'dist/module.js'
  });

  assert.equal(result.metadata.name, 'environmental-observatory');
  assert.ok(Object.keys(result.resolvedCapabilities).length > 0);
});
