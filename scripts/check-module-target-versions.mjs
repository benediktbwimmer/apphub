#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = result.stderr?.trim() ?? '';
    const message = stderr ? `${stderr} (exit ${result.status})` : `git ${args.join(' ')} exited with ${result.status}`;
    throw new Error(message);
  }
  return (result.stdout ?? '').trim();
}

function detectBaseRef() {
  const envOverride = process.env.APPHUB_VERSION_BASE?.trim();
  if (envOverride) {
    return envOverride;
  }
  try {
    const remotes = runGit(['remote']);
    if (remotes.split('\n').map((entry) => entry.trim()).includes('origin')) {
      const base = runGit(['merge-base', 'HEAD', 'origin/main']);
      if (base) {
        return base;
      }
    }
  } catch (error) {
    // fall through to alternate strategies
    if (process.env.CI) {
      console.warn('[check-module-target-versions] Failed to locate origin/main:', error.message ?? error);
    }
  }
  try {
    const headParent = runGit(['rev-parse', 'HEAD^']);
    if (headParent) {
      return headParent;
    }
  } catch (error) {
    console.warn('[check-module-target-versions] Unable to determine git base reference:', error.message ?? error);
  }
  return null;
}

function listChangedModuleFiles(baseRef) {
  const diff = runGit(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--', 'modules']);
  if (!diff) {
    return [];
  }
  return diff
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
    .filter((entry) => !entry.endsWith('.d.ts'));
}

function hasSubstantiveChange(baseRef, filePath) {
  const patch = runGit(['diff', '--unified=0', `${baseRef}...HEAD`, '--', filePath]);
  if (!patch) {
    return false;
  }
  const lines = patch.split('\n');
  for (const line of lines) {
    if (!line || line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    const indicator = line[0];
    if (indicator !== '+' && indicator !== '-') {
      continue;
    }
    const content = line.slice(1).trim();
    if (!content) {
      continue;
    }
    if (/^\/\//.test(content) || /^\*\*/.test(content)) {
      // skip comment-only edits
      continue;
    }
    if (/^version\s*:/.test(content) || content.includes(' version:')) {
      continue;
    }
    if (/^import\s+['"].+['"];?$/.test(content)) {
      // treat pure import churn as substantive to encourage version bumps
      return true;
    }
    return true;
  }
  return false;
}

function hasVersionLineChange(baseRef, filePath) {
  const patch = runGit(['diff', '--unified=0', `${baseRef}...HEAD`, '--', filePath]);
  if (!patch) {
    return false;
  }
  const lines = patch.split('\n');
  return lines.some((line) => {
    if (!line || line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
      return false;
    }
    const indicator = line[0];
    if (indicator !== '+' && indicator !== '-') {
      return false;
    }
    const content = line.slice(1);
    return /\bversion\s*:/.test(content);
  });
}

const moduleVersionCache = new Map();

function extractModuleVersion(content) {
  if (!content) {
    return null;
  }
  const metadataMatch = content.match(/metadata\s*:\s*{[\s\S]*?version\s*:\s*['"]([^'"\n]+)['"]/);
  if (metadataMatch) {
    return metadataMatch[1];
  }
  const genericMatch = content.match(/version\s*:\s*['"]([^'"\n]+)['"]/);
  return genericMatch ? genericMatch[1] : null;
}

function didModuleVersionChange(baseRef, moduleDir) {
  if (moduleVersionCache.has(moduleDir)) {
    return moduleVersionCache.get(moduleDir);
  }
  const moduleFile = path.join(moduleDir, 'module.ts');
  let currentContent = null;
  if (fs.existsSync(moduleFile)) {
    currentContent = fs.readFileSync(moduleFile, 'utf8');
  }
  let baseContent = null;
  try {
    baseContent = runGit(['show', `${baseRef}:${moduleFile.replace(/\\/g, '/')}`]);
  } catch {
    baseContent = null;
  }
  if (baseContent === null || currentContent === null) {
    moduleVersionCache.set(moduleDir, true);
    return true;
  }
  const currentVersion = extractModuleVersion(currentContent);
  const baseVersion = extractModuleVersion(baseContent);
  const changed = currentVersion !== baseVersion;
  moduleVersionCache.set(moduleDir, changed);
  return changed;
}

function findModuleDir(filePath) {
  const segments = filePath.split(path.sep);
  if (segments.length < 2 || segments[0] !== 'modules') {
    return null;
  }
  return path.join(segments[0], segments[1]);
}

function main() {
  try {
    if (process.env.APPHUB_SKIP_VERSION_CHECK === '1') {
      console.warn('[check-module-target-versions] Skipping version check via APPHUB_SKIP_VERSION_CHECK');
      return;
    }
    const baseRef = detectBaseRef();
    if (!baseRef) {
      console.warn('[check-module-target-versions] Skipping check (no git base reference found).');
      return;
    }

    const files = listChangedModuleFiles(baseRef);
    if (files.length === 0) {
      return;
    }

    const offenders = [];

    for (const file of files) {
      const moduleDir = findModuleDir(file);
      if (!moduleDir) {
        continue;
      }

      if (!hasSubstantiveChange(baseRef, file)) {
        continue;
      }

      if (hasVersionLineChange(baseRef, file)) {
        continue;
      }

      if (didModuleVersionChange(baseRef, moduleDir)) {
        continue;
      }

      offenders.push({ file, moduleDir });
    }

    if (offenders.length > 0) {
      console.error('\n[check-module-target-versions] Missing target version bump detected:');
      for (const offender of offenders) {
        console.error(`  - ${offender.file} (module: ${offender.moduleDir})`);
      }
      console.error('\nUpdate the target\'s version (or the module metadata version if it inherits the default) before committing.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[check-module-target-versions] Failed:', error.message ?? error);
    process.exitCode = 1;
  }
}

main();
