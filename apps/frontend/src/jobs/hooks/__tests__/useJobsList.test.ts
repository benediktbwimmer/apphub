import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJobsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({
    activeToken: 'token-123',
    identity: null,
    identityLoading: false,
    identityError: null,
    refreshIdentity: vi.fn(),
    apiKeys: [],
    apiKeysLoading: false,
    apiKeysError: null,
    refreshApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    setActiveToken: vi.fn()
  })
}));

vi.mock('../../api', () => ({
  fetchJobs: (...args: unknown[]) => fetchJobsMock(...args)
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import type { JobDefinitionSummary } from '../../../workflows/api';
import { useJobsList } from '../useJobsList';

function makeJob(
  slug: string,
  overrides: Partial<JobDefinitionSummary> = {}
): JobDefinitionSummary {
  const now = new Date().toISOString();
  return {
    id: slug,
    slug,
    name: slug,
    version: 1,
    type: 'task',
    runtime: 'node',
    entryPoint: 'index.ts',
    registryRef: null,
    parametersSchema: null,
    defaultParameters: null,
    outputSchema: null,
    timeoutMs: null,
    retryPolicy: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('useJobsList', () => {
  beforeEach(() => {
    fetchJobsMock.mockReset();
  });

  it('loads jobs and exposes sorted list', async () => {
    const jobs = [
      makeJob('bravo'),
      makeJob('alpha', { runtime: 'python' })
    ];
    fetchJobsMock.mockResolvedValueOnce(jobs);
    const { result } = renderHook(() => useJobsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchJobsMock).toHaveBeenCalledWith('token-123', { signal: expect.any(AbortSignal) });
    expect(fetchJobsMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual(jobs);
    expect(result.current.sortedJobs.map((job) => job.slug)).toEqual(['alpha', 'bravo']);
    expect(result.current.error).toBeNull();
  });

  it('refreshes jobs when requested', async () => {
    const first = [makeJob('one')];
    const second = [makeJob('two')];

    fetchJobsMock.mockResolvedValueOnce(first);
    const { result } = renderHook(() => useJobsList());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.jobs).toEqual(first);

    fetchJobsMock.mockResolvedValueOnce(second);
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.jobs).toEqual(second);
    });
    expect(fetchJobsMock).toHaveBeenCalledTimes(2);
  });

  it('captures errors from the API', async () => {
    fetchJobsMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useJobsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('boom');
    expect(result.current.jobs).toEqual([]);
  });
});
