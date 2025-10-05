/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_28 = {
  properties: {
    timeRange: {
      properties: {
        start: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
        end: {
          type: 'string',
          isRequired: true,
          format: 'date-time',
        },
      },
      isRequired: true,
    },
    timestampColumn: {
      type: 'string',
      description: `Logical timestamp column to use for range filtering.`,
    },
    columns: {
      type: 'any[]',
      isNullable: true,
    },
    filters: {
      type: 'any',
      isNullable: true,
    },
    downsample: {
      type: 'any',
      isNullable: true,
    },
    limit: {
      type: 'number',
      isNullable: true,
      maximum: 500000,
      minimum: 1,
    },
  },
} as const;
