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
