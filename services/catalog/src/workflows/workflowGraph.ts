import { listWorkflowDefinitions, listWorkflowAssetDeclarations } from '../db/workflows';
import {
  type WorkflowDefinitionRecord,
  type WorkflowStepDefinition,
  type WorkflowJobStepDefinition,
  type WorkflowServiceStepDefinition,
  type WorkflowFanOutStepDefinition,
  type WorkflowTriggerDefinition,
  type WorkflowScheduleRecord,
  type WorkflowEventTriggerRecord,
  type WorkflowEventTriggerPredicate,
  type WorkflowAssetDeclarationRecord,
  type WorkflowAssetAutoMaterialize,
  type WorkflowAssetFreshness,
  type WorkflowAssetPartitioning,
  type JsonValue as CatalogJsonValue
} from '../db/types';
import { applyDagMetadataToSteps } from './dag';
import {
  canonicalAssetId as canonicalizeAssetId,
  normalizeAssetId as normalizeAssetIdentifier
} from '../assets/identifiers';
import type {
  WorkflowTopologyGraph,
  WorkflowTopologyAnnotations,
  WorkflowTopologyWorkflowNode,
  WorkflowTopologyStepNode,
  WorkflowTopologyTriggerNode,
  WorkflowTopologyScheduleNode,
  WorkflowTopologyAssetNode,
  WorkflowTopologyEventSourceNode,
  WorkflowTopologyTriggerWorkflowEdge,
  WorkflowTopologyWorkflowStepEdge,
  WorkflowTopologyStepAssetEdge,
  WorkflowTopologyAssetWorkflowEdge,
  WorkflowTopologyEventSourceTriggerEdge,
  WorkflowTopologyJobStepRuntime,
  WorkflowTopologyServiceStepRuntime,
  WorkflowTopologyFanOutStepRuntime,
  WorkflowTopologyStepTemplate,
  WorkflowTopologyAssetAutoMaterialize,
  WorkflowTopologyAssetFreshness,
  WorkflowTopologyAssetPartitioning,
  WorkflowTopologyEventTriggerPredicate,
  JsonValue
} from '@apphub/shared/workflowTopology';

export type BuildWorkflowTopologyGraphOptions = {
  generatedAt?: string;
};

type AssetNodeAccumulator = Map<string, WorkflowTopologyAssetNode>;
type EventSourceAccumulator = Map<string, WorkflowTopologyEventSourceNode>;

type TriggerWorkflowEdges = WorkflowTopologyTriggerWorkflowEdge[];
type WorkflowStepEdges = WorkflowTopologyWorkflowStepEdge[];
type StepAssetEdges = WorkflowTopologyStepAssetEdge[];
type AssetWorkflowEdges = WorkflowTopologyAssetWorkflowEdge[];
type EventSourceTriggerEdges = WorkflowTopologyEventSourceTriggerEdge[];

export type WorkflowDefinitionsWithAssets = Array<{
  definition: WorkflowDefinitionRecord;
  assetDeclarations: WorkflowAssetDeclarationRecord[];
}>;

export async function buildWorkflowTopologyGraph(
  options: BuildWorkflowTopologyGraphOptions = {}
): Promise<WorkflowTopologyGraph> {
  const definitions = await listWorkflowDefinitions();
  const definitionsWithAssets = await attachAssetDeclarations(definitions);
  return assembleWorkflowTopologyGraph(definitionsWithAssets, options);
}

export function assembleWorkflowTopologyGraph(
  bundles: WorkflowDefinitionsWithAssets,
  options: BuildWorkflowTopologyGraphOptions = {}
): WorkflowTopologyGraph {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const workflows: WorkflowTopologyWorkflowNode[] = [];
  const steps: WorkflowTopologyStepNode[] = [];
  const triggers: WorkflowTopologyTriggerNode[] = [];
  const schedules: WorkflowTopologyScheduleNode[] = [];
  const assets: AssetNodeAccumulator = new Map();
  const eventSources: EventSourceAccumulator = new Map();

  const triggerToWorkflow: TriggerWorkflowEdges = [];
  const workflowToStep: WorkflowStepEdges = [];
  const stepToAsset: StepAssetEdges = [];
  const assetToWorkflow: AssetWorkflowEdges = [];
  const eventSourceToTrigger: EventSourceTriggerEdges = [];

  for (const { definition, assetDeclarations } of bundles) {
    workflows.push(buildWorkflowNode(definition));

    steps.push(
      ...buildStepNodes(definition.id, applyDagMetadataToSteps(definition.steps ?? [], definition.dag))
    );

    workflowToStep.push(...buildWorkflowStepEdges(definition.id, definition.dag));

    triggers.push(...buildDefinitionTriggerNodes(definition));
    triggerToWorkflow.push(...buildDefinitionTriggerEdges(definition));

    const scheduleNodes = buildScheduleNodes(definition);
    schedules.push(...scheduleNodes);
    triggerToWorkflow.push(...buildScheduleEdges(definition, scheduleNodes));

    const eventTriggerNodes = buildEventTriggerNodes(definition);
    triggers.push(...eventTriggerNodes);
    triggerToWorkflow.push(...buildEventTriggerEdges(definition));
    eventSourceToTrigger.push(
      ...buildEventSourceEdges(eventTriggerNodes, eventSources)
    );

    stepToAsset.push(
      ...buildStepAssetEdges(definition.id, assetDeclarations, assets)
    );
    assetToWorkflow.push(
      ...buildAssetWorkflowEdges(definition.id, assetDeclarations)
    );
  }

  return {
    version: 'v1',
    generatedAt,
    nodes: {
      workflows,
      steps,
      triggers,
      schedules,
      assets: Array.from(assets.values()),
      eventSources: Array.from(eventSources.values())
    },
    edges: {
      triggerToWorkflow,
      workflowToStep,
      stepToAsset,
      assetToWorkflow,
      eventSourceToTrigger
    }
  } satisfies WorkflowTopologyGraph;
}

async function attachAssetDeclarations(
  definitions: WorkflowDefinitionRecord[]
): Promise<WorkflowDefinitionsWithAssets> {
  return Promise.all(
    definitions.map(async (definition) => ({
      definition,
      assetDeclarations: await listWorkflowAssetDeclarations(definition.id)
    }))
  );
}

function buildWorkflowNode(definition: WorkflowDefinitionRecord): WorkflowTopologyWorkflowNode {
  const metadataRecord = toRecord(definition.metadata);
  return {
    id: definition.id,
    slug: definition.slug,
    name: definition.name,
    version: definition.version,
    description: definition.description ?? null,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    metadata: metadataRecord,
    annotations: extractAnnotations(metadataRecord)
  } satisfies WorkflowTopologyWorkflowNode;
}

function buildStepNodes(
  workflowId: string,
  steps: WorkflowStepDefinition[]
): WorkflowTopologyStepNode[] {
  return steps.map((step) => buildStepNode(workflowId, step));
}

function buildStepNode(
  workflowId: string,
  step: WorkflowStepDefinition
): WorkflowTopologyStepNode {
  if (step.type === 'job') {
    return buildJobStepNode(workflowId, step);
  }
  if (step.type === 'service') {
    return buildServiceStepNode(workflowId, step);
  }
  return buildFanOutStepNode(workflowId, step);
}

function buildJobStepNode(
  workflowId: string,
  step: WorkflowJobStepDefinition
): WorkflowTopologyStepNode {
  const runtime: WorkflowTopologyJobStepRuntime = {
    type: 'job',
    jobSlug: step.jobSlug,
    bundleStrategy: step.bundle?.strategy,
    bundleSlug: step.bundle?.slug ?? null,
    bundleVersion: step.bundle?.version ?? null,
    exportName: step.bundle?.exportName ?? null,
    timeoutMs: step.timeoutMs ?? null
  } satisfies WorkflowTopologyJobStepRuntime;

  return {
    id: step.id,
    workflowId,
    name: step.name ?? step.id,
    description: step.description ?? null,
    type: 'job',
    dependsOn: normalizeIdList(step.dependsOn),
    dependents: normalizeIdList(step.dependents),
    runtime
  } satisfies WorkflowTopologyStepNode;
}

function buildServiceStepNode(
  workflowId: string,
  step: WorkflowServiceStepDefinition
): WorkflowTopologyStepNode {
  const runtime: WorkflowTopologyServiceStepRuntime = {
    type: 'service',
    serviceSlug: step.serviceSlug,
    timeoutMs: step.timeoutMs ?? null,
    requireHealthy: step.requireHealthy ?? null,
    allowDegraded: step.allowDegraded ?? null,
    captureResponse: step.captureResponse ?? null
  } satisfies WorkflowTopologyServiceStepRuntime;

  return {
    id: step.id,
    workflowId,
    name: step.name ?? step.id,
    description: step.description ?? null,
    type: 'service',
    dependsOn: normalizeIdList(step.dependsOn),
    dependents: normalizeIdList(step.dependents),
    runtime
  } satisfies WorkflowTopologyStepNode;
}

function buildFanOutStepNode(
  workflowId: string,
  step: WorkflowFanOutStepDefinition
): WorkflowTopologyStepNode {
  const runtime: WorkflowTopologyFanOutStepRuntime = {
    type: 'fanout',
    collection:
      typeof step.collection === 'string'
        ? step.collection
        : (cloneJson(step.collection as unknown as JsonValue) ?? {}),
    maxItems: step.maxItems ?? null,
    maxConcurrency: step.maxConcurrency ?? null,
    storeResultsAs: step.storeResultsAs ?? null,
    template: buildStepTemplate(step.template)
  } satisfies WorkflowTopologyFanOutStepRuntime;

  return {
    id: step.id,
    workflowId,
    name: step.name ?? step.id,
    description: step.description ?? null,
    type: 'fanout',
    dependsOn: normalizeIdList(step.dependsOn),
    dependents: normalizeIdList(step.dependents),
    runtime
  } satisfies WorkflowTopologyStepNode;
}

function buildStepTemplate(step: WorkflowJobStepDefinition | WorkflowServiceStepDefinition): WorkflowTopologyStepTemplate {
  if (step.type === 'job') {
    return {
      id: step.id,
      name: step.name ?? step.id,
      runtime: {
        type: 'job',
        jobSlug: step.jobSlug,
        bundleStrategy: step.bundle?.strategy,
        bundleSlug: step.bundle?.slug ?? null,
        bundleVersion: step.bundle?.version ?? null,
        exportName: step.bundle?.exportName ?? null,
        timeoutMs: step.timeoutMs ?? null
      }
    } satisfies WorkflowTopologyStepTemplate;
  }

  return {
    id: step.id,
    name: step.name ?? step.id,
    runtime: {
      type: 'service',
      serviceSlug: step.serviceSlug,
      timeoutMs: step.timeoutMs ?? null,
      requireHealthy: step.requireHealthy ?? null,
      allowDegraded: step.allowDegraded ?? null,
      captureResponse: step.captureResponse ?? null
    }
  } satisfies WorkflowTopologyStepTemplate;
}

function buildWorkflowStepEdges(
  workflowId: string,
  dag: WorkflowDefinitionRecord['dag']
): WorkflowTopologyWorkflowStepEdge[] {
  const edges: WorkflowTopologyWorkflowStepEdge[] = [];
  const roots = dag.roots ?? [];
  for (const root of roots) {
    edges.push({ workflowId, fromStepId: null, toStepId: root });
  }
  const adjacency = dag.adjacency ?? {};
  for (const [from, dependents] of Object.entries(adjacency)) {
    for (const dependent of dependents ?? []) {
      edges.push({ workflowId, fromStepId: from, toStepId: dependent });
    }
  }
  return edges;
}

function buildDefinitionTriggerNodes(
  definition: WorkflowDefinitionRecord
): WorkflowTopologyTriggerNode[] {
  const nodes: WorkflowTopologyTriggerNode[] = [];
  const triggers = definition.triggers ?? [];
  for (let index = 0; index < triggers.length; index += 1) {
    const trigger = triggers[index] as WorkflowTriggerDefinition;
    nodes.push({
      id: buildDefinitionTriggerId(definition.id, index),
      workflowId: definition.id,
      kind: 'definition',
      triggerType: trigger.type,
      options: (trigger.options ?? null) as JsonValue,
      schedule: trigger.schedule
        ? {
            cron: trigger.schedule.cron,
            timezone: trigger.schedule.timezone ?? null,
            startWindow: trigger.schedule.startWindow ?? null,
            endWindow: trigger.schedule.endWindow ?? null,
            catchUp: trigger.schedule.catchUp ?? null
          }
        : null
    });
  }
  return nodes;
}

function buildDefinitionTriggerEdges(
  definition: WorkflowDefinitionRecord
): WorkflowTopologyTriggerWorkflowEdge[] {
  return (definition.triggers ?? []).map((_, index) => ({
    kind: 'definition-trigger',
    triggerId: buildDefinitionTriggerId(definition.id, index),
    workflowId: definition.id
  } satisfies WorkflowTopologyTriggerWorkflowEdge));
}

function buildScheduleNodes(
  definition: WorkflowDefinitionRecord
): WorkflowTopologyScheduleNode[] {
  return (definition.schedules ?? []).map((schedule) => ({
    id: schedule.id,
    workflowId: definition.id,
    name: schedule.name ?? null,
    description: schedule.description ?? null,
    cron: schedule.cron,
    timezone: schedule.timezone ?? null,
    parameters: (schedule.parameters ?? null) as JsonValue,
    startWindow: schedule.startWindow ?? null,
    endWindow: schedule.endWindow ?? null,
    catchUp: schedule.catchUp,
    nextRunAt: schedule.nextRunAt ?? null,
    isActive: schedule.isActive,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt
  } satisfies WorkflowTopologyScheduleNode));
}

function buildScheduleEdges(
  definition: WorkflowDefinitionRecord,
  schedules: WorkflowTopologyScheduleNode[]
): WorkflowTopologyTriggerWorkflowEdge[] {
  return schedules.map((schedule) => ({
    kind: 'schedule',
    scheduleId: schedule.id,
    workflowId: definition.id
  } satisfies WorkflowTopologyTriggerWorkflowEdge));
}

function buildEventTriggerNodes(
  definition: WorkflowDefinitionRecord
): WorkflowTopologyTriggerNode[] {
  return (definition.eventTriggers ?? []).map((trigger) => ({
    id: trigger.id,
    workflowId: trigger.workflowDefinitionId,
    kind: 'event',
    name: trigger.name ?? null,
    description: trigger.description ?? null,
    status: trigger.status,
    eventType: trigger.eventType,
    eventSource: trigger.eventSource ?? null,
    predicates: cloneEventTriggerPredicates(trigger.predicates),
    parameterTemplate: cloneJson(trigger.parameterTemplate as unknown as JsonValue | null | undefined),
    throttleWindowMs: trigger.throttleWindowMs ?? null,
    throttleCount: trigger.throttleCount ?? null,
    maxConcurrency: trigger.maxConcurrency ?? null,
    idempotencyKeyExpression: trigger.idempotencyKeyExpression ?? null,
    metadata: cloneJson(trigger.metadata as unknown as JsonValue | null | undefined),
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
    createdBy: trigger.createdBy ?? null,
    updatedBy: trigger.updatedBy ?? null
  } satisfies WorkflowTopologyTriggerNode));
}

function buildEventTriggerEdges(
  definition: WorkflowDefinitionRecord
): WorkflowTopologyTriggerWorkflowEdge[] {
  return (definition.eventTriggers ?? []).map((trigger) => ({
    kind: 'event-trigger',
    triggerId: trigger.id,
    workflowId: definition.id
  } satisfies WorkflowTopologyTriggerWorkflowEdge));
}

function buildEventSourceEdges(
  eventTriggers: WorkflowTopologyTriggerNode[],
  eventSources: EventSourceAccumulator
): WorkflowTopologyEventSourceTriggerEdge[] {
  const edges: WorkflowTopologyEventSourceTriggerEdge[] = [];
  for (const trigger of eventTriggers) {
    if (trigger.kind !== 'event') {
      continue;
    }
    const sourceId = buildEventSourceId(trigger.eventType, trigger.eventSource);
    if (!eventSources.has(sourceId)) {
      eventSources.set(sourceId, {
        id: sourceId,
        eventType: trigger.eventType,
        eventSource: trigger.eventSource
      });
    }
    edges.push({
      sourceId,
      triggerId: trigger.id
    });
  }
  return edges;
}

function buildStepAssetEdges(
  workflowId: string,
  declarations: WorkflowAssetDeclarationRecord[],
  assets: AssetNodeAccumulator
): WorkflowTopologyStepAssetEdge[] {
  const edges: WorkflowTopologyStepAssetEdge[] = [];
  for (const declaration of declarations) {
    const canonical = canonicalizeAssetId(declaration.assetId);
    if (!canonical) {
      continue;
    }
    const normalized = normalizeAssetIdentifier(canonical);
    if (!normalized) {
      continue;
    }
    ensureAssetNode(assets, canonical, normalized);
    edges.push({
      workflowId,
      stepId: declaration.stepId,
      assetId: canonical,
      normalizedAssetId: normalized,
      direction: declaration.direction,
      freshness: cloneAssetFreshness(declaration.freshness),
      partitioning: cloneAssetPartitioning(declaration.partitioning),
      autoMaterialize: cloneAutoMaterialize(declaration.autoMaterialize)
    });
  }
  return edges;
}

function buildAssetWorkflowEdges(
  workflowId: string,
  declarations: WorkflowAssetDeclarationRecord[]
): WorkflowTopologyAssetWorkflowEdge[] {
  const edges: WorkflowTopologyAssetWorkflowEdge[] = [];
  for (const declaration of declarations) {
    if (declaration.direction !== 'consumes') {
      continue;
    }
    const policy = declaration.autoMaterialize;
    if (!policy || !policy.onUpstreamUpdate) {
      continue;
    }
    const canonical = canonicalizeAssetId(declaration.assetId);
    if (!canonical) {
      continue;
    }
    const normalized = normalizeAssetIdentifier(canonical);
    if (!normalized) {
      continue;
    }
    edges.push({
      assetId: canonical,
      normalizedAssetId: normalized,
      workflowId,
      stepId: declaration.stepId,
      reason: 'auto-materialize',
      priority: policy.priority ?? null
    });
  }
  return edges;
}

function ensureAssetNode(
  assets: AssetNodeAccumulator,
  canonical: string,
  normalized: string
): WorkflowTopologyAssetNode {
  const existing = assets.get(normalized);
  if (existing) {
    return existing;
  }
  const node: WorkflowTopologyAssetNode = {
    id: normalized,
    assetId: canonical,
    normalizedAssetId: normalized,
    annotations: {
      tags: []
    }
  } satisfies WorkflowTopologyAssetNode;
  assets.set(normalized, node);
  return node;
}

function buildDefinitionTriggerId(workflowId: string, index: number): string {
  return `${workflowId}:definition-trigger:${index}`;
}

function buildEventSourceId(eventType: string, eventSource: string | null): string {
  const sourceKey = eventSource ?? 'default';
  return `event-source:${eventType}:${sourceKey}`;
}

function toRecord(value: CatalogJsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractAnnotations(metadata: Record<string, unknown> | null): WorkflowTopologyAnnotations {
  if (!metadata) {
    return { tags: [] } satisfies WorkflowTopologyAnnotations;
  }
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((value): value is string => typeof value === 'string')
    : [];

  const owner = metadata.owner;
  let ownerName: string | null = null;
  let ownerContact: string | null = null;
  if (owner && typeof owner === 'object' && !Array.isArray(owner)) {
    ownerName = typeof (owner as Record<string, unknown>).name === 'string'
      ? ((owner as Record<string, unknown>).name as string)
      : null;
    ownerContact = typeof (owner as Record<string, unknown>).contact === 'string'
      ? ((owner as Record<string, unknown>).contact as string)
      : null;
  }

  const annotations: WorkflowTopologyAnnotations = {
    tags,
    ownerName,
    ownerContact,
    team: typeof metadata.team === 'string' ? (metadata.team as string) : null,
    domain: typeof metadata.domain === 'string' ? (metadata.domain as string) : null,
    environment: typeof metadata.environment === 'string' ? (metadata.environment as string) : null,
    slo: typeof metadata.slo === 'string' ? (metadata.slo as string) : null
  } satisfies WorkflowTopologyAnnotations;

  return annotations;
}

function normalizeIdList(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  const normalized: string[] = [];
  for (const value of ids) {
    if (typeof value !== 'string' || normalized.includes(value)) {
      continue;
    }
    normalized.push(value);
  }
  return normalized;
}

function cloneAssetFreshness(
  freshness: WorkflowAssetFreshness | null | undefined
): WorkflowTopologyAssetFreshness | null {
  if (!freshness) {
    return null;
  }
  return {
    maxAgeMs: freshness.maxAgeMs ?? null,
    ttlMs: freshness.ttlMs ?? null,
    cadenceMs: freshness.cadenceMs ?? null
  } satisfies WorkflowTopologyAssetFreshness;
}

function cloneAssetPartitioning(
  partitioning: WorkflowAssetPartitioning | null | undefined
): WorkflowTopologyAssetPartitioning | null {
  if (!partitioning) {
    return null;
  }
  if (partitioning.type === 'timeWindow') {
    return {
      type: 'timeWindow',
      granularity: partitioning.granularity,
      timezone: partitioning.timezone ?? null,
      format: partitioning.format ?? null,
      lookbackWindows: partitioning.lookbackWindows ?? null
    } satisfies WorkflowTopologyAssetPartitioning;
  }
  if (partitioning.type === 'static') {
    return {
      type: 'static',
      keys: [...partitioning.keys]
    } satisfies WorkflowTopologyAssetPartitioning;
  }
  return {
    type: 'dynamic',
    maxKeys: partitioning.maxKeys ?? null,
    retentionDays: partitioning.retentionDays ?? null
  } satisfies WorkflowTopologyAssetPartitioning;
}

function cloneAutoMaterialize(
  autoMaterialize: WorkflowAssetAutoMaterialize | null | undefined
): WorkflowTopologyAssetAutoMaterialize | null {
  if (!autoMaterialize) {
    return null;
  }
  return {
    onUpstreamUpdate: autoMaterialize.onUpstreamUpdate ?? null,
    priority: autoMaterialize.priority ?? null,
    parameterDefaults: cloneJson(autoMaterialize.parameterDefaults as unknown as JsonValue)
  } satisfies WorkflowTopologyAssetAutoMaterialize;
}

function cloneJson(value: JsonValue | null | undefined): JsonValue | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function cloneEventTriggerPredicates(
  predicates: WorkflowEventTriggerPredicate[] | null | undefined
): WorkflowTopologyEventTriggerPredicate[] {
  if (!Array.isArray(predicates)) {
    return [];
  }
  return predicates.map((predicate) =>
    JSON.parse(JSON.stringify(predicate)) as WorkflowTopologyEventTriggerPredicate
  );
}
