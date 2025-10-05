/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $JobRetryPolicy = {
  properties: {
    maxAttempts: {
      type: 'number',
      maximum: 10,
      minimum: 1,
    },
    strategy: {
      type: 'Enum',
    },
    initialDelayMs: {
      type: 'number',
      maximum: 86400000,
    },
    maxDelayMs: {
      type: 'number',
      maximum: 86400000,
    },
    jitter: {
      type: 'Enum',
    },
  },
} as const;
