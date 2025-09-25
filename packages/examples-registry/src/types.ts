export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ExampleFileReference = string;

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
  runtime: 'node' | 'python';
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

export type ExampleJobSlug =
  | 'file-relocator'
  | 'retail-sales-csv-loader'
  | 'retail-sales-parquet-builder'
  | 'retail-sales-visualizer'
  | 'fleet-telemetry-metrics'
  | 'greenhouse-alerts-runner'
  | 'observatory-data-generator'
  | 'observatory-inbox-normalizer'
  | 'observatory-duckdb-loader'
  | 'observatory-visualization-runner'
  | 'observatory-report-publisher'
  | 'scan-directory'
  | 'generate-visualizations'
  | 'archive-report';

export type ExampleJobBundle = {
  slug: ExampleJobSlug;
  version: string;
  directory: ExampleFileReference;
  manifestPath: ExampleFileReference;
  jobDefinitionPath: ExampleFileReference;
  manifest: JobManifestTemplate;
  definition: JobDefinitionTemplate;
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

export type WorkflowStepTemplate = WorkflowJobStepTemplate | WorkflowServiceStepTemplate;

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

export type ExampleWorkflowSlug =
  | 'observatory-hourly-data-generator'
  | 'observatory-hourly-ingest'
  | 'observatory-daily-publication'
  | 'retail-sales-daily-ingest'
  | 'retail-sales-insights'
  | 'fleet-telemetry-daily-rollup'
  | 'fleet-telemetry-alerts'
  | 'directory-insights-report'
  | 'directory-insights-archive';

export type ExampleWorkflow = {
  slug: ExampleWorkflowSlug;
  path: ExampleFileReference;
  definition: WorkflowDefinitionTemplate;
};

export type ExampleScenarioType = 'service-manifest' | 'app' | 'job' | 'workflow' | 'scenario';

export type ExampleScenarioAsset = {
  label: string;
  description?: string;
  path?: ExampleFileReference;
  href?: string;
};

export type ExampleScenarioBase<T extends ExampleScenarioType> = {
  id: string;
  type: T;
  title: string;
  summary: string;
  description: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  tags?: string[];
  docs?: ExampleScenarioAsset[];
  assets?: ExampleScenarioAsset[];
  analyticsTag?: string;
  requiresServices?: string[];
  requiresApps?: string[];
  requiresJobs?: string[];
  requiresWorkflows?: string[];
};

export type ServiceManifestScenario = ExampleScenarioBase<'service-manifest'> & {
  form: {
    repo: string;
    ref?: string;
    commit?: string;
    configPath?: ExampleFileReference;
    module?: string;
    variables?: Record<string, string>;
  };
};

export type AppScenario = ExampleScenarioBase<'app'> & {
  form: {
    id?: string;
    name: string;
    description: string;
    repoUrl: string;
    dockerfilePath: ExampleFileReference;
    tags?: { key: string; value: string }[];
    sourceType?: 'remote' | 'local';
    metadataStrategy?: 'auto' | 'explicit';
  };
};

export type JobScenario = ExampleScenarioBase<'job'> & {
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
  exampleSlug?: ExampleJobSlug;
};

export type WorkflowScenario = ExampleScenarioBase<'workflow'> & {
  form: WorkflowDefinitionTemplate;
  includes?: string[];
};

export type ScenarioBundle = ExampleScenarioBase<'scenario'> & {
  includes: string[];
  focus?: 'service-manifests' | 'apps' | 'jobs' | 'workflows';
};

export type ExampleScenario =
  | ServiceManifestScenario
  | AppScenario
  | JobScenario
  | WorkflowScenario
  | ScenarioBundle;

export function isScenarioType<T extends ExampleScenarioType>(
  scenario: ExampleScenario,
  type: T
): scenario is Extract<ExampleScenario, { type: T }> {
  return scenario.type === type;
}

export function groupScenariosByType(scenarios: ExampleScenario[]) {
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
