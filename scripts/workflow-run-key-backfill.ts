import { parseArgs } from 'node:util';
import process from 'node:process';
import { Client } from 'pg';
import { normalizeRunKey } from '../services/core/src/workflows/runKey';

type WorkflowRunRow = {
  id: string;
  workflow_definition_id: string;
  status: string;
  partition_key: string | null;
  trigger: unknown;
  created_at: string;
};

type DerivationContext = {
  partitionKey: string | null;
  trigger: unknown;
  workflowDefinitionId: string;
  runId: string;
};

type Metrics = {
  processed: number;
  updated: number;
  skipped: number;
  conflicts: number;
  failures: number;
};

const args = parseArgs({
  options: {
    'dry-run': {
      type: 'boolean',
      default: false
    },
    'batch-size': {
      type: 'string'
    },
    'max-updates': {
      type: 'string'
    }
  }
});

const dryRun = Boolean(args.values['dry-run']);
const batchSize = clampPositive(parseInt(args.values['batch-size'] ?? '200', 10), 1, 1000);
const maxUpdatesRaw = args.values['max-updates'];
const maxUpdates = maxUpdatesRaw ? Math.max(parseInt(maxUpdatesRaw, 10), 0) : null;

const databaseUrl = process.env.DATABASE_URL ?? null;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
const metrics: Metrics = {
  processed: 0,
  updated: 0,
  skipped: 0,
  conflicts: 0,
  failures: 0
};

await client.connect();

try {
  let continuePaging = true;
  while (continuePaging) {
    const rows = await fetchNextBatch(client, batchSize);
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      metrics.processed += 1;

      const candidate = deriveRunKey(row);
      if (!candidate) {
        metrics.skipped += 1;
        continue;
      }

      const { runKey, normalized } = candidate;

      if (dryRun) {
        console.log(
          `DRY RUN: would update ${row.id} (workflow ${row.workflow_definition_id}) -> ${runKey}`
        );
        metrics.updated += 1;
        continue;
      }

      const success = await applyRunKey(client, row.id, runKey, normalized);
      if (success) {
        metrics.updated += 1;
      } else {
        metrics.failures += 1;
      }

      if (maxUpdates !== null && metrics.updated >= maxUpdates) {
        continuePaging = false;
        break;
      }
    }

    if (rows.length < batchSize) {
      break;
    }
  }
} finally {
  await client.end().catch(() => {});
}

outputMetrics(metrics);

function clampPositive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

async function fetchNextBatch(client: Client, limit: number): Promise<WorkflowRunRow[]> {
  const result = await client.query<WorkflowRunRow>(
    `SELECT id,
            workflow_definition_id,
            status,
            partition_key,
            trigger,
            created_at
       FROM workflow_runs
      WHERE run_key IS NULL
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit]
  );
  return result.rows;
}

function deriveRunKey(row: WorkflowRunRow): { runKey: string; normalized: string } | null {
  const context: DerivationContext = {
    partitionKey: row.partition_key,
    trigger: row.trigger,
    workflowDefinitionId: row.workflow_definition_id,
    runId: row.id
  };

  const candidates = buildCandidates(context);
  for (const candidate of candidates) {
    try {
      return normalizeRunKey(candidate);
    } catch (error) {
      continue;
    }
  }

  try {
    return normalizeRunKey(`run-${safeFragment(row.id).slice(0, 24)}`);
  } catch {
    return null;
  }
}

function buildCandidates(context: DerivationContext): string[] {
  const fragments: string[] = [];

  if (context.partitionKey) {
    fragments.push(`partition-${safeFragment(context.partitionKey)}`);
  }

  const trigger = extractTriggerMetadata(context.trigger);
  if (trigger?.dedupeKey) {
    fragments.push(`trigger-${safeFragment(trigger.dedupeKey)}`);
  }
  if (trigger?.deliveryId) {
    fragments.push(`delivery-${safeFragment(trigger.deliveryId)}`);
  }
  if (trigger?.eventId) {
    fragments.push(`event-${safeFragment(trigger.eventId)}`);
  }

  fragments.push(`run-${safeFragment(context.runId).slice(0, 24)}`);

  return fragments.filter(Boolean);
}

function extractTriggerMetadata(payload: unknown): {
  dedupeKey: string | null;
  deliveryId: string | null;
  eventId: string | null;
} | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const trigger = raw as { dedupeKey?: unknown; deliveryId?: unknown; event?: unknown };
  const event = trigger.event && typeof trigger.event === 'object' ? (trigger.event as Record<string, unknown>) : null;
  return {
    dedupeKey: typeof trigger.dedupeKey === 'string' ? trigger.dedupeKey : null,
    deliveryId: typeof trigger.deliveryId === 'string' ? trigger.deliveryId : null,
    eventId: event && typeof event.id === 'string' ? event.id : null
  };
}

function safeFragment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-');
}

async function applyRunKey(client: Client, runId: string, runKey: string, normalized: string): Promise<boolean> {
  try {
    const result = await client.query(
      `UPDATE workflow_runs
          SET run_key = $2,
              run_key_normalized = $3,
              updated_at = NOW()
        WHERE id = $1
          AND run_key IS NULL`,
      [runId, runKey, normalized]
    );
    if ((result.rowCount ?? 0) === 0) {
      metrics.skipped += 1;
      return false;
    }
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      metrics.conflicts += 1;
      console.warn(`conflict updating run ${runId}: ${(error as Error).message}`);
      return false;
    }
    console.error(`failed to update run ${runId}: ${(error as Error).message}`);
    return false;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

function outputMetrics(data: Metrics): void {
  console.log('# HELP workflow_run_key_backfill_processed_total Number of workflow runs inspected.');
  console.log('# TYPE workflow_run_key_backfill_processed_total counter');
  console.log(`workflow_run_key_backfill_processed_total ${data.processed}`);

  console.log('# HELP workflow_run_key_backfill_updated_total Number of workflow runs updated.');
  console.log('# TYPE workflow_run_key_backfill_updated_total counter');
  console.log(`workflow_run_key_backfill_updated_total ${data.updated}`);

  console.log('# HELP workflow_run_key_backfill_skipped_total Number of workflow runs skipped.');
  console.log('# TYPE workflow_run_key_backfill_skipped_total counter');
  console.log(`workflow_run_key_backfill_skipped_total ${data.skipped}`);

  console.log('# HELP workflow_run_key_backfill_conflicts_total Number of unique constraint conflicts.');
  console.log('# TYPE workflow_run_key_backfill_conflicts_total counter');
  console.log(`workflow_run_key_backfill_conflicts_total ${data.conflicts}`);

  console.log('# HELP workflow_run_key_backfill_failures_total Number of failed updates.');
  console.log('# TYPE workflow_run_key_backfill_failures_total counter');
  console.log(`workflow_run_key_backfill_failures_total ${data.failures}`);
}
