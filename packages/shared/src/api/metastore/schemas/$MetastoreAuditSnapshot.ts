/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $MetastoreAuditSnapshot = {
  properties: {
    metadata: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isRequired: true,
      isNullable: true,
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
      isRequired: true,
      isNullable: true,
    },
    schemaHash: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
