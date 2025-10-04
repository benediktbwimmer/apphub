import type { WorkflowProvisioningPlan } from '@apphub/module-registry';
import type { ModuleManifest, WorkflowDefinition } from '@apphub/module-sdk';
import type { S3BucketOptions } from '@apphub/module-registry';
import type { CoreRequestConfig } from '../core';

export interface ModuleDeploymentLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}

export interface ModuleDeploymentContext {
  modulePath: string;
  distPath: string;
  manifest: ModuleManifest;
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}

export interface WorkflowCustomization<TConfig> {
  applyDefaults?: (definition: WorkflowDefinition, config: TConfig) => void;
  buildPlan?: (definition: WorkflowDefinition, config: TConfig) => WorkflowProvisioningPlan | null | undefined;
}

export interface ModuleDeploymentPreparedState<TConfig = unknown> {
  config?: TConfig;
  configPath?: string;
  buckets?: S3BucketOptions[];
  workflow?: WorkflowCustomization<TConfig>;
  filestore?: FilestoreProvisioning;
  postDeploy?: (context: ModulePostDeployContext<TConfig>) => Promise<void> | void;
}

export interface FilestoreProvisioning {
  baseUrl: string;
  token: string | null;
  backendMountId: number | null;
  backendMountKey: string | null;
  prefixes: string[];
  principal: string;
  bucket: string | null;
  endpoint: string | null;
  region: string | null;
  forcePathStyle: boolean | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  sessionToken: string | null;
}

export interface ModulePostDeployContext<TConfig> {
  config?: TConfig;
  core: {
    baseUrl: string;
    token: string;
    request: <T>(config: Omit<CoreRequestConfig, 'baseUrl' | 'token'>) => Promise<T>;
  };
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}

export interface ModuleDeploymentAdapter<TConfig = unknown> {
  prepare(context: ModuleDeploymentContext): Promise<ModuleDeploymentPreparedState<TConfig>>;
}

export interface DeployModuleResult {
  configPath?: string;
  jobsProcessed: number;
  workflowsProcessed: number;
  servicesProcessed: number;
  bucketsEnsured: number;
  filestorePrefixesEnsured: number;
}
