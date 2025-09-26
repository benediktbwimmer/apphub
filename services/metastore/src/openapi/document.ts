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
    { name: 'System', description: 'Health and metrics' }
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
                  filter: { $ref: '#/components/schemas/SearchFilter' },
                  limit: { type: 'integer', minimum: 1, maximum: 200 },
                  offset: { type: 'integer', minimum: 0 },
                  includeDeleted: { type: 'boolean' },
                  projection: { type: 'array', items: { type: 'string' }, maxItems: 32 },
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
    }
  },
  components: {
    schemas: {
      MetastoreRecord: recordSchema,
      SearchFilter: searchFilterSchema,
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
          createdAt: { type: 'string', format: 'date-time' }
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
