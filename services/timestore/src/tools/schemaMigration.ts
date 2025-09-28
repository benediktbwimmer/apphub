import { exit } from 'node:process';
import path from 'node:path';
import { loadSchemaMigrationManifest, type SchemaMigrationManifest } from '../schema/migration/manifest';
import { executeSchemaMigration } from '../schema/migration/executor';
import { closePool } from '../db/client';
import { shutdownManifestCache } from '../cache/manifestCache';

interface CliArgs {
  manifestPath: string | null;
  dryRunOverride: boolean | null;
  archiveDirectory: string | null;
  showHelp: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    printUsage();
    return;
  }

  if (!args.manifestPath) {
    printUsage('Missing required --manifest <file> argument');
    exit(1);
  }

  const resolvedPath = path.resolve(args.manifestPath);
  console.log(`[schema-migration] loading manifest from ${resolvedPath}`);

  let manifest: SchemaMigrationManifest;
  try {
    manifest = await loadSchemaMigrationManifest(resolvedPath);
  } catch (error) {
    console.error('[schema-migration] failed to load manifest', error);
    exit(1);
    return;
  }

  if (args.dryRunOverride !== null) {
    manifest = {
      ...manifest,
      execution: {
        ...manifest.execution,
        dryRun: args.dryRunOverride
      }
    } satisfies SchemaMigrationManifest;
  }

  if (args.archiveDirectory) {
    manifest = {
      ...manifest,
      execution: {
        ...manifest.execution,
        archiveDirectory: args.archiveDirectory
      }
    } satisfies SchemaMigrationManifest;
  }

  console.log(
    `[schema-migration] executing migration for dataset '${manifest.dataset}' (dryRun=${manifest.execution.dryRun})`
  );

  try {
    const result = await executeSchemaMigration(manifest, {
      dryRun: args.dryRunOverride ?? undefined,
      archiveDirectory: args.archiveDirectory ?? undefined
    });

    logSummary(result);
  } catch (error) {
    console.error('[schema-migration] migration failed', error);
    exit(1);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    manifestPath: null,
    dryRunOverride: null,
    archiveDirectory: null,
    showHelp: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--manifest':
      case '-m':
        args.manifestPath = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--dry-run':
        args.dryRunOverride = true;
        break;
      case '--execute':
        args.dryRunOverride = false;
        break;
      case '--archive-dir':
        args.archiveDirectory = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--help':
      case '-h':
        args.showHelp = true;
        break;
      default:
        console.warn(`[schema-migration] unknown argument '${token}'`);
        break;
    }
  }

  return args;
}

function logSummary(result: Awaited<ReturnType<typeof executeSchemaMigration>>): void {
  console.log('[schema-migration] migration summary');
  console.log(`  dataset: ${result.dataset.slug}`);
  console.log(`  dryRun: ${result.dryRun}`);
  console.log(`  manifestsProcessed: ${result.manifestsProcessed}`);
  console.log(`  partitionsEvaluated: ${result.partitionsEvaluated}`);
  console.log(`  partitionsMigrated: ${result.partitionsMigrated}`);
  if (result.targetSchemaVersionId) {
    console.log(`  targetSchemaVersionId: ${result.targetSchemaVersionId}`);
  }
  if (result.archiveDirectory) {
    console.log(`  archiveDirectory: ${result.archiveDirectory}`);
  }
  console.log(`  startedAt: ${result.startedAt}`);
  console.log(`  completedAt: ${result.completedAt}`);
}

function printUsage(message?: string): void {
  if (message) {
    console.error(`[schema-migration] ${message}`);
  }
  console.log('Usage: npm run schema-migrate -- --manifest <path> [--dry-run|--execute] [--archive-dir <path>]');
  console.log('Options:');
  console.log('  --manifest, -m       Path to schema migration manifest (YAML or JSON)');
  console.log('  --dry-run            Force dry-run execution regardless of manifest setting');
  console.log('  --execute            Force execution (overrides manifest dryRun flag)');
  console.log('  --archive-dir        Override archive directory for drop operations');
  console.log('  --help, -h           Show this help message');
}

main()
  .catch((error) => {
    console.error('[schema-migration] unexpected failure', error);
    exit(1);
  })
  .finally(async () => {
    await shutdownManifestCache().catch((error) => {
      console.warn('[schema-migration] failed to shutdown manifest cache', error);
    });
    await closePool().catch((error) => {
      console.warn('[schema-migration] failed to close database pool', error);
    });
  });
