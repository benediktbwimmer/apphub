export type MetadataValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type MetastoreRecord = {
  id: number;
  namespace: string;
  key: string;
  metadata: Record<string, unknown>;
  tags: string[];
  owner: string | null;
  schemaHash: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
};

export type MetastoreRecordProjection =
  Pick<MetastoreRecord, 'namespace' | 'key'> &
  Partial<Omit<MetastoreRecord, 'namespace' | 'key'>>;

export type MetastoreRecordRow = {
  id: number;
  namespace: string;
  record_key: string;
  metadata: Record<string, unknown>;
  tags: string[] | null;
  owner: string | null;
  schema_hash: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  created_by: string | null;
  updated_by: string | null;
};

export type AuditAction = 'create' | 'update' | 'delete' | 'restore';

export type MetastoreRecordAuditRow = {
  id: number;
  record_id: number | null;
  namespace: string;
  record_key: string;
  action: AuditAction;
  actor: string | null;
  previous_version: number | null;
  version: number | null;
  metadata: Record<string, unknown> | null;
  previous_metadata: Record<string, unknown> | null;
  tags: string[] | null;
  previous_tags: string[] | null;
  owner: string | null;
  previous_owner: string | null;
  schema_hash: string | null;
  previous_schema_hash: string | null;
  created_at: Date;
};

export type RecordWriteInput = {
  namespace: string;
  key: string;
  metadata: Record<string, unknown>;
  tags?: string[];
  owner?: string | null;
  schemaHash?: string | null;
  actor?: string | null;
  idempotencyKey?: string | null;
};

export type RecordUpdateInput = RecordWriteInput & {
  expectedVersion?: number;
};

export type RecordDeleteInput = {
  namespace: string;
  key: string;
  actor?: string | null;
  expectedVersion?: number;
  idempotencyKey?: string | null;
};

export type RecordPatchInput = {
  namespace: string;
  key: string;
  metadataPatch?: Record<string, unknown>;
  metadataUnset?: string[];
  tags?: {
    set?: string[];
    add?: string[];
    remove?: string[];
  };
  owner?: string | null | undefined;
  schemaHash?: string | null | undefined;
  expectedVersion?: number;
  actor?: string | null;
  idempotencyKey?: string | null;
};

export type RecordPurgeInput = {
  namespace: string;
  key: string;
  expectedVersion?: number;
  idempotencyKey?: string | null;
};
