import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppHubEvent } from '../../events/context';
import { useMetastoreRecordStream } from '../../metastore/useRecordStream';
import type { ObservabilityEvent, ObservabilityEventSeverity } from '../types';

const EVENT_LIMIT = 60;

const WORKFLOW_RUN_EVENT_TYPES = [
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled'
] as const;

const JOB_RUN_EVENT_TYPES = [
  'job.run.pending',
  'job.run.running',
  'job.run.succeeded',
  'job.run.failed',
  'job.run.canceled',
  'job.run.expired'
] as const;

export function useObservabilityEvents(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const appendEvent = useCallback((entry: ObservabilityEvent) => {
    const eventId = entry.id;
    setEvents((previous) => {
      if (seenIdsRef.current.has(eventId)) {
        return previous;
      }
      const next = [entry, ...previous];
      seenIdsRef.current.add(eventId);
      if (next.length <= EVENT_LIMIT) {
        return next;
      }
      const trimmed = next.slice(0, EVENT_LIMIT);
      const retainedIds = new Set(trimmed.map((item) => item.id));
      seenIdsRef.current = retainedIds;
      return trimmed;
    });
  }, []);

  const buildWorkflowSummary = useCallback((type: string, data: { workflow?: { name?: string; slug?: string }; runKey?: string | null }) => {
    const status = type.split('.').pop() ?? 'updated';
    const name = data.workflow?.name ?? data.workflow?.slug ?? 'Workflow';
    const key = data.runKey ? ` · ${data.runKey}` : '';
    return `${name}${key} ${status}`;
  }, []);

  useAppHubEvent(WORKFLOW_RUN_EVENT_TYPES, (event) => {
    if (!enabled) {
      return;
    }
    const run = (event.data as { run?: { id?: string; workflow?: { name?: string; slug?: string }; updatedAt?: string | null; startedAt?: string | null; runKey?: string | null } }).run;
    if (!run) {
      return;
    }
    const occurredAt = run.updatedAt ?? run.startedAt ?? new Date().toISOString();
    appendEvent({
      id: `workflow-${run.id ?? `${event.type}-${occurredAt}`}`,
      kind: 'workflow',
      source: 'core',
      occurredAt,
      summary: buildWorkflowSummary(event.type, run),
      severity: deriveSeverity(event.type),
      payload: run
    });
  });

  useAppHubEvent(JOB_RUN_EVENT_TYPES, (event) => {
    if (!enabled) {
      return;
    }
    const run = (event.data as { run?: { id?: string; job?: { name?: string; slug?: string }; updatedAt?: string | null; startedAt?: string | null } }).run;
    const jobInfo = (event.data as { job?: { name?: string; slug?: string } }).job ?? run?.job;
    if (!run) {
      return;
    }
    const occurredAt = run.updatedAt ?? run.startedAt ?? new Date().toISOString();
    const status = event.type.split('.').pop() ?? 'updated';
    const name = jobInfo?.name ?? jobInfo?.slug ?? 'Job';
    appendEvent({
      id: `job-${run.id ?? `${event.type}-${occurredAt}`}`,
      kind: 'job',
      source: 'core',
      occurredAt,
      summary: `${name} ${status}`,
      severity: deriveSeverity(event.type),
      payload: { run, job: jobInfo }
    });
  });

  useAppHubEvent(['asset.produced', 'asset.expired'], (event) => {
    if (!enabled) {
      return;
    }
    const payload = event.data as { assetId?: string; producedAt?: string; expiresAt?: string; workflowSlug?: string };
    const occurredAt = (payload.producedAt ?? payload.expiresAt) ?? new Date().toISOString();
    const summary = event.type === 'asset.produced'
      ? `Asset ${payload.assetId ?? 'unknown'} produced`
      : `Asset ${payload.assetId ?? 'unknown'} expired`;
    appendEvent({
      id: `asset-${payload.assetId ?? `${event.type}-${occurredAt}`}`,
      kind: 'asset',
      source: 'core',
      occurredAt,
      summary,
      severity: event.type === 'asset.expired' ? 'warning' : 'info',
      payload: payload ?? event.data
    });
  });

  const metastoreStream = useMetastoreRecordStream({ enabled });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    for (const entry of metastoreStream.events) {
      const occurredAt = entry.payload.occurredAt ?? entry.receivedAt;
      const id = `metastore-${entry.payload.namespace}-${entry.payload.key}-${entry.payload.version ?? 'latest'}-${entry.receivedAt}`;
      if (seenIdsRef.current.has(id)) {
        continue;
      }
      appendEvent({
        id,
        kind: 'metastore',
        source: 'metastore',
        occurredAt,
        summary: `Metastore ${entry.payload.action} · ${entry.payload.namespace}/${entry.payload.key}`,
        severity: entry.payload.action === 'deleted' ? 'warning' : 'info',
        payload: entry.payload
      });
    }
  }, [appendEvent, enabled, metastoreStream.events]);

  const status = useMemo(
    () => ({
      metastoreStream: {
        status: metastoreStream.status,
        error: metastoreStream.error
      }
    }),
    [metastoreStream.error, metastoreStream.status]
  );

  return {
    events,
    status,
    loading: false,
    error: null
  } as const;
}

function deriveSeverity(eventType: string): ObservabilityEventSeverity {
  if (eventType.endsWith('failed') || eventType.endsWith('canceled')) {
    return eventType.endsWith('failed') ? 'danger' : 'warning';
  }
  return 'info';
}
