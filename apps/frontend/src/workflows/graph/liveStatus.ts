import type { AssetExpiredEvent, AssetProducedEvent } from '../../core/types';
import type { WorkflowEventSchedulerHealth, WorkflowRun } from '../types';
import type {
  WorkflowGraphAssetStatus,
  WorkflowGraphLiveOverlay,
  WorkflowGraphStepStatus,
  WorkflowGraphStepStatusState,
  WorkflowGraphTriggerStatus,
  WorkflowGraphTriggerStatusState,
  WorkflowGraphWorkflowStatus,
  WorkflowGraphWorkflowStatusState
} from './types';

const ISO_EPOCH = new Date(0).toISOString();

export function createInitialOverlay(): WorkflowGraphLiveOverlay {
  return {
    workflows: {},
    steps: {},
    assets: {},
    triggers: {}
  };
}

function toMillis(value: string | null | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function newerThan(previousIso: string | null | undefined, candidateMs: number): boolean {
  if (!previousIso) {
    return true;
  }
  const previousMs = toMillis(previousIso);
  if (previousMs === null) {
    return true;
  }
  return candidateMs >= previousMs;
}

function mapRunStatus(status: string, health: WorkflowRun['health']): WorkflowGraphWorkflowStatusState {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'succeeded':
      return health === 'degraded' ? 'degraded' : 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

function mapStepStatus(status: string): WorkflowGraphStepStatusState {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    case 'succeeded':
      return 'succeeded';
    default:
      return 'unknown';
  }
}

function normalizeAssetIdentifier(assetId: string | null | undefined): string {
  if (typeof assetId !== 'string') {
    return '';
  }
  const trimmed = assetId.trim();
  return trimmed.toLowerCase();
}

function computeAssetExpiry(producedAt: string | null | undefined, freshness: AssetProducedEvent['freshness']): string | null {
  if (!freshness) {
    return null;
  }
  const producedMs = toMillis(producedAt);
  if (producedMs === null) {
    return null;
  }
  const values: number[] = [];
  if (typeof freshness.ttlMs === 'number' && freshness.ttlMs > 0) {
    values.push(producedMs + freshness.ttlMs);
  }
  if (typeof freshness.cadenceMs === 'number' && freshness.cadenceMs > 0) {
    values.push(producedMs + freshness.cadenceMs);
  }
  if (typeof freshness.maxAgeMs === 'number' && freshness.maxAgeMs > 0) {
    values.push(producedMs + freshness.maxAgeMs);
  }
  if (values.length === 0) {
    return null;
  }
  const min = Math.min(...values);
  return new Date(min).toISOString();
}

export function applyWorkflowRunOverlay(
  overlay: WorkflowGraphLiveOverlay,
  run: WorkflowRun,
  eventTimestampMs: number
): WorkflowGraphLiveOverlay {
  const baselineMs =
    toMillis(run.updatedAt) ?? toMillis(run.completedAt) ?? toMillis(run.startedAt) ?? eventTimestampMs;
  const timestampMs = Math.max(eventTimestampMs, baselineMs);
  const timestampIso = new Date(timestampMs).toISOString();

  let workflows = overlay.workflows;
  const existingWorkflow = workflows[run.workflowDefinitionId];
  if (newerThan(existingWorkflow?.updatedAt, timestampMs)) {
    const nextWorkflowStatus: WorkflowGraphWorkflowStatus = {
      state: mapRunStatus(run.status, run.health),
      runId: run.id,
      runKey: run.runKey ?? null,
      updatedAt: timestampIso,
      triggeredBy: run.triggeredBy,
      errorMessage: run.errorMessage ?? undefined
    };
    workflows = { ...workflows, [run.workflowDefinitionId]: nextWorkflowStatus };
  }

  let steps = overlay.steps;
  const currentStepId = run.currentStepId ?? undefined;
  if (currentStepId) {
    const existingStep = steps[currentStepId];
    if (newerThan(existingStep?.updatedAt, timestampMs)) {
      const nextStepStatus: WorkflowGraphStepStatus = {
        state: mapStepStatus(run.status),
        runId: run.id,
        runKey: run.runKey ?? null,
        updatedAt: timestampIso
      };
      steps = { ...steps, [currentStepId]: nextStepStatus };
    }
  }

  if (run.status === 'succeeded' || run.status === 'canceled') {
    let mutated = false;
    for (const [stepId, status] of Object.entries(steps)) {
      if (status.runId === run.id) {
        if (!mutated) {
          steps = { ...steps };
          mutated = true;
        }
        delete steps[stepId];
      }
    }
  }

  return workflows === overlay.workflows && steps === overlay.steps
    ? overlay
    : {
        workflows,
        steps,
        assets: overlay.assets,
        triggers: overlay.triggers
      };
}

export function applyAssetProducedOverlay(
  overlay: WorkflowGraphLiveOverlay,
  event: AssetProducedEvent,
  eventTimestampMs: number
): WorkflowGraphLiveOverlay {
  const assetKey = normalizeAssetIdentifier(event.assetId);
  if (!assetKey) {
    return overlay;
  }
  const producedMs = toMillis(event.producedAt) ?? eventTimestampMs;
  const timestampMs = Math.max(eventTimestampMs, producedMs);
  const timestampIso = new Date(timestampMs).toISOString();

  const existing = overlay.assets[assetKey];
  if (!newerThan(existing?.producedAt ?? existing?.expiresAt ?? undefined, timestampMs)) {
    return overlay;
  }

  const nextStatus: WorkflowGraphAssetStatus = {
    state: 'fresh',
    producedAt: event.producedAt ?? timestampIso,
    expiresAt: computeAssetExpiry(event.producedAt, event.freshness),
    partitionKey: event.partitionKey,
    workflowDefinitionId: event.workflowDefinitionId,
    workflowRunId: event.workflowRunId,
    reason: null
  };

  return {
    workflows: overlay.workflows,
    steps: overlay.steps,
    assets: {
      ...overlay.assets,
      [assetKey]: nextStatus
    },
    triggers: overlay.triggers
  };
}

export function applyAssetExpiredOverlay(
  overlay: WorkflowGraphLiveOverlay,
  event: AssetExpiredEvent,
  eventTimestampMs: number
): WorkflowGraphLiveOverlay {
  const assetKey = normalizeAssetIdentifier(event.assetId);
  if (!assetKey) {
    return overlay;
  }
  const expiresMs = toMillis(event.expiresAt) ?? eventTimestampMs;
  const timestampMs = Math.max(eventTimestampMs, expiresMs);
  const timestampIso = new Date(timestampMs).toISOString();

  const existing = overlay.assets[assetKey];
  if (!newerThan(existing?.expiresAt ?? existing?.producedAt ?? undefined, timestampMs)) {
    return overlay;
  }

  const nextStatus: WorkflowGraphAssetStatus = {
    state: 'stale',
    producedAt: event.producedAt ?? existing?.producedAt ?? null,
    expiresAt: event.expiresAt ?? timestampIso,
    partitionKey: event.partitionKey,
    workflowDefinitionId: event.workflowDefinitionId,
    workflowRunId: event.workflowRunId,
    reason: event.reason ?? 'stale'
  };

  return {
    workflows: overlay.workflows,
    steps: overlay.steps,
    assets: {
      ...overlay.assets,
      [assetKey]: nextStatus
    },
    triggers: overlay.triggers
  };
}

function mapTriggerStatus(
  triggerId: string,
  health: WorkflowEventSchedulerHealth,
  metrics: WorkflowEventSchedulerHealth['triggers'][string] | undefined
): WorkflowGraphTriggerStatus {
  const paused = health.pausedTriggers?.[triggerId];
  if (paused) {
    return {
      state: 'paused',
      updatedAt: health.generatedAt,
      reason: paused.reason
    } satisfies WorkflowGraphTriggerStatus;
  }
  const lastStatus = metrics?.lastStatus ?? null;
  const lastUpdated = metrics?.lastUpdatedAt ?? health.generatedAt ?? ISO_EPOCH;
  let state: WorkflowGraphTriggerStatusState = 'active';
  if (lastStatus === 'failed') {
    state = 'failing';
  } else if (lastStatus === 'throttled') {
    state = 'throttled';
  }
  return {
    state,
    updatedAt: lastUpdated ?? ISO_EPOCH,
    lastError: metrics?.lastError ?? undefined
  } satisfies WorkflowGraphTriggerStatus;
}

export function applyTriggerHealthOverlay(
  overlay: WorkflowGraphLiveOverlay,
  health: WorkflowEventSchedulerHealth | null
): WorkflowGraphLiveOverlay {
  if (!health) {
    return overlay;
  }

  let triggers = overlay.triggers;
  let mutated = false;

  const processed = new Set<string>();
  for (const [triggerId, metrics] of Object.entries(health.triggers)) {
    const status = mapTriggerStatus(triggerId, health, metrics);
    const existing = triggers[triggerId];
    const updatedMs = toMillis(status.updatedAt ?? health.generatedAt) ?? Date.now();
    if (newerThan(existing?.updatedAt, updatedMs)) {
      if (!mutated) {
        triggers = { ...triggers };
        mutated = true;
      }
      triggers[triggerId] = status;
    }
    processed.add(triggerId);
  }

  for (const triggerId of Object.keys(health.pausedTriggers ?? {})) {
    if (processed.has(triggerId)) {
      continue;
    }
    const status = mapTriggerStatus(triggerId, health, undefined);
    const existing = triggers[triggerId];
    const updatedMs = toMillis(status.updatedAt ?? health.generatedAt) ?? Date.now();
    if (newerThan(existing?.updatedAt, updatedMs)) {
      if (!mutated) {
        triggers = { ...triggers };
        mutated = true;
      }
      triggers[triggerId] = status;
    }
  }

  return mutated
    ? {
        workflows: overlay.workflows,
        steps: overlay.steps,
        assets: overlay.assets,
        triggers
      }
    : overlay;
}
