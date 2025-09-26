import type { MetastoreRecord } from '../db/types';

type SerializedRecord = {
  namespace: string;
  key: string;
  metadata: Record<string, unknown>;
  tags: string[];
  owner: string | null;
  schemaHash: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
};

export function serializeRecord(record: MetastoreRecord): SerializedRecord {
  return {
    namespace: record.namespace,
    key: record.key,
    metadata: record.metadata,
    tags: record.tags,
    owner: record.owner,
    schemaHash: record.schemaHash,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy
  } satisfies SerializedRecord;
}
