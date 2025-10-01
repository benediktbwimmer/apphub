import type { OpenAPIV3 } from 'openapi-types';

const SCHEMA_NAMESPACE = 'https://filestore.apphub/schemas';

export const schemaId = (name: string): string => `${SCHEMA_NAMESPACE}/${name}.json`;

export const schemaRef = (name: string): OpenAPIV3.ReferenceObject => ({
  $ref: schemaId(name)
});

const stringSchema = (format?: string, description?: string): OpenAPIV3.SchemaObject => {
  const schema: OpenAPIV3.SchemaObject = { type: 'string' };
  if (format) {
    schema.format = format;
  }
  if (description) {
    schema.description = description;
  }
  return schema;
};

const integerSchema = (description?: string): OpenAPIV3.SchemaObject => {
  const schema: OpenAPIV3.SchemaObject = { type: 'integer' };
  if (description) {
    schema.description = description;
  }
  return schema;
};

const numberSchema = (description?: string): OpenAPIV3.SchemaObject => {
  const schema: OpenAPIV3.SchemaObject = { type: 'number' };
  if (description) {
    schema.description = description;
  }
  return schema;
};

const booleanSchema = (description?: string): OpenAPIV3.SchemaObject => {
  const schema: OpenAPIV3.SchemaObject = { type: 'boolean' };
  if (description) {
    schema.description = description;
  }
  return schema;
};

const nullable = (schema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject => ({
  ...schema,
  nullable: true
});

const backendMountKindValues = ['local', 's3'] as const;
const backendMountAccessModeValues = ['rw', 'ro'] as const;
const backendMountStateValues = ['active', 'inactive', 'offline', 'degraded', 'error', 'unknown'] as const;
const nodeKindValues = ['file', 'directory'] as const;
const nodeStateValues = ['active', 'inconsistent', 'missing', 'deleted'] as const;
const consistencyStateValues = ['active', 'inconsistent', 'missing'] as const;
const rollupStateValues = ['up_to_date', 'pending', 'stale', 'invalid'] as const;
const reconciliationReasonValues = ['drift', 'audit', 'manual'] as const;
const reconciliationJobStatusValues = ['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'] as const;

const jsonValueSchema: OpenAPIV3.SchemaObject = {
  description: 'Arbitrary JSON value.',
  nullable: true,
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'integer' },
    { type: 'boolean' },
    { type: 'array', items: {} as OpenAPIV3.SchemaObject },
    { type: 'object', additionalProperties: true }
  ]
};

const jsonRecordSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  description: 'Map of string keys to arbitrary JSON values.',
  additionalProperties: schemaRef('JsonValue')
};

const errorObjectSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: stringSchema(undefined, 'Stable machine-readable identifier for the error.'),
    message: stringSchema(undefined, 'Human-readable explanation of the error.'),
    details: nullable(jsonValueSchema)
  }
};

const errorResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: errorObjectSchema
  }
};

const eventsHealthSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['mode', 'ready', 'lastError'],
  properties: {
    mode: {
      type: 'string',
      enum: ['inline', 'redis'],
      description: 'Operating mode for filestore event delivery.'
    },
    ready: booleanSchema('Indicates whether the event publisher is ready.'),
    lastError: nullable(stringSchema(undefined, 'Most recent connection or publish error, when available.'))
  }
};

const healthResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'events'],
  properties: {
    status: {
      type: 'string',
      enum: ['ok', 'degraded'],
      description: 'Summary health indicator for the filestore service.'
    },
    events: eventsHealthSchema
  }
};

const readyResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: ['ok'],
      description: 'Indicates all critical dependencies are available.'
    }
  }
};

const readyUnavailableResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'reason', 'events'],
  properties: {
    status: {
      type: 'string',
      enum: ['unavailable'],
      description: 'Signals that at least one dependency is unavailable.'
    },
    reason: stringSchema(undefined, 'Details about the failing dependency.'),
    events: eventsHealthSchema
  }
};

const backendMountSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'mountKey',
    'backendKind',
    'accessMode',
    'state',
    'labels',
    'rootPath',
    'bucket',
    'prefix',
    'createdAt',
    'updatedAt',
    'config',
    'displayName',
    'description',
    'contact',
    'stateReason',
    'lastHealthCheckAt',
    'lastHealthStatus'
  ],
  properties: {
    id: integerSchema('Unique identifier for the backend mount.'),
    mountKey: stringSchema(undefined, 'Stable slug identifying the backend.'),
    displayName: nullable(stringSchema(undefined, 'Human friendly backend name.')),
    description: nullable(stringSchema(undefined, 'Optional description of the backend.')),
    contact: nullable(stringSchema(undefined, 'Point of contact for the backend.')),
    labels: {
      type: 'array',
      description: 'Arbitrary labels associated with the backend.',
      items: stringSchema()
    },
    backendKind: {
      type: 'string',
      enum: [...backendMountKindValues],
      description: 'Implementation backing this mount.'
    },
    accessMode: {
      type: 'string',
      enum: [...backendMountAccessModeValues],
      description: 'Indicates whether files can be written or only read.'
    },
    state: {
      type: 'string',
      enum: [...backendMountStateValues],
      description: 'Current health state as reported by the mount.'
    },
    stateReason: nullable(stringSchema(undefined, 'Additional context explaining the current state.')),
    rootPath: nullable(stringSchema(undefined, 'Base path for local backends.')),
    bucket: nullable(stringSchema(undefined, 'Bucket name for S3 backends.')),
    prefix: nullable(stringSchema(undefined, 'Optional prefix used when addressing the backend.')),
    config: nullable({
      type: 'object',
      description: 'Backend specific configuration. Secrets are omitted.',
      additionalProperties: schemaRef('JsonValue')
    }),
    lastHealthCheckAt: nullable(stringSchema('date-time', 'Timestamp of the most recent health check.')),
    lastHealthStatus: nullable(stringSchema(undefined, 'Latest reported status message from the backend.')),
    createdAt: stringSchema('date-time', 'Timestamp when the backend was created.'),
    updatedAt: stringSchema('date-time', 'Timestamp when the backend was last updated.')
  }
};

const backendMountEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: backendMountSchema
  }
};

const paginationSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['total', 'limit', 'offset', 'nextOffset'],
  properties: {
    total: integerSchema('Total matching records.'),
    limit: integerSchema('Requested page size.'),
    offset: integerSchema('Current offset within the collection.'),
    nextOffset: nullable(integerSchema('Next offset to request, if more data is available.'))
  }
};

const backendMountListFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['search', 'kinds', 'states', 'accessModes'],
  properties: {
    search: nullable(stringSchema(undefined, 'Search term applied to mount names or descriptions.')),
    kinds: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...backendMountKindValues]
      }
    },
    states: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...backendMountStateValues]
      }
    },
    accessModes: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...backendMountAccessModeValues]
      }
    }
  }
};

const backendMountListSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['mounts', 'pagination', 'filters'],
  properties: {
    mounts: {
      type: 'array',
      items: backendMountSchema
    },
    pagination: paginationSchema,
    filters: backendMountListFiltersSchema
  }
};

const backendMountListEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: backendMountListSchema
  }
};

const backendMountMutationSharedProperties: Record<string, OpenAPIV3.SchemaObject> = {
  displayName: nullable(stringSchema(undefined, 'Optional display name.')),
  description: nullable(stringSchema(undefined, 'Optional description.')),
  contact: nullable(stringSchema(undefined, 'Point of contact for the backend.')),
  labels: {
    type: 'array',
    description: 'Optional labels providing additional context.',
    items: stringSchema()
  },
  state: {
    type: 'string',
    enum: [...backendMountStateValues],
    description: 'Override the lifecycle state for the backend.'
  },
  stateReason: nullable(stringSchema(undefined, 'Explanation for the assigned state.')),
  accessMode: {
    type: 'string',
    enum: [...backendMountAccessModeValues],
    description: 'Desired access level for the backend.'
  },
  rootPath: nullable(stringSchema(undefined, 'Path to mount for local backends.')),
  bucket: nullable(stringSchema(undefined, 'Bucket name for S3 backends.')),
  prefix: nullable(stringSchema(undefined, 'Optional path prefix when interacting with the backend.')),
  config: nullable({
    type: 'object',
    description: 'Backend specific configuration overrides.',
    additionalProperties: schemaRef('JsonValue')
  })
};

const backendMountCreateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['mountKey', 'backendKind'],
  additionalProperties: false,
  properties: {
    mountKey: stringSchema(undefined, 'Unique slug for the backend mount.'),
    backendKind: {
      type: 'string',
      enum: [...backendMountKindValues]
    },
    ...backendMountMutationSharedProperties
  }
};

const backendMountUpdateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mountKey: stringSchema(undefined, 'Updated slug for the backend mount.'),
    ...backendMountMutationSharedProperties
  }
};

const nodeRollupSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['nodeId', 'sizeBytes', 'fileCount', 'directoryCount', 'childCount', 'state', 'lastCalculatedAt'],
  properties: {
    nodeId: integerSchema('Identifier of the node associated with this rollup.'),
    sizeBytes: integerSchema('Total bytes attributed to the subtree.'),
    fileCount: integerSchema('Number of files in the subtree.'),
    directoryCount: integerSchema('Number of directories in the subtree.'),
    childCount: integerSchema('Total direct children tracked in the rollup.'),
    state: {
      type: 'string',
      enum: [...rollupStateValues],
      description: 'Freshness indicator for the rollup snapshot.'
    },
    lastCalculatedAt: nullable(stringSchema('date-time', 'Timestamp of the most recent rollup calculation.'))
  }
};

const nodeDownloadDescriptorSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['mode', 'streamUrl', 'presignUrl', 'supportsRange', 'sizeBytes', 'checksum', 'contentHash', 'filename'],
  properties: {
    mode: {
      type: 'string',
      enum: ['stream', 'presign'],
      description: 'Preferred download strategy for the file.'
    },
    streamUrl: stringSchema(undefined, 'URL to stream the file through the filestore service.'),
    presignUrl: nullable(stringSchema(undefined, 'Link to request a presigned download if supported.')),
    supportsRange: booleanSchema('Indicates whether byte-range requests are supported.'),
    sizeBytes: nullable(integerSchema('Known size of the file when available.')),
    checksum: nullable(stringSchema(undefined, 'Checksum recorded for the file content.')),
    contentHash: nullable(stringSchema(undefined, 'Content hash recorded for the file content.')),
    filename: nullable(stringSchema(undefined, 'Suggested filename for downloads.'))
  }
};

const filestoreNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'backendMountId',
    'parentId',
    'path',
    'name',
    'depth',
    'kind',
    'sizeBytes',
    'checksum',
    'contentHash',
    'metadata',
    'state',
    'version',
    'isSymlink',
    'lastSeenAt',
    'lastModifiedAt',
    'consistencyState',
    'consistencyCheckedAt',
    'lastReconciledAt',
    'lastDriftDetectedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'rollup',
    'download'
  ],
  properties: {
    id: integerSchema('Unique identifier for the node.'),
    backendMountId: integerSchema('Identifier of the backend mount containing the node.'),
    parentId: nullable(integerSchema('Identifier of the parent directory, if any.')),
    path: stringSchema(undefined, 'Normalized absolute path for the node.'),
    name: stringSchema(undefined, 'Basename of the node.'),
    depth: integerSchema('Directory depth starting from the backend root.'),
    kind: {
      type: 'string',
      enum: [...nodeKindValues]
    },
    sizeBytes: integerSchema('Logical size recorded for the node, in bytes.'),
    checksum: nullable(stringSchema(undefined, 'Checksum recorded for the node content.')),
    contentHash: nullable(stringSchema(undefined, 'Content hash recorded for the node content.')),
    metadata: {
      type: 'object',
      description: 'Arbitrary metadata captured for the node.',
      additionalProperties: schemaRef('JsonValue')
    },
    state: {
      type: 'string',
      enum: [...nodeStateValues],
      description: 'Lifecycle state tracked for the node.'
    },
    version: integerSchema('Monotonic version counter for optimistic concurrency.'),
    isSymlink: booleanSchema('Indicates if the node represents a symbolic link.'),
    lastSeenAt: stringSchema('date-time', 'Timestamp when the node was last observed in the backend.'),
    lastModifiedAt: nullable(stringSchema('date-time', 'Last modification timestamp reported by the backend.')),
    consistencyState: {
      type: 'string',
      enum: [...consistencyStateValues],
      description: 'Consistency status derived from reconciliation.'
    },
    consistencyCheckedAt: stringSchema('date-time', 'Timestamp of the most recent consistency check.'),
    lastReconciledAt: nullable(stringSchema('date-time', 'Timestamp of the most recent reconciliation success.')),
    lastDriftDetectedAt: nullable(stringSchema('date-time', 'Timestamp when drift was last detected.')),
    createdAt: stringSchema('date-time', 'Timestamp when the node record was created.'),
    updatedAt: stringSchema('date-time', 'Timestamp when the node record was last updated.'),
    deletedAt: nullable(stringSchema('date-time', 'Timestamp when the node was marked deleted.')),
    rollup: nullable(nodeRollupSchema),
    download: nullable(nodeDownloadDescriptorSchema)
  }
};

const metadataFilterSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: stringSchema(undefined, 'Metadata key to match.'),
    value: schemaRef('JsonValue')
  }
};

const numericRangeFilterSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    min: integerSchema('Lower bound, inclusive.'),
    max: integerSchema('Upper bound, inclusive.')
  },
  description: 'Range constraint applied to numeric values.'
};

const dateRangeFilterSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    after: stringSchema('date-time', 'Lower inclusive bound.'),
    before: stringSchema('date-time', 'Upper inclusive bound.')
  },
  description: 'Range constraint applied to ISO-8601 timestamps.'
};

const rollupStatsFilterSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    states: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...rollupStateValues]
      }
    },
    minChildCount: integerSchema(),
    maxChildCount: integerSchema(),
    minFileCount: integerSchema(),
    maxFileCount: integerSchema(),
    minDirectoryCount: integerSchema(),
    maxDirectoryCount: integerSchema(),
    minSizeBytes: integerSchema(),
    maxSizeBytes: integerSchema(),
    lastCalculatedAfter: stringSchema('date-time'),
    lastCalculatedBefore: stringSchema('date-time')
  },
  description: 'Advanced rollup constraints applied when filtering nodes.'
};

const filestoreNodeFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: stringSchema(undefined, 'Full-text search term applied to node names and metadata.'),
    metadata: {
      type: 'array',
      items: metadataFilterSchema,
      description: 'Match nodes whose metadata entries equal the supplied values.'
    },
    size: numericRangeFilterSchema,
    lastSeenAt: dateRangeFilterSchema,
    rollup: rollupStatsFilterSchema
  }
};

const nodeListFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'backendMountId',
    'path',
    'depth',
    'states',
    'kinds',
    'search',
    'driftOnly',
    'advanced'
  ],
  properties: {
    backendMountId: integerSchema('Backend filter applied to the query.'),
    path: nullable(stringSchema(undefined, 'Optional path prefix filter.')),
    depth: nullable(integerSchema('Maximum depth relative to the provided path.')),
    states: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...nodeStateValues]
      }
    },
    kinds: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...nodeKindValues]
      }
    },
    search: nullable(stringSchema(undefined, 'Term supplied via search or advanced filters.')),
    driftOnly: booleanSchema('Whether only nodes with detected drift were requested.'),
    advanced: nullable(filestoreNodeFiltersSchema)
  }
};

const nodeListSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['nodes', 'pagination', 'filters'],
  properties: {
    nodes: {
      type: 'array',
      items: filestoreNodeSchema
    },
    pagination: paginationSchema,
    filters: nodeListFiltersSchema
  }
};

const nodeListEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: nodeListSchema
  }
};

const nodeChildrenFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['states', 'kinds', 'search', 'driftOnly', 'advanced'],
  properties: {
    states: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...nodeStateValues]
      }
    },
    kinds: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...nodeKindValues]
      }
    },
    search: nullable(stringSchema()),
    driftOnly: booleanSchema(),
    advanced: nullable(filestoreNodeFiltersSchema)
  }
};

const nodeChildrenSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['parent', 'children', 'pagination', 'filters'],
  properties: {
    parent: filestoreNodeSchema,
    children: {
      type: 'array',
      items: filestoreNodeSchema
    },
    pagination: paginationSchema,
    filters: nodeChildrenFiltersSchema
  }
};

const nodeChildrenEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: nodeChildrenSchema
  }
};

const nodeEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: filestoreNodeSchema
  }
};

const commandOutcomeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['idempotent', 'journalEntryId', 'node', 'result'],
  properties: {
    idempotent: booleanSchema('Indicates whether an idempotency key short-circuited the command.'),
    journalEntryId: integerSchema('Identifier of the journal entry generated for this command.'),
    node: nullable(filestoreNodeSchema),
    result: {
      type: 'object',
      description: 'Command-specific payload describing the work performed.',
      additionalProperties: schemaRef('JsonValue')
    }
  }
};

const commandOutcomeEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: commandOutcomeSchema
  }
};

const createDirectoryRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['backendMountId', 'path'],
  properties: {
    backendMountId: integerSchema('Backend mount receiving the directory.'),
    path: stringSchema(undefined, 'Directory path to create.'),
    metadata: {
      type: 'object',
      description: 'Optional metadata assigned to the directory.',
      additionalProperties: schemaRef('JsonValue')
    },
    idempotencyKey: stringSchema(undefined, 'Optional idempotency key to reuse previous results.')
  }
};

const deleteNodeRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['backendMountId', 'path'],
  properties: {
    backendMountId: integerSchema('Backend mount containing the node.'),
    path: stringSchema(undefined, 'Path of the node to delete.'),
    recursive: booleanSchema('When true, delete directories and their contents.'),
    idempotencyKey: stringSchema(undefined, 'Optional idempotency key.')
  }
};

const moveNodeRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['backendMountId', 'path', 'targetPath'],
  properties: {
    backendMountId: integerSchema('Backend mount containing the source node.'),
    path: stringSchema(undefined, 'Source node path.'),
    targetPath: stringSchema(undefined, 'Destination path for the node.'),
    targetBackendMountId: integerSchema('Alternate backend mount for cross-mount moves.'),
    overwrite: booleanSchema('When true, replace an existing node at the destination.'),
    idempotencyKey: stringSchema(undefined, 'Optional idempotency key.')
  }
};

const copyNodeRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['backendMountId', 'path', 'targetPath'],
  properties: {
    backendMountId: integerSchema('Backend mount containing the source node.'),
    path: stringSchema(undefined, 'Source node path.'),
    targetPath: stringSchema(undefined, 'Destination path for the copy.'),
    targetBackendMountId: integerSchema('Alternate backend mount for cross-mount copies.'),
    overwrite: booleanSchema('When true, replace an existing node at the destination.'),
    idempotencyKey: stringSchema(undefined, 'Optional idempotency key.')
  }
};

const updateMetadataRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['backendMountId'],
  properties: {
    backendMountId: integerSchema('Backend mount containing the node.'),
    set: nullable({
      type: 'object',
      description: 'Metadata entries to overwrite.',
      additionalProperties: schemaRef('JsonValue')
    }),
    unset: {
      type: 'array',
      description: 'Metadata keys to remove from the node.',
      items: stringSchema()
    },
    idempotencyKey: stringSchema(undefined, 'Optional idempotency key.')
  }
};

const reconciliationRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['backendMountId', 'path'],
  properties: {
    backendMountId: integerSchema('Backend mount containing the node to reconcile.'),
    path: stringSchema(undefined, 'Path of the node to reconcile.'),
    nodeId: nullable(integerSchema('Identifier of the node to reconcile.')),
    reason: {
      type: 'string',
      enum: [...reconciliationReasonValues],
      description: 'Reason the reconciliation was requested.'
    },
    detectChildren: booleanSchema('When true, enqueue reconciliation jobs for child nodes.'),
    requestedHash: booleanSchema('When true, force hash recomputation for the node.')
  }
};

const reconciliationEnqueueResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['enqueued'],
      properties: {
        enqueued: {
          type: 'boolean',
          enum: [true],
          description: 'Indicates the reconciliation job was queued.'
        }
      }
    }
  }
};

const reconciliationJobSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'jobKey',
    'backendMountId',
    'nodeId',
    'path',
    'reason',
    'status',
    'detectChildren',
    'requestedHash',
    'attempt',
    'result',
    'error',
    'enqueuedAt',
    'startedAt',
    'completedAt',
    'durationMs',
    'updatedAt'
  ],
  properties: {
    id: integerSchema('Identifier of the reconciliation job.'),
    jobKey: stringSchema(undefined, 'Deterministic key used for idempotent job scheduling.'),
    backendMountId: integerSchema('Backend mount identifier associated with the job.'),
    nodeId: nullable(integerSchema('Identifier of the node under reconciliation.')),
    path: stringSchema(undefined, 'Path of the node under reconciliation.'),
    reason: {
      type: 'string',
      enum: [...reconciliationReasonValues]
    },
    status: {
      type: 'string',
      enum: [...reconciliationJobStatusValues]
    },
    detectChildren: booleanSchema('Whether child reconciliation jobs were requested.'),
    requestedHash: booleanSchema('Whether a hash recalculation was requested.'),
    attempt: integerSchema('Attempt counter for the job.'),
    result: nullable(jsonRecordSchema),
    error: nullable(jsonRecordSchema),
    enqueuedAt: stringSchema('date-time', 'Timestamp when the job was enqueued.'),
    startedAt: nullable(stringSchema('date-time', 'Timestamp when the job started processing.')),
    completedAt: nullable(stringSchema('date-time', 'Timestamp when the job finished processing.')),
    durationMs: nullable(integerSchema('Duration in milliseconds, when available.')),
    updatedAt: stringSchema('date-time', 'Timestamp when the job record was last updated.')
  }
};

const reconciliationJobListFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['backendMountId', 'path', 'status'],
  properties: {
    backendMountId: nullable(integerSchema('Backend mount filter applied to the query.')),
    path: nullable(stringSchema(undefined, 'Path filter applied to the job listing.')),
    status: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...reconciliationJobStatusValues]
      }
    }
  }
};

const reconciliationJobListSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['jobs', 'pagination', 'filters'],
  properties: {
    jobs: {
      type: 'array',
      items: reconciliationJobSchema
    },
    pagination: paginationSchema,
    filters: reconciliationJobListFiltersSchema
  }
};

const reconciliationJobListEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: reconciliationJobListSchema
  }
};

const reconciliationJobEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: reconciliationJobSchema
  }
};

const presignedDownloadEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['url', 'expiresAt', 'headers', 'method'],
      properties: {
        url: stringSchema(undefined, 'Presigned URL to download the file directly from the backend.'),
        expiresAt: stringSchema('date-time', 'Timestamp when the presigned URL expires.'),
        headers: {
          type: 'object',
          description: 'HTTP headers that must be supplied when invoking the presigned URL.',
          additionalProperties: stringSchema()
        },
        method: stringSchema(undefined, 'HTTP method to use for the presigned request.')
      }
    }
  }
};

export const openApiInfo: OpenAPIV3.InfoObject = {
  title: 'AppHub Filestore API',
  version: '1.0.0',
  description:
    'HTTP interface for managing storage backends, file metadata, and reconciliation jobs within the AppHub filestore service.'
};

export const openApiServers: OpenAPIV3.ServerObject[] = [
  {
    url: 'http://localhost:4300',
    description: 'Local development server'
  }
];

export const openApiTags: OpenAPIV3.TagObject[] = [
  {
    name: 'System',
    description: 'Service health, readiness, and OpenAPI discovery endpoints.'
  },
  {
    name: 'Backend Mounts',
    description: 'Management of filestore backend mounts.'
  },
  {
    name: 'Files',
    description: 'Upload, download, and presign operations for stored files.'
  },
  {
    name: 'Nodes',
    description: 'Structured access to filestore nodes and directories.'
  },
  {
    name: 'Reconciliation',
    description: 'Queue and inspect filestore reconciliation jobs.'
  },
  {
    name: 'Events',
    description: 'Streaming access to filestore domain events.'
  }
];

export const openApiComponents: OpenAPIV3.ComponentsObject = {
  schemas: {
    JsonValue: jsonValueSchema,
    JsonRecord: jsonRecordSchema,
    ErrorObject: errorObjectSchema,
    ErrorResponse: errorResponseSchema,
    EventsHealth: eventsHealthSchema,
    HealthResponse: healthResponseSchema,
    ReadyResponse: readyResponseSchema,
    ReadyUnavailableResponse: readyUnavailableResponseSchema,
    BackendMount: backendMountSchema,
    BackendMountEnvelope: backendMountEnvelopeSchema,
    BackendMountListFilters: backendMountListFiltersSchema,
    BackendMountList: backendMountListSchema,
    BackendMountListEnvelope: backendMountListEnvelopeSchema,
    BackendMountCreateRequest: backendMountCreateRequestSchema,
    BackendMountUpdateRequest: backendMountUpdateRequestSchema,
    Pagination: paginationSchema,
    NodeRollup: nodeRollupSchema,
    NodeDownloadDescriptor: nodeDownloadDescriptorSchema,
    FilestoreNode: filestoreNodeSchema,
    FilestoreNodeFilters: filestoreNodeFiltersSchema,
    NodeListFilters: nodeListFiltersSchema,
    NodeList: nodeListSchema,
    NodeListEnvelope: nodeListEnvelopeSchema,
    NodeChildren: nodeChildrenSchema,
    NodeChildrenEnvelope: nodeChildrenEnvelopeSchema,
    NodeEnvelope: nodeEnvelopeSchema,
    CommandOutcome: commandOutcomeSchema,
    CommandOutcomeEnvelope: commandOutcomeEnvelopeSchema,
    CreateDirectoryRequest: createDirectoryRequestSchema,
    DeleteNodeRequest: deleteNodeRequestSchema,
    MoveNodeRequest: moveNodeRequestSchema,
    CopyNodeRequest: copyNodeRequestSchema,
    UpdateMetadataRequest: updateMetadataRequestSchema,
    ReconciliationRequest: reconciliationRequestSchema,
    ReconciliationEnqueueResponse: reconciliationEnqueueResponseSchema,
    ReconciliationJob: reconciliationJobSchema,
    ReconciliationJobListFilters: reconciliationJobListFiltersSchema,
    ReconciliationJobList: reconciliationJobListSchema,
    ReconciliationJobListEnvelope: reconciliationJobListEnvelopeSchema,
    ReconciliationJobEnvelope: reconciliationJobEnvelopeSchema,
    PresignedDownloadEnvelope: presignedDownloadEnvelopeSchema
  }
};
