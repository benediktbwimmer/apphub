/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_75 = {
  properties: {
    id: {
      type: 'string',
      isRequired: true,
    },
    name: {
      type: 'string',
      isNullable: true,
    },
    prefix: {
      type: 'string',
      description: `Stable API key prefix used for support diagnostics.`,
      isRequired: true,
    },
    scopes: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
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
    lastUsedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    expiresAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
    revokedAt: {
      type: 'string',
      isNullable: true,
      format: 'date-time',
    },
  },
} as const;
