import type { ModuleManifest } from '@apphub/module-sdk';
import { coreRequest, CoreError } from '../core';
import type { ModuleDeploymentLogger } from './types';

interface SyncJobsOptions {
  manifest: ModuleManifest;
  moduleId: string;
  moduleVersion: string;
  coreUrl: string;
  coreToken: string;
  logger: ModuleDeploymentLogger;
}

export async function syncJobs(options: SyncJobsOptions): Promise<number> {
  const targets = options.manifest.targets.filter(
    (target): target is ModuleManifest['targets'][number] & { kind: 'job' } => target.kind === 'job'
  );
  let processed = 0;

  for (const target of targets) {
    const result = await upsertJobDefinition(target, options);
    if (result) {
      processed += 1;
    }
  }

  return processed;
}

async function upsertJobDefinition(
  target: ModuleManifest['targets'][number],
  options: SyncJobsOptions
): Promise<boolean> {
  let slug = target.name;
  slug = slug.trim().toLowerCase();
  const displayName = target.displayName ?? target.name;

  const jobType: 'batch' | 'service-triggered' | 'manual' = 'batch';

  const defaultParameters = cloneJson(target.parameters?.defaults, {});
  const parametersSchema: Record<string, unknown> = {};
  const outputSchema: Record<string, unknown> = {};

  const moduleSettingsDefaults = cloneJson(options.manifest.settings?.defaults, {});
  const moduleSecretsDefaults = cloneJson(options.manifest.secrets?.defaults, {});

  const runtimeSettingsSource = target.settings?.defaults ?? moduleSettingsDefaults;
  const runtimeSecretsSource = target.secrets?.defaults ?? moduleSecretsDefaults;

  const runtimeSettings = cloneJson(runtimeSettingsSource, {});
  const runtimeSecrets = cloneJson(runtimeSecretsSource, {});

  const moduleBinding = {
    moduleId: options.moduleId,
    moduleVersion: options.moduleVersion,
    targetName: target.name,
    targetVersion: target.version,
    ...(target.fingerprint ? { targetFingerprint: target.fingerprint } : {})
  } as const;

  const metadataPayload = {
    module: {
      id: options.moduleId,
      version: options.moduleVersion,
      targetName: target.name,
      targetVersion: target.version,
      fingerprint: target.fingerprint ?? null
    },
    moduleRuntime: {
      settings: runtimeSettings,
      secrets: runtimeSecrets
    }
  } as const;

  const entryPoint = `module://${options.moduleId}/${target.name}`;

  const patchPayload = {
    name: displayName,
    type: jobType,
    runtime: 'module',
    entryPoint,
    defaultParameters,
    parametersSchema,
    outputSchema,
    metadata: metadataPayload,
    moduleBinding
  } as const;

  try {
    await coreRequest({
      baseUrl: options.coreUrl,
      token: options.coreToken,
      method: 'PATCH',
      path: `/jobs/${encodeURIComponent(slug)}`,
      body: patchPayload
    });
    options.logger.info('Updated job definition', { slug });
    return true;
  } catch (error) {
    if (!(error instanceof CoreError) || error.status !== 404) {
      throw error;
    }
  }

  await coreRequest({
    baseUrl: options.coreUrl,
    token: options.coreToken,
    method: 'POST',
    path: '/jobs',
    body: {
      slug,
      ...patchPayload,
      version: 1
    }
  });
  options.logger.info('Created job definition', { slug });
  return true;
}

function cloneJson<T>(value: unknown, fallback: T): T {
  const source = value === undefined || value === null ? fallback : (value as T);
  return JSON.parse(JSON.stringify(source)) as T;
}
