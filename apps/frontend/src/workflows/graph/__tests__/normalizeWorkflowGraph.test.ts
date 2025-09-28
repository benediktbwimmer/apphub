import { describe, expect, it } from 'vitest';
import type {
  WorkflowTopologyGraph,
  WorkflowTopologyWorkflowStepEdge
} from '@apphub/shared/workflowTopology';
import { normalizeWorkflowGraph } from '../normalize';

const SAMPLE_GRAPH: WorkflowTopologyGraph = {
  version: 'v1',
  generatedAt: '2024-04-02T00:00:00.000Z',
  nodes: {
    workflows: [
      {
        id: 'wf-1',
        slug: 'ingest-dataset',
        name: 'Ingest Dataset',
        version: 1,
        description: 'Load upstream dataset and fan out jobs',
        createdAt: '2024-03-30T12:00:00.000Z',
        updatedAt: '2024-03-30T12:10:00.000Z',
        metadata: null,
        annotations: {
          tags: ['etl'],
          ownerName: 'Data Engineering'
        }
      }
    ],
    steps: [
      {
        id: 'extract',
        workflowId: 'wf-1',
        name: 'Extract',
        description: 'Fetch raw records',
        type: 'service',
        dependsOn: [],
        dependents: ['load'],
        runtime: {
          type: 'service',
          serviceSlug: 'svc.extract',
          timeoutMs: 60000,
          requireHealthy: true
        }
      },
      {
        id: 'load',
        workflowId: 'wf-1',
        name: 'Load',
        description: 'Persist into warehouse',
        type: 'job',
        dependsOn: ['extract'],
        dependents: [],
        runtime: {
          type: 'job',
          jobSlug: 'job.load',
          bundleStrategy: 'latest'
        }
      }
    ],
    triggers: [
      {
        id: 'trigger-1',
        workflowId: 'wf-1',
        kind: 'event',
        name: 'On record batch',
        description: null,
        status: 'active',
        eventType: 'records.received',
        eventSource: 'primary',
        predicates: [],
        parameterTemplate: null,
        throttleWindowMs: null,
        throttleCount: null,
        maxConcurrency: 5,
        idempotencyKeyExpression: null,
        metadata: null,
        createdAt: '2024-03-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z',
        createdBy: 'etl@apphub.example',
        updatedBy: 'etl@apphub.example'
      }
    ],
    schedules: [
      {
        id: 'schedule-1',
        workflowId: 'wf-1',
        name: 'Daily run',
        description: 'Ensure workflow runs daily',
        cron: '0 2 * * *',
        timezone: 'UTC',
        parameters: null,
        startWindow: null,
        endWindow: null,
        catchUp: false,
        nextRunAt: '2024-04-03T02:00:00.000Z',
        isActive: true,
        createdAt: '2024-03-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z'
      }
    ],
    assets: [
      {
        id: 'asset-1',
        assetId: 'warehouse.dataset',
        normalizedAssetId: 'warehouse.dataset',
        annotations: {
          tags: ['warehouse'],
          ownerName: 'Analytics'
        }
      }
    ],
    eventSources: [
      {
        id: 'source-1',
        eventType: 'records.received',
        eventSource: 'primary'
      }
    ]
  },
  edges: {
    triggerToWorkflow: [
      {
        kind: 'event-trigger',
        triggerId: 'trigger-1',
        workflowId: 'wf-1'
      }
    ],
    workflowToStep: [
      {
        workflowId: 'wf-1',
        fromStepId: null,
        toStepId: 'extract'
      },
      {
        workflowId: 'wf-1',
        fromStepId: 'extract',
        toStepId: 'load'
      }
    ] satisfies WorkflowTopologyWorkflowStepEdge[],
    stepToAsset: [
      {
        workflowId: 'wf-1',
        stepId: 'extract',
        assetId: 'warehouse.dataset',
        normalizedAssetId: 'warehouse.dataset',
        direction: 'produces',
        freshness: null,
        partitioning: null,
        autoMaterialize: null
      },
      {
        workflowId: 'wf-1',
        stepId: 'load',
        assetId: 'warehouse.dataset',
        normalizedAssetId: 'warehouse.dataset',
        direction: 'consumes',
        freshness: null,
        partitioning: null,
        autoMaterialize: null
      }
    ],
    assetToWorkflow: [
      {
        assetId: 'warehouse.dataset',
        normalizedAssetId: 'warehouse.dataset',
        workflowId: 'wf-1',
        stepId: 'load',
        reason: 'auto-materialize',
        priority: 5
      }
    ],
    eventSourceToTrigger: [
      {
        sourceId: 'source-1',
        triggerId: 'trigger-1'
      }
    ]
  }
};

describe('normalizeWorkflowGraph', () => {
  it('builds lookup maps and adjacency indexes', () => {
    const normalized = normalizeWorkflowGraph(SAMPLE_GRAPH);

    expect(normalized.workflowsIndex.bySlug['ingest-dataset']).toMatchObject({ id: 'wf-1' });
    expect(normalized.stepsIndex.byId.load.name).toBe('Load');
    expect(normalized.stepsIndex.byWorkflowId['wf-1'].map((step) => step.id)).toEqual([
      'extract',
      'load'
    ]);
    expect(normalized.triggersIndex.byWorkflowId['wf-1'][0]?.id).toBe('trigger-1');
    expect(normalized.assetsIndex.byNormalizedId['warehouse.dataset']?.id).toBe('asset-1');
    expect(normalized.eventSourcesIndex.byKey['records.received::primary']?.id).toBe('source-1');

    expect(normalized.adjacency.workflowEntryStepIds['wf-1']).toEqual(['extract']);
    expect(normalized.adjacency.workflowTerminalStepIds['wf-1']).toEqual(['load']);
    expect(normalized.adjacency.stepChildren['extract']).toEqual(['load']);
    expect(normalized.adjacency.stepParents['load']).toEqual(['extract']);

    expect(normalized.adjacency.stepProduces['extract'][0]?.direction).toBe('produces');
    expect(normalized.adjacency.stepConsumes['load'][0]?.direction).toBe('consumes');
    expect(normalized.adjacency.assetProducers['warehouse.dataset']).toHaveLength(1);
    expect(normalized.adjacency.assetConsumers['warehouse.dataset']).toHaveLength(1);

    const firstWorkflowTriggerEdge = normalized.adjacency.workflowTriggerEdges['wf-1'][0];
    expect(firstWorkflowTriggerEdge?.kind).toBe('event-trigger');
    if (firstWorkflowTriggerEdge && firstWorkflowTriggerEdge.kind !== 'schedule') {
      expect(firstWorkflowTriggerEdge.triggerId).toBe('trigger-1');
    } else {
      throw new Error('Expected an event trigger edge for wf-1');
    }
    expect(normalized.adjacency.eventSourceTriggerEdges['source-1'][0]?.triggerId).toBe('trigger-1');

    expect(normalized.stats).toEqual({
      totalWorkflows: 1,
      totalSteps: 2,
      totalTriggers: 1,
      totalSchedules: 1,
      totalAssets: 1,
      totalEventSources: 1
    });
  });

  it('sorts arrays deterministically', () => {
    const reversed: WorkflowTopologyGraph = {
      ...SAMPLE_GRAPH,
      nodes: {
        ...SAMPLE_GRAPH.nodes,
        steps: [...SAMPLE_GRAPH.nodes.steps].reverse(),
        assets: [...SAMPLE_GRAPH.nodes.assets].reverse(),
        triggers: [...SAMPLE_GRAPH.nodes.triggers].reverse()
      },
      edges: {
        ...SAMPLE_GRAPH.edges,
        workflowToStep: [...SAMPLE_GRAPH.edges.workflowToStep].reverse()
      }
    };

    const normalized = normalizeWorkflowGraph(reversed);

    expect(normalized.steps.map((step) => step.id)).toEqual(['extract', 'load']);
    expect(normalized.adjacency.workflowStepEdges['wf-1'][0]?.toStepId).toBe('extract');
  });
});
