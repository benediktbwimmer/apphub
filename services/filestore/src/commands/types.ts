import { z } from 'zod';

export const createDirectoryCommandSchema = z.object({
  type: z.literal('createDirectory'),
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const deleteNodeCommandSchema = z.object({
  type: z.literal('deleteNode'),
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  recursive: z.boolean().optional()
});

export const filestoreCommandSchema = z.discriminatedUnion('type', [
  createDirectoryCommandSchema,
  deleteNodeCommandSchema
]);

export type CreateDirectoryCommand = z.infer<typeof createDirectoryCommandSchema> & { type: 'createDirectory' };
export type DeleteNodeCommand = z.infer<typeof deleteNodeCommandSchema> & { type: 'deleteNode' };

export type FilestoreCommand = CreateDirectoryCommand | DeleteNodeCommand;
