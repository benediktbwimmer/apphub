/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_3 = {
  properties: {
    acceptedAt: {
      type: 'string',
      isRequired: true,
      format: 'date-time',
    },
    event: {
      type: 'dictionary',
      contains: {
        properties: {
        },
      },
      isRequired: true,
    },
  },
} as const;
