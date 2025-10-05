/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_85 = {
  properties: {
    hit: {
      type: 'boolean',
      isRequired: true,
    },
    cachedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    ageMs: {
      type: 'number',
      isNullable: true,
    },
    expiresAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    stats: {
      properties: {
        hits: {
          type: 'number',
          isRequired: true,
        },
        misses: {
          type: 'number',
          isRequired: true,
        },
        invalidations: {
          type: 'number',
          isRequired: true,
        },
      },
      isRequired: true,
    },
    lastInvalidatedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    lastInvalidationReason: {
      type: 'string',
      isNullable: true,
    },
  },
} as const;
