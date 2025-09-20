import { createHmac } from 'node:crypto';
import {
  failLaunch,
  getBuildById,
  getLaunchById,
  markLaunchRunning,
  markLaunchStopped,
  requestLaunchStop,
  startLaunch
} from './db';

const RUNNER_MODE = (process.env.LAUNCH_RUNNER_MODE ?? 'docker').toLowerCase();
export const isStubRunnerEnabled = RUNNER_MODE === 'stub';

const DEFAULT_PREVIEW_BASE_URL = 'https://preview.osiris.local';
const DEFAULT_PREVIEW_PORT = 443;
const DEFAULT_TOKEN_SECRET = 'preview-secret';

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PREVIEW_PORT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PREVIEW_PORT;
  }
  return parsed;
}

function buildSignedPreviewUrl(launchId: string, repositoryId: string): string {
  const base = process.env.LAUNCH_PREVIEW_BASE_URL ?? DEFAULT_PREVIEW_BASE_URL;
  const secret = process.env.LAUNCH_PREVIEW_TOKEN_SECRET ?? DEFAULT_TOKEN_SECRET;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    url = new URL(DEFAULT_PREVIEW_BASE_URL);
  }

  const sanitizedPath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${sanitizedPath}/launches/${encodeURIComponent(launchId)}`;
  url.searchParams.set('repositoryId', repositoryId);

  const tokenPayload = `${launchId}:${repositoryId}`;
  const token = createHmac('sha256', secret).update(tokenPayload).digest('hex');
  url.searchParams.set('token', token);

  return url.toString();
}

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[launch-stub] ${message}${payload}`);
}

export async function runStubLaunchStart(launchId: string) {
  const launch = await startLaunch(launchId);
  if (!launch) {
    log('Launch not pending for stub start', { launchId });
    return;
  }

  const build = await getBuildById(launch.buildId);
  if (!build || build.status !== 'succeeded' || !build.imageTag) {
    const message = 'Launch unavailable: build image missing';
    await failLaunch(launch.id, message);
    log('Launch failed - build unavailable', { launchId, buildId: launch.buildId });
    return;
  }

  const instanceUrl = buildSignedPreviewUrl(launch.id, launch.repositoryId);
  const port = parsePort(process.env.LAUNCH_PREVIEW_PORT);
  const startedAt = new Date().toISOString();

  await markLaunchRunning(launch.id, {
    instanceUrl,
    containerId: `stub-${launch.id}`,
    port,
    startedAt,
    command: launch.command ?? undefined
  });

  log('Launch running (stub)', { launchId, instanceUrl });
}

export async function runStubLaunchStop(launchId: string) {
  const launch = await getLaunchById(launchId);
  if (!launch) {
    log('Launch missing for stub stop', { launchId });
    return;
  }

  if (launch.status !== 'stopping') {
    await requestLaunchStop(launchId);
  }

  await markLaunchStopped(launchId);
  log('Launch stopped (stub)', { launchId });
}
