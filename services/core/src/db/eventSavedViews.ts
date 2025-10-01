import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  type EventSavedViewRecord,
  type EventSavedViewCreateInput,
  type EventSavedViewUpdateInput,
  type EventSavedViewOwner,
  type EventSavedViewFilters,
  type EventSavedViewVisibility,
  type EventSavedViewAnalytics
} from './types';
import { useConnection, useTransaction } from './utils';
import { mapEventSavedViewRow, mapWorkflowEventRow } from './rowMappers';
import type { EventSavedViewRow, WorkflowEventRow } from './rowTypes';
import { buildWorkflowEventView } from '../workflowEventInsights';
import type { WorkflowEventRecord } from './types';
import type { WorkflowEventRecordView, WorkflowEventSeverity } from '@apphub/shared/coreEvents';

const DEFAULT_VISIBILITY: EventSavedViewVisibility = 'private';
const WILDCARD_PATTERN = /[*]/;
const MIN_WINDOW_SECONDS = 60;
const MAX_WINDOW_SECONDS = 86_400;
const DEFAULT_WINDOW_SECONDS = 900;
const MIN_SAMPLE_LIMIT = 100;
const MAX_SAMPLE_LIMIT = 5_000;
const DEFAULT_SAMPLE_LIMIT = 2_000;

const VALID_VISIBILITIES = new Set<EventSavedViewVisibility>(['private', 'shared']);
const VALID_SEVERITIES: readonly WorkflowEventSeverity[] = ['critical', 'error', 'warning', 'info', 'debug'];

function normalizeName(value: string): string {
  const fallback = 'Untitled view';
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeVisibility(value: unknown): EventSavedViewVisibility {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (VALID_VISIBILITIES.has(normalized as EventSavedViewVisibility)) {
      return normalized as EventSavedViewVisibility;
    }
  }
  return DEFAULT_VISIBILITY;
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLimit(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    if (normalized < 1) {
      return 1;
    }
    if (normalized > 200) {
      return 200;
    }
    return normalized;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return normalizeLimit(parsed);
    }
  }
  return null;
}

type NormalizedEventSavedViewFilters = {
  type: string | null;
  source: string | null;
  correlationId: string | null;
  from: string | null;
  to: string | null;
  jsonPath: string | null;
  severity: WorkflowEventSeverity[];
  severitySet: Set<WorkflowEventSeverity>;
  limit: number | null;
};

type NormalizedFiltersResult = {
  normalized: NormalizedEventSavedViewFilters;
  storage: Record<string, unknown>;
};

function normalizeFiltersInput(input: EventSavedViewFilters | null | undefined): NormalizedFiltersResult {
  const source = input ?? {};
  const type = sanitizeString(source.type ?? null);
  const eventSource = sanitizeString(source.source ?? null);
  const correlationId = sanitizeString(source.correlationId ?? null);
  const from = sanitizeString(source.from ?? null);
  const to = sanitizeString(source.to ?? null);
  const jsonPath = sanitizeString(source.jsonPath ?? null);

  const severityEntries = Array.isArray(source.severity) ? source.severity : [];
  const severitySet = new Set<WorkflowEventSeverity>();
  for (const entry of severityEntries) {
    if (typeof entry !== 'string') {
      continue;
    }
    const normalized = entry.trim().toLowerCase();
    if (VALID_SEVERITIES.includes(normalized as WorkflowEventSeverity)) {
      severitySet.add(normalized as WorkflowEventSeverity);
    }
  }
  const severity = Array.from(severitySet);

  const limit = normalizeLimit(source.limit ?? null);

  const storage: Record<string, unknown> = {};
  if (type) {
    storage.type = type;
  }
  if (eventSource) {
    storage.source = eventSource;
  }
  if (correlationId) {
    storage.correlationId = correlationId;
  }
  if (from) {
    storage.from = from;
  }
  if (to) {
    storage.to = to;
  }
  if (jsonPath) {
    storage.jsonPath = jsonPath;
  }
  if (severity.length > 0) {
    storage.severity = severity;
  }
  if (typeof limit === 'number') {
    storage.limit = limit;
  }

  return {
    normalized: {
      type,
      source: eventSource,
      correlationId,
      from,
      to,
      jsonPath,
      severity,
      severitySet,
      limit
    },
    storage
  } satisfies NormalizedFiltersResult;
}

function serializeFilters(filters: Record<string, unknown>): string {
  return JSON.stringify(filters);
}

function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'view';
}

async function slugExists(client: PoolClient, slug: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM event_saved_views WHERE slug = $1 LIMIT 1', [slug]);
  return rows.length > 0;
}

async function generateUniqueSlug(client: PoolClient, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let attempts = 0;
  while (await slugExists(client, candidate)) {
    attempts += 1;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 6);
    candidate = `${base}-${suffix}`.slice(0, 80);
    if (attempts > 8) {
      candidate = `${base}-${randomUUID()}`.slice(0, 80);
      break;
    }
  }
  return candidate;
}

async function fetchViewBySlug(
  client: PoolClient,
  slug: string,
  ownerKey: string,
  options: { includeShared?: boolean } = {}
): Promise<EventSavedViewRecord | null> {
  const includeShared = options.includeShared ?? false;
  const params: Array<string | boolean> = [slug, ownerKey];
  let query = 'SELECT * FROM event_saved_views WHERE slug = $1 AND owner_key = $2';
  if (includeShared) {
    query = `SELECT * FROM event_saved_views WHERE slug = $1 AND (owner_key = $2 OR visibility = 'shared')`;
  }
  const { rows } = await client.query<EventSavedViewRow>(query, params);
  const row = rows[0];
  return row ? mapEventSavedViewRow(row) : null;
}

function isExactFilterValue(value: string | null): boolean {
  if (!value) {
    return false;
  }
  if (value.endsWith('.')) {
    return false;
  }
  return !WILDCARD_PATTERN.test(value);
}

function matchesText(value: string | null, filter: string | null): boolean {
  if (!filter) {
    return true;
  }
  if (!value) {
    return false;
  }
  const candidate = value.toLowerCase();
  const pattern = filter.toLowerCase();
  if (WILDCARD_PATTERN.test(pattern)) {
    const tokens = pattern.split('*').map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`^${tokens.join('.*')}$`);
    return regex.test(candidate);
  }
  if (pattern.endsWith('.')) {
    return candidate.startsWith(pattern.slice(0, -1));
  }
  return candidate.includes(pattern);
}

function matchesTimeRange(timestamp: string, from: string | null, to: string | null): boolean {
  const occurred = Date.parse(timestamp);
  if (!Number.isFinite(occurred)) {
    return true;
  }
  if (from) {
    const fromMs = Date.parse(from);
    if (Number.isFinite(fromMs) && occurred < fromMs) {
      return false;
    }
  }
  if (to) {
    const toMs = Date.parse(to);
    if (Number.isFinite(toMs) && occurred > toMs) {
      return false;
    }
  }
  return true;
}

function matchesSeverityFilter(
  severity: WorkflowEventSeverity,
  severitySet: Set<WorkflowEventSeverity>
): boolean {
  if (severitySet.size === 0) {
    return true;
  }
  return severitySet.has(severity);
}

function matchesFilters(view: WorkflowEventRecordView, filters: NormalizedEventSavedViewFilters): boolean {
  if (!matchesText(view.type, filters.type)) {
    return false;
  }
  if (!matchesText(view.source, filters.source)) {
    return false;
  }
  if (!matchesText(view.correlationId ?? null, filters.correlationId)) {
    return false;
  }
  if (!matchesSeverityFilter(view.severity ?? 'info', filters.severitySet)) {
    return false;
  }
  if (!matchesTimeRange(view.occurredAt, filters.from, filters.to)) {
    return false;
  }
  return true;
}

export async function listEventSavedViews(
  owner: EventSavedViewOwner,
  options: { includeShared?: boolean } = {}
): Promise<EventSavedViewRecord[]> {
  const includeShared = options.includeShared ?? true;
  return useConnection(async (client) => {
    const params: string[] = [owner.key];
    let query = 'SELECT * FROM event_saved_views WHERE owner_key = $1 ORDER BY name ASC';
    if (includeShared) {
      query =
        "SELECT * FROM event_saved_views WHERE owner_key = $1 OR visibility = 'shared' ORDER BY name ASC";
    }
    const { rows } = await client.query<EventSavedViewRow>(query, params);
    return rows.map(mapEventSavedViewRow);
  });
}

export async function getEventSavedViewBySlug(
  owner: EventSavedViewOwner,
  slug: string,
  options: { includeShared?: boolean } = {}
): Promise<EventSavedViewRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  return useConnection((client) => fetchViewBySlug(client, normalizedSlug, owner.key, options));
}

export async function createEventSavedView(
  owner: EventSavedViewOwner,
  input: EventSavedViewCreateInput
): Promise<EventSavedViewRecord> {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description ?? null);
  const { storage } = normalizeFiltersInput(input.filters ?? {});
  const filtersJson = serializeFilters(storage);
  const visibility = normalizeVisibility(input.visibility);

  return useTransaction(async (client) => {
    const slug = await generateUniqueSlug(client, name);
    const id = randomUUID();

    const { rows } = await client.query<EventSavedViewRow>(
      `INSERT INTO event_saved_views (
         id,
         slug,
         owner_key,
         owner_user_id,
         owner_subject,
         owner_kind,
         owner_token_hash,
         name,
         description,
         filters,
         visibility
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
         $11
       )
       RETURNING *`,
      [
        id,
        slug,
        owner.key,
        owner.userId,
        owner.subject,
        owner.kind,
        owner.tokenHash,
        name,
        description,
        filtersJson,
        visibility
      ]
    );

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create event saved view');
    }
    return mapEventSavedViewRow(row);
  });
}

export async function updateEventSavedView(
  owner: EventSavedViewOwner,
  slug: string,
  updates: EventSavedViewUpdateInput
): Promise<EventSavedViewRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  return useTransaction(async (client) => {
    const existing = await fetchViewBySlug(client, normalizedSlug, owner.key, { includeShared: false });
    if (!existing) {
      return null;
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let index = 1;

    if (updates.name !== undefined) {
      sets.push(`name = $${index}`);
      params.push(normalizeName(updates.name ?? existing.name));
      index += 1;
    }

    if (updates.description !== undefined) {
      sets.push(`description = $${index}`);
      params.push(normalizeDescription(updates.description ?? null));
      index += 1;
    }

    if (updates.filters !== undefined) {
      const { storage } = normalizeFiltersInput(updates.filters ?? {});
      sets.push(`filters = $${index}::jsonb`);
      params.push(serializeFilters(storage));
      index += 1;
    }

    if (updates.visibility !== undefined) {
      sets.push(`visibility = $${index}`);
      params.push(normalizeVisibility(updates.visibility));
      index += 1;
    }

    if (sets.length === 1) {
      // Only updated_at would be mutated; avoid unnecessary write.
      return existing;
    }

    const slugIndex = index;
    params.push(normalizedSlug);
    index += 1;
    const ownerIndex = index;
    params.push(owner.key);

    const query = `UPDATE event_saved_views SET ${sets.join(', ')} WHERE slug = $${slugIndex} AND owner_key = $${ownerIndex} RETURNING *`;

    const { rows } = await client.query<EventSavedViewRow>(query, params);
    const row = rows[0];
    return row ? mapEventSavedViewRow(row) : null;
  });
}

export async function deleteEventSavedView(owner: EventSavedViewOwner, slug: string): Promise<boolean> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return false;
  }
  const result = await useConnection((client) =>
    client.query('DELETE FROM event_saved_views WHERE slug = $1 AND owner_key = $2', [normalizedSlug, owner.key])
  );
  return (result.rowCount ?? 0) > 0;
}

export async function recordEventSavedViewApplied(slug: string): Promise<EventSavedViewRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  const { rows } = await useConnection((client) =>
    client.query<EventSavedViewRow>(
      `UPDATE event_saved_views
         SET applied_count = applied_count + 1,
             last_applied_at = NOW(),
             updated_at = NOW()
       WHERE slug = $1
       RETURNING *`,
      [normalizedSlug]
    )
  );
  const row = rows[0];
  return row ? mapEventSavedViewRow(row) : null;
}

export async function recordEventSavedViewShared(
  owner: EventSavedViewOwner,
  slug: string
): Promise<EventSavedViewRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  const { rows } = await useConnection((client) =>
    client.query<EventSavedViewRow>(
      `UPDATE event_saved_views
         SET visibility = 'shared',
             shared_count = shared_count + 1,
             last_shared_at = NOW(),
             updated_at = NOW()
       WHERE slug = $1 AND owner_key = $2
       RETURNING *`,
      [normalizedSlug, owner.key]
    )
  );
  const row = rows[0];
  return row ? mapEventSavedViewRow(row) : null;
}

function clampWindowSeconds(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_WINDOW_SECONDS;
  }
  const normalized = Math.trunc(value);
  if (normalized < MIN_WINDOW_SECONDS) {
    return MIN_WINDOW_SECONDS;
  }
  if (normalized > MAX_WINDOW_SECONDS) {
    return MAX_WINDOW_SECONDS;
  }
  return normalized;
}

function clampSampleLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_SAMPLE_LIMIT;
  }
  const normalized = Math.trunc(value);
  if (normalized < MIN_SAMPLE_LIMIT) {
    return MIN_SAMPLE_LIMIT;
  }
  if (normalized > MAX_SAMPLE_LIMIT) {
    return MAX_SAMPLE_LIMIT;
  }
  return normalized;
}

export async function getEventSavedViewAnalytics(
  filters: EventSavedViewFilters,
  options: { windowSeconds?: number; sampleLimit?: number } = {}
): Promise<EventSavedViewAnalytics> {
  const { normalized } = normalizeFiltersInput(filters);
  const windowSeconds = clampWindowSeconds(options.windowSeconds);
  const sampleLimit = clampSampleLimit(options.sampleLimit);

  const conditions: string[] = [];
  const params: Array<string | number> = [];
  let index = 1;

  conditions.push(`occurred_at >= NOW() - ($${index}::int * INTERVAL '1 second')`);
  params.push(windowSeconds);
  index += 1;

  if (normalized.from) {
    conditions.push(`occurred_at >= $${index}`);
    params.push(normalized.from);
    index += 1;
  }

  if (normalized.to) {
    conditions.push(`occurred_at <= $${index}`);
    params.push(normalized.to);
    index += 1;
  }

  if (normalized.type && isExactFilterValue(normalized.type)) {
    conditions.push(`type = $${index}`);
    params.push(normalized.type);
    index += 1;
  }

  if (normalized.source && isExactFilterValue(normalized.source)) {
    conditions.push(`source = $${index}`);
    params.push(normalized.source);
    index += 1;
  }

  if (normalized.correlationId) {
    conditions.push(`correlation_id = $${index}`);
    params.push(normalized.correlationId);
    index += 1;
  }

  if (normalized.jsonPath) {
    conditions.push(`jsonb_path_exists(payload, $${index}::jsonpath)`);
    params.push(normalized.jsonPath);
    index += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT id, type, source, occurred_at, received_at, payload, correlation_id, ttl_ms, metadata
    FROM workflow_events
    ${whereClause}
    ORDER BY occurred_at DESC
    LIMIT $${index}`;
  params.push(sampleLimit);

  const rows = await useConnection(async (client) => {
    const result = await client.query<WorkflowEventRow>(query, params);
    return result.rows;
  });

  const records: WorkflowEventRecord[] = rows.map(mapWorkflowEventRow);
  const views: WorkflowEventRecordView[] = records.map((record) => buildWorkflowEventView(record));
  const filtered = views.filter((view) => matchesFilters(view, normalized));

  const totalEvents = filtered.length;
  let errorEvents = 0;
  for (const view of filtered) {
    if (view.severity === 'error' || view.severity === 'critical') {
      errorEvents += 1;
    }
  }

  const windowMinutes = windowSeconds / 60;
  const eventRatePerMinute = windowMinutes > 0 ? totalEvents / windowMinutes : 0;
  const errorRatio = totalEvents > 0 ? errorEvents / totalEvents : 0;

  return {
    windowSeconds,
    totalEvents,
    errorEvents,
    eventRatePerMinute,
    errorRatio,
    generatedAt: new Date().toISOString(),
    sampledCount: views.length,
    sampleLimit,
    truncated: views.length === sampleLimit
  } satisfies EventSavedViewAnalytics;
}

export type { EventSavedViewRecord, EventSavedViewOwner } from './types';
