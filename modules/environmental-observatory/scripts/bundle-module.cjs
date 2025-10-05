#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs/promises');
const { build } = require('esbuild');

async function main() {
  const moduleRoot = path.resolve(__dirname, '..');
  const distDir = path.join(moduleRoot, 'dist');
  const entryPath = path.join(distDir, 'module.js');
  const artifactPath = path.join(distDir, 'module.artifact.js');

  await ensureFile(entryPath, 'Module entrypoint not found. Did you run "tsc -b" first?');

  await build({
    entryPoints: [entryPath],
    outfile: artifactPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node18'],
    logLevel: 'silent',
    sourcemap: false,
    minify: true,
    external: ['@apphub/module-sdk', '@apphub/module-registry', '@apphub/filestore-client', 'undici']
  });
}

async function ensureFile(filePath, message) {
  try {
    await fs.access(filePath);
  } catch (error) {
    const err = new Error(message);
    err.cause = error;
    throw err;
  }
}

main().catch((error) => {
  console.error('[bundle-module]', error);
  process.exitCode = 1;
});
