import type { TicketStore } from '@apphub/ticketing';
import type { TicketingMetrics } from './metrics';
import type { TicketingConfig } from './config';

export interface ReadinessState {
  store: boolean;
  watcher: boolean;
}

export interface AppContext {
  config: TicketingConfig;
  store: TicketStore;
  metrics: TicketingMetrics;
  readiness: ReadinessState;
}
