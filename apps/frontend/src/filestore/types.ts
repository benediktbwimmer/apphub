import { z } from 'zod';

export const filestoreRollupStateSchema = z.enum(['up_to_date', 'pending', 'stale', 'invalid']);
export type FilestoreRollupState = z.infer<typeof filestoreRollupStateSchema>;

export const filestoreBackendMountSchema = z.object({
  id: z.number(),
  mountKey: z.string(),
  backendKind: z.enum(['local', 's3']),
  accessMode: z.enum(['rw', 'ro']),
  state: z.string(),
  rootPath: z.string().nullable(),
  bucket: z.string().nullable(),
  prefix: z.string().nullable()
});
export type FilestoreBackendMount = z.infer<typeof filestoreBackendMountSchema>;

export const filestoreBackendMountListEnvelopeSchema = z.object({
  data: z.object({
    mounts: z.array(filestoreBackendMountSchema)
  })
});
export type FilestoreBackendMountList = z.infer<typeof filestoreBackendMountListEnvelopeSchema>['data'];

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

export const filestoreNodeDownloadSchema = z.object({
  mode: z.enum(['stream', 'presign']),
  streamUrl: z.string(),
  presignUrl: z.string().nullable(),
  supportsRange: z.boolean(),
  sizeBytes: z.number().nullable(),
  checksum: z.string().nullable(),
  contentHash: z.string().nullable(),
  filename: z.string().nullable()
});
export type FilestoreNodeDownload = z.infer<typeof filestoreNodeDownloadSchema>;

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
  rollup: filestoreRollupSummarySchema.nullable(),
  download: filestoreNodeDownloadSchema.nullable()
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

export const filestorePaginationSchema = z.object({
  total: z.number().nonnegative(),
  limit: z.number().positive(),
  offset: z.number().nonnegative(),
  nextOffset: z.number().nullable()
});
export type FilestorePagination = z.infer<typeof filestorePaginationSchema>;

export const filestoreCommandResponseEnvelopeSchema = z.object({
  data: filestoreCommandResponseSchema
});

export const filestoreReconciliationJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled'
]);
export type FilestoreReconciliationJobStatus = z.infer<typeof filestoreReconciliationJobStatusSchema>;

export const filestoreReconciliationReasonSchema = z.enum(['drift', 'audit', 'manual']);
export type FilestoreReconciliationReason = z.infer<typeof filestoreReconciliationReasonSchema>;

export const filestoreReconciliationJobSchema = z.object({
  id: z.number(),
  jobKey: z.string(),
  backendMountId: z.number(),
  nodeId: z.number().nullable(),
  path: z.string(),
  reason: filestoreReconciliationReasonSchema,
  status: filestoreReconciliationJobStatusSchema,
  detectChildren: z.boolean(),
  requestedHash: z.boolean(),
  attempt: z.number(),
  result: z.record(z.unknown()).nullable(),
  error: z.record(z.unknown()).nullable(),
  enqueuedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  updatedAt: z.string()
});
export type FilestoreReconciliationJob = z.infer<typeof filestoreReconciliationJobSchema>;

export const filestoreReconciliationEnvelopeSchema = z.object({
  data: filestoreReconciliationResultSchema
});

export const filestoreReconciliationJobListEnvelopeSchema = z.object({
  data: z.object({
    jobs: z.array(filestoreReconciliationJobSchema),
    pagination: filestorePaginationSchema,
    filters: z.object({
      backendMountId: z.number().nullable(),
      path: z.string().nullable(),
      status: z.array(filestoreReconciliationJobStatusSchema)
    })
  })
});
export type FilestoreReconciliationJobList = z.infer<typeof filestoreReconciliationJobListEnvelopeSchema>['data'];

export const filestoreReconciliationJobDetailEnvelopeSchema = z.object({
  data: filestoreReconciliationJobSchema
});
export type FilestoreReconciliationJobDetail = z.infer<typeof filestoreReconciliationJobSchema>;

export const filestoreNodeListEnvelopeSchema = z.object({
  data: z.object({
    nodes: z.array(filestoreNodeSchema),
    pagination: filestorePaginationSchema,
    filters: z.object({
      backendMountId: z.number(),
      path: z.string().nullable(),
      depth: z.number().nullable(),
      states: z.array(filestoreNodeStateSchema),
      kinds: z.array(filestoreNodeKindSchema),
      search: z.string().nullable(),
      driftOnly: z.boolean()
    })
  })
});
export type FilestoreNodeList = z.infer<typeof filestoreNodeListEnvelopeSchema>['data'];

export const filestoreNodeChildrenEnvelopeSchema = z.object({
  data: z.object({
    parent: filestoreNodeSchema,
    children: z.array(filestoreNodeSchema),
    pagination: filestorePaginationSchema,
    filters: z.object({
      states: z.array(filestoreNodeStateSchema),
      kinds: z.array(filestoreNodeKindSchema),
      search: z.string().nullable(),
      driftOnly: z.boolean()
    })
  })
});
export type FilestoreNodeChildren = z.infer<typeof filestoreNodeChildrenEnvelopeSchema>['data'];

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

export const filestoreNodeDownloadedPayloadSchema = z.object({
  backendMountId: z.number(),
  nodeId: z.number().nullable(),
  path: z.string(),
  sizeBytes: z.number().nullable(),
  checksum: z.string().nullable(),
  contentHash: z.string().nullable(),
  principal: z.string().nullable(),
  mode: z.enum(['stream', 'presign']),
  range: z.string().nullable(),
  observedAt: z.string()
});
export type FilestoreNodeDownloadedPayload = z.infer<typeof filestoreNodeDownloadedPayloadSchema>;

export const filestoreEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('filestore.node.created'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.updated'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.deleted'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.uploaded'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.moved'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.node.copied'), data: filestoreNodeEventPayloadSchema }),
  z.object({ type: z.literal('filestore.command.completed'), data: filestoreCommandCompletedPayloadSchema }),
  z.object({ type: z.literal('filestore.drift.detected'), data: filestoreDriftDetectedPayloadSchema }),
  z.object({ type: z.literal('filestore.node.reconciled'), data: filestoreNodeReconciledPayloadSchema }),
  z.object({ type: z.literal('filestore.node.missing'), data: filestoreNodeReconciledPayloadSchema }),
  z.object({ type: z.literal('filestore.node.downloaded'), data: filestoreNodeDownloadedPayloadSchema }),
  z.object({ type: z.literal('filestore.reconciliation.job.queued'), data: filestoreReconciliationJobSchema }),
  z.object({ type: z.literal('filestore.reconciliation.job.started'), data: filestoreReconciliationJobSchema }),
  z.object({ type: z.literal('filestore.reconciliation.job.completed'), data: filestoreReconciliationJobSchema }),
  z.object({ type: z.literal('filestore.reconciliation.job.failed'), data: filestoreReconciliationJobSchema }),
  z.object({ type: z.literal('filestore.reconciliation.job.cancelled'), data: filestoreReconciliationJobSchema })
]);
export type FilestoreEvent = z.infer<typeof filestoreEventSchema>;
export type FilestoreEventType = FilestoreEvent['type'];

export const filestoreEventEnvelopeSchema = filestoreEventSchema;

export const filestorePresignEnvelopeSchema = z.object({
  data: z.object({
    url: z.string(),
    expiresAt: z.string(),
    headers: z.record(z.string()),
    method: z.string()
  })
});
export type FilestorePresignPayload = z.infer<typeof filestorePresignEnvelopeSchema>['data'];
