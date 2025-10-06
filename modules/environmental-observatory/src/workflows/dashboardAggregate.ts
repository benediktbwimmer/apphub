import {
  createWorkflow,
  createWorkflowTrigger,
  createWorkflowSchedule,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

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
    lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
  },
  steps: [
    {
      id: 'aggregate-dashboard',
      name: 'Aggregate dashboard data',
      type: 'job',
      jobSlug: 'observatory-dashboard-aggregator',
      parameters: {
        partitionKey: '{{ parameters.partitionKey }}',
        lookbackMinutes: '{{ parameters.lookbackMinutes | default: defaultParameters.lookbackMinutes }}',
        burstReason: '{{ parameters.burstReason }}',
        burstFinishedAt: '{{ parameters.burstFinishedAt }}'
      },
      produces: [
        {
          assetId: 'observatory.dashboard.snapshot',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
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
      partitionKey: '{{ event.payload.partitionKey | default: event.payload.workflowSlug }}',
      lookbackMinutes: '{{ trigger.metadata.lookbackMinutes }}',
      burstReason: '{{ event.payload.reason }}',
      burstFinishedAt: '{{ event.payload.expiresAt }}'
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
    timezone: 'UTC'
  })
];

export const dashboardAggregateWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers,
  schedules
});
