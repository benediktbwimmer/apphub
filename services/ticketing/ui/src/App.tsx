import type { Ticket, TicketDependencyGraph, TicketIndex } from '@apphub/ticketing';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchDependencyGraph, fetchIndex, fetchTicket } from './lib/api';
import { useTicketStream } from './hooks/useTicketStream';
import { KanbanColumn } from './components/KanbanColumn';
import { TicketDetailDrawer } from './components/TicketDetailDrawer';
import { DependencyGraph } from './components/DependencyGraph';
import { STATUS_COLUMNS, type TicketWithMeta } from './types';

interface BoardState {
  tickets: TicketWithMeta[];
  index: TicketIndex;
  dependencyGraph: TicketDependencyGraph | null;
}

const initialState: BoardState = {
  tickets: [],
  index: { generatedAt: new Date(0).toISOString(), tickets: [] },
  dependencyGraph: null
};

const App = () => {
  const [state, setState] = useState(initialState);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [index, graph] = await Promise.all([fetchIndex(), fetchDependencyGraph()]);
      const ticketsWithMeta: TicketWithMeta[] = await Promise.all(
        index.tickets.map(async (entry) => {
          const ticket = await fetchTicket(entry.id);
          return {
            ...ticket,
            dependents: entry.dependents
          };
        })
      );
      setState({ tickets: ticketsWithMeta, index, dependencyGraph: graph });
      if (selected) {
        const refreshed = ticketsWithMeta.find((ticket) => ticket.id === selected.id);
        if (refreshed) {
          setSelected(refreshed);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  useTicketStream(
    useCallback(
      (event) => {
        if (event.type === 'tickets.refreshed' || event.type === 'ticket.deleted') {
          load();
        } else {
          // fetch single ticket update for lightweight refresh
          fetchTicket(event.ticketId)
            .then((ticket) => {
              setState((prev) => {
                const tickets = [
                  ...prev.tickets.filter((item) => item.id !== ticket.id),
                  { ...ticket, dependents: ticket.dependents ?? [] }
                ];
                const indexTickets = prev.index.tickets.map((entry) =>
                  entry.id === ticket.id
                    ? {
                        ...entry,
                        status: ticket.status,
                        priority: ticket.priority,
                        assignees: ticket.assignees,
                        tags: ticket.tags,
                        dependencies: ticket.dependencies,
                        dependents: ticket.dependents ?? [],
                        updatedAt: ticket.updatedAt,
                        revision: ticket.revision
                      }
                    : entry
                );
                return {
                  tickets,
                  index: { ...prev.index, tickets: indexTickets },
                  dependencyGraph: prev.dependencyGraph
                };
              });
              if (selected?.id === ticket.id) {
                setSelected(ticket);
              }
            })
            .catch(() => load());
        }
      },
      [load, selected]
    )
  );

  const grouped = useMemo(() => {
    const groups: Record<string, Ticket[]> = {};
    STATUS_COLUMNS.forEach(({ key }) => {
      groups[key] = [];
    });
    state.tickets.forEach((ticket) => {
      groups[ticket.status]?.push(ticket);
    });
    return groups;
  }, [state.tickets]);

  const dependencyData = useMemo(() => {
    if (!state.dependencyGraph) return { nodes: [], links: [] };
    const nodes = state.tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status
    }));
    const links = Object.entries(state.dependencyGraph.nodes).flatMap(([id, info]) =>
      info.dependencies.map((dependency) => ({ source: dependency, target: id }))
    );
    return { nodes, links };
  }, [state.dependencyGraph, state.tickets]);

  return (
    <div style={{ padding: '32px', color: '#e8eaed' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Ticketing Mission Control</h1>
          <p style={{ margin: '8px 0 0', opacity: 0.6 }}>
            Monitor progress, respond to blockers, and keep agents aligned in real-time.
          </p>
        </div>
        <div style={{ textAlign: 'right', opacity: 0.6, fontSize: '12px' }}>
          <div>Last index refresh</div>
          <div>{new Date(state.index.generatedAt).toLocaleString()}</div>
        </div>
      </header>

      {error && (
        <div style={{ marginBottom: '16px', color: '#FF8A80', background: 'rgba(255,138,128,0.1)', padding: '12px', borderRadius: '12px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px', opacity: 0.6 }}>Loading tickets…</div>
      ) : (
        <main style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '16px', flex: 3, overflowX: 'auto' }}>
            {STATUS_COLUMNS.map(({ key, label }) => (
              <KanbanColumn
                key={key}
                title={label}
                tickets={grouped[key] ?? []}
                emptyState={<span>No tickets</span>}
                onSelect={(ticket) => setSelected(ticket)}
              />
            ))}
          </div>
          <div style={{ flex: 1.4, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <section>
              <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Dependency graph</h2>
              <DependencyGraph
                nodes={dependencyData.nodes}
                links={dependencyData.links}
                onSelect={(id) => {
                  const ticket = state.tickets.find((entry) => entry.id === id);
                  if (ticket) {
                    setSelected(ticket);
                  }
                }}
              />
            </section>
            <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '16px', padding: '16px' }}>
              <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>At a glance</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '12px' }}>
                {STATUS_COLUMNS.map(({ key, label }) => (
                  <li key={key} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '12px' }}>
                    <span>{label}</span>
                    <strong>{grouped[key]?.length ?? 0}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </main>
      )}

      <TicketDetailDrawer
        ticket={selected}
        onClose={() => setSelected(null)}
        onRefresh={load}
      />
    </div>
  );
};

export default App;
