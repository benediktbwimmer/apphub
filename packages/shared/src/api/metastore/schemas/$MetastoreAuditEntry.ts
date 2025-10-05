/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $MetastoreAuditEntry = {
  properties: {
    id: {
      type: 'number',
      isRequired: true,
    },
    namespace: {
      type: 'string',
      isRequired: true,
    },
    key: {
      type: 'string',
      isRequired: true,
    },
    action: {
      type: 'Enum',
      isRequired: true,
    },
    actor: {
      type: 'string',
      isNullable: true,
    },
    previousVersion: {
      type: 'number',
      isNullable: true,
    },
    version: {
      type: 'number',
      isNullable: true,
    },
    metadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    previousMetadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    tags: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isNullable: true,
    },
    previousTags: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isNullable: true,
    },
    owner: {
      type: 'string',
      isNullable: true,
    },
    previousOwner: {
      type: 'string',
      isNullable: true,
    },
    schemaHash: {
      type: 'string',
      isNullable: true,
    },
    previousSchemaHash: {
      type: 'string',
      isNullable: true,
    },
    createdAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
  },
} as const;
