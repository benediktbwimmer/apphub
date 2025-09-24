import type {
  JobDefinitionCreateInput,
  WorkflowDefinitionCreateInput,
  WorkflowJsonValue
} from '../zodSchemas';

const telemetryAssetSchema: Record<string, WorkflowJsonValue> = {
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

const alertsAssetSchema: Record<string, WorkflowJsonValue> = {
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

export const fleetTelemetryJobs: JobDefinitionCreateInput[] = [
  {
    slug: 'fleet-telemetry-metrics',
    name: 'Fleet Telemetry Metrics',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:fleet-telemetry-metrics@0.1.0#handler',
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 3, strategy: 'exponential', initialDelayMs: 5_000 },
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
    outputSchema: telemetryAssetSchema
  },
  {
    slug: 'greenhouse-alerts-runner',
    name: 'Greenhouse Alerts Runner',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:greenhouse-alerts-runner@0.1.0#handler',
    timeoutMs: 90_000,
    retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 5_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        telemetryDir: { type: 'string', minLength: 1 },
        windowHours: { type: 'number', minimum: 1, maximum: 168 },
        temperatureLimitC: { type: 'number' },
        humidityLimitPct: { type: 'number' }
      },
      required: ['windowHours']
    },
    defaultParameters: {
      telemetryDir: 'services/catalog/data/examples/fleet-telemetry-rollups',
      windowHours: 24,
      temperatureLimitC: 30,
      humidityLimitPct: 65
    },
    outputSchema: alertsAssetSchema
  }
];

const fleetTelemetryJobMap = new Map<string, JobDefinitionCreateInput>(
  fleetTelemetryJobs.map((job) => [job.slug.toLowerCase(), job])
);

function cloneJobDefinition(definition: JobDefinitionCreateInput): JobDefinitionCreateInput {
  return JSON.parse(JSON.stringify(definition)) as JobDefinitionCreateInput;
}

export function getFleetTelemetryJobDefinition(slug: string): JobDefinitionCreateInput | null {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    return null;
  }
  const match = fleetTelemetryJobMap.get(slug.trim().toLowerCase());
  return match ? cloneJobDefinition(match) : null;
}

export const fleetTelemetryDailyRollupWorkflow: WorkflowDefinitionCreateInput = {
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
      type: 'job',
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
            maxKeys: 1_000,
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
};

export const fleetTelemetryAlertsWorkflow: WorkflowDefinitionCreateInput = {
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
      type: 'job',
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
};

export const fleetTelemetryWorkflowExamples = {
  jobs: fleetTelemetryJobs,
  rollupWorkflow: fleetTelemetryDailyRollupWorkflow,
  alertsWorkflow: fleetTelemetryAlertsWorkflow
};

export default fleetTelemetryWorkflowExamples;
