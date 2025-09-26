import { z } from 'zod';

export const filestoreRollupStateSchema = z.enum(['up_to_date', 'pending', 'stale', 'invalid']);
export type FilestoreRollupState = z.infer<typeof filestoreRollupStateSchema>;

export const filestoreRollupSummarySchema = z.object({
  nodeId: z.number(),
  sizeBytes: z.number(),
  fileCount: z.number(),
  directoryCount: z.number(),
  childCount: z.number(),
  state: filestoreRollupStateSchema,
  lastCalculatedAt: z.string().nullable()
});
export type FilestoreRollupSummary = z.infer<typeof filestoreRollupSummarySchema>;

export const filestoreNodeKindSchema = z.enum(['file', 'directory', 'unknown']);
export type FilestoreNodeKind = z.infer<typeof filestoreNodeKindSchema>;

export const filestoreNodeStateSchema = z.enum(['active', 'inconsistent', 'missing', 'deleted', 'unknown']);
export type FilestoreNodeState = z.infer<typeof filestoreNodeStateSchema>;

export const filestoreConsistencyStateSchema = z.enum(['active', 'inconsistent', 'missing']);
export type FilestoreConsistencyState = z.infer<typeof filestoreConsistencyStateSchema>;

export const filestoreNodeSchema = z.object({
  id: z.number(),
  backendMountId: z.number(),
  parentId: z.number().nullable(),
  path: z.string(),
  name: z.string(),
  depth: z.number(),
  kind: filestoreNodeKindSchema,
  sizeBytes: z.number(),
  checksum: z.string().nullable(),
  contentHash: z.string().nullable(),
  metadata: z.record(z.unknown()),
  state: filestoreNodeStateSchema,
  version: z.number(),
  isSymlink: z.boolean(),
  lastSeenAt: z.string(),
  lastModifiedAt: z.string().nullable(),
  consistencyState: filestoreConsistencyStateSchema,
  consistencyCheckedAt: z.string(),
  lastReconciledAt: z.string().nullable(),
  lastDriftDetectedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  rollup: filestoreRollupSummarySchema.nullable()
});
export type FilestoreNode = z.infer<typeof filestoreNodeSchema>;

export const filestoreCommandResponseSchema = z.object({
  idempotent: z.boolean(),
  journalEntryId: z.number(),
  node: filestoreNodeSchema.nullable(),
  result: z.unknown()
});
export type FilestoreCommandResponse = z.infer<typeof filestoreCommandResponseSchema>;

const filestoreReconciliationResultSchema = z.object({
  enqueued: z.literal(true)
});
export const filestoreReconciliationResponseSchema = z.object({
  data: filestoreReconciliationResultSchema
});
export type FilestoreReconciliationResult = z.infer<typeof filestoreReconciliationResultSchema>;

export const filestoreNodeResponseSchema = z.object({
  data: filestoreNodeSchema
});

export const filestoreCommandResponseEnvelopeSchema = z.object({
  data: filestoreCommandResponseSchema
});

export const filestoreReconciliationEnvelopeSchema = z.object({
  data: filestoreReconciliationResultSchema
});

export const filestoreReconciliationReasonSchema = z.enum(['drift', 'audit', 'manual']);
export type FilestoreReconciliationReason = z.infer<typeof filestoreReconciliationReasonSchema>;

export const filestoreNodeEventPayloadSchema = z.object({
  backendMountId: z.number(),
  nodeId: z.number().nullable(),
  path: z.string(),
  kind: filestoreNodeKindSchema,
  state: filestoreNodeStateSchema,
  parentId: z.number().nullable(),
  version: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  checksum: z.string().nullable(),
  contentHash: z.string().nullable(),
  metadata: z.record(z.unknown()),
  journalId: z.number(),
  command: z.string(),
  idempotencyKey: z.string().nullable(),
  principal: z.string().nullable(),
  observedAt: z.string()
});
export type FilestoreNodeEventPayload = z.infer<typeof filestoreNodeEventPayloadSchema>;

export const filestoreCommandCompletedPayloadSchema = z.object({
  journalId: z.number(),
  command: z.string(),
  backendMountId: z.number(),
  nodeId: z.number().nullable(),
  path: z.string(),
  idempotencyKey: z.string().nullable(),
  principal: z.string().nullable(),
  result: z.record(z.unknown()),
  observedAt: z.string()
});
export type FilestoreCommandCompletedPayload = z.infer<typeof filestoreCommandCompletedPayloadSchema>;

export const filestoreDriftDetectedPayloadSchema = z.object({
  backendMountId: z.number(),
  nodeId: z.number().nullable(),
  path: z.string(),
  detectedAt: z.string(),
  reason: z.string(),
  reporter: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type FilestoreDriftDetectedPayload = z.infer<typeof filestoreDriftDetectedPayloadSchema>;

export const filestoreNodeReconciledPayloadSchema = z.object({
  backendMountId: z.number(),
  nodeId: z.number(),
  path: z.string(),
  kind: filestoreNodeKindSchema,
  state: filestoreNodeStateSchema,
  parentId: z.number().nullable(),
  version: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  checksum: z.string().nullable(),
  contentHash: z.string().nullable(),
  metadata: z.record(z.unknown()),
  consistencyState: filestoreConsistencyStateSchema,
  consistencyCheckedAt: z.string(),
  lastReconciledAt: z.string().nullable(),
  previousState: filestoreNodeStateSchema.nullable(),
  reason: filestoreReconciliationReasonSchema,
  observedAt: z.string()
});
export type FilestoreNodeReconciledPayload = z.infer<typeof filestoreNodeReconciledPayloadSchema>;

export const filestoreEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('filestore.node.created'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.updated'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.deleted'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.command.completed'), data: filestoreCommandCompletedPayloadSchema }),
  z.object({ type: z.literal('filestore.drift.detected'), data: filestoreDriftDetectedPayloadSchema }),
  z.object({ type: z.literal('filestore.node.reconciled'), data: filestoreNodeReconciledPayloadSchema }),
  z.object({ type: z.literal('filestore.node.missing'), data: filestoreNodeReconciledPayloadSchema })
]);
export type FilestoreEvent = z.infer<typeof filestoreEventSchema>;
export type FilestoreEventType = FilestoreEvent['type'];

export const filestoreEventEnvelopeSchema = filestoreEventSchema;
