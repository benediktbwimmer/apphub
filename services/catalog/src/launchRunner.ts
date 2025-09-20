import {
  createLaunch,
  failLaunch,
  getBuildById,
  getLaunchById,
  getRepositoryById,
  getServiceNetworkByRepositoryId,
  markLaunchRunning,
  markLaunchStopped,
  recordServiceNetworkLaunchMembers,
  requestLaunchStop,
  startLaunch,
  deleteServiceNetworkLaunchMembers,
  getServiceNetworkLaunchMembers,
  type LaunchEnvVar,
  type ServiceNetworkLaunchMemberInput,
  type ServiceNetworkLaunchMemberRecord,
  type LaunchRecord,
  type RepositoryRecord,
  type ServiceNetworkRecord,
  type ServiceNetworkMemberRecord
} from './db/index';
import { isStubRunnerEnabled, runStubLaunchStart, runStubLaunchStop } from './launchPreviewStub';
import { buildDockerRunCommand, parseDockerCommand, stringifyDockerCommand } from './launchCommand';
import {
  DEFAULT_LAUNCH_INTERNAL_PORT,
  resolveLaunchInternalPort,
  runDockerCommand,
  parseEnvPort
} from './docker';
import type { ManifestEnvVarInput } from './serviceManifestTypes';
import {
  updateServiceRuntimeForRepository,
  clearServiceRuntimeForRepository
} from './serviceRegistry';

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[launch] ${message}${payload}`);
}

const SERVICE_NETWORK_BUILD_TIMEOUT_MS = Number(process.env.SERVICE_NETWORK_BUILD_TIMEOUT_MS ?? 10 * 60_000);
const SERVICE_NETWORK_BUILD_POLL_INTERVAL_MS = Number(
  process.env.SERVICE_NETWORK_BUILD_POLL_INTERVAL_MS ?? 2000
);
const SERVICE_NETWORK_LAUNCH_TIMEOUT_MS = Number(
  process.env.SERVICE_NETWORK_LAUNCH_TIMEOUT_MS ?? 5 * 60_000
);
const SERVICE_NETWORK_LAUNCH_POLL_INTERVAL_MS = Number(
  process.env.SERVICE_NETWORK_LAUNCH_POLL_INTERVAL_MS ?? 2000
);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function resolvePortFromLaunchEnv(entries: LaunchEnvVar[] | null | undefined): number | null {
  if (!entries || entries.length === 0) {
    return null;
  }
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim().toLowerCase();
    if (key !== 'port') {
      continue;
    }
    const parsed = parseEnvPort(typeof entry.value === 'string' ? entry.value : undefined);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

type ServiceRuntimeInfo = {
  repositoryId: string;
  instanceUrl: string | null;
  baseUrl: string | null;
  port: number | null;
  host: string;
};

type RuntimeContext = Map<string, ServiceRuntimeInfo>;

function resolveEnvValueFromService(
  ref: NonNullable<ManifestEnvVarInput['fromService']>,
  runtime: RuntimeContext
): string | undefined {
  const target = ref.service.trim().toLowerCase();
  if (!target) {
    return undefined;
  }
  const context = runtime.get(target);
  if (!context) {
    return undefined;
  }
  switch (ref.property) {
    case 'instanceUrl':
      return context.instanceUrl ?? context.baseUrl ?? ref.fallback;
    case 'baseUrl':
      return context.baseUrl ?? context.instanceUrl ?? ref.fallback;
    case 'host':
      return context.host ?? ref.fallback;
    case 'port':
      return context.port !== null && context.port !== undefined
        ? String(context.port)
        : ref.fallback;
    default:
      return ref.fallback;
  }
}

function resolveEnvEntries(
  entries: ManifestEnvVarInput[] | undefined,
  runtime: RuntimeContext
): LaunchEnvVar[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  const resolved: LaunchEnvVar[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }

    let value: string | undefined;

    if (entry.fromService) {
      value = resolveEnvValueFromService(entry.fromService, runtime);
      if (value === undefined && entry.value !== undefined) {
        value = entry.value;
      }
      if (value === undefined && entry.fromService.fallback !== undefined) {
        value = entry.fromService.fallback;
      }
    } else if (entry.value !== undefined) {
      value = entry.value;
    }

    if (value === undefined) {
      continue;
    }
    resolved.push({ key, value });
  }
  return resolved;
}

function sortNetworkMembers(network: ServiceNetworkRecord): ServiceNetworkMemberRecord[] {
  return [...network.members].sort((a, b) => {
    if (a.launchOrder === b.launchOrder) {
      return a.memberRepositoryId.localeCompare(b.memberRepositoryId);
    }
    return a.launchOrder - b.launchOrder;
  });
}

async function resolveBuildIdForMember(member: ServiceNetworkMemberRecord): Promise<string> {
  let repository = await getRepositoryById(member.memberRepositoryId);
  if (!repository) {
    throw new Error(`repository ${member.memberRepositoryId} not found`);
  }
  const latest = repository.latestBuild;
  if (latest && latest.status === 'succeeded' && latest.imageTag) {
    return latest.id;
  }
  if (!member.waitForBuild) {
    throw new Error(`no successful build available for ${member.memberRepositoryId}`);
  }

  const deadline = Date.now() + SERVICE_NETWORK_BUILD_TIMEOUT_MS;
  log('waiting for member build', {
    repositoryId: member.memberRepositoryId,
    timeoutMs: SERVICE_NETWORK_BUILD_TIMEOUT_MS
  });
  while (Date.now() < deadline) {
    await delay(SERVICE_NETWORK_BUILD_POLL_INTERVAL_MS);
    repository = await getRepositoryById(member.memberRepositoryId);
    if (!repository) {
      continue;
    }
    const current = repository.latestBuild;
    if (current && current.status === 'succeeded' && current.imageTag) {
      return current.id;
    }
    if (current && current.status === 'failed') {
      const message = current.errorMessage ? current.errorMessage.slice(0, 160) : 'build failed';
      throw new Error(`build failed for ${member.memberRepositoryId}: ${message}`);
    }
  }

  throw new Error(`timed out waiting for build for ${member.memberRepositoryId}`);
}

async function waitForLaunchRunningStatus(launchId: string): Promise<LaunchRecord> {
  const deadline = Date.now() + SERVICE_NETWORK_LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const record = await getLaunchById(launchId);
    if (!record) {
      throw new Error(`launch ${launchId} not found`);
    }
    if (record.status === 'running') {
      return record;
    }
    if (record.status === 'failed') {
      const message = record.errorMessage ? record.errorMessage.slice(0, 160) : 'launch failed';
      throw new Error(message);
    }
    if (record.status === 'stopped') {
      throw new Error('launch stopped before reaching running state');
    }
    await delay(SERVICE_NETWORK_LAUNCH_POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for launch ${launchId} to start`);
}

async function waitForLaunchStoppedStatus(launchId: string): Promise<LaunchRecord> {
  const deadline = Date.now() + SERVICE_NETWORK_LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const record = await getLaunchById(launchId);
    if (!record) {
      throw new Error(`launch ${launchId} not found`);
    }
    if (record.status === 'stopped' || record.status === 'failed') {
      return record;
    }
    await delay(SERVICE_NETWORK_LAUNCH_POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for launch ${launchId} to stop`);
}

async function stopServiceLaunches(launchIds: string[]) {
  for (const launchId of launchIds) {
    try {
      const current = await getLaunchById(launchId);
      if (!current) {
        continue;
      }
      if (!['running', 'starting', 'pending'].includes(current.status)) {
        continue;
      }
      await requestLaunchStop(launchId);
      await runLaunchStop(launchId);
      const result = await waitForLaunchStoppedStatus(launchId);
      if (result.status === 'failed') {
        log('network member launch failed during stop', {
          launchId,
          error: result.errorMessage ?? null
        });
      } else {
        log('network member stopped', { launchId });
      }
    } catch (err) {
      log('failed to stop network member launch', {
        launchId,
        error: (err as Error).message
      });
    }
  }
}

async function runServiceNetworkLaunch(
  launch: LaunchRecord,
  repository: RepositoryRecord,
  network: ServiceNetworkRecord
) {
  const members = sortNetworkMembers(network);
  await deleteServiceNetworkLaunchMembers(launch.id);
  if (members.length === 0) {
    await recordServiceNetworkLaunchMembers(launch.id, []);
    await markLaunchRunning(launch.id, {
      instanceUrl: null,
      containerId: null,
      command: 'service-network'
    });
    log('service network launch running with no members', {
      launchId: launch.id,
      repositoryId: repository.id
    });
    return;
  }

  const recorded: ServiceNetworkLaunchMemberInput[] = [];
  const runtimeContext: RuntimeContext = new Map();

  try {
    for (const member of members) {
      log('starting network member launch', {
        networkLaunchId: launch.id,
        memberRepositoryId: member.memberRepositoryId,
        launchOrder: member.launchOrder
      });
      const buildId = await resolveBuildIdForMember(member);
      const resolvedEnv = resolveEnvEntries(member.env, runtimeContext);
      const childLaunch = await createLaunch(member.memberRepositoryId, buildId, {
        env: resolvedEnv,
        command: null
      });
      recorded.push({
        memberLaunchId: childLaunch.id,
        memberRepositoryId: member.memberRepositoryId,
        launchOrder: member.launchOrder
      });
      await runLaunchStart(childLaunch.id);
      await waitForLaunchRunningStatus(childLaunch.id);
      log('network member launch running', {
        networkLaunchId: launch.id,
        memberLaunchId: childLaunch.id
      });

      const runningLaunch = await getLaunchById(childLaunch.id);
      const port = runningLaunch?.port ?? null;
      const host = '127.0.0.1';
      const baseUrl = port ? `http://${host}:${port}` : runningLaunch?.instanceUrl ?? null;
      const context: ServiceRuntimeInfo = {
        repositoryId: member.memberRepositoryId,
        instanceUrl: runningLaunch?.instanceUrl ?? null,
        baseUrl,
        port,
        host
      };
      runtimeContext.set(member.memberRepositoryId.trim().toLowerCase(), context);
      if (runningLaunch && (context.instanceUrl || context.baseUrl)) {
        await updateServiceRuntimeForRepository(member.memberRepositoryId, {
          repositoryId: member.memberRepositoryId,
          launchId: childLaunch.id,
          instanceUrl: context.instanceUrl,
          baseUrl: context.baseUrl,
          previewUrl: context.instanceUrl ?? context.baseUrl,
          host: context.host,
          port: context.port,
          source: 'service-network'
        });
      }
    }

    await recordServiceNetworkLaunchMembers(launch.id, recorded);
    await markLaunchRunning(launch.id, {
      instanceUrl: null,
      containerId: null,
      command: 'service-network'
    });
    log('service network launch running', { launchId: launch.id, repositoryId: repository.id });
  } catch (err) {
    log('error launching service network', {
      launchId: launch.id,
      error: (err as Error).message
    });
    const reverseLaunchIds = recorded
      .slice()
      .sort((a, b) => b.launchOrder - a.launchOrder)
      .map((entry) => entry.memberLaunchId);
    if (reverseLaunchIds.length > 0) {
      await stopServiceLaunches(reverseLaunchIds);
    }
    for (const entry of recorded) {
      await clearServiceRuntimeForRepository(entry.memberRepositoryId, {
        launchId: entry.memberLaunchId
      });
    }
    await deleteServiceNetworkLaunchMembers(launch.id);
    await failLaunch(launch.id, (err as Error).message ?? 'service network launch failed');
  }
}

async function runServiceNetworkStop(launch: LaunchRecord) {
  let members: ServiceNetworkLaunchMemberRecord[] = [];
  try {
    members = await getServiceNetworkLaunchMembers(launch.id);
    if (members.length > 0) {
      const launchIds = members
        .slice()
        .sort((a, b) => b.launchOrder - a.launchOrder)
        .map((entry) => entry.memberLaunchId);
      try {
        await stopServiceLaunches(launchIds);
      } finally {
        for (const entry of members) {
          await clearServiceRuntimeForRepository(entry.memberRepositoryId, {
            launchId: entry.memberLaunchId
          });
        }
      }
    }
    await deleteServiceNetworkLaunchMembers(launch.id);
    await markLaunchStopped(launch.id);
    log('service network launch stopped', { launchId: launch.id });
  } catch (err) {
    await deleteServiceNetworkLaunchMembers(launch.id);
    for (const entry of members) {
      await clearServiceRuntimeForRepository(entry.memberRepositoryId, {
        launchId: entry.memberLaunchId
      });
    }
    markLaunchStopped(launch.id, { errorMessage: (err as Error).message });
    log('error stopping service network', {
      launchId: launch.id,
      error: (err as Error).message
    });
  }
}

export async function runLaunchStart(launchId: string) {
  if (isStubRunnerEnabled) {
    await runStubLaunchStart(launchId);
    return;
  }

  const launch = await startLaunch(launchId);
  if (!launch) {
    log('Launch not pending', { launchId });
    return;
  }

  const repository = await getRepositoryById(launch.repositoryId);
  if (!repository) {
    const message = 'Launch unavailable: app not found';
    await failLaunch(launch.id, message);
    log('Launch failed - repository missing', { launchId, repositoryId: launch.repositoryId });
    return;
  }

  const serviceNetwork = await getServiceNetworkByRepositoryId(repository.id);
  if (serviceNetwork) {
    await runServiceNetworkLaunch(launch, repository, serviceNetwork);
    return;
  }

  const build = await getBuildById(launch.buildId);
  if (!build || build.status !== 'succeeded' || !build.imageTag) {
    const message = 'Launch unavailable: build image missing';
    await failLaunch(launch.id, message);
    log('Launch failed - build unavailable', { launchId, buildId: launch.buildId });
    return;
  }

  const envDefinedPort = resolvePortFromLaunchEnv(launch.env);
  const containerPort = envDefinedPort ?? (await resolveLaunchInternalPort(build.imageTag));
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
  await markLaunchRunning(launch.id, {
    instanceUrl,
    containerId,
    port: Number(hostPort),
    command: effectiveCommand
  });

  log('Launch running', { launchId, containerId, instanceUrl });
}

export async function runLaunchStop(launchId: string) {
  if (isStubRunnerEnabled) {
    await runStubLaunchStop(launchId);
    return;
  }

  const launch = await getLaunchById(launchId);
  if (!launch) {
    log('Launch missing for stop', { launchId });
    return;
  }

  let current = launch;
  if (launch.status !== 'stopping') {
    const requested = await requestLaunchStop(launchId);
    if (!requested) {
      log('Launch not in stopping state', { launchId, status: launch.status });
      return;
    }
    current = requested;
  }

  const repository = await getRepositoryById(current.repositoryId);
  const networkConfig = repository ? await getServiceNetworkByRepositoryId(repository.id) : null;
  const launchMembers = await getServiceNetworkLaunchMembers(launchId);
  if (networkConfig || launchMembers.length > 0) {
    await runServiceNetworkStop(current);
    return;
  }

  if (!current.containerId) {
    await markLaunchStopped(launchId);
    log('Launch stop with no container id', { launchId });
    return;
  }

  const stopResult = await runDockerCommand(['stop', '--time', '5', current.containerId]);
  if (stopResult.exitCode !== 0) {
    const message = stopResult.stderr || 'docker stop failed';
    log('Launch docker stop failed', { launchId, error: message.trim() });
  }

  await runDockerCommand(['rm', '-f', current.containerId]);
  await markLaunchStopped(launchId);
  log('Launch stopped', { launchId });
}
