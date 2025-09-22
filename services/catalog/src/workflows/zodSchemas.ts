import { z } from 'zod';

export type WorkflowJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

export const jsonValueSchema: z.ZodType<WorkflowJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

export const jsonObjectSchema = z.record(jsonValueSchema);

export const jobRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).optional(),
    strategy: z.enum(['none', 'fixed', 'exponential']).optional(),
    initialDelayMs: z.number().int().min(0).max(86_400_000).optional(),
    maxDelayMs: z.number().int().min(0).max(86_400_000).optional(),
    jitter: z.enum(['none', 'full', 'equal']).optional()
  })
  .strict();

export const jobDefinitionCreateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1),
    version: z.number().int().min(1).optional(),
    type: z.enum(['batch', 'service-triggered', 'manual']),
    runtime: z.enum(['node', 'python']).default('node'),
    entryPoint: z.string().min(1),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    outputSchema: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

export const jobDefinitionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.number().int().min(1).optional(),
    type: z.enum(['batch', 'service-triggered', 'manual']).optional(),
    runtime: z.enum(['node', 'python']).optional(),
    entryPoint: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    outputSchema: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.nullable().optional()
  })
  .strict()
  .refine((payload: Record<string, unknown>) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided'
  });

const serviceSecretSchema = z.object({
  source: z.enum(['env', 'store']),
  key: z.string().min(1),
  version: z.string().min(1).optional()
});

const serviceHeaderValueSchema = z.union([
  z.string().min(1),
  z
    .object({
      secret: serviceSecretSchema,
      prefix: z.string().min(1).optional()
    })
    .strict()
]);

export const workflowTriggerSchema = z
  .object({
    type: z.string().min(1),
    options: jsonValueSchema.optional()
  })
  .strict();

export const workflowServiceRequestSchema = z
  .object({
    path: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
    headers: z.record(serviceHeaderValueSchema).optional(),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: jsonValueSchema.nullable().optional()
  })
  .strict();

export const workflowJobStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('job').optional(),
    jobSlug: z.string().min(1),
    description: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).max(25).optional(),
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    storeResultAs: z.string().min(1).max(200).optional()
  })
  .strict();

export const workflowServiceStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('service'),
    serviceSlug: z.string().min(1),
    description: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).max(25).optional(),
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    requireHealthy: z.boolean().optional(),
    allowDegraded: z.boolean().optional(),
    captureResponse: z.boolean().optional(),
    storeResponseAs: z.string().min(1).max(200).optional(),
    request: workflowServiceRequestSchema
  })
  .strict();

export const workflowFanOutTemplateSchema = z.union([workflowJobStepSchema, workflowServiceStepSchema]);

export const workflowFanOutStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('fanout'),
    description: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).max(25).optional(),
    collection: jsonValueSchema,
    template: workflowFanOutTemplateSchema,
    maxItems: z.number().int().min(1).max(10_000).optional(),
    maxConcurrency: z.number().int().min(1).max(1_000).optional(),
    storeResultsAs: z.string().min(1).max(200).optional()
  })
  .strict();

export const workflowStepSchema = z.union([
  workflowJobStepSchema,
  workflowServiceStepSchema,
  workflowFanOutStepSchema
]);

export const workflowDefinitionCreateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1),
    version: z.number().int().min(1).optional(),
    description: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).min(1).max(100),
    triggers: z.array(workflowTriggerSchema).optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonValueSchema.optional(),
    outputSchema: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

export const workflowDefinitionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.number().int().min(1).optional(),
    description: z.string().min(1).nullable().optional(),
    steps: z.array(workflowStepSchema).min(1).max(100).optional(),
    triggers: z.array(workflowTriggerSchema).optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonValueSchema.optional(),
    outputSchema: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.nullable().optional()
  })
  .strict()
  .refine((payload: Record<string, unknown>) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided'
  });

export type WorkflowDefinitionCreateInput = z.infer<typeof workflowDefinitionCreateSchema>;
export type WorkflowDefinitionUpdateInput = z.infer<typeof workflowDefinitionUpdateSchema>;
export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;
export type WorkflowFanOutTemplateInput = z.infer<typeof workflowFanOutTemplateSchema>;
export type WorkflowFanOutStepInput = z.infer<typeof workflowFanOutStepSchema>;
export type WorkflowTriggerInput = z.infer<typeof workflowTriggerSchema>;
export type JobDefinitionCreateInput = z.infer<typeof jobDefinitionCreateSchema>;
export const aiBundleFileSchema = z
  .object({
    path: z.string().min(1),
    contents: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    executable: z.boolean().optional()
  })
  .strict();

export const aiBundleSuggestionSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
    version: z.string().min(1),
    entryPoint: z.string().min(1),
    manifest: jsonObjectSchema,
    manifestPath: z.string().min(1).optional(),
    capabilityFlags: z.array(z.string().min(1)).optional(),
    metadata: jsonValueSchema.nullable().optional(),
    description: z.string().min(1).nullable().optional(),
    displayName: z.string().min(1).nullable().optional(),
    files: z.array(aiBundleFileSchema).min(1)
  })
  .strict();

export const aiJobWithBundleOutputSchema = z
  .object({
    job: jobDefinitionCreateSchema,
    bundle: aiBundleSuggestionSchema
  })
  .strict();

export type AiBundleFile = z.infer<typeof aiBundleFileSchema>;
export type AiBundleSuggestion = z.infer<typeof aiBundleSuggestionSchema>;
export type AiJobWithBundleOutput = z.infer<typeof aiJobWithBundleOutputSchema>;
export type JobDefinitionUpdateInput = z.infer<typeof jobDefinitionUpdateSchema>;
