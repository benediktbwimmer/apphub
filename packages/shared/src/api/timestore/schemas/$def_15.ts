/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_15 = {
  properties: {
    fields: {
      type: 'array',
      contains: {
        properties: {
          name: {
            type: 'string',
            description: `Logical column name defined by the dataset schema.`,
            isRequired: true,
          },
          type: {
            type: 'Enum',
            isRequired: true,
          },
        },
      },
      isRequired: true,
    },
    evolution: {
      properties: {
        defaults: {
          type: 'any',
          isNullable: true,
        },
        backfill: {
          type: 'boolean',
          isNullable: true,
        },
      },
    },
  },
} as const;
