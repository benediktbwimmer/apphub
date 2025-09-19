import { spawn } from 'node:child_process';
import { failLaunch, getBuildById, getLaunchById, markLaunchRunning, markLaunchStopped, requestLaunchStop, startLaunch } from './db';

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[launch] ${message}${payload}`);
}

function sanitizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function runDocker(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on('error', (err) => {
      const message = (err as Error).message ?? 'process error';
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${message}` });
    });
  });
}

function buildPreviewUrl(hostPort: string): string {
  const base = process.env.LAUNCH_PREVIEW_BASE_URL ?? 'http://127.0.0.1';
  try {
    const url = new URL(base);
    url.port = hostPort;
    return url.toString().replace(/\/$/, '');
  } catch {
    const trimmed = base.replace(/\/$/, '');
    if (/^https?:\/\//.test(trimmed)) {
      const withoutPort = trimmed.replace(/:\d+$/, '');
      return `${withoutPort}:${hostPort}`;
    }
    return `${trimmed}:${hostPort}`;
  }
}

function parseHostPort(output: string, internalPort: number): string | null {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const primary = line.match(new RegExp(`${internalPort}\/tcp\s+->\s+[^:]+:(\d+)`));
    if (primary?.[1]) {
      return primary[1];
    }
    const fallback = line.match(/:(\d+)\s*$/);
    if (fallback?.[1]) {
      return fallback[1];
    }
  }
  return null;
}

export async function runLaunchStart(launchId: string) {
  const launch = startLaunch(launchId);
  if (!launch) {
    log('Launch not pending', { launchId });
    return;
  }

  const build = getBuildById(launch.buildId);
  if (!build || build.status !== 'succeeded' || !build.imageTag) {
    const message = 'Launch unavailable: build image missing';
    failLaunch(launch.id, message);
    log('Launch failed - build unavailable', { launchId, buildId: launch.buildId });
    return;
  }

  const containerPort = Number(process.env.LAUNCH_INTERNAL_PORT ?? 3000);
  const containerName = `apphub-${sanitizeName(launch.repositoryId)}-${launch.id.slice(0, 8)}`;

  log('Starting container', {
    launchId,
    buildId: launch.buildId,
    imageTag: build.imageTag,
    containerName,
    containerPort
  });

  const runArgs = ['run', '-d', '--name', containerName, '-p', `0:${containerPort}`];
  for (const entry of launch.env) {
    runArgs.push('-e', `${entry.key}=${entry.value}`);
  }
  runArgs.push(build.imageTag);
  const runResult = await runDocker(runArgs);
  if (runResult.exitCode !== 0 || runResult.stdout.trim().length === 0) {
    const message = runResult.stderr || 'docker run failed';
    failLaunch(launch.id, message.trim().slice(0, 500));
    log('Launch docker run failed', { launchId, error: message.trim() });
    return;
  }

  const containerId = runResult.stdout.trim().split(/\s+/)[0];

  const portResult = await runDocker(['port', containerId, `${containerPort}/tcp`]);
  if (portResult.exitCode !== 0) {
    const message = portResult.stderr || 'Failed to determine mapped port';
    failLaunch(launch.id, message.trim().slice(0, 500));
    log('Launch port discovery failed', { launchId, error: message.trim() });
    void runDocker(['rm', '-f', containerId]);
    return;
  }

  const hostPort = parseHostPort(portResult.stdout, containerPort);
  if (!hostPort) {
    const message = 'Unable to parse docker port output';
    failLaunch(launch.id, message);
    log('Launch port parse failed', { launchId, output: portResult.stdout });
    void runDocker(['rm', '-f', containerId]);
    return;
  }

  const instanceUrl = buildPreviewUrl(hostPort);
  markLaunchRunning(launch.id, {
    instanceUrl,
    containerId,
    port: Number(hostPort)
  });

  log('Launch running', { launchId, containerId, instanceUrl });
}

export async function runLaunchStop(launchId: string) {
  const launch = getLaunchById(launchId);
  if (!launch) {
    log('Launch missing for stop', { launchId });
    return;
  }

  let current = launch;
  if (launch.status !== 'stopping') {
    const requested = requestLaunchStop(launchId);
    if (!requested) {
      log('Launch not in stopping state', { launchId, status: launch.status });
      return;
    }
    current = requested;
  }

  if (!current.containerId) {
    markLaunchStopped(launchId);
    log('Launch stop with no container id', { launchId });
    return;
  }

  const stopResult = await runDocker(['stop', '--time', '5', current.containerId]);
  if (stopResult.exitCode !== 0) {
    const message = stopResult.stderr || 'docker stop failed';
    log('Launch docker stop failed', { launchId, error: message.trim() });
  }

  await runDocker(['rm', '-f', current.containerId]);
  markLaunchStopped(launchId);
  log('Launch stopped', { launchId });
}
