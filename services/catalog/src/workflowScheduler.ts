import { parseCronExpression, type ParserOptions } from './workflows/cronParser';
import {
  createWorkflowRun,
  listDueWorkflowSchedules,
  updateWorkflowScheduleRuntimeMetadata
} from './db/workflows';
import type {
  WorkflowDefinitionRecord,
  WorkflowScheduleWindow,
  WorkflowScheduleRecord,
  WorkflowScheduleWithDefinition,
  WorkflowAssetPartitioning
} from './db/types';
import { enqueueWorkflowRun } from './queue';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import {
  collectPartitionedAssetsFromSteps,
  deriveTimeWindowPartitionKey
} from './workflows/partitioning';

const DEFAULT_INTERVAL_MS = Number(process.env.WORKFLOW_SCHEDULER_INTERVAL_MS ?? 5_000);
const DEFAULT_BATCH_SIZE = Number(process.env.WORKFLOW_SCHEDULER_BATCH_SIZE ?? 10);
const DEFAULT_MAX_WINDOWS = Number(process.env.WORKFLOW_SCHEDULER_MAX_WINDOWS ?? 25);

function log(message: string, meta?: Record<string, unknown>) {
  logger.info(message, normalizeMeta(meta));
}

function logError(message: string, meta?: Record<string, unknown>) {
  logger.error(message, normalizeMeta(meta));
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

async function materializeSchedule(
  entry: WorkflowScheduleWithDefinition,
  now: Date,
  maxWindows: number
): Promise<void> {
  const { schedule, workflow: definition } = entry;

  if (!schedule.isActive) {
    return;
  }

  const catchupEnabled = Boolean(schedule.catchUp);
  const occurrenceLimit = catchupEnabled ? Math.max(maxWindows, 1) : 1;

  const partitionSpecs = Array.from(collectPartitionedAssetsFromSteps(definition.steps).values());
  const referenceTimePartition = partitionSpecs.length > 0 && partitionSpecs.every((spec) => spec?.type === 'timeWindow')
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
  }

  let cursor = parseScheduleDate(schedule.catchupCursor) ?? parseScheduleDate(schedule.nextRunAt);

  if (!cursor) {
    cursor = computeNextOccurrence(schedule, now, { inclusive: true });
  }

  if (!cursor) {
    await updateWorkflowScheduleRuntimeMetadata(schedule.id, {
      nextRunAt: null,
      catchupCursor: null
    });
    return;
  }

  let remaining = occurrenceLimit;
  let nextCursor: Date | null = cursor;
  let lastWindow = schedule.lastMaterializedWindow ?? null;

  while (nextCursor && nextCursor.getTime() <= now.getTime() && remaining > 0) {
    const windowEndIso = nextCursor.toISOString();
    const windowStartIso = determineWindowStart(schedule, lastWindow, nextCursor);

    const runParameters = schedule.parameters ?? definition.defaultParameters ?? {};
    const triggerPayload = {
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

    if (partitionSpecs.length > 0 && !referenceTimePartition) {
      log('Partitioned assets require explicit partition keys; skipping scheduled run', {
        workflowId: definition.id,
        workflowSlug: definition.slug
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
        break;
      }
      partitionKey = deriveTimeWindowPartitionKey(referenceTimePartition, occurrenceDate);
    }

    try {
      const run = await createWorkflowRun(definition.id, {
        parameters: runParameters,
        trigger: triggerPayload,
        triggeredBy: 'scheduler',
        partitionKey
      });
      await enqueueWorkflowRun(run.id);
      log('Enqueued scheduled workflow run', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
        scheduleId: schedule.id,
        workflowRunId: run.id,
        occurrence: windowEndIso
      });
    } catch (err) {
      logError('Failed to enqueue scheduled workflow run', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
        scheduleId: schedule.id,
        error: (err as Error).message ?? 'unknown error'
      });
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

  if (nextCursor) {
    const nextIso = nextCursor.toISOString();
    updates.nextRunAt = nextIso;
    updates.catchupCursor = nextIso;
  } else {
    updates.nextRunAt = null;
    updates.catchupCursor = null;
  }

  await updateWorkflowScheduleRuntimeMetadata(schedule.id, updates);
}

async function processSchedules(batchSize: number, maxWindows: number): Promise<void> {
  const now = new Date();
  const due = await listDueWorkflowSchedules({ limit: batchSize, now });
  if (due.length === 0) {
    return;
  }

  for (const entry of due) {
    try {
      await materializeSchedule(entry, now, maxWindows);
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

export function startWorkflowScheduler({
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  maxWindows = DEFAULT_MAX_WINDOWS
}: {
  intervalMs?: number;
  batchSize?: number;
  maxWindows?: number;
} = {}) {
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
      await processSchedules(boundedBatch, boundedWindows);
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
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
}
