/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $NumberPartitionPredicate = {
  properties: {
    type: {
      type: 'Enum',
    },
    eq: {
      type: 'number',
      isNullable: true,
    },
    in: {
      type: 'array',
      contains: {
        type: 'number',
      },
      isNullable: true,
    },
    gt: {
      type: 'number',
      isNullable: true,
    },
    gte: {
      type: 'number',
      isNullable: true,
    },
    lt: {
      type: 'number',
      isNullable: true,
    },
    lte: {
      type: 'number',
      isNullable: true,
    },
  },
} as const;
