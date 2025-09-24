import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { API_BASE_URL } from '../config';
import {
  AppHubEventsContext,
  type AppHubEventHandler,
  type AppHubEventsClient,
  type AppHubSocketEvent
} from './context';

function resolveAppHubWebsocketUrl(): string {
  try {
    const apiUrl = new URL(API_BASE_URL);
    const wsUrl = new URL(apiUrl.toString());
    wsUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.hash = '';
    wsUrl.search = '';
    wsUrl.pathname = `${apiUrl.pathname.replace(/\/$/, '')}/ws`;
    return wsUrl.toString();
  } catch {
    const sanitized = API_BASE_URL.replace(/^https?:\/\//, '');
    const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
    return `${protocol}${sanitized.replace(/\/$/, '')}/ws`;
  }
}

export function AppHubEventsProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Set<AppHubEventHandler>());

  const subscribe = useCallback((handler: AppHubEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const emit = (event: AppHubSocketEvent) => {
      handlersRef.current.forEach((handler) => {
        try {
          handler(event);
        } catch (err) {
          console.error('[AppHubEvents] handler failed', err);
        }
      });
    };

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let pongTimer: number | null = null;
    let closed = false;
    let attempt = 0;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (pongTimer !== null) {
        window.clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const handlePong = () => {
      if (pongTimer !== null) {
        window.clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const startHeartbeat = () => {
      clearHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        if (closed || !socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        try {
          socket.send('ping');
        } catch {
          // Ignore transient network errors; reconnect logic will retry.
        }
        if (pongTimer !== null) {
          window.clearTimeout(pongTimer);
        }
        pongTimer = window.setTimeout(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        }, 10_000);
      }, 30_000);
    };

    const connect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const url = resolveAppHubWebsocketUrl();
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        startHeartbeat();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') {
          return;
        }
        const type = (payload as { type?: unknown }).type;
        if (type === 'connection.ack') {
          startHeartbeat();
        }
        if (type === 'pong') {
          handlePong();
        }
        if (typeof type !== 'string') {
          return;
        }
        emit(payload as AppHubSocketEvent);
      };

      const scheduleReconnect = (delay: number) => {
        if (closed) {
          return;
        }
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onclose = () => {
        if (closed) {
          return;
        }
        clearHeartbeat();
        attempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** attempt);
        scheduleReconnect(delay);
        socket = null;
      };

      socket.onerror = () => {
        clearHeartbeat();
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearHeartbeat();
      if (socket) {
        try {
          socket.close();
        } catch {
          // Best effort shutdown.
        }
        socket = null;
      }
    };
  }, []);

  const value = useMemo<AppHubEventsClient>(() => ({ subscribe }), [subscribe]);

  return <AppHubEventsContext.Provider value={value}>{children}</AppHubEventsContext.Provider>;
}
