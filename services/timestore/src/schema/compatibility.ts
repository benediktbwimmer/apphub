import type { FieldDefinition, FieldType } from '../storage';

export type SchemaCompatibilityStatus = 'identical' | 'additive' | 'breaking';

export interface SchemaMigrationPlan {
  kind: 'manual' | 'assisted';
  reason: string;
  summary: string;
  affectedColumns: string[];
  recommendedSteps: string[];
}

export interface SchemaCompatibilityResult {
  status: SchemaCompatibilityStatus;
  addedFields: FieldDefinition[];
  removedFields: FieldDefinition[];
  breakingReasons: string[];
  migrationPlan?: SchemaMigrationPlan;
}

const FIELD_TYPE_SET = new Set<FieldType>(['timestamp', 'string', 'double', 'integer', 'boolean']);

export function analyzeSchemaCompatibility(
  previousFields: FieldDefinition[],
  nextFields: FieldDefinition[]
): SchemaCompatibilityResult {
  const previousMap = buildFieldMap(previousFields);
  const nextMap = buildFieldMap(nextFields);

  const addedFields: FieldDefinition[] = [];
  const removedFields: FieldDefinition[] = [];
  const breakingReasons: string[] = [];

  for (const [name, prevField] of previousMap) {
    const nextField = nextMap.get(name);
    if (!nextField) {
      removedFields.push(prevField);
      breakingReasons.push(`column '${name}' was removed`);
      continue;
    }
    if (nextField.type !== prevField.type) {
      breakingReasons.push(
        `column '${name}' changed type from '${prevField.type}' to '${nextField.type}'`
      );
    }
  }

  for (const [name, field] of nextMap) {
    if (!previousMap.has(name)) {
      addedFields.push(field);
    }
  }

  if (breakingReasons.length > 0 || removedFields.length > 0) {
    return {
      status: 'breaking',
      addedFields,
      removedFields,
      breakingReasons,
      migrationPlan: buildDefaultMigrationPlan({ breakingReasons, removedFields, addedFields })
    } satisfies SchemaCompatibilityResult;
  }

  if (addedFields.length > 0) {
    return {
      status: 'additive',
      addedFields,
      removedFields: [],
      breakingReasons: []
    } satisfies SchemaCompatibilityResult;
  }

  return {
    status: 'identical',
    addedFields: [],
    removedFields: [],
    breakingReasons: []
  } satisfies SchemaCompatibilityResult;
}

export function extractFieldDefinitions(payload: unknown): FieldDefinition[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const rawFields = (payload as Record<string, unknown>).fields;
  if (!Array.isArray(rawFields)) {
    return [];
  }
  const normalized: FieldDefinition[] = [];
  for (const entry of rawFields) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const nameRaw = (entry as Record<string, unknown>).name;
    const typeRaw = (entry as Record<string, unknown>).type;
    if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
      continue;
    }
    if (typeof typeRaw !== 'string') {
      continue;
    }
    const type = typeRaw.trim() as FieldType;
    if (!FIELD_TYPE_SET.has(type)) {
      continue;
    }
    normalized.push({
      name: nameRaw.trim(),
      type
    });
  }
  return normalized;
}

export function normalizeFieldDefinitions(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.map((field) => ({
    name: field.name.trim(),
    type: field.type
  } satisfies FieldDefinition));
}

export function mergeFieldDefinitionsSuperset(versions: FieldDefinition[][]): FieldDefinition[] {
  const seen = new Set<string>();
  const merged: FieldDefinition[] = [];
  for (const version of versions) {
    for (const field of version) {
      const key = field.name;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(field);
    }
  }
  return merged;
}

function buildFieldMap(fields: FieldDefinition[]): Map<string, FieldDefinition> {
  const map = new Map<string, FieldDefinition>();
  for (const field of fields) {
    map.set(field.name, field);
  }
  return map;
}

interface MigrationPlanInput {
  breakingReasons: string[];
  removedFields: FieldDefinition[];
  addedFields: FieldDefinition[];
}

function buildDefaultMigrationPlan(input: MigrationPlanInput): SchemaMigrationPlan {
  const affectedColumns = new Set<string>();
  for (const field of input.removedFields) {
    affectedColumns.add(field.name);
  }
  for (const reason of input.breakingReasons) {
    const match = reason.match(/column '([^']+)'/);
    if (match) {
      affectedColumns.add(match[1] ?? reason);
    }
  }

  return {
    kind: 'manual',
    reason: 'schema migration required',
    summary: 'Incompatible schema changes detected; create a new manifest or migrate existing partitions.',
    affectedColumns: Array.from(affectedColumns),
    recommendedSteps: [
      'Pause ingestion for the dataset to avoid partial writes.',
      'Create a new manifest with the desired schema or rewrite existing partitions.',
      'Run validation queries to confirm readers observe the expected schema.',
      'Resume ingestion once migration is complete.'
    ]
  } satisfies SchemaMigrationPlan;
}

