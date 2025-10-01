import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  type BuildRecord,
  type BuildStatus
} from './types';
import { mapBuildRow } from './rowMappers';
import type { BuildRow } from './rowTypes';
import { emitApphubEvent } from '../events';
import { getRepositoryById } from './repositories';

async function emitBuildChanged(build: BuildRecord | null): Promise<void> {
  if (!build) {
    return;
  }
  emitApphubEvent({ type: 'build.updated', data: { build } });
  const repository = await getRepositoryById(build.repositoryId);
  if (repository) {
    emitApphubEvent({ type: 'repository.updated', data: { repository } });
  }
}

function normalizeLogs(logs?: string | null): string | null {
  if (logs === undefined) {
    return null;
  }
  return logs === null ? null : String(logs);
}

export async function getBuildById(id: string): Promise<BuildRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<BuildRow>('SELECT * FROM builds WHERE id = $1', [id]);
    return rows.length > 0 ? mapBuildRow(rows[0]) : null;
  });
}

export async function listBuildsForRepository(
  repositoryId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<BuildRecord[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);
  return useConnection(async (client) => {
    const { rows } = await client.query<BuildRow>(
      `SELECT *
       FROM builds
       WHERE repository_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [repositoryId, limit, offset]
    );
    return rows.map(mapBuildRow);
  });
}

export async function countBuildsForRepository(repositoryId: string): Promise<number> {
  return useConnection(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM builds WHERE repository_id = $1',
      [repositoryId]
    );
    return Number(rows[0]?.count ?? 0);
  });
}

export async function createBuild(
  repositoryId: string,
  options: { commitSha?: string | null; gitBranch?: string | null; gitRef?: string | null } = {}
): Promise<BuildRecord> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const gitBranch = options.gitBranch?.trim() ?? null;
  const gitRef = options.gitRef?.trim() ?? null;

  await useTransaction(async (client) => {
    await client.query(
      `INSERT INTO builds (
         id, repository_id, status, logs, image_tag, error_message,
         commit_sha, branch, git_ref, created_at, updated_at, started_at,
         completed_at, duration_ms
       ) VALUES ($1, $2, 'pending', '', NULL, NULL, $3, $4, $5, $6, $6, NULL, NULL, NULL)`,
      [id, repositoryId, options.commitSha ?? null, gitBranch, gitRef, now]
    );
  });

  const build = await getBuildById(id);
  await emitBuildChanged(build);
  if (!build) {
    throw new Error('failed to create build');
  }
  return build;
}

export async function startBuild(buildId: string): Promise<BuildRecord | null> {
  const build = await useTransaction(async (client) => {
    const { rows } = await client.query<BuildRow>('SELECT * FROM builds WHERE id = $1 FOR UPDATE', [buildId]);
    if (rows.length === 0) {
      return null;
    }
    const existing = rows[0];
    if (existing.status === 'running') {
      return mapBuildRow(existing);
    }
    if (existing.status !== 'pending') {
      return null;
    }
    const { rows: updated } = await client.query<BuildRow>(
      `UPDATE builds
       SET status = 'running',
           updated_at = NOW(),
           started_at = COALESCE(started_at, NOW())
       WHERE id = $1
       RETURNING *`,
      [buildId]
    );
    return updated.length > 0 ? mapBuildRow(updated[0]) : null;
  });

  await emitBuildChanged(build);
  return build;
}

export async function takeNextPendingBuild(): Promise<BuildRecord | null> {
  const build = await useTransaction(async (client) => {
    const { rows } = await client.query<BuildRow>(
      `WITH next_build AS (
         SELECT id
         FROM builds
         WHERE status = 'pending'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE builds b
       SET status = 'running',
           updated_at = NOW(),
           started_at = COALESCE(started_at, NOW())
       FROM next_build
       WHERE b.id = next_build.id
       RETURNING b.*`
    );
    return rows.length > 0 ? mapBuildRow(rows[0]) : null;
  });

  await emitBuildChanged(build);
  return build;
}

export async function appendBuildLog(buildId: string, chunk: string): Promise<void> {
  await useTransaction(async (client) => {
    await client.query(
      `UPDATE builds
       SET logs = COALESCE(logs, '') || $2,
           updated_at = NOW()
       WHERE id = $1`,
      [buildId, chunk]
    );
  });
}

export async function completeBuild(
  buildId: string,
  status: Extract<BuildStatus, 'succeeded' | 'failed'>,
  extra: {
    logs?: string | null;
    imageTag?: string | null;
    errorMessage?: string | null;
    commitSha?: string | null;
    gitBranch?: string | null;
    gitRef?: string | null;
    completedAt?: string;
    durationMs?: number | null;
  } = {}
): Promise<BuildRecord | null> {
  const build = await useTransaction(async (client) => {
    const { rows: existingRows } = await client.query<BuildRow>('SELECT * FROM builds WHERE id = $1 FOR UPDATE', [buildId]);
    if (existingRows.length === 0) {
      return null;
    }
    const existing = existingRows[0];
    const completedAt = extra.completedAt ?? new Date().toISOString();
    const durationFromStart = existing.started_at
      ? Math.max(Date.parse(completedAt) - Date.parse(existing.started_at), 0)
      : null;
    const durationMs = extra.durationMs ?? durationFromStart ?? null;

    const { rows: updatedRows } = await client.query<BuildRow>(
      `UPDATE builds
       SET status = $2,
           logs = COALESCE($3, logs),
           image_tag = COALESCE($4, image_tag),
           error_message = COALESCE($5, error_message),
           commit_sha = COALESCE($6, commit_sha),
           branch = COALESCE($7, branch),
           git_ref = COALESCE($8, git_ref),
           updated_at = $9,
           completed_at = $9,
           duration_ms = $10
       WHERE id = $1
       RETURNING *`,
      [
        buildId,
        status,
        normalizeLogs(extra.logs),
        extra.imageTag ?? null,
        extra.errorMessage ?? null,
        extra.commitSha ?? null,
        extra.gitBranch ?? null,
        extra.gitRef ?? null,
        completedAt,
        durationMs
      ]
    );

    return updatedRows.length > 0 ? mapBuildRow(updatedRows[0]) : null;
  });

  await emitBuildChanged(build);
  return build;
}
