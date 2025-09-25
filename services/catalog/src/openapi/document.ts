import type { OpenAPIV3 } from 'openapi-types';

const stringSchema = (format?: string): OpenAPIV3.SchemaObject =>
  format ? { type: 'string', format } : { type: 'string' };

const integerSchema = (): OpenAPIV3.SchemaObject => ({ type: 'integer' });

const AI_BUNDLE_EDIT_PROMPT_MAX_LENGTH = 10_000;

const nullable = (schema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject => ({
  ...schema,
  nullable: true
});

const nullableRef = (ref: string): OpenAPIV3.SchemaObject => ({
  allOf: [{ $ref: ref }],
  nullable: true
});

const jsonValueSchema: OpenAPIV3.SchemaObject = {
  description: 'Arbitrary JSON value.',
  nullable: true,
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'integer' },
    { type: 'boolean' },
    { type: 'array', items: { $ref: '#/components/schemas/JsonValue' } },
    {
      type: 'object',
      additionalProperties: { $ref: '#/components/schemas/JsonValue' }
    }
  ]
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
    latestBuild: nullableRef('#/components/schemas/Build'),
    latestLaunch: nullableRef('#/components/schemas/Launch'),
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
    relevance: nullableRef('#/components/schemas/RepositoryRelevance')
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
    data: { $ref: '#/components/schemas/OperatorIdentity' }
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
          items: { $ref: '#/components/schemas/ApiKey' }
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
        key: { $ref: '#/components/schemas/ApiKey' },
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
    description: { type: 'string', description: 'Short description that appears in the catalog.' },
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
      description: 'Environment variables declared for the service in manifests, including placeholder metadata.',
      nullable: true,
      allOf: [jsonValueSchema]
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
  properties: {
    resourceType: {
      type: 'string',
      enum: ['service'],
      description: 'Discriminator indicating this metadata payload represents a service resource.'
    },
    manifest: {
      nullable: true,
      allOf: [{ $ref: '#/components/schemas/ServiceManifestMetadata' }]
    },
    config: {
      nullable: true,
      allOf: [jsonValueSchema],
      description: 'Raw metadata block forwarded from manifests or config files.'
    },
    runtime: {
      nullable: true,
      allOf: [{ $ref: '#/components/schemas/ServiceRuntimeMetadata' }]
    },
    linkedApps: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
      description: 'Explicit list of app IDs linked to this service beyond manifest hints.'
    },
    notes: { type: 'string', maxLength: 2000, nullable: true }
  },
  additionalProperties: false
};

const serviceSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['id', 'slug', 'displayName', 'kind', 'baseUrl', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    displayName: { type: 'string' },
    kind: { type: 'string' },
    baseUrl: { type: 'string', format: 'uri' },
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
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

const serviceListResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: serviceSchema },
    meta: {
      type: 'object',
      required: ['total', 'healthyCount', 'unhealthyCount'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        healthyCount: { type: 'integer', minimum: 0 },
        unhealthyCount: { type: 'integer', minimum: 0 }
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
    capabilities: jsonValueSchema,
    metadata: {
      nullable: true,
      allOf: [{ $ref: '#/components/schemas/ServiceMetadata' }],
      description: 'Optional metadata describing manifest provenance, linked apps, and runtime expectations.'
    }
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
    runtime: { type: 'string', enum: ['node', 'python'] },
    entryPoint: { type: 'string' },
    parametersSchema: jsonValueSchema,
    defaultParameters: jsonValueSchema,
    outputSchema: jsonValueSchema,
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
    runtime: { type: 'string', enum: ['node', 'python'], default: 'node' },
    entryPoint: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1000, maximum: 86_400_000 },
    retryPolicy: jobRetryPolicySchema,
    parametersSchema: {
      type: 'object',
      additionalProperties: jsonValueSchema
    },
    defaultParameters: {
      type: 'object',
      additionalProperties: jsonValueSchema
    },
    outputSchema: {
      type: 'object',
      additionalProperties: jsonValueSchema
    },
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
    job: { $ref: '#/components/schemas/JobDefinition' },
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
    parametersSchema: jsonValueSchema,
    defaultParameters: jsonValueSchema,
    outputSchema: jsonValueSchema,
    metadata: nullable(jsonValueSchema),
    dag: jsonValueSchema,
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
    parametersSchema: {
      type: 'object',
      additionalProperties: jsonValueSchema
    },
    defaultParameters: jsonValueSchema,
    outputSchema: {
      type: 'object',
      additionalProperties: jsonValueSchema
    },
    metadata: jsonValueSchema
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

const healthResponseSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ok'] }
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
    JobRetryPolicy: jobRetryPolicySchema,
    JobDefinition: jobDefinitionSchema,
    JobDefinitionCreateRequest: jobDefinitionCreateRequestSchema,
    JobDefinitionResponse: jobDefinitionResponseSchema,
    JobDefinitionListResponse: jobDefinitionListResponseSchema,
    JobBundleFile: jobBundleFileSchema,
    JobBundleVersion: jobBundleVersionSchema,
    BundleEditorResponse: bundleEditorResponseSchema,
    AiBundleEditRequest: aiBundleEditRequestSchema,
    WorkflowTrigger: workflowTriggerSchema,
    WorkflowJobStep: workflowJobStepSchema,
    WorkflowServiceStep: workflowServiceStepSchema,
    WorkflowFanOutStep: workflowFanOutStepSchema,
    WorkflowStep: workflowStepSchema,
    WorkflowDefinition: workflowDefinitionSchema,
    WorkflowDefinitionCreateRequest: workflowDefinitionCreateRequestSchema,
    WorkflowDefinitionResponse: workflowDefinitionResponseSchema,
    WorkflowDefinitionListResponse: workflowDefinitionListResponseSchema,
    ApiKey: apiKeySchema,
    ApiKeyListResponse: apiKeyListResponseSchema,
    ApiKeyCreateResponse: apiKeyCreateResponseSchema,
    AssetGraphProducer: assetGraphProducerSchema,
    AssetGraphConsumer: assetGraphConsumerSchema,
    AssetGraphMaterialization: assetGraphMaterializationSchema,
    AssetGraphStalePartition: assetGraphStalePartitionSchema,
    AssetGraphNode: assetGraphNodeSchema,
    AssetGraphEdge: assetGraphEdgeSchema,
    AssetGraphResponse: assetGraphResponseSchema,
    AssetMarkStaleRequest: assetMarkStaleRequestSchema,
    HealthResponse: healthResponseSchema,
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

export const openApiDocument: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'Apphub Catalog API',
    version: '1.0.0',
    description:
      'HTTP API for indexing repositories, registering runtime services, and orchestrating automated jobs and workflows.'
  },
  servers: [
    {
      url: 'http://127.0.0.1:4000',
      description: 'Local development server'
    }
  ],
  tags: [
    { name: 'System', description: 'Service health and operational endpoints.' },
    { name: 'Auth', description: 'Authentication, session management, and identity inspection.' },
    { name: 'Apps', description: 'Search and management of ingested repositories.' },
    { name: 'Services', description: 'Runtime services discovered and managed by Apphub.' },
    { name: 'Jobs', description: 'Reusable job definitions executed by the platform.' },
    { name: 'Workflows', description: 'Multi-step workflow orchestration definitions.' }
  ],
  components,
  paths: {
    '/auth/login': {
      get: {
        tags: ['Auth'],
        summary: 'Initiate OIDC login',
        description: 'Generates an OAuth authorization request and redirects the browser to the configured identity provider.',
        parameters: [
          {
            name: 'redirectTo',
            in: 'query',
            schema: { type: 'string' },
            description: 'Optional relative path to redirect to after successful authentication.'
          }
        ],
        responses: {
          '302': { description: 'Redirect to the external identity provider.' },
          '400': {
            description: 'The request query parameters were invalid.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '503': {
            description: 'Single sign-on is not enabled on this instance.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/auth/callback': {
      get: {
        tags: ['Auth'],
        summary: 'OIDC login callback',
        description: 'Handles the OAuth authorization response, issues a secure session cookie, and redirects back to the application.',
        parameters: [
          { name: 'state', in: 'query', schema: { type: 'string' }, required: true },
          { name: 'code', in: 'query', schema: { type: 'string' }, required: true }
        ],
        responses: {
          '302': { description: 'User is redirected to the requested application page.' },
          '400': {
            description: 'The login state or authorization payload was invalid.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '403': {
            description: 'The authenticated identity is not allowed to access the platform.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '500': {
            description: 'The identity provider request failed.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Terminate current session',
        description: 'Revokes the caller\'s active session and clears the session cookie.',
        security: [{ OperatorToken: [] }],
        responses: {
          '204': { description: 'The session was terminated.' }
        }
      }
    },
    '/auth/identity': {
      get: {
        tags: ['Auth'],
        summary: 'Retrieve authenticated identity',
        description: 'Returns the subject, scopes, and metadata for the active session, API key, or operator token.',
        security: [{ OperatorToken: [] }],
        responses: {
          '200': {
            description: 'Identity details.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/IdentityResponse' } }
            }
          },
          '401': {
            description: 'No valid session or authorization token was provided.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '403': {
            description: 'The caller did not have permission to inspect identity information.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/auth/api-keys': {
      get: {
        tags: ['Auth'],
        summary: 'List API keys',
        description: 'Returns the API keys owned by the authenticated user.',
        security: [{ OperatorToken: [] }],
        responses: {
          '200': {
            description: 'API keys for the current user.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiKeyListResponse' } }
            }
          },
          '401': {
            description: 'No valid session or authorization token was provided.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      },
      post: {
        tags: ['Auth'],
        summary: 'Create API key',
        description: 'Mints a new API key scoped to the authenticated user.',
        security: [{ OperatorToken: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  expiresAt: stringSchema('date-time')
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'API key created successfully.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiKeyCreateResponse' } }
            }
          },
          '400': {
            description: 'The API key request payload was invalid.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '401': {
            description: 'No valid session or authorization token was provided.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/auth/api-keys/{id}': {
      delete: {
        tags: ['Auth'],
        summary: 'Revoke API key',
        description: 'Revokes an API key owned by the authenticated user.',
        security: [{ OperatorToken: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '204': { description: 'The API key was revoked.' },
          '401': {
            description: 'No valid session or authorization token was provided.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '404': {
            description: 'No API key matched the supplied identifier.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe',
        description: 'Returns a simple status payload when the API is healthy.',
        responses: {
          '200': {
            description: 'The API is healthy.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' }
              }
            }
          }
        }
      }
    },
    '/openapi.json': {
      get: {
        tags: ['System'],
        summary: 'OpenAPI specification',
        description: 'Returns the OpenAPI document that describes the catalog API.',
        responses: {
          '200': {
            description: 'OpenAPI document in JSON format.',
            content: {
              'application/json': {
                schema: {
                  type: 'object'
                }
              }
            }
          }
        }
      }
    },
    '/apps': {
      get: {
        tags: ['Apps'],
        summary: 'Search repositories',
        description:
          'Retrieves repositories matching text, tag, and ingest-status filters. Results include aggregated facets and relevance metadata.',
        parameters: [
          {
            name: 'q',
            in: 'query',
            schema: { type: 'string' },
            description: 'Free-text query matched against repository name, description, and tags.'
          },
          {
            name: 'tags',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Space or comma-delimited list of tag filters. Each token is matched against stored tag key/value pairs.'
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Space or comma-delimited list of ingest statuses to include (seed, pending, processing, ready, failed).'
          },
          {
            name: 'ingestedAfter',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Only return repositories ingested on or after the provided ISO timestamp.'
          },
          {
            name: 'ingestedBefore',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Only return repositories ingested on or before the provided ISO timestamp.'
          },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['relevance', 'updated', 'name'] },
            description: 'Sort order applied to search results.'
          },
          {
            name: 'relevance',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Optional JSON-encoded object overriding the name/description/tag relevance weights. All unspecified weights default to configured values.'
          }
        ],
        responses: {
          '200': {
            description: 'Matching repositories were found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RepositoryListResponse' }
              }
            }
          },
          '400': {
            description: 'The supplied query parameters were invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      post: {
        tags: ['Apps'],
        summary: 'Submit a repository for ingestion',
        description:
          'Queues a new repository for ingestion. The payload mirrors the information collected in the Apphub submission form.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RepositoryCreateRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'The repository was accepted for ingestion.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RepositoryResponse' }
              }
            }
          },
          '400': {
            description: 'The submission payload failed validation.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/apps/{id}': {
      get: {
        tags: ['Apps'],
        summary: 'Fetch a repository by identifier',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Repository identifier returned by the ingestion pipeline.'
          }
        ],
        responses: {
          '200': {
            description: 'Repository details were found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RepositoryResponse' }
              }
            }
          },
          '400': {
            description: 'The repository identifier was invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'The repository does not exist.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/services': {
      get: {
        tags: ['Services'],
        summary: 'List registered services',
        responses: {
          '200': {
            description: 'Service inventory and health summary.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ServiceListResponse' }
              }
            }
          }
        }
      },
      post: {
        tags: ['Services'],
        summary: 'Register or update a service',
        description:
          'Adds a new service entry or updates the metadata for an existing service. Requires the service registry bearer token.',
        security: [{ ServiceRegistryToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceRegistrationRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'A new service was registered.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ServiceResponse' }
              }
            }
          },
          '200': {
            description: 'The service metadata was updated.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ServiceResponse' }
              }
            }
          },
          '400': {
            description: 'The service payload failed validation.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '401': {
            description: 'Authorization header was missing.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '403': {
            description: 'Authorization header was rejected.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '503': {
            description: 'Service registry support is disabled on this deployment.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/jobs': {
      get: {
        tags: ['Jobs'],
        summary: 'List job definitions',
        responses: {
          '200': {
            description: 'Job definitions currently available to run.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobDefinitionListResponse' }
              }
            }
          }
        }
      },
      post: {
        tags: ['Jobs'],
        summary: 'Create a job definition',
        description:
          'Creates a new job definition. Only callers with the jobs:write scope may invoke this endpoint.',
        security: [{ OperatorToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/JobDefinitionCreateRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'The job definition was created successfully.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobDefinitionResponse' }
              }
            }
          },
          '400': {
            description: 'The request payload failed validation.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '403': {
            description: 'The operator token is missing required scopes.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '409': {
            description: 'A job definition with the same slug already exists.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '500': {
            description: 'The server failed to persist the job definition.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/jobs/{slug}/bundle-editor': {
      get: {
        tags: ['Jobs'],
        summary: 'Fetch bundle editor context for a job',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Slug of the job definition to inspect.'
          }
        ],
        responses: {
          '200': {
            description: 'Current bundle editor state for the requested job.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BundleEditorResponse' }
              }
            }
          },
          '400': {
            description: 'The provided slug failed validation.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'No job or bundle editor snapshot was found for the provided slug.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '500': {
            description: 'An unexpected error occurred while loading the bundle editor snapshot.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/jobs/{slug}/bundle/ai-edit': {
      post: {
        tags: ['Jobs'],
        summary: 'Generate bundle edits with AI',
        description:
          'Runs an AI provider against the current job bundle and publishes a new version when the response is valid.',
        security: [{ OperatorToken: [] }],
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Slug of the job whose bundle should be regenerated.'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiBundleEditRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'A new bundle version was generated and bound to the job.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BundleEditorResponse' }
              }
            }
          },
          '400': {
            description: 'Request parameters or generated bundle payload were invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '401': {
            description: 'The request lacked an operator token.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '403': {
            description: 'The supplied operator token was missing required scopes.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'No job or bundle editor snapshot was found for the provided slug.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '409': {
            description: 'The job is not bound to a bundle entry point or the generated version already exists.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '422': {
            description: 'The AI response did not contain a valid bundle suggestion.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '502': {
            description: 'The selected AI provider failed to generate a response.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '500': {
            description: 'The server failed to publish the generated bundle.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/assets/graph': {
      get: {
        tags: ['Workflows'],
        summary: 'Retrieve workflow asset dependency graph',
        description:
          'Returns producers, consumers, latest materializations, and stale partitions for all declared workflow assets.',
        responses: {
          '200': {
            description: 'Asset dependency graph data.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AssetGraphResponse' }
              }
            }
          },
          '500': {
            description: 'The server failed to aggregate asset metadata.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/workflows/{slug}/assets/{assetId}/stale': {
      post: {
        tags: ['Workflows'],
        summary: 'Mark a workflow asset partition as stale',
        description:
          'Flags a workflow asset or partition as stale so operators can track manual refresh requirements. Requires the workflows:run scope.',
        security: [{ OperatorToken: [] }],
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'assetId',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$', maxLength: 200 }
          }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AssetMarkStaleRequest' }
            }
          }
        },
        responses: {
          '204': { description: 'The asset partition was marked stale.' },
          '400': {
            description: 'The request parameters or partition key were invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '403': {
            description: 'The operator token lacks the required scope.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'The workflow or asset was not found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      delete: {
        tags: ['Workflows'],
        summary: 'Clear a stale flag for a workflow asset partition',
        description:
          'Removes a stale flag previously recorded for a workflow asset or partition. Requires the workflows:run scope.',
        security: [{ OperatorToken: [] }],
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'assetId',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$', maxLength: 200 }
          },
          {
            name: 'partitionKey',
            in: 'query',
            required: false,
            schema: { type: 'string', minLength: 1, maxLength: 200 },
            description: 'Partition key to clear for partitioned assets.'
          }
        ],
        responses: {
          '204': { description: 'The stale flag was cleared.' },
          '400': {
            description: 'The supplied partition key was invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '403': {
            description: 'The operator token lacks the required scope.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'The workflow or asset was not found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/workflows': {
      get: {
        tags: ['Workflows'],
        summary: 'List workflow definitions',
        responses: {
          '200': {
            description: 'Workflow definitions currently available.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WorkflowDefinitionListResponse' }
              }
            }
          },
          '500': {
            description: 'The server failed to fetch workflow definitions.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      post: {
        tags: ['Workflows'],
        summary: 'Create a workflow definition',
        description:
          'Creates a workflow by composing job and service steps. Requires the workflows:write operator scope.',
        security: [{ OperatorToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WorkflowDefinitionCreateRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'Workflow definition created successfully.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WorkflowDefinitionResponse' }
              }
            }
          },
          '400': {
            description: 'The workflow payload failed validation or the DAG is invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '403': {
            description: 'The operator token is missing required scopes.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '500': {
            description: 'The server failed to create the workflow.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    }
  }
};
