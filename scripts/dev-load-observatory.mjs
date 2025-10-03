#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MODULE_DIR = path.join(ROOT_DIR, 'modules', 'environmental-observatory');

function resolveScratchPrefixes(current, moduleDir) {
  const scratchEntries = [moduleDir, path.join(moduleDir, 'dist')];
  const normalized = current?.trim();
  return normalized && normalized.length > 0
    ? `${normalized}:${scratchEntries.join(':')}`
    : scratchEntries.join(':');
}

function run() {
  if (!fs.existsSync(MODULE_DIR)) {
    console.error('[dev-load-observatory] Module directory not found at', MODULE_DIR);
    process.exitCode = 1;
    return;
  }

  const extraArgs = process.argv.slice(2);
  const resolvedModuleDir = path.resolve(MODULE_DIR);
  const runArgs = ['run', 'module:publish', '--', '--module', resolvedModuleDir];
  const hasRegisterFlag = extraArgs.some((arg) => arg === '--register-jobs' || arg === '--no-register-jobs');
  if (!hasRegisterFlag) {
    runArgs.push('--register-jobs');
  }
  runArgs.push(...extraArgs);

  const env = {
    ...process.env,
    APPHUB_SCRATCH_PREFIXES: resolveScratchPrefixes(process.env.APPHUB_SCRATCH_PREFIXES, resolvedModuleDir)
  };

  const label = path.relative(ROOT_DIR, resolvedModuleDir) || resolvedModuleDir;
  console.log(`[dev-load-observatory] Publishing module from ${label}`);

  const result = spawnSync('npm', runArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

try {
  run();
} catch (err) {
  console.error('[dev-load-observatory] Failed to publish module:', err?.message ?? err);
  process.exitCode = 1;
}
