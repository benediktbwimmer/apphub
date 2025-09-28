import { describe, expect, it } from 'vitest';
import { buildWorkflowGraphCanvasModel } from '../canvasModel';
import type { WorkflowGraphLiveOverlay } from '../types';
import {
  createLargeWorkflowGraphNormalized,
  createMediumWorkflowGraphNormalized,
  createSmallWorkflowGraphNormalized
} from '../mocks';

describe('buildWorkflowGraphCanvasModel', () => {
  it('projects nodes and edges for a small topology', () => {
    const graph = createSmallWorkflowGraphNormalized();
    const model = buildWorkflowGraphCanvasModel(graph);

    const expectedNodeCount =
      graph.workflows.length +
      graph.steps.length +
      graph.triggers.length +
      graph.schedules.length +
      graph.assets.length +
      graph.eventSources.length;
    expect(model.nodes).toHaveLength(expectedNodeCount);

    const expectedEdgeCount =
      graph.edges.workflowToStep.length +
      graph.edges.triggerToWorkflow.length +
      graph.edges.stepToAsset.length +
      graph.edges.assetToWorkflow.length +
      graph.edges.eventSourceToTrigger.length;
    expect(model.edges).toHaveLength(expectedEdgeCount);

    expect(model.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true);
    expect(model.nodes.every((node) => Number.isFinite(node.position.y))).toBe(true);
  });

  it('highlights workflow selections including related entities', () => {
    const graph = createMediumWorkflowGraphNormalized();
    const workflow = graph.workflows[0];
    const model = buildWorkflowGraphCanvasModel(graph, { selection: { workflowId: workflow.id } });

    const highlightedWorkflowNodes = model.nodes.filter((node) => node.highlighted && node.kind === 'workflow');
    expect(highlightedWorkflowNodes.map((node) => node.refId)).toContain(workflow.id);

    const workflowSteps = graph.steps.filter((step) => step.workflowId === workflow.id);
    const highlightedStepIds = model.nodes
      .filter((node) => node.highlighted && node.kind.startsWith('step'))
      .map((node) => node.refId);
    workflowSteps.forEach((step) => {
      expect(highlightedStepIds).toContain(step.id);
    });

    const highlightedEdges = model.edges.filter((edge) => edge.highlighted);
    expect(highlightedEdges.length).toBeGreaterThan(0);
  });

  it('handles large graphs while keeping coordinates stable', () => {
    const graph = createLargeWorkflowGraphNormalized({ workflowCount: 8, stepsPerWorkflow: 12 });
    const model = buildWorkflowGraphCanvasModel(graph, {
      layout: { rankdir: 'TB' }
    });

    expect(model.nodes).toHaveLength(
      graph.workflows.length +
        graph.steps.length +
        graph.triggers.length +
        graph.schedules.length +
        graph.assets.length +
        graph.eventSources.length
    );

    const uniquePositions = new Set(model.nodes.map((node) => `${Math.round(node.position.x)}:${Math.round(node.position.y)}`));
    expect(uniquePositions.size).toBeGreaterThan(model.nodes.length * 0.6);

    const maxAbsCoordinate = Math.max(
      ...model.nodes.map((node) => Math.max(Math.abs(node.position.x), Math.abs(node.position.y)))
    );
    expect(maxAbsCoordinate).toBeGreaterThan(0);
  });

  it('filters nodes when workflow filters are applied', () => {
    const graph = createSmallWorkflowGraphNormalized();
    const workflow = graph.workflows[0];
    const model = buildWorkflowGraphCanvasModel(graph, {
      filters: { workflowIds: [workflow.id] }
    });

    const workflowNodeIds = model.nodes
      .filter((node) => node.kind === 'workflow')
      .map((node) => node.refId);
    expect(workflowNodeIds).toEqual([workflow.id]);
    expect(model.filtersApplied).toBe(true);
  });

  it('applies search filtering with contextual neighbors', () => {
    const graph = createSmallWorkflowGraphNormalized();
    const model = buildWorkflowGraphCanvasModel(graph, {
      searchTerm: 'Orders'
    });

    const labels = model.nodes.map((node) => node.label.toLowerCase());
    expect(labels.some((label) => label.includes('orders'))).toBe(true);
    expect(model.searchApplied).toBe(true);
  });

  it('annotates nodes with live status overlay metadata', () => {
    const graph = createSmallWorkflowGraphNormalized();
    const overlay: WorkflowGraphLiveOverlay = {
      workflows: {
        [graph.workflows[0]?.id ?? 'wf-unknown']: {
          state: 'running',
          runId: 'run-123',
          updatedAt: '2024-04-02T00:00:05.000Z'
        }
      },
      steps: {
        [graph.steps[0]?.id ?? 'step-unknown']: {
          state: 'running',
          runId: 'run-123',
          updatedAt: '2024-04-02T00:00:05.000Z'
        }
      },
      assets: {
        [graph.assets[0]?.normalizedAssetId ?? 'asset-unknown']: {
          state: 'fresh',
          producedAt: '2024-04-02T00:00:10.000Z',
          expiresAt: '2024-04-02T00:01:10.000Z',
          workflowDefinitionId: graph.workflows[0]?.id ?? null,
          workflowRunId: 'run-123',
          reason: null
        }
      },
      triggers: {}
    };

    const model = buildWorkflowGraphCanvasModel(graph, { overlay });
    const workflowNode = model.nodes.find((node) => node.kind === 'workflow');
    expect(workflowNode?.status?.label).toBe('Running');

    const stepNode = model.nodes.find((node) => node.kind.startsWith('step'));
    expect(stepNode?.status?.label).toBe('Running');

    const assetNode = model.nodes.find((node) => node.kind === 'asset');
    expect(assetNode?.status?.label).toBe('Fresh');
  });
});
