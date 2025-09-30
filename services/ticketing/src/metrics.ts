import { Counter, Gauge, Registry } from 'prom-client';

export interface TicketingMetrics {
  register: Registry;
  ticketsCreated: Counter<'source'>;
  ticketsUpdated: Counter<'source'>;
  ticketsDeleted: Counter<'source'>;
  ticketRefreshes: Counter<'reason'>;
  readinessGauge: Gauge<'component'>;
}

export const createMetrics = (): TicketingMetrics => {
  const register = new Registry();

  const ticketsCreated = new Counter({
    name: 'ticketing_tickets_created_total',
    help: 'Total number of tickets created via the service',
    registers: [register],
    labelNames: ['source'] as const
  });

  const ticketsUpdated = new Counter({
    name: 'ticketing_tickets_updated_total',
    help: 'Total number of tickets updated via the service',
    registers: [register],
    labelNames: ['source'] as const
  });

  const ticketsDeleted = new Counter({
    name: 'ticketing_tickets_deleted_total',
    help: 'Total number of tickets deleted via the service',
    registers: [register],
    labelNames: ['source'] as const
  });

  const ticketRefreshes = new Counter({
    name: 'ticketing_refresh_total',
    help: 'Total refresh operations performed after filesystem events',
    registers: [register],
    labelNames: ['reason'] as const
  });

  const readinessGauge = new Gauge({
    name: 'ticketing_component_ready',
    help: 'Readiness state per component (1 ready, 0 not ready)',
    registers: [register],
    labelNames: ['component'] as const
  });

  return {
    register,
    ticketsCreated,
    ticketsUpdated,
    ticketsDeleted,
    ticketRefreshes,
    readinessGauge
  };
};
