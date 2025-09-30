import type { Ticket } from '@apphub/ticketing';
import type { FC } from 'react';

interface TicketCardProps {
  ticket: Ticket;
  onSelect: (ticket: Ticket) => void;
}

const statusColors: Record<Ticket['status'], string> = {
  backlog: '#607D8B',
  in_progress: '#42A5F5',
  blocked: '#EF5350',
  review: '#AB47BC',
  done: '#66BB6A',
  archived: '#B0BEC5'
};

export const TicketCard: FC<TicketCardProps> = ({ ticket, onSelect }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(ticket)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '12px',
        marginBottom: '12px',
        color: '#e8eaed',
        boxShadow: '0 8px 16px rgba(15,17,25,0.25)',
        backdropFilter: 'blur(12px)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '16px' }}>{ticket.title}</strong>
        <span
          style={{
            background: statusColors[ticket.status],
            color: '#0f1115',
            borderRadius: '999px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 600
          }}
        >
          {ticket.status.replace('_', ' ')}
        </span>
      </div>
      <p style={{ fontSize: '13px', opacity: 0.75, marginTop: '8px' }}>{ticket.description.slice(0, 120)}...</p>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {ticket.tags.map((tag) => (
          <span
            key={tag}
            style={{
              background: 'rgba(66,165,245,0.12)',
              color: '#90CAF9',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '12px'
            }}
          >
            #{tag}
          </span>
        ))}
      </div>
    </button>
  );
};
