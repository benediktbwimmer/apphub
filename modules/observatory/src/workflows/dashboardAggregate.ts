import {
  createWorkflow,
  createWorkflowTrigger,
  createWorkflowSchedule,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatorySecrets, ObservatorySettings } from '../config/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-dashboard-aggregate',
  name: 'Observatory Dashboard Aggregate',
  version: 3,
  description: 'Aggregate observatory readings and refresh the interactive overview dashboard.',
  parametersSchema: {
    type: 'object',
    properties: {
      partitionKey: { type: 'string', minLength: 1 },
      lookbackMinutes: { type: 'number', minimum: 5, maximum: 4320 },
      burstReason: { type: 'string' },
      burstFinishedAt: { type: 'string' }
    },
    required: ['partitionKey']
  },
  defaultParameters: {
    burstReason: '',
    burstFinishedAt: ''
  },
  steps: [
    {
      id: 'aggregate-dashboard',
      name: 'Aggregate dashboard data',
      type: 'job',
      jobSlug: 'observatory-dashboard-aggregator',
      storeResultAs: 'result',
      parameters: {
        partitionKey: '{{ parameters.partitionKey | default: run.partitionKey | default: "" }}',
        burstReason: '{{ parameters.burstReason | default: "" }}',
        burstFinishedAt: '{{ parameters.burstFinishedAt | default: "" }}'
      },
      produces: [
        {
          assetId: 'observatory.dashboard.snapshot',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
          },
          freshness: {
            ttlMs: moduleSetting('dashboard.snapshotFreshnessMs')
          }
        }
      ]
    }
  ],
  metadata: {
    provisioning: {
      schedules: [
        {
          name: 'Periodic dashboard refresh',
          description: 'Fallback aggregation to cover long-running bursts.',
          cron: '*/5 * * * *',
          timezone: 'UTC'
        }
      ]
    }
  }
};

const triggers = [
  createWorkflowTrigger({
    name: 'Aggregate on burst expiry',
    description: 'Refresh dashboards when the burst window TTL expires with no new drops.',
    eventType: 'asset.expired',
    predicates: [
      {
        path: '$.payload.assetId',
        operator: 'equals',
        value: 'observatory.burst.window'
      },
      {
        path: '$.payload.reason',
        operator: 'equals',
        value: 'ttl'
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKey | default: event.payload.workflowSlug | default: "" }}',
      burstReason: '{{ event.payload.reason | default: "" }}',
      burstFinishedAt: '{{ event.payload.expiresAt | default: "" }}'
    },
    metadata: {
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
    },
    idempotencyKeyExpression:
      'dashboard-aggregate-{{ event.payload.partitionKey | default: event.payload.workflowSlug }}-{{ event.payload.expiresAt }}'
  })
];

const schedules = [
  createWorkflowSchedule({
    name: 'Periodic dashboard refresh',
    description: 'Fallback aggregation to cover long-running bursts.',
    cron: '*/5 * * * *',
    timezone: 'UTC',
    parameterTemplate: {
      partitionKey: '{{ run.trigger.schedule.occurrence | slice: 0, 16 }}'
    }
  })
];

export const dashboardAggregateWorkflow = createWorkflow<
  ObservatorySettings,
  ObservatorySecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers,
  schedules
});
