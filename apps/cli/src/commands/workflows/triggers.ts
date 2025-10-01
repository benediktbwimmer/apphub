import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import {
  coreRequest,
  resolveCoreToken,
  resolveCoreUrl,
  CoreError
} from '../../lib/core';
import { confirmPrompt } from '../../lib/prompt';

type TriggerRecord = {
  id: string;
  status: 'active' | 'disabled';
  name: string | null;
  description: string | null;
  eventType: string;
  eventSource: string | null;
  predicates: unknown[];
  parameterTemplate: unknown | null;
  throttleWindowMs: number | null;
  throttleCount: number | null;
  maxConcurrency: number | null;
  idempotencyKeyExpression: string | null;
  metadata: unknown | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type WorkflowSummary = {
  id: string;
  slug: string;
  name: string;
};

type TriggerListResponse = {
  data: {
    workflow: WorkflowSummary;
    triggers: TriggerRecord[];
  };
};

type TriggerSingleResponse = {
  data: TriggerRecord;
};

function workspaceRelative(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

async function loadDefinition(filePath: string): Promise<Record<string, unknown>> {
  const resolved = workspaceRelative(filePath);
  const contents = await fs.readFile(resolved, 'utf8');

  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    return parsed;
  } catch {
    try {
      const parsed = parseYaml(contents);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Parsed YAML is not an object');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse trigger definition at ${resolved}: ${message}`);
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function printValidationErrors(details: unknown): boolean {
  const record = toRecord(details);
  if (!record) {
    return false;
  }
  const formErrors = Array.isArray(record.formErrors)
    ? record.formErrors.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const fieldErrorsRecord = toRecord(record.fieldErrors) ?? {};
  const fieldEntries: Array<[string, string]> = [];
  for (const [field, value] of Object.entries(fieldErrorsRecord)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        fieldEntries.push([field, entry.trim()]);
      }
    }
  }
  if (formErrors.length === 0 && fieldEntries.length === 0) {
    return false;
  }
  console.error('Validation errors:');
  for (const message of formErrors) {
    console.error(`  - ${message}`);
  }
  for (const [field, message] of fieldEntries) {
    console.error(`  ${field}: ${message}`);
  }
  return true;
}

function printTriggerTable(workflow: WorkflowSummary, triggers: TriggerRecord[]): void {
  console.log(`Workflow: ${workflow.name} (${workflow.slug})`);
  if (triggers.length === 0) {
    console.log('No event triggers configured.');
    return;
  }

  const rows = triggers.map((trigger) => ({
    id: trigger.id,
    status: trigger.status,
    event: trigger.eventSource ? `${trigger.eventType} ← ${trigger.eventSource}` : trigger.eventType,
    name: trigger.name ?? '—',
    version: trigger.version,
    throttles:
      trigger.throttleWindowMs && trigger.throttleCount
        ? `${trigger.throttleCount}/${trigger.throttleWindowMs}ms`
        : '—',
    concurrency: trigger.maxConcurrency ?? '—',
    updatedAt: trigger.updatedAt
  }));

  console.table(rows);
}

async function listTriggers(workflow: string, options: { token?: string; coreUrl?: string; status?: string; eventType?: string; eventSource?: string }): Promise<void> {
  const baseUrl = resolveCoreUrl(options.coreUrl);
  const token = resolveCoreToken(options.token);

  const params = new URLSearchParams();
  if (options.status) {
    params.set('status', options.status);
  }
  if (options.eventType) {
    params.set('eventType', options.eventType);
  }
  if (options.eventSource) {
    params.set('eventSource', options.eventSource);
  }

  const query = params.toString();
  const path = `/workflows/${workflow}/triggers${query ? `?${query}` : ''}`;

  const response = await coreRequest<TriggerListResponse>({
    baseUrl,
    token,
    path
  });

  printTriggerTable(response.data.workflow, response.data.triggers);
}

async function createTrigger(workflow: string, options: { token?: string; coreUrl?: string; file?: string; yes?: boolean }): Promise<void> {
  if (!options.file) {
    throw new Error('Provide --file with a JSON or YAML definition.');
  }

  const payload = await loadDefinition(options.file);
  const baseUrl = resolveCoreUrl(options.coreUrl);
  const token = resolveCoreToken(options.token);

  const summary: string[] = [];
  const eventType = typeof payload.eventType === 'string' ? payload.eventType : undefined;
  if (eventType) {
    const eventSource = typeof payload.eventSource === 'string' ? payload.eventSource : null;
    summary.push(`Event: ${eventSource ? `${eventType} ← ${eventSource}` : eventType}`);
  }
  if (typeof payload.name === 'string') {
    summary.push(`Name: ${payload.name}`);
  }
  if (summary.length > 0) {
    console.log(summary.join('\n'));
  }

  const shouldProceed = options.yes ? true : await confirmPrompt('Create trigger with the definition above?');
  if (!shouldProceed) {
    console.log('Aborted.');
    return;
  }

  const response = await coreRequest<TriggerSingleResponse>({
    baseUrl,
    token,
    path: `/workflows/${workflow}/triggers`,
    method: 'POST',
    body: payload
  });

  const trigger = response.data;
  console.log(`Created trigger ${trigger.id} (${trigger.eventType}) with status ${trigger.status}.`);
}

async function updateTrigger(
  workflow: string,
  triggerId: string,
  options: { token?: string; coreUrl?: string; file?: string; status?: string; yes?: boolean }
): Promise<void> {
  const baseUrl = resolveCoreUrl(options.coreUrl);
  const token = resolveCoreToken(options.token);

  let payload: Record<string, unknown> = {};
  if (options.file) {
    payload = await loadDefinition(options.file);
  }

  if (options.status) {
    payload.status = options.status;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('No update fields provided. Use --file or --status.');
  }

  if (!(options.yes ?? false)) {
    const proceed = await confirmPrompt(`Update trigger ${triggerId}?`);
    if (!proceed) {
      console.log('Aborted.');
      return;
    }
  }

  const response = await coreRequest<TriggerSingleResponse>({
    baseUrl,
    token,
    path: `/workflows/${workflow}/triggers/${triggerId}`,
    method: 'PATCH',
    body: payload
  });

  const trigger = response.data;
  console.log(`Updated trigger ${trigger.id}; status is now ${trigger.status} (version ${trigger.version}).`);
}

async function disableTrigger(
  workflow: string,
  triggerId: string,
  options: { token?: string; coreUrl?: string; yes?: boolean }
): Promise<void> {
  const baseUrl = resolveCoreUrl(options.coreUrl);
  const token = resolveCoreToken(options.token);

  if (!(options.yes ?? false)) {
    const proceed = await confirmPrompt(`Disable trigger ${triggerId}?`);
    if (!proceed) {
      console.log('Aborted.');
      return;
    }
  }

  const response = await coreRequest<TriggerSingleResponse>({
    baseUrl,
    token,
    path: `/workflows/${workflow}/triggers/${triggerId}`,
    method: 'PATCH',
    body: { status: 'disabled' }
  });

  const trigger = response.data;
  console.log(`Trigger ${trigger.id} disabled.`);
}

export function registerTriggerCommands(workflows: Command): void {
  const triggers = workflows.command('triggers').description('Manage workflow event triggers');

  triggers
    .command('list <workflow>')
    .description('List triggers for a workflow')
    .option('--status <status>', 'Filter by status (active|disabled)')
    .option('--event-type <type>', 'Filter by event type')
    .option('--event-source <source>', 'Filter by event source')
    .option('--core-url <url>', 'Core API base URL (default: http://127.0.0.1:4000)')
    .option('--token <token>', 'Core API token (falls back to APPHUB_TOKEN)')
    .action(async (workflow: string, opts) => {
      try {
        await listTriggers(workflow, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
      }
    });

  triggers
    .command('create <workflow>')
    .description('Create a new event trigger from a JSON or YAML definition')
    .option('--file <path>', 'Path to trigger definition (JSON or YAML)', '')
    .option('--core-url <url>', 'Core API base URL (default: http://127.0.0.1:4000)')
    .option('--token <token>', 'Core API token (falls back to APPHUB_TOKEN)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (workflow: string, opts) => {
      try {
        await createTrigger(workflow, opts);
      } catch (err) {
        if (err instanceof CoreError && err.status === 400) {
          const printed = printValidationErrors(err.details);
          if (!printed) {
            console.error(err.message);
          }
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error(message);
        }
        process.exitCode = 1;
      }
    });

  triggers
    .command('update <workflow> <triggerId>')
    .description('Update an existing trigger via JSON/YAML patch or inline flags')
    .option('--file <path>', 'Partial trigger definition (JSON or YAML)')
    .option('--status <status>', 'Set trigger status (active|disabled)')
    .option('--core-url <url>', 'Core API base URL (default: http://127.0.0.1:4000)')
    .option('--token <token>', 'Core API token (falls back to APPHUB_TOKEN)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (workflow: string, triggerId: string, opts) => {
      try {
        await updateTrigger(workflow, triggerId, opts);
      } catch (err) {
        if (err instanceof CoreError && err.status === 400) {
          const printed = printValidationErrors(err.details);
          if (!printed) {
            console.error(err.message);
          }
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error(message);
        }
        process.exitCode = 1;
      }
    });

  triggers
    .command('disable <workflow> <triggerId>')
    .description('Disable a trigger (alias for update --status disabled)')
    .option('--core-url <url>', 'Core API base URL (default: http://127.0.0.1:4000)')
    .option('--token <token>', 'Core API token (falls back to APPHUB_TOKEN)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (workflow: string, triggerId: string, opts) => {
      try {
        await disableTrigger(workflow, triggerId, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
      }
    });
}
