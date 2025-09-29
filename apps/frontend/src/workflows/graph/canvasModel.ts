import dagre from 'dagre';
import type {
  WorkflowTopologyAssetNode,
  WorkflowTopologyEventSourceNode,
  WorkflowTopologyScheduleNode,
  WorkflowTopologyStepEventSourceEdge,
  WorkflowTopologyStepNode,
  WorkflowTopologyTriggerNode,
  WorkflowTopologyWorkflowNode
} from '@apphub/shared/workflowTopology';
import type {
  WorkflowGraphAssetStatus,
  WorkflowGraphLiveOverlay,
  WorkflowGraphNormalized,
  WorkflowGraphStepStatus,
  WorkflowGraphTriggerStatus,
  WorkflowGraphWorkflowStatus
} from './types';

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
  | 'event-source'
  | 'step-event-source';

export type WorkflowGraphCanvasNode = {
  id: string;
  kind: WorkflowGraphCanvasNodeKind;
  label: string;
  subtitle?: string;
  meta?: string[];
  badges?: string[];
  status?: NodeStatusDescriptor;
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
  tooltip?: string;
  highlighted: boolean;
};

export type WorkflowGraphCanvasModel = {
  nodes: WorkflowGraphCanvasNode[];
  edges: WorkflowGraphCanvasEdge[];
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  filtersApplied: boolean;
  searchApplied: boolean;
};

export type WorkflowGraphCanvasSelection = {
  workflowId?: string | null;
  stepId?: string | null;
  triggerId?: string | null;
  assetNormalizedId?: string | null;
};

export type WorkflowGraphCanvasFilters = {
  workflowIds?: string[];
  assetNormalizedIds?: string[];
  eventTypes?: string[];
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

type NodeStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type NodeStatusDescriptor = {
  label: string;
  tone: NodeStatusTone;
  tooltip?: string;
};

function formatTimestampLabel(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function toWorkflowNodeStatus(status: WorkflowGraphWorkflowStatus | undefined): NodeStatusDescriptor | undefined {
  if (!status) {
    return undefined;
  }
  let label = 'Unknown';
  let tone: NodeStatusTone = 'neutral';
  switch (status.state) {
    case 'pending':
      label = 'Pending';
      tone = 'info';
      break;
    case 'running':
      label = 'Running';
      tone = 'info';
      break;
    case 'succeeded':
      label = 'Succeeded';
      tone = 'success';
      break;
    case 'degraded':
      label = 'Degraded';
      tone = 'warning';
      break;
    case 'failed':
      label = 'Failed';
      tone = 'danger';
      break;
    case 'canceled':
      label = 'Canceled';
      tone = 'neutral';
      break;
    case 'idle':
      label = 'Idle';
      tone = 'neutral';
      break;
    default:
      label = 'Unknown';
      tone = 'neutral';
  }
  const timestamp = formatTimestampLabel(status.updatedAt);
  const tooltip = status.errorMessage
    ? `${status.errorMessage}${timestamp ? ` • ${timestamp}` : ''}`
    : timestamp ?? undefined;
  return { label, tone, tooltip } satisfies NodeStatusDescriptor;
}

function toStepNodeStatus(status: WorkflowGraphStepStatus | undefined): NodeStatusDescriptor | undefined {
  if (!status) {
    return undefined;
  }
  let label = 'Unknown';
  let tone: NodeStatusTone = 'neutral';
  switch (status.state) {
    case 'pending':
      label = 'Pending';
      tone = 'info';
      break;
    case 'running':
      label = 'Running';
      tone = 'info';
      break;
    case 'succeeded':
      label = 'Succeeded';
      tone = 'success';
      break;
    case 'failed':
      label = 'Failed';
      tone = 'danger';
      break;
    default:
      label = 'Unknown';
      tone = 'neutral';
  }
  const tooltip = formatTimestampLabel(status.updatedAt);
  return { label, tone, tooltip } satisfies NodeStatusDescriptor;
}

function toAssetNodeStatus(status: WorkflowGraphAssetStatus | undefined): NodeStatusDescriptor | undefined {
  if (!status) {
    return undefined;
  }
  let label = 'Unknown';
  let tone: NodeStatusTone = 'neutral';
  switch (status.state) {
    case 'fresh':
      label = 'Fresh';
      tone = 'success';
      break;
    case 'stale':
      label = 'Stale';
      tone = 'warning';
      break;
    default:
      label = 'Unknown';
      tone = 'neutral';
  }
  const expiresLabel = formatTimestampLabel(status.expiresAt);
  const producedLabel = formatTimestampLabel(status.producedAt);
  const tooltipParts: string[] = [];
  if (producedLabel) {
    tooltipParts.push(`Produced • ${producedLabel}`);
  }
  if (expiresLabel) {
    tooltipParts.push(`Expires • ${expiresLabel}`);
  }
  if (status.reason) {
    tooltipParts.push(status.reason);
  }
  const tooltip = tooltipParts.length > 0 ? tooltipParts.join('\n') : undefined;
  return { label, tone, tooltip } satisfies NodeStatusDescriptor;
}

function toTriggerNodeStatus(status: WorkflowGraphTriggerStatus | undefined): NodeStatusDescriptor | undefined {
  if (!status) {
    return undefined;
  }
  let label = 'Active';
  let tone: NodeStatusTone = 'success';
  switch (status.state) {
    case 'paused':
      label = 'Paused';
      tone = 'warning';
      break;
    case 'failing':
      label = 'Failing';
      tone = 'danger';
      break;
    case 'throttled':
      label = 'Throttled';
      tone = 'warning';
      break;
    case 'disabled':
      label = 'Disabled';
      tone = 'neutral';
      break;
    case 'active':
      label = 'Active';
      tone = 'success';
      break;
    default:
      label = 'Unknown';
      tone = 'neutral';
  }
  const tooltipParts: string[] = [];
  const updatedLabel = formatTimestampLabel(status.updatedAt);
  if (status.reason) {
    tooltipParts.push(status.reason);
  }
  if (status.lastError) {
    tooltipParts.push(status.lastError);
  }
  if (updatedLabel) {
    tooltipParts.push(`Updated • ${updatedLabel}`);
  }
  const tooltip = tooltipParts.length > 0 ? tooltipParts.join('\n') : undefined;
  return { label, tone, tooltip } satisfies NodeStatusDescriptor;
}

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

  const highlightEventSource = (sourceId: string | null | undefined): void => {
    if (!sourceId) {
      return;
    }
    const source = graph.eventSourcesIndex.byId[sourceId];
    if (source) {
      highlighted.add(toEventSourceNodeId(source));
    }
    const triggerLinks = graph.adjacency.eventSourceTriggerEdges[sourceId] ?? [];
    for (const link of triggerLinks) {
      const trigger = graph.triggersIndex.byId[link.triggerId];
      if (trigger) {
        highlighted.add(toTriggerNodeId(trigger));
      }
    }
  };

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

      const inferredSources = graph.adjacency.stepEventSourceEdges[step.id] ?? [];
      for (const link of inferredSources) {
        highlightEventSource(link.sourceId);
      }
    }

    const workflowTriggers = graph.triggers.filter((trigger) => trigger.workflowId === selection.workflowId);
    for (const trigger of workflowTriggers) {
      highlighted.add(toTriggerNodeId(trigger));
      const linkedSources = graph.adjacency.triggerEventSourceEdges[trigger.id] ?? [];
      for (const edge of linkedSources) {
        highlightEventSource(edge.sourceId);
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
    const inferredSources = graph.adjacency.stepEventSourceEdges[selection.stepId] ?? [];
    for (const link of inferredSources) {
      highlightEventSource(link.sourceId);
    }
  }

  if (selection.triggerId) {
    const trigger = graph.triggersIndex.byId[selection.triggerId];
    if (trigger) {
      highlighted.add(toTriggerNodeId(trigger));
      const linkedSources = graph.adjacency.triggerEventSourceEdges[trigger.id] ?? [];
      for (const edge of linkedSources) {
        highlightEventSource(edge.sourceId);
      }
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
  highlighted: Set<string>,
  overlay?: WorkflowGraphLiveOverlay | null
): WorkflowGraphCanvasNode[] {
  return workflows.map((workflow) => {
    const id = toWorkflowNodeId(workflow.id);
    const statusDescriptor = overlay ? toWorkflowNodeStatus(overlay.workflows[workflow.id]) : undefined;
    const meta: string[] = [`Version ${workflow.version}`];
    const overlayStatus = overlay?.workflows[workflow.id];
    if (overlayStatus?.runKey) {
      meta.push(`Run Key · ${overlayStatus.runKey}`);
    }
    if (overlayStatus?.runId) {
      meta.push(`Run ID · ${overlayStatus.runId}`);
    }
    const updatedLabel = overlayStatus ? formatTimestampLabel(overlayStatus.updatedAt) : undefined;
    if (updatedLabel) {
      meta.push(`Updated ${updatedLabel}`);
    }
    if (overlayStatus?.triggeredBy) {
      meta.push(`Triggered by · ${overlayStatus.triggeredBy}`);
    }
    return {
      id,
      refId: workflow.id,
      kind: 'workflow',
      label: workflow.name,
      subtitle: workflow.slug,
      meta,
      status: statusDescriptor,
      width: NODE_DIMENSIONS.workflow.width,
      height: NODE_DIMENSIONS.workflow.height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildStepNodes(
  steps: WorkflowTopologyStepNode[],
  highlighted: Set<string>,
  overlay?: WorkflowGraphLiveOverlay | null
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
    const overlayStatus = overlay?.steps[step.id];
    if (overlayStatus?.runKey) {
      meta.push(`Run Key · ${overlayStatus.runKey}`);
    }
    if (overlayStatus?.runId) {
      meta.push(`Run ID · ${overlayStatus.runId}`);
    }
    const statusDescriptor = overlay ? toStepNodeStatus(overlayStatus) : undefined;
    const updatedLabel = overlayStatus ? formatTimestampLabel(overlayStatus.updatedAt) : undefined;
    if (updatedLabel) {
      meta.push(`Updated ${updatedLabel}`);
    }
    return {
      id,
      refId: step.id,
      kind,
      label: step.name,
      subtitle: step.type ?? step.runtime.type,
      badges,
      meta,
      status: statusDescriptor,
      width: NODE_DIMENSIONS[kind].width,
      height: NODE_DIMENSIONS[kind].height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildTriggerNodes(
  triggers: WorkflowTopologyTriggerNode[],
  highlighted: Set<string>,
  overlay?: WorkflowGraphLiveOverlay | null
): WorkflowGraphCanvasNode[] {
  return triggers.map((trigger) => {
    const id = toTriggerNodeId(trigger);
    const kind: WorkflowGraphCanvasNodeKind = isEventTrigger(trigger)
      ? 'trigger-event'
      : 'trigger-definition';
    const subtitle = formatTriggerSubtitle(trigger);
    const meta: string[] = [];
    const badges: string[] = [];
    if (isEventTrigger(trigger)) {
      badges.push(trigger.status === 'active' ? 'Active' : 'Disabled');
      if (trigger.eventSource) {
        badges.push(trigger.eventSource);
      } else {
        badges.push('Event');
      }
      if (trigger.maxConcurrency) {
        meta.push(`Concurrency · ${trigger.maxConcurrency}`);
      }
      if (trigger.throttleWindowMs && trigger.throttleCount) {
        meta.push(`Throttle · ${trigger.throttleCount}/${trigger.throttleWindowMs}ms`);
      }
    } else {
      badges.push(trigger.triggerType);
      if (trigger.schedule?.timezone) {
        badges.push(trigger.schedule.timezone);
      }
      if (trigger.schedule) {
        meta.push(`Schedule · ${trigger.schedule.cron}`);
      }
    }
    const label = isEventTrigger(trigger) ? trigger.name ?? trigger.id : trigger.triggerType;
    const overlayStatus = overlay?.triggers[trigger.id];
    const statusDescriptor = overlay ? toTriggerNodeStatus(overlayStatus) : undefined;
    const updatedLabel = overlayStatus ? formatTimestampLabel(overlayStatus.updatedAt) : undefined;
    if (updatedLabel) {
      meta.push(`Updated ${updatedLabel}`);
    }
    return {
      id,
      refId: trigger.id,
      kind,
      label,
      subtitle,
      badges: badges.slice(0, 2),
      meta,
      status: statusDescriptor,
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
    const badges: string[] = [schedule.isActive ? 'Active' : 'Paused'];
    if (schedule.catchUp) {
      badges.push('Catch-up');
    }
    return {
      id,
      refId: schedule.id,
      kind: 'schedule',
      label: schedule.name ?? schedule.id,
      subtitle,
      meta: [schedule.isActive ? 'Active' : 'Paused'],
      badges: badges.slice(0, 2),
      width: NODE_DIMENSIONS.schedule.width,
      height: NODE_DIMENSIONS.schedule.height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildAssetNodes(
  assets: WorkflowTopologyAssetNode[],
  highlighted: Set<string>,
  overlay?: WorkflowGraphLiveOverlay | null
): WorkflowGraphCanvasNode[] {
  return assets.map((asset) => {
    const id = toAssetNodeId(asset);
    const tags = asset.annotations?.tags ?? [];
    const overlayStatus = overlay?.assets[asset.normalizedAssetId];
    const statusDescriptor = overlay ? toAssetNodeStatus(overlayStatus) : undefined;
    const meta = tags.slice(2);
    if (overlayStatus?.partitionKey) {
      meta.push(`Partition · ${overlayStatus.partitionKey}`);
    }
    const producedLabel = overlayStatus ? formatTimestampLabel(overlayStatus.producedAt) : undefined;
    if (producedLabel) {
      meta.push(`Produced ${producedLabel}`);
    }
    return {
      id,
      refId: asset.normalizedAssetId,
      kind: 'asset',
      label: asset.assetId,
      subtitle: asset.normalizedAssetId,
      badges: tags.slice(0, 2),
      meta,
      status: statusDescriptor,
      width: NODE_DIMENSIONS.asset.width,
      height: NODE_DIMENSIONS.asset.height,
      position: { x: 0, y: 0 },
      highlighted: highlighted.has(id)
    } satisfies WorkflowGraphCanvasNode;
  });
}

function buildEventSourceNodes(
  graph: WorkflowGraphNormalized,
  highlighted: Set<string>
): WorkflowGraphCanvasNode[] {
  return graph.eventSources.map((source) => {
    const id = toEventSourceNodeId(source);
    const subtitle = source.eventType;
    const producers = graph.adjacency.eventSourceStepEdges[source.id] ?? [];
    let totalSamples = 0;
    let latestSeenIso: string | null = null;
    let latestSeenTimestamp = Number.NEGATIVE_INFINITY;
    for (const edge of producers) {
      totalSamples += edge.confidence.sampleCount;
      const candidateTimestamp = Date.parse(edge.confidence.lastSeenAt);
      if (!Number.isNaN(candidateTimestamp) && candidateTimestamp > latestSeenTimestamp) {
        latestSeenTimestamp = candidateTimestamp;
        latestSeenIso = edge.confidence.lastSeenAt;
      }
    }
    const meta: string[] = [];
    if (producers.length > 0) {
      meta.push(`Observed from ${producers.length} ${producers.length === 1 ? 'step' : 'steps'}`);
    }
    if (totalSamples > 0) {
      meta.push(`Samples · ${totalSamples.toLocaleString()}`);
    }
    const lastSeenLabel = formatTimestampLabel(latestSeenIso);
    if (lastSeenLabel) {
      meta.push(`Last seen ${lastSeenLabel}`);
    }
    return {
      id,
      refId: source.id,
      kind: 'event-source',
      label: source.eventSource ?? source.id,
      subtitle,
      meta,
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

function buildStepEventSourceEdgeId(stepNodeId: string, sourceNodeId: string): string {
  return `edge:step-event-source:${stepNodeId}->${sourceNodeId}`;
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

function buildStepEventSourceTooltip(
  edge: WorkflowTopologyStepEventSourceEdge,
  source: WorkflowTopologyEventSourceNode
): string {
  const parts: string[] = [];
  parts.push(`Event ${source.eventType}`);
  if (source.eventSource) {
    parts.push(`Source ${source.eventSource}`);
  }
  const samplesLabel = edge.confidence.sampleCount === 1 ? 'sample' : 'samples';
  parts.push(`Observed ${edge.confidence.sampleCount.toLocaleString()} ${samplesLabel}`);
  const lastSeen = formatTimestampLabel(edge.confidence.lastSeenAt);
  if (lastSeen) {
    parts.push(`Last seen ${lastSeen}`);
  }
  return parts.join(' • ');
}

function buildStepEventSourceEdges(
  graph: WorkflowGraphNormalized,
  highlightedNodes: Set<string>
): WorkflowGraphCanvasEdge[] {
  const edges: WorkflowGraphCanvasEdge[] = [];
  for (const edge of graph.edges.stepToEventSource) {
    const stepNodeId = resolveStepNodeId(graph, edge.stepId);
    const source = graph.eventSourcesIndex.byId[edge.sourceId];
    if (!stepNodeId || !source) {
      continue;
    }
    const sourceNodeId = toEventSourceNodeId(source);
    const id = buildStepEventSourceEdgeId(stepNodeId, sourceNodeId);
    edges.push({
      id,
      kind: 'step-event-source',
      source: stepNodeId,
      target: sourceNodeId,
      label: 'observed',
      tooltip: buildStepEventSourceTooltip(edge, source),
      highlighted: highlightedNodes.has(stepNodeId) && highlightedNodes.has(sourceNodeId)
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

function normalizeSearchTerm(term?: string | null): string | null {
  if (!term) {
    return null;
  }
  const normalized = term.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function nodeMatchesSearch(node: WorkflowGraphCanvasNode, searchTerm: string): boolean {
  if (!searchTerm) {
    return false;
  }
  const candidates: string[] = [node.label];
  if (node.subtitle) {
    candidates.push(node.subtitle);
  }
  if (Array.isArray(node.meta)) {
    candidates.push(...node.meta);
  }
  if (Array.isArray(node.badges)) {
    candidates.push(...node.badges);
  }
  return candidates.some((entry) => entry && entry.toLowerCase().includes(searchTerm));
}

function buildNeighborMap(edges: WorkflowGraphCanvasEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!map.has(edge.source)) {
      map.set(edge.source, new Set());
    }
    map.get(edge.source)?.add(edge.target);
    if (!map.has(edge.target)) {
      map.set(edge.target, new Set());
    }
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}

function createContextCollector(
  graph: WorkflowGraphNormalized,
  register: (nodeId: string) => void
) {
  const visitedWorkflows = new Set<string>();
  const visitedSteps = new Set<string>();
  const visitedTriggers = new Set<string>();
  const visitedSchedules = new Set<string>();
  const visitedAssets = new Set<string>();
  const visitedEventSources = new Set<string>();
  const visitedEventTypes = new Set<string>();

  const addWorkflowContext = (workflowId: string | null | undefined): void => {
    if (!workflowId || visitedWorkflows.has(workflowId)) {
      return;
    }
    visitedWorkflows.add(workflowId);
    const workflow = graph.workflowsIndex.byId[workflowId];
    if (!workflow) {
      return;
    }
    register(toWorkflowNodeId(workflow.id));

    const steps = graph.stepsIndex.byWorkflowId[workflowId] ?? [];
    for (const step of steps) {
      addStepContext(step.id);
    }

    const triggers = graph.triggersIndex.byWorkflowId[workflowId] ?? [];
    for (const trigger of triggers) {
      addTriggerContext(trigger.id);
    }

    const schedules = graph.schedulesIndex.byWorkflowId[workflowId] ?? [];
    for (const schedule of schedules) {
      addScheduleContext(schedule.id);
    }

    const autoMaterialize = graph.adjacency.workflowAutoMaterializeSources[workflowId] ?? [];
    for (const edge of autoMaterialize) {
      addAssetContext(edge.normalizedAssetId);
      if (edge.stepId) {
        addStepContext(edge.stepId);
      }
    }
  };

  const addStepContext = (stepId: string | null | undefined): void => {
    if (!stepId || visitedSteps.has(stepId)) {
      return;
    }
    visitedSteps.add(stepId);
    const step = graph.stepsIndex.byId[stepId];
    if (!step) {
      return;
    }
    register(toStepNodeId(step));
    addWorkflowContext(step.workflowId);

    const produces = graph.adjacency.stepProduces[stepId] ?? [];
    for (const edge of produces) {
      addAssetContext(edge.normalizedAssetId);
    }

    const consumes = graph.adjacency.stepConsumes[stepId] ?? [];
    for (const edge of consumes) {
      addAssetContext(edge.normalizedAssetId);
    }

    const inferredSources = graph.adjacency.stepEventSourceEdges[stepId] ?? [];
    for (const edge of inferredSources) {
      addEventSourceContext(edge.sourceId);
    }
  };

  const addTriggerContext = (triggerId: string | null | undefined): void => {
    if (!triggerId || visitedTriggers.has(triggerId)) {
      return;
    }
    visitedTriggers.add(triggerId);
    const trigger = graph.triggersIndex.byId[triggerId];
    if (!trigger) {
      return;
    }
    register(toTriggerNodeId(trigger));
    addWorkflowContext(trigger.workflowId);

    const eventSources = graph.adjacency.triggerEventSourceEdges[triggerId] ?? [];
    for (const link of eventSources) {
      addEventSourceContext(link.sourceId);
    }
  };

  const addScheduleContext = (scheduleId: string | null | undefined): void => {
    if (!scheduleId || visitedSchedules.has(scheduleId)) {
      return;
    }
    visitedSchedules.add(scheduleId);
    const schedule = graph.schedulesIndex.byId[scheduleId];
    if (!schedule) {
      return;
    }
    register(toScheduleNodeId(schedule));
    addWorkflowContext(schedule.workflowId);
  };

  const addAssetContext = (assetNormalizedId: string | null | undefined): void => {
    if (!assetNormalizedId || visitedAssets.has(assetNormalizedId)) {
      return;
    }
    visitedAssets.add(assetNormalizedId);
    const asset = graph.assetsIndex.byNormalizedId[assetNormalizedId];
    if (!asset) {
      return;
    }
    register(toAssetNodeId(asset));

    const producers = graph.adjacency.assetProducers[assetNormalizedId] ?? [];
    for (const edge of producers) {
      addStepContext(edge.stepId);
      addWorkflowContext(edge.workflowId);
    }

    const consumers = graph.adjacency.assetConsumers[assetNormalizedId] ?? [];
    for (const edge of consumers) {
      addStepContext(edge.stepId);
      addWorkflowContext(edge.workflowId);
    }

    const autoTargets = graph.adjacency.assetAutoMaterializeTargets[assetNormalizedId] ?? [];
    for (const edge of autoTargets) {
      addWorkflowContext(edge.workflowId);
      if (edge.stepId) {
        addStepContext(edge.stepId);
      }
    }
  };

  const addEventSourceContext = (sourceId: string | null | undefined): void => {
    if (!sourceId || visitedEventSources.has(sourceId)) {
      return;
    }
    visitedEventSources.add(sourceId);
    const source = graph.eventSourcesIndex.byId[sourceId];
    if (!source) {
      return;
    }
    register(toEventSourceNodeId(source));

    const triggers = graph.adjacency.eventSourceTriggerEdges[sourceId] ?? [];
    for (const edge of triggers) {
      addTriggerContext(edge.triggerId);
    }

    const producingSteps = graph.adjacency.eventSourceStepEdges[sourceId] ?? [];
    for (const edge of producingSteps) {
      addStepContext(edge.stepId);
    }
  };

  const addEventTypeContext = (eventType: string | null | undefined): void => {
    if (!eventType) {
      return;
    }
    const normalized = eventType.trim();
    if (!normalized || visitedEventTypes.has(normalized)) {
      return;
    }
    visitedEventTypes.add(normalized);

    for (const trigger of graph.triggers) {
      if (trigger.kind === 'event' && trigger.eventType === normalized) {
        addTriggerContext(trigger.id);
      }
    }

    for (const source of graph.eventSources) {
      if (source.eventType === normalized) {
        addEventSourceContext(source.id);
      }
    }
  };

  const includeNodeContext = (node: WorkflowGraphCanvasNode): void => {
    switch (node.kind) {
      case 'workflow':
        addWorkflowContext(node.refId);
        break;
      case 'step-job':
      case 'step-service':
      case 'step-fanout':
        addStepContext(node.refId);
        break;
      case 'trigger-event':
      case 'trigger-definition':
        addTriggerContext(node.refId);
        break;
      case 'schedule':
        addScheduleContext(node.refId);
        break;
      case 'asset':
        addAssetContext(node.refId);
        break;
      case 'event-source':
        addEventSourceContext(node.refId);
        break;
      default:
        break;
    }
  };

  return {
    addWorkflowContext,
    addAssetContext,
    addEventTypeContext,
    addTriggerContext,
    addScheduleContext,
    addEventSourceContext,
    includeNodeContext
  };
}

function computeVisibleNodeIds(
  graph: WorkflowGraphNormalized,
  nodes: WorkflowGraphCanvasNode[],
  edges: WorkflowGraphCanvasEdge[],
  filters: WorkflowGraphCanvasFilters | undefined,
  searchTerm: string | null
): {
  visibleNodeIds: Set<string>;
  filtersActive: boolean;
  searchActive: boolean;
} {
  const filtersActive = Boolean(
    (filters?.workflowIds?.length ?? 0) > 0 ||
      (filters?.assetNormalizedIds?.length ?? 0) > 0 ||
      (filters?.eventTypes?.length ?? 0) > 0
  );
  const searchActive = searchTerm !== null;

  if (!filtersActive && !searchActive) {
    return {
      visibleNodeIds: new Set(nodes.map((node) => node.id)),
      filtersActive,
      searchActive
    };
  }

  const anchors = new Set<string>();
  const collector = createContextCollector(graph, (nodeId) => {
    if (nodeId) {
      anchors.add(nodeId);
    }
  });

  if (filtersActive && filters) {
    for (const workflowId of filters.workflowIds ?? []) {
      if (typeof workflowId === 'string' && workflowId.trim().length > 0) {
        collector.addWorkflowContext(workflowId.trim());
      }
    }
    for (const assetId of filters.assetNormalizedIds ?? []) {
      if (typeof assetId === 'string' && assetId.trim().length > 0) {
        collector.addAssetContext(assetId.trim());
      }
    }
    for (const eventType of filters.eventTypes ?? []) {
      if (typeof eventType === 'string' && eventType.trim().length > 0) {
        collector.addEventTypeContext(eventType.trim());
      }
    }
  }

  if (searchActive && searchTerm) {
    for (const node of nodes) {
      if (nodeMatchesSearch(node, searchTerm)) {
        collector.includeNodeContext(node);
      }
    }
  }

  if (anchors.size === 0) {
    return {
      visibleNodeIds: new Set<string>(),
      filtersActive,
      searchActive
    };
  }

  const neighborMap = buildNeighborMap(edges);
  const visible = new Set<string>(anchors);
  for (const nodeId of Array.from(anchors)) {
    const neighbors = neighborMap.get(nodeId);
    if (!neighbors) {
      continue;
    }
    for (const neighbor of neighbors) {
      visible.add(neighbor);
    }
  }

  return {
    visibleNodeIds: visible,
    filtersActive,
    searchActive
  };
}

export function buildWorkflowGraphCanvasModel(
  graph: WorkflowGraphNormalized,
  options: {
    layout?: Partial<WorkflowGraphCanvasLayoutConfig>;
    selection?: WorkflowGraphCanvasSelection;
    filters?: WorkflowGraphCanvasFilters;
    searchTerm?: string | null;
    overlay?: WorkflowGraphLiveOverlay | null;
  } = {}
): WorkflowGraphCanvasModel {
  const { layout, selection, filters, searchTerm: searchTermRaw, overlay } = options;

  const layoutConfig: WorkflowGraphCanvasLayoutConfig = {
    ...DEFAULT_LAYOUT,
    ...(layout ?? {})
  };

  const highlightedNodes = collectHighlightedNodeIds(graph, selection);

  const workflowNodes = buildWorkflowNodes(graph.workflows, highlightedNodes, overlay);
  const stepNodes = buildStepNodes(graph.steps, highlightedNodes, overlay);
  const triggerNodes = buildTriggerNodes(graph.triggers, highlightedNodes, overlay);
  const scheduleNodes = buildScheduleNodes(graph.schedules, highlightedNodes);
  const assetNodes = buildAssetNodes(graph.assets, highlightedNodes, overlay);
  const eventSourceNodes = buildEventSourceNodes(graph, highlightedNodes);

  let nodes = [
    ...workflowNodes,
    ...stepNodes,
    ...triggerNodes,
    ...scheduleNodes,
    ...assetNodes,
    ...eventSourceNodes
  ];

  let edges = [
    ...buildWorkflowAndStepEdges(graph, highlightedNodes),
    ...buildTriggerEdges(graph, highlightedNodes),
    ...buildStepAssetEdges(graph, highlightedNodes),
    ...buildAssetWorkflowEdges(graph, highlightedNodes),
    ...buildEventSourceEdges(graph, highlightedNodes),
    ...buildStepEventSourceEdges(graph, highlightedNodes)
  ];

  const searchTerm = normalizeSearchTerm(searchTermRaw ?? null);
  const { visibleNodeIds, filtersActive, searchActive } = computeVisibleNodeIds(
    graph,
    nodes,
    edges,
    filters,
    searchTerm
  );

  if ((filtersActive || searchActive) && visibleNodeIds.size === 0) {
    nodes = [];
    edges = [];
  } else if (filtersActive || searchActive) {
    nodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    edges = edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }

  const layoutNodes = nodes.length > 0 ? applyLayout(nodes, edges, layoutConfig) : [];

  const visibleHighlightedNodeIds = new Set<string>(
    Array.from(highlightedNodes).filter((id) => visibleNodeIds.has(id))
  );

  const highlightedEdgeIds = new Set<string>(
    edges.filter((edge) => edge.highlighted).map((edge) => edge.id)
  );

  return {
    nodes: layoutNodes,
    edges,
    highlightedNodeIds: visibleHighlightedNodeIds,
    highlightedEdgeIds,
    filtersApplied: filtersActive,
    searchApplied: searchActive
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
