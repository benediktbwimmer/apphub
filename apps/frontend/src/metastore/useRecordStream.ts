import { useEffect, useMemo, useRef, useState } from 'react';
import { METASTORE_BASE_URL } from '../config';
import { useAuth } from '../auth/useAuth';
import { recordStreamEventSchema, type MetastoreRecordStreamEvent } from './types';

export type MetastoreStreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

export type MetastoreStreamEntry = {
  id: string | null;
  eventType: `metastore.record.${MetastoreRecordStreamEvent['action']}`;
  payload: MetastoreRecordStreamEvent;
  receivedAt: string;
};

type UseMetastoreRecordStreamOptions = {
  enabled?: boolean;
  eventLimit?: number;
};

type UseMetastoreRecordStreamResult = {
  status: MetastoreStreamStatus;
  events: MetastoreStreamEntry[];
  error: string | null;
};

const DEFAULT_EVENT_LIMIT = 100;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

function buildStreamUrl(baseUrl: string, token: string | null): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(`${trimmed}/stream/records`);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

export function useMetastoreRecordStream(
  options: UseMetastoreRecordStreamOptions = {}
): UseMetastoreRecordStreamResult {
  const { activeToken } = useAuth();
  const enabled = options.enabled ?? true;
  const eventLimit = Math.max(1, options.eventLimit ?? DEFAULT_EVENT_LIMIT);

  const [status, setStatus] = useState<MetastoreStreamStatus>('idle');
  const [events, setEvents] = useState<MetastoreStreamEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set());

  const streamUrl = useMemo(() => buildStreamUrl(METASTORE_BASE_URL, activeToken), [activeToken]);

  useEffect(() => {
    seenIdsRef.current = new Set();
    setEvents([]);
    setError(null);

    if (!enabled) {
      setStatus('idle');
      return;
    }

    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      setStatus('error');
      setError('Realtime streams are unavailable in this environment.');
      return;
    }

    let attempt = 0;
    let reconnectTimer: number | null = null;
    let currentSource: EventSource | null = null;
    let handleCreated: ((event: MessageEvent<string>) => void) | null = null;
    let handleUpdated: ((event: MessageEvent<string>) => void) | null = null;
    let handleDeleted: ((event: MessageEvent<string>) => void) | null = null;
    let handleGeneric: ((event: MessageEvent<string>) => void) | null = null;
    let closed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const cleanupSource = () => {
      if (!currentSource) {
        return;
      }
      if (handleCreated) {
        currentSource.removeEventListener('metastore.record.created', handleCreated);
      }
      if (handleUpdated) {
        currentSource.removeEventListener('metastore.record.updated', handleUpdated);
      }
      if (handleDeleted) {
        currentSource.removeEventListener('metastore.record.deleted', handleDeleted);
      }
      if (handleGeneric) {
        currentSource.removeEventListener('message', handleGeneric);
      }
      currentSource.onopen = null;
      currentSource.onerror = null;
      currentSource.close();
      currentSource = null;
      handleCreated = null;
      handleUpdated = null;
      handleDeleted = null;
      handleGeneric = null;
    };

    const scheduleReconnect = () => {
      if (closed) {
        return;
      }
      if (reconnectTimer !== null) {
        return;
      }
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 5),
        RECONNECT_MAX_DELAY_MS
      );
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const dispatchEvent = (event: MessageEvent<string>) => {
      if (closed) {
        return;
      }
      const { data, lastEventId } = event;
      if (!data) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data) as unknown;
      } catch {
        return;
      }
      const result = recordStreamEventSchema.safeParse(parsed);
      if (!result.success) {
        return;
      }
      const payload = result.data;
      const entryId = lastEventId ?? null;
      if (entryId && seenIdsRef.current.has(entryId)) {
        return;
      }
      const entry: MetastoreStreamEntry = {
        id: entryId,
        eventType: `metastore.record.${payload.action}`,
        payload,
        receivedAt: new Date().toISOString()
      };
      setEvents((previous) => {
        if (entryId && previous.some((item) => item.id === entryId)) {
          return previous;
        }
        const next = [entry, ...previous];
        if (entryId) {
          seenIdsRef.current.add(entryId);
        }
        if (next.length <= eventLimit) {
          return next;
        }
        const trimmed = next.slice(0, eventLimit);
        const retainedIds = new Set<string>();
        for (const candidate of trimmed) {
          if (candidate.id) {
            retainedIds.add(candidate.id);
          }
        }
        seenIdsRef.current = retainedIds;
        return trimmed;
      });
    };

    const connect = () => {
      if (closed) {
        return;
      }
      clearReconnectTimer();
      cleanupSource();
      const currentAttempt = attempt;
      attempt += 1;
      setStatus(currentAttempt === 0 ? 'connecting' : 'reconnecting');
      setError(null);
      try {
        currentSource = new window.EventSource(streamUrl, { withCredentials: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to realtime stream');
        setStatus('error');
        scheduleReconnect();
        return;
      }

      const source = currentSource;

      source.onopen = () => {
        if (closed) {
          return;
        }
        attempt = 0;
        setStatus('open');
        setError(null);
      };

      source.onerror = () => {
        if (closed) {
          return;
        }
        if (source.readyState === window.EventSource.CLOSED) {
          cleanupSource();
          setStatus('error');
          setError('Stream disconnected');
          scheduleReconnect();
        } else {
          setStatus('reconnecting');
        }
      };

      handleCreated = (event) => dispatchEvent(event);
      handleUpdated = (event) => dispatchEvent(event);
      handleDeleted = (event) => dispatchEvent(event);
      handleGeneric = (event) => dispatchEvent(event);

      source.addEventListener('metastore.record.created', handleCreated);
      source.addEventListener('metastore.record.updated', handleUpdated);
      source.addEventListener('metastore.record.deleted', handleDeleted);
      source.addEventListener('message', handleGeneric);
    };

    connect();

    return () => {
      closed = true;
      clearReconnectTimer();
      cleanupSource();
    };
  }, [enabled, streamUrl, eventLimit]);

  return {
    status,
    events,
    error
  } satisfies UseMetastoreRecordStreamResult;
}
