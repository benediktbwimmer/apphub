import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ExampleBundlerProgressStage } from '@apphub/example-bundler';
import {
  type ExampleBundleArtifactRecord,
  type ExampleBundleState,
  type ExampleBundleStatusRecord,
  type ExampleBundleStorageKind
} from './types';
import { useConnection, useTransaction } from './utils';
import { mapExampleBundleArtifactRow, mapExampleBundleStatusRow } from './rowMappers';
import type { ExampleBundleArtifactRow, ExampleBundleStatusRow } from './rowTypes';

export type ExampleBundleStatusUpsertInput = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId?: string | null;
  version?: string | null;
  checksum?: string | null;
  filename?: string | null;
  cached?: boolean | null;
  error?: string | null;
  message?: string | null;
  artifactId?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExampleBundleArtifactInsert = {
  id?: string;
  slug: string;
  fingerprint: string;
  version?: string | null;
  checksum: string;
  filename?: string | null;
  storageKind: ExampleBundleStorageKind;
  storageKey: string;
  storageUrl?: string | null;
  contentType?: string | null;
  size?: number | null;
  jobId?: string | null;
};

type NormalizedStatusInput = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId: string | null;
  version: string | null;
  checksum: string | null;
  filename: string | null;
  cached: boolean | null;
  error: string | null;
  message: string | null;
  artifactId: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type NormalizedArtifactInput = {
  id: string;
  slug: string;
  fingerprint: string;
  version: string | null;
  checksum: string;
  filename: string | null;
  storageKind: ExampleBundleStorageKind;
  storageKey: string;
  storageUrl: string | null;
  contentType: string | null;
  size: number | null;
  jobId: string | null;
};

export async function listExampleBundleStatuses(): Promise<ExampleBundleStatusRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ExampleBundleStatusRow>(
      'SELECT * FROM example_bundle_status ORDER BY updated_at DESC'
    );
    if (rows.length === 0) {
      return [];
    }
    const artifactIds = rows
      .map((row) => row.artifact_id)
      .filter((id): id is string => Boolean(id));
    const artifactMap = artifactIds.length > 0 ? await fetchArtifactsByIds(client, artifactIds) : new Map();
    return rows.map((row) => {
      const artifactRow = row.artifact_id ? artifactMap.get(row.artifact_id) ?? null : null;
      return mapExampleBundleStatusRow(row, artifactRow);
    });
  });
}

export async function getExampleBundleStatus(slug: string): Promise<ExampleBundleStatusRecord | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }
  return useConnection(async (client) => {
    const { rows } = await client.query<ExampleBundleStatusRow>(
      'SELECT * FROM example_bundle_status WHERE slug = $1 LIMIT 1',
      [normalizedSlug]
    );
    if (rows.length === 0) {
      return null;
    }
    const statusRow = rows[0];
    let artifactRow: ExampleBundleArtifactRow | null = null;
    if (statusRow.artifact_id) {
      artifactRow = await fetchArtifactById(client, statusRow.artifact_id);
    }
    return mapExampleBundleStatusRow(statusRow, artifactRow);
  });
}

export async function upsertExampleBundleStatus(
  input: ExampleBundleStatusUpsertInput
): Promise<ExampleBundleStatusRecord> {
  const normalized = normalizeStatusInput(input);
  return useConnection(async (client) => {
    const statusRow = await upsertStatusRow(client, normalized);
    const artifactRow = statusRow.artifact_id ? await fetchArtifactById(client, statusRow.artifact_id) : null;
    return mapExampleBundleStatusRow(statusRow, artifactRow);
  });
}

export async function createExampleBundleArtifact(
  input: ExampleBundleArtifactInsert
): Promise<ExampleBundleArtifactRecord> {
  const normalized = normalizeArtifactInput(input);
  return useConnection(async (client) => {
    const artifactRow = await upsertArtifactRow(client, normalized);
    return mapExampleBundleArtifactRow(artifactRow);
  });
}

export async function recordExampleBundleCompletion(
  statusInput: ExampleBundleStatusUpsertInput,
  artifactInput: ExampleBundleArtifactInsert
): Promise<ExampleBundleStatusRecord> {
  const normalizedStatus = normalizeStatusInput(statusInput);
  if (!normalizedStatus.completedAt && normalizedStatus.state === 'completed') {
    normalizedStatus.completedAt = new Date().toISOString();
  }
  const normalizedArtifact = normalizeArtifactInput(artifactInput);
  return useTransaction(async (client) => {
    const artifactRow = await upsertArtifactRow(client, normalizedArtifact);
    normalizedStatus.artifactId = artifactRow.id;
    const statusRow = await upsertStatusRow(client, normalizedStatus);
    return mapExampleBundleStatusRow(statusRow, artifactRow);
  });
}

export async function clearExampleBundleStatus(slug: string): Promise<void> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return;
  }
  await useConnection((client) => client.query('DELETE FROM example_bundle_status WHERE slug = $1', [normalizedSlug]));
}

async function upsertStatusRow(
  client: PoolClient,
  input: NormalizedStatusInput
): Promise<ExampleBundleStatusRow> {
  const { rows } = await client.query<ExampleBundleStatusRow>(
    `INSERT INTO example_bundle_status (
       slug,
       fingerprint,
       stage,
       state,
       job_id,
       version,
       checksum,
       filename,
       cached,
       error,
       message,
       artifact_id,
       completed_at,
       created_at,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       COALESCE($14, NOW()),
       COALESCE($15, NOW())
     )
     ON CONFLICT (slug) DO UPDATE SET
       fingerprint = EXCLUDED.fingerprint,
       stage = EXCLUDED.stage,
       state = EXCLUDED.state,
       job_id = EXCLUDED.job_id,
       version = EXCLUDED.version,
       checksum = EXCLUDED.checksum,
       filename = EXCLUDED.filename,
       cached = EXCLUDED.cached,
       error = EXCLUDED.error,
       message = EXCLUDED.message,
       artifact_id = EXCLUDED.artifact_id,
       completed_at = EXCLUDED.completed_at,
       updated_at = COALESCE(EXCLUDED.updated_at, NOW())
     RETURNING *`,
    [
      input.slug,
      input.fingerprint,
      input.stage,
      input.state,
      input.jobId,
      input.version,
      input.checksum,
      input.filename,
      input.cached,
      input.error,
      input.message,
      input.artifactId,
      input.completedAt,
      input.createdAt,
      input.updatedAt
    ]
  );
  return rows[0];
}

async function upsertArtifactRow(
  client: PoolClient,
  input: NormalizedArtifactInput
): Promise<ExampleBundleArtifactRow> {
  const { rows } = await client.query<ExampleBundleArtifactRow>(
    `INSERT INTO example_bundle_artifacts (
       id,
       slug,
       fingerprint,
       version,
       checksum,
       filename,
       storage_kind,
       storage_key,
       storage_url,
       content_type,
       size,
       job_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     )
     ON CONFLICT (slug, fingerprint) DO UPDATE SET
       version = EXCLUDED.version,
       checksum = EXCLUDED.checksum,
       filename = EXCLUDED.filename,
       storage_kind = EXCLUDED.storage_kind,
       storage_key = EXCLUDED.storage_key,
       storage_url = EXCLUDED.storage_url,
       content_type = EXCLUDED.content_type,
       size = EXCLUDED.size,
       job_id = EXCLUDED.job_id,
       uploaded_at = NOW()
     RETURNING *`,
    [
      input.id,
      input.slug,
      input.fingerprint,
      input.version,
      input.checksum,
      input.filename,
      input.storageKind,
      input.storageKey,
      input.storageUrl,
      input.contentType,
      input.size,
      input.jobId
    ]
  );
  return rows[0];
}

async function fetchArtifactById(
  client: PoolClient,
  artifactId: string
): Promise<ExampleBundleArtifactRow | null> {
  const { rows } = await client.query<ExampleBundleArtifactRow>(
    'SELECT * FROM example_bundle_artifacts WHERE id = $1 LIMIT 1',
    [artifactId]
  );
  return rows[0] ?? null;
}

async function fetchArtifactsByIds(
  client: PoolClient,
  artifactIds: string[]
): Promise<Map<string, ExampleBundleArtifactRow>> {
  const uniqueIds = Array.from(new Set(artifactIds));
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const { rows } = await client.query<ExampleBundleArtifactRow>(
    'SELECT * FROM example_bundle_artifacts WHERE id = ANY($1::text[])',
    [uniqueIds]
  );
  const map = new Map<string, ExampleBundleArtifactRow>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function normalizeStatusInput(input: ExampleBundleStatusUpsertInput): NormalizedStatusInput {
  const slug = normalizeSlug(input.slug);
  if (!slug) {
    throw new Error('Example bundle slug is required');
  }
  const fingerprint = normalizeFingerprint(input.fingerprint);
  if (!fingerprint) {
    throw new Error('Example bundle fingerprint is required');
  }
  return {
    slug,
    fingerprint,
    stage: normalizeStage(input.stage),
    state: normalizeState(input.state),
    jobId: normalizeNullableString(input.jobId),
    version: normalizeNullableString(input.version),
    checksum: normalizeNullableString(input.checksum),
    filename: normalizeNullableString(input.filename),
    cached: normalizeNullableBoolean(input.cached),
    error: normalizeNullableString(input.error),
    message: normalizeNullableString(input.message),
    artifactId: normalizeNullableString(input.artifactId),
    completedAt: normalizeNullableString(input.completedAt),
    createdAt: normalizeNullableString(input.createdAt),
    updatedAt: normalizeNullableString(input.updatedAt)
  } satisfies NormalizedStatusInput;
}

function normalizeArtifactInput(input: ExampleBundleArtifactInsert): NormalizedArtifactInput {
  const slug = normalizeSlug(input.slug);
  if (!slug) {
    throw new Error('Example bundle artifact slug is required');
  }
  const fingerprint = normalizeFingerprint(input.fingerprint);
  if (!fingerprint) {
    throw new Error('Example bundle artifact fingerprint is required');
  }
  const checksum = normalizeChecksum(input.checksum);
  if (!checksum) {
    throw new Error('Example bundle artifact checksum is required');
  }
  return {
    id: input.id ?? randomUUID(),
    slug,
    fingerprint,
    version: normalizeNullableString(input.version),
    checksum,
    filename: normalizeNullableString(input.filename),
    storageKind: normalizeStorageKind(input.storageKind),
    storageKey: normalizeStorageKey(input.storageKey),
    storageUrl: normalizeNullableString(input.storageUrl),
    contentType: normalizeNullableString(input.contentType),
    size: normalizeSize(input.size),
    jobId: normalizeNullableString(input.jobId)
  } satisfies NormalizedArtifactInput;
}

function normalizeSlug(value: string): string {
  return value ? value.trim().toLowerCase() : '';
}

function normalizeFingerprint(value: string): string {
  return value ? value.trim() : '';
}

function normalizeChecksum(value: string): string {
  return value ? value.trim().toLowerCase() : '';
}

function normalizeStorageKey(value: string): string {
  const trimmed = value ? value.trim() : '';
  if (!trimmed) {
    throw new Error('Example bundle storage key is required');
  }
  return trimmed;
}

function normalizeStage(stage: ExampleBundlerProgressStage): ExampleBundlerProgressStage {
  return stage;
}

function normalizeState(state: ExampleBundleState): ExampleBundleState {
  return state;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  let candidate: string | null = null;

  if (typeof value === 'string') {
    candidate = value;
  } else if (value instanceof Date) {
    candidate = value.toISOString();
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    candidate = String(value);
  } else if (typeof value === 'object') {
    try {
      candidate = JSON.stringify(value);
    } catch {
      candidate = null;
    }
  } else {
    candidate = String(value);
  }

  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableBoolean(value: boolean | null | undefined): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  return Boolean(value);
}

function normalizeSize(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeStorageKind(value: ExampleBundleStorageKind | string): ExampleBundleStorageKind {
  return value === 's3' ? 's3' : 'local';
}
