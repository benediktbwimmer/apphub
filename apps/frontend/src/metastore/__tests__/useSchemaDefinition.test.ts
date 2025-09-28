import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSchemaDefinition } from '../useSchemaDefinition';
import type { MetastoreSchemaDefinition } from '../types';

vi.mock('../api', () => ({
  fetchSchemaDefinition: vi.fn()
}));

import { fetchSchemaDefinition } from '../api';

const fetchSchemaDefinitionMock = vi.mocked(fetchSchemaDefinition);

const authorizedFetchMock = vi.fn();

const schema: MetastoreSchemaDefinition = {
  schemaHash: 'sha256:abc123',
  name: 'Metrics payload',
  description: 'Schema description',
  version: '1.0.0',
  metadata: {},
  fields: [
    { path: 'name', type: 'string', required: true },
    { path: 'value', type: 'number' }
  ],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  cache: 'database'
};

afterEach(() => {
  fetchSchemaDefinitionMock.mockReset();
  authorizedFetchMock.mockClear();
});

describe('useSchemaDefinition', () => {
  it('returns idle state when hash is missing', () => {
    const { result } = renderHook(() => useSchemaDefinition(authorizedFetchMock, null));
    expect(result.current.status).toBe('idle');
    expect(result.current.schema).toBeNull();
    expect(fetchSchemaDefinitionMock).not.toHaveBeenCalled();
  });

  it('loads schema definition when hash is provided', async () => {
    fetchSchemaDefinitionMock.mockResolvedValueOnce({ status: 'found', schema });

    const { result } = renderHook(() => useSchemaDefinition(authorizedFetchMock, schema.schemaHash));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.schema).toEqual(schema);
    expect(fetchSchemaDefinitionMock).toHaveBeenCalledWith(authorizedFetchMock, schema.schemaHash, expect.any(Object));
  });

  it('handles missing schema definitions', async () => {
    fetchSchemaDefinitionMock.mockResolvedValueOnce({ status: 'missing', message: 'Schema not found' });

    const { result } = renderHook(() => useSchemaDefinition(authorizedFetchMock, schema.schemaHash));

    await waitFor(() => {
      expect(result.current.status).toBe('missing');
    });

    expect(result.current.missingMessage).toBe('Schema not found');
  });

  it('handles fetch errors gracefully', async () => {
    fetchSchemaDefinitionMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useSchemaDefinition(authorizedFetchMock, schema.schemaHash));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBe('boom');
  });
});
