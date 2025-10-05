/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $BooleanColumnPredicate = {
  properties: {
    type: {
      type: 'Enum',
    },
    eq: {
      type: 'boolean',
      isNullable: true,
    },
    in: {
      type: 'array',
      contains: {
        type: 'boolean',
      },
      isNullable: true,
    },
  },
} as const;
