/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_20 = {
  properties: {
    windowSeconds: {
      type: 'number',
      isRequired: true,
      minimum: 60,
    },
    totalEvents: {
      type: 'number',
      isRequired: true,
    },
    errorEvents: {
      type: 'number',
      isRequired: true,
    },
    eventRatePerMinute: {
      type: 'number',
      isRequired: true,
    },
    errorRatio: {
      type: 'number',
      isRequired: true,
    },
    generatedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    sampledCount: {
      type: 'number',
      isRequired: true,
    },
    sampleLimit: {
      type: 'number',
      isRequired: true,
      minimum: 1,
    },
    truncated: {
      type: 'boolean',
      isRequired: true,
    },
  },
} as const;
