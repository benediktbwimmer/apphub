/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_39 = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    slug: {
      type: 'string',
      isRequired: true,
    },
    name: {
      type: 'string',
      isRequired: true,
    },
    version: {
      type: 'number',
      isRequired: true,
    },
    type: {
      type: 'Enum',
      isRequired: true,
    },
    runtime: {
      type: 'Enum',
      isRequired: true,
    },
    entryPoint: {
      type: 'string',
      isRequired: true,
    },
    parametersSchema: {
      type: 'any',
      isRequired: true,
      isNullable: true,
    },
    defaultParameters: {
      type: 'any',
      isRequired: true,
      isNullable: true,
    },
    outputSchema: {
      type: 'any',
      isRequired: true,
      isNullable: true,
    },
    timeoutMs: {
      type: 'number',
      isNullable: true,
    },
    retryPolicy: {
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
  },
} as const;
