import { z } from 'zod';

const manifestReferenceSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(['services', 'networks', 'bundle', 'workflow']).optional(),
    description: z.string().optional()
  })
  .strict();

const importSchema = z
  .object({
    module: z.string().min(1),
    repo: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    configPath: z.string().min(1).optional(),
    variables: z.record(z.string().min(1), z.string()).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasRepo = typeof value.repo === 'string' && value.repo.trim().length > 0;
    const hasPath = typeof value.path === 'string' && value.path.trim().length > 0;
    if (hasRepo === hasPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of "repo" or "path" when importing descriptors.'
      });
    }
  });

export const moduleConfigDescriptorSchema = z
  .object({
    module: z.string().min(1),
    manifests: z.array(manifestReferenceSchema).optional(),
    imports: z.array(importSchema).optional()
  })
  .passthrough();

export type ModuleConfigDescriptor = z.infer<typeof moduleConfigDescriptorSchema>;
export type ModuleDescriptorImport = z.infer<typeof importSchema>;
export type ModuleDescriptorManifest = z.infer<typeof manifestReferenceSchema>;
