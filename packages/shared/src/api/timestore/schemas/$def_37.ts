/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_37 = {
  properties: {
    fetchedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    tables: {
      type: 'array',
      contains: {
        properties: {
          name: {
            type: 'string',
            isRequired: true,
          },
          description: {
            type: 'string',
            isNullable: true,
          },
          partitionKeys: {
            type: 'any[]',
            isNullable: true,
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
        },
      },
      isRequired: true,
    },
    warnings: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
  },
} as const;
