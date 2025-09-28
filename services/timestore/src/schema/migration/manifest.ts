import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { z } from 'zod';
import type { FieldDefinition, FieldType } from '../../storage';

export type MigrationOperation = RenameOperation | TransformOperation | DropOperation;

export interface RenameOperation {
  kind: 'rename';
  from: string;
  to: string;
  transform?: string;
  description?: string;
}

export interface TransformOperation {
  kind: 'transform';
  column: string;
  expression: string;
  description?: string;
}

export interface DropOperation {
  kind: 'drop';
  column: string;
  description?: string;
  archive?: DropArchiveConfig | null;
}

export interface DropArchiveConfig {
  enabled: boolean;
  directoryOverride?: string | null;
  format: 'jsonl';
}

export interface SchemaMigrationManifest {
  version: number;
  dataset: string;
  baseline?: BaselineSelector | null;
  targetSchema: {
    fields: FieldDefinition[];
  };
  operations: MigrationOperation[];
  governance: GovernanceMetadata;
  execution: ExecutionOptions;
  validation: ValidationOptions;
}

export interface BaselineSelector {
  schemaVersionId?: string;
  schemaChecksum?: string;
}

export interface GovernanceMetadata {
  approvedBy: string;
  ticketId: string;
  changeReason?: string;
  approvedAt?: string;
  notes?: string;
}

export interface ExecutionOptions {
  dryRun: boolean;
  partitionBatchSize: number;
  archiveDirectory?: string | null;
  continueOnPartitionFailure: boolean;
}

export interface ValidationOptions {
  requireConsistentSchema: boolean;
  allowManifestsWithoutSchemaVersion: boolean;
  maxPartitions?: number | null;
}

const FIELD_TYPES: FieldType[] = ['timestamp', 'string', 'double', 'integer', 'boolean'];

const fieldDefinitionSchema = z
  .object({
    name: z.string().min(1, 'field name is required').trim(),
    type: z.enum(FIELD_TYPES)
  })
  .strict();

const renameOperationSchema = z
  .object({
    kind: z.literal('rename'),
    from: z.string().min(1).trim(),
    to: z.string().min(1).trim(),
    transform: z.string().min(1).trim().optional(),
    description: z.string().min(1).optional()
  })
  .strict();

const transformOperationSchema = z
  .object({
    kind: z.literal('transform'),
    column: z.string().min(1).trim(),
    expression: z.string().min(1, 'transform expression is required').trim(),
    description: z.string().min(1).optional()
  })
  .strict();

const dropArchiveSchema = z
  .union([
    z.boolean(),
    z
      .object({
        enabled: z.boolean().optional(),
        directory: z.string().min(1).trim().optional(),
        format: z.enum(['jsonl']).optional()
      })
      .strict()
  ])
  .optional();

const dropOperationSchema = z
  .object({
    kind: z.literal('drop'),
    column: z.string().min(1).trim(),
    description: z.string().min(1).optional(),
    archive: dropArchiveSchema
  })
  .strict();

const baselineSchema = z
  .object({
    schemaVersionId: z.string().min(1).trim().optional(),
    schemaChecksum: z.string().min(1).trim().optional()
  })
  .refine((value) => Boolean(value.schemaVersionId || value.schemaChecksum), {
    message: 'baseline requires schemaVersionId or schemaChecksum'
  })
  .optional();

const governanceSchema = z
  .object({
    approvedBy: z.string().min(1).trim(),
    ticketId: z.string().min(1).trim(),
    changeReason: z.string().min(1).optional(),
    approvedAt: z.string().min(1).optional(),
    notes: z.string().min(1).optional()
  })
  .strict();

const executionSchema = z
  .object({
    dryRun: z.boolean().optional(),
    partitionBatchSize: z.number().int().min(1).max(50).optional(),
    archiveDirectory: z.string().min(1).trim().optional(),
    continueOnPartitionFailure: z.boolean().optional()
  })
  .strict()
  .default({});

const validationSchema = z
  .object({
    requireConsistentSchema: z.boolean().optional(),
    allowManifestsWithoutSchemaVersion: z.boolean().optional(),
    maxPartitions: z.number().int().min(1).optional()
  })
  .strict()
  .default({});

const manifestSchema = z
  .object({
    version: z.number().int().min(1),
    dataset: z.string().min(1).trim(),
    baseline: baselineSchema,
    targetSchema: z
      .object({
        fields: z.array(fieldDefinitionSchema).min(1)
      })
      .strict(),
    operations: z
      .array(z.union([renameOperationSchema, transformOperationSchema, dropOperationSchema]))
      .max(100),
    governance: governanceSchema,
    execution: executionSchema,
    validation: validationSchema
  })
  .strict();

export async function loadSchemaMigrationManifest(filePath: string): Promise<SchemaMigrationManifest> {
  const resolvedPath = path.resolve(filePath);
  const contents = await readFile(resolvedPath, 'utf8');
  return parseSchemaMigrationManifest(contents, resolvedPath);
}

export function parseSchemaMigrationManifest(source: string, origin = 'inline'): SchemaMigrationManifest {
  const payload = parseDocument(source);
  const parsed = manifestSchema.parse(payload);

  const execution = {
    dryRun: parsed.execution.dryRun ?? false,
    partitionBatchSize: parsed.execution.partitionBatchSize ?? 1,
    archiveDirectory: parsed.execution.archiveDirectory ?? null,
    continueOnPartitionFailure: parsed.execution.continueOnPartitionFailure ?? false
  } satisfies ExecutionOptions;

  const validation = {
    requireConsistentSchema: parsed.validation.requireConsistentSchema ?? true,
    allowManifestsWithoutSchemaVersion: parsed.validation.allowManifestsWithoutSchemaVersion ?? false,
    maxPartitions: parsed.validation.maxPartitions ?? null
  } satisfies ValidationOptions;

  const operations = normalizeOperations(parsed.operations);
  const fields = dedupeFields(parsed.targetSchema.fields, origin);

  return {
    version: parsed.version,
    dataset: parsed.dataset,
    baseline: parsed.baseline ?? null,
    targetSchema: {
      fields
    },
    operations,
    governance: parsed.governance,
    execution,
    validation
  } satisfies SchemaMigrationManifest;
}

function parseDocument(source: string): unknown {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('schema migration manifest is empty');
  }

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    try {
      const yamlResult = loadYaml(trimmed, { json: true, schema: undefined });
      return yamlResult ?? {};
    } catch (yamlErr) {
      const message =
        err instanceof Error
          ? err.message
          : 'failed to parse manifest as JSON';
      const yamlMessage =
        yamlErr instanceof Error
          ? yamlErr.message
          : 'failed to parse manifest as YAML';
      throw new Error(
        `Unable to parse schema migration manifest. JSON error: ${message}. YAML error: ${yamlMessage}.`
      );
    }
  }
}

function normalizeOperations(entries: Array<z.infer<typeof manifestSchema>['operations'][number]>): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case 'rename':
        operations.push({
          kind: 'rename',
          from: entry.from,
          to: entry.to,
          transform: entry.transform,
          description: entry.description
        });
        break;
      case 'transform':
        operations.push({
          kind: 'transform',
          column: entry.column,
          expression: entry.expression,
          description: entry.description
        });
        break;
      case 'drop': {
        const archiveConfig = normalizeDropArchive(entry.archive);
        operations.push({
          kind: 'drop',
          column: entry.column,
          description: entry.description,
          archive: archiveConfig
        });
        break;
      }
      default:
        throw new Error(`Unsupported operation kind ${(entry as { kind?: string }).kind ?? 'unknown'}`);
    }
  }
  return operations;
}

function normalizeDropArchive(value: z.infer<typeof dropArchiveSchema>): DropArchiveConfig | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? { enabled: true, format: 'jsonl', directoryOverride: null } : null;
  }
  if (!value) {
    return null;
  }
  const enabled = value.enabled ?? true;
  if (!enabled) {
    return null;
  }
  return {
    enabled: true,
    format: value.format ?? 'jsonl',
    directoryOverride: value.directory ?? null
  } satisfies DropArchiveConfig;
}

function dedupeFields(fields: FieldDefinition[], origin: string): FieldDefinition[] {
  const seen = new Set<string>();
  const result: FieldDefinition[] = [];
  for (const field of fields) {
    const key = field.name.trim();
    if (seen.has(key)) {
      throw new Error(`Duplicate field '${field.name}' in target schema (${origin})`);
    }
    seen.add(key);
    result.push({
      name: key,
      type: field.type
    });
  }
  return result;
}
