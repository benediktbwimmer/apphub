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

export const ingestionRequestSchema = z.object({
  datasetSlug: z.string().min(1),
  datasetName: z.string().min(1).optional(),
  storageTargetId: z.string().optional(),
  tableName: z.string().min(1).max(120).optional(),
  schema: z.object({ fields: z.array(fieldDefinitionSchema).min(1) }),
  partition: z.object({
    key: z.record(z.string(), z.string()),
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

export type IngestionActor = z.infer<typeof ingestionActorSchema>;

export interface IngestionProcessingResult {
  dataset: DatasetRecord;
  manifest: DatasetManifestWithPartitions;
  storageTarget: StorageTargetRecord;
  idempotencyKey?: string;
}

export type { FieldDefinition };
