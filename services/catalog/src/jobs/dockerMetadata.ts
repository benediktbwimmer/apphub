import { z } from 'zod';

import { evaluateDockerImagePolicy, getDockerRuntimeConfig } from '../config/dockerRuntime';

const MAX_PATH_LENGTH = 1024;
const MAX_RELATIVE_PATH_LENGTH = 512;
const MAX_ENV_VARS = 200;
const MAX_INPUTS = 100;
const MAX_OUTPUTS = 100;
const ABSOLUTE_PATH_REGEX = /^\//;

function isAbsolutePath(value: string): boolean {
  if (!ABSOLUTE_PATH_REGEX.test(value)) {
    return false;
  }
  if (value.includes('\\')) {
    return false;
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    if (segment === '.' || segment === '..') {
      return false;
    }
  }
  return true;
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/')) {
    return false;
  }
  if (value.includes('\\')) {
    return false;
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      return false;
    }
  }
  return true;
}

function isSafePathTemplate(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.includes('..')) {
    return false;
  }
  return true;
}

const secretReferenceSchema = z.union([
  z
    .object({
      source: z.literal('env'),
      key: z.string().min(1).max(256)
    })
    .strict(),
  z
    .object({
      source: z.literal('store'),
      key: z.string().min(1).max(256),
      version: z.string().min(1).max(128).optional()
    })
    .strict()
]);

const commandArraySchema = z
  .array(z.string().min(1).max(400))
  .max(128)
  .transform((items) => items.map((item) => item.trim()).filter((item) => item.length > 0))
  .refine((items) => items.length > 0, 'Command array must include at least one argument');

const absolutePathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => isAbsolutePath(value), {
    message: 'Path must be absolute, forward-slash separated, and must not contain . or .. segments'
  });

const relativeWorkspacePathSchema = z
  .string()
  .min(1)
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine((value) => isSafeRelativePath(value), {
    message: 'workspacePath must be a relative path without . or .. segments'
  });

const pathTemplateSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => isSafePathTemplate(value), {
    message: 'pathTemplate must not include .. segments'
  });

const dockerEnvVarSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Environment variable names must match [A-Za-z_][A-Za-z0-9_]*'),
    value: z.string().max(4096).optional(),
    secret: secretReferenceSchema.optional()
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (!entry.value && !entry.secret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Provide either a literal value or a secret reference'
      });
    }
    if (entry.secret && entry.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Secret environment variables must not include inline values'
      });
    }
  });

const dockerConfigFileSchema = z
  .object({
    filename: relativeWorkspacePathSchema,
    mountPath: absolutePathSchema.optional(),
    format: z.enum(['json', 'yaml', 'text', 'binary']).optional()
  })
  .strict();

const filestoreNodeSourceSchema = z
  .object({
    type: z.literal('filestoreNode'),
    nodeId: z.union([z.string().min(1).max(64), z.number({ coerce: true }).int().positive()])
  })
  .strict();

const filestorePathSourceSchema = z
  .object({
    type: z.literal('filestorePath'),
    backendMountId: z.number({ coerce: true }).int().positive(),
    path: absolutePathSchema
  })
  .strict();

const dockerInputSourceSchema = z.union([filestoreNodeSourceSchema, filestorePathSourceSchema]);

const dockerInputDescriptorSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    source: dockerInputSourceSchema,
    workspacePath: relativeWorkspacePathSchema,
    mountPath: absolutePathSchema.optional(),
    optional: z.boolean().optional(),
    writable: z.boolean().optional()
  })
  .strict();

const dockerOutputUploadSchema = z
  .object({
    backendMountId: z.number({ coerce: true }).int().positive(),
    pathTemplate: pathTemplateSchema,
    contentType: z.string().min(1).max(200).optional(),
    mode: z.enum(['file', 'directory']).optional(),
    overwrite: z.boolean().optional()
  })
  .strict();

const dockerOutputDescriptorSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    workspacePath: relativeWorkspacePathSchema,
    upload: dockerOutputUploadSchema,
    optional: z.boolean().optional()
  })
  .strict();

type DockerEnvVarInput = z.infer<typeof dockerEnvVarSchema>;
type DockerInputDescriptorInput = z.infer<typeof dockerInputDescriptorSchema>;
type DockerOutputDescriptorInput = z.infer<typeof dockerOutputDescriptorSchema>;

const dockerMetadataCoreSchema = z
  .object({
    image: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => value.trim().length > 0, {
        message: 'image is required'
      }),
    imagePullPolicy: z.enum(['always', 'ifNotPresent']).optional(),
    platform: z.string().min(1).max(80).optional(),
    entryPoint: commandArraySchema.optional(),
    command: commandArraySchema.optional(),
    args: commandArraySchema.optional(),
    workingDirectory: absolutePathSchema.optional(),
    workspaceMountPath: absolutePathSchema.optional(),
    networkMode: z.enum(['bridge', 'none']).optional(),
    requiresGpu: z.boolean().optional(),
    environment: z.array(dockerEnvVarSchema).max(MAX_ENV_VARS).optional(),
    configFile: dockerConfigFileSchema.optional(),
    inputs: z.array(dockerInputDescriptorSchema).max(MAX_INPUTS).optional(),
    outputs: z.array(dockerOutputDescriptorSchema).max(MAX_OUTPUTS).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const runtimeConfig = getDockerRuntimeConfig();
    const policyResult = evaluateDockerImagePolicy(value.image, runtimeConfig);
    if (!policyResult.allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['image'],
        message: policyResult.reason ?? 'Docker image is not permitted by policy'
      });
    }

    if (value.networkMode) {
      if (!runtimeConfig.network.allowedModes.has(value.networkMode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['networkMode'],
          message: `Network mode ${value.networkMode} is not permitted in this environment`
        });
      } else if (runtimeConfig.network.isolationEnabled && value.networkMode !== 'none') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['networkMode'],
          message: 'Network isolation is enforced; containers must run with network mode "none"'
        });
      } else if (!runtimeConfig.network.allowModeOverride && value.networkMode !== runtimeConfig.network.defaultMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['networkMode'],
          message: `Network mode overrides are disabled. Use ${runtimeConfig.network.defaultMode}`
        });
      }
    }

    if (value.requiresGpu && !runtimeConfig.gpuEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiresGpu'],
        message: 'GPU execution is not enabled in this environment'
      });
    }

    const environmentEntries = (value.environment ?? []) as DockerEnvVarInput[];
    const seenEnv = new Set<string>();
    environmentEntries.forEach((entry, index) => {
      const normalized = entry.name.toUpperCase();
      if (seenEnv.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['environment', index, 'name'],
          message: `Duplicate environment variable: ${entry.name}`
        });
        return;
      }
      seenEnv.add(normalized);
    });

    const inputEntries = (value.inputs ?? []) as DockerInputDescriptorInput[];
    const seenInputIds = new Set<string>();
    inputEntries.forEach((entry, index) => {
      if (entry.writable) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['inputs', index, 'writable'],
          message: 'Input mounts are read-only; set writable=false or omit the field'
        });
      }
      if (!entry.id) {
        return;
      }
      const normalized = entry.id.toLowerCase();
      if (seenInputIds.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['inputs', index, 'id'],
          message: `Duplicate input id: ${entry.id}`
        });
        return;
      }
      seenInputIds.add(normalized);
    });

    const outputEntries = (value.outputs ?? []) as DockerOutputDescriptorInput[];
    const seenOutputIds = new Set<string>();
    outputEntries.forEach((entry, index) => {
      if (!entry.id) {
        return;
      }
      const normalized = entry.id.toLowerCase();
      if (seenOutputIds.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outputs', index, 'id'],
          message: `Duplicate output id: ${entry.id}`
        });
        return;
      }
      seenOutputIds.add(normalized);
    });
  });

export const dockerJobMetadataSchema = z
  .object({
    docker: dockerMetadataCoreSchema
  })
  .passthrough();

export type ParsedDockerJobMetadata = z.infer<typeof dockerJobMetadataSchema>;

export function safeParseDockerJobMetadata(value: unknown) {
  return dockerJobMetadataSchema.safeParse(value ?? {});
}

export function parseDockerJobMetadata(value: unknown): ParsedDockerJobMetadata {
  return dockerJobMetadataSchema.parse(value ?? {});
}

export type {
  DockerJobMetadata,
  DockerJobInputDescriptor,
  DockerJobInputSource,
  DockerJobOutputDescriptor,
  DockerJobOutputUploadTarget,
  DockerJobEnvironmentVariable,
  DockerJobConfigFileSpec
} from '../db/types';
