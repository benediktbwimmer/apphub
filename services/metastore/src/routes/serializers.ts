import type { MetastoreRecord } from '../db/types';
import type { RecordAuditView } from '../db/auditRepository';

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

export type ProjectedSerializedRecord = Pick<SerializedRecord, 'namespace' | 'key'> &
  Partial<SerializedRecord>;

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
  record: MetastoreRecord,
  projection?: string[]
): SerializedRecord | ProjectedSerializedRecord {
  const baseRecord: SerializedRecord = {
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

  if (!projection || projection.length === 0) {
    return baseRecord;
  }

  const normalized = new Set(projection.map((entry) => entry.trim()).filter(Boolean));
  const projected: ProjectedSerializedRecord = {
    namespace: baseRecord.namespace,
    key: baseRecord.key
  };
  const partial = projected as Partial<SerializedRecord>;

  const metadataProjection = selectMetadata(baseRecord.metadata, Array.from(normalized));
  if (Object.keys(metadataProjection).length > 0 || normalized.has('metadata')) {
    partial.metadata = metadataProjection;
  }

  for (const field of SERIALIZABLE_FIELDS) {
    if (field === 'metadata') {
      continue;
    }
    if (normalized.has(field)) {
      (partial as Record<string, unknown>)[field] = baseRecord[field];
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
    createdAt: entry.createdAt.toISOString()
  } satisfies SerializedAuditEntry;
}
