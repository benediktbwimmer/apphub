import type {
  ModuleManifestTarget,
  ModuleManifestWorkflowDetails
} from '@apphub/module-sdk';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ModuleFileReference = string;

export type JobRetryPolicyTemplate = {
  maxAttempts?: number;
  strategy?: 'none' | 'fixed' | 'exponential';
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: 'none' | 'full' | 'equal';
};

export type JobDefinitionTemplate = {
  slug: string;
  name: string;
  version?: number;
  type: 'batch' | 'service-triggered' | 'manual';
  runtime: 'node' | 'python' | 'docker' | 'module';
  entryPoint: string;
  timeoutMs?: number;
  retryPolicy?: JobRetryPolicyTemplate;
  parametersSchema?: JsonObject;
  defaultParameters?: JsonValue;
  outputSchema?: JsonObject;
  metadata?: JsonValue;
};

export type JobManifestTemplate = {
  name: string;
  version: string;
  entry: string;
  runtime: string;
  description?: string;
  capabilities?: string[];
  metadata?: JsonValue;
};

export type ModuleJobSlug =
  | 'observatory-data-generator'
  | 'observatory-inbox-normalizer'
  | 'observatory-timestore-loader'
  | 'observatory-visualization-runner'
  | 'observatory-dashboard-aggregator'
  | 'observatory-report-publisher'
  | 'observatory-calibration-importer'
  | 'observatory-calibration-planner'
  | 'observatory-calibration-reprocessor';

export type ModuleJobBundle = {
  slug: ModuleJobSlug;
  version: string;
  moduleId: string;
  moduleVersion: string;
  modulePath: ModuleFileReference;
  manifestPath: ModuleFileReference;
  target: ModuleManifestTarget & { kind: 'job' };
};

export type WorkflowTriggerTemplate = {
  type: string;
  options?: JsonValue;
};

export type WorkflowAssetFreshnessTemplate = {
  maxAgeMs?: number;
  ttlMs?: number;
  cadenceMs?: number;
};

export type WorkflowAssetAutoMaterializeTemplate = {
  onUpstreamUpdate?: boolean;
  priority?: number;
  parameterDefaults?: JsonValue;
};

export type WorkflowAssetPartitioningTemplate =
  | {
      type: 'static';
      keys: string[];
    }
  | {
      type: 'timeWindow';
      granularity: 'minute' | 'hour' | 'day' | 'week' | 'month';
      timezone?: string;
      format?: string;
      lookbackWindows?: number;
    }
  | {
      type: 'dynamic';
      maxKeys?: number;
      retentionDays?: number;
    };

export type WorkflowAssetDeclarationTemplate = {
  assetId: string;
  schema?: JsonObject;
  freshness?: WorkflowAssetFreshnessTemplate;
  autoMaterialize?: WorkflowAssetAutoMaterializeTemplate;
  partitioning?: WorkflowAssetPartitioningTemplate;
};

export type WorkflowJobStepTemplate = {
  id: string;
  name: string;
  type?: 'job';
  jobSlug: string;
  description?: string | null;
  dependsOn?: string[];
  parameters?: JsonValue;
  timeoutMs?: number | null;
  retryPolicy?: JsonValue;
  storeResultAs?: string;
  produces?: WorkflowAssetDeclarationTemplate[];
  consumes?: WorkflowAssetDeclarationTemplate[];
  bundle?: {
    slug: string;
    version?: string | null;
    exportName?: string | null;
    strategy?: 'pinned' | 'latest';
  } | null;
};

export type WorkflowServiceRequestTemplate = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<
    string,
    string | { secret: { source: 'env' | 'store'; key: string; prefix?: string } }
  >;
  query?: Record<string, string | number | boolean>;
  body?: JsonValue;
};

export type WorkflowServiceStepTemplate = {
  id: string;
  name: string;
  type: 'service';
  serviceSlug: string;
  description?: string | null;
  dependsOn?: string[];
  parameters?: JsonValue;
  timeoutMs?: number | null;
  retryPolicy?: JsonValue;
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request: WorkflowServiceRequestTemplate;
  produces?: WorkflowAssetDeclarationTemplate[];
  consumes?: WorkflowAssetDeclarationTemplate[];
};

export type WorkflowFanOutTemplateStep =
  | (WorkflowJobStepTemplate & { type?: 'job' })
  | WorkflowServiceStepTemplate;

export type WorkflowFanOutStepTemplate = {
  id: string;
  name: string;
  type: 'fanout';
  description?: string | null;
  dependsOn?: string[];
  collection: JsonValue | string;
  template: WorkflowFanOutTemplateStep;
  maxItems?: number | null;
  maxConcurrency?: number | null;
  storeResultsAs?: string;
  produces?: WorkflowAssetDeclarationTemplate[];
  consumes?: WorkflowAssetDeclarationTemplate[];
};

export type WorkflowStepTemplate =
  | WorkflowJobStepTemplate
  | WorkflowServiceStepTemplate
  | WorkflowFanOutStepTemplate;

export type WorkflowDefinitionTemplate = {
  slug: string;
  name: string;
  version?: number;
  description?: string | null;
  steps: WorkflowStepTemplate[];
  triggers?: WorkflowTriggerTemplate[];
  parametersSchema?: JsonObject;
  defaultParameters?: JsonValue;
  outputSchema?: JsonObject;
  metadata?: JsonValue;
};

export type WorkflowProvisioningScheduleTemplate = {
  name?: string;
  description?: string;
  cron: string;
  timezone?: string | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
  isActive?: boolean;
  parameters?: JsonValue;
};

export type WorkflowProvisioningEventTriggerPredicateTemplate = {
  path: string;
  operator:
    | 'exists'
    | 'equals'
    | 'notEquals'
    | 'in'
    | 'notIn'
    | 'contains'
    | 'regex'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte';
  value?: JsonValue;
  values?: JsonValue[];
  caseSensitive?: boolean;
  flags?: string;
};

export type WorkflowProvisioningEventTriggerTemplate = {
  name?: string;
  description?: string;
  eventType: string;
  eventSource?: string | null;
  predicates?: WorkflowProvisioningEventTriggerPredicateTemplate[];
  parameterTemplate?: JsonValue;
  runKeyTemplate?: string;
  metadata?: JsonValue;
  throttleWindowMs?: number;
  throttleCount?: number;
  maxConcurrency?: number;
  idempotencyKeyExpression?: string;
  status?: 'active' | 'disabled';
};

export type WorkflowProvisioningPlanTemplate = {
  schedules?: WorkflowProvisioningScheduleTemplate[];
  eventTriggers?: WorkflowProvisioningEventTriggerTemplate[];
};

export type ModuleWorkflowSlug =
  | 'observatory-minute-data-generator'
  | 'observatory-minute-ingest'
  | 'observatory-daily-publication'
  | 'observatory-dashboard-aggregate'
  | 'observatory-calibration-import'
  | 'observatory-calibration-reprocess';

export type ModuleWorkflow = {
  slug: ModuleWorkflowSlug;
  moduleId: string;
  moduleVersion: string;
  manifestPath: ModuleFileReference;
  definition: WorkflowDefinitionTemplate;
  target: ModuleManifestTarget & {
    kind: 'workflow';
    workflow: ModuleManifestWorkflowDetails;
  };
};

export type ModuleScenarioType = 'service-manifest' | 'app' | 'job' | 'workflow' | 'scenario';

export type ModuleScenarioAsset = {
  label: string;
  description?: string;
  path?: ModuleFileReference;
  href?: string;
};

export type ModuleScenarioBase<T extends ModuleScenarioType> = {
  id: string;
  type: T;
  title: string;
  summary: string;
  description: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  tags?: string[];
  docs?: ModuleScenarioAsset[];
  assets?: ModuleScenarioAsset[];
  analyticsTag?: string;
  requiresServices?: string[];
  requiresApps?: string[];
  requiresJobs?: string[];
  requiresWorkflows?: string[];
};

export type ServiceManifestScenario = ModuleScenarioBase<'service-manifest'> & {
  form: {
    sourceType?: 'git' | 'image';
    repo?: string;
    image?: string;
    ref?: string;
    commit?: string;
    configPath?: ModuleFileReference;
    module?: string;
    variables?: Record<string, string>;
  };
};

export type AppScenario = ModuleScenarioBase<'app'> & {
  form: {
    id?: string;
    name: string;
    description: string;
    repoUrl: string;
    dockerfilePath: ModuleFileReference;
    tags?: { key: string; value: string }[];
    sourceType?: 'remote' | 'local';
    metadataStrategy?: 'auto' | 'explicit';
  };
};

export type JobScenario = ModuleScenarioBase<'job'> & {
  form: {
    source: 'upload' | 'registry';
    reference?: string;
    notes?: string;
  };
  bundle?: {
    filename: string;
    publicPath: string;
    contentType?: string;
  };
  /**
   * @deprecated Legacy example slug kept for backwards compatibility while the importer migrates to module-first flows.
   */
  exampleSlug?: string;
  moduleId?: ModuleJobSlug;
};

export type WorkflowScenario = ModuleScenarioBase<'workflow'> & {
  form: WorkflowDefinitionTemplate;
  includes?: string[];
};

export type ScenarioBundle = ModuleScenarioBase<'scenario'> & {
  includes: string[];
  focus?: 'service-manifests' | 'apps' | 'jobs' | 'workflows';
};

export type ModuleScenario =
  | ServiceManifestScenario
  | AppScenario
  | JobScenario
  | WorkflowScenario
  | ScenarioBundle;

export function isScenarioType<T extends ModuleScenarioType>(
  scenario: ModuleScenario,
  type: T
): scenario is Extract<ModuleScenario, { type: T }> {
  return scenario.type === type;
}

export function groupScenariosByType(scenarios: ModuleScenario[]) {
  return scenarios.reduce<{
    'service-manifest': ServiceManifestScenario[];
    app: AppScenario[];
    job: JobScenario[];
    workflow: WorkflowScenario[];
    scenario: ScenarioBundle[];
  }>(
    (acc, scenario) => {
      switch (scenario.type) {
        case 'service-manifest':
          acc['service-manifest'].push(scenario);
          break;
        case 'app':
          acc.app.push(scenario);
          break;
        case 'job':
          acc.job.push(scenario);
          break;
        case 'workflow':
          acc.workflow.push(scenario);
          break;
        case 'scenario':
          acc.scenario.push(scenario);
          break;
        default:
          break;
      }
      return acc;
    },
    { 'service-manifest': [], app: [], job: [], workflow: [], scenario: [] }
  );
}
