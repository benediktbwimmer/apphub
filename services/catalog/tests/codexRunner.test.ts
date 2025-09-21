import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import './setupTestEnv';
import { runCodexGeneration } from '../src/ai/codexRunner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockDir = path.resolve(__dirname, 'fixtures/codex');

async function testMockWorkflowGeneration() {
  process.env.APPHUB_CODEX_MOCK_DIR = mockDir;
  const result = await runCodexGeneration({
    mode: 'workflow',
    operatorRequest: 'Create a sample workflow',
    metadataSummary: 'jobs: ai-orchestrator',
    additionalNotes: 'unit-test'
  });
  const expected = await readFile(path.join(mockDir, 'workflow.json'), 'utf8');
  assert.equal(result.output.trim(), expected.trim());
}

async function testMockJobGeneration() {
  process.env.APPHUB_CODEX_MOCK_DIR = mockDir;
  const result = await runCodexGeneration({
    mode: 'job',
    operatorRequest: 'Create a sample job',
    metadataSummary: 'jobs: ai-orchestrator'
  });
  const expected = await readFile(path.join(mockDir, 'job.json'), 'utf8');
  assert.equal(result.output.trim(), expected.trim());
}

async function run() {
  await testMockWorkflowGeneration();
  await testMockJobGeneration();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
