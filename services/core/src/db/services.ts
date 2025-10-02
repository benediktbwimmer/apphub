import { randomUUID } from 'node:crypto';
import { useConnection, useTransaction } from './utils';
import {
  type JsonValue,
  type ServiceRecord,
  type ServiceStatusUpdate,
  type ServiceUpsertInput
} from './types';
import { mapServiceRow } from './rowMappers';
import type { ServiceRow } from './rowTypes';
import { emitApphubEvent } from '../events';

function jsonEquals(a: JsonValue | null, b: JsonValue | null): boolean {
  if (a === b) {
    return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function toJsonParameter(value: JsonValue | null): JsonValue | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

async function fetchServiceBySlug(client: import('pg').PoolClient, slug: string): Promise<ServiceRecord | null> {
  const { rows } = await client.query<ServiceRow>('SELECT * FROM services WHERE slug = $1', [slug]);
  return rows.length > 0 ? mapServiceRow(rows[0]) : null;
}

async function emitServiceUpdated(service: ServiceRecord | null): Promise<void> {
  if (!service) {
    return;
  }
  emitApphubEvent({ type: 'service.updated', data: { service } });
}

export async function listServices(): Promise<ServiceRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceRow>('SELECT * FROM services ORDER BY slug ASC');
    return rows.map(mapServiceRow);
  });
}

export async function getServiceBySlug(slug: string): Promise<ServiceRecord | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return useConnection((client) => fetchServiceBySlug(client, normalized));
}

export async function upsertService(input: ServiceUpsertInput): Promise<ServiceRecord> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    throw new Error('Service slug must be provided');
  }
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    throw new Error('Service baseUrl must be provided');
  }
  const displayName = input.displayName.trim();
  const kind = input.kind.trim();
  const now = new Date().toISOString();
  const source = input.source ?? null;

  const record = await useTransaction(async (client) => {
    const existing = await fetchServiceBySlug(client, slug);

    const resolvedDisplayName = displayName.length > 0 ? displayName : existing?.displayName ?? slug;
    const status = input.status ?? existing?.status ?? 'unknown';
    const statusMessage = Object.prototype.hasOwnProperty.call(input, 'statusMessage')
      ? input.statusMessage ?? null
      : existing?.statusMessage ?? null;
    const capabilities = Object.prototype.hasOwnProperty.call(input, 'capabilities')
      ? (input.capabilities ?? null)
      : existing?.capabilities ?? null;
    const metadata = Object.prototype.hasOwnProperty.call(input, 'metadata')
      ? (input.metadata ?? null)
      : existing?.metadata ?? null;

    const createdAt = existing?.createdAt ?? now;
    const resolvedSource = source ?? existing?.source ?? 'external';

    const next: ServiceRecord = {
      id: existing?.id ?? randomUUID(),
      slug,
      displayName: resolvedDisplayName,
      kind,
      baseUrl,
      source: resolvedSource,
      status,
      statusMessage,
      capabilities,
      metadata,
      lastHealthyAt: existing?.lastHealthyAt ?? null,
      createdAt,
      updatedAt: now
    } satisfies ServiceRecord;

    const unchanged =
      existing &&
      existing.displayName === next.displayName &&
      existing.kind === next.kind &&
      existing.baseUrl === next.baseUrl &&
      existing.source === next.source &&
      existing.status === next.status &&
      existing.statusMessage === next.statusMessage &&
      existing.lastHealthyAt === next.lastHealthyAt &&
      jsonEquals(existing.capabilities, next.capabilities) &&
      jsonEquals(existing.metadata, next.metadata);

    if (unchanged) {
      return existing;
    }

    await client.query(
      `INSERT INTO services (
         id, slug, display_name, kind, base_url, source, status, status_message,
         capabilities, metadata, last_healthy_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       )
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         kind = EXCLUDED.kind,
         base_url = EXCLUDED.base_url,
         source = EXCLUDED.source,
         status = EXCLUDED.status,
         status_message = EXCLUDED.status_message,
         capabilities = EXCLUDED.capabilities,
         metadata = EXCLUDED.metadata,
         last_healthy_at = EXCLUDED.last_healthy_at,
         updated_at = EXCLUDED.updated_at`,
      [
        next.id,
        slug,
        next.displayName,
        next.kind,
        next.baseUrl,
        next.source,
        next.status,
        next.statusMessage,
        toJsonParameter(next.capabilities),
        toJsonParameter(next.metadata),
        next.lastHealthyAt,
        next.createdAt,
        next.updatedAt
      ]
    );

    const updated = await fetchServiceBySlug(client, slug);
    return updated ?? next;
  });

  await emitServiceUpdated(record);
  return record;
}

export async function setServiceStatus(
  slug: string,
  update: ServiceStatusUpdate
): Promise<ServiceRecord | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const record = await useTransaction(async (client) => {
    const existing = await fetchServiceBySlug(client, normalized);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const baseUrl = update.baseUrl ? update.baseUrl.trim() : existing.baseUrl;
    const status = update.status ?? existing.status;
    const statusMessage = Object.prototype.hasOwnProperty.call(update, 'statusMessage')
      ? update.statusMessage ?? null
      : existing.statusMessage ?? null;
    const capabilities = Object.prototype.hasOwnProperty.call(update, 'capabilities')
      ? update.capabilities ?? null
      : existing.capabilities ?? null;
    const metadata = Object.prototype.hasOwnProperty.call(update, 'metadata')
      ? update.metadata ?? null
      : existing.metadata ?? null;
    let lastHealthyAt = existing.lastHealthyAt;
    if (Object.prototype.hasOwnProperty.call(update, 'lastHealthyAt')) {
      lastHealthyAt = update.lastHealthyAt ?? null;
    } else if (status === 'healthy' && existing.status !== 'healthy') {
      lastHealthyAt = now;
    }

    const next: ServiceRecord = {
      ...existing,
      baseUrl,
      status,
      statusMessage,
      capabilities,
      metadata,
      lastHealthyAt,
      updatedAt: now
    } satisfies ServiceRecord;

    const unchanged =
      next.status === existing.status &&
      next.statusMessage === existing.statusMessage &&
      next.baseUrl === existing.baseUrl &&
      next.lastHealthyAt === existing.lastHealthyAt &&
      jsonEquals(next.capabilities, existing.capabilities) &&
      jsonEquals(next.metadata, existing.metadata);

    if (unchanged) {
      return existing;
    }

    await client.query(
      `UPDATE services
       SET base_url = $2,
           status = $3,
           status_message = $4,
           capabilities = $5,
           metadata = $6,
           last_healthy_at = $7,
           updated_at = $8
       WHERE slug = $1`,
      [
        normalized,
        next.baseUrl,
        next.status,
        next.statusMessage,
        toJsonParameter(next.capabilities),
        toJsonParameter(next.metadata),
        next.lastHealthyAt,
        next.updatedAt
      ]
    );

    const updated = await fetchServiceBySlug(client, normalized);
    return updated ?? next;
  });

  await emitServiceUpdated(record);
  return record;
}
