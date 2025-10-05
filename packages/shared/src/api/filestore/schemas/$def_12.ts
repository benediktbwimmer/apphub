/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_12 = {
  properties: {
    data: {
      properties: {
        mounts: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'number',
                description: `Unique identifier for the backend mount.`,
                isRequired: true,
              },
              mountKey: {
                type: 'string',
                description: `Stable slug identifying the backend.`,
                isRequired: true,
              },
              displayName: {
                type: 'string',
                description: `Human friendly backend name.`,
                isRequired: true,
                isNullable: true,
              },
              description: {
                type: 'string',
                description: `Optional description of the backend.`,
                isRequired: true,
                isNullable: true,
              },
              contact: {
                type: 'string',
                description: `Point of contact for the backend.`,
                isRequired: true,
                isNullable: true,
              },
              labels: {
                type: 'array',
                contains: {
                  type: 'string',
                },
                isRequired: true,
              },
              backendKind: {
                type: 'Enum',
                isRequired: true,
              },
              accessMode: {
                type: 'Enum',
                isRequired: true,
              },
              state: {
                type: 'Enum',
                isRequired: true,
              },
              stateReason: {
                type: 'string',
                description: `Additional context explaining the current state.`,
                isRequired: true,
                isNullable: true,
              },
              rootPath: {
                type: 'string',
                description: `Base path for local backends.`,
                isRequired: true,
                isNullable: true,
              },
              bucket: {
                type: 'string',
                description: `Bucket name for S3 backends.`,
                isRequired: true,
                isNullable: true,
              },
              prefix: {
                type: 'string',
                description: `Optional prefix used when addressing the backend.`,
                isRequired: true,
                isNullable: true,
              },
              config: {
                type: 'any',
                description: `Backend specific configuration. Secrets are omitted.`,
                isNullable: true,
              },
              lastHealthCheckAt: {
                type: 'string',
                description: `Timestamp of the most recent health check.`,
                isRequired: true,
                isNullable: true,
                format: 'date-time',
              },
              lastHealthStatus: {
                type: 'string',
                description: `Latest reported status message from the backend.`,
                isRequired: true,
                isNullable: true,
              },
              createdAt: {
                type: 'string',
                description: `Timestamp when the backend was created.`,
                isRequired: true,
                format: 'date-time',
              },
              updatedAt: {
                type: 'string',
                description: `Timestamp when the backend was last updated.`,
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
            search: {
              type: 'string',
              description: `Search term applied to mount names or descriptions.`,
              isRequired: true,
              isNullable: true,
            },
            kinds: {
              type: 'array',
              contains: {
                type: 'Enum',
              },
              isRequired: true,
            },
            states: {
              type: 'array',
              contains: {
                type: 'Enum',
              },
              isRequired: true,
            },
            accessModes: {
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
      isRequired: true,
    },
  },
} as const;
