/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_37 = {
  properties: {
    jobs: {
      type: 'array',
      contains: {
        properties: {
          id: {
            type: 'number',
            description: `Identifier of the reconciliation job.`,
            isRequired: true,
          },
          jobKey: {
            type: 'string',
            description: `Deterministic key used for idempotent job scheduling.`,
            isRequired: true,
          },
          backendMountId: {
            type: 'number',
            description: `Backend mount identifier associated with the job.`,
            isRequired: true,
          },
          nodeId: {
            type: 'number',
            description: `Identifier of the node under reconciliation.`,
            isRequired: true,
            isNullable: true,
          },
          path: {
            type: 'string',
            description: `Path of the node under reconciliation.`,
            isRequired: true,
          },
          reason: {
            type: 'Enum',
            isRequired: true,
          },
          status: {
            type: 'Enum',
            isRequired: true,
          },
          detectChildren: {
            type: 'boolean',
            description: `Whether child reconciliation jobs were requested.`,
            isRequired: true,
          },
          requestedHash: {
            type: 'boolean',
            description: `Whether a hash recalculation was requested.`,
            isRequired: true,
          },
          attempt: {
            type: 'number',
            description: `Attempt counter for the job.`,
            isRequired: true,
          },
          result: {
            type: 'any',
            description: `Map of string keys to arbitrary JSON values.`,
            isRequired: true,
            isNullable: true,
          },
          error: {
            type: 'any',
            description: `Map of string keys to arbitrary JSON values.`,
            isRequired: true,
            isNullable: true,
          },
          enqueuedAt: {
            type: 'string',
            description: `Timestamp when the job was enqueued.`,
            isRequired: true,
            format: 'date-time',
          },
          startedAt: {
            type: 'string',
            description: `Timestamp when the job started processing.`,
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          completedAt: {
            type: 'string',
            description: `Timestamp when the job finished processing.`,
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          durationMs: {
            type: 'number',
            description: `Duration in milliseconds, when available.`,
            isRequired: true,
            isNullable: true,
          },
          updatedAt: {
            type: 'string',
            description: `Timestamp when the job record was last updated.`,
            isRequired: true,
            format: 'date-time',
          },
        },
      },
      isRequired: true,
    },
    pagination: {
      properties: {
        total: {
          type: 'number',
          description: `Total matching records.`,
          isRequired: true,
        },
        limit: {
          type: 'number',
          description: `Requested page size.`,
          isRequired: true,
        },
        offset: {
          type: 'number',
          description: `Current offset within the collection.`,
          isRequired: true,
        },
        nextOffset: {
          type: 'number',
          description: `Next offset to request, if more data is available.`,
          isRequired: true,
          isNullable: true,
        },
      },
      isRequired: true,
    },
    filters: {
      properties: {
        backendMountId: {
          type: 'number',
          description: `Backend mount filter applied to the query.`,
          isRequired: true,
          isNullable: true,
        },
        path: {
          type: 'string',
          description: `Path filter applied to the job listing.`,
          isRequired: true,
          isNullable: true,
        },
        status: {
          type: 'array',
          contains: {
            type: 'Enum',
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
