import { describe, expect, it } from 'vitest';
import type { WorkflowEventSample } from '../../workflows/types';
import { buildEventsQuery, matchesEventFilters, prepareEventFilters } from '../filtering';
import { DEFAULT_EVENTS_FILTERS, normalizeFilters } from '../explorerTypes';

const baseEvent: WorkflowEventSample = {
  id: 'evt-1',
  type: 'metastore.record.updated',
  source: 'metastore.api',
  occurredAt: '2025-01-01T00:00:00.000Z',
  receivedAt: '2025-01-01T00:00:01.000Z',
  payload: { assetId: 'asset-1', details: { status: 'updated' } },
  correlationId: 'req-123',
  ttlMs: null,
  metadata: { region: 'iad' },
  severity: 'warning',
  links: null,
  derived: null
};

describe('event filtering helpers', () => {
  it('matches events using exact filters and severities', () => {
    const filters = normalizeFilters({
      ...DEFAULT_EVENTS_FILTERS,
      type: 'metastore.record.updated',
      source: 'metastore.api',
      correlationId: 'req-123',
      severity: ['warning']
    });
    const prepared = prepareEventFilters(filters);
    expect(matchesEventFilters(baseEvent, prepared)).toBe(true);
  });

  it('matches events using partial text filters and JSONPath predicates', () => {
    const filters = normalizeFilters({
      ...DEFAULT_EVENTS_FILTERS,
      type: 'metastore.',
      source: 'metastore',
      jsonPath: '$.assetId'
    });
    const prepared = prepareEventFilters(filters);
    expect(matchesEventFilters(baseEvent, prepared)).toBe(true);
  });

  it('rejects events when severity or time window does not match', () => {
    const filters = normalizeFilters({
      ...DEFAULT_EVENTS_FILTERS,
      severity: ['critical'],
      from: '2025-01-02T00:00:00.000Z'
    });
    const prepared = prepareEventFilters(filters);
    expect(matchesEventFilters(baseEvent, prepared)).toBe(false);
  });

  it('builds queries only with exact values', () => {
    const filters = normalizeFilters({
      ...DEFAULT_EVENTS_FILTERS,
      type: 'metastore.record.updated',
      source: 'metastore.',
      correlationId: 'req-123',
      jsonPath: '$.assetId'
    });
    const query = buildEventsQuery(filters, 'cursor-1');
    expect(query).toMatchObject({
      type: 'metastore.record.updated',
      correlationId: 'req-123',
      jsonPath: '$.assetId',
      cursor: 'cursor-1',
      limit: filters.limit
    });
    expect(query.source).toBeUndefined();
  });
});
