import { randomUUID } from 'node:crypto';
import {
  getDatasetBySlug,
  listPartitionsForQuery,
  type PartitionWithTarget
} from '../db/metadata';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { resolvePartitionLocation } from '../storage';
import { queryRequestSchema, type QueryRequest, type DownsampleInput } from './types';

export interface QueryPlanPartition {
  id: string;
  alias: string;
  tableName: string;
  location: string;
  startTime: Date;
  endTime: Date;
}

export interface DownsampleAggregationPlan {
  column: string;
  fn: 'avg' | 'min' | 'max' | 'sum';
  alias: string;
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
  requestInput: unknown
): Promise<QueryPlan> {
  const request = queryRequestSchema.parse(requestInput);
  const dataset = await getDatasetBySlug(datasetSlug);
  if (!dataset) {
    throw new Error(`Dataset ${datasetSlug} not found`);
  }

  const rangeStart = new Date(request.timeRange.start);
  const rangeEnd = new Date(request.timeRange.end);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw new Error('Invalid time range supplied');
  }
  if (rangeEnd.getTime() < rangeStart.getTime()) {
    throw new Error('timeRange.end must be greater than or equal to timeRange.start');
  }

  const config = loadServiceConfig();
  const partitions = await listPartitionsForQuery(dataset.id, rangeStart, rangeEnd, request.filters ?? {});
  if (partitions.length === 0) {
    throw new Error('No partitions available for the requested time range');
  }

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
  const aggregationPlans = aggregations.map((aggregation) => ({
    column: aggregation.column,
    fn: aggregation.fn,
    alias: aggregation.alias ?? `${aggregation.fn}_${aggregation.column}`
  }));
  return {
    intervalLiteral,
    aggregations: aggregationPlans
  } satisfies DownsamplePlan;
}

function createIntervalLiteral(size: number, unit: DownsampleInput['intervalUnit']): string {
  const unitSuffix = size === 1 ? unit : `${unit}s`;
  return `${size} ${unitSuffix}`;
}
