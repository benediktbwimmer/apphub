import type { Ticket } from '@apphub/ticketing';
import { useState, type FC } from 'react';
import { assignTicket, postComment, updateTicketStatus } from '../lib/api';

interface TicketDetailDrawerProps {
  ticket: Ticket | null;
  onClose: () => void;
  onRefresh: () => void;
}

const statusOptions: Array<{ value: Ticket['status']; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' }
];

export const TicketDetailDrawer: FC<TicketDetailDrawerProps> = ({ ticket, onClose, onRefresh }) => {
  const [actor, setActor] = useState('ui');
  const [comment, setComment] = useState('');
  const [assignees, setAssignees] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ticket) {
    return null;
  }

  const handleStatusChange = async (value: Ticket['status']) => {
    try {
      setPending(true);
      setError(null);
      await updateTicketStatus(ticket.id, value, comment || undefined, ticket.revision, actor || undefined);
      setComment('');
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const handleAssign = async () => {
    try {
      setPending(true);
      setError(null);
      const list = assignees
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (list.length === 0) {
        setError('Please enter at least one assignee');
        return;
      }
      await assignTicket(ticket.id, list, ticket.revision, actor || undefined);
      setAssignees('');
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const handleComment = async () => {
    if (!comment) {
      return;
    }

    try {
      setPending(true);
      setError(null);
      await postComment(ticket.id, comment, ticket.revision, actor || undefined);
      setComment('');
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <aside
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '420px',
        height: '100vh',
        background: 'rgba(15,17,25,0.95)',
        borderLeft: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '-16px 0 32px rgba(0,0,0,0.35)',
        padding: '24px',
        color: '#fff',
        overflowY: 'auto',
        zIndex: 20
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: '0 0 6px', opacity: 0.6 }}>#{ticket.id}</p>
          <h1 style={{ margin: 0 }}>{ticket.title}</h1>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '999px',
            color: '#fff',
            padding: '6px 14px'
          }}
        >
          Close
        </button>
      </header>

      <section style={{ marginTop: '16px' }}>
        <p style={{ lineHeight: 1.6 }}>{ticket.description}</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          {ticket.tags.map((tag) => (
            <span key={tag} style={{ background: 'rgba(66,165,245,0.15)', padding: '4px 10px', borderRadius: '999px' }}>
              #{tag}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Workflow</h2>
        <label style={{ display: 'block', fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>Status</label>
        <select
          value={ticket.status}
          onChange={(event) => handleStatusChange(event.target.value as Ticket['status'])}
          disabled={pending}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.2)',
            color: '#fff',
            marginBottom: '12px'
          }}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>Actor</label>
        <input
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          placeholder="actor (optional)"
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.2)',
            color: '#fff',
            marginBottom: '12px'
          }}
        />

        <label style={{ display: 'block', fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>Comment</label>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          placeholder="Add context for audit trail"
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.2)',
            color: '#fff',
            resize: 'vertical',
            marginBottom: '8px'
          }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={handleComment}
            disabled={pending || !comment}
            style={{
              flex: 1,
              background: '#42A5F5',
              border: 'none',
              borderRadius: '10px',
              padding: '10px',
              color: '#0f1115',
              fontWeight: 600
            }}
          >
            Post comment
          </button>
        </div>
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Assignments</h2>
        <div style={{ marginBottom: '8px', opacity: 0.7 }}>Current: {ticket.assignees.join(', ') || 'Unassigned'}</div>
        <input
          value={assignees}
          onChange={(event) => setAssignees(event.target.value)}
          placeholder="alice,bob"
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.2)',
            color: '#fff',
            marginBottom: '8px'
          }}
        />
        <button
          type="button"
          onClick={handleAssign}
          disabled={pending || assignees.trim().length === 0}
          style={{
            width: '100%',
            background: '#66BB6A',
            border: 'none',
            borderRadius: '10px',
            padding: '10px',
            color: '#0f1115',
            fontWeight: 600
          }}
        >
          Update assignees
        </button>
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>History</h2>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxHeight: '200px',
            overflowY: 'auto',
            paddingRight: '8px'
          }}
        >
          {ticket.history
            .slice()
            .reverse()
            .map((entry) => (
              <div
                key={entry.id}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.08)'
                }}
              >
                <div style={{ fontSize: '12px', opacity: 0.6 }}>{new Date(entry.at).toLocaleString()}</div>
                <div style={{ fontWeight: 600 }}>{entry.actor}</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>{entry.message || entry.action}</div>
              </div>
            ))}
        </div>
      </section>

      {error && (
        <div style={{ marginTop: '16px', color: '#FF8A80' }}>{error}</div>
      )}
    </aside>
  );
};
