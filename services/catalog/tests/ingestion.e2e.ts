import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

type IngestionEvent = {
  id: number;
  status: string;
  message: string | null;
  attempt: number | null;
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
};

const exec = promisify(execCallback);

const CATALOG_ROOT = path.resolve(__dirname, '..');

async function waitForServer(baseUrl: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return;
      }
    } catch (err) {
      // wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become healthy in time');
}

async function pollApp(baseUrl: string, id: string, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/apps/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch app: ${res.status}`);
    }
    const payload = await res.json();
    const app = payload.data;
    if (app?.ingestStatus === 'ready') {
      return app;
    }
    if (app?.ingestStatus === 'failed') {
      throw new Error(`Ingestion failed: ${app.ingestError}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for ingestion to complete');
}

async function createLocalRepo(root: string) {
  const repoDir = path.join(root, 'repo');
  await exec(`git init ${repoDir}`);
  await exec('git config user.name "Test User"', { cwd: repoDir });
  await exec('git config user.email "test@example.com"', { cwd: repoDir });

  const dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY package.json package.json\nRUN npm install\nCMD [\"npm\", \"start\"]\n`;
  const packageJson = {
    name: 'apphub-e2e',
    version: '0.0.1',
    scripts: { start: 'node index.js' }
  };
  await writeFile(path.join(repoDir, 'Dockerfile'), dockerfile, 'utf8');
  await writeFile(path.join(repoDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');
  await writeFile(path.join(repoDir, 'index.js'), 'console.log("hello apphub")\n', 'utf8');

  await exec('git add .', { cwd: repoDir });
  await exec('git commit -m "Initial commit"', { cwd: repoDir });

  const commit = (await exec('git rev-parse HEAD', { cwd: repoDir })).stdout.trim();
  return { repoDir, commit };
}

async function run() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'apphub-e2e-'));
  const dbPath = path.join(tempRoot, 'catalog.db');
  const port = 4200 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;

  const envBase = {
    ...process.env,
    NODE_ENV: 'test',
    CATALOG_DB_PATH: dbPath,
    REDIS_URL: 'inline',
    INGEST_QUEUE_NAME: 'apphub_e2e',
    PORT: String(port),
    HOST: '127.0.0.1'
  };

  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: CATALOG_ROOT,
    env: envBase,
    stdio: 'inherit'
  });

  try {
    await waitForServer(baseUrl);

    const worker = spawn('npx', ['tsx', 'src/ingestionWorker.ts'], {
      cwd: CATALOG_ROOT,
      env: envBase,
      stdio: 'inherit'
    });

    try {
      const { repoDir, commit } = await createLocalRepo(tempRoot);
      const repoUrl = repoDir;
      const appId = `repo-${Date.now()}`;

      const createRes = await fetch(`${baseUrl}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: appId,
          name: 'E2E App',
          description: 'End-to-end test application',
          repoUrl,
          dockerfilePath: 'Dockerfile',
          tags: [{ key: 'language', value: 'javascript' }]
        })
      });

      assert.equal(createRes.status, 201, 'Expected app creation to succeed');

      const app = await pollApp(baseUrl, appId);
      assert.equal(app.ingestStatus, 'ready');
      assert.equal(app.ingestAttempts > 0, true);

      const historyRes = await fetch(`${baseUrl}/apps/${appId}/history`);
      assert.equal(historyRes.status, 200, 'History endpoint should respond');
      const historyPayload = await historyRes.json();
      const events = historyPayload.data as IngestionEvent[];
      assert(events.length >= 3, 'Expected at least queue/start/success events');
      const readyEvent = events.find((e) => e.status === 'ready');
      assert(readyEvent, 'Expected ready event in history');
      assert(readyEvent?.commitSha?.toLowerCase().startsWith(commit.slice(0, 8).toLowerCase()), 'Commit SHA should match cloned repo');
      assert.equal(typeof readyEvent?.durationMs, 'number');
      assert((readyEvent?.durationMs ?? 0) >= 0);
    } finally {
      worker.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
