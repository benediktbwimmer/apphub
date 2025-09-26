import { z } from 'zod';

export type FilestoreReconciliationReason = 'drift' | 'audit' | 'manual';

export type FilestoreNodeKind = 'file' | 'directory' | 'unknown';
export type FilestoreNodeState = 'active' | 'inconsistent' | 'missing' | 'deleted' | 'unknown';

export type FilestoreNodeEventPayload = {
  backendMountId: number;
  nodeId: number | null;
  path: string;
  kind: FilestoreNodeKind;
  state: FilestoreNodeState;
  parentId: number | null;
  version: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  journalId: number;
  command: string;
  idempotencyKey: string | null;
  principal: string | null;
  observedAt: string;
};

export type FilestoreNodeReconciledPayload = {
  backendMountId: number;
  nodeId: number;
  path: string;
  kind: FilestoreNodeKind;
  state: FilestoreNodeState;
  parentId: number | null;
  version: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  consistencyState: 'active' | 'inconsistent' | 'missing';
  consistencyCheckedAt: string;
  lastReconciledAt: string | null;
  previousState: FilestoreNodeState | null;
  reason: FilestoreReconciliationReason;
  observedAt: string;
};

export type FilestoreCommandCompletedPayload = {
  journalId: number;
  command: string;
  backendMountId: number;
  nodeId: number | null;
  path: string;
  idempotencyKey: string | null;
  principal: string | null;
  result: Record<string, unknown>;
  observedAt: string;
};

export type FilestoreDriftDetectedPayload = {
  backendMountId: number;
  nodeId: number | null;
  path: string;
  detectedAt: string;
  reason: string;
  reporter?: string;
  metadata?: Record<string, unknown>;
};

export type FilestoreEvent =
  | { type: 'filestore.node.created'; data: FilestoreNodeEventPayload }
  | { type: 'filestore.node.updated'; data: FilestoreNodeEventPayload }
  | { type: 'filestore.node.deleted'; data: FilestoreNodeEventPayload }
  | { type: 'filestore.command.completed'; data: FilestoreCommandCompletedPayload }
  | { type: 'filestore.drift.detected'; data: FilestoreDriftDetectedPayload }
  | { type: 'filestore.node.reconciled'; data: FilestoreNodeReconciledPayload }
  | { type: 'filestore.node.missing'; data: FilestoreNodeReconciledPayload };

export type FilestoreEventEnvelope = {
  origin?: string;
  event: FilestoreEvent;
};

const eventEnvelopeSchema: z.ZodSchema<FilestoreEventEnvelope> = z.object({
  origin: z.string().optional(),
  event: z.object({
    type: z.string(),
    data: z.any()
  })
}) as unknown as z.ZodSchema<FilestoreEventEnvelope>;

export function parseFilestoreEventEnvelope(message: string): FilestoreEventEnvelope | null {
  try {
    const parsed = JSON.parse(message);
    const result = eventEnvelopeSchema.parse(parsed);
    return result;
  } catch (err) {
    return null;
  }
}

export function isFilestoreEvent(value: unknown): value is FilestoreEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { type?: string };
  return typeof candidate.type === 'string' && candidate.type.startsWith('filestore.');
}

export function isFilestoreEventEnvelope(value: unknown): value is FilestoreEventEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'event' in value;
}

