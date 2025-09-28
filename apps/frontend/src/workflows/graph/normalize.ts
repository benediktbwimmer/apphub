import type {
  WorkflowTopologyAssetNode,
  WorkflowTopologyAssetWorkflowEdge,
  WorkflowTopologyEventSourceNode,
  WorkflowTopologyEventSourceTriggerEdge,
  WorkflowTopologyGraph,
  WorkflowTopologyScheduleNode,
  WorkflowTopologyStepAssetEdge,
  WorkflowTopologyStepNode,
  WorkflowTopologyTriggerNode,
  WorkflowTopologyTriggerWorkflowEdge,
  WorkflowTopologyWorkflowNode,
  WorkflowTopologyWorkflowStepEdge
} from '@apphub/shared/workflowTopology';
import {
  type WorkflowGraphAdjacency,
  type WorkflowGraphAssetMap,
  type WorkflowGraphEventSourceIndex,
  type WorkflowGraphNormalized,
  type WorkflowGraphScheduleIndex,
  type WorkflowGraphStats,
  type WorkflowGraphStepIndex,
  type WorkflowGraphTriggerIndex,
  type WorkflowGraphWorkflowMap
} from './types';

function cloneAndSortWorkflows(nodes: WorkflowTopologyWorkflowNode[]): WorkflowTopologyWorkflowNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      const slugCompare = a.slug.localeCompare(b.slug);
      if (slugCompare !== 0) {
        return slugCompare;
      }
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.id.localeCompare(b.id);
    });
}

function cloneAndSortSteps(
  nodes: WorkflowTopologyStepNode[],
  workflowsById: WorkflowGraphWorkflowMap['byId']
): WorkflowTopologyStepNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      const workflowA = workflowsById[a.workflowId];
      const workflowB = workflowsById[b.workflowId];
      const slugA = workflowA?.slug ?? a.workflowId;
      const slugB = workflowB?.slug ?? b.workflowId;
      if (slugA !== slugB) {
        return slugA.localeCompare(slugB);
      }
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.id.localeCompare(b.id);
    });
}

function cloneAndSortTriggers(
  nodes: WorkflowTopologyTriggerNode[],
  workflowsById: WorkflowGraphWorkflowMap['byId']
): WorkflowTopologyTriggerNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      const workflowA = workflowsById[a.workflowId];
      const workflowB = workflowsById[b.workflowId];
      const slugA = workflowA?.slug ?? a.workflowId;
      const slugB = workflowB?.slug ?? b.workflowId;
      if (slugA !== slugB) {
        return slugA.localeCompare(slugB);
      }
      if (a.kind !== b.kind) {
        return a.kind.localeCompare(b.kind);
      }
      return a.id.localeCompare(b.id);
    });
}

function cloneAndSortSchedules(
  nodes: WorkflowTopologyScheduleNode[],
  workflowsById: WorkflowGraphWorkflowMap['byId']
): WorkflowTopologyScheduleNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      const workflowA = workflowsById[a.workflowId];
      const workflowB = workflowsById[b.workflowId];
      const slugA = workflowA?.slug ?? a.workflowId;
      const slugB = workflowB?.slug ?? b.workflowId;
      if (slugA !== slugB) {
        return slugA.localeCompare(slugB);
      }
      if (a.cron !== b.cron) {
        return a.cron.localeCompare(b.cron);
      }
      return a.id.localeCompare(b.id);
    });
}

function cloneAndSortAssets(nodes: WorkflowTopologyAssetNode[]): WorkflowTopologyAssetNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      if (a.normalizedAssetId !== b.normalizedAssetId) {
        return a.normalizedAssetId.localeCompare(b.normalizedAssetId);
      }
      if (a.assetId !== b.assetId) {
        return a.assetId.localeCompare(b.assetId);
      }
      return a.id.localeCompare(b.id);
    });
}

function cloneAndSortEventSources(nodes: WorkflowTopologyEventSourceNode[]): WorkflowTopologyEventSourceNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      if (a.eventType !== b.eventType) {
        return a.eventType.localeCompare(b.eventType);
      }
      const sourceA = a.eventSource ?? '';
      const sourceB = b.eventSource ?? '';
      if (sourceA !== sourceB) {
        return sourceA.localeCompare(sourceB);
      }
      return a.id.localeCompare(b.id);
    });
}

function indexWorkflows(nodes: WorkflowTopologyWorkflowNode[]): WorkflowGraphWorkflowMap {
  const byId: WorkflowGraphWorkflowMap['byId'] = {};
  const bySlug: WorkflowGraphWorkflowMap['bySlug'] = {};
  for (const node of nodes) {
    byId[node.id] = node;
    bySlug[node.slug] = node;
  }
  return { byId, bySlug };
}

function indexSteps(nodes: WorkflowTopologyStepNode[]): WorkflowGraphStepIndex {
  const byId: WorkflowGraphStepIndex['byId'] = {};
  const byWorkflowId: WorkflowGraphStepIndex['byWorkflowId'] = {};
  for (const node of nodes) {
    byId[node.id] = node;
    if (!byWorkflowId[node.workflowId]) {
      byWorkflowId[node.workflowId] = [];
    }
    byWorkflowId[node.workflowId].push(node);
  }
  for (const workflowId of Object.keys(byWorkflowId)) {
    byWorkflowId[workflowId] = byWorkflowId[workflowId].slice().sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.id.localeCompare(b.id);
    });
  }
  return { byId, byWorkflowId };
}

function indexTriggers(nodes: WorkflowTopologyTriggerNode[]): WorkflowGraphTriggerIndex {
  const byId: WorkflowGraphTriggerIndex['byId'] = {};
  const byWorkflowId: WorkflowGraphTriggerIndex['byWorkflowId'] = {};
  for (const node of nodes) {
    byId[node.id] = node;
    if (!byWorkflowId[node.workflowId]) {
      byWorkflowId[node.workflowId] = [];
    }
    byWorkflowId[node.workflowId].push(node);
  }
  for (const workflowId of Object.keys(byWorkflowId)) {
    byWorkflowId[workflowId] = byWorkflowId[workflowId].slice().sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind.localeCompare(b.kind);
      }
      return a.id.localeCompare(b.id);
    });
  }
  return { byId, byWorkflowId };
}

function indexSchedules(nodes: WorkflowTopologyScheduleNode[]): WorkflowGraphScheduleIndex {
  const byId: WorkflowGraphScheduleIndex['byId'] = {};
  const byWorkflowId: WorkflowGraphScheduleIndex['byWorkflowId'] = {};
  for (const node of nodes) {
    byId[node.id] = node;
    if (!byWorkflowId[node.workflowId]) {
      byWorkflowId[node.workflowId] = [];
    }
    byWorkflowId[node.workflowId].push(node);
  }
  for (const workflowId of Object.keys(byWorkflowId)) {
    byWorkflowId[workflowId] = byWorkflowId[workflowId].slice().sort((a, b) => {
      if (a.cron !== b.cron) {
        return a.cron.localeCompare(b.cron);
      }
      return a.id.localeCompare(b.id);
    });
  }
  return { byId, byWorkflowId };
}

function indexAssets(nodes: WorkflowTopologyAssetNode[]): WorkflowGraphAssetMap {
  const byId: WorkflowGraphAssetMap['byId'] = {};
  const byNormalizedId: WorkflowGraphAssetMap['byNormalizedId'] = {};
  for (const node of nodes) {
    byId[node.id] = node;
    byNormalizedId[node.normalizedAssetId] = node;
  }
  return { byId, byNormalizedId };
}

function buildEventSourceKey(node: WorkflowTopologyEventSourceNode): string {
  const source = node.eventSource ?? '';
  return `${node.eventType}::${source}`;
}

function indexEventSources(nodes: WorkflowTopologyEventSourceNode[]): WorkflowGraphEventSourceIndex {
  const byId: WorkflowGraphEventSourceIndex['byId'] = {};
  const byKey: WorkflowGraphEventSourceIndex['byKey'] = {};
  for (const node of nodes) {
    byId[node.id] = node;
    byKey[buildEventSourceKey(node)] = node;
  }
  return { byId, byKey };
}

function pushEdge<T>(record: Record<string, T[]>, key: string, value: T): void {
  if (!record[key]) {
    record[key] = [];
  }
  record[key].push(value);
}

function addToSet(record: Map<string, Set<string>>, key: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  if (!record.has(key)) {
    record.set(key, new Set());
  }
  record.get(key)?.add(value);
}

function mapSetToSortedRecord(source: Map<string, Set<string>>): Record<string, string[]> {
  const record: Record<string, string[]> = {};
  for (const [key, value] of source.entries()) {
    record[key] = Array.from(value).sort((a, b) => a.localeCompare(b));
  }
  return record;
}

function sortEdgeRecord<T>(
  record: Record<string, T[]>,
  sorter: (a: T, b: T) => number
): Record<string, T[]> {
  const sorted: Record<string, T[]> = {};
  for (const key of Object.keys(record)) {
    sorted[key] = record[key].slice().sort(sorter);
  }
  return sorted;
}

function compareWorkflowStepEdge(a: WorkflowTopologyWorkflowStepEdge, b: WorkflowTopologyWorkflowStepEdge): number {
  const fromA = a.fromStepId ?? '';
  const fromB = b.fromStepId ?? '';
  if (fromA !== fromB) {
    return fromA.localeCompare(fromB);
  }
  return a.toStepId.localeCompare(b.toStepId);
}

function compareStepAssetEdge(a: WorkflowTopologyStepAssetEdge, b: WorkflowTopologyStepAssetEdge): number {
  if (a.stepId !== b.stepId) {
    return a.stepId.localeCompare(b.stepId);
  }
  if (a.direction !== b.direction) {
    return a.direction.localeCompare(b.direction);
  }
  if (a.normalizedAssetId !== b.normalizedAssetId) {
    return a.normalizedAssetId.localeCompare(b.normalizedAssetId);
  }
  return a.assetId.localeCompare(b.assetId);
}

function compareAssetWorkflowEdge(a: WorkflowTopologyAssetWorkflowEdge, b: WorkflowTopologyAssetWorkflowEdge): number {
  if (a.workflowId !== b.workflowId) {
    return a.workflowId.localeCompare(b.workflowId);
  }
  if (a.stepId !== b.stepId) {
    const stepA = a.stepId ?? '';
    const stepB = b.stepId ?? '';
    return stepA.localeCompare(stepB);
  }
  return a.normalizedAssetId.localeCompare(b.normalizedAssetId);
}

function compareTriggerWorkflowEdge(a: WorkflowTopologyTriggerWorkflowEdge, b: WorkflowTopologyTriggerWorkflowEdge): number {
  if (a.workflowId !== b.workflowId) {
    return a.workflowId.localeCompare(b.workflowId);
  }
  const keyA = 'triggerId' in a ? a.triggerId : a.scheduleId ?? '';
  const keyB = 'triggerId' in b ? b.triggerId : b.scheduleId ?? '';
  return keyA.localeCompare(keyB);
}

function compareEventSourceTriggerEdge(
  a: WorkflowTopologyEventSourceTriggerEdge,
  b: WorkflowTopologyEventSourceTriggerEdge
): number {
  if (a.sourceId !== b.sourceId) {
    return a.sourceId.localeCompare(b.sourceId);
  }
  return a.triggerId.localeCompare(b.triggerId);
}

function buildAdjacency(
  graph: WorkflowTopologyGraph
): WorkflowGraphAdjacency {
  const workflowStepEdges: Record<string, WorkflowTopologyWorkflowStepEdge[]> = {};
  const stepParentsMap = new Map<string, Set<string>>();
  const stepChildrenMap = new Map<string, Set<string>>();
  const workflowEntrySteps = new Map<string, Set<string>>();
  const stepOutgoingPresence = new Map<string, boolean>();

  for (const edge of graph.edges.workflowToStep) {
    pushEdge(workflowStepEdges, edge.workflowId, edge);
    if (edge.fromStepId === null) {
      addToSet(workflowEntrySteps, edge.workflowId, edge.toStepId);
    } else {
      addToSet(stepChildrenMap, edge.fromStepId, edge.toStepId);
      addToSet(stepParentsMap, edge.toStepId, edge.fromStepId);
      stepOutgoingPresence.set(edge.fromStepId, true);
    }
    const existing = stepOutgoingPresence.get(edge.toStepId);
    if (existing === undefined) {
      stepOutgoingPresence.set(edge.toStepId, false);
    }
  }

  const workflowTerminalSteps = new Map<string, Set<string>>();
  for (const step of graph.nodes.steps) {
    const hasChildren = stepOutgoingPresence.get(step.id) ?? false;
    if (!hasChildren) {
      addToSet(workflowTerminalSteps, step.workflowId, step.id);
    }
  }

  const stepProduces: Record<string, WorkflowTopologyStepAssetEdge[]> = {};
  const stepConsumes: Record<string, WorkflowTopologyStepAssetEdge[]> = {};
  const assetProducers: Record<string, WorkflowTopologyStepAssetEdge[]> = {};
  const assetConsumers: Record<string, WorkflowTopologyStepAssetEdge[]> = {};

  for (const edge of graph.edges.stepToAsset) {
    if (edge.direction === 'produces') {
      pushEdge(stepProduces, edge.stepId, edge);
      pushEdge(assetProducers, edge.normalizedAssetId, edge);
    } else {
      pushEdge(stepConsumes, edge.stepId, edge);
      pushEdge(assetConsumers, edge.normalizedAssetId, edge);
    }
  }

  const assetAutoMaterializeTargets: Record<string, WorkflowTopologyAssetWorkflowEdge[]> = {};
  const workflowAutoMaterializeSources: Record<string, WorkflowTopologyAssetWorkflowEdge[]> = {};

  for (const edge of graph.edges.assetToWorkflow) {
    pushEdge(assetAutoMaterializeTargets, edge.normalizedAssetId, edge);
    pushEdge(workflowAutoMaterializeSources, edge.workflowId, edge);
  }

  const workflowTriggerEdges: Record<string, WorkflowTopologyTriggerWorkflowEdge[]> = {};
  const triggerWorkflowEdges: Record<string, WorkflowTopologyTriggerWorkflowEdge[]> = {};

  for (const edge of graph.edges.triggerToWorkflow) {
    pushEdge(workflowTriggerEdges, edge.workflowId, edge);
    const lookupKey = edge.kind === 'schedule' ? edge.scheduleId : edge.triggerId;
    pushEdge(triggerWorkflowEdges, lookupKey, edge);
  }

  const eventSourceTriggerEdges: Record<string, WorkflowTopologyEventSourceTriggerEdge[]> = {};
  const triggerEventSourceEdges: Record<string, WorkflowTopologyEventSourceTriggerEdge[]> = {};

  for (const edge of graph.edges.eventSourceToTrigger) {
    pushEdge(eventSourceTriggerEdges, edge.sourceId, edge);
    pushEdge(triggerEventSourceEdges, edge.triggerId, edge);
  }

  return {
    workflowStepEdges: sortEdgeRecord(workflowStepEdges, compareWorkflowStepEdge),
    workflowEntryStepIds: mapSetToSortedRecord(workflowEntrySteps),
    workflowTerminalStepIds: mapSetToSortedRecord(workflowTerminalSteps),
    stepParents: mapSetToSortedRecord(stepParentsMap),
    stepChildren: mapSetToSortedRecord(stepChildrenMap),
    stepProduces: sortEdgeRecord(stepProduces, compareStepAssetEdge),
    stepConsumes: sortEdgeRecord(stepConsumes, compareStepAssetEdge),
    assetProducers: sortEdgeRecord(assetProducers, compareStepAssetEdge),
    assetConsumers: sortEdgeRecord(assetConsumers, compareStepAssetEdge),
    assetAutoMaterializeTargets: sortEdgeRecord(assetAutoMaterializeTargets, compareAssetWorkflowEdge),
    workflowAutoMaterializeSources: sortEdgeRecord(
      workflowAutoMaterializeSources,
      compareAssetWorkflowEdge
    ),
    workflowTriggerEdges: sortEdgeRecord(workflowTriggerEdges, compareTriggerWorkflowEdge),
    triggerWorkflowEdges: sortEdgeRecord(triggerWorkflowEdges, compareTriggerWorkflowEdge),
    eventSourceTriggerEdges: sortEdgeRecord(eventSourceTriggerEdges, compareEventSourceTriggerEdge),
    triggerEventSourceEdges: sortEdgeRecord(triggerEventSourceEdges, compareEventSourceTriggerEdge)
  } satisfies WorkflowGraphAdjacency;
}

function buildStats(graph: WorkflowTopologyGraph): WorkflowGraphStats {
  return {
    totalWorkflows: graph.nodes.workflows.length,
    totalSteps: graph.nodes.steps.length,
    totalTriggers: graph.nodes.triggers.length,
    totalSchedules: graph.nodes.schedules.length,
    totalAssets: graph.nodes.assets.length,
    totalEventSources: graph.nodes.eventSources.length
  } satisfies WorkflowGraphStats;
}

export function normalizeWorkflowGraph(graph: WorkflowTopologyGraph): WorkflowGraphNormalized {
  const workflowsIndex = indexWorkflows(graph.nodes.workflows);
  const workflows = cloneAndSortWorkflows(graph.nodes.workflows);
  const steps = cloneAndSortSteps(graph.nodes.steps, workflowsIndex.byId);
  const triggers = cloneAndSortTriggers(graph.nodes.triggers, workflowsIndex.byId);
  const schedules = cloneAndSortSchedules(graph.nodes.schedules, workflowsIndex.byId);
  const assets = cloneAndSortAssets(graph.nodes.assets);
  const eventSources = cloneAndSortEventSources(graph.nodes.eventSources);

  const stepsIndex = indexSteps(steps);
  const triggersIndex = indexTriggers(triggers);
  const schedulesIndex = indexSchedules(schedules);
  const assetsIndex = indexAssets(assets);
  const eventSourcesIndex = indexEventSources(eventSources);

  const adjacency = buildAdjacency(graph);
  const stats = buildStats(graph);

  return {
    version: graph.version,
    generatedAt: graph.generatedAt,
    raw: graph,
    workflows,
    steps,
    triggers,
    schedules,
    assets,
    eventSources,
    workflowsIndex,
    stepsIndex,
    triggersIndex,
    schedulesIndex,
    assetsIndex,
    eventSourcesIndex,
    edges: graph.edges,
    adjacency,
    stats
  } satisfies WorkflowGraphNormalized;
}
