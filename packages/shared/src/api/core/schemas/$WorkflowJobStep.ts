/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $WorkflowJobStep = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    name: {
      type: 'string',
      isRequired: true,
    },
    type: {
      type: 'Enum',
    },
    jobSlug: {
      type: 'string',
      isRequired: true,
    },
    description: {
      type: 'string',
      isNullable: true,
    },
    dependsOn: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    parameters: {
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
    timeoutMs: {
      type: 'number',
      isNullable: true,
      maximum: 86400000,
      minimum: 1000,
    },
    retryPolicy: {
      properties: {
        maxAttempts: {
          type: 'number',
          maximum: 10,
          minimum: 1,
        },
        strategy: {
          type: 'Enum',
        },
        initialDelayMs: {
          type: 'number',
          maximum: 86400000,
        },
        maxDelayMs: {
          type: 'number',
          maximum: 86400000,
        },
        jitter: {
          type: 'Enum',
        },
      },
      isNullable: true,
    },
    storeResultAs: {
      type: 'string',
      isNullable: true,
    },
  },
} as const;
