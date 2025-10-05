/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $BackendMountEnvelope = {
  properties: {
    data: {
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
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
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
      isRequired: true,
    },
  },
} as const;
