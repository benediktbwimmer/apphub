/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_82 = {
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
    runId: {
      type: 'string',
      isRequired: true,
    },
    stepId: {
      type: 'string',
      isRequired: true,
    },
    stepName: {
      type: 'string',
      isRequired: true,
    },
    stepType: {
      type: 'Enum',
      isRequired: true,
    },
    runStatus: {
      type: 'Enum',
      isRequired: true,
    },
    stepStatus: {
      type: 'Enum',
      isRequired: true,
    },
    producedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    partitionKey: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
    freshness: {
      type: 'any-of',
      contains: [{
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
      }, {
        type: 'null',
      }],
      isRequired: true,
    },
    runStartedAt: {
      type: 'string',
      isRequired: true,
      isNullable: true,
      format: 'date-time',
    },
    runCompletedAt: {
      type: 'string',
      isRequired: true,
      isNullable: true,
      format: 'date-time',
    },
  },
} as const;
