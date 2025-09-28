import { describe, expect, it } from 'vitest';
import { buildWorkflowGraphCanvasModel } from '../canvasModel';
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
});
