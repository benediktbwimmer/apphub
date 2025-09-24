import type {
  JobDefinitionCreateInput,
  WorkflowDefinitionCreateInput,
  WorkflowJsonValue
} from '../zodSchemas';

const retailRawAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    partitionKey: { type: 'string' },
    sourceFile: { type: 'string' },
    totals: {
      type: 'object',
      properties: {
        units: { type: 'number' },
        revenue: { type: 'number' },
        averageOrderValue: { type: 'number' }
      },
      required: ['units', 'revenue']
    },
    byCategory: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          units: { type: 'number' },
          revenue: { type: 'number' }
        },
        required: ['category', 'revenue']
      }
    },
    byRegion: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          revenue: { type: 'number' }
        },
        required: ['region', 'revenue']
      }
    },
    channels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          revenue: { type: 'number' }
        },
        required: ['channel', 'revenue']
      }
    }
  },
  required: ['partitionKey', 'sourceFile', 'totals']
};

const retailParquetAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    partitionKey: { type: 'string' },
    parquetFile: { type: 'string' },
    summaryFile: { type: 'string' },
    totals: {
      type: 'object',
      properties: {
        units: { type: 'number' },
        revenue: { type: 'number' },
        averageOrderValue: { type: 'number' }
      },
      required: ['units', 'revenue']
    },
    byCategory: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          units: { type: 'number' },
          revenue: { type: 'number' }
        },
        required: ['category', 'revenue']
      }
    },
    byRegion: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          revenue: { type: 'number' }
        },
        required: ['region', 'revenue']
      }
    },
    channels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          revenue: { type: 'number' }
        },
        required: ['channel', 'revenue']
      }
    }
  },
  required: ['partitionKey', 'parquetFile', 'summaryFile', 'totals']
};

const retailReportAssetSchema: Record<string, WorkflowJsonValue> = {
  type: 'object',
  properties: {
    reportTitle: { type: 'string' },
    generatedAt: { type: 'string', format: 'date-time' },
    partitions: { type: 'number' },
    totalRevenue: { type: 'number' },
    totalUnits: { type: 'number' },
    averageOrderValue: { type: 'number' },
    revenueSeries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          partitionKey: { type: 'string' },
          revenue: { type: 'number' }
        },
        required: ['partitionKey', 'revenue']
      }
    },
    topCategories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          revenue: { type: 'number' },
          share: { type: 'number' }
        },
        required: ['category', 'revenue']
      }
    },
    topRegions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          revenue: { type: 'number' },
          share: { type: 'number' }
        },
        required: ['region', 'revenue']
      }
    },
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
    }
  },
  required: ['reportTitle', 'generatedAt', 'partitions', 'totalRevenue', 'artifacts']
};

export const retailSalesJobs: JobDefinitionCreateInput[] = [
  {
    slug: 'retail-sales-csv-loader',
    name: 'Retail Sales CSV Loader',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:retail-sales-csv-loader@0.1.0#handler',
    timeoutMs: 60_000,
    retryPolicy: { maxAttempts: 2, strategy: 'exponential' },
    parametersSchema: {
      type: 'object',
      properties: {
        dataRoot: { type: 'string', minLength: 1 },
        partitionKey: { type: 'string', minLength: 1 },
        datasetName: { type: 'string' },
        sampleSize: { type: 'number', minimum: 1, maximum: 20 }
      },
      required: ['dataRoot', 'partitionKey']
    },
    defaultParameters: {
      datasetName: 'retail_sales',
      sampleSize: 5
    }
  },
  {
    slug: 'retail-sales-parquet-builder',
    name: 'Retail Sales Parquet Builder',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:retail-sales-parquet-builder@0.1.0#handler',
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 5_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        warehouseDir: { type: 'string', minLength: 1 },
        partitionKey: { type: 'string', minLength: 1 },
        rawPartition: { type: 'object' }
      },
      required: ['warehouseDir', 'partitionKey', 'rawPartition']
    }
  },
  {
    slug: 'retail-sales-visualizer',
    name: 'Retail Sales Visualizer',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:retail-sales-visualizer@0.1.0#handler',
    timeoutMs: 90_000,
    retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 5_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        warehouseDir: { type: 'string', minLength: 1 },
        outputDir: { type: 'string', minLength: 1 },
        reportTitle: { type: 'string' },
        lookback: { type: 'number', minimum: 1, maximum: 90 }
      },
      required: ['warehouseDir', 'outputDir']
    },
    defaultParameters: {
      reportTitle: 'Retail Sales Daily Report',
      lookback: 14
    }
  }
];

export const retailSalesDailyIngestWorkflow: WorkflowDefinitionCreateInput = {
  slug: 'retail-sales-daily-ingest',
  name: 'Retail Sales Daily Ingest',
  version: 1,
  description: 'Loads partitioned CSV exports and builds Parquet snapshots.',
  parametersSchema: {
    type: 'object',
    properties: {
      dataRoot: { type: 'string', minLength: 1 },
      warehouseDir: { type: 'string', minLength: 1 },
      datasetName: { type: 'string' },
      partitionKey: { type: 'string', minLength: 1 }
    },
    required: ['dataRoot', 'warehouseDir', 'partitionKey']
  },
  defaultParameters: {
    datasetName: 'retail_sales'
  },
  steps: [
    {
      id: 'load-partition',
      name: 'Load partition CSV',
      type: 'job',
      jobSlug: 'retail-sales-csv-loader',
      parameters: {
        dataRoot: '{{ parameters.dataRoot }}',
        datasetName: '{{ parameters.datasetName }}',
        partitionKey: '{{ parameters.partitionKey }}'
      },
      storeResultAs: 'rawPartition',
      produces: [
        {
          assetId: 'retail.sales.raw',
          partitioning: {
            type: 'timeWindow',
            granularity: 'day',
            format: 'YYYY-MM-DD',
            lookbackWindows: 30
          },
          schema: retailRawAssetSchema
        }
      ]
    },
    {
      id: 'build-parquet',
      name: 'Build Parquet artifacts',
      type: 'job',
      jobSlug: 'retail-sales-parquet-builder',
      dependsOn: ['load-partition'],
      parameters: {
        warehouseDir: '{{ parameters.warehouseDir }}',
        partitionKey: '{{ shared.rawPartition.partitionKey }}',
        rawPartition: '{{ shared.rawPartition }}'
      },
      storeResultAs: 'warehousePartition',
      consumes: [{ assetId: 'retail.sales.raw' }],
      produces: [
        {
          assetId: 'retail.sales.parquet',
          partitioning: {
            type: 'timeWindow',
            granularity: 'day',
            format: 'YYYY-MM-DD',
            lookbackWindows: 30
          },
          schema: retailParquetAssetSchema
        }
      ]
    }
  ],
  triggers: [
    { type: 'manual' },
    {
      type: 'schedule',
      schedule: {
        cron: '30 5 * * *',
        timezone: 'UTC',
        catchUp: false
      }
    }
  ]
};

export const retailSalesInsightsWorkflow: WorkflowDefinitionCreateInput = {
  slug: 'retail-sales-insights',
  name: 'Retail Sales Insights Publishing',
  version: 1,
  description: 'Aggregates Parquet partitions, renders plots, and publishes a static dashboard.',
  parametersSchema: {
    type: 'object',
    properties: {
      warehouseDir: { type: 'string', minLength: 1 },
      outputDir: { type: 'string', minLength: 1 },
      reportTitle: { type: 'string' },
      lookback: { type: 'number', minimum: 1, maximum: 90 }
    },
    required: ['warehouseDir', 'outputDir']
  },
  defaultParameters: {
    reportTitle: 'Retail Sales Daily Report',
    lookback: 14
  },
  steps: [
    {
      id: 'render-report',
      name: 'Render dashboard',
      type: 'job',
      jobSlug: 'retail-sales-visualizer',
      parameters: {
        warehouseDir: '{{ parameters.warehouseDir }}',
        outputDir: '{{ parameters.outputDir }}',
        reportTitle: '{{ parameters.reportTitle }}',
        lookback: '{{ parameters.lookback }}'
      },
      storeResultAs: 'report',
      consumes: [{ assetId: 'retail.sales.parquet' }],
      produces: [
        {
          assetId: 'retail.sales.report',
          autoMaterialize: { onUpstreamUpdate: true, priority: 4 },
          schema: retailReportAssetSchema
        }
      ]
    }
  ],
  triggers: [{ type: 'manual' }]
};

export const retailSalesWorkflowExamples = {
  jobs: retailSalesJobs,
  ingestWorkflow: retailSalesDailyIngestWorkflow,
  insightsWorkflow: retailSalesInsightsWorkflow
};

export default retailSalesWorkflowExamples;
