import type {
  WorkflowTopologyAssetNode,
  WorkflowTopologyAssetWorkflowEdge,
  WorkflowTopologyEventSourceNode,
  WorkflowTopologyEventSourceTriggerEdge,
  WorkflowTopologyGraph,
  WorkflowTopologyScheduleNode,
  WorkflowTopologyStepAssetEdge,
  WorkflowTopologyStepNode,
  WorkflowTopologyStepRuntime,
  WorkflowTopologyTriggerNode,
  WorkflowTopologyTriggerWorkflowEdge,
  WorkflowTopologyWorkflowNode,
  WorkflowTopologyWorkflowStepEdge
} from '@apphub/shared/workflowTopology';
import { normalizeWorkflowGraph } from './normalize';
import type { WorkflowGraphNormalized } from './types';

const BASE_GENERATED_AT = '2024-04-02T00:00:00.000Z';

const DEMO_GRAPH: WorkflowTopologyGraph = {
  version: 'v2',
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
        updatedAt: '2024-03-30T00:10:00.000Z',
        createdBy: 'orders@apphub.example',
        updatedBy: 'orders@apphub.example'
      },
      {
        id: 'trigger-metrics-definition',
        workflowId: 'wf-metrics',
        kind: 'definition',
        triggerType: 'scheduled',
        options: {
          retryLimit: 3
        },
        schedule: {
          cron: '0 5 * * *',
          timezone: 'UTC',
          startWindow: null,
          endWindow: null,
          catchUp: true
        }
      }
    ],
    schedules: [
      {
        id: 'schedule-metrics',
        workflowId: 'wf-metrics',
        name: 'Daily Metrics Cron',
        description: 'Run metrics pipeline every morning.',
        cron: '0 5 * * *',
        timezone: 'UTC',
        parameters: null,
        startWindow: null,
        endWindow: null,
        catchUp: true,
        nextRunAt: '2024-04-03T05:00:00.000Z',
        isActive: true,
        createdAt: '2024-02-04T00:00:00.000Z',
        updatedAt: '2024-03-15T00:00:00.000Z'
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
        triggerId: 'trigger-metrics-definition'
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
    ],
    stepToEventSource: [
      {
        workflowId: 'wf-orders',
        stepId: 'publish-orders',
        sourceId: 'source-orders-primary',
        kind: 'inferred',
        confidence: {
          sampleCount: 128,
          lastSeenAt: '2024-03-31T10:15:00.000Z'
        }
      }
    ]
  }
};

export function createDemoWorkflowGraph(): WorkflowTopologyGraph {
  return JSON.parse(JSON.stringify(DEMO_GRAPH)) as WorkflowTopologyGraph;
}

export function createMediumWorkflowGraph(): WorkflowTopologyGraph {
  return createDemoWorkflowGraph();
}

export function createSmallWorkflowGraph(): WorkflowTopologyGraph {
  const graph = createDemoWorkflowGraph();
  const workflowIds = new Set<string>();
  const firstWorkflow = graph.nodes.workflows[0];
  if (firstWorkflow) {
    workflowIds.add(firstWorkflow.id);
  }

  graph.nodes.workflows = graph.nodes.workflows.filter((workflow) => workflowIds.has(workflow.id));
  graph.nodes.steps = graph.nodes.steps.filter((step) => workflowIds.has(step.workflowId));
  graph.nodes.triggers = graph.nodes.triggers.filter((trigger) => workflowIds.has(trigger.workflowId));
  graph.nodes.schedules = graph.nodes.schedules.filter((schedule) => workflowIds.has(schedule.workflowId));

  const assetIds = new Set<string>();
  graph.edges.stepToAsset = graph.edges.stepToAsset.filter((edge) => {
    if (workflowIds.has(edge.workflowId)) {
      assetIds.add(edge.normalizedAssetId);
      return true;
    }
    return false;
  });

  graph.nodes.assets = graph.nodes.assets.filter((asset) => assetIds.has(asset.normalizedAssetId));
  graph.edges.assetToWorkflow = graph.edges.assetToWorkflow.filter((edge) => workflowIds.has(edge.workflowId));
  graph.edges.workflowToStep = graph.edges.workflowToStep.filter((edge) => workflowIds.has(edge.workflowId));
  graph.edges.triggerToWorkflow = graph.edges.triggerToWorkflow.filter((edge) => workflowIds.has(edge.workflowId));
  graph.edges.stepToEventSource = graph.edges.stepToEventSource.filter((edge) => workflowIds.has(edge.workflowId));

  const triggerIds = new Set(graph.nodes.triggers.map((trigger) => trigger.id));
  graph.edges.eventSourceToTrigger = graph.edges.eventSourceToTrigger.filter((edge) =>
    triggerIds.has(edge.triggerId)
  );
  const sourceIds = new Set(graph.edges.eventSourceToTrigger.map((edge) => edge.sourceId));
  for (const edge of graph.edges.stepToEventSource) {
    sourceIds.add(edge.sourceId);
  }
  graph.nodes.eventSources = graph.nodes.eventSources.filter((source) => sourceIds.has(source.id));

  return graph;
}

export function createLargeWorkflowGraph({
  workflowCount = 12,
  stepsPerWorkflow = 10
}: {
  workflowCount?: number;
  stepsPerWorkflow?: number;
} = {}): WorkflowTopologyGraph {
  const workflows: WorkflowTopologyWorkflowNode[] = [];
  const steps: WorkflowTopologyStepNode[] = [];
  const triggers: WorkflowTopologyTriggerNode[] = [];
  const schedules: WorkflowTopologyScheduleNode[] = [];
  const assets: WorkflowTopologyAssetNode[] = [];
  const eventSources: WorkflowTopologyEventSourceNode[] = [];

  const triggerToWorkflow: WorkflowTopologyTriggerWorkflowEdge[] = [];
  const workflowToStep: WorkflowTopologyWorkflowStepEdge[] = [];
  const stepToAsset: WorkflowTopologyStepAssetEdge[] = [];
  const assetToWorkflow: WorkflowTopologyAssetWorkflowEdge[] = [];
  const eventSourceToTrigger: WorkflowTopologyEventSourceTriggerEdge[] = [];

  const now = new Date(BASE_GENERATED_AT);

  for (let index = 0; index < workflowCount; index += 1) {
    const workflowId = `wf-batch-${index}`;
    const slug = `workflow-${index}`;
    workflows.push({
      id: workflowId,
      slug,
      name: `Workflow ${index + 1}`,
      version: (index % 5) + 1,
      description: `Generated workflow ${index + 1}`,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * (index + 1)).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 15 * index).toISOString(),
      metadata: null,
      annotations: {
        tags: [`team-${index % 3}`, `domain-${index % 4}`],
        ownerName: `Team ${index % 5}`
      }
    });

    const triggerId = `trigger-event-${workflowId}`;
    const eventSourceId = `event-source-${workflowId}`;
    eventSources.push({
      id: eventSourceId,
      eventType: `event.type.${index}`,
      eventSource: `svc.event.${index}`
    });
    triggers.push({
      id: triggerId,
      workflowId,
      kind: 'event',
      name: `Event Trigger ${index + 1}`,
      description: 'Generated trigger',
      status: 'active',
      eventType: `event.type.${index}`,
      eventSource: eventSourceId,
      predicates: [],
      parameterTemplate: null,
      throttleWindowMs: 60000,
      throttleCount: 5,
      maxConcurrency: 4,
      idempotencyKeyExpression: '{{ event.id }}',
      metadata: null,
      createdAt: new Date(now.getTime() - 1000 * 60 * 10 * index).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * index).toISOString(),
      createdBy: 'system@apphub.example',
      updatedBy: 'system@apphub.example'
    });
    eventSourceToTrigger.push({
      sourceId: eventSourceId,
      triggerId
    });
    triggerToWorkflow.push({
      kind: 'event-trigger',
      triggerId,
      workflowId
    });

    const scheduleId = `schedule-${workflowId}`;
    schedules.push({
      id: scheduleId,
      workflowId,
      name: `Daily ${index}`,
      description: 'Generated schedule',
      cron: `${index % 60} ${index % 24} * * *`,
      timezone: 'UTC',
      parameters: null,
      startWindow: null,
      endWindow: null,
      catchUp: index % 2 === 0,
      nextRunAt: null,
      isActive: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60).toISOString()
    });
    triggerToWorkflow.push({
      kind: 'schedule',
      scheduleId,
      workflowId
    });

    let previousStepId: string | null = null;
    let previousAssetNormalizedId: string | null = null;

    for (let stepIndex = 0; stepIndex < stepsPerWorkflow; stepIndex += 1) {
      const stepId = `step-${workflowId}-${stepIndex}`;
      const isJob = stepIndex % 2 === 0;
      const runtime: WorkflowTopologyStepRuntime = isJob
        ? {
            type: 'job',
            jobSlug: `job.slug.${index}.${stepIndex}`,
            bundleStrategy: 'latest',
            timeoutMs: 120000
          }
        : {
            type: 'service',
            serviceSlug: `svc.slug.${index}.${stepIndex}`,
            timeoutMs: 90000,
            requireHealthy: true
          };

      steps.push({
        id: stepId,
        workflowId,
        name: isJob ? `Job Step ${stepIndex + 1}` : `Service Step ${stepIndex + 1}`,
        description: 'Generated step',
        type: isJob ? 'job' : 'service',
        dependsOn: previousStepId ? [previousStepId] : [],
        dependents: [],
        runtime
      });

      workflowToStep.push({
        workflowId,
        fromStepId: previousStepId,
        toStepId: stepId
      });

      const assetNormalizedId = `asset:${workflowId}:${stepIndex}`;
      assets.push({
        id: `asset-${workflowId}-${stepIndex}`,
        assetId: `asset.${workflowId}.${stepIndex}`,
        normalizedAssetId: assetNormalizedId,
        annotations: {
          tags: [`asset-${index % 4}`],
          ownerName: `Data Team ${index % 3}`
        }
      });

      stepToAsset.push({
        workflowId,
        stepId,
        assetId: `asset.${workflowId}.${stepIndex}`,
        normalizedAssetId: assetNormalizedId,
        direction: 'produces',
        freshness: null,
        partitioning: null,
        autoMaterialize: null
      });

      if (previousAssetNormalizedId) {
        stepToAsset.push({
          workflowId,
          stepId,
          assetId: `asset.${workflowId}.${stepIndex - 1}`,
          normalizedAssetId: previousAssetNormalizedId,
          direction: 'consumes',
          freshness: null,
          partitioning: null,
          autoMaterialize: null
        });
      }

      previousStepId = stepId;
      previousAssetNormalizedId = assetNormalizedId;
    }

    if (previousAssetNormalizedId) {
      const downstreamWorkflowIndex = (index + 1) % workflowCount;
      const targetWorkflowId = `wf-batch-${downstreamWorkflowIndex}`;
      assetToWorkflow.push({
        assetId: `asset.${workflowId}.${stepsPerWorkflow - 1}`,
        normalizedAssetId: previousAssetNormalizedId,
        workflowId: targetWorkflowId,
        stepId: null,
        reason: 'auto-materialize',
        priority: 1
      });
    }
  }

  return {
    version: 'v2',
    generatedAt: BASE_GENERATED_AT,
    nodes: {
      workflows,
      steps,
      triggers,
      schedules,
      assets,
      eventSources
    },
    edges: {
      triggerToWorkflow,
      workflowToStep,
      stepToAsset,
      assetToWorkflow,
      eventSourceToTrigger,
      stepToEventSource: []
    }
  } satisfies WorkflowTopologyGraph;
}

export function createSmallWorkflowGraphNormalized(): WorkflowGraphNormalized {
  return normalizeWorkflowGraph(createSmallWorkflowGraph());
}

export function createMediumWorkflowGraphNormalized(): WorkflowGraphNormalized {
  return normalizeWorkflowGraph(createMediumWorkflowGraph());
}

export function createLargeWorkflowGraphNormalized(options?: {
  workflowCount?: number;
  stepsPerWorkflow?: number;
}): WorkflowGraphNormalized {
  return normalizeWorkflowGraph(createLargeWorkflowGraph(options));
}

export function createNormalizedDemoWorkflowGraph(): WorkflowGraphNormalized {
  return normalizeWorkflowGraph(createDemoWorkflowGraph());
}

export function createEmptyWorkflowGraph(): WorkflowGraphNormalized {
  return normalizeWorkflowGraph({
    version: 'v2',
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
      eventSourceToTrigger: [],
      stepToEventSource: []
    }
  });
}
