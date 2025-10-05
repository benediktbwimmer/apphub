/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SchemaFieldDefinition } from './SchemaFieldDefinition';
export type SchemaDefinitionInput = {
  schemaHash: string;
  name?: string | null;
  description?: string | null;
  version?: (string | number) | null;
  metadata?: Record<string, any> | null;
  fields: Array<SchemaFieldDefinition>;
};

