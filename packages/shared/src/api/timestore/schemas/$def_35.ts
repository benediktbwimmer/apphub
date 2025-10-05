/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_35 = {
  properties: {
    executionId: {
      type: 'string',
      isRequired: true,
    },
    columns: {
      type: 'array',
      contains: {
        properties: {
          name: {
            type: 'string',
            isRequired: true,
          },
          type: {
            type: 'string',
            isRequired: true,
          },
          nullable: {
            type: 'boolean',
            isNullable: true,
          },
          description: {
            type: 'string',
            isNullable: true,
          },
        },
      },
      isRequired: true,
    },
    rows: {
      type: 'array',
      contains: {
        type: 'dictionary',
        contains: {
          type: 'any-of',
          contains: [{
            type: 'any-of',
            description: `Arbitrary JSON value.`,
            contains: [{
              type: 'string',
            }, {
              type: 'number',
            }, {
              type: 'number',
            }, {
              type: 'boolean',
            }, {
              type: 'dictionary',
              contains: {
                properties: {
                },
              },
            }],
          }, {
            type: 'null',
          }],
        },
      },
      isRequired: true,
    },
    truncated: {
      type: 'boolean',
      description: `Indicates whether results were truncated due to limits.`,
      isRequired: true,
    },
    warnings: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    statistics: {
      properties: {
        rowCount: {
          type: 'number',
          isRequired: true,
        },
        elapsedMs: {
          type: 'number',
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
