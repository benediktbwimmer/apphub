/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $JsonValue = {
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
} as const;
