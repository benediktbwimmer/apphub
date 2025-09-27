import { useCallback, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import { API_BASE_URL } from '../constants';
import type { AppRecord, HistoryState, IngestionEvent } from '../types';
import type { CatalogRepositoryMutators } from './useCatalogSearch';

export type UseCatalogHistoryOptions = {
  repositories: CatalogRepositoryMutators;
  setGlobalError: (message: string | null) => void;
};

export type UseCatalogHistoryResult = {
  historyState: HistoryState;
  retryingId: string | null;
  toggleHistory: (id: string) => Promise<void>;
  retryIngestion: (id: string) => Promise<void>;
};

export function useCatalogHistory(options: UseCatalogHistoryOptions): UseCatalogHistoryResult {
  const { repositories, setGlobalError } = options;
  const [historyState, setHistoryState] = useState<HistoryState>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const authorizedFetch = useAuthorizedFetch();

  const fetchHistory = useCallback(
    async (id: string, force = false) => {
      setHistoryState((prev) => ({
        ...prev,
        [id]: {
          open: true,
          loading: true,
          error: null,
          events: force ? null : prev[id]?.events ?? null
        }
      }));

      try {
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/history`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? `Failed to load history (${response.status})`);
        }
        const payload = await response.json();
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: null,
            events: payload?.data ?? []
          }
        }));
      } catch (err) {
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: (err as Error).message,
            events: null
          }
        }));
      }
    },
    [authorizedFetch]
  );

  const toggleHistory = useCallback(
    async (id: string) => {
      const existing = historyState[id];
      const nextOpen = !(existing?.open ?? false);

      if (!nextOpen) {
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: false,
            loading: false,
            error: existing?.error ?? null,
            events: existing?.events ?? null
          }
        }));
        return;
      }

      if (existing?.events) {
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            ...existing,
            open: true,
            loading: false,
            error: null
          }
        }));
        return;
      }

      await fetchHistory(id);
    },
    [fetchHistory, historyState]
  );

  const retryIngestion = useCallback(
    async (id: string) => {
      setRetryingId(id);
      try {
        const response = await authorizedFetch(`${API_BASE_URL}/apps/${id}/retry`, {
          method: 'POST'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Retry failed with status ${response.status}`);
        }
        const repository = payload?.data as Partial<AppRecord> | undefined;
        if (repository) {
          repositories.merge(id, repository);
          if (historyState[id]?.open) {
            await fetchHistory(id, true);
          }
        }
      } catch (err) {
        setGlobalError((err as Error).message);
      } finally {
        setRetryingId(null);
      }
    },
    [authorizedFetch, fetchHistory, historyState, repositories, setGlobalError]
  );

  const handleIngestionEvent = useCallback((event: IngestionEvent) => {
    setHistoryState((prev) => {
      const current = prev[event.repositoryId];
      if (!current) {
        return prev;
      }
      const existingEvents = current.events ?? [];
      const eventIndex = existingEvents.findIndex((item) => item.id === event.id);
      const nextEvents = eventIndex === -1
        ? [event, ...existingEvents]
        : existingEvents.map((item, idx) => (idx === eventIndex ? event : item));
      return {
        ...prev,
        [event.repositoryId]: {
          ...current,
          events: nextEvents
        }
      };
    });
  }, []);

  const handleIngestionSocketEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: 'repository.ingestion-event' }>) => {
      if (event.data?.event) {
        handleIngestionEvent(event.data.event);
      }
    },
    [handleIngestionEvent]
  );

  useAppHubEvent('repository.ingestion-event', handleIngestionSocketEvent);

  return {
    historyState,
    retryingId,
    toggleHistory,
    retryIngestion
  };
}
