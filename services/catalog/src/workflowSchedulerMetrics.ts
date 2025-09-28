import type { JsonValue } from './db/types';

type LeaderEvent =
  | 'attempt'
  | 'acquired'
  | 'released'
  | 'contention'
  | 'keepalive_failed'
  | 'stopped'
  | 'error';

type ScheduleEvent =
  | 'lock_acquired'
  | 'lock_contention'
  | 'optimistic_conflict'
  | 'processed'
  | 'skipped'
  | 'error';

type RecentEntry = {
  event: string;
  at: string;
  details?: Record<string, JsonValue | string | number | boolean | null>;
};

type LeaderMetrics = {
  attempts: number;
  acquired: number;
  released: number;
  contention: number;
  keepaliveFailures: number;
  errors: number;
  active: boolean;
  ownerId: string | null;
  acquiredAt: string | null;
  releasedAt: string | null;
};

type ScheduleMetrics = {
  lockAcquired: number;
  lockContention: number;
  optimisticConflicts: number;
  processed: number;
  skipped: number;
  errors: number;
  runsCreated: number;
};

type WorkflowSchedulerMetricsState = {
  leader: LeaderMetrics;
  schedules: ScheduleMetrics;
  recent: RecentEntry[];
  updatedAt: string | null;
};

const MAX_RECENT_ENTRIES = 50;

const state: WorkflowSchedulerMetricsState = {
  leader: {
    attempts: 0,
    acquired: 0,
    released: 0,
    contention: 0,
    keepaliveFailures: 0,
    errors: 0,
    active: false,
    ownerId: null,
    acquiredAt: null,
    releasedAt: null
  },
  schedules: {
    lockAcquired: 0,
    lockContention: 0,
    optimisticConflicts: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    runsCreated: 0
  },
  recent: [],
  updatedAt: null
};

function recordRecent(event: string, details?: Record<string, unknown>) {
  const entry: RecentEntry = {
    event,
    at: new Date().toISOString()
  };
  if (details && Object.keys(details).length > 0) {
    const normalized: Record<string, JsonValue | string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(details)) {
      if (value === undefined) {
        continue;
      }
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        normalized[key] = value;
      } else {
        normalized[key] = JSON.parse(JSON.stringify(value)) as JsonValue;
      }
    }
    entry.details = normalized;
  }

  state.recent.unshift(entry);
  if (state.recent.length > MAX_RECENT_ENTRIES) {
    state.recent.length = MAX_RECENT_ENTRIES;
  }
  state.updatedAt = entry.at;
}

export function recordWorkflowSchedulerLeaderEvent(event: LeaderEvent, details?: Record<string, unknown>): void {
  switch (event) {
    case 'attempt':
      state.leader.attempts += 1;
      break;
    case 'acquired':
      state.leader.acquired += 1;
      state.leader.active = true;
      state.leader.ownerId = typeof details?.ownerId === 'string' ? (details.ownerId as string) : state.leader.ownerId;
      state.leader.acquiredAt = new Date().toISOString();
      break;
    case 'released':
      state.leader.released += 1;
      state.leader.active = false;
      state.leader.releasedAt = new Date().toISOString();
      break;
    case 'contention':
      state.leader.contention += 1;
      break;
    case 'keepalive_failed':
      state.leader.keepaliveFailures += 1;
      state.leader.active = false;
      state.leader.releasedAt = new Date().toISOString();
      break;
    case 'error':
      state.leader.errors += 1;
      break;
    case 'stopped':
      state.leader.active = false;
      state.leader.releasedAt = new Date().toISOString();
      break;
    default:
      break;
  }

  recordRecent(`leader.${event}`, details);
}

export function recordWorkflowSchedulerScheduleEvent(
  event: ScheduleEvent,
  details?: Record<string, unknown>
): void {
  switch (event) {
    case 'lock_acquired':
      state.schedules.lockAcquired += 1;
      break;
    case 'lock_contention':
      state.schedules.lockContention += 1;
      break;
    case 'optimistic_conflict':
      state.schedules.optimisticConflicts += 1;
      break;
    case 'processed': {
      state.schedules.processed += 1;
      const runs = typeof details?.runs === 'number' ? (details.runs as number) : 0;
      if (runs > 0) {
        state.schedules.runsCreated += runs;
      }
      break;
    }
    case 'skipped':
      state.schedules.skipped += 1;
      break;
    case 'error':
      state.schedules.errors += 1;
      break;
    default:
      break;
  }

  recordRecent(`schedule.${event}`, details);
}

export function getWorkflowSchedulerMetricsSnapshot(): WorkflowSchedulerMetricsState {
  return {
    leader: { ...state.leader },
    schedules: { ...state.schedules },
    recent: state.recent.map((entry) => ({ ...entry, details: entry.details ? { ...entry.details } : undefined })),
    updatedAt: state.updatedAt
  } satisfies WorkflowSchedulerMetricsState;
}

export function resetWorkflowSchedulerMetrics(): void {
  state.leader = {
    attempts: 0,
    acquired: 0,
    released: 0,
    contention: 0,
    keepaliveFailures: 0,
    errors: 0,
    active: false,
    ownerId: null,
    acquiredAt: null,
    releasedAt: null
  } satisfies LeaderMetrics;

  state.schedules = {
    lockAcquired: 0,
    lockContention: 0,
    optimisticConflicts: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    runsCreated: 0
  } satisfies ScheduleMetrics;

  state.recent = [];
  state.updatedAt = null;
}
