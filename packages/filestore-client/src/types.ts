import type {
  FilestoreEvent,
  FilestoreNodeEventPayload,
  FilestoreNodeReconciledPayload,
  FilestoreReconciliationReason
} from '@apphub/shared/filestoreEvents';
import type { FilestoreNodeFilters } from '@apphub/shared/filestoreFilters';

export type TokenSupplier = string | (() => string | Promise<string>);

export interface FilestoreClientOptions {
  baseUrl: string;
  token?: TokenSupplier;
  defaultHeaders?: Record<string, string>;
  userAgent?: string;
  fetchTimeoutMs?: number;
}

export interface CreateDirectoryInput {
  backendMountId: number;
  path: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  principal?: string;
}

export interface DeleteNodeInput {
  backendMountId: number;
  path: string;
  recursive?: boolean;
  idempotencyKey?: string;
  principal?: string;
}

export interface GetNodeByPathInput {
  backendMountId: number;
  path: string;
}

export interface EnqueueReconciliationInput {
  backendMountId: number;
  path: string;
  nodeId?: number | null;
  reason?: FilestoreReconciliationReason;
  detectChildren?: boolean;
  requestedHash?: boolean;
}

export interface UploadFileInput {
  backendMountId: number;
  path: string;
  content: string | Uint8Array;
  contentType?: string;
  metadata?: Record<string, unknown>;
  overwrite?: boolean;
  idempotencyKey?: string;
  principal?: string;
  filename?: string;
}

export interface MoveNodeInput {
  backendMountId: number;
  path: string;
  targetPath: string;
  targetBackendMountId?: number;
  overwrite?: boolean;
  idempotencyKey?: string;
  principal?: string;
}

export interface CopyNodeInput {
  backendMountId: number;
  path: string;
  targetPath: string;
  targetBackendMountId?: number;
  overwrite?: boolean;
  idempotencyKey?: string;
  principal?: string;
}

export interface ListEventsOptions {
  signal?: AbortSignal;
  eventTypes?: FilestoreEvent['type'][];
  backendMountId?: number;
  pathPrefix?: string;
}

export interface ListNodesInput {
  backendMountId: number;
  path?: string;
  limit?: number;
  offset?: number;
  depth?: number;
  states?: ('active' | 'inconsistent' | 'missing' | 'deleted')[];
  kinds?: ('file' | 'directory')[];
  driftOnly?: boolean;
  search?: string;
  filters?: FilestoreNodeFilters;
}

export interface ListNodesResult {
  nodes: FilestoreNodeResponse[];
  total: number;
  nextOffset: number | null;
  limit: number;
  offset: number;
}

export interface FilestoreNodeResponse {
  id: number;
  backendMountId: number;
  parentId: number | null;
  path: string;
  name: string;
  depth: number;
  kind: string;
  sizeBytes: number;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  state: string;
  version: number;
  isSymlink: boolean;
  lastSeenAt: string;
  lastModifiedAt: string | null;
  consistencyState: string;
  consistencyCheckedAt: string;
  lastReconciledAt: string | null;
  lastDriftDetectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rollup: Record<string, unknown> | null;
}

export interface CommandResponse<T = unknown> {
  idempotent: boolean;
  journalEntryId: number;
  node: FilestoreNodeResponse | null;
  result: T;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface FilestoreEventEnvelope {
  type: FilestoreEvent['type'];
  data: FilestoreNodeEventPayload | FilestoreNodeReconciledPayload | Record<string, unknown>;
}
