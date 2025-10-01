import { z } from 'zod';
import { jsonValueSchema } from '../serviceManifestTypes';

const templateStringSchema = z.string().min(1, 'template string must not be empty');

const templateStringArraySchema = z
  .array(templateStringSchema)
  .min(1, 'provide at least one entry for this action');

const placeholderAssignmentSchema = z
  .record(z.string().min(1), templateStringSchema)
  .refine((value) => Object.keys(value).length > 0, 'placeholder assignments require at least one entry');

export const bootstrapActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ensureDirectories'),
      directories: templateStringArraySchema,
      description: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('ensureFilestoreBackend'),
      mountKey: templateStringSchema,
      backend: z
        .object({
          kind: z.literal('local'),
          rootPath: templateStringSchema
        })
        .strict()
        .optional(),
      accessMode: z.enum(['ro', 'rw']).optional(),
      state: z.enum(['active', 'inactive']).optional(),
      displayName: templateStringSchema.optional(),
      summary: templateStringSchema.optional(),
      contact: templateStringSchema.optional(),
      labels: templateStringArraySchema.optional(),
      stateReason: templateStringSchema.optional(),
      config: jsonValueSchema.optional(),
      connection: z
        .object({
          connectionString: templateStringSchema.optional(),
          schema: templateStringSchema.optional()
        })
        .strict()
        .optional(),
      assign: z
        .object({
          placeholders: placeholderAssignmentSchema.optional(),
          variables: placeholderAssignmentSchema.optional()
        })
        .strict()
        .optional(),
      description: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('writeJsonFile'),
      path: templateStringSchema,
      content: jsonValueSchema,
      createParents: z.boolean().optional(),
      pretty: z.boolean().optional(),
      description: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('applyWorkflowDefaults'),
      workflows: z
        .array(
          z
            .object({
              slug: z.string().min(1),
              defaults: jsonValueSchema.optional(),
              strategy: z.enum(['merge', 'replace']).optional(),
              description: z.string().optional()
            })
            .strict()
        )
        .min(1, 'provide at least one workflow default'),
      description: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('setEnvDefaults'),
      values: placeholderAssignmentSchema,
      description: z.string().optional()
    })
    .strict()
]);

export const bootstrapPlanSchema = z
  .object({
    actions: z.array(bootstrapActionSchema).default([])
  })
  .strict();

export type BootstrapActionSpec = z.infer<typeof bootstrapActionSchema>;
export type BootstrapPlanSpec = z.infer<typeof bootstrapPlanSchema>;
