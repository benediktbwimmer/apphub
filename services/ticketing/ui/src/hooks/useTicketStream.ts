import { useEffect } from 'react';

type TicketEvent =
  | { type: 'ticket.created'; ticketId: string }
  | { type: 'ticket.updated'; ticketId: string }
  | { type: 'ticket.deleted'; ticketId: string }
  | { type: 'tickets.refreshed' };

export const useTicketStream = (onEvent: (event: TicketEvent) => void) => {
  useEffect(() => {
    let shutdown = false;
    let source: EventSource | null = null;

    const connect = () => {
      if (shutdown) {
        return;
      }
      source = new EventSource('/tickets/events');

      const handlers: Record<string, (payload: MessageEvent) => void> = {
        'ticket.created': (event) => {
          const data = JSON.parse(event.data);
          onEvent({ type: 'ticket.created', ticketId: data.id });
        },
        'ticket.updated': (event) => {
          const data = JSON.parse(event.data);
          onEvent({ type: 'ticket.updated', ticketId: data.id });
        },
        'ticket.deleted': (event) => {
          const data = JSON.parse(event.data);
          onEvent({ type: 'ticket.deleted', ticketId: data.id });
        },
        'tickets.refreshed': () => {
          onEvent({ type: 'tickets.refreshed' });
        }
      };

      Object.entries(handlers).forEach(([event, handler]) => source?.addEventListener(event, handler));

      source.onerror = () => {
        source?.close();
        if (!shutdown) {
          setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      shutdown = true;
      source?.close();
    };
  }, [onEvent]);
};
