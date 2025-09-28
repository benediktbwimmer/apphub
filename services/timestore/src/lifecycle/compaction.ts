import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import type {
  CompactionCheckpointRecord,
  DatasetManifestWithPartitions,
  DatasetPartitionRecord,
  DatasetSchemaVersionRecord,
  LifecycleAuditLogInput,
  PartitionInput,
  PartitionWithTarget
} from '../db/metadata';
import {
  getCompactionCheckpointByManifest,
  getSchemaVersionById,
  replacePartitionsInManifest,
  upsertCompactionCheckpoint,
  updateCompactionCheckpoint
} from '../db/metadata';
import {
  createStorageDriver,
  resolvePartitionLocation,
  type FieldDefinition,
  type FieldType
} from '../storage';
import type { ServiceConfig } from '../config/serviceConfig';
import type { LifecycleJobContext, LifecycleOperationExecutionResult } from './types';
import { invalidateSqlRuntimeCache } from '../sql/runtime';
import { recordCompactionChunk } from './metrics';

const CHECKPOINT_METADATA_VERSION = 1;
const CHECKPOINT_STATS_VERSION = 1;
const MAX_CHUNK_HISTORY = 50;

interface CompactionGroup {
  id: string;
  partitions: PartitionWithTarget[];
  totalBytes: number;
  totalRows: number;
  tableName: string;
  storageTargetId: string;
}

interface CompactionPlanGroupSummary {
  id: string;
  partitionIds: string[];
  storageTargetId: string;
  tableName: string;
  replacementPartitionId: string;
  totalBytes: number;
  totalRows: number;
}

interface CheckpointMetadataV1 {
  version: typeof CHECKPOINT_METADATA_VERSION;
  manifestId: string;
  manifestShard: string;
  schemaVersionId: string | null;
  chunkPartitionLimit: number;
  groups: CompactionPlanGroupSummary[];
  completedGroupIds: string[];
  chunkAttempts: Record<string, number>;
}

interface ChunkHistoryEntry {
  chunkId: string;
  bytes: number;
  partitions: number;
  attempts: number;
  durationMs: number;
  completedAt: string;
}

interface CheckpointStatsV1 {
  version: typeof CHECKPOINT_STATS_VERSION;
  bytesProcessed: number;
  partitionsCompacted: number;
  rowsCompacted: number;
  chunksCompleted: number;
  chunkHistory: ChunkHistoryEntry[];
  resumedAt?: string;
  lastError?: string | null;
}

interface MaterializedPlanGroup {
  summary: CompactionPlanGroupSummary;
  partitions: PartitionWithTarget[];
}

interface MaterializedChunkGroups {
  ready: MaterializedPlanGroup[];
  skipped: CompactionPlanGroupSummary[];
}

interface CompactedPartitionArtifact {
  groupId: string;
  tempDir: string;
  tempFile: string;
  rowCount: number;
  fileSizeBytes: number;
  checksum: string;
  startTime: Date;
  endTime: Date;
}

interface CompactionChunkResult {
  manifest: DatasetManifestWithPartitions;
  bytesWritten: number;
  rowsWritten: number;
  sourcePartitions: PartitionWithTarget[];
  replacementPartitionIds: string[];
  auditEvents: LifecycleAuditLogInput[];
}

interface CompactionChunkSummary {
  chunkId: string;
  groupIds: string[];
  partitionIds: string[];
  attempts: Record<string, number>;
  bytes: number;
  partitions: number;
  durationMs: number;
  completedAt: string;
}

export async function performCompaction(
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[]
): Promise<LifecycleOperationExecutionResult> {
  const { config, manifest } = context;
  const compactionConfig = config.lifecycle.compaction;

  if (!manifest.schemaVersionId) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: 'manifest missing schema version; cannot compact'
    };
  }

  const schemaVersion = await getSchemaVersionById(manifest.schemaVersionId);
  if (!schemaVersion) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: `schema version ${manifest.schemaVersionId} not found`
    };
  }

  const schemaFields = extractSchemaFields(schemaVersion);
  if (schemaFields.length === 0) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: 'schema version missing field definitions'
    };
  }

  const partitionsById = new Map(partitions.map((partition) => [partition.id, partition]));

  let checkpoint = await getCompactionCheckpointByManifest(manifest.id);
  let metadataState: CheckpointMetadataV1 | null = checkpoint
    ? parseCheckpointMetadata(checkpoint)
    : null;
  let statsState: CheckpointStatsV1 | null = checkpoint ? parseCheckpointStats(checkpoint) : null;

  const chunkLimitChanged =
    metadataState && metadataState.chunkPartitionLimit !== compactionConfig.chunkPartitionLimit;

  if (!checkpoint || !metadataState || chunkLimitChanged) {
    const groups = buildCompactionGroups(partitions, compactionConfig);
    if (groups.length === 0) {
      return {
        operation: 'compaction',
        status: 'skipped',
        message: 'no small partition groups found for compaction'
      };
    }

    const metadata = buildCheckpointMetadata(manifest, compactionConfig.chunkPartitionLimit, groups);
    const stats = buildInitialCheckpointStats();
    checkpoint = await upsertCompactionCheckpoint({
      id: checkpoint?.id ?? `cc-${randomUUID()}`,
      datasetId: context.dataset.id,
      manifestId: manifest.id,
      manifestShard: manifest.manifestShard,
      totalGroups: metadata.groups.length,
      metadata,
      stats
    });
    metadataState = parseCheckpointMetadata(checkpoint);
    statsState = parseCheckpointStats(checkpoint);
  }

  if (!checkpoint || !metadataState || !statsState) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: 'failed to initialise compaction checkpoint'
    };
  }

  const pendingGroupIds = metadataState.groups
    .map((group) => group.id)
    .filter((groupId) => !metadataState.completedGroupIds.includes(groupId));
  if (pendingGroupIds.length === 0) {
    await updateCompactionCheckpoint({
      id: checkpoint.id,
      status: 'completed',
      cursor: checkpoint.totalGroups,
      metadataReplace: metadataState,
      statsReplace: statsState,
      lastError: null
    });
    return {
      operation: 'compaction',
      status: 'skipped',
      message: 'compaction checkpoint already completed'
    };
  }

  const auditEvents: LifecycleAuditLogInput[] = [];
  const chunkSummaries: CompactionChunkSummary[] = [];
  const partitionsToDelete: PartitionWithTarget[] = [];
  const replacementPartitionIds: string[] = [];
  let totalBytes = 0;
  let totalPartitions = 0;
  let latestManifest: DatasetManifestWithPartitions | null = null;
  let cursor = checkpoint.cursor;

  if (checkpoint.retryCount > 0) {
    statsState.resumedAt = new Date().toISOString();
    auditEvents.push({
      id: `la-${randomUUID()}`,
      datasetId: context.dataset.id,
      manifestId: manifest.id,
      eventType: 'compaction.resume',
      payload: {
        datasetId: context.dataset.id,
        manifestId: manifest.id,
        manifestShard: manifest.manifestShard,
        retryCount: checkpoint.retryCount,
        cursor
      }
    });
  }

  while (true) {
    const selection = selectNextChunk(metadataState, cursor, compactionConfig.chunkPartitionLimit);
    if (selection.groups.length === 0) {
      break;
    }

    const materialized = materializeChunkGroups(selection.groups, partitionsById);

    if (materialized.skipped.length > 0) {
      const skippedIds = materialized.skipped.map((group) => group.id);
      metadataState.completedGroupIds = mergeUnique(metadataState.completedGroupIds, skippedIds);
      cursor = selection.nextCursor;
      await updateCompactionCheckpoint({
        id: checkpoint.id,
        cursor,
        metadataReplace: metadataState,
        statsReplace: statsState,
        lastError: null
      });

      for (const skipped of materialized.skipped) {
        auditEvents.push({
          id: `la-${randomUUID()}`,
          datasetId: context.dataset.id,
          manifestId: manifest.id,
          eventType: 'compaction.group.skipped',
          payload: {
            datasetId: context.dataset.id,
            manifestId: manifest.id,
            manifestShard: manifest.manifestShard,
            groupId: skipped.id,
            reason: 'source partitions missing'
          }
        });
      }

      if (materialized.ready.length === 0) {
        continue;
      }
    }

    if (materialized.ready.length === 0) {
      cursor = selection.nextCursor;
      continue;
    }

    const chunkId = `chunk-${selection.startIndex}-${Date.now()}`;
    const attemptsForChunk: Record<string, number> = {};
    for (const group of materialized.ready) {
      const currentAttempt = (metadataState.chunkAttempts[group.summary.id] ?? 0) + 1;
      metadataState.chunkAttempts[group.summary.id] = currentAttempt;
      attemptsForChunk[group.summary.id] = currentAttempt;
    }

    const chunkStartedAt = Date.now();

    try {
      const chunkResult = await processChunk({
        chunkId,
        context,
        schemaFields,
        manifest,
        groups: materialized.ready,
        metadataState,
        attempts: attemptsForChunk
      });

      metadataState.completedGroupIds = mergeUnique(
        metadataState.completedGroupIds,
        materialized.ready.map((group) => group.summary.id)
      );
      cursor = selection.nextCursor;
      latestManifest = chunkResult.manifest;
      context.manifest = chunkResult.manifest;
      totalBytes += chunkResult.bytesWritten;
      totalPartitions += chunkResult.sourcePartitions.length;
      partitionsToDelete.push(...chunkResult.sourcePartitions);
      replacementPartitionIds.push(...chunkResult.replacementPartitionIds);
      auditEvents.push(...chunkResult.auditEvents);

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - chunkStartedAt;
      const partitionsInChunk = chunkResult.sourcePartitions.length;
      chunkSummaries.push({
        chunkId,
        groupIds: materialized.ready.map((group) => group.summary.id),
        partitionIds: chunkResult.sourcePartitions.map((partition) => partition.id),
        attempts: attemptsForChunk,
        bytes: chunkResult.bytesWritten,
        partitions: partitionsInChunk,
        durationMs,
        completedAt
      });

      const attemptValues = Object.values(attemptsForChunk);
      const maxAttempt = attemptValues.length > 0 ? Math.max(...attemptValues) : 0;

      statsState.bytesProcessed += chunkResult.bytesWritten;
      statsState.partitionsCompacted += partitionsInChunk;
      statsState.rowsCompacted += chunkResult.rowsWritten;
      statsState.chunksCompleted += 1;
      statsState.chunkHistory.push({
        chunkId,
        bytes: chunkResult.bytesWritten,
        partitions: partitionsInChunk,
        attempts: maxAttempt,
        durationMs,
        completedAt
      });
      if (statsState.chunkHistory.length > MAX_CHUNK_HISTORY) {
        statsState.chunkHistory.splice(0, statsState.chunkHistory.length - MAX_CHUNK_HISTORY);
      }

      recordCompactionChunk({
        chunkId,
        bytes: chunkResult.bytesWritten,
        partitions: partitionsInChunk,
        durationMs,
        attempts: maxAttempt
      });

      await updateCompactionCheckpoint({
        id: checkpoint.id,
        cursor,
        metadataReplace: metadataState,
        statsReplace: statsState,
        lastError: null
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      statsState.lastError = err.message;
      await updateCompactionCheckpoint({
        id: checkpoint.id,
        metadataReplace: metadataState,
        statsReplace: statsState,
        lastError: err.message
      });
      throw err;
    }
  }

  await updateCompactionCheckpoint({
    id: checkpoint.id,
    status: 'completed',
    cursor: metadataState.groups.length,
    metadataReplace: metadataState,
    statsReplace: statsState,
    lastError: null
  });

  invalidateSqlRuntimeCache();

  if (!latestManifest) {
    latestManifest = context.manifest;
  }

  return {
    operation: 'compaction',
    status: replacementPartitionIds.length > 0 ? 'completed' : 'skipped',
    manifest: latestManifest,
    auditEvents,
    totals: {
      partitions: totalPartitions,
      bytes: totalBytes
    },
    partitionsToDelete,
    details: {
      checkpointId: checkpoint.id,
      retryCount: checkpoint.retryCount,
      chunks: chunkSummaries
    }
  };
}

function buildCompactionGroups(
  partitions: PartitionWithTarget[],
  config: {
    smallPartitionBytes: number;
    targetPartitionBytes: number;
    maxPartitionsPerGroup: number;
  }
): CompactionGroup[] {
  const sorted = [...partitions]
    .filter((partition) => partition.fileFormat === 'duckdb')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const groups: CompactionGroup[] = [];
  let current: CompactionGroup | null = null;
  let sequence = 0;

  const flushCurrent = () => {
    if (current && current.partitions.length > 1) {
      groups.push(current);
    }
    current = null;
  };

  for (const partition of sorted) {
    const size = partition.fileSizeBytes ?? 0;
    if (size > config.smallPartitionBytes) {
      flushCurrent();
      continue;
    }

    const tableName = extractTableName(partition);
    const storageTargetId = partition.storageTarget.id;

    if (
      current &&
      (current.totalBytes + size > config.targetPartitionBytes ||
        current.partitions.length >= config.maxPartitionsPerGroup ||
        current.storageTargetId !== storageTargetId ||
        current.tableName !== tableName)
    ) {
      flushCurrent();
    }

    if (!current) {
      current = {
        id: `cg-${sequence++}`,
        partitions: [],
        totalBytes: 0,
        totalRows: 0,
        tableName,
        storageTargetId
      };
    }

    current.partitions.push(partition);
    current.totalBytes += size;
    current.totalRows += partition.rowCount ?? 0;
  }

  flushCurrent();
  return groups;
}

function selectNextChunk(
  metadata: CheckpointMetadataV1,
  cursor: number,
  chunkPartitionLimit: number
): { groups: CompactionPlanGroupSummary[]; startIndex: number; nextCursor: number } {
  const groups: CompactionPlanGroupSummary[] = [];
  const completedSet = new Set(metadata.completedGroupIds);
  let nextCursor = cursor;
  let partitionsInChunk = 0;

  while (nextCursor < metadata.groups.length) {
    const candidate = metadata.groups[nextCursor];
    nextCursor += 1;
    if (completedSet.has(candidate.id)) {
      continue;
    }

    const partitionCount = candidate.partitionIds.length;
    if (groups.length > 0 && partitionsInChunk + partitionCount > chunkPartitionLimit) {
      nextCursor -= 1;
      break;
    }

    groups.push(candidate);
    partitionsInChunk += partitionCount;

    if (partitionsInChunk >= chunkPartitionLimit) {
      break;
    }
  }

  return {
    groups,
    startIndex: cursor,
    nextCursor
  };
}

function materializeChunkGroups(
  summaries: CompactionPlanGroupSummary[],
  partitionsById: Map<string, PartitionWithTarget>
): MaterializedChunkGroups {
  const ready: MaterializedPlanGroup[] = [];
  const skipped: CompactionPlanGroupSummary[] = [];

  for (const summary of summaries) {
    const partitions: PartitionWithTarget[] = [];
    let missing = false;

    for (const partitionId of summary.partitionIds) {
      const partition = partitionsById.get(partitionId);
      if (!partition) {
        missing = true;
        break;
      }
      if (partition.storageTarget.id !== summary.storageTargetId) {
        missing = true;
        break;
      }
      partitions.push(partition);
    }

    if (missing || partitions.length === 0) {
      skipped.push(summary);
      continue;
    }

    ready.push({
      summary,
      partitions
    });
  }

  return { ready, skipped };
}

async function processChunk(params: {
  chunkId: string;
  context: LifecycleJobContext;
  schemaFields: FieldDefinition[];
  manifest: DatasetManifestWithPartitions;
  groups: MaterializedPlanGroup[];
  metadataState: CheckpointMetadataV1;
  attempts: Record<string, number>;
}): Promise<CompactionChunkResult> {
  const { chunkId, context, schemaFields, manifest, groups, attempts } = params;
  const chunkAuditEvents: LifecycleAuditLogInput[] = [];
  const replacementPartitionInputs: PartitionInput[] = [];
  const partitionsToDelete: PartitionWithTarget[] = [];
  const replacementPartitionIds: string[] = [];
  const storageDriverCache = new Map<string, ReturnType<typeof createStorageDriver>>();

  let bytesWritten = 0;
  let rowsWritten = 0;

  const artifacts: CompactedPartitionArtifact[] = [];

  for (const group of groups) {
    const artifact = await materializeGroupPartition(
      group,
      schemaFields,
      context.config
    );
    artifacts.push(artifact);
  }

  try {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const artifact = artifacts[index];
      const storageTarget = group.partitions[0]?.storageTarget;
      if (!storageTarget) {
        continue;
      }

      let driver = storageDriverCache.get(storageTarget.id);
      if (!driver) {
        driver = createStorageDriver(context.config, storageTarget);
        storageDriverCache.set(storageTarget.id, driver);
      }

      const partitionKey = buildPartitionKey(group.partitions.length, artifact.startTime, artifact.endTime);
      const writeResult = await driver.writePartition({
        datasetSlug: context.dataset.slug,
        partitionId: group.summary.replacementPartitionId,
        partitionKey,
        tableName: group.summary.tableName,
        schema: schemaFields,
        sourceFilePath: artifact.tempFile,
        rowCountHint: artifact.rowCount
      });

      const fileSize = writeResult.fileSizeBytes ?? artifact.fileSizeBytes;
      bytesWritten += fileSize;
      rowsWritten += writeResult.rowCount ?? artifact.rowCount;
      replacementPartitionIds.push(group.summary.replacementPartitionId);
      partitionsToDelete.push(...group.partitions);

      replacementPartitionInputs.push({
        id: group.summary.replacementPartitionId,
        storageTargetId: storageTarget.id,
        fileFormat: 'duckdb',
        filePath: writeResult.relativePath,
        partitionKey,
        startTime: artifact.startTime,
        endTime: artifact.endTime,
        fileSizeBytes: fileSize,
        rowCount: writeResult.rowCount ?? artifact.rowCount,
        checksum: writeResult.checksum,
        metadata: {
          tableName: group.summary.tableName,
          lifecycle: {
            compaction: {
              chunkId,
              attempt: attempts[group.summary.id] ?? 1,
              sourcePartitionIds: group.summary.partitionIds
            }
          }
        }
      });

      chunkAuditEvents.push({
        id: `la-${randomUUID()}`,
        datasetId: context.dataset.id,
        manifestId: manifest.id,
        eventType: 'compaction.group.compacted',
        payload: {
          datasetId: context.dataset.id,
          manifestId: manifest.id,
          manifestShard: manifest.manifestShard,
          groupId: group.summary.id,
          chunkId,
          sourcePartitionIds: group.summary.partitionIds,
          replacementPartitionId: group.summary.replacementPartitionId,
          tableName: group.summary.tableName,
          rowCount: writeResult.rowCount,
          bytesWritten: fileSize,
          attempt: attempts[group.summary.id] ?? 1
        }
      });
    }
  } finally {
    for (const artifact of artifacts) {
      await rm(artifact.tempDir, { recursive: true, force: true });
    }
  }

  const summaryPatch = {
    lifecycle: {
      compaction: {
        appliedAt: new Date().toISOString(),
        chunkId,
        groups: groups.map((group, index) => ({
          id: group.summary.id,
          sourcePartitionIds: group.summary.partitionIds,
          totalRows: artifacts[index]?.rowCount ?? group.summary.totalRows,
          totalBytes: artifacts[index]?.fileSizeBytes ?? group.summary.totalBytes
        })),
        replacementPartitionIds
      }
    }
  } as Record<string, unknown>;

  const metadataPatch = {
    lifecycle: {
      compaction: {
        previousManifestId: manifest.id,
        lastChunkId: chunkId
      }
    }
  } as Record<string, unknown>;

  const newManifest = await replacePartitionsInManifest({
    datasetId: context.dataset.id,
    manifestId: manifest.id,
    removePartitionIds: partitionsToDelete.map((partition) => partition.id),
    addPartitions: replacementPartitionInputs,
    summaryPatch,
    metadataPatch
  });

  return {
    manifest: newManifest,
    bytesWritten,
    rowsWritten,
    sourcePartitions: partitionsToDelete,
    replacementPartitionIds,
    auditEvents: chunkAuditEvents
  };
}

function buildCheckpointMetadata(
  manifest: DatasetManifestWithPartitions,
  chunkPartitionLimit: number,
  groups: CompactionGroup[]
): CheckpointMetadataV1 {
  return {
    version: CHECKPOINT_METADATA_VERSION,
    manifestId: manifest.id,
    manifestShard: manifest.manifestShard,
    schemaVersionId: manifest.schemaVersionId,
    chunkPartitionLimit,
    groups: groups.map((group) => ({
      id: group.id,
      partitionIds: group.partitions.map((partition) => partition.id),
      storageTargetId: group.storageTargetId,
      tableName: group.tableName,
      replacementPartitionId: `part-${randomUUID()}`,
      totalBytes: group.totalBytes,
      totalRows: group.totalRows
    })),
    completedGroupIds: [],
    chunkAttempts: {}
  };
}

function buildInitialCheckpointStats(): CheckpointStatsV1 {
  return {
    version: CHECKPOINT_STATS_VERSION,
    bytesProcessed: 0,
    partitionsCompacted: 0,
    rowsCompacted: 0,
    chunksCompleted: 0,
    chunkHistory: []
  };
}

function parseCheckpointMetadata(record: CompactionCheckpointRecord): CheckpointMetadataV1 | null {
  const value = record.metadata as Partial<CheckpointMetadataV1> | undefined;
  if (!value || value.version !== CHECKPOINT_METADATA_VERSION) {
    return null;
  }
  return {
    version: CHECKPOINT_METADATA_VERSION,
    manifestId: value.manifestId ?? record.manifestId,
    manifestShard: value.manifestShard ?? record.manifestShard,
    schemaVersionId: value.schemaVersionId ?? null,
    chunkPartitionLimit: value.chunkPartitionLimit ?? 1,
    groups: Array.isArray(value.groups) ? value.groups : [],
    completedGroupIds: Array.isArray(value.completedGroupIds) ? value.completedGroupIds : [],
    chunkAttempts: value.chunkAttempts ?? {}
  };
}

function parseCheckpointStats(record: CompactionCheckpointRecord): CheckpointStatsV1 | null {
  const stats = record.stats as Partial<CheckpointStatsV1> | undefined;
  if (!stats || stats.version !== CHECKPOINT_STATS_VERSION) {
    return buildInitialCheckpointStats();
  }
  return {
    version: CHECKPOINT_STATS_VERSION,
    bytesProcessed: stats.bytesProcessed ?? 0,
    partitionsCompacted: stats.partitionsCompacted ?? 0,
    rowsCompacted: stats.rowsCompacted ?? 0,
    chunksCompleted: stats.chunksCompleted ?? 0,
    chunkHistory: Array.isArray(stats.chunkHistory) ? stats.chunkHistory : [],
    resumedAt: stats.resumedAt,
    lastError: stats.lastError ?? null
  };
}

async function materializeGroupPartition(
  group: MaterializedPlanGroup,
  schemaFields: FieldDefinition[],
  config: ServiceConfig
): Promise<CompactedPartitionArtifact> {
  const duckdb = loadDuckDb();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'timestore-compaction-'));
  const tempFile = path.join(tempDir, `${group.summary.replacementPartitionId}.duckdb`);
  const db = new duckdb.Database(tempFile);
  const connection = db.connect();

  try {
    const safeTableName = quoteIdentifier(group.summary.tableName || 'records');
    const columnDefinitions = schemaFields
      .map((field) => `${quoteIdentifier(field.name)} ${mapDuckDbType(field.type)}`)
      .join(', ');
    await run(connection, `CREATE TABLE ${safeTableName} (${columnDefinitions})`);

    for (let index = 0; index < group.partitions.length; index += 1) {
      const partition = group.partitions[index];
      const alias = `src${index}`;
      const location = resolvePartitionLocation(partition, partition.storageTarget, config);
      const escapedLocation = location.replace(/'/g, "''");
      await run(connection, `ATTACH '${escapedLocation}' AS ${alias}`);
      const tableColumns = await all(
        connection,
        `PRAGMA table_info('${alias}.${group.summary.tableName}')`
      );
      const availableColumns = new Set(
        tableColumns.map((row) => (typeof row.name === 'string' ? row.name : String(row.name)))
      );
      const columnList = schemaFields.map((field) => quoteIdentifier(field.name)).join(', ');
      const selectExpressions = schemaFields
        .map((field) => {
          const quoted = quoteIdentifier(field.name);
          if (availableColumns.has(field.name)) {
            return quoted;
          }
          return `CAST(NULL AS ${mapDuckDbType(field.type)}) AS ${quoted}`;
        })
        .join(', ');
      await run(
        connection,
        `INSERT INTO ${safeTableName} (${columnList}) SELECT ${selectExpressions} FROM ${alias}.${quoteIdentifier(group.summary.tableName)}`
      );
      await run(connection, `DETACH ${alias}`);
    }

    const rowCountResult = await all(connection, `SELECT COUNT(*)::BIGINT AS count FROM ${safeTableName}`);
    const rowCount = Number(rowCountResult[0]?.count ?? 0);
    const startTime = new Date(
      Math.min(...group.partitions.map((partition) => new Date(partition.startTime).getTime()))
    );
    const endTime = new Date(
      Math.max(...group.partitions.map((partition) => new Date(partition.endTime).getTime()))
    );
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }

    const fileStats = await stat(tempFile);
    const checksum = await computeFileChecksum(tempFile);

    return {
      groupId: group.summary.id,
      tempDir,
      tempFile,
      rowCount,
      fileSizeBytes: fileStats.size,
      checksum,
      startTime,
      endTime
    };
  } catch (error) {
    await closeConnection(connection).catch(() => undefined);
    if (isCloseable(db)) {
      try {
        db.close();
      } catch {
        // database already closed
      }
    }
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function extractTableName(partition: DatasetPartitionRecord): string {
  const metadata = partition.metadata ?? {};
  const tableName = typeof metadata.tableName === 'string' ? metadata.tableName : 'records';
  return tableName;
}

function extractSchemaFields(schema: DatasetSchemaVersionRecord): FieldDefinition[] {
  const candidate = schema.schema as { fields?: { name: string; type: string }[] } | undefined;
  if (!candidate || !Array.isArray(candidate.fields)) {
    return [];
  }
  return candidate.fields
    .map((field) => ({
      name: field.name,
      type: normalizeFieldType(field.type)
    }))
    .filter((field): field is FieldDefinition => field.type !== null);
}

function normalizeFieldType(value: string): FieldType | null {
  const allowed: FieldType[] = ['timestamp', 'string', 'double', 'integer', 'boolean'];
  if (allowed.includes(value as FieldType)) {
    return value as FieldType;
  }
  return null;
}

function buildPartitionKey(
  partitionCount: number,
  startTime: Date,
  endTime: Date
): Record<string, string> {
  const startIso = startTime.toISOString();
  const endIso = endTime.toISOString();
  return {
    compacted_range: `${startIso}__${endIso}`,
    partition_count: String(partitionCount)
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function mapDuckDbType(type: FieldType): string {
  switch (type) {
    case 'timestamp':
      return 'TIMESTAMP';
    case 'double':
      return 'DOUBLE';
    case 'integer':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
    default:
      return 'VARCHAR';
  }
}

function mergeUnique<T>(existing: T[], additions: T[]): T[] {
  const set = new Set(existing);
  for (const item of additions) {
    set.add(item);
  }
  return Array.from(set);
}

function run(connection: any, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, ...params, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function all(connection: any, sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: Record<string, unknown>[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
}

function closeConnection(connection: any): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function computeFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
