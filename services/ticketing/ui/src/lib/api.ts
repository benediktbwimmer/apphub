import type { Ticket, TicketDependencyGraph, TicketIndex } from '@apphub/ticketing';

const JSON_HEADERS = {
  'Content-Type': 'application/json'
};

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const fetchTickets = () => request<{ tickets: Ticket[] }>('/tickets');

export const fetchIndex = () => request<TicketIndex>('/tickets?view=index');

export const fetchTicket = (id: string) => request<Ticket>(`/tickets/${id}`);

export const fetchDependencyGraph = () => request<TicketDependencyGraph>('/tickets/dependencies');

export const updateTicketStatus = (
  id: string,
  status: Ticket['status'],
  comment?: string,
  expectedRevision?: number,
  actor?: string
) =>
  request<Ticket>(`/tickets/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      updates: { status },
      comment,
      actor,
      expectedRevision
    })
  });

export const assignTicket = (
  id: string,
  assignees: string[],
  expectedRevision?: number,
  actor?: string
) =>
  request<Ticket>(`/tickets/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      updates: { assignees },
      actor,
      expectedRevision
    })
  });

export const postComment = (
  id: string,
  comment: string,
  expectedRevision?: number,
  actor?: string
) =>
  request<Ticket>(`/tickets/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      updates: {},
      comment,
      actor,
      expectedRevision
    })
  });
