import path from 'node:path';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { serializeModuleDefinition } from '@apphub/module-sdk';
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
  const moduleEntryPath = path.join(distPath, 'module.js');

  await assertFileExists(moduleEntryPath);

  const moduleDefinition = await loadModuleDefinition(modulePath, path.relative(modulePath, moduleEntryPath));
  const manifest = serializeModuleDefinition(moduleDefinition);

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

  const bucketsEnsured = await ensureBuckets(prepared?.buckets ?? [], options.logger);

  let filestorePrefixesEnsured = 0;
  if (prepared?.filestore) {
    const backendId = await ensureFilestoreBackend({
      ...prepared.filestore,
      logger: options.logger
    });

    if (backendId && prepared.filestore.backendMountId !== backendId) {
      prepared.filestore.backendMountId = backendId;
    }

    if (prepared.filestore.prefixes.length > 0) {
      filestorePrefixesEnsured = await ensureFilestorePrefixes({
        ...prepared.filestore,
        logger: options.logger
      });
    }
  }

  const request = createCoreRequest({ baseUrl: options.coreUrl, token: options.coreToken });

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

async function assertFileExists(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

async function loadDeploymentAdapter(
  distPath: string,
  logger: ModuleDeploymentLogger
): Promise<ModuleDeploymentAdapter | null> {
  const candidates = [
    path.join(distPath, 'deployment', 'adapter.js'),
    path.join(distPath, 'deployment', 'index.js')
  ];

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      continue;
    }
    try {
      const imported = await import(pathToFileURL(candidate).href);
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
