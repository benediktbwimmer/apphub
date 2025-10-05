/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $PartitionFilters = {
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
} as const;
