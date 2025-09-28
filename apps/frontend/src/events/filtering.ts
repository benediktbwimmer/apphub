import { JSONPath } from 'jsonpath-plus';
import type { WorkflowEventSample, WorkflowEventSeverity } from '../workflows/types';
import type { WorkflowEventSampleQuery } from '../workflows/api';
import type { EventsExplorerFilters } from './explorerTypes';

export type PreparedEventFilters = {
  filters: EventsExplorerFilters;
  typeFilter: string | null;
  sourceFilter: string | null;
  correlationFilter: string | null;
  severitySet: Set<WorkflowEventSeverity>;
  fromTime: number | null;
  toTime: number | null;
  jsonPath: string | null;
};

const WILDCARD_PATTERN = /[*]/;

function toTimestamp(value: string): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sanitizeFilter(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesText(value: string | null | undefined, filter: string | null): boolean {
  if (!filter) {
    return true;
  }
  if (!value) {
    return false;
  }
  const candidate = value.toLowerCase();
  const pattern = filter.toLowerCase();
  if (WILDCARD_PATTERN.test(pattern)) {
    const tokens = pattern.split('*').map(escapeRegex);
    const regex = new RegExp(`^${tokens.join('.*')}$`);
    return regex.test(candidate);
  }
  if (pattern.endsWith('.')) {
    return candidate.startsWith(pattern.slice(0, -1));
  }
  return candidate.includes(pattern);
}

function evaluateJsonPath(path: string, payload: unknown): boolean {
  try {
    const result = JSONPath({ path, json: payload, wrap: true }) as unknown[];
    return Array.isArray(result) && result.length > 0;
  } catch {
    return false;
  }
}

export function isExactFilterValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.endsWith('.')) {
    return false;
  }
  return !WILDCARD_PATTERN.test(normalized);
}

export function prepareEventFilters(filters: EventsExplorerFilters): PreparedEventFilters {
  const typeFilter = sanitizeFilter(filters.type);
  const sourceFilter = sanitizeFilter(filters.source);
  const correlationFilter = sanitizeFilter(filters.correlationId);
  const jsonPath = sanitizeFilter(filters.jsonPath);
  const severitySet = new Set(filters.severity);
  return {
    filters,
    typeFilter,
    sourceFilter,
    correlationFilter,
    jsonPath,
    severitySet,
    fromTime: toTimestamp(filters.from),
    toTime: toTimestamp(filters.to)
  } satisfies PreparedEventFilters;
}

export function matchesEventFilters(event: WorkflowEventSample, prepared: PreparedEventFilters): boolean {
  if (!matchesText(event.type, prepared.typeFilter)) {
    return false;
  }
  if (!matchesText(event.source, prepared.sourceFilter)) {
    return false;
  }
  if (!matchesText(event.correlationId, prepared.correlationFilter)) {
    return false;
  }

  if (prepared.severitySet.size > 0) {
    const severity = event.severity ?? null;
    if (!severity || !prepared.severitySet.has(severity)) {
      return false;
    }
  }

  const occurredMs = Date.parse(event.occurredAt);
  if (prepared.fromTime !== null && Number.isFinite(occurredMs) && occurredMs < prepared.fromTime) {
    return false;
  }
  if (prepared.toTime !== null && Number.isFinite(occurredMs) && occurredMs > prepared.toTime) {
    return false;
  }

  if (prepared.jsonPath && !evaluateJsonPath(prepared.jsonPath, event.payload)) {
    return false;
  }

  return true;
}

export function buildEventsQuery(
  filters: EventsExplorerFilters,
  cursor?: string | null
): WorkflowEventSampleQuery {
  const query: WorkflowEventSampleQuery = {};
  if (filters.type && isExactFilterValue(filters.type)) {
    query.type = filters.type.trim();
  }
  if (filters.source && isExactFilterValue(filters.source)) {
    query.source = filters.source.trim();
  }
  if (filters.correlationId.trim()) {
    query.correlationId = filters.correlationId.trim();
  }
  if (filters.from.trim()) {
    query.from = filters.from.trim();
  }
  if (filters.to.trim()) {
    query.to = filters.to.trim();
  }
  if (filters.jsonPath.trim()) {
    query.jsonPath = filters.jsonPath.trim();
  }
  query.limit = filters.limit;
  if (cursor) {
    query.cursor = cursor;
  }
  return query;
}

export function sortEventsByOccurredAt(events: WorkflowEventSample[]): WorkflowEventSample[] {
  return [...events].sort((left, right) => {
    const leftMs = Date.parse(left.occurredAt);
    const rightMs = Date.parse(right.occurredAt);
    if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) {
      return 0;
    }
    if (!Number.isFinite(leftMs)) {
      return 1;
    }
    if (!Number.isFinite(rightMs)) {
      return -1;
    }
    return rightMs - leftMs;
  });
}
