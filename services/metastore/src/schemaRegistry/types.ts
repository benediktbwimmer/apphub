export type SchemaFieldDefinition = {
  path: string;
  type: string;
  description?: string;
  required?: boolean;
  repeated?: boolean;
  constraints?: Record<string, unknown>;
  hints?: Record<string, unknown>;
  examples?: unknown[];
  metadata?: Record<string, unknown>;
};

export type SchemaDefinition = {
  schemaHash: string;
  name?: string;
  description?: string;
  version?: string | number;
  fields: SchemaFieldDefinition[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SchemaDefinitionInput = {
  schemaHash: string;
  name?: string;
  description?: string;
  version?: string | number;
  fields: SchemaFieldDefinition[];
  metadata?: Record<string, unknown>;
};

type SchemaCacheMetadata = {
  source: 'database' | 'cache';
};

export type SchemaFetchResult =
  | ({ status: 'found'; definition: SchemaDefinition } & SchemaCacheMetadata)
  | ({ status: 'missing' } & SchemaCacheMetadata);

export type SchemaRegistryConfig = {
  ttlMs: number;
  refreshAheadMs: number;
  refreshIntervalMs: number;
  negativeTtlMs: number;
};
