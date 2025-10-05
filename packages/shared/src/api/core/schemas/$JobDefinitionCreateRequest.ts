/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $JobDefinitionCreateRequest = {
  properties: {
    slug: {
      type: 'string',
      isRequired: true,
      maxLength: 100,
      minLength: 1,
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9-_]*$',
    },
    name: {
      type: 'string',
      isRequired: true,
    },
    version: {
      type: 'number',
      minimum: 1,
    },
    type: {
      type: 'Enum',
      isRequired: true,
    },
    runtime: {
      type: 'Enum',
    },
    entryPoint: {
      type: 'string',
      isRequired: true,
    },
    timeoutMs: {
      type: 'number',
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
    },
    parametersSchema: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    defaultParameters: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    outputSchema: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isNullable: true,
    },
    metadata: {
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
