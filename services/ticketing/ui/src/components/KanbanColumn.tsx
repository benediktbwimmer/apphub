import type { Ticket } from '@apphub/ticketing';
import type { FC, ReactNode } from 'react';
import { TicketCard } from './TicketCard';

interface ColumnProps {
  title: string;
  tickets: Ticket[];
  emptyState: ReactNode;
  onSelect: (ticket: Ticket) => void;
}

export const KanbanColumn: FC<ColumnProps> = ({ title, tickets, emptyState, onSelect }) => (
  <section
    style={{
      flex: 1,
      minWidth: '260px',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: '16px',
      border: '1px solid rgba(255,255,255,0.04)',
      padding: '16px',
      maxHeight: 'calc(100vh - 220px)',
      overflowY: 'auto'
    }}
  >
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
      <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>{title}</h2>
      <span style={{ fontSize: '12px', opacity: 0.6 }}>{tickets.length} items</span>
    </header>
    {tickets.length === 0 ? (
      <div style={{ padding: '24px 0', textAlign: 'center', opacity: 0.5 }}>{emptyState}</div>
    ) : (
      tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onSelect={onSelect} />)
    )}
  </section>
);
