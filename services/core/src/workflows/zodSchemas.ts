import { parseCronExpression, type ParserOptions } from './cronParser';
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

const assetFreshnessSchema = z
  .object({
    maxAgeMs: z.number().int().min(1).max(31_536_000_000).optional(),
    ttlMs: z.number().int().min(1).max(31_536_000_000).optional(),
    cadenceMs: z.number().int().min(1).max(31_536_000_000).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Freshness must specify at least one field'
  });

const assetAutoMaterializeSchema = z
  .object({
    onUpstreamUpdate: z.boolean().optional(),
    priority: z.number().int().min(0).max(1_000_000).optional(),
    parameterDefaults: jsonValueSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'autoMaterialize must specify at least one field'
  });
const assetStaticPartitionSchema = z
  .object({
    type: z.literal('static'),
    keys: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(500)
  })
  .strict();

const assetTimePartitionSchema = z
  .object({
    type: z.literal('timeWindow'),
    granularity: z.enum(['minute', 'hour', 'day', 'week', 'month']),
    timezone: z.string().min(1).max(100).optional(),
    format: z.string().min(1).max(100).optional(),
    lookbackWindows: z.number().int().min(1).max(10_000).optional()
  })
  .strict();

const assetDynamicPartitionSchema = z
  .object({
    type: z.literal('dynamic'),
    maxKeys: z.number().int().min(1).max(100_000).optional(),
    retentionDays: z.number().int().min(1).max(10_000).optional()
  })
  .strict();

const assetPartitioningSchema = z.union([
  assetStaticPartitionSchema,
  assetTimePartitionSchema,
  assetDynamicPartitionSchema
]);

const workflowAssetDeclarationSchema = z
  .object({
    assetId: z
      .string()
      .min(1)
      .max(200)
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
        'Asset ID must start with an alphanumeric character and may include dot, underscore, colon, or dash'
      ),
    schema: jsonObjectSchema.optional(),
    freshness: assetFreshnessSchema.optional(),
    autoMaterialize: assetAutoMaterializeSchema.optional(),
    partitioning: assetPartitioningSchema.optional()
  })
  .strict();

export const workflowAssetPartitionParametersSchema = z
  .object({
    partitionKey: z.string().min(1).max(200).optional().nullable(),
    parameters: jsonValueSchema
  })
  .strict();

export const jobRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).optional(),
    strategy: z.enum(['none', 'fixed', 'exponential']).optional(),
    initialDelayMs: z.number().int().min(0).max(86_400_000).optional(),
    maxDelayMs: z.number().int().min(0).max(86_400_000).optional(),
    jitter: z.enum(['none', 'full', 'equal']).optional()
  })
  .strict();

const moduleTargetBindingSchema = z
  .object({
    moduleId: z.string().min(1),
    moduleVersion: z.string().min(1),
    moduleArtifactId: z.string().min(1).nullable().optional(),
    targetName: z.string().min(1),
    targetVersion: z.string().min(1),
    targetFingerprint: z.string().min(1).nullable().optional()
  })
  .strict()
  .transform((value) => ({
    moduleId: value.moduleId,
    moduleVersion: value.moduleVersion,
    moduleArtifactId: value.moduleArtifactId ?? null,
    targetName: value.targetName,
    targetVersion: value.targetVersion,
    targetFingerprint: value.targetFingerprint ?? null
  }));

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
    runtime: z.enum(['node', 'python', 'docker', 'module']).default('node'),
    entryPoint: z.string().min(1),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    outputSchema: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.optional(),
    moduleBinding: moduleTargetBindingSchema.optional()
  })
  .strict();

export const jobDefinitionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.number().int().min(1).optional(),
    type: z.enum(['batch', 'service-triggered', 'manual']).optional(),
    runtime: z.enum(['node', 'python', 'docker', 'module']).optional(),
    entryPoint: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    outputSchema: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.nullable().optional(),
    moduleBinding: moduleTargetBindingSchema.nullable().optional()
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

const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .or(
    z
      .string()
      .refine((value) => {
        const parsed = new Date(value);
        return !Number.isNaN(parsed.getTime());
      }, 'Invalid ISO timestamp')
  );

function isValidCronExpression(expression: string, options: ParserOptions = {}) {
  try {
    parseCronExpression(expression, {
      ...options,
      currentDate: new Date()
    });
    return true;
  } catch {
    return false;
  }
}

const workflowTriggerScheduleSchema = z
  .object({
    cron: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => isValidCronExpression(value.trim()), 'Invalid cron expression'),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .refine(
        (value) => {
          if (!value) {
            return true;
          }
          return isValidCronExpression('* * * * *', { tz: value.trim() });
        },
        { message: 'Invalid timezone identifier' }
      ),
    startWindow: isoDateTimeSchema.optional(),
    endWindow: isoDateTimeSchema.optional(),
    catchUp: z.boolean().optional()
  })
  .strict()
  .refine((value) => {
    if (!value.startWindow || !value.endWindow) {
      return true;
    }
    const start = new Date(value.startWindow);
    const end = new Date(value.endWindow);
    return start.getTime() <= end.getTime();
  }, 'startWindow must be before endWindow');

export const workflowTriggerSchema = z
  .object({
    type: z.string().min(1),
    options: jsonValueSchema.optional(),
    schedule: workflowTriggerScheduleSchema.optional()
  })
  .strict()
  .refine(
    (payload) => {
      if (payload.type.trim().toLowerCase() !== 'schedule') {
        return true;
      }
      return Boolean(payload.schedule);
    },
    { message: 'Schedule triggers require schedule configuration' }
  );

const workflowScheduleParametersSchema = jsonValueSchema.refine(
  (value) => value === null || (typeof value === 'object' && !Array.isArray(value)),
  { message: 'Parameters must be a JSON object' }
);

const workflowScheduleTimingBase = z
  .object({
    cron: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => isValidCronExpression(value.trim()), 'Invalid cron expression'),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .nullable()
      .refine(
        (value) => {
          if (!value) {
            return true;
          }
          return isValidCronExpression('* * * * *', { tz: value.trim() });
        },
        { message: 'Invalid timezone identifier' }
      ),
    startWindow: isoDateTimeSchema.optional().nullable(),
    endWindow: isoDateTimeSchema.optional().nullable(),
    catchUp: z.boolean().optional()
  })
  .strict();

export const workflowScheduleCreateSchema = workflowScheduleTimingBase
  .extend({
    name: z.string().min(1).max(100).optional(),
    description: z.string().min(1).max(500).optional(),
    parameters: workflowScheduleParametersSchema.optional(),
    isActive: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    const { startWindow, endWindow } = value;
    if (!startWindow || !endWindow) {
      return;
    }
    const startDate = new Date(startWindow);
    const endDate = new Date(endWindow);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return;
    }
    if (startDate.getTime() > endDate.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startWindow must be before endWindow' });
    }
  });

export const workflowScheduleUpdateSchema = workflowScheduleTimingBase
  .partial()
  .extend({
    name: z.union([z.string().min(1).max(100), z.literal(null)]).optional(),
    description: z.union([z.string().min(1).max(500), z.literal(null)]).optional(),
    parameters: workflowScheduleParametersSchema.optional(),
    isActive: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value as Record<string, unknown>).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided'
      });
      return;
    }
    const { startWindow, endWindow } = value;
    if (!startWindow || !endWindow) {
      return;
    }
    const startDate = new Date(startWindow);
    const endDate = new Date(endWindow);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return;
    }
    if (startDate.getTime() > endDate.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startWindow must be before endWindow' });
    }
  });

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
    type: z.literal('job').default('job'),
    jobSlug: z.string().min(1),
    description: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).max(25).optional(),
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    storeResultAs: z.string().min(1).max(200).optional(),
    produces: z.array(workflowAssetDeclarationSchema).max(50).optional(),
    consumes: z.array(workflowAssetDeclarationSchema).max(50).optional(),
    bundle: z
      .object({
        slug: z.string().min(1),
        version: z.string().min(1).optional(),
        exportName: z.string().min(1).optional(),
        strategy: z.enum(['pinned', 'latest']).optional()
      })
      .strict()
      .refine((value) => value.strategy === 'latest' || (typeof value.version === 'string' && value.version.trim().length > 0), {
        message: 'Bundle version is required when strategy is pinned',
        path: ['version']
      })
      .optional()
      .nullable()
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
    request: workflowServiceRequestSchema,
    produces: z.array(workflowAssetDeclarationSchema).max(50).optional(),
    consumes: z.array(workflowAssetDeclarationSchema).max(50).optional()
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
    storeResultsAs: z.string().min(1).max(200).optional(),
    produces: z.array(workflowAssetDeclarationSchema).max(50).optional(),
    consumes: z.array(workflowAssetDeclarationSchema).max(50).optional()
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
export type WorkflowAssetFreshnessInput = z.infer<typeof assetFreshnessSchema>;
export type WorkflowAssetDeclarationInput = z.infer<typeof workflowAssetDeclarationSchema>;
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

export const aiWorkflowExistingJobDependencySchema = z
  .object({
    kind: z.literal('existing-job'),
    jobSlug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Job slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2_000).optional(),
    rationale: z.string().min(1).max(2_000).optional()
  })
  .strict();

export const aiWorkflowNewJobDependencySchema = z
  .object({
    kind: z.literal('job'),
    jobSlug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Job slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1).max(200),
    summary: z.string().min(1).max(2_000).optional(),
    prompt: z.string().min(1).max(4_000),
    rationale: z.string().min(1).max(2_000).optional(),
    dependsOn: z.array(z.string().min(1).max(200)).max(10).optional()
  })
  .strict();

export const aiWorkflowJobWithBundleDependencySchema = z
  .object({
    kind: z.literal('job-with-bundle'),
    jobSlug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Job slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1).max(200),
    summary: z.string().min(1).max(2_000).optional(),
    prompt: z.string().min(1).max(4_000),
    rationale: z.string().min(1).max(2_000).optional(),
    bundleOutline: z
      .object({
        entryPoint: z.string().min(1).max(200),
        files: z
          .array(
            z
              .object({
                path: z.string().min(1).max(200),
                description: z.string().min(1).max(2_000).optional()
              })
              .strict()
          )
          .min(1)
          .max(50)
          .optional(),
        capabilities: z.array(z.string().min(1)).min(1).optional(),
        manifestNotes: z.string().min(1).max(2_000).optional()
      })
      .strict()
      .optional(),
    dependsOn: z.array(z.string().min(1).max(200)).max(10).optional()
  })
  .strict();

export const aiWorkflowDependencySchema = z.union([
  aiWorkflowExistingJobDependencySchema,
  aiWorkflowNewJobDependencySchema,
  aiWorkflowJobWithBundleDependencySchema
]);

export const aiWorkflowWithJobsOutputSchema = z
  .object({
    workflow: workflowDefinitionCreateSchema,
    dependencies: z.array(aiWorkflowDependencySchema).optional().default([]),
    notes: z.string().min(1).max(5_000).optional()
  })
  .strict();

export type AiBundleFile = z.infer<typeof aiBundleFileSchema>;
export type AiBundleSuggestion = z.infer<typeof aiBundleSuggestionSchema>;
export type AiJobWithBundleOutput = z.infer<typeof aiJobWithBundleOutputSchema>;
export type AiWorkflowExistingJobDependency = z.infer<typeof aiWorkflowExistingJobDependencySchema>;
export type AiWorkflowNewJobDependency = z.infer<typeof aiWorkflowNewJobDependencySchema>;
export type AiWorkflowJobWithBundleDependency = z.infer<typeof aiWorkflowJobWithBundleDependencySchema>;
export type AiWorkflowDependency = z.infer<typeof aiWorkflowDependencySchema>;
export type AiWorkflowWithJobsOutput = z.infer<typeof aiWorkflowWithJobsOutputSchema>;
export type JobDefinitionUpdateInput = z.infer<typeof jobDefinitionUpdateSchema>;
