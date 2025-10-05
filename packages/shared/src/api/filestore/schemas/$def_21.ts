/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_21 = {
  properties: {
    nodes: {
      type: 'array',
      contains: {
        properties: {
          id: {
            type: 'number',
            description: `Unique identifier for the node.`,
            isRequired: true,
          },
          backendMountId: {
            type: 'number',
            description: `Identifier of the backend mount containing the node.`,
            isRequired: true,
          },
          parentId: {
            type: 'number',
            description: `Identifier of the parent directory, if any.`,
            isRequired: true,
            isNullable: true,
          },
          path: {
            type: 'string',
            description: `Normalized absolute path for the node.`,
            isRequired: true,
          },
          name: {
            type: 'string',
            description: `Basename of the node.`,
            isRequired: true,
          },
          depth: {
            type: 'number',
            description: `Directory depth starting from the backend root.`,
            isRequired: true,
          },
          kind: {
            type: 'Enum',
            isRequired: true,
          },
          sizeBytes: {
            type: 'number',
            description: `Logical size recorded for the node, in bytes.`,
            isRequired: true,
          },
          checksum: {
            type: 'string',
            description: `Checksum recorded for the node content.`,
            isRequired: true,
            isNullable: true,
          },
          contentHash: {
            type: 'string',
            description: `Content hash recorded for the node content.`,
            isRequired: true,
            isNullable: true,
          },
          metadata: {
            type: 'dictionary',
            contains: {
              type: 'def_0',
            },
            isRequired: true,
          },
          state: {
            type: 'Enum',
            isRequired: true,
          },
          version: {
            type: 'number',
            description: `Monotonic version counter for optimistic concurrency.`,
            isRequired: true,
          },
          isSymlink: {
            type: 'boolean',
            description: `Indicates if the node represents a symbolic link.`,
            isRequired: true,
          },
          lastSeenAt: {
            type: 'string',
            description: `Timestamp when the node was last observed in the backend.`,
            isRequired: true,
            format: 'date-time',
          },
          lastModifiedAt: {
            type: 'string',
            description: `Last modification timestamp reported by the backend.`,
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          consistencyState: {
            type: 'Enum',
            isRequired: true,
          },
          consistencyCheckedAt: {
            type: 'string',
            description: `Timestamp of the most recent consistency check.`,
            isRequired: true,
            format: 'date-time',
          },
          lastReconciledAt: {
            type: 'string',
            description: `Timestamp of the most recent reconciliation success.`,
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          lastDriftDetectedAt: {
            type: 'string',
            description: `Timestamp when drift was last detected.`,
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          createdAt: {
            type: 'string',
            description: `Timestamp when the node record was created.`,
            isRequired: true,
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            description: `Timestamp when the node record was last updated.`,
            isRequired: true,
            format: 'date-time',
          },
          deletedAt: {
            type: 'string',
            description: `Timestamp when the node was marked deleted.`,
            isRequired: true,
            isNullable: true,
            format: 'date-time',
          },
          rollup: {
            type: 'any',
            isRequired: true,
            isNullable: true,
          },
          download: {
            type: 'any',
            isRequired: true,
            isNullable: true,
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
          type: 'any',
          isRequired: true,
          isNullable: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
