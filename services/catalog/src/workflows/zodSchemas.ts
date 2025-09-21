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
    entryPoint: z.string().min(1),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

export const jobDefinitionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.number().int().min(1).optional(),
    type: z.enum(['batch', 'service-triggered', 'manual']).optional(),
    entryPoint: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.nullable().optional()
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
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
    metadata: jsonValueSchema.nullable().optional()
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided'
  });

export type WorkflowDefinitionCreateInput = z.infer<typeof workflowDefinitionCreateSchema>;
export type WorkflowDefinitionUpdateInput = z.infer<typeof workflowDefinitionUpdateSchema>;
export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;
export type WorkflowFanOutTemplateInput = z.infer<typeof workflowFanOutTemplateSchema>;
export type WorkflowFanOutStepInput = z.infer<typeof workflowFanOutStepSchema>;
export type WorkflowTriggerInput = z.infer<typeof workflowTriggerSchema>;
export type JobDefinitionCreateInput = z.infer<typeof jobDefinitionCreateSchema>;
export type JobDefinitionUpdateInput = z.infer<typeof jobDefinitionUpdateSchema>;
