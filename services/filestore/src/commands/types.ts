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

export const updateNodeMetadataCommandSchema = z.object({
  type: z.literal('updateNodeMetadata'),
  backendMountId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  set: z.record(z.string(), z.unknown()).optional(),
  unset: z.array(z.string()).optional()
});

export const moveNodeCommandSchema = z.object({
  type: z.literal('moveNode'),
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  targetPath: z.string().min(1),
  targetBackendMountId: z.number().int().positive().optional(),
  overwrite: z.boolean().optional(),
  nodeKind: z.enum(['file', 'directory']).optional()
});

export const copyNodeCommandSchema = z.object({
  type: z.literal('copyNode'),
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  targetPath: z.string().min(1),
  targetBackendMountId: z.number().int().positive().optional(),
  overwrite: z.boolean().optional(),
  nodeKind: z.enum(['file', 'directory']).optional(),
  includeMetadata: z.boolean().optional()
});

export const uploadFileCommandSchema = z.object({
  type: z.literal('uploadFile'),
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  stagingPath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1).nullable().optional(),
  contentHash: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  mimeType: z.string().min(1).nullable().optional(),
  originalName: z.string().min(1).nullable().optional(),
  overwrite: z.boolean().optional()
});

export const writeFileCommandSchema = z.object({
  type: z.literal('writeFile'),
  backendMountId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  path: z.string().min(1),
  stagingPath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1).nullable().optional(),
  contentHash: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  mimeType: z.string().min(1).nullable().optional(),
  originalName: z.string().min(1).nullable().optional()
});

export const filestoreCommandSchema = z.discriminatedUnion('type', [
  createDirectoryCommandSchema,
  deleteNodeCommandSchema,
  updateNodeMetadataCommandSchema,
  moveNodeCommandSchema,
  copyNodeCommandSchema,
  uploadFileCommandSchema,
  writeFileCommandSchema
]);

export type CreateDirectoryCommand = z.infer<typeof createDirectoryCommandSchema> & { type: 'createDirectory' };
export type DeleteNodeCommand = z.infer<typeof deleteNodeCommandSchema> & { type: 'deleteNode' };
export type UpdateNodeMetadataCommand = z.infer<typeof updateNodeMetadataCommandSchema> & {
  type: 'updateNodeMetadata';
};
export type MoveNodeCommand = z.infer<typeof moveNodeCommandSchema> & { type: 'moveNode' };
export type CopyNodeCommand = z.infer<typeof copyNodeCommandSchema> & { type: 'copyNode' };
export type UploadFileCommand = z.infer<typeof uploadFileCommandSchema> & { type: 'uploadFile' };
export type WriteFileCommand = z.infer<typeof writeFileCommandSchema> & { type: 'writeFile' };

export type FilestoreCommand =
  | CreateDirectoryCommand
  | DeleteNodeCommand
  | UpdateNodeMetadataCommand
  | MoveNodeCommand
  | CopyNodeCommand
  | UploadFileCommand
  | WriteFileCommand;
