/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $NamespaceSummary = {
  properties: {
    name: {
      type: 'string',
      isRequired: true,
    },
    totalRecords: {
      type: 'number',
      isRequired: true,
    },
    deletedRecords: {
      type: 'number',
      isRequired: true,
    },
    lastUpdatedAt: {
      type: 'string',
      isRequired: true,
      isNullable: true,
      format: 'date-time',
    },
    ownerCounts: {
      type: 'array',
      contains: {
        type: 'NamespaceOwnerCount',
      },
    },
  },
} as const;
