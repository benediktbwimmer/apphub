import { hostname } from 'node:os';
import type { PoolClient } from 'pg';

import { parseCronExpression, type ParserOptions } from './workflows/cronParser';
import * as workflowDb from './db/workflows';
import type {
  WorkflowDefinitionRecord,
  WorkflowScheduleWindow,
  WorkflowScheduleRecord,
  WorkflowScheduleWithDefinition,
  WorkflowAssetPartitioning,
  JsonValue
} from './db/types';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import {
  collectPartitionedAssetsFromSteps,
  deriveTimeWindowPartitionKey
} from './workflows/partitioning';
import { buildRunKeyFromParts, computeRunKeyColumns } from './workflows/runKey';
import { useTransaction } from './db/utils';
import { getClient } from './db/client';
import { mapWorkflowScheduleRow } from './db/rowMappers';
import type { WorkflowScheduleRow } from './db/rowTypes';
import {
  recordWorkflowSchedulerLeaderEvent,
  recordWorkflowSchedulerScheduleEvent
} from './workflowSchedulerMetrics';
import {
  resolveJsonTemplates,
  type TemplateResolutionIssue,
  type TemplateResolutionTracker,
  type TemplateScope
} from './workflow/context';

const DEFAULT_INTERVAL_MS = Number(process.env.WORKFLOW_SCHEDULER_INTERVAL_MS ?? 5_000);
const DEFAULT_BATCH_SIZE = Number(process.env.WORKFLOW_SCHEDULER_BATCH_SIZE ?? 10);
const DEFAULT_MAX_WINDOWS = Number(process.env.WORKFLOW_SCHEDULER_MAX_WINDOWS ?? 25);

const SCHEDULE_LOCK_NAMESPACE = Number(process.env.WORKFLOW_SCHEDULER_LOCK_NAMESPACE ?? 61_204);
const LEADER_LOCK_NAMESPACE = Number(process.env.WORKFLOW_SCHEDULER_LEADER_NAMESPACE ?? 61_204);
const LEADER_LOCK_KEY = Number(process.env.WORKFLOW_SCHEDULER_LEADER_KEY ?? 1);
const MAX_LOCK_ATTEMPTS = Math.max(Number(process.env.WORKFLOW_SCHEDULER_LOCK_ATTEMPTS ?? 3), 1);
const LOCK_BACKOFF_MS = Math.max(Number(process.env.WORKFLOW_SCHEDULER_LOCK_BACKOFF_MS ?? 75), 1);
const LEADER_KEEPALIVE_MS = Math.max(Number(process.env.WORKFLOW_SCHEDULER_LEADER_KEEPALIVE_MS ?? 15_000), 1_000);
const LEADER_RETRY_BASE_MS = Math.max(Number(process.env.WORKFLOW_SCHEDULER_LEADER_RETRY_MS ?? 2_000), 250);

function log(message: string, meta?: Record<string, unknown>) {
  logger.info(message, normalizeMeta(meta));
}

function logError(message: string, meta?: Record<string, unknown>) {
  logger.error(message, normalizeMeta(meta));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(baseMs: number): number {
  const jitter = Math.floor(Math.random() * baseMs);
  return baseMs + jitter;
}

function getInstanceId(): string {
  return (
    process.env.WORKFLOW_SCHEDULER_INSTANCE_ID ??
    process.env.HOSTNAME ??
    hostname() ??
    `core-worker-${process.pid}`
  );
}

function isAdvisoryLockModeEnabled(): boolean {
  const raw = process.env.WORKFLOW_SCHEDULER_ADVISORY_LOCKS;
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseScheduleDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry as JsonValue)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      result[key] = cloneJsonValue(entry);
    }
    return result;
  }
  return value;
}

function resolveScheduleParameterTemplates(
  parameters: JsonValue,
  triggerPayload: JsonValue
): { value: JsonValue; issues: TemplateResolutionIssue[] } {
  const issues: TemplateResolutionIssue[] = [];
  const tracker: TemplateResolutionTracker = {
    record(issue) {
      issues.push(issue);
    }
  } satisfies TemplateResolutionTracker;
  const scope: TemplateScope = {
    shared: {},
    steps: {},
    run: {
      id: '__schedule__',
      parameters,
      triggeredBy: 'schedule',
      trigger: triggerPayload
    },
    parameters
  } satisfies TemplateScope;
  const resolved = resolveJsonTemplates(parameters, scope, tracker, '$.parameters');
  return { value: resolved, issues };
}

function computeNextOccurrence(
  schedule: WorkflowScheduleRecord,
  from: Date,
  { inclusive = false }: { inclusive?: boolean } = {}
): Date | null {
  const options: ParserOptions = {};
  if (schedule.timezone) {
    options.tz = schedule.timezone;
  }

  const startWindow = parseScheduleDate(schedule.startWindow);
  const endWindow = parseScheduleDate(schedule.endWindow);

  if (endWindow && from.getTime() > endWindow.getTime()) {
    return null;
  }

  let reference = from;
  if (startWindow && reference.getTime() < startWindow.getTime()) {
    reference = startWindow;
  }

  const currentDate = inclusive ? new Date(reference.getTime() - 1) : reference;

  try {
    const interval = parseCronExpression(schedule.cron, {
      ...options,
      currentDate
    });
    const next = interval.next().toDate();
    if (endWindow && next.getTime() > endWindow.getTime()) {
      return null;
    }
    return next;
  } catch {
    return null;
  }
}

function computePreviousOccurrence(
  schedule: WorkflowScheduleRecord,
  occurrence: Date
): Date | null {
  const options: ParserOptions = {};
  if (schedule.timezone) {
    options.tz = schedule.timezone;
  }

  const startWindow = parseScheduleDate(schedule.startWindow);

  try {
    const interval = parseCronExpression(schedule.cron, {
      ...options,
      currentDate: new Date(occurrence.getTime() - 1)
    });
    const previous = interval.prev().toDate();
    if (startWindow && previous.getTime() < startWindow.getTime()) {
      return startWindow;
    }
    return previous;
  } catch {
    return startWindow;
  }
}

function determineWindowStart(
  schedule: WorkflowScheduleRecord,
  lastWindow: WorkflowScheduleWindow | null,
  occurrence: Date
): string | null {
  const lastEnd = lastWindow?.end ? parseScheduleDate(lastWindow.end) : null;
  if (lastEnd) {
    return lastEnd.toISOString();
  }

  const previous = computePreviousOccurrence(schedule, occurrence);
  if (previous) {
    return previous.toISOString();
  }

  const startWindow = parseScheduleDate(schedule?.startWindow ?? null);
  if (startWindow && startWindow.getTime() <= occurrence.getTime()) {
    return startWindow.toISOString();
  }

  return null;
}

type EnqueueWorkflowRun = (runId: string, options?: { runKey?: string | null }) => Promise<void>;

type MaterializationStats = {
  runsCreated: number;
  skipReason?: string;
};

type LockedMaterializer = (
  entry: WorkflowScheduleWithDefinition,
  now: Date,
  maxWindows: number,
  deps: WorkflowSchedulerDependencies
) => Promise<MaterializationStats | null>;

type WorkflowSchedulerDependencies = {
  createWorkflowRun: typeof workflowDb.createWorkflowRun;
  enqueueWorkflowRun: EnqueueWorkflowRun;
  listDueWorkflowSchedules: typeof workflowDb.listDueWorkflowSchedules;
  updateWorkflowScheduleRuntimeMetadata: typeof workflowDb.updateWorkflowScheduleRuntimeMetadata;
  materializeWithLock?: LockedMaterializer;
};

const defaultDependencies: WorkflowSchedulerDependencies = {
  createWorkflowRun: workflowDb.createWorkflowRun,
  enqueueWorkflowRun: async (runId: string, options?: { runKey?: string | null }) => {
    const { enqueueWorkflowRun } = await import('./queue');
    return enqueueWorkflowRun(runId, options ?? {});
  },
  listDueWorkflowSchedules: workflowDb.listDueWorkflowSchedules,
  updateWorkflowScheduleRuntimeMetadata: workflowDb.updateWorkflowScheduleRuntimeMetadata,
  materializeWithLock: materializeScheduleWithLocks
};

async function materializeSchedule(
  entry: WorkflowScheduleWithDefinition,
  now: Date,
  maxWindows: number,
  deps: WorkflowSchedulerDependencies
): Promise<MaterializationStats> {
  const { schedule, workflow: definition } = entry;

  if (!schedule.isActive) {
    recordWorkflowSchedulerScheduleEvent('skipped', {
      scheduleId: schedule.id,
      reason: 'inactive'
    });
    return { runsCreated: 0, skipReason: 'inactive' };
  }

  const catchupEnabled = Boolean(schedule.catchUp);
  const occurrenceLimit = catchupEnabled ? Math.max(maxWindows, 1) : 1;
  const upcomingFromNow = catchupEnabled ? null : computeNextOccurrence(schedule, now, { inclusive: true });

  const partitionSpecs = Array.from(collectPartitionedAssetsFromSteps(definition.steps).values());
  const referenceTimePartition =
    partitionSpecs.length > 0 && partitionSpecs.every((spec) => spec?.type === 'timeWindow')
      ? (partitionSpecs[0] as Extract<WorkflowAssetPartitioning, { type: 'timeWindow' }>)
      : null;
  if (partitionSpecs.length > 0 && !referenceTimePartition) {
    log(
      'Skipping scheduler-driven partitioning because workflow uses non time-window partitioning',
      {
        workflowId: definition.id,
        workflowSlug: definition.slug
      }
    );
    recordWorkflowSchedulerScheduleEvent('skipped', {
      scheduleId: schedule.id,
      reason: 'non_time_window_partition'
    });
    return { runsCreated: 0, skipReason: 'non_time_window_partition' };
  }

  let cursor: Date | null;
  if (catchupEnabled) {
    cursor = parseScheduleDate(schedule.catchupCursor) ?? parseScheduleDate(schedule.nextRunAt);
  } else {
    cursor = parseScheduleDate(schedule.nextRunAt);
  }

  if (!cursor) {
    cursor = catchupEnabled ? computeNextOccurrence(schedule, now, { inclusive: true }) : upcomingFromNow;
  }

  if (!catchupEnabled) {
    let latestDue: Date | null = null;

    if (upcomingFromNow) {
      if (upcomingFromNow.getTime() <= now.getTime()) {
        latestDue = upcomingFromNow;
      } else {
        latestDue = computePreviousOccurrence(schedule, upcomingFromNow);
      }
    } else {
      latestDue = computePreviousOccurrence(schedule, now);
    }

    if (!cursor && latestDue) {
      cursor = latestDue;
    } else if (
      cursor &&
      latestDue &&
      latestDue.getTime() <= now.getTime() &&
      cursor.getTime() < latestDue.getTime()
    ) {
      cursor = latestDue;
    }
  }

  if (!cursor) {
    await deps.updateWorkflowScheduleRuntimeMetadata(schedule.id, {
      nextRunAt: null,
      catchupCursor: null
    });

    recordWorkflowSchedulerScheduleEvent('skipped', {
      scheduleId: schedule.id,
      reason: 'no_cursor'
    });
    return { runsCreated: 0, skipReason: 'no_cursor' };
  }

  let remaining = occurrenceLimit;
  let nextCursor: Date | null = cursor;
  let lastWindow = schedule.lastMaterializedWindow ?? null;
  let runsCreated = 0;
  let skipReason: string | undefined;
  let hadError = false;

  while (nextCursor && nextCursor.getTime() <= now.getTime() && remaining > 0) {
    const windowEndIso = nextCursor.toISOString();
    const windowStartIso = determineWindowStart(schedule, lastWindow, nextCursor);

    const scheduleParameterSource = (schedule.parameters ?? definition.defaultParameters ?? {}) as JsonValue;
    const clonedParameters = cloneJsonValue(scheduleParameterSource);
    const triggerPayload: JsonValue = {
      type: 'schedule',
      schedule: {
        id: schedule.id,
        name: schedule.name ?? null,
        cron: schedule.cron,
        timezone: schedule.timezone ?? null,
        occurrence: windowEndIso,
        window: {
          start: windowStartIso,
          end: windowEndIso
        },
        catchUp: catchupEnabled
      }
    };
    const { value: evaluatedParameters, issues: scheduleParameterIssues } =
      resolveScheduleParameterTemplates(clonedParameters, triggerPayload);
    const runParameters = scheduleParameterIssues.length === 0 ? evaluatedParameters : clonedParameters;
    if (scheduleParameterIssues.length > 0) {
      log(
        'Schedule parameter templates could not be fully resolved; using literal values',
        {
          scheduleId: schedule.id,
          workflowId: definition.id,
          issues: scheduleParameterIssues.map((issue) => `${issue.path}: {{ ${issue.expression} }}`)
        }
      );
    }

    if (partitionSpecs.length > 0 && !referenceTimePartition) {
      log('Partitioned assets require explicit partition keys; skipping scheduled run', {
        workflowId: definition.id,
        workflowSlug: definition.slug
      });
      recordWorkflowSchedulerScheduleEvent('skipped', {
        scheduleId: schedule.id,
        reason: 'partition_key_missing'
      });
      break;
    }

    let partitionKey: string | null = null;
    if (referenceTimePartition && windowEndIso) {
      const occurrenceDate = new Date(windowEndIso);
      if (Number.isNaN(occurrenceDate.getTime())) {
        logError('Unable to derive partition key from schedule window', {
          workflowId: definition.id,
          workflowSlug: definition.slug,
          windowEnd: windowEndIso
        });
        recordWorkflowSchedulerScheduleEvent('error', {
          scheduleId: schedule.id,
          reason: 'invalid_partition_key'
        });
        skipReason = 'invalid_partition_key';
        break;
      }
      partitionKey = deriveTimeWindowPartitionKey(referenceTimePartition, occurrenceDate);
    }

    let runKeyColumns: { runKey: string | null; runKeyNormalized: string | null } = {
      runKey: null,
      runKeyNormalized: null
    };
    const runKeyCandidate = buildRunKeyFromParts(
      'schedule',
      schedule.id,
      partitionKey ?? null,
      partitionKey ? null : windowEndIso ?? null
    );
    if (runKeyCandidate) {
      try {
        runKeyColumns = computeRunKeyColumns(runKeyCandidate);
      } catch (err) {
        logError('Failed to normalize run key for scheduled run', {
          workflowId: definition.id,
          workflowSlug: definition.slug,
          scheduleId: schedule.id,
          error: (err as Error).message ?? 'unknown'
        });
        recordWorkflowSchedulerScheduleEvent('error', {
          scheduleId: schedule.id,
          reason: 'invalid_run_key'
        });
        skipReason = 'invalid_run_key';
        break;
      }
    }

    try {
      const run = await deps.createWorkflowRun(definition.id, {
        parameters: runParameters,
        trigger: triggerPayload,
        triggeredBy: 'scheduler',
        partitionKey,
        runKey: runKeyColumns.runKey
      });
      await deps.enqueueWorkflowRun(run.id, { runKey: run.runKey ?? runKeyColumns.runKey ?? null });
      runsCreated += 1;

      log('Enqueued scheduled workflow run', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
        scheduleId: schedule.id,
        workflowRunId: run.id,
        occurrence: windowEndIso
      });
    } catch (err) {
      if (runKeyColumns.runKeyNormalized && workflowDb.isRunKeyConflict(err)) {
        const existing = await workflowDb.getActiveWorkflowRunByKey(
          definition.id,
          runKeyColumns.runKeyNormalized
        );
        if (existing) {
          try {
            const existingRunKey = existing.runKey ?? runKeyColumns.runKey ?? null;
            await deps.enqueueWorkflowRun(existing.id, { runKey: existingRunKey });
            log('Skipped scheduled run due to existing active run key', {
              workflowId: definition.id,
              workflowSlug: definition.slug,
              scheduleId: schedule.id,
              workflowRunId: existing.id,
              runKey: existingRunKey
            });
            recordWorkflowSchedulerScheduleEvent('skipped', {
              scheduleId: schedule.id,
              reason: 'duplicate_run_key'
            });
            skipReason = 'duplicate_run_key';
            break;
          } catch (enqueueErr) {
            logError('Failed to re-enqueue existing workflow run after run key conflict', {
              workflowId: definition.id,
              workflowSlug: definition.slug,
              scheduleId: schedule.id,
              existingRunId: existing.id,
              error: (enqueueErr as Error).message ?? 'unknown error'
            });
            recordWorkflowSchedulerScheduleEvent('error', {
              scheduleId: schedule.id,
              reason: 'enqueue_failure'
            });
            skipReason = 'enqueue_failure';
            hadError = true;
            break;
          }
        }
      }
      logError('Failed to enqueue scheduled workflow run', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
        scheduleId: schedule.id,
        error: (err as Error).message ?? 'unknown error'
      });
      recordWorkflowSchedulerScheduleEvent('error', {
        scheduleId: schedule.id,
        reason: 'enqueue_failure'
      });
      skipReason = 'enqueue_failure';
      hadError = true;
      break;
    }

    lastWindow = {
      start: windowStartIso,
      end: windowEndIso
    };
    remaining -= 1;

    nextCursor = computeNextOccurrence(schedule, nextCursor, { inclusive: false });
  }

  const updates: {
    nextRunAt?: string | null;
    catchupCursor?: string | null;
    lastWindow?: WorkflowScheduleWindow | null;
  } = {};

  updates.lastWindow = lastWindow;

  if (catchupEnabled) {
    if (nextCursor) {
      const nextIso = nextCursor.toISOString();
      updates.nextRunAt = nextIso;
      updates.catchupCursor = nextIso;
    } else {
      updates.nextRunAt = null;
      updates.catchupCursor = null;
    }
  } else {
    if (upcomingFromNow) {
      updates.nextRunAt = upcomingFromNow.toISOString();
    } else {
      updates.nextRunAt = null;
    }
    updates.catchupCursor = null;
  }

  await deps.updateWorkflowScheduleRuntimeMetadata(schedule.id, updates);

  if (hadError && runsCreated === 0) {
    return { runsCreated: 0, skipReason: skipReason ?? 'enqueue_failure' };
  }

  if (runsCreated > 0) {
    recordWorkflowSchedulerScheduleEvent('processed', {
      scheduleId: schedule.id,
      runs: runsCreated
    });
  } else {
    if (!hadError) {
      recordWorkflowSchedulerScheduleEvent('skipped', {
        scheduleId: schedule.id,
        reason: skipReason ?? 'no_due_windows'
      });
    }
  }

  return { runsCreated, skipReason: runsCreated > 0 ? undefined : skipReason ?? 'no_due_windows' };
}

async function tryAcquireScheduleLock(client: PoolClient, scheduleId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_LOCK_ATTEMPTS; attempt += 1) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked',
      [SCHEDULE_LOCK_NAMESPACE, scheduleId]
    );
    const locked = Boolean(rows[0]?.locked);
    if (locked) {
      recordWorkflowSchedulerScheduleEvent('lock_acquired', {
        scheduleId,
        attempts: attempt
      });
      return true;
    }
    recordWorkflowSchedulerScheduleEvent('lock_contention', {
      scheduleId,
      attempt
    });
    if (attempt < MAX_LOCK_ATTEMPTS) {
      await sleep(LOCK_BACKOFF_MS * attempt);
    }
  }
  return false;
}

async function fetchScheduleForUpdate(
  client: PoolClient,
  scheduleId: string
): Promise<WorkflowScheduleRecord | null> {
  const { rows } = await client.query<WorkflowScheduleRow>(
    'SELECT * FROM workflow_schedules WHERE id = $1 FOR UPDATE',
    [scheduleId]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowScheduleRow(rows[0]);
}

async function materializeScheduleWithLocks(
  entry: WorkflowScheduleWithDefinition,
  now: Date,
  maxWindows: number,
  deps: WorkflowSchedulerDependencies
): Promise<MaterializationStats | null> {
  let lockAcquired = false;
  let stats: MaterializationStats = { runsCreated: 0 };

  try {
    await useTransaction(async (client) => {
      const acquired = await tryAcquireScheduleLock(client, entry.schedule.id);
      if (!acquired) {
        return;
      }
      lockAcquired = true;

      const schedule = await fetchScheduleForUpdate(client, entry.schedule.id);
      if (!schedule) {
        recordWorkflowSchedulerScheduleEvent('skipped', {
          scheduleId: entry.schedule.id,
          reason: 'missing_schedule'
        });
        return;
      }

      let expectedUpdatedAt: string | null = schedule.updatedAt;
      const lockedDeps: WorkflowSchedulerDependencies = {
        ...deps,
        updateWorkflowScheduleRuntimeMetadata: async (scheduleId, updates) => {
          const updated = await workflowDb.updateWorkflowScheduleRuntimeMetadata(scheduleId, updates, {
            client,
            expectedUpdatedAt
          });
          if (!updated) {
            recordWorkflowSchedulerScheduleEvent('optimistic_conflict', {
              scheduleId
            });
            throw new Error('schedule_metadata_conflict');
          }
          expectedUpdatedAt = updated.updatedAt;
          return updated;
        }
      };

      stats = await materializeSchedule({ schedule, workflow: entry.workflow }, now, maxWindows, lockedDeps);
    });
  } catch (err) {
    recordWorkflowSchedulerScheduleEvent('error', {
      scheduleId: entry.schedule.id,
      reason: err instanceof Error ? err.message : 'unknown'
    });
    throw err;
  }

  if (!lockAcquired) {
    return null;
  }

  return stats;
}

type SchedulerExecutionOptions = {
  useLocks: boolean;
  lockedMaterializer: LockedMaterializer;
};

async function processSchedules(
  batchSize: number,
  maxWindows: number,
  deps: WorkflowSchedulerDependencies,
  execution: SchedulerExecutionOptions
): Promise<void> {
  const now = new Date();
  const due = await deps.listDueWorkflowSchedules({ limit: batchSize, now });
  if (due.length === 0) {
    return;
  }

  for (const entry of due) {
    try {
      if (execution.useLocks) {
        await execution.lockedMaterializer(entry, now, maxWindows, deps);
      } else {
        await materializeSchedule(entry, now, maxWindows, deps);
      }
    } catch (err) {
      logError('Failed to materialize workflow schedule', {
        workflowId: entry.workflow.id,
        workflowSlug: entry.workflow.slug,
        scheduleId: entry.schedule.id,
        error: (err as Error).message ?? 'unknown error'
      });
    }
  }
}

type SchedulerHandle = {
  stop: () => Promise<void>;
};

function startSchedulerLoop(
  {
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    maxWindows = DEFAULT_MAX_WINDOWS
  }: {
    intervalMs?: number;
    batchSize?: number;
    maxWindows?: number;
  },
  deps: WorkflowSchedulerDependencies,
  execution: SchedulerExecutionOptions
): SchedulerHandle {
  const interval = Math.max(intervalMs, 500);
  const boundedBatch = Math.min(Math.max(batchSize, 1), 100);
  const boundedWindows = Math.max(maxWindows, 1);

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      await processSchedules(boundedBatch, boundedWindows, deps, execution);
    } catch (err) {
      logError('Workflow scheduler iteration failed', {
        error: (err as Error).message ?? 'unknown error'
      });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, interval);

  void tick();

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      while (running) {
        await sleep(50);
      }
    }
  };
}

function startLeaderCoordinatedScheduler(
  config: {
    intervalMs?: number;
    batchSize?: number;
    maxWindows?: number;
  },
  deps: WorkflowSchedulerDependencies
): SchedulerHandle {
  const instanceId = getInstanceId();
  let stopped = false;
  let activeLoop: SchedulerHandle | null = null;
  let leaderClient: PoolClient | null = null;

  const execution: SchedulerExecutionOptions = {
    useLocks: true,
    lockedMaterializer: deps.materializeWithLock ?? materializeScheduleWithLocks
  };

  const leaderLoop = async () => {
    while (!stopped) {
      recordWorkflowSchedulerLeaderEvent('attempt', { ownerId: instanceId });
      let client: PoolClient | null = null;
      try {
        client = await getClient();
        const { rows } = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2) AS locked',
          [LEADER_LOCK_NAMESPACE, LEADER_LOCK_KEY]
        );
        const locked = Boolean(rows[0]?.locked);
        if (!locked) {
          recordWorkflowSchedulerLeaderEvent('contention', { ownerId: instanceId });
          client.release();
          client = null;
          await sleep(withJitter(LEADER_RETRY_BASE_MS));
          continue;
        }

        leaderClient = client;
        recordWorkflowSchedulerLeaderEvent('acquired', { ownerId: instanceId });
        log('Workflow scheduler leader lock acquired', { instanceId });

        activeLoop = startSchedulerLoop(config, deps, execution);

        while (!stopped) {
          await sleep(LEADER_KEEPALIVE_MS);
          try {
            await client.query('SELECT 1');
          } catch (err) {
            recordWorkflowSchedulerLeaderEvent('keepalive_failed', {
              ownerId: instanceId,
              error: err instanceof Error ? err.message : 'unknown error'
            });
            logError('Workflow scheduler leader keepalive failed', {
              instanceId,
              error: err instanceof Error ? err.message : 'unknown error'
            });
            break;
          }
        }
      } catch (err) {
        recordWorkflowSchedulerLeaderEvent('error', {
          ownerId: instanceId,
          error: err instanceof Error ? err.message : 'unknown error'
        });
        logError('Workflow scheduler leader loop encountered an error', {
          instanceId,
          error: err instanceof Error ? err.message : 'unknown error'
        });
      } finally {
        if (activeLoop) {
          await activeLoop.stop();
          activeLoop = null;
        }
        if (leaderClient) {
          try {
            await leaderClient.query('SELECT pg_advisory_unlock($1, $2)', [LEADER_LOCK_NAMESPACE, LEADER_LOCK_KEY]);
          } catch (unlockErr) {
            logError('Failed to release workflow scheduler leader lock', {
              instanceId,
              error: unlockErr instanceof Error ? unlockErr.message : 'unknown error'
            });
          }
          leaderClient.release();
          leaderClient = null;
          recordWorkflowSchedulerLeaderEvent('released', { ownerId: instanceId });
          log('Workflow scheduler leader lock released', { instanceId });
        }
      }

      if (!stopped) {
        await sleep(withJitter(LEADER_RETRY_BASE_MS));
      }
    }
  };

  const leaderLoopPromise = leaderLoop();

  return {
    async stop() {
      stopped = true;
      recordWorkflowSchedulerLeaderEvent('stopped', { ownerId: instanceId });
      if (activeLoop) {
        await activeLoop.stop();
        activeLoop = null;
      }
      if (leaderClient) {
        try {
          await leaderClient.query('SELECT pg_advisory_unlock($1, $2)', [LEADER_LOCK_NAMESPACE, LEADER_LOCK_KEY]);
        } catch (unlockErr) {
          logError('Failed to release workflow scheduler leader lock during shutdown', {
            instanceId,
            error: unlockErr instanceof Error ? unlockErr.message : 'unknown error'
          });
        }
        leaderClient.release();
        leaderClient = null;
        recordWorkflowSchedulerLeaderEvent('released', { ownerId: instanceId });
      }
      await leaderLoopPromise.catch(() => undefined);
    }
  };
}

export function startWorkflowScheduler(
  config: {
    intervalMs?: number;
    batchSize?: number;
    maxWindows?: number;
  } = {},
  dependencyOverrides: Partial<WorkflowSchedulerDependencies> = {}
): SchedulerHandle {
  const deps: WorkflowSchedulerDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides
  };

  if (!deps.materializeWithLock) {
    deps.materializeWithLock = (entry, now, maxWindows, innerDeps) =>
      materializeScheduleWithLocks(entry, now, maxWindows, innerDeps);
  }

  const advisoryLocksEnabled = isAdvisoryLockModeEnabled();

  log('Starting workflow scheduler', {
    advisoryLocksEnabled
  });

  if (advisoryLocksEnabled) {
    return startLeaderCoordinatedScheduler(config, deps);
  }

  const execution: SchedulerExecutionOptions = {
    useLocks: false,
    lockedMaterializer: deps.materializeWithLock
  };

  return startSchedulerLoop(config, deps, execution);
}
