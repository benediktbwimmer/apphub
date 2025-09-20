import path from 'node:path';
import { z } from 'zod';
import { type JsonValue } from './db';

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

export const manifestEntrySchema = z
  .object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.string().min(1),
    baseUrl: z.string().min(1),
    capabilities: jsonValueSchema.optional(),
    metadata: jsonValueSchema.optional(),
    healthEndpoint: z.string().optional(),
    openapiPath: z.string().optional(),
    devCommand: z.string().optional(),
    workingDir: z.string().optional()
  })
  .strict();

export const manifestFileSchema = z.union([
  z.object({ services: z.array(manifestEntrySchema) }).strict(),
  z.array(manifestEntrySchema)
]);

export type ManifestEntryInput = z.infer<typeof manifestEntrySchema>;

export type ManifestFileInput = z.infer<typeof manifestFileSchema>;

export type ManifestLoadError = {
  source: string;
  error: Error;
};

export function joinSourceLabel(base: string, child?: string) {
  if (!child) {
    return base;
  }
  if (!base) {
    return child;
  }
  const normalized = child.startsWith('.') || child.startsWith('..') ? child : path.normalize(child);
  return `${base}:${normalized}`;
}
