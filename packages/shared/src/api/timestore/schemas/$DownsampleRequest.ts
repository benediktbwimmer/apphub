/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $DownsampleRequest = {
  properties: {
    intervalUnit: {
      type: 'Enum',
    },
    intervalSize: {
      type: 'number',
      minimum: 1,
    },
    aggregations: {
      type: 'array',
      contains: {
        type: 'one-of',
        contains: [{
          properties: {
            fn: {
              type: 'Enum',
              isRequired: true,
            },
            column: {
              type: 'string',
              isRequired: true,
            },
            alias: {
              type: 'string',
              isNullable: true,
            },
          },
        }, {
          properties: {
            fn: {
              type: 'Enum',
              isRequired: true,
            },
            column: {
              type: 'string',
              isNullable: true,
            },
            alias: {
              type: 'string',
              isNullable: true,
            },
          },
        }, {
          properties: {
            fn: {
              type: 'Enum',
              isRequired: true,
            },
            column: {
              type: 'string',
              isRequired: true,
            },
            alias: {
              type: 'string',
              isNullable: true,
            },
          },
        }, {
          properties: {
            fn: {
              type: 'Enum',
              isRequired: true,
            },
            column: {
              type: 'string',
              isRequired: true,
            },
            percentile: {
              type: 'number',
              isRequired: true,
              maximum: 1,
            },
            alias: {
              type: 'string',
              isNullable: true,
            },
          },
        }],
      },
      isRequired: true,
    },
  },
} as const;
