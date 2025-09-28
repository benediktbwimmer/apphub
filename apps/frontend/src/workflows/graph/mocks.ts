import type { WorkflowTopologyGraph } from '@apphub/shared/workflowTopology';
import { normalizeWorkflowGraph } from './normalize';
import type { WorkflowGraphNormalized } from './types';

const BASE_GENERATED_AT = '2024-04-02T00:00:00.000Z';

const DEMO_GRAPH: WorkflowTopologyGraph = {
  version: 'v1',
  generatedAt: BASE_GENERATED_AT,
  nodes: {
    workflows: [
      {
        id: 'wf-orders',
        slug: 'orders-pipeline',
        name: 'Orders Pipeline',
        version: 7,
        description: 'Ingest and enrich commerce orders before publishing downstream metrics.',
        createdAt: '2024-03-12T08:00:00.000Z',
        updatedAt: '2024-03-31T15:40:00.000Z',
        metadata: null,
        annotations: {
          tags: ['orders', 'etl'],
          ownerName: 'Commerce Platform',
          ownerContact: 'orders-team@apphub.example'
        }
      },
      {
        id: 'wf-metrics',
        slug: 'daily-metrics',
        name: 'Daily Metrics',
        version: 3,
        description: 'Materialize aggregated tiles for dashboards once source assets are fresh.',
        createdAt: '2024-02-01T00:00:00.000Z',
        updatedAt: '2024-03-29T22:10:00.000Z',
        metadata: null,
        annotations: {
          tags: ['metrics'],
          ownerName: 'Analytics Guild'
        }
      }
    ],
    steps: [
      {
        id: 'extract-orders',
        workflowId: 'wf-orders',
        name: 'Extract Orders',
        description: 'Fetch order events from upstream API',
        type: 'service',
        dependsOn: [],
        dependents: ['transform-orders'],
        runtime: {
          type: 'service',
          serviceSlug: 'svc.orders.fetch',
          timeoutMs: 120000,
          requireHealthy: true
        }
      },
      {
        id: 'transform-orders',
        workflowId: 'wf-orders',
        name: 'Transform Orders',
        description: 'Clean and validate payload',
        type: 'job',
        dependsOn: ['extract-orders'],
        dependents: ['publish-orders'],
        runtime: {
          type: 'job',
          jobSlug: 'job.orders.transform',
          bundleStrategy: 'latest'
        }
      },
      {
        id: 'publish-orders',
        workflowId: 'wf-orders',
        name: 'Publish Orders',
        description: 'Store curated dataset in warehouse',
        type: 'job',
        dependsOn: ['transform-orders'],
        dependents: [],
        runtime: {
          type: 'job',
          jobSlug: 'job.orders.publish',
          bundleStrategy: 'latest'
        }
      },
      {
        id: 'refresh-dashboard',
        workflowId: 'wf-metrics',
        name: 'Refresh Dashboard',
        description: 'Recompute dashboard tiles once upstream data is available',
        type: 'job',
        dependsOn: [],
        dependents: [],
        runtime: {
          type: 'job',
          jobSlug: 'job.metrics.refresh'
        }
      }
    ],
    triggers: [
      {
        id: 'trigger-orders-event',
        workflowId: 'wf-orders',
        kind: 'event',
        name: 'Orders Event Stream',
        description: 'Launch ingestion when new orders arrive.',
        status: 'active',
        eventType: 'orders.created',
        eventSource: 'primary',
        predicates: [],
        parameterTemplate: null,
        throttleWindowMs: 60000,
        throttleCount: 5,
        maxConcurrency: 4,
        idempotencyKeyExpression: '{{ event.id }}',
        metadata: null,
        createdAt: '2024-03-10T00:00:00.000Z',
        updatedAt: '2024-03-30T00:10:00.000Z'
      },
      {
        id: 'trigger-metrics-schedule',
        workflowId: 'wf-metrics',
        kind: 'definition',
        name: 'Daily Catch-up',
        description: 'Ensure dashboards refresh even if events are missing.',
        status: 'active',
        eventType: 'scheduler',
        eventSource: null,
        predicates: [],
        parameterTemplate: null,
        throttleWindowMs: null,
        throttleCount: null,
        maxConcurrency: 1,
        idempotencyKeyExpression: null,
        metadata: null,
        createdAt: '2024-02-04T00:00:00.000Z',
        updatedAt: '2024-03-15T00:00:00.000Z'
      }
    ],
    schedules: [
      {
        id: 'schedule-metrics',
        workflowId: 'wf-metrics',
        triggerId: 'trigger-metrics-schedule',
        slug: 'daily-metrics-cron',
        cron: '0 5 * * *',
        timezone: 'UTC',
        startWindow: null,
        endWindow: null,
        catchUp: true
      }
    ],
    assets: [
      {
        id: 'asset-orders-curated',
        assetId: 'warehouse.orders.curated',
        normalizedAssetId: 'warehouse.orders.curated',
        annotations: {
          tags: ['warehouse', 'orders'],
          ownerName: 'Commerce Platform'
        }
      },
      {
        id: 'asset-dashboard',
        assetId: 'dashboards.orders.daily',
        normalizedAssetId: 'dashboards.orders.daily',
        annotations: {
          tags: ['dashboard'],
          ownerName: 'Analytics Guild'
        }
      }
    ],
    eventSources: [
      {
        id: 'source-orders-primary',
        eventType: 'orders.created',
        eventSource: 'primary'
      }
    ]
  },
  edges: {
    triggerToWorkflow: [
      {
        kind: 'event-trigger',
        workflowId: 'wf-orders',
        triggerId: 'trigger-orders-event'
      },
      {
        kind: 'definition-trigger',
        workflowId: 'wf-metrics',
        triggerId: 'trigger-metrics-schedule'
      },
      {
        kind: 'schedule',
        workflowId: 'wf-metrics',
        scheduleId: 'schedule-metrics'
      }
    ],
    workflowToStep: [
      {
        workflowId: 'wf-orders',
        fromStepId: null,
        toStepId: 'extract-orders'
      },
      {
        workflowId: 'wf-orders',
        fromStepId: 'extract-orders',
        toStepId: 'transform-orders'
      },
      {
        workflowId: 'wf-orders',
        fromStepId: 'transform-orders',
        toStepId: 'publish-orders'
      },
      {
        workflowId: 'wf-metrics',
        fromStepId: null,
        toStepId: 'refresh-dashboard'
      }
    ],
    stepToAsset: [
      {
        workflowId: 'wf-orders',
        stepId: 'publish-orders',
        assetId: 'warehouse.orders.curated',
        normalizedAssetId: 'warehouse.orders.curated',
        direction: 'produces',
        freshness: {
          maxAgeMs: 3_600_000
        },
        partitioning: null,
        autoMaterialize: null
      },
      {
        workflowId: 'wf-metrics',
        stepId: 'refresh-dashboard',
        assetId: 'warehouse.orders.curated',
        normalizedAssetId: 'warehouse.orders.curated',
        direction: 'consumes',
        freshness: null,
        partitioning: null,
        autoMaterialize: null
      },
      {
        workflowId: 'wf-metrics',
        stepId: 'refresh-dashboard',
        assetId: 'dashboards.orders.daily',
        normalizedAssetId: 'dashboards.orders.daily',
        direction: 'produces',
        freshness: null,
        partitioning: null,
        autoMaterialize: {
          onUpstreamUpdate: true,
          priority: 10,
          parameterDefaults: null
        }
      }
    ],
    assetToWorkflow: [
      {
        assetId: 'warehouse.orders.curated',
        normalizedAssetId: 'warehouse.orders.curated',
        workflowId: 'wf-metrics',
        stepId: 'refresh-dashboard',
        reason: 'auto-materialize',
        priority: 7
      }
    ],
    eventSourceToTrigger: [
      {
        sourceId: 'source-orders-primary',
        triggerId: 'trigger-orders-event'
      }
    ]
  }
};

export function createDemoWorkflowGraph(): WorkflowTopologyGraph {
  return JSON.parse(JSON.stringify(DEMO_GRAPH)) as WorkflowTopologyGraph;
}

export function createNormalizedDemoWorkflowGraph(): WorkflowGraphNormalized {
  return normalizeWorkflowGraph(createDemoWorkflowGraph());
}

export function createEmptyWorkflowGraph(): WorkflowGraphNormalized {
  return normalizeWorkflowGraph({
    version: 'v1',
    generatedAt: BASE_GENERATED_AT,
    nodes: {
      workflows: [],
      steps: [],
      triggers: [],
      schedules: [],
      assets: [],
      eventSources: []
    },
    edges: {
      triggerToWorkflow: [],
      workflowToStep: [],
      stepToAsset: [],
      assetToWorkflow: [],
      eventSourceToTrigger: []
    }
  });
}
