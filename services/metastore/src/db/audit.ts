import type { PoolClient } from 'pg';
import type { AuditAction, MetastoreRecord } from './types';

export type AuditLogInput = {
  client: PoolClient;
  action: AuditAction;
  record: MetastoreRecord | null;
  previousRecord?: MetastoreRecord | null;
  actor?: string | null;
};

function toJson(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  return metadata as Record<string, unknown>;
}

export async function writeAuditEntry(options: AuditLogInput): Promise<void> {
  const { client, action, record, previousRecord, actor } = options;

  const targetNamespace = record?.namespace ?? previousRecord?.namespace;
  const targetKey = record?.key ?? previousRecord?.key;

  await client.query(
    `INSERT INTO metastore_record_audits
       (record_id,
        namespace,
        record_key,
        action,
        actor,
        previous_version,
        version,
        metadata,
        previous_metadata,
        tags,
        previous_tags,
        owner,
        previous_owner,
        schema_hash,
        previous_schema_hash)
     VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        $9::jsonb,
        $10::text[],
        $11::text[],
        $12,
        $13,
        $14,
        $15
     )`,
    [
      record?.id ?? previousRecord?.id ?? null,
      targetNamespace,
      targetKey,
      action,
      actor ?? null,
      previousRecord?.version ?? null,
      record?.version ?? null,
      record ? JSON.stringify(record.metadata ?? {}) : null,
      previousRecord ? JSON.stringify(previousRecord.metadata ?? {}) : null,
      record?.tags ?? null,
      previousRecord?.tags ?? null,
      record?.owner ?? null,
      previousRecord?.owner ?? null,
      record?.schemaHash ?? null,
      previousRecord?.schemaHash ?? null
    ]
  );
}
