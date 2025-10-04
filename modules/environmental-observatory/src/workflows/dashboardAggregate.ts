import {
  createWorkflow,
  createWorkflowTrigger,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-dashboard-aggregate',
  name: 'Observatory Dashboard Aggregate',
  version: 2,
  description: 'Aggregate observatory readings and refresh the interactive overview dashboard.',
  parametersSchema: {
    type: 'object',
    properties: {
      partitionKey: { type: 'string', minLength: 1 },
      lookbackMinutes: { type: 'number', minimum: 5, maximum: 4320 }
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
        lookbackMinutes: '{{ parameters.lookbackMinutes | default: defaultParameters.lookbackMinutes }}'
      }
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Aggregate on timestore partition',
    description: 'Refresh dashboards when new timestore partitions become available.',
    eventType: 'timestore.partition.created',
    eventSource: 'timestore.ingest',
    predicates: [
      {
        path: '$.payload.datasetSlug',
        operator: 'equals',
        value: moduleSetting('timestore.datasetSlug')
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey }}',
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
    },
    idempotencyKeyExpression:
      'dashboard-aggregate-{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey }}'
  }),
  createWorkflowTrigger({
    name: 'Aggregate on observatory partition ready',
    description: 'Fallback trigger fired by the ingest workflow when a partition is hydrated.',
    eventType: 'observatory.minute.partition-ready',
    eventSource: 'observatory.events',
    predicates: [
      {
        path: '$.payload.datasetSlug',
        operator: 'equals',
        value: moduleSetting('timestore.datasetSlug')
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKeyFields.window | default: event.payload.minute }}',
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
    },
    idempotencyKeyExpression:
      'dashboard-aggregate-{{ event.payload.partitionKeyFields.window | default: event.payload.minute }}'
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
  triggers
});
