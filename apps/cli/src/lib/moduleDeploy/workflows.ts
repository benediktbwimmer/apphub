import type { ModuleManifest, WorkflowDefinition } from '@apphub/module-sdk';
import {
  resolveWorkflowProvisioningPlan,
  type WorkflowProvisioningPlan,
  type WorkflowProvisioningSchedule
} from '@apphub/module-registry';
import { coreRequest, CoreError } from '../core';
import type { ModuleDeploymentLogger, WorkflowCustomization } from './types';

interface SyncWorkflowsOptions {
  manifest: ModuleManifest;
  moduleId: string;
  moduleVersion: string;
  coreUrl: string;
  coreToken: string;
  logger: ModuleDeploymentLogger;
  workflowCustomization?: WorkflowCustomization<unknown>;
  config?: unknown;
}

export async function syncWorkflows(options: SyncWorkflowsOptions): Promise<number> {
  const targets = options.manifest.targets.filter((target) => target.kind === 'workflow');
  let processed = 0;

  for (const target of targets) {
    const workflow = target.workflow;
    if (!workflow || !workflow.definition) {
      continue;
    }

    const definition = cloneJson<WorkflowDefinition>(
      workflow.definition,
      {} as WorkflowDefinition
    );
    if (!definition.slug) {
      definition.slug = target.name;
    }
    if (!definition.name || definition.name.trim().length === 0) {
      definition.name = definition.slug;
    }

    if (options.workflowCustomization?.applyDefaults) {
      options.workflowCustomization.applyDefaults(definition, options.config);
    }

    const metadataRecord = asRecord(definition.metadata) ?? {};
    metadataRecord.module = {
      id: options.moduleId,
      version: options.moduleVersion,
      targetName: target.name,
      targetVersion: target.version,
      fingerprint: target.fingerprint ?? null
    };
    definition.metadata = metadataRecord;

    await upsertWorkflowDefinition(definition, options);

    const plan = buildProvisioningPlan(definition, options);
    if (plan) {
      await ensureWorkflowSchedules(definition.slug, plan.schedules, options);
      await ensureWorkflowTriggers(definition.slug, plan.eventTriggers, options);
    }

    processed += 1;
  }

  return processed;
}

async function upsertWorkflowDefinition(definition: WorkflowDefinition, options: SyncWorkflowsOptions) {
  const slug = String(definition.slug);
  try {
    const existing = await coreRequest({
      baseUrl: options.coreUrl,
      token: options.coreToken,
      method: 'GET',
      path: `/workflows/${encodeURIComponent(slug)}`
    });
    if (existing) {
      await coreRequest({
        baseUrl: options.coreUrl,
        token: options.coreToken,
        method: 'PATCH',
        path: `/workflows/${encodeURIComponent(slug)}`,
        body: buildWorkflowUpdatePayload(definition)
      });
      options.logger.info('Updated workflow definition', { slug });
      return;
    }
  } catch (error) {
    if (!(error instanceof CoreError) || error.status !== 404) {
      throw error;
    }
  }

  await coreRequest({
    baseUrl: options.coreUrl,
    token: options.coreToken,
    method: 'POST',
    path: '/workflows',
    body: buildWorkflowCreatePayload(definition)
  });
  options.logger.info('Created workflow definition', { slug });
}

function buildProvisioningPlan(
  definition: WorkflowDefinition,
  options: SyncWorkflowsOptions
): WorkflowProvisioningPlan | null {
  const normalizedDefinition = {
    ...definition,
    name: definition.name ?? definition.slug
  } as WorkflowDefinition & { name: string };

  if (options.workflowCustomization?.buildPlan) {
    const plan = options.workflowCustomization.buildPlan(normalizedDefinition, options.config);
    if (plan) {
      return plan;
    }
  }

  try {
    return resolveWorkflowProvisioningPlan(normalizedDefinition as never);
  } catch {
    return null;
  }
}

async function ensureWorkflowSchedules(
  slug: string,
  schedules: WorkflowProvisioningPlan['schedules'],
  options: SyncWorkflowsOptions
): Promise<void> {
  if (schedules.length === 0) {
    return;
  }

  const allSchedules = await coreRequest<{ data: WorkflowScheduleListEntry[] }>({
    baseUrl: options.coreUrl,
    token: options.coreToken,
    method: 'GET',
    path: '/workflow-schedules'
  });
  const scoped = allSchedules.data.filter((entry) => entry.workflow?.slug === slug);
  const remaining = scoped.map((entry) => ({ entry, signature: normalizeExistingSchedule(entry.schedule) }));

  for (const scheduleTemplate of schedules) {
    const desired = normalizeScheduleTemplate(scheduleTemplate);
    const index = matchingScheduleIndex(remaining, desired);
    const match = index >= 0 ? remaining.splice(index, 1)[0] : undefined;

    if (!match) {
      const payload = buildScheduleCreatePayload(scheduleTemplate);
      await coreRequest({
        baseUrl: options.coreUrl,
        token: options.coreToken,
        method: 'POST',
        path: `/workflows/${encodeURIComponent(slug)}/schedules`,
        body: payload
      });
      options.logger.info('Created workflow schedule', {
        workflow: slug,
        schedule: scheduleTemplate.name ?? scheduleTemplate.cron
      });
      continue;
    }

    const updates = buildScheduleUpdatePayload(scheduleTemplate, match.signature);
    if (Object.keys(updates).length === 0) {
      continue;
    }

    await coreRequest({
      baseUrl: options.coreUrl,
      token: options.coreToken,
      method: 'PATCH',
      path: `/workflow-schedules/${match.entry.schedule.id}`,
      body: updates
    });
    options.logger.info('Updated workflow schedule', {
      workflow: slug,
      schedule: scheduleTemplate.name ?? scheduleTemplate.cron
    });
  }
}

async function ensureWorkflowTriggers(
  slug: string,
  triggers: WorkflowProvisioningPlan['eventTriggers'],
  options: SyncWorkflowsOptions
): Promise<void> {
  if (triggers.length === 0) {
    return;
  }

  const response = await coreRequest<{ data: TriggerRecord[] | { triggers?: TriggerRecord[] } }>({
    baseUrl: options.coreUrl,
    token: options.coreToken,
    method: 'GET',
    path: `/workflows/${encodeURIComponent(slug)}/triggers`
  });

  const triggerList = Array.isArray(response.data)
    ? response.data
    : Array.isArray((response.data as { triggers?: TriggerRecord[] }).triggers)
      ? ((response.data as { triggers?: TriggerRecord[] }).triggers as TriggerRecord[])
      : [];

  for (const trigger of triggers) {
    const existing = triggerList.find((entry) => entry.name === trigger.name) ?? null;
    const payload = buildTriggerPayload(trigger);

    if (existing) {
      await coreRequest({
        baseUrl: options.coreUrl,
        token: options.coreToken,
        method: 'PATCH',
        path: `/workflows/${encodeURIComponent(slug)}/triggers/${existing.id}`,
        body: payload
      });
      options.logger.info('Updated workflow trigger', { workflow: slug, name: trigger.name });
      continue;
    }

    await coreRequest({
      baseUrl: options.coreUrl,
      token: options.coreToken,
      method: 'POST',
      path: `/workflows/${encodeURIComponent(slug)}/triggers`,
      body: payload
    });
    options.logger.info('Created workflow trigger', { workflow: slug, name: trigger.name });
  }
}

function buildWorkflowCreatePayload(definition: WorkflowDefinition) {
  const { slug, triggers: _ignoredTriggers, ...rest } = definition as WorkflowDefinition & {
    triggers?: unknown;
  };
  return { slug, ...rest };
}

function buildWorkflowUpdatePayload(definition: WorkflowDefinition) {
  const { slug, triggers: _ignoredTriggers, ...rest } = definition as WorkflowDefinition & {
    triggers?: unknown;
  };
  return rest;
}

function cloneJson<T>(value: unknown, fallback: T): T {
  const source = value === undefined || value === null ? fallback : (value as T);
  return JSON.parse(JSON.stringify(source)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeScheduleTemplate(schedule: WorkflowProvisioningSchedule): NormalizedScheduleSignature {
  return {
    name: schedule.name ?? null,
    description: schedule.description ?? null,
    cron: schedule.cron.trim(),
    timezone: schedule.timezone ?? null,
    startWindow: schedule.startWindow ?? null,
    endWindow: schedule.endWindow ?? null,
    catchUp: schedule.catchUp ?? false,
    isActive: schedule.isActive ?? true,
    parametersKey: JSON.stringify(schedule.parameters ?? null)
  };
}

function normalizeExistingSchedule(schedule: WorkflowScheduleListEntry['schedule']): NormalizedScheduleSignature {
  return {
    name: schedule.name ?? null,
    description: schedule.description ?? null,
    cron: schedule.cron.trim(),
    timezone: schedule.timezone ?? null,
    startWindow: schedule.startWindow ?? null,
    endWindow: schedule.endWindow ?? null,
    catchUp: schedule.catchUp ?? false,
    isActive: schedule.isActive ?? true,
    parametersKey: JSON.stringify(schedule.parameters ?? null)
  };
}

function matchingScheduleIndex(
  existing: Array<{ signature: NormalizedScheduleSignature }>,
  desired: NormalizedScheduleSignature
): number {
  if (desired.name) {
    return existing.findIndex((candidate) => candidate.signature.name === desired.name);
  }
  return existing.findIndex(
    (candidate) => !candidate.signature.name && candidate.signature.cron === desired.cron
  );
}

function schedulesEquivalent(left: NormalizedScheduleSignature, right: NormalizedScheduleSignature): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.cron === right.cron &&
    left.timezone === right.timezone &&
    left.startWindow === right.startWindow &&
    left.endWindow === right.endWindow &&
    left.catchUp === right.catchUp &&
    left.isActive === right.isActive &&
    left.parametersKey === right.parametersKey
  );
}

function buildScheduleCreatePayload(schedule: WorkflowProvisioningSchedule) {
  const payload: Record<string, unknown> = { cron: schedule.cron };
  if (schedule.name) {
    payload.name = schedule.name;
  }
  if (schedule.description) {
    payload.description = schedule.description;
  }
  if (schedule.timezone !== undefined && schedule.timezone !== null) {
    payload.timezone = schedule.timezone;
  }
  if (schedule.startWindow !== undefined && schedule.startWindow !== null) {
    payload.startWindow = schedule.startWindow;
  }
  if (schedule.endWindow !== undefined && schedule.endWindow !== null) {
    payload.endWindow = schedule.endWindow;
  }
  if (schedule.catchUp !== undefined) {
    payload.catchUp = schedule.catchUp;
  }
  if (schedule.isActive !== undefined) {
    payload.isActive = schedule.isActive;
  }
  if (schedule.parameters && Object.keys(schedule.parameters).length > 0) {
    payload.parameters = schedule.parameters;
  }
  return payload;
}

function buildScheduleUpdatePayload(
  template: WorkflowProvisioningSchedule,
  existing: NormalizedScheduleSignature
) {
  const desired = normalizeScheduleTemplate(template);
  const updates: Record<string, unknown> = {};
  if (desired.name !== existing.name) {
    updates.name = desired.name;
  }
  if (desired.description !== existing.description) {
    updates.description = desired.description;
  }
  if (desired.cron !== existing.cron) {
    updates.cron = desired.cron;
  }
  if (desired.timezone !== existing.timezone) {
    updates.timezone = desired.timezone;
  }
  if (desired.startWindow !== existing.startWindow) {
    updates.startWindow = desired.startWindow;
  }
  if (desired.endWindow !== existing.endWindow) {
    updates.endWindow = desired.endWindow;
  }
  if (desired.catchUp !== existing.catchUp) {
    updates.catchUp = desired.catchUp;
  }
  if (desired.isActive !== existing.isActive) {
    updates.isActive = desired.isActive;
  }
  if (desired.parametersKey !== existing.parametersKey) {
    updates.parameters = template.parameters ?? null;
  }
  return updates;
}

function buildTriggerPayload(trigger: WorkflowProvisioningPlan['eventTriggers'][number]) {
  const payload: Record<string, unknown> = {
    name: trigger.name,
    description: trigger.description,
    eventType: trigger.eventType,
    predicates: trigger.predicates ?? []
  };
  if (trigger.eventSource !== undefined && trigger.eventSource !== null) {
    payload.eventSource = trigger.eventSource;
  }
  if (trigger.parameterTemplate) {
    payload.parameterTemplate = trigger.parameterTemplate;
  }
  if (trigger.metadata !== undefined) {
    payload.metadata = trigger.metadata;
  }
  if (trigger.idempotencyKeyExpression) {
    payload.idempotencyKeyExpression = trigger.idempotencyKeyExpression;
  }
  if (trigger.runKeyTemplate) {
    payload.runKeyTemplate = trigger.runKeyTemplate;
  }
  if (trigger.maxConcurrency !== undefined && trigger.maxConcurrency !== null) {
    payload.maxConcurrency = trigger.maxConcurrency;
  }
  if (trigger.throttleWindowMs !== undefined && trigger.throttleWindowMs !== null) {
    payload.throttleWindowMs = trigger.throttleWindowMs;
  }
  if (trigger.throttleCount !== undefined && trigger.throttleCount !== null) {
    payload.throttleCount = trigger.throttleCount;
  }
  if (trigger.status) {
    payload.status = trigger.status;
  }
  return payload;
}

type WorkflowScheduleListEntry = {
  schedule: {
    id: string;
    name: string | null;
    description: string | null;
    cron: string;
    timezone: string | null;
    startWindow: string | null;
    endWindow: string | null;
    catchUp?: boolean | null;
    isActive?: boolean | null;
    parameters?: Record<string, unknown> | null;
  };
  workflow: {
    slug: string;
  };
};

type NormalizedScheduleSignature = {
  name: string | null;
  description: string | null;
  cron: string;
  timezone: string | null;
  startWindow: string | null;
  endWindow: string | null;
  catchUp: boolean;
  isActive: boolean;
  parametersKey: string;
};

type TriggerRecord = {
  id: string;
  name: string | null;
};
