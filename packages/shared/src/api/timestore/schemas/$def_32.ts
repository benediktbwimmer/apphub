/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_32 = {
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
} as const;
