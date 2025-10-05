import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { serializeModuleDefinition, type ModuleManifest } from '@apphub/module-sdk';
import { loadModuleDefinition } from '../module';
import type { ModuleDeploymentLogger } from './types';
import {
  ModuleDeploymentAdapter,
  ModuleDeploymentPreparedState,
  DeployModuleResult
} from './types';
import { ensureBuckets } from './ensureBuckets';
import { ensureFilestorePrefixes, ensureFilestoreBackend } from './filestore';
import { syncServices } from './services';
import { syncJobs } from './jobs';
import { syncWorkflows } from './workflows';
import { createCoreRequest } from './request';
import { prepareModuleArtifact, type ModuleArtifactDescriptor } from './storage';

export interface DeployModuleOptions {
  modulePath: string;
  distPath?: string;
  coreUrl: string;
  coreToken: string;
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}

export async function deployModule(options: DeployModuleOptions): Promise<DeployModuleResult> {
  const modulePath = path.resolve(options.modulePath);
  const distPath = path.resolve(options.distPath ?? path.join(modulePath, 'dist'));

  primeScratchPrefixes(options.env);
  options.logger.debug?.('Configured scratch prefixes', {
    prefixes: process.env.APPHUB_SCRATCH_PREFIXES
  });

  const { entryPath: moduleEntryPath, relativeEntry } = await resolveModuleEntryPath({
    modulePath,
    distPath
  });

  let moduleDefinition = await loadModuleDefinition(modulePath, relativeEntry);
  let manifest = serializeModuleDefinition(moduleDefinition);

  const request = createCoreRequest({ baseUrl: options.coreUrl, token: options.coreToken });

  const adapter = await loadDeploymentAdapter(distPath, options.logger);
  let prepared: ModuleDeploymentPreparedState | null = null;
  if (adapter) {
    prepared = await adapter.prepare({
      modulePath,
      distPath,
      manifest,
      env: options.env,
      logger: options.logger
    });
  }

  const artifact = await prepareModuleArtifact({
    moduleId: manifest.metadata.name,
    moduleVersion: manifest.metadata.version,
    moduleEntryPath,
    env: options.env,
    logger: options.logger
  });

  await publishModuleArtifactBundle({
    manifest,
    artifact,
    request,
    logger: options.logger
  });

  const bucketsEnsured = await ensureBuckets(prepared?.buckets ?? [], options.logger);

  let filestorePrefixesEnsured = 0;
  if (prepared?.filestore) {
    const backendId = await ensureFilestoreBackend({
      ...prepared.filestore,
      logger: options.logger
    });

    if (backendId && prepared.filestore.backendMountId !== backendId) {
      prepared.filestore.backendMountId = backendId;
      if (prepared.configPath) {
        await updateObservatoryConfigBackendId({
          configPath: prepared.configPath,
          backendId,
          env: options.env,
          logger: options.logger
        });
      }
      if (moduleDefinition.settings?.defaults && typeof moduleDefinition.settings.defaults === 'object') {
        const defaults = moduleDefinition.settings.defaults as Record<string, any>;
        if (defaults.filestore && typeof defaults.filestore === 'object') {
          defaults.filestore.backendId = backendId;
      }
    }
  }

  manifest = serializeModuleDefinition(moduleDefinition);

    if (prepared.filestore.prefixes.length > 0) {
      filestorePrefixesEnsured = await ensureFilestorePrefixes({
        ...prepared.filestore,
        logger: options.logger
      });
    }
  }

  const servicesProcessed = await syncServices({
    manifest,
    moduleId: manifest.metadata.name,
    moduleVersion: manifest.metadata.version,
    coreUrl: options.coreUrl,
    coreToken: options.coreToken,
    logger: options.logger,
    env: options.env
  });

  const jobsProcessed = await syncJobs({
    manifest,
    moduleId: manifest.metadata.name,
    moduleVersion: manifest.metadata.version,
    coreUrl: options.coreUrl,
    coreToken: options.coreToken,
    logger: options.logger
  });

  const workflowsProcessed = await syncWorkflows({
    manifest,
    moduleId: manifest.metadata.name,
    moduleVersion: manifest.metadata.version,
    coreUrl: options.coreUrl,
    coreToken: options.coreToken,
    logger: options.logger,
    workflowCustomization: prepared?.workflow,
    config: prepared?.config
  });

  if (prepared?.postDeploy) {
    await prepared.postDeploy({
      config: prepared.config,
      env: options.env,
      logger: options.logger,
      core: {
        baseUrl: options.coreUrl,
        token: options.coreToken,
        request
      }
    });
  }

  return {
    configPath: prepared?.configPath,
    jobsProcessed,
    workflowsProcessed,
    servicesProcessed,
    bucketsEnsured,
    filestorePrefixesEnsured
  } satisfies DeployModuleResult;
}

function primeScratchPrefixes(env: NodeJS.ProcessEnv): void {
  const prefixes = new Set<string>();

  const add = (value: string | undefined) => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    prefixes.add(path.resolve(trimmed));
  };

  const existing = process.env.APPHUB_SCRATCH_PREFIXES ?? env.APPHUB_SCRATCH_PREFIXES;
  if (existing) {
    for (const candidate of existing.split(':')) {
      add(candidate);
    }
  }

  add(env.APPHUB_SCRATCH_ROOT);
  add(env.APPHUB_RUNTIME_SCRATCH_ROOT);
  add(process.env.APPHUB_SCRATCH_ROOT);
  add(process.env.APPHUB_RUNTIME_SCRATCH_ROOT);
  const configPath = env.OBSERVATORY_CONFIG_PATH ?? process.env.OBSERVATORY_CONFIG_PATH;
  if (configPath) {
    add(path.dirname(configPath));
  }
  add('/tmp/apphub');

  if (prefixes.size > 0) {
    process.env.APPHUB_SCRATCH_PREFIXES = Array.from(prefixes).join(':');
  }
}

async function publishModuleArtifactBundle(options: {
  manifest: ModuleManifest;
  artifact: ModuleArtifactDescriptor;
  request: ReturnType<typeof createCoreRequest>;
  logger: ModuleDeploymentLogger;
}): Promise<void> {
  const basePayload = {
    moduleId: options.manifest.metadata.name,
    moduleVersion: options.manifest.metadata.version,
    displayName: options.manifest.metadata.displayName ?? null,
    description: options.manifest.metadata.description ?? null,
    keywords: options.manifest.metadata.keywords ?? [],
    manifest: options.manifest
  } satisfies Record<string, unknown>;

  const artifactPayload =
    options.artifact.storage === 's3'
      ? {
          storage: 's3' as const,
          bucket: options.artifact.bucket,
          key: options.artifact.key,
          contentType: options.artifact.contentType,
          size: options.artifact.size,
          checksum: options.artifact.checksum
        }
      : {
          storage: 'inline' as const,
          filename: options.artifact.filename,
          contentType: options.artifact.contentType,
          data: options.artifact.data,
          size: options.artifact.size,
          checksum: options.artifact.checksum
        };

  await options.request({
    method: 'POST',
    path: '/module-runtime/artifacts',
    body: {
      ...basePayload,
      artifact: artifactPayload
    }
  });

  options.logger.info('Published module artifact', {
    moduleId: options.manifest.metadata.name,
    moduleVersion: options.manifest.metadata.version,
    storage: options.artifact.storage
  });
}

async function updateObservatoryConfigBackendId(options: {
  configPath: string;
  backendId: number;
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}): Promise<void> {
  try {
    const raw = await readFile(options.configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('config is not a JSON object');
    }
    const filestore = (parsed.filestore ?? {}) as Record<string, unknown>;
    filestore.backendMountId = options.backendId;
    parsed.filestore = filestore;
    await writeFile(options.configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

    const runtimeRoot = options.env.APPHUB_RUNTIME_SCRATCH_ROOT?.trim();
    if (runtimeRoot) {
      const mirrorPath = path.join(runtimeRoot, 'observatory', 'config', 'observatory-config.json');
      try {
        await writeFile(mirrorPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      } catch (error) {
        options.logger.warn?.('Failed to mirror observatory config to runtime scratch root', {
          path: mirrorPath,
          error
        });
      }
    }
  } catch (error) {
    options.logger.warn?.('Failed to update observatory config with backend mount id', {
      configPath: options.configPath,
      backendId: options.backendId,
      error
    });
  }
}

async function resolveModuleEntryPath(options: {
  modulePath: string;
  distPath: string;
}): Promise<{ entryPath: string; relativeEntry: string }> {
  const candidates = ['module.artifact.js', 'module.js'];
  for (const candidate of candidates) {
    const candidatePath = path.join(options.distPath, candidate);
    if (await fileExists(candidatePath)) {
      return {
        entryPath: candidatePath,
        relativeEntry: path.relative(options.modulePath, candidatePath)
      };
    }
  }

  throw new Error(
    `Unable to locate module entry file in ${options.distPath}. Expected one of ${candidates.join(', ')}`
  );
}

async function loadDeploymentAdapter(
  distPath: string,
  logger: ModuleDeploymentLogger
): Promise<ModuleDeploymentAdapter | null> {
  const candidates = [
    path.join(distPath, 'deployment', 'adapter.js'),
    path.join(distPath, 'deployment', 'index.js'),
    path.join(distPath, 'src', 'deployment', 'adapter.js'),
    path.join(distPath, 'src', 'deployment', 'index.js')
  ];

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      continue;
    }
    try {
      const imported = await import(candidate);
      const adapter: ModuleDeploymentAdapter | undefined =
        imported.deploymentAdapter ?? imported.deployment ?? imported.default;
      if (adapter && typeof adapter.prepare === 'function') {
        return adapter;
      }
      logger.warn('Module deployment adapter found but missing prepare() method', { candidate });
    } catch (error) {
      logger.error('Failed to load module deployment adapter', { candidate, error });
      throw error;
    }
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
