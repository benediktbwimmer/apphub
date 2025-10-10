import type { SchemaMigrationManifest } from './manifest';

export interface SchemaMigrationResult {
  dryRun: boolean;
  datasetSlug?: string;
  targetSchemaVersionId: string | null;
  manifestsProcessed: number;
  partitionsEvaluated: number;
  partitionsMigrated: number;
  archivedColumns: number;
  startedAt: string;
  completedAt: string;
  archiveDirectory?: string | null;
}

export interface SchemaMigrationOverrides {
  dryRun?: boolean;
  archiveDirectory?: string;
}

export async function executeSchemaMigration(
  _manifest: SchemaMigrationManifest,
  _overrides: SchemaMigrationOverrides = {}
): Promise<SchemaMigrationResult> {
  throw new Error('Schema migrations are not supported in the ClickHouse migration prototype.');
}
