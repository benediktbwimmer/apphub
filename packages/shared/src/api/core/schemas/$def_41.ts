/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_41 = {
  properties: {
    name: {
      type: 'string',
      minLength: 1,
    },
    version: {
      type: 'number',
      minimum: 1,
    },
    type: {
      type: 'Enum',
    },
    runtime: {
      type: 'Enum',
    },
    entryPoint: {
      type: 'string',
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
      type: 'any',
      isNullable: true,
    },
    defaultParameters: {
      type: 'any',
      isNullable: true,
    },
    outputSchema: {
      type: 'any',
      isNullable: true,
    },
    metadata: {
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
    },
  },
} as const;
