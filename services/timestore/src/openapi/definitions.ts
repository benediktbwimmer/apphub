import type { OpenAPIV3 } from 'openapi-types';

const SCHEMA_NAMESPACE = 'https://timestore.apphub/schemas';

export const schemaId = (name: string): string => `${SCHEMA_NAMESPACE}/${name}.json`;

export const schemaRef = (name: string): OpenAPIV3.ReferenceObject => ({
  $ref: schemaId(name)
});

const stringSchema = (format?: string): OpenAPIV3.SchemaObject =>
  format ? { type: 'string', format } : { type: 'string' };

const integerSchema = (): OpenAPIV3.SchemaObject => ({ type: 'integer' });

const numberSchema = (): OpenAPIV3.SchemaObject => ({ type: 'number' });

const booleanSchema = (): OpenAPIV3.SchemaObject => ({ type: 'boolean' });

const nullable = (schema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject => ({
  ...schema,
  nullable: true
});

const jsonValueSchema: OpenAPIV3.SchemaObject = {
  description: 'Arbitrary JSON value.',
  nullable: true,
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'integer' },
    { type: 'boolean' },
    { type: 'array', items: {} },
    {
      type: 'object',
      additionalProperties: true
    }
  ]
};

const jsonObjectSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: schemaRef('JsonValue')
};

const lifecycleQueueHealthSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['inline', 'ready', 'lastError'],
  properties: {
    inline: {
      type: 'boolean',
      description: 'Indicates whether queue processing runs inline instead of Redis-backed.'
    },
    ready: {
      type: 'boolean',
      description: 'True when the lifecycle queue connection is available.'
    },
    lastError: nullable(stringSchema())
  }
};

const streamingStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['enabled', 'state', 'brokerConfigured'],
  properties: {
    enabled: { type: 'boolean' },
    state: { type: 'string', enum: ['disabled', 'ready', 'unconfigured'] },
    reason: { type: 'string', nullable: true },
    brokerConfigured: { type: 'boolean' }
  }
};

const healthResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'lifecycle', 'features'],
  properties: {
    status: {
      type: 'string',
      description: 'High-level health indicator for the service.',
      enum: ['ok', 'degraded']
    },
    lifecycle: lifecycleQueueHealthSchema,
    features: {
      type: 'object',
      required: ['streaming'],
      properties: {
        streaming: streamingStatusSchema
      }
    }
  }
};

const healthUnavailableResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'lifecycle', 'features'],
  properties: {
    status: {
      type: 'string',
      enum: ['unavailable'],
      description: 'Indicates the service cannot serve traffic.'
    },
    lifecycle: lifecycleQueueHealthSchema,
    features: {
      type: 'object',
      required: ['streaming'],
      properties: {
        streaming: streamingStatusSchema
      }
    }
  }
};

const readyResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'features'],
  properties: {
    status: {
      type: 'string',
      enum: ['ready'],
      description: 'Indicates the service is ready to receive traffic.'
    },
    features: {
      type: 'object',
      required: ['streaming'],
      properties: {
        streaming: streamingStatusSchema
      }
    }
  }
};

const readyUnavailableResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'reason', 'lifecycle', 'features'],
  properties: {
    status: {
      type: 'string',
      enum: ['unavailable'],
      description: 'Indicates the readiness check failed.'
    },
    reason: {
      type: 'string',
      description: 'Detailed reason describing why the service is not ready.'
    },
    lifecycle: lifecycleQueueHealthSchema,
    features: {
      type: 'object',
      required: ['streaming'],
      properties: {
        streaming: streamingStatusSchema
      }
    }
  }
};

const errorResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'string',
      description: 'Human-readable description of the error.'
    },
    details: nullable(jsonValueSchema)
  }
};

const datasetSlugParamsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['datasetSlug'],
  properties: {
    datasetSlug: {
      type: 'string',
      description: 'Human-readable slug uniquely identifying a dataset.',
      minLength: 1
    }
  }
};

const ingestionActorSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'scopes'],
  properties: {
    id: {
      type: 'string',
      description: 'Identifier of the actor that initiated the ingestion.'
    },
    scopes: {
      type: 'array',
      description: 'Authorization scopes granted to the actor.',
      items: { type: 'string' },
      default: []
    }
  }
};

const ingestionFieldDefinitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['name', 'type'],
  properties: {
    name: {
      type: 'string',
      description: 'Logical column name defined by the dataset schema.'
    },
    type: {
      type: 'string',
      description: 'Logical field type used to validate incoming rows.',
      enum: ['timestamp', 'string', 'double', 'integer', 'boolean']
    }
  }
};

const ingestionSchemaEvolutionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    defaults: nullable(jsonObjectSchema),
    backfill: nullable(booleanSchema())
  }
};

const ingestionDatasetSchemaSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['fields'],
  additionalProperties: false,
  properties: {
    fields: {
      type: 'array',
      minItems: 1,
      description: 'Field definitions describing the expected columns.',
      items: ingestionFieldDefinitionSchema
    },
    evolution: ingestionSchemaEvolutionSchema
  }
};

const ingestionPartitionTimeRangeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['start', 'end'],
  additionalProperties: false,
  properties: {
    start: stringSchema('date-time'),
    end: stringSchema('date-time')
  }
};

const ingestionPartitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['key', 'timeRange'],
  additionalProperties: false,
  properties: {
    key: {
      type: 'object',
      description: 'Partition key identifying the shard the data belongs to.',
      additionalProperties: { type: 'string' }
    },
    attributes: nullable({
      type: 'object',
      description: 'Optional attributes describing the partition.',
      additionalProperties: { type: 'string' }
    }),
    timeRange: ingestionPartitionTimeRangeSchema
  }
};

const datasetIngestionRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['schema', 'partition', 'rows'],
  additionalProperties: false,
  properties: {
    datasetName: nullable({
      type: 'string',
      description: 'Display name to assign if the dataset is created automatically.'
    }),
    storageTargetId: nullable({
      type: 'string',
      description: 'Explicit storage target identifier. Defaults to the dataset\'s configured target.'
    }),
    tableName: nullable({
      type: 'string',
      description: 'Physical table name override for the dataset backend.'
    }),
    schema: ingestionDatasetSchemaSchema,
    partition: ingestionPartitionSchema,
    rows: {
      type: 'array',
      description: 'Collection of rows that should be appended to the partition.',
      items: {
        type: 'object',
        additionalProperties: jsonValueSchema
      }
    },
    idempotencyKey: nullable({
      type: 'string',
      description: 'Client supplied token to deduplicate ingestion attempts.',
      maxLength: 255
    }),
    actor: nullable(ingestionActorSchema)
  }
};

const storageTargetSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'kind', 'config', 'createdAt', 'updatedAt'],
  properties: {
    id: stringSchema(),
    name: stringSchema(),
    kind: {
      type: 'string',
      enum: ['local', 's3', 'gcs', 'azure_blob']
    },
    description: nullable(stringSchema()),
    config: jsonObjectSchema,
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const datasetRecordSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'slug',
    'name',
    'status',
    'writeFormat',
    'defaultStorageTargetId',
    'metadata',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: stringSchema(),
    slug: stringSchema(),
    name: stringSchema(),
    description: nullable(stringSchema()),
    status: {
      type: 'string',
      enum: ['active', 'inactive']
    },
    writeFormat: {
      type: 'string',
      enum: ['duckdb', 'parquet']
    },
    defaultStorageTargetId: nullable(stringSchema()),
    metadata: jsonObjectSchema,
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const datasetPartitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'datasetId',
    'manifestId',
    'partitionKey',
    'storageTargetId',
    'fileFormat',
    'filePath',
    'startTime',
    'endTime',
    'metadata',
    'columnStatistics',
    'columnBloomFilters',
    'createdAt'
  ],
  properties: {
    id: stringSchema(),
    datasetId: stringSchema(),
    manifestId: stringSchema(),
    manifestShard: stringSchema(),
    partitionKey: jsonObjectSchema,
    storageTargetId: stringSchema(),
    fileFormat: {
      type: 'string',
      enum: ['duckdb', 'parquet']
    },
    filePath: stringSchema(),
    fileSizeBytes: nullable(integerSchema()),
    rowCount: nullable(integerSchema()),
    startTime: stringSchema('date-time'),
    endTime: stringSchema('date-time'),
    checksum: nullable(stringSchema()),
    metadata: jsonObjectSchema,
    columnStatistics: jsonObjectSchema,
    columnBloomFilters: jsonObjectSchema,
    ingestionSignature: nullable(stringSchema()),
    createdAt: stringSchema('date-time')
  }
};

const datasetManifestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'datasetId',
    'version',
    'status',
    'manifestShard',
    'summary',
    'statistics',
    'metadata',
    'partitionCount',
    'totalRows',
    'totalBytes',
    'createdAt',
    'updatedAt',
    'partitions'
  ],
  properties: {
    id: stringSchema(),
    datasetId: stringSchema(),
    version: integerSchema(),
    status: {
      type: 'string',
      enum: ['draft', 'published', 'superseded']
    },
    schemaVersionId: nullable(stringSchema()),
    parentManifestId: nullable(stringSchema()),
    manifestShard: stringSchema(),
    summary: jsonObjectSchema,
    statistics: jsonObjectSchema,
    metadata: jsonObjectSchema,
    partitionCount: integerSchema(),
    totalRows: integerSchema(),
    totalBytes: integerSchema(),
    createdBy: nullable(stringSchema()),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    publishedAt: nullable(stringSchema('date-time')),
    partitions: {
      type: 'array',
      items: datasetPartitionSchema
    }
  }
};

const datasetIngestionInlineResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['mode', 'manifest', 'dataset', 'storageTarget'],
  properties: {
    mode: {
      type: 'string',
      enum: ['inline']
    },
    manifest: datasetManifestSchema,
    dataset: datasetRecordSchema,
    storageTarget: storageTargetSchema
  }
};

const datasetIngestionQueuedResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['mode', 'jobId'],
  properties: {
    mode: {
      type: 'string',
      enum: ['queued']
    },
    jobId: {
      type: 'string',
      description: 'Identifier of the enqueued ingestion job.'
    }
  }
};

const stringPartitionPredicateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['string']
    },
    eq: nullable(stringSchema()),
    in: nullable({
      type: 'array',
      minItems: 1,
      items: stringSchema()
    })
  },
  anyOf: [
    { required: ['eq'] },
    { required: ['in'] }
  ]
};

const numberPartitionPredicateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['number']
    },
    eq: nullable(numberSchema()),
    in: nullable({
      type: 'array',
      minItems: 1,
      items: numberSchema()
    }),
    gt: nullable(numberSchema()),
    gte: nullable(numberSchema()),
    lt: nullable(numberSchema()),
    lte: nullable(numberSchema())
  }
};

const timestampPartitionPredicateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['timestamp']
    },
    eq: nullable(stringSchema('date-time')),
    in: nullable({
      type: 'array',
      minItems: 1,
      items: stringSchema('date-time')
    }),
    gt: nullable(stringSchema('date-time')),
    gte: nullable(stringSchema('date-time')),
    lt: nullable(stringSchema('date-time')),
    lte: nullable(stringSchema('date-time'))
  }
};

const booleanColumnPredicateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['boolean']
    },
    eq: nullable(booleanSchema()),
    in: nullable({
      type: 'array',
      minItems: 1,
      items: booleanSchema()
    })
  }
};

const stringArrayPredicateSchema: OpenAPIV3.SchemaObject = {
  type: 'array',
  minItems: 1,
  description: 'Shorthand for an equality/inclusion check across string values.',
  items: stringSchema()
};

const partitionKeyPredicateSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    stringPartitionPredicateSchema,
    numberPartitionPredicateSchema,
    timestampPartitionPredicateSchema,
    stringArrayPredicateSchema
  ]
};

const columnPredicateSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    stringPartitionPredicateSchema,
    numberPartitionPredicateSchema,
    timestampPartitionPredicateSchema,
    booleanColumnPredicateSchema
  ]
};

const partitionFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    partitionKey: nullable({
      type: 'object',
      additionalProperties: partitionKeyPredicateSchema
    }),
    columns: nullable({
      type: 'object',
      additionalProperties: columnPredicateSchema
    })
  }
};

const downsampleAggregationSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    {
      type: 'object',
      required: ['fn', 'column'],
      additionalProperties: false,
      properties: {
        fn: {
          type: 'string',
          enum: ['avg', 'min', 'max', 'sum', 'median']
        },
        column: stringSchema(),
        alias: nullable(stringSchema())
      }
    },
    {
      type: 'object',
      required: ['fn'],
      additionalProperties: false,
      properties: {
        fn: {
          type: 'string',
          enum: ['count']
        },
        column: nullable(stringSchema()),
        alias: nullable(stringSchema())
      }
    },
    {
      type: 'object',
      required: ['fn', 'column'],
      additionalProperties: false,
      properties: {
        fn: {
          type: 'string',
          enum: ['count_distinct']
        },
        column: stringSchema(),
        alias: nullable(stringSchema())
      }
    },
    {
      type: 'object',
      required: ['fn', 'column', 'percentile'],
      additionalProperties: false,
      properties: {
        fn: {
          type: 'string',
          enum: ['percentile']
        },
        column: stringSchema(),
        percentile: {
          type: 'number',
          minimum: 0,
          maximum: 1
        },
        alias: nullable(stringSchema())
      }
    }
  ]
};

const downsampleRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['aggregations'],
  properties: {
    intervalUnit: {
      type: 'string',
      enum: ['second', 'minute', 'hour', 'day', 'week', 'month'],
      default: 'minute'
    },
    intervalSize: {
      type: 'integer',
      minimum: 1,
      default: 1
    },
    aggregations: {
      type: 'array',
      minItems: 1,
      items: downsampleAggregationSchema
    }
  }
};

const datasetQueryRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['timeRange'],
  additionalProperties: false,
  properties: {
    timeRange: {
      type: 'object',
      required: ['start', 'end'],
      additionalProperties: false,
      properties: {
        start: stringSchema('date-time'),
        end: stringSchema('date-time')
      }
    },
    timestampColumn: {
      type: 'string',
      description: 'Logical timestamp column to use for range filtering.',
      default: 'timestamp'
    },
    columns: nullable({
      type: 'array',
      items: stringSchema()
    }),
    filters: nullable(partitionFiltersSchema),
    downsample: nullable(downsampleRequestSchema),
    limit: nullable({
      type: 'integer',
      minimum: 1,
      maximum: 500000
    })
  }
};

const datasetQueryResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['rows', 'columns', 'mode'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true
      }
    },
    columns: {
      type: 'array',
      items: stringSchema()
    },
    mode: {
      type: 'string',
      enum: ['raw', 'downsampled']
    },
    warnings: {
      type: 'array',
      description: 'Non-fatal issues encountered while executing the query.',
      items: stringSchema()
    }
  }
};

const sqlQueryRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['sql'],
  additionalProperties: false,
  properties: {
    sql: {
      type: 'string',
      description: 'SQL statement to execute.'
    },
    params: {
      type: 'array',
      description: 'Positional parameters bound to the statement.',
      items: jsonValueSchema
    }
  }
};

const sqlSchemaColumnSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['name', 'type'],
  properties: {
    name: stringSchema(),
    type: stringSchema(),
    nullable: nullable(booleanSchema()),
    description: nullable(stringSchema())
  }
};

const sqlSchemaTableSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['name', 'columns'],
  properties: {
    name: stringSchema(),
    description: nullable(stringSchema()),
    partitionKeys: nullable({
      type: 'array',
      items: stringSchema()
    }),
    columns: {
      type: 'array',
      items: sqlSchemaColumnSchema
    }
  }
};

const sqlSchemaResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['fetchedAt', 'tables', 'warnings'],
  properties: {
    fetchedAt: stringSchema('date-time'),
    tables: {
      type: 'array',
      items: sqlSchemaTableSchema
    },
    warnings: {
      type: 'array',
      items: stringSchema()
    }
  }
};

const sqlReadStatisticsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['rowCount', 'elapsedMs'],
  properties: {
    rowCount: integerSchema(),
    elapsedMs: numberSchema()
  }
};

const sqlReadResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['executionId', 'columns', 'rows', 'truncated', 'warnings', 'statistics'],
  properties: {
    executionId: stringSchema(),
    columns: {
      type: 'array',
      items: sqlSchemaColumnSchema
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: jsonValueSchema
      }
    },
    truncated: {
      type: 'boolean',
      description: 'Indicates whether results were truncated due to limits.'
    },
    warnings: {
      type: 'array',
      items: stringSchema()
    },
    statistics: sqlReadStatisticsSchema
  }
};

const sqlSavedQueryStatsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rowCount: nullable(integerSchema()),
    elapsedMs: nullable(integerSchema())
  }
};

const sqlSavedQuerySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'statement', 'createdBy', 'createdAt', 'updatedAt'],
  properties: {
    id: stringSchema(),
    statement: stringSchema(),
    label: nullable(stringSchema()),
    stats: nullable(sqlSavedQueryStatsSchema),
    createdBy: nullable(stringSchema()),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const sqlSavedQueryListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['savedQueries'],
  properties: {
    savedQueries: {
      type: 'array',
      items: sqlSavedQuerySchema
    }
  }
};

const sqlSavedQueryResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['savedQuery'],
  properties: {
    savedQuery: sqlSavedQuerySchema
  }
};

const sqlSavedQueryParamsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier of the saved query.'
    }
  }
};

const sqlSavedQueryUpsertRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['statement'],
  additionalProperties: false,
  properties: {
    statement: {
      type: 'string',
      description: 'SQL statement to persist.'
    },
    label: nullable(stringSchema()),
    stats: nullable(sqlSavedQueryStatsSchema)
  }
};

const sqlExecResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['command', 'rowCount'],
  properties: {
    command: stringSchema(),
    rowCount: integerSchema()
  }
};

const components: OpenAPIV3.ComponentsObject = {
  schemas: {
    JsonValue: jsonValueSchema,
    JsonObject: jsonObjectSchema,
    ErrorResponse: errorResponseSchema,
    LifecycleQueueHealth: lifecycleQueueHealthSchema,
    HealthResponse: healthResponseSchema,
    HealthUnavailableResponse: healthUnavailableResponseSchema,
    ReadyResponse: readyResponseSchema,
    ReadyUnavailableResponse: readyUnavailableResponseSchema,
    DatasetSlugParams: datasetSlugParamsSchema,
    IngestionActor: ingestionActorSchema,
    IngestionFieldDefinition: ingestionFieldDefinitionSchema,
    IngestionSchema: ingestionDatasetSchemaSchema,
    IngestionPartition: ingestionPartitionSchema,
    DatasetIngestionRequest: datasetIngestionRequestSchema,
    StorageTarget: storageTargetSchema,
    Dataset: datasetRecordSchema,
    DatasetManifest: datasetManifestSchema,
    DatasetPartition: datasetPartitionSchema,
    DatasetIngestionInlineResponse: datasetIngestionInlineResponseSchema,
    DatasetIngestionQueuedResponse: datasetIngestionQueuedResponseSchema,
    StringPartitionPredicate: stringPartitionPredicateSchema,
    NumberPartitionPredicate: numberPartitionPredicateSchema,
    TimestampPartitionPredicate: timestampPartitionPredicateSchema,
    BooleanColumnPredicate: booleanColumnPredicateSchema,
    StringArrayPredicate: stringArrayPredicateSchema,
    PartitionFilters: partitionFiltersSchema,
    DownsampleAggregation: downsampleAggregationSchema,
    DownsampleRequest: downsampleRequestSchema,
    DatasetQueryRequest: datasetQueryRequestSchema,
    DatasetQueryResponse: datasetQueryResponseSchema,
    SqlQueryRequest: sqlQueryRequestSchema,
    SqlSchemaColumn: sqlSchemaColumnSchema,
    SqlSchemaTable: sqlSchemaTableSchema,
    SqlSchemaResponse: sqlSchemaResponseSchema,
    SqlReadStatistics: sqlReadStatisticsSchema,
    SqlReadResponse: sqlReadResponseSchema,
    SqlSavedQueryStats: sqlSavedQueryStatsSchema,
    SqlSavedQuery: sqlSavedQuerySchema,
    SqlSavedQueryListResponse: sqlSavedQueryListResponseSchema,
    SqlSavedQueryResponse: sqlSavedQueryResponseSchema,
    SqlSavedQueryParams: sqlSavedQueryParamsSchema,
    SqlSavedQueryUpsertRequest: sqlSavedQueryUpsertRequestSchema,
    SqlExecResponse: sqlExecResponseSchema
  }
};

export const openApiComponents: OpenAPIV3.ComponentsObject = components;

export const openApiInfo: OpenAPIV3.InfoObject = {
  title: 'Apphub Timestore API',
  version: '1.0.0',
  description:
    'HTTP API for ingesting, querying, and managing time series datasets stored within Apphub Timestore.'
};

export const openApiServers: OpenAPIV3.ServerObject[] = [
  {
    url: 'http://127.0.0.1:4200',
    description: 'Local development server (legacy routes)'
  },
  {
    url: 'http://127.0.0.1:4200/v1',
    description: 'Local development server (versioned API)'
  }
];

export const openApiTags: OpenAPIV3.TagObject[] = [
  { name: 'System', description: 'Service health and operational endpoints.' },
  { name: 'Ingestion', description: 'Dataset ingestion workflow endpoints.' },
  { name: 'Query', description: 'Time series query endpoints for datasets.' },
  { name: 'SQL', description: 'Interactive SQL access to Timestore datasets.' }
];
