/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $MetastoreRecord = {
  properties: {
    namespace: {
      type: 'string',
      isRequired: true,
    },
    key: {
      type: 'string',
      isRequired: true,
    },
    metadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isRequired: true,
    },
    tags: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    owner: {
      type: 'string',
      isNullable: true,
    },
    schemaHash: {
      type: 'string',
      isNullable: true,
    },
    version: {
      type: 'number',
      isRequired: true,
      minimum: 1,
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
    deletedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    createdBy: {
      type: 'string',
      isNullable: true,
    },
    updatedBy: {
      type: 'string',
      isNullable: true,
    },
  },
} as const;
