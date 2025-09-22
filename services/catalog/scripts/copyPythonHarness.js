#!/usr/bin/env node
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'src', 'jobs', 'sandbox', 'pythonChild.py');
const destination = path.join(projectRoot, 'dist', 'jobs', 'sandbox', 'pythonChild.py');

if (!existsSync(source)) {
  console.error(`Python harness missing at ${source}`);
  process.exit(1);
}

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Copied Python harness to ${destination}`);
