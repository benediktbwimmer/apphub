#!/usr/bin/env node
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const filesToCopy = [
  {
    source: path.join(projectRoot, 'src', 'jobs', 'sandbox', 'pythonChild.py'),
    destination: path.join(projectRoot, 'dist', 'jobs', 'sandbox', 'pythonChild.py'),
    description: 'Python sandbox harness'
  },
  {
    source: path.join(projectRoot, 'src', 'jobs', 'snippets', 'pythonSnippetAnalyzer.py'),
    destination: path.join(projectRoot, 'dist', 'jobs', 'snippets', 'pythonSnippetAnalyzer.py'),
    description: 'Python snippet analyzer'
  }
];

for (const { source, destination, description } of filesToCopy) {
  if (!existsSync(source)) {
    console.error(`${description} missing at ${source}`);
    process.exit(1);
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  console.log(`Copied ${description.toLowerCase()} to ${destination}`);
}
