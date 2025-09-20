import path from 'node:path';
import { z } from 'zod';
import { type JsonValue } from './db/index';

const manifestEnvReferenceSchema = z
  .object({
    service: z.string().min(1),
    property: z.enum(['instanceUrl', 'baseUrl', 'host', 'port']),
    fallback: z.string().optional()
  })
  .strict();

export const manifestEnvVarSchema = z
  .object({
    key: z.string().min(1),
    value: z.string().optional(),
    fromService: manifestEnvReferenceSchema.optional()
  })
  .strict()
  .refine((entry) => entry.value !== undefined || entry.fromService !== undefined, {
    message: 'env entry must define either value or fromService'
  });

export const manifestTagSchema = z
  .object({
    key: z.string().min(1),
    value: z.string().min(1)
  })
  .strict();

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
    workingDir: z.string().optional(),
    env: z.array(manifestEnvVarSchema).optional()
  })
  .strict();

const manifestNetworkAppSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    repoUrl: z.string().min(1),
    dockerfilePath: z.string().min(1),
    tags: z.array(manifestTagSchema).optional(),
    launchEnv: z.array(manifestEnvVarSchema).optional(),
    launchCommand: z.string().optional()
  })
  .strict();

const manifestNetworkServiceSchema = z
  .object({
    serviceSlug: z.string().min(1),
    app: manifestNetworkAppSchema,
    launchOrder: z.number().int().min(0).optional(),
    waitForBuild: z.boolean().optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
    env: z.array(manifestEnvVarSchema).optional()
  })
  .strict();

export const serviceNetworkSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    repoUrl: z.string().min(1),
    dockerfilePath: z.string().min(1),
    tags: z.array(manifestTagSchema).optional(),
    env: z.array(manifestEnvVarSchema).optional(),
    services: z.array(manifestNetworkServiceSchema).min(1),
    launchOrder: z.array(z.string().min(1)).optional()
  })
  .strict();

const manifestFileObjectSchema = z
  .object({
    services: z.array(manifestEntrySchema).optional(),
    networks: z.array(serviceNetworkSchema).optional()
  })
  .strict()
  .refine((value) =>
    (value.services?.length ?? 0) > 0 || (value.networks?.length ?? 0) > 0
  );

export const manifestFileSchema = z.union([
  manifestFileObjectSchema,
  z.array(manifestEntrySchema)
]);

export type ManifestEntryInput = z.infer<typeof manifestEntrySchema>;

export type ManifestFileInput = z.infer<typeof manifestFileSchema>;

export type ManifestEnvVarInput = z.infer<typeof manifestEnvVarSchema>;

export type ManifestServiceNetworkInput = z.infer<typeof serviceNetworkSchema>;

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
