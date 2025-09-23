import { parseExpression, type ParserOptions } from 'cron-parser';
import {
  createWorkflowRun,
  listDueWorkflowSchedules,
  updateWorkflowScheduleMetadata
} from './db/workflows';
import type {
  WorkflowDefinitionRecord,
  WorkflowScheduleWindow,
  WorkflowTriggerDefinition
} from './db/types';
import { enqueueWorkflowRun } from './queue';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';

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

function findScheduleTrigger(triggers: WorkflowTriggerDefinition[]): WorkflowTriggerDefinition | null {
  for (const trigger of triggers) {
    if (trigger.type && trigger.type.toLowerCase() === 'schedule' && trigger.schedule) {
      return trigger;
    }
  }
  return null;
}

function computeNextOccurrence(
  schedule: WorkflowTriggerDefinition['schedule'],
  from: Date,
  { inclusive = false }: { inclusive?: boolean } = {}
): Date | null {
  if (!schedule) {
    return null;
  }

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
    const interval = parseExpression(schedule.cron, {
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
  schedule: WorkflowTriggerDefinition['schedule'],
  occurrence: Date
): Date | null {
  if (!schedule) {
    return null;
  }

  const options: ParserOptions = {};
  if (schedule.timezone) {
    options.tz = schedule.timezone;
  }

  const startWindow = parseScheduleDate(schedule.startWindow);

  try {
    const interval = parseExpression(schedule.cron, {
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
  schedule: WorkflowTriggerDefinition['schedule'],
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
  definition: WorkflowDefinitionRecord,
  now: Date,
  maxWindows: number
): Promise<void> {
  const scheduleTrigger = findScheduleTrigger(definition.triggers);
  if (!scheduleTrigger || !scheduleTrigger.schedule) {
    await updateWorkflowScheduleMetadata(definition.id, {
      scheduleNextRunAt: null,
      scheduleCatchupCursor: null,
      scheduleLastMaterializedWindow: null
    });
    return;
  }

  const schedule = scheduleTrigger.schedule;
  const catchupEnabled = Boolean(schedule.catchUp);
  const occurrenceLimit = catchupEnabled ? Math.max(maxWindows, 1) : 1;

  let cursor = parseScheduleDate(definition.scheduleCatchupCursor) ??
    parseScheduleDate(definition.scheduleNextRunAt);

  if (!cursor) {
    cursor = computeNextOccurrence(schedule, now, { inclusive: true });
  }

  if (!cursor) {
    await updateWorkflowScheduleMetadata(definition.id, {
      scheduleNextRunAt: null,
      scheduleCatchupCursor: null
    });
    return;
  }

  let remaining = occurrenceLimit;
  let nextCursor: Date | null = cursor;
  let lastWindow = definition.scheduleLastMaterializedWindow ?? null;

  while (nextCursor && nextCursor.getTime() <= now.getTime() && remaining > 0) {
    const windowEndIso = nextCursor.toISOString();
    const windowStartIso = determineWindowStart(schedule, lastWindow, nextCursor);

    const triggerPayload = {
      type: 'schedule',
      schedule: {
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

    try {
      const run = await createWorkflowRun(definition.id, {
        parameters: definition.defaultParameters ?? {},
        trigger: triggerPayload,
        triggeredBy: 'scheduler'
      });
      await enqueueWorkflowRun(run.id);
      log('Enqueued scheduled workflow run', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
        workflowRunId: run.id,
        occurrence: windowEndIso
      });
    } catch (err) {
      logError('Failed to enqueue scheduled workflow run', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
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
    scheduleNextRunAt?: string | null;
    scheduleCatchupCursor?: string | null;
    scheduleLastMaterializedWindow?: WorkflowScheduleWindow | null;
  } = {};

  updates.scheduleLastMaterializedWindow = lastWindow;

  if (nextCursor) {
    updates.scheduleNextRunAt = nextCursor.toISOString();
    updates.scheduleCatchupCursor = nextCursor.toISOString();
  } else {
    updates.scheduleNextRunAt = null;
    updates.scheduleCatchupCursor = null;
  }

  await updateWorkflowScheduleMetadata(definition.id, updates);
}

async function processSchedules(batchSize: number, maxWindows: number): Promise<void> {
  const now = new Date();
  const due = await listDueWorkflowSchedules({ limit: batchSize, now });
  if (due.length === 0) {
    return;
  }

  for (const definition of due) {
    try {
      await materializeSchedule(definition, now, maxWindows);
    } catch (err) {
      logError('Failed to materialize workflow schedule', {
        workflowId: definition.id,
        workflowSlug: definition.slug,
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
