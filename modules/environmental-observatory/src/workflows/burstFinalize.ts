import { createWorkflow, createWorkflowTrigger, type WorkflowDefinition } from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-burst-finalize',
  name: 'Observatory Burst Finalize',
  version: 1,
  description: 'Convert burst window expirations into downstream aggregation signals.',
  parametersSchema: {
    type: 'object',
    properties: {
      partitionKey: { type: 'string', minLength: 1 },
      producedAt: { type: 'string' },
      expiresAt: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['partitionKey']
  },
  steps: [
    {
      id: 'finalize-burst',
      name: 'Emit burst finalized signal',
      type: 'job',
      jobSlug: 'observatory-burst-finalizer',
      parameters: {
        partitionKey: '{{ parameters.partitionKey }}',
        producedAt: '{{ parameters.producedAt }}',
        expiresAt: '{{ parameters.expiresAt }}',
        reason: '{{ parameters.reason }}'
      },
      produces: [
        {
          assetId: 'observatory.burst.ready',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
          }
        }
      ]
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Finalize burst on quiet-window expiry',
    description: 'Run when the burst window asset TTL elapses, signalling no new drops arrived.',
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
      producedAt: '{{ event.payload.producedAt }}',
      expiresAt: '{{ event.payload.expiresAt }}',
      reason: '{{ event.payload.reason }}'
    },
    idempotencyKeyExpression:
      'burst-finalize-{{ event.payload.partitionKey | default: event.payload.workflowSlug }}-{{ event.payload.expiresAt }}'
  })
];

export const burstFinalizeWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
