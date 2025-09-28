import dagre from 'dagre';
import type {
  WorkflowTopologyAssetNode,
  WorkflowTopologyEventSourceNode,
  WorkflowTopologyScheduleNode,
  WorkflowTopologyStepNode,
  WorkflowTopologyTriggerNode,
  WorkflowTopologyWorkflowNode
} from '@apphub/shared/workflowTopology';
import type { WorkflowGraphNormalized } from './types';

export type WorkflowGraphCanvasNodeKind =
  | 'workflow'
  | 'step-job'
  | 'step-service'
  | 'step-fanout'
  | 'trigger-event'
  | 'trigger-definition'
  | 'schedule'
  | 'asset'
  | 'event-source';

export type WorkflowGraphCanvasEdgeKind =
  | 'workflow-entry'
  | 'step-dependency'
  | 'trigger'
  | 'schedule'
  | 'step-produces'
  | 'step-consumes'
  | 'asset-feeds'
  | 'event-source';

export type WorkflowGraphCanvasNode = {
  id: string;
  kind: WorkflowGraphCanvasNodeKind;
  label: string;
  subtitle?: string;
  meta?: string[];
  badges?: string[];
  width: number;
  height: number;
  position: { x: number; y: number };
  highlighted: boolean;
  refId: string;
};

export type WorkflowGraphCanvasEdge = {
  id: string;
  kind: WorkflowGraphCanvasEdgeKind;
  source: string;
  target: string;
  label?: string;
  highlighted: boolean;
};

export type WorkflowGraphCanvasModel = {
  nodes: WorkflowGraphCanvasNode[];
  edges: WorkflowGraphCanvasEdge[];
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
};

export type WorkflowGraphCanvasSelection = {
  workflowId?: string | null;
  stepId?: string | null;
  triggerId?: string | null;
  assetNormalizedId?: string | null;
};

export type WorkflowGraphCanvasLayoutConfig = {
  rankdir: 'LR' | 'RL' | 'TB' | 'BT';
  ranksep: number;
  nodesep: number;
  marginx: number;
  marginy: number;
};

const DEFAULT_LAYOUT: WorkflowGraphCanvasLayoutConfig = {
  rankdir: 'LR',
  ranksep: 260,
  nodesep: 160,
  marginx: 48,
  marginy: 48
};

const NODE_DIMENSIONS: Record<WorkflowGraphCanvasNodeKind, { width: number; height: number }> = {
  workflow: { width: 280, height: 144 },
  'step-job': { width: 260, height: 168 },
  'step-service': { width: 260, height: 168 },
  'step-fanout': { width: 260, height: 188 },
  'trigger-event': { width: 240, height: 132 },
  'trigger-definition': { width: 240, height: 132 },
  schedule: { width: 240, height: 120 },
  asset: { width: 260, height: 152 },
  'event-source': { width: 220, height: 108 }
};

const STEP_KIND_MAP: Record<WorkflowTopologyStepNode['runtime']['type'], WorkflowGraphCanvasNodeKind> = {
  job: 'step-job',
  service: 'step-service',
  fanout: 'step-fanout'
};

function toWorkflowNodeId(workflowId: string): string {
  return `workflow:${workflowId}`;
}

function toStepNodeId(step: WorkflowTopologyStepNode): string {
  return `step:${step.workflowId}:${step.id}`;
}

function toTriggerNodeId(trigger: WorkflowTopologyTriggerNode): string {
  return `trigger:${trigger.id}`;
}

function toScheduleNodeId(schedule: WorkflowTopologyScheduleNode): string {
  return `schedule:${schedule.id}`;
}

function toAssetNodeId(asset: WorkflowTopologyAssetNode): string {
  return `asset:${asset.normalizedAssetId}`;
}

function toEventSourceNodeId(eventSource: WorkflowTopologyEventSourceNode): string {
  return `event-source:${eventSource.id}`;
}

function resolveStepNodeId(graph: WorkflowGraphNormalized, stepId: string): string | null {
  const lookup = graph.stepsIndex.byId[stepId];
  return lookup ? toStepNodeId(lookup) : null;
}

function resolveWorkflowNodeId(graph: WorkflowGraphNormalized, workflowId: string): string | null {
  const lookup = graph.workflowsIndex.byId[workflowId];
  return lookup ? toWorkflowNodeId(lookup.id) : null;
}

function isEventTrigger(trigger: WorkflowTopologyTriggerNode): trigger is Extract<WorkflowTopologyTriggerNode, { kind: 'event' }> {
  return trigger.kind === 'event';
}

function isDefinitionTrigger(trigger: WorkflowTopologyTriggerNode): trigger is Extract<WorkflowTopologyTriggerNode, { kind: 'definition' }> {
  return trigger.kind === 'definition';
}

function formatStepRuntimeMeta(step: WorkflowTopologyStepNode): string[] {
  const { runtime } = step;
  if (runtime.type === 'job') {
    const badge = runtime.jobSlug ? `Job · ${runtime.jobSlug}` : 'Job runtime';
    return [badge];
  }
  if (runtime.type === 'service') {
    const badge = runtime.serviceSlug ? `Service · ${runtime.serviceSlug}` : 'Service runtime';
    return [badge];
  }
  if (runtime.type === 'fanout') {
    const meta: string[] = ['Fan out'];
    if (runtime.template?.runtime.type === 'job' && runtime.template.runtime.jobSlug) {
      meta.push(`Template job · ${runtime.template.runtime.jobSlug}`);
    }
    if (runtime.template?.runtime.type === 'service' && runtime.template.runtime.serviceSlug) {
      meta.push(`Template service · ${runtime.template.runtime.serviceSlug}`);
    }
    if (typeof runtime.maxItems === 'number') {
      meta.push(`Max items · ${runtime.maxItems}`);
    }
    if (typeof runtime.maxConcurrency === 'number') {
      meta.push(`Max concurrency · ${runtime.maxConcurrency}`);
    }
    return meta;
  }
  return [];
}

function formatTriggerSubtitle(trigger: WorkflowTopologyTriggerNode): string | undefined {
  if (isEventTrigger(trigger)) {
    return trigger.eventType ?? undefined;
  }
  if (isDefinitionTrigger(trigger)) {
    return trigger.triggerType;
  }
  return undefined;
}

function formatScheduleSubtitle(schedule: WorkflowTopologyScheduleNode): string {
  const timezone = schedule.timezone ?? 'UTC';
  return `${schedule.cron} · ${timezone}`;
}

export function collectHighlightedNodeIds(
  graph: WorkflowGraphNormalized,
  selection: WorkflowGraphCanvasSelection | undefined
): Set<string> {
  const highlighted = new Set<string>();
  if (!selection) {
    return highlighted;
  }

  if (selection.workflowId) {
    const workflowNodeId = resolveWorkflowNodeId(graph, selection.workflowId);
    if (workflowNodeId) {
      highlighted.add(workflowNodeId);
    }

    const workflowSteps = graph.steps.filter((step) => step.workflowId === selection.workflowId);
    for (const step of workflowSteps) {
      highlighted.add(toStepNodeId(step));
      const produces = graph.adjacency.stepProduces[step.id] ?? [];
      const consumes = graph.adjacency.stepConsumes[step.id] ?? [];
      for (const edge of produces) {
        const asset = graph.assetsIndex.byNormalizedId[edge.normalizedAssetId];
        if (asset) {
          highlighted.add(toAssetNodeId(asset));
        }
      }
      for (const edge of consumes) {
        const asset = graph.assetsIndex.byNormalizedId[edge.normalizedAssetId];
        if (asset) {
          highlighted.add(toAssetNodeId(asset));
        }
      }
    }

    const workflowTriggers = graph.triggers.filter((trigger) => trigger.workflowId === selection.workflowId);
    for (const trigger of workflowTriggers) {
      highlighted.add(toTriggerNodeId(trigger));
      const linkedSources = graph.adjacency.triggerEventSourceEdges[trigger.id] ?? [];
      for (const edge of linkedSources) {
        const source = graph.eventSourcesIndex.byId[edge.sourceId];
        if (source) {
          highlighted.add(toEventSourceNodeId(source));
        }
      }
    }

    const workflowSchedules = graph.schedules.filter((schedule) => schedule.workflowId === selection.workflowId);
    for (const schedule of workflowSchedules) {
      highlighted.add(toScheduleNodeId(schedule));
    }

    const autoMaterialize = graph.adjacency.workflowAutoMaterializeSources[selection.workflowId] ?? [];
    for (const edge of autoMaterialize) {
      const asset = graph.assetsIndex.byNormalizedId[edge.normalizedAssetId];
      if (asset) {
        highlighted.add(toAssetNodeId(asset));
      }
    }
  }

  if (selection.stepId) {
    const nodeId = resolveStepNodeId(graph, selection.stepId);
    if (nodeId) {
      highlighted.add(nodeId);
    }
  }

  if (selection.triggerId) {
    const trigger = graph.triggersIndex.byId[selection.triggerId];
    if (trigger) {
      highlighted.add(toTriggerNodeId(trigger));
    }
  }

  if (selection.assetNormalizedId) {
    const asset = graph.assetsIndex.byNormalizedId[selection.assetNormalizedId];
    if (asset) {
      highlighted.add(toAssetNodeId(asset));
    }
  }

  return highlighted;
}

function buildWorkflowNodes(
  workflows: WorkflowTopologyWorkflowNode[],
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return workflows.map((workflow) => {
    const id = toWorkflowNodeId(workflow.id);
    return {
      id,
      refId: workflow.id,
      kind: 'workflow',
      label: workflow.name,
      subtitle: workflow.slug,
      meta: [`Version ${workflow.version}`],
      width: NODE_DIMENSIONS.workflow.width,
      height: NODE_DIMENSIONS.workflow.height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildStepNodes(
  steps: WorkflowTopologyStepNode[],
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return steps.map((step) => {
    const id = toStepNodeId(step);
    const kind = STEP_KIND_MAP[step.runtime.type];
    const badges: string[] = [];
    if (step.runtime.type === 'job' && step.runtime.jobSlug) {
      badges.push(step.runtime.jobSlug);
    }
    if (step.runtime.type === 'service' && step.runtime.serviceSlug) {
      badges.push(step.runtime.serviceSlug);
    }
    if (step.runtime.type === 'fanout') {
      badges.push(`${step.runtime.template.runtime.type} template`);
    }
    const meta = formatStepRuntimeMeta(step);
    return {
      id,
      refId: step.id,
      kind,
      label: step.name,
      subtitle: step.type ?? step.runtime.type,
      badges,
      meta,
      width: NODE_DIMENSIONS[kind].width,
      height: NODE_DIMENSIONS[kind].height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildTriggerNodes(
  triggers: WorkflowTopologyTriggerNode[],
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return triggers.map((trigger) => {
    const id = toTriggerNodeId(trigger);
    const kind: WorkflowGraphCanvasNodeKind = isEventTrigger(trigger)
      ? 'trigger-event'
      : 'trigger-definition';
    const subtitle = formatTriggerSubtitle(trigger);
    const meta: string[] = [];
    if (isEventTrigger(trigger)) {
      meta.push(`Status · ${trigger.status}`);
      if (trigger.maxConcurrency) {
        meta.push(`Concurrency · ${trigger.maxConcurrency}`);
      }
    } else if (trigger.schedule) {
      meta.push(`Schedule · ${trigger.schedule.cron}`);
    }
    return {
      id,
      refId: trigger.id,
      kind,
      label: trigger.name ?? trigger.id,
      subtitle,
      meta,
      width: NODE_DIMENSIONS[kind].width,
      height: NODE_DIMENSIONS[kind].height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildScheduleNodes(
  schedules: WorkflowTopologyScheduleNode[],
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return schedules.map((schedule) => {
    const id = toScheduleNodeId(schedule);
    const subtitle = formatScheduleSubtitle(schedule);
    return {
      id,
      refId: schedule.id,
      kind: 'schedule',
      label: schedule.name ?? schedule.id,
      subtitle,
      meta: [schedule.isActive ? 'Active' : 'Paused'],
      width: NODE_DIMENSIONS.schedule.width,
      height: NODE_DIMENSIONS.schedule.height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildAssetNodes(
  assets: WorkflowTopologyAssetNode[],
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return assets.map((asset) => {
    const id = toAssetNodeId(asset);
    const tags = asset.annotations?.tags ?? [];
    return {
      id,
      refId: asset.normalizedAssetId,
      kind: 'asset',
      label: asset.assetId,
      subtitle: asset.normalizedAssetId,
      badges: tags.slice(0, 2),
      meta: tags.slice(2),
      width: NODE_DIMENSIONS.asset.width,
      height: NODE_DIMENSIONS.asset.height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildEventSourceNodes(
  eventSources: WorkflowTopologyEventSourceNode[],
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return eventSources.map((source) => {
    const id = toEventSourceNodeId(source);
    const subtitle = source.eventType;
    return {
      id,
      refId: source.id,
      kind: 'event-source',
      label: source.eventSource ?? source.id,
      subtitle,
      width: NODE_DIMENSIONS['event-source'].width,
      height: NODE_DIMENSIONS['event-source'].height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildWorkflowEntryEdgeId(workflowId: string, toNodeId: string): string {
  return `edge:workflow-entry:${workflowId}->${toNodeId}`;
}

function buildStepDependencyEdgeId(from: string, to: string): string {
  return `edge:step-dependency:${from}->${to}`;
}

function buildTriggerEdgeId(triggerId: string, workflowId: string): string {
  return `edge:trigger:${triggerId}->${workflowId}`;
}

function buildScheduleEdgeId(scheduleId: string, workflowId: string): string {
  return `edge:schedule:${scheduleId}->${workflowId}`;
}

function buildAssetEdgeId(prefix: string, source: string, target: string): string {
  return `edge:${prefix}:${source}->${target}`;
}

function buildEventSourceEdgeId(sourceId: string, triggerId: string): string {
  return `edge:event-source:${sourceId}->${triggerId}`;
}

function buildWorkflowAndStepEdges(
  graph: WorkflowGraphNormalized,
  highlightedNodes: Set<string>
): WorkflowGraphCanvasEdge[] {
  const edges: WorkflowGraphCanvasEdge[] = [];
  for (const edge of graph.edges.workflowToStep) {
    const workflowNodeId = resolveWorkflowNodeId(graph, edge.workflowId);
    const toNodeId = resolveStepNodeId(graph, edge.toStepId);
    if (!toNodeId) {
      continue;
    }
    if (!edge.fromStepId) {
      if (!workflowNodeId) {
        continue;
      }
      const id = buildWorkflowEntryEdgeId(edge.workflowId, toNodeId);
      edges.push({
        id,
        kind: 'workflow-entry',
        source: workflowNodeId,
        target: toNodeId,
        highlighted: highlightedNodes.has(workflowNodeId) && highlightedNodes.has(toNodeId)
      });
    } else {
      const fromNodeId = resolveStepNodeId(graph, edge.fromStepId);
      if (!fromNodeId) {
        continue;
      }
      const id = buildStepDependencyEdgeId(fromNodeId, toNodeId);
      edges.push({
        id,
        kind: 'step-dependency',
        source: fromNodeId,
        target: toNodeId,
        highlighted: highlightedNodes.has(fromNodeId) && highlightedNodes.has(toNodeId)
      });
    }
  }
  return edges;
}

function buildTriggerEdges(
  graph: WorkflowGraphNormalized,
  highlightedNodes: Set<string>
): WorkflowGraphCanvasEdge[] {
  const edges: WorkflowGraphCanvasEdge[] = [];
  for (const edge of graph.edges.triggerToWorkflow) {
    const workflowNodeId = resolveWorkflowNodeId(graph, edge.workflowId);
    if (!workflowNodeId) {
      continue;
    }
    if (edge.kind === 'schedule') {
      const schedule = graph.schedulesIndex.byId[edge.scheduleId];
      if (!schedule) {
        continue;
      }
      const scheduleNodeId = toScheduleNodeId(schedule);
      const id = buildScheduleEdgeId(schedule.id, edge.workflowId);
      edges.push({
        id,
        kind: 'schedule',
        source: scheduleNodeId,
        target: workflowNodeId,
        highlighted: highlightedNodes.has(scheduleNodeId) && highlightedNodes.has(workflowNodeId)
      });
      continue;
    }
    const trigger = graph.triggersIndex.byId[edge.triggerId];
    if (!trigger) {
      continue;
    }
    const triggerNodeId = toTriggerNodeId(trigger);
    const id = buildTriggerEdgeId(trigger.id, edge.workflowId);
    edges.push({
      id,
      kind: 'trigger',
      source: triggerNodeId,
      target: workflowNodeId,
      highlighted: highlightedNodes.has(triggerNodeId) && highlightedNodes.has(workflowNodeId)
    });
  }
  return edges;
}

function buildStepAssetEdges(
  graph: WorkflowGraphNormalized,
  highlightedNodes: Set<string>
): WorkflowGraphCanvasEdge[] {
  const edges: WorkflowGraphCanvasEdge[] = [];
  for (const edge of graph.edges.stepToAsset) {
    const stepNodeId = resolveStepNodeId(graph, edge.stepId);
    const asset = graph.assetsIndex.byNormalizedId[edge.normalizedAssetId];
    if (!stepNodeId || !asset) {
      continue;
    }
    const assetNodeId = toAssetNodeId(asset);
    const prefix = edge.direction === 'produces' ? 'step-produces' : 'step-consumes';
    const id = buildAssetEdgeId(prefix, stepNodeId, assetNodeId);
    const isHighlighted = highlightedNodes.has(stepNodeId) && highlightedNodes.has(assetNodeId);
    if (edge.direction === 'produces') {
      edges.push({
        id,
        kind: 'step-produces',
        source: stepNodeId,
        target: assetNodeId,
        label: 'produces',
        highlighted: isHighlighted
      });
    } else {
      edges.push({
        id,
        kind: 'step-consumes',
        source: assetNodeId,
        target: stepNodeId,
        label: 'consumes',
        highlighted: isHighlighted
      });
    }
  }
  return edges;
}

function buildAssetWorkflowEdges(
  graph: WorkflowGraphNormalized,
  highlightedNodes: Set<string>
): WorkflowGraphCanvasEdge[] {
  const edges: WorkflowGraphCanvasEdge[] = [];
  for (const edge of graph.edges.assetToWorkflow) {
    const asset = graph.assetsIndex.byNormalizedId[edge.normalizedAssetId];
    const workflowNodeId = resolveWorkflowNodeId(graph, edge.workflowId);
    if (!asset || !workflowNodeId) {
      continue;
    }
    const assetNodeId = toAssetNodeId(asset);
    const id = buildAssetEdgeId('asset-feeds', assetNodeId, workflowNodeId);
    edges.push({
      id,
      kind: 'asset-feeds',
      source: assetNodeId,
      target: workflowNodeId,
      label: 'feeds',
      highlighted: highlightedNodes.has(assetNodeId) && highlightedNodes.has(workflowNodeId)
    });
  }
  return edges;
}

function buildEventSourceEdges(
  graph: WorkflowGraphNormalized,
  highlightedNodes: Set<string>
): WorkflowGraphCanvasEdge[] {
  const edges: WorkflowGraphCanvasEdge[] = [];
  for (const edge of graph.edges.eventSourceToTrigger) {
    const source = graph.eventSourcesIndex.byId[edge.sourceId];
    const trigger = graph.triggersIndex.byId[edge.triggerId];
    if (!source || !trigger) {
      continue;
    }
    const sourceNodeId = toEventSourceNodeId(source);
    const triggerNodeId = toTriggerNodeId(trigger);
    const id = buildEventSourceEdgeId(edge.sourceId, edge.triggerId);
    edges.push({
      id,
      kind: 'event-source',
      source: sourceNodeId,
      target: triggerNodeId,
      label: 'emits',
      highlighted: highlightedNodes.has(sourceNodeId) && highlightedNodes.has(triggerNodeId)
    });
  }
  return edges;
}

function applyLayout(
  nodes: WorkflowGraphCanvasNode[],
  edges: WorkflowGraphCanvasEdge[],
  layoutConfig: WorkflowGraphCanvasLayoutConfig
): WorkflowGraphCanvasNode[] {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph(layoutConfig);

  for (const node of nodes) {
    dagreGraph.setNode(node.id, {
      width: node.width,
      height: node.height
    });
  }

  for (const edge of edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const metadata = dagreGraph.node(node.id);
    if (!metadata) {
      return node;
    }
    return {
      ...node,
      position: {
        x: metadata.x - node.width / 2,
        y: metadata.y - node.height / 2
      }
    } satisfies WorkflowGraphCanvasNode;
  });
}

export function buildWorkflowGraphCanvasModel(
  graph: WorkflowGraphNormalized,
  options: {
    layout?: Partial<WorkflowGraphCanvasLayoutConfig>;
    selection?: WorkflowGraphCanvasSelection;
  } = {}
): WorkflowGraphCanvasModel {
  const layoutConfig: WorkflowGraphCanvasLayoutConfig = {
    ...DEFAULT_LAYOUT,
    ...(options.layout ?? {})
  };

  const highlightedNodes = collectHighlightedNodeIds(graph, options.selection);

  const workflowNodes = buildWorkflowNodes(graph.workflows, highlightedNodes);
  const stepNodes = buildStepNodes(graph.steps, highlightedNodes);
  const triggerNodes = buildTriggerNodes(graph.triggers, highlightedNodes);
  const scheduleNodes = buildScheduleNodes(graph.schedules, highlightedNodes);
  const assetNodes = buildAssetNodes(graph.assets, highlightedNodes);
  const eventSourceNodes = buildEventSourceNodes(graph.eventSources, highlightedNodes);

  const nodes = [
    ...workflowNodes,
    ...stepNodes,
    ...triggerNodes,
    ...scheduleNodes,
    ...assetNodes,
    ...eventSourceNodes
  ];

  const edges = [
    ...buildWorkflowAndStepEdges(graph, highlightedNodes),
    ...buildTriggerEdges(graph, highlightedNodes),
    ...buildStepAssetEdges(graph, highlightedNodes),
    ...buildAssetWorkflowEdges(graph, highlightedNodes),
    ...buildEventSourceEdges(graph, highlightedNodes)
  ];

  const layoutNodes = applyLayout(nodes, edges, layoutConfig);

  const highlightedEdgeIds = new Set<string>(
    edges.filter((edge) => edge.highlighted).map((edge) => edge.id)
  );

  return {
    nodes: layoutNodes,
    edges,
    highlightedNodeIds: highlightedNodes,
    highlightedEdgeIds
  } satisfies WorkflowGraphCanvasModel;
}

export const __internal = {
  toWorkflowNodeId,
  toStepNodeId,
  toTriggerNodeId,
  toScheduleNodeId,
  toAssetNodeId,
  toEventSourceNodeId,
  collectHighlightedNodeIds
};
