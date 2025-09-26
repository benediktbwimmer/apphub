import { describe, expect, it } from 'vitest';
import { datasetListResponseSchema } from '../types';

describe('timestore types', () => {
  it('parses dataset list responses', () => {
    const result = datasetListResponseSchema.parse({
      datasets: [
        {
          id: 'ds-1',
          slug: 'example.dataset',
          displayName: 'Example',
          status: 'active',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T01:00:00Z',
          storageTargetId: null,
          metadata: {}
        }
      ],
      nextCursor: null
    });
    expect(result.datasets).toHaveLength(1);
  });
});
