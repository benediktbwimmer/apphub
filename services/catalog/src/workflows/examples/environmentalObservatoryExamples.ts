import type {
  JobDefinitionCreateInput,
  WorkflowDefinitionCreateInput,
  WorkflowJsonValue
} from '../zodSchemas';

const rawTimeseriesAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    partitionKey: { type: 'string' },
    hour: { type: 'string' },
    instrumentCount: { type: 'number' },
    recordCount: { type: 'number' },
    sourceFiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relativePath: { type: 'string' },
          site: { type: 'string' },
          instrumentId: { type: 'string' },
          rows: { type: 'number' }
        },
        required: ['relativePath', 'rows']
      }
    },
    stagingDir: { type: 'string' },
    normalizedAt: { type: 'string', format: 'date-time' }
  },
  required: ['partitionKey', 'hour', 'recordCount', 'sourceFiles', 'normalizedAt']
};

const duckdbSnapshotAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    partitionKey: { type: 'string' },
    warehousePath: { type: 'string' },
    appendedRows: { type: 'number' },
    totalRows: { type: 'number' },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rowCount: { type: 'number' }
        },
        required: ['name', 'rowCount']
      }
    },
    checkpointCreatedAt: { type: 'string', format: 'date-time' }
  },
  required: ['partitionKey', 'warehousePath', 'appendedRows', 'checkpointCreatedAt']
};

const visualizationAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    generatedAt: { type: 'string', format: 'date-time' },
    partitionKey: { type: 'string' },
    plotsDir: { type: 'string' },
    lookbackHours: { type: 'number' },
    artifacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relativePath: { type: 'string' },
          mediaType: { type: 'string' },
          description: { type: 'string' },
          sizeBytes: { type: 'number' }
        },
        required: ['relativePath', 'mediaType']
      }
    },
    metrics: {
      type: 'object',
      additionalProperties: true
    }
  },
  required: ['generatedAt', 'partitionKey', 'plotsDir', 'artifacts']
};

const reportAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    generatedAt: { type: 'string', format: 'date-time' },
    reportsDir: { type: 'string' },
    reportFiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relativePath: { type: 'string' },
          mediaType: { type: 'string' },
          sizeBytes: { type: 'number' }
        },
        required: ['relativePath', 'mediaType']
      }
    },
    summary: {
      type: 'object',
      properties: {
        instrumentCount: { type: 'number' },
        siteCount: { type: 'number' },
        alertCount: { type: 'number' }
      }
    },
    plotsReferenced: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relativePath: { type: 'string' },
          altText: { type: 'string' }
        },
        required: ['relativePath']
      }
    }
  },
  required: ['generatedAt', 'reportsDir', 'reportFiles']
};

export const environmentalObservatoryJobs: JobDefinitionCreateInput[] = [
  {
    slug: 'observatory-inbox-normalizer',
    name: 'Observatory Inbox Normalizer',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:observatory-inbox-normalizer@0.1.0#handler',
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 3, strategy: 'exponential', initialDelayMs: 5_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        inboxDir: { type: 'string', minLength: 1 },
        stagingDir: { type: 'string', minLength: 1 },
        hour: { type: 'string', minLength: 1 },
        maxFiles: { type: 'number', minimum: 1, maximum: 200 }
      },
      required: ['inboxDir', 'stagingDir', 'hour']
    },
    defaultParameters: {
      maxFiles: 64
    },
    outputSchema: rawTimeseriesAssetSchema
  },
  {
    slug: 'observatory-duckdb-loader',
    name: 'Observatory DuckDB Loader',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:observatory-duckdb-loader@0.1.0#handler',
    timeoutMs: 180_000,
    retryPolicy: { maxAttempts: 3, strategy: 'exponential', initialDelayMs: 10_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        warehousePath: { type: 'string', minLength: 1 },
        hour: { type: 'string', minLength: 1 },
        rawAsset: { type: 'object' },
        vacuum: { type: 'boolean' }
      },
      required: ['warehousePath', 'hour', 'rawAsset']
    },
    defaultParameters: {
      vacuum: false
    },
    outputSchema: duckdbSnapshotAssetSchema
  },
  {
    slug: 'observatory-visualization-runner',
    name: 'Observatory Visualization Runner',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:observatory-visualization-runner@0.1.0#handler',
    timeoutMs: 150_000,
    retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 10_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        warehousePath: { type: 'string', minLength: 1 },
        plotsDir: { type: 'string', minLength: 1 },
        partitionKey: { type: 'string', minLength: 1 },
        lookbackHours: { type: 'number', minimum: 1, maximum: 336 },
        siteFilter: { type: 'string' }
      },
      required: ['warehousePath', 'plotsDir', 'partitionKey']
    },
    defaultParameters: {
      lookbackHours: 72
    },
    outputSchema: visualizationAssetSchema
  },
  {
    slug: 'observatory-report-publisher',
    name: 'Observatory Report Publisher',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:observatory-report-publisher@0.1.0#handler',
    timeoutMs: 180_000,
    retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 15_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        reportsDir: { type: 'string', minLength: 1 },
        plotsDir: { type: 'string', minLength: 1 },
        partitionKey: { type: 'string', minLength: 1 },
        reportTemplate: { type: 'string' },
        visualizationAsset: { type: 'object' }
      },
      required: ['reportsDir', 'plotsDir', 'partitionKey', 'visualizationAsset']
    },
    outputSchema: reportAssetSchema
  }
];

export const observatoryHourlyIngestWorkflow: WorkflowDefinitionCreateInput = {
  slug: 'observatory-hourly-ingest',
  name: 'Observatory Hourly Ingest',
  version: 1,
  description: 'Normalizes inbox CSVs and persists hourly readings into DuckDB.',
  parametersSchema: {
    type: 'object',
    properties: {
      inboxDir: { type: 'string', minLength: 1 },
      stagingDir: { type: 'string', minLength: 1 },
      warehousePath: { type: 'string', minLength: 1 },
      hour: { type: 'string', minLength: 1 },
      maxFiles: { type: 'number', minimum: 1, maximum: 200 },
      vacuum: { type: 'boolean' }
    },
    required: ['inboxDir', 'stagingDir', 'warehousePath', 'hour']
  },
  defaultParameters: {
    maxFiles: 64,
    vacuum: false,
    inboxDir: 'services/catalog/data/examples/environmental-observatory/inbox',
    stagingDir: 'services/catalog/data/examples/environmental-observatory/staging',
    warehousePath: 'services/catalog/data/examples/environmental-observatory/warehouse/observatory.duckdb'
  },
  steps: [
    {
      id: 'normalize-inbox',
      name: 'Normalize inbox files',
      type: 'job',
      jobSlug: 'observatory-inbox-normalizer',
      parameters: {
        inboxDir: '{{ parameters.inboxDir }}',
        stagingDir: '{{ parameters.stagingDir }}',
        hour: '{{ parameters.hour }}',
        maxFiles: '{{ parameters.maxFiles }}'
      },
      storeResultAs: 'normalizedOutput',
      produces: [
        {
          assetId: 'observatory.timeseries.raw',
          partitioning: {
            type: 'timeWindow',
            granularity: 'hour',
            format: 'YYYY-MM-DDTHH',
            lookbackWindows: 168
          },
          schema: rawTimeseriesAssetSchema
        }
      ]
    },
    {
      id: 'load-duckdb',
      name: 'Append to DuckDB',
      type: 'job',
      jobSlug: 'observatory-duckdb-loader',
      dependsOn: ['normalize-inbox'],
      parameters: {
        warehousePath: '{{ parameters.warehousePath }}',
        hour: '{{ parameters.hour }}',
        rawAsset: '{{ shared.normalizedOutput }}',
        vacuum: '{{ parameters.vacuum }}'
      },
      storeResultAs: 'duckdbSnapshot',
      consumes: [{ assetId: 'observatory.timeseries.raw' }],
      produces: [
        {
          assetId: 'observatory.timeseries.duckdb',
          partitioning: {
            type: 'timeWindow',
            granularity: 'hour',
            format: 'YYYY-MM-DDTHH',
            lookbackWindows: 168
          },
          freshness: {
            ttlMs: 3_600_000
          },
          autoMaterialize: {
            onUpstreamUpdate: true,
            priority: 5
          },
          schema: duckdbSnapshotAssetSchema
        }
      ]
    }
  ],
  triggers: [
    { type: 'manual' },
    {
      type: 'schedule',
      schedule: {
        cron: '5 * * * *',
        timezone: 'UTC',
        catchUp: true
      }
    }
  ]
};

export const observatoryDailyPublicationWorkflow: WorkflowDefinitionCreateInput = {
  slug: 'observatory-daily-publication',
  name: 'Observatory Visualization & Reports',
  version: 1,
  description: 'Generates plots and publishes hourly status reports from DuckDB snapshots.',
  parametersSchema: {
    type: 'object',
    properties: {
      warehousePath: { type: 'string', minLength: 1 },
      plotsDir: { type: 'string', minLength: 1 },
      reportsDir: { type: 'string', minLength: 1 },
      partitionKey: { type: 'string', minLength: 1 },
      lookbackHours: { type: 'number', minimum: 1, maximum: 336 },
      siteFilter: { type: 'string' },
      reportTemplate: { type: 'string' }
    },
    required: ['warehousePath', 'plotsDir', 'reportsDir', 'partitionKey']
  },
  defaultParameters: {
    lookbackHours: 72,
    warehousePath: 'services/catalog/data/examples/environmental-observatory/warehouse/observatory.duckdb',
    plotsDir: 'services/catalog/data/examples/environmental-observatory/plots',
    reportsDir: 'services/catalog/data/examples/environmental-observatory/reports'
  },
  steps: [
    {
      id: 'generate-plots',
      name: 'Generate observatory plots',
      type: 'job',
      jobSlug: 'observatory-visualization-runner',
      parameters: {
        warehousePath: '{{ parameters.warehousePath }}',
        plotsDir: '{{ parameters.plotsDir }}',
        partitionKey: '{{ parameters.partitionKey }}',
        lookbackHours: '{{ parameters.lookbackHours }}',
        siteFilter: '{{ parameters.siteFilter }}'
      },
      storeResultAs: 'visualizations',
      consumes: [{ assetId: 'observatory.timeseries.duckdb' }],
      produces: [
        {
          assetId: 'observatory.visualizations.hourly',
          freshness: {
            ttlMs: 86_400_000
          },
          autoMaterialize: {
            onUpstreamUpdate: true,
            priority: 6
          },
          schema: visualizationAssetSchema
        }
      ]
    },
    {
      id: 'publish-report',
      name: 'Publish status report',
      type: 'job',
      jobSlug: 'observatory-report-publisher',
      dependsOn: ['generate-plots'],
      parameters: {
        reportsDir: '{{ parameters.reportsDir }}',
        plotsDir: '{{ parameters.plotsDir }}',
        partitionKey: '{{ parameters.partitionKey }}',
        reportTemplate: '{{ parameters.reportTemplate }}',
        visualizationAsset: '{{ shared.visualizations }}'
      },
      consumes: [{ assetId: 'observatory.visualizations.hourly' }],
      produces: [
        {
          assetId: 'observatory.reports.status',
          autoMaterialize: {
            onUpstreamUpdate: true,
            priority: 7
          },
          schema: reportAssetSchema
        }
      ]
    }
  ],
  triggers: [
    { type: 'manual' },
    {
      type: 'schedule',
      schedule: {
        cron: '15 * * * *',
        timezone: 'UTC',
        catchUp: false
      }
    }
  ]
};

export const environmentalObservatoryWorkflows = {
  jobs: environmentalObservatoryJobs,
  ingestWorkflow: observatoryHourlyIngestWorkflow,
  publicationWorkflow: observatoryDailyPublicationWorkflow
};

export default environmentalObservatoryWorkflows;
