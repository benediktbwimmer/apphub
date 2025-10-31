import { z } from 'zod';
import type {
  DatasetManifestWithPartitions,
  DatasetRecord,
  JsonObject,
  LifecycleAuditLogInput,
  LifecycleAuditLogRecord,
  LifecycleJobRunRecord,
  PartitionWithTarget,
  RetentionPolicyRecord
} from '../db/metadata';
import type { ServiceConfig } from '../config/serviceConfig';

export type LifecycleOperation = 'compaction' | 'retention' | 'postgres_migration';

export type LifecycleTrigger = 'schedule' | 'manual' | 'retry' | 'api';

export interface LifecycleJobPayload {
  datasetId: string;
  datasetSlug: string;
  operations: LifecycleOperation[];
  trigger: LifecycleTrigger;
  requestId: string;
  requestedAt: string;
  scheduledFor?: string | null;
}

export interface LifecycleJobContext {
  config: ServiceConfig;
  dataset: DatasetRecord;
  manifest: DatasetManifestWithPartitions;
  retentionPolicy: RetentionPolicy | null;
  jobRun: LifecycleJobRunRecord;
}

export interface LifecycleOperationResult {
  operation: LifecycleOperation;
  status: 'skipped' | 'completed' | 'failed';
  message?: string;
  details?: JsonObject;
}

export interface LifecycleMaintenanceReport {
  jobId: string;
  datasetId: string;
  datasetSlug: string;
  operations: LifecycleOperationResult[];
  auditLogEntries: LifecycleAuditLogRecord[];
}

export interface LifecycleOperationExecutionResult extends LifecycleOperationResult {
  manifest?: DatasetManifestWithPartitions;
  auditEvents?: LifecycleAuditLogInput[];
  totals?: {
    partitions: number;
    bytes: number;
  };
  partitionsToDelete?: PartitionWithTarget[];
}

const retentionRuleSchema = z.object({
  maxAgeHours: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional()
});

export const retentionPolicySchema = z
  .object({
  mode: z.enum(['time', 'size', 'hybrid']).optional(),
  rules: retentionRuleSchema.default({}),
  deleteGraceMinutes: z.number().int().nonnegative().optional(),
  coldStorageAfterHours: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export function parseRetentionPolicy(
  record: RetentionPolicyRecord | null,
  defaults: RetentionPolicy
): RetentionPolicy {
  if (!record) {
    return defaults;
  }
  try {
    return retentionPolicySchema.parse(record.policy);
  } catch (err) {
    return defaults;
  }
}

export function createDefaultRetentionPolicy(config: ServiceConfig): RetentionPolicy {
  const { lifecycle } = config;
  return {
    mode: 'hybrid',
    rules: {
      maxAgeHours: lifecycle.retention.defaultRules.maxAgeHours,
      maxTotalBytes: lifecycle.retention.defaultRules.maxTotalBytes
    },
    deleteGraceMinutes: lifecycle.retention.deleteGraceMinutes
  };
}

export function normalizeOperations(operations: LifecycleOperation[]): LifecycleOperation[] {
  const seen = new Set<LifecycleOperation>();
  const normalized: LifecycleOperation[] = [];
  for (const op of operations) {
    if (!seen.has(op)) {
      normalized.push(op);
      seen.add(op);
    }
  }
  if (normalized.length === 0) {
    return ['compaction', 'retention'];
  }
  return normalized;
}

export interface PostgresMigrationConfig {
  enabled: boolean;
  batchSize: number;
  maxAgeHours: number;
  gracePeriodhours: number;
  targetTable: string;
  watermarkTable: string;
}

export function createDefaultPostgresMigrationConfig(): PostgresMigrationConfig {
  return {
    enabled: true,
    batchSize: 10000,
    maxAgeHours: 24 * 7,
    gracePeriodhours: 24,
    targetTable: 'migrated_data',
    watermarkTable: 'migration_watermarks'
  };
}
