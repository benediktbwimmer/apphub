/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ErrorResponse = {
  properties: {
    error: {
      properties: {
        code: {
          type: 'string',
          description: `Stable machine-readable identifier for the error.`,
          isRequired: true,
        },
        message: {
          type: 'string',
          description: `Human-readable explanation of the error.`,
          isRequired: true,
        },
        details: {
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
      isRequired: true,
    },
  },
} as const;
