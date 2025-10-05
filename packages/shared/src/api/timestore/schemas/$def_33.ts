/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_33 = {
  properties: {
    rows: {
      type: 'array',
      contains: {
        type: 'dictionary',
        contains: {
          properties: {
          },
        },
      },
      isRequired: true,
    },
    columns: {
      type: 'array',
      contains: {
        type: 'string',
      },
      isRequired: true,
    },
    mode: {
      type: 'Enum',
      isRequired: true,
    },
    warnings: {
      type: 'array',
      contains: {
        type: 'string',
      },
    },
    streaming: {
      type: 'any',
      isNullable: true,
    },
  },
} as const;
