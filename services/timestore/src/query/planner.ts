import { randomUUID } from 'node:crypto';
import {
  getDatasetBySlug,
  listPartitionsForQuery,
  type PartitionWithTarget,
  type DatasetRecord
} from '../db/metadata';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { resolvePartitionLocation } from '../storage';
import {
  queryRequestSchema,
  type QueryRequest,
  type DownsampleInput,
  type DownsampleAggregationInput
} from './types';

export interface QueryPlanPartition {
  id: string;
  alias: string;
  tableName: string;
  location: string;
  startTime: Date;
  endTime: Date;
}

export interface DownsampleAggregationPlan {
  alias: string;
  expression: string;
}

export interface DownsamplePlan {
  intervalLiteral: string;
  aggregations: DownsampleAggregationPlan[];
}

export interface QueryPlan {
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
  const partitions = await listPartitionsForQuery(dataset.id, rangeStart, rangeEnd, request.filters ?? {});

  const planPartitions = partitions.map((partition, index) =>
    buildPlanPartition(partition, index, config)
  );

  let downsamplePlan: DownsamplePlan | undefined;
  if (request.downsample) {
    const { intervalUnit, intervalSize, aggregations } = request.downsample;
    downsamplePlan = buildDownsamplePlan(intervalUnit, intervalSize, aggregations);
  }

  const mode = downsamplePlan ? 'downsampled' : 'raw';

  return {
    datasetId: dataset.id,
    datasetSlug,
    timestampColumn: request.timestampColumn,
    columns: request.columns,
    limit: request.limit,
    partitions: planPartitions,
    downsample: downsamplePlan,
    mode,
    rangeStart,
    rangeEnd
  } satisfies QueryPlan;
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
    endTime: new Date(partition.endTime)
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
