import process from 'node:process';
import { ensureDatabase } from '../db/init';
import { replayWorkflowEventSampling } from '../eventSamplingReplay';

function printUsage(): void {
  console.log('Usage: event-sampling-replay [options]\n');
  console.log('Options:');
  console.log('  --lookback-minutes <minutes>   Lookback window in minutes (default: 10080)');
  console.log('  --limit <count>                Maximum events to process per run (default: 100)');
  console.log('  --max-attempts <count>         Maximum retry attempts per event (default: 5)');
  console.log('  --include-processed            Include events already marked as succeeded (skipped)');
  console.log('  --dry-run                      Do not write changes or update state');
  console.log('  --help                         Show this help');
}

type ParsedArgs = {
  lookbackMs?: number;
  limit?: number;
  maxAttempts?: number;
  includeProcessed: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    includeProcessed: false,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--include-processed') {
      parsed.includeProcessed = true;
      continue;
    }

    if (arg === '--lookback-minutes') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--lookback-minutes requires a value');
      }
      i += 1;
      const parsedMinutes = Number(value);
      if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
        throw new Error('--lookback-minutes must be a positive number');
      }
      parsed.lookbackMs = Math.floor(parsedMinutes) * 60_000;
      continue;
    }

    if (arg.startsWith('--lookback-minutes=')) {
      const value = arg.slice('--lookback-minutes='.length);
      const parsedMinutes = Number(value);
      if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
        throw new Error('--lookback-minutes must be a positive number');
      }
      parsed.lookbackMs = Math.floor(parsedMinutes) * 60_000;
      continue;
    }

    if (arg === '--limit') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--limit requires a value');
      }
      i += 1;
      const parsedLimit = Number(value);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new Error('--limit must be a positive number');
      }
      parsed.limit = Math.floor(parsedLimit);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = arg.slice('--limit='.length);
      const parsedLimit = Number(value);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new Error('--limit must be a positive number');
      }
      parsed.limit = Math.floor(parsedLimit);
      continue;
    }

    if (arg === '--max-attempts') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--max-attempts requires a value');
      }
      i += 1;
      const parsedAttempts = Number(value);
      if (!Number.isFinite(parsedAttempts) || parsedAttempts <= 0) {
        throw new Error('--max-attempts must be a positive number');
      }
      parsed.maxAttempts = Math.floor(parsedAttempts);
      continue;
    }

    if (arg.startsWith('--max-attempts=')) {
      const value = arg.slice('--max-attempts='.length);
      const parsedAttempts = Number(value);
      if (!Number.isFinite(parsedAttempts) || parsedAttempts <= 0) {
        throw new Error('--max-attempts must be a positive number');
      }
      parsed.maxAttempts = Math.floor(parsedAttempts);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    await ensureDatabase();
    const summary = await replayWorkflowEventSampling({
      lookbackMs: parsed.lookbackMs,
      limit: parsed.limit,
      maxAttempts: parsed.maxAttempts,
      includeProcessed: parsed.includeProcessed,
      dryRun: parsed.dryRun
    });

    console.log('Event sampling replay complete:');
    console.log(`  processed: ${summary.processed}`);
    console.log(`  succeeded: ${summary.succeeded}`);
    console.log(`  failed: ${summary.failed}`);
    console.log(`  skipped: ${summary.skipped}`);
    console.log(`  pending: ${summary.pending}`);
    console.log(`  dryRun: ${summary.dryRun}`);
    if (summary.errors.length > 0) {
      console.log('  errors:');
      for (const entry of summary.errors) {
        console.log(`    - ${entry.eventId}: ${entry.reason}`);
      }
    }
  } catch (err) {
    console.error('[event-sampling-replay] failed to execute replay');
    if (err instanceof Error) {
      console.error(`Reason: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

void main();
