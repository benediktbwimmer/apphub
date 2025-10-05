/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $IngestionSchema = {
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
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
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
