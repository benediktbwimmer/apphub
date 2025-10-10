import type { OpenAPIV3 } from 'openapi-types';

const SCHEMA_NAMESPACE = 'https://core.apphub/schemas';

export const schemaId = (name: string): string => `${SCHEMA_NAMESPACE}/${name}.json`;

export const schemaRef = (name: string): OpenAPIV3.ReferenceObject => ({
  $ref: schemaId(name)
});

const stringSchema = (format?: string): OpenAPIV3.SchemaObject =>
  format ? { type: 'string', format } : { type: 'string' };

const integerSchema = (): OpenAPIV3.SchemaObject => ({ type: 'integer' });

const AI_BUNDLE_EDIT_PROMPT_MAX_LENGTH = 10_000;

const nullable = (schema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject => ({
  ...schema,
  nullable: true
});

const nullableRef = (name: string): OpenAPIV3.SchemaObject => ({
  allOf: [schemaRef(name)],
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

const jsonLooseObjectSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: true
};

const jsonRecordSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: { $ref: '#/components/schemas/JsonValue' }
};

const eventEnvelopeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'type', 'source', 'occurredAt', 'payload'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string' },
    source: { type: 'string' },
    occurredAt: stringSchema('date-time'),
    payload: jsonValueSchema,
    correlationId: nullable(stringSchema()),
    ttl: nullable(integerSchema()),
    metadata: nullable(jsonRecordSchema)
  },
  additionalProperties: true
};

const eventPublishRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  description: 'Event envelope accepted by the HTTP event proxy.',
  required: ['type', 'source'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string' },
    source: { type: 'string' },
    occurredAt: nullable(stringSchema('date-time')),
    payload: jsonValueSchema,
    correlationId: nullable(stringSchema()),
    ttl: nullable(integerSchema()),
    metadata: nullable(jsonRecordSchema)
  },
  additionalProperties: true
};

const eventPublishResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['acceptedAt', 'event'],
  properties: {
    acceptedAt: stringSchema('date-time'),
    event: eventEnvelopeSchema
  }
};

const repositoryTagSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', description: 'Tag key.' },
    value: { type: 'string', description: 'Tag value.' }
  }
};

const launchEnvVarSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', description: 'Environment variable name.' },
    value: { type: 'string', description: 'Environment variable value.' }
  }
};

const buildSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'repositoryId', 'status', 'imageTag', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', description: 'Unique build identifier.' },
    repositoryId: { type: 'string', description: 'Identifier of the source repository.' },
    status: {
      type: 'string',
      description: 'Current build status.',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled']
    },
    imageTag: nullable(stringSchema()),
    errorMessage: nullable(stringSchema()),
    commitSha: nullable(stringSchema()),
    gitBranch: nullable(stringSchema()),
    gitRef: nullable(stringSchema()),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    startedAt: nullable(stringSchema('date-time')),
    completedAt: nullable(stringSchema('date-time')),
    durationMs: nullable(integerSchema()),
    logsPreview: nullable(stringSchema()),
    logsTruncated: { type: 'boolean' },
    hasLogs: { type: 'boolean' },
    logsSize: { type: 'integer', description: 'Size of the captured logs in bytes.' }
  }
};

const launchSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'status', 'buildId', 'repositoryId', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'starting', 'running', 'stopping', 'stopped', 'failed']
    },
    buildId: nullable(stringSchema()),
    repositoryId: { type: 'string' },
    instanceUrl: nullable(stringSchema()),
    resourceProfile: nullable(stringSchema()),
    env: {
      type: 'array',
      items: launchEnvVarSchema,
      description: 'Environment variables used when starting the launch.'
    },
    command: nullable(stringSchema()),
    errorMessage: nullable(stringSchema()),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    startedAt: nullable(stringSchema('date-time')),
    stoppedAt: nullable(stringSchema('date-time')),
    expiresAt: nullable(stringSchema('date-time')),
    port: nullable(integerSchema()),
    internalPort: nullable(integerSchema()),
    containerIp: nullable(stringSchema())
  }
};

const repositoryPreviewSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'kind', 'title', 'description', 'src', 'embedUrl', 'posterUrl', 'width', 'height', 'sortOrder', 'source'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    title: nullable(stringSchema()),
    description: nullable(stringSchema()),
    src: nullable(stringSchema()),
    embedUrl: nullable(stringSchema()),
    posterUrl: nullable(stringSchema()),
    width: nullable(integerSchema()),
    height: nullable(integerSchema()),
    sortOrder: { type: 'integer' },
    source: { type: 'string' }
  }
};

const repositoryRelevanceComponentSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['hits', 'score', 'weight'],
  properties: {
    hits: { type: 'integer' },
    score: { type: 'number' },
    weight: { type: 'number' }
  }
};

const repositoryRelevanceSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['score', 'normalizedScore', 'components'],
  properties: {
    score: { type: 'number' },
    normalizedScore: { type: 'number' },
    components: {
      type: 'object',
      required: ['name', 'description', 'tags'],
      properties: {
        name: repositoryRelevanceComponentSchema,
        description: repositoryRelevanceComponentSchema,
        tags: repositoryRelevanceComponentSchema
      }
    }
  }
};

const repositorySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'name',
    'description',
    'repoUrl',
    'dockerfilePath',
    'updatedAt',
    'ingestStatus',
    'ingestAttempts',
    'tags',
    'previewTiles',
    'launchEnvTemplates'
  ],
  properties: {
    id: { type: 'string', description: 'Repository identifier.' },
    name: { type: 'string' },
    description: { type: 'string' },
    repoUrl: { type: 'string', description: 'Git or HTTP URL where the repository is hosted.' },
    dockerfilePath: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    ingestStatus: {
      type: 'string',
      enum: ['seed', 'pending', 'processing', 'ready', 'failed']
    },
    ingestError: nullable(stringSchema()),
    ingestAttempts: { type: 'integer' },
    latestBuild: nullableRef('Build'),
    latestLaunch: nullableRef('Launch'),
    previewTiles: {
      type: 'array',
      items: repositoryPreviewSchema
    },
    tags: {
      type: 'array',
      items: repositoryTagSchema
    },
    launchEnvTemplates: {
      type: 'array',
      description: 'Template environment variables suggested when launching the app.',
      items: launchEnvVarSchema
    },
    relevance: nullableRef('RepositoryRelevance')
  }
};

const tagFacetSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['key', 'value', 'count'],
  properties: {
    key: { type: 'string' },
    value: { type: 'string' },
    count: { type: 'integer', minimum: 0 }
  }
};

const statusFacetSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'count'],
  properties: {
    status: {
      type: 'string',
      enum: ['seed', 'pending', 'processing', 'ready', 'failed']
    },
    count: { type: 'integer', minimum: 0 }
  }
};

const repositoryListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data', 'facets', 'total', 'meta'],
  properties: {
    data: {
      type: 'array',
      items: repositorySchema
    },
    facets: {
      type: 'object',
      required: ['tags', 'statuses', 'owners', 'frameworks'],
      properties: {
        tags: { type: 'array', items: tagFacetSchema },
        statuses: { type: 'array', items: statusFacetSchema },
        owners: { type: 'array', items: tagFacetSchema },
        frameworks: { type: 'array', items: tagFacetSchema }
      }
    },
    total: { type: 'integer', minimum: 0 },
    meta: {
      type: 'object',
      required: ['tokens', 'sort', 'weights'],
      properties: {
        tokens: { type: 'array', items: { type: 'string' } },
        sort: {
          type: 'string',
          enum: ['relevance', 'updated', 'name']
        },
        weights: {
          type: 'object',
          required: ['name', 'description', 'tags'],
          properties: {
            name: { type: 'number' },
            description: { type: 'number' },
            tags: { type: 'number' }
          }
        }
      }
    }
  }
};

const repositoryResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: repositorySchema
  }
};

const savedCoreSearchSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'slug',
    'name',
    'searchInput',
    'statusFilters',
    'sort',
    'category',
    'config',
    'visibility',
    'appliedCount',
    'sharedCount',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', description: 'Saved search identifier.' },
    slug: { type: 'string', description: 'Shareable slug referencing the saved search.' },
    name: { type: 'string', description: 'Human friendly label for the saved query.' },
    description: nullable(stringSchema()),
    searchInput: {
      type: 'string',
      description: 'Raw core search input as entered by the operator.'
    },
    statusFilters: {
      type: 'array',
      items: { type: 'string', enum: ['seed', 'pending', 'processing', 'ready', 'failed'] },
      description: 'Selected ingest status filters applied when executing the saved search.'
    },
    sort: {
      type: 'string',
      enum: ['relevance', 'updated', 'name'],
      description: 'Preferred sort mode.'
    },
    visibility: {
      type: 'string',
      enum: ['private'],
      description: 'Visibility of the saved search. Currently limited to private entries.'
    },
    appliedCount: {
      type: 'integer',
      minimum: 0,
      description: 'Number of times the saved search has been applied.'
    },
    sharedCount: {
      type: 'integer',
      minimum: 0,
      description: 'Number of share actions recorded for the saved search.'
    },
    lastAppliedAt: nullable(stringSchema('date-time')),
    lastSharedAt: nullable(stringSchema('date-time')),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const savedCoreSearchResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: savedCoreSearchSchema
  }
};

const savedCoreSearchListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'array',
      items: savedCoreSearchSchema
    }
  }
};

const savedCoreSearchCreateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', maxLength: 100 },
    description: nullable(stringSchema()),
    searchInput: { type: 'string', maxLength: 500 },
    statusFilters: {
      type: 'array',
      maxItems: 50,
      items: { type: 'string' },
      description: 'Selected status filters applied when executing the saved search.'
    },
    sort: {
      type: 'string',
      maxLength: 100,
      description: 'Preferred sort mode for rendering results.'
    },
    category: {
      type: 'string',
      maxLength: 100,
      description: 'Logical grouping for the saved search (e.g. core, runs).'
    },
    config: {
      type: 'object',
      additionalProperties: true,
      description: 'Structured configuration used to rehydrate saved filters.'
    }
  }
};

const savedCoreSearchUpdateRequestSchema: OpenAPIV3.SchemaObject = {
  allOf: [
    {
      type: 'object',
      properties: savedCoreSearchCreateRequestSchema.properties ?? {},
      additionalProperties: false
    }
  ]
};

const eventSavedViewFiltersSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', maxLength: 200 },
    source: { type: 'string', maxLength: 200 },
    correlationId: { type: 'string', maxLength: 200 },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    jsonPath: { type: 'string', maxLength: 500 },
    severity: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', enum: ['critical', 'error', 'warning', 'info', 'debug'] }
    },
    limit: { type: 'integer', minimum: 1, maximum: 200 }
  }
};

const eventSavedViewAnalyticsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'windowSeconds',
    'totalEvents',
    'errorEvents',
    'eventRatePerMinute',
    'errorRatio',
    'generatedAt',
    'sampledCount',
    'sampleLimit',
    'truncated'
  ],
  properties: {
    windowSeconds: { type: 'integer', minimum: 60 },
    totalEvents: { type: 'integer', minimum: 0 },
    errorEvents: { type: 'integer', minimum: 0 },
    eventRatePerMinute: { type: 'number', minimum: 0 },
    errorRatio: { type: 'number', minimum: 0 },
    generatedAt: stringSchema('date-time'),
    sampledCount: { type: 'integer', minimum: 0 },
    sampleLimit: { type: 'integer', minimum: 1 },
    truncated: { type: 'boolean' }
  }
};

const eventSavedViewOwnerSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['key', 'subject', 'kind'],
  properties: {
    key: { type: 'string' },
    subject: { type: 'string' },
    kind: { type: 'string', enum: ['user', 'service'] },
    userId: nullable(stringSchema())
  }
};

const eventSavedViewSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'slug',
    'name',
    'filters',
    'visibility',
    'appliedCount',
    'sharedCount',
    'createdAt',
    'updatedAt',
    'owner'
  ],
  properties: {
    id: { type: 'string', description: 'Saved view identifier.' },
    slug: { type: 'string', description: 'Slug used to reference the saved view.' },
    name: { type: 'string', description: 'Display name for the saved view.' },
    description: nullable(stringSchema()),
    filters: eventSavedViewFiltersSchema,
    visibility: { type: 'string', enum: ['private', 'shared'] },
    appliedCount: { type: 'integer', minimum: 0 },
    sharedCount: { type: 'integer', minimum: 0 },
    lastAppliedAt: nullable(stringSchema('date-time')),
    lastSharedAt: nullable(stringSchema('date-time')),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    owner: eventSavedViewOwnerSchema,
    analytics: nullable(eventSavedViewAnalyticsSchema)
  }
};

const eventSavedViewResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: eventSavedViewSchema
  }
};

const eventSavedViewListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'array',
      items: eventSavedViewSchema
    }
  }
};

const eventSavedViewCreateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', maxLength: 120 },
    description: nullable(stringSchema()),
    filters: eventSavedViewFiltersSchema,
    visibility: { type: 'string', enum: ['private', 'shared'] }
  },
  additionalProperties: false
};

const eventSavedViewUpdateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: eventSavedViewCreateRequestSchema.properties,
  additionalProperties: false
};

const operatorIdentitySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['subject', 'kind', 'scopes'],
  properties: {
    subject: { type: 'string', description: 'Identifier for the authenticated principal (user email, service name, or token subject).' },
    kind: {
      type: 'string',
      description: 'Identity classification.',
      enum: ['user', 'service']
    },
    scopes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Granted operator scopes.'
    },
    userId: nullable(stringSchema()),
    sessionId: nullable(stringSchema()),
    apiKeyId: nullable(stringSchema()),
    authDisabled: {
      type: 'boolean',
      description: 'Indicates that the server is running with authentication disabled for local development.'
    },
    displayName: nullable(stringSchema()),
    email: nullable(stringSchema()),
    roles: {
      type: 'array',
      items: { type: 'string' },
      description: 'Role slugs assigned to the identity.'
    }
  }
};

const identityResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: schemaRef('OperatorIdentity')
  }
};

const apiKeySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'prefix', 'scopes', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    name: nullable(stringSchema()),
    prefix: { type: 'string', description: 'Stable API key prefix used for support diagnostics.' },
    scopes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Scopes granted to the API key.'
    },
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    lastUsedAt: nullable(stringSchema('date-time')),
    expiresAt: nullable(stringSchema('date-time')),
    revokedAt: nullable(stringSchema('date-time'))
  }
};

const apiKeyListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['keys'],
      properties: {
        keys: {
          type: 'array',
          items: schemaRef('ApiKey')
        }
      }
    }
  }
};

const apiKeyCreateResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['key', 'token'],
      properties: {
        key: schemaRef('ApiKey'),
        token: {
          type: 'string',
          description: 'Full API key token. This value is only returned once at creation time.'
        }
      }
    }
  }
};

const createRepositoryRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'description', 'repoUrl', 'dockerfilePath'],
  properties: {
    id: {
      type: 'string',
      description: 'Lowercase identifier for the app (letters, numbers, and dashes).',
      pattern: '^[a-z][a-z0-9-]{2,63}$',
      minLength: 3,
      maxLength: 64
    },
    name: { type: 'string', description: 'Human readable name for the app.' },
    description: { type: 'string', description: 'Short description that appears in the core.' },
    repoUrl: {
      type: 'string',
      description: 'Location of the repository. Supports git, HTTP(S), and absolute filesystem paths.'
    },
    dockerfilePath: {
      type: 'string',
      description: 'Repository-relative path to the Dockerfile (e.g. services/api/Dockerfile).',
      pattern: 'Dockerfile(\.[^/]+)?$'
    },
    tags: {
      type: 'array',
      description: 'Optional tags to associate with the repository.',
      items: repositoryTagSchema,
      default: []
    }
  }
};

const manifestEnvPlaceholderSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['$var'],
  additionalProperties: false,
  properties: {
    $var: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        default: { type: 'string' },
        description: { type: 'string' }
      }
    }
  }
};

const manifestEnvReferenceSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['service', 'property'],
  additionalProperties: false,
  properties: {
    service: { type: 'string', minLength: 1 },
    property: { type: 'string', enum: ['instanceUrl', 'baseUrl', 'host', 'port'] },
    fallback: { type: 'string' }
  }
};

const manifestEnvVarSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['key'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', minLength: 1 },
    value: {
      oneOf: [{ type: 'string' }, manifestEnvPlaceholderSchema]
    },
    fromService: manifestEnvReferenceSchema
  },
  description: 'Environment variable declared in a service manifest.'
};

const serviceManifestMetadataSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  description: 'Metadata sourced from service manifests and configuration files.',
  properties: {
    source: { type: 'string', nullable: true, description: 'Location of the manifest entry that populated this service.' },
    sources: {
      type: 'array',
      items: { type: 'string' },
      description: 'All manifest files that contributed to this service definition.'
    },
    baseUrlSource: {
      type: 'string',
      enum: ['manifest', 'runtime', 'config'],
      nullable: true,
      description: 'Whether the manifest, runtime state, or config file selected the effective base URL.'
    },
    openapiPath: { type: 'string', nullable: true },
    healthEndpoint: { type: 'string', nullable: true },
    workingDir: { type: 'string', nullable: true },
    devCommand: { type: 'string', nullable: true },
    env: {
      type: 'array',
      items: manifestEnvVarSchema,
      nullable: true,
      description: 'Environment variables declared for the service in manifests, including placeholder metadata.'
    },
    apps: {
      type: 'array',
      items: { type: 'string' },
      description: 'IDs of apps that are linked to this service through service networks.',
      nullable: true
    },
    appliedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp indicating when this manifest version was applied.'
    }
  },
  additionalProperties: false
};

const serviceRuntimeMetadataSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  description: 'Runtime details gathered from the containerized app connected to the service.',
  properties: {
    repositoryId: { type: 'string', description: 'Repository ID providing the runtime implementation.' },
    launchId: { type: 'string', nullable: true },
    instanceUrl: { type: 'string', format: 'uri', nullable: true },
    baseUrl: { type: 'string', format: 'uri', nullable: true },
    previewUrl: { type: 'string', format: 'uri', nullable: true },
    host: { type: 'string', nullable: true },
    port: { type: 'integer', minimum: 0, maximum: 65535, nullable: true },
    containerIp: { type: 'string', nullable: true },
    containerPort: { type: 'integer', minimum: 0, maximum: 65535, nullable: true },
    containerBaseUrl: { type: 'string', format: 'uri', nullable: true },
    source: { type: 'string', nullable: true, description: 'Origin of the runtime snapshot (for example, service-network synchronizer).' },
    status: { type: 'string', enum: ['running', 'stopped'], nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true }
  },
  additionalProperties: false
};

const serviceMetadataSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  description: 'Structured metadata describing how a service is sourced, linked, and executed.',
  additionalProperties: true
};

const serviceSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'slug', 'displayName', 'kind', 'baseUrl', 'source', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    displayName: { type: 'string' },
    kind: { type: 'string' },
    baseUrl: { type: 'string', format: 'uri' },
    source: {
      type: 'string',
      enum: ['external', 'module']
    },
    status: {
      type: 'string',
      enum: ['unknown', 'healthy', 'degraded', 'unreachable']
    },
    statusMessage: nullable(stringSchema()),
    capabilities: nullable(jsonValueSchema),
    metadata: nullable(serviceMetadataSchema),
    openapi: nullable(jsonValueSchema),
    lastHealthyAt: nullable(stringSchema('date-time')),
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    health: nullable({
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['unknown', 'healthy', 'degraded', 'unreachable']
        },
        statusMessage: nullable(stringSchema()),
        checkedAt: nullable(stringSchema('date-time')),
        latencyMs: nullable(integerSchema()),
        statusCode: nullable(integerSchema()),
        baseUrl: nullable(stringSchema()),
        healthEndpoint: nullable(stringSchema())
      }
    })
  }
};

const serviceListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: serviceSchema },
    meta: {
      type: 'object',
      required: ['total', 'healthyCount', 'unhealthyCount', 'sourceCounts'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        healthyCount: { type: 'integer', minimum: 0 },
        unhealthyCount: { type: 'integer', minimum: 0 },
        filters: nullable({
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', enum: ['module', 'external'] }
          }
        }),
        sourceCounts: {
          type: 'object',
          required: ['module', 'external'],
          properties: {
            module: { type: 'integer', minimum: 0 },
            external: { type: 'integer', minimum: 0 }
          }
        }
      }
    }
  }
};

const serviceResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: serviceSchema
  }
};

const serviceRegistrationRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['slug', 'displayName', 'kind', 'baseUrl'],
  properties: {
    slug: { type: 'string', description: 'Unique identifier for the service.' },
    displayName: { type: 'string' },
    kind: { type: 'string', description: 'Service kind or integration type.' },
    baseUrl: { type: 'string', format: 'uri' },
    status: {
      type: 'string',
      enum: ['unknown', 'healthy', 'degraded', 'unreachable']
    },
    statusMessage: nullable(stringSchema()),
    capabilities: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      description: 'Optional capability metadata exposed by the service.'
    },
    metadata: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      description: 'Optional metadata describing manifest provenance, linked apps, and runtime expectations.'
    },
    source: {
      type: 'string',
      enum: ['external', 'module'],
      description: 'Source type. External registrations must use "external".'
    }
  }
};

const moduleArtifactUploadRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['moduleId', 'moduleVersion', 'manifest', 'artifact'],
  properties: {
    moduleId: { type: 'string', minLength: 1 },
    moduleVersion: { type: 'string', minLength: 1 },
    displayName: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    keywords: {
      type: 'array',
      items: { type: 'string', minLength: 1 }
    },
    manifest: { type: 'object' },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        filename: { type: 'string', minLength: 1 },
        contentType: { type: 'string', minLength: 1 },
        data: {
          type: 'string',
          minLength: 1,
          description: 'Base64-encoded module bundle contents.'
        }
      }
    }
  }
};

const moduleArtifactResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    module: { type: 'object', additionalProperties: true },
    artifact: { type: 'object', additionalProperties: true }
  }
};

const jobRetryPolicySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
    strategy: { type: 'string', enum: ['none', 'fixed', 'exponential'] },
    initialDelayMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
    maxDelayMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
    jitter: { type: 'string', enum: ['none', 'full', 'equal'] }
  }
};

const jobDefinitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'slug',
    'name',
    'version',
    'type',
    'runtime',
    'entryPoint',
    'parametersSchema',
    'defaultParameters',
    'outputSchema',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'integer' },
    type: { type: 'string', enum: ['batch', 'service-triggered', 'manual'] },
    runtime: { type: 'string', enum: ['node', 'python', 'docker', 'module'] },
    entryPoint: { type: 'string' },
    parametersSchema: nullable(jsonLooseObjectSchema),
    defaultParameters: nullable(jsonLooseObjectSchema),
    outputSchema: nullable(jsonLooseObjectSchema),
    timeoutMs: nullable(integerSchema()),
    retryPolicy: nullable(jobRetryPolicySchema),
    metadata: nullable(jsonValueSchema),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const jobDefinitionCreateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['slug', 'name', 'type', 'entryPoint'],
  properties: {
    slug: {
      type: 'string',
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9-_]*$',
      minLength: 1,
      maxLength: 100
    },
    name: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    type: { type: 'string', enum: ['batch', 'service-triggered', 'manual'] },
    runtime: { type: 'string', enum: ['node', 'python', 'docker', 'module'], default: 'node' },
    entryPoint: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1000, maximum: 86_400_000 },
    retryPolicy: jobRetryPolicySchema,
    parametersSchema: nullable(jsonLooseObjectSchema),
    defaultParameters: nullable(jsonLooseObjectSchema),
    outputSchema: nullable(jsonLooseObjectSchema),
    metadata: jsonValueSchema
  }
};

const jobDefinitionListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: jobDefinitionSchema }
  }
};

const jobDefinitionResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: jobDefinitionSchema
  }
};

const jobDefinitionUpdateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 },
    type: { type: 'string', enum: ['batch', 'service-triggered', 'manual'] },
    runtime: { type: 'string', enum: ['node', 'python', 'docker', 'module'] },
    entryPoint: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1000, maximum: 86_400_000 },
    retryPolicy: jobRetryPolicySchema,
    parametersSchema: nullable(jsonLooseObjectSchema),
    defaultParameters: nullable(jsonLooseObjectSchema),
    outputSchema: nullable(jsonLooseObjectSchema),
    metadata: jsonValueSchema
  }
};

const jobRunSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'jobDefinitionId',
    'status',
    'parameters',
    'result',
    'context',
    'metrics',
    'attempt',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    jobDefinitionId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled', 'expired']
    },
    parameters: schemaRef('JsonValue'),
    result: schemaRef('JsonValue'),
    errorMessage: { type: 'string', nullable: true },
    logsUrl: { type: 'string', format: 'uri', nullable: true },
    metrics: schemaRef('JsonValue'),
    context: schemaRef('JsonValue'),
    timeoutMs: { type: 'integer', nullable: true, minimum: 0 },
    attempt: { type: 'integer', minimum: 1 },
    maxAttempts: { type: 'integer', nullable: true, minimum: 1 },
    durationMs: { type: 'integer', nullable: true, minimum: 0 },
    scheduledAt: { type: 'string', format: 'date-time', nullable: true },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

const jobRunWithDefinitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['run', 'job'],
  properties: {
    run: jobRunSchema,
    job: {
      type: 'object',
      required: ['id', 'slug', 'name', 'version', 'type', 'runtime'],
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        type: { type: 'string', enum: ['batch', 'service-triggered', 'manual'] },
        runtime: { type: 'string', enum: ['node', 'python', 'docker', 'module'] }
      }
    }
  }
};

const jobRunListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: jobRunWithDefinitionSchema },
    meta: {
      type: 'object',
      required: ['limit', 'offset', 'hasMore', 'nextOffset'],
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0 },
        hasMore: { type: 'boolean' },
        nextOffset: { type: 'integer', nullable: true, minimum: 0 }
      }
    }
  }
};

const jobDetailResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      required: ['job', 'runs'],
      properties: {
        job: jobDefinitionSchema,
        runs: { type: 'array', items: jobRunSchema }
      }
    },
    meta: {
      type: 'object',
      required: ['limit', 'offset'],
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0 }
      }
    }
  }
};

const runtimeReadinessSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['runtime', 'ready', 'reason', 'checkedAt', 'details'],
  properties: {
    runtime: { type: 'string', enum: ['node', 'python', 'docker', 'module'] },
    ready: { type: 'boolean' },
    reason: { type: 'string', nullable: true },
    checkedAt: { type: 'string', format: 'date-time' },
    details: schemaRef('JsonValue')
  }
};

const runtimeReadinessListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: runtimeReadinessSchema }
  }
};

const jobSchemaPreviewSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['parametersSchema', 'outputSchema', 'parametersSource', 'outputSource'],
  properties: {
    parametersSchema: schemaRef('JsonValue'),
    outputSchema: schemaRef('JsonValue'),
    parametersSource: { type: 'string', nullable: true },
    outputSource: { type: 'string', nullable: true }
  }
};

const jobSchemaPreviewResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: jobSchemaPreviewSchema
  }
};

const pythonSnippetPreviewSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['handlerName', 'handlerIsAsync', 'inputModel', 'outputModel'],
  properties: {
    handlerName: { type: 'string' },
    handlerIsAsync: { type: 'boolean' },
    inputModel: {
      type: 'object',
      required: ['name', 'schema'],
      properties: {
        name: { type: 'string' },
        schema: schemaRef('JsonValue')
      }
    },
    outputModel: {
      type: 'object',
      required: ['name', 'schema'],
      properties: {
        name: { type: 'string' },
        schema: schemaRef('JsonValue')
      }
    }
  }
};

const pythonSnippetCreateResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['job', 'analysis', 'bundle'],
      properties: {
        job: jobDefinitionSchema,
        analysis: pythonSnippetPreviewSchema,
        bundle: {
          type: 'object',
          required: ['slug', 'version'],
          properties: {
            slug: { type: 'string' },
            version: { type: 'string' }
          }
        }
      }
    }
  }
};

const bundleRegenerateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['entryPoint', 'manifestPath', 'files'],
  properties: {
    entryPoint: { type: 'string', minLength: 1, maxLength: 256 },
    manifestPath: { type: 'string', minLength: 1, maxLength: 512 },
    manifest: schemaRef('JsonValue'),
    files: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contents'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 512 },
          contents: { type: 'string' },
          encoding: { type: 'string', enum: ['utf8', 'base64'] },
          executable: { type: 'boolean' }
        }
      }
    },
    capabilityFlags: { type: 'array', items: { type: 'string', minLength: 1 } },
    metadata: schemaRef('JsonValue'),
    description: { type: 'string', maxLength: 512, nullable: true },
    displayName: { type: 'string', maxLength: 256, nullable: true },
    version: { type: 'string', maxLength: 100 }
  }
};

const jobRunRequestBodySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    parameters: schemaRef('JsonValue'),
    timeoutMs: { type: 'integer', minimum: 1_000, maximum: 86_400_000 },
    maxAttempts: { type: 'integer', minimum: 1 },
    context: schemaRef('JsonValue')
  }
};

const jobBundleFileSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['path', 'contents'],
  properties: {
    path: { type: 'string', description: 'Relative path of the file inside the bundle.' },
    contents: { type: 'string', description: 'File contents encoded as UTF-8 text or base64.' },
    encoding: {
      type: 'string',
      enum: ['utf8', 'base64'],
      description: 'Encoding of the contents value. Defaults to utf8 when omitted.'
    },
    executable: {
      type: 'boolean',
      description: 'Whether the file should be marked as executable in the generated bundle.'
    }
  }
};

const jobBundleVersionArtifactSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['storage', 'contentType', 'size'],
  properties: {
    storage: { type: 'string', description: 'Where the bundle artifact is stored.' },
    contentType: { type: 'string', description: 'MIME type reported for the bundle artifact.' },
    size: { type: 'integer', description: 'Size of the bundle artifact in bytes.' }
  }
};

const jobBundlePublisherSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['subject', 'kind', 'tokenHash'],
  properties: {
    subject: nullable(stringSchema()),
    kind: nullable(stringSchema()),
    tokenHash: nullable(stringSchema())
  }
};

const jobBundleVersionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'bundleId',
    'slug',
    'version',
    'checksum',
    'capabilityFlags',
    'immutable',
    'status',
    'artifact',
    'metadata',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    bundleId: { type: 'string' },
    slug: { type: 'string' },
    version: { type: 'string' },
    checksum: { type: 'string', description: 'SHA-256 checksum of the stored artifact.' },
    capabilityFlags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Capability flags declared by the bundle.'
    },
    immutable: { type: 'boolean', description: 'Indicates whether further edits to this version are allowed.' },
    status: { type: 'string', description: 'Lifecycle status of the bundle version.' },
    artifact: jobBundleVersionArtifactSchema,
    manifest: jsonValueSchema,
    metadata: jsonValueSchema,
    publishedBy: nullable(jobBundlePublisherSchema),
    publishedAt: nullable(stringSchema('date-time')),
    deprecatedAt: nullable(stringSchema('date-time')),
    replacedAt: nullable(stringSchema('date-time')),
    replacedBy: nullable(stringSchema()),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    download: {
      type: 'object',
      required: ['url', 'expiresAt', 'storage', 'kind'],
      properties: {
        url: { type: 'string', format: 'uri' },
        expiresAt: stringSchema('date-time'),
        storage: { type: 'string' },
        kind: { type: 'string' }
      }
    }
  }
};

const bundleEditorBindingSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['slug', 'version'],
  properties: {
    slug: { type: 'string', description: 'Slug of the bundle bound to the job.' },
    version: { type: 'string', description: 'Version of the bundle referenced by the job entry point.' },
    exportName: {
      type: 'string',
      description: 'Optional export name used when requiring the bundle entry point.',
      nullable: true
    }
  }
};

const bundleEditorHistoryEntrySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['slug', 'version'],
  properties: {
    slug: { type: 'string' },
    version: { type: 'string' },
    checksum: { type: 'string', description: 'Checksum of the generated artifact.' },
    regeneratedAt: stringSchema('date-time')
  }
};

const bundleEditorStateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['job', 'binding', 'bundle', 'editor', 'aiBuilder', 'history', 'suggestionSource', 'availableVersions'],
  properties: {
    job: schemaRef('JobDefinition'),
    binding: bundleEditorBindingSchema,
    bundle: jobBundleVersionSchema,
    editor: {
      type: 'object',
      required: ['entryPoint', 'manifestPath', 'manifest', 'files'],
      properties: {
        entryPoint: { type: 'string', description: 'Relative path of the bundle entry point file.' },
        manifestPath: { type: 'string', description: 'Path to the manifest file within the bundle.' },
        manifest: jsonValueSchema,
        files: { type: 'array', items: jobBundleFileSchema }
      }
    },
    aiBuilder: nullable(jsonValueSchema),
    history: {
      type: 'array',
      items: bundleEditorHistoryEntrySchema,
      description: 'History of AI generated bundle versions associated with this job.'
    },
    suggestionSource: {
      type: 'string',
      enum: ['metadata', 'artifact'],
      description: 'Source used to build the current editor suggestion.'
    },
    availableVersions: {
      type: 'array',
      items: jobBundleVersionSchema,
      description: 'Previously published bundle versions available for selection.'
    }
  }
};

const bundleEditorResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: bundleEditorStateSchema
  }
};

const aiBundleEditProviderOptionsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    openAiApiKey: { type: 'string', description: 'API key to authorize calls to OpenAI models.' },
    openAiBaseUrl: {
      type: 'string',
      format: 'uri',
      description: 'Override for the OpenAI API base URL when routing requests through a proxy.'
    },
    openAiMaxOutputTokens: {
      type: 'integer',
      minimum: 256,
      maximum: 32000,
      description: 'Maximum number of tokens the OpenAI provider may generate in a single response.'
    },
    openRouterApiKey: { type: 'string', description: 'API key used when the OpenRouter provider is selected.' },
    openRouterReferer: {
      type: 'string',
      format: 'uri',
      description: 'Referer value to include when calling OpenRouter.'
    },
    openRouterTitle: {
      type: 'string',
      description: 'Human readable title supplied to OpenRouter when making a request.'
    }
  }
};

const aiBundleEditRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      maxLength: AI_BUNDLE_EDIT_PROMPT_MAX_LENGTH,
      description: 'Instruction describing the desired edits to apply to the job bundle.'
    },
    provider: {
      type: 'string',
      enum: ['codex', 'openai', 'openrouter'],
      description: 'Model provider responsible for generating the bundle edits.'
    },
    providerOptions: {
      allOf: [aiBundleEditProviderOptionsSchema],
      description: 'Provider-specific configuration such as API keys or maximum output tokens.'
    }
  }
};

const workflowTriggerSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string' },
    options: nullable(jsonValueSchema)
  }
};

const workflowJobStepSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'jobSlug'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['job'] },
    jobSlug: { type: 'string' },
    description: nullable(stringSchema()),
    dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 25 },
    parameters: nullable(jsonValueSchema),
    timeoutMs: nullable({ type: 'integer', minimum: 1000, maximum: 86_400_000 }),
    retryPolicy: nullable(jobRetryPolicySchema),
    storeResultAs: nullable(stringSchema())
  }
};

const workflowServiceRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string' },
    method: {
      type: 'string',
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
    },
    headers: {
      type: 'object',
      additionalProperties: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            required: ['secret'],
            properties: {
              secret: {
                type: 'object',
                required: ['source', 'key'],
                properties: {
                  source: { type: 'string', enum: ['env', 'store'] },
                  key: { type: 'string' },
                  version: { type: 'string' }
                }
              },
              prefix: { type: 'string' }
            }
          }
        ]
      }
    },
    query: {
      type: 'object',
      additionalProperties: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }]
      }
    },
    body: nullable(jsonValueSchema)
  }
};

const workflowServiceStepSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'type', 'serviceSlug', 'request'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['service'] },
    serviceSlug: { type: 'string' },
    description: nullable(stringSchema()),
    dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 25 },
    parameters: nullable(jsonValueSchema),
    timeoutMs: nullable({ type: 'integer', minimum: 1000, maximum: 86_400_000 }),
    retryPolicy: nullable(jobRetryPolicySchema),
    requireHealthy: { type: 'boolean' },
    allowDegraded: { type: 'boolean' },
    captureResponse: { type: 'boolean' },
    storeResponseAs: stringSchema(),
    request: workflowServiceRequestSchema
  }
};

const workflowFanOutTemplateSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    workflowJobStepSchema,
    workflowServiceStepSchema
  ]
};

const workflowFanOutStepSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'type', 'collection', 'template'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['fanout'] },
    description: nullable(stringSchema()),
    dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 25 },
    collection: jsonValueSchema,
    template: workflowFanOutTemplateSchema,
    maxItems: nullable({ type: 'integer', minimum: 1, maximum: 10000 }),
    maxConcurrency: nullable({ type: 'integer', minimum: 1, maximum: 1000 }),
    storeResultsAs: stringSchema()
  }
};

const workflowStepSchema: OpenAPIV3.SchemaObject = {
  oneOf: [workflowJobStepSchema, workflowServiceStepSchema, workflowFanOutStepSchema]
};

const workflowDefinitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'slug',
    'name',
    'version',
    'steps',
    'triggers',
    'parametersSchema',
    'defaultParameters',
    'outputSchema',
    'dag',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'integer' },
    description: nullable(stringSchema()),
    steps: { type: 'array', items: workflowStepSchema, minItems: 1, maxItems: 100 },
    triggers: { type: 'array', items: workflowTriggerSchema },
    parametersSchema: nullable(jsonLooseObjectSchema),
    defaultParameters: nullable(jsonLooseObjectSchema),
    outputSchema: nullable(jsonLooseObjectSchema),
    metadata: nullable(jsonLooseObjectSchema),
    dag: nullable(jsonLooseObjectSchema),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const workflowDefinitionCreateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['slug', 'name', 'steps'],
  properties: {
    slug: {
      type: 'string',
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9-_]*$',
      minLength: 1,
      maxLength: 100
    },
    name: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    description: { type: 'string' },
    steps: { type: 'array', items: workflowStepSchema, minItems: 1, maxItems: 100 },
    triggers: { type: 'array', items: workflowTriggerSchema },
    parametersSchema: nullable(jsonLooseObjectSchema),
    defaultParameters: nullable(jsonLooseObjectSchema),
    outputSchema: nullable(jsonLooseObjectSchema),
    metadata: nullable(jsonLooseObjectSchema)
  }
};

const workflowDefinitionListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: workflowDefinitionSchema }
  }
};

const workflowDefinitionResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: workflowDefinitionSchema
  }
};

const workflowTopologyAnnotationsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['tags'],
  properties: {
    tags: {
      type: 'array',
      description: 'Annotation tags that can be used for filtering and grouping.',
      items: { type: 'string' }
    },
    ownerName: nullable(stringSchema()),
    ownerContact: nullable(stringSchema()),
    team: nullable(stringSchema()),
    domain: nullable(stringSchema()),
    environment: nullable(stringSchema()),
    slo: nullable(stringSchema())
  }
};

const workflowTopologyAssetFreshnessSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    maxAgeMs: nullable(integerSchema()),
    ttlMs: nullable(integerSchema()),
    cadenceMs: nullable(integerSchema())
  }
};

const workflowTopologyAssetAutoMaterializeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    onUpstreamUpdate: { type: 'boolean' },
    priority: nullable(integerSchema()),
    parameterDefaults: jsonValueSchema
  }
};

const workflowAutoMaterializeAssetUpdateRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['stepId'],
  properties: {
    stepId: { type: 'string', minLength: 1, maxLength: 200 },
    enabled: { type: 'boolean' },
    onUpstreamUpdate: { type: 'boolean' },
    priority: {
      type: 'integer',
      minimum: 0,
      maximum: 1_000_000,
      nullable: true
    },
    parameterDefaults: jsonValueSchema
  },
  allOf: [
    {
      anyOf: [
        { required: ['enabled'] },
        { required: ['onUpstreamUpdate'] },
        { required: ['priority'] },
        { required: ['parameterDefaults'] }
      ]
    }
  ]
};

const workflowAutoMaterializeAssetUpdateResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['assetId', 'stepId', 'autoMaterialize'],
      properties: {
        assetId: { type: 'string' },
        stepId: { type: 'string' },
        autoMaterialize: nullable({ allOf: [workflowTopologyAssetAutoMaterializeSchema] })
      }
    }
  }
};

const workflowTopologyAssetPartitioningSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'granularity'],
      properties: {
        type: { type: 'string', enum: ['timeWindow'] },
        granularity: {
          type: 'string',
          enum: ['minute', 'hour', 'day', 'week', 'month']
        },
        timezone: nullable(stringSchema()),
        format: nullable(stringSchema()),
        lookbackWindows: nullable(integerSchema())
      }
    },
    {
      type: 'object',
      required: ['type', 'keys'],
      properties: {
        type: { type: 'string', enum: ['static'] },
        keys: { type: 'array', items: { type: 'string' } }
      }
    },
    {
      type: 'object',
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['dynamic'] },
        maxKeys: nullable(integerSchema()),
        retentionDays: nullable(integerSchema())
      }
    }
  ]
};

const workflowTopologyTriggerScheduleSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['cron'],
  properties: {
    cron: { type: 'string' },
    timezone: nullable(stringSchema()),
    startWindow: nullable(stringSchema()),
    endWindow: nullable(stringSchema()),
    catchUp: { type: 'boolean', nullable: true }
  }
};

const workflowTopologyEventTriggerPredicateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['type', 'path', 'operator'],
  properties: {
    type: { type: 'string', enum: ['jsonPath'] },
    path: { type: 'string' },
    operator: { type: 'string' },
    value: jsonValueSchema,
    values: {
      type: 'array',
      items: jsonValueSchema
    },
    caseSensitive: { type: 'boolean' },
    flags: nullable(stringSchema())
  }
};

const workflowTopologyDefinitionTriggerNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'workflowId', 'kind', 'triggerType'],
  properties: {
    id: { type: 'string' },
    workflowId: { type: 'string' },
    kind: { type: 'string', enum: ['definition'] },
    triggerType: { type: 'string' },
    options: jsonValueSchema,
    schedule: nullable({ allOf: [workflowTopologyTriggerScheduleSchema] })
  }
};

const workflowTopologyEventTriggerNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'workflowId',
    'kind',
    'status',
    'eventType',
    'predicates',
    'parameterTemplate',
    'runKeyTemplate',
    'throttleWindowMs',
    'throttleCount',
    'maxConcurrency',
    'idempotencyKeyExpression',
    'metadata',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    workflowId: { type: 'string' },
    kind: { type: 'string', enum: ['event'] },
    name: nullable(stringSchema()),
    description: nullable(stringSchema()),
    status: { type: 'string', enum: ['active', 'disabled'] },
    eventType: { type: 'string' },
    eventSource: nullable(stringSchema()),
    predicates: {
      type: 'array',
      items: workflowTopologyEventTriggerPredicateSchema
    },
    parameterTemplate: jsonValueSchema,
    runKeyTemplate: nullable(stringSchema()),
    throttleWindowMs: nullable(integerSchema()),
    throttleCount: nullable(integerSchema()),
    maxConcurrency: nullable(integerSchema()),
    idempotencyKeyExpression: nullable(stringSchema()),
    metadata: jsonValueSchema,
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time'),
    createdBy: nullable(stringSchema()),
    updatedBy: nullable(stringSchema())
  }
};

const workflowTopologyTriggerNodeSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    workflowTopologyDefinitionTriggerNodeSchema,
    workflowTopologyEventTriggerNodeSchema
  ]
};

const workflowTopologyScheduleNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'id',
    'workflowId',
    'cron',
    'timezone',
    'parameters',
    'startWindow',
    'endWindow',
    'catchUp',
    'nextRunAt',
    'isActive',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    workflowId: { type: 'string' },
    name: nullable(stringSchema()),
    description: nullable(stringSchema()),
    cron: { type: 'string' },
    timezone: nullable(stringSchema()),
    parameters: jsonValueSchema,
    startWindow: nullable(stringSchema()),
    endWindow: nullable(stringSchema()),
    catchUp: { type: 'boolean' },
    nextRunAt: nullable(stringSchema('date-time')),
    isActive: { type: 'boolean' },
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const workflowTopologyJobStepRuntimeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['type', 'jobSlug'],
  properties: {
    type: { type: 'string', enum: ['job'] },
    jobSlug: { type: 'string' },
    bundleStrategy: nullable({ type: 'string', enum: ['latest', 'pinned'] }),
    bundleSlug: nullable(stringSchema()),
    bundleVersion: nullable(stringSchema()),
    exportName: nullable(stringSchema()),
    timeoutMs: nullable(integerSchema())
  }
};

const workflowTopologyServiceStepRuntimeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['type', 'serviceSlug'],
  properties: {
    type: { type: 'string', enum: ['service'] },
    serviceSlug: { type: 'string' },
    timeoutMs: nullable(integerSchema()),
    requireHealthy: { type: 'boolean', nullable: true },
    allowDegraded: { type: 'boolean', nullable: true },
    captureResponse: { type: 'boolean', nullable: true }
  }
};

const workflowTopologyStepTemplateSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'runtime'],
  properties: {
    id: { type: 'string' },
    name: nullable(stringSchema()),
    runtime: {
      oneOf: [
        workflowTopologyJobStepRuntimeSchema,
        workflowTopologyServiceStepRuntimeSchema
      ]
    }
  }
};

const workflowTopologyFanOutStepRuntimeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['type', 'collection', 'template'],
  properties: {
    type: { type: 'string', enum: ['fanout'] },
    collection: jsonValueSchema,
    maxItems: nullable(integerSchema()),
    maxConcurrency: nullable(integerSchema()),
    storeResultsAs: nullable(stringSchema()),
    template: workflowTopologyStepTemplateSchema
  }
};

const workflowTopologyStepRuntimeSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    workflowTopologyJobStepRuntimeSchema,
    workflowTopologyServiceStepRuntimeSchema,
    workflowTopologyFanOutStepRuntimeSchema
  ]
};

const workflowTopologyStepNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'workflowId', 'name', 'type', 'dependsOn', 'dependents', 'runtime'],
  properties: {
    id: { type: 'string' },
    workflowId: { type: 'string' },
    name: { type: 'string' },
    description: nullable(stringSchema()),
    type: { type: 'string', enum: ['job', 'service', 'fanout'] },
    dependsOn: { type: 'array', items: { type: 'string' } },
    dependents: { type: 'array', items: { type: 'string' } },
    runtime: workflowTopologyStepRuntimeSchema
  }
};

const workflowTopologyAssetNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'assetId', 'normalizedAssetId', 'annotations'],
  properties: {
    id: { type: 'string' },
    assetId: { type: 'string' },
    normalizedAssetId: { type: 'string' },
    annotations: workflowTopologyAnnotationsSchema
  }
};

const workflowTopologyEventSourceNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'eventType'],
  properties: {
    id: { type: 'string' },
    eventType: { type: 'string' },
    eventSource: nullable(stringSchema())
  }
};

const workflowTopologyTriggerWorkflowEdgeSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    {
      type: 'object',
      required: ['kind', 'triggerId', 'workflowId'],
      properties: {
        kind: { type: 'string', enum: ['event-trigger', 'definition-trigger'] },
        triggerId: { type: 'string' },
        workflowId: { type: 'string' }
      }
    },
    {
      type: 'object',
      required: ['kind', 'scheduleId', 'workflowId'],
      properties: {
        kind: { type: 'string', enum: ['schedule'] },
        scheduleId: { type: 'string' },
        workflowId: { type: 'string' }
      }
    }
  ]
};

const workflowTopologyWorkflowStepEdgeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['workflowId', 'toStepId'],
  properties: {
    workflowId: { type: 'string' },
    fromStepId: nullable(stringSchema()),
    toStepId: { type: 'string' }
  }
};

const workflowTopologyStepAssetEdgeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['workflowId', 'stepId', 'assetId', 'normalizedAssetId', 'direction'],
  properties: {
    workflowId: { type: 'string' },
    stepId: { type: 'string' },
    assetId: { type: 'string' },
    normalizedAssetId: { type: 'string' },
    direction: { type: 'string', enum: ['produces', 'consumes'] },
    freshness: nullable(workflowTopologyAssetFreshnessSchema),
    partitioning: nullable(workflowTopologyAssetPartitioningSchema),
    autoMaterialize: nullable(workflowTopologyAssetAutoMaterializeSchema)
  }
};

const workflowTopologyAssetWorkflowEdgeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['assetId', 'normalizedAssetId', 'workflowId', 'reason'],
  properties: {
    assetId: { type: 'string' },
    normalizedAssetId: { type: 'string' },
    workflowId: { type: 'string' },
    stepId: nullable(stringSchema()),
    reason: { type: 'string', enum: ['auto-materialize'] },
    priority: nullable(integerSchema())
  }
};

const workflowTopologyEventSourceTriggerEdgeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['sourceId', 'triggerId'],
  properties: {
    sourceId: { type: 'string' },
    triggerId: { type: 'string' }
  }
};

const workflowTopologyEdgeConfidenceSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['sampleCount', 'lastSeenAt'],
  properties: {
    sampleCount: { type: 'integer', minimum: 0 },
    lastSeenAt: stringSchema('date-time')
  }
};

const workflowTopologyStepEventSourceEdgeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['workflowId', 'stepId', 'sourceId', 'kind', 'confidence'],
  properties: {
    workflowId: { type: 'string' },
    stepId: { type: 'string' },
    sourceId: { type: 'string' },
    kind: { type: 'string', enum: ['inferred'] },
    confidence: workflowTopologyEdgeConfidenceSchema
  }
};

const workflowTopologyGraphSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['version', 'generatedAt', 'nodes', 'edges'],
  properties: {
    version: { type: 'string', enum: ['v1', 'v2'] },
    generatedAt: stringSchema('date-time'),
    nodes: {
      type: 'object',
      required: ['workflows', 'steps', 'triggers', 'schedules', 'assets', 'eventSources'],
      properties: {
        workflows: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'slug', 'name', 'version', 'createdAt', 'updatedAt', 'annotations'],
            properties: {
              id: { type: 'string' },
              slug: { type: 'string' },
              name: { type: 'string' },
              version: { type: 'integer' },
              description: nullable(stringSchema()),
              createdAt: stringSchema('date-time'),
              updatedAt: stringSchema('date-time'),
              metadata: nullable({
                type: 'object',
                additionalProperties: jsonValueSchema
              }),
              annotations: workflowTopologyAnnotationsSchema
            }
          }
        },
        steps: { type: 'array', items: workflowTopologyStepNodeSchema },
        triggers: { type: 'array', items: workflowTopologyTriggerNodeSchema },
        schedules: { type: 'array', items: workflowTopologyScheduleNodeSchema },
        assets: { type: 'array', items: workflowTopologyAssetNodeSchema },
        eventSources: { type: 'array', items: workflowTopologyEventSourceNodeSchema }
      }
    },
    edges: {
      type: 'object',
      required: [
        'triggerToWorkflow',
        'workflowToStep',
        'stepToAsset',
        'assetToWorkflow',
        'eventSourceToTrigger',
        'stepToEventSource'
      ],
      properties: {
        triggerToWorkflow: { type: 'array', items: workflowTopologyTriggerWorkflowEdgeSchema },
        workflowToStep: { type: 'array', items: workflowTopologyWorkflowStepEdgeSchema },
        stepToAsset: { type: 'array', items: workflowTopologyStepAssetEdgeSchema },
        assetToWorkflow: { type: 'array', items: workflowTopologyAssetWorkflowEdgeSchema },
        eventSourceToTrigger: { type: 'array', items: workflowTopologyEventSourceTriggerEdgeSchema },
        stepToEventSource: { type: 'array', items: workflowTopologyStepEventSourceEdgeSchema }
      }
    }
  }
};

const workflowGraphCacheStatsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['hits', 'misses', 'invalidations'],
  properties: {
    hits: integerSchema(),
    misses: integerSchema(),
    invalidations: integerSchema()
  }
};

const workflowGraphCacheMetaSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['hit', 'stats'],
  properties: {
    hit: { type: 'boolean' },
    cachedAt: nullable(stringSchema('date-time')),
    ageMs: nullable(integerSchema()),
    expiresAt: nullable(stringSchema('date-time')),
    stats: workflowGraphCacheStatsSchema,
    lastInvalidatedAt: nullable(stringSchema('date-time')),
    lastInvalidationReason: nullable(stringSchema())
  }
};

const workflowGraphResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: workflowTopologyGraphSchema,
    meta: {
      type: 'object',
      required: ['cache'],
      properties: {
        cache: workflowGraphCacheMetaSchema
      }
    }
  }
};

const workflowRunSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'workflowDefinitionId', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    workflowDefinitionId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled']
    },
    parameters: jsonValueSchema,
    context: jsonValueSchema,
    output: jsonValueSchema,
    errorMessage: nullable(stringSchema()),
    currentStepId: nullable(stringSchema()),
    currentStepIndex: nullable(integerSchema()),
    metrics: nullable(jsonValueSchema),
    triggeredBy: nullable(stringSchema()),
    trigger: jsonValueSchema,
    partitionKey: nullable(stringSchema()),
    startedAt: nullable(stringSchema('date-time')),
    completedAt: nullable(stringSchema('date-time')),
    durationMs: nullable(integerSchema()),
    createdAt: stringSchema('date-time'),
    updatedAt: stringSchema('date-time')
  }
};

const workflowAutoMaterializeInFlightSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['reason', 'requestedAt', 'claimedAt', 'claimOwner'],
  properties: {
    workflowRunId: nullable(stringSchema()),
    reason: { type: 'string' },
    assetId: nullable(stringSchema()),
    partitionKey: nullable(stringSchema()),
    requestedAt: stringSchema('date-time'),
    claimedAt: stringSchema('date-time'),
    claimOwner: { type: 'string' },
    context: nullable(jsonValueSchema)
  }
};

const workflowAutoMaterializeCooldownSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['failures'],
  properties: {
    failures: { type: 'integer', minimum: 0 },
    nextEligibleAt: nullable(stringSchema('date-time'))
  }
};

const workflowAutoMaterializeOpsResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['runs', 'inFlight', 'cooldown', 'updatedAt'],
      properties: {
        runs: { type: 'array', items: schemaRef('WorkflowRun') },
        inFlight: nullableRef('WorkflowAutoMaterializeInFlight'),
        cooldown: nullableRef('WorkflowAutoMaterializeCooldown'),
        updatedAt: stringSchema('date-time')
      }
    },
    meta: {
      type: 'object',
      properties: {
        workflow: {
          type: 'object',
          required: ['id', 'slug', 'name'],
          properties: {
            id: { type: 'string' },
            slug: { type: 'string' },
            name: { type: 'string' }
          }
        },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0 }
      }
    }
  }
};

const assetGraphProducerSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'workflowId',
    'workflowSlug',
    'workflowName',
    'stepId',
    'stepName',
    'stepType',
    'partitioning',
    'autoMaterialize',
    'freshness'
  ],
  properties: {
    workflowId: { type: 'string' },
    workflowSlug: { type: 'string' },
    workflowName: { type: 'string' },
    stepId: { type: 'string' },
    stepName: { type: 'string' },
    stepType: { type: 'string', enum: ['job', 'service', 'fanout'] },
    partitioning: nullable(jsonValueSchema),
    autoMaterialize: nullable(jsonValueSchema),
    freshness: nullable(jsonValueSchema)
  }
};

const assetGraphConsumerSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['workflowId', 'workflowSlug', 'workflowName', 'stepId', 'stepName', 'stepType'],
  properties: {
    workflowId: { type: 'string' },
    workflowSlug: { type: 'string' },
    workflowName: { type: 'string' },
    stepId: { type: 'string' },
    stepName: { type: 'string' },
    stepType: { type: 'string', enum: ['job', 'service', 'fanout'] }
  }
};

const assetGraphMaterializationSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'workflowId',
    'workflowSlug',
    'workflowName',
    'runId',
    'stepId',
    'stepName',
    'stepType',
    'runStatus',
    'stepStatus',
    'producedAt',
    'partitionKey',
    'freshness',
    'runStartedAt',
    'runCompletedAt'
  ],
  properties: {
    workflowId: { type: 'string' },
    workflowSlug: { type: 'string' },
    workflowName: { type: 'string' },
    runId: { type: 'string' },
    stepId: { type: 'string' },
    stepName: { type: 'string' },
    stepType: { type: 'string', enum: ['job', 'service', 'fanout'] },
    runStatus: { type: 'string', enum: ['pending', 'running', 'succeeded', 'failed', 'canceled'] },
    stepStatus: { type: 'string', enum: ['pending', 'running', 'succeeded', 'failed', 'skipped'] },
    producedAt: stringSchema('date-time'),
    partitionKey: nullable(stringSchema()),
    freshness: nullable(jsonValueSchema),
    runStartedAt: nullable(stringSchema('date-time')),
    runCompletedAt: nullable(stringSchema('date-time'))
  }
};

const assetGraphStalePartitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['workflowId', 'workflowSlug', 'workflowName', 'partitionKey', 'requestedAt', 'requestedBy', 'note'],
  properties: {
    workflowId: { type: 'string' },
    workflowSlug: { type: 'string' },
    workflowName: { type: 'string' },
    partitionKey: nullable(stringSchema()),
    requestedAt: stringSchema('date-time'),
    requestedBy: nullable(stringSchema()),
    note: nullable(stringSchema())
  }
};

const assetGraphNodeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'assetId',
    'normalizedAssetId',
    'producers',
    'consumers',
    'latestMaterializations',
    'stalePartitions',
  'hasStalePartitions',
  'hasOutdatedUpstreams',
  'outdatedUpstreamAssetIds'
  ],
  properties: {
    assetId: { type: 'string' },
    normalizedAssetId: { type: 'string' },
    producers: { type: 'array', items: assetGraphProducerSchema },
    consumers: { type: 'array', items: assetGraphConsumerSchema },
    latestMaterializations: { type: 'array', items: assetGraphMaterializationSchema },
    stalePartitions: { type: 'array', items: assetGraphStalePartitionSchema },
    hasStalePartitions: { type: 'boolean' },
    hasOutdatedUpstreams: { type: 'boolean' },
    outdatedUpstreamAssetIds: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

const assetGraphEdgeSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'fromAssetId',
    'fromAssetNormalizedId',
    'toAssetId',
    'toAssetNormalizedId',
    'workflowId',
    'workflowSlug',
    'workflowName',
    'stepId',
    'stepName',
    'stepType'
  ],
  properties: {
    fromAssetId: { type: 'string' },
    fromAssetNormalizedId: { type: 'string' },
    toAssetId: { type: 'string' },
    toAssetNormalizedId: { type: 'string' },
    workflowId: { type: 'string' },
    workflowSlug: { type: 'string' },
    workflowName: { type: 'string' },
    stepId: { type: 'string' },
    stepName: { type: 'string' },
    stepType: { type: 'string', enum: ['job', 'service', 'fanout'] }
  }
};

const assetGraphResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['assets', 'edges'],
      properties: {
        assets: { type: 'array', items: assetGraphNodeSchema },
        edges: { type: 'array', items: assetGraphEdgeSchema }
      }
    }
  }
};

const assetMarkStaleRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    partitionKey: { type: 'string', minLength: 1, maxLength: 200 },
    note: { type: 'string', minLength: 1, maxLength: 500 }
  },
  additionalProperties: false
};

const streamingBrokerStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['configured', 'reachable', 'lastCheckedAt', 'error'],
  properties: {
    configured: { type: 'boolean' },
    reachable: { type: 'boolean', nullable: true },
    lastCheckedAt: nullable(stringSchema('date-time')),
    error: nullable(stringSchema())
  }
};

const streamingBatcherConnectorStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'connectorId',
    'datasetSlug',
    'topic',
    'groupId',
    'state',
    'bufferedWindows',
    'bufferedRows',
    'openWindows',
    'lastMessageAt',
    'lastFlushAt',
    'lastEventTimestamp',
    'lastError'
  ],
  properties: {
    connectorId: stringSchema(),
    datasetSlug: stringSchema(),
    topic: stringSchema(),
    groupId: stringSchema(),
    state: { type: 'string', enum: ['starting', 'running', 'stopped', 'error'] },
    bufferedWindows: integerSchema(),
    bufferedRows: integerSchema(),
    openWindows: integerSchema(),
    lastMessageAt: nullable(stringSchema('date-time')),
    lastFlushAt: nullable(stringSchema('date-time')),
    lastEventTimestamp: nullable(stringSchema('date-time')),
    lastError: nullable(stringSchema())
  }
};

const streamingBatcherStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['configured', 'running', 'failing', 'state', 'connectors'],
  properties: {
    configured: integerSchema(),
    running: integerSchema(),
    failing: integerSchema(),
    state: { type: 'string', enum: ['disabled', 'ready', 'degraded'] },
    connectors: {
      type: 'array',
      items: streamingBatcherConnectorStatusSchema
    }
  }
};

const streamingMirrorTopicDiagnosticsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['topic', 'lastSuccessAt', 'lastFailureAt', 'failureCount', 'lastError'],
  properties: {
    topic: stringSchema(),
    lastSuccessAt: nullable(stringSchema('date-time')),
    lastFailureAt: nullable(stringSchema('date-time')),
    failureCount: integerSchema(),
    lastError: nullable(stringSchema())
  }
};

const streamingMirrorSourceDiagnosticsSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'source',
    'total',
    'throttled',
    'dropped',
    'failures',
    'averageLagMs',
    'lastLagMs',
    'maxLagMs',
    'lastEventAt'
  ],
  properties: {
    source: stringSchema(),
    total: integerSchema(),
    throttled: integerSchema(),
    dropped: integerSchema(),
    failures: integerSchema(),
    averageLagMs: nullable(integerSchema()),
    lastLagMs: integerSchema(),
    maxLagMs: integerSchema(),
    lastEventAt: nullable(stringSchema('date-time'))
  }
};

const streamingMirrorSummarySchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['totalEvents', 'totalThrottled', 'totalDropped', 'totalFailures'],
  properties: {
    totalEvents: integerSchema(),
    totalThrottled: integerSchema(),
    totalDropped: integerSchema(),
    totalFailures: integerSchema()
  }
};

const streamingMirrorPublisherStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: [
    'configured',
    'lastSuccessAt',
    'lastFailureAt',
    'failureCount',
    'lastError',
    'broker',
    'topics',
    'sources',
    'summary'
  ],
  properties: {
    configured: { type: 'boolean' },
    lastSuccessAt: nullable(stringSchema('date-time')),
    lastFailureAt: nullable(stringSchema('date-time')),
    failureCount: integerSchema(),
    lastError: nullable(stringSchema()),
    broker: {
      type: 'object',
      required: ['url'],
      properties: {
        url: nullable(stringSchema())
      }
    },
    topics: {
      type: 'array',
      items: streamingMirrorTopicDiagnosticsSchema
    },
    sources: {
      type: 'array',
      items: streamingMirrorSourceDiagnosticsSchema
    },
    summary: streamingMirrorSummarySchema
  }
};

const streamingStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['enabled', 'state', 'reason', 'broker', 'batchers', 'hotBuffer'],
  properties: {
    enabled: { type: 'boolean' },
    state: { type: 'string', enum: ['disabled', 'ready', 'degraded', 'unconfigured'] },
    reason: nullable(stringSchema()),
    broker: streamingBrokerStatusSchema,
    batchers: streamingBatcherStatusSchema,
    hotBuffer: {
      type: 'object',
      required: ['enabled', 'state', 'datasets', 'healthy', 'lastRefreshAt', 'lastIngestAt'],
      properties: {
        enabled: { type: 'boolean' },
        state: { type: 'string', enum: ['disabled', 'ready', 'unavailable'] },
        datasets: integerSchema(),
        healthy: { type: 'boolean' },
        lastRefreshAt: nullable(stringSchema('date-time')),
        lastIngestAt: nullable(stringSchema('date-time'))
      }
    },
    mirrors: {
      type: 'object',
      additionalProperties: { type: 'boolean' },
      properties: {
        workflowRuns: { type: 'boolean' },
        workflowEvents: { type: 'boolean' },
        jobRuns: { type: 'boolean' },
        ingestion: { type: 'boolean' },
        coreEvents: { type: 'boolean' }
      }
    },
    publisher: streamingMirrorPublisherStatusSchema
  }
};

const eventSchemaStatusSchema: OpenAPIV3.SchemaObject = {
  type: 'string',
  enum: ['draft', 'active', 'deprecated']
};

const eventSchemaDefinitionSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['eventType', 'version', 'status', 'schemaHash', 'schema', 'createdAt', 'updatedAt'],
  properties: {
    eventType: stringSchema(),
    version: integerSchema(),
    status: eventSchemaStatusSchema,
    schemaHash: stringSchema(),
    schema: jsonLooseObjectSchema,
    metadata: nullable(jsonLooseObjectSchema),
    createdAt: stringSchema('date-time'),
    createdBy: nullable(stringSchema()),
    updatedAt: stringSchema('date-time'),
    updatedBy: nullable(stringSchema())
  }
};

const eventSchemaListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['schemas'],
  properties: {
    schemas: {
      type: 'array',
      items: eventSchemaDefinitionSchema
    }
  }
};

const eventSchemaRegisterRequestSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['eventType', 'schema'],
  properties: {
    eventType: stringSchema(),
    version: nullable(integerSchema()),
    status: eventSchemaStatusSchema,
    schema: jsonLooseObjectSchema,
    metadata: nullable(jsonLooseObjectSchema),
    author: nullable(stringSchema())
  }
};

const eventSchemaRegisterResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['schema'],
  properties: {
    schema: eventSchemaDefinitionSchema
  }
};

const healthResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'features'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      default: []
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

const healthUnavailableResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'features'],
  properties: {
    status: { type: 'string', enum: ['unavailable', 'degraded'] },
    warnings: {
      type: 'array',
      items: { type: 'string' }
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

const readyResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status', 'features'],
  properties: {
    status: { type: 'string', enum: ['ready'] },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      default: []
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
  required: ['status', 'features'],
  properties: {
    status: { type: 'string', enum: ['unavailable', 'degraded'] },
    warnings: {
      type: 'array',
      items: { type: 'string' }
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

const errorResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: jsonValueSchema
  }
};

const components: OpenAPIV3.ComponentsObject = {
  schemas: {
    JsonValue: jsonValueSchema,
    EventEnvelope: eventEnvelopeSchema,
    EventPublishRequest: eventPublishRequestSchema,
    EventPublishResponse: eventPublishResponseSchema,
    RepositoryTag: repositoryTagSchema,
    LaunchEnvVar: launchEnvVarSchema,
    Build: buildSchema,
    Launch: launchSchema,
    RepositoryPreview: repositoryPreviewSchema,
    RepositoryRelevanceComponent: repositoryRelevanceComponentSchema,
    RepositoryRelevance: repositoryRelevanceSchema,
    Repository: repositorySchema,
    RepositoryListResponse: repositoryListResponseSchema,
    RepositoryResponse: repositoryResponseSchema,
    SavedCoreSearch: savedCoreSearchSchema,
    SavedCoreSearchResponse: savedCoreSearchResponseSchema,
    SavedCoreSearchListResponse: savedCoreSearchListResponseSchema,
    SavedCoreSearchCreateRequest: savedCoreSearchCreateRequestSchema,
    SavedCoreSearchUpdateRequest: savedCoreSearchUpdateRequestSchema,
    EventSavedViewFilters: eventSavedViewFiltersSchema,
    EventSavedViewAnalytics: eventSavedViewAnalyticsSchema,
    EventSavedView: eventSavedViewSchema,
    EventSavedViewResponse: eventSavedViewResponseSchema,
    EventSavedViewListResponse: eventSavedViewListResponseSchema,
    EventSavedViewCreateRequest: eventSavedViewCreateRequestSchema,
    EventSavedViewUpdateRequest: eventSavedViewUpdateRequestSchema,
    OperatorIdentity: operatorIdentitySchema,
    IdentityResponse: identityResponseSchema,
    RepositoryCreateRequest: createRepositoryRequestSchema,
    TagFacet: tagFacetSchema,
    StatusFacet: statusFacetSchema,
    ServiceManifestMetadata: serviceManifestMetadataSchema,
    ServiceRuntimeMetadata: serviceRuntimeMetadataSchema,
    ServiceMetadata: serviceMetadataSchema,
    Service: serviceSchema,
    ServiceListResponse: serviceListResponseSchema,
    ServiceResponse: serviceResponseSchema,
    ServiceRegistrationRequest: serviceRegistrationRequestSchema,
    ModuleArtifactUploadRequest: moduleArtifactUploadRequestSchema,
    ModuleArtifactResponse: moduleArtifactResponseSchema,
    JobRetryPolicy: jobRetryPolicySchema,
    JobDefinition: jobDefinitionSchema,
    JobDefinitionCreateRequest: jobDefinitionCreateRequestSchema,
    JobDefinitionUpdateRequest: jobDefinitionUpdateRequestSchema,
    JobDefinitionResponse: jobDefinitionResponseSchema,
    JobDefinitionListResponse: jobDefinitionListResponseSchema,
    JobRun: jobRunSchema,
    JobRunWithDefinition: jobRunWithDefinitionSchema,
    JobRunListResponse: jobRunListResponseSchema,
    JobDetailResponse: jobDetailResponseSchema,
    RuntimeReadiness: runtimeReadinessSchema,
    RuntimeReadinessListResponse: runtimeReadinessListResponseSchema,
    JobSchemaPreview: jobSchemaPreviewSchema,
    JobSchemaPreviewResponse: jobSchemaPreviewResponseSchema,
    JobBundleFile: jobBundleFileSchema,
    JobBundleVersion: jobBundleVersionSchema,
    BundleEditorResponse: bundleEditorResponseSchema,
    AiBundleEditRequest: aiBundleEditRequestSchema,
    BundleRegenerateRequest: bundleRegenerateRequestSchema,
    JobRunRequest: jobRunRequestBodySchema,
    WorkflowTrigger: workflowTriggerSchema,
    WorkflowJobStep: workflowJobStepSchema,
    WorkflowServiceStep: workflowServiceStepSchema,
    WorkflowFanOutStep: workflowFanOutStepSchema,
    WorkflowStep: workflowStepSchema,
    WorkflowDefinition: workflowDefinitionSchema,
    WorkflowDefinitionCreateRequest: workflowDefinitionCreateRequestSchema,
    WorkflowDefinitionResponse: workflowDefinitionResponseSchema,
    WorkflowDefinitionListResponse: workflowDefinitionListResponseSchema,
    WorkflowRun: workflowRunSchema,
    WorkflowAutoMaterializeInFlight: workflowAutoMaterializeInFlightSchema,
    WorkflowAutoMaterializeCooldown: workflowAutoMaterializeCooldownSchema,
    WorkflowAutoMaterializeOpsResponse: workflowAutoMaterializeOpsResponseSchema,
    WorkflowAutoMaterializeAssetUpdateRequest: workflowAutoMaterializeAssetUpdateRequestSchema,
    WorkflowAutoMaterializeAssetUpdateResponse: workflowAutoMaterializeAssetUpdateResponseSchema,
    ApiKey: apiKeySchema,
    ApiKeyListResponse: apiKeyListResponseSchema,
    ApiKeyCreateResponse: apiKeyCreateResponseSchema,
    PythonSnippetPreview: pythonSnippetPreviewSchema,
    PythonSnippetCreateResponse: pythonSnippetCreateResponseSchema,
    AssetGraphProducer: assetGraphProducerSchema,
    AssetGraphConsumer: assetGraphConsumerSchema,
    AssetGraphMaterialization: assetGraphMaterializationSchema,
    AssetGraphStalePartition: assetGraphStalePartitionSchema,
    AssetGraphNode: assetGraphNodeSchema,
    AssetGraphEdge: assetGraphEdgeSchema,
    AssetGraphResponse: assetGraphResponseSchema,
    AssetMarkStaleRequest: assetMarkStaleRequestSchema,
    WorkflowTopologyGraph: workflowTopologyGraphSchema,
    WorkflowGraphCacheMeta: workflowGraphCacheMetaSchema,
    WorkflowGraphCacheStats: workflowGraphCacheStatsSchema,
    WorkflowGraphResponse: workflowGraphResponseSchema,
    StreamingBrokerStatus: streamingBrokerStatusSchema,
    StreamingBatcherConnectorStatus: streamingBatcherConnectorStatusSchema,
    StreamingBatcherStatus: streamingBatcherStatusSchema,
    StreamingMirrorTopicDiagnostics: streamingMirrorTopicDiagnosticsSchema,
    StreamingMirrorSourceDiagnostics: streamingMirrorSourceDiagnosticsSchema,
    StreamingMirrorSummary: streamingMirrorSummarySchema,
    StreamingMirrorPublisherStatus: streamingMirrorPublisherStatusSchema,
    StreamingStatus: streamingStatusSchema,
    EventSchemaStatus: eventSchemaStatusSchema,
    EventSchema: eventSchemaDefinitionSchema,
    EventSchemaListResponse: eventSchemaListResponseSchema,
    EventSchemaRegisterRequest: eventSchemaRegisterRequestSchema,
    EventSchemaRegisterResponse: eventSchemaRegisterResponseSchema,
    HealthResponse: healthResponseSchema,
    HealthUnavailableResponse: healthUnavailableResponseSchema,
    ReadyResponse: readyResponseSchema,
    ReadyUnavailableResponse: readyUnavailableResponseSchema,
    ErrorResponse: errorResponseSchema
  },
  securitySchemes: {
    OperatorToken: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'Token',
      description:
        'Operator access token supplied via the Authorization header: `Authorization: Bearer <token>`.'
    },
    ServiceRegistryToken: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'Token',
      description:
        'Service registry token supplied via the Authorization header when registering services.'
    }
  }
};


export const openApiComponents: OpenAPIV3.ComponentsObject = components;

export const openApiInfo: OpenAPIV3.InfoObject = {
  title: 'Apphub Core API',
  version: '1.0.0',
  description:
    'HTTP API for indexing repositories, registering runtime services, and orchestrating automated jobs and workflows.'
};

export const openApiServers: OpenAPIV3.ServerObject[] = [
  {
    url: 'http://127.0.0.1:4000',
    description: 'Local development server'
  }
];

export const openApiTags: OpenAPIV3.TagObject[] = [
  { name: 'System', description: 'Service health and operational endpoints.' },
  { name: 'Auth', description: 'Authentication, session management, and identity inspection.' },
  { name: 'Apps', description: 'Search and management of ingested repositories.' },
  { name: 'Services', description: 'Runtime services discovered and managed by Apphub.' },
  { name: 'Jobs', description: 'Reusable job definitions executed by the platform.' },
  { name: 'Workflows', description: 'Multi-step workflow orchestration definitions.' },
  { name: 'Saved Searches', description: 'Manage reusable core search definitions.' },
  { name: 'Events', description: 'Events explorer health overlays and saved views.' }
];
