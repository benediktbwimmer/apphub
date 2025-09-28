import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  type WorkflowDefinitionRecord,
  type WorkflowRunCreateInput,
  type WorkflowRunRecord,
  type WorkflowScheduleRecord,
  type WorkflowScheduleWithDefinition,
  type WorkflowScheduleWindow
} from '../src/db/types';

process.env.APPHUB_DISABLE_ANALYTICS = '1';
process.env.APPHUB_ANALYTICS_INTERVAL_MS = '0';
process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.APPHUB_DISABLE_SERVICE_POLLING = '1';
process.env.REDIS_URL = 'inline';

function alignToInterval(value: Date, intervalMs: number): Date {
  const aligned = Math.floor(value.getTime() / intervalMs) * intervalMs;
  return new Date(aligned);
}

function cloneWindow(window: WorkflowScheduleWindow | null): WorkflowScheduleWindow | null {
  if (!window) {
    return null;
  }
  return { start: window.start, end: window.end } satisfies WorkflowScheduleWindow;
}

function cloneSchedule(schedule: WorkflowScheduleRecord): WorkflowScheduleRecord {
  return {
    ...schedule,
    lastMaterializedWindow: cloneWindow(schedule.lastMaterializedWindow)
  } satisfies WorkflowScheduleRecord;
}

type SchedulerContextOptions = {
  schedule?: Partial<WorkflowScheduleRecord>;
  definition?: Partial<WorkflowDefinitionRecord>;
  shouldReturnSchedule?: (input: { schedule: WorkflowScheduleRecord; now: Date; invocation: number }) => boolean;
  mocks?: {
    enqueueWorkflowRun?: (runId: string) => Promise<void> | void;
  };
};

type SchedulerContext = ReturnType<typeof createSchedulerContext>;

function createSchedulerContext(options: SchedulerContextOptions = {}) {
  const now = new Date();
  const isoNow = now.toISOString();

  const baseDefinition: WorkflowDefinitionRecord = {
    id: 'workflow-1',
    slug: 'test-workflow',
    name: 'Test Workflow',
    version: 1,
    description: null,
    steps: [
      {
        id: 'step-1',
        name: 'Generate',
        type: 'job',
        jobSlug: 'generate-minute-data'
      }
    ],
    triggers: [],
    eventTriggers: [],
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    metadata: null,
    dag: {
      adjacency: {},
      roots: ['step-1'],
      topologicalOrder: ['step-1'],
      edges: 0
    },
    schedules: [],
    createdAt: isoNow,
    updatedAt: isoNow
  } satisfies WorkflowDefinitionRecord;

  const definitionOverrides = options.definition ?? {};
  const definition: WorkflowDefinitionRecord = {
    ...baseDefinition,
    ...definitionOverrides,
    steps: definitionOverrides.steps ?? baseDefinition.steps,
    dag: definitionOverrides.dag ?? baseDefinition.dag,
    schedules: definitionOverrides.schedules ?? []
  } satisfies WorkflowDefinitionRecord;

  const baseNextRunAt = alignToInterval(new Date(Date.now() - 60_000), 30_000).toISOString();

  let storedSchedule: WorkflowScheduleRecord = {
    id: 'schedule-1',
    workflowDefinitionId: definition.id,
    name: 'Test Schedule',
    description: null,
    cron: '*/30 * * * * *',
    timezone: 'UTC',
    parameters: null,
    startWindow: null,
    endWindow: null,
    catchUp: false,
    nextRunAt: baseNextRunAt,
    lastMaterializedWindow: null,
    catchupCursor: baseNextRunAt,
    isActive: true,
    createdAt: baseNextRunAt,
    updatedAt: baseNextRunAt
  } satisfies WorkflowScheduleRecord;

  const scheduleOverrides = options.schedule ?? {};
  storedSchedule = {
    ...storedSchedule,
    ...scheduleOverrides,
    lastMaterializedWindow:
      scheduleOverrides.lastMaterializedWindow !== undefined
        ? cloneWindow(scheduleOverrides.lastMaterializedWindow)
        : storedSchedule.lastMaterializedWindow,
    workflowDefinitionId: definition.id
  } satisfies WorkflowScheduleRecord;

  const runs: WorkflowRunRecord[] = [];
  const enqueuedRuns: string[] = [];
  const occurrences: string[] = [];
  const windows: WorkflowScheduleWindow[] = [];
  const updates: Array<{
    nextRunAt?: string | null;
    catchupCursor?: string | null;
    lastWindow?: WorkflowScheduleWindow | null;
  }> = [];
  const dueLog: boolean[] = [];
  let lastSchedulerNow: Date | null = null;
  let listInvocation = 0;

  const shouldReturnSchedule =
    options.shouldReturnSchedule ??
    (({ schedule, now: reference }: { schedule: WorkflowScheduleRecord; now: Date }) => {
      return Boolean(
        schedule.isActive &&
          schedule.nextRunAt &&
          new Date(schedule.nextRunAt).getTime() <= reference.getTime()
      );
    });

  const deps = {
    enqueueWorkflowRun: mock.fn(async (runId: string) => {
      enqueuedRuns.push(runId);
      if (options.mocks?.enqueueWorkflowRun) {
        await options.mocks.enqueueWorkflowRun(runId);
      }
    }),
    listDueWorkflowSchedules: mock.fn(
      async ({ now: schedulerNow }: { limit?: number; now?: Date } = {}): Promise<WorkflowScheduleWithDefinition[]> => {
        const referenceNow = schedulerNow ?? new Date();
        lastSchedulerNow = referenceNow;
        listInvocation += 1;
        const due = shouldReturnSchedule({
          schedule: storedSchedule,
          now: referenceNow,
          invocation: listInvocation
        });
        dueLog.push(due);
        if (!due) {
          return [];
        }
        const scheduleCopy = cloneSchedule(storedSchedule);
        return [
          {
            schedule: scheduleCopy,
            workflow: definition
          }
        ];
      }
    ),
    createWorkflowRun: mock.fn(
      async (workflowId: string, input: WorkflowRunCreateInput = {}): Promise<WorkflowRunRecord> => {
        const timestamp = new Date().toISOString();
        const run: WorkflowRunRecord = {
          id: `run-${runs.length + 1}`,
          workflowDefinitionId: workflowId,
          status: input.status ?? 'pending',
          parameters: input.parameters ?? {},
          context: input.context ?? {},
          output: null,
          errorMessage: null,
          currentStepId: input.currentStepId ?? null,
          currentStepIndex: input.currentStepIndex ?? null,
          metrics: null,
          triggeredBy: input.triggeredBy ?? 'scheduler',
          trigger: input.trigger ?? null,
          partitionKey: input.partitionKey ?? null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          createdAt: timestamp,
          updatedAt: timestamp
        } satisfies WorkflowRunRecord;

        const triggerPayload = (input.trigger as { schedule?: { occurrence?: string; window?: WorkflowScheduleWindow } }) ?? {};
        if (triggerPayload.schedule?.occurrence) {
          occurrences.push(triggerPayload.schedule.occurrence);
          if (triggerPayload.schedule.window) {
            windows.push(triggerPayload.schedule.window);
          }
        }

        runs.push(run);
        return run;
      }
    ),
    updateWorkflowScheduleRuntimeMetadata: mock.fn(
      async (
        _id: string,
        payload: { nextRunAt?: string | null; catchupCursor?: string | null; lastWindow?: WorkflowScheduleWindow | null }
      ) => {
        updates.push({ ...payload });
        if (Object.prototype.hasOwnProperty.call(payload, 'nextRunAt')) {
          storedSchedule = {
            ...storedSchedule,
            nextRunAt: payload.nextRunAt ?? null
          } satisfies WorkflowScheduleRecord;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'catchupCursor')) {
          storedSchedule = {
            ...storedSchedule,
            catchupCursor: payload.catchupCursor ?? null
          } satisfies WorkflowScheduleRecord;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'lastWindow')) {
          storedSchedule = {
            ...storedSchedule,
            lastMaterializedWindow: cloneWindow(payload.lastWindow ?? null)
          } satisfies WorkflowScheduleRecord;
        }
        storedSchedule = {
          ...storedSchedule,
          updatedAt: new Date().toISOString()
        } satisfies WorkflowScheduleRecord;
      }
    )
  } as const;

  return {
    get schedule(): WorkflowScheduleRecord {
      return storedSchedule;
    },
    definition,
    runs,
    occurrences,
    windows,
    enqueuedRuns,
    updates,
    dueLog,
    deps,
    get lastSchedulerNow(): Date | null {
      return lastSchedulerNow;
    },
    async runScheduler({
      intervalMs = 10,
      waitMs = 150,
      batchSize = 5,
      maxWindows = 5
    }: {
      intervalMs?: number;
      waitMs?: number;
      batchSize?: number;
      maxWindows?: number;
    } = {}) {
      const { startWorkflowScheduler } = await import('../src/workflowScheduler');
      const scheduler = startWorkflowScheduler({ intervalMs, batchSize, maxWindows }, deps);
      try {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } finally {
        await scheduler.stop();
      }
      return { lastSchedulerNow } as const;
    }
  };
}

describe('workflow scheduler materialization', () => {
  it('skips backlog when catch-up is disabled', async () => {
    const fiveMinutesAgo = alignToInterval(new Date(Date.now() - 5 * 60_000), 30_000).toISOString();
    const context = createSchedulerContext({
      schedule: {
        catchUp: false,
        cron: '*/30 * * * * *',
        nextRunAt: fiveMinutesAgo,
        catchupCursor: fiveMinutesAgo
      }
    });

    await context.runScheduler({ maxWindows: 4, waitMs: 120 });

    assert.equal(context.runs.length, 1);
    assert.equal(context.enqueuedRuns.length, 1);
    assert.equal(context.occurrences.length, 1);

    const lastUpdate = context.updates.at(-1);
    assert.ok(lastUpdate, 'expected runtime metadata update');
    assert.equal(lastUpdate!.catchupCursor, null);
    assert.ok(lastUpdate!.nextRunAt, 'expected nextRunAt to be scheduled');
    assert.ok(
      lastUpdate!.nextRunAt && new Date(lastUpdate!.nextRunAt).getTime() > new Date(context.occurrences[0]).getTime(),
      'next run should be after the processed occurrence'
    );

    assert.ok(context.dueLog[0], 'schedule should be processed on the first tick');
    assert.equal(context.dueLog.slice(1).some(Boolean), false, 'schedule should not remain due after rescheduling');
  });

  it('processes backlog when catch-up is enabled respecting max windows', async () => {
    const backlogStart = alignToInterval(new Date(Date.now() - 150_000), 30_000).toISOString();
    const context = createSchedulerContext({
      schedule: {
        catchUp: true,
        cron: '*/30 * * * * *',
        nextRunAt: backlogStart,
        catchupCursor: backlogStart
      },
      shouldReturnSchedule: ({ invocation }) => invocation === 1
    });

    await context.runScheduler({ maxWindows: 3, waitMs: 120 });

    assert.equal(context.runs.length, 3, 'should enqueue up to the max window limit');
    assert.deepEqual(
      context.enqueuedRuns,
      context.runs.map((run) => run.id),
      'each run should be enqueued'
    );

    assert.equal(context.occurrences.length, 3);
    const deltas = context.occurrences.slice(1).map((occurrence, index) => {
      const previous = context.occurrences[index];
      return new Date(occurrence).getTime() - new Date(previous).getTime();
    });
    for (const delta of deltas) {
      assert.ok(delta >= 29_000 && delta <= 31_000, 'occurrences should advance by cron cadence');
    }

    const lastUpdate = context.updates.at(-1);
    assert.ok(lastUpdate, 'expected runtime metadata update');
    assert.equal(lastUpdate!.catchupCursor, lastUpdate!.nextRunAt, 'catch-up cursor should track next run');
    assert.ok(
      lastUpdate!.nextRunAt &&
        new Date(lastUpdate!.nextRunAt).getTime() - new Date(context.occurrences.at(-1)!).getTime() >= 29_000,
      'next run should follow the last processed occurrence'
    );
  });

  it('ignores inactive schedules', async () => {
    const context = createSchedulerContext({
      schedule: {
        isActive: false
      }
    });

    await context.runScheduler({ waitMs: 60 });

    assert.equal(context.runs.length, 0);
    assert.equal(context.enqueuedRuns.length, 0);
    assert.equal(context.updates.length, 0);
    assert.ok(context.dueLog.length > 0);
    assert.equal(context.dueLog.some(Boolean), false, 'inactive schedules should never be due');
  });

  it('skips materialization for non time-window partitioned assets', async () => {
    const fiveMinutesAgo = alignToInterval(new Date(Date.now() - 5 * 60_000), 30_000).toISOString();
    const context = createSchedulerContext({
      definition: {
        steps: [
          {
            id: 'step-1',
            name: 'Generate',
            type: 'job',
            jobSlug: 'generate-minute-data',
            produces: [
              {
                assetId: 'dataset',
                partitioning: {
                  type: 'static',
                  keys: ['a', 'b']
                }
              }
            ]
          }
        ]
      },
      schedule: {
        catchUp: false,
        cron: '*/30 * * * * *',
        nextRunAt: fiveMinutesAgo,
        catchupCursor: fiveMinutesAgo
      },
      shouldReturnSchedule: ({ invocation }) => invocation === 1
    });

    await context.runScheduler({ waitMs: 120 });

    assert.equal(context.runs.length, 0, 'runs should not be created');
    assert.equal(context.enqueuedRuns.length, 0, 'runs should not be enqueued');

    const lastUpdate = context.updates.at(-1);
    assert.ok(lastUpdate, 'metadata should still be updated');
    assert.equal(lastUpdate!.catchupCursor, null);
    assert.ok(lastUpdate!.nextRunAt, 'next run should be scheduled despite skipping execution');
  });

  it('logs failure when enqueueing a run throws and leaves schedule due for retry', async () => {
    const thirtySecondsAgo = alignToInterval(new Date(Date.now() - 30_000), 30_000).toISOString();
    const context = createSchedulerContext({
      schedule: {
        catchUp: true,
        cron: '*/30 * * * * *',
        nextRunAt: thirtySecondsAgo,
        catchupCursor: thirtySecondsAgo
      },
      shouldReturnSchedule: ({ invocation }) => invocation === 1,
      mocks: {
        enqueueWorkflowRun: async () => {
          throw new Error('boom');
        }
      }
    });

    await context.runScheduler({ waitMs: 120 });

    assert.equal(context.runs.length, 1, 'scheduler should attempt the run once');
    assert.equal(context.enqueuedRuns.length, 1, 'enqueue should be invoked before failing');

    const lastUpdate = context.updates.at(-1);
    assert.ok(lastUpdate, 'metadata should be updated even on failure');
    assert.equal(lastUpdate!.catchupCursor, lastUpdate!.nextRunAt, 'catch-up cursor should remain on the failed occurrence');
    assert.ok(
      lastUpdate!.nextRunAt &&
        new Date(lastUpdate!.nextRunAt).getTime() === new Date(context.occurrences[0]).getTime(),
      'next run should remain the failed occurrence for retry'
    );
  });
});
