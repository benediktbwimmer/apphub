import type { OpenAPIV3 } from 'openapi-types';

const recordSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['namespace', 'key', 'metadata', 'tags', 'version', 'createdAt', 'updatedAt'],
  properties: {
    namespace: { type: 'string' },
    key: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true },
    tags: { type: 'array', items: { type: 'string' } },
    owner: { type: 'string', nullable: true },
    schemaHash: { type: 'string', nullable: true },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true },
    createdBy: { type: 'string', nullable: true },
    updatedBy: { type: 'string', nullable: true }
  }
};

const searchFilterSchema: OpenAPIV3.SchemaObject = {
  oneOf: [
    {
      type: 'object',
      required: ['field', 'operator'],
      properties: {
        type: { type: 'string', enum: ['condition'] },
        field: { type: 'string' },
        operator: {
          type: 'string',
          enum: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'between', 'contains', 'has_key', 'array_contains', 'exists']
        },
        value: {},
        values: { type: 'array', items: {} }
      },
      additionalProperties: false
    },
    {
      type: 'object',
      required: ['type', 'operator', 'filters'],
      properties: {
        type: { type: 'string', enum: ['group'] },
        operator: { type: 'string', enum: ['and', 'or'] },
        filters: {
          type: 'array',
          items: { $ref: '#/components/schemas/SearchFilter' },
          minItems: 1
        }
      },
      additionalProperties: false
    },
    {
      type: 'object',
      required: ['type', 'filter'],
      properties: {
        type: { type: 'string', enum: ['not'] },
        filter: { $ref: '#/components/schemas/SearchFilter' }
      },
      additionalProperties: false
    }
  ]
};

export const openApiDocument: OpenAPIV3.Document = {
  openapi: '3.1.0',
  info: {
    title: 'Metastore API',
    description: 'Flexible metadata storage and search API',
    version: '0.1.0'
  },
  servers: [
    {
      url: 'http://127.0.0.1:4100',
      description: 'Local development'
    }
  ],
  tags: [
    { name: 'Records', description: 'Metadata record CRUD and search' },
    { name: 'Namespaces', description: 'Namespace discovery and summaries' },
    { name: 'System', description: 'Health and metrics' },
    { name: 'Streams', description: 'Realtime record change notifications' },
    {
      name: 'Filestore',
      description: 'Filestore sync health and lag monitoring'
    },
    { name: 'Schemas', description: 'Schema registry introspection and administration' }
  ],
  paths: {
    '/records': {
      post: {
        tags: ['Records'],
        summary: 'Create a record',
        operationId: 'createRecord',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['namespace', 'key', 'metadata'],
                properties: {
                  namespace: { type: 'string' },
                  key: { type: 'string' },
                  metadata: { type: 'object', additionalProperties: true },
                  tags: { type: 'array', items: { type: 'string' } },
                  owner: { type: 'string' },
                  schemaHash: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Record already existed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    created: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '201': {
            description: 'Record created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    created: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '409': { description: 'Conflict (record soft-deleted)' }
        }
      }
    },
    '/namespaces': {
      get: {
        tags: ['Namespaces'],
        summary: 'List namespace summaries',
        operationId: 'listNamespaces',
        parameters: [
          {
            name: 'prefix',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              minLength: 1,
              maxLength: 128,
              pattern: '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
            },
            description: 'Return namespaces beginning with the provided prefix'
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 25 }
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, default: 0 }
          }
        ],
        responses: {
          '200': {
            description: 'Namespace summaries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pagination: {
                      type: 'object',
                      required: ['total', 'limit', 'offset'],
                      properties: {
                        total: { type: 'integer', minimum: 0 },
                        limit: { type: 'integer', minimum: 1, maximum: 200 },
                        offset: { type: 'integer', minimum: 0 },
                        nextOffset: { type: 'integer', minimum: 0 }
                      }
                    },
                    namespaces: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/NamespaceSummary' }
                    }
                  }
                }
              }
            }
          },
          '403': { description: 'Forbidden' }
        }
      }
    },
    '/schemas/{hash}': {
      get: {
        tags: ['Schemas'],
        summary: 'Fetch schema definition by hash',
        operationId: 'getSchemaDefinition',
        parameters: [
          {
            name: 'hash',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Schema hash (for example, sha256:...)'
          }
        ],
        responses: {
          '200': {
            description: 'Schema definition for the supplied hash',
            headers: {
              'Cache-Control': {
                schema: { type: 'string' },
                description: 'Caching directives for schema consumers'
              }
            },
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/SchemaDefinition' },
                    {
                      type: 'object',
                      required: ['cache'],
                      properties: {
                        cache: { type: 'string', enum: ['cache', 'database'] }
                      }
                    }
                  ]
                }
              }
            }
          },
          '400': { description: 'Invalid schema hash' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Schema not registered' }
        }
      }
    },
    '/admin/schemas': {
      post: {
        tags: ['Schemas'],
        summary: 'Register or update a schema definition',
        operationId: 'registerSchemaDefinition',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SchemaDefinitionInput' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Schema definition updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['created', 'schema'],
                  properties: {
                    created: { type: 'boolean' },
                    schema: { $ref: '#/components/schemas/SchemaDefinition' }
                  }
                }
              }
            }
          },
          '201': {
            description: 'Schema definition created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['created', 'schema'],
                  properties: {
                    created: { type: 'boolean' },
                    schema: { $ref: '#/components/schemas/SchemaDefinition' }
                  }
                }
              }
            }
          },
          '400': { description: 'Invalid schema definition payload' },
          '403': { description: 'Forbidden' }
        }
      }
    },
    '/records/{namespace}/{key}/audit': {
      get: {
        tags: ['Records'],
        summary: 'List record audit entries',
        operationId: 'listRecordAudit',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } }
        ],
        responses: {
          '200': {
            description: 'Audit trail entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        limit: { type: 'integer' },
                        offset: { type: 'integer' }
                      }
                    },
                    entries: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/MetastoreAuditEntry' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/records/{namespace}/{key}/audit/{id}/diff': {
      get: {
        tags: ['Records'],
        summary: 'Diff a record audit entry',
        operationId: 'diffRecordAudit',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        responses: {
          '200': {
            description: 'Structured diff for the requested audit entry',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MetastoreAuditDiff' }
              }
            }
          },
          '400': { description: 'Invalid audit id supplied' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Audit entry not found' }
        }
      }
    },
    '/records/{namespace}/{key}/restore': {
      post: {
        tags: ['Records'],
        summary: 'Restore a record from an audit entry or version',
        operationId: 'restoreRecord',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  auditId: { type: 'integer', minimum: 1 },
                  version: { type: 'integer', minimum: 1 },
                  expectedVersion: { type: 'integer', minimum: 1 }
                },
                oneOf: [{ required: ['auditId'] }, { required: ['version'] }],
                additionalProperties: false
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Record restored successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['restored', 'record', 'restoredFrom'],
                  properties: {
                    restored: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' },
                    restoredFrom: {
                      type: 'object',
                      required: ['auditId'],
                      properties: {
                        auditId: { type: 'integer' },
                        version: { type: 'integer', nullable: true }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { description: 'Invalid restore payload' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Audit entry or record not found' },
          '409': { description: 'Version conflict during restore' }
        }
      }
    },
    '/records/{namespace}/{key}/purge': {
      delete: {
        tags: ['Records'],
        summary: 'Hard delete a record and its audit trail',
        operationId: 'purgeRecord',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expectedVersion: { type: 'integer', minimum: 1 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Record purged',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    purged: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '404': { description: 'Record not found' },
          '409': { description: 'Version conflict' }
        }
      }
    },
    '/records/{namespace}/{key}': {
      get: {
        tags: ['Records'],
        summary: 'Fetch a record',
        operationId: 'getRecord',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'includeDeleted', in: 'query', required: false, schema: { type: 'boolean' } }
        ],
        responses: {
          '200': {
            description: 'Record found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '404': { description: 'Record not found' }
        }
      },
      put: {
        tags: ['Records'],
        summary: 'Upsert a record',
        operationId: 'upsertRecord',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['metadata'],
                properties: {
                  metadata: { type: 'object', additionalProperties: true },
                  tags: { type: 'array', items: { type: 'string' } },
                  owner: { type: 'string' },
                  schemaHash: { type: 'string' },
                  expectedVersion: { type: 'integer', minimum: 1 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Record updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    created: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '201': {
            description: 'Record created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    created: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '409': { description: 'Version conflict' }
        }
      },
      patch: {
        tags: ['Records'],
        summary: 'Patch a record',
        operationId: 'patchRecord',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  metadata: { type: 'object', additionalProperties: true },
                  metadataUnset: { type: 'array', items: { type: 'string' } },
                  tags: {
                    type: 'object',
                    properties: {
                      set: { type: 'array', items: { type: 'string' } },
                      add: { type: 'array', items: { type: 'string' } },
                      remove: { type: 'array', items: { type: 'string' } }
                    },
                    additionalProperties: false
                  },
                  owner: { type: 'string', nullable: true },
                  schemaHash: { type: 'string', nullable: true },
                  expectedVersion: { type: 'integer', minimum: 1 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Record patched',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '404': { description: 'Record not found' },
          '409': { description: 'Version conflict or record soft-deleted' }
        }
      },
      delete: {
        tags: ['Records'],
        summary: 'Soft delete a record',
        operationId: 'deleteRecord',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expectedVersion: { type: 'integer', minimum: 1 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Record soft-deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    deleted: { type: 'boolean' },
                    record: { $ref: '#/components/schemas/MetastoreRecord' }
                  }
                }
              }
            }
          },
          '404': { description: 'Record not found' },
          '409': { description: 'Version conflict' }
        }
      }
    },
    '/records/search': {
      post: {
        tags: ['Records'],
        summary: 'Search records',
        operationId: 'searchRecords',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['namespace'],
                properties: {
                  namespace: { type: 'string' },
                  filter: {
                    allOf: [{ $ref: '#/components/schemas/SearchFilter' }],
                    description: 'Structured filter tree. Combined with `q` and `preset` using an AND group.'
                  },
                  q: {
                    type: 'string',
                    description:
                      'Lightweight query-string syntax (e.g. `key:foo owner=ops status:"in progress"`). Combined with other filters using AND semantics.'
                  },
                  preset: {
                    type: 'string',
                    description: 'Named server-defined filter preset. Requires appropriate scopes to use.'
                  },
                  limit: { type: 'integer', minimum: 1, maximum: 200 },
                  offset: { type: 'integer', minimum: 0 },
                  includeDeleted: { type: 'boolean' },
                  projection: { type: 'array', items: { type: 'string' }, maxItems: 32 },
                  summary: {
                    type: 'boolean',
                    description:
                      'When true, return a lean default projection (namespace, key, version, updatedAt, owner, schemaHash, tags, deletedAt). Additional fields can be added via `projection`.'
                  },
                  sort: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['field'],
                      properties: {
                        field: { type: 'string' },
                        direction: { type: 'string', enum: ['asc', 'desc'] }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        limit: { type: 'integer' },
                        offset: { type: 'integer' }
                      }
                    },
                    records: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/MetastoreRecord' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/records/bulk': {
      post: {
        tags: ['Records'],
        summary: 'Apply bulk operations',
        operationId: 'bulkRecords',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['operations'],
                properties: {
                  operations: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          required: ['namespace', 'key', 'metadata'],
                          properties: {
                            type: { type: 'string', enum: ['upsert', 'put', 'create'] },
                            namespace: { type: 'string' },
                            key: { type: 'string' },
                            metadata: { type: 'object', additionalProperties: true },
                            tags: { type: 'array', items: { type: 'string' } },
                            owner: { type: 'string' },
                            schemaHash: { type: 'string' },
                            expectedVersion: { type: 'integer', minimum: 1 }
                          }
                        },
                        {
                          type: 'object',
                          required: ['type', 'namespace', 'key'],
                          properties: {
                            type: { type: 'string', enum: ['delete'] },
                            namespace: { type: 'string' },
                            key: { type: 'string' },
                            expectedVersion: { type: 'integer', minimum: 1 }
                          }
                        }
                      ]
                    }
                  },
                  continueOnError: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Bulk operations succeeded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    operations: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/BulkOperationResult' }
                    }
                  }
                }
              }
            }
          },
          '409': { description: 'Version conflict' },
          '404': { description: 'Record not found' }
        }
      }
    },
    '/healthz': {
      get: {
        tags: ['System'],
        summary: 'Health probe',
        operationId: 'healthz',
        responses: {
          '200': {
            description: 'Service healthy',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } }
          }
        }
      }
    },
    '/readyz': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe',
        operationId: 'readyz',
        responses: {
          '200': { description: 'Service ready' }
        }
      }
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Prometheus metrics',
        operationId: 'metrics',
        responses: {
          '200': { description: 'Metrics payload (text/plain)' },
          '503': { description: 'Metrics disabled' }
        }
      }
    },
    '/filestore/health': {
      get: {
        tags: ['Filestore'],
        summary: 'Filestore sync health',
        operationId: 'filestoreHealth',
        responses: {
          '200': {
            description: 'Filestore consumer healthy or disabled',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FilestoreHealth' }
              }
            }
          },
          '503': {
            description: 'Filestore consumer stalled beyond threshold',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FilestoreHealth' }
              }
            }
          }
        }
      }
    },
    '/stream/records': {
      get: {
        tags: ['Streams'],
        summary: 'Stream record lifecycle events',
        operationId: 'streamRecords',
        description:
          'Establishes a server-sent events feed of metastore record create/update/delete notifications. Clients may optionally upgrade to WebSocket to receive the same payloads.',
        responses: {
          '200': {
            description: 'SSE stream of record lifecycle notifications',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  description: 'Server-sent events payload (event: metastore.record.*)'
                }
              }
            }
          },
          '401': { description: 'Missing or invalid bearer token' },
          '403': { description: 'Missing metastore:read scope' }
        }
      }
    },
    '/admin/tokens/reload': {
      post: {
        tags: ['System'],
        summary: 'Reload bearer tokens',
        operationId: 'reloadTokens',
        responses: {
          '200': {
            description: 'Tokens reloaded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    reloaded: { type: 'boolean' },
                    tokenCount: { type: 'integer' }
                  }
                }
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
        operationId: 'getOpenApiDocument',
        responses: {
          '200': {
            description: 'OpenAPI document',
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
    }
  },
  components: {
    schemas: {
      NamespaceOwnerCount: {
        type: 'object',
        required: ['owner', 'count'],
        properties: {
          owner: { type: 'string' },
          count: { type: 'integer', minimum: 1 }
        },
        additionalProperties: false
      },
      NamespaceSummary: {
        type: 'object',
        required: ['name', 'totalRecords', 'deletedRecords', 'lastUpdatedAt'],
        properties: {
          name: { type: 'string' },
          totalRecords: { type: 'integer', minimum: 0 },
          deletedRecords: { type: 'integer', minimum: 0 },
          lastUpdatedAt: { type: 'string', format: 'date-time', nullable: true },
          ownerCounts: {
            type: 'array',
            items: { $ref: '#/components/schemas/NamespaceOwnerCount' }
          }
        },
        additionalProperties: false
      },
      MetastoreRecord: recordSchema,
      SchemaFieldDefinition: {
        type: 'object',
        required: ['path', 'type'],
        properties: {
          path: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string', nullable: true },
          required: { type: 'boolean' },
          repeated: { type: 'boolean' },
          constraints: { type: 'object', additionalProperties: true },
          hints: { type: 'object', additionalProperties: true },
          examples: { type: 'array', items: {} },
          metadata: { type: 'object', additionalProperties: true }
        },
        additionalProperties: false
      },
      SchemaDefinitionInput: {
        type: 'object',
        required: ['schemaHash', 'fields'],
        properties: {
          schemaHash: { type: 'string' },
          name: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          version: {
            oneOf: [{ type: 'string' }, { type: 'number' }],
            nullable: true
          },
          metadata: { type: 'object', additionalProperties: true, nullable: true },
          fields: {
            type: 'array',
            items: { $ref: '#/components/schemas/SchemaFieldDefinition' }
          }
        },
        additionalProperties: false
      },
      SchemaDefinition: {
        allOf: [
          { $ref: '#/components/schemas/SchemaDefinitionInput' },
          {
            type: 'object',
            required: ['schemaHash', 'fields', 'createdAt', 'updatedAt'],
            properties: {
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          }
        ]
      },
      SearchFilter: searchFilterSchema,
      FilestoreHealth: {
        type: 'object',
        required: ['status', 'enabled', 'inline', 'thresholdSeconds', 'retries', 'lastEvent'],
        properties: {
          status: { type: 'string', enum: ['disabled', 'ok', 'stalled'] },
          enabled: { type: 'boolean' },
          inline: { type: 'boolean' },
          thresholdSeconds: { type: 'integer', minimum: 1 },
          lagSeconds: { type: 'number', nullable: true },
          lastEvent: {
            type: 'object',
            required: ['type', 'observedAt', 'receivedAt'],
            properties: {
              type: { type: 'string', nullable: true },
              observedAt: { type: 'string', format: 'date-time', nullable: true },
              receivedAt: { type: 'string', format: 'date-time', nullable: true }
            }
          },
          retries: {
            type: 'object',
            required: ['connect', 'processing', 'total'],
            properties: {
              connect: { type: 'integer', minimum: 0 },
              processing: { type: 'integer', minimum: 0 },
              total: { type: 'integer', minimum: 0 }
            }
          }
        },
        additionalProperties: false
      },
      MetastoreAuditEntry: {
        type: 'object',
        required: ['id', 'namespace', 'key', 'action', 'createdAt'],
        properties: {
          id: { type: 'integer' },
          namespace: { type: 'string' },
          key: { type: 'string' },
          action: { type: 'string', enum: ['create', 'update', 'delete', 'restore'] },
          actor: { type: 'string', nullable: true },
          previousVersion: { type: 'integer', nullable: true },
          version: { type: 'integer', nullable: true },
          metadata: { type: 'object', nullable: true, additionalProperties: true },
          previousMetadata: { type: 'object', nullable: true, additionalProperties: true },
          tags: {
            type: 'array',
            items: { type: 'string' },
            nullable: true
          },
          previousTags: {
            type: 'array',
            items: { type: 'string' },
            nullable: true
          },
          owner: { type: 'string', nullable: true },
          previousOwner: { type: 'string', nullable: true },
          schemaHash: { type: 'string', nullable: true },
          previousSchemaHash: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      MetastoreAuditSnapshot: {
        type: 'object',
        required: ['metadata', 'tags', 'owner', 'schemaHash'],
        properties: {
          metadata: { type: 'object', nullable: true, additionalProperties: true },
          tags: {
            type: 'array',
            items: { type: 'string' }
          },
          owner: { type: 'string', nullable: true },
          schemaHash: { type: 'string', nullable: true }
        }
      },
      MetastoreAuditDiff: {
        type: 'object',
        required: ['audit', 'metadata', 'tags', 'owner', 'schemaHash', 'snapshots'],
        properties: {
          audit: {
            type: 'object',
            required: ['id', 'namespace', 'key', 'action', 'createdAt'],
            properties: {
              id: { type: 'integer' },
              namespace: { type: 'string' },
              key: { type: 'string' },
              action: { type: 'string' },
              actor: { type: 'string', nullable: true },
              previousVersion: { type: 'integer', nullable: true },
              version: { type: 'integer', nullable: true },
              createdAt: { type: 'string', format: 'date-time' }
            }
          },
          metadata: {
            type: 'object',
            required: ['added', 'removed', 'changed'],
            properties: {
              added: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['path', 'value'],
                  properties: {
                    path: { type: 'string' },
                    value: {}
                  }
                }
              },
              removed: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['path', 'value'],
                  properties: {
                    path: { type: 'string' },
                    value: {}
                  }
                }
              },
              changed: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['path', 'before', 'after'],
                  properties: {
                    path: { type: 'string' },
                    before: {},
                    after: {}
                  }
                }
              }
            }
          },
          tags: {
            type: 'object',
            required: ['added', 'removed'],
            properties: {
              added: { type: 'array', items: { type: 'string' } },
              removed: { type: 'array', items: { type: 'string' } }
            }
          },
          owner: {
            type: 'object',
            required: ['before', 'after', 'changed'],
            properties: {
              before: { type: 'string', nullable: true },
              after: { type: 'string', nullable: true },
              changed: { type: 'boolean' }
            }
          },
          schemaHash: {
            type: 'object',
            required: ['before', 'after', 'changed'],
            properties: {
              before: { type: 'string', nullable: true },
              after: { type: 'string', nullable: true },
              changed: { type: 'boolean' }
            }
          },
          snapshots: {
            type: 'object',
            required: ['current', 'previous'],
            properties: {
              current: { $ref: '#/components/schemas/MetastoreAuditSnapshot' },
              previous: { $ref: '#/components/schemas/MetastoreAuditSnapshot' }
            }
          }
        }
      },
      BulkOperationResult: {
        oneOf: [
          {
            type: 'object',
            required: ['status', 'type', 'namespace', 'key', 'record'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              type: { type: 'string', enum: ['upsert', 'delete'] },
              namespace: { type: 'string' },
              key: { type: 'string' },
              created: { type: 'boolean' },
              record: { $ref: '#/components/schemas/MetastoreRecord' }
            },
            additionalProperties: false
          },
          {
            type: 'object',
            required: ['status', 'namespace', 'key', 'error'],
            properties: {
              status: { type: 'string', enum: ['error'] },
              namespace: { type: 'string' },
              key: { type: 'string' },
              error: {
                type: 'object',
                required: ['statusCode', 'code', 'message'],
                properties: {
                  statusCode: { type: 'integer' },
                  code: { type: 'string' },
                  message: { type: 'string' }
                }
              }
            },
            additionalProperties: false
          }
        ]
      }
    }
  }
};
