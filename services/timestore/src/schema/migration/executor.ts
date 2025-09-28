import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import {
  createDatasetManifest,
  createDatasetSchemaVersion,
  getDatasetBySlug,
  getManifestById,
  getNextManifestVersion,
  getNextSchemaVersion,
  getPartitionsWithTargetsForManifest,
  getSchemaVersionById,
  listPublishedManifestsWithPartitions,
  recordLifecycleAuditEvent,
  type DatasetManifestWithPartitions,
  type DatasetRecord,
  type DatasetSchemaVersionRecord,
  type LifecycleAuditLogInput,
  type PartitionInput,
  type PartitionWithTarget
} from '../../db/metadata';
import { refreshManifestCache } from '../../cache/manifestCache';
import { loadServiceConfig, type ServiceConfig } from '../../config/serviceConfig';
import {
  createStorageDriver,
  resolvePartitionLocation,
  type FieldDefinition,
  type FieldType
} from '../../storage';
import { computePartitionIndexForConnection } from '../../indexing/partitionIndex';
import { extractFieldDefinitions } from '../compatibility';
import { invalidateSqlRuntimeCache } from '../../sql/runtime';
import { observeSchemaMigration } from '../../observability/metrics';
import type {
  DropArchiveConfig,
  DropOperation,
  GovernanceMetadata,
  MigrationOperation,
  RenameOperation,
  SchemaMigrationManifest,
  TransformOperation
} from './manifest';

export interface SchemaMigrationResult {
  dryRun: boolean;
  dataset: DatasetRecord;
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

interface ColumnProjection {
  target: FieldDefinition;
  expression: string;
  origin: 'inherit' | 'rename' | 'transform';
  sourceColumns: string[];
  description?: string;
}

interface DropPlanEntry {
  column: string;
  archive?: DropArchiveConfig | null;
  description?: string;
}

interface PartitionMigrationContext {
  dataset: DatasetRecord;
  manifest: DatasetManifestWithPartitions;
  targetSchemaVersionId: string;
  projections: ColumnProjection[];
  drops: DropPlanEntry[];
  governance: GovernanceMetadata;
  archiveDirectory: string | null;
  dryRun: boolean;
  continueOnFailure: boolean;
}

interface PartitionMigrationResult {
  partitionId: string;
  migrated: boolean;
  rowCount: number;
  bytesWritten: number;
  archiveArtifacts: ArchiveArtifact[];
}

interface ArchiveArtifact {
  column: string;
  filePath: string;
  rowCount: number;
}

export async function executeSchemaMigration(
  manifest: SchemaMigrationManifest,
  overrides: SchemaMigrationOverrides = {}
): Promise<SchemaMigrationResult> {
  const startedAt = new Date();
  const dryRun = overrides.dryRun ?? manifest.execution.dryRun;
  const archiveDirectory = overrides.archiveDirectory ?? manifest.execution.archiveDirectory ?? null;
  const config = loadServiceConfig();
  const dataset = await getDatasetBySlug(manifest.dataset);
  if (!dataset) {
    throw new Error(`Dataset '${manifest.dataset}' not found`);
  }

  const manifests = await listPublishedManifestsWithPartitions(dataset.id);
  if (manifests.length === 0) {
    throw new Error(`Dataset '${dataset.slug}' has no published manifests to migrate`);
  }

  const partitionTotal = manifests.reduce((sum, entry) => sum + entry.partitions.length, 0);
  if (manifest.validation.maxPartitions && partitionTotal > manifest.validation.maxPartitions) {
    throw new Error(
      `Manifest references ${partitionTotal} partition(s) which exceeds configured maximum ${manifest.validation.maxPartitions}`
    );
  }

  const baselineSchema = await resolveBaselineSchema(manifest, manifests);
  const projections = buildColumnProjections(baselineSchema.fields, manifest.targetSchema.fields, manifest.operations);
  const drops = buildDropPlan(baselineSchema.fields, manifest.operations);

  const governance = manifest.governance;

  if (!dryRun) {
    await recordLifecycleEvent({
      datasetId: dataset.id,
      manifestId: null,
      eventType: 'schema.migration.started',
      payload: {
        ticketId: governance.ticketId,
        approvedBy: governance.approvedBy,
        changeReason: governance.changeReason ?? null,
        manifestCount: manifests.length,
        partitionCount: partitionTotal
      }
    });
  }

  let targetSchemaVersion: DatasetSchemaVersionRecord | null = null;
  if (!dryRun) {
    const nextVersion = await getNextSchemaVersion(dataset.id);
    targetSchemaVersion = await createDatasetSchemaVersion({
      id: `dsv-${randomUUID()}`,
      datasetId: dataset.id,
      version: nextVersion,
      description: governance.changeReason ?? `Schema migration ${governance.ticketId}`,
      schema: { fields: manifest.targetSchema.fields },
      checksum: computeSchemaChecksum(manifest.targetSchema.fields)
    });
  }

  const targetSchemaVersionId = targetSchemaVersion?.id ?? null;
  const archiveRoot = archiveDirectory ? path.resolve(archiveDirectory) : null;
  if (!dryRun && archiveRoot) {
    await mkdir(archiveRoot, { recursive: true });
  }

  let manifestsProcessed = 0;
  let partitionsEvaluated = 0;
  let partitionsMigrated = 0;
  let archivedColumns = 0;

  try {
    for (const sourceManifest of manifests) {
      manifestsProcessed += 1;
      const partitionResults: PartitionMigrationResult[] = [];
      const partitionsWithTargets = await getPartitionsWithTargetsForManifest(sourceManifest.id);
      if (partitionsWithTargets.length !== sourceManifest.partitions.length) {
        console.warn('[schema-migration] partition target lookup mismatch', {
          manifestId: sourceManifest.id,
          expected: sourceManifest.partitions.length,
          actual: partitionsWithTargets.length
        });
      }

      for (const partition of partitionsWithTargets) {
        partitionsEvaluated += 1;
        try {
          const result = await migratePartition({
            dataset,
            manifest: sourceManifest,
            targetSchemaVersionId: targetSchemaVersionId ?? 'dry-run',
            projections,
            drops,
            governance,
            archiveDirectory: archiveRoot,
            dryRun,
            continueOnFailure: manifest.execution.continueOnPartitionFailure
          }, partition, config);
          partitionResults.push(result);
          if (result.migrated) {
            partitionsMigrated += 1;
            archivedColumns += result.archiveArtifacts.length;
          }
        } catch (error) {
          if (!manifest.execution.continueOnPartitionFailure || dryRun) {
            throw error;
          }
          console.error(
            '[schema-migration] partition migration failed but continueOnFailure enabled',
            {
              datasetId: dataset.id,
              manifestId: sourceManifest.id,
              partitionId: partition.id,
              error: error instanceof Error ? error.message : String(error)
            }
          );
        }
      }

      if (!dryRun) {
        const migratedPartitions = partitionResults.filter((entry) => entry.migrated) as Array<PartitionMigrationResult & { partitionInput: PartitionInput }>;
        const partitionInputs = migratedPartitions.map((entry) => entry.partitionInput);
        if (partitionInputs.length !== partitionsWithTargets.length) {
          throw new Error(
            `Schema migration produced ${partitionInputs.length} partitions but expected ${partitionsWithTargets.length} for manifest ${sourceManifest.id}`
          );
        }

        const newManifest = await createMigratedManifest({
          dataset,
          sourceManifest,
          targetSchemaVersionId: targetSchemaVersionId!,
          partitionInputs,
          governance,
          projections,
          drops
        });

        await refreshManifestCacheSafe(dataset, newManifest.id);
        await recordLifecycleEvent({
          datasetId: dataset.id,
          manifestId: newManifest.id,
          eventType: 'schema.migration.manifest.completed',
          payload: {
            ticketId: governance.ticketId,
            sourceManifestId: sourceManifest.id,
            manifestId: newManifest.id,
            partitionCount: partitionInputs.length
          }
        });
      }
    }

    const completedAt = new Date();
    const result: SchemaMigrationResult = {
      dryRun,
      dataset,
      targetSchemaVersionId,
      manifestsProcessed,
      partitionsEvaluated,
      partitionsMigrated,
      archivedColumns,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      archiveDirectory: archiveRoot
    };

    if (!dryRun) {
      invalidateSqlRuntimeCache();
      await recordLifecycleEvent({
        datasetId: dataset.id,
        manifestId: null,
        eventType: 'schema.migration.completed',
        payload: {
          ticketId: governance.ticketId,
          approvedBy: governance.approvedBy,
          manifestsProcessed,
          partitionsMigrated
        }
      });
      observeSchemaMigration({
        datasetSlug: dataset.slug,
        result: 'completed',
        partitions: partitionsMigrated,
        durationSeconds: durationSinceSeconds(startedAt)
      });
    }

    return result;
  } catch (error) {
    if (!dryRun) {
      await recordLifecycleEvent({
        datasetId: dataset.id,
        manifestId: null,
        eventType: 'schema.migration.failed',
        payload: {
          ticketId: governance.ticketId,
          approvedBy: governance.approvedBy,
          manifestsProcessed,
          partitionsMigrated,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      observeSchemaMigration({
        datasetSlug: dataset.slug,
        result: 'failed',
        partitions: partitionsMigrated,
        durationSeconds: durationSinceSeconds(startedAt)
      });
    }
    throw error;
  }
}

async function resolveBaselineSchema(
  manifest: SchemaMigrationManifest,
  manifests: DatasetManifestWithPartitions[]
): Promise<{ fields: FieldDefinition[]; schemaVersion: DatasetSchemaVersionRecord | null }> {
  const schemaVersionIds = new Set<string>();
  const schemaVersions = new Map<string, DatasetSchemaVersionRecord>();

  for (const entry of manifests) {
    if (!entry.schemaVersionId) {
      if (!manifest.validation.allowManifestsWithoutSchemaVersion) {
        throw new Error(
          `Manifest ${entry.id} is missing schemaVersionId and allowManifestsWithoutSchemaVersion is false`
        );
      }
      continue;
    }
    schemaVersionIds.add(entry.schemaVersionId);
    if (!schemaVersions.has(entry.schemaVersionId)) {
      const record = await getSchemaVersionById(entry.schemaVersionId);
      if (!record) {
        throw new Error(`Schema version ${entry.schemaVersionId} referenced by manifest ${entry.id} not found`);
      }
      schemaVersions.set(entry.schemaVersionId, record);
    }
  }

  if (schemaVersionIds.size === 0) {
    throw new Error('Unable to determine baseline schema; no manifests provided a schema version');
  }

  if (manifest.validation.requireConsistentSchema && schemaVersionIds.size > 1) {
    throw new Error(
      `Dataset has ${schemaVersionIds.size} schema versions across published manifests; set requireConsistentSchema=false to override`
    );
  }

  let chosenVersion: DatasetSchemaVersionRecord | null = null;
  if (manifest.baseline?.schemaVersionId) {
    chosenVersion = schemaVersions.get(manifest.baseline.schemaVersionId) ?? null;
    if (!chosenVersion) {
      throw new Error(`Baseline schemaVersionId ${manifest.baseline.schemaVersionId} not found in dataset manifests`);
    }
  } else {
    chosenVersion = schemaVersions.values().next().value ?? null;
  }

  if (!chosenVersion) {
    throw new Error('Unable to resolve baseline schema version for migration');
  }

  if (manifest.baseline?.schemaChecksum && chosenVersion.checksum !== manifest.baseline.schemaChecksum) {
    throw new Error(
      `Baseline checksum mismatch: manifest expected ${manifest.baseline.schemaChecksum} but dataset version has ${chosenVersion.checksum ?? 'unknown'}`
    );
  }

  const fields = extractFieldDefinitions(chosenVersion.schema);
  if (fields.length === 0) {
    throw new Error('Baseline schema version does not contain field definitions');
  }

  return { fields, schemaVersion: chosenVersion };
}

function buildColumnProjections(
  baselineFields: FieldDefinition[],
  targetFields: FieldDefinition[],
  operations: MigrationOperation[]
): ColumnProjection[] {
  const baselineMap = new Map(baselineFields.map((field) => [field.name, field]));
  const projectionMap = new Map<string, ColumnProjection>();
  const consumedSources = new Set<string>();

  for (const operation of operations) {
    if (operation.kind === 'drop') {
      continue;
    }
    if (operation.kind === 'rename') {
      const rename = operation as RenameOperation;
      const source = baselineMap.get(rename.from);
      if (!source) {
        throw new Error(`Rename operation references unknown column '${rename.from}'`);
      }
      if (!targetFields.find((field) => field.name === rename.to)) {
        throw new Error(`Rename target column '${rename.to}' missing from target schema`);
      }
      if (projectionMap.has(rename.to)) {
        throw new Error(`Multiple operations defined for target column '${rename.to}'`);
      }
      projectionMap.set(rename.to, {
        target: resolveTargetField(rename.to, targetFields),
        expression: rename.transform ? wrapExpression(rename.transform) : quoteIdentifier(rename.from),
        origin: rename.transform ? 'transform' : 'rename',
        sourceColumns: [rename.from],
        description: rename.description
      });
      consumedSources.add(rename.from);
      continue;
    }
    if (operation.kind === 'transform') {
      const transform = operation as TransformOperation;
      if (!targetFields.find((field) => field.name === transform.column)) {
        throw new Error(`Transform target column '${transform.column}' missing from target schema`);
      }
      if (projectionMap.has(transform.column)) {
        throw new Error(`Multiple operations defined for target column '${transform.column}'`);
      }
      projectionMap.set(transform.column, {
        target: resolveTargetField(transform.column, targetFields),
        expression: wrapExpression(transform.expression),
        origin: 'transform',
        sourceColumns: [],
        description: transform.description
      });
    }
  }

  for (const target of targetFields) {
    if (projectionMap.has(target.name)) {
      continue;
    }
    const baseline = baselineMap.get(target.name);
    if (!baseline) {
      throw new Error(`Target column '${target.name}' requires a rename or transform operation`);
    }
    projectionMap.set(target.name, {
      target,
      expression: quoteIdentifier(target.name),
      origin: 'inherit',
      sourceColumns: [target.name]
    });
    consumedSources.add(target.name);
  }

  return targetFields.map((field) => {
    const projection = projectionMap.get(field.name);
    if (!projection) {
      throw new Error(`Missing projection for target column '${field.name}'`);
    }
    return projection;
  });
}

function buildDropPlan(
  baselineFields: FieldDefinition[],
  operations: MigrationOperation[]
): DropPlanEntry[] {
  const dropEntries: DropPlanEntry[] = [];
  const baselineNames = new Set(baselineFields.map((field) => field.name));
  for (const operation of operations) {
    if (operation.kind !== 'drop') {
      continue;
    }
    const drop = operation as DropOperation;
    if (!baselineNames.has(drop.column)) {
      throw new Error(`Drop operation references unknown column '${drop.column}'`);
    }
    dropEntries.push({
      column: drop.column,
      archive: drop.archive ?? undefined,
      description: drop.description
    });
  }
  return dropEntries;
}

async function migratePartition(
  context: PartitionMigrationContext,
  partition: PartitionWithTarget,
  config: ServiceConfig
): Promise<PartitionMigrationResult> {
  if (context.dryRun) {
    await validatePartitionTransform(context, partition, config);
    return {
      partitionId: partition.id,
      migrated: false,
      rowCount: partition.rowCount ?? 0,
      bytesWritten: 0,
      archiveArtifacts: []
    } satisfies PartitionMigrationResult;
  }

  const artifact = await materializePartition(context, partition, config);
  return {
    partitionId: partition.id,
    migrated: true,
    rowCount: artifact.partitionInput.rowCount ?? 0,
    bytesWritten: artifact.partitionInput.fileSizeBytes ?? 0,
    archiveArtifacts: artifact.archiveArtifacts,
    partitionInput: artifact.partitionInput
  } as PartitionMigrationResult & { partitionInput: PartitionInput };
}

async function validatePartitionTransform(
  context: PartitionMigrationContext,
  partition: PartitionWithTarget,
  config: ServiceConfig
): Promise<void> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();
  const alias = 'src';
  const tableName = extractTableName(partition);
  const escapedLocation = resolvePartitionLocation(partition, partition.storageTarget, config).replace(/'/g, "''");
  try {
    await run(connection, `ATTACH '${escapedLocation}' AS ${alias}`);
    await run(connection, `CREATE TEMP VIEW source_data AS SELECT * FROM ${alias}.${quoteIdentifier(tableName)}`);
    const selectList = buildSelectList(context.projections);
    await all(connection, `SELECT ${selectList} FROM source_data LIMIT 5`);
    await all(connection, 'SELECT COUNT(*) FROM source_data');
  } finally {
    await run(connection, 'DROP VIEW IF EXISTS source_data').catch(() => undefined);
    await run(connection, `DETACH ${alias}`).catch(() => undefined);
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
  }
}

async function materializePartition(
  context: PartitionMigrationContext,
  partition: PartitionWithTarget,
  config: ServiceConfig
): Promise<{ partitionInput: PartitionInput; archiveArtifacts: ArchiveArtifact[] }> {
  const duckdb = loadDuckDb();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'timestore-schema-migration-'));
  const tempFile = path.join(tempDir, `${partition.id}-migrated.duckdb`);
  const db = new duckdb.Database(tempFile);
  const connection = db.connect();
  const alias = 'src';
  const tableName = extractTableName(partition);
  const escapedLocation = resolvePartitionLocation(partition, partition.storageTarget, config).replace(/'/g, "''");
  const archiveArtifacts: ArchiveArtifact[] = [];

  try {
    const safeTableName = quoteIdentifier(tableName);
    const columnDefinitions = context.projections
      .map((projection) => `${quoteIdentifier(projection.target.name)} ${mapDuckType(projection.target.type)}`)
      .join(', ');
    await run(connection, `CREATE TABLE ${safeTableName} (${columnDefinitions})`);
    await run(connection, `ATTACH '${escapedLocation}' AS ${alias}`);
    await run(connection, `CREATE VIEW source_data AS SELECT * FROM ${alias}.${quoteIdentifier(tableName)}`);

    const selectList = buildSelectList(context.projections);
    await run(connection, `INSERT INTO ${safeTableName} SELECT ${selectList} FROM source_data`);

    const [{ count }] = await all(
      connection,
      `SELECT COUNT(*)::BIGINT AS count FROM ${safeTableName}`
    );
    const rowCount = Number(count ?? 0);
    const startTime = new Date(partition.startTime);
    const endTime = new Date(partition.endTime);

    const indexResult = await computePartitionIndexForConnection(
      connection,
      tableName,
      context.projections.map((projection) => projection.target),
      config.partitionIndex
    );

    const shouldArchive = context.drops.some(
      (drop) => drop.archive && (drop.archive.directoryOverride || context.archiveDirectory)
    );
    if (shouldArchive) {
      for (const drop of context.drops) {
        if (!drop.archive || !drop.archive.enabled) {
          continue;
        }
        const archiveDir = drop.archive.directoryOverride
          ? path.resolve(drop.archive.directoryOverride)
          : context.archiveDirectory;
        if (!archiveDir) {
          console.warn(
            '[schema-migration] archive requested for column but no archiveDirectory provided',
            { column: drop.column }
          );
          continue;
        }
        await mkdir(archiveDir, { recursive: true });
        const archivePath = path.join(
          archiveDir,
          `${context.dataset.slug}-${partition.id}-${drop.column}.jsonl`
        );
        const rows = await all(
          connection,
          `SELECT ${quoteIdentifier(drop.column)} AS value FROM source_data`
        );
        let json = '';
        let index = 0;
        for (const row of rows) {
          json +=
            JSON.stringify({
              datasetId: context.dataset.id,
              manifestId: context.manifest.id,
              partitionId: partition.id,
              column: drop.column,
              rowIndex: index,
              value: row.value ?? null
            }) + '\n';
          index += 1;
        }
        await writeFile(archivePath, json, 'utf8');
        archiveArtifacts.push({
          column: drop.column,
          filePath: archivePath,
          rowCount: rows.length
        });
      }
    }

    await run(connection, 'DROP VIEW IF EXISTS source_data');
    await run(connection, `DETACH ${alias}`);
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }

    const driver = createStorageDriver(config, partition.storageTarget);
    const normalizedKey = normalizePartitionKey(partition.partitionKey);
    const newPartitionId = `part-${randomUUID()}`;
    const writeResult = await driver.writePartition({
      datasetSlug: context.dataset.slug,
      partitionId: newPartitionId,
      partitionKey: normalizedKey,
      tableName,
      schema: context.projections.map((projection) => projection.target),
      sourceFilePath: tempFile,
      rowCountHint: rowCount
    });

    const partitionInput: PartitionInput = {
      id: newPartitionId,
      storageTargetId: partition.storageTarget.id,
      fileFormat: partition.fileFormat,
      filePath: writeResult.relativePath,
      partitionKey: normalizedKey,
      startTime,
      endTime,
      fileSizeBytes: writeResult.fileSizeBytes,
      rowCount: writeResult.rowCount,
      checksum: writeResult.checksum,
      metadata: {
        tableName,
        schemaVersionId: context.targetSchemaVersionId,
        schemaMigration: {
          ticketId: context.governance.ticketId,
          approvedBy: context.governance.approvedBy,
          changeReason: context.governance.changeReason ?? null,
          operations: summarizeOperations(context.projections, context.drops)
        }
      },
      columnStatistics: indexResult.columnStatistics,
      columnBloomFilters: indexResult.columnBloomFilters
    };

    return {
      partitionInput,
      archiveArtifacts
    };
  } finally {
    await closeConnection(connection).catch(() => undefined);
    if (isCloseable(db)) {
      try {
        db.close();
      } catch (err) {
        console.warn('[schema-migration] failed to close duckdb', err);
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createMigratedManifest(params: {
  dataset: DatasetRecord;
  sourceManifest: DatasetManifestWithPartitions;
  targetSchemaVersionId: string;
  partitionInputs: PartitionInput[];
  governance: GovernanceMetadata;
  projections: ColumnProjection[];
  drops: DropPlanEntry[];
}): Promise<DatasetManifestWithPartitions> {
  const { dataset, sourceManifest, targetSchemaVersionId, partitionInputs, governance, projections, drops } = params;
  const nextVersion = await getNextManifestVersion(dataset.id);
  const totalRows = partitionInputs.reduce((sum, partition) => sum + (partition.rowCount ?? 0), 0);
  const totalBytes = partitionInputs.reduce((sum, partition) => sum + (partition.fileSizeBytes ?? 0), 0);
  const startTime = partitionInputs.reduce<Date | null>((min, partition) => {
    const current = partition.startTime;
    if (!current) {
      return min;
    }
    return !min || current < min ? current : min;
  }, null);
  const endTime = partitionInputs.reduce<Date | null>((max, partition) => {
    const current = partition.endTime;
    if (!current) {
      return max;
    }
    return !max || current > max ? current : max;
  }, null);

  const summary = {
    ...sourceManifest.summary,
    schemaMigration: {
      ticketId: governance.ticketId,
      approvedBy: governance.approvedBy,
      changeReason: governance.changeReason ?? null,
      operations: summarizeOperations(projections, drops),
      migratedAt: new Date().toISOString(),
      sourceManifestId: sourceManifest.id
    }
  } as Record<string, unknown>;

  const metadata = {
    ...sourceManifest.metadata,
    schemaMigration: {
      ticketId: governance.ticketId,
      approvedBy: governance.approvedBy,
      notes: governance.notes ?? null,
      parentManifestId: sourceManifest.id
    }
  } as Record<string, unknown>;

  const statistics = {
    rowCount: totalRows,
    fileSizeBytes: totalBytes,
    startTime: startTime?.toISOString() ?? null,
    endTime: endTime?.toISOString() ?? null
  } as Record<string, unknown>;

  return createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: dataset.id,
    version: nextVersion,
    status: 'published',
    schemaVersionId: targetSchemaVersionId,
    parentManifestId: sourceManifest.id,
    manifestShard: sourceManifest.manifestShard,
    summary,
    statistics,
    metadata,
    createdBy: 'timestore-schema-migrator',
    partitions: partitionInputs
  });
}

function summarizeOperations(projections: ColumnProjection[], drops: DropPlanEntry[]): Record<string, unknown> {
  return {
    projections: projections.map((projection) => ({
      column: projection.target.name,
      origin: projection.origin,
      description: projection.description ?? null
    })),
    drops: drops.map((drop) => ({
      column: drop.column,
      archived: Boolean(drop.archive && drop.archive.enabled),
      description: drop.description ?? null
    }))
  } satisfies Record<string, unknown>;
}

async function refreshManifestCacheSafe(dataset: DatasetRecord, manifestId: string): Promise<void> {
  try {
    const manifest = await getManifestById(manifestId);
    if (!manifest) {
      return;
    }
    const partitions = await getPartitionsWithTargetsForManifest(manifestId);
    const { partitions: _ignored, ...manifestRecord } = manifest;
    await refreshManifestCache({ id: dataset.id, slug: dataset.slug }, manifestRecord, partitions);
  } catch (err) {
    console.warn('[schema-migration] failed to refresh manifest cache', err);
  }
}

async function recordLifecycleEvent(event: LifecycleAuditLogInput): Promise<void> {
  try {
    await recordLifecycleAuditEvent({
      id: event.id ?? `la-${randomUUID()}`,
      datasetId: event.datasetId,
      manifestId: event.manifestId,
      eventType: event.eventType,
      payload: event.payload
    });
  } catch (err) {
    console.warn('[schema-migration] failed to record lifecycle audit event', err);
  }
}

function buildSelectList(projections: ColumnProjection[]): string {
  return projections
    .map((projection) => `${projection.expression} AS ${quoteIdentifier(projection.target.name)}`)
    .join(', ');
}

function resolveTargetField(name: string, targetFields: FieldDefinition[]): FieldDefinition {
  const field = targetFields.find((entry) => entry.name === name);
  if (!field) {
    throw new Error(`Target field '${name}' not found`);
  }
  return field;
}

function mapDuckType(type: FieldType): string {
  switch (type) {
    case 'timestamp':
      return 'TIMESTAMP';
    case 'string':
      return 'VARCHAR';
    case 'double':
      return 'DOUBLE';
    case 'integer':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    default:
      return 'VARCHAR';
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function wrapExpression(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return trimmed;
  }
  return `(${trimmed})`;
}

function extractTableName(partition: PartitionWithTarget): string {
  const metadata = partition.metadata as Record<string, unknown> | undefined;
  const tableName = typeof metadata?.tableName === 'string' && metadata.tableName.trim().length > 0
    ? metadata.tableName
    : 'records';
  return tableName;
}

function normalizePartitionKey(input: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    result[key] = typeof value === 'string' ? value : String(value);
  }
  return result;
}

function computeSchemaChecksum(fields: FieldDefinition[]): string {
  const canonical = JSON.stringify(fields.map((field) => ({ name: field.name, type: field.type })));
  return createHash('sha1').update(canonical).digest('hex');
}

function durationSinceSeconds(start: Date): number {
  const diff = Date.now() - start.getTime();
  return diff / 1000;
}

async function run(connection: any, sql: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.run(sql, (error: unknown) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function all(connection: any, sql: string): Promise<any[]> {
  return new Promise<any[]>((resolve, reject) => {
    connection.all(sql, (error: unknown, rows: any[]) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows ?? []);
      }
    });
  });
}

async function closeConnection(connection: any): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.close((error: unknown) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
