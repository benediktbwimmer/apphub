import type { JobDefinitionCreateInput } from '../../db/types';

export const fileDropJobs: JobDefinitionCreateInput[] = [
  {
    slug: 'file-relocator',
    name: 'File Relocator',
    type: 'batch',
    runtime: 'node',
    entryPoint: 'bundle:file-relocator@0.1.0#handler',
    timeoutMs: 90_000,
    retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 5_000 },
    parametersSchema: {
      type: 'object',
      properties: {
        dropId: { type: 'string', minLength: 1 },
        sourcePath: { type: 'string', minLength: 1 },
        relativePath: { type: 'string', minLength: 1 },
        destinationDir: { type: 'string', minLength: 1 },
        destinationFilename: { type: 'string' }
      },
      required: ['dropId', 'sourcePath', 'relativePath', 'destinationDir']
    },
    outputSchema: {
      type: 'object',
      properties: {
        dropId: { type: 'string' },
        sourcePath: { type: 'string' },
        destinationPath: { type: 'string' },
        relativePath: { type: 'string' },
        bytesMoved: { type: 'number' },
        startedAt: { type: 'string', format: 'date-time' },
        completedAt: { type: 'string', format: 'date-time' },
        durationMs: { type: 'number' },
        attempts: { type: 'number' }
      }
    }
  }
];

const fileDropJobMap = new Map<string, JobDefinitionCreateInput>(
  fileDropJobs.map((job) => [job.slug.toLowerCase(), job])
);

function cloneJobDefinition(definition: JobDefinitionCreateInput): JobDefinitionCreateInput {
  return JSON.parse(JSON.stringify(definition)) as JobDefinitionCreateInput;
}

export function getFileDropJobDefinition(slug: string): JobDefinitionCreateInput | null {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    return null;
  }
  const match = fileDropJobMap.get(slug.trim().toLowerCase());
  return match ? cloneJobDefinition(match) : null;
}
