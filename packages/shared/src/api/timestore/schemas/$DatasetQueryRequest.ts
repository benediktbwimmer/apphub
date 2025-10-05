/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $DatasetQueryRequest = {
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
      type: 'array',
      contains: {
        type: 'string',
      },
      isNullable: true,
    },
    filters: {
      properties: {
        partitionKey: {
          type: 'dictionary',
          contains: {
            type: 'one-of',
            contains: [{
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
            }, {
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
            }, {
              properties: {
                type: {
                  type: 'Enum',
                },
                eq: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                in: {
                  type: 'array',
                  contains: {
                    type: 'string',
                    format: 'date-time',
                  },
                  isNullable: true,
                },
                gt: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                gte: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                lt: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                lte: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
              },
            }, {
              type: 'array',
              contains: {
                type: 'string',
              },
            }],
          },
          isNullable: true,
        },
        columns: {
          type: 'dictionary',
          contains: {
            type: 'one-of',
            contains: [{
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
            }, {
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
            }, {
              properties: {
                type: {
                  type: 'Enum',
                },
                eq: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                in: {
                  type: 'array',
                  contains: {
                    type: 'string',
                    format: 'date-time',
                  },
                  isNullable: true,
                },
                gt: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                gte: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                lt: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
                lte: {
                  type: 'string',
                  isNullable: true,
                  format: 'date-time',
                },
              },
            }, {
              properties: {
                type: {
                  type: 'Enum',
                },
                eq: {
                  type: 'boolean',
                  isNullable: true,
                },
                in: {
                  type: 'array',
                  contains: {
                    type: 'boolean',
                  },
                  isNullable: true,
                },
              },
            }],
          },
          isNullable: true,
        },
      },
      isNullable: true,
    },
    downsample: {
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
