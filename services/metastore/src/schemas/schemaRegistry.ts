import { z } from 'zod';
import { schemaHashSchema } from './records';

const schemaFieldConstraintsSchema = z.record(z.unknown()).optional();
const schemaFieldHintsSchema = z.record(z.unknown()).optional();
const schemaFieldMetadataSchema = z.record(z.unknown()).optional();

const schemaFieldDefinitionSchema = z
  .object({
    path: z.string().min(1, 'Field path is required'),
    type: z.string().min(1, 'Field type is required'),
    description: z.string().trim().min(1).max(2048).optional(),
    required: z.boolean().optional(),
    repeated: z.boolean().optional(),
    constraints: schemaFieldConstraintsSchema,
    hints: schemaFieldHintsSchema,
    examples: z.array(z.unknown()).optional(),
    metadata: schemaFieldMetadataSchema
  })
  .strict();

const schemaDefinitionDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    description: z.string().trim().min(1).max(4096).optional(),
    version: z.union([z.string().trim().min(1).max(128), z.number()]).optional(),
    fields: z.array(schemaFieldDefinitionSchema).min(1, 'Schema must include at least one field definition'),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

const schemaHashRequiredSchema = schemaHashSchema.refine(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
  {
    message: 'schemaHash is required'
  }
);

export const schemaDefinitionSchema = schemaDefinitionDocumentSchema.extend({
  schemaHash: schemaHashRequiredSchema
});

export type SchemaFieldDefinitionPayload = z.infer<typeof schemaFieldDefinitionSchema>;
export type SchemaDefinitionDocument = z.infer<typeof schemaDefinitionDocumentSchema>;
export type SchemaDefinitionPayload = z.infer<typeof schemaDefinitionSchema>;

export function parseSchemaDefinitionPayload(payload: unknown): SchemaDefinitionPayload {
  return schemaDefinitionSchema.parse(payload);
}

export function parseSchemaDefinitionDocument(document: unknown): SchemaDefinitionDocument {
  return schemaDefinitionDocumentSchema.parse(document);
}

export function parseSchemaFieldDefinitionPayload(payload: unknown): SchemaFieldDefinitionPayload {
  return schemaFieldDefinitionSchema.parse(payload);
}
