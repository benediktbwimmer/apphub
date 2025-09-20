import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const exec = promisify(execCallback);

const CATALOG_ROOT = path.resolve(__dirname, '..');
const REAL_REPO_PATH = process.env.APPHUB_E2E_REAL_REPO;
const REAL_REPO_GIT_URL =
  process.env.APPHUB_E2E_REAL_REPO_URL ?? 'https://github.com/benediktbwimmer/better-fileexplorer.git';

const APP_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 20_000;

type IngestionEvent = {
  id: number;
  status: string;
  message: string | null;
  attempt: number | null;
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
};

type TagPair = { key: string; value: string };

type BuildSummary = {
  id: string;
  status: string;
  imageTag: string | null;
  errorMessage: string | null;
  logs?: string | null;
};

type LaunchEnvVar = { key: string; value: string };

type LaunchSummary = {
  id: string;
  status: string;
  instanceUrl: string | null;
  errorMessage: string | null;
  port: number | null;
  resourceProfile: string | null;
  buildId: string;
  env: LaunchEnvVar[];
};

type RepositorySummary = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  ingestStatus: string;
  ingestError: string | null;
  ingestAttempts: number;
  tags: TagPair[];
  latestBuild: BuildSummary | null;
  latestLaunch: LaunchSummary | null;
};

type FakeDockerPaths = {
  binDir: string;
  stateDir: string;
};

type CatalogTestContext = {
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  tempRoot: string;
  server: ChildProcess;
  worker: ChildProcess;
  fakeDocker: FakeDockerPaths;
};

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await delay(250);
  }
  throw new Error('Server did not become healthy in time');
}

async function pollRepository(
  baseUrl: string,
  id: string,
  desiredStatus: 'ready' | 'stopped' | 'processing' = 'ready',
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RepositorySummary> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/apps/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch repository: ${res.status}`);
    }
    const payload = (await res.json()) as { data: RepositorySummary };
    const repository = payload.data;
    if (!repository) {
      throw new Error('Repository payload missing');
    }
    if (repository.ingestStatus === 'failed') {
      throw new Error(`Ingestion failed: ${repository.ingestError ?? 'unknown error'}`);
    }
    if (repository.ingestStatus === desiredStatus) {
      return repository;
    }
    await delay(APP_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for repository ${id} to reach status ${desiredStatus}`);
}

async function pollLaunch(
  baseUrl: string,
  repositoryId: string,
  launchId: string,
  desiredStatus: 'running' | 'stopped',
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<LaunchSummary> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/apps/${repositoryId}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch repository for launch polling: ${res.status}`);
    }
    const payload = (await res.json()) as { data: RepositorySummary };
    const repo = payload.data;
    const launch = repo?.latestLaunch;
    if (launch?.id === launchId) {
      if (launch.status === 'failed') {
        throw new Error(`Launch failed: ${launch.errorMessage ?? 'unknown error'}`);
      }
      if (launch.status === desiredStatus) {
        return launch;
      }
    }
    await delay(APP_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for launch ${launchId} to reach status ${desiredStatus}`);
}

async function pollLatestBuild(
  baseUrl: string,
  repositoryId: string,
  desiredStatus: 'pending' | 'running' | 'succeeded' | 'failed',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  expectedBuildId?: string | null
): Promise<BuildSummary> {
  const start = Date.now();
  let targetBuildId = expectedBuildId ?? null;
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/apps/${repositoryId}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch repository for build polling: ${res.status}`);
    }
    const payload = (await res.json()) as { data: RepositorySummary };
    const repo = payload.data;
    const latestBuild = repo?.latestBuild;
    if (!latestBuild) {
      await delay(APP_POLL_INTERVAL_MS);
      continue;
    }

    if (targetBuildId && latestBuild.id !== targetBuildId) {
      await delay(APP_POLL_INTERVAL_MS);
      continue;
    }
    if (!targetBuildId) {
      targetBuildId = latestBuild.id;
    }

    if (latestBuild.status === 'failed') {
      throw new Error(`Build failed: ${latestBuild.errorMessage ?? 'unknown error'}`);
    }
    if (latestBuild.status === desiredStatus) {
      return latestBuild;
    }

    await delay(APP_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for build on ${repositoryId} to reach status ${desiredStatus}`
  );
}

async function fetchHistory(baseUrl: string, repositoryId: string) {
  const res = await fetch(`${baseUrl}/apps/${repositoryId}/history`);
  if (!res.ok) {
    throw new Error(`Failed to fetch history: ${res.status}`);
  }
  const payload = (await res.json()) as { data: IngestionEvent[] };
  return payload.data;
}

async function collectBuildLogs(baseUrl: string, buildId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/builds/${buildId}/logs`);
  if (!res.ok) {
    throw new Error(`Failed to fetch build logs: ${res.status}`);
  }
  const payload = (await res.json()) as { data: BuildSummary };
  return payload.data.logs ?? '';
}

async function createFakeDocker(tempRoot: string): Promise<FakeDockerPaths> {
  const root = path.join(tempRoot, 'fake-docker');
  const binDir = path.join(root, 'bin');
  const stateDir = path.join(root, 'state');
  await mkdir(binDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const scriptPath = path.join(binDir, 'docker');
  const script = `#!/usr/bin/env node\nconst fs = require('fs');\nconst path = require('path');\nconst crypto = require('crypto');\n\nconst stateDir = process.env.APPHUB_FAKE_DOCKER_STATE;\nif (!stateDir) {\n  console.error('APPHUB_FAKE_DOCKER_STATE is not configured');\n  process.exit(1);\n}\n\nif (process.argv.length < 3) {\n  console.error('No docker command provided');\n  process.exit(1);\n}\n\nconst command = process.argv[2];\nconst args = process.argv.slice(3);\n\nfs.mkdirSync(stateDir, { recursive: true });\n\nfunction statePath(id) {\n  return path.join(stateDir, id + '.json');\n}\n\nfunction readState(id) {\n  try {\n    return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));\n  } catch {\n    return null;\n  }\n}\n\nfunction writeState(id, data) {\n  fs.writeFileSync(statePath(id), JSON.stringify(data));\n}\n\nfunction removeState(id) {\n  try {\n    fs.unlinkSync(statePath(id));\n  } catch {\n    /* noop */\n  }\n}\n\nswitch (command) {\n  case 'build': {\n    console.log('[fake-docker] build success');\n    process.exit(0);\n  }\n  case 'run': {\n    let containerPort = '3000';\n    let containerName = 'apphub-container';\n    for (let i = 0; i < args.length; i++) {\n      const arg = args[i];\n      if (arg === '--name' && args[i + 1]) {\n        containerName = args[i + 1];\n        i += 1;\n        continue;\n      }\n      if (arg === '-p' && args[i + 1]) {\n        const mapping = args[i + 1];\n        const parts = mapping.split(':');\n        containerPort = parts[parts.length - 1] || containerPort;\n        i += 1;\n      }\n    }\n    const containerId = containerName + '-' + crypto.randomUUID().slice(0, 8);\n    const basePort = Number(process.env.APPHUB_FAKE_DOCKER_PORT_BASE || '45000');\n    const hostPort = basePort + Math.floor(Math.random() * 500);\n    writeState(containerId, { containerId, containerName, containerPort, hostPort });\n    process.stdout.write(containerId + '\\n');\n    process.exit(0);\n  }\n  case 'port': {\n    const containerId = args[0];\n    const portSpec = args[1] || '3000/tcp';\n    const state = readState(containerId);\n    if (!state) {\n      console.error('container not found');\n      process.exit(1);\n    }\n    const containerPort = portSpec.split('/')[0] || state.containerPort;\n    console.log(containerPort + '/tcp -> 0.0.0.0:' + state.hostPort);\n    process.exit(0);\n  }\n  case 'stop': {\n    // stop succeeds without side effects\n    process.exit(0);\n  }\n  case 'rm': {\n    const targets = args.filter((arg) => !arg.startsWith('-'));\n    for (const target of targets) {\n      removeState(target);\n    }\n    process.exit(0);\n  }\n  default: {\n    console.warn('[fake-docker] ignoring command', command);\n    process.exit(0);\n  }\n}`;

  await writeFile(scriptPath, script, 'utf8');
  await chmod(scriptPath, 0o755);

  return { binDir, stateDir };
}

async function terminateProcess(proc: ChildProcess | undefined) {
  if (!proc) {
    return;
  }
  if (proc.exitCode !== null) {
    return;
  }
  proc.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function startCatalog(): Promise<CatalogTestContext> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'apphub-e2e-'));
  const fakeDocker = await createFakeDocker(tempRoot);
  const dbPath = path.join(tempRoot, 'catalog.db');
  const port = 4200 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    CATALOG_DB_PATH: dbPath,
    REDIS_URL: 'inline',
    INGEST_QUEUE_NAME: 'apphub_e2e',
    PORT: String(port),
    HOST: '127.0.0.1',
    PATH: `${fakeDocker.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    APPHUB_FAKE_DOCKER_STATE: fakeDocker.stateDir,
    BUILD_CLONE_DEPTH: '1',
    INGEST_CLONE_DEPTH: '1',
    LAUNCH_RUNNER_MODE: 'stub',
    LAUNCH_PREVIEW_BASE_URL: 'https://preview.apphub.local',
    LAUNCH_PREVIEW_TOKEN_SECRET: 'e2e-preview-secret',
    LAUNCH_PREVIEW_PORT: '443'
  };

  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: CATALOG_ROOT,
    env,
    stdio: 'inherit'
  });

  await waitForServer(baseUrl);

  const worker = spawn('npx', ['tsx', 'src/ingestionWorker.ts'], {
    cwd: CATALOG_ROOT,
    env,
    stdio: 'inherit'
  });

  // give the worker a moment to boot
  await delay(250);

  return { baseUrl, env, tempRoot, server, worker, fakeDocker };
}

async function withCatalogEnvironment<T>(fn: (context: CatalogTestContext) => Promise<T>) {
  const context = await startCatalog();
  try {
    return await fn(context);
  } finally {
    await terminateProcess(context.worker);
    await terminateProcess(context.server);
  }
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
  const dockerfileRelativePath = path.join('containers', 'web', 'Dockerfile');
  await mkdir(path.join(repoDir, 'containers', 'web'), { recursive: true });
  await writeFile(path.join(repoDir, dockerfileRelativePath), dockerfile, 'utf8');
  await writeFile(path.join(repoDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');
  await writeFile(path.join(repoDir, 'index.js'), 'console.log("hello apphub")\n', 'utf8');

  await exec('git add .', { cwd: repoDir });
  await exec('git commit -m "Initial commit"', { cwd: repoDir });

  const commit = (await exec('git rev-parse HEAD', { cwd: repoDir })).stdout.trim();
  return { repoDir, commit, dockerfilePath: dockerfileRelativePath.split(path.sep).join('/') };
}

async function snapshotRepository(sourcePath: string) {
  const snapshotRoot = await mkdtemp(path.join(tmpdir(), 'apphub-real-'));
  const repoDir = path.join(snapshotRoot, 'repo');
  await cp(sourcePath, repoDir, {
    recursive: true,
    filter: (src) => {
      const relative = path.relative(sourcePath, src);
      if (!relative || relative === '') {
        return true;
      }
      return !relative.split(path.sep).includes('.git');
    }
  });

  await exec('git init', { cwd: repoDir });
  await exec('git config user.name "Test User"', { cwd: repoDir });
  await exec('git config user.email "test@example.com"', { cwd: repoDir });
  await exec('git add .', { cwd: repoDir });
  await exec('git commit -m "Snapshot"', { cwd: repoDir });

  return repoDir;
}

async function testSyntheticRepositoryFlow() {
  await withCatalogEnvironment(async ({ baseUrl }) => {
    const tempRepoRoot = await mkdtemp(path.join(tmpdir(), 'apphub-synth-'));
    const { repoDir, commit, dockerfilePath: detectedDockerfile } = await createLocalRepo(tempRepoRoot);
    const appId = `repo-${Date.now()}`;

    const createRes = await fetch(`${baseUrl}/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: appId,
        name: 'E2E App',
        description: 'End-to-end test application',
        repoUrl: repoDir,
        dockerfilePath: 'Dockerfile',
        tags: [{ key: 'language', value: 'javascript' }]
      })
    });

    assert.equal(createRes.status, 201, 'Expected app creation to succeed');

    const initialRepository = await pollRepository(baseUrl, appId);
    assert.equal(initialRepository.ingestStatus, 'ready');
    assert.equal(initialRepository.ingestAttempts > 0, true);

    const build = await pollLatestBuild(
      baseUrl,
      appId,
      'succeeded',
      DEFAULT_TIMEOUT_MS,
      initialRepository.latestBuild?.id
    );
    assert(build.imageTag, 'Build image tag should be present');

    const repository = await pollRepository(baseUrl, appId);
    assert.equal(
      repository.dockerfilePath,
      detectedDockerfile,
      'Repository should record detected Dockerfile path'
    );

    const history = await fetchHistory(baseUrl, appId);
    assert(history.length >= 3, 'Expected history to include multiple events');
    const readyEvent = history.find((event) => event.status === 'ready');
    assert(readyEvent, 'Ready event should be present');
    assert(readyEvent?.commitSha?.toLowerCase().startsWith(commit.slice(0, 8).toLowerCase()));
    assert.equal(typeof readyEvent?.durationMs, 'number');
    assert((readyEvent?.durationMs ?? 0) >= 0);

    const logs = await collectBuildLogs(baseUrl, build.id);
    assert(logs.includes('[fake-docker] build success'), 'Expected fake docker logs in build output');
  });
}

async function prepareRealRepository(): Promise<string> {
  if (REAL_REPO_PATH) {
    await access(REAL_REPO_PATH);
    return REAL_REPO_PATH;
  }

  const cloneRoot = await mkdtemp(path.join(tmpdir(), 'apphub-real-src-'));
  const repoDir = path.join(cloneRoot, 'better-fileexplorer');

  try {
    await exec(`git clone --depth 1 ${REAL_REPO_GIT_URL} ${repoDir}`);
  } catch (err) {
    throw new Error(`Failed to clone real repo from ${REAL_REPO_GIT_URL}: ${String(err)}`);
  }

  return repoDir;
}

async function testRealRepositoryLaunchFlow() {
  await withCatalogEnvironment(async ({ baseUrl, env }) => {
    const previewSecret = env.LAUNCH_PREVIEW_TOKEN_SECRET ?? '';
    const sourceRepoPath = await prepareRealRepository();
    const repoUrl = await snapshotRepository(sourceRepoPath);

    const appId = `better-fileexplorer-${Date.now()}`;

    const createRes = await fetch(`${baseUrl}/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: appId,
        name: 'Better File Explorer',
        description: 'Static file explorer demo',
        repoUrl,
        dockerfilePath: 'Dockerfile',
        tags: [{ key: 'category', value: 'demo' }]
      })
    });

    assert.equal(createRes.status, 201, 'Real repo submission should succeed');

    const initialRepository = await pollRepository(baseUrl, appId);
    assert.equal(initialRepository.ingestStatus, 'ready');

    const build = await pollLatestBuild(
      baseUrl,
      appId,
      'succeeded',
      DEFAULT_TIMEOUT_MS,
      initialRepository.latestBuild?.id
    );
    assert(build.imageTag, 'Real repo build should produce an image');

    const repository = await pollRepository(baseUrl, appId);

    const tagStrings = repository.tags.map((tag) => `${tag.key}:${tag.value}`);
    assert(tagStrings.includes('language:javascript'), 'Dockerfile-derived language tag expected');
    assert(tagStrings.some((tag) => tag.startsWith('runtime:node')), 'Runtime tag should include node');

    const buildLogs = await collectBuildLogs(baseUrl, build.id);
    assert(buildLogs.includes('[fake-docker] build success'), 'Real repo build should run through fake docker');

    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    const socket = new WebSocket(wsUrl);
    const launchEvents: LaunchSummary[] = [];
    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        socket.off('error', handleError);
        resolve();
      };
      const handleError = (err: Error) => {
        socket.off('open', handleOpen);
        reject(err);
      };
      socket.once('open', handleOpen);
      socket.once('error', handleError);
    });

    socket.on('message', (raw) => {
      let text: string | null = null;
      if (typeof raw === 'string') {
        text = raw;
      } else if (raw instanceof Buffer) {
        text = raw.toString('utf8');
      } else if (Array.isArray(raw)) {
        text = Buffer.concat(raw).toString('utf8');
      }
      if (!text) {
        return;
      }
      try {
        const parsed = JSON.parse(text) as {
          type?: string;
          data?: { repositoryId?: string; launch?: LaunchSummary };
        };
        if (parsed.type === 'launch.updated' && parsed.data?.launch) {
          launchEvents.push(parsed.data.launch);
        }
      } catch {
        // ignore malformed frames
      }
    });

    try {
      const launchRes = await fetch(`${baseUrl}/launches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryId: appId,
          env: [
            { key: 'HELLO', value: 'world' },
            { key: 'FOO', value: 'bar' }
          ]
        })
      });

      assert.equal(launchRes.status, 202, 'Launch request should be accepted');
      const launchPayload = (await launchRes.json()) as {
        data: { repository: RepositorySummary; launch: LaunchSummary };
      };
      const launch = launchPayload.data.launch;
      assert(launch.id, 'Launch identifier should be defined');
      assert(launch.env.some((entry) => entry.key === 'HELLO' && entry.value === 'world'));

      const runningLaunch = await pollLaunch(baseUrl, appId, launch.id, 'running');
      assert(runningLaunch.instanceUrl, 'Instance URL should be populated');
      assert.strictEqual(typeof runningLaunch.port, 'number');
      assert(runningLaunch.env.some((entry) => entry.key === 'FOO' && entry.value === 'bar'));

      await delay(300);

      const previewUrl = new URL(runningLaunch.instanceUrl ?? '');
      assert.equal(previewUrl.origin, 'https://preview.apphub.local');
      assert.equal(previewUrl.searchParams.get('repositoryId'), appId);
      const token = previewUrl.searchParams.get('token');
      assert(token, 'Preview URL should include a token');
      const expectedToken = createHmac('sha256', previewSecret)
        .update(`${launch.id}:${appId}`)
        .digest('hex');
      assert.equal(token, expectedToken, 'Preview token should be signed');

      const launchesRes = await fetch(`${baseUrl}/apps/${appId}/launches`);
      assert.equal(launchesRes.status, 200, 'Launch listing should succeed');
      const launchesPayload = (await launchesRes.json()) as { data: LaunchSummary[] };
      assert(launchesPayload.data.some((entry) => entry.id === launch.id), 'Launch should be listed');

      const stopRes = await fetch(`${baseUrl}/apps/${appId}/launches/${launch.id}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(stopRes.status, 202, 'Launch stop should be accepted');

      const stoppedLaunch = await pollLaunch(baseUrl, appId, launch.id, 'stopped');
      assert.equal(stoppedLaunch.status, 'stopped');

      await delay(300);

      const relevantEvents = launchEvents.filter((event) => event.id === launch.id);
      const statusSet = new Set(relevantEvents.map((event) => event.status));
      assert(statusSet.has('starting'), 'Launch should emit starting event');
      assert(statusSet.has('running'), 'Launch should emit running event');
      assert(statusSet.has('stopping'), 'Launch should emit stopping event');
      assert(statusSet.has('stopped'), 'Launch should emit stopped event');
      const runningEvent = relevantEvents.find((event) => event.status === 'running');
      assert(runningEvent?.instanceUrl, 'Running event should include preview URL');
    } finally {
      socket.close();
    }
  });
}

async function run() {
  await testSyntheticRepositoryFlow();
  await testRealRepositoryLaunchFlow();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
