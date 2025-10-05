/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $StringPartitionPredicate = {
  type: 'any-of',
  contains: [{
    properties: {
      type: {
        type: 'Enum',
      },
      eq: {
        type: 'string',
        isNullable: true,
      },
      in: {
        type: 'array',
        contains: {
          type: 'string',
        },
        isNullable: true,
      },
    },
  }],
} as const;
