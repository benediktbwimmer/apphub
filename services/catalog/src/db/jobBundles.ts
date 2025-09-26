import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  type JobBundlePublishInput,
  type JobBundleRecord,
  type JobBundleVersionRecord,
  type JobBundleVersionUpdateInput
} from './types';
import {
  mapJobBundleRow,
  mapJobBundleVersionRow
} from './rowMappers';
import type { JobBundleRow, JobBundleVersionRow } from './rowTypes';

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function normalizeVersion(version: string): string {
  return version.trim();
}

function normalizeDisplayName(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeDescription(value: string | null | undefined, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback ?? null;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildReplacementActorIdentifier(subject: string | null, kind: string | null): string {
  const normalizedSubject = typeof subject === 'string' ? subject.trim() : '';
  const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
  if (normalizedSubject && normalizedKind) {
    return `${normalizedKind}:${normalizedSubject}`;
  }
  if (normalizedSubject) {
    return normalizedSubject;
  }
  if (normalizedKind) {
    return normalizedKind;
  }
  return 'unknown';
}

function uniqueCapabilityFlags(flags: string[] = []): string[] {
  const seen = new Set<string>();
  for (const flag of flags) {
    const candidate = flag.trim();
    if (!candidate) {
      continue;
    }
    seen.add(candidate);
  }
  return Array.from(seen).sort();
}

async function fetchBundleRowBySlug(client: PoolClient, slug: string): Promise<JobBundleRow | null> {
  const { rows } = await client.query<JobBundleRow>(
    'SELECT * FROM job_bundles WHERE slug = $1',
    [slug]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function fetchBundleVersionRow(
  client: PoolClient,
  slug: string,
  version: string
): Promise<JobBundleVersionRow | null> {
  const { rows } = await client.query<JobBundleVersionRow>(
    'SELECT * FROM job_bundle_versions WHERE slug = $1 AND version = $2',
    [slug, version]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function fetchBundleVersionRowById(
  client: PoolClient,
  bundleId: string,
  version: string
): Promise<JobBundleVersionRow | null> {
  const { rows } = await client.query<JobBundleVersionRow>(
    'SELECT * FROM job_bundle_versions WHERE bundle_id = $1 AND version = $2',
    [bundleId, version]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function listBundleVersionRows(
  client: PoolClient,
  bundleId: string
): Promise<JobBundleVersionRow[]> {
  const { rows } = await client.query<JobBundleVersionRow>(
    'SELECT * FROM job_bundle_versions WHERE bundle_id = $1 ORDER BY published_at DESC',
    [bundleId]
  );
  return rows;
}

function toJsonParameter(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

export async function listJobBundles(): Promise<JobBundleRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<JobBundleRow>(
      'SELECT * FROM job_bundles ORDER BY slug ASC'
    );
    return rows.map(mapJobBundleRow);
  });
}

export async function getJobBundleBySlug(
  slug: string,
  options?: { includeVersions?: boolean }
): Promise<JobBundleRecord | null> {
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    return null;
  }
  return useConnection(async (client) => {
    const bundleRow = await fetchBundleRowBySlug(client, normalized);
    if (!bundleRow) {
      return null;
    }
    const bundle = mapJobBundleRow(bundleRow);
    if (options?.includeVersions) {
      const versionRows = await listBundleVersionRows(client, bundleRow.id);
      bundle.versions = versionRows.map(mapJobBundleVersionRow);
    }
    return bundle;
  });
}

export async function getJobBundleVersion(
  slug: string,
  version: string
): Promise<JobBundleVersionRecord | null> {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedSlug || !normalizedVersion) {
    return null;
  }
  return useConnection(async (client) => {
    const row = await fetchBundleVersionRow(client, normalizedSlug, normalizedVersion);
    return row ? mapJobBundleVersionRow(row) : null;
  });
}

export async function listJobBundleVersions(
  slug: string
): Promise<JobBundleVersionRecord[]> {
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    return [];
  }
  return useConnection(async (client) => {
    const bundle = await fetchBundleRowBySlug(client, normalized);
    if (!bundle) {
      return [];
    }
    const versionRows = await listBundleVersionRows(client, bundle.id);
    return versionRows.map(mapJobBundleVersionRow);
  });
}

export async function publishJobBundleVersion(
  input: JobBundlePublishInput
): Promise<{ bundle: JobBundleRecord; version: JobBundleVersionRecord }> {
  const slug = normalizeSlug(input.slug);
  if (!slug) {
    throw new Error('Bundle slug is required');
  }
  const version = normalizeVersion(input.version);
  if (!version) {
    throw new Error('Bundle version is required');
  }
  const checksum = input.checksum.trim();
  if (!checksum) {
    throw new Error('Bundle checksum is required');
  }
  const artifactPath = input.artifactPath.trim();
  if (!artifactPath) {
    throw new Error('Bundle artifact path is required');
  }
  const artifactStorage = input.artifactStorage === 's3' ? 's3' : 'local';
  const artifactData = input.artifactData ?? null;
  const artifactSize = input.artifactSize ?? artifactData?.byteLength ?? null;

  if (artifactStorage === 'local' && artifactData === null) {
    throw new Error('Local bundle artifacts must include binary data');
  }
  const capabilityFlags = uniqueCapabilityFlags(input.capabilityFlags ?? []);
  const immutable = Boolean(input.immutable);
  const artifactContentType = input.artifactContentType ?? null;
  const metadata = input.metadata ?? null;
  const force = Boolean(input.force);

  const manifest = input.manifest ?? {};

  const { bundleRow, versionRow } = await useTransaction(async (client) => {
    let bundle = await fetchBundleRowBySlug(client, slug);
    const displayName = normalizeDisplayName(input.displayName, bundle?.display_name ?? slug);
    const description = normalizeDescription(input.description, bundle?.description ?? null);

    if (!bundle) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO job_bundles (
           id,
           slug,
           display_name,
           description,
           latest_version,
           created_at,
           updated_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           NOW(),
           NOW()
         )
         ON CONFLICT (slug) DO NOTHING`,
        [id, slug, displayName, description, version]
      );
      bundle = await fetchBundleRowBySlug(client, slug);
      if (!bundle) {
        throw new Error('Failed to create job bundle record');
      }
    } else if (input.displayName !== undefined || input.description !== undefined) {
      await client.query(
        `UPDATE job_bundles
         SET display_name = $1,
             description = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [displayName, description, bundle.id]
      );
      bundle = await fetchBundleRowBySlug(client, slug);
    }

    if (!bundle) {
      throw new Error('Failed to load job bundle record');
    }

    const existingVersion = await fetchBundleVersionRowById(client, bundle.id, version);
    let versionRow: JobBundleVersionRow | null = null;
    if (existingVersion) {
      if (!force) {
        throw new Error(`Bundle version ${slug}@${version} already exists`);
      }
      const replacementActor = buildReplacementActorIdentifier(
        input.publishedBy ?? null,
        input.publishedByKind ?? null
      );
      const updatedVersion = await client.query<JobBundleVersionRow>(
        `UPDATE job_bundle_versions
         SET manifest = $1::jsonb,
             checksum = $2,
             capability_flags = $3::jsonb,
             artifact_storage = $4,
             artifact_path = $5,
             artifact_content_type = $6,
             artifact_size = $7,
             artifact_data = $8,
             immutable = $9,
             status = 'published',
             published_by = $10,
             published_by_kind = $11,
             published_by_token_hash = $12,
             published_at = NOW(),
             deprecated_at = NULL,
             metadata = $13::jsonb,
             updated_at = NOW(),
             replaced_at = NOW(),
             replaced_by = $14
         WHERE id = $15
         RETURNING *`,
        [
          JSON.stringify(manifest),
          checksum,
          JSON.stringify(capabilityFlags),
          artifactStorage,
          artifactPath,
          artifactContentType,
          artifactSize,
          artifactData,
          immutable,
          input.publishedBy ?? null,
          input.publishedByKind ?? null,
          input.publishedByTokenHash ?? null,
          toJsonParameter(metadata),
          replacementActor,
          existingVersion.id
        ]
      );
      if (updatedVersion.rowCount === 0) {
        throw new Error('Failed to replace job bundle version');
      }
      versionRow = updatedVersion.rows[0];
    } else {
      const versionId = randomUUID();
      const insertedVersion = await client.query<JobBundleVersionRow>(
        `INSERT INTO job_bundle_versions (
           id,
           bundle_id,
           slug,
           version,
           manifest,
           checksum,
           capability_flags,
           artifact_storage,
           artifact_path,
           artifact_content_type,
           artifact_size,
           artifact_data,
           immutable,
           status,
           published_by,
           published_by_kind,
           published_by_token_hash,
           published_at,
           metadata,
           created_at,
           updated_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5::jsonb,
           $6,
           $7::jsonb,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           'published',
           $14,
           $15,
           $16,
           NOW(),
           $17::jsonb,
           NOW(),
           NOW()
         )
         RETURNING *`,
        [
          versionId,
          bundle.id,
          slug,
          version,
          JSON.stringify(manifest),
          checksum,
          JSON.stringify(capabilityFlags),
          artifactStorage,
          artifactPath,
          artifactContentType,
          artifactSize,
          artifactData,
          immutable,
          input.publishedBy ?? null,
          input.publishedByKind ?? null,
          input.publishedByTokenHash ?? null,
          toJsonParameter(metadata)
        ]
      );
      versionRow = insertedVersion.rows[0] ?? null;
    }

    if (!versionRow) {
      throw new Error('Failed to persist job bundle version');
    }

    await client.query(
      `UPDATE job_bundles
       SET display_name = $1,
           description = $2,
           latest_version = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [displayName, description, version, bundle.id]
    );

    const refreshedBundle = await fetchBundleRowBySlug(client, slug);
    if (!refreshedBundle) {
      throw new Error('Bundle record missing after publish');
    }

    return { bundleRow: refreshedBundle, versionRow };
  });

  return {
    bundle: mapJobBundleRow(bundleRow),
    version: mapJobBundleVersionRow(versionRow)
  };
}

export async function updateJobBundleVersion(
  slug: string,
  version: string,
  updates: JobBundleVersionUpdateInput
): Promise<JobBundleVersionRecord | null> {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedSlug || !normalizedVersion) {
    return null;
  }

  return useTransaction(async (client) => {
    const bundle = await fetchBundleRowBySlug(client, normalizedSlug);
    if (!bundle) {
      return null;
    }
    const existing = await fetchBundleVersionRowById(client, bundle.id, normalizedVersion);
    if (!existing) {
      return null;
    }

    let nextStatus = existing.status;
    let deprecatedAt = existing.deprecated_at;

    if (updates.deprecated !== undefined) {
      if (updates.deprecated) {
        nextStatus = 'deprecated';
        deprecatedAt = new Date().toISOString();
      } else {
        nextStatus = 'published';
        deprecatedAt = null;
      }
    }

    await client.query(
      `UPDATE job_bundle_versions
       SET status = $1,
           deprecated_at = $2,
           updated_at = NOW()
       WHERE bundle_id = $3 AND version = $4`,
      [
        nextStatus,
        deprecatedAt,
        bundle.id,
        normalizedVersion
      ]
    );

    if (updates.metadata !== undefined) {
      await client.query(
        `UPDATE job_bundle_versions
         SET metadata = $1::jsonb,
             updated_at = NOW()
         WHERE bundle_id = $2 AND version = $3`,
        [toJsonParameter(updates.metadata), bundle.id, normalizedVersion]
      );
    }

    const latestPublished = await client.query<JobBundleVersionRow>(
      `SELECT *
         FROM job_bundle_versions
        WHERE bundle_id = $1
          AND status = 'published'
        ORDER BY published_at DESC
        LIMIT 1`,
      [bundle.id]
    );

    await client.query(
      `UPDATE job_bundles
       SET latest_version = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [latestPublished.rows[0]?.version ?? null, bundle.id]
    );

    const refreshed = await fetchBundleVersionRowById(client, bundle.id, normalizedVersion);
    return refreshed ? mapJobBundleVersionRow(refreshed) : null;
  });
}
