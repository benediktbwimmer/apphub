import { randomUUID } from 'node:crypto';
import {
  getDatasetBySlug,
  getSchemaVersionById,
  type DatasetRecord,
  type DatasetManifestRecord,
  type StorageTargetRecord,
  type PartitionWithTarget
} from '../db/metadata';
import { loadManifestPartitionsForQuery } from '../cache/manifestCache';
import {
  loadServiceConfig,
  type ServiceConfig,
  type QueryExecutionBackendConfig
} from '../config/serviceConfig';
import { resolvePartitionLocation } from '../storage';
import {
  queryRequestSchema,
  type QueryRequest,
  type DownsampleInput,
  type DownsampleAggregationInput
} from './types';
import {
  extractFieldDefinitions,
  mergeFieldDefinitionsSuperset,
  normalizeFieldDefinitions
} from '../schema/compatibility';
import type { FieldDefinition } from '../storage';
import { readStagingSchemaFields } from '../sql/stagingSchema';
import type { ColumnPredicate } from '../types/partitionFilters';

export interface QueryPlanPartition {
  id: string;
  alias: string;
  tableName: string;
  location: string;
  startTime: Date;
  endTime: Date;
  storageTarget: StorageTargetRecord;
  fileSizeBytes: number | null;
}

export interface DownsampleAggregationPlan {
  alias: string;
  expression: string;
}

export interface DownsamplePlan {
  intervalLiteral: string;
  intervalUnit: DownsampleInput['intervalUnit'];
  intervalSize: number;
  aggregations: DownsampleAggregationPlan[];
}

export interface QueryPlan {
  dataset: DatasetRecord;
  datasetId: string;
  datasetSlug: string;
  timestampColumn: string;
  columns?: string[];
  limit?: number;
  partitions: QueryPlanPartition[];
  downsample?: DownsamplePlan;
  mode: 'raw' | 'downsampled';
  rangeStart: Date;
  rangeEnd: Date;
  schemaFields: FieldDefinition[];
  columnFilters?: Record<string, ColumnPredicate>;
  partitionSelection: PartitionSelectionSummary;
  execution: QueryExecutionPlan;
}

export interface QueryExecutionPlan {
  backend: QueryExecutionBackendConfig;
  requestedBackend: string | null;
}

export interface PartitionSelectionSummary {
  total: number;
  selected: number;
  pruned: number;
}

export async function buildQueryPlan(
  datasetSlug: string,
  requestInput: unknown,
  datasetOverride?: DatasetRecord
): Promise<QueryPlan> {
  const request = queryRequestSchema.parse(requestInput);
  const dataset = datasetOverride ?? (await getDatasetBySlug(datasetSlug));
  if (!dataset) {
    throw new Error(`Dataset ${datasetSlug} not found`);
  }

  const rangeStart = new Date(request.timeRange.start);
  const rangeEnd = new Date(request.timeRange.end);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw new Error(
      `Invalid time range supplied: start='${request.timeRange.start}', end='${request.timeRange.end}'`
    );
  }
  if (rangeEnd.getTime() < rangeStart.getTime()) {
    throw new Error('timeRange.end must be greater than or equal to timeRange.start');
  }

  const config = loadServiceConfig();
  const filters = request.filters ?? {};
  const cacheResult = await loadManifestPartitionsForQuery(dataset, rangeStart, rangeEnd, filters);
  const manifests = cacheResult.manifests;
  const shardKeys = cacheResult.shards.length > 0
    ? cacheResult.shards
    : Array.from(new Set(manifests.map((manifest) => manifest.manifestShard)));
  const partitions = cacheResult.partitions;

  const planPartitions = partitions.map((partition, index) =>
    buildPlanPartition(partition, index, config)
  );

  const columnFilters = filters.columns ?? {};
  const hasColumnFilters = Object.keys(columnFilters).length > 0;

  const selection: PartitionSelectionSummary = {
    total: cacheResult.partitionsEvaluated ?? planPartitions.length,
    selected: planPartitions.length,
    pruned: cacheResult.partitionsPruned ?? 0
  };

  let downsamplePlan: DownsamplePlan | undefined;
  if (request.downsample) {
    const { intervalUnit, intervalSize, aggregations } = request.downsample;
    downsamplePlan = buildDownsamplePlan(intervalUnit, intervalSize, aggregations);
  }

  const mode = downsamplePlan ? 'downsampled' : 'raw';
  const schemaFields = await resolveSchemaFieldsForPlan(dataset, manifests, config);
  const execution = resolveExecutionPlan(dataset, config);

  return {
    dataset,
    datasetId: dataset.id,
    datasetSlug,
    timestampColumn: request.timestampColumn,
    columns: request.columns,
    limit: request.limit,
    partitions: planPartitions,
    downsample: downsamplePlan,
    mode,
    rangeStart,
    rangeEnd,
    schemaFields,
    columnFilters: hasColumnFilters ? columnFilters : undefined,
    partitionSelection: selection,
    execution
  } satisfies QueryPlan;
}

function resolveExecutionPlan(
  dataset: DatasetRecord,
  config: ServiceConfig
): QueryExecutionPlan {
  const requested = extractRequestedBackend(dataset.metadata ?? {});
  const executionConfig = config.query.execution;
  const backendMap = new Map<string, QueryExecutionBackendConfig>(
    executionConfig.backends.map((backend) => [backend.name, backend])
  );
  const fallbackBackend = backendMap.get(executionConfig.defaultBackend) ?? executionConfig.backends[0];
  if (!fallbackBackend) {
    throw new Error('No query execution backends configured');
  }
  const backend = requested ? backendMap.get(requested) ?? fallbackBackend : fallbackBackend;
  return {
    backend,
    requestedBackend: requested
  } satisfies QueryExecutionPlan;
}

function extractRequestedBackend(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const execution = (metadata as { execution?: unknown }).execution;
  if (!execution || typeof execution !== 'object') {
    return null;
  }
  const backend = (execution as { backend?: unknown }).backend;
  if (typeof backend !== 'string') {
    return null;
  }
  const trimmed = backend.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveSchemaFieldsForPlan(
  dataset: DatasetRecord,
  manifests: DatasetManifestRecord[],
  config: ServiceConfig
): Promise<FieldDefinition[]> {
  const schemaVersionIds = manifests
    .map((manifest) => manifest.schemaVersionId)
    .filter((id): id is string => Boolean(id));

  if (schemaVersionIds.length > 0) {
    const uniqueIds = Array.from(new Set(schemaVersionIds));
    const fieldSets: FieldDefinition[][] = [];

    for (const schemaVersionId of uniqueIds) {
      const schemaVersion = await getSchemaVersionById(schemaVersionId);
      if (!schemaVersion) {
        continue;
      }
      const fields = normalizeFieldDefinitions(extractFieldDefinitions(schemaVersion.schema));
      if (fields.length > 0) {
        fieldSets.push(fields);
      }
    }

    if (fieldSets.length > 0) {
      return mergeFieldDefinitionsSuperset(fieldSets);
    }
  }

  const stagingFields = await readStagingSchemaFields(dataset, config);
  if (stagingFields.length === 0) {
    return [];
  }

  const mapped: FieldDefinition[] = [];
  for (const field of stagingFields) {
    const name = field.name.trim();
    if (!name) {
      continue;
    }
    mapped.push({
      name,
      type: mapStagingTypeToFieldType(field.type)
    });
  }

  return mapped;
}

function buildPlanPartition(
  partition: PartitionWithTarget,
  index: number,
  config: ServiceConfig
): QueryPlanPartition {
  const metadata = partition.metadata as Record<string, unknown>;
  const tableName = typeof metadata.tableName === 'string' ? metadata.tableName : 'records';
  const alias = `p_${index}_${randomUUID().slice(0, 8)}`;
  const location = resolvePartitionLocation(partition, partition.storageTarget, config);
  return {
    id: partition.id,
    alias,
    tableName,
    location,
    startTime: new Date(partition.startTime),
    endTime: new Date(partition.endTime),
    storageTarget: partition.storageTarget,
    fileSizeBytes: partition.fileSizeBytes ?? null
  } satisfies QueryPlanPartition;
}

function buildDownsamplePlan(
  intervalUnit: DownsampleInput['intervalUnit'],
  intervalSize: number,
  aggregations: DownsampleInput['aggregations']
): DownsamplePlan {
  const intervalLiteral = createIntervalLiteral(intervalSize, intervalUnit);
  const aggregationPlans = aggregations.map(createDownsampleAggregationPlan);
  return {
    intervalLiteral,
    intervalUnit,
    intervalSize,
    aggregations: aggregationPlans
  } satisfies DownsamplePlan;
}

function createDownsampleAggregationPlan(aggregation: DownsampleAggregationInput): DownsampleAggregationPlan {
  const alias = resolveAggregationAlias(aggregation);
  const expression = resolveAggregationExpression(aggregation);
  return {
    alias,
    expression
  } satisfies DownsampleAggregationPlan;
}

function resolveAggregationAlias(aggregation: DownsampleAggregationInput): string {
  if (aggregation.alias) {
    return aggregation.alias;
  }

  switch (aggregation.fn) {
    case 'count':
      return aggregation.column ? `count_${aggregation.column}` : 'count';
    case 'count_distinct':
      return `count_distinct_${aggregation.column}`;
    case 'percentile': {
      const percentileLabel = Math.round(aggregation.percentile * 100);
      return `p${percentileLabel}_${aggregation.column}`;
    }
    default:
      return `${aggregation.fn}_${aggregation.column}`;
  }
}

function resolveAggregationExpression(aggregation: DownsampleAggregationInput): string {
  const column = aggregation.column ? quoteIdentifier(aggregation.column) : null;

  switch (aggregation.fn) {
    case 'avg':
    case 'min':
    case 'max':
    case 'sum':
    case 'median':
      return `${aggregation.fn.toUpperCase()}(${column})`;
    case 'count':
      return column ? `COUNT(${column})` : 'COUNT(*)';
    case 'count_distinct':
      return `COUNT(DISTINCT ${column})`;
    case 'percentile':
      return `QUANTILE(${column}, ${Number(aggregation.percentile)})`;
    default: {
      const exhaustive: never = aggregation;
      throw new Error(`Unsupported aggregation function: ${(exhaustive as { fn: string }).fn}`);
    }
  }
}

function createIntervalLiteral(size: number, unit: DownsampleInput['intervalUnit']): string {
  const unitSuffix = size === 1 ? unit : `${unit}s`;
  return `${size} ${unitSuffix}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function mapStagingTypeToFieldType(input: string): FieldDefinition['type'] {
  const normalized = input.trim().toLowerCase();
  if (normalized.includes('time')) {
    return 'timestamp';
  }
  if (normalized === 'boolean' || normalized === 'bool') {
    return 'boolean';
  }
  if (
    normalized === 'double' ||
    normalized === 'float' ||
    normalized === 'real' ||
    normalized === 'numeric' ||
    normalized === 'decimal'
  ) {
    return 'double';
  }
  if (
    normalized === 'integer' ||
    normalized === 'int' ||
    normalized === 'bigint' ||
    normalized === 'smallint' ||
    normalized === 'tinyint'
  ) {
    return 'integer';
  }
  return 'string';
}
