import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchStreamingStatus } from '../api';
import type { StreamingStatus } from '../types';

const MAX_HISTORY_SAMPLES = 60;

export type StreamingMetricSample = {
  timestamp: number;
  bufferedRows: number;
  openWindows: number;
  hotBufferDatasets: number;
  perDataset: Record<
    string,
    {
      bufferedRows: number;
      openWindows: number;
    }
  >;
};

export interface StreamingStatusState {
  status: StreamingStatus | null;
  loading: boolean;
  error: string | null;
  history: StreamingMetricSample[];
  refresh: () => void;
}

function aggregateBufferedRows(status: StreamingStatus | null): number {
  if (!status) {
    return 0;
  }
  return status.batchers.connectors.reduce((acc, connector) => acc + connector.bufferedRows, 0);
}

function aggregateOpenWindows(status: StreamingStatus | null): number {
  if (!status) {
    return 0;
  }
  return status.batchers.connectors.reduce((acc, connector) => acc + connector.openWindows, 0);
}

function aggregatePerDataset(status: StreamingStatus | null): Record<string, { bufferedRows: number; openWindows: number }> {
  const result: Record<string, { bufferedRows: number; openWindows: number }> = {};
  if (!status) {
    return result;
  }
  for (const connector of status.batchers.connectors) {
    const existing = result[connector.datasetSlug] ?? { bufferedRows: 0, openWindows: 0 };
    existing.bufferedRows += connector.bufferedRows;
    existing.openWindows += connector.openWindows;
    result[connector.datasetSlug] = existing;
  }
  return result;
}

export function useStreamingStatus(pollIntervalMs = 10000): StreamingStatusState {
  const authorizedFetch = useAuthorizedFetch();
  const [status, setStatus] = useState<StreamingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [history, setHistory] = useState<StreamingMetricSample[]>([]);

  const updateStatus = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const nextStatus = await fetchStreamingStatus(authorizedFetch);
        if (signal?.aborted) {
          return;
        }
        setStatus(nextStatus);
        setError(null);
        setLoading(false);
        setHistory((prev) => {
          const sample: StreamingMetricSample = {
            timestamp: Date.now(),
            bufferedRows: aggregateBufferedRows(nextStatus),
            openWindows: aggregateOpenWindows(nextStatus),
            hotBufferDatasets: nextStatus.hotBuffer.datasets,
            perDataset: aggregatePerDataset(nextStatus)
          };
          const next = [...prev, sample];
          if (next.length > MAX_HISTORY_SAMPLES) {
            next.shift();
          }
          return next;
        });
      } catch (err) {
        if (signal?.aborted) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load streaming status';
        setError(message);
        setLoading(false);
      }
    },
    [authorizedFetch]
  );

  useEffect(() => {
    const controller = new AbortController();
    updateStatus(controller.signal).catch(() => undefined);
    const interval = setInterval(() => {
      updateStatus().catch(() => undefined);
    }, pollIntervalMs);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [pollIntervalMs, updateStatus]);

  const refresh = useCallback(() => {
    updateStatus().catch(() => undefined);
  }, [updateStatus]);

  const trimmedHistory = useMemo(() => history.slice(), [history]);

  return {
    status,
    loading,
    error,
    history: trimmedHistory,
    refresh
  };
}
