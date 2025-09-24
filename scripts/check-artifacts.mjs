import { execSync } from 'node:child_process';

const patterns = ['*.tgz', '*.tgz.sha256'];
const offenders = new Set();

for (const pattern of patterns) {
  const output = execSync(`git ls-files -z -- '${pattern}'`, { encoding: 'utf8' });
  if (!output) {
    continue;
  }
  for (const entry of output.split('\0')) {
    if (entry) {
      offenders.add(entry);
    }
  }
}

if (offenders.size > 0) {
  const list = Array.from(offenders).sort();
  console.error('Found generated bundle artifacts tracked in Git:');
  for (const file of list) {
    console.error(`  - ${file}`);
  }
  console.error('\nRemove these files; example bundles are packaged on demand during import.');
  process.exitCode = 1;
}
