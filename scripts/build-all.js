#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const tsxShimDir = path.join(rootDir, 'scripts', 'bin');

const workspaces = [
  { path: 'services/core', name: '@apphub/core' },
  { path: 'services/filestore', name: '@apphub/filestore' },
  { path: 'services/metastore', name: '@apphub/metastore' },
  { path: 'services/secrets', name: '@apphub/secrets' },
  { path: 'apps/frontend', name: '@apphub/frontend' },
  { path: 'apps/cli', name: '@apphub/cli' },
  { path: 'packages/shared', name: '@apphub/shared' },
  { path: 'packages/module-registry', name: '@apphub/module-registry' },
  { path: 'packages/module-sdk', name: '@apphub/module-sdk' },
  { path: 'packages/filestore-client', name: '@apphub/filestore-client' },
  { path: 'packages/event-bus', name: '@apphub/event-bus' }
];

const scriptMappings = {
  'test': {
    'services/core': 'test:e2e'
  }
};

function runScriptInWorkspace(workspacePath, scriptName) {
  const packageJsonPath = path.join(rootDir, workspacePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    console.log(`Skipping ${workspacePath} - no package.json found`);
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  let actualScriptName = scriptName;
  if (scriptMappings[scriptName] && scriptMappings[scriptName][workspacePath]) {
    actualScriptName = scriptMappings[scriptName][workspacePath];
  }

  if (!packageJson.scripts || !packageJson.scripts[actualScriptName]) {
    console.log(`Skipping ${workspacePath} - no ${actualScriptName} script found`);
    return;
  }

  console.log(`Running ${actualScriptName} in ${workspacePath}...`);
  try {
    const env = { ...process.env };
    env.PATH = env.PATH ? `${tsxShimDir}${path.delimiter}${env.PATH}` : tsxShimDir;
    // Use --no-workspaces to prevent npm from trying to run the script in all workspaces
    execSync(`npm run ${actualScriptName} --no-workspaces`, {
      cwd: path.join(rootDir, workspacePath),
      stdio: 'inherit',
      env
    });
    console.log(`✓ Successfully completed ${actualScriptName} in ${workspacePath}`);
  } catch (error) {
    console.error(`✗ Failed to run ${actualScriptName} in ${workspacePath}`);
    return false;
  }
  return true;
}

function main() {
  const scriptName = process.argv[2];
  if (!scriptName) {
    console.error('Usage: node build-all.js <script-name>');
    process.exit(1);
  }

  console.log(`Running ${scriptName} across all workspaces...`);

  const results = [];
  for (const workspace of workspaces) {
    const result = runScriptInWorkspace(workspace.path, scriptName);
    if (result !== undefined) {
      results.push({ workspace: workspace.path, success: result });
    }
  }

  console.log(`\nSummary for ${scriptName}:`);
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✓ Successful: ${successful.length}`);
  if (successful.length > 0) {
    successful.forEach(r => console.log(`  - ${r.workspace}`));
  }

  if (failed.length > 0) {
    console.log(`✗ Failed: ${failed.length}`);
    failed.forEach(r => console.log(`  - ${r.workspace}`));
    process.exit(1);
  }

  console.log(`\nFinished running ${scriptName} across all workspaces.`);
}

main();
