/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_81 = {
  properties: {
    workflowId: {
      type: 'string',
      isRequired: true,
    },
    workflowSlug: {
      type: 'string',
      isRequired: true,
    },
    workflowName: {
      type: 'string',
      isRequired: true,
    },
    partitionKey: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
    requestedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    requestedBy: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
    note: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
