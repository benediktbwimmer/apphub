/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_49 = {
  properties: {
    data: {
      type: 'array',
      contains: {
        properties: {
          runtime: {
            type: 'Enum',
            isRequired: true,
          },
          ready: {
            type: 'boolean',
            isRequired: true,
          },
          reason: {
            type: 'string',
            isRequired: true,
            isNullable: true,
          },
          checkedAt: {
            type: 'string',
            isRequired: true,
            format: 'date-time',
          },
          details: {
            type: 'def_0',
            isRequired: true,
          },
        },
      },
      isRequired: true,
    },
  },
} as const;
