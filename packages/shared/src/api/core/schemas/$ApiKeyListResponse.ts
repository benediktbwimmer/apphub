/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $ApiKeyListResponse = {
  properties: {
    data: {
      properties: {
        keys: {
          type: 'array',
          contains: {
            type: 'def_75',
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
