import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

try {
  execSync('node scripts/generate-openapi-clients.mjs', {
    cwd: rootDir,
    stdio: 'inherit'
  });
} catch (error) {
  console.error('Failed to regenerate OpenAPI clients.');
  process.exitCode = 1;
  throw error;
}

const diff = execSync('git status --porcelain=1 packages/shared/src/api', {
  cwd: rootDir,
  encoding: 'utf8'
}).trim();

const pending = diff
  .split('\n')
  .filter((line) => line.trim().length > 0 && line[0] !== 'A');

if (pending.length > 0) {
  console.warn('OpenAPI client artifacts were regenerated and now differ from the worktree:');
  console.warn(pending.join('\n'));
  console.warn('Run `npm run generate:openapi-clients` if you need to refresh them manually.');
}
