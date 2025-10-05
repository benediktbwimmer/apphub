/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $StreamingBrokerStatus = {
  properties: {
    configured: {
      type: 'boolean',
      isRequired: true,
    },
    reachable: {
      type: 'boolean',
      isRequired: true,
      isNullable: true,
    },
    lastCheckedAt: {
      type: 'string',
      isRequired: true,
      isNullable: true,
      format: 'date-time',
    },
    error: {
      type: 'string',
      isRequired: true,
      isNullable: true,
    },
  },
} as const;
