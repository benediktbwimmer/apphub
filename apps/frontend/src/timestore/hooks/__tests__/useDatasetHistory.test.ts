import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDatasetHistory } from '../../hooks/useDatasetHistory';
import type { DatasetAccessAuditEvent, DatasetAccessAuditListResponse } from '../../types';

const sampleEvent: DatasetAccessAuditEvent = {
  id: 'event-1',
  datasetId: 'ds-1',
  datasetSlug: 'dataset-one',
  actorId: 'user-1',
  actorScopes: ['timestore:admin'],
  action: 'ingest',
  success: true,
  metadata: { mode: 'inline' },
  createdAt: new Date('2024-05-01T10:00:00Z').toISOString()
};

describe('useDatasetHistory', () => {
  const authorizedFetch = vi.fn();
  let historyFetcher: vi.Mock<
    Promise<DatasetAccessAuditListResponse>,
    [ReturnType<typeof authorizedFetch>, string, Record<string, unknown> | undefined, { signal?: AbortSignal } | undefined]
  >;

  beforeEach(() => {
    historyFetcher = vi.fn();
  });

  it('loads history when enabled and datasetId present', async () => {
    historyFetcher.mockResolvedValueOnce({ events: [sampleEvent], nextCursor: 'cursor-1' });

    const { result } = renderHook(() =>
      useDatasetHistory({
        datasetId: 'ds-1',
        authorizedFetch,
        enabled: true,
        pageSize: 10,
        historyFetcher
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.events).toEqual([sampleEvent]);
    expect(result.current.hasMore).toBe(true);
    expect(historyFetcher).toHaveBeenCalledTimes(1);
    expect(historyFetcher.mock.calls[0][2]).toMatchObject({ limit: 10, cursor: null });
  });

  it('appends additional pages when loadMore is invoked', async () => {
    const secondEvent: DatasetAccessAuditEvent = {
      ...sampleEvent,
      id: 'event-2',
      createdAt: new Date('2024-05-01T09:00:00Z').toISOString(),
      metadata: { mode: 'queued', jobId: 'job-123' }
    };

    historyFetcher
      .mockResolvedValueOnce({ events: [sampleEvent], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ events: [secondEvent], nextCursor: null });

    const { result } = renderHook(() =>
      useDatasetHistory({
        datasetId: 'ds-1',
        authorizedFetch,
        enabled: true,
        pageSize: 5,
        historyFetcher
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(historyFetcher).toHaveBeenCalledTimes(2);
    expect(result.current.events).toEqual([sampleEvent, secondEvent]);
    expect(result.current.hasMore).toBe(false);
  });

  it('captures API failures', async () => {
    historyFetcher.mockRejectedValueOnce(new Error('history failed'));

    const { result } = renderHook(() =>
      useDatasetHistory({
        datasetId: 'ds-1',
        authorizedFetch,
        enabled: true,
        historyFetcher
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('history failed');
    expect(result.current.events).toEqual([]);
  });

  it('does nothing when disabled', async () => {
    const { result } = renderHook(() =>
      useDatasetHistory({
        datasetId: 'ds-1',
        authorizedFetch,
        enabled: false,
        historyFetcher
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events).toEqual([]);
    expect(historyFetcher).not.toHaveBeenCalled();
  });

  it('refreshes history on demand', async () => {
    historyFetcher
      .mockResolvedValueOnce({ events: [sampleEvent], nextCursor: null })
      .mockResolvedValueOnce({
        events: [{ ...sampleEvent, id: 'event-new' }],
        nextCursor: 'cursor-3'
      });

    const { result } = renderHook(() =>
      useDatasetHistory({
        datasetId: 'ds-1',
        authorizedFetch,
        enabled: true,
        historyFetcher
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(historyFetcher).toHaveBeenCalledTimes(2);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe('event-new');
    expect(result.current.hasMore).toBe(true);
  });
});
