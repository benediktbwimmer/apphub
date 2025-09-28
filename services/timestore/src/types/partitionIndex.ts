import type { FieldType } from '../storage';

export interface HistogramBin {
  lower: number | string | boolean;
  upper: number | string | boolean;
  count: number;
}

export interface PartitionColumnStatistics {
  type: FieldType;
  rowCount: number;
  nullCount: number;
  distinctCount?: number;
  distinctCountExact?: boolean;
  min?: number | string | boolean;
  max?: number | string | boolean;
  histogram?: {
    bins: HistogramBin[];
  };
}

export interface PartitionColumnBloomFilter {
  type: FieldType;
  hash: 'fnv1a32';
  m: number;
  k: number;
  bits: string;
  rowCount: number;
}

export type PartitionColumnStatisticsMap = Record<string, PartitionColumnStatistics>;
export type PartitionColumnBloomFilterMap = Record<string, PartitionColumnBloomFilter>;
