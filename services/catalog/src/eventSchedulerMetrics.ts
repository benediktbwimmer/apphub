import type { EventEnvelope } from '@apphub/event-bus';
import type { WorkflowEventTriggerRecord } from './db/types';

type SourceMetricRecord = {
  total: number;
  throttled: number;
  dropped: number;
  failures: number;
  totalLagMs: number;
  lastLagMs: number;
  maxLagMs: number;
  lastEventAt: string | null;
};

type TriggerMetricRecord = {
  workflowDefinitionId: string;
  counts: Record<TriggerMetricStatus, number>;
  lastStatus: TriggerMetricStatus | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
};

type TriggerMetricStatus =
  | 'filtered'
  | 'matched'
  | 'launched'
  | 'throttled'
  | 'skipped'
  | 'failed'
  | 'paused';

const sourceMetrics = new Map<string, SourceMetricRecord>();
const triggerMetrics = new Map<string, TriggerMetricRecord>();

function getSourceMetrics(source: string): SourceMetricRecord {
  let entry = sourceMetrics.get(source);
  if (!entry) {
    entry = {
      total: 0,
      throttled: 0,
      dropped: 0,
      failures: 0,
      totalLagMs: 0,
      lastLagMs: 0,
      maxLagMs: 0,
      lastEventAt: null
    } satisfies SourceMetricRecord;
    sourceMetrics.set(source, entry);
  }
  return entry;
}

function getTriggerMetrics(trigger: WorkflowEventTriggerRecord): TriggerMetricRecord {
  let entry = triggerMetrics.get(trigger.id);
  if (!entry) {
    entry = {
      workflowDefinitionId: trigger.workflowDefinitionId,
      counts: {
        filtered: 0,
        matched: 0,
        launched: 0,
        throttled: 0,
        skipped: 0,
        failed: 0,
        paused: 0
      },
      lastStatus: null,
      lastUpdatedAt: null,
      lastError: null
    } satisfies TriggerMetricRecord;
    triggerMetrics.set(trigger.id, entry);
  }
  return entry;
}

export function recordEventIngress(
  envelope: EventEnvelope,
  options: {
    throttled?: boolean;
    dropped?: boolean;
  } = {}
): void {
  const source = envelope.source ?? 'unknown';
  const record = getSourceMetrics(source);
  record.total += 1;

  const occurredAt = Date.parse(envelope.occurredAt);
  if (!Number.isNaN(occurredAt)) {
    const lagMs = Math.max(0, Date.now() - occurredAt);
    record.totalLagMs += lagMs;
    record.lastLagMs = lagMs;
    record.maxLagMs = Math.max(record.maxLagMs, lagMs);
  } else {
    record.lastLagMs = 0;
  }

  if (options.throttled) {
    record.throttled += 1;
  }
  if (options.dropped) {
    record.dropped += 1;
  }

  record.lastEventAt = new Date().toISOString();
}

export function recordEventIngressFailure(source: string): void {
  const record = getSourceMetrics(source ?? 'unknown');
  record.failures += 1;
  record.lastEventAt = new Date().toISOString();
}

export function recordTriggerEvaluation(
  trigger: WorkflowEventTriggerRecord,
  status: TriggerMetricStatus,
  options: { error?: string } = {}
): void {
  const record = getTriggerMetrics(trigger);
  record.counts[status] += 1;
  record.lastStatus = status;
  record.lastUpdatedAt = new Date().toISOString();
  if (options.error) {
    record.lastError = options.error;
  } else if (status === 'failed') {
    record.lastError = 'unknown error';
  } else if (status === 'launched') {
    record.lastError = null;
  }
}

export function getEventSchedulerMetricsSnapshot(): {
  generatedAt: string;
  sources: Array<{
    source: string;
    total: number;
    throttled: number;
    dropped: number;
    failures: number;
    averageLagMs: number | null;
    lastLagMs: number;
    maxLagMs: number;
    lastEventAt: string | null;
  }>;
  triggers: Array<{
    triggerId: string;
    workflowDefinitionId: string;
    counts: Record<TriggerMetricStatus, number>;
    lastStatus: TriggerMetricStatus | null;
    lastUpdatedAt: string | null;
    lastError: string | null;
  }>;
} {
  const sources = Array.from(sourceMetrics.entries()).map(([source, record]) => ({
    source,
    total: record.total,
    throttled: record.throttled,
    dropped: record.dropped,
    failures: record.failures,
    averageLagMs: record.total > 0 ? Math.round(record.totalLagMs / record.total) : null,
    lastLagMs: record.lastLagMs,
    maxLagMs: record.maxLagMs,
    lastEventAt: record.lastEventAt
  }));

  const triggers = Array.from(triggerMetrics.entries()).map(([triggerId, record]) => ({
    triggerId,
    workflowDefinitionId: record.workflowDefinitionId,
    counts: { ...record.counts },
    lastStatus: record.lastStatus,
    lastUpdatedAt: record.lastUpdatedAt,
    lastError: record.lastError
  }));

  return {
    generatedAt: new Date().toISOString(),
    sources,
    triggers
  };
}
