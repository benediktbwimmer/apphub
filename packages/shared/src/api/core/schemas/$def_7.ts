/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_7 = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    status: {
      type: 'Enum',
      isRequired: true,
    },
    buildId: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
    repositoryId: {
      type: 'string',
      isRequired: true,
    },
    instanceUrl: {
      type: 'string',
      isNullable: true,
    },
    resourceProfile: {
      type: 'string',
      isNullable: true,
    },
    env: {
      type: 'array',
      contains: {
        properties: {
          key: {
            type: 'string',
            description: `Environment variable name.`,
            isRequired: true,
          },
          value: {
            type: 'string',
            description: `Environment variable value.`,
            isRequired: true,
          },
        },
      },
    },
    command: {
      type: 'string',
      isNullable: true,
    },
    errorMessage: {
      type: 'string',
      isNullable: true,
    },
    createdAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    startedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    stoppedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    expiresAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    port: {
      type: 'number',
      isNullable: true,
    },
    internalPort: {
      type: 'number',
      isNullable: true,
    },
    containerIp: {
      type: 'string',
      isNullable: true,
    },
  },
} as const;
