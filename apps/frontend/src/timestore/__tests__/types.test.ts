import { describe, expect, it } from 'vitest';
import { datasetListResponseSchema } from '../types';

describe('timestore types', () => {
  it('parses dataset list responses', () => {
    const result = datasetListResponseSchema.parse({
      datasets: [
        {
          id: 'ds-1',
          slug: 'example.dataset',
          name: 'Example',
          description: null,
          displayName: 'Example',
          status: 'active',
          writeFormat: 'clickhouse',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T01:00:00Z',
          defaultStorageTargetId: null,
          metadata: {}
        }
      ],
      nextCursor: null
    });
    expect(result.datasets).toHaveLength(1);
  });
});
