import { useCallback, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import type { AppRecord, HistoryState, IngestionEvent } from '../types';
import type { CoreRepositoryMutators } from './useCoreSearch';
import { fetchHistory as fetchHistoryRequest, retryIngestion as retryIngestionRequest } from '../api';

export type UseCoreHistoryOptions = {
  repositories: CoreRepositoryMutators;
  setGlobalError: (message: string | null) => void;
};

export type UseCoreHistoryResult = {
  historyState: HistoryState;
  retryingId: string | null;
  toggleHistory: (id: string) => Promise<void>;
  retryIngestion: (id: string) => Promise<void>;
};

export function useCoreHistory(options: UseCoreHistoryOptions): UseCoreHistoryResult {
  const { repositories, setGlobalError } = options;
  const [historyState, setHistoryState] = useState<HistoryState>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const { activeToken: authToken } = useAuth();

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
        const events = await fetchHistoryRequest(authToken, id);
        setHistoryState((prev) => ({
          ...prev,
          [id]: {
            open: true,
            loading: false,
            error: null,
            events
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
    [authToken]
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
        const repository = (await retryIngestionRequest(authToken, id)) as Partial<AppRecord> | null;
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
    [authToken, fetchHistory, historyState, repositories, setGlobalError]
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
