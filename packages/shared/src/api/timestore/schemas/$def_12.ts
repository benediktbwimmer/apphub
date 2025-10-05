/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_12 = {
  properties: {
    key: {
      type: 'dictionary',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    attributes: {
      type: 'any',
      description: `Optional attributes describing the partition.`,
      isNullable: true,
    },
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
  },
} as const;
