/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_34 = {
  properties: {
    sql: {
      type: 'string',
      description: `SQL statement to execute.`,
      isRequired: true,
    },
    params: {
      type: 'array',
      contains: {
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
  },
} as const;
