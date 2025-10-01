import { useConnection, useTransaction } from './utils';
import { mapServiceHealthSnapshotRow } from './rowMappers';
import type {
  ServiceHealthSnapshotInsert,
  ServiceHealthSnapshotRecord
} from './types';
import type { ServiceHealthSnapshotRow } from './rowTypes';

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function serializeMetadata(metadata: ServiceHealthSnapshotInsert['metadata']): string | null {
  if (metadata === undefined || metadata === null) {
    return null;
  }
  return JSON.stringify(metadata);
}

export async function recordServiceHealthSnapshot(
  input: ServiceHealthSnapshotInsert
): Promise<ServiceHealthSnapshotRecord> {
  const slug = normalizeSlug(input.serviceSlug);
  if (!slug) {
    throw new Error('serviceSlug is required to record a health snapshot');
  }

  return useTransaction(async (client) => {
    const { rows: versionRows } = await client.query<{ max_version: number | null }>(
      `SELECT MAX(version) AS max_version
       FROM service_health_snapshots
       WHERE service_slug = $1`,
      [slug]
    );
    const nextVersion = Number(versionRows[0]?.max_version ?? 0) + 1;

    const { rows } = await client.query<ServiceHealthSnapshotRow>(
      `INSERT INTO service_health_snapshots (
         service_slug,
         version,
         status,
         status_message,
         latency_ms,
         status_code,
         checked_at,
         base_url,
         health_endpoint,
         metadata,
         created_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10::jsonb,
         NOW(),
         NOW()
       )
       RETURNING *`,
      [
        slug,
        nextVersion,
        input.status,
        input.statusMessage ?? null,
        input.latencyMs ?? null,
        input.statusCode ?? null,
        input.checkedAt,
        input.baseUrl ?? null,
        input.healthEndpoint ?? null,
        serializeMetadata(input.metadata)
      ]
    );

    if (rows.length === 0) {
      throw new Error('failed to record service health snapshot');
    }

    return mapServiceHealthSnapshotRow(rows[0]);
  });
}

export async function getLatestServiceHealthSnapshot(
  slug: string
): Promise<ServiceHealthSnapshotRecord | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceHealthSnapshotRow>(
      `SELECT *
       FROM service_health_snapshots
       WHERE service_slug = $1
       ORDER BY checked_at DESC, version DESC
       LIMIT 1`,
      [normalizedSlug]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapServiceHealthSnapshotRow(rows[0]);
  });
}

export async function getLatestServiceHealthSnapshots(
  slugs: string[]
): Promise<Map<string, ServiceHealthSnapshotRecord>> {
  const normalized = Array.from(
    new Set(
      slugs
        .map((slug) => normalizeSlug(slug))
        .filter((slug) => slug.length > 0)
    )
  );

  if (normalized.length === 0) {
    return new Map<string, ServiceHealthSnapshotRecord>();
  }

  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceHealthSnapshotRow>(
      `SELECT DISTINCT ON (service_slug) *
       FROM service_health_snapshots
       WHERE service_slug = ANY($1)
       ORDER BY service_slug, checked_at DESC, version DESC`,
      [normalized]
    );
    const result = new Map<string, ServiceHealthSnapshotRecord>();
    for (const row of rows) {
      const record = mapServiceHealthSnapshotRow(row);
      result.set(record.serviceSlug, record);
    }
    return result;
  });
}
