import type { Ticket, TicketIndex } from '@apphub/ticketing';

export type TicketWithMeta = Ticket & {
  dependents: string[];
};

export interface TicketIndexResponse extends TicketIndex {}

export interface ApiError {
  message: string;
}

export type TicketStatusGroup = 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done' | 'archived';

export const STATUS_COLUMNS: Array<{ key: TicketStatusGroup; label: string }> = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
  { key: 'archived', label: 'Archived' }
];
