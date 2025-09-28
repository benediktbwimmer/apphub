import { describe, expect, it } from 'vitest';
import {
  buildQueryPayload,
  createEmptyClause,
  decodeClausesFromUrl,
  encodeClausesForUrl,
  decodeDslFromUrl,
  encodeDslForUrl,
  sanitizeClauses,
  type QueryClause
} from '../queryComposer';

function clause(partial: Partial<QueryClause>): QueryClause {
  return {
    ...createEmptyClause(),
    ...partial
  } satisfies QueryClause;
}

describe('queryComposer', () => {
  it('builds q payloads for simple key and metadata filters', () => {
    const clauses = [
      clause({ field: 'key', operator: 'equals', value: 'dataset/users' }),
      clause({ field: 'metadata', operator: 'equals', path: 'status', value: 'active' })
    ];

    const payload = buildQueryPayload(clauses);

    expect(payload.q).toBe('key:"dataset/users" status:active');
    expect(payload.filter).toBeUndefined();
  });

  it('creates tag and owner filters when operators require DSL', () => {
    const clauses = [
      clause({ field: 'tags', operator: 'includesAny', value: 'critical, workflows' }),
      clause({ field: 'owner', operator: 'exists', value: '' })
    ];

    const payload = buildQueryPayload(clauses);

    expect(payload.q).toBeUndefined();
    expect(payload.filter).toEqual({
      type: 'group',
      operator: 'and',
      filters: [
        {
          type: 'condition',
          condition: { field: 'tags', operator: 'array_contains', value: ['critical', 'workflows'] }
        },
        {
          type: 'condition',
          condition: { field: 'owner', operator: 'exists' }
        }
      ]
    });
  });

  it('supports metadata contains filters with JSON coercion', () => {
    const clauses = [
      clause({ field: 'metadata', operator: 'contains', path: 'thresholds', value: '{"latencyMs":150}' })
    ];

    const payload = buildQueryPayload(clauses);

    expect(payload.q).toBeUndefined();
    expect(payload.filter).toEqual({
      type: 'condition',
      condition: { field: 'metadata.thresholds', operator: 'contains', value: { latencyMs: 150 } }
    });
  });

  it('encodes and decodes clause payloads for URL persistence', () => {
    const clauses = sanitizeClauses([
      clause({ field: 'key', operator: 'equals', value: 'pipeline-1' }),
      clause({ field: 'tags', operator: 'includesAny', value: 'beta' })
    ]);

    const encoded = encodeClausesForUrl(clauses);
    expect(encoded).toBeTruthy();

    const decoded = decodeClausesFromUrl(encoded);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.field).toBe('key');
    expect(decoded[0]?.value).toBe('pipeline-1');
    expect(decoded[1]?.field).toBe('tags');
  });

  it('returns an empty clause when decoding fails', () => {
    const decoded = decodeClausesFromUrl('invalid');
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.field).toBe('key');
  });

  it('encodes and decodes advanced DSL payloads', () => {
    const input = '{"field":"metadata.status","operator":"eq","value":"active"}';
    const encoded = encodeDslForUrl(input);
    expect(encoded).toBeTruthy();
    const decoded = decodeDslFromUrl(encoded);
    expect(decoded).toBe(input);
  });
});
