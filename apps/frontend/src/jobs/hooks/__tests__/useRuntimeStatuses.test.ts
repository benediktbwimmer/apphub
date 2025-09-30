import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchStatusesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => vi.fn()
}));

vi.mock('../../api', () => ({
  fetchJobRuntimeStatuses: (...args: unknown[]) => fetchStatusesMock(...args)
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import type { JobRuntimeStatus } from '../../api';
import { useRuntimeStatuses } from '../useRuntimeStatuses';

describe('useRuntimeStatuses', () => {
  beforeEach(() => {
    fetchStatusesMock.mockReset();
  });

  it('loads runtime statuses', async () => {
    const statuses: JobRuntimeStatus[] = [
      { runtime: 'node', ready: true, reason: null, checkedAt: '2024-01-01T00:00:00Z', details: null }
    ];
    fetchStatusesMock.mockResolvedValueOnce(statuses);
    const fetcher = vi.fn();

    const { result } = renderHook(() => useRuntimeStatuses({ fetcher }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchStatusesMock).toHaveBeenCalledTimes(1);
    expect(result.current.statuses).toEqual(statuses);
    expect(result.current.error).toBeNull();
  });

  it('refreshes on demand', async () => {
    fetchStatusesMock.mockResolvedValueOnce([
      { runtime: 'node', ready: true, reason: null, checkedAt: '2024-01-01T00:00:00Z', details: null }
    ] satisfies JobRuntimeStatus[]);
    const fetcher = vi.fn();
    const { result } = renderHook(() => useRuntimeStatuses({ fetcher }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchStatusesMock.mockResolvedValueOnce([
      { runtime: 'python', ready: false, reason: 'offline', checkedAt: '2024-01-01T00:10:00Z', details: null }
    ] satisfies JobRuntimeStatus[]);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.statuses[0].runtime).toBe('python');
    });
    expect(fetchStatusesMock).toHaveBeenCalledTimes(2);
  });

  it('captures errors', async () => {
    fetchStatusesMock.mockRejectedValueOnce(new Error('nope'));
    const fetcher = vi.fn();

    const { result } = renderHook(() => useRuntimeStatuses({ fetcher }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('nope');
    expect(result.current.statuses).toEqual([]);
  });
});
