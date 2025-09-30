import type { MetastoreRecord, MetastoreRecordProjection } from '../db/types';
import type { RecordAuditView } from '../db/auditRepository';
import type { NamespaceSummary } from '../db/namespacesRepository';

export type SerializedRecord = {
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

export type ProjectedSerializedRecord = Pick<SerializedRecord, 'namespace' | 'key'> &
  Partial<SerializedRecord>;

function isCompleteRecord(record: MetastoreRecordProjection): record is MetastoreRecord {
  return (
    record.metadata !== undefined &&
    record.tags !== undefined &&
    record.owner !== undefined &&
    record.schemaHash !== undefined &&
    record.version !== undefined &&
    record.createdAt instanceof Date &&
    record.updatedAt instanceof Date &&
    record.deletedAt !== undefined &&
    record.createdBy !== undefined &&
    record.updatedBy !== undefined
  );
}

function isMetadataProjection(entry: string): boolean {
  return entry === 'metadata' || entry.startsWith('metadata.');
}

function selectMetadata(metadata: Record<string, unknown>, projection: string[]): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  const metadataPaths = projection.filter(isMetadataProjection);
  if (metadataPaths.length === 0) {
    return metadata;
  }

  for (const path of metadataPaths) {
    if (path === 'metadata') {
      return metadata;
    }

    const segments = path
      .slice('metadata.'.length)
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    let source: unknown = metadata;
    let target: Record<string, unknown> = selected;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) {
        break;
      }
      if (typeof source !== 'object' || source === null) {
        break;
      }

      const isLeaf = index === segments.length - 1;
      const nextSource = (source as Record<string, unknown>)[segment];

      if (isLeaf) {
        target[segment] = nextSource as unknown;
        break;
      }

      if (!(segment in target) || typeof target[segment] !== 'object' || target[segment] === null) {
        target[segment] = {};
      }
      target = target[segment] as Record<string, unknown>;
      source = nextSource;
    }
  }

  return selected;
}

const SERIALIZABLE_FIELDS: Array<keyof SerializedRecord> = [
  'metadata',
  'tags',
  'owner',
  'schemaHash',
  'version',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy'
];

export function serializeRecord(
  record: MetastoreRecordProjection,
  projection?: string[]
): SerializedRecord | ProjectedSerializedRecord {
  if (!projection || projection.length === 0) {
    if (!isCompleteRecord(record)) {
      throw new Error('serializeRecord requires a complete record when projection is omitted');
    }

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

  const normalized = new Set(projection.map((entry) => entry.trim()).filter(Boolean));
  const projected: ProjectedSerializedRecord = {
    namespace: record.namespace,
    key: record.key
  };
  const partial = projected as Partial<SerializedRecord>;

  const baseMetadata = record.metadata ?? {};
  const metadataProjection = selectMetadata(baseMetadata, Array.from(normalized));
  if (Object.keys(metadataProjection).length > 0 || normalized.has('metadata')) {
    partial.metadata = metadataProjection;
  }

  for (const field of SERIALIZABLE_FIELDS) {
    if (field === 'metadata') {
      continue;
    }
    if (normalized.has(field)) {
      const value = (record as Record<string, unknown>)[field];

      switch (field) {
        case 'tags': {
          partial.tags = Array.isArray(value) ? (value as string[]) : [];
          break;
        }
        case 'createdAt':
        case 'updatedAt': {
          if (value instanceof Date) {
            partial[field] = value.toISOString();
          }
          break;
        }
        case 'deletedAt': {
          if (value instanceof Date) {
            partial.deletedAt = value.toISOString();
          } else if (value == null) {
            partial.deletedAt = null;
          }
          break;
        }
        default:
          (partial as Record<string, unknown>)[field] = value as unknown;
          break;
      }
    }
  }

  if (!normalized.has('metadata') && Object.keys(metadataProjection).length === 0) {
    delete (projected as Record<string, unknown>).metadata;
  }

  return projected;
}

export type SerializedAuditEntry = {
  id: number;
  namespace: string;
  key: string;
  action: string;
  actor: string | null;
  previousVersion: number | null;
  version: number | null;
  metadata: Record<string, unknown> | null;
  previousMetadata: Record<string, unknown> | null;
  tags: string[] | null;
  previousTags: string[] | null;
  owner: string | null;
  previousOwner: string | null;
  schemaHash: string | null;
  previousSchemaHash: string | null;
  createdAt: string;
};

export function serializeAuditEntry(entry: RecordAuditView): SerializedAuditEntry {
  return {
    id: entry.id,
    namespace: entry.namespace,
    key: entry.recordKey,
    action: entry.action,
    actor: entry.actor,
    previousVersion: entry.previousVersion,
    version: entry.version,
    metadata: entry.metadata,
    previousMetadata: entry.previousMetadata,
    tags: entry.tags,
    previousTags: entry.previousTags,
    owner: entry.owner,
    previousOwner: entry.previousOwner,
    schemaHash: entry.schemaHash,
    previousSchemaHash: entry.previousSchemaHash,
    createdAt: entry.createdAt.toISOString()
  } satisfies SerializedAuditEntry;
}

export type SerializedNamespaceSummary = {
  name: string;
  totalRecords: number;
  deletedRecords: number;
  lastUpdatedAt: string | null;
  ownerCounts?: Array<{ owner: string; count: number }>;
};

export function serializeNamespaceSummary(summary: NamespaceSummary): SerializedNamespaceSummary {
  const owners = summary.ownerCounts
    .filter((entry) => typeof entry.owner === 'string' && entry.owner.length > 0)
    .map((entry) => ({ owner: entry.owner, count: entry.count }))
    .filter((entry) => entry.count > 0);

  const serialized: SerializedNamespaceSummary = {
    name: summary.name,
    totalRecords: summary.totalRecords,
    deletedRecords: summary.deletedRecords,
    lastUpdatedAt: summary.lastUpdatedAt ? summary.lastUpdatedAt.toISOString() : null
  } satisfies SerializedNamespaceSummary;

  if (owners.length > 0) {
    serialized.ownerCounts = owners;
  }

  return serialized;
}
