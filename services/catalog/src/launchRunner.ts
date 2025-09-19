import {
  failLaunch,
  getBuildById,
  getLaunchById,
  markLaunchRunning,
  markLaunchStopped,
  requestLaunchStop,
  startLaunch
} from './db';
import { buildDockerRunCommand, parseDockerCommand, stringifyDockerCommand } from './launchCommand';
import {
  DEFAULT_LAUNCH_INTERNAL_PORT,
  resolveLaunchInternalPort,
  runDockerCommand
} from './docker';

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[launch] ${message}${payload}`);
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

function parseContainerPortFromMapping(mapping: string): number | null {
  if (!mapping) {
    return null;
  }
  const parts = mapping.split(':');
  if (parts.length === 0) {
    return null;
  }
  const containerPart = parts[parts.length - 1]?.split('/')[0] ?? '';
  const parsed = Number(containerPart);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function adjustPublishArgs(args: string[], desiredPort: number): { args: string[]; changed: boolean } {
  let changed = false;
  const updated = [...args];
  for (let index = 0; index < updated.length; index += 1) {
    const token = updated[index];
    if (token === '-p' || token === '--publish') {
      const mappingIndex = index + 1;
      if (mappingIndex >= updated.length) {
        continue;
      }
      const mapping = updated[mappingIndex];
      const containerPort = parseContainerPortFromMapping(mapping);
      if (
        containerPort === DEFAULT_LAUNCH_INTERNAL_PORT &&
        desiredPort !== DEFAULT_LAUNCH_INTERNAL_PORT
      ) {
        updated[mappingIndex] = `0:${desiredPort}`;
        changed = true;
      }
      continue;
    }

    const inlineMatch = token.match(/^(-p|--publish)=(.+)$/);
    if (inlineMatch) {
      const containerPort = parseContainerPortFromMapping(inlineMatch[2]);
      if (
        containerPort === DEFAULT_LAUNCH_INTERNAL_PORT &&
        desiredPort !== DEFAULT_LAUNCH_INTERNAL_PORT
      ) {
        updated[index] = `${inlineMatch[1]}=0:${desiredPort}`;
        changed = true;
      }
    }
  }

  return { args: updated, changed };
}

function extractContainerPort(args: string[]): number | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-p' || token === '--publish') {
      const mapping = args[index + 1];
      const parsed = parseContainerPortFromMapping(mapping ?? '');
      if (parsed) {
        return parsed;
      }
      continue;
    }

    const inlineMatch = token.match(/^(-p|--publish)=(.+)$/);
    if (inlineMatch) {
      const parsed = parseContainerPortFromMapping(inlineMatch[2]);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}

function extractContainerName(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--name') {
      return args[index + 1] ?? null;
    }
    const inlineMatch = token.match(/^--name=(.+)$/);
    if (inlineMatch) {
      return inlineMatch[1];
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

  const containerPort = await resolveLaunchInternalPort(build.imageTag);
  const commandSource = launch.command?.trim() ?? '';
  let runArgs = commandSource ? parseDockerCommand(commandSource) : null;
  let commandLabel = commandSource;
  let containerName: string | null = null;

  if (runArgs) {
    const adjusted = adjustPublishArgs(runArgs, containerPort);
    runArgs = adjusted.args;
    if (adjusted.changed || !commandLabel) {
      commandLabel = stringifyDockerCommand(runArgs);
    }
    containerName = extractContainerName(runArgs) ?? containerName;
  }

  if (!runArgs) {
    const fallback = buildDockerRunCommand({
      repositoryId: launch.repositoryId,
      launchId: launch.id,
      imageTag: build.imageTag,
      env: launch.env,
      internalPort: containerPort
    });
    runArgs = fallback.args;
    commandLabel = fallback.command;
    containerName = fallback.containerName;
  }

  const containerPortForLookup = extractContainerPort(runArgs) ?? containerPort;
  const effectiveCommand = commandLabel || stringifyDockerCommand(runArgs);

  log('Starting container', {
    launchId,
    buildId: launch.buildId,
    imageTag: build.imageTag,
    containerName,
    command: effectiveCommand,
    containerPort: containerPortForLookup
  });

  if (!runArgs || runArgs.length === 0) {
    const message = 'Launch command invalid';
    failLaunch(launch.id, message);
    log('Launch command missing', { launchId, command: commandSource });
    return;
  }
  const runResult = await runDockerCommand(runArgs);
  if (runResult.exitCode !== 0 || runResult.stdout.trim().length === 0) {
    const message = runResult.stderr || 'docker run failed';
    failLaunch(launch.id, message.trim().slice(0, 500));
    log('Launch docker run failed', { launchId, error: message.trim() });
    return;
  }

  const containerId = runResult.stdout.trim().split(/\s+/)[0];

  const portResult = await runDockerCommand(['port', containerId, `${containerPortForLookup}/tcp`]);
  if (portResult.exitCode !== 0) {
    const message = portResult.stderr || 'Failed to determine mapped port';
    failLaunch(launch.id, message.trim().slice(0, 500));
    log('Launch port discovery failed', { launchId, error: message.trim() });
    void runDockerCommand(['rm', '-f', containerId]);
    return;
  }

  const hostPort = parseHostPort(portResult.stdout, containerPortForLookup);
  if (!hostPort) {
    const message = 'Unable to parse docker port output';
    failLaunch(launch.id, message);
    log('Launch port parse failed', { launchId, output: portResult.stdout });
    void runDockerCommand(['rm', '-f', containerId]);
    return;
  }

  const instanceUrl = buildPreviewUrl(hostPort);
  markLaunchRunning(launch.id, {
    instanceUrl,
    containerId,
    port: Number(hostPort),
    command: effectiveCommand
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

  const stopResult = await runDockerCommand(['stop', '--time', '5', current.containerId]);
  if (stopResult.exitCode !== 0) {
    const message = stopResult.stderr || 'docker stop failed';
    log('Launch docker stop failed', { launchId, error: message.trim() });
  }

  await runDockerCommand(['rm', '-f', current.containerId]);
  markLaunchStopped(launchId);
  log('Launch stopped', { launchId });
}
