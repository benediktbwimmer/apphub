import { createContext, useContext, useEffect, useRef } from 'react';
import type { CatalogSocketEvent } from '../catalog/types';

export type AppHubConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type AppHubConnectionStateEvent = {
  type: 'connection.state';
  data: { status: AppHubConnectionStatus };
};

export type AppHubSocketEvent = CatalogSocketEvent | AppHubConnectionStateEvent;
export type AppHubEventType = AppHubSocketEvent['type'];

export type AppHubEventHandler = (event: AppHubSocketEvent) => void;
export type AppHubConnectionHandler = (status: AppHubConnectionStatus) => void;

export type AppHubEventsClient = {
  subscribe: (handler: AppHubEventHandler) => () => void;
  subscribeConnection: (handler: AppHubConnectionHandler) => () => void;
  getConnectionState: () => AppHubConnectionStatus;
};

export const AppHubEventsContext = createContext<AppHubEventsClient | null>(null);

export function useAppHubEventsClient(): AppHubEventsClient {
  const context = useContext(AppHubEventsContext);
  if (!context) {
    throw new Error('useAppHubEventsClient must be used within AppHubEventsProvider');
  }
  return context;
}

type ExtractEvent<T extends AppHubEventType> = Extract<AppHubSocketEvent, { type: T }>;

type EventList<T extends AppHubEventType> = T | ReadonlyArray<T>;

export function useAppHubEvent<T extends AppHubEventType>(
  types: EventList<T>,
  handler: (event: ExtractEvent<T>) => void
): void {
  const client = useAppHubEventsClient();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const typeList: ReadonlyArray<T> = Array.isArray(types) ? types : [types];
    if (typeList.length === 0) {
      return;
    }
    return client.subscribe((event) => {
      if (typeList.includes(event.type as T)) {
        handlerRef.current(event as ExtractEvent<T>);
      }
    });
  }, [client, types]);
}
