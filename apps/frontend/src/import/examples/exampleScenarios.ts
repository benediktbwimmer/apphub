import type { WorkflowCreateInput } from '../../workflows/api';
import type { ExampleScenario } from './types';

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
} as const satisfies WorkflowCreateInput;

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
    outputDir: 'services/catalog/data/examples/fleet-telemetry-rollups'
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
} as const satisfies WorkflowCreateInput;

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
    telemetryDir: 'services/catalog/data/examples/fleet-telemetry-rollups',
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
} as const satisfies WorkflowCreateInput;

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
        label: 'Service manifest',
        path: 'services/examples/environmental-observatory/service-manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/services/examples/environmental-observatory/service-manifest.json'
      },
      {
        label: 'Watcher service',
        path: 'services/examples/file-drop-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/examples/file-drop-watcher'
      }
    ],
    form: {
      repo: 'https://github.com/benediktbwimmer/apphub.git',
      ref: 'main',
      configPath: 'services/examples/environmental-observatory/service-manifest.json',
      variables: {
        FILE_WATCH_ROOT: 'services/catalog/data/examples/environmental-observatory/inbox',
        FILE_WATCH_STAGING_DIR: 'services/catalog/data/examples/environmental-observatory/staging',
        FILE_WATCH_WAREHOUSE_PATH: 'services/catalog/data/examples/environmental-observatory/warehouse/observatory.duckdb',
        CATALOG_API_TOKEN: 'replace-with-operator-token'
      }
    },
    analyticsTag: 'service__observatory_file_watcher'
  },
  {
    id: 'file-relocator-job',
    type: 'job',
    title: 'File drop relocator job',
    summary: 'Moves a newly dropped file into the archive directory.',
    description:
      'Uploads the `file-relocator` bundle (0.1.0). The watcher service triggers this job to move files out of the inbox and into `services/catalog/data/examples/file-drop/archive`, returning metadata for the dashboard.',
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
        path: 'job-bundles/file-relocator/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/file-relocator/manifest.json'
      },
      {
        label: 'Watcher service',
        path: 'services/examples/file-drop-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/examples/file-drop-watcher'
      }
    ],
  form: {
    source: 'upload',
    reference: 'file-relocator@0.1.0',
    notes: 'Bundle packaged from job-bundles/file-relocator. Works with the file drop watcher service.'
  },
  exampleSlug: 'file-relocator',
  analyticsTag: 'job__file_relocator'
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
        path: 'services/examples/file-drop-watcher/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/examples/file-drop-watcher'
      },
      {
        label: 'Relocator bundle',
        path: 'job-bundles/file-relocator/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/job-bundles/file-relocator'
      }
    ],
    form: fileDropRelocationWorkflowForm,
    includes: ['file-relocator-job'],
    analyticsTag: 'workflow__file_drop_relocation'
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
    analyticsTag: 'bundle__file_drop_watcher'
  },
  {
    id: 'retail-sales-csv-loader-job',
    type: 'job',
    title: 'Retail sales CSV loader',
    summary: 'Stages the CSV ingest job that seeds `retail.sales.raw` partitions.',
    description:
      'Uploads the `retail-sales-csv-loader` bundle (0.1.0) so you can preview the ingest job against the sample dataset in `services/catalog/data/examples/retail-sales`. Perfect for exercising the ingest loop end-to-end.',
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
        path: 'services/catalog/data/examples/retail-sales/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/retail-sales'
      }
    ],
    form: {
      source: 'upload',
      reference: 'retail-sales-csv-loader@0.1.0',
      notes: 'Prebuilt bundle from job-bundles/retail-sales-csv-loader. Use services/catalog/data/examples/retail-sales as dataRoot when running.'
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
        path: 'job-bundles/retail-sales-parquet-builder/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/retail-sales-parquet-builder/manifest.json'
      },
      {
        label: 'Sample CSV dataset',
        path: 'services/catalog/data/examples/retail-sales/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/retail-sales'
      }
    ],
    form: {
      source: 'upload',
      reference: 'retail-sales-parquet-builder@0.1.0',
      notes: 'Bundle sourced from job-bundles/retail-sales-parquet-builder. Leave notes to document which partitions you are building.'
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
        path: 'job-bundles/retail-sales-visualizer/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/retail-sales-visualizer/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: 'retail-sales-visualizer@0.1.0',
      notes: 'Bundle packaged from job-bundles/retail-sales-visualizer. Point parameters at the Parquet output directory when running.'
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
      'Uploads the `fleet-telemetry-metrics` bundle (0.1.0). With the dataset under `services/catalog/data/examples/fleet-telemetry`, you can preview the rollup workflow and emit metrics per instrument/day.',
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
        path: 'services/catalog/data/examples/fleet-telemetry/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/fleet-telemetry'
      },
      {
        label: 'Bundle manifest',
        path: 'job-bundles/fleet-telemetry-metrics/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/fleet-telemetry-metrics/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: 'fleet-telemetry-metrics@0.1.0',
      notes: 'Bundle built from job-bundles/fleet-telemetry-metrics. Use services/catalog/data/examples/fleet-telemetry as dataRoot when previewing.'
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
      'Uploads the `greenhouse-alerts-runner` bundle (0.1.0). Point the parameters at the rollup directory (`services/catalog/data/examples/fleet-telemetry-rollups`) to replay alert evaluation against the example metrics.',
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
        path: 'services/catalog/data/examples/fleet-telemetry-rollups/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/fleet-telemetry-rollups'
      }
    ],
    form: {
      source: 'upload',
      reference: 'greenhouse-alerts-runner@0.1.0',
      notes: 'Bundle packaged from job-bundles/greenhouse-alerts-runner. Provide telemetryDir pointing at services/catalog/data/examples/fleet-telemetry-rollups.'
    },
    exampleSlug: 'greenhouse-alerts-runner',
    analyticsTag: 'job__greenhouse_alerts_runner'
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
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/services/catalog/src/workflows/examples/fleetTelemetryExamples.ts'
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
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/services/catalog/src/workflows/examples/fleetTelemetryExamples.ts'
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
      'file-relocator-job',
      'file-drop-relocation-workflow',
      'retail-sales-csv-loader-job',
      'retail-sales-parquet-job',
      'retail-sales-visualizer-job',
      'fleet-telemetry-metrics-job',
      'greenhouse-alerts-runner-job',
      'fleet-telemetry-daily-rollup-workflow',
      'fleet-telemetry-alerts-workflow'
    ],
    focus: 'workflows',
    analyticsTag: 'bundle__all_examples'
  }
];
