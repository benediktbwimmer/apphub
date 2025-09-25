import type { ExampleJobSlug, ExampleScenario, ExampleWorkflowSlug, WorkflowDefinitionTemplate } from './types';
import { getExampleJobBundle } from './jobs';
import { getExampleWorkflow } from './workflows';

function requireWorkflow(slug: ExampleWorkflowSlug): WorkflowDefinitionTemplate {
  const workflow = getExampleWorkflow(slug);
  if (!workflow) {
    throw new Error(`Unknown example workflow: ${slug}`);
  }
  return workflow.definition;
}

function requireJobBundle(slug: ExampleJobSlug) {
  const bundle = getExampleJobBundle(slug);
  if (!bundle) {
    throw new Error(`Unknown example job bundle: ${slug}`);
  }
  return bundle;
}

function jobReference(slug: ExampleJobSlug): string {
  const bundle = requireJobBundle(slug);
  return `${slug}@${bundle.version}`;
}

const fileDropRelocationWorkflowForm = {
  slug: 'file-drop-relocation',
  name: 'File drop relocation',
  version: 1,
  description: 'Moves dropped files into the archive directory and notifies the watcher service.',
  parametersSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'string', minLength: 1 },
      sourcePath: { type: 'string', minLength: 1 },
      relativePath: { type: 'string', minLength: 1 },
      destinationDir: { type: 'string', minLength: 1 },
      destinationFilename: { type: 'string', minLength: 1 }
    },
    required: ['dropId', 'sourcePath', 'relativePath', 'destinationDir']
  },
  steps: [
    {
      id: 'relocate',
      name: 'Relocate file',
      type: 'job' as const,
      jobSlug: 'file-relocator',
      parameters: {
        dropId: '{{ parameters.dropId }}',
        sourcePath: '{{ parameters.sourcePath }}',
        relativePath: '{{ parameters.relativePath }}',
        destinationDir: '{{ parameters.destinationDir }}',
        destinationFilename: '{{ parameters.destinationFilename }}'
      },
      storeResultAs: 'relocatedFile',
      retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 2_000 }
    },
    {
      id: 'notify-watcher',
      name: 'Notify watcher',
      type: 'service' as const,
      serviceSlug: 'file-drop-watcher',
      dependsOn: ['relocate'],
      timeoutMs: 5_000,
      request: {
        method: 'POST',
        path: '/api/drops/{{ parameters.dropId }}/complete',
        body: {
          dropId: '{{ parameters.dropId }}',
          runId: '{{ run.id }}',
          status: '{{ steps.relocate.status }}',
          file: '{{ shared.relocatedFile }}'
        }
      },
      allowDegraded: true
    }
  ],
  triggers: [{ type: 'manual' }]
} as const satisfies WorkflowDefinitionTemplate;

const retailSalesDailyIngestWorkflowForm = requireWorkflow('retail-sales-daily-ingest');

const retailSalesInsightsWorkflowForm = requireWorkflow('retail-sales-insights');

const observatoryHourlyDataGeneratorWorkflowForm = requireWorkflow('observatory-hourly-data-generator');

const observatoryHourlyIngestWorkflowForm = requireWorkflow('observatory-hourly-ingest');

const observatoryDailyPublicationWorkflowForm = requireWorkflow('observatory-daily-publication');

const directoryInsightsReportWorkflowForm = requireWorkflow('directory-insights-report');

const directoryInsightsArchiveWorkflowForm = requireWorkflow('directory-insights-archive');

const telemetryAssetSchema = {
  type: 'object',
  properties: {
    partitionKey: { type: 'string' },
    instrumentId: { type: 'string' },
    day: { type: 'string' },
    aggregatedAt: { type: 'string', format: 'date-time' },
    sourceFiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relativePath: { type: 'string' },
          samples: { type: 'number' }
        },
        required: ['relativePath']
      }
    },
    metrics: {
      type: 'object',
      properties: {
        samples: { type: 'number' },
        temperatureC: {
          type: 'object',
          properties: {
            min: { type: 'number' },
            max: { type: 'number' },
            mean: { type: 'number' }
          },
          required: ['min', 'max', 'mean']
        },
        humidityPct: {
          type: 'object',
          properties: {
            min: { type: 'number' },
            max: { type: 'number' },
            mean: { type: 'number' }
          },
          required: ['min', 'max', 'mean']
        }
      },
      required: ['samples', 'temperatureC', 'humidityPct']
    },
    anomalyWindow: {
      type: 'object',
      properties: {
        flagged: { type: 'boolean' },
        reason: { type: 'string' },
        firstSample: { type: 'string', format: 'date-time' },
        lastSample: { type: 'string', format: 'date-time' }
      },
      required: ['flagged']
    }
  },
  required: ['partitionKey', 'instrumentId', 'aggregatedAt', 'metrics']
};

const alertsAssetSchema = {
  type: 'object',
  properties: {
    generatedAt: { type: 'string', format: 'date-time' },
    windowHours: { type: 'number' },
    temperatureLimitC: { type: 'number' },
    humidityLimitPct: { type: 'number' },
    totalPartitions: { type: 'number' },
    flaggedInstruments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          partitionKey: { type: 'string' },
          instrumentId: { type: 'string' },
          reason: { type: 'string' },
          lastReadingAt: { type: 'string', format: 'date-time' },
          latestMetrics: { type: 'object' }
        },
        required: ['partitionKey', 'instrumentId', 'reason']
      }
    }
  },
  required: ['generatedAt', 'flaggedInstruments']
};

const fleetTelemetryDailyRollupForm = {
  slug: 'fleet-telemetry-daily-rollup',
  name: 'Fleet Telemetry Daily Rollup',
  version: 1,
  description: 'Aggregates instrument CSV readings into partitioned telemetry assets.',
  parametersSchema: {
    type: 'object',
    properties: {
      dataRoot: { type: 'string', minLength: 1 },
      instrumentId: { type: 'string', minLength: 1 },
      day: { type: 'string', minLength: 1 },
      temperatureLimitC: { type: 'number' },
      humidityLimitPct: { type: 'number' },
      outputDir: { type: 'string', minLength: 1 }
    },
    required: ['dataRoot', 'instrumentId', 'day', 'outputDir']
  },
  defaultParameters: {
    temperatureLimitC: 30,
    humidityLimitPct: 65,
    outputDir: 'examples/fleet-telemetry/data/rollups'
  },
  steps: [
    {
      id: 'compute-telemetry',
      name: 'Compute telemetry rollup',
      type: 'job' as const,
      jobSlug: 'fleet-telemetry-metrics',
      parameters: {
        dataRoot: '{{ parameters.dataRoot }}',
        instrumentId: '{{ parameters.instrumentId }}',
        day: '{{ parameters.day }}',
        temperatureLimitC: '{{ parameters.temperatureLimitC }}',
        humidityLimitPct: '{{ parameters.humidityLimitPct }}',
        outputDir: '{{ parameters.outputDir }}'
      },
      storeResultAs: 'instrumentTelemetry',
      produces: [
        {
          assetId: 'greenhouse.telemetry.instrument',
          partitioning: {
            type: 'dynamic',
            maxKeys: 1000,
            retentionDays: 120
          },
          freshness: {
            ttlMs: 86_400_000
          },
          schema: telemetryAssetSchema
        }
      ]
    }
  ],
  triggers: [{ type: 'manual' }]
} as const satisfies WorkflowDefinitionTemplate;

const fleetTelemetryAlertsForm = {
  slug: 'fleet-telemetry-alerts',
  name: 'Fleet Telemetry Alerts',
  version: 1,
  description: 'Evaluates telemetry partitions and raises greenhouse alerts when thresholds are breached.',
  parametersSchema: {
    type: 'object',
    properties: {
      telemetryDir: { type: 'string', minLength: 1 },
      windowHours: { type: 'number', minimum: 1, maximum: 168 },
      temperatureLimitC: { type: 'number' },
      humidityLimitPct: { type: 'number' }
    },
    required: ['telemetryDir', 'windowHours']
  },
  defaultParameters: {
    telemetryDir: 'examples/fleet-telemetry/data/rollups',
    windowHours: 24,
    temperatureLimitC: 30,
    humidityLimitPct: 65
  },
  steps: [
    {
      id: 'scan-instruments',
      name: 'Scan instrument telemetry',
      type: 'job' as const,
      jobSlug: 'greenhouse-alerts-runner',
      parameters: {
        telemetryDir: '{{ parameters.telemetryDir }}',
        windowHours: '{{ parameters.windowHours }}',
        temperatureLimitC: '{{ parameters.temperatureLimitC }}',
        humidityLimitPct: '{{ parameters.humidityLimitPct }}'
      },
      consumes: [{ assetId: 'greenhouse.telemetry.instrument' }],
      produces: [
        {
          assetId: 'greenhouse.telemetry.alerts',
          autoMaterialize: {
            onUpstreamUpdate: true,
            priority: 6,
            parameterDefaults: {
              windowHours: 24
            }
          },
          schema: alertsAssetSchema
        }
      ]
    }
  ],
  triggers: [{ type: 'manual' }]
} as const satisfies WorkflowDefinitionTemplate;

export const EXAMPLE_SCENARIOS: ExampleScenario[] = [
  {
    id: 'observatory-file-watcher-service',
    type: 'service-manifest',
    title: 'Observatory file watcher',
    summary: 'Registers the observatory watcher service configured for hourly ingest.',
    description:
      'Imports the service manifest that points the file watcher at the environmental observatory inbox, staging directory, and DuckDB warehouse so new drops automatically trigger `observatory-hourly-ingest`.',
    difficulty: 'beginner',
    tags: ['observatory', 'automation'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      },
      {
        label: 'File watcher guide',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/file-drop-watcher.md'
      }
    ],
    assets: [
      {
        label: 'Service config',
        path: 'examples/environmental-observatory/service-manifests/service-config.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/service-manifests/service-config.json'
      },
      {
        label: 'Service manifest',
        path: 'examples/environmental-observatory/service-manifests/service-manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/service-manifests/service-manifest.json'
      },
      {
        label: 'Watcher service',
        path: 'examples/environmental-observatory/services/observatory-file-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/environmental-observatory/services/observatory-file-watcher'
      }
    ],
    form: {
      repo: 'https://github.com/benediktbwimmer/apphub.git',
      ref: 'main',
      configPath: 'examples/environmental-observatory/service-manifests/service-config.json',
      module: 'github.com/apphub/examples/environmental-observatory',
      variables: {
        FILE_WATCH_ROOT: 'examples/environmental-observatory/data/inbox',
        FILE_WATCH_STAGING_DIR: 'examples/environmental-observatory/data/staging',
        FILE_WATCH_WAREHOUSE_PATH: 'examples/environmental-observatory/data/warehouse/observatory.duckdb',
        CATALOG_API_TOKEN: 'dev-token'
      }
    },
    analyticsTag: 'service__observatory_file_watcher',
    requiresApps: ['observatory-file-watcher']
  },
  {
    id: 'observatory-file-watcher-app',
    type: 'app',
    title: 'Observatory file watcher app',
    summary: 'Packages the watcher service into a container image.',
    description:
      'Registers the watcher repository so AppHub can build and launch it as a container. The Dockerfile installs dependencies, builds the TypeScript project, and runs the compiled watcher entry point.',
    difficulty: 'intermediate',
    tags: ['observatory', 'workflow watcher'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Watcher repository',
        path: 'examples/environmental-observatory/services/observatory-file-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/environmental-observatory/services/observatory-file-watcher'
      },
      {
        label: 'Dockerfile',
        path: 'examples/environmental-observatory/services/observatory-file-watcher/Dockerfile',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/services/observatory-file-watcher/Dockerfile'
      }
    ],
    form: {
      id: 'observatory-file-watcher',
      name: 'Observatory File Watcher',
      description: 'Watches the observatory inbox for hourly CSV drops and triggers ingest workflows automatically.',
      repoUrl: 'https://github.com/benediktbwimmer/apphub.git',
      dockerfilePath: 'examples/environmental-observatory/services/observatory-file-watcher/Dockerfile',
      tags: [
        { key: 'language', value: 'typescript' },
        { key: 'framework', value: 'fastify' }
      ],
      sourceType: 'remote',
      metadataStrategy: 'explicit'
    },
    analyticsTag: 'app__observatory_file_watcher',
    requiresServices: ['observatory-file-watcher']
  },
  {
    id: 'file-relocator-job',
    type: 'job',
    title: 'File drop relocator job',
    summary: 'Moves a newly dropped file into the archive directory.',
    description:
      'Uploads the `file-relocator` bundle (0.1.0). The watcher service triggers this job to move files out of the inbox and into `examples/file-drop/data/archive`, returning metadata for the dashboard.',
    difficulty: 'beginner',
    tags: ['file drop', 'automation'],
    docs: [
      {
        label: 'File drop watcher scenario',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/file-drop-watcher.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/file-drop/jobs/file-relocator/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/file-drop/jobs/file-relocator/manifest.json'
      },
      {
        label: 'Watcher service',
        path: 'examples/environmental-observatory/services/observatory-file-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/environmental-observatory/services/observatory-file-watcher'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('file-relocator'),
      notes: 'Bundle packaged from examples/file-drop/jobs/file-relocator. Works with the file drop watcher service.'
    },
    exampleSlug: 'file-relocator',
    analyticsTag: 'job__file_relocator',
    requiresServices: ['observatory-file-watcher']
  },
  {
    id: 'file-drop-relocation-workflow',
    type: 'workflow',
    title: 'File drop relocation',
    summary: 'Relocates dropped files and updates the watcher dashboard.',
    description:
      'Imports the `file-drop-relocation` workflow definition. Step one runs the relocator job; step two calls back into the watcher service via a workflow service step so the dashboard can record completions.',
    difficulty: 'beginner',
    tags: ['file drop', 'service'],
    docs: [
      {
        label: 'File drop watcher scenario',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/file-drop-watcher.md'
      }
    ],
    assets: [
      {
        label: 'Watcher service',
        path: 'examples/environmental-observatory/services/observatory-file-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/environmental-observatory/services/observatory-file-watcher'
      },
      {
        label: 'Relocator bundle',
        path: 'examples/file-drop/jobs/file-relocator/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/file-drop/jobs/file-relocator'
      }
    ],
    form: fileDropRelocationWorkflowForm,
    includes: ['file-relocator-job'],
    analyticsTag: 'workflow__file_drop_relocation',
    requiresServices: ['observatory-file-watcher'],
    requiresJobs: ['file-relocator']
  },
  {
    id: 'file-drop-scenario-pack',
    type: 'scenario',
    title: 'File drop watcher demo',
    summary: 'Loads the relocator job and workflow used by the watcher service.',
    description:
      'Prefills the importer with the relocator bundle and workflow so you can pair the watcher service with ready-made definitions.',
    tags: ['file drop', 'automation'],
    includes: ['file-relocator-job', 'file-drop-relocation-workflow'],
    focus: 'workflows',
    analyticsTag: 'bundle__file_drop_watcher',
    requiresServices: ['observatory-file-watcher']
  },
  {
    id: 'retail-sales-csv-loader-job',
    type: 'job',
    title: 'Retail sales CSV loader',
    summary: 'Stages the CSV ingest job that seeds `retail.sales.raw` partitions.',
    description:
      'Uploads the `retail-sales-csv-loader` bundle (0.1.0) so you can preview the ingest job against the sample dataset in `examples/retail-sales/data`. Perfect for exercising the ingest loop end-to-end.',
    difficulty: 'beginner',
    tags: ['ingest', 'retail sales'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Sample CSV dataset',
        path: 'examples/retail-sales/data/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/retail-sales/data'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('retail-sales-csv-loader'),
      notes: 'Prebuilt bundle from examples/retail-sales/jobs/retail-sales-csv-loader. Use examples/retail-sales/data as dataRoot when running.'
    },
    exampleSlug: 'retail-sales-csv-loader',
    analyticsTag: 'job__retail_sales_csv_loader'
  },
  {
    id: 'retail-sales-parquet-job',
    type: 'job',
    title: 'Retail sales parquet builder',
    summary: 'Builds curated Parquet assets from the example retail dataset.',
    description:
      'Uploads the `retail-sales-parquet-builder` bundle (0.1.0) so you can validate downstream materialization. Once the CSV loader fills partitions, run this job to emit `retail.sales.parquet` using the same data root.',
    difficulty: 'beginner',
    tags: ['fs capability', 'retail sales'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/retail-sales/jobs/retail-sales-parquet-builder/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/retail-sales/jobs/retail-sales-parquet-builder/manifest.json'
      },
      {
        label: 'Sample CSV dataset',
        path: 'examples/retail-sales/data/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/retail-sales/data'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('retail-sales-parquet-builder'),
      notes: 'Bundle sourced from examples/retail-sales/jobs/retail-sales-parquet-builder. Leave notes to document which partitions you are building.'
    },
    exampleSlug: 'retail-sales-parquet-builder',
    analyticsTag: 'job__retail_sales_parquet_builder'
  },
  {
    id: 'retail-sales-visualizer-job',
    type: 'job',
    title: 'Retail sales visualizer',
    summary: 'Publishes dashboard assets after Parquet assets refresh.',
    description:
      'Uploads the `retail-sales-visualizer` bundle (0.1.0) to complete the retail demo. The job reads the curated Parquet outputs and writes SVG/HTML artifacts so you can mirror the full walkthrough locally.',
    difficulty: 'beginner',
    tags: ['dashboard', 'retail sales'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Visualization job manifest',
        path: 'examples/retail-sales/jobs/retail-sales-visualizer/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/retail-sales/jobs/retail-sales-visualizer/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('retail-sales-visualizer'),
      notes: 'Bundle packaged from examples/retail-sales/jobs/retail-sales-visualizer. Point parameters at the Parquet output directory when running.'
    },
    exampleSlug: 'retail-sales-visualizer',
    analyticsTag: 'job__retail_sales_visualizer'
  },
  {
    id: 'fleet-telemetry-metrics-job',
    type: 'job',
    title: 'Fleet telemetry metrics',
    summary: 'Aggregates raw instrument CSVs into rollup artifacts.',
    description:
      'Uploads the `fleet-telemetry-metrics` bundle (0.1.0). With the dataset under `examples/fleet-telemetry/data/raw`, you can preview the rollup workflow and emit metrics per instrument/day.',
    difficulty: 'intermediate',
    tags: ['dynamic partitions', 'fleet telemetry'],
    docs: [
      {
        label: 'Fleet telemetry walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/fleet-telemetry-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Telemetry dataset',
        path: 'examples/fleet-telemetry/data/raw/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/fleet-telemetry/data/raw'
      },
      {
        label: 'Bundle manifest',
        path: 'examples/fleet-telemetry/jobs/fleet-telemetry-metrics/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/fleet-telemetry/jobs/fleet-telemetry-metrics/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('fleet-telemetry-metrics'),
      notes: 'Bundle built from examples/fleet-telemetry/jobs/fleet-telemetry-metrics. Use examples/fleet-telemetry/data/raw as dataRoot when previewing.'
    },
    exampleSlug: 'fleet-telemetry-metrics',
    analyticsTag: 'job__fleet_telemetry_metrics'
  },
  {
    id: 'greenhouse-alerts-runner-job',
    type: 'job',
    title: 'Greenhouse alerts runner',
    summary: 'Consumes telemetry rollups to raise greenhouse alerts.',
    description:
      'Uploads the `greenhouse-alerts-runner` bundle (0.1.0). Point the parameters at the rollup directory (`examples/fleet-telemetry/data/rollups`) to replay alert evaluation against the example metrics.',
    difficulty: 'intermediate',
    tags: ['alerts', 'fleet telemetry'],
    docs: [
      {
        label: 'Fleet telemetry walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/fleet-telemetry-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Telemetry rollups',
        path: 'examples/fleet-telemetry/data/rollups/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/examples/fleet-telemetry/data/rollups'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('greenhouse-alerts-runner'),
      notes: 'Bundle packaged from examples/fleet-telemetry/jobs/greenhouse-alerts-runner. Provide telemetryDir pointing at examples/fleet-telemetry/data/rollups.'
    },
    exampleSlug: 'greenhouse-alerts-runner',
    analyticsTag: 'job__greenhouse_alerts_runner'
  },
  {
    id: 'scan-directory-job',
    type: 'job',
    title: 'Directory scanner job',
    summary: 'Indexes a directory tree and captures per-file metadata.',
    description:
      'Uploads the `scan-directory` bundle (0.1.0). Use it to crawl `examples/directory-insights/data/output` or any workspace directory before generating visualizations.',
    difficulty: 'intermediate',
    tags: ['directory insights', 'fs capability'],
    docs: [
      {
        label: 'Directory insights walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/directory-insights-workflow.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/directory-insights/jobs/scan-directory/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/directory-insights/jobs/scan-directory/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('scan-directory'),
      notes: 'Bundle sourced from examples/directory-insights/jobs/scan-directory. Provide scanDir pointing at a workspace directory when previewing.'
    },
    exampleSlug: 'scan-directory',
    analyticsTag: 'job__scan_directory'
  },
  {
    id: 'generate-visualizations-job',
    type: 'job',
    title: 'Directory visualization builder',
    summary: 'Renders HTML, Markdown, and JSON reports from scan metadata.',
    description:
      'Uploads the `generate-visualizations` bundle (0.1.2) to turn directory scan outputs into shareable reports for the insights demo.',
    difficulty: 'intermediate',
    tags: ['directory insights', 'reporting'],
    docs: [
      {
        label: 'Directory insights walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/directory-insights-workflow.md'
      }
    ],
    assets: [
      {
        label: 'Visualization job manifest',
        path: 'examples/directory-insights/jobs/generate-visualizations/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/directory-insights/jobs/generate-visualizations/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('generate-visualizations'),
      notes: 'Bundle built from examples/directory-insights/jobs/generate-visualizations. Point scanData at the scan-directory output when running.'
    },
    exampleSlug: 'generate-visualizations',
    analyticsTag: 'job__generate_visualizations'
  },
  {
    id: 'archive-report-job',
    type: 'job',
    title: 'Directory report archiver',
    summary: 'Compresses generated reports and artifacts into a tarball.',
    description:
      'Uploads the `archive-report` bundle (0.1.1) so you can archive directory insight artifacts and publish `directory.insights.archive` assets.',
    difficulty: 'beginner',
    tags: ['directory insights', 'automation'],
    docs: [
      {
        label: 'Directory insights archive guide',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/directory-insights-archive-workflow.md'
      }
    ],
    assets: [
      {
        label: 'Archive job manifest',
        path: 'examples/directory-insights/jobs/archive-report/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/directory-insights/jobs/archive-report/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('archive-report'),
      notes: 'Bundle packaged from examples/directory-insights/jobs/archive-report. Use alongside the directory insights workflows to archive generated reports.'
    },
    exampleSlug: 'archive-report',
    analyticsTag: 'job__archive_report'
  },
  {
    id: 'observatory-data-generator-job',
    type: 'job',
    title: 'Observatory data generator',
    summary: 'Produces synthetic inbox CSVs for hourly ingest.',
    description:
      'Uploads the `observatory-data-generator` bundle (0.1.0) so you can simulate instrument drops by writing synthetic CSVs into the observatory inbox.',
    difficulty: 'beginner',
    tags: ['observatory', 'simulation'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/environmental-observatory/jobs/observatory-data-generator/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/jobs/observatory-data-generator/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('observatory-data-generator'),
      notes: 'Bundle sourced from examples/environmental-observatory/jobs/observatory-data-generator. Point inboxDir at the directory you want synthetic drops to land.'
    },
    exampleSlug: 'observatory-data-generator',
    analyticsTag: 'job__observatory_data_generator'
  },
  {
    id: 'observatory-inbox-normalizer-job',
    type: 'job',
    title: 'Observatory inbox normalizer',
    summary: 'Stages hourly CSV drops into standardized observatory assets.',
    description:
      'Uploads the `observatory-inbox-normalizer` bundle (0.1.0). Pair it with the hourly ingest workflow to emit `observatory.timeseries.raw` assets from inbox files.',
    difficulty: 'intermediate',
    tags: ['observatory', 'ingest'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/environmental-observatory/jobs/observatory-inbox-normalizer/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/jobs/observatory-inbox-normalizer/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('observatory-inbox-normalizer'),
      notes: 'Bundle sourced from examples/environmental-observatory/jobs/observatory-inbox-normalizer. Configure inbox/staging directories to match your environment.'
    },
    exampleSlug: 'observatory-inbox-normalizer',
    analyticsTag: 'job__observatory_inbox_normalizer'
  },
  {
    id: 'observatory-duckdb-loader-job',
    type: 'job',
    title: 'Observatory DuckDB loader',
    summary: 'Appends normalized readings into DuckDB snapshots.',
    description:
      'Uploads the `observatory-duckdb-loader` bundle (0.1.0) to materialize `observatory.timeseries.duckdb` assets after normalization completes.',
    difficulty: 'intermediate',
    tags: ['observatory', 'duckdb'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/environmental-observatory/jobs/observatory-duckdb-loader/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/jobs/observatory-duckdb-loader/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('observatory-duckdb-loader'),
      notes: 'Bundle packaged from examples/environmental-observatory/jobs/observatory-duckdb-loader. Point warehousePath at the DuckDB database you want to populate.'
    },
    exampleSlug: 'observatory-duckdb-loader',
    analyticsTag: 'job__observatory_duckdb_loader'
  },
  {
    id: 'observatory-visualization-runner-job',
    type: 'job',
    title: 'Observatory visualization runner',
    summary: 'Builds SVG plots and metrics from DuckDB timeseries.',
    description:
      'Uploads the `observatory-visualization-runner` bundle (0.1.0). Use it to generate observatory dashboards and feed the publication workflow.',
    difficulty: 'intermediate',
    tags: ['observatory', 'visualization'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/environmental-observatory/jobs/observatory-visualization-runner/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/jobs/observatory-visualization-runner/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('observatory-visualization-runner'),
      notes: 'Bundle sourced from examples/environmental-observatory/jobs/observatory-visualization-runner. Provide warehousePath and plotsDir when previewing.'
    },
    exampleSlug: 'observatory-visualization-runner',
    analyticsTag: 'job__observatory_visualization_runner'
  },
  {
    id: 'observatory-report-publisher-job',
    type: 'job',
    title: 'Observatory report publisher',
    summary: 'Publishes observatory status reports referencing generated plots.',
    description:
      'Uploads the `observatory-report-publisher` bundle (0.1.0). Combine it with visualization outputs to render Markdown, HTML, and JSON reports.',
    difficulty: 'intermediate',
    tags: ['observatory', 'reporting'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'examples/environmental-observatory/jobs/observatory-report-publisher/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/jobs/observatory-report-publisher/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: jobReference('observatory-report-publisher'),
      notes: 'Bundle packaged from examples/environmental-observatory/jobs/observatory-report-publisher. Supply reportsDir and visualization asset metadata before running.'
    },
    exampleSlug: 'observatory-report-publisher',
    analyticsTag: 'job__observatory_report_publisher'
  },
  {
    id: 'retail-sales-daily-ingest-workflow',
    type: 'workflow',
    title: 'Retail sales daily ingest',
    summary: 'Ingests CSV exports and builds curated Parquet assets.',
    description:
      'Imports the `retail-sales-daily-ingest` workflow definition. It runs the CSV loader and Parquet builder jobs to materialize `retail.sales.raw` and `retail.sales.parquet` partitions for a given day.',
    difficulty: 'intermediate',
    tags: ['retail sales', 'ingest'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/retail-sales/workflows/retail-sales-daily-ingest.json'
      }
    ],
    form: retailSalesDailyIngestWorkflowForm,
    includes: ['retail-sales-csv-loader-job', 'retail-sales-parquet-job'],
    analyticsTag: 'workflow__retail_sales_ingest'
  },
  {
    id: 'retail-sales-insights-workflow',
    type: 'workflow',
    title: 'Retail sales insights publishing',
    summary: 'Transforms Parquet partitions into dashboards and artifacts.',
    description:
      'Imports the `retail-sales-insights` workflow definition. It reads curated Parquet data and renders static HTML, Markdown, and JSON reports for the retail demo.',
    difficulty: 'intermediate',
    tags: ['retail sales', 'reporting'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/retail-sales/workflows/retail-sales-insights.json'
      }
    ],
    form: retailSalesInsightsWorkflowForm,
    includes: ['retail-sales-visualizer-job'],
    analyticsTag: 'workflow__retail_sales_insights'
  },
  {
    id: 'observatory-hourly-data-generator-workflow',
    type: 'workflow',
    title: 'Observatory hourly data generator',
    summary: 'Schedules synthetic instrument data drops.',
    description:
      'Imports the `observatory-hourly-data-generator` workflow definition to automate synthetic CSV drops into the observatory inbox for testing.',
    difficulty: 'beginner',
    tags: ['observatory', 'simulation'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/workflows/observatory-hourly-data-generator.json'
      }
    ],
    form: observatoryHourlyDataGeneratorWorkflowForm,
    includes: ['observatory-data-generator-job'],
    analyticsTag: 'workflow__observatory_data_generator'
  },
  {
    id: 'observatory-hourly-ingest-workflow',
    type: 'workflow',
    title: 'Observatory hourly ingest',
    summary: 'Normalizes inbox CSV drops and appends them into DuckDB.',
    description:
      'Imports the `observatory-hourly-ingest` workflow definition so you can replay the hourly ingestion loop and emit observatory telemetry assets.',
    difficulty: 'intermediate',
    tags: ['observatory', 'ingest'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/workflows/observatory-hourly-ingest.json'
      }
    ],
    form: observatoryHourlyIngestWorkflowForm,
    includes: ['observatory-inbox-normalizer-job', 'observatory-duckdb-loader-job'],
    analyticsTag: 'workflow__observatory_hourly_ingest'
  },
  {
    id: 'observatory-daily-publication-workflow',
    type: 'workflow',
    title: 'Observatory daily publication',
    summary: 'Generates observatory visualizations and publishes reports.',
    description:
      'Imports the `observatory-daily-publication` workflow definition. It renders visualizations from DuckDB snapshots and publishes hourly status reports with linked artifacts.',
    difficulty: 'intermediate',
    tags: ['observatory', 'reporting'],
    docs: [
      {
        label: 'Environmental observatory walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/environmental-observatory-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/environmental-observatory/workflows/observatory-daily-publication.json'
      }
    ],
    form: observatoryDailyPublicationWorkflowForm,
    includes: [
      'observatory-visualization-runner-job',
      'observatory-report-publisher-job',
      'observatory-hourly-ingest-workflow'
    ],
    analyticsTag: 'workflow__observatory_daily_publication'
  },
  {
    id: 'observatory-scenario-pack',
    type: 'scenario',
    title: 'Environmental observatory demo',
    summary: 'Loads services, jobs, and workflows for the observatory walkthrough.',
    description:
      'Prefills the importer with the watcher service, container app, supporting jobs, and both observatory workflows so you can replay the end-to-end environmental observatory demo.',
    tags: ['observatory', 'end-to-end'],
    includes: [
      'observatory-file-watcher-service',
      'observatory-file-watcher-app',
      'observatory-data-generator-job',
      'observatory-inbox-normalizer-job',
      'observatory-duckdb-loader-job',
      'observatory-visualization-runner-job',
      'observatory-report-publisher-job',
      'observatory-hourly-data-generator-workflow',
      'observatory-hourly-ingest-workflow',
      'observatory-daily-publication-workflow'
    ],
    focus: 'workflows',
    analyticsTag: 'bundle__observatory'
  },
  {
    id: 'directory-insights-report-workflow',
    type: 'workflow',
    title: 'Directory insights report',
    summary: 'Scans directories and renders interactive reports.',
    description:
      'Imports the `directory-insights-report` workflow definition. It runs the scan and visualization jobs to emit the `directory.insights.report` asset.',
    difficulty: 'intermediate',
    tags: ['directory insights', 'reporting'],
    docs: [
      {
        label: 'Directory insights walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/directory-insights-workflow.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/directory-insights/workflows/directory-insights-report.json'
      }
    ],
    form: directoryInsightsReportWorkflowForm,
    includes: ['scan-directory-job', 'generate-visualizations-job'],
    analyticsTag: 'workflow__directory_insights_report'
  },
  {
    id: 'directory-insights-archive-workflow',
    type: 'workflow',
    title: 'Directory insights archive',
    summary: 'Archives directory insight artifacts into compressed bundles.',
    description:
      'Imports the `directory-insights-archive` workflow definition to package visualization artifacts into a tarball and emit the `directory.insights.archive` asset.',
    difficulty: 'beginner',
    tags: ['directory insights', 'automation'],
    docs: [
      {
        label: 'Directory insights archive guide',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/directory-insights-archive-workflow.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/directory-insights/workflows/directory-insights-archive.json'
      }
    ],
    form: directoryInsightsArchiveWorkflowForm,
    includes: ['archive-report-job', 'directory-insights-report-workflow'],
    analyticsTag: 'workflow__directory_insights_archive'
  },
  {
    id: 'fleet-telemetry-daily-rollup-workflow',
    type: 'workflow',
    title: 'Fleet telemetry daily rollup',
    summary: 'Creates dynamic telemetry partitions and propagates freshness metadata.',
    description:
      'Imports the `fleet-telemetry-daily-rollup` workflow definition. It executes the metrics job with templated parameters, registers `greenhouse.telemetry.instrument` as a dynamic asset, and keeps freshness targets aligned while emitting JSON rollups.',
    difficulty: 'intermediate',
    tags: ['fleet telemetry', 'dynamic partitions'],
    docs: [
      {
        label: 'Fleet telemetry walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/fleet-telemetry-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/fleet-telemetry/workflows/fleet-telemetry-daily-rollup.json'
      }
    ],
    form: fleetTelemetryDailyRollupForm,
    includes: ['fleet-telemetry-metrics-job'],
    analyticsTag: 'workflow__fleet_telemetry_rollup'
  },
  {
    id: 'fleet-telemetry-alerts-workflow',
    type: 'workflow',
    title: 'Fleet telemetry alerts',
    summary: 'Monitors telemetry rollups and triggers greenhouse alerts.',
    description:
      'Imports the `fleet-telemetry-alerts` workflow definition. It consumes the telemetry asset, materialises alert snapshots, and demonstrates auto-materialize rules reacting to upstream updates.',
    difficulty: 'intermediate',
    tags: ['fleet telemetry', 'auto-materialize'],
    docs: [
      {
        label: 'Fleet telemetry walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/fleet-telemetry-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Workflow definition reference',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/examples/fleet-telemetry/workflows/fleet-telemetry-alerts.json'
      }
    ],
    form: fleetTelemetryAlertsForm,
    includes: ['fleet-telemetry-metrics-job', 'greenhouse-alerts-runner-job', 'fleet-telemetry-daily-rollup-workflow'],
    analyticsTag: 'workflow__fleet_telemetry_alerts'
  },
  {
    id: 'fleet-telemetry-scenario-pack',
    type: 'scenario',
    title: 'Fleet telemetry demo',
    summary: 'Loads jobs and workflows required to replay the fleet telemetry walkthrough.',
    description:
      'Prefills the job importer with the metrics and alerts bundles, loads both workflow definitions, and keeps everything focused on the workflow tab so you can validate dependencies in one pass.',
    tags: ['fleet telemetry', 'end-to-end'],
    includes: [
      'fleet-telemetry-metrics-job',
      'greenhouse-alerts-runner-job',
      'fleet-telemetry-daily-rollup-workflow',
      'fleet-telemetry-alerts-workflow'
    ],
    focus: 'workflows',
    analyticsTag: 'bundle__fleet_telemetry'
  },
  {
    id: 'all-examples-scenario-pack',
    type: 'scenario',
    title: 'Load every example',
    summary: 'Applies all service, app, job, and workflow examples in one click.',
    description:
      'Populates the import workspace with every curated example shipped in this repository. Useful when seeding a fresh environment or demo workspace.',
    tags: ['quickstart'],
    includes: [
      'observatory-file-watcher-service',
      'observatory-file-watcher-app',
      'scan-directory-job',
      'generate-visualizations-job',
      'archive-report-job',
      'observatory-inbox-normalizer-job',
      'observatory-duckdb-loader-job',
      'observatory-visualization-runner-job',
      'observatory-report-publisher-job',
      'file-relocator-job',
      'retail-sales-csv-loader-job',
      'retail-sales-parquet-job',
      'retail-sales-visualizer-job',
      'fleet-telemetry-metrics-job',
      'greenhouse-alerts-runner-job',
      'file-drop-relocation-workflow',
      'retail-sales-daily-ingest-workflow',
      'retail-sales-insights-workflow',
      'fleet-telemetry-daily-rollup-workflow',
      'fleet-telemetry-alerts-workflow',
      'observatory-hourly-ingest-workflow',
      'observatory-daily-publication-workflow',
      'directory-insights-report-workflow',
      'directory-insights-archive-workflow'
    ],
    focus: 'workflows',
    analyticsTag: 'bundle__all_examples'
  }
];
