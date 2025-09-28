import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  WorkflowDefinitionRecord,
  WorkflowStepDefinition,
  WorkflowEventTriggerRecord,
  WorkflowAssetDeclarationRecord,
  WorkflowEventTriggerPredicate,
  WorkflowAssetAutoMaterialize
} from '../src/db/types';
import type {
  WorkflowTopologyFanOutStepRuntime,
  WorkflowTopologyStepNode
} from '@apphub/shared/workflowTopology';

process.env.APPHUB_DISABLE_ANALYTICS = '1';
process.env.APPHUB_ANALYTICS_INTERVAL_MS = '0';
process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.REDIS_URL = 'inline';

let buildWorkflowDagMetadata: (typeof import('../src/workflows/dag'))['buildWorkflowDagMetadata'];
let assembleWorkflowTopologyGraph: (typeof import('../src/workflows/workflowGraph'))['assembleWorkflowTopologyGraph'];

before(async () => {
  ({ buildWorkflowDagMetadata } = await import('../src/workflows/dag'));
  ({ assembleWorkflowTopologyGraph } = await import('../src/workflows/workflowGraph'));
});

const ISO_NOW = '2024-04-01T00:00:00.000Z';

describe('assembleWorkflowTopologyGraph', () => {
  it('assembles a linear workflow graph with DAG edges', () => {
    const steps: WorkflowStepDefinition[] = [
      {
        id: 'extract',
        name: 'Extract',
        type: 'job',
        jobSlug: 'job.extract'
      },
      {
        id: 'transform',
        name: 'Transform',
        type: 'job',
        jobSlug: 'job.transform',
        dependsOn: ['extract']
      },
      {
        id: 'load',
        name: 'Load',
        type: 'service',
        serviceSlug: 'svc.load',
        dependsOn: ['transform']
      }
    ];

    const definition = createWorkflowDefinition({
      id: 'wf-linear',
      slug: 'linear',
      name: 'Linear Workflow',
      steps,
      dag: buildWorkflowDagMetadata(steps)
    });

    const graph = assembleWorkflowTopologyGraph(
      [
        {
          definition,
          assetDeclarations: []
        }
      ],
      { generatedAt: ISO_NOW }
    );

    assert.equal(graph.version, 'v1');
    assert.equal(graph.generatedAt, ISO_NOW);
    assert.equal(graph.nodes.workflows.length, 1);
    assert.equal(graph.nodes.steps.length, 3);

    const extractNode = findStep(graph.nodes.steps, 'extract');
    assert.deepEqual(extractNode.dependsOn, []);
    assert.deepEqual(extractNode.dependents, ['transform']);

    const transformNode = findStep(graph.nodes.steps, 'transform');
    assert.deepEqual(transformNode.dependsOn, ['extract']);
    assert.deepEqual(transformNode.dependents, ['load']);

    const loadNode = findStep(graph.nodes.steps, 'load');
    assert.deepEqual(loadNode.dependsOn, ['transform']);

    const edges = graph.edges.workflowToStep;
    assert.ok(
      edges.some((edge) => edge.workflowId === 'wf-linear' && edge.fromStepId === null && edge.toStepId === 'extract')
    );
    assert.ok(
      edges.some((edge) => edge.workflowId === 'wf-linear' && edge.fromStepId === 'extract' && edge.toStepId === 'transform')
    );
    assert.ok(
      edges.some((edge) => edge.workflowId === 'wf-linear' && edge.fromStepId === 'transform' && edge.toStepId === 'load')
    );
  });

  it('includes fan-out template metadata in step nodes', () => {
    const steps: WorkflowStepDefinition[] = [
      {
        id: 'seed',
        name: 'Seed',
        type: 'job',
        jobSlug: 'job.seed'
      },
      {
        id: 'fanout',
        name: 'Process Items',
        type: 'fanout',
        dependsOn: ['seed'],
        collection: '{{ steps.seed.result.items }}',
        maxItems: 10,
        maxConcurrency: 3,
        template: {
          id: 'process-item',
          name: 'Process Item',
          type: 'job',
          jobSlug: 'job.process'
        }
      }
    ];

    const definition = createWorkflowDefinition({
      id: 'wf-fanout',
      slug: 'fanout',
      name: 'Fanout Workflow',
      steps,
      dag: buildWorkflowDagMetadata(steps)
    });

    const graph = assembleWorkflowTopologyGraph(
      [
        {
          definition,
          assetDeclarations: []
        }
      ],
      { generatedAt: ISO_NOW }
    );

    const step = findStep(graph.nodes.steps, 'fanout');
    assert.equal(step.type, 'fanout');
    const runtime = step.runtime as WorkflowTopologyFanOutStepRuntime;
    assert.equal(runtime.type, 'fanout');
    assert.equal(runtime.maxItems, 10);
    assert.equal(runtime.maxConcurrency, 3);
    assert.equal(runtime.template.id, 'process-item');
    assert.equal(runtime.template.runtime.type, 'job');
    assert.equal(runtime.template.runtime.jobSlug, 'job.process');
  });

  it('connects asset producers and consumers across workflows using normalized IDs', () => {
    const producerSteps: WorkflowStepDefinition[] = [
      {
        id: 'produce-data',
        name: 'Produce Data',
        type: 'job',
        jobSlug: 'job.producer'
      }
    ];
    const consumerSteps: WorkflowStepDefinition[] = [
      {
        id: 'consume-data',
        name: 'Consume Data',
        type: 'job',
        jobSlug: 'job.consumer'
      }
    ];

    const producer = createWorkflowDefinition({
      id: 'wf-producer',
      slug: 'producer',
      name: 'Producer',
      steps: producerSteps,
      dag: buildWorkflowDagMetadata(producerSteps)
    });
    const consumer = createWorkflowDefinition({
      id: 'wf-consumer',
      slug: 'consumer',
      name: 'Consumer',
      steps: consumerSteps,
      dag: buildWorkflowDagMetadata(consumerSteps)
    });

    const assetId = 'Data.Hourly';
    const autoMaterialize: WorkflowAssetAutoMaterialize = {
      onUpstreamUpdate: true,
      priority: 5,
      parameterDefaults: null
    };

    const graph = assembleWorkflowTopologyGraph(
      [
        {
          definition: producer,
          assetDeclarations: [
            createAssetDeclaration({
              workflowDefinitionId: 'wf-producer',
              stepId: 'produce-data',
              direction: 'produces',
              assetId
            })
          ]
        },
        {
          definition: consumer,
          assetDeclarations: [
            createAssetDeclaration({
              workflowDefinitionId: 'wf-consumer',
              stepId: 'consume-data',
              direction: 'consumes',
              assetId,
              autoMaterialize
            })
          ]
        }
      ],
      { generatedAt: ISO_NOW }
    );

    const assetNode = graph.nodes.assets.find((node) => node.assetId === assetId.trim());
    assert.ok(assetNode);
    assert.equal(assetNode.normalizedAssetId, 'data.hourly');

    const edges = graph.edges.stepToAsset.filter((edge) => edge.assetId === assetId.trim());
    assert.equal(edges.length, 2);
    assert.ok(edges.some((edge) => edge.workflowId === 'wf-producer' && edge.direction === 'produces'));
    assert.ok(edges.some((edge) => edge.workflowId === 'wf-consumer' && edge.direction === 'consumes'));

    const autoEdges = graph.edges.assetToWorkflow.filter((edge) => edge.workflowId === 'wf-consumer');
    assert.equal(autoEdges.length, 1);
    assert.equal(autoEdges[0].reason, 'auto-materialize');
    assert.equal(autoEdges[0].priority, 5);
  });

  it('captures event trigger throttle metadata and deduplicates event sources', () => {
    const steps: WorkflowStepDefinition[] = [
      {
        id: 'ingest',
        name: 'Ingest',
        type: 'job',
        jobSlug: 'job.ingest'
      }
    ];

    const eventTriggers: WorkflowEventTriggerRecord[] = [
      createEventTrigger({
        id: 'trigger-a',
        workflowDefinitionId: 'wf-events',
        name: 'Trigger A',
        eventType: 'records.created',
        eventSource: 'catalog',
        throttleWindowMs: 60_000,
        throttleCount: 3,
        idempotencyKeyExpression: '$.id'
      }),
      createEventTrigger({
        id: 'trigger-b',
        workflowDefinitionId: 'wf-events',
        name: 'Trigger B',
        eventType: 'records.created',
        eventSource: 'catalog',
        throttleWindowMs: 120_000,
        throttleCount: 10,
        maxConcurrency: 2
      })
    ];

    const definition = createWorkflowDefinition({
      id: 'wf-events',
      slug: 'events',
      name: 'Events Workflow',
      steps,
      dag: buildWorkflowDagMetadata(steps),
      eventTriggers
    });

    const graph = assembleWorkflowTopologyGraph(
      [
        {
          definition,
          assetDeclarations: []
        }
      ],
      { generatedAt: ISO_NOW }
    );

    const triggerNodes = graph.nodes.triggers.filter((node) => node.kind === 'event');
    assert.equal(triggerNodes.length, 2);

    const triggerA = triggerNodes.find((node) => node.id === 'trigger-a');
    assert.ok(triggerA);
    assert.equal(triggerA.throttleWindowMs, 60_000);
    assert.equal(triggerA.throttleCount, 3);
    assert.equal(triggerA.idempotencyKeyExpression, '$.id');

    const eventSources = graph.nodes.eventSources;
    assert.equal(eventSources.length, 1);
    assert.equal(eventSources[0].eventType, 'records.created');
    assert.equal(eventSources[0].eventSource, 'catalog');

    const sourceEdges = graph.edges.eventSourceToTrigger;
    assert.equal(sourceEdges.length, 2);
    const triggerIds = sourceEdges.map((edge) => edge.triggerId).sort();
    assert.deepEqual(triggerIds, ['trigger-a', 'trigger-b']);
  });
});

function createWorkflowDefinition(
  overrides: Partial<WorkflowDefinitionRecord>
): WorkflowDefinitionRecord {
  const now = ISO_NOW;
  return {
    id: 'workflow-id',
    slug: 'workflow-slug',
    name: 'Workflow',
    version: 1,
    description: null,
    steps: [],
    triggers: [],
    eventTriggers: [],
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    metadata: null,
    dag: {
      adjacency: {},
      roots: [],
      topologicalOrder: [],
      edges: 0
    },
    schedules: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
    steps: overrides.steps ?? [],
    triggers: overrides.triggers ?? [],
    eventTriggers: overrides.eventTriggers ?? [],
    schedules: overrides.schedules ?? []
  } satisfies WorkflowDefinitionRecord;
}

function createAssetDeclaration(
  overrides: Partial<WorkflowAssetDeclarationRecord>
): WorkflowAssetDeclarationRecord {
  const now = ISO_NOW;
  return {
    id: `${overrides.workflowDefinitionId ?? 'wf'}:${overrides.stepId ?? 'step'}:${overrides.assetId ?? 'asset'}:${overrides.direction ?? 'produces'}`,
    workflowDefinitionId: overrides.workflowDefinitionId ?? 'wf',
    stepId: overrides.stepId ?? 'step',
    direction: overrides.direction ?? 'produces',
    assetId: overrides.assetId ?? 'asset',
    schema: null,
    freshness: overrides.freshness ?? null,
    autoMaterialize: overrides.autoMaterialize ?? null,
    partitioning: overrides.partitioning ?? null,
    createdAt: now,
    updatedAt: now
  } satisfies WorkflowAssetDeclarationRecord;
}

function createEventTrigger(
  overrides: Partial<WorkflowEventTriggerRecord>
): WorkflowEventTriggerRecord {
  const now = ISO_NOW;
  const predicates: WorkflowEventTriggerPredicate[] = overrides.predicates ?? [
    {
      type: 'jsonPath',
      path: '$.id',
      operator: 'exists'
    }
  ];
  return {
    id: 'trigger-id',
    workflowDefinitionId: 'workflow-id',
    version: 1,
    status: 'active',
    name: null,
    description: null,
    eventType: 'default.event',
    eventSource: null,
    predicates,
    parameterTemplate: null,
    throttleWindowMs: null,
    throttleCount: null,
    maxConcurrency: null,
    idempotencyKeyExpression: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    ...overrides,
    predicates
  } satisfies WorkflowEventTriggerRecord;
}

function findStep(nodes: WorkflowTopologyStepNode[], id: string): WorkflowTopologyStepNode {
  const step = nodes.find((candidate) => candidate.id === id);
  assert.ok(step, `Expected step ${id} to exist`);
  return step;
}
