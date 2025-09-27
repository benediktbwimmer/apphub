import type { FilestoreEvent, FilestoreEventType } from './api';

export type ActivityEntry = {
  id: string;
  type: FilestoreEventType;
  label: string;
  detail: string;
  backendMountId: number | null;
  timestamp: string;
};

export function resolveEventTimestamp(event: FilestoreEvent): string {
  switch (event.type) {
    case 'filestore.node.created':
    case 'filestore.node.updated':
    case 'filestore.node.deleted':
      return event.data.observedAt;
    case 'filestore.command.completed':
      return event.data.observedAt;
    case 'filestore.drift.detected':
      return event.data.detectedAt;
    case 'filestore.node.reconciled':
    case 'filestore.node.missing':
      return event.data.observedAt;
    case 'filestore.node.downloaded':
      return event.data.observedAt;
    case 'filestore.reconciliation.job.queued':
    case 'filestore.reconciliation.job.started':
    case 'filestore.reconciliation.job.completed':
    case 'filestore.reconciliation.job.failed':
    case 'filestore.reconciliation.job.cancelled':
      return event.data.updatedAt ?? event.data.enqueuedAt;
    default:
      return new Date().toISOString();
  }
}

export function describeFilestoreEvent(event: FilestoreEvent): ActivityEntry {
  const backendMountId = 'backendMountId' in event.data ? event.data.backendMountId ?? null : null;
  const timestamp = resolveEventTimestamp(event);
  const path = 'path' in event.data ? event.data.path : undefined;
  let label = 'Filestore event';
  let detail = path ?? 'Unknown path';

  switch (event.type) {
    case 'filestore.node.created':
      label = 'Node created';
      detail = `${path ?? 'unknown'} · ${event.data.kind}`;
      break;
    case 'filestore.node.updated':
      label = 'Node updated';
      detail = `${path ?? 'unknown'} · state ${event.data.state}`;
      break;
    case 'filestore.node.deleted':
      label = 'Node deleted';
      detail = path ?? 'unknown';
      break;
    case 'filestore.command.completed':
      label = `Command ${event.data.command}`;
      detail = `${path ?? 'unknown'} · journal ${event.data.journalId}`;
      break;
    case 'filestore.drift.detected':
      label = 'Drift detected';
      detail = `${path ?? 'unknown'} · ${event.data.reason}`;
      break;
    case 'filestore.node.reconciled':
      label = `Reconciled (${event.data.reason})`;
      detail = `${path ?? 'unknown'} · state ${event.data.state}`;
      break;
    case 'filestore.node.missing':
      label = 'Node missing';
      detail = `${path ?? 'unknown'} · previously ${event.data.previousState ?? 'unknown'}`;
      break;
    case 'filestore.node.downloaded': {
      label = event.data.mode === 'presign' ? 'Download (presigned)' : 'Download';
      const parts = [path ?? 'unknown'];
      if (event.data.mode === 'stream' && event.data.range) {
        parts.push(`range ${event.data.range}`);
      }
      if (event.data.mode === 'presign') {
        parts.push('presigned link');
      }
      detail = parts.join(' · ');
      break;
    }
    case 'filestore.reconciliation.job.queued':
      label = 'Reconciliation queued';
      detail = `${path ?? 'unknown'} · reason ${event.data.reason}`;
      break;
    case 'filestore.reconciliation.job.started':
      label = 'Reconciliation started';
      detail = `${path ?? 'unknown'} · attempt ${event.data.attempt}`;
      break;
    case 'filestore.reconciliation.job.completed': {
      const outcome =
        event.data.result && typeof event.data.result === 'object' && 'outcome' in event.data.result
          ? String((event.data.result as Record<string, unknown>).outcome)
          : event.data.status;
      label = 'Reconciliation completed';
      detail = `${path ?? 'unknown'} · ${outcome}`;
      break;
    }
    case 'filestore.reconciliation.job.failed': {
      const message =
        event.data.error && typeof event.data.error === 'object' && 'message' in event.data.error
          ? String((event.data.error as Record<string, unknown>).message)
          : 'See worker logs';
      label = 'Reconciliation failed';
      detail = `${path ?? 'unknown'} · ${message}`;
      break;
    }
    case 'filestore.reconciliation.job.cancelled':
      label = 'Reconciliation cancelled';
      detail = `${path ?? 'unknown'} · job cancelled`;
      break;
    default:
      break;
  }

  const idSource =
    ('journalId' in event.data && event.data.journalId !== undefined && event.data.journalId !== null)
      ? `journal:${event.data.journalId}`
      : ('nodeId' in event.data && event.data.nodeId ? `node:${event.data.nodeId}` : `path:${path ?? 'unknown'}`);

  return {
    id: `${event.type}:${idSource}:${timestamp}`,
    type: event.type,
    label,
    detail,
    backendMountId,
    timestamp
  };
}
