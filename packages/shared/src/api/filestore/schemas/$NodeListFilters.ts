/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $NodeListFilters = {
  properties: {
    backendMountId: {
      type: 'number',
      description: `Backend filter applied to the query.`,
      isRequired: true,
    },
    path: {
      type: 'string',
      description: `Optional path prefix filter.`,
      isRequired: true,
      isNullable: true,
    },
    depth: {
      type: 'number',
      description: `Maximum depth relative to the provided path.`,
      isRequired: true,
      isNullable: true,
    },
    states: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
    kinds: {
      type: 'array',
      contains: {
        type: 'Enum',
      },
      isRequired: true,
    },
    search: {
      type: 'string',
      description: `Term supplied via search or advanced filters.`,
      isRequired: true,
      isNullable: true,
    },
    driftOnly: {
      type: 'boolean',
      description: `Whether only nodes with detected drift were requested.`,
      isRequired: true,
    },
    advanced: {
      properties: {
        query: {
          type: 'string',
          description: `Full-text search term applied to node names and metadata.`,
        },
        metadata: {
          type: 'array',
          contains: {
            properties: {
              key: {
                type: 'string',
                description: `Metadata key to match.`,
                isRequired: true,
              },
              value: {
                type: 'def_0',
                isRequired: true,
              },
            },
          },
        },
        size: {
          description: `Range constraint applied to numeric values.`,
          properties: {
            min: {
              type: 'number',
              description: `Lower bound, inclusive.`,
            },
            max: {
              type: 'number',
              description: `Upper bound, inclusive.`,
            },
          },
        },
        lastSeenAt: {
          description: `Range constraint applied to ISO-8601 timestamps.`,
          properties: {
            after: {
              type: 'string',
              description: `Lower inclusive bound.`,
              format: 'date-time',
            },
            before: {
              type: 'string',
              description: `Upper inclusive bound.`,
              format: 'date-time',
            },
          },
        },
        rollup: {
          description: `Advanced rollup constraints applied when filtering nodes.`,
          properties: {
            states: {
              type: 'array',
              contains: {
                type: 'Enum',
              },
            },
            minChildCount: {
              type: 'number',
            },
            maxChildCount: {
              type: 'number',
            },
            minFileCount: {
              type: 'number',
            },
            maxFileCount: {
              type: 'number',
            },
            minDirectoryCount: {
              type: 'number',
            },
            maxDirectoryCount: {
              type: 'number',
            },
            minSizeBytes: {
              type: 'number',
            },
            maxSizeBytes: {
              type: 'number',
            },
            lastCalculatedAfter: {
              type: 'string',
              format: 'date-time',
            },
            lastCalculatedBefore: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
      },
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
