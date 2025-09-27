export type StringPartitionKeyPredicate = {
  type: 'string';
  eq?: string;
  in?: string[];
};

export type NumberPartitionKeyPredicate = {
  type: 'number';
  eq?: number;
  in?: number[];
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
};

export type TimestampPartitionKeyPredicate = {
  type: 'timestamp';
  eq?: string;
  in?: string[];
  gt?: string;
  gte?: string;
  lt?: string;
  lte?: string;
};

export type PartitionKeyPredicate =
  | StringPartitionKeyPredicate
  | NumberPartitionKeyPredicate
  | TimestampPartitionKeyPredicate;

export interface PartitionFilters {
  partitionKey?: Record<string, PartitionKeyPredicate>;
}
