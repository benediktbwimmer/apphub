#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

let concurrently;
try {
  concurrently = require('concurrently');
} catch (err) {
  console.error('[dev-services] Failed to load "concurrently". Install it with `npm install` at repo root.');
  process.exit(1);
}

const ROOT_DIR = path.resolve(__dirname, '..');

function resolveManifestPaths() {
  const cliArgs = process.argv.slice(2).filter(Boolean);
  const defaults = ['examples/environmental-observatory/service-manifests/service-manifest.json'];
  const entries = cliArgs.length > 0 ? cliArgs : defaults;
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const resolved = path.isAbsolute(entry) ? entry : path.resolve(ROOT_DIR, entry);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    deduped.push(resolved);
  }
  return deduped;
}

function readManifest(filePath) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(contents);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.services)) {
      return parsed.services;
    }
    console.warn(`[dev-services] Manifest ${filePath} does not include a "services" array.`);
    return [];
  } catch (err) {
    console.warn(`[dev-services] Failed to read manifest ${filePath}: ${(err && err.message) || err}`);
    return [];
  }
}

function loadServiceDefinitions() {
  const paths = resolveManifestPaths();
  const definitions = new Map();
  for (const manifestPath of paths) {
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const entries = readManifest(manifestPath);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const slug = typeof entry.slug === 'string' ? entry.slug.trim().toLowerCase() : '';
      if (!slug) {
        continue;
      }
      const existing = definitions.get(slug) ?? {};
      definitions.set(slug, {
        ...existing,
        ...entry,
        slug
      });
    }
  }
  return Array.from(definitions.values());
}

function buildCommands(definitions) {
  const commands = [];
  for (const definition of definitions) {
    const devCommand = typeof definition.devCommand === 'string' ? definition.devCommand.trim() : '';
    const workingDir = typeof definition.workingDir === 'string' ? definition.workingDir.trim() : '';
    if (!devCommand || !workingDir) {
      continue;
    }
    const absWorkingDir = path.isAbsolute(workingDir)
      ? workingDir
      : path.resolve(ROOT_DIR, workingDir);
    const manifestEnv = Array.isArray(definition.env)
      ? definition.env
          .filter((entry) => entry && typeof entry.key === 'string')
          .reduce((acc, entry) => {
            const key = entry.key.trim();
            if (!key) {
              return acc;
            }
            if (typeof entry.value === 'string') {
              acc[key] = entry.value;
            }
            return acc;
          }, {})
      : {};
    commands.push({
      name: definition.slug,
      command: devCommand,
      cwd: absWorkingDir,
      env: { ...process.env, ...manifestEnv }
    });
  }
  return commands;
}

async function main() {
  const definitions = loadServiceDefinitions();
  const commands = buildCommands(definitions);

  if (commands.length === 0) {
    console.log('[dev-services] No service dev commands defined in manifest.');
    return;
  }

  const run = concurrently(commands, {
    killOthersOn: ['failure', 'success'],
    prefix: 'name',
    restartTries: 0,
    cwd: ROOT_DIR
  });

  const terminate = (signal) => {
    for (const command of run.commands ?? []) {
      if (command && typeof command.kill === 'function') {
        try {
          command.kill(signal);
        } catch (err) {
          if (err && err.code !== 'ESRCH') {
            console.warn(`[dev-services] Failed to propagate ${signal} to ${command.name ?? 'command'}: ${err.message ?? err}`);
          }
        }
      }
    }
  };

  process.on('SIGINT', () => terminate('SIGINT'));
  process.on('SIGTERM', () => terminate('SIGTERM'));

  try {
    await run.result;
  } catch (err) {
    if (Array.isArray(err)) {
      const failed = err
        .filter((event) => event && event.exitCode !== 0)
        .map((event) => {
          const command = run.commands[event.index];
          return command?.name || command?.command || `command-${event.index}`;
        });
      if (failed.length > 0) {
        console.error(`[dev-services] Service command failed: ${failed.join(', ')}`);
      }
    } else {
      console.error('[dev-services] Unexpected error while running services', err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[dev-services] Unexpected error', err);
  process.exit(1);
});
