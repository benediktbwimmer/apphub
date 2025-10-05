/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $WorkflowAutoMaterializeInFlight = {
  properties: {
    workflowRunId: {
      type: 'string',
      isNullable: true,
    },
    reason: {
      type: 'string',
      isRequired: true,
    },
    assetId: {
      type: 'string',
      isNullable: true,
    },
    partitionKey: {
      type: 'string',
      isNullable: true,
    },
    requestedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    claimedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    claimOwner: {
      type: 'string',
      isRequired: true,
    },
    context: {
      type: 'any-of',
      description: `Arbitrary JSON value.`,
      contains: [{
        type: 'string',
      }, {
        type: 'number',
      }, {
        type: 'number',
      }, {
        type: 'boolean',
      }, {
        type: 'dictionary',
        contains: {
          properties: {
          },
        },
      }],
      isNullable: true,
    },
  },
} as const;
