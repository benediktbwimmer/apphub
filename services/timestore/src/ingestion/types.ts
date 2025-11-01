import { z } from 'zod';
import type { DatasetManifestWithPartitions, DatasetRecord, StorageTargetRecord } from '../db/metadata';
import type { FieldDefinition } from '../storage';

export const fieldTypeSchema = z.enum(['timestamp', 'string', 'double', 'integer', 'boolean']);

export const fieldDefinitionSchema = z.object({
  name: z.string().min(1),
  type: fieldTypeSchema
});

export const ingestionActorSchema = z.object({
  id: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([])
});

const schemaEvolutionOptionsSchema = z
  .object({
    defaults: z.record(z.string(), z.unknown()).optional(),
    backfill: z.boolean().optional()
  })
  .partial();

const datasetSchemaSchema = z.object({
  fields: z.array(fieldDefinitionSchema).min(1),
  evolution: schemaEvolutionOptionsSchema.optional()
});

export const ingestionRequestSchema = z.object({
  datasetSlug: z.string().min(1),
  datasetName: z.string().min(1).optional(),
  storageTargetId: z.string().optional(),
  tableName: z.string().min(1).max(120).optional(),
  schema: datasetSchemaSchema,
  partition: z.object({
    key: z.record(z.string(), z.string()),
    attributes: z.record(z.string(), z.string()).optional(),
    timeRange: z.object({
      start: z.string().min(1),
      end: z.string().min(1)
    })
  }),
  rows: z.array(z.record(z.string(), z.unknown())),
  idempotencyKey: z.string().min(1).max(255).optional(),
  actor: ingestionActorSchema.optional()
});

export type IngestionRequest = z.infer<typeof ingestionRequestSchema>;

export const ingestionJobPayloadSchema = ingestionRequestSchema.extend({
  receivedAt: z.string()
});

export type IngestionJobPayload = z.infer<typeof ingestionJobPayloadSchema>;

export const partitionBuildJobPayloadSchema = z
  .object({
    datasetSlug: z.string().min(1),
    storageTargetId: z.string().min(1),
    partitionId: z.string().min(1),
    partitionKey: z.record(z.string(), z.string()),
    tableName: z.string().min(1).max(120),
    schema: z.array(fieldDefinitionSchema).min(1),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    sourceFilePath: z.string().min(1).optional(),
    rowCountHint: z.number().int().nonnegative().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.rows && !value.sourceFilePath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'partition build requires rows or a source file path'
      });
    }
  });

export const partitionBuildJobResultSchema = z.object({
  storageTargetId: z.string().min(1),
  relativePath: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  checksum: z.string().min(1)
});

export type IngestionActor = z.infer<typeof ingestionActorSchema>;

export interface IngestionProcessingResult {
  dataset: DatasetRecord;
  manifest: DatasetManifestWithPartitions | null;
  storageTarget: StorageTargetRecord;
  idempotencyKey?: string | null;
  flushPending?: boolean;
}

export type { FieldDefinition };

export type SchemaEvolutionOptions = z.infer<typeof schemaEvolutionOptionsSchema>;

export type PartitionBuildJobPayload = z.infer<typeof partitionBuildJobPayloadSchema>;

export type PartitionBuildJobResult = z.infer<typeof partitionBuildJobResultSchema>;
