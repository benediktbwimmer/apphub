import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  type LaunchEnvVar,
  type LaunchRecord,
  type LaunchStatus
} from './types';
import { mapLaunchRow, parseLaunchEnv } from './rowMappers';
import type { LaunchRow } from './rowTypes';
import { emitApphubEvent } from '../events';
import { getRepositoryById } from './repositories';

function normalizeEnv(entries: LaunchEnvVar[] | null | undefined): LaunchEnvVar[] {
  if (!entries) {
    return [];
  }
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    if (!seen.has(key)) {
      seen.set(key, value);
    }
    if (seen.size >= 64) {
      break;
    }
  }
  return Array.from(seen.entries()).map(([key, value]) => ({ key, value }));
}

function serializeEnv(entries: LaunchEnvVar[]): string {
  const normalized = entries.map((entry) => ({ key: entry.key, value: entry.value }));
  return JSON.stringify(normalized);
}

async function emitLaunchChanged(launch: LaunchRecord | null): Promise<void> {
  if (!launch) {
    return;
  }
  emitApphubEvent({ type: 'launch.updated', data: { launch } });
  const repository = await getRepositoryById(launch.repositoryId);
  if (repository) {
    emitApphubEvent({ type: 'repository.updated', data: { repository } });
  }
}

async function fetchLaunchRow(client: PoolClient, launchId: string): Promise<LaunchRow | null> {
  const { rows } = await client.query<LaunchRow>('SELECT * FROM launches WHERE id = $1', [launchId]);
  return rows.length > 0 ? rows[0] : null;
}

async function updateLaunchRecord(
  client: PoolClient,
  launchId: string,
  updates: {
    status?: LaunchStatus;
    instanceUrl?: string | null;
    containerId?: string | null;
    port?: number | null;
    internalPort?: number | null;
    containerIp?: string | null;
    resourceProfile?: string | null;
    command?: string | null;
    env?: LaunchEnvVar[] | null;
    errorMessage?: string | null;
    updatedAt?: string;
    startedAt?: string | null;
    stoppedAt?: string | null;
    expiresAt?: string | null;
  }
): Promise<LaunchRecord | null> {
  const { rows } = await client.query<LaunchRow>('SELECT * FROM launches WHERE id = $1 FOR UPDATE', [launchId]);
  if (rows.length === 0) {
    return null;
  }
  const current = rows[0];

  const envEntries =
    updates.env !== undefined ? normalizeEnv(updates.env ?? []) : parseLaunchEnv(current.env_vars);
  const updatedAt = updates.updatedAt ?? new Date().toISOString();

  const { rows: updatedRows } = await client.query<LaunchRow>(
     `UPDATE launches
     SET status = $2,
         instance_url = $3,
         container_id = $4,
         port = $5,
         internal_port = $6,
         container_ip = $7,
         resource_profile = $8,
         command = $9,
         env_vars = $10::jsonb,
         error_message = $11,
         updated_at = $12,
         started_at = $13,
         stopped_at = $14,
         expires_at = $15
     WHERE id = $1
     RETURNING *`,
    [
      launchId,
      updates.status ?? (current.status as LaunchStatus),
      updates.instanceUrl !== undefined ? updates.instanceUrl : current.instance_url,
      updates.containerId !== undefined ? updates.containerId : current.container_id,
      updates.port !== undefined ? updates.port : current.port,
      updates.internalPort !== undefined ? updates.internalPort : current.internal_port,
      updates.containerIp !== undefined ? updates.containerIp : current.container_ip,
      updates.resourceProfile !== undefined ? updates.resourceProfile : current.resource_profile,
      updates.command !== undefined ? (updates.command ? updates.command.trim() : null) : current.command,
      serializeEnv(envEntries),
      updates.errorMessage !== undefined ? updates.errorMessage : current.error_message,
      updatedAt,
      updates.startedAt !== undefined ? updates.startedAt : current.started_at,
      updates.stoppedAt !== undefined ? updates.stoppedAt : current.stopped_at,
      updates.expiresAt !== undefined ? updates.expiresAt : current.expires_at
    ]
  );

  return updatedRows.length > 0 ? mapLaunchRow(updatedRows[0]) : null;
}

export async function createLaunch(
  repositoryId: string,
  buildId: string,
  options: {
    id?: string;
    resourceProfile?: string | null;
    expiresAt?: string | null;
    env?: LaunchEnvVar[] | null;
    command?: string | null;
  } = {}
): Promise<LaunchRecord> {
  const launchId = options.id?.trim() ?? '';
  const id = launchId.length > 0 ? launchId : randomUUID();
  const envEntries = normalizeEnv(options.env);
  const command = options.command?.trim() ?? null;

  await useTransaction(async (client) => {
    await client.query(
      `INSERT INTO launches (
         id, repository_id, build_id, status, instance_url, container_id, port,
         internal_port, container_ip, resource_profile, command, env_vars,
         error_message, created_at, updated_at, started_at, stopped_at, expires_at
       ) VALUES (
         $1, $2, $3, 'pending', NULL, NULL, NULL,
         NULL, NULL, $4, $5, $6::jsonb,
         NULL, NOW(), NOW(), NULL, NULL, $7
       )
       ON CONFLICT (id) DO NOTHING`,
      [id, repositoryId, buildId, options.resourceProfile ?? null, command, serializeEnv(envEntries), options.expiresAt ?? null]
    );
  });

  const launch = await getLaunchById(id);
  await emitLaunchChanged(launch);
  if (!launch) {
    throw new Error('failed to create launch');
  }
  return launch;
}

export async function getLaunchById(id: string): Promise<LaunchRecord | null> {
  return useConnection(async (client) => {
    const row = await fetchLaunchRow(client, id);
    return row ? mapLaunchRow(row) : null;
  });
}

export async function listLaunchesForRepository(
  repositoryId: string,
  limit = 20
): Promise<LaunchRecord[]> {
  const effective = Math.max(1, Math.min(limit, 100));
  return useConnection(async (client) => {
    const { rows } = await client.query<LaunchRow>(
      `SELECT * FROM launches
       WHERE repository_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [repositoryId, effective]
    );
    return rows.map(mapLaunchRow);
  });
}

export async function startLaunch(launchId: string): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    const row = await fetchLaunchRow(client, launchId);
    if (!row) {
      return null;
    }
    if (row.status === 'starting') {
      return mapLaunchRow(row);
    }
    if (!['pending', 'failed', 'stopped'].includes(row.status)) {
      return null;
    }
    return updateLaunchRecord(client, launchId, {
      status: 'starting',
      instanceUrl: null,
      containerId: null,
      port: null,
      internalPort: null,
      containerIp: null,
      errorMessage: null,
      startedAt: row.started_at ?? null,
      stoppedAt: null
    });
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function updateLaunchEnv(
  launchId: string,
  env: LaunchEnvVar[]
): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    return updateLaunchRecord(client, launchId, { env });
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function markLaunchRunning(
  launchId: string,
  details: {
    instanceUrl?: string | null;
    containerId?: string | null;
    port?: number | null;
    internalPort?: number | null;
    containerIp?: string | null;
    startedAt?: string;
    command?: string;
  }
): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    return updateLaunchRecord(client, launchId, {
      status: 'running',
      instanceUrl: details.instanceUrl ?? null,
      containerId: details.containerId ?? null,
      port: details.port ?? null,
      internalPort: details.internalPort ?? null,
      containerIp: details.containerIp ?? null,
      command: details.command ?? null,
      startedAt: details.startedAt ?? new Date().toISOString(),
      stoppedAt: null,
      errorMessage: null
    });
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function failLaunch(launchId: string, message: string): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    return updateLaunchRecord(client, launchId, {
      status: 'failed',
      errorMessage: message,
      instanceUrl: null,
      containerId: null,
      port: null,
      internalPort: null,
      containerIp: null,
      stoppedAt: new Date().toISOString()
    });
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function requestLaunchStop(launchId: string): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    const row = await fetchLaunchRow(client, launchId);
    if (!row) {
      return null;
    }
    if (row.status === 'stopping') {
      return mapLaunchRow(row);
    }
    if (!['running', 'starting', 'pending'].includes(row.status)) {
      return null;
    }
    return updateLaunchRecord(client, launchId, {
      status: 'stopping',
      errorMessage: null
    });
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function markLaunchStopped(
  launchId: string,
  extra: { stoppedAt?: string; errorMessage?: string | null } = {}
): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    return updateLaunchRecord(client, launchId, {
      status: extra.errorMessage ? 'failed' : 'stopped',
      instanceUrl: null,
      containerId: null,
      port: null,
      internalPort: null,
      containerIp: null,
      stoppedAt: extra.stoppedAt ?? new Date().toISOString(),
      errorMessage: extra.errorMessage ?? null
    });
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function takeNextLaunchToStart(): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    const { rows } = await client.query<LaunchRow>(
      `WITH next_launch AS (
         SELECT id
         FROM launches
         WHERE status = 'pending'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
      )
       UPDATE launches l
       SET status = 'starting',
           updated_at = NOW(),
           error_message = NULL,
           instance_url = NULL,
           container_id = NULL,
           port = NULL,
           internal_port = NULL,
           container_ip = NULL,
           stopped_at = NULL
       FROM next_launch
       WHERE l.id = next_launch.id
       RETURNING l.*`
    );
    return rows.length > 0 ? mapLaunchRow(rows[0]) : null;
  });

  await emitLaunchChanged(launch);
  return launch;
}

export async function takeNextLaunchToStop(): Promise<LaunchRecord | null> {
  const launch = await useTransaction(async (client) => {
    const { rows } = await client.query<LaunchRow>(
      `WITH next_launch AS (
         SELECT id
         FROM launches
         WHERE status = 'stopping'
         ORDER BY updated_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE launches l
       SET updated_at = NOW()
       FROM next_launch
       WHERE l.id = next_launch.id
       RETURNING l.*`
    );
    return rows.length > 0 ? mapLaunchRow(rows[0]) : null;
  });

  await emitLaunchChanged(launch);
  return launch;
}
